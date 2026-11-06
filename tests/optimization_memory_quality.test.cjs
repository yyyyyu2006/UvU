const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture(review = true) {
    const chat = { id: 'c', activeArchiveId: 'a', realName: '晴', myName: '我', maxMemory: 100,
        history: Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: '2026-11-01 两人约定周末去海边看日落，并在回来后一起吃晚饭。', timestamp: 1700000000000 + i })),
        memoryJournals: [], autoMemorySettings: { enabled: true, useMemory: true, contextInjectionOptIn: true, keepRecent: 0, threshold: 4, batchSize: 4, mergeEnabled: false,
            summaryQualityReviewEnabled: review, useTargetLength: true, targetLength: 500 } };
    let calls = 0;
    const c = vm.createContext({ window: {}, console, setTimeout, clearTimeout, AbortController,
        document: { addEventListener() {}, getElementById() { return null; } }, db: { characters: [chat], groups: [], apiSettings: { provider: 'newapi', url: 'https://test.invalid', key: 'test', model: 'chat' } },
        saveData: async () => {} });
    for (const file of ['utils.js', 'modules/journal.js', 'modules/auto_memory.js', 'modules/memory_library.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), c);
    c.fetchAiResponse = async () => { calls++; return '<title>周末约定</title><content>两人约定去海边。</content>'; };
    return { c, chat, calls: () => calls, run: () => c.runAutoMemory('c', 'private') };
}
test('quality review is opt-in and disabled behavior still commits ordinary automatic summaries', async () => {
    const { c, chat, run } = fixture(false); await run(); assert.equal(chat.memoryJournals[0].autoMemory.committed, true); assert.equal(c.getAutoMemoryState(chat).covered.size, 4);
});
test('opt-in summaries persist review drafts without hiding originals or rebilling the same waiting floors', async () => {
    const { c, chat, run, calls } = fixture(); const before = JSON.stringify(chat.history); await run();
    assert.equal(chat.memoryJournals[0].autoMemory.committed, false); assert.equal(chat.memoryJournals[0].qualityReview.status, 'pending');
    assert.ok(chat.memoryJournals[0].qualityReview.warnings.length > 0); assert.equal(c.getAutoMemoryState(chat).covered.size, 0);
    await run(); assert.equal(calls(), 1); assert.equal(JSON.stringify(chat.history), before);
});
test('review allows editing and explicit approval before source coverage becomes effective', async () => {
    const { c, chat, run } = fixture(); await run();
    await c.saveAutoMemoryReview(chat, chat.memoryJournals[0], { action: 'approve', fields: { title: '已核对', content: '2026-11-01，去海边看日落并吃晚饭。' } });
    assert.equal(chat.memoryJournals[0].content, '2026-11-01，去海边看日落并吃晚饭。'); assert.equal(c.getAutoMemoryState(chat).covered.size, 4);
});
test('retry replaces only a pending draft, and keeping originals removes the draft without touching history', async () => {
    const { c, chat, run } = fixture(); await run(); const before = JSON.stringify(chat.history);
    c.fetchAiResponse = async () => '<title>重试结果</title><content>核对后的海边约定。</content>';
    const id = chat.memoryJournals[0].id;
    await c.saveAutoMemoryReview(chat, chat.memoryJournals[0], { action: 'retry', type: 'private', control: {} });
    assert.equal(chat.memoryJournals[0].id, id); assert.match(chat.memoryJournals[0].content, /核对后/); assert.equal(c.getAutoMemoryState(chat).covered.size, 0);
    await c.saveAutoMemoryReview(chat, chat.memoryJournals[0], { action: 'discard' }); assert.equal(chat.memoryJournals.length, 0); assert.equal(JSON.stringify(chat.history), before);
});
test('approval rejects changed source floors and failed approval leaves a non-covering review draft', async () => {
    const { c, chat, run } = fixture(); await run(); const draft = chat.memoryJournals[0]; chat.history[0].content = '用户后来改的事实';
    await assert.rejects(c.saveAutoMemoryReview(chat, draft, { action: 'approve' }), /来源/); assert.equal(chat.memoryJournals[0], draft);
    chat.history[0].content = '2026-11-01 两人约定周末去海边看日落，并在回来后一起吃晚饭。';
    let saves = 0; c.saveData = async () => { if (++saves === 2) throw new Error('quota'); };
    await assert.rejects(c.saveAutoMemoryReview(chat, draft, { action: 'approve' }), /quota/); assert.equal(c.getAutoMemoryState(chat).covered.size, 0);
    assert.equal(chat.memoryJournals[0].qualityReview.status, 'pending');
});
test('range diagnostics expose exact eligible floors, exclusions and projected summary/merge calls', () => {
    const { c, chat } = fixture(false); chat.autoMemorySettings.mergeEnabled = true; chat.autoMemorySettings.mergeThreshold = 2; chat.autoMemorySettings.mergeBatchSize = 2;
    chat.history.push({ id: 'hidden', role: 'assistant', content: 'secret', isHidden: true });
    const preview = c.getAutoMemoryRangeDiagnostics(chat, 1, 5, 2);
    assert.equal(preview.rawCount, 5); assert.equal(preview.eligibleCount, 4); assert.equal(preview.sources.length, 4);
    assert.equal(preview.summaryCalls, 2); assert.equal(preview.mergeCalls, 1); assert.equal(preview.exclusions[0].floor, 5);
});
test('failed final approval remains pending after reloading persisted data and avoids rebilling', async () => {
    const { c, chat, run, calls } = fixture(); await run();
    let persisted, saves = 0;
    c.saveData = async () => { if (++saves === 2) throw new Error('quota'); persisted = JSON.parse(JSON.stringify(chat.memoryJournals)); };
    await assert.rejects(c.saveAutoMemoryReview(chat, chat.memoryJournals[0], { action: 'approve' }), /quota/);
    chat.memoryJournals = persisted;
    assert.equal(chat.memoryJournals[0].qualityReview.status, 'pending');
    assert.equal(chat.memoryJournals[0].autoMemory.committed, false);
    await run(); assert.equal(calls(), 1); assert.equal(c.getAutoMemoryState(chat).covered.size, 0);
});
test('approving after an alternative summary covered the sources rejects duplicate coverage', async () => {
    const { c, chat, run } = fixture(); await run(); const draft = chat.memoryJournals[0];
    chat.autoMemorySettings.summaryQualityReviewEnabled = false; await run();
    await assert.rejects(c.saveAutoMemoryReview(chat, draft, { action: 'approve' }), /来源|覆盖/);
});
test('approval rollback repairs the original archive after a switch and leaves the new branch untouched', async () => {
    const { c, chat, run } = fixture(); await run(); const draft = chat.memoryJournals[0];
    chat.archives = [{ id: 'a', data: { memoryJournals: [] } }]; let saves = 0;
    c.saveData = async () => {
        chat.archives[0].data.memoryJournals = JSON.parse(JSON.stringify(chat.memoryJournals));
        if (++saves === 2) { chat.activeArchiveId = 'b'; chat.history = []; chat.memoryJournals = [{ id: 'new-branch' }]; }
    };
    await assert.rejects(c.saveAutoMemoryReview(chat, draft, { action: 'approve' }), /存档|变化/);
    assert.equal(chat.memoryJournals[0].id, 'new-branch');
    assert.equal(chat.archives[0].data.memoryJournals[0].qualityReview.status, 'pending'); assert.equal(chat.archives[0].data.memoryJournals[0].autoMemory.committed, false);
});
