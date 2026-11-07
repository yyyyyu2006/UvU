const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const file = path.join(__dirname, '../js/modules/voice_director.js');

function fixture() {
    const previous = { id: 'p', role: 'user', content: '你刚才说的让我很难过。' };
    const message = { id: 'm', role: 'assistant', content: '[晴的语音：对不起，是我没考虑周全。]' };
    const chat = { id: 'a', activeArchiveId: 'archive-a', realName: '晴', persona: '温柔且克制', history: [previous, message] };
    const calls = [], bubble = {}, settings = { enabled: true, provider: 'newapi', endpoint: 'https://director.test/v1',
        apiKey: 'director-secret', model: 'model', contextMessages: 12, timeoutSec: 12, prompt: '' };
    const timers = new Set();
    const state = { chat, message, previous, bubble, settings, calls,
        reply: { emotion: 'sad', speedMultiplier: 0.9, pauses: [{ after: '对不起，', seconds: 0.4 }] } };
    const c = vm.createContext({ window: {}, db: { characters: [chat], groups: [] }, AbortController, URL,
        setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); timers.add(t); return t; },
        clearTimeout: t => { timers.delete(t); clearTimeout(t); },
        fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) });
            if (state.fetch) return state.fetch(url, init);
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(state.reply) } }] }) };
        } });
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), c);
    state.director = fs.existsSync(file) ? vm.runInContext('VoiceDirector', c) : undefined;
    state.db = c.db;
    state.timers = timers;
    return state;
}
function capture(f) { f.director.bind(f.bubble, f.chat, f.message, 'private'); return f.director.capture(f.bubble, '对不起，是我没考虑周全。', f.settings); }

test('disabled director performs no request and leaves voice settings and text intact', async () => {
    const f = fixture(); assert.ok(f.director, 'director module exists');
    assert.equal(f.director.settings({}).enabled, false);
    const source = f.director.capture(f.bubble, '原文', { enabled: false });
    assert.equal(source, null);
    const result = await f.director.prepare('原文', { enabled: false }, source);
    assert.equal(result.text, '原文'); assert.equal(result.speedMultiplier, 1);
    assert.equal(f.calls.length, 0);
});

test('director adds only supported controls and never rewrites the message', async () => {
    const f = fixture(), before = JSON.stringify(f.chat), source = capture(f);
    f.reply.text = '恶意改写(laughs)'; f.reply.emotion = 'sad';
    const result = await f.director.prepare('对不起，是我没考虑周全。', f.settings, source);
    assert.equal(result.text, '对不起，<#0.4#>是我没考虑周全。');
    assert.equal(result.emotion, 'sad'); assert.equal(result.speedMultiplier, 0.9);
    assert.equal(JSON.stringify(f.chat), before);
    assert.equal(f.calls[0].url, 'https://director.test/v1/chat/completions');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer director-secret');
    assert.match(f.calls[0].body.messages[1].content, /温柔且克制/);
    assert.equal(f.calls[0].body.stream, false);
});

test('source context excludes future, thinking, status, disabled and media payloads', () => {
    const f = fixture(); assert.ok(f.director);
    f.chat.history.splice(1, 0,
        { id: 'thought', role: 'assistant', content: '<thinking>SECRET</thinking>', isThinking: true },
        { id: 'status', role: 'assistant', content: '[system-display: HIDDEN]', isStatusUpdate: true },
        { id: 'excluded', role: 'user', content: 'EXCLUDED', isContextDisabled: true },
        { id: 'mixed', role: 'assistant', content: '<thinking>SECRET2</thinking>我会认真听。<status>HIDDEN2</status>' },
        { id: 'image', role: 'user', content: '<img src="data:image/png;base64,AAA">', parts: [{ type: 'image', data: 'BASE64' }] });
    f.chat.history.push({ id: 'future', role: 'user', content: 'FUTURE' });
    const source = capture(f), json = JSON.stringify(source.payload);
    assert.doesNotMatch(json, /SECRET|HIDDEN|EXCLUDED|FUTURE|BASE64|base64/);
    assert.match(json, /我会认真听/);
});

