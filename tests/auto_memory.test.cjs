const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(count = 12, settings = {}) {
    const chat = { id: 'alice', activeArchiveId: 'a1', realName: '晴', remarkName: '晴', myName: '我',
        persona: '人物', maxMemory: 100, history: Array.from({ length: count }, (_, i) => ({
            id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `原楼层${i}`, timestamp: 1700000000000 + i * 1000
        })), memoryJournals: [], autoMemorySettings: { enabled: true, useMemory: true, contextInjectionOptIn: true, keepRecent: 2, threshold: 4, batchSize: 4,
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

test('manual favorites survive dormant replacement markers unless the replacement is injected', () => {
    const { context: c, chat } = fixture(2, { enabled: false, useMemory: false, vectorSearchEnabled: false });
    const source = { id: 'source', content: '手动收藏', isFavorited: true, vectorSupersededBy: 'replacement' };
    const replacement = { id: 'replacement', content: '整理结果', isFavorited: false };
    chat.memoryJournals = [source, replacement];
    assert.deepEqual(ids(c.getContextMemoryJournals(chat)), ['source']);
    assert.equal(c.getMemoryUsageExplanation(chat, source).status, '收藏引用');
    chat.autoMemorySettings.vectorSearchEnabled = true;
    assert.deepEqual(ids(c.getContextMemoryJournals(chat)), ['source'], 'enabling retrieval alone does not prove a hit');
    replacement.isFavorited = true;
    assert.deepEqual(ids(c.getContextMemoryJournals(chat)), ['replacement']);
    replacement.memorySourceTarget = { chatId: 'other', archiveId: 'a1' };
    assert.deepEqual(ids(c.getContextMemoryJournals(chat)), ['source'], 'unauthorized replacement cannot hide a manual favorite');
    source.memorySourceTarget = { chatId: 'other', archiveId: 'a1' };
    assert.deepEqual(ids(c.getContextMemoryJournals(chat)), [], 'fallback still checks source permissions');
});

test('a vector-selected replacement hides a manual favorite only within the actual prompt build', async()=>{
    const {context:c,chat}=fixture(0,{enabled:false,useMemory:false,vectorSearchEnabled:true,vectorThreshold:0});
    chat.memoryJournals=[{id:'source',content:'原收藏正文',isFavorited:true,vectorSupersededBy:'replacement'},
        {id:'replacement',title:'整理',content:'整理后的事实',isFavorited:false}];
    c.db.vectorMemoryApiSettings={provider:'newapi',url:'https://vectors.test/v1',key:'test',embeddingModel:'embed'};
    c.fetch=async()=>({ok:true,json:async()=>({data:[{embedding:[1,0]}]})});
    const retrieved=await c.getVectorMemoryContext(chat,'话题');assert.match(retrieved,/整理后的事实/);
    const prompt=c.buildPromptWithVectorMemory(chat,()=>{assert.deepEqual(ids(c.getContextMemoryJournals(chat)),[]);return 'base';},retrieved);
    assert.doesNotMatch(prompt,/原收藏正文/);assert.deepEqual(ids(c.getContextMemoryJournals(chat)),['source']);
});

test('default and custom memory inputs include quoted facts without changing original messages', () => {
    const f = fixture(1); f.chat.history[0].content = '[我的消息：就按这个地址办]';
    f.chat.history[0].quote = { senderName: '晴', content: '地址是星河路77号', messageId: 'outside-batch' };
    const before = JSON.stringify(f.chat.history);
    for (const summaryPrompt of ['', '提取事实']) {
        const settings = { ...f.context.getAutoMemorySettings(f.chat), summaryPrompt };
        const prompt = f.context.buildAutoMemoryPrompt(f.chat, 'private', f.chat.history, 'summary', settings);
        assert.match(JSON.stringify(prompt), /星河路77号/);
        assert.match(JSON.stringify(prompt), /就按这个地址办/);
    }
    assert.equal(JSON.stringify(f.chat.history), before);
});

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

test('empty, hidden and thinking-only records are not counted as floors; media messages remain eligible', () => {
    const { context: c } = fixture(1);
    assert.equal(c.isAutoMemoryFloor({ id: 'empty', role: 'user', content: '  ' }), false);
    assert.equal(c.isAutoMemoryFloor({ id: 'hidden', role: 'assistant', content: 'text', isHidden: true }), false);
    assert.equal(c.isAutoMemoryFloor({ id: 'thinking', role: 'assistant', content: '<thinking>reasoning</thinking>' }), false);
    assert.equal(c.isAutoMemoryFloor({ id: 'image', role: 'user', content: '', parts: [{ type: 'image', data: 'data:image/png;base64,AA==' }] }), true);
});

test('coverage status counts eligible floors and reports the first uncovered record even with gaps', () => {
    const { context: c, chat } = fixture(7, { keepRecent: 2 });
    chat.history[1].isContextDisabled = true;
    chat.history[4].parts = [{ type: 'image', url: 'data:image/png;base64,AA==' }];
    const stats = c.getAutoMemoryCoverageStats(chat, { covered: new Set(['m0', 'm3', 'm6']) });
    assert.equal(stats.total, 6);
    assert.equal(stats.excluded, 1);
    assert.equal(stats.covered, 3);
    assert.deepEqual(ids(stats.uncovered.map(item => item.message)), ['m2', 'm4', 'm5']);
    assert.equal(stats.next.floor, 3);
    assert.equal(stats.retained, 2);
    assert.equal(stats.available, 2);
});

test('vector memory is opt-in and caches embeddings while ranking relevant journals', async () => {
    const f = fixture(1, { vectorSearchEnabled: false });
    const journal = { id: 'favorite', title: '约定', content: '两人约定下周一起看电影。', isFavorited: true };
    f.chat.memoryJournals.push(journal);
    f.context.db.memoryApiSettings = { provider: 'newapi', url: 'https://memory.test/v1', key: 'test-key', embeddingModel: 'embed-model' };
    const inputs = [];
    f.context.fetch = async (_url, request) => {
        const input = JSON.parse(request.body).input; inputs.push(input);
        return { ok: true, json: async () => ({ data: [{ embedding: input.includes('当前话题') ? [1, 0] : [0.8, 0.6] }] }) };
    };
    assert.equal(await f.context.getVectorMemoryContext(f.chat, '当前话题'), '');
    assert.equal(inputs.length, 0);
    f.chat.autoMemorySettings.vectorSearchEnabled = true;
    f.chat.autoMemorySettings.vectorThreshold = 0.7;
    const context = await f.context.getVectorMemoryContext(f.chat, '当前话题');
    assert.match(context, /约定下周一起看电影/);
    assert.equal(inputs.length, 2);
    await f.context.getVectorMemoryContext(f.chat, '当前话题');
    assert.equal(inputs.length, 3);
});

test('vector history library filters reasoning, status blocks and excluded context while preserving source messages', () => {
    const f = fixture(4, { vectorSearchEnabled: true, keepRecent: 1 });
    f.chat.statusPanel = { enabled: true, regexPattern: '<status>[\\s\\S]*?<\\/status>' };
    f.chat.history[0].content = '旧剧情 <thinking>私有推理</thinking><status>状态栏</status>';
    f.chat.history[1].content = '第二段剧情';
    f.chat.history[2].isThinking = true;
    f.chat.history[3].content = '最近一条';
    f.chat.memoryJournals.push({ id: 'old', title: '旧', content: '已合并旧记忆', isFavorited: true, vectorSupersededBy: 'manual_1' });
    const before = JSON.stringify(f.chat.history);
    const entries = f.context.getVectorMemoryCandidates(f.chat);
    assert.equal(entries.length, 1);
    assert.match(entries[0].content, /旧剧情/);
    assert.match(entries[0].content, /第二段剧情/);
    assert.doesNotMatch(entries[0].content, /私有推理|状态栏|最近一条/);
    assert.equal(JSON.stringify(f.chat.history), before);
});

test('successful vector retrieval preserves explicitly favorited legacy memories', () => {
    const f = fixture(1);
    f.chat.memoryJournals.push({ id: 'favorite', title: '旧事', content: '整篇旧记忆', isFavorited: true });
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 1);
    const prompt = f.context.buildPromptWithVectorMemory(f.chat,
        () => `base:${f.context.getContextMemoryJournals(f.chat).length}`, '\n向量片段');
    assert.equal(prompt, 'base:1\n向量片段');
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 1);
});

test('retrieved favorite is injected once and its token context is deduplicated', async () => {
    const f=fixture(1,{vectorSearchEnabled:true,vectorThreshold:0});
    f.chat.memoryJournals.push({id:'fixed',title:'固定往事',content:'固定往事正文',isFavorited:true});
    f.context.db.vectorMemoryApiSettings={provider:'newapi',url:'https://vectors.test/v1',key:'test',embeddingModel:'embed'};
    f.context.fetch=async()=>({ok:true,json:async()=>({data:[{embedding:[1,0]}]})});
    const retrieved=await f.context.getVectorMemoryContext(f.chat,'话题');
    const final=f.context.buildPromptWithVectorMemory(f.chat,()=>f.context.getContextMemoryJournals(f.chat).map(j=>j.content).join('\n'),retrieved);
    assert.equal(final,'固定往事正文');
    assert.equal(f.context.getInjectedVectorMemoryContext(f.chat,retrieved),'');
});

test('vector results rank distinct memory entries before applying Top K', async () => {
    const f = fixture(1, { vectorSearchEnabled: true, vectorTopK: 2, vectorThreshold: 0 });
    f.chat.memoryJournals.push({ id: 'one', title: '同一长记忆', content: '事件甲。'.repeat(2000), isFavorited: true },
        { id: 'two', title: '另一篇记忆', content: '事件乙。', isFavorited: true });
    f.context.db.vectorMemoryApiSettings = { provider: 'newapi', url: 'https://vectors.test/v1', key: 'test-key', embeddingModel: 'embed-model' };
    f.context.fetch = async (_url, request) => {
        const input = JSON.parse(request.body).input;
        const isOther = String(input).includes('事件乙');
        return { ok: true, json: async () => ({ data: [{ embedding: isOther ? [0.9, 0.1] : [1, 0] }] }) };
    };
    const result = await f.context.getVectorMemoryContext(f.chat, '当前话题');
    assert.match(result, /同一长记忆/);
    assert.match(result, /另一篇记忆/);
});

test('vector indexing rejects stale archive results and leaves the new archive index untouched', async () => {
    const f = fixture(1, { vectorSearchEnabled: true, vectorThreshold: 0 });
    f.chat.memoryJournals.push({ id: 'note', title: '记忆', content: '相关剧情', isFavorited: true });
    f.context.db.vectorMemoryApiSettings = { provider: 'newapi', url: 'https://vectors.test/v1', key: 'test-key', embeddingModel: 'embed-model' };
    let finish, started;
    const ready = new Promise(resolve => started = resolve);
    f.context.fetch = async () => { started(); return new Promise(resolve => finish = resolve); };
    const pending = f.context.getVectorMemoryContext(f.chat, '当前话题');
    await ready;
    f.chat.activeArchiveId = 'a2';
    finish({ ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) });
    await assert.rejects(pending, /存档|变化|取消/);
    assert.equal(f.chat.memoryVectorIndex, undefined);
    assert.equal(f.saves.length, 0);
});

