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
    async function read(scope) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['manifests', 'chunks'], 'readonly');
            const meta = tx.objectStore('manifests').get(scope);
            const rows = tx.objectStore('chunks').index('scope').getAll(scope);
            tx.onabort = tx.onerror = () => reject(tx.error || Error('独立向量索引读取失败'));
            tx.oncomplete = () => {
                const vectors = new Map((rows.result || []).filter(x => valid(x.vector)).map(x => [x.key, x.vector]));
                const index = Object.create(null);
                for (const entry of meta.result?.entries || []) {
                    const chunks = entry.chunks.flatMap(chunk => vectors.has(chunk.key) ? [{ ...chunk, vector: vectors.get(chunk.key) }] : []);
                    if (chunks.length) index[entry.id] = { version: 2, chunks };
                }
                resolve({ index, fingerprint: meta.result?.fingerprint || '', updatedAt: meta.result?.updatedAt || 0 });
            };
        });
    }
    async function commit(scope, index, fingerprint, guard = () => {}) {
        guard();
        const wanted = new Map(), entries = [];
        for (const [id, entry] of Object.entries(index)) {
            if (entry?.version !== 2 || !Array.isArray(entry.chunks)) throw Error('独立向量 index 结构无效');
            const chunks = entry.chunks.map(chunk => {
                if (!valid(chunk.vector) || typeof chunk.key !== 'string' || !Number.isInteger(chunk.start) || !Number.isInteger(chunk.end) || chunk.end < chunk.start) throw Error('独立向量 index 分块无效');
                wanted.set(chunk.key, chunk.vector); return { key: chunk.key, start: chunk.start, end: chunk.end };
            });
            entries.push({ id, chunks });
        }
        const db = await open(); guard();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['manifests', 'chunks'], 'readwrite'), chunks = tx.objectStore('chunks');
            const request = chunks.index('scope').getAll(scope); let thrown, written = 0, removed = 0;
            tx.onabort = tx.onerror = () => reject(thrown || tx.error || Error('独立向量索引保存失败'));
            tx.oncomplete = () => resolve({ written, removed });
            request.onsuccess = () => {
                try {
                    guard();
                    const previous = new Map(request.result.map(row => [row.key, row]));
                    for (const row of request.result) if (!wanted.has(row.key)) { chunks.delete(row.id); removed++; }
                    for (const [key, vector] of wanted) if (!equal(previous.get(key)?.vector, vector)) {
                        chunks.put({ id: [scope, key], scope, key, vector }); written++;
                    }
                    tx.objectStore('manifests').put({ id: scope, entries, fingerprint, updatedAt: Date.now() });
                } catch (error) { thrown = error; tx.abort(); }
            };
        });
    }
    return Object.freeze({ read, commit });
})();
