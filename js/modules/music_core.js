(function (root) {
    'use strict';
    const PROVIDERS = ['netease', 'qq'], MAX_QUEUE = 500, MAX_JSON = 2 * 1024 * 1024;
    const copy = value => JSON.parse(JSON.stringify(value));
    const text = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '';
    const number = (value, max = 86400) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : 0;
    const abortError = () => new DOMException('Music request cancelled', 'AbortError');
    const database = () => typeof db !== 'undefined' ? db : (root.db || (root.db = {}));
    const listeners = new Set(), directSources = new Map(), sessions = new Map(), lyricCache=new Map();
    let saveTail = Promise.resolve(), sequence = 0, queueTimer, sleepTimer, blobDatabase;

    function safeURL(value, portable = false) {
        if (typeof value !== 'string' || !value || value.length > 4096) return '';
        try {
            const url = new URL(value);
            const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
            if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password || url.hash) return '';
            if (portable && [...url.searchParams.keys()].some(key => /token|cookie|auth|secret|sign|credential|key|expires/i.test(key))) return '';
            return url.href;
        } catch (_) { return ''; }
    }
    function endpoint(value) {
        if (!value) return '';
        const safe = safeURL(value), url = safe && new URL(safe);
        if (!url || url.search) throw new Error('Music gateway requires HTTPS (HTTP is allowed on localhost)');
        return safe.replace(/\/$/, '').replace(/\/v1$/, '');
    }
    function normalizeSettings(raw = {}) {
        return { endpoint: endpoint(raw.endpoint), providers: PROVIDERS.filter(provider => !Array.isArray(raw.providers) || raw.providers.includes(provider)), publicSources: Array.isArray(raw.publicSources) && raw.publicSources.includes('gd-netease') ? ['gd-netease'] : [], remember: raw.remember === true };
    }
    function settings() { return normalizeSettings(database().musicSettings || {}); }
    function normalizeTrack(raw) {
        if (!raw || typeof raw !== 'object' || !['netease', 'qq', 'local', 'gd-netease'].includes(raw.provider)) throw new Error('Invalid music provider');
        const id = text(String(raw.id ?? ''), 160).trim();
        if (!id || /[\r\n]/.test(id)) throw new Error('Invalid music track ID');
        const result = { provider: raw.provider, id, title: text(raw.title, 300) || 'Untitled',
            artists: (Array.isArray(raw.artists) ? raw.artists : []).filter(value => typeof value === 'string').slice(0, 20).map(value => text(value, 160)),
            album: text(raw.album, 300), cover: safeURL(raw.cover, true), duration: number(raw.duration),
            availability: ['full', 'preview', 'unavailable'].includes(raw.availability) ? raw.availability : 'unknown' };
        const page = safeURL(raw.pageUrl, true);
        if (page && ((['netease', 'gd-netease'].includes(raw.provider) && new URL(page).hostname === 'music.163.com') || (raw.provider === 'qq' && ['y.qq.com', 'i.y.qq.com'].includes(new URL(page).hostname)))) result.pageUrl = page;
        if (raw.provider === 'gd-netease' && /^\d{1,24}$/.test(raw.artworkId || '')) result.artworkId = String(raw.artworkId);
        if (raw.provider === 'local' && /^[a-zA-Z0-9_-]{1,160}$/.test(raw.localId || '')) result.localId = raw.localId;
        return result;
    }
    const key = track => { const value = normalizeTrack(track); return value.provider + ':' + value.id; };
    function tracks(values, max) {
        const output = [], seen = new Set();
        for (const raw of (Array.isArray(values) ? values.slice(0, max) : [])) {
            try { const value = normalizeTrack(raw), id = key(value); if (!seen.has(id)) { output.push(value); seen.add(id); } } catch (_) {}
        }
        return output;
    }
    function normalizeLibrary(raw = {}) {
        const seen = new Set();
        return { favorites: tracks(raw.favorites, 2000), playlists: (Array.isArray(raw.playlists) ? raw.playlists : []).slice(0, 100).filter(value => {
            if (!value || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id || '') || seen.has(value.id)) return false;
            seen.add(value.id); return true;
        }).map(value => ({ id: value.id, name: text(value.name, 160) || 'Playlist', tracks: tracks(value.tracks, 1000) })),
        recent: tracks(raw.recent, 100), queue: tracks(raw.queue, MAX_QUEUE), searches: [...new Set((Array.isArray(raw.searches) ? raw.searches : []).filter(v => typeof v === 'string').map(v => text(v,200).trim()).filter(Boolean))].slice(0,12),
        playerPrefs: { mode: ['order', 'list', 'shuffle', 'one'].includes(raw.playerPrefs?.mode) ? raw.playerPrefs.mode : 'order', skipUnavailable: raw.playerPrefs?.skipUnavailable === true, queueLabel: text(raw.playerPrefs?.queueLabel,100) } };
    }
    const library = () => normalizeLibrary(database().musicLibrary || {});
    async function writeSetting(name, value) {
        if (typeof dexieDB !== 'undefined' && dexieDB?.globalSettings && typeof runDataPersistence === 'function') {
            await runDataPersistence(() => dexieDB.transaction('rw', dexieDB.globalSettings, () => dexieDB.globalSettings.put({ key: name, value })));
        } else if (typeof saveData === 'function') await saveData();
    }
    function persist(name, mutate) {
        const pending = saveTail.catch(() => {}).then(async () => {
            const store = database(), previous = store[name];
            const current = name === 'musicLibrary' ? library() : settings();
            const next = mutate(current); store[name] = next;
            try {
                await writeSetting(name, next);
            } catch (error) { if (store[name] === next) { if (previous === undefined) delete store[name]; else store[name] = previous; } throw error; }
            emit(); return copy(next);
        });
        saveTail = pending; return pending;
    }
    function saveSettings(patch) {
        return persist('musicSettings', current => normalizeSettings({ ...current, ...patch })).then(next => {
            const token = tokenGet(next.endpoint);
            if (token) tokenSet(next.endpoint, token, next.remember);
            if (state.track?.provider === 'gd-netease' && !next.publicSources.includes('gd-netease')) stop();
            return next;
        });
    }
    function toggleFavorite(track) {
        const value = normalizeTrack(track), id = key(value);
        return persist('musicLibrary', current => {
            const index = current.favorites.findIndex(item => key(item) === id);
            if (index >= 0) current.favorites.splice(index, 1);
            else { if (current.favorites.length >= 2000) throw new Error('Favorite limit reached'); current.favorites.push(value); }
            return current;
        });
    }
    const makeId = () => 'music_' + Date.now().toString(36) + '_' + (++sequence).toString(36);
    async function addPlaylist(name) {
        const id = makeId();
        await persist('musicLibrary', current => { if (current.playlists.length >= 100) throw new Error('Playlist limit reached'); current.playlists.push({ id, name: text(name, 160).trim() || 'Playlist', tracks: [] }); return current; });
        return library().playlists.find(item => item.id === id);
    }
    function editPlaylist(id, edit) {
        return persist('musicLibrary', current => { const item = current.playlists.find(value => value.id === id); if (!item) throw new Error('Playlist not found'); edit(item); return current; });
    }
    function addToPlaylist(id, track) {
        const value = normalizeTrack(track);
        return editPlaylist(id, item => { if (!item.tracks.some(track => key(track) === key(value))) { if (item.tracks.length >= 1000) throw new Error('Playlist track limit reached'); item.tracks.push(value); } });
    }
    const removeFromPlaylist = (id, trackKey) => editPlaylist(id, item => { item.tracks = item.tracks.filter(track => key(track) !== trackKey); });
    const renamePlaylist = (id, name) => editPlaylist(id, item => { item.name = text(name,160).trim() || item.name; });
    const reorderPlaylist = (id, from, to) => editPlaylist(id, item => { if (Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 && from < item.tracks.length && to < item.tracks.length) item.tracks.splice(to,0,item.tracks.splice(from,1)[0]); });
    const removePlaylistTracks = (id, keys) => editPlaylist(id, item => { const selected=new Set(keys); item.tracks=item.tracks.filter(t=>!selected.has(key(t))); });
    async function updateLocal(track, patch) {
        const value=normalizeTrack(track); if(value.provider!=='local') throw new Error('只能编辑本地歌曲资料');
        const next=normalizeTrack({...value,title:text(patch.title,300).trim()||value.title,artists:Array.isArray(patch.artists)?patch.artists:value.artists,album:patch.album===undefined?value.album:text(patch.album,300),cover:patch.cover===undefined?value.cover:safeURL(patch.cover,true)}), id=key(value);
        const replace=list=>list.map(t=>key(t)===id?next:t);
        await persist('musicLibrary', current=>({...current,favorites:replace(current.favorites),recent:replace(current.recent),queue:replace(current.queue),playlists:current.playlists.map(p=>({...p,tracks:replace(p.tracks)}))}));
        state.queue=replace(state.queue); if(state.track&&key(state.track)===id){state.track={...next,duration:state.duration};metadataKey='';}saveQueue();emit();return next;
    }

    const vaultKey = host => 'uvu.music.session.v1:' + encodeURIComponent(host);
    function tokenGet(host) { try { return sessionStorage.getItem(vaultKey(host)) || localStorage.getItem(vaultKey(host)) || ''; } catch (_) { return ''; } }
    function tokenSet(host, token, remember) {
        const name = vaultKey(host);
        let previousSession, previousLocal;
        try {
            previousSession = sessionStorage.getItem(name); previousLocal = localStorage.getItem(name);
            (remember ? localStorage : sessionStorage).setItem(name, token); (remember ? sessionStorage : localStorage).removeItem(name);
        } catch (_) {
            try {
                previousSession == null ? sessionStorage.removeItem(name) : sessionStorage.setItem(name, previousSession);
                previousLocal == null ? localStorage.removeItem(name) : localStorage.setItem(name, previousLocal);
            } catch (_) {}
            throw new Error('Music session storage unavailable');
        }
    }
    function tokenClear(host) { try { sessionStorage.removeItem(vaultKey(host)); localStorage.removeItem(vaultKey(host)); } catch (_) {} }
    function aborted(signal) { if (signal?.aborted) throw abortError(); }
    function withSignal(promise, signal) {
        if (!signal) return promise;
        aborted(signal);
        return new Promise((resolve, reject) => {
            const cancel = () => { cleanup(); reject(abortError()); };
            const cleanup = () => signal.removeEventListener('abort', cancel);
            signal.addEventListener('abort', cancel, { once: true });
            promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
        });
    }
    async function readJSON(response) {
        if (Number(response.headers?.get('content-length')) > MAX_JSON) throw new Error('Music response is too large');
        let raw = '';
        if (response.body?.getReader && typeof TextDecoder === 'function') {
            const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0;
            try {
                while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_JSON) throw new Error('Music response is too large'); raw += decoder.decode(part.value, { stream: true }); }
                raw += decoder.decode();
            } catch (error) { try { await reader.cancel(); } catch (_) {} throw error; }
        } else { raw = await response.text(); if (raw.length > MAX_JSON) throw new Error('Music response is too large'); }
        let result; try { result = JSON.parse(raw); } catch (_) { throw new Error('Music gateway returned invalid JSON'); }
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Music gateway returned invalid data');
        return result;
    }
    function gatewayError(status, raw) {
        const detail = raw?.error && typeof raw.error === 'object' ? raw.error : {};
        const code = /^[a-z][a-z0-9_]{0,79}$/.test(detail.code || '') ? detail.code : '';
        const message = text(detail.message, 2000).replace(/[\r\n\t]+/g, ' ')
            .replace(/https?:\/\/[^\s<>"']+/gi, '[链接已隐藏]')
            .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
            .replace(/\b(cookie|authorization|token|credential|secret|password|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[已隐藏]').slice(0, 300);
        const messages = {
            persistence_disabled: '音乐网关未启用加密会话保存。请取消“记住登录”，或由管理员配置加密存储后重试。',
            account_required: '请先登录对应的音乐平台账号，再读取歌单或播放账号专属内容。',
            unauthorized: '音乐登录会话已失效，请重新连接网关并登录。',
            origin_denied: '音乐网关未允许当前页面地址，请在网关的允许来源中加入本站地址。',
            engine_not_installed: '音乐网关尚未安装平台引擎，请先完成服务端安装。',
            provider_unavailable: '音乐平台暂时不可用，请稍后重试或切换平台。',
            provider_timeout: '音乐平台请求超时，请检查网关网络后重试。',
            rate_limited: '音乐请求过于频繁，请稍后重试。',
            request_limit: '音乐请求过多，请等待当前请求完成后重试。',
            session_limit: '音乐网关会话数量已达上限，请稍后重试或联系管理员。',
            qr_expired: '登录二维码已过期，请生成新的二维码。',
            qr_not_found: '登录二维码不存在或属于其他会话，请重新生成。',
            gateway_closed: '音乐网关正在关闭，请稍后重新连接。'
        };
        const error = new Error(messages[code] || (message ? '音乐服务请求失败：' + message : '音乐服务请求失败（' + status + '），请稍后重试。'));
        error.status = status; if (code) error.code = code; if (message) error.gatewayMessage = message;
        return error;
    }
    async function transport(host, path, { method = 'GET', body, signal, token } = {}) {
        aborted(signal);
        const controller = new AbortController(), relay = () => controller.abort();
        signal?.addEventListener('abort', relay, { once: true });
        const timer = setTimeout(() => controller.abort(), 20000); timer?.unref?.();
        try {
            const response = await fetch(host + '/v1' + path, { method, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
                headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
            if (!response.ok) {
                let detail; try { detail = await readJSON(response); } catch (_) {}
                aborted(controller.signal); throw gatewayError(response.status, detail);
            }
            const result = await readJSON(response); aborted(controller.signal); return result;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', relay); }
    }
    function session(host, signal) {
        const existing = tokenGet(host); if (existing) return withSignal(Promise.resolve(existing), signal);
        let pending = sessions.get(host);
        if (!pending) {
            pending = transport(host, '/session', { method: 'POST', body: { remember: settings().remember } }).then(result => {
                if (settings().endpoint !== host) throw abortError();
                const token = result.token;
                if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('Invalid music session');
                tokenSet(host, token, settings().remember); return token;
            }).finally(() => { if (sessions.get(host) === pending) sessions.delete(host); });
            sessions.set(host, pending);
        }
        return withSignal(pending, signal);
    }
    function request(path, options = {}) {
        if (typeof path !== 'string' || path.length > 3000 || !/^\/(?:health|accounts(?:\/(?:netease|qq)(?:\/qr(?:\/[a-zA-Z0-9_-]{1,200})?|\/playlists)?)?|search|track\/(?:netease|qq)\/[^/?#]+\/(?:stream|lyrics)|playlist\/(?:netease|qq)\/[^/?#]+)(?:\?[^#]*)?$/.test(path)) throw new Error('Invalid music API route');
        if (!['GET', 'POST', 'DELETE'].includes(options.method || 'GET')) throw new Error('Invalid music API method');
        return (async () => {
            const host = settings().endpoint; if (!host) throw new Error('Configure a music gateway first');
            aborted(options.signal);
            let token = await session(host, options.signal);
            if (settings().endpoint !== host) throw abortError();
            try { const result = await transport(host, path, { ...options, token }); if (settings().endpoint !== host) throw abortError(); return result; }
            catch (error) {
                if (error.status !== 401 || (error.code && error.code !== 'unauthorized')) throw error;
                tokenClear(host); token = await session(host, options.signal);
                if (settings().endpoint !== host) throw abortError();
                const result = await transport(host, path, { ...options, token }); if (settings().endpoint !== host) throw abortError(); return result;
            }
        })();
    }
    function provider(value) { if (!PROVIDERS.includes(value)) throw new Error('Invalid music provider'); return value; }
    function publicAdapter() {
        if (!settings().publicSources.includes('gd-netease')) throw new Error('请先在音乐设置中开启 GD 音乐台公共源');
        if (!root.UvUPublicMusic) throw new Error('公共音乐模块尚未加载，请刷新页面');
        return root.UvUPublicMusic;
    }
    const part = value => { const output = text(String(value ?? ''), 200); if (!output) throw new Error('Missing music ID'); return encodeURIComponent(output); };
    const user = raw => raw && typeof raw === 'object' ? { id: text(String(raw.id ?? ''), 160), name: text(raw.name, 160), avatar: safeURL(raw.avatar, true) } : undefined;
    const resultTracks = raw => ({ tracks: tracks(raw.tracks, 200), hasMore: raw.hasMore === true });
    async function accounts(signal) {
        const raw = await request('/accounts', { signal });
        return { accounts: (Array.isArray(raw.accounts) ? raw.accounts : []).filter(item => PROVIDERS.includes(item?.provider)).slice(0, 2).map(item => ({ provider: item.provider, loggedIn: item.loggedIn === true, ...(item.user ? { user: user(item.user) } : {}) })) };
    }
    async function createQR(value, signal) {
        const raw = await request('/accounts/' + provider(value) + '/qr', { method: 'POST', body: {}, signal });
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(raw.id || '')) throw new Error('Invalid music QR response');
        const image = safeURL(raw.image) || (/^data:image\/png;base64,[a-zA-Z0-9+/=]{1,400000}$/.test(raw.image || '') ? raw.image : '');
        return { id: raw.id, image, url: safeURL(raw.url), expiresAt: number(raw.expiresAt, Number.MAX_SAFE_INTEGER) };
    }
    async function pollQR(value, id, signal) {
        const raw = await request('/accounts/' + provider(value) + '/qr/' + part(id), { signal });
        if (!['waiting', 'scanned', 'authorized', 'expired'].includes(raw.status)) throw new Error('Invalid music QR state');
        return { status: raw.status, ...(raw.user ? { user: user(raw.user) } : {}) };
    }
    async function search(q, selected = settings().providers, page = 1, signal) {
        const query = text(q, 200).trim(); if (!query) return { tracks: [], errors: [], hasMore: false };
        if (Array.isArray(selected) && selected.includes('gd-netease')) {
            if (selected.some(value => PROVIDERS.includes(value))) throw new Error('请分别选择公共源或账号源搜索');
            const raw = await publicAdapter().search('gd-netease', query, page, signal); publicAdapter(); aborted(signal);
            return { ...resultTracks(raw), errors: [] };
        }
        const providers = PROVIDERS.filter(value => Array.isArray(selected) && selected.includes(value));
        if (!providers.length) return { tracks: [], errors: [], hasMore: false };
        const raw = await request('/search?providers=' + providers.join(',') + '&q=' + encodeURIComponent(query) + '&page=' + Math.max(1, Math.min(100, Math.floor(Number(page) || 1))), { signal });
        return { ...resultTracks(raw), errors: (Array.isArray(raw.errors) ? raw.errors : []).slice(0, 2).map(item => ({ provider: PROVIDERS.includes(item?.provider) ? item.provider : '', message: text(item?.message, 300) })) };
    }
    async function playlists(value, signal) {
        const raw = await request('/accounts/' + provider(value) + '/playlists', { signal });
        return { playlists: (Array.isArray(raw.playlists) ? raw.playlists : []).filter(item => item && item.id != null).slice(0, 200).map(item => ({ id: text(String(item.id), 160), name: text(item.name, 200), cover: safeURL(item.cover, true), count: number(item.count, 100000) })) };
    }
    async function playlist(value, id, page = 1, signal) { return resultTracks(await request('/playlist/' + provider(value) + '/' + part(id) + '?page=' + Math.max(1, Math.min(100, Math.floor(Number(page) || 1))), { signal })); }
    async function lyrics(track, signal) {
        aborted(signal);const value = normalizeTrack(track); if (value.provider === 'local') return { lyric: '', translation: '' };
        if(value.provider==='gd-netease')publicAdapter();const id=(value.provider==='gd-netease'?'public':settings().endpoint)+':'+key(value),saved=lyricCache.get(id);if(saved&&saved.until>Date.now())return copy(saved.value);
        const raw=value.provider==='gd-netease'?await publicAdapter().lyrics(value,signal):await request('/track/' + provider(value.provider) + '/' + part(value.id) + '/lyrics', { signal });
        if(value.provider==='gd-netease')publicAdapter();aborted(signal);const result={lyric:text(raw.lyric,100000),translation:text(raw.translation,100000)};
        if(lyricCache.size>=20)lyricCache.delete(lyricCache.keys().next().value);lyricCache.set(id,{value:result,until:Date.now()+600000});return copy(result);
    }
    function clearMetadataCache(){const count=lyricCache.size;lyricCache.clear();root.UvUPublicMusic?.clearCache?.();return count;}

    function localDB() {
        if (!blobDatabase) blobDatabase = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') { reject(new Error('Local audio storage is unavailable')); return; }
            const pending = indexedDB.open('uvu-music-local', 1);
            pending.onupgradeneeded = () => pending.result.createObjectStore('audio', { keyPath: 'id' });
            pending.onerror = () => reject(new Error('Local audio storage is unavailable'));
            pending.onsuccess = () => resolve(pending.result);
        }).catch(error => { blobDatabase = undefined; throw error; });
        return blobDatabase;
    }
    async function localRecord(mode, action) {
        const store = await localDB();
        return new Promise((resolve, reject) => {
            const transaction = store.transaction('audio', mode), pending = action(transaction.objectStore('audio'));
            transaction.oncomplete = () => resolve(pending.result);
            transaction.onerror = transaction.onabort = () => reject(new Error('Local audio storage failed'));
        });
    }
    async function importLocal(file) {
        if (!file || typeof file.size !== 'number' || file.size <= 0 || file.size > 30 * 1024 * 1024 || !/^audio\/(mpeg|mp3|mp4|aac|x-m4a|ogg|wav|x-wav|webm|flac|x-flac)$/i.test(file.type || '')) throw new Error('Choose an audio file up to 30 MB');
        const meta=await root.UvUMusicMetadata?.read(file)||{},id = makeId(), value = normalizeTrack({ provider: 'local', id, localId: id, title: text(file.name, 300).replace(/\.[^.]+$/, ''), artists: [],...meta, availability: 'full' });
        await localRecord('readwrite', store => store.put({ id, blob: file }));
        try { await toggleFavorite(value); } catch (error) { try { await localRecord('readwrite', store => store.delete(id)); } catch (_) {} throw error; }
        return value;
    }
    function importURL(url, meta = {}) {
        const source = safeURL(url); if (!source) throw new Error('Use an HTTPS audio URL (HTTP is allowed on localhost)');
        const value = normalizeTrack({ ...meta, provider: 'local', id: text(meta.id, 160) || makeId(), availability: 'unknown' });
        if (directSources.size >= 500 && !directSources.has(key(value))) throw new Error('Direct audio limit reached');
        directSources.set(key(value), source); return value;
    }
    async function deleteLocal(track) {
        const value = normalizeTrack(track);
        if (value.provider !== 'local') throw new Error('Only local audio can be deleted from this device');
        const matches = item => item?.provider === 'local' && (key(item) === key(value) || (value.localId && item.localId === value.localId));
        const pending = saveTail.catch(() => {}).then(async () => {
            const store = database(), previous = store.musicLibrary, current = library();
            const retained = values => values.filter(item => !matches(item));
            const next = { ...current, favorites: retained(current.favorites), recent: retained(current.recent), queue: retained(current.queue),
                playlists: current.playlists.map(item => ({ ...item, tracks: retained(item.tracks) })) };
            const record = value.localId ? await localRecord('readonly', table => table.get(value.localId)) : null;
            if (value.localId) await localRecord('readwrite', table => table.delete(value.localId));
            store.musicLibrary = next;
            try { await writeSetting('musicLibrary', next); }
            catch (error) {
                if (store.musicLibrary === next) { if (previous === undefined) delete store.musicLibrary; else store.musicLibrary = previous; }
                if (record) {
                    try { await localRecord('readwrite', table => table.put(record)); }
                    catch (_) { throw new Error('删除音乐保存失败，本地音频恢复也失败；请保留原始文件后重试。', { cause: error }); }
                }
                throw error;
            }
            directSources.delete(key(value));
            restore(); state.queue = retained(state.queue);
            if (matches(state.track)) stop();
            else { state.index = state.track ? state.queue.findIndex(item => key(item) === key(state.track)) : -1; emit(); }
            return copy(next);
        });
        saveTail = pending; return pending;
    }

    const state = { track: null, queue: [], index: -1, playing: false, phase: 'idle', position: 0, duration: 0, mode: 'order', error: '', errorCode: '', sleepAt: 0, skipUnavailable:false, queueLabel:'', queueVersion:0 };
    let shuffleBag=[], visits=[], visitIndex=-1, priority=[];
    const failedKeys=new Set();
    function resetShuffle(current=state.track){shuffleBag=state.queue.map(key).filter(id=>!current||id!==key(current));for(let i=shuffleBag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffleBag[i],shuffleBag[j]]=[shuffleBag[j],shuffleBag[i]];}}
    function queueChanged(){state.index=state.track?state.queue.findIndex(t=>key(t)===key(state.track)):-1;const ids=new Set(state.queue.map(key));shuffleBag=shuffleBag.filter(id=>ids.has(id));priority=priority.filter(id=>ids.has(id));saveQueue();emit();}
    let restored = false, restoredLibrary, playerTouched = false, audio = null, objectURL = '', intent = 0, seekRevision = 0, loadController, metadataKey = '';
    function restore(touch = false) {
        const raw = database().musicLibrary;
        if (!restored || (!playerTouched && raw !== restoredLibrary)) {
            restored = true; restoredLibrary = raw; const stored = library(); state.queue = stored.queue; state.mode = stored.playerPrefs.mode;state.skipUnavailable=stored.playerPrefs.skipUnavailable;state.queueLabel=stored.playerPrefs.queueLabel;resetShuffle();
        }
        if (touch) playerTouched = true;
    }
    function snapshot() { restore(); return copy(state); }
    function mediaState() {
        if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
        const media = navigator.mediaSession;
        try {
            media.playbackState = state.playing ? 'playing' : state.track ? 'paused' : 'none';
            const trackKey = state.track ? key(state.track) : '';
            if (trackKey !== metadataKey && typeof MediaMetadata === 'function') {
                media.metadata = state.track ? new MediaMetadata({ title: state.track.title, artist: state.track.artists.join(', '), album: state.track.album, ...(state.track.cover ? { artwork: [{ src: state.track.cover }] } : {}) }) : null;
                metadataKey = trackKey;
            }
            if (media.setPositionState && state.duration > 0 && Number.isFinite(state.duration)) media.setPositionState({ duration: state.duration, playbackRate: 1, position: Math.min(state.duration, state.position) });
        } catch (_) {}
    }
    function emit() {
        const current = snapshot();
        for (const listener of listeners) { try { listener(current); } catch (_) {} }
        try { root.dispatchEvent?.(new CustomEvent('music-state', { detail: current })); } catch (_) {}
        mediaState();
    }
    function saveQueue() {
        clearTimeout(queueTimer);
        queueTimer = setTimeout(() => {
            persist('musicLibrary', current => ({ ...current, queue: tracks(state.queue, MAX_QUEUE), playerPrefs: { mode: state.mode, skipUnavailable:state.skipUnavailable,queueLabel:state.queueLabel } })).catch(() => { if(typeof root.showToast==='function')root.showToast('播放队列未保存，请检查存储空间'); });
        }, 250); queueTimer?.unref?.();
    }
    function unload() {
        loadController?.abort(); loadController = null;
        if (audio) { const old = audio; audio = null; old.pause(); old.removeAttribute('src'); old.load(); }
        if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = ''; }
    }
    function fail(error) {
        if(state.phase==='error'||state.phase==='blocked')return Promise.resolve(false);
        const wasAttempting=state.playing||state.phase==='loading';
        state.playing=false;audio?.pause();state.phase=error?.name==='NotAllowedError'?'blocked':'error';
        const message=String(error?.message||'');state.errorCode=state.phase==='blocked'?'permission':/decode|format|could not be loaded|not supported/i.test(message)?'decode':/429|rate|limit|限流|过于频繁/i.test(message)?'rate_limit':/unavailable|not found|无.*地址|不可用|试听/i.test(message)?'unavailable':'network';
        state.error={permission:'请点击播放以允许音频播放',decode:'音频格式不支持或文件无法解码',rate_limit:'音乐服务请求过多，请稍后重试',unavailable:'歌曲暂无可用音源',network:'音频加载失败，请检查网络后重试'}[state.errorCode];emit();
        if(wasAttempting&&state.skipUnavailable&&['network','decode','unavailable'].includes(state.errorCode)&&state.track){
            failedKeys.add(key(state.track));const next=state.queue.find((t,i)=>i>state.index&&!failedKeys.has(key(t)))||state.queue.find(t=>!failedKeys.has(key(t)));
            if(next&&failedKeys.size<Math.min(state.queue.length,5))return play(next,undefined,{keepFailures:true});
            state.error+='；已停止自动跳过';emit();
        }return Promise.resolve(false);
    }
    function playAudio(current, generation) {
        if (!current || generation !== intent) return Promise.resolve();
        state.error = ''; state.errorCode=''; state.phase='loading';
        let result; try { result = current.play(); } catch (error) { result = Promise.reject(error); }
        return Promise.resolve(result).then(() => {
            if (generation !== intent || audio !== current) { if (audio !== current) current.pause(); return; }
            state.playing = true; state.phase = 'playing'; emit();
        }, error => { if (generation === intent && audio === current) return fail(error); });
    }
    async function resolveSource(track, signal) {
        if (track.provider === 'local') {
            if (directSources.has(key(track))) return { url: directSources.get(key(track)), availability: 'full' };
            if (!track.localId) throw new Error('This direct audio URL must be imported again');
            const record = await localRecord('readonly', store => store.get(track.localId)); aborted(signal);
            if (!record?.blob) throw new Error('Local audio is missing on this device');
            return { blob: record.blob, availability: 'full' };
        }
        const result = track.provider === 'gd-netease' ? await publicAdapter().stream(track, signal) : await request('/track/' + track.provider + '/' + part(track.id) + '/stream', { signal });
        if (track.provider === 'gd-netease') publicAdapter();
        if (result.availability === 'unavailable') throw new Error('This track is unavailable for this account');
        const url = safeURL(result.url); if (!url) throw new Error('Music gateway returned an unsafe media URL');
        return { url, availability: ['preview', 'full'].includes(result.availability) ? result.availability : 'unknown', ...(track.provider === 'gd-netease' && safeURL(result.cover,true) ? {cover:safeURL(result.cover,true)} : {}) };
    }
    function play(track, queue, options = {}) {
        restore(true);
        const value = normalizeTrack(track), generation = ++intent;
        if(!options.keepFailures)failedKeys.clear();
        if (queue !== undefined) { state.queue = tracks(queue, MAX_QUEUE);state.queueVersion++;state.queueLabel=text(options.label,100);visits=[];visitIndex=-1;priority=[]; }
        let index = state.queue.findIndex(item => key(item) === key(value));
        if (index < 0) { if (state.queue.length >= MAX_QUEUE) state.queue.pop(); state.queue.push(value); index = state.queue.length - 1; }
        state.index = index;
        if(!options.historyMove&&visits[visitIndex]!==key(value)){visits=visits.slice(0,visitIndex+1);visits.push(key(value));if(visits.length>1000)visits.shift();visitIndex=visits.length-1;}
        if(queue!==undefined)resetShuffle(value);shuffleBag=shuffleBag.filter(id=>id!==key(value));saveQueue();
        if (audio && state.track && key(state.track) === key(value) && state.phase!=='error') return playAudio(audio, generation);
        unload(); state.track = value; state.position = 0; state.duration = value.duration; state.playing = false; state.phase = 'loading'; state.error = '';state.errorCode=''; emit();
        const controller = new AbortController(); loadController = controller;
        return resolveSource(value, controller.signal).then(async source => {
            if (generation !== intent || controller.signal.aborted) return;
            if (typeof Audio !== 'function') throw new Error('Audio playback is unavailable');
            const current = new Audio(); audio = current;
            objectURL = source.blob ? URL.createObjectURL(source.blob) : '';
            current.preload = 'metadata'; current.src = objectURL || source.url; current.referrerPolicy = 'no-referrer';
            state.track = { ...value, availability: source.availability, ...(source.cover ? {cover:source.cover} : {}) };
            const valid = () => audio === current;
            current.addEventListener('timeupdate', () => { if (valid()) { state.position = number(current.currentTime); emit(); } });
            current.addEventListener('loadedmetadata', () => { if (valid()) { state.duration = Number.isFinite(current.duration) ? number(current.duration) : value.duration; emit(); } });
            current.addEventListener('ended', () => { if (valid() && state.playing) advance(1, true); });
            current.addEventListener('error', () => { if (valid()) void fail(new Error(current.error?.code===3||current.error?.code===4?'Audio format not supported':'Network audio error')); });
            current.addEventListener('pause', () => { if (valid() && current.paused && !current.ended && state.playing) { state.playing = false; state.phase = 'paused'; emit(); } });
            await playAudio(current, generation);
            if (generation === intent && state.playing) { const played = { ...state.track }; persist('musicLibrary', stored => ({ ...stored, recent: [played, ...stored.recent.filter(item => key(item) !== key(played))].slice(0, 100) })).catch(() => {}); }
        }).catch(error => { if (generation === intent && !controller.signal.aborted) return fail(error); });
    }
    function toggle() {
        if(['error','blocked'].includes(state.phase))return retry();
        restore(true); const generation = ++intent;
        if (state.playing || state.phase === 'loading') {
            if (state.phase === 'loading') { loadController?.abort(); unload(); }
            else audio?.pause();
            state.playing = false; state.phase = state.track ? 'paused' : 'idle'; emit(); return Promise.resolve();
        }
        if (audio) return playAudio(audio, generation);
        const track = state.track || state.queue[Math.max(0, state.index)]; return track ? play(track) : Promise.resolve();
    }
    function advance(direction, ended = false) {
        restore(true);
        if (!state.queue.length) { stop(); return Promise.resolve(); }
        if (ended && state.mode === 'one') { if (audio) audio.currentTime = 0; state.position = 0; return playAudio(audio, ++intent); }
        if (direction < 0 && state.position > 3) { seek(0); return Promise.resolve(); }
        let index = state.index + direction;
        if(direction<0&&state.mode==='shuffle'){
            while(visitIndex>0){visitIndex--;const previous=state.queue.find(t=>key(t)===visits[visitIndex]);if(previous)return play(previous,undefined,{historyMove:true});}
            return Promise.resolve();
        }
        const pending=direction>0&&priority.shift();if(pending){const next=state.queue.find(t=>key(t)===pending);if(next)return play(next);}
        if(direction>0&&state.mode==='shuffle'&&state.queue.length>1){
            if(visitIndex<visits.length-1){visitIndex++;const forward=state.queue.find(t=>key(t)===visits[visitIndex]);if(forward)return play(forward,undefined,{historyMove:true});}
            if(!shuffleBag.length)resetShuffle();const nextId=shuffleBag.shift(),next=state.queue.find(t=>key(t)===nextId);if(next)return play(next);
        }
        if (ended && state.mode === 'order' && index >= state.queue.length) { ++intent; state.playing = false; state.phase = 'paused'; emit(); return Promise.resolve(); }
        index = (index + state.queue.length) % state.queue.length;
        return play(state.queue[index]);
    }
    function seek(seconds) {
        // Seeking changes position without cancelling an in-flight stream or play() permission promise.
        ++seekRevision;
        if (audio) { const position = Math.min(number(seconds), state.duration || number(seconds)); try { audio.currentTime = position; state.position = position; emit(); } catch (_) {} }
    }
    function setMode(mode) { restore(true); if (!['order', 'list', 'shuffle', 'one'].includes(mode)) throw new Error('Invalid play mode'); state.mode = mode;resetShuffle(); saveQueue(); emit(); }
    function enqueue(track, next = false) {
        restore(true); const value = normalizeTrack(track),id=key(value),existing=state.queue.findIndex(item=>key(item)===id);
        if(existing>=0&&!next)return false;if(existing<0&&state.queue.length>=MAX_QUEUE)return false;
        if(existing>=0)state.queue.splice(existing,1);state.index=state.track?state.queue.findIndex(t=>key(t)===key(state.track)):-1;
        state.queue.splice(next?Math.max(0,state.index+1):state.queue.length,0,value);
        if(next)priority=[id,...priority.filter(v=>v!==id)];if(!shuffleBag.includes(id)&&(!state.track||id!==key(state.track)))shuffleBag.push(id);queueChanged();return true;
    }
    function remove(index) {
        restore(true); if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return;
        state.queue.splice(index, 1);queueChanged();
    }
    function move(from,to){restore(true);if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=state.queue.length||to>=state.queue.length)return;state.queue.splice(to,0,state.queue.splice(from,1)[0]);queueChanged();}
    function clear(){restore(true);state.queue=state.track?[state.track]:[];priority=[];shuffleBag=[];visits=state.track?[key(state.track)]:[];visitIndex=visits.length-1;queueChanged();}
    function retry(){const t=state.track;if(!t)return Promise.resolve();if(audio&&state.phase==='blocked'){state.phase='paused';return playAudio(audio,++intent);}unload();return play(t);}
    function setSkipUnavailable(value){restore(true);state.skipUnavailable=value===true;saveQueue();emit();}
    function stop() { ++intent; unload(); state.track = null; state.index = -1; state.position = state.duration = 0; state.playing = false; state.phase = 'idle'; state.error = ''; clearTimeout(sleepTimer); state.sleepAt = 0; emit(); }
    function setSleep(minutes) {
        clearTimeout(sleepTimer); const delay = number(minutes, 1440) * 60000; state.sleepAt = delay ? Date.now() + delay : 0;
        if (delay) { sleepTimer = setTimeout(() => { ++intent; unload(); state.playing = false; state.phase = state.track ? 'paused' : 'idle'; state.sleepAt = 0; emit(); }, delay); sleepTimer?.unref?.(); }
        emit();
    }
    function suspendVoice() {
        const current = audio, loading = state.phase === 'loading', track = state.track, resume = state.playing || loading;
        if (loading) { ++intent; unload(); }
        const generation = intent, seekGeneration = seekRevision;
        if (resume) { current?.pause(); state.playing = false; state.phase = 'paused'; emit(); }
        let used = false;
        return () => {
            if (used) return Promise.resolve(); used = true;
            if (!resume || generation !== intent || seekGeneration !== seekRevision) return Promise.resolve();
            return loading ? play(track) : audio === current ? playAudio(current, generation) : Promise.resolve();
        };
    }
    const player = { snapshot, subscribe(fn) { if (typeof fn !== 'function') throw new Error('Music subscriber must be a function'); listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); },
        play, toggle, next: () => advance(1), previous: () => advance(-1), seek, setMode, enqueue, remove, move, clear, retry, setSkipUnavailable, setSleep, stop, suspendVoice };
    if (typeof navigator !== 'undefined' && navigator.mediaSession?.setActionHandler) {
        for (const [name, action] of Object.entries({ play: () => { if (!state.playing) toggle(); }, pause: () => { if (state.playing) toggle(); }, previoustrack: player.previous, nexttrack: player.next, stop,
            seekto: details => seek(details.seekTime), seekbackward: details => seek(state.position - (details.seekOffset || 10)), seekforward: details => seek(state.position + (details.seekOffset || 10)) })) {
            try { navigator.mediaSession.setActionHandler(name, action); } catch (_) {}
        }
    }
    const api = { normalizeTrack, normalizeLibrary, portableLibrary: library, key, settings, saveSettings, request,
        connect: signal => request('/health', { signal }), accounts, createQR, pollQR, logout: (value, signal) => request('/accounts/' + provider(value), { method: 'DELETE', signal }),
        search, playlists, playlist, lyrics, clearMetadataCache, importLocal, importURL, deleteLocal, updateLocal, library, toggleFavorite, addPlaylist, addToPlaylist, removeFromPlaylist, renamePlaylist, reorderPlaylist, removePlaylistTracks,
        rememberSearch:q=>persist('musicLibrary',current=>({...current,searches:[text(q,200).trim(),...current.searches.filter(v=>v!==text(q,200).trim())].filter(Boolean).slice(0,12)})),clearSearches:()=>persist('musicLibrary',current=>({...current,searches:[]})),
        clearRecent: () => persist('musicLibrary', current => ({ ...current, recent: [] })),
        deletePlaylist: id => persist('musicLibrary', current => ({ ...current, playlists: current.playlists.filter(item => item.id !== id) })), player };
    root.UvUMusic = api; globalThis.UvUMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
