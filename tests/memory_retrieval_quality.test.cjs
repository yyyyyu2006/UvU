const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
function fixture(settings = {}) {
    const chat = { id: 'quality', activeArchiveId: 'a', realName: '晴', myName: '我', maxMemory: 2,
        history: [], memoryJournals: [], autoMemorySettings: { enabled: true, keepRecent: 0, threshold: 1, batchSize: 3,
            mergeEnabled: false, ...settings } };
    const calls = [];
    const c = vm.createContext({ console, Date, URL, setTimeout, clearTimeout, AbortController,
        window: {}, document: { getElementById() { return null; }, addEventListener() {} },
        db: { characters: [chat], groups: [], worldBooks: [], apiSettings: { provider: 'newapi', url: 'https://fixture.invalid/v1', key: 'synthetic', model: 'summary' },
            vectorMemoryApiSettings: { provider: 'newapi', url: 'https://fixture.invalid/v1', key: 'synthetic', embeddingModel: 'fixed', batchSize: 16 } },
        saveData: async () => {}, getRandomValue: x => x,
        fetch: async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body });
            return { ok: true, json: async () => ({ data: (Array.isArray(body.input) ? body.input : [body.input]).map(() => ({ embedding: [1, 0] })) }) }; } });
    for (const name of ['utils', 'modules/journal', 'modules/vector_memory_tools', 'modules/auto_memory'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + name + '.js'), 'utf8'), c);
    c.fetchAiResponse = async () => { calls.push({ summary: true }); return '<title>测试</title><content>完整且保留来源的合成总结。</content>'; };
    return { c, chat, calls, tools: vm.runInContext('VectorMemoryTools', c) };
}
const ids = items => Array.from(items, x => x.id);
function history(chat, count) {
    chat.history = Array.from({ length: count }, (_, i) => ({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: '合成消息' + i, timestamp: 1700000000000 + i }));
}

test('smart manual ranges repartition by complete exchanges, explicit events and full input limits', () => {
    const { c, chat, calls } = fixture({ summarySmartBatchEnabled: true, batchSize: 4, summaryInputMaxTokens: 6000 }); history(chat, 8);
    const batches = c.planAutoMemoryRange(chat, 1, 8, 1, '5').batches;
    assert.deepEqual(Array.from(batches, rows => ids(rows)), [['m0', 'm1', 'm2', 'm3'], ['m4', 'm5', 'm6', 'm7']]);
    const split = c.planAutoMemoryRange(chat, 1, 8, 3).batches;
    assert.deepEqual(Array.from(split, rows => rows.length), [4, 4], 'requested count is a target; complete answers stay together');
    assert.throws(() => c.planAutoMemoryRange(chat, 1, 8, 2, '9'), /本次待整理来源/);
    assert.throws(() => c.planAutoMemoryRange(chat, 1, 8, 2, '5abc'), /整数/);
    chat.history[0].content = '很长的消息'.repeat(4000);
    assert.throws(() => c.planAutoMemoryRange(chat, 1, 8, 2), /不会截断或发出请求/);
    assert.equal(calls.length, 0);
});

test('confirmed alias dictionaries apply only to optional local lexical scoring and exact English names', async () => {
    const { tools } = fixture(), settings = { vectorVocabularyEnabled: true, vectorAliases: '许见青=小青,见青\nAnn=安', vectorWorkTerms: '量子海\n2026-11-22' };
    assert.equal(tools.lexical('小青', '许见青', settings), 1);
    assert.equal(tools.lexical('小青', '许见青'), 0);
    assert.ok(tools.lexical('安', 'Ann', settings) > 0);
    assert.equal(tools.lexical('安', 'Anna', settings), 0);
    assert.equal(tools.lexical('2026年11月22日', '2026-11-22', settings), 1);
    assert.ok((await tools.weightedLexical('小青', ['许见青在量子海。', '其他角色。'], () => {}, settings))[0] > 0);
    assert.throws(() => tools.vocabulary({ vectorAliases: '甲=小青\n乙=小青' }), /不同标准名/);
    assert.throws(() => tools.vocabulary({ vectorAliases: '缺少等号' }), /每行/);
});

