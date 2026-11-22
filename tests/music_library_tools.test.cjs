const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const plain=v=>JSON.parse(JSON.stringify(v));
const song=(id,extra={})=>({provider:'netease',id,title:'歌曲 '+id,artists:['歌手'],album:'专辑',...extra});
const local=(id,extra={})=>song(id,{provider:'local',localId:id,...extra});
const list=(id,tracks,name=id)=>({id,name,tracks});
const source=tracks=>({provider:'netease',id:'123',name:'远端',sourceEndpoint:'https://one.test',tracks,partial:false,nextPage:2});
function harness(initial={},records=[]){
    const window=new EventTarget(),db={musicLibrary:initial,musicSettings:{endpoint:'https://one.test'}};
    const storage={getItem(){return null;},setItem(){},removeItem(){}};
    Object.assign(window,{crypto:webcrypto,navigator:{storage:{estimate:async()=>({quota:1e9,usage:0}),persist:async()=>true,persisted:async()=>false}}});
    const context=vm.createContext({window,db,URL,Blob,TextEncoder,TextDecoder,AbortController,DOMException,Event,EventTarget,CustomEvent:class extends Event{constructor(n,o){super(n);this.detail=o.detail;}},navigator:window.navigator,sessionStorage:storage,localStorage:storage,setTimeout,clearTimeout,saveData:async()=>{}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/music_core.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/music_library_tools.js'),'utf8'),context);
    const M=window.UvUMusic,L=window.UvUMusicLibraryTools,files=new Map(records.map(r=>[r.id,r])),h={M,L,files,context,db,writes:0,failSave:false,refs:[],snapshot:{}};
    let tail=Promise.resolve(),importCount=0;
    M.library=()=>({...M.normalizeLibrary(db.musicLibrary),tools:L.normalize(db.musicLibrary.tools)});
    M.mutateLibrary=fn=>{const promise=tail.catch(()=>{}).then(async()=>{const before=M.library(),next=fn(plain(before));if(h.failSave)throw Error('disk full');db.musicLibrary=next;h.writes++;return next;});tail=promise;return promise;};
    M.localFiles={list:async()=>[...files.values()],get:async id=>files.get(id),put:async r=>{if(h.failPut)throw Error('quota');files.set(r.id,r);},remove:async id=>{if(h.failRemove===id)throw Error('remove failed');files.delete(id);}};
    M.refreshLibrary=async()=>{h.onRefresh?.();return M.library();};
    M.withLocalFileLock=async fn=>fn();M.canLockLocalFiles=()=>true;M.localFileReferences=()=>h.refs;M.player.snapshot=()=>h.snapshot;
    M.importLocal=async(file,{signal}={})=>{if(signal?.aborted)throw new DOMException('cancelled','AbortError');if(file.name==='fail.mp3')throw Error('bad file');const id='import_'+(++importCount),track=M.normalizeTrack(local(id,{title:file.name,addedAt:Date.now()}));files.set(id,{id,blob:file});try{await M.mutateLibrary(lib=>{lib.favorites.push(track);return lib;});}catch(error){files.delete(id);throw error;}return track;};
    return h;
}
function audio(name,bytes='ID3audio'){const b=new Blob([bytes],{type:'audio/mpeg'});b.name=name;return b;}

test('module loading is inert and tools normalization strips malformed and credential data',()=>{
    const h=harness();assert.equal(h.writes,0);const t=h.L.normalize({token:'secret',drafts:{ok:{...source([song('1')]),sourceEndpoint:'https://user:pass@test/'},bad:{provider:'evil'}}});
    assert.equal(t.token,undefined);assert.equal(t.drafts.ok.sourceEndpoint,'');assert.equal(t.drafts.bad,undefined);
});
test('draft survives a fresh module and selection imports atomically with honest partial status',async()=>{
    const h=harness();const d=await h.L.saveDraft({...source([song('1'),song('1'),song('2')]),partial:true,total:42},'draft_1');assert.equal(d.tracks.length,2);
    const fresh=harness(plain(h.db.musicLibrary));assert.equal(fresh.L.loadDraft(d.draftId).total,42);
    const p=await fresh.L.importDraft(d.draftId,{selectedKeys:['netease:2']});assert.equal(p.partial,true);assert.equal(p.imported,1);assert.deepEqual(plain(p.tracks.map(t=>t.id)),['2']);assert.equal(fresh.L.loadDraft(d.draftId),null);assert.equal(fresh.M.library().tools.bindings[p.id].partial,true);
});
test('failed draft save/import rolls back and endpoint changes require fresh preview',async()=>{
    const h=harness();const d=await h.L.saveDraft(source([song('1')]));h.failSave=true;await assert.rejects(h.L.importDraft(d.draftId),/disk full/);assert.equal(h.M.library().playlists.length,0);assert.ok(h.L.loadDraft(d.draftId));h.failSave=false;h.db.musicSettings.endpoint='https://two.test';await assert.rejects(h.L.importDraft(d.draftId),/服务已更换/);
});
test('draft resume preserves failed-page continuation, but expired drafts revalidate from page one',async()=>{
    const h=harness();const d=await h.L.saveDraft({...source([song('1')]),partial:true,nextPage:3});let resume;
    h.M.previewPlaylist=async(a,b,c,d,r)=>{resume=r;return source([song('1'),song('2')]);};await h.L.resumeDraft(d.draftId);assert.equal(resume.nextPage,3);
    h.db.musicLibrary.tools.drafts[d.draftId].savedAt=1;await h.L.resumeDraft(d.draftId);assert.equal(resume,undefined);
});
test('sync preview makes no writes, preserves manual songs/local name, and add-only retains removals for later confirmation',async()=>{
    const h=harness({playlists:[list('p',[song('1'),song('2'),song('manual')],'本地名')]});await h.L.bindPlaylist('p',source([song('1'),song('2')]));await h.M.mutateLibrary(lib=>{lib.playlists[0].name='手动改名';return lib;});const count=h.writes;
    const p=h.L.previewSync('p',source([song('2'),song('3')]));assert.equal(h.writes,count);assert.equal(p.added.length,1);assert.equal(p.removed.length,1);assert.equal(p.localNamePreserved,true);
    await h.L.applySync(p.token,{rename:true});let current=h.M.library().playlists[0];assert.equal(current.name,'手动改名');assert.deepEqual(plain(current.tracks.map(t=>t.id)),['1','2','manual','3']);
    const second=h.L.previewSync('p',{...source([song('2'),song('3')]),name:'第二次远端名'});assert.equal(second.removed.length,1);await h.L.applySync(second.token,{remove:true,rename:true});current=h.M.library().playlists[0];assert.equal(current.name,'手动改名');assert.deepEqual(plain(current.tracks.map(t=>t.id)),['2','manual','3']);
});
test('sync partial pages cannot remove and stale previews/cancel/aborts make zero changes',async()=>{
    const h=harness({playlists:[list('p',[song('1')])]});await h.L.bindPlaylist('p',source([song('1')]));let p=h.L.previewSync('p',{...source([song('2')]),partial:true});await assert.rejects(h.L.applySync(p.token,{remove:true}),/完整/);
    h.L.cancelPreview(p.token);await assert.rejects(h.L.applySync(p.token),/过期/);
    p=h.L.previewSync('p',source([song('2')]));await h.M.mutateLibrary(lib=>{lib.playlists[0].tracks.push(song('new'));return lib;});await assert.rejects(h.L.applySync(p.token),/修改/);assert.equal(h.M.library().playlists[0].tracks.length,2);
    const c=new AbortController();c.abort();await assert.rejects(h.L.applySync(p.token,{signal:c.signal}),{name:'AbortError'});
});
test('copy/merge deduplicate by source ID, retain live recording, order and undo without altering playback',async()=>{
    const h=harness({playlists:[list('p',[song('1')]),list('q',[song('1'),song('live',{title:'歌曲 1'}),song('3')])]});h.snapshot={track:song('1'),queue:[song('1')],playing:true};
    const p=h.L.previewMerge('p',['q']);assert.equal(p.duplicates.length,1);const merge=await h.L.mergePlaylists(p.token);assert.deepEqual(plain(h.M.library().playlists[0].tracks.map(t=>t.id)),['1','live','3']);await h.L.undo(merge.undoToken);assert.equal(h.M.library().playlists[0].tracks.length,1);
    const copy=await h.L.copyPlaylist('q','复制');assert.notEqual(copy.playlist.id,'q');const order=await h.L.reorderPlaylist(copy.playlist.id,2,0);assert.deepEqual(plain(h.M.library().playlists.at(-1).tracks.map(t=>t.id)),['3','1','live']);await h.L.undo(order.undoToken);await h.L.undo(copy.undoToken);assert.equal(h.M.library().playlists.length,2);assert.equal(h.snapshot.playing,true);
});
test('undo refuses subsequent edits and failed operation produces no saved partial state',async()=>{
    const h=harness({playlists:[list('p',[song('1'),song('2')])]});const moved=await h.L.reorderPlaylist('p',0,1);await h.M.mutateLibrary(lib=>{lib.playlists[0].name='later';return lib;});await assert.rejects(h.L.undo(moved.undoToken),/后续修改/);h.failSave=true;await assert.rejects(h.L.copyPlaylist('p'),/disk full/);assert.equal(h.M.library().playlists.length,1);
});
test('dynamic rules read actual library, handle empty artist and never reorder manual playlists',async()=>{
    const h=harness({favorites:[song('b',{title:'Z',addedAt:10}),song('a',{title:'阿',artists:[]})],playlists:[list('p',[song('b'),song('c',{provider:'qq'})])]});const before=JSON.stringify(h.M.library().playlists);
    const id=await h.L.saveRule('QQ',{provider:'qq'});assert.deepEqual(plain(h.L.runRule(id).map(t=>t.id)),['c']);assert.equal(h.L.filterTracks({artist:'歌手',favorite:true}).length,1);h.db.musicLibrary.playlists=[];assert.equal(h.L.runRule(id).length,0);h.db.musicLibrary.playlists=JSON.parse(before);h.L.filterTracks({sort:'title',descending:true});assert.equal(JSON.stringify(h.M.library().playlists),before);
});
test('batch preview recognizes renamed equal content, keeps same-name differing content and imports selected files only',async()=>{
    const h=harness({},[{id:'old',blob:audio('old.mp3','same')}]);const p=await h.L.previewBatch([audio('renamed.mp3','same'),audio('same.mp3','different'),audio('same.mp3','different')]);assert.equal(h.writes,0);assert.deepEqual(plain(p.entries[0].duplicates),['old']);assert.equal(p.entries[1].duplicates.length,0);assert.deepEqual(plain(p.entries[2].duplicates),['batch:1']);const result=await h.L.importBatch(p.token);assert.equal(result.length,1);assert.equal(result[0].status,'success');assert.equal(h.M.library().favorites.length,1);assert.equal(h.files.size,2);
});
test('batch failure/cancel records each chosen result and preserves completed songs and original files',async()=>{
    const h=harness(),controller=new AbortController(),files=[audio('good.mp3','a'),audio('fail.mp3','b'),audio('later.mp3','c')],p=await h.L.previewBatch(files);
    const results=await h.L.importBatch(p.token,{selectedIndices:[0,1,2],signal:controller.signal,progress:({completed})=>{if(completed===2)controller.abort();}});assert.deepEqual(plain(results.map(r=>r.status)),['success','failed','cancelled']);assert.equal(h.M.library().favorites.length,1);assert.equal(files[0].size,1);assert.equal(await files[0].text(),'a');
});
test('quota preflight and abort avoid files or library writes',async()=>{
    const h=harness();h.context.window.navigator.storage.estimate=async()=>({quota:10,usage:10});await assert.rejects(h.L.previewBatch([audio('x.mp3')]),/空间不足/);assert.equal(h.files.size,0);assert.equal(h.writes,0);const c=new AbortController();c.abort();await assert.rejects(h.L.previewBatch([audio('x.mp3')],{signal:c.signal}),{name:'AbortError'});
});
test('audio migration contains bytes in real split packages and imports references consistently with fresh IDs',async()=>{
    const content='ID3'+('x'.repeat(3000)),original=local('audio1'),h=harness({favorites:[original],playlists:[list('p',[original])],tools:{token:'DO_NOT_EXPORT',bindings:{},playback:{token:'HIDDEN'}}},[{id:'audio1',blob:audio('one.mp3',content)}]);
    const exported=await h.L.exportAudioPackages({partSize:1024});assert.equal(exported.includesAudio,true);assert.equal(exported.audioCount,1);assert.equal(exported.files.length,3);for(const f of exported.files)assert.ok(!(await f.blob.text()).includes('DO_NOT_EXPORT'));
    const destination=harness({favorites:[local('audio1',{title:'Existing'})]},[{id:'audio1',blob:audio('old.mp3','original')}]),p=await destination.L.previewAudioImport(exported.files.map(f=>f.blob));assert.equal(destination.writes,0);const imported=await destination.L.importAudioPackages(p.token);assert.equal(imported.audioCount,1);assert.notEqual(imported.mapping.audio1,'audio1');assert.equal(await destination.files.get('audio1').blob.text(),'original');assert.equal(await destination.files.get(imported.mapping.audio1).blob.text(),content);const lib=destination.M.library();assert.equal(lib.favorites[1].id,lib.playlists[0].tracks[0].id);assert.equal(lib.favorites[1].localId,lib.playlists[0].tracks[0].localId);
});
test('audio packages reject corruption/missing parts before any mutation',async()=>{
    const h=harness({favorites:[local('a')]},[{id:'a',blob:audio('a.mp3','x'.repeat(2200))}]),out=await h.L.exportAudioPackages({partSize:1024}),target=harness();await assert.rejects(target.L.previewAudioImport(out.files.slice(1).map(f=>f.blob)),/缺失/);const damaged=out.files.map(f=>f.blob);const b=damaged[0];damaged[0]=new Blob([b.slice(0,b.size-1),'q']);await assert.rejects(target.L.previewAudioImport(damaged),/校验失败/);assert.equal(target.writes,0);assert.equal(target.files.size,0);
});
test('audio import save failure rolls back newly written audio and retains existing database',async()=>{
    const h=harness({favorites:[local('a')]},[{id:'a',blob:audio('a.mp3')}]),out=await h.L.exportAudioPackages(),target=harness({favorites:[song('existing')]},[{id:'existing',blob:audio('existing.mp3')}]),p=await target.L.previewAudioImport(out.files.map(f=>f.blob));target.failSave=true;await assert.rejects(target.L.importAudioPackages(p.token),/disk full/);assert.equal(target.files.size,1);assert.equal(target.M.library().favorites[0].id,'existing');
});
test('missing audio is reported, imported with isolated IDs, and can be relinked without changing track/card identity',async()=>{
    const h=harness({favorites:[local('missing')]}),out=await h.L.exportAudioPackages();assert.deepEqual(plain(out.missing),['missing']);const target=harness(),p=await target.L.previewAudioImport(out.files.map(f=>f.blob));assert.equal(p.missing.length,1);const result=await target.L.importAudioPackages(p.token),track=target.M.library().favorites[0],id=track.id;await target.L.relinkLocal(result.mapping.missing,audio('found.mp3'));assert.equal(target.M.library().favorites[0].id,id);assert.ok(target.files.has(track.localId));await assert.rejects(target.L.relinkLocal(track.localId,audio('other.mp3')),/已有音频/);
});
test('storage preview protects favorites, multiple playlists, playing audio and previously sent cards',async()=>{
    const h=harness({favorites:[local('shared')],playlists:[list('a',[local('shared')]),list('b',[local('shared')])]},['shared','playing','card','orphan'].map(id=>({id,blob:audio(id+'.mp3')})));h.refs=['card'];h.snapshot={track:local('playing')};const p=await h.L.previewCleanup();assert.deepEqual(plain(p.candidates.map(c=>c.id)),['orphan']);assert.equal(h.files.size,4);await assert.rejects(h.L.cleanup(p.token),/确认/);const result=await h.L.cleanup(p.token,{confirmed:true});assert.deepEqual(plain(result.removed),['orphan']);assert.equal(h.files.size,3);const usage=await h.L.storageUsage();assert.equal(usage.audioCount,3);assert.equal(usage.audioBytes,24);
});
test('cleanup refuses concurrent library edits and rechecks newly sent-card references inside lock',async()=>{
    const h=harness({},[{id:'orphan',blob:audio('x.mp3')}]);let p=await h.L.previewCleanup();await h.M.mutateLibrary(lib=>{lib.favorites.push(local('orphan'));return lib;});await assert.rejects(h.L.cleanup(p.token,{confirmed:true}),/已改变/);assert.equal(h.files.size,1);
    h.db.musicLibrary.favorites=[];p=await h.L.previewCleanup();h.refs=['orphan'];const result=await h.L.cleanup(p.token,{confirmed:true});assert.deepEqual(plain(result.retained),['orphan']);assert.equal(h.files.size,1);
});
test('cleanup rollback restores earlier removed files and refuses unsupported locking/reference checks',async()=>{
    const h=harness({},['a','b'].map(id=>({id,blob:audio(id+'.mp3')}))),p=await h.L.previewCleanup();h.failRemove='b';await assert.rejects(h.L.cleanup(p.token,{confirmed:true}),/remove failed/);assert.equal(h.files.size,2);delete h.M.localFileReferences;await assert.rejects(h.L.cleanup(p.token,{confirmed:true}),/聊天卡片/);h.M.localFileReferences=()=>[];delete h.M.withLocalFileLock;await assert.rejects(h.L.cleanup(p.token,{confirmed:true}),/锁定/);
});
test('persistent storage receipt does not claim a backup',async()=>{const h=harness();assert.deepEqual(plain(await h.L.requestPersistentStorage()),{supported:true,granted:true,isBackup:false});});
test('source metadata changes are previewed and update only songs without local edits',async()=>{
    const h=harness({playlists:[list('p',[song('1'),song('2')])]});await h.L.bindPlaylist('p',source([song('1'),song('2')]));await h.M.mutateLibrary(lib=>{lib.playlists[0].tracks[1].title='我的本地标题';return lib;});
    const p=h.L.previewSync('p',source([song('1',{title:'来源新标题'}),song('2',{title:'来源新标题2'})]));assert.equal(p.changed.length,2);assert.equal(p.changed[1].localEdited,true);await h.L.applySync(p.token,{updateMetadata:true});assert.equal(h.M.library().playlists[0].tracks[0].title,'来源新标题');assert.equal(h.M.library().playlists[0].tracks[1].title,'我的本地标题');
});
test('stale draft import and gateway changes after sync preview cannot write',async()=>{
    const h=harness({playlists:[list('p',[song('1')])]});const d=await h.L.saveDraft(source([song('1')]));h.db.musicLibrary.tools.drafts[d.draftId].savedAt=1;await assert.rejects(h.L.importDraft(d.draftId),/过期/);await h.L.bindPlaylist('p',source([song('1')]));const p=h.L.previewSync('p',source([song('2')]));h.db.musicSettings.endpoint='https://two.test';await assert.rejects(h.L.applySync(p.token),/已更换/);assert.equal(h.M.library().playlists[0].tracks[0].id,'1');
});
test('unheard rules opt into future tracking and read preserved real play timestamps',async()=>{
    const now=Date.now(),h=harness({favorites:[song('old'),song('recent'),song('unknown')],tools:{lastPlayed:{'netease:old':now-40*86400000,'netease:recent':now-86400000}}});assert.equal(h.M.library().tools.trackPlays,false);const id=await h.L.saveRule('30天未听',{unheardDays:30});assert.equal(h.M.library().tools.trackPlays,true);assert.deepEqual(plain(h.L.runRule(id).map(t=>t.id)),['old','unknown']);
});
test('cleanup detects same-size replaced audio and supports async persisted card references',async()=>{
    const h=harness({},[{id:'orphan',blob:audio('x.mp3','old')}]);h.M.localFileReferences=async()=>['persisted_card'];let p=await h.L.previewCleanup();h.files.set('orphan',{id:'orphan',blob:audio('x.mp3','new')});await assert.rejects(h.L.cleanup(p.token,{confirmed:true}),/文件已改变/);assert.equal(await h.files.get('orphan').blob.text(),'new');p=await h.L.previewCleanup();h.M.canLockLocalFiles=()=>false;await assert.rejects(h.L.cleanup(p.token,{confirmed:true}),/锁定/);
});
test('migration distinguishes a missing audio file from a missing direct source and isolates imported direct track identity',async()=>{
    const direct=local('direct',{localId:undefined,title:'直链歌曲'}),h=harness({favorites:[direct,local('missing_file')]});h.M.importURL('https://audio.test/current?token=PRIVATE_CREDENTIAL',direct);assert.equal(h.M.hasDirectSource(direct),true);
    const out=await h.L.exportAudioPackages();assert.equal(out.audioCount,0);assert.deepEqual(plain(out.missing),['missing_file']);assert.deepEqual(plain(out.missingSources),[{key:'local:direct',title:'直链歌曲'}]);assert.ok(!(await out.files[0].blob.text()).includes('PRIVATE_CREDENTIAL'));
    const target=harness({favorites:[direct]});target.M.importURL('https://audio.test/existing',direct);const p=await target.L.previewAudioImport(out.files.map(f=>f.blob));assert.equal(p.missingSources.length,1);assert.equal(p.missing.length,1);await target.L.importAudioPackages(p.token);const imported=target.M.library().favorites.find(t=>t.title==='直链歌曲'&&t.id!=='direct');assert.ok(imported);assert.equal(target.M.hasDirectSource(imported),false);assert.equal(target.M.hasDirectSource(direct),true);
    let usage=await target.L.storageUsage();assert.equal(usage.missingSources.length,1);const before=JSON.stringify(target.M.library());target.L.relinkSource(target.M.key(imported),'https://audio.test/restored?token=RESTORED_SECRET');assert.equal(target.M.hasDirectSource(imported),true);assert.equal(JSON.stringify(target.M.library()),before);assert.ok(!JSON.stringify(target.db).includes('RESTORED_SECRET'));usage=await target.L.storageUsage();assert.equal(usage.missingSources.length,0);assert.equal(usage.missing.length,1);
});
test('direct-source relinking rejects unsafe URLs and songs that already refer to stored audio',()=>{
    const h=harness({favorites:[local('file'),local('direct',{localId:undefined})]});assert.throws(()=>h.L.relinkSource('local:file','https://audio.test/source'),/不是/);assert.throws(()=>h.L.relinkSource('local:direct','javascript:alert(1)'),/HTTPS/);assert.equal(h.M.hasDirectSource(local('direct',{localId:undefined})),false);assert.equal(h.writes,0);
});
