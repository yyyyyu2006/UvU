'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(process.env.UVU_WORKSHOP_SETTINGS_SOURCE || path.join(__dirname, '../js/modules/image-workshop/settings.js'), 'utf8');
function fixture(fetch, timers = {}) {
    const select = { options: [{ value: 'old', textContent: 'Old' }], value: 'old',
        set innerHTML(_) { this.options = [{ value: '', textContent: '请选择模型' }]; this.value = ''; },
        appendChild(option) { this.options.push(option); } };
    const context = vm.createContext({ URL, Response, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
        document: { createElement: () => ({}) }, console, fetch, ...timers });
    vm.runInContext(source, context);
    return { select, run: (options = {}) => context.fetchGPTModels('https://models.test/v1/images/generations', 'fixture-key', select, 'chosen', options) };
}
for (const [label, payload] of [
    ['missing collection', {}], ['null root', null], ['object collection', { data: {} }],
    ['upstream error', { error: { message: 'fixture' }, data: [] }], ['null item', { data: [null] }],
    ['numeric ID', { data: [{ id: 3 }] }], ['blank ID', { data: [{ id: '   ' }] }],
    ['oversized ID', { data: [{ id: 'a'.repeat(1025) }] }],
    ['excessive item count', { data: Array.from({ length: 10001 }, (_, i) => ({ id: 'm' + i })) }]
]) {
    test('workshop model list rejects ' + label + ' before changing the select', async () => {
        const f = fixture(async () => new Response(JSON.stringify(payload)));
        await assert.rejects(f.run(), /模型列表/); assert.equal(f.select.options[0].value, 'old'); assert.equal(f.select.value, 'old');
    });
}
test('workshop model list rejects malformed JSON and HTTP errors without replacing options', async () => {
    for (const response of [new Response('{'), new Response('fixture error', { status: 503 })]) {
        const f = fixture(async () => response); await assert.rejects(f.run()); assert.equal(f.select.options[0].value, 'old');
    }
});
test('workshop model list reads split UTF8, deduplicates IDs and preserves the selection', async () => {
    let request;
    const bytes = new TextEncoder().encode(JSON.stringify({ data: [{ id: 'chosen' }, { id: '中文' }, { id: 'chosen' }] }));
    const f = fixture(async (url, options) => {
        request = { url, options };
        return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    });
    assert.equal(await f.run(), true); assert.deepEqual(f.select.options.map(o => o.value), ['', 'chosen', '中文']); assert.equal(f.select.value, 'chosen');
    assert.equal(request.url, 'https://models.test/v1/models'); assert.equal(request.options.headers.Authorization, 'Bearer fixture-key');
});
test('workshop model list ignores a retired response without touching existing options', async () => {
    const f = fixture(async () => new Response(JSON.stringify({ data: [{ id: 'new' }] })));
    assert.equal(await f.run({ isCurrent: () => false }), false); assert.equal(f.select.options[0].value, 'old');
});
test('workshop model list cancels oversized declared responses before consuming their body', async () => {
    let cancelled = false;
    const f = fixture(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Length': '3000000' } }));
    await assert.rejects(f.run(), /过大/); assert.equal(cancelled, true); assert.equal(f.select.options[0].value, 'old');
});
test('workshop model list cancels oversized streams even without content length', async () => {
    let cancelled = false;
    const f = fixture(async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
        cancel() { cancelled = true; }
    })));
    await assert.rejects(f.run(), /过大/); assert.equal(cancelled, true); assert.equal(f.select.options[0].value, 'old');
});
test('workshop model list timeout covers body consumption and clears its timer', async () => {
    let timeout, cleared = false, ready;
    const bodyReady = new Promise(resolve => { ready = resolve; });
    const f = fixture(async (_, options) => new Response(new ReadableStream({ start(controller) {
        // A native fetch errors its response stream when its signal is aborted.
        options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); ready();
    } })), { setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() { cleared = true; } });
    const task = f.run(); const rejection = assert.rejects(task, /超时/); await bodyReady; timeout(); await rejection;
    assert.equal(cleared, true); assert.equal(f.select.options[0].value, 'old');
});
test('workshop model list external cancellation does not become a timeout or alter options', async () => {
    let ready; const started = new Promise(resolve => { ready = resolve; });
    const f = fixture((_, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); ready(); }));
    const controller = new AbortController(), task = f.run({ signal: controller.signal }); const rejection = assert.rejects(task, { name: 'AbortError' });
    await started; controller.abort(); await rejection; assert.equal(f.select.options[0].value, 'old');
});
