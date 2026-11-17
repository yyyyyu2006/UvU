'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fullApp,stableUI,root}=require('./helpers/full_app_browser.cjs');
(async()=>{
 const app=await fullApp(),out=path.join(root,'outputs/bridge-file-recovery');fs.mkdirSync(out,{recursive:true});
 try{
  const {page,errors}=await app.page({viewport:{width:320,height:568}});
  page.setDefaultTimeout(10000);
  const bridgeRequests=[];page.on('request',request=>{if(request.url().includes('/v1/client/'))bridgeRequests.push(request.url());});
  await page.evaluate(async()=>{
   document.addEventListener('pointerdown',()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;},true);
   const chat={id:'bridge-recovery',realName:'测试角色',myName:'测试用户',persona:'',myPersona:'',history:[],memoryJournals:[],maxMemory:20,worldBookIds:[],activeArchiveId:'a',archives:[{id:'a',name:'存档甲'}]};
   db.characters=[chat];db.uvuStoryBridgeSettings={channel:'tt',ttSettings:{transportVersion:1,transport:'file',bridgeEnabled:true,handoffCharacterId:chat.id,cursorByCharacter:{[chat.id]:77}}};
   localStorage.removeItem('uvu-story-bridge.v1.tt');
   currentChatId=chat.id;currentChatType='private';
   syncChatActiveArchive(chat,true);chat.archives.push({id:'b',name:'存档乙',data:captureArchiveData(chat)});
   window.makeRecovery=(id,archiveId='b')=>JSON.stringify({format:'uvu-bridge-recovery',version:1,channel:'tt',outbox:[],receipts:{},cursorByCharacter:{},pendingScenes:{
    [chat.id+':'+id]:{characterKey:chat.id,archiveId,partCount:1,parts:{1:'本地恢复的剧情 '+id}},
    [chat.id+':incomplete']:{characterKey:chat.id,archiveId:'a',partCount:2,parts:{1:'未收齐的剧情'}}
   }});
   await UvUStoryBridge.importRecovery(makeRecovery('restored'),{confirmed:true});
   switchScreen('uvu-story-bridge-screen');await UvUStoryBridge.changeChannel('tt');
  });
  await page.getByRole('button',{name:'剧情审核',exact:true}).click();
  const recover=page.getByRole('button',{name:'打开目标存档并收取',exact:true});
  await page.locator('#uvu-bridge-review-list > details').filter({has:page.getByRole('button',{name:'打开目标存档并收取',exact:true,includeHidden:true})}).locator(':scope > summary').click();
  assert.equal(await recover.count(),1);await recover.click();
  await page.waitForFunction(()=>db.characters[0].memoryJournals.some(j=>j.externalSceneId==='restored'));
  assert.deepEqual(await page.evaluate(()=>{const c=db.characters[0],s=db.uvuStoryBridgeSettings.ttSettings,j=c.memoryJournals[0];return {archive:c.activeArchiveId,status:j.bridgeReview.status,favorite:j.isFavorited,cursor:s.cursorByCharacter[c.id],incomplete:s.pendingScenes[c.id+':incomplete'].parts[1],connected:UvUStoryBridge.isConnected()};}),{archive:'b',status:'pending',favorite:false,cursor:77,incomplete:'未收齐的剧情',connected:false});
  await page.waitForFunction(()=>!document.querySelectorAll('#uvu-bridge-review-list button').length || !Array.from(document.querySelectorAll('#uvu-bridge-review-list button')).some(b=>b.textContent==='打开目标存档并收取'));
  assert.equal(await recover.count(),0);
  await page.evaluate(async()=>{
   await UvUStoryBridge.importRecovery(makeRecovery('retry'),{confirmed:true});
   window.bridgeSaveOriginal=runDataPersistence;window.failRecoverySave=true;
   runDataPersistence=async(...args)=>{if(failRecoverySave&&db.characters[0].memoryJournals.some(j=>j.externalSceneId==='retry'))throw new Error('模拟保存失败');return bridgeSaveOriginal(...args);};
   UvUStoryBridge.renderReview(true);
  });
  await page.locator('#uvu-bridge-review-list > details').filter({has:page.getByRole('button',{name:'打开目标存档并收取',exact:true,includeHidden:true})}).locator(':scope > summary').click();
  await recover.click();await page.waitForFunction(()=>document.getElementById('uvu-bridge-status').textContent.includes('模拟保存失败'));
  assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals.some(j=>j.externalSceneId==='retry')),false);
  assert.equal(await page.evaluate(()=>Boolean(db.uvuStoryBridgeSettings.ttSettings.pendingScenes['bridge-recovery:retry'])),true);
  await page.evaluate(()=>{failRecoverySave=false;runDataPersistence=bridgeSaveOriginal;switchScreen('uvu-story-bridge-screen');});
  const retryScene=page.locator('#uvu-bridge-review-list > details').filter({has:page.getByRole('button',{name:'打开目标存档并收取',exact:true,includeHidden:true})});
  if(!await retryScene.evaluate(el=>el.open))await retryScene.locator(':scope > summary').click();
  await recover.click();await page.waitForFunction(()=>db.characters[0].memoryJournals.some(j=>j.externalSceneId==='retry'));
  await page.waitForFunction(()=>!Object.keys(db.uvuStoryBridgeSettings.ttSettings.pendingScenes).some(k=>k.endsWith(':retry')) && !document.querySelector('#uvu-bridge-review-list button')?.disabled);
  await stableUI(page,'#uvu-story-bridge-screen');
  await page.getByRole('button',{name:'全部',exact:true}).click();
  const restored=page.locator('#uvu-bridge-review-list > details[data-draft-scene]').first();
  await restored.scrollIntoViewIfNeeded();
  assert.equal(await restored.isVisible(),true);
  await page.screenshot({path:path.join(out,'restored-320.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>db.characters.some(c=>c.id==='bridge-recovery'));
  assert.deepEqual(await page.evaluate(()=>{const c=db.characters.find(c=>c.id==='bridge-recovery');return {ids:c.memoryJournals.map(j=>j.externalSceneId).sort(),statuses:c.memoryJournals.map(j=>j.bridgeReview.status),cursor:db.uvuStoryBridgeSettings.ttSettings.cursorByCharacter[c.id]};}),{ids:['restored','retry'],statuses:['pending','pending'],cursor:77});
  assert.deepEqual(errors,[]);
  assert.deepEqual(bridgeRequests,[]);
  console.log('PASS full App TT file recovery: real button, archive switch, no pairing, pending-only memory, failure rollback/retry, incomplete preservation, unchanged cursor, IndexedDB reload, 320px layout/pageerror 0.');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
