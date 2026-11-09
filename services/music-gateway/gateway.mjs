import http from 'node:http';
import https from 'node:https';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isIP } from 'node:net';
import { createProviderAdapter, engineInstalled, ENGINE_REVISION } from './provider-adapter.mjs';

const PROVIDERS = ['netease', 'qq'];
const BASE_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
const text = (value, limit = 300) => typeof value === 'string' ? value.slice(0, limit) : '';
const hash = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const error = (status, code) => Object.assign(new Error(code), { status, code });
const boundedInt = (value, fallback, max) => {
    if (value == null || value === '') return fallback;
    if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > max) throw error(400, 'invalid_parameter');
    return Number(value);
};
// Trust only explicitly configured socket peers and walk XFF from the nearest proxy.
export function resolveClientIp(peer, forwarded, trusted = []) {
    const normalize = value => String(value || '').replace(/^::ffff:/, '');
    const socket = normalize(peer), allowed = new Set(trusted.map(normalize));
    if (!allowed.has(socket) || typeof forwarded !== 'string' || forwarded.length > 2048) return socket;
    const chain = forwarded.split(',').map(v => normalize(v.trim()));
    if (!chain.length || chain.length > 20 || chain.some(v => !isIP(v))) return socket;
    let address = socket;
    for (let i = chain.length - 1; i >= 0 && allowed.has(address); i--) address = chain[i];
    return address;
}
function providerName(value) {
    if (!PROVIDERS.includes(value)) throw error(400, 'invalid_provider');
    return value;
}
function resourceId(value, provider) {
    const expression = provider === 'netease' ? /^\d{1,24}$/ : /^[A-Za-z0-9_-]{1,100}$/;
    if (!expression.test(value)) throw error(400, 'invalid_id');
    return value;
}

export function safeProviderUrl(value, provider, kind = 'media') {
    try {
        const url = new URL(value);
        if (url.username || url.password || url.port || value.length > 4096) return '';
        const suffixes = provider === 'netease'
            ? ['music.126.net', 'music.163.com']
            : ['qqmusic.qq.com', 'stream.qqmusic.qq.com', 'y.qq.com', 'gtimg.cn', 'qpic.cn'];
        if (!suffixes.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return '';
        if (url.protocol === 'http:') url.protocol = 'https:';
        if (url.protocol !== 'https:') return '';
        if (kind === 'qr' && url.hostname !== 'music.163.com') return '';
        return url.href;
    } catch { return ''; }
}
function userFacts(raw, provider) {
    if (!raw || typeof raw !== 'object') return undefined;
    return { id: text(String(raw.id || ''), 100), name: text(raw.name, 120), avatar: safeProviderUrl(raw.avatar || '', provider, 'image') };
}
function trackFacts(raw, provider) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '');
    try { resourceId(id, provider); } catch { return null; }
    return {
        provider, id, title: text(raw.title || raw.name, 300),
        artists: (Array.isArray(raw.artists || raw.artist) ? (raw.artists || raw.artist) : []).slice(0, 20).map(v => text(v, 120)),
        album: text(raw.album, 300), cover: safeProviderUrl(raw.cover || '', provider, 'image'),
        duration: Math.min(86400, Math.max(0, Number(raw.duration) || 0)),
        pageUrl: provider === 'netease' ? 'https://music.163.com/song?id=' + id : 'https://y.qq.com/n/ryqq/songDetail/' + id,
        availability: ['full', 'preview', 'unavailable'].includes(raw.availability) ? raw.availability : 'unknown'
    };
}

