// Real app DOM and local fixtures only. No accounts, paid APIs or rescue-counter bypass.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/persistence-browser');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),libs=new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m,i)=>[m[1],path.resolve(root,'../browser-test-assets',i+'.js')]));
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(p,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[path.extname(p)]||'application/octet-stream')+'; charset=utf-8');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
 await ctx.addInitScript(()=>{localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');});
 await ctx.route('**/*',r=>{const u=r.request().url();if(libs.has(u))return r.fulfill({path:libs.get(u),contentType:'application/javascript'});if(u.startsWith('https://fixture.invalid/')&&u.endsWith('/models'))return r.fulfill({json:{data:[{id:'fixture'}]}});return u.startsWith(origin)||u.startsWith('data:')||u.startsWith('blob:')?r.continue():r.abort();});

 const errors=[];
 async function openPage(){const page=await ctx.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');await page.evaluate(()=>GuideSystem.cleanup());return page;}
 const first=await openPage();
 await first.evaluate(async()=>{db.characters=[{id:'concurrent',realName:'测试角色',persona:'original',history:[{id:'m',role:'user',content:'original',timestamp:1}],memoryJournals:[],maxMemory:20,worldBookIds:[]}];db.groups=[];db.worldBooks=[{id:'original',content:'old'}];await saveData();});
 const second=await openPage();
 await first.evaluate(async()=>{try{await loadData();db.characters[0].memoryJournals=[{id:'new',content:'remote memory'}];await saveData();}catch(e){throw Error(e.name+': '+e.message);}});
 await second.evaluate(async()=>{currentChatId='concurrent';db.apiSettings.model='changed-setting';await saveData();});
 assert.equal(await first.evaluate(async()=>(await dexieDB.characters.get('concurrent')).memoryJournals[0].id),'new');
 const conflict=await second.evaluate(async()=>{db.characters[0].persona='local draft';try{await saveData();return '';}catch(e){return e.name+':'+e.message;}});
 assert.match(conflict,/DataConflictError/);
 assert.equal(await second.evaluate(()=>db.characters[0].persona),'local draft');
 assert.equal(await first.evaluate(async()=>(await dexieDB.characters.get('concurrent')).persona),'original');
 const before=await second.evaluate(()=>JSON.stringify(db.characters));
 await second.evaluate(async()=>{try{await storageCommitImport({contacts:true,chats:true},{characters:[{id:'concurrent',history:[],persona:'stale restore'}]});throw Error('expected conflict');}catch(e){if(e.name!=='DataConflictError')throw e;}});
 assert.equal(await second.evaluate(()=>JSON.stringify(db.characters)),before);
 await second.reload({waitUntil:'domcontentloaded'});await second.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
 const rollback=await second.evaluate(async()=>{const before=JSON.stringify(db.worldBooks);try{await dexieDB.transaction('rw',dexieDB.tables,async()=>{await storageCommitImport({worldbooks:true},{worldBooks:[{id:'transient',content:'temporary'}]});throw Error('outer abort');});}catch(e){if(!e.message.includes('outer abort'))throw e;}return {same:before===JSON.stringify(db.worldBooks),stored:await dexieDB.worldBooks.get('transient')};});
 assert.equal(rollback.same,true);assert.equal(rollback.stored,undefined);
 await second.evaluate(async()=>{await dexieDB.transaction('rw',dexieDB.tables,async()=>{await storageCommitImport({worldbooks:true},{worldBooks:[{id:'first',content:'one'}]});await storageCommitImport({worldbooks:true},{worldBooks:[{id:'second',content:'two'}]});});await saveData();});
 assert.deepEqual(await second.evaluate(async()=>(await dexieDB.worldBooks.toArray()).map(x=>x.id)),['second']);
 const revision=await first.evaluate(async()=>{const index={source:{version:2,chunks:[{key:'same',start:0,end:2,vector:[1,0]}]}};await VectorIndexStore.commit('browser-scope',index,'initial');return (await VectorIndexStore.read('browser-scope')).updatedAt;});
 await second.evaluate(async revision=>{await VectorIndexStore.commit('browser-scope',{source:{version:2,chunks:[{key:'same',start:0,end:2,vector:[0,1]}]}},'latest',undefined,revision);},revision);
 const vectorConflict=await first.evaluate(async revision=>{try{await VectorIndexStore.commit('browser-scope',{},'stale',undefined,revision);return '';}catch(e){return e.message;}},revision);
 assert.match(vectorConflict,/索引已更新/);assert.equal(await first.evaluate(async()=>(await VectorIndexStore.read('browser-scope')).fingerprint),'latest');
 await first.evaluate(async()=>{await loadData();window.homeDraft=await HomePresets.createPreset('并发测试',false);homeDraft.settings.homeSignature='new preset';await HomePresets.applyPreset(homeDraft);});
 const presetConflict=await second.evaluate(async()=>{const preset=await HomePresets.createPreset('stale',false);preset.settings.homeSignature='stale';try{await HomePresets.applyPreset(preset);return '';}catch(e){return e.name;}});
 assert.equal(presetConflict,'DataConflictError');
 await first.evaluate(async()=>{await HomePresets.undoPreset();await saveData();});
 await second.evaluate(async()=>{await loadData();await UvUMusic.rememberSearch('本地搜索');await UvUCalendar.saveMood({owner:'user',date:'2026-11-11',mood:'calm'});await MCPServices.save({enabled:false,services:[],policies:[]});await saveData();});
 assert.equal(await second.evaluate(async()=>(await dexieDB.globalSettings.get('musicLibrary')).value.searches[0]),'本地搜索');
 assert.equal(await second.evaluate(async()=>(await dexieDB.globalSettings.get('calendarData')).value.moods.length),1);
 await second.evaluate(()=>{GuideSystem.cleanup();switchScreen('home-screen');});
 await second.locator('.app-icon[data-target="tutorial-screen"]').click();
 await second.getByText('多窗口保存与索引冲突',{exact:true}).click();
 assert.match(await second.locator('#tutorial-content-area').textContent(),/先在本页/);
 assert.deepEqual(errors,[]);console.log('PASS real two-page IndexedDB: stale save/import/preset, unsaved draft, nested rollback/commit order, stale vector commit, music/calendar/MCP writes, tutorial');
 await ctx.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
