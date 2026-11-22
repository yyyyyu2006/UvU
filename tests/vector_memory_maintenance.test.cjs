const { test } = require('node:test');
const assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { IDBFactory, IDBKeyRange, IDBObjectStore } = require('fake-indexeddb');
function fixture(factory = new IDBFactory()) {
    const chat = { id: 'maintenance', activeArchiveId: 'a', history: [], memoryJournals: [], maxMemory: 2,
        autoMemorySettings: { vectorSearchEnabled: true, vectorExternalIndex: true, vectorThreshold: .9 } };
    const calls = [];
    const c = vm.createContext({ console, Date, URL, indexedDB: factory, IDBKeyRange, setTimeout, clearTimeout, AbortController,
        document: { getElementById() {}, addEventListener() {} }, window: {},
        db: { characters: [chat], groups: [], vectorMemoryApiSettings: { provider: 'newapi', url: 'https://fixture.invalid/v1', key: 'synthetic', embeddingModel: 'fixed' } },
        saveData: async () => { throw Error('maintenance must not rewrite source records'); },
        requestMemoryEmbedding: async () => { calls.push('query'); return [1, 0]; } });
    for (const name of ['utils', 'modules/journal', 'modules/vector_index_store', 'modules/vector_memory_tools', 'modules/auto_memory', 'modules/vector_memory_maintenance'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + name + '.js'), 'utf8'), c);
    c.requestMemoryEmbedding = async () => { calls.push('query'); return [1, 0]; };
    c.requestMemoryEmbeddings = async texts => { calls.push('documents'); return texts.map(text => text.includes('低分') ? [-.5, Math.sqrt(.75)] : [.8, .6]); };
    const tools = vm.runInContext('VectorMemoryTools', c);
    const scope = () => tools.indexScope(chat, c.vectorMemoryApiFingerprint(c.resolveVectorMemoryApi()));
    return { c, chat, calls, scope, factory, tools };
}
const plain = value => JSON.parse(JSON.stringify(value));
const labelled = () => [
    { queryKey: 'one', cosine: .8, lexical: .1, rerank: .85, relevant: true },
    { queryKey: 'two', cosine: .85, lexical: .1, rerank: .9, relevant: true },
    { queryKey: 'one', cosine: .1, lexical: .1, rerank: .1, relevant: false },
    { queryKey: 'two', cosine: .7, lexical: .1, rerank: .7, relevant: false }
];
test('threshold suggestions use labelled errors, preserve parameters, and require independent questions and both labels', () => {
    const { c } = fixture(), settings = { vectorThreshold: .25, vectorRerankThreshold: .3 }, rows = labelled();
    const before = JSON.stringify([rows, settings]), result = c.suggestVectorMemoryThresholds(rows, settings);
    assert.equal(result.ready, true); assert.equal(result.current.fp, 1); assert.equal(result.proposed.fp, 0); assert.equal(result.proposed.fn, 0);
    assert.equal(JSON.stringify([rows, settings]), before);
    for (const insufficient of [[], rows.filter(row => row.relevant), rows.map(row => ({ ...row, queryKey: 'one' }))])
        assert.equal(c.suggestVectorMemoryThresholds(insufficient, settings).ready, false);
});
test('keyword admission is evaluated explicitly rather than pretending higher cosine rejects every lexical false positive', () => {
    const { c } = fixture(), rows = labelled(); rows[3].lexical = .9;
    const result = c.suggestVectorMemoryThresholds(rows, { vectorThreshold: .25, vectorHybridEnabled: true });
    assert.equal(result.lexicalBypass, true); assert.ok(result.proposed.fp > 0);
});
test('native rerank suggestions use current vector admission and refuse missing, chat-only or out-of-range scores', () => {
    const { c } = fixture(), settings = { vectorThreshold: 0, vectorRerankThreshold: .3 };
    assert.equal(c.suggestVectorMemoryThresholds(labelled(), settings, 'rerank').ready, true);
    for (const bad of [undefined, 3, -.5, NaN]) {
        const rows = labelled(); rows[0].rerank = bad;
        assert.equal(c.suggestVectorMemoryThresholds(rows, settings, 'rerank').ready, false);
    }
    assert.equal(c.suggestVectorMemoryThresholds(labelled(), { ...settings, vectorThreshold: .75 }, 'rerank').ready, false);
});
test('calibration samples scores below active threshold using existing cache without injection, document requests, or settings writes', async () => {
    const { c, chat, calls } = fixture();
    chat.memoryJournals.push({ id: 'one', content: '已有剧情' }, { id: 'low', content: '低分剧情' });
    await c.getVectorMemoryContext(chat, '试查'); const before = JSON.stringify(chat), diag = JSON.stringify(c.getVectorMemoryDiagnostics(chat));
    calls.length = 0; let report;
    assert.equal(await c.getVectorMemoryContext(chat, '试查', undefined, { calibrateThresholds: true, trial: value => { report = value; } }), '');
    assert.equal(report.calibration, true); assert.equal(report.selected.length, 2); assert.ok(report.selected.some(row => row.cosine < 0));
    assert.deepEqual(calls, ['query']); assert.equal(JSON.stringify(chat), before); assert.equal(JSON.stringify(c.getVectorMemoryDiagnostics(chat)), diag);
    assert.equal(report.identity, c.vectorThresholdIdentity(chat));
    chat.memoryJournals[0].content += '变化'; assert.notEqual(report.identity, c.vectorThresholdIdentity(chat));
});
test('calibration native score requests are explicit and cancelled or changed sources are rejected', async () => {
    const { c, chat } = fixture(); chat.memoryJournals.push({ id: 'one', content: '剧情' }); await c.getVectorMemoryContext(chat, '试查');
    let scoreCalls = 0;
    c.rerankMemoryCandidates = async (_query, rows) => { scoreCalls++; return rows.map(row => ({ ...row, rerankScore: .8 })); };
    const options = { calibrateThresholds: true, trialRerank: true, trial() {} };
    await assert.rejects(c.getVectorMemoryContext(chat, '试查', undefined, options), /专用重排/); assert.equal(scoreCalls, 0);
    Object.assign(c.db.vectorMemoryApiSettings, { rerankMode: 'native', rerankModel: 'rerank' });
    let report; await c.getVectorMemoryContext(chat, '试查', undefined, { ...options, trial: row => { report = row; } });
    assert.equal(scoreCalls, 1); assert.equal(report.selected[0].rerank, .8);
    c.rerankMemoryCandidates = async (_query, rows) => { chat.history.push({ id: 'changed', role: 'user', content: '变化' }); return rows; };
    await assert.rejects(c.getVectorMemoryContext(chat, '试查', undefined, options), /变化/);
    const control = new AbortController(); control.abort();
    await assert.rejects(c.getVectorMemoryContext(chat, '试查', control.signal, options), { name: 'AbortError' });
});
async function seed() {
    const state = fixture(); state.chat.memoryJournals.push({ id: 'keep', content: '保留原文' }, { id: 'remove', content: '撤销原文' });
    await state.c.getVectorMemoryContext(state.chat, '原文');
    return state;
}
test('current cache cleanup previews unavailable and changed blocks, preserves originals and other scopes, without network or source writes', async () => {
    const { c, chat, calls, scope, tools } = await seed(), store = c.VectorIndexStore;
    const old = await store.read(scope()); await store.commit('other-model', old.index, 'other');
    chat.memoryJournals.pop(); chat.memoryJournals[0].content = '编辑后的正文';
    chat.autoMemorySettings.vectorQueryCache = true;
    tools.cachedResult(chat, 'pre-cleanup', { context: 'before cleanup' }); c.updateVectorMemoryDiagnostics(chat, { injectedIds: ['old'] });
    const before = JSON.stringify(chat); calls.length = 0;
    const preview = await c.previewVectorMemoryCacheCleanup(chat);
    assert.equal(preview.reasons.unavailable, 1); assert.equal(preview.reasons.changed, 1); assert.equal(preview.removedVectors, 2);
    assert.equal(JSON.stringify(chat), before); assert.equal((await store.read(scope())).updatedAt, old.updatedAt);
    const done = await c.applyVectorMemoryCacheCleanup(chat, preview);
    assert.equal(done.removedVectors, 2); assert.equal(Object.keys((await store.read(scope())).index).length, 0);
    assert.equal(tools.cachedResult(chat, 'pre-cleanup'), null); assert.equal(c.getVectorMemoryDiagnostics(chat).injectedIds, undefined);
    assert.equal(Object.keys((await store.read('other-model')).index).length, 2); assert.equal(JSON.stringify(chat), before); assert.deepEqual(calls, []);
    await assert.rejects(c.applyVectorMemoryCacheCleanup(chat, preview), /重新预览/);
});
test('read-only retrieval mode permits manual stale cleanup while valid vectors remain byte-identical', async () => {
    const { c, chat, scope } = await seed(); chat.autoMemorySettings.vectorRetrievalOnly = true;
    const before = await c.VectorIndexStore.read(scope());
    // Explicitly revoked bridge sources are filtered by the same production candidate reader.
    chat.memoryJournals[1].source = 'sillytavern'; chat.memoryJournals[1].bridgeReview = { status: 'pending' };
    const preview = await c.previewVectorMemoryCacheCleanup(chat);
    assert.equal(preview.keptReferences, 1); await c.applyVectorMemoryCacheCleanup(chat, preview);
    assert.deepEqual(plain((await c.VectorIndexStore.read(scope())).index.keep), plain(before.index.keep));
    assert.equal((await c.VectorIndexStore.read(scope())).index.remove, undefined);
});
test('stale cleanup rejects changed model, source, archive or closed owner before any mutation', async () => {
    for (const change of [s => { s.chat.memoryJournals[0].content += '变化'; }, s => { s.c.db.vectorMemoryApiSettings.embeddingModel = 'other'; },
        s => { s.chat.activeArchiveId = 'other'; }, s => { s.c.db.characters = []; }]) {
        const state = await seed(), oldScope = state.scope(), before = await state.c.VectorIndexStore.read(oldScope);
        const preview = await state.c.previewVectorMemoryCacheCleanup(state.chat); change(state);
        await assert.rejects(state.c.applyVectorMemoryCacheCleanup(state.chat, preview), /变化/);
        assert.equal((await state.c.VectorIndexStore.read(oldScope)).updatedAt, before.updatedAt);
    }
    const { c, chat } = await seed(); let current = true;
    const preview = await c.previewVectorMemoryCacheCleanup(chat, () => current); current = false;
    await assert.rejects(c.applyVectorMemoryCacheCleanup(chat, preview), /变化/);
});
test('another page cache update invalidates cleanup instead of deleting newer chunks', async () => {
    const { c, chat, scope, factory } = await seed(), peer = fixture(factory).c.VectorIndexStore;
    chat.memoryJournals.pop(); const preview = await c.previewVectorMemoryCacheCleanup(chat);
    const before = await peer.read(scope()); await peer.commit(scope(), before.index, 'peer', undefined, before.updatedAt);
    await assert.rejects(c.applyVectorMemoryCacheCleanup(chat, preview), /索引已更新/);
    assert.equal((await peer.read(scope())).fingerprint, 'peer'); assert.equal(Object.keys((await peer.read(scope())).index).length, 2);
});
test('cleanup inspection accounts for invalid and unreferenced physical rows; quota failure rolls back its transaction', async () => {
    const { c, chat, scope, factory } = await seed(), store = c.VectorIndexStore;
    const database = await new Promise(resolve => { const request = factory.open('uvu-vector-index-v1'); request.onsuccess = () => resolve(request.result); });
    const before = await store.read(scope(), true), key = before.index.remove.chunks[0].key;
    await new Promise((resolve, reject) => { const tx = database.transaction('chunks', 'readwrite'), chunks = tx.objectStore('chunks');
        chunks.put({ id: [scope(), key], scope: scope(), key, vector: [NaN, 0] });
        chunks.put({ id: [scope(), 'orphan'], scope: scope(), key: 'orphan', vector: [1, 0] });
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    const preview = await c.previewVectorMemoryCacheCleanup(chat);
    assert.equal(preview.reasons.invalid, 1); assert.equal(preview.orphanVectors, 1); assert.equal(preview.removedVectors, 2);
    const originalPut = IDBObjectStore.prototype.put;
    try {
        IDBObjectStore.prototype.put = function (...args) { if (this.name === 'manifests') throw Error('test quota'); return originalPut.apply(this, args); };
        await assert.rejects(c.applyVectorMemoryCacheCleanup(chat, preview), /quota/);
    } finally { IDBObjectStore.prototype.put = originalPut; }
    assert.equal((await store.read(scope(), true)).inventory.length, 3);
    await c.applyVectorMemoryCacheCleanup(chat, preview); assert.equal((await store.read(scope(), true)).inventory.length, 1);
    database.close();
});
