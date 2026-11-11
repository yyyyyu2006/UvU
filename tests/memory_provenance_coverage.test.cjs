const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture() {
    let serial = 0;
    const chat = { id: 'c', activeArchiveId: 'a', history: [{ id: 'm', role: 'user', content: '周五还书' }], maxMemory: 20,
        memoryJournals: [], autoMemorySettings: { useMemory: true, contextInjectionOptIn: true, keepRecent: 0 } };
    const enabled = { st: true, tt: true };
    const c = vm.createContext({ window: {}, document: { addEventListener() {}, getElementById() { return null; } },
        db: { characters: [chat], groups: [] }, crypto: { randomUUID: () => String(++serial) }, saveData: async () => {},
        UvUStoryBridge: { allowedMemory: (_chat, journal) => enabled[journal.bridgeReview?.channel || 'st'] && journal.bridgeReview?.status === 'approved' }, console });
    for (const file of ['character_memos.js', 'auto_memory.js', 'memory_library.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules', file), 'utf8'), c);
    const summary = { id: 'summary', title: '约定', content: '周五还书', range: { start: 1, end: 1 }, createdAt: 1,
        autoMemory: { version: 1, kind: 'summary', committed: true, sources: [{ id: 'm', hash: c.autoMemoryMessageHash(chat.history[0]) }] } };
    return { c, chat, enabled, summary };
}

