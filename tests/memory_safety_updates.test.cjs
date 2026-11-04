const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../js', file), 'utf8');
function fixture() {
    const chat = { id: 'c', activeArchiveId: 'a', history: [], memoryJournals: [], persona: '角色设定', myPersona: '用户设定',
        autoMemorySettings: { vectorSearchEnabled: true, vectorThreshold: 0 } };
    const c = vm.createContext({ window: {}, console, setTimeout, clearTimeout, AbortController,
        document: { addEventListener() {}, getElementById() { return null; } },
        db: { characters: [chat], groups: [], cotSettings: { enabled: true }, cotPresets: [{ id: 'default', items: [{ enabled: true, content: 'CHAT_COT' }] }],
            vectorMemoryApiSettings: { provider: 'newapi', url: 'https://test.invalid', key: 'test', embeddingModel: 'embed' } },
        getRandomValue: value => value, saveData: async () => {}, buildWorldBookPlan: () => [],
        generatePrivateSystemPrompt: () => 'BASE', filterHistoryForAI: (_chat, history) => history });
    for (const file of ['modules/auto_memory.js', 'modules/chat_ai_prompt.js']) vm.runInContext(read(file), c);
    return { c, chat };
}

test('final-request token classification is read-only and does not double-count embedded T.T history or vector replacement', () => {
    const { c, chat } = fixture();
    chat.memoryJournals = [{ id: 'old', title: '旧总结', content: 'NOT_IN_REQUEST', isFavorited: true }];
    const body = { messages: [{ role: 'system', content: 'BASE\n角色设定\n用户设定\nWB\nVECTOR\n<chat_history>剧情</chat_history>' },
        { role: 'user', content: '最新消息' }, { role: 'system', content: 'CHAT_COT' }] };
    const before = JSON.stringify(body);
    const result = c.estimateChatTokenUsage(chat, 'private', body.messages[0].content, [], 'VECTOR', [{ id: 'w', content: 'WB' }], body);
    assert.equal(JSON.stringify(body), before);
    assert.ok(result.baseSystem > 0); assert.ok(result.cot > 0);
    assert.ok(result.history > 0); assert.equal(result.memory, 0); assert.ok(result.vectorMemory > 0);
    assert.equal(result.floorCount, 0);
    assert.equal(result.promptTokens, ['baseSystem', 'cot', 'charPersona', 'userPersona', 'memory', 'vectorMemory', 'history', 'worldBook'].reduce((sum, key) => sum + result[key], 0));
});

test('partial API usage never labels missing input or reasoning as actual zero', () => {
    const { c, chat } = fixture();
    const estimate = { promptTokens: 100, completionTokens: 0, floorCount: 0 };
    const result = c.recordChatTokenUsage(chat, 'private', { total_tokens: 123 }, estimate);
    assert.equal(result.totalTokens, 123); assert.equal(result.totalActual, true);
    assert.equal(result.promptActual, false); assert.equal(result.completionActual, false); assert.equal(result.reasoningActual, false);
    assert.equal(c.normalizeChatTokenUsage({ prompt_tokens: null }), null);
    assert.equal(c.normalizeChatTokenUsage({ prompt_tokens: -1 }), null);
});

test('independent vector settings do not borrow summary API credentials; legacy route remains available', () => {
    const { c } = fixture();
    c.db.memoryApiSettings = { url: 'https://summary.invalid', key: 'summary', embeddingModel: 'old' };
    c.db.vectorMemoryApiSettings = { url: 'https://vector.invalid', embeddingModel: 'new' };
    assert.equal(c.resolveVectorMemoryApi().key, undefined);
    c.db.vectorMemoryApiSettings = {};
    assert.equal(c.resolveVectorMemoryApi().key, 'summary');
});

test('failed vector commit repairs deep-cloned original archive without changing a newly active branch', async () => {
    for (const switchArchive of [false, true]) {
        const { c, chat } = fixture();
        chat.memoryJournals = [{ id: 'note', title: '旧事', content: '剧情' }];
        chat.archives = [{ id: 'a', data: { history: [], memoryVectorIndex: {} } }]; chat.memoryVectorIndex = {};
        c.fetch = async () => ({ ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) });
        const newBranchIndex = { other: { version: 2, chunks: [] } };
        c.saveData = async () => {
            chat.archives[0].data.memoryVectorIndex = structuredClone(chat.memoryVectorIndex);
            if (switchArchive) { chat.activeArchiveId = 'b'; chat.history = []; chat.memoryJournals = []; chat.memoryVectorIndex = newBranchIndex; }
            throw new Error('quota');
        };
        await assert.rejects(c.getVectorMemoryContext(chat, '旧事'), /quota/);
        assert.deepEqual(Object.keys(chat.archives[0].data.memoryVectorIndex), []);
        if (switchArchive) assert.equal(chat.memoryVectorIndex, newBranchIndex);
        else assert.deepEqual(Object.keys(chat.memoryVectorIndex), []);
    }
});

test('worker cosine scores match the original exact algorithm and worker failure falls back', async () => {
    const { c } = fixture();
    const workerSource = read('modules/vector_search_worker.js');
    let workers = 0;
    c.Worker = class {
        constructor() { workers++; }
        postMessage(data) {
            const self = { postMessage: result => this.onmessage({ data: result }) };
            vm.runInNewContext(workerSource, { self }); self.onmessage({ data });
        }
        terminate() {}
    };
    const query = [0.3, 0.8];
    const rows = Array.from({ length: 300 }, (_, index) => ({ embedding: [Math.cos(index), Math.sin(index)] }));
    const expected = rows.map(row => c.autoMemoryCosine(query, row.embedding));
    const scores = await c.scoreVectorMemoryChunks(query, rows, () => {});
    assert.equal(workers, 1);
    scores.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
    c.Worker = class { constructor() { throw new Error('unavailable'); } };
    const fallback = await c.scoreVectorMemoryChunks(query, rows, () => {});
    assert.deepEqual(Array.from(fallback), expected);
});

test('runtime entry does not include legacy settings module', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)/g)].map(match => match[1].split('?')[0]);
    assert.equal(scripts.includes('js/settings.js'), false);
    for (const name of ['customize', 'api', 'chat', 'presets']) assert.equal(scripts.filter(file => file === `js/modules/settings_${name}.js`).length, 1);
});
