'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const current = path.resolve(__dirname, '..');
const baseline = process.env.UVU_1900_ROOT || 'C:/Users/15271130817/Desktop/1900版uwu';
const available = fs.existsSync(path.join(baseline, 'js/modules/chat_ai_call.js'));
function fixture(root, provider, version, stream, cot) {
    const requests = [], updates = [];
    const chat = { id: 'call-char', realName: '测试角色', remarkName: '测试角色', myName: '我', persona: '原人设',
        myPersona: '用户人设', status: '在线', activeArchiveId: 'one', maxMemory: 2,
        worldBookIds: ['before2', 'before1', 'after', 'guidelines', 'limit'],
        memoryJournals: [{ id: 'favorite', title: '约定', content: '收藏的记忆', isFavorited: true }],
        history: [{ id: 'old', role: 'user', content: '超出范围', timestamp: 1 },
            { id: 'recent', role: 'assistant', content: '最近的对话', timestamp: 2 },
            { id: 'new', role: 'user', content: '最新的对话', timestamp: 3 }] };
    class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-14T06:00:00Z'])); } }
    const c = vm.createContext({ Date: FixedDate, AbortController, Response, TextDecoder, structuredClone, setTimeout, clearTimeout,
        console: { log() {}, error() {}, warn() {} }, document: { addEventListener() {} },
        db: { characters: [chat], groups: [], worldBooks: [
            { id: 'before1', position: 'before', depth: 2, content: 'BEFORE_2' },
            { id: 'before2', position: 'before', depth: 1, content: 'BEFORE_1' },
            { id: 'after', position: 'after', content: 'AFTER' },
            { id: 'guidelines', position: 'guidelines', content: 'GUIDELINES' },
            { id: 'limit', position: 'limit_break', content: 'LIMIT' }],
            apiSettings: { url: 'https://fixture.invalid', key: 'fixture-key', model: 'fixture', provider, streamEnabled: stream },
            cotSettings: { promptVersion: version, callEnabled: cot !== 'off', callPrefillEnabled: cot === 'prefill', activeCallPresetId: 'call' },
            cotPresets: [{ id: 'call', items: [{ enabled: true, content: '通话思考规则' }, { enabled: false, content: 'DISABLED_RULE' }] }] },
        pad: value => String(value).padStart(2, '0'), getRandomValue: value => value,
        resolveAuxiliaryApiConfig: (_kind, config) => config,
        filterHistoryForAI: (_chat, history) => history.filter(item => !item.isThinking && !item.isContextDisabled),
        showToast() {}, fetch: async (url, init) => {
            const body = JSON.parse(init.body); requests.push({ url, headers: init.headers, body });
            const reply = '[测试角色的声音：测试回复]';
            const data = provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: reply }] } }] } : { choices: [{ message: { content: reply } }] };
            if (!body.stream) return new Response(JSON.stringify(data));
            return new Response(provider === 'gemini' ? JSON.stringify([data]) :
                'data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\ndata: [DONE]\n\n');
        } });
    c.window = c;
    if (root === current) for (const file of ['auto_memory.js', 'worldbook_rules.js'])
        vm.runInContext(fs.readFileSync(path.join(root, 'js/modules', file), 'utf8'), c);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/chat_ai_call.js'), 'utf8'), c);
    return { c, chat, requests, updates };
}
test('48 disabled-feature call combinations retain 1900 request bodies, summaries and reply ordering', { skip: !available }, async () => {
    let comparisons = 0;
    for (const provider of ['newapi', 'gemini']) for (const version of ['uwu', 'tt'])
        for (const type of ['voice', 'video']) for (const stream of [false, true]) for (const cot of ['off', 'prefill', 'no-prefill']) {
            const old = fixture(baseline, provider, version, stream, cot), next = fixture(current, provider, version, stream, cot);
            const context = [{ role: 'user', type: 'voice', content: '你好' }, { role: 'ai', type: 'voice', content: '你好呀' },
                { role: 'user', type: 'visual', content: '挥手' }, { role: 'user', type: 'voice', content: '听见了吗' }];
            for (const f of [old, next]) {
                await f.c.getCallReply(f.chat, type, context, text => f.updates.push(text));
                await f.c.generateCallSummary(f.chat, context);
            }
            const label = [provider, version, type, stream, cot].join('/');
            assert.equal(old.requests.length, 2, label); assert.equal(next.requests.length, 2, label);
            assert.deepEqual(JSON.parse(JSON.stringify(next.requests)), JSON.parse(JSON.stringify(old.requests)), label);
            assert.deepEqual(next.updates, old.updates, label);
            assert.doesNotMatch(JSON.stringify(next.requests), /DISABLED_RULE|超出范围/);
            comparisons++;
        }
    assert.equal(comparisons, 48);
});
