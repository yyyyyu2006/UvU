'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createServer}=require('node:http'),{once}=require('node:events');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const root=path.resolve(__dirname,'..');
(async()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const markup=html.slice(html.indexOf('<div id="uvu-story-bridge-screen"'),html.indexOf('<div id="wallpaper-screen"'));
 const server=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:14px sans-serif}input,select,button{font:inherit;max-width:100%}label{display:block}main{padding:12px}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}</style>'+markup));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:320,height:844}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'css/settings.css'),'utf8')});
  await page.evaluate(()=>{
   window.db={characters:[{id:'c',realName:'角色',activeArchiveId:'a',archives:[{id:'a',name:'选定存档'}],history:[{id:'m',role:'user',content:'交接正文',timestamp:1}],memoryJournals:[]}],uvuStoryBridgeSettings:{}};
   window.currentChatType='private';window.currentChatId='c';window.saveData=async()=>{};
   window.fetch=async(...args)=>{window.networkCalls=(window.networkCalls||[]).concat([args]);throw Error('No network expected');};
   document.getElementById('uvu-story-bridge-screen').classList.add('active');
  });
  for(const file of ['bridge_text.js','bridge_summary.js','bridge_file.js','story_bridge.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/modules',file),'utf8')});
  await page.evaluate(()=>setupUvUStoryBridge());
  await page.locator('#uvu-bridge-channel').selectOption('tt');
  await page.waitForFunction(()=>db.uvuStoryBridgeSettings.channel==='tt'&&document.getElementById('uvu-bridge-online-controls').hidden);
  assert.equal(await page.locator('#uvu-bridge-tt-mode').inputValue(),'file');
  for(const id of ['uvu-bridge-url','uvu-bridge-pair','uvu-bridge-st-guide','uvu-bridge-handoff','uvu-bridge-recover'])assert.equal(await page.locator('#'+id).isVisible(),false,id);
  assert.equal(await page.locator('#uvu-bridge-url').inputValue(),'');
  const pending=page.waitForEvent('download');await page.locator('#uvu-bridge-export-file').click();
  const download=await pending,file=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(file.characterKey,'c');assert.equal(file.archiveId,'a');assert.equal(file.direction,'to-tavern');assert.doesNotMatch(JSON.stringify(file),/token|adminSecret/);
  const dir=path.resolve(root,'../uvu-verification-deps/artifacts');fs.mkdirSync(dir,{recursive:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow '+width);await page.screenshot({path:path.join(dir,'uvu-tt-file-'+width+'.png'),fullPage:true});}
  await page.locator('#uvu-bridge-tt-mode').selectOption('https');
  assert.equal(await page.locator('#uvu-bridge-url').isVisible(),true);
  await page.locator('#uvu-bridge-url').fill('https://yyyyyu2006.github.io/UvU');await page.locator('#uvu-bridge-pair-code').fill('test-pair-code');
  await page.locator('#uvu-bridge-pair').click();await page.waitForFunction(()=>document.getElementById('uvu-bridge-status').textContent.includes('GitHub Pages'));
  assert.equal(await page.evaluate(()=>window.networkCalls?.length||0),0);
  await page.locator('#uvu-bridge-channel').selectOption('st');assert.equal(await page.locator('#uvu-bridge-st-guide').isVisible(),true);
  assert.match(await page.locator('#uvu-bridge-url').inputValue(),/127\.0\.0\.1:8765/);
  assert.deepEqual(errors,[]);console.log('PASS UvU TT onboarding: file default/hidden server forms and ST tutorial, selected character/archive download, no credential export, Pages rejected before network, original ST restored, 320/390 layout.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
