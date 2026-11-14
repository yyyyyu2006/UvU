const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { Worker } = require('node:worker_threads');

async function fixture(t, timeoutMs = 1000) {
    const workers = [];
    class ControlledWorker extends EventEmitter {
        constructor(url, options) { super(); if (ControlledWorker.failNext) { ControlledWorker.failNext = false; throw Error('PRIVATE-CONSTRUCTOR'); } this.operation = options.workerData.operation; this.stdout = this.stderr = { resume() {} }; workers.push(this); }
        async terminate() { if (this.waitForTermination) await new Promise(resolve => { this.finishTermination = resolve; }); this.terminated = true; }
    }
    const key = '__uvuWorkerFixture' + Math.random().toString(36).slice(2);
    globalThis[key] = ControlledWorker;
    const hooks = registerHooks({ resolve(specifier, context, next) {
        if (context.parentURL?.includes('/services/music-gateway/provider-adapter.mjs')) {
            const source = specifier === 'node:worker_threads' ? `export const Worker = globalThis[${JSON.stringify(key)}];`
                : specifier === 'node:fs/promises' ? 'export async function access() {} export async function readFile() { return "4d83862b063b31af3eab1d823cfc7ff584609234"; }' : null;
            if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
        }
        return next(specifier, context);
    } });
    const url = pathToFileURL(path.join(__dirname, '../services/music-gateway/provider-adapter.mjs')).href + '?fixture=' + key;
    let module;
    try { module = await import(url); } finally { hooks.deregister(); delete globalThis[key]; }
    const adapters = ['qq', 'netease'].map(provider => module.createProviderAdapter(provider, { timeoutMs }));
    t.after(() => Promise.all(adapters.map(adapter => adapter.close())));
    const tick = () => new Promise(resolve => setImmediate(resolve));
    return { workers, adapters, tick, WorkerClass: ControlledWorker };
}

test('all account adapters share an eight-worker process budget and reject excess work safely', async t => {
    const s = await fixture(t);
    const methods = [['createQR'], ['pollQR', 'state'], ['search', 'x', 1], ['stream', '123'], ['lyrics', '123'], ['playlists'], ['playlist', '123', 1], ['search', 'x', 1]];
    const requests = methods.map(([method, ...args], i) => s.adapters[i % 2][method](...args));
    const outcomes = requests.map(request => request.catch(error => error));
    await s.tick();
    const overflow = await s.adapters[0].lyrics('456').catch(error => error);
    assert.equal(overflow.code, 'provider_busy'); assert.equal(overflow.status, 503);
    assert.equal(s.workers.length, 8);
    for (const worker of s.workers) worker.emit('message', { ok: true, value: worker.operation === 'playlistSnapshot' ? [] : { tracks: [] } });
    await s.tick();
    for (const worker of s.workers.slice(8)) worker.emit('message', { ok: true, value: [] });
    await Promise.all(outcomes);
    const next = s.adapters[1].lyrics('123'); await s.tick();
    s.workers.at(-1).emit('message', { ok: true, value: { lyric: 'recovered' } });
    assert.equal((await next).lyric, 'recovered');
});

test('adapter close cancels pending requests, releases slots and settles callers promptly', async t => {
    const s = await fixture(t);
    const requests = Array.from({ length: 8 }, () => s.adapters[0].lyrics('123').catch(error => error));
    await s.tick(); await s.adapters[0].close();
    const results = await Promise.all(requests);
    assert.equal(results.every(result => result.code === 'provider_cancelled' && result.status === 503), true);
    const next = s.adapters[1].search('recover', 1); await s.tick();
    s.workers.at(-1).emit('message', { ok: true, value: { tracks: [] } });
    assert.deepEqual(await next, { tracks: [] });
});

test('worker failure codes are allowlisted and raw provider details never cross the adapter', async t => {
    const s = await fixture(t);
    const safe = s.adapters[0].lyrics('123').catch(error => error); await s.tick();
    s.workers.at(-1).emit('message', { ok: false, error: { code: 'provider_invalid_response', message: 'PRIVATE-COOKIE' } });
    assert.equal((await safe).code, 'provider_invalid_response');
    const unsafe = s.adapters[1].lyrics('123').catch(error => error); await s.tick();
    s.workers.at(-1).emit('message', { ok: false, error: { code: 'PRIVATE-COOKIE', status: 401 } });
    const error = await unsafe;
    assert.equal(error.code, 'provider_unavailable');
    assert.equal(JSON.stringify(error).includes('PRIVATE'), false);
});

