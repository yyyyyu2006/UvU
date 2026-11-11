// Reported November 11 regressions: real touch, isolated data, no paid calls.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../outputs/reported-ui-20261111');fs.mkdirSync(out,{recursive:true});
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
 await page.evaluate(()=>openRelationshipDialog());
 const autonomous=page.locator('.draft-relationship-rule').filter({has:page.locator('summary',{hasText:'角色自主判断'})});
 for(let i=0;i<3;i++){
  await autonomous.locator(':scope > summary').tap();
  assert.equal(await autonomous.locator('#relationship-autonomy-enabled').isVisible(),true,'autonomy controls stay inside their own disclosure after layout observers');
  await autonomous.locator(':scope > summary').tap();
 }
 assert.ok((await autonomous.boundingBox()).height<=52,'closed disclosure stays compact');
 await autonomous.locator(':scope > summary').tap();await autonomous.locator('#relationship-autonomy-enabled').check();
 await autonomous.getByRole('button',{name:/保存角色判断设置/}).tap();
 await page.waitForFunction(()=>db.characters[0].friendRelationship.autonomy.enabled);
 await autonomous.locator(':scope > summary').tap();
 assert.equal(await autonomous.locator('#relationship-autonomy-enabled').isChecked(),true);
 await page.screenshot({path:path.join(out,'relationship.png')});await page.locator('.relationship-dialog .sheet-close').tap();

 await page.evaluate(()=>{switchScreen('chat-list-screen');const c=db.characters[0],m={id:'incoming-one',role:'assistant',content:'[陆沉的消息：晚上一起去书店。]',timestamp:Date.now()};c.history.push(m);addMessageBubble(m,c.id,'private');showIncomingMessageNotifications(c,[m],c.id,'private');});
 assert.equal(await page.locator('#incoming-message-notifications .incoming-message-toast').count(),1);
 assert.equal(await page.locator('#toast-notification.show:not(.simple)').count(),0,'one owner: no legacy rich banner alongside derivative banner');
 await page.screenshot({path:path.join(out,'notification.png')});
 await page.evaluate(()=>document.getElementById('incoming-message-notifications').replaceChildren());
 await page.evaluate(()=>{openChatRoom('sheet-char','private');window.pendingReroll=showRegenerateGuidanceDialog();});
 const reroll=page.locator('.regenerate-guidance-card');await reroll.waitFor();await page.waitForTimeout(100);
 assert.ok((await reroll.boundingBox()).height<380,'reroll dialog returns to compact intrinsic height');
 await page.getByLabel('回复修改方向',{exact:true}).fill('保留刚才的地点');await page.screenshot({path:path.join(out,'reroll.png')});
 await reroll.locator('[data-action=reroll]').tap();assert.equal(await page.evaluate(()=>pendingReroll),'保留刚才的地点');

 await page.evaluate(()=>{openEnvironmentCalendar();});await page.locator('.calendar-weather').evaluate(el=>{el.textContent='武汉市 · 多云 · 12.6°C';});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:740});
  const weather=await page.locator('.calendar-weather').evaluate(el=>{const r=el.getBoundingClientRect(),body=el.closest('.calendar-body').getBoundingClientRect();return{y:r.y,h:r.height,top:body.top,line:parseFloat(getComputedStyle(el).lineHeight)};});
  assert.ok(weather.y>=weather.top&&weather.h>=weather.line,'weather has a complete visible line');
 }
 await page.screenshot({path:path.join(out,'calendar.png')});await page.locator('.uvu-calendar .sheet-close').tap();
 await page.evaluate(()=>openEnvironmentSettings(true));await page.locator('#environment-settings .uvu-sheet-v2').waitFor();
 for(const item of await page.locator('#environment-settings details:not([open])').all()){
  const box=await item.boundingBox();if(box)assert.ok(box.height<=56,'environment disclosures compact');
 }
 await page.screenshot({path:path.join(out,'environment.png')});await page.locator('#environment-settings .sheet-close').tap();
 await page.evaluate(()=>{const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';db.characters[0].history.push({id:'avatar-image',role:'user',content:'照片',parts:[{type:'image',data:png}]});openCharacterAvatarSettings();});
 const choices=page.locator('.avatar-candidate-actions');await choices.waitFor();
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  assert.equal(await choices.locator('label').evaluateAll(labels=>labels.every(label=>{const input=label.querySelector('input').getBoundingClientRect(),rect=label.getBoundingClientRect();return Math.abs((input.y+input.height/2)-(rect.y+rect.height/2))<3;})),true,'avatar choices align checkbox and label');
  assert.equal(await choices.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'avatar choices fit column');
 }
 await choices.locator('input[type=radio]').check();await choices.locator('input[type=checkbox]').check();
 assert.equal(await page.locator('.avatar-candidate-list > label input').isChecked(),true,'excluding preferred resets selection');
 await page.screenshot({path:path.join(out,'avatar.png')});await page.locator('#character-avatar-settings .sheet-close').tap();
 await page.evaluate(()=>switchScreen('api-settings-screen'));
 const pref=page.locator('#uvu-notification-preferences > summary'),test=page.locator('#system-notification-test');
 await test.scrollIntoViewIfNeeded();
 assert.ok((await pref.boundingBox()).height<=48,'notification preference entry stays inline');
 assert.ok((await test.boundingBox()).height<=36,'notification test stays small');
 await page.screenshot({path:path.join(out,'notification-settings.png')});
 assert.equal(await page.locator('#global-rescue-panel').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS disclosures retain controls across rerenders, single notification, compact reroll, weather, inline preferences');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
