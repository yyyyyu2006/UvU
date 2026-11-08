// Public browser OAuth client only: no embedded client secret, credentials or data in backups.
(function () {
    'use strict';
    const pending = new Set(), refreshing = new Map(), epochs = new Map(), PREFIX = 'uvu.mcp.oauth.v1:', MAX = 65536;
    const cancelled = () => new DOMException('授权已取消', 'AbortError');
    const key = s => PREFIX + encodeURIComponent(s.id + '|' + s.url + '|' + (s.oauth?.clientId || ''));
    const snapshot = s => JSON.stringify([s.id, s.url, s.auth, s.oauth]);
    const epoch = s => epochs.get(key(s)) || 0;
    const callbackUrl = () => new URL('mcp-oauth-callback.html', location.href).href;
    function https(value) {
        const u = new URL(value);
        if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('OAuth 端点必须使用 HTTPS 且不含密码或片段');
        return u;
    }
    function random() { return btoa(Array.from(crypto.getRandomValues(new Uint8Array(32)), n => String.fromCharCode(n)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function waiting(promise,signal){if(signal.aborted)return Promise.reject(cancelled());return new Promise((resolve,reject)=>{const stop=()=>reject(cancelled());signal.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});}
    async function request(url, options = {}, signal, probe = false, stage='token') {
        const controller = new AbortController(), cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
        const timer = setTimeout(cancel, 20000);
        try {
            let response;try{response = await waiting(fetch(https(url).href, { ...options, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' }),controller.signal);}
            catch(error){if(controller.signal.aborted)throw error;throw Object.assign(new Error('OAuth 网络请求失败：检查 CORS、TLS、DNS、本地网络权限和服务状态；浏览器不能单独判定原因'),{code:'OAUTH_NETWORK'});}
            if (probe) { await response.body?.cancel(); return response; }
            if (!response.ok) { await response.body?.cancel(); const error = new Error('OAuth HTTP ' + response.status + '；'+(response.status===400?'核对公开客户端登记、回调地址、授权类型与令牌状态':response.status===401 || response.status===403?'核对授权状态、服务访问权限与客户端登记':'核对元数据端点和服务状态')); error.status = response.status;error.code='OAUTH_HTTP_'+response.status; throw error; }
            if (!(response.headers.get('content-type') || '').includes('application/json') || Number(response.headers.get('content-length')) > MAX) throw new Error('OAuth 返回的元数据格式或大小无效');
            const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '', size = 0;
            try { while (true) { const { value, done } = await waiting(reader.read(),controller.signal); if (done) break; size += value.byteLength; if (size > MAX) throw new Error('OAuth 元数据超过 64 KiB'); text += decoder.decode(value, { stream: true }); } text += decoder.decode(); }
            finally { void reader.cancel().catch(() => {});try{reader.releaseLock();}catch{} }
            let data; try { data = JSON.parse(text); } catch (_) { throw new Error('OAuth 返回的 JSON 无效'); }
            if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('OAuth 元数据无效'); return data;
        } catch (error) { if (signal?.aborted) throw cancelled(); if (controller.signal.aborted)error=Object.assign(new Error('OAuth 请求超时，请重新连接'),{code:'OAUTH_TIMEOUT'});error.stage=stage;error.code ||= 'OAUTH_RESPONSE';error.message='['+error.code+' / '+stage+'] '+error.message;throw error; }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    async function discover(s, signal) {
        const resource = https(s.url), probe = await request(resource.href, { headers: { Accept: 'application/json' } }, signal, true,'resource-probe');
        const challenge = probe.headers.get('WWW-Authenticate') || '', advertised = /resource_metadata="([^"]+)"/i.exec(challenge)?.[1];
        const metadataUrl = advertised || resource.origin + '/.well-known/oauth-protected-resource' + resource.pathname.replace(/\/$/, '');
        const metadata = await request(metadataUrl, {}, signal,false,'resource-metadata');
        if (typeof metadata.resource !== 'string' || new URL(metadata.resource).href !== resource.href) throw new Error('OAuth 资源 resource 与当前 MCP 服务不一致');
        if (!Array.isArray(metadata.authorization_servers) || !metadata.authorization_servers.length) throw new Error('OAuth 服务没有提供授权服务器');
        const issuers=[...new Set(metadata.authorization_servers.map(value=>{const url=https(value);if(url.search)throw new Error('OAuth issuer 颁发地址无效');return url.href.replace(/\/$/,'');}))];
        const selected=s.oauth?.issuer ? https(s.oauth.issuer).href.replace(/\/$/,'') : '';
        if(selected && !issuers.includes(selected))throw new Error('OAuth 所选 issuer 不在服务声明列表中，请核对颁发者');
        if(issuers.length>1 && !selected)throw Object.assign(new Error('OAuth 服务声明多个 issuer，请在授权设置中明确选择颁发者；不会自动尝试其他服务器'),{code:'OAUTH_ISSUER_SELECTION_REQUIRED'});
        const issuer = https(selected || issuers[0]);
        const suffix = issuer.pathname.replace(/\/$/, ''); let auth;
        try { auth = await request(issuer.origin + '/.well-known/oauth-authorization-server' + suffix, {}, signal,false,'issuer-metadata'); }
        catch (error) { if (error.status !== 404) throw error; auth = await request(issuer.href.replace(/\/$/, '') + '/.well-known/openid-configuration', {}, signal,false,'issuer-metadata'); }
        if (auth.issuer !== issuer.href.replace(/\/$/, '') && auth.issuer !== issuer.href) throw new Error('OAuth issuer 颁发者与元数据不一致');
        if (!Array.isArray(auth.code_challenge_methods_supported) || !auth.code_challenge_methods_supported.includes('S256')) throw new Error('OAuth 服务未声明 PKCE S256 支持');
        return { issuer: auth.issuer, authorization: https(auth.authorization_endpoint).href, token: https(auth.token_endpoint).href,
            requireIssuer: auth.authorization_response_iss_parameter_supported === true, resource: resource.href };
    }
    function read(s) {
        try { const value = sessionStorage.getItem(key(s)) || localStorage.getItem(key(s)); return value ? JSON.parse(value) : null; } catch (_) { return null; }
    }
    function remove(s) { sessionStorage.removeItem(key(s)); localStorage.removeItem(key(s)); }
    function store(s, data, remember) {
        const serialized = JSON.stringify(data), storage = remember ? localStorage : sessionStorage, other = remember ? sessionStorage : localStorage;
        storage.setItem(key(s), serialized); other.removeItem(key(s));
    }
    function current(s) { return snapshot(window.MCPServices.service(s.id)) === snapshot(s); }
    async function acceptToken(s, response, details, remember, startedEpoch, rotation = false) {
        if (!current(s) || epoch(s) !== startedEpoch) throw new Error('服务配置或授权状态已变化，授权结果已失效');
        if (typeof response.access_token !== 'string' || !response.access_token || response.access_token.length > 4096 || /[\r\n]/.test(response.access_token) || String(response.token_type).toLowerCase() !== 'bearer') throw new Error('OAuth 服务未返回有效的 Bearer 令牌');
        const seconds = Number(response.expires_in), expires = Number.isFinite(seconds) && seconds > 0 ? Date.now() + Math.min(seconds, 31536000) * 1000 : null;
        const data = { ...details, expires, remember, refresh: typeof response.refresh_token === 'string' && response.refresh_token.length <= 4096 ? response.refresh_token : details.refresh || '' };
        try { store(s, data, remember); const vault = window.MCPServices.vault; (rotation && vault.renew ? vault.renew : vault.set).call(vault, s, response.access_token, remember); }
        catch (error) { remove(s); window.MCPServices.vault.clear(s); throw error; }
        return response.access_token;
    }
    async function connect(s, options = {}) {
        if (pending.has(s.id)) throw new Error('此服务已有授权窗口，请先完成或关闭');
        if (!s.oauth?.clientId?.trim()) throw new Error('请先填写服务提供者登记的公开客户端 ID');
        // Keep window.open before the first await so mobile browsers can treat this as a user gesture.
        const popup = window.open('about:blank', 'uvu-mcp-oauth-' + s.id, 'popup,width=500,height=700');
        if (!popup) throw new Error('授权窗口被浏览器阻止，请允许此站点弹出窗口');
        pending.add(s.id); epochs.set(key(s), epoch(s) + 1); refreshing.delete(key(s));
        const transactionKey = key(s) + ':pending', startedEpoch = epoch(s);
        try {
            if (options.signal?.aborted) throw cancelled();
            const metadata = await discover(s, options.signal), verifier = random(), state = random();
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
            const challenge = btoa(Array.from(digest, n => String.fromCharCode(n)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const redirect = callbackUrl(), auth = new URL(metadata.authorization);
            const params = { response_type: 'code', client_id: s.oauth.clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, resource: s.url };
            if (s.oauth.scope) params.scope = s.oauth.scope; for (const [name, value] of Object.entries(params)) auth.searchParams.set(name, value);
            sessionStorage.setItem(transactionKey, JSON.stringify({ state, verifier, at: Date.now(), issuer: metadata.issuer }));
            const callback = new Promise((resolve, reject) => {
                let timer, poll; const cleanup = () => { clearTimeout(timer); clearInterval(poll); window.removeEventListener('message', receive); options.signal?.removeEventListener('abort', cancel); };
                const done = (fn, value) => { cleanup(); fn(value); }, cancel = () => done(reject, cancelled());
                const receive = event => {
                    const data = event.data;
                    if (event.origin !== location.origin || event.source !== popup || data?.type !== 'uvu-mcp-oauth' || data.state !== state) return;
                    if ((metadata.requireIssuer && !data.iss) || (data.iss && data.iss !== metadata.issuer)) return done(reject, new Error('OAuth 回调 issuer 不匹配'));
                    if (data.error) return done(reject, new Error('OAuth 授权被取消或拒绝'));
                    if (typeof data.code !== 'string' || !data.code || data.code.length > 4096) return done(reject, new Error('OAuth 回调授权码无效'));
                    done(resolve, data.code);
                };
                window.addEventListener('message', receive); options.signal?.addEventListener('abort', cancel, { once: true });
                timer = setTimeout(() => done(reject, new Error('OAuth 授权超过 5 分钟，请重新连接')), 300000);
                poll = setInterval(() => { if (popup.closed) done(reject, new Error('OAuth 授权窗口已关闭')); }, 500);
                if (options.signal?.aborted) cancel();
            });
            popup.location.href = auth.href;
            const code = await callback;
            const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: s.oauth.clientId, code, redirect_uri: redirect, code_verifier: verifier, resource: s.url });
            const response = await request(metadata.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() }, options.signal);
            return await acceptToken(s, response, { token: metadata.token, issuer: metadata.issuer, resource: s.url }, options.remember === true, startedEpoch);
        } finally { pending.delete(s.id); sessionStorage.removeItem(transactionKey); popup.close(); }
    }
    async function access(s, signal) {
        const state = read(s), token = window.MCPServices.vault.get(s);
        if (!state || state.resource !== s.url || !token) throw new Error('此服务需要 OAuth 授权，请点击连接');
        if (!state.expires || state.expires > Date.now() + 30000) return token;
        if (!state.refresh) { disconnect(s); throw new Error('OAuth 已过期，请重新连接'); }
        const id = key(s); let shared = refreshing.get(id);
        if (!shared) {
            const startedEpoch = epoch(s);
            shared = (async () => {
                try {
                    const response = await request(state.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: state.refresh, client_id: s.oauth.clientId, resource: s.url }).toString() });
                    return await acceptToken(s, response, state, state.remember, startedEpoch, true);
                } catch (error) {
                    if (error.status === 400 && epoch(s) === startedEpoch && current(s) && JSON.stringify(read(s)) === JSON.stringify(state)) disconnect(s);
                    throw error;
                }
                finally { if (refreshing.get(id) === shared) refreshing.delete(id); }
            })(); refreshing.set(id, shared);
        }
        return new Promise((resolve, reject) => {
            const cancel = () => reject(cancelled()); signal?.addEventListener('abort', cancel, { once: true });
            shared.then(resolve, reject).finally(() => signal?.removeEventListener('abort', cancel)); if (signal?.aborted) cancel();
        });
    }
    function disconnect(s) { epochs.set(key(s), epoch(s) + 1); refreshing.delete(key(s)); remove(s); window.MCPServices.vault.clear(s); }
    function invalidateExternal(changedKey){
        for(const s of window.MCPServices?.settings?.().services || []){if(changedKey===null || changedKey===key(s) || changedKey?.startsWith('uvu.mcp.secret.v1:')){epochs.set(key(s),epoch(s)+1);refreshing.delete(key(s));try{sessionStorage.removeItem(key(s));}catch{}}}
    }
    window.MCPOAuth = Object.freeze({ connect, access, disconnect, discover, callbackUrl, invalidateExternal });
}());
