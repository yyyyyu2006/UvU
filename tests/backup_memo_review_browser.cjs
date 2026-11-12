// Regression for real touch clicks: do not disable the production rescue gesture here.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../outputs/backup-memo-review-20261112');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const libs=new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m,i)=>[m[1],path.resolve(root,'../browser-test-assets',i+'.js')]));
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!f.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(f,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream')+'; charset=utf-8');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
 await ctx.addInitScript(()=>{localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');});
 await ctx.route('**/*',r=>{const u=r.request().url();if(libs.has(u))return r.fulfill({path:libs.get(u),contentType:'application/javascript'});return u.startsWith(origin)||u.startsWith('data:')||u.startsWith('blob:')?r.continue():r.abort();});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='confirm'?d.dismiss():d.accept());
 await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
 await page.evaluate(async()=>{for(const key of ['guide_search_entry','guide_char_gallery','guide_group_summary','guide_group_notice','guide_group_gossip'])localStorage.setItem(key,'true');GuideSystem.cleanup();db.characters=[{id:'sheet-char',realName:'陆沉',remarkName:'陆沉',avatar:'',myAvatar:'',myName:'我',persona:'温和细致。',myPersona:'喜欢读书',maxMemory:20,worldBookIds:[],history:Array.from({length:60},(_,i)=>({id:'sheet-'+i,role:i%2?'assistant':'user',content:i%2?'周末一起去书店。':'我更喜欢不加糖的拿铁。',timestamp:Date.now()-i*1000})),memoryJournals:[]}];db.groups=[];db.worldBooks=[];db.backupReminderSettings={enabled:false};await saveData();openChatRoom('sheet-char','private');});


 if(process.env.CASE!=='memo'){
  await page.evaluate(()=>switchScreen('storage-analysis-screen'));
  await page.locator('#storage-backup-options .backup-module-checkbox').first().waitFor({state:'attached'});
  await page.locator('#storage-export-btn').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'backup-before.png')});
  assert.equal(await page.locator('#storage-import-label').isVisible(),true,'Import must be visible beside export without finding the earlier mode selector');
  await page.locator('[data-backup-mode="import"]').tap();
  assert.equal(await page.locator('#storage-export-btn').isVisible(),true,'Export also stays available');
  await page.locator('.backup-module-checkbox[data-key="chats"]').locator('..').tap();
  await page.locator('[data-backup-mode="export"]').tap();
  assert.equal(await page.locator('.backup-module-checkbox[data-key="chats"]').isChecked(),true,'Export and import keep independent selections');
  const chooser=page.waitForEvent('filechooser');await page.locator('#storage-import-label').tap();await chooser;
  assert.equal(await page.locator('[data-backup-mode="import"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.backup-module-checkbox[data-key="chats"]').isChecked(),false);
  await page.locator('#storage-import-file').setInputFiles({name:'test.json',mimeType:'application/json',buffer:Buffer.from('{"modules":{"worldBooks":[{"id":"import-test","name":"Test book","content":"Safe test"}]}}')});
  await page.locator('#storage-backup-progress').getByText('已取消，未写入数据。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>db.worldBooks.length),0,'Cancelled import must not write');
  assert.equal(await page.locator('#storage-import-label').isEnabled(),true);
  await page.locator('#storage-import-file').setInputFiles({name:'bad.ee',mimeType:'application/octet-stream',buffer:Buffer.from('invalid backup')});
  await page.locator('#storage-backup-progress').getByText('导入失败，原数据保留。',{exact:true}).waitFor();
  assert.equal(await page.locator('#storage-import-label').isEnabled(),true,'Bad file releases the import control');
  assert.equal(await page.locator('#global-rescue-panel').count(),0,'Ordinary backup controls must not trigger CSS rescue');
  for(const [width,height]of [[320,740],[390,844],[402,420]]){
   await page.setViewportSize({width,height});await page.locator('#storage-import-label').scrollIntoViewIfNeeded();
   for(const id of ['storage-import-label','storage-export-btn'])assert.equal(await page.locator('#'+id).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   await page.screenshot({path:path.join(out,'backup-'+width+'.png')});
  }
  await page.setViewportSize({width:390,height:844});
 }
 if(process.env.CASE!=='backup'){
  await page.evaluate(async()=>{
   const chat=db.characters[0],source=chat.history.find(m=>m.role==='user');
   const base={owner:characterMemoIdentity(chat),subject:'user',category:'偏好',createdAt:Date.now(),useContext:true,sources:[{id:source.id,quote:source.content,fingerprint:characterMemoFingerprint(source)}]};
   chat.characterMemos={settings:{enabled:true,useContext:true,mode:'review'},notes:[{...base,id:'old',fact:'以前喜欢加糖',status:'approved'},{...base,id:'pending',fact:'喜欢不加糖',status:'pending'},{...base,id:'conflict',fact:'最近不加糖',status:'pending',replacesId:'old'}],blocked:[],processed:{}};
   await saveData();switchScreen('chat-room-screen');openCharacterMemos(chat);
  });
  const detail=page.locator('#character-memo-detail');
  const openNote=async fact=>{await page.locator('.memo-card').filter({has:page.getByRole('heading',{name:fact,exact:true})}).getByRole('button',{name:'审核',exact:true}).tap();await detail.waitFor();};
  await openNote('喜欢不加糖');
  assert.equal(await detail.getByRole('button',{name:'删除',exact:true}).count(),1,'Pending review needs a direct delete action');
  for(const [width,height]of [[320,740],[390,844],[402,420]]){
   await page.setViewportSize({width,height});await detail.evaluate(el=>el.getAnimations({subtree:true}).forEach(a=>a.finish()));
   const footer=detail.locator('footer');assert.equal(await footer.evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth+1;}),true);
   await page.screenshot({path:path.join(out,'review-'+width+'.png')});
  }
  await page.setViewportSize({width:390,height:844});
  await detail.getByRole('button',{name:'删除',exact:true}).tap();await detail.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.some(n=>n.id==='pending')),false);
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.blocked.length),0,'Delete does not suppress future extraction');
  assert.equal(await page.evaluate(()=>db.characters[0].history.length),60,'Delete preserves source messages');
  await page.getByRole('button',{name:'撤销删除',exact:true}).tap();
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.some(n=>n.id==='pending')),true);
  await openNote('最近不加糖');
  for(const [width,height]of [[320,740],[402,420]]){
   await page.setViewportSize({width,height});
   assert.equal(await detail.locator('footer').evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth+1;}),true,'Conflict review actions stay inside narrow and short screens');
   await page.screenshot({path:path.join(out,'conflict-'+width+'.png')});
  }
  await page.setViewportSize({width:390,height:844});await detail.getByRole('button',{name:'删除',exact:true}).tap();await detail.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.find(n=>n.id==='old').status),'approved','Deleting proposed replacement preserves original');
  await page.getByRole('button',{name:'撤销删除',exact:true}).tap();
  await openNote('最近不加糖');await detail.getByRole('button',{name:'忽略',exact:true}).tap();await detail.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.blocked.length),1);
  await page.getByRole('button',{name:'撤销删除',exact:true}).tap();
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.blocked.length),0,'Undo ignore removes its suppression');
  await openNote('喜欢不加糖');
  await page.evaluate(()=>{window.savedMemoTransaction=dexieDB.transaction;dexieDB.transaction=async()=>{throw Error('disk test failure');};});
  await detail.getByRole('button',{name:'删除',exact:true}).tap();await detail.getByText('disk test failure',{exact:true}).waitFor();
  assert.equal(await detail.getByRole('button',{name:'删除',exact:true}).isEnabled(),true);
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.some(n=>n.id==='pending')),true,'Failed persistence keeps draft and note');
  await page.evaluate(()=>{dexieDB.transaction=window.savedMemoTransaction;db.characters[0].characterMemos.notes.find(n=>n.id==='pending').content='newer edit';});
  await detail.getByRole('button',{name:'删除',exact:true}).tap();await detail.getByText('记录已变化，请重新打开后审核',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.some(n=>n.id==='pending')),true);
  await detail.locator('.sheet-close').tap();await openNote('最近不加糖');
  await page.evaluate(()=>{db.characters[0].myName='another persona';});
  await detail.getByRole('button',{name:'删除',exact:true}).tap();await detail.getByText('当前角色、存档或用户已改变，请重新打开备忘录',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.some(n=>n.id==='conflict')),true);
  await page.evaluate(()=>{db.characters[0].myName='我';});await detail.locator('.sheet-close').tap();await openNote('最近不加糖');
  await page.evaluate(()=>{window.memoDeleteCalls=0;window.savedMemoDelete=deleteCharacterMemo;deleteCharacterMemo=async(...args)=>{window.memoDeleteCalls++;await new Promise(r=>setTimeout(r,150));return window.savedMemoDelete(...args);};});
  await detail.getByRole('button',{name:'删除',exact:true}).tap();
  assert.equal(await detail.getByRole('button',{name:'编辑',exact:true}).isEnabled(),false,'Editing also waits for delete to commit');
  await detail.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.memoDeleteCalls),1);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.some(n=>n.id==='conflict')),false,'Deletion survives reload');
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.find(n=>n.id==='old').status),'approved');
  await page.evaluate(()=>{openChatRoom('sheet-char','private');openCharacterMemos(db.characters[0]);});
  await openNote('喜欢不加糖');await detail.getByRole('button',{name:'确认记忆',exact:true}).tap();await detail.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.find(n=>n.id==='pending').status),'approved','Approve still works through shared review guard');
 }
 assert.deepEqual(errors,[]);console.log('PASS visible backup actions and guarded memo review deletion, undo, failure, stale scope, narrow/short screens');
}finally{await browser.close();server.closeAllConnections();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
