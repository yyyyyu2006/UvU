// Unified fixed regression contract. Synthetic vectors cannot measure real model accuracy.
const { run, modes, cases } = require('./vector_recall_benchmark.cjs');
const assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { performance } = require('node:perf_hooks');
async function lifecycle(name, mutate) {
    const chat = { id: 'source', activeArchiveId: 'a', maxMemory: 0, history: [{ id: 'm', role: 'user', content: '约好周五还书。' }], memoryJournals: [],
        autoMemorySettings: { vectorSearchEnabled: true, vectorThreshold: 0, keepRecent: 100, vectorDeduplicateSources: true } };
    let requests = 0;
    const controller = new AbortController(), c = vm.createContext({ console, Date, URL, setTimeout, clearTimeout, AbortController,
        document: { getElementById() {}, addEventListener() {} }, window: {},
        db: { characters: [chat], groups: [], vectorMemoryApiSettings: { provider: 'newapi', url: 'https://fixture.invalid', key: 'synthetic', embeddingModel: 'fixed' } },
        saveData: async () => {} });
    for (const name of ['utils', 'modules/journal', 'modules/vector_memory_tools', 'modules/auto_memory'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + name + '.js'), 'utf8'), c);
    c.requestMemoryEmbedding = async () => { requests++; return [1, 0]; };
    c.requestMemoryEmbeddings = async texts => { requests++; return texts.map(() => [1, 0]); };
    chat.memoryJournals.push({ id: 'summary', title: '约定', content: '约好周五还书。', range: { start: 1, end: 1 }, autoMemory: {
        version: 1, kind: 'summary', committed: true, sources: [{ id: 'm', hash: c.autoMemoryMessageHash(chat.history[0]) }] } });
    const started = performance.now(), text = await c.getVectorMemoryContext(chat, '还书', controller.signal);
    assert.match(text, /约好周五还书/);
    mutate({ chat, c, controller });
    const prompt = c.buildPromptWithVectorMemory(chat, () => 'BASE', text);
    assert.equal(prompt, 'BASE', name + ': stale result must not enter the next prompt');
    assert.equal(c.getVectorMemoryDiagnostics(chat).injectedIds.length, 0);
    return { case: name, mode: 'source-lifecycle', hit: true, precision: null, recall: null, reciprocalRank: null,
        correctAbstention: true, falseReferences: 0, estimatedTokens: 0, requests, milliseconds: +(performance.now() - started).toFixed(2) };
}
const changes = [
    ['edited', ({ chat }) => { chat.history[0].content += '后来取消。'; }],
    ['withdrawn', ({ chat }) => { chat.history[0].isWithdrawn = true; }],
    ['hidden', ({ chat }) => { chat.history[0].isHidden = true; }],
    ['context-disabled', ({ chat }) => { chat.history[0].isContextDisabled = true; }],
    ['deleted-message', ({ chat }) => { chat.history.pop(); }],
    ['changed-archive', ({ chat }) => { chat.activeArchiveId = 'other'; }],
    ['removed-target-character', ({ c }) => { c.db.characters = [{ id: 'other', history: [], memoryJournals: [] }]; }],
    ['retrieval-disabled', ({ chat }) => { chat.autoMemorySettings.vectorSearchEnabled = false; }],
    ['cancelled', ({ controller }) => { controller.abort(); }]
];
(async () => {
    for (const mode of modes) for (const query of cases.queries) console.log(JSON.stringify(await run(mode, query)));
    for (const [name, change] of changes) console.log(JSON.stringify(await lifecycle(name, change)));
})().catch(error => { console.error(error); process.exitCode = 1; });