test('source-aware coverage retains independent text, and anchored manual summaries recover source identity', () => {
    const { tools, chat } = fixture(); history(chat, 3);
    const journal = { content: '约好周五。后来取消。', startMessageId: 'm0', endMessageId: 'm1' };
    assert.deepEqual(ids(tools.sourceIds(journal, chat).map(id => ({ id }))), ['m0', 'm1']);
    assert.equal(tools.coveredBy(journal, [{ content: '约好周五。', sourceMessageIds: ['m0', 'm1'] }], chat), false);
    assert.equal(tools.coveredBy(journal, [{ content: journal.content, sourceMessageIds: ['other'] }], chat), false);
    assert.equal(tools.coveredBy(journal, [{ content: journal.content, sourceMessageIds: ['m0', 'm1'] }], chat), true);
});
test('smart summary batches preserve adjacent Q&A and keep legacy batches when disabled', () => {
    const { c, chat } = fixture(); history(chat, 6);
    assert.deepEqual(ids(c.getAutoMemoryPlan(chat).batch), ['m0', 'm1', 'm2']);
    chat.autoMemorySettings.summarySmartBatchEnabled = true;
    assert.deepEqual(ids(c.getAutoMemoryPlan(chat).batch), ['m0', 'm1']);
    chat.autoMemorySettings.batchSize = 1;
    assert.equal(c.getAutoMemoryPlan(chat).batch.length, 0);
    assert.match(c.getAutoMemoryPlan(chat).batchWarning, /连续问答/);
    assert.equal(chat.history.length, 6);
});
test('summary budget blocks oversized automatic and explicit-range calls without covering or truncating a message', async () => {
    const { c, chat, calls } = fixture({ summarySmartBatchEnabled: true, summaryInputMaxTokens: 500 }); history(chat, 2);
    chat.history[0].content = '原文不可截断。'.repeat(600);
    const original = JSON.stringify(chat.history);
    assert.equal(c.getAutoMemoryPlan(chat).batch.length, 0);
    const result = await c.runAutoMemory(chat.id, 'private', { force: true });
    assert.equal(result.count, 0); assert.equal(calls.length, 0);
    await c.runAutoMemory(chat.id, 'private', { range: { start: 1, end: 2, parts: 1 }, reviewOnly: true });
    assert.equal(calls.length, 0); assert.equal(chat.memoryJournals.length, 0);
    assert.equal(JSON.stringify(chat.history), original);
});
test('summary batch waits when answer is in recent protected region', () => {
    const { c, chat } = fixture({ summarySmartBatchEnabled: true, keepRecent: 1 }); history(chat, 2);
    assert.equal(c.getAutoMemoryPlan(chat).batch.length, 0);
    assert.match(c.getAutoMemoryPlan(chat).batchWarning, /保留区/);
});
test('weighted Chinese lexical scoring favors precise rare words and penalizes unrelated long text without padding no-match', async () => {
    const { tools } = fixture();
    const texts = ['明天约定去青鹭书店。', '明天约定。' + '无关背景。'.repeat(80), '明天约定去另一个地方。', '音乐设置'];
    const scores = await tools.weightedLexical('明天青鹭书店', texts);
    assert.ok(scores[0] > scores[1]); assert.ok(scores[0] > scores[2]); assert.equal(scores[3], 0);
    assert.ok(scores.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
    const dates = await tools.weightedLexical('2026-11-22', ['2026-11-22', '2026-11-23']);
    assert.ok(dates[0] > dates[1]);
});
test('RRF fuses independent ranked routes with deterministic ties and never replaces cosine gate', async () => {
    const { c, chat, tools } = fixture({ vectorSearchEnabled: true, vectorHybridEnabled: true, vectorRRFEnabled: true, vectorThreshold: 1 });
    const hits = [ { id: 'vector', vectorScore: .99, lexical: .1 }, { id: 'both', vectorScore: .9, lexical: .8 }, { id: 'lexical', vectorScore: .1, lexical: .9 }, { id: 'middle', vectorScore: .5, lexical: .5 } ];
    const result = tools.fuseRanks(hits);
    assert.equal(result.sort((a,b) => b.score - a.score)[0].id, 'both');
    assert.equal(hits[0].score, undefined);
    chat.memoryJournals = [{ id: 'none', content: '音乐设置' }];
    c.fetch = async () => ({ ok: true, json: async () => ({ data: [{ embedding: [0, 1] }] }) });
    // Index and query vectors are deliberately orthogonal.
    let n = 0; c.requestMemoryEmbeddings = async () => [[0, 1]]; c.requestMemoryEmbedding = async () => { n++; return [1, 0]; };
    assert.equal(await c.getVectorMemoryContext(chat, '青鹭书店'), ''); assert.equal(n, 1);
    assert.equal(c.getVectorMemoryDiagnostics(chat).ranking, 'RRF名次融合');
});
test('source diversity offers another source before a second copy and does not permanently discard unique content', async () => {
    const { c, chat } = fixture({ vectorSearchEnabled: true, vectorDiversityEnabled: true, vectorTopK: 2, vectorThreshold: 0 });
    chat.memoryJournals = [ { id: 'a', sourceMessageIds: ['s'], content: '约定地点' }, { id: 'b', sourceMessageIds: ['s'], content: '约定时间' }, { id: 'c', sourceMessageIds: ['t'], content: '另一件事' } ];
    await c.getVectorMemoryContext(chat, '约定');
    assert.deepEqual(ids(c.getVectorMemoryDiagnostics(chat).selected), ['a', 'c']);
    chat.memoryJournals.pop(); await c.getVectorMemoryContext(chat, '约定');
    assert.deepEqual(ids(c.getVectorMemoryDiagnostics(chat).selected), ['a', 'b']);
});
test('source links do not erase details lost by summaries or an explicitly favorited copy', () => {
    const { c, chat } = fixture({ vectorDeduplicateSources: true, vectorStableSources: true }); chat.maxMemory = 1;
    chat.history = [{ id: 'old', role: 'user', content: '约定周日归还蓝色的书。后来取消了归还安排。' }, { id: 'new', role: 'user', content: '现在' }];
    chat.memoryJournals = [{ id: 'short', content: '约定周日归还蓝色的书。', sourceMessageIds: ['old'] },
        { id: 'favorite', content: '约定周日归还蓝色的书。', sourceMessageIds: ['old'], isFavorited: true }];
    assert.ok(ids(c.getVectorMemoryCandidates(chat)).includes('message:old'));
    assert.ok(ids(c.getVectorMemoryCandidates(chat)).includes('favorite'));
    chat.maxMemory = 2; chat.memoryJournals[0].content = '约定周日归还蓝色的书。另有独有事实。';
    assert.ok(ids(c.getVectorMemoryCandidates(chat)).includes('short'));
});
test('neighbor expansion retains following cancellation, bounds readable old-message neighbors and applies an atomic budget', async () => {
    const { c, chat, tools } = fixture({ vectorSearchEnabled: true, vectorThreshold: 0, vectorStableSources: true, vectorNeighborExpansionEnabled: true });
    const source = '前一件事。周日归还蓝色的书。后来取消了归还安排。其他内容。';
    const start = source.indexOf('周日'), end = source.indexOf('后来');
    const range = tools.expandRange(source, { start, end });
    assert.match(source.slice(range.start, range.end), /后来取消/);
    history(chat, 4); chat.maxMemory = 0;
    chat.history[1].isWithdrawn = true; chat.history[2].content = '答应。'; chat.history[3].content = '后来取消。';
    const candidates = c.getVectorMemoryCandidates(chat), pair = candidates.find(row => row.id === 'message:m2');
    assert.deepEqual(Array.from(pair.sourceMessageIds), ['m2', 'm3']);
    chat.memoryJournals = [{ id: 'large', content: '答应。' + '后来取消安排。'.repeat(40) }]; chat.history = [];
    Object.assign(chat.autoMemorySettings, { vectorContextBudgetEnabled: true, vectorContextMaxChars: 200 });
    assert.equal(await c.getVectorMemoryContext(chat, '答应'), '');
    assert.ok(c.getVectorMemoryDiagnostics(chat).excluded.some(item => /跳过整段/.test(item.reason)));
});
test('new empty retrieval and cache reuse cannot inherit an earlier assembled injection state', async () => {
    const { c, chat } = fixture({ vectorSearchEnabled: true, vectorThreshold: 0, vectorQueryCache: true });
    chat.memoryJournals = [{ id: 'note', content: '合成事实' }];
    const context = await c.getVectorMemoryContext(chat, '合成');
    c.buildPromptWithVectorMemory(chat, () => 'BASE', context);
    assert.equal(c.getVectorMemoryDiagnostics(chat).injectedIds.length, 1);
    await c.getVectorMemoryContext(chat, '合成');
    assert.equal(c.getVectorMemoryDiagnostics(chat).resultCacheHit, true);
    assert.equal(c.getVectorMemoryDiagnostics(chat).injectedIds.length, 0);
    chat.memoryJournals = []; await c.getVectorMemoryContext(chat, '合成');
    assert.equal(c.getVectorMemoryDiagnostics(chat).selected.length, 0);
    assert.equal(c.getVectorMemoryDiagnostics(chat).injectedIds.length, 0);
});
test('copy report strips all raw text and configuration secrets and source navigation refuses edited originals', async () => {
    const { c, chat } = fixture({ vectorSearchEnabled: true, vectorThreshold: 0 });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/memory_library.js'), 'utf8'), c);
    chat.memoryJournals = [{ id: 'PERSONAL-ID', title: 'PRIVATE-TITLE', content: 'PRIVATE-CONTENT' }];
    c.db.vectorMemoryApiSettings.key = 'PRIVATE-KEY';
    const context = await c.getVectorMemoryContext(chat, 'PRIVATE-QUERY');
    const diag = c.getVectorMemoryDiagnostics(chat), report = JSON.stringify(c.getRedactedVectorMemoryReport(chat));
    for (const word of ['PERSONAL-ID', 'PRIVATE-TITLE', 'PRIVATE-CONTENT', 'PRIVATE-KEY', 'PRIVATE-QUERY', 'fixture.invalid']) assert.ok(!report.includes(word));
    assert.equal(c.getRedactedVectorMemoryReport(chat).preparedSourceKeys.length, 0);
    assert.match(c.memoryVectorSourcePreview(chat, diag.selected[0], diag.sourceSnapshot), /PRIVATE-CONTENT/);
    c.buildPromptWithVectorMemory(chat, () => 'BASE', context);
    assert.equal(c.getRedactedVectorMemoryReport(chat).preparedSourceKeys.length, 1);
    chat.memoryJournals[0].content = 'UPDATED';
    assert.match(c.memoryVectorSourcePreview(chat, diag.selected[0], diag.sourceSnapshot), /已变化/);
    assert.equal(c.getRedactedVectorMemoryReport(chat).sourceSnapshotCurrent, false);
});
