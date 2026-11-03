// Parse off the UI thread and transfer only selected modules back to the page.
self.onmessage = async event => {
    try {
        const { file, keys } = event.data;
        let stream = file.stream();
        if (/\.ee$/i.test(file.name)) {
            if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持解压 .ee，请使用 JSON 备份');
            stream = stream.pipeThrough(new DecompressionStream('gzip'));
        }
        const reader = stream.getReader(), decoder = new TextDecoder(), parts = [];
        let bytes = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > 512 * 1024 * 1024) { await reader.cancel(); throw new Error('解压后备份超过 512 MB，请在原设备按类别拆分导出'); }
                parts.push(decoder.decode(value, { stream: true }));
            }
            parts.push(decoder.decode());
        } finally { reader.releaseLock(); }
        let text = parts.join(''); parts.length = 0;
        const data = JSON.parse(text); text = null;
        const modules = data?.modules ?? data;
        if (!modules || typeof modules !== 'object' || Array.isArray(modules)) throw new Error('备份根数据必须是对象');
        self.postMessage({ modules: Object.fromEntries(keys.filter(key => Object.hasOwn(modules, key)).map(key => [key, modules[key]])) });
    } catch (error) { self.postMessage({ error: error instanceof SyntaxError ? '备份 JSON 格式无效' : error.message }); }
};
