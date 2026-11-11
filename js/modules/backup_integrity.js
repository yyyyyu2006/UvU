// Optional, bounded module digests. This detects accidental corruption, not authorship.
(function (root) {
    'use strict';
    const maxModuleBytes = 8 * 1024 * 1024, maxTotalBytes = 32 * 1024 * 1024;
    const check = signal => { if (signal?.aborted) throw Object.assign(new Error('备份校验已取消'), { name: 'AbortError' }); };
    async function bytes(value, signal) {
        const encoder = new TextEncoder(), parts = [], ancestors = new Set();let size = 0, buffer = '', lastYield = Date.now();
        const oversized = () => new Error('完整性校验单个模块最多8 MB；请关闭此选项或拆分备份');
        function* visit(item, depth = 0) {
            if (depth > 128) throw new Error('备份校验嵌套过深');
            if (item && typeof item.toJSON === 'function') item = item.toJSON();
            if (typeof item === 'string' && item.length > maxModuleBytes) throw oversized();
            if (item === null || typeof item !== 'object') { const text = JSON.stringify(item);yield text === undefined ? 'null' : text;return; }
            if (ancestors.has(item)) throw new Error('备份校验不支持循环引用');ancestors.add(item);
            if (Array.isArray(item)) { yield '[';for (let i = 0;i < item.length;i++) { if (i) yield ',';yield* visit(item[i], depth + 1); }yield ']'; }
            else { yield '{';let first = true;for (const key of Object.keys(item).sort()) {
                if (item[key] === undefined || typeof item[key] === 'function' || typeof item[key] === 'symbol') continue;
                if (key.length > maxModuleBytes) throw oversized();
                if (!first) yield ',';first = false;yield JSON.stringify(key);yield ':';yield* visit(item[key], depth + 1);
            }yield '}'; }ancestors.delete(item);
        }
        const flush = () => { const chunk = encoder.encode(buffer);size += chunk.byteLength;if (size > maxModuleBytes) throw oversized();parts.push(chunk);buffer = ''; };
        for (const text of visit(value)) {
            check(signal);buffer += text;if (buffer.length >= 65536) flush();
            if (Date.now() - lastYield > 8) { await new Promise(resolve => setTimeout(resolve, 0));check(signal);lastYield = Date.now(); }
        }
        if (buffer) flush();const result = new Uint8Array(size);let offset = 0;for (const part of parts) { result.set(part, offset);offset += part.byteLength; }return result;
    }
    async function digest(value, signal) {
        check(signal);if (!root.crypto?.subtle) throw new Error('当前浏览器不支持安全校验，请使用HTTPS或关闭导出校验');
        const data = await bytes(value, signal), hash = await root.crypto.subtle.digest('SHA-256', data);check(signal);
        return { bytes: data.byteLength, sha256: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('') };
    }
    async function create(modules, { signal } = {}) {
        const entries = {};let total = 0;
        for (const key of Object.keys(modules)) {
            check(signal);if (modules[key] === undefined) continue;
            if (Object.keys(entries).length >= 100) throw new Error('备份校验模块过多');
            const result = await digest(modules[key], signal);total += result.bytes;
            if (total > maxTotalBytes) throw new Error('完整性校验总量最多32 MB；请关闭此选项或拆分备份');
            Object.defineProperty(entries, key, { value: result, enumerable: true });
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        check(signal);return { version: 1, algorithm: 'SHA-256', encoding: 'sorted-json-v1', modules: entries };
    }
    async function verify(modules, manifest, { signal, keys } = {}) {
        check(signal);if (manifest === undefined) return { verified: 0, legacy: true };
        if (!manifest || manifest.version !== 1 || manifest.algorithm !== 'SHA-256' || manifest.encoding !== 'sorted-json-v1' || !manifest.modules || typeof manifest.modules !== 'object' || Array.isArray(manifest.modules) || Object.keys(manifest.modules).length > 100) throw new Error('备份完整性校验清单无效');
        const scope = keys ? new Set(keys) : null;
        for (const key of Object.keys(manifest.modules)) if ((!scope || scope.has(key)) && !Object.hasOwn(modules, key)) throw new Error('备份校验模块缺失：' + key);
        let verified = 0, total = 0;
        for (const key of Object.keys(modules)) {
            if (['_exportVersion', '__chunks__'].includes(key)) continue;
            const entry = Object.hasOwn(manifest.modules, key) && manifest.modules[key];
            if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > maxModuleBytes) throw new Error('备份校验缺失或无效：' + key);
            const actual = await digest(modules[key], signal);total += actual.bytes;
            if (total > maxTotalBytes || actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error('备份模块校验失败：' + key + '，请重新获取备份');
            verified++;await new Promise(resolve => setTimeout(resolve, 0));
        }
        check(signal);return { verified, legacy: false };
    }
    root.UvUBackupIntegrity = { create, verify };
})(globalThis);
