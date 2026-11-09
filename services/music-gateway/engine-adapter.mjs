const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const numericId = value => /^\d{1,24}$/.test(String(value || '')) ? String(value) : '';

export function createEngineAdapter(Meting, provider, credential = '') {
    const engine = new Meting(provider === 'qq' ? 'tencent' : 'netease');
    engine.format(true);
    if (credential) engine.cookie(credential);

    // Keep the pinned engine intact; adapt only its NetEase QR login descriptors.
    // Both endpoints must use the same type (current maintained client: 3).
    if (provider === 'netease') {
        for (const method of ['loginQrKey', 'loginQrCheck']) {
            if (typeof engine.provider[method] !== 'function') continue;
            const original = engine.provider[method].bind(engine.provider);
            engine.provider[method] = (...args) => {
                const api = original(...args);
                return { ...api, body: { ...api.body, type: 3 } };
            };
        }
    }

    async function rawApi(api) {
        const oldFormat = engine.isFormat;
        engine.format(false);
        try { return parse(await engine._exec(api)); } finally { engine.format(oldFormat); }
    }
    async function accountUser() {
        if (provider === 'qq') {
            const id = engine.provider._getLoginUin();
            return { id: id === '0' ? '' : String(id), name: 'QQ Music', avatar: '' };
        }
        const response = await rawApi({ method: 'POST', url: 'https://music.163.com/api/nuser/account/get', body: {}, encode: 'netease_eapi' });
        const profile = response.profile || {};
        return { id: numericId(profile.userId || response.account?.id), name: profile.nickname || '', avatar: profile.avatarUrl || '' };
    }
    function normalize(raw) {
        const cover = raw.cover || (raw.pic_id ? (provider === 'qq'
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${encodeURIComponent(raw.pic_id)}.jpg`
            : '') : '');
        return { id: String(raw.id), title: raw.name || '', artists: raw.artist || [], album: raw.album || '', cover, duration: Number(raw.duration) || 0, availability: 'unknown' };
    }
    async function tracks(raw) {
        const list = Array.isArray(raw) ? raw.slice(0, 3000) : [];
        const result = list.map(normalize); let cursor = 0, artworkTimedOut = false;
        await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
            while (cursor < list.length && !artworkTimedOut) {
                const index = cursor++, item = list[index];
                if (provider !== 'netease' || !item.pic_id) continue;
                let timer;
                try { result[index].cover = parse(await Promise.race([engine.pic(item.pic_id, 300), new Promise((_, reject) => { timer = setTimeout(() => { artworkTimedOut = true; reject(Error('Artwork timeout')); }, 1000); })])).url || ''; }
                catch { /* Missing/slow artwork must not hide the song. */ }
                finally { clearTimeout(timer); }
            }
        }));
        return result;
    }
    return {
        async createQR() {
            const result = parse(await engine.loginQr());
            return { state: result.state || '', image: result.qrimg || '', url: result.qrurl || '' };
        },
        async pollQR(state) {
            const result = parse(await engine.loginQrCheck(state));
            const status = { 800: 'expired', 801: 'waiting', 802: 'scanned', 803: 'authorized' }[result.code];
            if (!status) throw Error('Unexpected login status');
            if (status !== 'authorized') return { status };
            const cookie = result.cookieHeader || result.cookie || '';
            if (!cookie) throw Error('Missing account credential');
            engine.cookie(cookie);
            if (provider === 'qq' && (engine.provider._getLoginUin() === '0' || !engine.provider._getMusicKey())) throw Error('Incomplete QQ Music credentials');
            let user;
            try { user = await accountUser(); } catch { /* Credentials may still work if profile lookup is unavailable. */ }
            return { status, credential: cookie, user };
        },
        async search(query, page = 1) {
            const raw = parse(await engine.search(query, { page, limit: 30, type: 1 }));
            if (!Array.isArray(raw)) throw Error('Invalid search result');
            return { tracks: await tracks(raw.slice(0, 30)), hasMore: raw.length >= 30 };
        },
        async stream(id) {
            if (provider === 'netease') {
                // Read the official result without the upstream decoder's uf fallback,
                // preserving trial/rights information instead of claiming full access.
                const raw = await rawApi(engine.provider.url(id, 128));
                const item = raw.data?.[0];
                if (!item?.url || Number(item.code || 200) >= 400) return { url: '', availability: 'unavailable' };
                return { url: item.url, availability: item.freeTrialInfo ? 'preview' : 'full', ...(Number(item.expi) > 0 ? { expiresAt: Date.now() + Math.min(item.expi, 86400) * 1000 } : {}) };
            }
            // Use only the account's ordinary web vkey request. The pinned engine's
            // alternative anonymous/mobile and spoofed-IP playback fallbacks are unused.
            const detail = await rawApi(engine.provider.url(id, 128));
            const song = detail.data?.[0];
            if (!song?.file || !song.file.size_128mp3 || !song.mid) return { url: '', availability: 'unavailable' };
            const result = await engine.provider._requestVkeys([{
                filename: `M500${song.file.media_mid || song.mid}.mp3`, songmid: song.mid, songtype: Number(song.type) || 0
            }], { guid: engine.provider._getGuid(), gtk: engine.provider._getGtk() || 5381, uin: engine.provider._getLoginUin(), musicKey: engine.provider._getMusicKey() }, 'web-post');
            const purl = result.vkeys?.[0]?.purl || '';
            return { url: purl ? (/^https?:\/\//i.test(purl) ? purl : result.sip + purl) : '', availability: purl ? 'unknown' : 'unavailable' };
        },
        async lyrics(id) {
            const result = parse(await engine.lyric(id));
            return { lyric: result.lyric || '', translation: result.tlyric || '' };
        },
        async playlists(user) {
            if (provider === 'qq') {
                const result = parse(await engine.userPlaylists());
                if (result.code !== 0) throw Error('Playlists unavailable');
                return (result.playlists || []).map(item => ({ id: item.id, name: item.name, cover: item.pic, count: item.song_count }));
            }
            const id = numericId(user?.id) || numericId((await accountUser()).id);
            if (!id) throw Error('Account identity unavailable');
            const result = await rawApi({ method: 'POST', url: 'https://music.163.com/api/user/playlist', body: { uid: id, limit: 200, offset: 0 }, encode: 'netease_eapi' });
            if (result.code !== 200) throw Error('Playlists unavailable');
            return (result.playlist || []).slice(0, 200).map(item => ({ id: String(item.id), name: item.name, cover: item.coverImgUrl, count: item.trackCount }));
        },
        async playlist(id, page = 1) {
            const raw = parse(await engine.playlist(id));
            if (!Array.isArray(raw)) throw Error('Playlist unavailable');
            return { tracks: await tracks(raw.slice((page - 1) * 30, page * 30)), hasMore: raw.length > page * 30 };
        },
        async playlistSnapshot(id) { const raw = parse(await engine.playlist(id)); if (!Array.isArray(raw)) throw Error('Playlist unavailable'); return raw.slice(0, 3000); },
        async playlistRows(rows) { return tracks(rows.slice(0, 30)); }
    };
}

export function createRestrictedFetch(fetchImpl, provider) {
    const domains = provider === 'netease' ? ['music.163.com'] : ['qq.com', 'qqmusic.qq.com', 'gtimg.cn'];
    return async function restrictedFetch(input, options = {}) {
        let url = new URL(input);
        const requestOptions = { ...options, headers: new Headers(options.headers || {}) };
        requestOptions.headers.delete('X-Forwarded-For');
        requestOptions.headers.delete('X-Real-IP');
        const timeoutSignal = AbortSignal.timeout(10000);
        requestOptions.signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
        for (let redirects = 0; redirects <= 5; redirects++) {
            if (url.username || url.password || url.port || !domains.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) throw Error('Upstream host denied');
            if (url.protocol === 'http:') url.protocol = 'https:';
            if (url.protocol !== 'https:') throw Error('Upstream protocol denied');
            const response = await fetchImpl(url, { ...requestOptions, redirect: 'manual' });
            if (options.redirect !== 'manual' && [301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                if (!location) throw Error('Invalid redirect');
                await response.body?.cancel();
                const next = new URL(location, url);
                if (next.origin !== url.origin) { requestOptions.headers.delete('Cookie'); requestOptions.headers.delete('Authorization'); }
                if (response.status === 303 || ((response.status === 301 || response.status === 302) && requestOptions.method === 'POST')) { requestOptions.method = 'GET'; delete requestOptions.body; }
                url = next; continue;
            }
            if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) { await response.body?.cancel(); throw Error('Upstream response too large'); }
            const reader = response.body?.getReader();
            const chunks = []; let size = 0;
            if (reader) {
                for (;;) {
                    const part = await reader.read(); if (part.done) break;
                    size += part.value.length;
                    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw Error('Upstream response too large'); }
                    chunks.push(Buffer.from(part.value));
                }
            }
            return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        throw Error('Too many redirects');
    };
}
