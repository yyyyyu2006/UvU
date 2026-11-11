// Evidence review and conflict choices, real DOM with isolated local data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../outputs/memo-priority-20261111');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const libs=new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m,i)=>[m[1],path.resolve(root,'../browser-test-assets',i+'.js')]));
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!f.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(f,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream')+'; charset=utf-8');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
 await ctx.addInitScript(()=>{localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');});
 await ctx.route('**/*',r=>{const u=r.request().url();if(libs.has(u))return r.fulfill({path:libs.get(u),contentType:'application/javascript'});return u.startsWith(origin)||u.startsWith('data:')||u.startsWith('blob:')?r.continue():r.abort();});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
 await page.evaluate(async()=>{for(const key of ['guide_search_entry','guide_char_gallery','guide_group_summary','guide_group_notice','guide_group_gossip'])localStorage.setItem(key,'true');GuideSystem.cleanup();db.characters=[{id:'sheet-char',realName:'陆沉',remarkName:'陆沉',avatar:'',myAvatar:'',myName:'我',persona:'温和细致。',myPersona:'喜欢读书',maxMemory:20,worldBookIds:[],history:[{id:'tea',role:'user',content:'我最近改喝红茶。',timestamp:Date.now()}],memoryJournals:[]}];db.groups=[];db.worldBooks=[];db.backupReminderSettings={enabled:false};const c=db.characters[0],owner=characterMemoIdentity(c);c.characterMemos={settings:{enabled:true,useContext:true},notes:[{id:'old',owner,fact:'喜欢绿茶',content:'记得泡绿茶',manual:true,status:'approved',category:'偏好',locked:true},{id:'new',owner,fact:'最近改喝红茶',content:'换成红茶',status:'pending',category:'偏好',replacesId:'old',sources:[{id:'tea',quote:'我最近改喝红茶。',fingerprint:characterMemoFingerprint(c.history[0])}]}]};await saveData();openChatRoom(c.id,'private');openCharacterMemos(c);});

 const row=()=>page.locator('.memo-card').filter({has:page.locator('h3',{hasText:'最近改喝红茶'})});
 await row().getByRole('button',{name:'审核',exact:true}).tap();
 const detail=page.locator('#character-memo-detail');
 assert.equal(await detail.locator('.memo-conflict').getByText('喜欢绿茶',{exact:true}).isVisible(),true,'old fact is visible before deciding');
 assert.equal(await detail.getByRole('button',{name:'替换旧记录',exact:true}).isDisabled(),true,'locked fact cannot be replaced');
 for(const [width,height]of [[320,740],[390,844],[402,420]]){await page.setViewportSize({width,height});assert.equal(await detail.locator('.memo-review-actions > button').evaluateAll(buttons=>buttons.every(b=>{const r=b.getBoundingClientRect();return r.width>=100&&r.height<=52;})),true,'conflict buttons use readable rows');}
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(out,'conflict.png')});
 await page.evaluate(()=>db.characters[0].characterMemos.notes[1].content='新的候选便签');
 await detail.getByRole('button',{name:'忽略',exact:true}).tap();
 assert.equal(await detail.getByText('记录已变化，请重新打开后审核',{exact:true}).isVisible(),true);
 assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.length),2,'a stale review cannot discard updated evidence');
 await detail.locator('.sheet-close').tap();await row().getByRole('button',{name:'审核',exact:true}).tap();
 await detail.getByRole('button',{name:'两条都保留',exact:true}).tap();await detail.waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>db.characters[0].characterMemos.notes.map(n=>n.status)),['approved','approved']);
 await page.locator('#character-memos-dialog .sheet-close').tap();
 await page.evaluate(()=>{const c=db.characters[0];c.history[0].content='原话已经编辑';openCharacterMemos(c);});
 assert.equal(await row().getByText('原消息已编辑',{exact:true}).isVisible(),true);
 await row().getByRole('button',{name:'查看',exact:true}).tap();
 await page.locator('#character-memo-detail').getByText('查看原消息',{exact:true}).tap();
 assert.equal(await page.locator('#character-memo-detail').getByText('原话已经编辑',{exact:true}).isVisible(),true);
 await page.locator('#character-memo-detail').getByRole('button',{name:'另存为手动记录',exact:true}).tap();
 const editor=page.locator('#character-memo-editor');await editor.getByLabel('记住的事情',{exact:true}).fill('手动确认喜欢红茶');await editor.getByRole('button',{name:'保存',exact:true}).tap();await editor.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.at(-1).manual),true);
 assert.equal(await page.locator('#global-rescue-panel').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS conflict review, locked original, coexist, source diagnosis and deliberate manual correction');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
