// Regression for real touch clicks: do not disable the production rescue gesture here.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../outputs/memory20-native-photo');fs.mkdirSync(out,{recursive:true});
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



 await page.evaluate(()=>{document.getElementById('photo-video-btn').click();});
 const modal=page.locator('#send-pv-modal'),panel=modal.locator('.modal-window');await modal.waitFor({state:'visible'});
 assert.equal(await panel.locator('.draft-image-identity').count(),0,'Native photo dialog must not insert a character hero');
 assert.equal(await modal.getByRole('button',{name:'设置',exact:true}).isVisible(),false,'Text photo has no drawing controls');
 await modal.getByLabel('AI 生图',{exact:true}).check();
 assert.equal(await panel.evaluate(el=>el.classList.contains('uvu-sheet-v2')||el.classList.contains('uvu-mono-panel')),false,'AI stays in native modal');
 for(const [width,height]of [[320,740],[390,844],[402,420]]){
  await page.setViewportSize({width,height});
  assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'No horizontal overflow');
  assert.equal(await panel.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=8&&r.bottom<=innerHeight-8;}),true,'AI panel stays within the short viewport');
  await modal.getByRole('button',{name:'生成并发送',exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await modal.getByRole('button',{name:'生成并发送',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,'Submit remains reachable by internal scrolling');
  await panel.evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.join(out,'native-ai-'+width+'.png')});
 }
 await page.setViewportSize({width:390,height:844});await modal.getByLabel('文字图',{exact:true}).check();
 await page.screenshot({path:path.join(out,'native-text.png')});
 await modal.getByLabel('AI 生图',{exact:true}).check();await page.locator('#pv-text-input').fill('窗边的一杯茶');
 await page.evaluate(()=>{window.testImageCalls=0;window.executeImageGeneration=async()=>{window.testImageCalls++;const canvas=document.createElement('canvas');canvas.width=canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);return {imageData:canvas.toDataURL('image/png')};};});
 await page.setViewportSize({width:402,height:420});await page.locator('#pv-confirm-preview').check();await modal.getByRole('button',{name:'生成并发送',exact:true}).tap();
 await page.locator('#pv-generated-preview').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>testImageCalls),1);
 assert.equal(await page.locator('#global-rescue-panel').count(),0,'Image controls must not trigger background rescue');
 await page.screenshot({path:path.join(out,'native-generated.png')});
 assert.equal(await panel.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=8&&r.bottom<=innerHeight-8;}),true,'Generated preview remains contained');
 await modal.getByRole('button',{name:'确认发送',exact:true}).tap();await modal.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>testImageCalls),1,'Confirming a preview cannot generate twice');assert.match(await page.evaluate(()=>db.characters[0].history.at(-1).content),/^data:image\/png/);
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>document.getElementById('photo-video-btn').click());await modal.waitFor({state:'visible'});await modal.getByLabel('文字图',{exact:true}).check();
 await page.locator('#pv-text-input').fill('窗边的一杯茶');await modal.getByRole('button',{name:'发送',exact:true}).tap();
 await modal.waitFor({state:'hidden'});await page.waitForFunction(()=>db.characters[0].history.at(-1).content.includes('窗边的一杯茶'));assert.equal(await page.evaluate(()=>db.characters[0].history.at(-1).content.includes('窗边的一杯茶')),true);
 assert.deepEqual(errors,[]);console.log('PASS native text-photo modal, isolated AI controls, responsive layout and original send');
}finally{await browser.close();server.closeAllConnections();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
