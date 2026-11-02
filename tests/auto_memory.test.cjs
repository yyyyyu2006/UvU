const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(count = 12, settings = {}) {
    const chat = { id: 'alice', activeArchiveId: 'a1', realName: '晴', remarkName: '晴', myName: '我',
        persona: '人物', maxMemory: 100, history: Array.from({ length: count }, (_, i) => ({
            id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `原楼层${i}`, timestamp: 1700000000000 + i * 1000
        })), memoryJournals: [], autoMemorySettings: { enabled: true, keepRecent: 2, threshold: 4, batchSize: 4,
            mergeThreshold: 2, mergeBatchSize: 2, ...settings } };
    const requests = [], saves = [];
    const context = vm.createContext({ window: {}, document: { addEventListener() {}, getElementById() { return null; } },
        console, setTimeout, clearTimeout, AbortController,
        db: { characters: [chat], groups: [], worldBooks: [], apiSettings: {
            provider: 'newapi', url: 'https://primary.test/v1', key: 'fake-test-key', model: 'model' } },
        saveData: async () => { saves.push(JSON.parse(JSON.stringify(chat))); },
    });
    for (const file of ['utils.js', 'modules/journal.js', 'modules/auto_memory.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
    }
    context.fetchAiResponse = async (config, body, headers, endpoint, stream, options) => {
        requests.push({ config, body, headers, endpoint, options });
        return '<title>约定</title><content>我们约定下周一起看电影。</content>';
    };
    return { context, chat, requests, saves, run: options => context.runAutoMemory('alice', 'private', options) };
}
const ids = items => Array.from(items, item => item.id);

test('threshold counts eligible old floors after preserving recent floors, skips special messages', () => {
    const { context: c, chat } = fixture(6);
    assert.deepEqual(ids(c.getAutoMemoryPlan(chat).batch), ['m0', 'm1', 'm2', 'm3']);
    chat.history[0].isThinking = true;
    assert.equal(c.getAutoMemoryPlan(chat).batch.length, 0);
    assert.deepEqual(ids(c.getAutoMemoryPlan(chat, true).batch), ['m1', 'm2', 'm3']);
    chat.history[1].isWithdrawn = true;
    chat.history[2].isContextDisabled = true;
    chat.history[3].role = 'system';
    assert.equal(c.getAutoMemoryPlan(chat, true).batch.length, 0);
});

test('batch can be smaller or larger than threshold; it never consumes recent floors', () => {
    const { context: c, chat } = fixture(8, { threshold: 3, batchSize: 20, keepRecent: 3 });
    assert.deepEqual(ids(c.getAutoMemoryPlan(chat).batch), ['m0', 'm1', 'm2', 'm3', 'm4']);
    chat.autoMemorySettings.batchSize = 2;
    assert.deepEqual(ids(c.getAutoMemoryPlan(chat).batch), ['m0', 'm1']);
});

test('default is off and disabled automation makes no paid API request', async () => {
    const f = fixture(); delete f.chat.autoMemorySettings;
    assert.equal(f.context.getAutoMemorySettings(f.chat).enabled, false);
    await f.run(); assert.equal(f.requests.length, 0);
});

test('small summary commits before covering originals; context includes memory without a favorite', async () => {
    const f = fixture();
    const coveredDuringSave = [];
    f.context.saveData = async () => coveredDuringSave.push(f.context.getAutoMemoryState(f.chat).covered.size);
    const result = await f.run();
    assert.equal(result.count, 1);
    assert.deepEqual(coveredDuringSave, [0, 0]);
    assert.equal(f.chat.history.length, 12);
    assert.deepEqual([...f.context.getAutoMemoryState(f.chat).covered], ['m0', 'm1', 'm2', 'm3']);
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 1);
    assert.deepEqual(ids(f.context.getAutoMemoryContextHistory(f.chat)), ['m4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11']);
});

test('big summary replaces children, and deleting it restores children without duplicate injection', async () => {
    const f = fixture();
    await f.run(); await f.run();
    assert.equal(f.requests.length, 3);
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 1);
    const parent = f.context.getAutoMemoryState(f.chat).active[0];
    assert.equal(parent.autoMemory.kind, 'merged');
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 8);
    f.chat.memoryJournals[0].isFavorited = true;
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 1);
    f.chat.memoryJournals = f.chat.memoryJournals.filter(j => j.id !== parent.id);
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 2);
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 8);
    f.chat.memoryJournals.shift();
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 4);
});

