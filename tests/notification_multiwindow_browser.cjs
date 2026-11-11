'use strict';
// Real same-origin Web Locks and localStorage; only system delivery is simulated.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../uvu-verification-deps/node_modules/playwright');
const source=fs.readFileSync(path.join(__dirname,'../js/modules/notifications.js'),'utf8');
const server=http.createServer((req,res)=>res.end('<!doctype html><title>Isolated notifications</title>'));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const context=await browser.newContext(),pages=await Promise.all([context.newPage(),context.newPage()]);const errors=[];
  for(const page of pages){
   page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
   await page.evaluate(()=>{
    localStorage.setItem('uvu-system-notifications','true');localStorage.setItem('uvu-notification-preferences.v1',JSON.stringify({duplicateProtection:true}));
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'granted'}});
    window.deliveries=[];window.failDelivery=false;window.chat={id:'secret-character',activeArchiveId:'archive-a',history:[]};window.db={characters:[chat],groups:[]};
    navigator.serviceWorker.getRegistration=async()=>({active:{},showNotification:async(title,options)=>{if(failDelivery)throw Error('delivery failed');deliveries.push({title,options});}});
   });
   await page.addScriptTag({content:source});
  }
  const notify=(page,id='same',archive='archive-a')=>page.evaluate(async({id,archive})=>{
   chat.activeArchiveId=archive;const message={id,role:'assistant',content:'PRIVATE_CONTENT',timestamp:1700000000000};
   await showSystemMessageNotification('SECRET_NAME',message.content,'','secret-character','private',{chat,message});
  },{id,archive});
  const count=async()=>{const counts=await Promise.all(pages.map(page=>page.evaluate(()=>deliveries.length)));return counts.reduce((sum,n)=>sum+n,0);};
  await Promise.all(pages.map(page=>notify(page)));assert.equal(await count(),1,'same message across two windows delivers once');
  await notify(pages[1],'different');assert.equal(await count(),2,'same text with another ID still delivers');
  await notify(pages[1],'same','archive-b');assert.equal(await count(),3,'archives remain independent');
  const ledger=await pages[0].evaluate(()=>localStorage.getItem('uvu-system-notification-claims.v1'));
  assert.ok(ledger);assert.doesNotMatch(ledger,/PRIVATE_CONTENT|SECRET_NAME|secret-character|archive-a|same/);
  for(const page of pages)await page.evaluate(()=>saveMessageNotificationPreferences({duplicateProtection:false}));
  await Promise.all(pages.map(page=>notify(page,'disabled')));assert.equal(await count(),5,'disabled option does not coordinate delivery');
  for(const page of pages)await page.evaluate(()=>saveMessageNotificationPreferences({duplicateProtection:true}));
  await pages[0].evaluate(()=>failDelivery=true);await notify(pages[0],'retry-after-failure');
  await notify(pages[1],'retry-after-failure');assert.equal(await count(),6,'failed delivery does not reserve the ID');
  const priorLedger=await pages[0].evaluate(()=>localStorage.getItem('uvu-system-notification-claims.v1'));
  await pages[0].evaluate(()=>{window.lockEntered=false;window.heldLock=navigator.locks.request('uvu-system-notification-claims.v1',()=>{lockEntered=true;return new Promise(resolve=>window.releaseLock=resolve);});});
  await pages[0].waitForFunction(()=>lockEntered);
  await pages[1].evaluate(()=>{window.queuedNotification=showSystemMessageNotification('new','new','','secret-character','private',{chat,message:{id:'disabled-while-queued',role:'assistant'}});});
  await pages[0].waitForFunction(async()=>(await navigator.locks.query()).pending.length>0);
  await pages[0].evaluate(async()=>{saveMessageNotificationPreferences({duplicateProtection:false});releaseLock();await heldLock;});
  await pages[1].evaluate(()=>queuedNotification);assert.equal(await count(),7);
  assert.equal(await pages[0].evaluate(()=>localStorage.getItem('uvu-system-notification-claims.v1')),priorLedger,'turning off coordination while queued creates no shared receipt');
  await pages[0].evaluate(()=>saveMessageNotificationPreferences({duplicateProtection:true}));
  const before=await count();await pages[0].evaluate(()=>{chat.activeArchiveId='archive-a';window.releaseLookup=null;window.lookupStarted=false;navigator.serviceWorker.getRegistration=()=>{lookupStarted=true;return new Promise(resolve=>releaseLookup=()=>resolve({active:{},showNotification:async()=>deliveries.push({stale:true})}));};window.pendingDelivery=showSystemMessageNotification('old','old','','secret-character','private',{chat,message:{id:'stale',role:'assistant'}});});
  await pages[0].waitForFunction(()=>lookupStarted);await pages[0].evaluate(async()=>{chat.history=[];releaseLookup();await pendingDelivery;});assert.equal(await count(),before,'archive/history changes discard pending delivery');
  // Preference changes propagate to the already-open sibling window.
  await pages[1].evaluate(()=>localStorage.setItem('uvu-system-notifications','false'));
  await pages[0].waitForFunction(()=>systemNotificationsEnabled===false);
  await pages[0].evaluate(()=>{navigator.serviceWorker.getRegistration=async()=>({active:{},showNotification:async()=>deliveries.push({disabled:true})});});
  await notify(pages[0],'turned-off');assert.equal(await count(),before);
  assert.deepEqual(errors,[]);console.log('PASS two-window system dedup, separate IDs/archives, private receipts, default-off behavior, failed delivery retry, stale owner rejection and shared disable');
 } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
