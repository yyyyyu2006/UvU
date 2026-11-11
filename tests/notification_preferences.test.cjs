'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){const values=new Map(),shown=[];const context=vm.createContext({Date,window:{isSecureContext:true,matchMedia:()=>({matches:false})},navigator:{serviceWorker:{getRegistration:async()=>({active:{},showNotification:async(...args)=>shown.push(args)}),addEventListener(){}}},Notification:{permission:'granted'},document:{visibilityState:'hidden',getElementById:()=>null},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},setTimeout,clearTimeout});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/notifications.js'),'utf8'),context);return {context,values,shown};}
test('notification preference defaults preserve existing title body icon and do not mute chats',()=>{const {context:c}=fixture();assert.equal(c.shouldShowMessageNotification('a','private'),true);assert.deepEqual(JSON.parse(JSON.stringify(c.getMessageNotificationPresentation('角色','正文','头像','a','private'))),{title:'角色',body:'正文',icon:'头像'});});
test('per chat mute isolates private and group IDs and preserves unrelated preferences',()=>{const {context:c}=fixture();c.saveMessageNotificationPreferences({mutedChats:{'["private","same"]':true}});assert.equal(c.shouldShowMessageNotification('same','private'),false);assert.equal(c.shouldShowMessageNotification('same','group'),true);assert.equal(c.shouldShowMessageNotification('other','private'),true);});
test('quiet hours cover midnight wraparound, exact boundaries and disabled default',()=>{const {context:c}=fixture();c.saveMessageNotificationPreferences({quietHours:{enabled:true,start:'22:00',end:'08:00'}});for(const time of ['2026-11-06T22:00:00','2026-11-07T01:30:00','2026-11-07T07:59:00'])assert.equal(c.shouldShowMessageNotification('a','private',new Date(time)),false);for(const time of ['2026-11-06T21:59:00','2026-11-07T08:00:00'])assert.equal(c.shouldShowMessageNotification('a','private',new Date(time)),true);assert.throws(()=>c.saveMessageNotificationPreferences({quietHours:{enabled:true,start:'bad',end:'08:00'}}),/时间/);});
test('privacy hides message body or all identifying content without mutating source',async()=>{const {context:c,values,shown}=fixture();values.set('uvu-system-notifications','true');vm.runInContext('systemNotificationsEnabled=true',c);c.saveMessageNotificationPreferences({privacy:'hide-body'});assert.deepEqual(JSON.parse(JSON.stringify(c.getMessageNotificationPresentation('角色','SECRET','avatar','a','private'))),{title:'角色',body:'你收到一条新消息',icon:'avatar'});c.saveMessageNotificationPreferences({privacy:'private'});await c.showSystemMessageNotification('角色','SECRET','avatar','a','private');assert.equal(shown[0][0],'UvU 新消息');assert.doesNotMatch(JSON.stringify(shown[0]),/SECRET|avatar|角色/);});
test('capability report distinguishes missing permission support and page-dependent delivery',()=>{const {context:c}=fixture();assert.equal(c.getMessageNotificationCapabilities().delivery,'page-dependent');assert.equal(c.getMessageNotificationCapabilities().permission,'granted');c.window.isSecureContext=false;assert.equal(c.getMessageNotificationCapabilities().supported,false);});

test('per-chat aggregation is opt-in and does not suppress another chat while service lookup waits',async()=>{const {context:c,shown}=fixture();vm.runInContext('systemNotificationsEnabled=true',c);assert.equal(c.getMessageNotificationPreferences().groupByChat,false);c.saveMessageNotificationPreferences({groupByChat:true,privacy:'private'});const resolvers=[];c.navigator.serviceWorker.getRegistration=()=>new Promise(resolve=>resolvers.push(resolve));const a=c.showSystemMessageNotification('SECRET_A','body','avatar','a','private'),b=c.showSystemMessageNotification('SECRET_B','body','avatar','b','group');for(const resolve of resolvers)resolve({active:{},showNotification:async(...args)=>shown.push(args)});await Promise.all([a,b]);assert.equal(shown.length,2);assert.notEqual(shown[0][1].tag,shown[1][1].tag);assert.doesNotMatch(JSON.stringify(shown.map(x=>x[1].tag)),/SECRET|body|avatar/);assert.equal(c.messageNotificationTag('a','private'),c.messageNotificationTag('a','private'));assert.notEqual(c.messageNotificationTag('same','private'),c.messageNotificationTag('same','group'));});

