const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const gatewayModule = import(pathToFileURL(path.join(__dirname, '../services/music-gateway/gateway.mjs')));

function fixtures() {
    const instances = [];
    let clock = 100000;
    const factory = async provider => {
        const adapter = {
            provider, cookie: '', closed: false,
            async createQR() { return { state: 'PRIVATE-STATE', image: 'data:image/png;base64,aGVsbG8=', url: '' }; },
            async pollQR() { return { status: 'authorized', credential: 'PRIVATE-COOKIE', user: { id: '123', name: provider } }; },
            async setCredential(value) { this.cookie = value; },
            async search(q, page) { if (provider === 'qq' && q === 'partial') throw Error('PRIVATE-COOKIE'); return { tracks: [{ id: '123', title: q, artists: ['Artist'], duration: 12, cookie: 'SECRET' }], hasMore: page === 1 }; },
            async stream() { return { url: 'https://m701.music.126.net/song.mp3?key=abc', availability: 'preview' }; },
            async lyrics() { return { lyric: '[00:01]hello', translation: 'translated', cookie: 'SECRET' }; },
            async playlists() { return [{ id: '456', name: 'List', count: 1 }]; },
            async playlist(id, page) { return { tracks: [{ id: '123', title: 'Song', artists: [] }], hasMore: page === 1 }; },
            close() { this.closed = true; }
        };
        instances.push(adapter);
        return adapter;
    };
    return { instances, factory, now: () => clock, advance: ms => { clock += ms; } };
}
async function setup(options = {}) {
    const { createGateway } = await gatewayModule;
    const f = fixtures();
    const gateway = await createGateway({ adapterFactory: f.factory, now: f.now, origins: ['http://localhost:3000'], ...options });
    const request = (method, route, token, body, headers = {}) => gateway.dispatch({ method, path: '/v1' + route, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body, ip: '127.0.0.1' });
    const session = async remember => (await request('POST', '/session', null, { remember })).body.token;
    return { ...f, gateway, request, session };
}

test('gateway exposes health and authenticated contract without raw provider fields', async t => {
    const s = await setup(); t.after(() => s.gateway.close());
    assert.deepEqual((await s.request('GET', '/health')).body.providers, ['netease', 'qq']);
    assert.equal((await s.request('GET', '/accounts')).status, 401);
    const token = await s.session();
    assert.match(token, /^[\w-]{40,}$/);
    const search = await s.request('GET', '/search?q=hello&providers=netease&page=1', token);
    assert.equal(search.status, 200); assert.equal(search.body.tracks[0].provider, 'netease');
    assert.equal(search.body.tracks[0].cookie, undefined);
    assert.equal(search.body.hasMore, true);
    assert.deepEqual((await s.request('GET', '/track/netease/123/lyrics', token)).body, { lyric: '[00:01]hello', translation: 'translated' });
});

test('each session/provider has isolated credentials and QR state stays private', async t => {
    const s = await setup(); t.after(() => s.gateway.close());
    const a = await s.session(), b = await s.session();
    const qr = await s.request('POST', '/accounts/netease/qr', a);
    assert.equal(qr.body.state, undefined); assert.equal(qr.body.credential, undefined);
    assert.equal((await s.request('GET', '/accounts/netease/qr/' + qr.body.id, b)).status, 404);
    assert.equal((await s.request('GET', '/accounts/qq/qr/' + qr.body.id, a)).status, 404);
    assert.equal((await s.request('GET', '/accounts/netease/qr/' + qr.body.id, a)).body.status, 'authorized');
    const accountsA = (await s.request('GET', '/accounts', a)).body.accounts;
    const accountsB = (await s.request('GET', '/accounts', b)).body.accounts;
    assert.equal(accountsA[0].loggedIn, true); assert.equal(accountsA[1].loggedIn, false); assert.equal(accountsB[0].loggedIn, false);
    assert.equal((await s.request('GET', '/accounts/netease/playlists', a)).body.playlists[0].id, '456');
    assert.equal((await s.request('GET', '/accounts/netease/playlists', b)).status, 401);
    assert.equal(JSON.stringify(accountsA).includes('PRIVATE'), false);
});

