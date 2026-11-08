// Keep selected values without retaining the full decompressed JSON string or
// constructing objects for categories that were not selected.
function createBackupParser(keys, fullRestore = false) {
    const selected = new Set(keys), stack = [];
    let root, rootDone = false, rootStarted = false, lex = '', token = '', escape = false, unicode = 0, retain = false;
    const syntax = () => { throw new SyntaxError('备份 JSON 格式无效'); };
    const top = () => stack[stack.length - 1];
    const plan = () => {
        const parent = top();
        if (!parent) return { keep: false, mode: 'root' };
        if (parent.mode === 'root' && parent.key === 'modules') return { keep: true, mode: 'modules' };
        return { keep: parent.mode ? selected.has(parent.key) : parent.keep, mode: '' };
    };
    const complete = value => {
        const parent = top();
        if (!parent) { root = value; rootDone = true; return; }
        if (parent.type === 'array') { if (parent.keep) parent.value.push(value); }
        else if (parent.mode === 'root' && parent.key === 'modules') { parent.hasModules = true; parent.modules = value; }
        else if (parent.mode ? selected.has(parent.key) : parent.keep) {
            Object.defineProperty(parent.value, parent.key, { value, enumerable: true, configurable: true, writable: true });
        }
        parent.state = 'commaOrEnd';
    };
    const take = (kind, value) => {
        const parent = top();
        if (kind === '}' || kind === ']') {
            if (!parent || (kind === '}' ? parent.type !== 'object' : parent.type !== 'array') || !['keyOrEnd', 'valueOrEnd', 'commaOrEnd'].includes(parent.state)) syntax();
            stack.pop();
            if (fullRestore && parent.mode === 'root' && parent.hasModules && parent.modules && typeof parent.modules === 'object') parent.modules._exportVersion = '3.0';
            complete(parent.mode === 'root' && parent.hasModules && parent.modules != null ? parent.modules : parent.value);
            return;
        }
        if (parent?.state === 'commaOrEnd') {
            if (kind !== ',') syntax();
            parent.state = parent.type === 'object' ? 'key' : 'value'; return;
        }
        if (parent?.state === 'colon') { if (kind !== ':') syntax(); parent.state = 'value'; return; }
        if (parent?.type === 'object' && ['key', 'keyOrEnd'].includes(parent.state)) {
            if (kind !== 'string') syntax();
            parent.key = value; parent.state = 'colon'; return;
        }
        if (parent && !['value', 'valueOrEnd'].includes(parent.state) || !parent && rootStarted) syntax();
        const options = plan();
        if (!parent) rootStarted = true;
        if (kind === '{' || kind === '[') {
            if (stack.length >= 512) throw new Error('备份嵌套超过 512 层，请检查文件');
            if (options.mode && kind !== '{') throw new Error('备份根数据必须是对象');
            stack.push({ ...options, type: kind === '{' ? 'object' : 'array', state: kind === '{' ? 'keyOrEnd' : 'valueOrEnd',
                value: options.keep || options.mode ? (kind === '{' ? {} : []) : undefined });
        } else if (kind === 'string' || kind === 'primitive') {
            if (!parent || options.mode && value != null) throw new Error('备份根数据必须是对象');
            complete(value);
        } else syntax();
    };
    const finishPrimitive = () => {
        if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(token)) syntax();
        take('primitive', JSON.parse(token)); token = ''; lex = '';
    };
    return {
        write(text) {
            for (const char of text) {
                if (lex === 'string') {
                    if (retain) token += char;
                    if (unicode) { if (!/[0-9a-f]/i.test(char)) syntax(); unicode--; }
                    else if (escape) { if (char === 'u') unicode = 4; else if (!'"\\/bfnrt'.includes(char)) syntax(); escape = false; }
                    else if (char === '\\') escape = true;
                    else if (char === '"') { const value = retain ? JSON.parse(token) : undefined; lex = ''; token = ''; take('string', value); }
                    else if (char.charCodeAt(0) < 32) syntax();
                    continue;
                }
                if (lex === 'primitive') {
                    if (!/[\s\[\]{},:"]/.test(char)) { token += char; continue; }
                    finishPrimitive();
                }
                if (/^[\x20\t\r\n]$/.test(char)) continue;
                if (char === '"') {
                    const parent = top();
                    retain = parent?.type === 'object' && ['keyOrEnd', 'key'].includes(parent.state) || plan().keep;
                    lex = 'string'; token = retain ? '"' : ''; escape = false; unicode = 0;
                } else if ('{}[],:'.includes(char)) take(char);
                else { lex = 'primitive'; token = char; }
            }
        },
        finish() {
            if (lex === 'primitive') finishPrimitive();
            if (lex || stack.length || !rootDone || !root || typeof root !== 'object' || Array.isArray(root)) syntax();
            return root;
        }
    };
}

// Parse off the UI thread and transfer only selected modules back to the page.
self.onmessage = async event => {
    try {
        const { file, keys } = event.data;
        let stream = file.stream();
        const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
        if (signature[0] === 0x1f && signature[1] === 0x8b || /\.ee$/i.test(file.name)) {
            if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持解压 .ee，请使用 JSON 备份');
            stream = stream.pipeThrough(new DecompressionStream('gzip'));
        }
        const reader = stream.getReader(), decoder = new TextDecoder(), parser = createBackupParser(keys, event.data.fullRestore === true);
        let bytes = 0, lastProgress = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > 512 * 1024 * 1024) { await reader.cancel(); throw new Error('解压后备份超过 512 MB，请在原设备按类别拆分导出'); }
                parser.write(decoder.decode(value, { stream: true }));
                if (event.data.progress && bytes - lastProgress >= 1024 * 1024) {
                    lastProgress = bytes; self.postMessage({ progress: { decodedBytes: bytes } });
                }
            }
            parser.write(decoder.decode());
        } finally { reader.releaseLock(); }
        self.postMessage({ modules: parser.finish() });
    } catch (error) { self.postMessage({ error: error instanceof SyntaxError ? '备份 JSON 格式无效' : error.message }); }
};
