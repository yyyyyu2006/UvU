'use strict';
const { test: nodeTest } = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 1500 }, fn);
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../js', name), 'utf8');
function fixture(provider = 'newapi') {
    const requests = [], updates = [], logs = [], errors = [];
    const chat = { id: 'c', realName: 'CHAR_SENTINEL', myName: 'user', persona: 'PERSONA_SENTINEL',
        maxMemory: 2, history: [{ role: 'user', content: 'CHAT_SENTINEL', timestamp: 1 }] };
    const c = vm.createContext({ Response, ReadableStream, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
        document: { addEventListener() {} }, db: { apiSettings: { provider, model: 'test', key: 'fixture', url: 'https://api.invalid', streamEnabled: false }, characters: [chat], groups: [] },
        console: Object.fromEntries(['log', 'error', 'warn'].map(name => [name, (...args) => logs.push(args)])),
        getRandomValue: x => x, resolveAuxiliaryApiConfig: (_, config) => config, pad: x => String(x).padStart(2, '0'),
        showToast: x => errors.push(x), filterHistoryForAI: (_, history) => history, getContextMemoryJournals: () => [],
        fetch: async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ choices: [{ message: { content: 'ANSWER_SENTINEL' } }] })); } });
    c.window = c;
    require('./helpers/api_transport.cjs')(c);
    vm.runInContext(source('modules/auto_memory.js'), c);
    vm.runInContext(source('modules/chat_ai_call.js'), c);
    return { c, chat, requests, updates, logs, errors };
}
const packet = text => 'data:' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n';
const complete = text => ({ choices: [{ message: { content: text } }] });
const gemini = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
function trackedResponse(chunks, open = false) {
    let cancelled = false, streamController;
    const response = new Response(new ReadableStream({ start(controller) {
        streamController = controller;
        chunks.forEach(chunk => controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk));
        if (!open) controller.close();
    }, cancel() { cancelled = true; } }));
    return { response, cancelled: () => cancelled, close() { try { streamController.close(); } catch {} } };
}