test('expired or superseded QR cannot authorize, including completion after logout', async t => {
    const s = await setup({ qrTtlMs: 1000 }); t.after(() => s.gateway.close());
    const token = await s.session();
    const qr = (await s.request('POST', '/accounts/qq/qr', token)).body;
    s.advance(1001);
    assert.equal((await s.request('GET', '/accounts/qq/qr/' + qr.id, token)).body.status, 'expired');
    const next = (await s.request('POST', '/accounts/qq/qr', token)).body;
    let release;
    s.instances.at(-1).pollQR = () => new Promise(resolve => { release = resolve; });
    const pending = s.request('GET', '/accounts/qq/qr/' + next.id, token);
    await new Promise(resolve => setImmediate(resolve));
    await s.request('DELETE', '/accounts/qq', token);
    release({ status: 'authorized', credential: 'PRIVATE-LATE' });
    assert.equal((await pending).body.status, 'expired');
    assert.equal((await s.request('GET', '/accounts', token)).body.accounts[1].loggedIn, false);
});

test('parallel QR polls coalesce and a new QR invalidates pending authorization', async t => {
    const s = await setup(); t.after(() => s.gateway.close());
    const token = await s.session();
    const qr = (await s.request('POST', '/accounts/qq/qr', token)).body;
    let release, calls = 0;
    s.instances.at(-1).pollQR = () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const a = s.request('GET', '/accounts/qq/qr/' + qr.id, token);
    const b = s.request('GET', '/accounts/qq/qr/' + qr.id, token);
    await new Promise(resolve => setImmediate(resolve));
    await s.request('POST', '/accounts/qq/qr', token);
    release({ status: 'authorized', credential: 'LATE' });
    assert.equal((await a).body.status, 'expired'); assert.equal((await b).body.status, 'expired'); assert.equal(calls, 1);
});

test('one failed provider retains successful search results and redacts upstream error', async t => {
    const s = await setup(); t.after(() => s.gateway.close()); const token = await s.session();
    const res = await s.request('GET', '/search?q=partial&providers=netease,qq', token);
    assert.equal(res.status, 200); assert.equal(res.body.tracks.length, 1); assert.equal(res.body.errors[0].provider, 'qq');
    assert.equal(JSON.stringify(res.body).includes('PRIVATE'), false);
});

test('rejects unsafe URLs, malformed ids and unsupported providers without proxying', async t => {
    const s = await setup(); t.after(() => s.gateway.close()); const token = await s.session();
    await s.request('GET', '/search?q=x&providers=netease', token);
    for (const url of ['http://127.0.0.1/a', 'https://evil.test/a', 'https://music.126.net.evil.test/a', 'https://user:pass@m701.music.126.net/a', 'file:///a']) {
        s.instances[0].stream = async () => ({ url });
        const response = await s.request('GET', '/track/netease/123/stream', token);
        assert.equal(response.body.availability, 'unavailable'); assert.equal(response.body.url, '');
    }
    assert.equal((await s.request('GET', '/track/netease/1%7B/stream', token)).status, 400);
    assert.equal((await s.request('GET', '/search?q=x&providers=evil', token)).status, 400);
    assert.equal((await s.request('GET', '/proxy?url=https://evil.test', token)).status, 404);
});

test('CORS uses an exact allowlist and bounds requests, paging and sessions', async t => {
    const s = await setup({ maxSessions: 2 }); t.after(() => s.gateway.close());
    assert.equal((await s.request('POST', '/session', null, {}, { origin: 'https://evil.test' })).status, 403);
    const good = await s.request('OPTIONS', '/accounts', null, null, { origin: 'http://localhost:3000' });
    assert.equal(good.headers['Access-Control-Allow-Origin'], 'http://localhost:3000');
    const token = await s.session(); await s.session();
    assert.equal((await s.request('POST', '/session')).status, 429);
    assert.equal((await s.request('GET', '/search?q=x&page=0', token)).status, 400);
    assert.equal((await s.request('GET', '/search?q=' + 'x'.repeat(301), token)).status, 400);
});

test('provider operation timeouts are bounded and do not reveal exception text', async t => {
    const s = await setup({ timeoutMs: 20 }); t.after(() => s.gateway.close()); const token = await s.session();
    await s.request('GET', '/search?q=x&providers=netease', token);
    s.instances[0].lyrics = () => new Promise(() => {});
    const result = await s.request('GET', '/track/netease/123/lyrics', token);
    assert.equal(result.status, 504);
});

