// Actual app and image decoding; generation is simulated and all external requests blocked.
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/image-preview-guards');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const libs=new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m,i)=>[m[1],path.resolve(root,'../browser-test-assets',i+'.js')]));
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!f.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(f,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream')+'; charset=utf-8');res.end(b);});});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await context.addInitScript(()=>{localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');});
  await context.route('**/*',route=>{const url=route.request().url();if(libs.has(url))return route.fulfill({path:libs.get(url),contentType:'application/javascript'});return url.startsWith(origin)||url.startsWith('data:')||url.startsWith('blob:')?route.continue():route.abort();});
  await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
  await page.evaluate(async()=>{
   for(const key of ['guide_search_entry','guide_char_gallery','guide_group_summary','guide_group_notice','guide_group_gossip'])localStorage.setItem(key,'true');
   GuideSystem.cleanup();db.characters=[{id:'preview-char',realName:'测试角色',remarkName:'测试角色',myName:'我',avatar:'',myAvatar:'',maxMemory:20,worldBookIds:[],history:[],memoryJournals:[]}];db.groups=[];
   db.workshopSettings={provider:'gpt',gptModel:'first-model',gptApiUrl:'https://unused.invalid',gptApiKey:'fixture'};
   await saveData();openChatRoom('preview-char','private');window.imagePurchases=0;
   window.executeImageGeneration=async()=>{imagePurchases++;const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,16,16);return{imageData:canvas.toDataURL('image/png')};};
  });
  await page.locator('#toggle-expansion-btn').click();await page.locator('#photo-video-btn').click();await page.locator('#pv-mode-ai').check();
  assert.equal(await page.locator('#pv-confirm-preview').isVisible(),true,'preview controls remain directly available in the native AI panel');
  await page.locator('#pv-confirm-preview').check();await page.locator('#pv-text-input').fill('窗边的一杯咖啡');
  await page.locator('#pv-send-btn').click();await page.locator('#pv-generated-preview').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.getElementById('pv-generated-confirm').disabled);
  assert.equal(await page.evaluate(()=>imagePurchases),1);assert.equal(await page.evaluate(()=>db.characters[0].history.length),0);
  await page.evaluate(()=>{db.workshopSettings.gptModel='changed-model';});
  await page.locator('#pv-generated-confirm').click();await page.waitForFunction(()=>/预览已失效/.test(document.getElementById('pv-generation-status').textContent));
  assert.equal(await page.evaluate(()=>imagePurchases),1);assert.equal(await page.evaluate(()=>db.characters[0].history.length),0);
  await page.screenshot({path:path.join(out,'stale-preview-390.png')});
  assert.equal(await page.locator('#global-rescue-panel').count(),0,'normal AI photo controls must not trigger the CSS rescue gesture');
  await page.locator('#pv-generated-regenerate').click();await page.waitForFunction(()=>imagePurchases===2&&!document.getElementById('pv-generated-confirm').disabled);
  await page.locator('#pv-generated-confirm').click();await page.waitForFunction(()=>db.characters[0].history.length===1);
  assert.equal(await page.evaluate(()=>imagePurchases),2);assert.equal(await page.evaluate(()=>db.characters[0].history[0].parts[1].type),'image');
  assert.deepEqual(errors,[]);console.log('PASS actual image preview, stale settings reject without generation, explicit regeneration, decoded preview and one confirmed message');
 } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.closeAllConnections();server.close();process.exitCode=1;});
