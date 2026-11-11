// Real app DOM and local fixtures only. No accounts, paid APIs or rescue-counter bypass.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/remaining-optimizations');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),libs=new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m,i)=>[m[1],path.resolve(root,'../browser-test-assets',i+'.js')]));
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(p,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[path.extname(p)]||'application/octet-stream')+'; charset=utf-8');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
 await ctx.addInitScript(()=>{localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');});
 await ctx.route('**/*',r=>{const u=r.request().url();if(libs.has(u))return r.fulfill({path:libs.get(u),contentType:'application/javascript'});return u.startsWith(origin)||u.startsWith('data:')||u.startsWith('blob:')?r.continue():r.abort();});
 const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
 await page.evaluate(async()=>{
  for(const key of ['guide_search_entry','guide_char_gallery','guide_group_summary','guide_group_notice','guide_group_gossip'])localStorage.setItem(key,'true');GuideSystem.cleanup();
  const c={id:'audit-role',realName:'陆沉',myName:'我',myPersona:'读书',persona:'教师',activeArchiveId:'main',maxMemory:20,worldBookIds:[],history:[{id:'one',role:'user',content:'我不吃花生。',timestamp:Date.now()}],memoryJournals:[{id:'j',title:'饮食记录',content:'我不吃花生。未知的旅行。',range:{start:1,end:1},isFavorited:true,createdAt:Date.now()}],moments:[{id:'post',author:'陆沉',content:'今天下课了',comments:[],likes:[]}]};db.characters=[c];db.groups=[];db.worldBooks=[];
  await addManualCharacterMemo(c,{fact:'喜欢喝绿茶'});await addManualCharacterMemo(c,{fact:'喜欢喝绿茶，少放糖'});
  await saveData();openChatRoom(c.id,'private');openCharacterMemos(c);
 });
 await page.getByRole('button',{name:'备忘录设置',exact:true}).tap();
 const memo=page.locator('#character-memos-dialog');assert.match(await memo.locator('.memo-settings-page').textContent(),/本存档 2\/500/);
 await memo.getByText('本轮可用记忆',{exact:true}).tap();assert.match(await memo.locator('.memo-diagnostics').first().textContent(),/备忘录未启用/);
 await memo.getByText('相近记录',{exact:true}).tap();await memo.getByRole('button',{name:'检查相近记录',exact:true}).tap();assert.equal(await memo.getByRole('button',{name:'查看第一条',exact:true}).count(),1);
 await memo.screenshot({path:path.join(out,'memo-diagnostics.png')});await memo.locator('.sheet-close').tap();
 await page.evaluate(()=>{setupMemoryLibrary();setupMemoryLibrary();openMemoryLibrary();});assert.equal(await page.locator('#memory-library-open').count(),1);
 await page.getByRole('button',{name:'阅读记忆',exact:true}).tap();const reader=page.locator('#draft-memory-reader');await reader.getByRole('button',{name:'查看原文',exact:true}).tap();await reader.getByText('逐句核对',{exact:true}).tap();
 await reader.getByRole('button',{name:'第 1 楼',exact:true}).tap();assert.match(await reader.locator('.draft-memory-original').textContent(),/无逐字匹配/);
 await page.evaluate(()=>db.characters[0].history[0].content='我现在改过这句话');await reader.getByRole('button',{name:'第 1 楼',exact:true}).tap();assert.match(await reader.locator('.draft-memory-original').textContent(),/原消息已变化/);
 await reader.screenshot({path:path.join(out,'summary-sources.png')});await reader.locator('.sheet-close').tap();await page.locator('.memory-library [data-action=close]').tap();
 await page.evaluate(async()=>{
  const c=db.characters[0],C=UvUCalendar,key=C.owner(c),date=C.addDays(C.today(),1);await C.saveProfile(key,{autonomy:true,reviewChanges:true});
  const a=await C.saveEvent({owner:key,title:'原备课',start:date,time:'09:00',endTime:'10:00'}),b=await C.saveEvent({owner:key,title:'保留散步',start:date,time:'18:00',endTime:'19:00'});
  window.auditOldIds=[a.id,b.id];db.apiSettings={...db.apiSettings,url:'https://fixture.invalid',key:'fixture',model:'fixture'};
  fetchAiResponse=async()=>JSON.stringify({events:[{action:'update',id:a.id,title:'调整备课',time:'10:00',endTime:'11:00'},{action:'delete',id:b.id}],mood:{mood:'calm'}});
  UvUCalendarAI.defer(c,await UvUCalendarAI.generate(c,date,undefined,{update:true}));
  localStorage.setItem('uvu-calendar-view.v1',JSON.stringify({side:'character:'+c.id,date,month:date.slice(0,7),mode:'schedule'}));openEnvironmentCalendar();
 });
 const cal=page.locator('.uvu-calendar');await cal.getByText('更多操作',{exact:true}).tap();await cal.getByRole('button',{name:'审核安排',exact:true}).tap();const plan=page.locator('#calendar-plan-preview');assert.match(await plan.textContent(),/原安排：09:00 原备课/);
 assert.equal(await plan.locator('.calendar-check').first().evaluate(el=>getComputedStyle(el).flexDirection),'row','review checkboxes stay beside their action labels');
 await plan.getByLabel(/^删除 ·/).uncheck();await plan.screenshot({path:path.join(out,'calendar-review.png')});await plan.getByRole('button',{name:'保存',exact:true}).tap();await plan.waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>UvUCalendar.state().events.map(e=>e.title)),['调整备课','保留散步']);assert.equal(await page.evaluate(()=>UvUCalendar.state().moods.length),0);
 await cal.getByRole('button',{name:'日历设置',exact:true}).tap();assert.equal(await page.locator('#calendar-preferences').getByLabel('自动安排先审核',{exact:true}).isChecked(),true);await page.locator('#calendar-preferences .sheet-close').tap();await cal.locator('.sheet-close').tap();
 await page.evaluate(async()=>{const c=db.characters[0];await UvUMoments.configure(c,{enabled:true,charReplies:true,cooldown:5});fetchAiResponse=async()=>JSON.stringify({action:'comment',content:'结束了一天的课。',replyToCommentId:null});await UvUMomentsAI.generate(c,'post');UvUMomentsUI.settings(c);});
 await page.locator('.ms-dialog').getByText('本次互动',{exact:true}).tap();assert.match(await page.locator('.ms-dialog').textContent(),/请求 1\/1 次/);await page.locator('.ms-dialog .sheet-close').tap();
 await page.evaluate(()=>{
  openChatRoom(db.characters[0].id,'private');const bubble=document.createElement('button');bubble.textContent='本地语音诊断样本';document.getElementById('message-area').append(bubble);
  MiniMaxSpeech.inspect(bubble,{emotion:'happy',speed:1.1,pauseCount:1,segmentDetails:[{text:'明天一起去看书。',emotion:'happy',speed:1.1,pauses:[{after:'明天',seconds:.4}],usageCharacters:8,cacheHit:false},{text:'就这样约定了。',emotion:'calm',speed:1,pauses:[],usageCharacters:0,cacheHit:true}]});
 });
 const speech=page.locator('.minimax-message-diagnostic');await speech.getByText('语音详情',{exact:true}).tap();await speech.getByText('分段参数',{exact:true}).tap();assert.match(await speech.textContent(),/“明天”后停顿 0.4 秒/);assert.match(await speech.textContent(),/第 2 段 · calm · 语速 1 · 音频缓存/);assert.doesNotMatch(await speech.textContent(),/<#|<emotion/);await speech.screenshot({path:path.join(out,'speech-segments.png')});
 await page.evaluate(()=>switchScreen('uvu-story-bridge-screen'));await page.getByRole('button',{name:'去审核',exact:true}).tap();
 const rules=page.locator('#uvu-bridge-rule-preview');await rules.locator('summary').tap();await rules.getByLabel('检查剧情原文').fill('<content>审核正文。</content><status>秘密状态</status>');
 for(let i=0;i<6;i++)await rules.getByRole('button',{name:'检查正文',exact:true}).tap();assert.equal(await page.locator('#global-rescue-panel').count(),0,'ordinary Tavern controls do not open background rescue');assert.match(await rules.locator('pre').textContent(),/命中 content/);assert.doesNotMatch(await rules.locator('pre').textContent(),/秘密状态/);
 for(const [width,height]of [[320,740],[390,844],[402,420]]){await page.setViewportSize({width,height});assert.equal(await rules.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await rules.screenshot({path:path.join(out,'rule-preview-'+width+'.png')});}
 assert.deepEqual(errors,[]);console.log('PASS memo capacity/diagnostics/similarity, summary floor links/stale source, schedule review/selection/mood, NPC task report, Tavern rules, repeated setup and touch controls');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