test('long memories index and retrieve tail chunks, reuse chunk cache, and inject excerpts only', async () => {
    const f = fixture(1, { vectorSearchEnabled: true, vectorTopK: 1, vectorThreshold: 0.5 });
    const opening = `最早标记：${'早期无关记录。'.repeat(900)}`;
    const journal = { id: 'long-note', title: '长总结', content: `${opening}尾部约定：月桂街 88 号。`, isFavorited: true };
    f.chat.memoryJournals.push(journal);
    f.context.db.vectorMemoryApiSettings = { provider: 'newapi', url: 'https://vectors.test/v1', key: 'test-key', embeddingModel: 'embed-model' };
    const inputs = [];
    f.context.fetch = async (_url, request) => {
        const input = JSON.parse(request.body).input;
        inputs.push(input);
        const relevant = input.includes('当前话题') || input.includes('月桂街');
        return { ok: true, json: async () => ({ data: [{ embedding: relevant ? [1, 0] : [0, 1] }] }) };
    };

    const result = await f.context.getVectorMemoryContext(f.chat, '当前话题：住址');
    assert.match(result, /月桂街 88 号/);
    assert.doesNotMatch(result, /最早标记/);
    assert.ok(inputs.some(input => input.includes('月桂街 88 号')));
    const indexed = f.chat.memoryVectorIndex['long-note'];
    assert.equal(indexed.version, 2);
    assert.ok(indexed.chunks.length > 1);
    const initialCalls = inputs.length;

    await f.context.getVectorMemoryContext(f.chat, '当前话题：住址');
    assert.equal(inputs.length, initialCalls + 1, 'only the query should be embedded on a cache hit');
});

