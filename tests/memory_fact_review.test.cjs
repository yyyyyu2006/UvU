const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture() {
    let serial = 0;
    const chat = { id: 'c', myName: '我', activeArchiveId: 'a', history: [], memoryJournals: [] };
    const c = vm.createContext({ db: { characters: [chat], groups: [] }, Date, console, saveData: async () => {},
        autoMemoryFingerprint: value => JSON.stringify(value), autoMemoryMessageHash: message => JSON.stringify(message),
        memoryJournalSourcesAllowed: (_, journal) => !journal.denied, getAutoMemoryState: () => ({ validIds: new Set(['auto']) }),
        characterMemoId: () => 'f' + ++serial });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/memory_fact_review.js'), 'utf8'), c);
    const a = { id: 'a', title: '旧事', content: '我喜欢喝茶。', createdAt: 100, range: { start: 0, end: 0 } };
    const b = { id: 'b', title: '新事', content: '我不喜欢喝茶。', createdAt: 200, range: { start: 0, end: 0 } };
    chat.memoryJournals.push(a, b);
    const fields = (journal, extra = {}) => ({ fact: journal.content, subject: 'user', attribute: '饮品偏好', value: '茶',
        polarity: journal === a ? 'positive' : 'negative', period: 'current', ...extra });
    return { c, chat, a, b, fields };
}
test('local factual labels require an exact quote and explicitly separate event from recording time', async () => {
    const { c, chat, a, fields } = fixture();
    await assert.rejects(c.saveMemoryFactReview(chat, a, 'add', fields(a, { fact: '没有的事实' })), /复制/);
    await c.saveMemoryFactReview(chat, a, 'add', fields(a, { period: 'unknown', polarity: 'unknown', subject: 'unknown' }));
    const f = a.memoryFacts[0];
    assert.equal(f.from, ''); assert.equal(f.to, ''); assert.equal(f.sourceRecordedAt, 100);
    assert.equal(f.polarity, 'unknown'); assert.equal(f.entityId, ''); assert.equal(a.content, '我喜欢喝茶。');
    await assert.rejects(c.saveMemoryFactReview(chat, a, 'add', fields(a, { period: 'range', from: '2026-02-30', to: '2026-03-01' })), /日期/);
    await assert.rejects(c.saveMemoryFactReview(chat, a, 'add', fields(a, { period: 'range', from: '2026-03-02', to: '2026-03-01' })), /起止/);
});
test('only confirmed same-subject same-attribute overlapping periods produce suggestions', async () => {
    const { c, chat, a, b, fields } = fixture();
    await c.saveMemoryFactReview(chat, a, 'add', fields(a));
    await c.saveMemoryFactReview(chat, b, 'add', fields(b, { subject: 'char' }));
    assert.equal(c.memoryFactSuggestions(chat, a.id).length, 0);
    b.memoryFacts = [];
    await c.saveMemoryFactReview(chat, b, 'add', fields(b));
    assert.equal(c.memoryFactSuggestions(chat, a.id).length, 1);
    b.memoryFacts[0].period = 'unknown'; assert.equal(c.memoryFactSuggestions(chat, a.id).length, 0);
    b.memoryFacts[0].period = 'range'; b.memoryFacts[0].from = '2026-11-01'; b.memoryFacts[0].to = '2026-11-02';
    assert.equal(c.memoryFactSuggestions(chat, a.id).length, 0);
});
test('manual relationships retain both originals, can be undone and expire after source changes', async () => {
    const { c, chat, a, b, fields } = fixture();
    await c.saveMemoryFactReview(chat, a, 'add', fields(a)); await c.saveMemoryFactReview(chat, b, 'add', fields(b));
    const pair = c.memoryFactSuggestions(chat, b.id)[0], originals = [a.content, b.content];
    await c.saveMemoryFactReview(chat, b, 'relation', { ...pair, decision: 'changed' });
    assert.equal(c.memoryFactSuggestions(chat, b.id)[0].decision, 'changed');
    assert.equal(c.memoryFactSuggestions(chat, a.id)[0].decision, 'changed', 'the same relationship is visible from the paired journal');
    assert.deepEqual([a.content, b.content], originals); assert.equal(a.vectorSupersededBy, undefined);
    await c.saveMemoryFactReview(chat, b, 'relation', { ...pair, decision: '' });
    assert.equal(c.memoryFactSuggestions(chat, b.id)[0].decision, '');
    assert.equal(c.memoryFactSuggestions(chat, a.id)[0].decision, '', 'undo is visible from both journals');
    a.content += '后来取消了。'; assert.equal(c.memoryFactSuggestions(chat, b.id).length, 0);
    await assert.rejects(c.saveMemoryFactReview(chat, b, 'relation', { ...pair, decision: 'changed' }), /来源已变化/);
});
test('source edits, withdrawal, persona changes, pending or denied journals invalidate labels', async () => {
    const { c, chat, a, fields } = fixture();
    chat.history.push({ id: 'u', role: 'user', content: a.content }); a.range = { start: 1, end: 1 };
    await c.saveMemoryFactReview(chat, a, 'add', fields(a)); assert.equal(c.memoryFactRows(chat).length, 1);
    chat.history[0].isWithdrawn = true; assert.equal(c.memoryFactRows(chat).length, 0);
    delete chat.history[0].isWithdrawn; chat.myName = '别人'; assert.equal(c.memoryFactRows(chat).length, 0);
    chat.myName = '我'; a.qualityReview = { status: 'pending' }; assert.equal(c.memoryFactRows(chat).length, 0);
    delete a.qualityReview; a.denied = true; assert.equal(c.memoryFactRows(chat).length, 0);
});
test('stale editors and concurrent writes refuse to overwrite another edit', async () => {
    const { c, chat, a, fields } = fixture(), snapshot = c.memoryFactSnapshot(chat, a);
    await c.saveMemoryFactReview(chat, a, 'add', fields(a));
    await assert.rejects(c.saveMemoryFactReview(chat, a, 'add', fields(a), snapshot), /标签或存档/);
    const other = c.memoryFactSnapshot(chat, a); chat.activeArchiveId = 'b';
    await assert.rejects(c.saveMemoryFactReview(chat, a, 'remove', { id: a.memoryFacts[0].id }, other), /标签或存档/);
});
test('failed saves restore annotations in the original archive and preserve concurrent content edits', async () => {
    const { c, chat, a, fields } = fixture();
    chat.archives = [{ id: 'a', data: {} }];
    c.saveData = async () => { a.content += '保留后来编辑。'; chat.archives[0].data.memoryJournals = JSON.parse(JSON.stringify(chat.memoryJournals));
        chat.activeArchiveId = 'b'; chat.memoryJournals = [{ id: 'branch' }]; throw Error('quota'); };
    await assert.rejects(c.saveMemoryFactReview(chat, a, 'add', fields(a)), /quota/);
    assert.equal(chat.memoryJournals[0].id, 'branch');
    assert.equal(chat.archives[0].data.memoryJournals[0].memoryFacts, undefined);
    assert.match(chat.archives[0].data.memoryJournals[0].content, /保留后来编辑/);
});