test('revoking notification permission during service lookup stops the pending real delivery',async()=>{
 const {context:c,shown}=fixture();vm.runInContext('systemNotificationsEnabled=true',c);let finish;
 c.navigator.serviceWorker.getRegistration=()=>new Promise(resolve=>finish=resolve);
 const task=c.showSystemMessageNotification('角色','消息','avatar','a','private');c.Notification.permission='denied';
 finish({active:{},showNotification:async(...args)=>shown.push(args)});await task;assert.equal(shown.length,0);
});

test('shared notification receipts expire and discard future or malformed entries',async()=>{
 const {context:c,values}=fixture();c.crypto=require('node:crypto').webcrypto;c.TextEncoder=TextEncoder;c.navigator.locks={request:async(_,run)=>run()};
 c.saveMessageNotificationPreferences({duplicateProtection:true});let shown=0;const send=()=>c.deliverSharedSystemNotification(['same'],()=>true,async()=>shown++);
 await send();await send();assert.equal(shown,1);const key='uvu-system-notification-claims.v1',records=JSON.parse(values.get(key)),id=Object.keys(records)[0];
 records[id]=Date.now()-600001;records['bad-key']=Date.now();records['a'.repeat(64)]=Date.now()+600000;values.set(key,JSON.stringify(records));
 await send();assert.equal(shown,2);assert.equal(Object.keys(JSON.parse(values.get(key))).length,1);
});

test('shared notification history stays bounded and contains only opaque receipt keys',async()=>{
 const {context:c,values}=fixture();c.crypto=require('node:crypto').webcrypto;c.TextEncoder=TextEncoder;c.navigator.locks={request:async(_,run)=>run()};c.saveMessageNotificationPreferences({duplicateProtection:true});
 values.set('uvu-system-notification-claims.v1',JSON.stringify(Object.fromEntries(Array.from({length:1024},(_,i)=>[i.toString(16).padStart(64,'0'),Date.now()]))));
 let shown=0;await c.deliverSharedSystemNotification(['secret-account','private message'],()=>true,async()=>shown++);
 const receipts=values.get('uvu-system-notification-claims.v1');assert.equal(shown,1);assert.equal(Object.keys(JSON.parse(receipts)).length,1024);assert.doesNotMatch(receipts,/secret|private|account/);
});

test('missing Web Locks and lock rejection keep notification delivery available',async()=>{
 for(const rejects of [false,true]){
  const {context:c}=fixture();c.crypto=require('node:crypto').webcrypto;c.TextEncoder=TextEncoder;c.saveMessageNotificationPreferences({duplicateProtection:true});
  if(rejects)c.navigator.locks={request:async()=>{throw Error('not available');}};
  let shown=0;await c.deliverSharedSystemNotification(['message'],()=>true,async()=>shown++);assert.equal(shown,1);
 }
});

test('receipt storage failure after successful notification never displays a second time',async()=>{
 const {context:c}=fixture();c.crypto=require('node:crypto').webcrypto;c.TextEncoder=TextEncoder;c.navigator.locks={request:async(_,run)=>run()};c.saveMessageNotificationPreferences({duplicateProtection:true});
 c.localStorage.setItem=()=>{throw Error('quota');};let shown=0;await c.deliverSharedSystemNotification(['message'],()=>true,async()=>shown++);assert.equal(shown,1);
});