test('partial chunk indexing survives an embedding API failure without re-embedding completed chunks', async () => {
    const f = fixture(1, { vectorSearchEnabled: true, vectorThreshold: 0 });
    f.chat.memoryJournals.push({ id: 'partial-note', title: '长记忆', content: '连续事件。'.repeat(500), isFavorited: true });
    f.context.db.vectorMemoryApiSettings = { provider: 'newapi', url: 'https://vectors.test/v1', key: 'test-key', embeddingModel: 'embed-model' };
    const firstPass = [];
    f.context.fetch = async (_url, request) => {
        const input = JSON.parse(request.body).input;
        firstPass.push(input);
        if (firstPass.length === 3) throw new Error('temporary embedding failure');
        return { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) };
    };
    await assert.rejects(f.context.getVectorMemoryContext(f.chat, '当前话题'), /temporary embedding failure/);
    const cached = f.chat.memoryVectorIndex['partial-note'].chunks;
    assert.ok(cached.length > 0);
    const firstCompletedText = firstPass[1].slice('长记忆\n'.length);

    const retryInputs = [];
    f.context.fetch = async (_url, request) => {
        retryInputs.push(JSON.parse(request.body).input);
        return { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) };
    };
    await f.context.getVectorMemoryContext(f.chat, '当前话题');
    assert.ok(!retryInputs.includes(`长记忆\n${firstCompletedText}`));
});