export async function createGateway(options = {}) {
    const now = options.now || Date.now;
    const origins = new Set(options.origins || ['http://localhost:3000', 'http://127.0.0.1:3000']);
    for (const origin of origins) {
        const url = new URL(origin);
        if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw Error('Invalid allowed origin');
    }
    const timeoutMs = options.timeoutMs ?? 15000;
    const adapterFactory = options.adapterFactory || (provider => createProviderAdapter(provider, { timeoutMs: Math.max(1, timeoutMs - 100) }));
    const engineReady = options.engineStatus || (options.adapterFactory ? async () => true : engineInstalled);
    const sessions = new Map();
    const ipRates = new Map();
    const persistPath = options.persistPath;
    const key = options.encryptionKey;
    if (persistPath && (!Buffer.isBuffer(key) || key.length !== 32)) throw Error('Persistence requires a 32-byte encryption key');
    let saving = Promise.resolve();
    let closed = false;
    let closing;
    const assertOpen = () => { if (closed) throw error(503, 'gateway_closed'); };
    const makeAccount = () => ({ loggedIn: false, credential: '', user: undefined, adapter: null, generation: 0 });
    const makeSession = (remember = false) => ({ expiresAt: now() + (remember ? 7 : 1) * 86400000, remember, accounts: Object.fromEntries(PROVIDERS.map(p => [p, makeAccount()])), qrs: new Map(), rate: { at: now(), count: 0 }, inflight: 0 });

    async function save() {
        assertOpen();
        if (!persistPath) return;
        const records = [...sessions].filter(([, session]) => session.remember && session.expiresAt > now()).map(([id, session]) => ({
            id, expiresAt: session.expiresAt,
            accounts: Object.fromEntries(PROVIDERS.map(p => [p, { credential: session.accounts[p].credential, user: session.accounts[p].user }]))
        }));
        const plaintext = JSON.stringify({ version: 1, records });
        saving = saving.catch(() => {}).then(async () => {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from('uvu-music-gateway-v1'));
            const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
            const envelope = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
            await mkdir(dirname(persistPath), { recursive: true, mode: 0o700 });
            const temporary = persistPath + '.tmp';
            await writeFile(temporary, envelope, { mode: 0o600 });
            await rename(temporary, persistPath);
        });
        await saving;
    }
    if (persistPath) {
        try {
            if ((await stat(persistPath)).size > 12 * 1024 * 1024) throw Error('Invalid vault');
            const envelope = JSON.parse(await readFile(persistPath, 'utf8'));
            if (envelope.version !== 1) throw Error('Invalid vault');
            const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
            decipher.setAAD(Buffer.from('uvu-music-gateway-v1'));
            decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
            const records = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')).records;
            for (const record of records.slice(0, options.maxSessions ?? 100)) {
                if (!/^[a-f0-9]{64}$/.test(record.id) || !(record.expiresAt > now())) continue;
                const session = makeSession(true); session.expiresAt = record.expiresAt;
                for (const p of PROVIDERS) {
                    const stored = record.accounts?.[p];
                    if (typeof stored?.credential === 'string' && stored.credential.length <= 32768 && stored.credential) {
                        Object.assign(session.accounts[p], { loggedIn: true, credential: stored.credential, user: userFacts(stored.user, p) });
                    }
                }
                sessions.set(record.id, session);
            }
        } catch (e) { if (e.code !== 'ENOENT') throw Error('Cannot decrypt music gateway vault'); }
    }
    async function bounded(operation) {
        let timer;
        try {
            const result = await Promise.race([Promise.resolve().then(() => { assertOpen(); return operation(); }), new Promise((_, reject) => { timer = setTimeout(() => reject(error(504, 'provider_timeout')), timeoutMs); })]);
            assertOpen();
            return result;
        } finally { clearTimeout(timer); }
    }
    async function getAdapter(account, provider) {
        assertOpen();
        if (!account.adapter) {
            account.adapter = Promise.resolve(adapterFactory(provider)).then(async adapter => {
                if (closed) { await adapter.close?.(); assertOpen(); }
                if (account.credential) await adapter.setCredential(account.credential);
                if (closed) { await adapter.close?.(); assertOpen(); }
                return adapter;
            });
        }
        return account.adapter;
    }
    async function closeAdapter(adapter) {
        try { await (await adapter)?.close?.(); } catch { /* Cleanup cannot reveal provider details. */ }
    }
    function retireQR(qr) {
        if (!qr) return;
        qr.status = 'expired'; qr.state = '';
        return closeAdapter(qr.adapter);
    }
    async function cleanup() {
        let changed = false;
        for (const [id, session] of sessions) {
            for (const qr of session.qrs.values()) if (qr.expiresAt <= now() && qr.status !== 'authorized') retireQR(qr);
            if (session.expiresAt > now()) continue;
            sessions.delete(id); changed = true;
            for (const account of Object.values(session.accounts)) { account.generation++; void closeAdapter(account.adapter); }
            for (const qr of session.qrs.values()) retireQR(qr);
        }
        for (const [ip, rate] of ipRates) if (now() - rate.at > 60000) ipRates.delete(ip);
        if (changed) await save();
    }
    function rateLimit(rate, limit) {
        if (now() - rate.at >= 60000) { rate.at = now(); rate.count = 0; }
        if (++rate.count > limit) throw error(429, 'rate_limited');
    }

    async function dispatch(input) {
        const headers = { ...BASE_HEADERS };
        let activeSession;
        try {
            assertOpen();
            const requestHeaders = Object.fromEntries(Object.entries(input.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
            const origin = requestHeaders.origin;
            if (origin) {
                if (!origins.has(origin)) throw error(403, 'origin_denied');
                headers['Access-Control-Allow-Origin'] = origin;
                headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
                headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
            }
            if (input.method === 'OPTIONS') return { status: 204, headers, body: null };
            if (typeof input.path !== 'string' || input.path.length > 4096) throw error(414, 'request_too_large');
            const url = new URL(input.path, 'http://gateway.invalid');
            const route = url.pathname;
            const method = input.method;
            if (method === 'GET' && route === '/v1/health') {
                const ready = await engineReady();
                assertOpen();
                return { status: 200, headers, body: { ok: ready, ready, providers: PROVIDERS, engine: { installed: ready, revision: ENGINE_REVISION }, ...(options.ephemeralDeployment === true ? { deployment: { provider: 'render', ephemeral: true } } : {}), ...(!ready ? { error: 'engine_not_installed' } : {}) } };
            }
            await cleanup();
            assertOpen();
            if (method === 'POST' && route === '/v1/session') {
                const ip = text(input.ip || 'unknown', 100);
                if (!ipRates.has(ip)) {
                    if (ipRates.size > 1000) throw error(429, 'rate_limited');
                    ipRates.set(ip, { at: now(), count: 0 });
                }
                rateLimit(ipRates.get(ip), 10);
                if (sessions.size >= (options.maxSessions ?? 100)) throw error(429, 'session_limit');
                const remember = input.body?.remember === true;
                if (remember && !persistPath) throw error(400, 'persistence_disabled');
                const token = opaque(); sessions.set(hash(token), makeSession(remember)); await save();
                assertOpen();
                return { status: 201, headers, body: { token } };
            }
            const authorization = requestHeaders.authorization;
            if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{40,100}$/.test(authorization)) throw error(401, 'unauthorized');
            const session = sessions.get(hash(authorization.slice(7)));
            if (!session) throw error(401, 'unauthorized');
            rateLimit(session.rate, 180);
            if (session.inflight >= 8) throw error(429, 'request_limit');
            session.inflight++; activeSession = session;
            let body;
            if (method === 'GET' && route === '/v1/accounts') {
                body = { accounts: PROVIDERS.map(provider => ({ provider, loggedIn: session.accounts[provider].loggedIn, ...(session.accounts[provider].user ? { user: session.accounts[provider].user } : {}) })) };
            } else if (method === 'DELETE' && route === '/v1/session') {
                sessions.delete(hash(authorization.slice(7)));
                for (const p of PROVIDERS) { session.accounts[p].generation++; void closeAdapter(session.accounts[p].adapter); }
                for (const qr of session.qrs.values()) retireQR(qr);
                await save(); body = { ok: true };
            } else if (route.match(/^\/v1\/accounts\/[^/]+(?:\/.*)?$/)) {
                const [, , , providerValue, ...parts] = route.split('/');
                const provider = providerName(providerValue), account = session.accounts[provider];
                if (method === 'DELETE' && parts.length === 0) {
                    account.generation++;
                    for (const qr of session.qrs.values()) if (qr.provider === provider) retireQR(qr);
                    void closeAdapter(account.adapter);
                    session.accounts[provider] = { ...makeAccount(), generation: account.generation };
                    await save(); body = { ok: true };
                } else if (method === 'POST' && parts.join('/') === 'qr') {
                    account.generation++;
                    for (const qr of session.qrs.values()) if (qr.provider === provider) retireQR(qr);
                    while (session.qrs.size >= 8) session.qrs.delete(session.qrs.keys().next().value);
                    const qr = { id: opaque(), provider, generation: account.generation, expiresAt: now() + (options.qrTtlMs ?? 180000), status: 'waiting', state: '', adapter: Promise.resolve(adapterFactory(provider)), pending: null };
                    session.qrs.set(qr.id, qr);
                    try {
                        const result = await bounded(async () => (await qr.adapter).createQR());
                        if (qr.status === 'expired' || account.generation !== qr.generation || !sessions.has(hash(authorization.slice(7))) || qr.expiresAt <= now()) throw error(409, 'qr_expired');
                        qr.state = text(result.state, 16384);
                        if (!qr.state) throw error(502, 'provider_unavailable');
                        const image = typeof result.image === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.image) && result.image.length < 300000 ? result.image : '';
                        const qrUrl = safeProviderUrl(result.url || '', provider, 'qr');
                        if (!image && !qrUrl) throw error(502, 'provider_unavailable');
                        body = { id: qr.id, image, url: qrUrl, expiresAt: qr.expiresAt };
                    } catch (e) { retireQR(qr); throw e; }
                } else if (method === 'GET' && parts.length === 2 && parts[0] === 'qr') {
                    const qr = session.qrs.get(parts[1]);
                    if (!qr || qr.provider !== provider) throw error(404, 'qr_not_found');
                    if (qr.status === 'authorized') body = { status: 'authorized', ...(qr.user ? { user: qr.user } : {}) };
                    else if (qr.status === 'expired' || qr.expiresAt <= now() || qr.generation !== account.generation) { retireQR(qr); body = { status: 'expired' }; }
                    else {
                        if (!qr.pending) qr.pending = (async () => {
                            const result = await bounded(async () => (await qr.adapter).pollQR(qr.state));
                            if (qr.status === 'expired' || qr.expiresAt <= now() || account.generation !== qr.generation || session.accounts[provider] !== account || !sessions.has(hash(authorization.slice(7)))) { retireQR(qr); return { status: 'expired' }; }
                            const status = ['waiting', 'scanned', 'authorized', 'expired'].includes(result.status) ? result.status : null;
                            if (!status) throw error(502, 'provider_unavailable');
                            if (status === 'authorized') {
                                if (typeof result.credential !== 'string' || !result.credential || result.credential.length > 32768) throw error(502, 'provider_unavailable');
                                const authorizedAdapter = qr.adapter;
                                await (await authorizedAdapter).setCredential(result.credential);
                                assertOpen();
                                if (qr.status === 'expired' || qr.expiresAt <= now() || account.generation !== qr.generation || session.accounts[provider] !== account || !sessions.has(hash(authorization.slice(7)))) { retireQR(qr); return { status: 'expired' }; }
                                const previous = account.adapter;
                                Object.assign(account, { adapter: authorizedAdapter, credential: result.credential, loggedIn: true, user: userFacts(result.user, provider) });
                                qr.status = 'authorized'; qr.state = ''; qr.user = account.user;
                                qr.adapter = null;
                                if (previous !== authorizedAdapter) void closeAdapter(previous);
                                await save();
                            } else if (status === 'expired') retireQR(qr);
                            else qr.status = status;
                            return { status, ...(status === 'authorized' && account.user ? { user: account.user } : {}) };
                        })().finally(() => { qr.pending = null; });
                        body = await qr.pending;
                    }
                } else if (method === 'GET' && parts.join('/') === 'playlists') {
                    if (!account.loggedIn) throw error(401, 'account_required');
                    const result = await bounded(async () => (await getAdapter(account, provider)).playlists(account.user));
                    body = { playlists: (Array.isArray(result) ? result : []).slice(0, 200).map(v => ({ id: text(String(v.id || ''), 100), name: text(v.name, 300), cover: safeProviderUrl(v.cover || '', provider, 'image'), count: Math.min(100000, Math.max(0, Number(v.count) || 0)) })).filter(v => v.id) };
                } else throw error(404, 'not_found');
            } else if (method === 'GET' && route === '/v1/search') {
                const query = url.searchParams.get('q')?.trim();
                if (!query || query.length > 300) throw error(400, 'invalid_query');
                const page = boundedInt(url.searchParams.get('page'), 1, 100);
                const selected = [...new Set((url.searchParams.get('providers') || 'netease,qq').split(','))].map(providerName);
                const results = await Promise.allSettled(selected.map(async provider => {
                    const result = await bounded(async () => (await getAdapter(session.accounts[provider], provider)).search(query, page));
                    return { tracks: (result.tracks || []).slice(0, 30).map(v => trackFacts(v, provider)).filter(Boolean), hasMore: result.hasMore === true };
                }));
                body = { tracks: [], errors: [], hasMore: false };
                results.forEach((result, i) => {
                    if (result.status === 'fulfilled') { body.tracks.push(...result.value.tracks); body.hasMore ||= result.value.hasMore; }
                    else body.errors.push({ provider: selected[i], code: result.reason?.status === 504 ? 'provider_timeout' : 'provider_unavailable', message: 'Platform request failed' });
                });
            } else if (method === 'GET' && /^\/v1\/track\/[^/]+\/[^/]+\/(stream|lyrics)$/.test(route)) {
                const [, , , providerValue, encodedId, action] = route.split('/');
                const provider = providerName(providerValue), id = resourceId(decodeURIComponent(encodedId), provider);
                const result = await bounded(async () => {
                    const adapter = await getAdapter(session.accounts[provider], provider);
                    return action === 'stream' ? adapter.stream(id) : adapter.lyrics(id);
                });
                if (action === 'lyrics') body = { lyric: text(result.lyric, 100000), ...(result.translation ? { translation: text(result.translation, 100000) } : {}) };
                else {
                    const safeUrl = safeProviderUrl(result.url || '', provider);
                    body = { url: safeUrl, availability: safeUrl ? (['full', 'preview'].includes(result.availability) ? result.availability : 'unknown') : 'unavailable', ...(!safeUrl ? { message: 'Platform did not return an allowed playable URL; login or playback rights may be required.' } : {}) };
                    if (safeUrl && Number.isFinite(result.expiresAt) && result.expiresAt > now()) body.expiresAt = result.expiresAt;
                }
            } else if (method === 'GET' && /^\/v1\/playlist\/[^/]+\/[^/]+$/.test(route)) {
                const [, , , providerValue, encodedId] = route.split('/');
                const provider = providerName(providerValue), id = resourceId(decodeURIComponent(encodedId), provider), page = boundedInt(url.searchParams.get('page'), 1, 100);
                const result = await bounded(async () => (await getAdapter(session.accounts[provider], provider)).playlist(id, page));
                body = { tracks: (result.tracks || []).slice(0, 30).map(v => trackFacts(v, provider)).filter(Boolean), hasMore: result.hasMore === true, ...(Number.isInteger(result.total) && result.total >= 0 && result.total <= 3000 ? { total: result.total } : {}) };
            } else throw error(404, 'not_found');
            assertOpen();
            return { status: 200, headers, body };
        } catch (e) {
            if (closed) e = error(503, 'gateway_closed');
            const status = e.status || (e instanceof URIError ? 400 : 502);
            return { status, headers, body: { error: { code: e.code && e.status ? e.code : (status === 400 ? 'invalid_parameter' : 'provider_unavailable'), message: status === 502 ? 'Platform request failed' : 'Request could not be completed' } } };
        } finally { if (activeSession) activeSession.inflight--; }
    }
    async function handler(req, res) {
        let size = 0, chunks = [];
        try {
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 4096) throw error(413, 'request_too_large');
                chunks.push(chunk);
            }
            let body;
            if (size) {
                try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error(400, 'invalid_json'); }
                if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'invalid_json');
            }
            const result = await dispatch({ method: req.method, path: req.url, headers: req.headers, body, ip: resolveClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], options.trustedProxies || []) });
            res.writeHead(result.status, result.headers); res.end(result.body === null ? '' : JSON.stringify(result.body));
        } catch (e) {
            res.writeHead(e.status || 400, BASE_HEADERS); res.end(JSON.stringify({ error: { code: e.code || 'invalid_request' } }));
        }
    }
    const server = options.tls ? https.createServer(options.tls, handler) : http.createServer(handler);
    server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
    return { server, dispatch, close() {
        if (closing) return closing;
        closed = true;
        const cleanupJobs = [];
        for (const session of sessions.values()) {
            for (const account of Object.values(session.accounts)) { account.generation++; cleanupJobs.push(closeAdapter(account.adapter)); }
            for (const qr of session.qrs.values()) cleanupJobs.push(retireQR(qr));
        }
        closing = (async () => {
            await Promise.all(cleanupJobs);
            await saving;
            if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
        })();
        return closing;
    } };
}
