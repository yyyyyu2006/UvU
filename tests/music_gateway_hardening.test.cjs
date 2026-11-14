const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function setup(t, options = {}) {
    let clock = 1000000;
    const adapters = [];
    const { createGateway } = await import(pathToFileURL(path.join(__dirname, '../services/music-gateway/gateway.mjs')));
    const gateway = await createGateway({ now: () => clock, ...options, adapterFactory: () => {
        const adapter = {
            close() {}, async setCredential() {},
            async createQR() { return { state: 'PRIVATE', image: 'data:image/png;base64,aA==' }; },
            async pollQR() { return { status: 'authorized', credential: 'PRIVATE' }; },
            async search() { return { tracks: [] }; }, async lyrics() { return { lyric: 'ok' }; }
        };
        adapters.push(adapter); return adapter;
    } });
    t.after(() => gateway.close());
    let nextIp = 0;
    const request = (method, route, token) => gateway.dispatch({ method, path: '/v1' + route, headers: token ? { authorization: 'Bearer ' + token } : {}, ip: 'fixture-' + nextIp++ });
    const session = async () => (await request('POST', '/session')).body.token;
    return { gateway, request, session, adapters, advance(ms) { clock += ms; } };
}

test('unused anonymous sessions release admission capacity after a short idle period', async t => {
    const s = await setup(t, { maxSessions: 2 });
    const token = await s.session(); await s.session();
    assert.equal((await s.request('POST', '/session')).status, 429);
    s.advance(300001);
    assert.equal((await s.request('POST', '/session')).status, 201);
    assert.equal((await s.request('GET', '/accounts', token)).status, 401);
});

test('anonymous capacity reserves room for accounts without evicting a signed-in session', async t => {
    const s = await setup(t, { maxSessions: 3, maxAnonymousSessions: 1 });
    const token = await s.session();
    assert.equal((await s.request('POST', '/session')).status, 429);
    const qr = (await s.request('POST', '/accounts/qq/qr', token)).body;
    await s.request('GET', '/accounts/qq/qr/' + qr.id, token);
    assert.equal((await s.request('POST', '/session')).status, 201);
    s.advance(300001);
    assert.equal((await s.request('POST', '/session')).status, 201);
    assert.equal((await s.request('GET', '/accounts', token)).body.accounts[1].loggedIn, true);
});

test('last activity refreshes anonymous idle time and active QR survives idle cleanup', async t => {
    const s = await setup(t, { maxSessions: 2, qrTtlMs: 600000 });
    const token = await s.session();
    s.advance(290000);
    assert.equal((await s.request('GET', '/accounts', token)).status, 200);
    s.advance(20000);
    assert.equal((await s.request('GET', '/accounts', token)).status, 200);
    const qr = (await s.request('POST', '/accounts/qq/qr', token)).body;
    s.advance(300001);
    await s.request('POST', '/session');
    assert.equal((await s.request('GET', '/accounts/qq/qr/' + qr.id, token)).body.status, 'authorized');
});

test('in-flight anonymous work keeps its session through cleanup and refreshes idle time on completion', async t => {
    const s = await setup(t, { maxSessions: 2 });
    const token = await s.session();
    await s.request('GET', '/search?q=a&providers=qq', token);
    let release;
    s.adapters[0].lyrics = () => new Promise(resolve => { release = resolve; });
    const pending = s.request('GET', '/track/qq/123/lyrics', token);
    await new Promise(resolve => setImmediate(resolve));
    s.advance(300001);
    await s.request('POST', '/session');
    release({ lyric: 'ok' });
    assert.equal((await pending).status, 200);
    assert.equal((await s.request('GET', '/accounts', token)).status, 200);
});

test('gateway keeps safe error categories for direct operations and partial searches while redacting unknown codes', async t => {
    const s = await setup(t); const token = await s.session();
    await s.request('GET', '/search?q=a&providers=qq', token);
    s.adapters[0].search = async () => { throw { code: 'provider_busy', status: 503, message: 'PRIVATE-COOKIE' }; };
    const search = await s.request('GET', '/search?q=a&providers=qq', token);
    assert.equal(search.body.errors[0].code, 'provider_busy');
    s.adapters[0].lyrics = async () => { throw { code: 'provider_invalid_response', status: 502, message: 'PRIVATE-COOKIE' }; };
    assert.equal((await s.request('GET', '/track/qq/123/lyrics', token)).body.error.code, 'provider_invalid_response');
    s.adapters[0].lyrics = async () => { throw { code: 'PRIVATE-COOKIE', status: 403 }; };
    const unknown = await s.request('GET', '/track/qq/123/lyrics', token);
    assert.equal(unknown.status, 502); assert.equal(unknown.body.error.code, 'provider_unavailable');
    assert.equal(JSON.stringify(search).includes('PRIVATE'), false);
});