test('optional memory API reranker can reorder cosine-ranked summaries', async () => {
    const f = fixture(1, { vectorSearchEnabled: true, vectorRerankEnabled: true, vectorTopK: 1, vectorThreshold: 0 });
    f.chat.memoryJournals.push(
        { id: 'first', title: '旧事一', content: '两人讨论过电影。', isFavorited: true },
        { id: 'second', title: '旧事二', content: '两人约定周末见面。', isFavorited: true }
    );
    f.context.db.memoryApiSettings = { provider: 'newapi', url: 'https://memory.test/v1', key: 'test-key', model: 'reranker', embeddingModel: 'embed-model' };
    f.context.fetch = async (_url, request) => {
        const input = JSON.parse(request.body).input;
        if (Array.isArray(input)) return { ok: true, json: async () => ({ data: input.map(() => ({ embedding: [1, 0] })) }) };
        return { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) };
    };
    f.context.buildChatApiRequest = () => ({ requestBody: {}, headers: {}, endpoint: 'https://memory.test/v1/chat/completions' });
    f.context.fetchAiResponse = async () => '2, 1';
    const result = await f.context.getVectorMemoryContext(f.chat, '需要周末约定');
    assert.match(result, /旧事二/);
    assert.doesNotMatch(result, /旧事一/);
});

