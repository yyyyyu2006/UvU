const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
function fixture(files = ['storage', 'character_memos', 'memory_library']) {
    const chat = { id:'audit', myName:'User', myPersona:'', activeArchiveId:'a', history:[], memoryJournals:[] };
    const c = vm.createContext({ console, Date, setTimeout, clearTimeout, AbortController,
        crypto:require('node:crypto').webcrypto, window:{}, db:{characters:[chat],groups:[]}, saveData:async()=>{} });
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules', file+'.js'),'utf8'),c);
    return {c,chat};
}
test('B01 backup rejects corrupt memo structures before import, including archived data', async () => {
    const {c,chat}=fixture(); const note=await c.addManualCharacterMemo(chat,{fact:'喜欢喝茶'});
    const good=structuredClone(chat.characterMemos);
    assert.doesNotThrow(()=>c.storageValidateModules({characters:[chat]}));
    assert.doesNotThrow(()=>c.storageValidateModules({characters:[{id:'legacy',history:[]}]}));
    const cases = [
        [s=>s.notes=[null], /notes\[0\]/],
        [s=>s.notes=[note,note], /ID/],
        [s=>s.notes[0].sources=[null], /sources\[0\]/],
        [s=>s.notes[0].createdAt=1e100, /createdAt/],
        [s=>s.notes[0].revisions=[null], /revisions\[0\]/],
        [s=>s.settings=[], /settings/],
        [s=>s.trash=[{deletedAt:1,note:null}], /trash\[0\].note/],
        [s=>s.task={status:'running',inputs:[null]}, /inputs\[0\]/],
        [s=>s.processed={owner:[]}, /processed/],
    ];
    for (const [mutate,error] of cases) {
        const state=structuredClone(good); mutate(state);
        assert.throws(()=>c.storageValidateModules({characters:[{id:'bad',characterMemos:state}]}),error);
        assert.throws(()=>c.storageValidateModules({characters:[{id:'bad',archives:[{id:'a',data:{characterMemos:state}}]}]}),error);
    }
});
test('B01 existing malformed memo records are isolated on read without deleting originals', async()=>{
    const {c,chat}=fixture(); const note=await c.addManualCharacterMemo(chat,{fact:'喜欢喝茶'});
    chat.characterMemos.notes.push(null,{id:'broken',owner:c.characterMemoIdentity(chat),fact:{bad:true}});
    chat.characterMemos.trash=[null];
    const original=JSON.stringify(chat.characterMemos);
    assert.deepEqual(Array.from(c.queryCharacterMemoRecords(chat),n=>n.id),[note.id]);
    assert.doesNotThrow(()=>c.inspectCharacterMemos(chat));
    assert.doesNotThrow(()=>c.characterMemoState(chat));
    assert.equal(JSON.stringify(chat.characterMemos),original,'reading cannot silently delete bad data');
});
test('B02 invalid journal time is rejected at import and never crashes an existing library',()=>{
    const {c}=fixture(); const journal={id:'j',title:'Tea',content:'Tea',createdAt:1e100};
    assert.throws(()=>c.storageValidateModules({characters:[{id:'c',memoryJournals:[journal]}]}),/createdAt/);
    assert.equal(c.queryMemoryLibrary([journal]).total,1);
    assert.equal(c.queryMemoryLibrary([journal],{from:'2026-01-01'}).total,0);
    for(const createdAt of [undefined,0,-1,Date.parse('1900-01-01'),Date.now()])
        assert.doesNotThrow(()=>c.storageValidateModules({characters:[{id:'c',memoryJournals:[{...journal,createdAt}]}]}));
});
test('B03 only journals qualified for this request can suppress an approved memo',async()=>{
    const {c,chat}=fixture(['auto_memory','character_memos']);
    chat.characterMemos={settings:{enabled:true,useContext:true},notes:[]};
    const note=await c.addManualCharacterMemo(chat,{fact:'喜欢喝茶'});note.pinned=true;
    chat.memoryJournals=[{id:'old',isFavorited:true,content:note.fact,vectorSupersededBy:'merged'}, {id:'merged',isFavorited:false,content:'其他事情'}];
    assert.equal(c.getContextMemoryJournals(chat).length,0);
    assert.equal(c.selectCharacterMemos(chat).length,1);
    assert.equal(c.inspectCharacterMemos(chat).rows[0].code,'selected');
    chat.memoryJournals=[{id:'active',isFavorited:true,content:note.fact}];
    assert.equal(c.selectCharacterMemos(chat).length,0);
    assert.equal(c.inspectCharacterMemos(chat).rows[0].code,'duplicate');
    chat.memoryJournals=[{id:'review',isFavorited:true,content:note.fact,autoMemory:{version:1,kind:'summary',committed:false},qualityReview:{status:'pending'}}];
    assert.equal(c.getContextMemoryJournals(chat).length,0);
    assert.equal(c.selectCharacterMemos(chat).length,1);
});

test('B01 unavailable memo journal diagnostics tolerate isolated bad records',()=>{const {c,chat}=fixture(['auto_memory','character_memos']);chat.characterMemos={notes:[null]};const j={id:'j',source:'character-memo',characterMemoId:'missing',content:'旧事实'};assert.doesNotThrow(()=>c.getMemoryUsageExplanation(chat,j));assert.equal(c.getMemoryUsageExplanation(chat,j).status,'来源停用');});