test('recursive big summaries preserve provenance across reload and recover from source editing', async () => {
    const f = fixture(20);
    await f.run(); await f.run(); await f.run();
    const snapshot = JSON.parse(JSON.stringify(f.chat));
    const second = fixture();
    Object.assign(second.chat, snapshot);
    assert.equal(second.context.getAutoMemoryState(second.chat).covered.size, 12);
    assert.equal(second.context.getContextMemoryJournals(second.chat).length, 1);
    second.chat.history[0].content = '已修正的事件';
    assert.equal(second.context.getAutoMemoryState(second.chat).covered.has('m0'), false);
    assert.equal(second.context.getAutoMemoryState(second.chat).covered.size, 8);
    assert.equal(second.context.getContextMemoryJournals(second.chat).length, 2);
});

test('pausing injection restores raw context and prevents summary calls, manual favorites remain', async () => {
    const f = fixture(); await f.run();
    f.chat.memoryJournals.push({ id: 'manual', title: '收藏日记', content: '共同回忆', isFavorited: true });
    f.chat.autoMemorySettings.useMemory = false;
    assert.equal(f.context.getAutoMemoryContextHistory(f.chat).length, 12);
    assert.deepEqual(ids(f.context.getContextMemoryJournals(f.chat)), ['manual']);
    await f.run({ force: true });
    assert.equal(f.requests.length, 1);
});

test('disabling automatic generation still keeps existing memories in context', async () => {
    const f = fixture(); await f.run(); f.chat.autoMemorySettings.enabled = false;
    await f.run();
    assert.equal(f.requests.length, 1);
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 1);
});

test('default summary and merge reuse original prompt builders; custom rules replace them', () => {
    const { context: c, chat } = fixture();
    const settings = c.getAutoMemorySettings(chat);
    const messages = c.buildAutoMemoryPrompt(chat, 'private', chat.history.slice(0, 2), 'summary', settings);
    assert.ok(messages[0].content.includes(c.buildJournalSummaryPrompt(chat, 'private', chat.history.slice(0, 2))));
    assert.match(messages[0].content, /800 字/);
    const custom = c.buildAutoMemoryPrompt(chat, 'private', chat.history.slice(0, 2), 'summary', { ...settings,
        summaryPrompt: '只写 JSON，保留关系变化', requirements: '不能遗漏承诺' });
    assert.match(custom[0].content, /只写 JSON/);
    assert.match(custom[0].content, /不能遗漏承诺/);
    assert.doesNotMatch(custom[0].content, /第一人称视角/);
    assert.match(custom[1].content, /原楼层0/);
    const merge = c.buildAutoMemoryPrompt(chat, 'private', [{ title: 'A', content: '事实', range: { start: 1, end: 4 } }], 'merged', settings);
    assert.match(merge[0].content, /专业的档案记录员/);
    assert.match(merge[0].content, /1500 字/);
});

test('API source routing supports primary, secondary, follow and rejects incomplete secondary', () => {
    const { context: c } = fixture();
    c.db.apiSettings.secondary = { enabled: true, url: 'https://secondary.test', key: 'fake-secondary', model: 'other', provider: 'gemini', routes: { journal: true } };
    assert.equal(c.resolveAutoMemoryApi({ apiSource: 'follow' }).provider, 'gemini');
    assert.equal(c.resolveAutoMemoryApi({ apiSource: 'primary' }).url, 'https://primary.test/v1');
    assert.equal(c.resolveAutoMemoryApi({ apiSource: 'secondary' }).model, 'other');
    delete c.db.apiSettings.secondary.key;
    assert.throws(() => c.resolveAutoMemoryApi({ apiSource: 'secondary' }), /尚未配置完整/);
    assert.throws(() => c.resolveAutoMemoryApi({ apiSource: 'follow' }), /尚未配置完整/);
    c.db.apiSettings.secondary.enabled = false;
    assert.throws(() => c.resolveAutoMemoryApi({ apiSource: 'secondary' }), /启用并配置/);
});

