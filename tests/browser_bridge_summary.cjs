'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '../node_modules/playwright');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://bridge-summary.test/**',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1">'}));
  await page.goto('https://bridge-summary.test/');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),start=html.indexOf('<div id="uvu-story-bridge-screen"'),end=html.indexOf('<div id="wallpaper-screen"',start);
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+html.slice(start,end).replace('class="screen"','class="screen active"'));
  for(const file of ['base.css','layout.css','settings.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,'css',file),'utf8')});
  await page.evaluate(()=>{
   window.currentChatId='other';window.currentChatType='private';window.pad=v=>String(v).padStart(2,'0');
   window.db={worldBooks:[],characters:[{id:'c',name:'甲',realName:'甲',activeArchiveId:'a',history:[{id:'m',role:'user',content:'ONLINE_SOURCE'}],journalStyleSettings:{mode:'default'},memoryJournals:[{
    id:'scene',source:'sillytavern',externalSceneId:'s',title:'待审',content:'原剧情',isFavorited:false,bridgeReview:{version:2,channel:'st',archiveId:'a',status:'pending',sourceText:'原剧情',items:[{id:'f',text:'甲与乙约定下周见面。',selected:true,floor:{number:8,speaker:'甲',createdAt:0}}]}
   }]},{id:'other',name:'乙',history:[],activeArchiveId:'b',memoryJournals:[]}],uvuStoryBridgeSettings:{}};
   window.saveData=async()=>{if(window.failSave)throw new Error('quota');window.saved=structuredClone(db);};
   window.resolveAuxiliaryApiConfig=()=>({url:'https://api.test',key:'key',model:'model'});
   window.resolveAutoMemoryApi=()=>({url:'https://memory.test',key:'key',model:'model'});
   window.buildChatApiRequest=(config,messages)=>({requestBody:{messages},headers:{},endpoint:config.url});
   window.fetchAiResponse=async(config,body)=>{window.lastPrompt=body.messages[0].content;if(window.delaySummary)await new Promise(resolve=>window.releaseSummary=resolve);return '<title>下周约定</title><content>甲与乙约定下周见面，具体剧情日期未知。</content>';};
  });
  for(const file of ['bridge_text','journal','bridge_summary','bridge_file','story_bridge'])await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/modules',file+'.js'),'utf8')});
  await page.evaluate(()=>setupUvUStoryBridge());
  await page.locator('#uvu-bridge-handoff-character').selectOption('c');
  await page.locator('#uvu-bridge-save-character').click();
  await page.waitForFunction(()=>saved.uvuStoryBridgeSettings.handoffCharacterId==='c');
  await page.evaluate(()=>document.getElementById('uvu-story-bridge-screen').classList.remove('active'));
  await page.evaluate(()=>document.getElementById('uvu-story-bridge-screen').classList.add('active'));
  assert.equal(await page.locator('#uvu-bridge-handoff-character').inputValue(),'c');
  await page.locator('#uvu-bridge-use-current').click();assert.match(await page.locator('#uvu-bridge-handoff-source').textContent(),/甲/);
  await page.locator('#uvu-bridge-review-list > details > summary').click();
  const generate=page.getByRole('button',{name:'生成摘要',exact:true});await generate.click();
  await page.waitForFunction(()=>db.characters[0].memoryJournals[0].bridgeReview.summaryDraft);
  assert.equal(await page.evaluate(()=>UvUStoryBridge.allowedMemory(db.characters[0],db.characters[0].memoryJournals[0])),false);
  assert.match(await page.evaluate(()=>lastPrompt),/第三人称/);assert.doesNotMatch(await page.evaluate(()=>lastPrompt),/ONLINE_SOURCE|1970/);
  assert.equal(await page.evaluate(()=>db.characters[0].journalStyleSettings.mode),'default');
  const preview=page.locator('.uvu-bridge-summary-preview');assert.equal(await preview.isVisible(),true);
  await preview.locator(':scope > summary').click();assert.equal(await page.getByLabel('编辑摘要',{exact:true}).isVisible(),false);await preview.locator(':scope > summary').click();
  await preview.getByText('对照已选楼层的人物 / 日期 / 约定 / 待办',{exact:true}).click();assert.match(await preview.locator('pre').textContent(),/第 8 层 · 甲/);
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   const metrics=await page.locator('#uvu-bridge-review-list').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth}));assert.ok(metrics.scrollWidth<=metrics.width,JSON.stringify(metrics));
   await page.screenshot({path:path.join(root,'../uvu-verification-deps/bridge-summary-'+width+'.png'),fullPage:true});
  }
  await page.getByLabel('编辑摘要',{exact:true}).fill('审核后的第三人称摘要。');
  await page.evaluate(()=>window.failSave=true);
  await page.getByRole('button',{name:'确认摘要并加入记忆',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('uvu-bridge-status').textContent.includes('quota'));
  assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals[0].isFavorited),false);
  await page.evaluate(()=>window.failSave=false);
  await page.getByRole('button',{name:'确认摘要并加入记忆',exact:true}).click();
  await page.waitForFunction(()=>db.characters[0].memoryJournals[0].bridgeReview.status==='approved');
  assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals[0].content),'审核后的第三人称摘要。');
  assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals[0].bridgeReview.sourceText),'原剧情');
  assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals.length),1);
  await page.locator('#uvu-bridge-review-list > details > summary').click();
  await page.evaluate(()=>{window.delaySummary=true;});await generate.click();await page.waitForFunction(()=>typeof releaseSummary==='function');
  await page.locator('#uvu-bridge-handoff-character').selectOption('other');await page.evaluate(()=>releaseSummary());
  await page.waitForFunction(()=>document.getElementById('uvu-bridge-status').textContent.includes('已修改'));
  assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals[0].content),'审核后的第三人称摘要。');
  await page.locator('#uvu-bridge-channel').selectOption('tt');await page.waitForFunction(()=>db.uvuStoryBridgeSettings.channel==='tt');
  assert.equal(await page.locator('#uvu-bridge-url').inputValue(),'');
  assert.equal(await page.locator('#uvu-bridge-review-list > details').count(),0);
  await page.locator('#uvu-bridge-handoff-character').selectOption('c');
  const file=await page.evaluate(async()=>{
   const text='TT 导回的完整剧情。',partHash=await UvUBridgeFile.hash(text);
   return JSON.stringify({format:'uvu-bridge-file',version:1,direction:'to-uvu',characterKey:'c',archiveId:'a',events:[{eventId:'file-event',source:'sillytavern',kind:'scene_transcript',sceneId:'tt-scene',characterKey:'c',createdAt:Date.now(),payload:{uvuArchiveId:'a',part:1,partCount:1,text,partHash,sceneFormat:'floors-v1',floor:{id:'tt-f',number:2,speaker:'甲',role:'assistant',createdAt:0,part:1,partCount:1,extraction:'tagged',bodyTag:'content'}}}]});
  });
  await page.locator('#uvu-bridge-import-file-input').setInputFiles({name:'scene.json',mimeType:'application/json',buffer:Buffer.from(file)});
  await page.waitForFunction(()=>db.characters[0].memoryJournals.length===2);
  assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals[1].bridgeReview.channel),'tt');
  assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals[1].isFavorited),false);
  const download=page.waitForEvent('download');await page.locator('#uvu-bridge-export-file').click();await download;
  assert.deepEqual(errors,[]);console.log('PASS saved role/reentry, original third-person prompt, draft gate/edit/confirm/rollback, stale role rejection, TT isolation, file import/export, 320/390 layouts.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
