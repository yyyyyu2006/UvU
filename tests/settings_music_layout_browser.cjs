const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/ui-review');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync('index.html','utf8'),libs=new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m,i)=>[m[1],path.resolve(root,'../browser-test-assets',i+'.js')]));
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(p,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[path.extname(p)]||'application/octet-stream')+'; charset=utf-8');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});await context.addInitScript(()=>{localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');});await context.route('**/*',r=>{const u=r.request().url();if(libs.has(u))return r.fulfill({path:libs.get(u),contentType:'application/javascript'});return u.startsWith(origin)||u.startsWith('data:')||u.startsWith('blob:')?r.continue():r.abort();});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');await page.evaluate(()=>{document.addEventListener('pointerdown',()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;},true);db.characters=[{id:'ui-role',realName:'示例角色',myName:'我',persona:'人设示例',myPersona:'用户人设',avatar:'',history:[],worldBookIds:[]}];currentChatId='ui-role';currentChatType='private';switchScreen('chat-settings-screen');loadSettingsToSidebar();});
const failures=[];
const verify=(condition,message)=>{if(!condition)failures.push(message);};
await page.locator('#setting-my-persona').scrollIntoViewIfNeeded();
const tools=page.locator('#setting-my-persona + .document-edit-tools');
const buttons=await tools.locator('button').evaluateAll(bs=>bs.map(b=>({label:b.getAttribute('aria-label'),width:b.offsetWidth,height:b.offsetHeight,icons:b.querySelectorAll('svg').length})));
verify(buttons.length===2&&buttons.every(b=>b.width===32&&b.height===32&&b.icons===1),'expand/import must be equal 32px Lucide buttons: '+JSON.stringify(buttons));
if(buttons.every(b=>b.label)){
 await tools.getByRole('button',{name:'展开',exact:true}).click();await page.getByRole('textbox',{name:'展开编辑内容',exact:true}).fill('仅草稿，不写入人设');await page.getByRole('button',{name:'暂存关闭',exact:true}).click();
 verify(await page.locator('#setting-my-persona').inputValue()==='用户人设','draft close must preserve original persona');
 const chooser=page.waitForEvent('filechooser');await tools.getByRole('button',{name:'导入',exact:true}).click();verify((await chooser).isMultiple()===false,'import icon must still open the file picker');
}
await page.screenshot({path:path.join(out,'editor-buttons-390.png')});
await page.evaluate(()=>{
 window.reviewOriginal=JSON.stringify(db.characters[0]);window.reviewSaved=null;
 UvUMusicCharacter.refresh=async()=>({profile:{tracks:[]},choices:[{title:'Midsummer Madness '+ '超长歌曲名'.repeat(10),artists:['88rising','Joji','Rich Brian'],selected:'',candidates:[{provider:'netease',id:'one',title:'一个超长的版本名字'.repeat(12),artists:['Artist '.repeat(10)]}]},...Array.from({length:6},(_,i)=>({title:'歌曲 '+i,artists:['歌手'],selected:'',candidates:[]}))],commit:async(ids,keep)=>{window.reviewSaved={ids,keep};}});UvUMusicUI.characterPlaylist('ui-role');
});
await page.getByRole('button',{name:'刷新角色歌单',exact:true}).click();await page.getByRole('button',{name:'保存所选版本',exact:true}).waitFor();
for(const width of [320,390,768]){
 await page.setViewportSize({width,height:844});
 const sizes=await page.locator('.um-sheet-body').evaluate(el=>{el.scrollLeft=1000;el.scrollTop=10000;const box=el.getBoundingClientRect();return{width:el.clientWidth,scroll:el.scrollWidth,left:el.scrollLeft,top:el.scrollTop,overflow:[...el.querySelectorAll('select')].some(s=>s.getBoundingClientRect().right>box.right+1)};});
 verify(sizes.scroll<=sizes.width+1&&sizes.left===0&&!sizes.overflow,'playlist review must not pan horizontally at '+width+': '+JSON.stringify(sizes));verify(sizes.top>0,'playlist review must retain internal vertical scrolling at '+width);
 await page.locator('.um-sheet-body').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,'playlist-review-'+width+'.png')});
}
await page.getByLabel('选择歌曲版本：Midsummer Madness '+ '超长歌曲名'.repeat(10),{exact:true}).selectOption('netease:one');
await page.getByRole('button',{name:'保存所选版本',exact:true}).click();
assert.deepEqual(await page.evaluate(()=>reviewSaved),{ids:['netease:one','','','','','',''],keep:true});verify(await page.evaluate(()=>reviewOriginal===JSON.stringify(db.characters[0])),'UI review must not mutate chat/persona data');
await page.evaluate(()=>{UvUMusicUI.close();switchScreen('api-settings-screen');});
for(const width of [320,390,768]){
 await page.setViewportSize({width,height:844});
 verify(await page.evaluate(()=>getComputedStyle(document.getElementById('minimax-tts-settings')).backgroundColor===getComputedStyle(document.querySelector('#api-settings-screen .kkt-group')).backgroundColor),'MiniMax must match original API card background at '+width);
 verify(await page.locator('#minimax-tts-settings').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'MiniMax fields must fit at '+width);
}
await page.setViewportSize({width:390,height:844});await page.locator('#minimax-tts-settings .kkt-item-title').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'minimax-api-390.png')});assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);console.log('PASS 320/390/768px: long playlist title/version containment and vertical scroll, manual selection/save, equal Lucide toolbar buttons with working draft/file-picker actions, original API background, chat-data isolation. No paid API calls.');
}finally{await browser.close();server.closeAllConnections();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