test('real engine worker returns only safe categories for malformed, timeout and private upstream errors', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-worker-errors-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const entry = path.join(directory, 'entry.mjs');
    const source = `export default class Engine {
        constructor() { this.provider = {}; } format() {} cookie() {}
        async lyric(id) {
            if (id === 'malformed') return 'PRIVATE-NON-JSON';
            if (id === 'timeout') throw Object.assign(new Error('PRIVATE-COOKIE'), {code:'provider_timeout'});
            throw Object.assign(new Error('PRIVATE-COOKIE'), {code:'PRIVATE-COOKIE', status:401});
        }
    }`;
    const workerUrl = pathToFileURL(path.join(__dirname, '../services/music-gateway/engine-worker.mjs')).href;
    await fs.writeFile(entry, `import { registerHooks } from 'node:module';
        registerHooks({resolve(specifier, context, next) {
            if (specifier === './.runtime/engine/src/meting.js') return {url:${JSON.stringify('data:text/javascript,' + encodeURIComponent(source))},shortCircuit:true};
            return next(specifier, context);
        }});
        await import(${JSON.stringify(workerUrl)});`);
    for (const [id, code] of [['malformed', 'provider_invalid_response'], ['timeout', 'provider_timeout'], ['private', 'provider_unavailable']]) {
        const worker = new Worker(entry, { workerData: { provider: 'qq', operation: 'lyrics', args: [id], credential: 'PRIVATE-COOKIE' } });
        const result = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
        await worker.terminate();
        assert.deepEqual(result, { ok: false, error: { code } });
        assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    }
});

test('restricted upstream fetch reports safe HTTP and timeout categories without returning private response bodies', async () => {
    const { createRestrictedFetch } = await import(pathToFileURL(path.join(__dirname, '../services/music-gateway/engine-adapter.mjs')));
    const httpFailure = createRestrictedFetch(async () => new Response('PRIVATE-BODY', { status: 429 }), 'qq');
    await assert.rejects(httpFailure('https://y.qq.com/a'), error => error.code === 'provider_http_error' && !error.message.includes('PRIVATE'));
    const timeout = createRestrictedFetch(async () => { throw new DOMException('PRIVATE-URL', 'TimeoutError'); }, 'qq');
    await assert.rejects(timeout('https://y.qq.com/a'), error => error.code === 'provider_timeout' && !error.message.includes('PRIVATE'));
});

test('worker slots remain occupied until termination finishes, including a concurrent close', async t => {
    const s = await fixture(t);
    const requests = Array.from({ length: 8 }, () => s.adapters[0].lyrics('123').catch(error => error));
    await s.tick();
    s.workers[0].waitForTermination = true;
    s.workers[0].emit('message', { ok: true, value: { lyric: 'done' } });
    await s.tick();
    assert.equal((await s.adapters[1].lyrics('123').catch(error => error)).code, 'provider_busy');
    let closed = false;
    const close = s.adapters[0].close().then(() => { closed = true; });
    await s.tick(); assert.equal(closed, false);
    s.workers[0].finishTermination(); await close; await Promise.all(requests);
    const next = s.adapters[1].lyrics('123'); await s.tick();
    s.workers.at(-1).emit('message', { ok: true, value: { lyric: 'recovered' } });
    assert.equal((await next).lyric, 'recovered');
});

test('timeouts, worker crashes and constructor failures return the shared capacity', async t => {
    const s = await fixture(t, 20);
    s.WorkerClass.failNext = true;
    assert.equal((await s.adapters[0].lyrics('123').catch(error => error)).code, 'provider_unavailable');
    const timed = Array.from({ length: 8 }, () => s.adapters[0].lyrics('123').catch(error => error));
    assert.equal((await Promise.all(timed)).every(error => error.code === 'provider_timeout'), true);
    const crashed = Array.from({ length: 8 }, () => s.adapters[1].lyrics('123').catch(error => error));
    await s.tick();
    for (const [index, worker] of s.workers.slice(8).entries()) worker.emit(index % 2 ? 'exit' : 'error', index % 2 ? 1 : Error('PRIVATE-CRASH'));
    assert.equal((await Promise.all(crashed)).every(error => error.code === 'provider_unavailable'), true);
    const recovered = s.adapters[0].lyrics('123'); await s.tick();
    s.workers.at(-1).emit('message', { ok: true, value: { lyric: 'ok' } });
    assert.equal((await recovered).lyric, 'ok');
});