test('vector retrieval uses its own API endpoint and distinct embedding and rerank models', async () => {
    const f = fixture(1, { vectorSearchEnabled: true, vectorRerankEnabled: true, vectorTopK: 1, vectorThreshold: 0 });
    f.chat.memoryJournals.push(
        { id: 'first', title: '旧事一', content: '讨论电影。', isFavorited: true },
        { id: 'second', title: '旧事二', content: '周末见面。', isFavorited: true }
    );
    f.context.db.memoryApiSettings = { provider: 'newapi', url: 'https://summary.test/v1', key: 'summary-key', model: 'summary-model' };
    f.context.db.vectorMemoryApiSettings = { provider: 'newapi', url: 'https://vectors.test/v1', key: 'vector-key', embeddingModel: 'embed-v2', rerankModel: 'rank-v3' };
    const embeddingRequests = [];
    f.context.fetch = async (url, request) => {
        embeddingRequests.push({ url, request, body: JSON.parse(request.body) });
        const input = JSON.parse(request.body).input;
        return { ok: true, json: async () => ({ data: [{ embedding: Array.isArray(input) ? [1, 0] : [1, 0] }] }) };
    };
    f.context.buildChatApiRequest = config => {
        assert.equal(config.url, 'https://vectors.test/v1');
        assert.equal(config.key, 'vector-key');
        assert.equal(config.model, 'rank-v3');
        return { requestBody: {}, headers: {}, endpoint: 'https://vectors.test/v1/chat/completions' };
    };
    f.context.fetchAiResponse = async () => '2, 1';
    const result = await f.context.getVectorMemoryContext(f.chat, '当前话题');
    assert.equal(embeddingRequests.length, 3);
    assert.ok(embeddingRequests.every(item => item.url === 'https://vectors.test/v1/embeddings'));
    assert.ok(embeddingRequests.every(item => item.body.model === 'embed-v2'));
    assert.match(result, /旧事二/);
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

test('big summaries keep separate levels, persist and recover from source editing', async () => {
    const f = fixture(20);
    await f.run(); await f.run(); await f.run();
    const snapshot = JSON.parse(JSON.stringify(f.chat));
    const second = fixture();
    Object.assign(second.chat, snapshot);
    assert.equal(second.context.getAutoMemoryState(second.chat).covered.size, 12);
    assert.equal(second.context.getContextMemoryJournals(second.chat).length, 2);
    second.chat.history[0].content = '已修正的事件';
    assert.equal(second.context.getAutoMemoryState(second.chat).covered.has('m0'), false);
    assert.equal(second.context.getAutoMemoryState(second.chat).covered.size, 8);
    assert.equal(second.context.getContextMemoryJournals(second.chat).length, 2);
});

test('pausing injection restores raw context while automatic summaries continue, manual favorites remain', async () => {
    const f = fixture(); await f.run();
    f.chat.memoryJournals.push({ id: 'manual', title: '收藏日记', content: '共同回忆', isFavorited: true });
    f.chat.autoMemorySettings.useMemory = false;
    assert.equal(f.context.getAutoMemoryContextHistory(f.chat).length, 12);
    assert.deepEqual(ids(f.context.getContextMemoryJournals(f.chat)), ['manual']);
    await f.run({ force: true });
    assert.equal(f.requests.length, 3);
});

test('disabling automatic generation still keeps existing memories in context', async () => {
    const f = fixture(); await f.run(); f.chat.autoMemorySettings.enabled = false;
    await f.run();
    assert.equal(f.requests.length, 1);
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 1);
});

test('default summary and merge send original prompt builders unchanged; custom rules replace them', () => {
    const { context: c, chat } = fixture();
    const settings = c.getAutoMemorySettings(chat);
    const messages = c.buildAutoMemoryPrompt(chat, 'private', chat.history.slice(0, 2), 'summary', settings);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, c.buildJournalSummaryPrompt(chat, 'private', chat.history.slice(0, 2), false));
    const custom = c.buildAutoMemoryPrompt(chat, 'private', chat.history.slice(0, 2), 'summary', { ...settings,
        summaryPrompt: '只写 JSON，保留关系变化', requirements: '不能遗漏承诺' });
    assert.match(custom[0].content, /只写 JSON/);
    assert.match(custom[0].content, /不能遗漏承诺/);
    assert.doesNotMatch(custom[0].content, /第一人称视角/);
    assert.match(custom[1].content, /原楼层0/);
    const merge = c.buildAutoMemoryPrompt(chat, 'private', [{ title: 'A', content: '事实', range: { start: 1, end: 4 } }], 'merged', settings);
    assert.equal(merge.length, 1);
    assert.equal(merge[0].role, 'user');
    assert.equal(merge[0].content, c.buildJournalMergePrompt(chat, '楼层 1-4\n标题：A\n事实'));
});

test('automatic summaries stay outside context until memory injection is enabled', async () => {
    const f = fixture(6, { useMemory: false, keepRecent: 1, threshold: 4, batchSize: 4 });
    await f.run();
    assert.equal(f.requests.length, 1);
    assert.equal(f.context.getAutoMemoryContextHistory(f.chat).length, 6);
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 0);
    f.chat.autoMemorySettings.useMemory = true;
    assert.equal(f.context.getAutoMemoryContextHistory(f.chat).length, 2);
    assert.equal(f.context.getContextMemoryJournals(f.chat).length, 1);
});

