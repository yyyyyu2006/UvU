// Optional, credential-free adapter. API terms and attribution: GD Studio.
(function (root) {
    'use strict';
    const API = 'https://music-api.gdstudio.xyz/api.php', PROVIDER = 'gd-netease';
    const MAX_BYTES = 2 * 1024 * 1024, WINDOW = 300000, BUDGET_KEY = 'uvu-music-public-budget-v1';
    const cache = new Map(); let times = [], blockedUntil = 0;
    const clean = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '';
    const abort = () => new DOMException('公共音乐请求已取消', 'AbortError');
    function check(signal) { if (signal?.aborted) throw abort(); }
    function source(value) { if (value !== PROVIDER) throw new Error('不支持的公共音乐来源'); }
    function id(value) { if (!/^\d{1,24}$/.test(String(value || ''))) throw new Error('公共音乐标识无效'); return String(value); }
    function mediaURL(value) {
        if (typeof value !== 'string' || value.length > 4096) return '';
        try {
            const u = new URL(value);
            return u.protocol === 'https:' && !u.username && !u.password && !u.hash &&
                ['music.126.net', 'music.163.com'].some(host => u.hostname === host || u.hostname.endsWith('.' + host)) ? u.href : '';
        } catch (_) { return ''; }
    }
    function writeBudget() { try { sessionStorage.setItem(BUDGET_KEY, JSON.stringify({times,blockedUntil})); } catch (_) {} }
    function reserve() {
        const now = Date.now();
        try {
            const stored = JSON.parse(sessionStorage.getItem(BUDGET_KEY) || '{}');
            if (Array.isArray(stored.times)) times = stored.times.filter(v => Number.isFinite(v) && v <= now).slice(-45);
            if (Number.isFinite(stored.blockedUntil)) blockedUntil = Math.max(blockedUntil, Math.min(stored.blockedUntil, now + WINDOW));
        } catch (_) {}
        times = times.filter(value => value > now - WINDOW);
        if (now < blockedUntil || times.length >= 45) throw new Error('公共源请求过于频繁，请稍后重试或切换账号源');
        times.push(now); writeBudget();
    }
    async function read(response) {
        if (Number(response.headers?.get('content-length')) > MAX_BYTES) throw new Error('公共源响应过大');
        let raw = '';
        if (response.body?.getReader) {
            const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0;
            try {
                while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BYTES) throw new Error('公共源响应过大'); raw += decoder.decode(part.value, {stream:true}); }
                raw += decoder.decode();
            } catch (error) { try { await reader.cancel(); } catch (_) {} throw error; }
        } else { raw = await response.text(); if (raw.length > MAX_BYTES) throw new Error('公共源响应过大'); }
        try { return JSON.parse(raw); } catch (_) { throw new Error('公共源返回格式无效'); }
    }
    async function get(params, signal, ttl = 0) {
        check(signal);
        const url = new URL(API); Object.entries({source:'netease', ...params}).forEach(([k,v]) => url.searchParams.set(k,String(v)));
        const key = url.href, saved = cache.get(key);
        if (saved && saved.until > Date.now()) return JSON.parse(JSON.stringify(saved.value));
        reserve();
        const controller = new AbortController(), cancel = () => controller.abort(); let timedOut = false;
        signal?.addEventListener('abort', cancel, {once:true});
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
        try {
            const response = await fetch(key, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer', redirect:'error', headers:{Accept:'application/json'}});
            check(signal);
            if (response.status === 429) { blockedUntil = Date.now() + WINDOW; writeBudget(); throw new Error('公共源请求过于频繁，请稍后重试或切换账号源'); }
            if (!response.ok) throw new Error('公共音乐源暂时不可用（HTTP ' + response.status + '）');
            const value = await read(response); check(signal);
            if (timedOut) throw new Error('公共音乐源请求超时，请稍后重试');
            if (ttl) { if (cache.size >= 100) cache.delete(cache.keys().next().value); cache.set(key,{value,until:Date.now()+ttl}); }
            return value;
        } catch (error) {
            if (signal?.aborted) throw abort();
            if (timedOut) throw new Error('公共音乐源请求超时，请稍后重试');
            if (/^公共/.test(error.message || '')) throw error;
            throw new Error('公共音乐源连接失败，请检查网络或切换账号源');
        } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
    }
    async function search(provider, query, page = 1, signal) {
        source(provider); const q = clean(query,200).trim();
        if (!q) return {tracks:[],errors:[],hasMore:false};
        const raw = await get({types:'search',name:q,count:20,pages:Math.max(1,Math.min(100,Math.floor(Number(page)||1)))},signal,60000);
        if (!Array.isArray(raw)) throw new Error('公共源搜索结果格式无效');
        const tracks = [];
        for (const row of raw.slice(0,20)) {
            if (!row || row.source !== 'netease' || !/^\d{1,24}$/.test(String(row.id || '')) || !clean(row.name)) continue;
            tracks.push({provider:PROVIDER,id:String(row.id),title:clean(row.name),artists:(Array.isArray(row.artist)?row.artist:[]).filter(v=>typeof v==='string').slice(0,12).map(v=>clean(v,120)),
                album:clean(row.album),cover:'',duration:0,availability:'unknown',pageUrl:'https://music.163.com/song?id='+row.id,
                ...(/^\d{1,24}$/.test(String(row.pic_id || ''))?{artworkId:String(row.pic_id)}:{})});
        }
        return {tracks,errors:[],hasMore:raw.length>=20};
    }
    async function stream(track, signal) {
        source(track.provider); const trackId = id(track.id);
        const raw = await get({types:'url',id:trackId,br:128},signal);
        const url = mediaURL(raw?.url); if (!url) throw new Error('公共源未返回可用的 HTTPS 播放地址，请换一首歌或切换账号源');
        let cover = '';
        if (/^\d{1,24}$/.test(track.artworkId || '')) {
            try { cover = mediaURL((await get({types:'pic',id:track.artworkId,size:300},signal,3600000))?.url); }
            catch (error) { check(signal); /* Artwork failures must not block audio. */ }
        }
        return {url,availability:'unknown',...(cover?{cover}:{})};
    }
    async function lyrics(track,signal) {
        source(track.provider);
        const raw = await get({types:'lyric',id:id(track.id)},signal,600000);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('公共源歌词格式无效');
        return {lyric:clean(raw.lyric,100000).replace(/\\r\\n|\\n/g,'\n'),translation:clean(raw.tlyric,100000).replace(/\\r\\n|\\n/g,'\n')};
    }
    root.UvUPublicMusic = {search,stream,lyrics};
})(typeof window !== 'undefined' ? window : globalThis);