function memoJournal(f) {
    const {c,chat}=f,note={id:'memo1',owner:c.characterMemoIdentity(chat),fact:'周五还书',content:'记得提醒你',subject:'user',status:'approved',sources:[{id:'m',fingerprint:c.characterMemoFingerprint(chat.history[0])}],useContext:true};
    chat.characterMemos={settings:{enabled:true},notes:[note]};
    const journal={id:'memo-journal',source:'character-memo',characterMemoId:note.id,content:'周五还书',title:'约定',isFavorited:true};chat.memoryJournals.push(journal);return {note,journal};
}
test('a memo copied into diary cannot bypass edited-source invalidation or a changed user persona',()=>{
    const f=fixture(),{c,chat}=f;memoJournal(f);assert.equal(c.getContextMemoryJournals(chat).length,1);
    chat.history[0].content='已取消约定';assert.equal(c.getContextMemoryJournals(chat).length,0);assert.ok(!c.getVectorMemoryCandidates(chat).some(j=>j.id==='memo-journal'));
    chat.history[0].content='周五还书';chat.myName='另一个用户';assert.equal(c.getContextMemoryJournals(chat).length,0);
});
test('merged memo diaries retain source checks after original journal removal',async()=>{
    const f=fixture(),{c,chat}=f,{journal}=memoJournal(f),manual={id:'other',title:'其他',content:'普通记录',isFavorited:true};chat.memoryJournals.push(manual);
    const first=await c.saveLibraryMemory(chat,{title:'一次合并',content:'两项记录'},{sources:[journal,manual]});
    const second=await c.saveLibraryMemory(chat,{title:'再次合并',content:'两项记录的摘要'},{sources:[first]});
    assert.ok(c.getContextMemoryJournals(chat).includes(second));chat.memoryJournals=chat.memoryJournals.filter(j=>j!==journal);
    chat.history[0].isWithdrawn=true;assert.ok(!c.getContextMemoryJournals(chat).includes(second));assert.ok(!c.getVectorMemoryCandidates(chat).includes(second));
});
test('memo diary has independent enable switch but requires a live unexpired approved fact',()=>{
    const f=fixture(),{c,chat}=f,{note}=memoJournal(f);chat.characterMemos.settings.enabled=false;
    assert.equal(c.getContextMemoryJournals(chat).length,1,'explicit diary use stays independent of memo feature enable');
    note.status='superseded';assert.equal(c.getContextMemoryJournals(chat).length,0);note.status='approved';note.expiresAt=1;assert.equal(c.getContextMemoryJournals(chat).length,0);
    note.expiresAt=null;note.fact='改过的新约定';assert.equal(c.getContextMemoryJournals(chat).length,0);chat.characterMemos.notes=[];assert.equal(c.getContextMemoryJournals(chat).length,0);
});
test('new memo diary snapshots preserve origin through diary text edits and reject expired export',()=>{
    const f=fixture(),{c,chat}=f,{note}=memoJournal(f),journal=c.characterMemoToJournal(chat,note);journal.isFavorited=true;journal.content='用户校订后的日记';chat.memoryJournals=[journal];
    assert.equal(c.getContextMemoryJournals(chat).length,1);note.fact='来源事实已变';assert.equal(c.getContextMemoryJournals(chat).length,0);
    note.fact='周五还书';note.expiresAt=1;assert.throws(()=>c.characterMemoToJournal(chat,note),/到期|来源|确认/);
});
test('diary source diagnostic explains the invalid memo without requesting vectors',()=>{
    const f=fixture(),{c,chat}=f,{journal}=memoJournal(f);chat.history[0].isWithdrawn=true;
    const explanation=c.getMemoryUsageExplanation(chat,journal);assert.match(explanation.reason,/备忘录.*撤回/);assert.equal(c.getVectorMemoryDiagnostics(chat).query,undefined);
});
test('mixed and repeated manual merges retain ST and TT source permission through snapshots and undo', async () => {
    const { c, chat, enabled } = fixture();
    const st = { id: 'st', title: 'ST', content: '事实甲', source: 'sillytavern', isFavorited: true, bridgeReview: { channel: 'st', archiveId: 'a', status: 'approved' } };
    const tt = { ...st, id: 'tt', title: 'TT', content: '事实乙', bridgeReview: { ...st.bridgeReview, channel: 'tt' } };
    const manual = { id: 'manual', title: '手动', content: '事实丙', isFavorited: true };
    chat.memoryJournals.push(st, tt, manual);
    const merged = await c.saveLibraryMemory(chat, { title: '合并', content: '甲乙' }, { sources: [st, tt] });
    assert.equal(merged.manualMergeSources[0].source, 'sillytavern');
    assert.equal(merged.manualMergeSources[1].bridgeReview.channel, 'tt');
    const again = await c.saveLibraryMemory(chat, { title: '再次合并', content: '甲乙丙' }, { sources: [merged, manual] });
    assert.ok(c.getContextMemoryJournals(chat).some(item => item.id === again.id));
    for (const channel of ['st', 'tt']) {
        enabled[channel] = false;
        assert.ok(!c.getContextMemoryJournals(chat).some(item => item.id === again.id), channel + ' revoked');
        assert.ok(!c.getVectorMemoryCandidates(chat).some(item => item.id === again.id), channel + ' vector revoked');
        enabled[channel] = true;
    }
    // Deleting an original cannot erase the permissions preserved at merge time.
    chat.memoryJournals = chat.memoryJournals.filter(item => item.id !== 'st'); enabled.st = false;
    assert.ok(!c.getContextMemoryJournals(chat).some(item => item.id === again.id));
    enabled.st = true;
    await c.undoLibraryMemoryMerge(chat, again);
    assert.ok(c.getContextMemoryJournals(chat).some(item => item.id === merged.id));
});
test('summary manual replacement only hides raw floors while its effective replacement is injected', async () => {
    const { c, chat, summary } = fixture(); chat.memoryJournals.push(summary);
    const merged = await c.saveLibraryMemory(chat, { title: '整理', content: '周五还书' }, { sources: [summary] });
    assert.equal(c.getAutoMemoryContextHistory(chat).length, 0);
    merged.isFavorited = false;
    assert.deepEqual(Array.from(c.getAutoMemoryContextHistory(chat), item => item.id), ['m']);
    assert.equal(c.getContextMemoryJournals(chat).length, 0);
    merged.isFavorited = true; chat.memoryJournals = chat.memoryJournals.filter(item => item.id !== merged.id);
    assert.deepEqual(Array.from(c.getAutoMemoryContextHistory(chat), item => item.id), ['m']);
});
test('revoked imported replacement and unfavorited vector miss restore the summary source floor', async () => {
    const { c, chat, summary, enabled } = fixture();
    const source = { id: 'tt', title: '剧情', content: '其他约定', source: 'sillytavern', isFavorited: true, bridgeReview: { channel: 'tt', archiveId: 'a', status: 'approved' } };
    chat.memoryJournals.push(summary, source);
    const merged = await c.saveLibraryMemory(chat, { title: '混合', content: '两项约定' }, { sources: [summary, source] });
    enabled.tt = false;
    assert.equal(c.getAutoMemoryContextHistory(chat)[0].id, 'm');
    enabled.tt = true; merged.isFavorited = false; chat.autoMemorySettings.vectorSearchEnabled = true;
    assert.equal(c.buildPromptWithVectorMemory(chat, () => c.getAutoMemoryContextHistory(chat).map(item => item.content).join(''), ''), '周五还书');
    await c.undoLibraryMemoryMerge(chat, merged);
    assert.equal(c.getAutoMemoryContextHistory(chat).length, 0);
    assert.ok(c.getContextMemoryJournals(chat).some(item => item.id === 'summary'));
});
test('fact checklist preserves same-name attribution, unknown dates and contradictory commitments without requests', () => {
    const { c } = fixture();
    const result = c.getMemoryFactChecklist([{ id: 'one', floor: 1, speaker: '甲', content: '2026-11-09 小明答应周五还书。' },
        { id: 'two', floor: 2, speaker: '乙', content: '小明取消周五还书，待办仍是联系图书馆。' }]);
    assert.equal(result.length, 2); assert.equal(result[0].speaker, '甲'); assert.equal(result[1].speaker, '乙');
    assert.deepEqual(Array.from(result[0].dates), ['2026-11-09']); assert.equal(result[1].dates.length, 0);
    assert.match(result[1].commitments.join(' '), /取消/); assert.match(result[1].todos.join(' '), /待办/);
});
test('usage preview explains active replacement and source revocation without creating retrieval', async () => {
    const { c, chat, enabled } = fixture();
    const source = { id: 'st', source: 'sillytavern', isFavorited: true, title: '源', content: '约定', bridgeReview: { channel: 'st', archiveId: 'a', status: 'approved' } };
    chat.memoryJournals.push(source);
    const merged = await c.saveLibraryMemory(chat, { title: '整理', content: '约定' }, { sources: [source] });
    assert.equal(c.getMemoryUsageExplanation(chat, merged).status, '收藏引用');
    assert.equal(c.getMemoryUsageExplanation(chat, chat.memoryJournals.find(item => item.id === source.id)).status, '已由合并结果替代');
    enabled.st = false; assert.equal(c.getMemoryUsageExplanation(chat, merged).status, '来源停用');
    assert.equal(c.getVectorMemoryDiagnostics(chat).query, undefined);
});
