// Optional Chromium check of the two bridge panels at mobile widths.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/15271130817/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.join(__dirname,'..'),plugin=path.join(root,'../SillyTavern-UvU-Bridge');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:320,height:844}}), errors=[],metrics=[],onlineEvents=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://bridge-layout.test/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="extensions_settings"></div>'});
   let data={};
   if(url.pathname==='/csrf-token')data={token:'test-csrf'};
   if(url.pathname.endsWith('/ui/service'))data={enabled:true,version:'0.3.1',protocolVersion:1};
   if(url.pathname.endsWith('/ui/events'))data={events:onlineEvents.filter(event=>event.seq>Number(url.searchParams.get('after')||0))};
   if(url.pathname.endsWith('/ui/state'))data={enabled:true,mode:'offline',sceneId:'scene'};
   if(url.pathname.endsWith('/ui/characters'))data={characters:[{id:'c',name:'测试角色'}]};
   if(url.pathname.endsWith('/ui/pair-code'))data={code:'123456',expiresAt:Date.now()+300000};
   return route.fulfill({json:data});
  });
  await page.goto('https://bridge-layout.test/');
  await page.evaluate(()=>{window.getContext=()=>window.testContext;window.extension_prompt_types={IN_PROMPT:0};window.testContext={extensionSettings:{},characters:[{name:'测试角色',avatar:'card.png'}],characterId:0,chatId:'chat',setExtensionPrompt(){},saveSettingsDebounced:async()=>{},eventSource:{on(){}},eventTypes:{CHAT_CHANGED:'chat'}};});
  await page.addStyleTag({content:fs.readFileSync(path.join(plugin,'style.css'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(plugin,'story-text.js'),'utf8')});
  const source=fs.readFileSync(path.join(plugin,'index.js'),'utf8').split(String.fromCharCode(10)).filter(line=>!line.startsWith('import ')).join(String.fromCharCode(10));
  await page.addScriptTag({content:source});
  await page.locator('[data-action=pair]').click();
  assert.equal(await page.locator('[data-pair-code]').innerText(),'123456');
  await page.locator('[data-uvu-character]').selectOption('c');
  await page.waitForTimeout(100);
  const event=(seq,id,text)=>({seq,characterKey:'c',kind:'memory_packet',payload:{archiveId:'archive-a',messages:[{id,text,createdAt:seq,revision:'r'+seq}]}});
  onlineEvents.push(event(1,'m1','第一条正文'));
  await page.getByText('UvU → 酒馆：线上记忆审核',{exact:true}).click();
  const refresh=page.locator('[data-action=refresh-online]');
  await refresh.click(); await page.waitForFunction(()=>document.querySelectorAll('[data-item]').length===1);
  await page.locator('.uvu-bridge-review-list summary').click();
  await page.locator('[data-item-text]').fill('手动编辑待审核');
  await page.locator('[data-item]').uncheck();
  onlineEvents.push(event(2,'m2','第二条正文'));
  await refresh.click(); await page.waitForFunction(()=>document.querySelectorAll('[data-item]').length===2);
  assert.equal(await page.locator('[data-item-text]').first().inputValue(),'手动编辑待审核');
  assert.equal(await page.locator('[data-item]').first().isChecked(),false);
  assert.equal(await page.locator('[data-item]').nth(1).isChecked(),true);
  assert.equal(await page.evaluate(()=>testContext.extensionSettings['uvu-story-bridge'].packetsByCharacter.c.items.some(item=>item.selected)),false);
  await page.getByRole('button',{name:'保存勾选与编辑',exact:true}).click();
  await page.waitForFunction(()=>testContext.extensionSettings['uvu-story-bridge'].packetsByCharacter.c.items[1].selected===true);
  page.on('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'删除勾选副本',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-item]').length===1);
  onlineEvents.push(event(3,'m2','第二条正文'));
  await refresh.click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-item]').count(),1);
  assert.equal(await page.locator('[data-item-text]').inputValue(),'手动编辑待审核');
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   const result=await page.locator('.uvu-bridge-panel').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,buttons:[...e.querySelectorAll('button')].map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width}))}));
   assert.ok(result.scrollWidth<=result.width,JSON.stringify(result));
   assert.ok(result.buttons.every(b=>b.height<=32));metrics.push({panel:'Tavern',viewport:width,noOverflow:true});
  }
  await page.close();
  const uvu=await browser.newPage({viewport:{width:320,height:844}});
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const start=html.indexOf('<div id="uvu-story-bridge-screen"'),end=html.indexOf('<div id="wallpaper-screen"',start);
  assert.ok(start>=0&&end>start);
  await uvu.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+html.slice(start,end).replace('class="screen"','class="screen active"'));
  for(const css of ['css/base.css','css/layout.css','css/settings.css'])await uvu.addStyleTag({content:fs.readFileSync(path.join(root,css),'utf8')});
  for(const width of [320,390]){
   await uvu.setViewportSize({width,height:844});
   const result=await uvu.locator('.uvu-bridge-range').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,inputs:[...e.querySelectorAll('input')].map(i=>({width:i.getBoundingClientRect().width,right:i.getBoundingClientRect().right}))}));
   assert.ok(result.scrollWidth<=result.width);assert.ok(result.inputs.every(i=>i.width<=84&&i.right<=width));
   metrics.push({panel:'UvU',viewport:width,numberInputWidths:result.inputs.map(i=>i.width),noOverflow:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({metrics,errors},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
