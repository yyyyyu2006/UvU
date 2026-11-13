const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function harness(file,names){
 const noTest=Object.assign(()=>{},{test(){}});
 const c=vm.createContext({require:id=>id==='node:test'?noTest:require(id),__dirname,console,AbortController,AbortSignal,DOMException,Response,Blob,File,URL,TextEncoder,TextDecoder,structuredClone,setTimeout,clearTimeout,setImmediate,crypto:require('node:crypto').webcrypto});
 vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8')+'\nglobalThis.exportsForAudit={'+names+'};',c);return c.exportsForAudit;
}
function branchFixture(){const f=harness('archive_audit.test.cjs','fixture').fixture();
 for(const name of ['character_memos','auto_memory','memory_library'])vm.runInContext(fs.readFileSync('js/modules/'+name+'.js','utf8'),f.c);return f;}
test('branch retains merged memory without weakening foreign archive isolation',async()=>{
 const {c,chat}=branchFixture();chat.memoryJournals=[{id:'s',title:'源',content:'one',isFavorited:true,range:{start:1,end:1}}];
 await c.saveLibraryMemory(chat,{title:'合并',content:'合并事实'},{sources:chat.memoryJournals.slice()});
 assert.equal(c.getContextMemoryJournals(chat).length,1);await c.createBranchArchiveAtMessage('a1');
 assert.deepEqual(Array.from(c.getContextMemoryJournals(chat),j=>j.content),['合并事实']);
 const merged=chat.memoryJournals.find(j=>j.manualMergeSources);merged.manualMergeSources[0].memorySourceTarget.archiveId='foreign';
 assert.equal(c.getContextMemoryJournals(chat).length,0);
});
test('branch cannot recall manual or external facts recorded after its history cutoff',async()=>{
 const {c,chat}=branchFixture();chat.characterMemos={settings:{enabled:true,useContext:true},notes:['manual','external'].map((kind,i)=>({id:kind,owner:c.characterMemoIdentity(chat),fact:'未来事实'+i,subject:'user',status:'approved',pinned:true,createdAt:20,recordedAt:20,[kind]:true}))};
 await c.createBranchArchiveAtMessage('a1');assert.equal(c.selectCharacterMemos(chat).length,0);
 assert.equal(chat.archives.find(a=>a.id==='first').data.characterMemos.notes.length,2);
});
test('branch restores original fact when a later approved correction has no retained evidence',async()=>{
 const {c,chat}=branchFixture(),owner=c.characterMemoIdentity(chat);chat.characterMemos={settings:{enabled:true,useContext:true},notes:[
 {id:'old',owner,fact:'one',subject:'user',status:'superseded',pinned:true,validTo:20,sources:[{id:'u1',fingerprint:c.characterMemoFingerprint(chat.history[0])}],revisions:[{at:20,fact:'one',status:'approved',validTo:null}]},
 {id:'new',owner,fact:'two',subject:'user',status:'approved',pinned:true,sources:[{id:'u2',fingerprint:c.characterMemoFingerprint(chat.history.at(-1))}],conflictReview:{id:'old',decision:'replace',at:20}}]};
 await c.createBranchArchiveAtMessage('a1');assert.deepEqual(Array.from(c.selectCharacterMemos(chat),n=>n.fact),['one']);
});
test('calendar autonomous requests exclude withdrawn and hidden records',async()=>{
 const c=harness('calendar_ai.test.cjs','fixture').fixture();await c.UvUCalendar.saveProfile(c.UvUCalendar.owner(c.chat),{autonomy:true});
 c.chat.history.push(...['isWithdrawn','isRevoked','isHidden','isStatusUpdate'].map((flag,i)=>({id:'bad'+i,role:'user',content:'SECRET'+i,[flag]:true})));
 let sent;c.fetchAiResponse=async(_,body)=>{sent=JSON.stringify(body);return '{"events":[]}';};
 await c.UvUCalendarAI.generate(c.chat,'2026-11-07',undefined,{update:true});assert.doesNotMatch(sent,/SECRET/);assert.match(sent,/明天见/);
});
test('voice list does not fetch when the caller already cancelled',async()=>{
 let calls=0;const speech=harness('minimax_refinement.test.cjs','fixture').fixture({fetch:async()=>{calls++;return new Response('{}');}});
 const controller=new AbortController();controller.abort();
 await assert.rejects(speech.listVoices({apiKey:'fixture',endpoint:'https://api.minimax.chat/v1/t2a_v2'},controller.signal),{name:'AbortError'});assert.equal(calls,0);
});
test('failed scene setting restores only its captured channel after navigation',async()=>{
 const f=harness('story_bridge.test.cjs','harness').harness(async()=>({ok:true}));
 const c=f.context;c.db.uvuStoryBridgeSettings={handoffCharacterId:'char-1',injectionByCharacter:{'char-1':true},ttSettings:{injectionByCharacter:{'char-1':false}}};
 vm.runInContext(fs.readFileSync('js/modules/story_bridge.js','utf8').replace('window.UvUStoryBridge =','window.auditBridge={setSceneInjection};window.UvUStoryBridge ='),c);
 let reject;c.saveData=()=>new Promise((_,r)=>reject=r);const waiting=c.window.auditBridge.setSceneInjection(false);
 c.db.uvuStoryBridgeSettings.channel='tt';reject(Error('quota'));await assert.rejects(waiting,/quota/);
 assert.equal(c.db.uvuStoryBridgeSettings.injectionByCharacter['char-1'],true);
 assert.equal(c.db.uvuStoryBridgeSettings.ttSettings.injectionByCharacter['char-1'],false);
});
test('branch restores sources when the merged result includes messages after the cutoff',async()=>{
 const {c,chat}=branchFixture();chat.memoryJournals=[{id:'early',title:'早期',content:'one',isFavorited:true,range:{start:1,end:1}},{id:'late',title:'后期',content:'two',isFavorited:true,range:{start:5,end:5}}];
 await c.saveLibraryMemory(chat,{title:'合并',content:'contains future'},{sources:chat.memoryJournals.slice()});await c.createBranchArchiveAtMessage('a1');
 assert.deepEqual(Array.from(c.getContextMemoryJournals(chat),n=>n.id),['early']);
});
test('repeated branches remap nested own sources and still honor original source revocation',async()=>{
 const {c,chat}=branchFixture();chat.memoryJournals=[{id:'s',title:'源',content:'one',isFavorited:true,range:{start:1,end:1}}];
 const first=await c.saveLibraryMemory(chat,{title:'first',content:'first'},{sources:chat.memoryJournals.slice()});
 await c.saveLibraryMemory(chat,{title:'second',content:'second'},{sources:[first]});
 await c.createBranchArchiveAtMessage('a1');await c.createBranchArchiveAtMessage('a1');assert.equal(c.getContextMemoryJournals(chat).length,1);
 const merged=chat.memoryJournals.find(n=>n.content==='second');assert.equal(merged.manualMergeSources[0].manualMergeSources[0].memorySourceTarget.archiveId,chat.activeArchiveId);
});
test('branch restores the last evidenced memo text before a later manual edit',async()=>{
 const {c,chat}=branchFixture();chat.characterMemos={settings:{enabled:true,useContext:true},notes:[{id:'n',owner:c.characterMemoIdentity(chat),fact:'future edited text',subject:'user',status:'approved',pinned:true,sources:[{id:'u1',fingerprint:c.characterMemoFingerprint(chat.history[0])}],revisions:[{at:20,fact:'one',status:'approved',validTo:null}]}]};
 await c.createBranchArchiveAtMessage('a1');assert.deepEqual(Array.from(c.selectCharacterMemos(chat),n=>n.fact),['one']);
});
test('calendar rejects late analysis when an actual included older message changes',async()=>{
 const c=harness('calendar_ai.test.cjs','fixture').fixture();await c.UvUCalendar.saveProfile(c.UvUCalendar.owner(c.chat),{autonomy:true});
 c.chat.history.push(...Array.from({length:7},(_,i)=>({id:'hidden'+i,role:'user',content:'hidden',isHidden:true})));
 let release;c.fetchAiResponse=()=>new Promise(r=>release=r);const waiting=c.UvUCalendarAI.generate(c.chat,'2026-11-07',undefined,{update:true});
 c.chat.history[0].content='changed';release('{"events":[]}');await assert.rejects(waiting,{name:'AbortError'});
});
test('voice-list cancellation during a response prevents returning stale success',async()=>{
 const controller=new AbortController();let release;
 const speech=harness('minimax_refinement.test.cjs','fixture').fixture({fetch:()=>new Promise(r=>release=r)});
 const waiting=speech.listVoices({apiKey:'fixture',endpoint:'https://api.minimax.chat/v1/t2a_v2'},controller.signal);controller.abort();release(new Response('{}'));
 await assert.rejects(waiting,{name:'AbortError'});
});