test('director cache isolates message context, archive, persona and settings', async () => {
    const f = fixture(); let source = capture(f);
    await f.director.prepare('对不起，是我没考虑周全。', f.settings, source);
    await f.director.prepare('对不起，是我没考虑周全。', f.settings, capture(f));
    assert.equal(f.calls.length, 1);
    f.previous.content = '我现在很开心。';
    await f.director.prepare('对不起，是我没考虑周全。', f.settings, capture(f));
    f.chat.activeArchiveId = 'archive-b';
    await f.director.prepare('对不起，是我没考虑周全。', f.settings, capture(f));
    f.chat.persona = '爽朗';
    await f.director.prepare('对不起，是我没考虑周全。', f.settings, capture(f));
    await f.director.prepare('对不起，是我没考虑周全。', { ...f.settings, model: 'other-model' }, capture(f));
    assert.equal(f.calls.length, 5);
    assert.equal(f.timers.size, 0);
});

test('undelivered messages stay out of director context after manual context restoration', () => {
    const f = fixture();
    f.chat.history.splice(1, 0, { id: 'rejected', role: 'user', content: 'UNDELIVERED',
        relationshipDelivery: 'blocked', isContextDisabled: false });
    const source = capture(f);
    assert.doesNotMatch(JSON.stringify(source.payload), /UNDELIVERED/);
    assert.match(JSON.stringify(source.payload), /你刚才说的/);
});

test('director removes source chat custom status blocks without changing stored text', () => {
    for (const regexPattern of ['<character_status>.*?</character_status>', '/<character_status>.*?<\\/character_status>/i']) {
        const f = fixture();
        f.chat.statusPanel = { enabled: true, regexPattern };
        f.chat.history.splice(1, 0, { id: 'imported', role: 'assistant',
            content: '我会听你说。<character_status>PRIVATE_STATUS\nsecond line</character_status>\n<character_status>OTHER_STATUS</character_status>请继续。' });
        const before = JSON.stringify(f.chat), source = capture(f), json = JSON.stringify(source.payload);
        assert.doesNotMatch(json, /PRIVATE_STATUS|second line|OTHER_STATUS/);
        assert.match(json, /我会听你说/);
        assert.match(json, /请继续/);
        assert.equal(JSON.stringify(f.chat), before);
    }
});

test('stale archive, deleted message and edited context invalidate captured direction', () => {
    for (const change of [f => { f.chat.activeArchiveId = 'other'; }, f => { f.chat.history.pop(); }, f => { f.previous.content = 'changed'; }]) {
        const f = fixture(), source = capture(f); change(f);
        assert.equal(f.director.isCurrent(source), false);
    }
});

test('arbitrary labels, duplicate anchors and invalid controls cannot enter spoken text', async () => {
    const f = fixture(); assert.ok(f.director);
    f.reply = { emotion: 'whisper(laughs)', speedMultiplier: 999, pauses: [
        { after: '对不起，', seconds: -1 }, { after: '是我', seconds: 0.3 },
        { after: '<tag>', seconds: 0.3 }, { after: '周全。', seconds: 0.3 }
    ] };
    const result = await f.director.prepare('对不起，是我没考虑周全。', f.settings, capture(f));
    assert.equal(result.text, '对不起，是我没考虑周全。');
    assert.equal(result.emotion, ''); assert.equal(result.speedMultiplier, 1);
    f.director.bind(f.bubble, f.chat, f.message, 'private');
    const duplicate = f.director.capture({}, '好，好，再见。', f.settings);
    f.reply = { emotion: 'calm', speedMultiplier: 1, pauses: [{ after: '好，', seconds: 0.5 }] };
    const other = await f.director.prepare('好，好，再见。', f.settings, duplicate);
    assert.equal(other.text, '好，好，再见。');
});

test('director failure falls back without leaking response body or credentials', async () => {
    const f = fixture(), source = capture(f);
    f.fetch = async () => ({ ok: false, status: 401, text: async () => 'director-secret private server content' });
    const result = await f.director.prepare('对不起，是我没考虑周全。', f.settings, source);
    assert.equal(result.text, '对不起，是我没考虑周全。');
    assert.equal(result.emotion, ''); assert.match(result.warning, /401/);
    assert.doesNotMatch(result.warning, /director-secret|private server/);
    f.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) });
    const invalid = await f.director.prepare('对不起，是我没考虑周全。', f.settings, source);
    assert.equal(invalid.text, '对不起，是我没考虑周全。'); assert.ok(invalid.warning);
});