test('legacy saved useMemory defaults do not opt into context replacement after upgrade', () => {
    const f = fixture(6);
    delete f.chat.autoMemorySettings.contextInjectionOptIn;
    assert.equal(f.context.getAutoMemorySettings(f.chat).useMemory, false);
    assert.equal(f.context.getAutoMemoryContextHistory(f.chat).length, 6);
    f.chat.autoMemorySettings.contextInjectionOptIn = true;
    assert.equal(f.context.getAutoMemorySettings(f.chat).useMemory, true);
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
        if (provider === 'gemini') { assert.ok(req.body.contents.length); assert.match(req.endpoint, /generateContent/); }
        else { assert.equal(req.body.messages[0].role, 'user'); assert.ok(req.endpoint.endsWith('/v1/chat/completions')); }
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

test('150 summarized floors resume at floor 151 after reload, without repeating originals', async () => {
    const f = fixture(320, { batchSize: 150, threshold: 150, keepRecent: 20, mergeThreshold: 6 });
    assert.equal((await f.run()).count, 1);
    assert.deepEqual(ids(f.context.getAutoMemoryPlan(f.chat).batch).slice(0, 2), ['m150', 'm151']);
    const reloaded = fixture(); Object.assign(reloaded.chat, JSON.parse(JSON.stringify(f.chat)));
    assert.equal((await reloaded.run()).count, 1);
    const request = JSON.stringify(reloaded.requests[0].body);
    assert.ok(request.includes('原楼层150'));
    assert.ok(!request.includes('原楼层149'));
    assert.equal(reloaded.context.getAutoMemoryState(reloaded.chat).covered.size, 300);
    assert.equal(reloaded.requests.length, 1);
    assert.equal((await reloaded.run()).count, 0);
});

test('manual run never bypasses six-summary merge threshold; existing big summary is not a small one', async () => {
    const f = fixture(30, { keepRecent: 0, batchSize: 1, threshold: 1, mergeThreshold: 6, mergeBatchSize: 6 });
    for (let i = 0; i < 5; i++) { assert.equal((await f.run({ force: true })).count, 1); }
    assert.equal(f.requests.length, 5);
    assert.equal((await f.run({ force: true })).count, 2);
    assert.equal(f.chat.memoryJournals.filter(j => j.autoMemory.kind === 'merged').length, 1);
    for (let i = 0; i < 5; i++) await f.run({ force: true });
    assert.equal(f.chat.memoryJournals.filter(j => j.autoMemory.kind === 'merged').length, 1);
    const plan = f.context.getAutoMemoryPlan(f.chat, true);
    assert.equal(plan.state.active.length, 6);
    assert.equal(plan.merge.length, 0);
    await f.run({ force: true });
    assert.equal(f.chat.memoryJournals.filter(j => j.autoMemory.kind === 'merged').length, 2);
});

test('higher-level compression waits for the same number of big summaries', async () => {
    const f = fixture(10, { keepRecent: 0, batchSize: 1, threshold: 1 });
    await f.run(); await f.run(); await f.run();
    assert.equal(f.context.getAutoMemoryState(f.chat).active.length, 2);
    await f.run();
    assert.equal(f.context.getAutoMemoryPlan(f.chat).merge.length, 2);
    await f.run();
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 5);
    const state = f.context.getAutoMemoryState(f.chat);
    assert.equal(state.active.filter(j => j.autoMemory.kind === 'merged').length, 1);
});

test('specified 1–700 range processes every floor in seven parts, skips completed range on rerun', async () => {
    const f = fixture(720, { enabled: false, keepRecent: 100, mergeThreshold: 6, mergeBatchSize: 6 });
    const plan = f.context.planAutoMemoryRange(f.chat, 1, 700, 7);
    assert.deepEqual(Array.from(plan.batches, b => b.length), [100, 100, 100, 100, 100, 100, 100]);
    const result = await f.run({ range: { start: 1, end: 700, parts: 7 } });
    assert.equal(result.completedParts, 7);
    assert.equal(result.count, 8);
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 700);
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.has('m700'), false);
    const summaryCalls = f.requests.filter(req => !JSON.stringify(req.body).includes('专业的档案记录员'));
    assert.equal(summaryCalls.length, 7);
    for (let i = 0; i < 7; i++) {
        const body = JSON.stringify(summaryCalls[i].body);
        assert.ok(body.includes('原楼层' + (i * 100)));
        if (i > 0) assert.ok(!body.includes('原楼层' + (i * 100 - 1)));
    }
    assert.equal((await f.run({ range: { start: 1, end: 700, parts: 7 } })).count, 0);
    assert.equal(f.requests.length, 8);
});

test('range failure preserves completed parts and resumes without repeating billed successful sources', async () => {
    const f = fixture(30, { mergeEnabled: false }); let calls = 0;
    f.context.fetchAiResponse = async () => { if (++calls === 2) throw new Error('API Error: 503'); return '<title>A</title><content>完整记忆</content>'; };
    const first = await f.run({ range: { start: 1, end: 30, parts: 3 } });
    assert.equal(first.completedParts, 1); assert.ok(first.error);
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 10);
    const received = [];
    f.context.fetchAiResponse = async (config, body) => { received.push(JSON.stringify(body)); return '<title>A</title><content>完整记忆</content>'; };
    const next = await f.run({ range: { start: 1, end: 30, parts: 2 } });
    assert.equal(next.completedParts, 2); assert.equal(next.skipped, 10);
    assert.ok(received.every(body => !body.includes('原楼层9')));
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 30);
});

