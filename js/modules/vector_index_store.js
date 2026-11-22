// Optional derivative cache. Original chat records and backup format remain readable.
globalThis.VectorIndexStore = (() => {
    let opening;
    function open() {
        if (opening) return opening;
        opening = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') return reject(Error('当前环境不支持独立向量索引'));
            const request = indexedDB.open('uvu-vector-index-v1', 1);
            let settled = false;
            const fail = error => {
                if (settled) return;
                settled = true; clearTimeout(timer); reject(error);
            };
            const timer = setTimeout(() => fail(Error('独立向量索引打开超时')), 5000);
            request.onupgradeneeded = () => {
                const db = request.result;
                db.createObjectStore('manifests', { keyPath: 'id' });
                db.createObjectStore('chunks', { keyPath: 'id' }).createIndex('scope', 'scope');
            };
            request.onsuccess = () => { const db = request.result;
                if (settled) { db.close(); return; }
                settled = true; clearTimeout(timer);
                db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
            request.onerror = () => fail(request.error);
            request.onblocked = () => fail(Error('请关闭其他旧页面后重试索引'));
        }).catch(error => { opening = null; throw error; });
        return opening;
    }
    const equal = (a, b) => a?.length === b?.length && a.every((n, i) => n === b[i]);
    const valid = v => Array.isArray(v) && v.length > 0 && v.length <= 65536 && v.every(Number.isFinite) && v.some(n => n !== 0);
    async function read(scope, inspect = false) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['manifests', 'chunks'], 'readonly');
            const meta = tx.objectStore('manifests').get(scope);
            const vectors = new Map(), inventory = [];
            const rows = tx.objectStore('chunks').index('scope').openCursor(scope);
            rows.onsuccess = () => {
                const cursor = rows.result; if (!cursor) return;
                const row = cursor.value, usable = valid(row.vector);
                if (usable) vectors.set(row.key, row.vector);
                if (inspect) inventory.push({ key: row.key, valid: usable, dimension: Array.isArray(row.vector) ? row.vector.length : 0,
                    estimatedVectorBytes: Array.isArray(row.vector) ? row.vector.length * 8 : 0 });
                cursor.continue();
            };
            tx.onabort = tx.onerror = () => reject(tx.error || Error('独立向量索引读取失败'));
            tx.oncomplete = () => {
                try {
                const index = Object.create(null);
                if (meta.result && (!Array.isArray(meta.result.entries) || meta.result.entries.some(entry => !entry || typeof entry.id !== 'string' || !Array.isArray(entry.chunks) || entry.chunks.some(chunk => !chunk || typeof chunk.key !== 'string' || !Number.isInteger(chunk.start) || chunk.start < 0 || !Number.isInteger(chunk.end) || chunk.end < chunk.start)))) throw Error('独立向量索引结构无效，请检查索引清单后手动重建；原始记忆未删除');
                for (const entry of meta.result?.entries || []) {
                    const chunks = entry.chunks.flatMap(chunk => vectors.has(chunk.key) ? [{ ...chunk, vector: vectors.get(chunk.key) }] : []);
                    if (chunks.length) index[entry.id] = { version: 2, chunks };
                }
                resolve({ index, fingerprint: meta.result?.fingerprint || '', updatedAt: meta.result?.updatedAt || 0,
                    descriptor: meta.result?.descriptor || null, estimatedVectorBytes: meta.result?.estimatedVectorBytes ?? null,
                    ...(inspect ? { inventory, entries: meta.result?.entries || [] } : {}) });
                } catch (error) { reject(error); }
            };
        });
    }
    async function commit(scope, index, fingerprint, guard = () => {}, expectedUpdatedAt, descriptor) {
        guard();
        const wanted = new Map(), entries = [];
        let dimension = 0;
        for (const [id, entry] of Object.entries(index)) {
            if (entry?.version !== 2 || !Array.isArray(entry.chunks)) throw Error('独立向量 index 结构无效');
            const chunks = entry.chunks.map(chunk => {
                if (!valid(chunk.vector) || typeof chunk.key !== 'string' || !Number.isInteger(chunk.start) || chunk.start < 0 || !Number.isInteger(chunk.end) || chunk.end < chunk.start) throw Error('独立向量 index 分块无效');
                if (dimension && dimension !== chunk.vector.length) throw Error('同一索引的向量维度不一致，本次未覆盖旧索引');
                dimension = chunk.vector.length;
                wanted.set(chunk.key, chunk.vector); return { key: chunk.key, start: chunk.start, end: chunk.end };
            });
            entries.push({ id, chunks });
        }
        const estimatedVectorBytes = [...wanted.values()].reduce((bytes, vector) => bytes + vector.length * 8, 0);
        const safeDescriptor = descriptor ? Object.fromEntries(['model', 'provider', 'cleanerVersion', 'chunkerVersion', 'taskMode', 'documentPrefixHash', 'chunkSettingsHash']
            .map(key => [key, String(descriptor[key] || '').slice(0, 200)])) : null;
        if (safeDescriptor) { safeDescriptor.version = 1; safeDescriptor.dimension = dimension; }
        const db = await open(); guard();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['manifests', 'chunks'], 'readwrite'), chunks = tx.objectStore('chunks');
            const previousMeta = tx.objectStore('manifests').get(scope);
            const request = chunks.index('scope').openCursor(scope); let thrown, written = 0, removed = 0;
            tx.onabort = tx.onerror = () => reject(thrown || tx.error || Error('独立向量索引保存失败'));
            tx.oncomplete = () => resolve({ written, removed });
            request.onsuccess = () => {
                try {
                    guard();
                    if (expectedUpdatedAt !== undefined && (previousMeta.result?.updatedAt || 0) !== expectedUpdatedAt) throw Error('索引已更新，请刷新索引清单后重试；本次未覆盖，也未自动重新请求嵌入');
                    const cursor = request.result;
                    if (cursor) {
                        const row = cursor.value;
                        if (!wanted.has(row.key)) { cursor.delete(); removed++; }
                        else if (equal(wanted.get(row.key), row.vector)) wanted.delete(row.key);
                        cursor.continue(); return;
                    }
                    for (const [key, vector] of wanted) {
                        chunks.put({ id: [scope, key], scope, key, vector }); written++;
                    }
                    const manifestDescriptor = safeDescriptor || (previousMeta.result?.descriptor ? { ...previousMeta.result.descriptor, dimension } : null);
                    tx.objectStore('manifests').put({ id: scope, entries, fingerprint, descriptor: manifestDescriptor,
                        estimatedVectorBytes, updatedAt: Math.max(Date.now(), (previousMeta.result?.updatedAt || 0) + 1) });
                } catch (error) { thrown = error; tx.abort(); }
            };
        });
    }
    async function listScopes() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('manifests', 'readonly'), rows = [];
            const request = tx.objectStore('manifests').openCursor();
            request.onsuccess = () => {
                const cursor = request.result; if (!cursor) return;
                const meta = cursor.value, entries = Array.isArray(meta.entries) ? meta.entries : [];
                rows.push({ id: meta.id, sourceCount: entries.length,
                    chunkCount: entries.reduce((count, entry) => count + (Array.isArray(entry?.chunks) ? entry.chunks.length : 0), 0), updatedAt: meta.updatedAt || 0,
                    descriptor: meta.descriptor || null, estimatedVectorBytes: meta.estimatedVectorBytes ?? null, fingerprint: meta.fingerprint || '' });
                cursor.continue();
            };
            tx.oncomplete = () => resolve(rows);
            tx.onabort = tx.onerror = () => reject(tx.error || Error('索引清单读取失败'));
        });
    }
    async function removeScope(scope, expectedUpdatedAt) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['manifests', 'chunks'], 'readwrite'); let thrown;
            const manifests = tx.objectStore('manifests'), chunks = tx.objectStore('chunks');
            const request = manifests.get(scope);
            request.onsuccess = () => {
                if (request.result && request.result.updatedAt !== expectedUpdatedAt) {
                    thrown = Error('索引已更新，请刷新清单后重试'); tx.abort(); return;
                }
                manifests.delete(scope);
                // Cursor deletion avoids loading all vectors just to discard a scope.
                const cursorRequest = chunks.index('scope').openCursor(scope);
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result; if (!cursor) return;
                    cursor.delete(); cursor.continue();
                };
            };
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(thrown || tx.error || Error('索引清理失败'));
        });
    }
    return Object.freeze({ read, commit, listScopes, removeScope });
})();
