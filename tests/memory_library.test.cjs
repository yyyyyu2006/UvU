const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture() {
    const chat = { id: 'c', activeArchiveId: 'a', history: [], memoryJournals: [] };
    const c = vm.createContext({ db: { characters: [chat], groups: [] }, crypto: { randomUUID: () => 'new-id' },
        saveData: async () => {}, Date, console });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/memory_library.js'), 'utf8'), c);
    return { chat, c };
}
test('linked memo journals have a distinct source and summary fidelity retains missing commitments',()=>{
    const {c,chat}=fixture();const journals=[{id:'memo',source:'character-memo',content:'怕冷'},{id:'plain',content:'手动'}];
    assert.deepEqual(Array.from(c.queryMemoryLibrary(journals,{source:'character-memo'}).items,x=>x.id),['memo']);
    chat.history=[{id:'u',role:'user',content:'答应2026-11-14去看小李。还没买票。'}];
    const r=c.memorySummaryFidelity(chat,{content:'约好出去。',autoMemory:{sources:[{id:'u'}]}});
    assert.ok(r.warnings.some(x=>x.includes('2026-11-14')));assert.equal(r.rawCount,1);assert.equal(r.verified,false);
});
test('summary sentence lookup links only literal fragments in its own source floors',()=>{
    const {chat,c}=fixture();chat.history=[{id:'one',role:'user',content:'我不吃花生。约好周六见。'},{id:'two',role:'assistant',content:'周六见。'},{id:'foreign',role:'user',content:'火星旅行。'}];
    const journal={content:'我不吃花生。火星旅行。周六见。',autoMemory:{sources:[{id:'one'},{id:'two'}]}};
    const before=JSON.stringify(chat),rows=c.memorySummarySentenceLinks(chat,journal);
    assert.equal(rows[0].matches[0].floor,1);assert.equal(rows[1].matches.length,0);assert.equal(rows[2].matches.length,2);
    chat.history[0].isWithdrawn=true;assert.equal(c.memorySummarySentenceLinks(chat,journal)[0].matches.length,0);
    delete chat.history[0].isWithdrawn;assert.equal(JSON.stringify(chat),before);
});
test('refreshing derived memory entry never duplicates the management button',()=>{
    const {c}=fixture(),children=[],entry={append:el=>children.push(el)};
    c.document={querySelector:()=>entry,getElementById:id=>children.find(e=>e.id===id),createElement:()=>({})};
    c.setupMemoryLibrary();c.setupMemoryLibrary();assert.equal(children.length,1);
});
test('memory groups are kept within category and configured size', () => {
    const { c } = fixture();
    const entries = Array.from({ length: 13 }, (_, i) => ({ id: String(i), category: i === 12 ? '其他' : '剧情', createdAt: i }));
    const groups = c.memoryLibraryGroups(entries, 6);
    assert.deepEqual(Array.from(groups, group => group.sources.length), [6, 6, 1]);
    assert.equal(groups[2].category, '其他');
});
test('manual memories persist category and timeline, and only confirmed source memories are superseded', async () => {
    const { chat, c } = fixture();
    const first = { id: 'one', title: '旧记忆', content: '原文一', createdAt: 100, range: { start: 1, end: 2 } };
    const second = { id: 'two', title: '另一个分类', content: '原文二', category: '生活', createdAt: 200, range: { start: 3, end: 4 } };
    chat.memoryJournals.push(first, second);
    const saved = await c.saveLibraryMemory(chat, { title: '合并结果', content: '整理后的事实', category: '剧情', timeline: '2024年春' },
        { sources: [first], isCurrent: () => true });
    assert.equal(saved.timeline, '2024年春');
    assert.equal(chat.memoryJournals.find(item => item.id === 'one').vectorSupersededBy, saved.id);
    assert.equal(chat.memoryJournals.find(item => item.id === 'two').vectorSupersededBy, undefined);
    assert.equal(saved.manualMergeSources[0].content, '原文一');
});
test('failed manual-memory save restores the original journal list', async () => {
    const { chat, c } = fixture();
    const source = { id: 'source', title: '源记忆', content: '原文', createdAt: 123 };
    chat.memoryJournals.push(source);
    c.saveData = async () => { throw new Error('storage failure'); };
    await assert.rejects(c.saveLibraryMemory(chat, { title: '合并', content: '结果' }, { sources: [source], isCurrent: () => true }), /storage failure/);
    assert.deepEqual(chat.memoryJournals.map(item => item.id), ['source']);
    assert.equal(source.vectorSupersededBy, undefined);
});

test('failed manual save repairs its original archive while preserving the active branch and concurrent entries', async () => {
    const { chat, c } = fixture();
    const source = { id: 'source', title: 'Source', content: 'Original' };
    chat.memoryJournals = [source];
    chat.archives = [{ id: 'a', data: {} }, { id: 'b', data: { memoryJournals: [{ id: 'branch' }] } }];
    c.saveData = async () => {
        chat.archives[0].data.memoryJournals = JSON.parse(JSON.stringify(chat.memoryJournals));
        chat.archives[0].data.memoryJournals.push({ id: 'concurrent', title: 'Later' });
        chat.activeArchiveId = 'b'; chat.memoryJournals = [{ id: 'branch' }];
        throw new Error('quota');
    };
    await assert.rejects(c.saveLibraryMemory(chat, { title: 'Merged', content: 'Result' }, { sources: [source] }), /quota/);
    assert.deepEqual(Array.from(chat.memoryJournals, item => item.id), ['branch']);
    assert.deepEqual(Array.from(chat.archives[0].data.memoryJournals, item => item.id), ['source', 'concurrent']);
    assert.equal(chat.archives[0].data.memoryJournals[0].vectorSupersededBy, undefined);
});