test('invalid range rejected before API and recent retention does not silently omit explicit range', async () => {
    const f = fixture(10, { keepRecent: 20, mergeEnabled: false });
    for (const range of [{ start: 0, end: 10, parts: 2 }, { start: 1, end: 11, parts: 2 }, { start: 2, end: 1, parts: 1 }, { start: 1, end: 10, parts: 0 }]) assert.ok((await f.run({ range })).error);
    assert.equal(f.requests.length, 0);
    await f.run({ range: { start: 1, end: 10, parts: 2 } });
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 10);
});

test('stopping a range aborts the request and leaves pending floors uncovered', async () => {
    const f = fixture(10); let signal;
    f.context.fetchAiResponse = (config, body, headers, endpoint, stream, options) => new Promise((resolve, reject) => {
        signal = options.signal; signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const task = f.run({ range: { start: 1, end: 10, parts: 2 } });
    vm.runInContext("const ctl = autoMemoryControls.get('private:alice:a1'); ctl.cancelled = true; ctl.controller.abort();", f.context);
    const result = await task;
    assert.equal(result.cancelled, true); assert.equal(signal.aborted, true);
    assert.equal(f.chat.memoryJournals.length, 0);
});

test('independent memory API never falls back to primary and can use Gemini', async () => {
    const f = fixture(10, { apiSource: 'memory' });
    assert.ok((await f.run()).error); assert.equal(f.requests.length, 0);
    f.context.db.memoryApiSettings = { provider: 'gemini', url: 'https://memory.test', key: 'fake-memory-key', model: 'memory-model' };
    const result = await f.run({ force: true });
    assert.equal(result.count, 1); assert.equal(f.requests[0].config.provider, 'gemini');
    assert.ok(f.requests[0].endpoint.startsWith('https://memory.test/'));
});

test('zero context limit sends no raw messages', () => {
    const f = fixture(); f.chat.maxMemory = 0;
    assert.equal(f.context.getAutoMemoryContextHistory(f.chat).length, 0);
});

test('range retry can finish a failed merge even when every source floor was already saved', async () => {
    const f = fixture(12, { mergeThreshold: 6, mergeBatchSize: 6 });
    const original = f.context.fetchAiResponse;
    let calls = 0;
    f.context.fetchAiResponse = async (...args) => {
        if (++calls === 7) throw new Error('network failure');
        return original(...args);
    };
    const range = { start: 1, end: 12, parts: 6 };
    assert.ok((await f.run({ range })).error);
    assert.equal(f.context.getAutoMemoryState(f.chat).covered.size, 12);
    assert.equal(f.chat.memoryJournals.length, 6);
    f.context.fetchAiResponse = original;
    const result = await f.run({ range });
    assert.equal(result.count, 1);
    assert.equal(result.completedParts, 0);
    assert.equal(f.chat.memoryJournals.at(-1).autoMemory.kind, 'merged');
    assert.equal((await f.run({ range })).count, 0);
});

test('summary and vector settings update independently without overwriting each other', () => {
    const f = fixture(1, { enabled: true, hideSummarized: false, vectorSearchEnabled: true, vectorRerankEnabled: true, vectorTopK: 7, vectorThreshold: 0.61 });
    const initial = JSON.parse(JSON.stringify(f.context.getAutoMemorySettings(f.chat)));
    const summary = f.context.mergeAutoMemorySettings(initial, { hideSummarized: true, keepRecent: 42 });
    assert.equal(summary.hideSummarized, true);
    assert.equal(summary.keepRecent, 42);
    assert.equal(summary.vectorSearchEnabled, true);
    assert.equal(summary.vectorRerankEnabled, true);
    assert.equal(summary.vectorTopK, 7);
    assert.equal(summary.vectorThreshold, 0.61);
    const vector = f.context.mergeAutoMemorySettings(summary, { vectorSearchEnabled: false, vectorTopK: 2 });
    assert.equal(vector.vectorSearchEnabled, false);
    assert.equal(vector.vectorTopK, 2);
    assert.equal(vector.hideSummarized, true);
    assert.equal(vector.keepRecent, 42);
});
