const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const a={id:'a',history:[],activeArchiveId:'one'},b={id:'b',history:[],activeArchiveId:'one'},timers=[],pending=[],delivered=[],toasts=[];
 const node={style:{},classList:{add(){},remove(){}},textContent:''};
 const c=vm.createContext({window:{},db:{characters:[a,b],groups:[]},AbortController,console:{error(){},warn(){}},showToast:text=>toasts.push(text),
 document:{getElementById:()=>node,addEventListener(){}},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},clearInterval(){},
 getCallReply:(chat,type,context,chunk,signal)=>new Promise(resolve=>pending.push({chat,signal,finish:text=>{chunk(text);resolve(text)}}))});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/video_call.js'),'utf8'),c);
 const m=vm.runInContext('VideoCallModule',c),realParse=m.parseAndAddAiResponse;
 const enter=chat=>{m.state.currentChat=chat;m.state.currentCallContext=[];m.state.isCallActive=true;m.state.isGenerating=false;m.state.isAiSpeaking=false;m.state.callSession={};m.state.callScope=null;m.captureCallScope();};
 m.parseAndAddAiResponse=text=>delivered.push({id:m.state.currentChat.id,text});enter(a);
 return {m,c,a,b,timers,pending,delivered,toasts,enter,realParse};
}
test('a late call result cannot deliver to another session or clear its generation controls',async()=>{
 const f=fixture(),pa=f.m.triggerAiReply();f.enter(f.b);const pb=f.m.triggerAiReply();
 f.pending[0].finish('[a的声音：old]');await pa;assert.deepEqual(f.delivered,[]);assert.equal(f.m.state.isGenerating,true);
 f.pending[1].finish('[b的声音：new]');await pb;assert.equal(f.delivered[0].id,'b');assert.equal(f.m.state.isGenerating,false);
});
test('call result is discarded after history or archive replacement',async()=>{
 for(const change of [f=>f.a.activeArchiveId='two',f=>f.a.history=[]]){
  const f=fixture(),p=f.m.triggerAiReply();change(f);f.pending[0].finish('old');await p;assert.equal(f.delivered.length,0);
 }
});
test('hangup aborts the current request and ignores its eventual completion',async()=>{
 const f=fixture(),p=f.m.triggerAiReply();await f.m.endCall();assert.equal(f.pending[0].signal?.aborted,true);
 f.pending[0].finish('old');await p;assert.equal(f.delivered.length,0);
});
test('queued call message bubbles retain session identity',()=>{
 const f=fixture();f.m.parseAndAddAiResponse=f.realParse;
 const m=f.m;let count=0;m.addMessage=()=>count++;
 m.parseAndAddAiResponse('[a的声音：late]');m.state.currentCallContext=[];for(const fn of f.timers)fn();assert.equal(count,0);
});

test('call session origin remains pinned after switching archives before a fresh reply or hangup',async()=>{
 const f=fixture();f.m.state.currentCallContext.push({role:'user',content:'old private call'});
 f.a.activeArchiveId='two';f.a.history=[];
 const reply=f.m.triggerAiReply();assert.equal(f.pending.length,0);await reply;
 await f.m.endCall();assert.equal(f.a.history.length,0);assert.equal(f.a.callHistory?.length||0,0);
});
test('old hangup animation cannot hide a newer active call',async()=>{
 const f=fixture();await f.m.endCall();f.enter(f.b);
 const scene=f.c.document.getElementById('vc-scene-call');scene.style.display='flex';
 for(const fn of f.timers)fn();assert.equal(scene.style.display,'flex');
});

test('an active call timeout reports a retryable error and releases generation controls',async()=>{
 const f=fixture(),job=f.m.triggerAiReply();
 const controller=f.m.state.replyController;
 f.timers[f.timers.length-1](); await job;
 assert.equal(controller.signal.aborted,true);
 assert.equal(f.m.state.isGenerating,false);
 assert.equal(f.m.state.isAiSpeaking,false);
 assert.ok(f.toasts.some(text=>/超时/.test(text)));
 f.pending[0].finish('[a的声音：late]'); await Promise.resolve();
 assert.equal(f.delivered.length,0);
 const retry=f.m.triggerAiReply(); f.pending[1].finish('[a的声音：retry]'); await retry;
 assert.equal(f.delivered.length,1);
});

test('intentional hangup and expired session timeouts do not show a connection error',async()=>{
 const ended=fixture(),job=ended.m.triggerAiReply();await ended.m.endCall();await job;
 assert.deepEqual(ended.toasts,[]);
 const stale=fixture(),old=stale.m.triggerAiReply();stale.enter(stale.b);
 stale.timers[stale.timers.length-1]();await old;
 assert.deepEqual(stale.toasts,[]);
});
