// Remote MCP only. Authorization is isolated in mcp_oauth.js; no server-initiated execution.
(function () {
    'use strict';
    const MODERN = '2026-07-28', LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26'];
    const MAX_BYTES = 1024 * 1024;
    let sequence = 0;
    function endpoint(value) {
        let url;
        try { url = new URL(value); } catch (_) { throw new Error('MCP 地址无效'); }
        if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) {
            throw new Error('MCP 需使用无密码、无查询参数的 HTTPS 地址；本机可用 loopback HTTP，令牌请填入专用字段');
        }
        return url.href;
    }
    const aborted = () => new DOMException('请求已取消', 'AbortError');
    function headerValue(value) {
        const str = String(value);
        if (/^[\x20-\x7e]*$/.test(str) && str === str.trim() && !str.startsWith('=?base64?')) return str;
        return '=?base64?' + btoa(Array.from(new TextEncoder().encode(str), n => String.fromCharCode(n)).join('')) + '?=';
    }
    function wait(promise, signal) {
        if (signal?.aborted) return Promise.reject(aborted());
        return new Promise((resolve, reject) => {
            const cancel = () => reject(aborted());
            signal?.addEventListener('abort', cancel, { once: true });
            Promise.resolve(promise).then(resolve, reject).finally(() => signal?.removeEventListener('abort', cancel));
        });
    }
    async function readBody(response, signal, onPacket) {
        const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json' && type !== 'text/event-stream') {
            await response.body?.cancel();
            throw new Error('服务未返回 MCP JSON/SSE；请检查地址是否为 /mcp 接口');
        }
        if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('MCP 响应过大（最多 1 MiB）'); }
        if (!response.body?.getReader) throw new Error('浏览器不支持流式读取，请升级浏览器');
        const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, text = '';
        const packet = data => { let parsed; try { parsed = JSON.parse(data); } catch (_) { throw new Error('MCP 响应 JSON 无效'); } return onPacket ? onPacket(parsed) : parsed; };
        const parseEvents = final => {
            // Normalize only complete lines; a CR split across chunks must not create a false event boundary.
            let match;
            while ((match = /\r\n\r\n|\n\n|\r\r/.exec(text))) {
                const event = text.slice(0, match.index); text = text.slice(match.index + match[0].length);
                const data = event.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
                if (data) { const result = packet(data); if (result !== undefined) return { found: true, value: result }; }
            }
            if (final && text.trim()) throw new Error('MCP SSE 响应不完整');
            return { found: false };
        };
        try {
            while (true) {
                const { value, done } = await wait(reader.read(), signal);
                if (done) { text += decoder.decode(); break; }
                bytes += value.byteLength;
                if (bytes > MAX_BYTES) throw new Error('MCP 响应过大（最多 1 MiB）');
                text += decoder.decode(value, { stream: true });
                if (type === 'text/event-stream') { const event = parseEvents(false); if (event.found) return event.value; }
            }
            if (type === 'application/json') return packet(text);
            const event = parseEvents(true); if (event.found) return event.value;
            throw new Error('MCP SSE 未返回匹配的响应');
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    function failure(status, rpc) {
        const hints = { 401: '令牌已失效，请重新填写令牌或连接 OAuth', 403: '服务拒绝访问，请检查 Origin/CORS、令牌和本地网络权限', 404: '接口或会话不存在，请重新测试连接', 429: '服务限流，请稍后手动重试' };
        const error = new Error(status ? `MCP HTTP ${status}：${hints[status] || '服务请求失败'}` : 'MCP 协议错误（' + (Number.isInteger(rpc?.code) ? rpc.code : '未知') + '）');
        // Do not expose remote error bodies: they can contain credentials and private arguments.
        error.status = status; error.rpc = Number.isInteger(rpc?.code) ? { code: rpc.code, data: rpc.data } : undefined; return error;
    }
    function create(config, token = '') {
        const url = endpoint(config.url);
        if (typeof token !== 'string' || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('令牌格式无效');
        const mode = config.protocol || 'auto';
        if (!['auto', MODERN, ...LEGACY].includes(mode)) throw new Error('不支持的 MCP 协议版本');
        let version = mode === 'auto' ? MODERN : mode, session = '', ready = false, capabilities = null, recovery;
        const timeout = Math.max(1000, Math.min(60000, Number(config.timeoutMs) || 20000));
        async function rpc(method, params = {}, externalSignal, notification = false, paramHeaders = []) {
            if (externalSignal?.aborted) throw aborted();
            const controller = new AbortController(); let timedOut = false;
            const cancel = () => controller.abort(); externalSignal?.addEventListener('abort', cancel, { once: true });
            const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
            const id = notification ? undefined : ++sequence;
            const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
            if (token) headers.Authorization = 'Bearer ' + token;
            if (method !== 'initialize') headers['MCP-Protocol-Version'] = version;
            if (session && version !== MODERN) headers['Mcp-Session-Id'] = session;
            if (version === MODERN) {
                headers['Mcp-Method'] = method;
                if (params.name) headers['Mcp-Name'] = headerValue(params.name);
                for (const header of paramHeaders) {
                    let value = params.arguments;
                    for (const key of header.path) value = value && Object.hasOwn(value, key) ? value[key] : undefined;
                    if (value === undefined) continue;
                    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(header.name) || (header.type === 'integer' && !Number.isSafeInteger(value))) throw new Error('MCP 工具参数头无效');
                    headers['Mcp-Param-' + header.name] = headerValue(value);
                }
                params = { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN,
                    'io.modelcontextprotocol/clientInfo': { name: 'UvU', version: '1.0.0' }, 'io.modelcontextprotocol/clientCapabilities': {} } };
            }
            try {
                let response;
                try { response = await wait(fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, params }),
                    signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' }), controller.signal); }
                catch (error) { if (controller.signal.aborted) throw error; throw new Error('MCP 网络请求失败：检查 HTTPS、CORS、本地网络权限及服务是否运行'); }
                if (notification && response.ok) { await response.body?.cancel(); return {}; }
                let packet;
                try {
                    packet = await readBody(response, controller.signal, value => {
                        if (!value || value.jsonrpc !== '2.0' || Array.isArray(value)) {
                            if (!response.ok) return value;
                            throw new Error('MCP 响应格式无效');
                        }
                        if (value.method && value.id === undefined) return undefined;
                        if (value.id !== id) { if (!response.ok && value.error && value.id === undefined) return value; throw new Error('MCP 响应 ID 不匹配或含未支持的服务端请求'); }
                        return value;
                    });
                } catch (error) {
                    if (response.ok || controller.signal.aborted || /过大/.test(error.message)) throw error;
                    throw failure(response.status);
                }
                if (!response.ok || packet?.error) throw failure(response.ok ? 0 : response.status, packet?.error);
                if (!packet?.result || typeof packet.result !== 'object' || Array.isArray(packet.result)) throw new Error('MCP 响应缺少 result');
                if (packet.result.resultType && packet.result.resultType !== 'complete') throw new Error('本版暂不支持交互式或异步工具结果：' + String(packet.result.resultType).slice(0, 50));
                if (method === 'initialize') {
                    session = response.headers.get('Mcp-Session-Id') || '';
                    if (session.length > 1024 || /[^\x21-\x7e]/.test(session)) throw new Error('MCP 会话标识无效');
                }
                return packet.result;
            } catch (error) {
                if (timedOut) throw new Error('MCP 请求超时；工具可能已执行，请先核实结果，写入操作不会自动重试');
                if (externalSignal?.aborted) throw aborted();
                throw error;
            } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', cancel); }
        }
        async function initialize(signal, preferred) {
            version = preferred || (LEGACY.includes(mode) ? mode : LEGACY[0]); session = '';
            const result = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'UvU', version: '1.0.0' } }, signal);
            if (!LEGACY.includes(result.protocolVersion) || !result.capabilities || typeof result.capabilities !== 'object') throw new Error('服务未提供兼容的 MCP 协议版本');
            version = result.protocolVersion; capabilities = result.capabilities;
            await rpc('notifications/initialized', {}, signal, true);
        }
        async function firstList(signal) {
            if (LEGACY.includes(mode)) { await initialize(signal); return capabilities?.tools ? rpc('tools/list', {}, signal) : { tools: [] }; }
            try { return await rpc('tools/list', {}, signal); }
            catch (error) {
                if (mode !== 'auto') throw error;
                if (error.rpc?.code === -32022) {
                    const supported = error.rpc.data?.supported;
                    const chosen = LEGACY.find(v => Array.isArray(supported) && supported.includes(v));
                    if (!chosen) throw new Error('MCP 服务协议版本不兼容');
                    try { await initialize(signal, chosen); } catch (_) { throw new Error('MCP 服务协议版本协商失败'); }
                } else if (error.status === 400 && (!error.rpc || [-32600, -32601, -32000].includes(error.rpc.code))) await initialize(signal);
                else throw error;
                return capabilities?.tools ? rpc('tools/list', {}, signal) : { tools: [] };
            }
        }
        async function safeRpc(method, params, signal, headers = [], safe = true) {
            try { return await rpc(method, params, signal, false, headers); }
            catch (error) {
                // Session expiration is the only automatic replay. Unknown/write calls never enter this branch.
                if (!safe || error.status !== 404 || !session || version === MODERN || signal?.aborted) throw error;
                if (!recovery) recovery = initialize(signal, version).finally(() => { recovery = null; });
                await wait(recovery, signal);
                return rpc(method, params, signal, false, headers);
            }
        }
        async function list(method, key, signal) {
            if (!ready) { if (LEGACY.includes(mode)) await initialize(signal); ready = true; }
            if (capabilities && !capabilities[key]) return [];
            let page = await safeRpc(method, {}, signal); const entries = [], seen = new Set();
            for (let index = 0; index < 20; index++) {
                if (!Array.isArray(page[key])) throw new Error('MCP 列表格式无效');
                entries.push(...page[key]); if (entries.length > 200) throw new Error('MCP 列表超过 200 项');
                if (!page.nextCursor) return entries;
                if (typeof page.nextCursor !== 'string' || page.nextCursor.length > 4096 || seen.has(page.nextCursor)) throw new Error('MCP 分页无效');
                seen.add(page.nextCursor); page = await safeRpc(method, { cursor: page.nextCursor }, signal);
            }
            throw new Error('MCP 分页超过限制');
        }
        return {
            get version() { return version; },
            get capabilities() { return capabilities ? { ...capabilities } : null; },
            async listTools(signal) {
                if (ready && capabilities && !capabilities.tools) return [];
                let page = ready ? await safeRpc('tools/list', {}, signal) : await firstList(signal);
                ready = true;
                const tools = [], cursors = new Set(); let pages = 0;
                while (true) {
                    if (!Array.isArray(page.tools)) throw new Error('MCP tools/list 缺少工具列表');
                    for (const tool of page.tools) {
                        if (!tool || typeof tool.name !== 'string' || !tool.name || tool.name.length > 128 || /[^\x21-\x7e\u0080-\uffff]/.test(tool.name) || tools.some(t => t.name === tool.name)) throw new Error('MCP 工具名称无效或重复');
                        tools.push(tool);
                    }
                    if (tools.length > 200) throw new Error('工具超过 200 个，请在服务端缩小范围');
                    if (page.nextCursor === undefined || page.nextCursor === null || page.nextCursor === '') break;
                    if (typeof page.nextCursor !== 'string' || page.nextCursor.length > 4096 || cursors.has(page.nextCursor) || ++pages >= 20) throw new Error('MCP 分页无效或超过限制');
                    cursors.add(page.nextCursor); page = await safeRpc('tools/list', { cursor: page.nextCursor }, signal);
                }
                return tools;
            },
            async call(name, args, signal, paramHeaders = [], options = {}) {
                if (!ready) await this.listTools(signal);
                return safeRpc('tools/call', { name, arguments: args }, signal, paramHeaders, options.safeRead === true);
            },
            listResources(signal) { return list('resources/list', 'resources', signal); },
            listPrompts(signal) { return list('prompts/list', 'prompts', signal); },
            async readResource(uri, signal) {
                if (typeof uri !== 'string' || uri.length > 4096 || !/^[a-z][a-z0-9+.-]*:/i.test(uri) || /^(javascript|data|file|vbscript):/i.test(uri) || /[\x00-\x20]/.test(uri)) throw new Error('资源 URI 无效或不允许');
                return safeRpc('resources/read', { uri }, signal);
            },
            async getPrompt(name, args = {}, signal) {
                if (typeof name !== 'string' || !name || name.length > 128 || !args || Array.isArray(args) || typeof args !== 'object' || Object.entries(args).some(([key, value]) => ['__proto__', 'constructor', 'prototype'].includes(key) || typeof value !== 'string' || value.length > 10000)) throw new Error('提示模板名称或参数无效');
                return safeRpc('prompts/get', { name, arguments: args }, signal);
            }
        };
    }
    window.MCPTransport = Object.freeze({ create, endpoint, readBody, wait });
}());