test('external cancellation never falls back into another paid TTS request', async () => {
    const f = fixture(), source = capture(f), controller = new AbortController();
    f.fetch = (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
    const pending = f.director.prepare('对不起，是我没考虑周全。', f.settings, source, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(f.timers.size, 0);
});

test('Gemini director has independent auth and parses only visible response text', async () => {
    const f = fixture(), source = capture(f);
    f.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [
        { thought: true, text: 'private reasoning' }, { text: JSON.stringify(f.reply) }
    ] } }] }) });
    const result = await f.director.prepare('对不起，是我没考虑周全。', {
        ...f.settings, provider: 'gemini', endpoint: 'https://gemini.test/v1beta', model: 'models/gemini-test'
    }, source);
    assert.equal(f.calls[0].url, 'https://gemini.test/v1beta/models/gemini-test:generateContent');
    assert.equal(f.calls[0].init.headers['x-goog-api-key'], 'director-secret');
    assert.equal(result.emotion, 'sad');
});

test('group direction uses the speaking member persona instead of the currently open private chat', () => {
    const f = fixture(); assert.ok(f.director);
    const member = { id: 'member', originalCharId: f.chat.id, realName: '晴', persona: '群内人设' };
    const message = { id: 'g-voice', role: 'assistant', senderId: member.id, content: '[晴的语音：你好。]' };
    const group = { id: 'g', activeArchiveId: 'ga', name: '群', members: [member], history: [message] };
    f.db.groups.push(group);
    // Registering a second chat must not alter the first bubble's source.
    f.director.bind(f.bubble, group, message, 'group');
    const source = f.director.capture(f.bubble, '你好。', f.settings);
    assert.equal(source.payload.character.persona, '群内人设');
    assert.equal(source.payload.character.name, '晴');
});

test('director timeout falls back and cleans its timer', async () => {
    const f = fixture(), source = capture(f);
    f.fetch = (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
    const result = await f.director.prepare('对不起，是我没考虑周全。', { ...f.settings, timeoutSec: 1 }, source);
    assert.equal(result.text, '对不起，是我没考虑周全。');
    assert.match(result.warning, /超时/);
    assert.equal(f.timers.size, 0);
});


test('normal speech identity and role resolution remain guarded when director is disabled', () => {
    const f = fixture(); f.director.bind(f.bubble, f.chat, f.message, 'private');
    assert.equal(f.director.roleFor(f.bubble), f.chat);
    const identity = f.director.identity(f.bubble, '原文');
    assert.equal(f.director.isCurrent(identity), true);
    f.chat.activeArchiveId = 'another';
    assert.equal(f.director.isCurrent(identity), false);
    assert.throws(() => f.director.roleFor(f.bubble), { name: 'AbortError' });
});

test('director reports returned usage separately and explicit retry invalidates only its own plan', async () => {
    const f = fixture(), source = capture(f);
    f.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(f.reply) } }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }) });
    const result = await f.director.prepare('对不起，是我没考虑周全。', f.settings, source);
    assert.equal(result.usage.inputTokens, 12); assert.equal(result.usage.outputTokens, 4);
    await f.director.prepare(source.text, f.settings, source); assert.equal(f.calls.length, 1);
    f.director.invalidate(f.settings, source);
    await f.director.prepare(source.text, f.settings, source); assert.equal(f.calls.length, 2);
});

test('director pause controls cannot add more than 4.5 seconds total', async () => {
    const f = fixture(), line = '一，二，三，四，五。';
    f.reply.pauses = ['一，','二，','三，','四，'].map(after => ({ after, seconds: 1.5 }));
    const source = f.director.capture({}, line, f.settings);
    const result = await f.director.prepare(line, f.settings, source);
    assert.equal(result.pauseCount, 3); assert.equal(result.pauseSeconds, 4.5);
});
