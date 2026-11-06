const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://offline.test/**',r=>r.abort());await page.setContent('<button id="open">打开</button><div id="home-screen"><img src="https://offline.test/a.png?token=PRIVATE"><iframe src="about:blank"></iframe></div>');
 await page.addScriptTag({path:path.join(root,'js/modules/feature_dialogs.js')});
 await page.addScriptTag({path:path.join(root,'js/modules/resource_health.js')});
 await page.focus('#open');
 await page.evaluate(()=>{const show=id=>{const el=document.createElement('div');el.id=id;el.className='feature-dialog';el.innerHTML='<section class="feature-dialog-card"><button data-action="close">关闭</button><input aria-label="输入"><button>保存</button></section>';el.querySelector('button').onclick=()=>el.remove();document.body.append(el);};show('outer');window.show=show;});
 await page.waitForFunction(()=>document.activeElement?.closest('#outer'));
 await page.evaluate(()=>show('inner'));await page.waitForFunction(()=>document.activeElement?.closest('#inner'));
 await page.keyboard.press('Escape');assert.equal(await page.locator('#inner').count(),0);assert.equal(await page.locator('#outer').count(),1);
 await page.locator('#outer button').last().focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'关闭');
 await page.evaluate(()=>{show('expanded-text-editor');document.getElementById('expanded-text-editor').addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();e.currentTarget.remove();}});});
 await page.locator('#expanded-text-editor input').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#outer').count(),1);assert.equal(await page.locator('#expanded-text-editor').count(),0);
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'open');
 const scan=await page.evaluate(()=>{const before=document.querySelector('img').getAttribute('src');const data=UvUResourceHealth.inspect(document.getElementById('home-screen'));return {data,before,after:document.querySelector('img').getAttribute('src')};});
 assert.equal(scan.before,scan.after);assert.ok(scan.data.some(x=>x.type==='图片'));assert.ok(scan.data.some(x=>x.type==='组件'));assert.doesNotMatch(JSON.stringify(scan.data),/PRIVATE/);
 await page.addStyleTag({path:path.join(root,'css/modules/document_features.css')});await page.addStyleTag({path:path.join(root,'css/modules/feature_refinements.css')});
 for(const scheme of ['light','dark'])for(const width of [320,390,768]){await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:844});await page.evaluate(()=>show('layout'));assert.equal(await page.locator('#layout .feature-dialog-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await page.locator('#layout [data-action=close]').click();}
 assert.deepEqual(errors,[]);console.log('PASS: nested Escape, focus trap/restore, resource scan preserves URLs, 320/390/768 light/dark.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