test('remembered credentials persist encrypted; restart restores only their matching opaque token', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-gateway-test-'));
    const gateways = [];
    t.after(async () => {
        for (const gateway of gateways) await gateway.close();
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
    });
    const config = { persistPath: path.join(dir, 'vault.json'), encryptionKey: Buffer.alloc(32, 7) };
    const first = await setup(config);
    gateways.push(first.gateway);
    const token = await first.session(true);
    const qr = (await first.request('POST', '/accounts/qq/qr', token)).body;
    await first.request('GET', '/accounts/qq/qr/' + qr.id, token);
    const disk = await fs.readFile(config.persistPath, 'utf8');
    assert.equal(disk.includes('PRIVATE-COOKIE'), false); assert.equal(disk.includes(token), false);
    await first.gateway.close();
    const second = await setup(config); gateways.push(second.gateway);
    assert.equal((await second.request('GET', '/accounts', token)).body.accounts[1].loggedIn, true);
    assert.equal((await second.request('GET', '/accounts', 'wrong')).status, 401);
    await second.request('DELETE', '/accounts/qq', token);
    await second.gateway.close();
    const third = await setup(config); gateways.push(third.gateway);
    assert.equal((await third.request('GET', '/accounts', token)).body.accounts[1].loggedIn, false);
});

test('shutdown rejects a session paused at cleanup and never creates its vault afterward', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-gateway-shutdown-'));
    const vault = path.join(dir, 'vault.json');
    const s = await setup({ persistPath: vault, encryptionKey: Buffer.alloc(32, 8) });
    t.after(async () => { await s.gateway.close(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }); });
    const pending = s.request('POST', '/session', null, { remember: true });
    await s.gateway.close();
    await assert.rejects(fs.access(vault), { code: 'ENOENT' });
    const result = await pending;
    assert.equal(result.status, 503); assert.equal(result.body.error.code, 'gateway_closed');
    await assert.rejects(fs.access(vault), { code: 'ENOENT' });
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(fs.access(vault), { code: 'ENOENT' });
});

test('concurrent shutdown callers wait for adapter cleanup and late QR cannot persist authorization', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-gateway-shutdown-'));
    const vault = path.join(dir, 'vault.json');
    const s = await setup({ persistPath: vault, encryptionKey: Buffer.alloc(32, 9) });
    t.after(async () => { await s.gateway.close(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }); });
    const token = await s.session(true);
    await s.request('GET', '/search?q=x&providers=netease', token);
    let finishClose;
    s.instances[0].close = () => new Promise(resolve => { finishClose = resolve; });
    const qr = (await s.request('POST', '/accounts/qq/qr', token)).body;
    let finishCredential, credentialStarted;
    const installed = new Promise(resolve => { credentialStarted = resolve; });
    s.instances.at(-1).setCredential = () => { credentialStarted(); return new Promise(resolve => { finishCredential = resolve; }); };
    const pending = s.request('GET', '/accounts/qq/qr/' + qr.id, token);
    await installed;
    const previousVault = await fs.readFile(vault, 'utf8');
    const closeA = s.gateway.close();
    let secondDone = false;
    const closeB = s.gateway.close().then(() => { secondDone = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(secondDone, false, 'all close callers must wait for the same shutdown');
    finishCredential();
    const response = await pending;
    assert.equal(response.status, 503);
    finishClose();
    await Promise.all([closeA, closeB]);
    assert.equal(await fs.readFile(vault, 'utf8'), previousVault);
});

