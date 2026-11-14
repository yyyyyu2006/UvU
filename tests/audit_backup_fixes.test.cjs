const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Dexie = require('dexie');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
let serial = 0;
async function fixture(t) {
 const database = new Dexie(`uvu-audit-backup-${Date.now()}-${serial++}`, { indexedDB, IDBKeyRange });
 database.version(1).stores({characters:'&id',groups:'&id',worldBooks:'&id',myStickers:'&id',globalSettings:'key',customFonts:'&id',workshopHistory:'++id',workshopVibeGroups:'++id',characterPhotos:'++id',reader_books:'&id',reader_chapters:'&id',reader_comments:'++id'});
 await database.open(); t.after(()=>database.delete());
 const elements = new Map();
 const element = id => { if (!elements.has(id)) elements.set(id,{value:'',checked:false,innerText:'start',style:{},addEventListener(){}}); return elements.get(id); };
 const messages=[], timers=[];
 const c=vm.createContext({Dexie,console:{log(){},warn(){},error(){}},structuredClone,Blob,File,Response,ReadableStream,TextEncoder,CompressionStream,DecompressionStream,AbortController,URL,atob,btoa,window:{},document:{hidden:false,addEventListener(){},getElementById:element,createElement:()=>({style:{},remove(){}}),body:{appendChild(){}}},localStorage:{getItem(){return null},setItem(){}},showToast:m=>messages.push(m),alert:m=>messages.push(m),confirm:()=>true,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){}});
 for(const file of ['db.js','modules/chat_archives.js','modules/storage.js','modules/storage_features.js','modules/tutorial.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),c);
 c.dexieDB=database; c.db={characters:[{id:'original',persona:'original persona',history:[]}],groups:[],worldBooks:[],myStickers:[],apiSettings:{apiKey:'secret',url:'https://api.test'}}; await vm.runInContext('saveData()',c);
 return {c,database,element,messages,timers,mgr:c.window.GitHubMgr};
}
test('tutorial restore rejects malformed input without deleting persistent or live originals',async t=>{
 const f=await fixture(t); const original=f.c.db.characters;
 const result=await f.c.importBackupData({_exportVersion:'3.0',characters:[{id:'new',history:'bad'}]});
 assert.equal(result.success,false); assert.equal(f.c.db.characters,original);assert.equal((await f.database.characters.get('original')).persona,'original persona');
});
test('tutorial restore is atomic when any selected table fails and replaces complete chats on success',async t=>{
 const f=await fixture(t);const original=f.c.db.characters;
 const fail=()=>{throw new Error('quota test')};f.database.worldBooks.hook('creating',fail);
 const data={_exportVersion:'3.0',characters:[{id:'new',history:[]}],groups:[],worldBooks:[{id:'world'}]};
 assert.equal((await f.c.importBackupData(data)).success,false);assert.equal(f.c.db.characters,original);assert.ok(await f.database.characters.get('original'));assert.equal(await f.database.characters.get('new'),undefined);
 f.database.worldBooks.hook('creating').unsubscribe(fail);assert.equal((await f.c.importBackupData(data)).success,true);assert.equal(await f.database.characters.get('original'),undefined);assert.equal(f.c.db.characters.length,1);assert.equal(f.c.db.characters[0].id,'new');
});
test('full backup includes portable media, vectors and manifest and applies credential omission',async t=>{
 const f=await fixture(t);await f.database.reader_books.put({id:'book',title:'portable'});
 f.c.VectorMemoryTools={portableExport:async m=>{m.characters[0].memoryVectorIndex={portable:true}}};
 const backup=await f.c.createFullBackupData({includeCredentials:false});
 assert.equal(backup.modules.apiSettings.apiKey,'');assert.equal(backup.modules.mediaCache.tables.reader_books[0].id,'book');assert.equal(backup.modules.characters[0].memoryVectorIndex.portable,true);assert.equal(backup.backupManifest.resources,'external-links-preserved');assert.ok(Array.isArray(backup.modules.customFonts));
});
test('manual upload needs no window.event and does not trigger automatic duplicate',async t=>{
 const f=await fixture(t);f.element('gh-token-input').value='token';f.element('gh-repo-input').value='owner/repo';f.element('gh-auto-switch').checked=true;f.element('gh-interval-select').value='1';let uploads=0;f.mgr.performUpload=async()=>{uploads++};
 await f.mgr.testUpload();assert.equal(uploads,1);assert.equal(f.element('gh-backup-btn').innerText,'start');
});
test('corrupt and unavailable localStorage do not prevent GitHub manager initialization or saving',async t=>{
 const f=await fixture(t);f.c.localStorage.getItem=()=>'{bad';assert.doesNotThrow(()=>f.mgr.init());f.c.localStorage.setItem=()=>{throw new Error('quota')};assert.doesNotThrow(()=>f.mgr.saveConfig());
});
test('public repository is blocked before a private backup is packaged or PUT',async t=>{
 const f=await fixture(t);f.mgr.config={token:'test',repo:'owner/repo',includeCredentials:false};let puts=0;f.c.fetch=async(_url,opts)=>{if(opts.method==='PUT')puts++;return Response.json({private:false,permissions:{push:true}})};
 await assert.rejects(f.mgr.performUpload(()=>{}),/公开/);assert.equal(puts,0);
});
test('simultaneous uploads share one PUT and preserve snapshot name after JSON fallback',async t=>{
 const f=await fixture(t);f.c.CompressionStream=undefined;f.mgr.config={token:'test',repo:'owner/repo',fileName:'folder/backup',includeCredentials:false};let puts=0,payload;
 f.c.fetch=async(url,opts)=>{if(opts.method==='PUT'){puts++;payload=JSON.parse(opts.body);assert.match(url,/backup_.*[.]json/);return Response.json({content:{sha:'saved'}})}return Response.json({private:true,default_branch:'main',permissions:{push:true}})};
 await Promise.all([f.mgr.performUpload(()=>{}),f.mgr.performUpload(()=>{})]);assert.equal(puts,1);assert.equal(JSON.parse(Buffer.from(payload.content,'base64')).modules.apiSettings.apiKey,'');
});
test('bounded GitHub request cancels a stalled response and classifies uncertain PUT',async t=>{
 const f=await fixture(t);f.c.fetch=()=>new Promise(()=>{});const result=f.mgr.request('https://api.github.com/repos/o/r',{method:'PUT'},10);await f.timers.at(-1).fn();await assert.rejects(result,/核实/);
});
test('tutorial JSON export works without browser compression support',async t=>{
 const f=await fixture(t);f.c.CompressionStream=undefined;const output=await f.c.tutorialBackupBlob({modules:{worldBooks:[{id:'w'}]}});assert.equal(output.extension,'json');assert.equal(JSON.parse(await output.blob.text()).modules.worldBooks[0].id,'w');
});
test('legacy missing history chunk fails without deleting originals',async t=>{
 const f=await fixture(t);const result=await f.c.importBackupData({characters:[{id:'new',history:['absent']}],__chunks__:{}});assert.equal(result.success,false);assert.ok(await f.database.characters.get('original'));
});
test('full export snapshots live galleries before asynchronous vector export',async t=>{
 const f=await fixture(t);f.c.db.characters[0].gallery=[{url:'original'}];f.c.VectorMemoryTools={portableExport:async()=>{f.c.db.characters[0].gallery=[{url:'later'}]}};
 const backup=await f.c.createFullBackupData();assert.equal(backup.modules.mediaCache.characters[0].gallery[0].url,'original');
});
test('foreground schedule starts overdue backup once and visibility catch-up respects in-flight work',async t=>{
 const f=await fixture(t);f.mgr.config={token:'token',repo:'o/r',auto:true,lastTime:0,interval:1};let started=0;let release;f.mgr.performUpload=()=>{started++;f.mgr.inFlight=new Promise(resolve=>release=resolve);return f.mgr.inFlight};
 f.mgr.schedule();const timer=f.timers.at(-1);assert.equal(timer.ms,60000);timer.fn();await f.mgr.checkAndBackup();assert.equal(started,1);release();
});
test('tutorial full restore disables imported MCP grants and credentials',async t=>{
 const f=await fixture(t);f.c.window.MCPTransport={endpoint:v=>new URL(v).href};vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/mcp_services.js'),'utf8'),f.c);
 const result=await f.c.importBackupData({_exportVersion:'3.0',mcpSettings:{enabled:true,token:'secret',services:[{id:'m',url:'https://mcp.test',enabled:true,token:'secret'}],policies:[]}});
 assert.equal(result.success,true);const saved=(await f.database.globalSettings.get('mcpSettings')).value;assert.equal(saved.enabled,false);assert.equal(saved.services[0].enabled,false);assert.ok(!JSON.stringify(saved).includes('secret'));
});
test('cancelled slow body read settles with actionable cancellation instead of a locked-reader error',async t=>{
 const f=await fixture(t);f.mgr.controller=new AbortController();f.c.fetch=async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{})}}));
 const pending=f.mgr.request('https://api.github.com/repos/o/r');await new Promise(resolve=>setImmediate(resolve));f.mgr.cancel();await assert.rejects(pending,/取消或超时/);
});
test('storage sharing purpose omits API keys even when the individual checkbox was previously enabled',async t=>{
 const f=await fixture(t);f.element('storage-export-purpose').value='share';f.element('storage-export-credentials').checked=true;f.element('storage-export-format').value='json';let blob;
 f.c.URL={createObjectURL:value=>{blob=value;return 'blob:test'},revokeObjectURL(){}};f.c.document.createElement=()=>({click(){},remove(){}});
 await f.c.handleExport();assert.equal(JSON.parse(await blob.text()).modules.apiSettings.apiKey,'');
});
test('full restore replaces an explicitly empty font snapshot without changing missing categories',async t=>{
 const f=await fixture(t);await f.database.customFonts.put({id:'old'});const result=await f.c.importBackupData({modules:{customFonts:[]}});assert.equal(result.success,true);assert.equal(await f.database.customFonts.count(),0);assert.equal(f.c.db.characters[0].id,'original');
});
test('cancel during local tutorial parsing stops before confirmation and preserves data',async t=>{
 const f=await fixture(t);let resolveRead,confirmed=0,readOptions;f.c.storageReadBackup=async(_file,_selection,options)=>new Promise(resolve=>{readOptions=options;resolveRead=()=>resolve({characters:[]});options?.signal.addEventListener('abort',()=>resolveRead());});f.c.confirm=()=>{confirmed++;return true};const input={files:[new File(['{}'],'backup.json')],value:'chosen'};
 const pending=f.c.tutorialImportFile({target:input});await new Promise(resolve=>setImmediate(resolve));assert.ok(readOptions?.signal,'local reader must receive cancellation signal');f.mgr.cancel();resolveRead();await pending;assert.equal(confirmed,0);assert.equal(f.c.db.characters[0].id,'original');assert.equal(input.value,'');
});
test('full file read and restore preserves version 3 world-book positions without legacy conversion',async t=>{
 const f=await fixture(t);f.c.db.worldBooks=[{id:'w',type:'entry',position:'middle',content:'original position'}];const backup=await f.c.createFullBackupData();const parsed=await f.c.storageReadBackup(new File([JSON.stringify(backup)],'backup.json'),f.c.tutorialBackupSelection());assert.equal((await f.c.importBackupData(parsed)).success,true);assert.equal(f.c.db.worldBooks[0].position,'middle');
});
test('current module-envelope imports preserve world-book positions after bounded read',async t=>{
 const f=await fixture(t);const parsed=await f.c.storageReadBackup(new File([JSON.stringify({version:'current',modules:{worldBooks:[{id:'w',type:'entry',position:'middle'}]}})],'backup.json'),f.c.tutorialBackupSelection());assert.equal((await f.c.importBackupData(parsed)).success,true);assert.equal(f.c.db.worldBooks[0].position,'middle');
});
test('worker full-restore parser preserves modern envelope marker without altering raw legacy metadata',()=>{
 const c=vm.createContext({self:{}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/storage_backup_worker.js'),'utf8'),c);
 for(const [text,expected] of [['{"modules":{"worldBooks":[]}}','3.0'],['{"_exportVersion":"2.0","worldBooks":[]}','2.0']]){const parser=c.createBackupParser(['worldBooks','_exportVersion'],true);parser.write(text);assert.equal(parser.finish()._exportVersion,expected);}
});

test('cloud restore selects the newest remote snapshot rather than this device last upload', async t => {
 const f = await fixture(t), requests = [];
 const oldPath = 'backups/user_100_old.json', newPath = 'backups/user_200_new.json';
 const config = { token: 'fixture', repo: 'owner/repo', branch: 'main', fileName: 'backups/user', lastSnapshot: oldPath, lastSnapshotRepo: 'owner/repo', lastSnapshotBranch: 'main' };
 f.c.fetch = async url => {
  requests.push(url);
  if (new URL(url).pathname.endsWith('/contents/backups/')) throw new Error('unexpected trailing slash');
  if (new URL(url).pathname.endsWith('/contents/backups')) return Response.json([
   { type: 'file', name: 'user_100_old.json', path: oldPath },
   { type: 'file', name: 'user_200_new.json', path: newPath }
  ]);
  return Response.json({ modules: { characters: [{ id: url.includes('user_200_new') ? 'newest' : 'stale', history: [] }] } });
 };
 await f.mgr.restoreSnapshot(config);
 assert.equal(f.c.db.characters[0].id, 'newest');
 assert.ok(await f.database.characters.get('newest'));
 assert.ok(requests.every(url => new URL(url).searchParams.get('ref') === 'main'));
});

test('changing cloud backup prefix does not restore the old cached path', async t => {
 const f = await fixture(t), requests = [];
 const config = { token: 'fixture', repo: 'owner/repo', branch: 'main', fileName: 'new/place', lastSnapshot: 'old/place_100_id.json', lastSnapshotRepo: 'owner/repo', lastSnapshotBranch: 'main' };
 f.c.fetch = async url => {
  requests.push(url);
  if (new URL(url).pathname.endsWith('/contents/new')) return Response.json([{ type: 'file', name: 'place_200_id.json', path: 'new/place_200_id.json' }]);
  return Response.json({ modules: { characters: [{ id: url.includes('/contents/new/') ? 'selected-prefix' : 'wrong-prefix', history: [] }] } });
 };
 await f.mgr.restoreSnapshot(config);
 assert.equal(f.c.db.characters[0].id, 'selected-prefix');
 assert.ok(requests.every(url => !url.includes('/contents/old/')));
});

test('remote listing failure does not silently restore a stale cached snapshot', async t => {
 const f = await fixture(t);
 f.c.fetch = async () => new Response('{}', { status: 403 });
 await assert.rejects(f.mgr.restoreSnapshot({ token: 'fixture', repo: 'owner/repo', fileName: '', lastSnapshot: 'AutoBackup_1_x.json', lastSnapshotRepo: 'owner/repo' }), /403/);
 assert.equal(f.c.db.characters[0].id, 'original');
 assert.ok(await f.database.characters.get('original'));
});

test('cloud restore refuses ambiguous capped directories even with a local cached path', async t => {
 const f = await fixture(t);
 f.c.fetch = async () => Response.json(Array.from({ length: 1000 }, (_, i) => ({ type: 'file', name: `AutoBackup_${i}_x.json`, path: `AutoBackup_${i}_x.json` })));
 await assert.rejects(f.mgr.restoreSnapshot({ token: 'fixture', repo: 'owner/repo', fileName: '', lastSnapshot: 'AutoBackup_1_x.json', lastSnapshotRepo: 'owner/repo' }), /目录文件过多/);
 assert.equal(f.c.db.characters[0].id, 'original');
});

test('declining the newest cloud restore leaves persistent and live data untouched', async t => {
 const f = await fixture(t); let confirmed = '';
 f.c.confirm = message => { confirmed = message; return false; };
 f.c.fetch = async url => new URL(url).pathname.endsWith('/contents/')
  ? Response.json([{ type: 'file', name: 'AutoBackup_200_x.json', path: 'AutoBackup_200_x.json' }])
  : Response.json({ modules: { characters: [{ id: 'replacement', history: [] }] } });
 await f.mgr.restoreSnapshot({ token: 'fixture', repo: 'owner/repo', fileName: '' });
 assert.match(confirmed, /AutoBackup_200_x.json/);
 assert.equal(f.c.db.characters[0].id, 'original');
 assert.ok(await f.database.characters.get('original'));
 assert.equal(await f.database.characters.get('replacement'), undefined);
});

test('upload requested during cloud restore is rejected instead of sharing its success result', async t => {
 const f = await fixture(t); let finishRestore;
 f.mgr.restoreSnapshot = () => new Promise(resolve => { finishRestore = resolve; });
 const restoring = f.mgr.restoreLatest();
 const controller = f.mgr.controller;
 const uploading = f.mgr.performUpload();
 const rejected = assert.rejects(uploading, /另一个备份任务/);
 finishRestore();
 await restoring; await rejected;
 assert.equal(controller.signal.aborted, false);
 assert.equal(f.mgr.inFlight, null);
});

test('upload cannot replace the cancellation controller of a pending local import', async t => {
 const f = await fixture(t); let finishRead, uploads = 0;
 f.c.storageReadBackup = () => new Promise(resolve => { finishRead = resolve; });
 f.mgr.uploadSnapshot = async () => { uploads++; };
 const input = { files: [new File(['{}'], 'backup.json')], value: 'chosen' };
 const importing = f.c.tutorialImportFile({ target: input });
 const controller = f.mgr.controller;
 try {
  await assert.rejects(f.mgr.performUpload(), /另一个备份任务/);
  assert.equal(uploads, 0);
  assert.equal(f.mgr.controller, controller);
 } finally {
  controller.abort(); finishRead({ characters: [] }); await importing;
 }
 assert.equal(f.c.db.characters[0].id, 'original');
});

test('automatic backup skips local import without consuming its retry window', async t => {
 const f = await fixture(t); let finishRead, uploads = 0;
 f.c.storageReadBackup = () => new Promise(resolve => { finishRead = resolve; });
 f.mgr.config = { token: 'fixture', repo: 'owner/repo', auto: true, interval: 1, lastTime: 0 };
 f.mgr.performUpload = async () => { uploads++; };
 const importing = f.c.tutorialImportFile({ target: { files: [new File(['{}'], 'backup.json')], value: 'chosen' } });
 await f.mgr.checkAndBackup();
 assert.equal(uploads, 0); assert.equal(f.mgr.lastAttempt, 0);
 f.mgr.cancel(); finishRead({ characters: [] }); await importing;
 await f.mgr.checkAndBackup(); assert.equal(uploads, 1);
});

test('failed restore releases its task ownership so a subsequent upload can run', async t => {
 const f = await fixture(t); let uploads = 0;
 f.mgr.restoreSnapshot = async () => { throw new Error('simulated restore failure'); };
 await f.mgr.restoreLatest();
 assert.equal(f.mgr.inFlight, null); assert.equal(f.mgr.inFlightType, null); assert.equal(f.mgr.controller, null);
 f.mgr.uploadSnapshot = async () => { uploads++; };
 await f.mgr.performUpload();
 assert.equal(uploads, 1); assert.equal(f.mgr.inFlight, null); assert.equal(f.mgr.inFlightType, null);
});