test('Gemini and OpenAI requests both carry instructions and an abort signal', async () => {
    for (const provider of ['newapi', 'gemini']) {
        const f = fixture(); f.context.db.apiSettings.provider = provider; await f.run();
        const req = f.requests[0];
        assert.ok(req.options.signal);
        if (provider === 'gemini') { assert.ok(req.body.system_instruction); assert.ok(req.body.contents.length); assert.match(req.endpoint, /generateContent/); }
        else { assert.equal(req.body.messages[0].role, 'system'); assert.ok(req.endpoint.endsWith('/v1/chat/completions')); }
    }
});

test('empty, malformed, incomplete or reasoning-only output never hides originals', async () => {
    for (const response of ['', '随便一段文本', '<title>标题</title><content>未闭合', '<title>X</title><content></content>',
        '<thinking>分析</thinking>', '<title>X</title><content>内容为空。</content>']) {
        const f = fixture(); f.context.fetchAiResponse = async () => response;
        assert.ok((await f.run()).error);
        assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 0);
        assert.equal(f.chat.memoryJournals.length, 0);
    }
});

test('custom plain output is preserved and is not truncated to the word target', async () => {
    const f = fixture(12, { summaryPrompt: '按我的格式写', targetLength: 50 });
    const output = '保留完整事实。'.repeat(100);
    f.context.fetchAiResponse = async () => output; await f.run();
    assert.equal(f.chat.memoryJournals[0].content, output);
});

test('API failures enter cooldown; manual retry can recover', async () => {
    const f = fixture(); let calls = 0;
    f.context.fetchAiResponse = async () => { calls++; throw new Error('API Error: 500 secret-response'); };
    const result = await f.run();
    assert.doesNotMatch(result.error, /secret-response/);
    assert.equal((await f.run()).coolingDown, true);
    assert.equal(calls, 1);
    f.context.fetchAiResponse = async () => '<title>A</title><content>已恢复</content>';
    assert.equal((await f.run({ force: true })).count, 1);
});

test('save failure in either commit phase rolls back coverage and does not lose source messages', async () => {
    for (const failAt of [1, 2]) {
        const f = fixture(); let writes = 0;
        f.context.saveData = async () => { if (++writes === failAt) throw new Error('存储失败'); };
        assert.ok((await f.run()).error);
        assert.equal(f.chat.memoryJournals.length, 0);
        assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 0);
        assert.equal(f.chat.history.length, 12);
    }
});

test('concurrent automatic checks share one request rather than duplicate API billing', async () => {
    const f = fixture(); let finish, calls = 0;
    f.context.fetchAiResponse = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const first = f.run(); const second = f.run();
    assert.equal(calls, 1); finish('<title>A</title><content>事实</content>');
    assert.equal((await first).count, 1); assert.equal((await second).count, 1);
    assert.equal(f.chat.memoryJournals.length, 1);
});

test('archive switching, settings change and source editing during requests discard stale results', async () => {
    for (const mutate of [f => { f.chat.activeArchiveId = 'a2'; f.chat.history = []; f.chat.memoryJournals = []; },
        f => { f.chat.history[0].content = 'edited'; }, f => { f.chat.autoMemorySettings.keepRecent = 50; }]) {
        const f = fixture(); let finish;
        f.context.fetchAiResponse = () => new Promise(resolve => { finish = resolve; });
        const task = f.run(); mutate(f); finish('<title>A</title><content>事实</content>');
        assert.ok((await task).error); assert.equal(f.chat.memoryJournals.length, 0);
    }
});

test('switching archive while a commit is pending removes draft from the original archive only', async () => {
    const f = fixture();
    f.chat.archives = [{ id: 'a1', data: { memoryJournals: [] } }, { id: 'a2', data: {} }];
    f.context.saveData = async () => {
        if (f.chat.activeArchiveId !== 'a1') return;
        f.chat.archives[0].data.memoryJournals = JSON.parse(JSON.stringify(f.chat.memoryJournals));
        f.chat.activeArchiveId = 'a2'; f.chat.memoryJournals = []; f.chat.history = [];
    };
    assert.ok((await f.run()).error);
    assert.equal(f.chat.archives[0].data.memoryJournals.length, 0);
    assert.equal(f.chat.memoryJournals.length, 0);
});

test('manual runs respect recent retention, and each check has at most two API calls', async () => {
    const f = fixture(200, { enabled: false, threshold: 1000 });
    assert.equal((await f.run()).count, 0);
    assert.equal((await f.run({ force: true })).count, 1);
    assert.equal((await f.run({ force: true })).count, 2);
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.has('m199'), false);
    assert.equal(f.requests.length, 3);
});