test('actual HTTP server rejects oversized bodies and emits no-store responses', async t => {
    const s = await setup(); t.after(() => s.gateway.close());
    await new Promise(resolve => s.gateway.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + s.gateway.server.address().port;
    const res = await fetch(base + '/v1/health'); assert.equal(res.headers.get('cache-control'), 'no-store');
    const oversized = await fetch(base + '/v1/session', { method: 'POST', body: 'x'.repeat(5000) });
    assert.equal(oversized.status, 413);
});

test('health states clearly when the pinned provider engine is missing', async t => {
    const { createGateway } = await gatewayModule;
    const gateway = await createGateway({ engineStatus: async () => false }); t.after(() => gateway.close());
    const health = await gateway.dispatch({ method: 'GET', path: '/v1/health' });
    assert.equal(health.body.ok, false); assert.equal(health.body.ready, false);
    assert.equal(health.body.error, 'engine_not_installed');
});

test('replacing QR leaves current account usable and logout during credential installation wins', async t => {
    const s = await setup(); t.after(() => s.gateway.close()); const token = await s.session();
    const first = (await s.request('POST', '/accounts/qq/qr', token)).body;
    await s.request('GET', '/accounts/qq/qr/' + first.id, token);
    const active = s.instances[0];
    const next = (await s.request('POST', '/accounts/qq/qr', token)).body;
    assert.equal(active.closed, false, 'new QR must not terminate the authenticated adapter');
    let release;
    s.instances.at(-1).setCredential = () => new Promise(resolve => { release = resolve; });
    const pending = s.request('GET', '/accounts/qq/qr/' + next.id, token);
    await new Promise(resolve => setImmediate(resolve));
    await s.request('DELETE', '/accounts/qq', token); release();
    assert.equal((await pending).body.status, 'expired');
    assert.equal((await s.request('GET', '/accounts', token)).body.accounts[1].loggedIn, false);
});

test('engine adapter uses account-only rights flow, translates raw formats and contains upstream fetches', async () => {
    const { createEngineAdapter, createRestrictedFetch } = await import(pathToFileURL(path.join(__dirname, '../services/music-gateway/engine-adapter.mjs')));
    let instance;
    class Engine {
        constructor(provider) {
            this.providerName = provider; this.header = {}; instance = this;
            this.provider = {
                url: () => ({ kind: 'url' }),
                _getLoginUin: () => '123', _getGtk: () => 7, _getGuid: () => 'guid', _getMusicKey: () => 'musicKey',
                _requestVkeys: async (candidates, account, strategy) => { assert.equal(account.uin, '123'); assert.equal(strategy, 'web-post'); return { vkeys: [{ purl: 'song.mp3' }], sip: 'https://ws.stream.qqmusic.qq.com/' }; }
            };
        }
        format(value) { this.isFormat = value; }
        cookie(value) { this.header.Cookie = value; }
        async loginQr() { return JSON.stringify({ state: 'PRIVATE', qrurl: 'https://music.163.com/login?codekey=key' }); }
        async loginQrCheck() { return JSON.stringify({ code: 803, cookie: 'PRIVATE' }); }
        async _exec(api) {
            if (api.url?.includes('account/get')) return JSON.stringify({ profile: { userId: 123, nickname: 'Name' } });
            if (api.url?.includes('user/playlist')) return JSON.stringify({ code: 200, playlist: [{ id: 44, name: 'My list', trackCount: 2 }] });
            return JSON.stringify({ data: this.providerName === 'tencent' ? [{ mid: 'ABC', file: { size_128mp3: 12 } }] : [{ url: 'https://m701.music.126.net/audio', code: 200, freeTrialInfo: { start: 0, end: 30 } }] });
        }
        async search() { return JSON.stringify([{ id: '123', name: 'Song', artist: ['Singer'], album: 'Album', pic_id: '4' }]); }
        async pic() { return JSON.stringify({ url: 'https://p3.music.126.net/cover.jpg' }); }
        async lyric() { return JSON.stringify({ lyric: 'LRC', tlyric: 'translation' }); }
        async playlist() { return this.search(); }
        async userPlaylists() { return JSON.stringify({ code: 0, playlists: [{ id: '44', name: 'QQ list', song_count: 2 }] }); }
    }
    const netease = createEngineAdapter(Engine, 'netease', 'ACCOUNT');
    assert.equal((await netease.createQR()).state, 'PRIVATE');
    assert.equal((await netease.pollQR('PRIVATE')).user.name, 'Name');
    assert.equal((await netease.search('song', 1)).tracks[0].cover, 'https://p3.music.126.net/cover.jpg');
    assert.equal((await netease.stream('123')).availability, 'preview');
    assert.equal((await netease.playlists({ id: '123' }))[0].id, '44');
    assert.equal((await netease.lyrics('123')).translation, 'translation');
    assert.equal((await netease.playlist('44', 1)).tracks.length, 1);
    const qq = createEngineAdapter(Engine, 'qq', 'ACCOUNT');
    assert.equal(instance.header.Cookie, 'ACCOUNT');
    assert.equal((await qq.stream('ABC')).url, 'https://ws.stream.qqmusic.qq.com/song.mp3');
    assert.equal((await qq.playlists())[0].name, 'QQ list');
    instance.provider._getLoginUin = () => '0';
    await assert.rejects(qq.pollQR('PRIVATE'), /Incomplete QQ/);
    let calls = 0;
    const restricted = createRestrictedFetch(async (url, options) => {
        calls++; assert.equal(url.protocol, 'https:'); assert.equal(options.headers.has('X-Real-IP'), false);
        return new Response('small', { headers: { 'set-cookie': 'session=secret' } });
    }, 'netease');
    assert.equal(await (await restricted('http://music.163.com/a', { headers: { 'X-Real-IP': '1.2.3.4' } })).text(), 'small');
    await assert.rejects(restricted('https://evil.test/a')); assert.equal(calls, 1);
    const redirect = createRestrictedFetch(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/a' } }), 'qq');
    await assert.rejects(redirect('https://y.qq.com/a'));
});
