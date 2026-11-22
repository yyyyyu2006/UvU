(function (root) {
    'use strict';
    const CACHE_SCOPE = root.UvUTestEnvironment?.channel === 'test' || /(?:^|\/)test(?:\/|$)/.test(root.location?.pathname || '') ? 'test' : 'main';
    const SETTINGS = 'uvu.music.extensions.v1', CREDS = 'uvu.music.navidrome.session.v1', CACHE = 'uvu-music-authorized-v1-' + CACHE_SCOPE;
    const copy = v => JSON.parse(JSON.stringify(v));
    const abort = signal => { if (signal?.aborted) throw new DOMException('已取消', 'AbortError'); };
    const limited = (n, min, max, fallback) => Number.isFinite(Number(n)) ? Math.max(min, Math.min(max, Number(n))) : fallback;
    const defaults = { offline: false, eq: false, replayGain: false, fade: false, navidrome: false, sync: false, maxCacheMB: 256, fadeMs: 600, bands: [0, 0, 0, 0, 0] };
    let memorySettings = {}, credential = null, cacheTail = Promise.resolve();
    const pendingTasks = new Map(), syncClients = new Set();
    function task(name, external) { const controller = new AbortController(); const stop = () => controller.abort(); external?.addEventListener('abort',stop,{once:true}); if (external?.aborted) stop(); if (!pendingTasks.has(name)) pendingTasks.set(name,new Set()); pendingTasks.get(name).add(controller); return {signal:controller.signal,done:()=>{external?.removeEventListener('abort',stop);pendingTasks.get(name)?.delete(controller);}}; }
    function cancelTasks(name) { for (const c of pendingTasks.get(name) || []) c.abort(); }
    function settings() {
        let saved = memorySettings; try { if(root.localStorage) saved = JSON.parse(root.localStorage.getItem(SETTINGS) || '{}'); } catch (_) {}
        const result = { ...defaults };
        for (const k of ['offline','eq','replayGain','fade','navidrome','sync']) result[k] = saved[k] === true;
        result.maxCacheMB = limited(saved.maxCacheMB, 1, 2048, 256); result.fadeMs = limited(saved.fadeMs, 50, 5000, 600);
        result.bands = defaults.bands.map((_, i) => limited(saved.bands?.[i], -12, 12, 0)); return result;
    }
    function configure(patch) {
        const previous = settings(), next = { ...previous };
        for (const key of Object.keys(defaults)) if (Object.prototype.hasOwnProperty.call(patch || {}, key)) next[key] = patch[key];
        memorySettings = next;
        try { root.localStorage?.setItem(SETTINGS, JSON.stringify(next)); } catch (e) { throw new Error('扩展设置无法保存：' + e.message); }
        for (const name of ['offline','navidrome','sync']) if (previous[name] && !next[name]) cancelTasks(name);
        if (previous.sync && !next.sync) for (const client of syncClients) client.stop();
        if ((previous.eq || previous.fade || previous.replayGain) && !next.eq && !next.fade && !next.replayGain) { cancelTasks('audio'); for (const g of activeGraphs) g.bypass(); }
        return settings();
    }
    function enabled(name) { if (!settings()[name]) throw new Error('请先开启此扩展：' + name); }
    function safeEndpoint(value) {
        const u = new URL(value); if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))) || u.username || u.password || u.search || u.hash) throw new Error('请使用 HTTPS，或本机 HTTP 服务地址'); return u.href.replace(/\/$/, '');
    }
    const identity = t => [t.provider, t.serverId || '', t.localId || t.id].map(v => encodeURIComponent(String(v || ''))).join('/');
    const cacheURL = t => 'https://uvu-music.invalid/' + CACHE_SCOPE + '/' + identity(t);
    async function cacheStore() { if (!root.caches) throw new Error('当前浏览器不支持音频缓存'); return root.caches.open(CACHE); }
    async function listCache() {
        const store = await cacheStore(), keys = await store.keys(), out = [];
        for (const req of keys) { const r = await store.match(req); out.push({ key: req.url, title: decodeURIComponent(r.headers.get('x-uvu-title') || ''), size: Number(r.headers.get('content-length')), savedAt: Number(r.headers.get('x-uvu-saved-at')) }); }
        return out;
    }
    async function fullBlob(response, { signal, onProgress, maxBytes = 200 * 1024 * 1024 } = {}) {
        abort(signal);
        if (!response.ok || response.status === 206 || response.type === 'opaque') throw new Error('需要完整、允许跨域读取的音频响应；未保存半份下载');
        const mime = response.headers.get('content-type') || '';
        if (!/^(audio\/|application\/(octet-stream|ogg))/i.test(mime)) throw new Error('响应不是音频，未缓存登录页或错误页');
        const size = Number(response.headers.get('content-length') || 0); if (size > maxBytes) throw new Error('音频超过容量限制');
        if (!response.body?.getReader) { const b = await response.blob(); abort(signal); if (b.size > maxBytes || size && size !== b.size) throw new Error('下载不完整或容量不足'); return b; }
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        const cancel = () => { void reader.cancel().catch(() => {}); }; signal?.addEventListener('abort', cancel, { once: true });
        try { while (true) { abort(signal); const part = await reader.read(); abort(signal); if (part.done) break; bytes += part.value.byteLength; if (bytes > maxBytes) throw new Error('音频超过容量限制'); chunks.push(part.value); onProgress?.({ loaded: bytes, total: size || null }); }
            if (!bytes || size && bytes !== size) throw new Error('下载不完整，未保存'); return new Blob(chunks, { type: mime });
        } catch (e) { await reader.cancel().catch(() => {}); throw e; } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
    }
    async function cacheAudio(track, options = {}) {
        enabled('offline'); if (options.authorized !== true) throw new Error('仅缓存你明确有权离线保存的音频'); abort(options.signal);
        const pending = task('offline',options.signal); options = {...options,signal:pending.signal};
        const run = cacheTail.catch(() => {}).then(async () => {
            abort(options.signal); enabled('offline');
            const entries = await listCache(), key = cacheURL(track), used = entries.filter(e => e.key !== key).reduce((n, e) => n + e.size, 0);
            const maxBytes = Math.max(0, settings().maxCacheMB * 1024 * 1024 - used);
            const quota = await root.navigator?.storage?.estimate?.();
            const budget = Math.min(maxBytes, quota?.quota ? Math.max(0, quota.quota - (quota.usage || 0) - 1024 * 1024) : maxBytes);
            if (budget <= 0) throw new Error('缓存空间不足，请先清理音频');
            let blob = options.blob;
            if (!blob) {
                const u = new URL(options.url); if (!['https:','http:'].includes(u.protocol) || u.username || u.password) throw new Error('音频地址无效');
                blob = await fullBlob(await root.fetch(u.href, { signal: options.signal, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }), { ...options, maxBytes: budget });
            }
            if (!blob.size || blob.size > budget || !/^(audio\/|application\/(octet-stream|ogg))/i.test(blob.type)) throw new Error('音频无效或缓存空间不足');
            abort(options.signal); enabled('offline'); const store = await cacheStore();
            const previous = await store.match(key);
            const resolvedTrack=options.resolvedTrack?portablePlaylists([{id:'resolved',tracks:[options.resolvedTrack]}])[0].tracks[0]:null;
            await store.put(key, new Response(blob, { headers: { 'content-type': blob.type, 'content-length': String(blob.size), 'x-uvu-title': encodeURIComponent(track.title || ''), 'x-uvu-saved-at': String(Date.now()),...(resolvedTrack?{'x-uvu-resolved-track':encodeURIComponent(JSON.stringify(resolvedTrack))}:{}) } }));
            if (options.signal?.aborted || !settings().offline) { if (previous) await store.put(key, previous); else await store.delete(key); abort(options.signal); throw new Error('音频缓存已关闭'); }
            return { size: blob.size, key };
        }); cacheTail = run; return run.finally(pending.done);
    }
    async function readRange(track, range = '') {
        if (!settings().offline) return null;
        const response = await (await cacheStore()).match(cacheURL(track)); if (!response) return null;
        const blob = await response.blob(), size = blob.size, headers = { 'content-type': blob.type, 'accept-ranges': 'bytes', 'content-length': String(size),...(response.headers.get('x-uvu-resolved-track')?{'x-uvu-resolved-track':response.headers.get('x-uvu-resolved-track')}:{}) };
        if (!range) return new Response(blob, { headers });
        const match = /^bytes=(\d*)-(\d*)$/.exec(range); let start, end;
        if (match && (match[1] || match[2])) { start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2])); end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1; }
        if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } });
        headers['content-range'] = `bytes ${start}-${end}/${size}`; headers['content-length'] = String(end - start + 1);
        return new Response(blob.slice(start, end + 1, blob.type), { status: 206, headers });
    }
    const offline = { cache: cacheAudio, list: listCache, readRange,
        resolve: async track => { const r = await readRange(track);if(!r)return null;let resolvedTrack=null;try{const raw=r.headers.get('x-uvu-resolved-track');if(raw)resolvedTrack=portablePlaylists([{id:'resolved',tracks:[JSON.parse(decodeURIComponent(raw))]}])[0].tracks[0];}catch(_){}return { blob:await r.blob(),availability:'full',offline:true,...(resolvedTrack?{resolvedTrack}:{}),resolvedKey:root.UvUMusic?.key?root.UvUMusic.key(resolvedTrack||track):identity(resolvedTrack||track),resolvedVersionKnown:!!resolvedTrack }; },
        remove: async track => (await cacheStore()).delete(typeof track === 'string' ? track : cacheURL(track)),
        clear: async () => { await cacheTail.catch(() => {}); return root.caches?.delete(CACHE); } };
    const graphs = new WeakMap(), activeGraphs = new Set();
    async function attach(element, track, options = {}) {
        const config = settings(), noop = () => {}; if (!config.eq && !config.replayGain && !config.fade) return noop;
        const Context = root.AudioContext || root.webkitAudioContext; if (!Context || element.src || graphs.has(element)) return noop;
        abort(options.signal);
        // Never bind a media element that could become CORS-silent. Core gives this URL to src only after attach.
        let url = options.url || '', blobURL = ''; if (!url) return noop;
        const pending=task('audio',options.signal);options={...options,signal:pending.signal};
        if (url && !url.startsWith('blob:') && !url.startsWith('data:')) {
            try { const b = await fullBlob(await root.fetch(url, { signal: options.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }), { signal: options.signal }); blobURL = URL.createObjectURL(b); }
            catch (e) { pending.done(); if (e.name === 'AbortError') throw e; return noop; }
        }
        let context, source, gain, nodes = [], cleaned = false;
        const cleanup = () => { if (cleaned) return; cleaned = true; element.removeEventListener('play', resume); options.signal?.removeEventListener('abort', cleanup); for (const n of nodes) try { n.disconnect(); } catch (_) {} if (blobURL) URL.revokeObjectURL(blobURL); activeGraphs.delete(graph); if (context) void context.close().catch(() => {}); };
        const resume = () => { if (context?.state === 'suspended') void context.resume().catch(() => {}); };
        let graph;
        try {
            abort(options.signal);context = new Context(); if (context.state === 'suspended') {let resumeTimer;try{await Promise.race([context.resume(),new Promise(resolve=>{resumeTimer=setTimeout(resolve,250);})]);}finally{clearTimeout(resumeTimer);}if(context.state==='suspended'){cleanup();pending.done();return noop;}} abort(options.signal);
            // Creation succeeds before any irreversible connection to the media element.
            gain = context.createGain(); nodes.push(gain); let tail = gain;
            if (config.eq) for (const [i, frequency] of [60,230,910,3600,14000].entries()) { const filter = context.createBiquadFilter(); filter.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking'; filter.frequency.value = frequency; filter.Q.value = 0.8; filter.gain.value = config.bands[i]; tail.connect(filter); nodes.push(filter); tail = filter; }
            tail.connect(context.destination);
            const db = config.replayGain && Number.isFinite(track.replayGainDb) ? limited(track.replayGainDb, -24, 12, 0) : 0;
            const target = Math.pow(10, db / 20); gain.gain.value = config.fade ? 0 : target;
            if (config.fade) gain.gain.linearRampToValueAtTime(target, context.currentTime + config.fadeMs / 1000);
            source = context.createMediaElementSource(element); nodes.push(source); source.connect(gain);
            graph = { context, gain, cleanup, target, bypass:()=>{source.disconnect(); source.connect(context.destination);} }; graphs.set(element, graph); activeGraphs.add(graph);
            if (blobURL) cleanup.sourceURL = blobURL;
            element.addEventListener('play', resume); options.signal?.addEventListener('abort', cleanup, { once: true }); pending.done();return cleanup;
        } catch (e) { cleanup();pending.done(); if (e.name === 'AbortError') throw e; return noop; }
    }
    const audio = { attach, fadeOut: async (element, ms = settings().fadeMs) => { const g = graphs.get(element); if (!g || !settings().fade) return; const duration = limited(ms, 0, 5000, 600); g.gain.gain.cancelScheduledValues(g.context.currentTime); g.gain.gain.setValueAtTime(g.gain.gain.value, g.context.currentTime); g.gain.gain.linearRampToValueAtTime(0, g.context.currentTime + duration / 1000); await new Promise(r => setTimeout(r, duration)); },
        resetGain: element => {const g=graphs.get(element);if(!g)return;g.gain.gain.cancelScheduledValues(g.context.currentTime);g.gain.gain.value=g.target;g.gain.gain.setValueAtTime(g.target,g.context.currentTime);},
        suspend: async () => { await Promise.all([...activeGraphs].map(g => g.context.suspend())); }, resume: async () => { await Promise.all([...activeGraphs].map(g => g.context.resume())); } };
    function creds() { if (credential) return credential; try { return credential=JSON.parse(root.sessionStorage?.getItem(CREDS) || 'null'); } catch (_) { return null; } }
    // OpenSubsonic's legacy token contract requires MD5(password + random salt).
    // This small implementation is restricted to that protocol; it is not a general encryption primitive.
    function subsonicToken(value) {
        const input=new TextEncoder().encode(value),length=Math.ceil((input.length+9)/64)*64,bytes=new Uint8Array(length);bytes.set(input);bytes[input.length]=128;const view=new DataView(bytes.buffer);view.setUint32(length-8,input.length*8,true);
        const words=[0x67452301,0xefcdab89,0x98badcfe,0x10325476],shift=[[7,12,17,22],[5,9,14,20],[4,11,16,23],[6,10,15,21]];
        for(let block=0;block<length;block+=64){let [a,b,c,d]=words;for(let i=0;i<64;i++){const round=i>>4,g=round===0?i:round===1?(5*i+1)%16:round===2?(3*i+5)%16:7*i%16;const f=round===0?(b&c)|(~b&d):round===1?(d&b)|(~d&c):round===2?b^c^d:c^(b|~d);const sum=(a+f+Math.floor(Math.abs(Math.sin(i+1))*4294967296)+view.getUint32(block+g*4,true))|0,s=shift[round][i%4],rot=(sum<<s)|(sum>>>(32-s)),old=d;d=c;c=b;b=(b+rot)|0;a=old;}for(const [i,n]of [a,b,c,d].entries())words[i]=(words[i]+n)|0;}
        return words.map(n=>[0,8,16,24].map(s=>((n>>>s)&255).toString(16).padStart(2,'0')).join('')).join('');
    }
    function navConfig() { const c = creds(); return c ? { endpoint: c.endpoint, username: c.username, serverId: c.serverId, configured: true } : { configured: false }; }
    async function configureNav(raw) {
        const endpoint = safeEndpoint(raw.endpoint), username = String(raw.username || '').trim(), password = String(raw.password || ''),apiKey=String(raw.apiKey||''); if ((!username || !password)&&!apiKey) throw new Error('请填写自建音乐库用户名和密码，或服务器提供的 API Key');if(username.length>200||password.length>4096||apiKey.length>2048)throw Error('认证信息过长');
        const bytes = new TextEncoder().encode(endpoint), hash = await root.crypto.subtle.digest('SHA-256', bytes);
        cancelTasks('navidrome'); credential = { endpoint, username, password,apiKey, serverId: Array.from(new Uint8Array(hash)).map(n => n.toString(16).padStart(2,'0')).join('') };
        root.sessionStorage?.setItem(CREDS, JSON.stringify(credential)); return navConfig();
    }
    function navTrack(raw) { const c = creds(); if (!c) throw new Error('尚未连接自己的音乐库'); return { provider: 'navidrome', serverId: c.serverId, id: String(raw.id), title: String(raw.title || '未命名'), artists: raw.artist ? [String(raw.artist)] : [], album: String(raw.album || ''), cover: '', duration: Number(raw.duration) || 0, availability: 'full', ...(Number.isFinite(raw.replayGain?.trackGain) ? { replayGainDb: raw.replayGain.trackGain } : {}) }; }
    async function navCall(method, params = {}, signal, binary = false) {
        enabled('navidrome'); abort(signal); const c = creds(); if (!c) throw new Error('尚未连接自己的音乐库');
        const pending=task('navidrome',signal);signal=pending.signal;
        try {
        if(!c.extensions){const d=await discoverNav(c.endpoint,signal);c.extensions=d.extensions;}
        if(!c.extensions.some(e=>e.name==='formPost'))throw Error('服务器未声明支持安全表单 POST，请先升级或启用 OpenSubsonic formPost');
        if(c.apiKey&&!c.extensions.some(e=>e.name==='apiKeyAuthentication'))throw Error('此服务器未声明支持 API Key 认证');
        const salt=Array.from(root.crypto.getRandomValues(new Uint8Array(12))).map(n=>n.toString(16).padStart(2,'0')).join('');
        const body = new URLSearchParams({ ...(c.apiKey?{apiKey:c.apiKey}:{u:c.username,t:subsonicToken(c.password+salt),s:salt}), v:'1.16.1', c:'UvU', f:'json', ...params });
        const response = await root.fetch(c.endpoint + '/rest/' + method + '.view', { method:'POST', body, signal, mode:'cors', credentials:'omit', cache:'no-store', redirect:'error',referrerPolicy:'no-referrer' }); abort(signal);
        if (creds()?.serverId !== c.serverId) throw new DOMException('音乐库已切换', 'AbortError');
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '自建音乐库认证失效' : '自建音乐库请求失败：' + response.status);
        if (binary) return { blob: await fullBlob(response, { signal }), availability:'full' };
        const result = (await response.json())['subsonic-response']; abort(signal); if (!result || result.status !== 'ok') throw new Error('自建音乐库：' + (result?.error?.message || '返回资料无效')); return result;
        } finally { pending.done(); }
    }
    async function discoverNav(endpoint,signal){
        enabled('navidrome');abort(signal);const base=safeEndpoint(endpoint),pending=task('navidrome',signal);signal=pending.signal;
        try {const response=await root.fetch(base+'/rest/getOpenSubsonicExtensions.view?f=json&v=1.16.1&c=UvU',{signal,mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});abort(signal);if(!response.ok)throw Error('无法读取自建音乐库能力：'+response.status);const result=(await response.json())['subsonic-response'];abort(signal);if(result?.status!=='ok')throw Error('自建音乐库不支持能力查询');return {extensions:Array.isArray(result.openSubsonicExtensions)?result.openSubsonicExtensions:[]};}finally{pending.done();}
    }
    function lyricText(layer){const lines=Array.isArray(layer?.line)?layer.line:[];const synced=layer?.synced===true&&lines.every(l=>Number.isFinite(l.start));const offset=Number.isFinite(layer?.offset)?layer.offset:0;return lines.map(line=>{const value=String(line.value||'');if(!synced)return value;const ms=Math.max(0,line.start-offset),minutes=Math.floor(ms/60000),seconds=Math.floor(ms/1000)%60;return '['+String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0')+'.'+String(Math.floor(ms%1000)).padStart(3,'0')+']'+value;}).join('\n');}
    const navidrome = { configure: configureNav, settings: navConfig,discover:discoverNav, disconnect: () => { cancelTasks('navidrome'); credential = null; root.sessionStorage?.removeItem(CREDS); }, normalizeTrack: navTrack,
        capabilities: async signal => { const ping = await navCall('ping', {}, signal);return { version:ping.version, openSubsonic:ping.openSubsonic === true, extensions:creds()?.extensions||[] }; },
        search: async (query, options = {}) => { const count = Math.floor(limited(options.count,1,100,30)), offset = Math.floor(limited(options.offset,0,100000,0)); const r = await navCall('search3', { query:String(query).slice(0,200), songCount:String(count), songOffset:String(offset), artistCount:'0', albumCount:'0' }, options.signal); const songs = r.searchResult3?.song || []; return { tracks:songs.map(navTrack), hasMore:songs.length === count, nextOffset:offset + songs.length }; },
        playlists: async signal => ((await navCall('getPlaylists', {}, signal)).playlists?.playlist || []).map(p => ({ id:String(p.id), name:String(p.name || '歌单'), trackCount:Number(p.songCount) || 0 })),
        playlist: async (id, signal) => { const p = (await navCall('getPlaylist', { id:String(id) }, signal)).playlist; if (!p) throw new Error('歌单不存在'); return { id:String(p.id), name:String(p.name || '歌单'), tracks:(p.entry || []).map(navTrack) }; },
        lyrics: async (track, signal) => { checkNavTrack(track); try { const result = await navCall('getLyricsBySongId', { id:track.id }, signal); const lyrics = result.lyricsList?.structuredLyrics || [],main=lyrics.find(l=>!l.kind||l.kind==='main')||lyrics[0],translation=lyrics.find(l=>l.kind==='translation');return {structured:lyrics,text:lyricText(main),...(translation?{translation:lyricText(translation)}:{})}; } catch (e) { abort(signal); const r = await navCall('getLyrics', { artist:track.artists?.[0] || '', title:track.title || '' }, signal); return { text:r.lyrics?.value || '', structured:[] }; } },
        resolve: async (track, signal) => { checkNavTrack(track); return navCall('stream', { id:track.id }, signal, true); } };
    function checkNavTrack(track) { if (track.provider !== 'navidrome' || track.serverId !== creds()?.serverId) throw new Error('歌曲来自另一个自建音乐库，请切回对应服务器'); }
    // A base snapshot makes deletions and concurrent edits explicit. No timestamp silently wins a conflict.
    function portablePlaylists(values) {
        if (!Array.isArray(values) || values.length > 100) throw new Error('歌单资料无效');
        const seen = new Set(); return values.map(p => {
            if (!p || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.id) || seen.has(p.id) || !Array.isArray(p.tracks) || p.tracks.length > 1000) throw new Error('歌单资料无效'); seen.add(p.id);
            return { id:p.id, name:String(p.name || '').slice(0,160), tracks:p.tracks.map(t => {
                if (!['netease','qq','local','gd-netease','navidrome'].includes(t.provider) || !t.id) throw new Error('歌曲来源无效');
                return { provider:t.provider, id:String(t.id).slice(0,160), title:String(t.title || '').slice(0,300), artists:(Array.isArray(t.artists) ? t.artists : []).slice(0,20).map(v => String(v).slice(0,160)), album:String(t.album || '').slice(0,300), duration:limited(t.duration,0,86400,0), ...(typeof t.version==='string'?{version:t.version.slice(0,200)}:{}),...(Number.isFinite(t.replayGainDb)?{replayGainDb:limited(t.replayGainDb,-24,12,0)}:{}), ...(t.provider === 'navidrome' ? {serverId:String(t.serverId || '').slice(0,100)} : {}) };
            }) };
        });
    }
    function snapshot(playlists) { let deviceId; try { deviceId = root.localStorage?.getItem(SETTINGS + '.device'); } catch (_) {} if (!deviceId) { deviceId = root.crypto.randomUUID(); root.localStorage?.setItem(SETTINGS + '.device', deviceId); } return { version:1, deviceId, revision:Date.now(), playlists:portablePlaylists(playlists) }; }
    function preview(local, remote, base = { version:1, playlists:[] }) {
        for (const value of [local,remote,base]) if (value?.version !== 1) throw new Error('同步资料版本不兼容');
        const a = new Map(portablePlaylists(local.playlists).map(p => [p.id,p])), b = new Map(portablePlaylists(remote.playlists).map(p => [p.id,p])), c = new Map(portablePlaylists(base.playlists).map(p => [p.id,p]));
        const rows = []; for (const id of new Set([...a.keys(),...b.keys(),...c.keys()])) { const l = a.get(id) || null, r = b.get(id) || null, old = c.get(id) || null, eq = (x,y) => JSON.stringify(x) === JSON.stringify(y); rows.push({ id, local:l, remote:r, base:old, conflict:!eq(l,r) && !eq(l,old) && !eq(r,old), selected:eq(l,r) || eq(r,old) ? 'local' : eq(l,old) ? 'remote' : null }); }
        return { version:1, rows };
    }
    function merge(plan, choices = {}) { if (plan.version !== 1) throw new Error('同步资料版本不兼容'); const result = []; for (const row of plan.rows) { const selection = Object.prototype.hasOwnProperty.call(choices,row.id)?choices[row.id]:row.selected; if (!['local','remote','both'].includes(selection)) throw new Error('请先处理歌单冲突：' + row.id); let item = row[selection]; if (selection === 'both') { if (!row.local || !row.remote) throw new Error('删除冲突需要明确选择保留或删除'); const unique = new Map(); for (const t of [...row.local.tracks,...row.remote.tracks]) unique.set(identity(t),t); item = { ...row.local, tracks:[...unique.values()] }; } if (item) result.push(item); } return portablePlaylists(result); }
    function createClient(options = {}) {
        enabled('sync'); const endpoint = safeEndpoint(options.endpoint); let room = null, controller = null, running = false, offset = 0, failures = 0, pollTask = null;
        const emit = (type, value) => { options.onEvent?.(type,value); if(type==='state')options.onState?.(value); if(type==='participants')options.onParticipants?.(value);if(type==='disconnected')options.onError?.(new Error(value.message)); };
        async function call(path, data, signal) { enabled('sync'); const pending=task('sync',signal);try {const before = Date.now(); const response = await root.fetch(endpoint + path, { method:data === undefined ? 'GET':'POST', headers:{ 'content-type':'application/json', ...(room ? {authorization:'Bearer ' + room.token} : {}) }, ...(data === undefined ? {} : {body:JSON.stringify(data)}), signal:pending.signal, credentials:'omit', cache:'no-store',redirect:'error' }); const result = await response.json();abort(pending.signal); if (!response.ok) throw new Error(result.error || '同步服务错误'); offset = result.serverTime - (before + Date.now()) / 2; return result;} finally{pending.done();} }
        const api = {
            create: async () => { const result = await call('/v1/rooms', {version:1}); room = {id:result.id,token:result.token,invite:result.invite,role:'host'}; syncClients.add(api); return copy(room); },
            join: async (id, invite) => { const result = await call('/v1/rooms/' + encodeURIComponent(id) + '/join', {invite,version:1}); room = {id,token:result.token,role:'guest'}; syncClients.add(api); return copy(room); },
            info: () => room ? { id:room.id, role:room.role } : null,
            publish: async state => { if (!room) throw new Error('尚未加入房间'); const track = state.track ? portablePlaylists([{id:'room',tracks:[state.track]}])[0].tracks[0] : null; return call('/v1/rooms/' + room.id + '/control', {version:1,track,playing:state.playing === true,position:limited(state.position,0,86400,0), clientTime:Date.now() + offset}); },
            save: async (value, revision) => { if (!room) throw new Error('尚未加入房间'); return call('/v1/rooms/' + room.id + '/playlists', {version:1, expectedRevision:revision, snapshot:{version:1,playlists:portablePlaylists(value.playlists)}}); },
            load: async () => { if (!room) throw new Error('尚未加入房间'); return call('/v1/rooms/' + room.id + '/playlists'); },
            poll: async signal => { if (!room) throw new Error('尚未加入房间'); const result = await call('/v1/rooms/' + room.id + '/state', undefined, signal); const s = result.state; const position = Math.min(86400,s.position + (s.playing ? Math.max(0,(Date.now() + offset - s.updatedAt) / 1000) : 0)); const value = { ...s, position }; emit('state',value);emit('participants',result.participants); return value; },
            start: () => { if (running) return pollTask; running = true; controller = new AbortController(); const signal = controller.signal; pollTask = (async () => { while (running && !signal.aborted) { try { await api.poll(signal); if (failures) emit('reconnected',{}); failures=0; } catch (e) { if (signal.aborted) break; failures++; emit('disconnected',{message:e.message,attempt:failures}); } await new Promise(resolve => { const timer = setTimeout(done, Math.min(10000,1000 * Math.pow(2,Math.min(failures,3)))); function done() { clearTimeout(timer); signal.removeEventListener('abort',done); resolve(); } signal.addEventListener('abort',done,{once:true}); }); } })(); return pollTask; },
            stop: () => { running = false; controller?.abort(); },
            leave: async () => { api.stop(); syncClients.delete(api); if (!room) return; try { await call('/v1/rooms/' + room.id + '/leave',{}); } finally { room = null; } },
            // Each device resolves its own lawful source. A failed source never sends credentials to the room.
            apply: async (state, resolver, player) => { if (!state.track) return; const source = await resolver(state.track); if (!source) { emit('unavailable',{track:state.track}); return false; } await player({ ...state, source }); return true; }
        }; api.connect=api.start;return api;
    }
    const api = { settings, configure, offline, audio, navidrome, sync:{ snapshot,preview,merge,createClient } };
    root.UvUMusicExtensions = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
