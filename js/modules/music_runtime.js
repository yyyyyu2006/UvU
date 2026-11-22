// Playback coordination and safe diagnostics. No account or media request at startup.
(function (root) {
    'use strict';
    const providers = {
        netease: { search: true, login: true, playlists: true, lyrics: true, quality: false, pagination: true },
        qq: { search: true, login: true, playlists: true, lyrics: true, quality: false, pagination: true },
        'gd-netease': { search: true, login: false, playlists: false, lyrics: true, quality: false, pagination: true },
        local: { search: false, login: false, playlists: false, lyrics: true, quality: false, pagination: false },
        navidrome: { search: true, login: true, playlists: true, lyrics: true, quality: false, pagination: true }
    };
    const reports = [], health = new Map();
    const clean = (value, max = 80) => typeof value === 'string' && /^[\w: .-]*$/.test(value) ? value.slice(0, max) : '';
    function capabilities(provider) { return { ...(providers[provider] || {}) }; }
    function preferences(raw = {}) {
        return { recoverNetwork: raw.recoverNetwork === true, refreshExpired: raw.refreshExpired === true,
            singlePage: raw.singlePage === true, persistentCheckpoint: raw.persistentCheckpoint === true };
    }
    function record(event = {}) {
        const entry = { at: Date.now(), provider: Object.hasOwn(providers, event.provider) ? event.provider : '',
            stage: clean(event.stage), code: clean(event.code), phase: clean(event.phase),
            status: Number.isInteger(event.status) ? Math.max(0, Math.min(599, event.status)) : 0,
            elapsedMs: Number.isFinite(event.elapsedMs) ? Math.max(0, Math.min(180000, event.elapsedMs)) : 0 };
        reports.push(entry); if (reports.length > 60) reports.shift(); return { ...entry };
    }
    function report() {
        return JSON.stringify({ version: 1, component: 'uvu-music', coordination: coordinator.support(),
            events: reports.map(item => ({ ...item })), sources: [...health].map(([provider, value]) => ({ provider, ...value })) }, null, 2);
    }
    function sourceState(provider, patch) {
        if (!Object.hasOwn(providers, provider)) return {};
        const old = health.get(provider) || { connected: false, loggedIn: false, failures: 0, cooldownUntil: 0 };
        if (patch) {
            const next = { ...old };
            for (const field of ['connected', 'loggedIn']) if (typeof patch[field] === 'boolean') next[field] = patch[field];
            if (Number.isFinite(patch.failures)) next.failures = Math.max(0, Math.min(100, patch.failures));
            if (Number.isFinite(patch.cooldownUntil)) next.cooldownUntil = Math.max(0, Math.min(Date.now() + 300000, patch.cooldownUntil));
            health.set(provider, next); return { ...next };
        }
        return { ...old };
    }
    function retryDelay(value, now = Date.now()) {
        if (value === null || value === undefined || value === '') return 0;
        const seconds = Number(value), ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
        return Number.isFinite(ms) ? Math.max(0, Math.min(300000, ms)) : 0;
    }
    const scope = /(?:^|\/)test(?:\/|$)/.test(root.location?.pathname || '') ? 'test' : 'main';
    const id = root.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    let channel, lease, pending, yieldPlayback, ticket, generation = 0;
    try { if (typeof root.BroadcastChannel === 'function') channel = new root.BroadcastChannel('uvu-music-playback:' + scope); } catch (_) {}
    channel?.unref?.();
    function cancelled(message = '播放协调已取消') { const error = new Error(message); error.name = 'AbortError'; return error; }
    function release() {
        // Settle our caller immediately, even if a browser delivers a stale lock callback later.
        if (pending) { const attempt = pending; pending = null; attempt.cancel(); }
        if (lease) { const done = lease; lease = null; done(); }
        ticket = null;
    }
    const coordinator = {
        support: () => root.navigator?.locks?.request ? 'locks' : channel ? 'broadcast' : 'unavailable',
        release,
        async acquire(onYield) {
            if (lease) { yieldPlayback = onYield; return true; }
            release(); yieldPlayback = onYield;
            const mine = String(Date.now()).padStart(15, '0') + ':' + id + ':' + (++generation); ticket = mine;
            try { channel?.postMessage({ type: 'claim', id, ticket: mine }); } catch (_) { channel = null; }
            const locks = root.navigator?.locks;
            if (!locks?.request && !channel) { ticket = null; return false; }
            return new Promise((resolve, reject) => {
                const controller = new AbortController(); let timer, settled = false;
                const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); if (pending === attempt) pending = null; if (error) { if (ticket === mine) ticket = null; reject(error); } else resolve(true); };
                const attempt = { cancel() { finish(cancelled()); controller.abort(); } }; pending = attempt;
                if (!locks?.request) {
                    // Allow competing broadcast claims to arrive before the caller starts audio.
                    timer = setTimeout(() => ticket === mine ? finish() : finish(cancelled()), 80);
                    return;
                }
                timer = setTimeout(() => { finish(cancelled('其他页面仍在播放，请停止后重试')); controller.abort(); }, 5000);
                let request;
                try {
                    request = locks.request('uvu-music-playback:' + scope, { signal: controller.signal }, async () => {
                        if (ticket !== mine || controller.signal.aborted) { finish(cancelled()); return; }
                        await new Promise(done => { lease = done; finish(); });
                    });
                } catch (error) { finish(error); return; }
                Promise.resolve(request).then(() => { if (!settled) finish(cancelled()); }, error => finish(error));
            });
        },
        close() { release(); channel?.close(); channel = null; }
    };
    if (channel) channel.onmessage = event => {
        const value = event.data;
        if (value?.type !== 'claim' || value.id === id || typeof value.ticket !== 'string' || value.ticket.length > 160) return;
        if (ticket && ticket > value.ticket) return;
        if (lease || ticket) { release(); try { yieldPlayback?.(); } catch (_) {} }
    };
    root.addEventListener?.('pagehide', release);
    root.UvUMusicRuntime = { capabilities, preferences, record, report, sourceState, retryDelay, coordinator };
})(typeof window !== 'undefined' ? window : globalThis);