test('auxiliary API preserves complete paths and explicit versions without altering messages', () => {
    const { c } = fixture(), messages = [{ role: 'user', content: 'unchanged' }];
    for (const [suffix, expected] of [['', '/v1/chat/completions'], ['/v1/', '/v1/chat/completions'],
        ['/chat/completions', '/chat/completions'], ['/api/v2', '/api/v2/chat/completions'],
        ['/api/chat/completions?route=one', '/api/chat/completions?route=one']]) {
        const result = c.buildChatApiRequest({ provider: 'newapi', url: 'https://api.invalid' + suffix, model: 'm', key: 'k' }, messages);
        assert.equal(result.endpoint, 'https://api.invalid' + expected);
        assert.equal(result.requestBody.messages, messages);
    }
});
test('nonstream HTTP200 business errors expose the provider error instead of choices[0]', async () => {
    const { c } = fixture(); c.fetch = async () => new Response(JSON.stringify({ error: { code: 'LIMIT', message: 'quota exhausted' } }));
    await assert.rejects(c.fetchAiResponse({}, {}, {}, 'https://api.invalid'), /LIMIT.*quota exhausted/);
});
test('nonstream malformed and empty responses fail clearly, including null and non-text content', async () => {
    for (const data of [null, {}, { choices: [] }, complete(null), complete({ text: 'wrong' }), complete('  ')]) {
        const { c } = fixture(); c.fetch = async () => new Response(JSON.stringify(data));
        await assert.rejects(c.fetchAiResponse({}, {}, {}, 'https://api.invalid'), /API.*(文本|格式)/);
    }
});
test('stream business error after partial text fails and cancels instead of returning partial success', async () => {
    const { c } = fixture(), f = trackedResponse([packet('partial'), 'data:{"error":{"message":"upstream failed"}}\n\n']);
    try { await assert.rejects(c.readStreamResponse(f.response, 'newapi'), /upstream failed/); }
    finally { f.close(); }
    assert.equal(f.response.body.locked, false);
});
test('DONE finishes immediately, ignores following packets and cancels an open connection', async () => {
    const { c } = fixture(), f = trackedResponse([packet('reply') + 'data: [DONE]\n\n' + packet('ignored')], true);
    let timer;
    try {
        const result = await Promise.race([c.readStreamResponse(f.response, 'newapi'), new Promise((_, reject) => timer = setTimeout(() => reject(Error('still waiting for EOF')), 100))]);
        assert.equal(result, 'reply'); assert.equal(f.cancelled(), true);
    } finally { clearTimeout(timer); f.close(); }
});
test('JSON fallback works when streaming was requested, and still reports token usage', async () => {
    const { c } = fixture(), usage = []; const data = { ...complete('reply'), usage: { total_tokens: 8 } };
    assert.equal(await c.readStreamResponse(new Response(JSON.stringify(data)), 'newapi', x => usage.push(x)), 'reply');
    assert.equal(usage[0].total_tokens, 8);
});
test('SSE without a content-type header uses the same error checks in nonstream mode', async () => {
    const { c } = fixture(); c.fetch = async () => new Response(packet('partial') + 'data:{"error":{"message":"failure sentinel"}}\n\n');
    await assert.rejects(c.fetchAiResponse({}, {}, {}, 'https://api.invalid'), error => /^API.*failure sentinel/.test(error.message));
});
test('event:error is not silently treated as a normal empty event', async () => {
    const { c } = fixture();
    await assert.rejects(c.readStreamResponse(new Response('event:error\ndata:{"message":"event failed"}\n\n'), 'newapi'), /event failed/);
});
test('malformed event after valid output cannot become a successful partial response', async () => {
    const { c } = fixture();
    await assert.rejects(c.readStreamResponse(new Response(packet('partial') + 'data:{broken}\n\n'), 'newapi'), /格式|JSON/);
});
test('reasoning-only and tool-only streams never masquerade as visible reply text', async () => {
    const { c } = fixture();
    for (const delta of [{ reasoning_content: 'internal' }, { tool_calls: [{ id: 'tool' }] }]) {
        await assert.rejects(c.readStreamResponse(new Response('data:' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata:[DONE]\n\n'), 'newapi'), /文本/);
    }
});
test('Gemini nonstream call selects generateContent and keeps exactly one final update', async () => {
    const f = fixture('gemini'); f.c.fetch = async (url, init) => { f.requests.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify(gemini('reply'))); };
    assert.equal(await f.c.getCallReply(f.chat, 'voice', [], text => f.updates.push(text)), 'reply');
    assert.match(f.requests[0].url, /:generateContent\?/); assert.deepEqual(f.updates, ['reply']);
});
for (const ending of ['\n\n', '\r\n\r\n', '']) test('call streaming accepts no-space data, Unicode and tail: ' + JSON.stringify(ending), async () => {
    const f = fixture(); f.c.db.apiSettings.streamEnabled = true;
    const bytes = new TextEncoder().encode('data:' + JSON.stringify({ choices: [{ delta: { content: '回复🌸' } }] }) + ending);
    f.c.fetch = async () => trackedResponse([...bytes].map(byte => new Uint8Array([byte]))).response;
    assert.equal(await f.c.getCallReply(f.chat, 'voice', [], x => f.updates.push(x)), '回复🌸');
    assert.deepEqual(f.updates, ['回复🌸']);
});
test('Gemini call accepts SSE as well as JSON array streams', async () => {
    for (const body of [JSON.stringify([gemini('one'), gemini('two')]), 'data:' + JSON.stringify(gemini('one')) + '\n\ndata:' + JSON.stringify(gemini('two')) + '\n\n']) {
        const f = fixture('gemini'); f.c.db.apiSettings.streamEnabled = true; f.c.fetch = async () => new Response(body);
        assert.equal(await f.c.getCallReply(f.chat, 'voice', [], () => {}), 'onetwo');
    }
});
test('call stream errors never invoke the final reply callback', async () => {
    const f = fixture(); f.c.db.apiSettings.streamEnabled = true; f.c.fetch = async () => new Response(packet('partial') + 'data:{"error":{"message":"failed"}}\n\n');
    assert.equal(await f.c.getCallReply(f.chat, 'voice', [], x => f.updates.push(x)), null);
    assert.deepEqual(f.updates, []);
});
test('routine call logs omit personas, conversation, returned text and thinking', async () => {
    const f = fixture(); f.c.db.cotSettings = { callEnabled: true }; f.c.fetch = async () => new Response(JSON.stringify(complete('<thinking>THINK_SENTINEL</thinking>ANSWER_SENTINEL')));
    await f.c.getCallReply(f.chat, 'voice', [{ role: 'user', content: 'CHAT_SENTINEL', type: 'voice' }], () => {});
    assert.doesNotMatch(JSON.stringify(f.logs), /PERSONA_SENTINEL|CHAT_SENTINEL|ANSWER_SENTINEL|THINK_SENTINEL/);
});
test('call summary checks HTTP failures, validates business errors and uses an abort signal', async () => {
    for (const [status, data] of [[500, complete('bad summary')], [200, { error: { message: 'quota' } }], [200, {}]]) {
        const f = fixture(); let signal;
        f.c.fetch = async (_, init) => { signal = init.signal; return new Response(JSON.stringify(data), { status }); };
        assert.equal(await f.c.generateCallSummary(f.chat, []), null); assert.ok(signal);
    }
});
test('summary timeout aborts its request and always clears its timer', async () => {
    const f = fixture(); let expire, signal, cleared;
    f.c.setTimeout = (callback, delay) => { assert.equal(delay, 300000); expire = callback; return 91; };
    f.c.clearTimeout = timer => cleared = timer;
    f.c.fetch = (_, init) => { signal = init.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true })); };
    const waiting = f.c.generateCallSummary(f.chat, []);
    assert.ok(signal); expire(); assert.equal(await waiting, null); assert.equal(cleared, 91);
    assert.equal(signal.aborted, true); assert.match(JSON.stringify(f.logs), /TIMEOUT/);
});
test('oversized stream fails and releases its connection instead of growing without a bound', async () => {
    const { c } = fixture(), f = trackedResponse([new Uint8Array(16 * 1024 * 1024 + 1)], true);
    try { await assert.rejects(c.readStreamResponse(f.response, 'gemini'), /过大/); }
    finally { f.close(); }
    assert.equal(f.cancelled(), true); assert.equal(f.response.body.locked, false);
});
test('main chat reports HTTP200 provider/malformed errors without delivering a reply or changing history', async () => {
    for (const data of [{ error: { code: 'LIMIT', message: 'quota failed' } }, null, {}, complete(null), complete({ value: 'wrong' })]) {
        const f = fixture(); const original = JSON.stringify(f.chat.history);
        Object.assign(f.c, { currentChatId: 'c', currentChatType: 'private', isGenerating: false,
            AudioManager: { unlock() {} }, getReplyBtn: {}, regenerateBtn: {}, typingIndicator: { style: {} }, messageArea: {},
            generatePrivateSystemPrompt: () => 'original prompt', showApiError: e => f.errors.push(e.message) });
        vm.runInContext(source('modules/chat_ai.js'), f.c);
        f.c.handleAiReplyContent = async text => { f.updates.push(text); };
        f.c.fetch = async () => new Response(JSON.stringify(data));
        await f.c.getAiReply('c', 'private');
        assert.deepEqual(f.updates, []); assert.equal(JSON.stringify(f.chat.history), original);
        assert.equal(f.errors.length, 1); assert.match(f.errors[0], /API/); assert.doesNotMatch(f.errors[0], /undefined|reading/);
        if (data?.error) assert.match(f.errors[0], /LIMIT.*quota failed/);
    }
});
