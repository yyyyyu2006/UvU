// Optional Chromium check of the two bridge panels at mobile widths.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/15271130817/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.join(__dirname,'..'),plugin=path.join(root,'../SillyTavern-UvU-Bridge');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:320,height:844}}), errors=[],metrics=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://bridge-layout.test/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="extensions_settings"></div>'});
   let data={};
   if(url.pathname==='/csrf-token')data={token:'test-csrf'};
   if(url.pathname.endsWith('/ui/service'))data={enabled:true,version:'0.3.0',protocolVersion:1};
   if(url.pathname.endsWith('/ui/characters'))data={characters:[{id:'c',name:'测试角色'}]};
   if(url.pathname.endsWith('/ui/pair-code'))data={code:'123456',expiresAt:Date.now()+300000};
   return route.fulfill({json:data});
  });
  await page.goto('https://bridge-layout.test/');
  await page.evaluate(()=>{window.getContext=()=>window.testContext;window.extension_prompt_types={IN_PROMPT:0};window.testContext={extensionSettings:{},characters:[{name:'测试角色',avatar:'card.png'}],characterId:0,chatId:'chat',setExtensionPrompt(){},saveSettingsDebounced:async()=>{},eventSource:{on(){}},eventTypes:{CHAT_CHANGED:'chat'}};});
  await page.addStyleTag({content:fs.readFileSync(path.join(plugin,'style.css'),'utf8')});
  const source=fs.readFileSync(path.join(plugin,'index.js'),'utf8').split(String.fromCharCode(10)).filter(line=>!line.startsWith('import ')).join(String.fromCharCode(10));
  await page.addScriptTag({content:source});
  await page.locator('[data-action=pair]').click();
  assert.equal(await page.locator('[data-pair-code]').innerText(),'123456');
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
