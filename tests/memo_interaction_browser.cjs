// Regression for real touch clicks: do not disable the production rescue gesture here.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../outputs/memo-click-debug');fs.mkdirSync(out,{recursive:true});
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
 await page.evaluate(async()=>{for(const key of ['guide_search_entry','guide_char_gallery','guide_group_summary','guide_group_notice','guide_group_gossip'])localStorage.setItem(key,'true');GuideSystem.cleanup();db.characters=[{id:'sheet-char',realName:'陆沉',remarkName:'陆沉',avatar:'',myAvatar:'',myName:'我',persona:'温和细致。',myPersona:'喜欢读书',maxMemory:20,worldBookIds:[],history:Array.from({length:60},(_,i)=>({id:'sheet-'+i,role:i%2?'assistant':'user',content:i%2?'周末一起去书店。':'我更喜欢不加糖的拿铁。',timestamp:Date.now()-i*1000})),memoryJournals:[]}];db.groups=[];db.worldBooks=[];db.backupReminderSettings={enabled:false};await saveData();openChatRoom('sheet-char','private');});

 await page.evaluate(()=>openCharacterMemos(db.characters[0]));
 await page.locator('#character-memos-dialog .uvu-sheet-v2').waitFor();
 await page.evaluate(()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;});
 for(const value of ['pending','pinned','active','pending','active']) await page.locator('[data-memo-filter="'+value+'"]').tap();
 assert.equal(await page.locator('#global-rescue-panel').count(),0,'normal memo controls must not trigger global CSS rescue');
 // An explicitly opened native rescue overlay must own hit testing even above a sheet.
 await page.evaluate(()=>{db.globalCss='/* keep custom theme */';showGlobalRescuePanel();});
 await page.waitForFunction(()=>!document.getElementById('global-rescue-panel').inert&&document.getElementById('character-memos-dialog').inert);
 for(const id of ['rescue-clear-btn','rescue-cancel-btn'])assert.equal(await page.locator('#'+id).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,id+' receives clicks');
 await page.locator('#rescue-cancel-btn').tap();await page.locator('#global-rescue-panel').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>db.globalCss),'/* keep custom theme */','cancel preserves theme');
 await page.getByRole('button',{name:'备忘录设置',exact:true}).tap();await page.getByRole('switch',{name:'启用备忘录',exact:true}).check();await page.getByRole('button',{name:'完成',exact:true}).tap();
 await page.getByRole('button',{name:'添加',exact:true}).tap();await page.getByLabel('记住的事情',{exact:true}).fill('喜欢下雨天');await page.getByRole('button',{name:'保存',exact:true}).tap();await page.locator('#character-memo-editor').waitFor({state:'detached'});
 await page.evaluate(()=>{fetchAiResponse=async()=> '[]';resolveAutoMemoryApi=()=>({provider:'newapi',url:'https://mock.invalid',key:'fake',model:'mock'});});
 await page.getByRole('button',{name:'备忘录设置',exact:true}).tap();
 await page.getByRole('button',{name:'整理聊天',exact:true}).tap();await page.waitForFunction(()=>document.querySelector('.memo-feedback').textContent.includes('新增 0 条'));
 await page.evaluate(()=>{db.characters[0].history.push({id:'new-after-run',role:'user',content:'我喜欢下雨天'});fetchAiResponse=async()=> '{}';});
 await page.getByRole('button',{name:'整理聊天',exact:true}).tap();await page.waitForFunction(()=>document.querySelector('.memo-feedback').textContent.includes('响应格式错误'));
 // A failed extraction must release the busy/close state and keep editing available.
 await page.getByRole('button',{name:'完成',exact:true}).tap();
 await page.getByRole('button',{name:'添加',exact:true}).tap();await page.locator('#character-memo-editor .sheet-close').tap();
 await page.screenshot({path:path.join(out,'memo-after-failed-extraction.png')});
 await page.locator('#character-memos-dialog .sheet-close').tap();
 // Original background rescue remains reachable; clicks on its own buttons don't re-trigger it.
 await page.evaluate(()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;for(let i=0;i<5;i++)document.body.click();});
 await page.locator('#global-rescue-panel').waitFor();await page.locator('#rescue-cancel-btn').tap();assert.equal(await page.locator('#global-rescue-panel').count(),0);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS touch controls, rescue isolation/cancel, manual memo save, empty extraction and original background gesture');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
