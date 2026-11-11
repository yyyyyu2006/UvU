const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../outputs/ui-model-picker');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),libs=new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m,i)=>[m[1],path.resolve(root,'../browser-test-assets',i+'.js')]));
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'}[path.extname(file)]||'text/plain')+'; charset=utf-8');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block'});await context.addInitScript(()=>{localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');});
 await context.route('**/*',route=>{const u=route.request().url();if(libs.has(u))return route.fulfill({path:libs.get(u),contentType:'application/javascript'});if(u.startsWith(origin)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue();return route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
 await page.evaluate(()=>{switchScreen('cot-settings-screen');openCotPresetManageModal();});
 await page.locator('#cot-preset-manage-modal .modal-window').evaluate(el=>el.getAnimations().forEach(a=>a.finish()));
 const [left,right]=await page.evaluate(()=>['cot-import-preset-btn','cot-close-manage-modal-btn'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {y:r.y,height:r.height};}));
 const failures=[];if(Math.abs(left.y-right.y)>1||Math.abs(left.height-right.height)>1)failures.push('preset footer buttons must align');
 await page.evaluate(()=>{document.getElementById('cot-preset-manage-modal').classList.remove('visible');setupFunctionPanelSwiper();});
 const archive=await page.locator('#chat-archives-btn').evaluate(el=>({page:[...el.parentElement.parentElement.children].indexOf(el.parentElement),slot:[...el.parentElement.children].indexOf(el)}));if(archive.page!==1||archive.slot!==7)failures.push('archive must occupy previous page final slot');
 if(!await page.locator('#api-model-picker').count())failures.push('searchable model picker missing');assert.deepEqual(failures,[]);
 await page.evaluate(()=>{switchScreen('api-settings-screen');const s=document.getElementById('api-model');s.replaceChildren(...['gemini-3.1-pro','Claude-Opus-4-7','kimi-k3','模型<&>'].map(id=>new Option(id,id)));s.value='gemini-3.1-pro';window.modelChanges=0;s.addEventListener('change',()=>modelChanges++);});
 await page.locator('#api-model-picker').click();await page.getByRole('searchbox',{name:'搜索模型名称'}).fill('CLAUDE');await page.getByRole('option',{name:'Claude-Opus-4-7',exact:true}).click();
 assert.equal(await page.locator('#api-model').inputValue(),'Claude-Opus-4-7');assert.equal(await page.evaluate(()=>modelChanges),1);assert.equal(await page.locator('#api-model-picker').textContent(),'Claude-Opus-4-7');
 await page.locator('#api-model-picker').click();await page.getByRole('searchbox',{name:'搜索模型名称'}).fill('不存在');assert.equal(await page.getByText('没有匹配的模型').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('#api-model').inputValue(),'Claude-Opus-4-7');
 await page.locator('#api-model-picker').click();await page.getByRole('searchbox',{name:'搜索模型名称'}).fill('模型');assert.equal(await page.getByRole('option',{name:'模型<&>',exact:true}).count(),1);await page.keyboard.press('Escape');
 await page.evaluate(()=>{const s=document.getElementById('api-model');s.replaceChildren(...Array.from({length:1000},(_,i)=>new Option('model-'+i+'-long-name','model-'+i)));s.value='model-150';});await page.locator('#api-model-picker').click();assert.equal(await page.locator('.model-picker-list > button').count(),1000);
 const models=page.locator('.model-picker-list'),searchBox=page.getByRole('searchbox',{name:'搜索模型名称'}),searchTop=(await searchBox.boundingBox()).y;
 await searchBox.blur();
 const gesture=await context.newCDPSession(page);
 const swipeModels=async()=>{const bounds=await models.boundingBox(),touchX=Math.round(bounds.x+bounds.width/2),touchY=Math.round(bounds.y+Math.min(360,bounds.height-40));
 await gesture.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchX,y:touchY}]});
 for(let step=1;step<=15;step++){await gesture.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchX,y:touchY-step*16}]});await page.waitForTimeout(16);}
 // Hold before lifting to exercise a drag without an ongoing inertial fling.
 await page.waitForTimeout(160);
 await gesture.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
 // Recreate the old CSS interaction without editing production files: a non-scrolling
 // list with overscroll containment swallows gestures before its outer body can scroll.
 const oldLayout=await page.addStyleTag({content:'.model-picker-card.uvu-mono-panel.mono-page > .draft-scroll{overflow:auto!important}.model-picker-card.uvu-mono-panel.mono-page > .draft-scroll > .model-picker-list{flex:none!important;overflow:hidden!important;touch-action:auto!important}'});
 await swipeModels();
 assert.equal(await models.evaluate(el=>el.scrollTop),0);
 assert.equal(await page.locator('.model-picker-card > .draft-scroll').evaluate(el=>el.scrollTop),0,'old containment reproduces the touch scroll trap');
 await oldLayout.evaluate(el=>el.remove());
 await swipeModels();
 await page.waitForFunction(()=>document.querySelector('.model-picker-list').scrollTop>100);
 assert.equal((await searchBox.boundingBox()).y,searchTop,'search must remain fixed while swiping the model list');
 assert.equal(await page.locator('.model-picker-card > .draft-scroll').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'only model list should scroll');
 assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0);
 await page.getByRole('option',{name:'model-10-long-name',exact:true}).tap();
 assert.equal(await page.locator('#api-model').inputValue(),'model-10');
 await page.locator('#api-model-picker').tap();
 await page.screenshot({path:path.join(out,'model-touch-fixed.png')});
 assert.equal(await page.locator('.model-picker-list').evaluate(el=>el.scrollHeight>el.clientHeight),true);await page.getByRole('searchbox',{name:'搜索模型名称'}).fill('model-150-');await page.getByRole('option',{name:'model-150-long-name',exact:true}).click();assert.equal(await page.locator('#api-model').inputValue(),'model-150');
 await page.evaluate(()=>{const s=document.getElementById('secondary-api-model');s.replaceChildren(new Option('副模型','secondary'));document.getElementById('secondary-api-enabled').checked=true;document.getElementById('secondary-api-enabled').dispatchEvent(new Event('change'));});
 await page.evaluate(()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;});
 await page.locator('#secondary-api-model-picker').click();await page.getByRole('option',{name:'副模型',exact:true}).click();assert.equal(await page.locator('#secondary-api-model').inputValue(),'secondary');
 await page.evaluate(()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;});
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});await page.locator('#api-model-picker').click();const card=page.locator('.model-picker-card');assert.equal(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);const row=page.locator('.model-picker-list > button').first();await row.waitFor({state:'visible'});assert.ok((await row.boundingBox()).width>=(await page.locator('.model-picker-list').boundingBox()).width-2);await page.screenshot({animations:'disabled',path:path.join(out,'models-'+width+'.png')});await page.keyboard.press('Escape');await page.evaluate(()=>{switchScreen('cot-settings-screen');openCotPresetManageModal();});await page.locator('#cot-preset-manage-modal').waitFor({state:'visible'});await page.locator('#cot-preset-manage-modal .modal-window').evaluate(el=>el.getAnimations().forEach(a=>a.finish()));const [a,b]=await page.evaluate(()=>['cot-import-preset-btn','cot-close-manage-modal-btn'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {y:r.y,height:r.height};}));assert.ok(Math.abs(a.y-b.y)<1&&Math.abs(a.height-b.height)<1);await page.screenshot({animations:'disabled',path:path.join(out,'preset-'+width+'.png')});await page.evaluate(()=>{document.getElementById('cot-preset-manage-modal').classList.remove('visible');switchScreen('api-settings-screen');});}
 for(const viewport of [{width:320,height:420},{width:844,height:390}]){await page.setViewportSize(viewport);await page.locator('#api-model-picker').click();const rect=await page.locator('.model-picker-card').boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+1&&rect.y+rect.height<=viewport.height+1);assert.ok((await models.boundingBox()).height>=60);await page.getByRole('searchbox',{name:'搜索模型名称'}).fill('model-150-');await page.getByRole('option',{name:'model-150-long-name',exact:true}).tap();assert.equal(await page.locator('#api-model').inputValue(),'model-150');}
 await page.locator('#api-model-picker').click();await page.getByRole('searchbox',{name:'搜索模型名称'}).fill('model-150-');
 await page.evaluate(()=>{const s=document.getElementById('api-model');s.replaceChildren(new Option('新来源模型','replacement'));s.value='replacement';});
 await page.waitForFunction(()=>document.querySelectorAll('.model-picker-list [role=option]').length===0);
 assert.equal(await page.locator('#api-model').inputValue(),'replacement','a refreshed list must not restore an old choice');
 await page.getByRole('searchbox',{name:'搜索模型名称'}).fill('新来源');await page.getByRole('option',{name:'新来源模型',exact:true}).click();
 assert.equal(await page.locator('#api-model').inputValue(),'replacement');
 assert.deepEqual(errors,[]);console.log('PASS 1000-model search, live list replacement, touch-scroll regression, fixed search, selection/cancel, 320/390/768 and short/landscape; archive/preset alignment');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