test('manual save rollback preserves a later edit and later additions to the same list', async () => {
    const { chat, c } = fixture();
    c.saveData = async () => {
        chat.memoryJournals[0].content = 'Later edit';
        chat.memoryJournals.push({ id: 'later' });
        throw new Error('quota');
    };
    await assert.rejects(c.saveLibraryMemory(chat, { title: 'New', content: 'Draft' }), /quota/);
    assert.equal(chat.memoryJournals[0].content, 'Later edit');
    assert.equal(chat.memoryJournals[1].id, 'later');
});

test('failed memory deletion restores only its own entry and preserves concurrent changes', async () => {
    const { chat, c } = fixture();
    const removed = {id:'removed',content:'restore'}, deleted = {id:'deleted'}, edited = {id:'edited',content:'old'}, replaced = {id:'replaced',content:'old'};
    chat.memoryJournals = [removed,deleted,edited,replaced];
    const later = {id:'later'}, replacement = {id:'replaced',content:'new'};
    c.saveData = async () => {
        chat.memoryJournals.splice(0,1);
        edited.content = 'new';
        chat.memoryJournals.splice(1,1,replacement);
        chat.memoryJournals.push(later);
        throw Error('quota');
    };
    await assert.rejects(c.deleteLibraryMemory(chat,removed), /quota/);
    assert.deepEqual(Array.from(chat.memoryJournals,item=>item.id), ['removed','edited','replaced','later']);
    assert.equal(chat.memoryJournals[1],edited);
    assert.equal(edited.content,'new');
    assert.equal(chat.memoryJournals[2],replacement);
    assert.equal(chat.memoryJournals[3],later);
});

test('failed memory deletion repairs only its source archive after switching branches', async () => {
    const { chat, c } = fixture();
    const removed = {id:'removed'}, kept = {id:'kept'}, branch = [{id:'branch'}];
    chat.memoryJournals = [removed,kept];
    chat.archives = [{id:'a',data:{}},{id:'b',data:{memoryJournals:branch}}];
    c.saveData = async () => {
        chat.archives[0].data.memoryJournals = JSON.parse(JSON.stringify(chat.memoryJournals));
        chat.archives[0].data.memoryJournals.push({id:'later'});
        chat.activeArchiveId = 'b'; chat.memoryJournals = branch;
        throw Error('quota');
    };
    await assert.rejects(c.deleteLibraryMemory(chat,removed), /quota/);
    assert.equal(chat.memoryJournals,branch);
    assert.deepEqual(Array.from(chat.archives[0].data.memoryJournals,item=>item.id), ['removed','kept','later']);
});

test('failed memory deletion preserves a newer record with the same id', async () => {
    const { chat, c } = fixture();
    const removed = {id:'removed',content:'old'}, replacement = {id:'removed',content:'new'};
    chat.memoryJournals = [removed];
    c.saveData = async () => {chat.memoryJournals.push(replacement);throw Error('quota');};
    await assert.rejects(c.deleteLibraryMemory(chat,removed), /quota/);
    assert.equal(chat.memoryJournals.length,1);
    assert.equal(chat.memoryJournals[0],replacement);
});

test('memory deletion retains normal success and rejects stale callers', async () => {
    const { chat, c } = fixture();
    const removed = {id:'removed'}, kept = {id:'kept'}; chat.memoryJournals = [removed,kept];
    let saves=0; c.saveData=async()=>{saves++;};
    await assert.rejects(c.deleteLibraryMemory(chat,removed,{isCurrent:()=>false}), /变化/);
    assert.equal(saves,0);
    const next=await c.deleteLibraryMemory(chat,removed);
    assert.equal(next,chat.memoryJournals);
    assert.deepEqual(Array.from(next,item=>item.id), ['kept']);
    assert.equal(saves,1);
});

test('failed merge undo retains edits made while saving and repairs only untouched entries', async () => {
    const { chat, c } = fixture();
    const first={id:'first',content:'original'}, second={id:'second',content:'other'};
    chat.memoryJournals=[first,second];
    const merged=await c.saveLibraryMemory(chat,{title:'Merged',content:'Result'},{sources:[first,second]});
    let later;
    c.saveData=async()=>{
        later=chat.memoryJournals[0];later.content='concurrent edit';
        chat.memoryJournals.push({id:'later'});
        throw Error('quota');
    };
    await assert.rejects(c.undoLibraryMemoryMerge(chat,merged), /quota/);
    assert.equal(chat.memoryJournals.find(item=>item.id==='first'),later);
    assert.equal(later.content,'concurrent edit');
    assert.equal(chat.memoryJournals.find(item=>item.id==='second').vectorSupersededBy,merged.id);
    assert.equal(chat.memoryJournals.find(item=>item.id===merged.id),merged);
    assert.ok(chat.memoryJournals.some(item=>item.id==='later'));
});
