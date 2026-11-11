'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){const c=vm.createContext({Date,Intl,console,structuredClone,AbortController,DOMException,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,db:{characters:[],apiSettings:{url:'https://fixture.test',key:'fixture',model:'test'}},calls:0});c.window=c;c.dexieDB={globalSettings:{put:async()=>{}},transaction:async(...a)=>a.at(-1)()};c.runDataPersistence=f=>f();c.buildChatApiRequest=(api,messages)=>({requestBody:{messages},headers:{},endpoint:api.url});c.fetchAiResponse=async()=>{c.calls++;return JSON.stringify({events:[{title:'备课',start:'2026-11-07',end:'2026-11-07',time:'09:00',endTime:'10:00'}],mood:{mood:'calm'}});};
for(const f of ['calendar_core.js','calendar_ai.js']){const p=path.join(__dirname,'../js/modules',f);if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),c);}c.chat={id:'a',activeArchiveId:'one',persona:'教师',realName:'甲',history:[{id:'m1',role:'user',content:'明天见'}]};c.db.characters=[c.chat];return c;}
test('calendar AI disabled after-reply path makes zero external calls',async()=>{const c=fixture();assert.ok(c.UvUCalendarAI);await c.UvUCalendarAI.afterReply(c.chat);assert.equal(c.calls,0);assert.equal(c.UvUCalendar.context(c.chat),'');});
test('calendar AI proposals require explicit apply and cannot replace locked events',async()=>{const c=fixture(),C=c.UvUCalendar,A=c.UvUCalendarAI;assert.ok(A);await C.saveEvent({owner:C.owner(c.chat),title:'锁定工作',start:'2026-11-07',end:'2026-11-07',time:'11:00',endTime:'12:00',locked:true});const p=await A.generate(c.chat,'2026-11-07');assert.equal(C.state().events.length,1);await A.apply(c.chat,p);assert.deepEqual(Array.from(C.state().events,e=>e.title),['锁定工作','备课']);await assert.rejects(A.apply(c.chat,p),/失效|保存|变化/);});
test('calendar AI archive switch and manual edits invalidate in-flight proposals',async()=>{const c=fixture(),A=c.UvUCalendarAI,C=c.UvUCalendar;assert.ok(A);const p=await A.generate(c.chat,'2026-11-07');c.chat.activeArchiveId='two';await assert.rejects(A.apply(c.chat,p),/变化|失效/);c.chat.activeArchiveId='one';const q=await A.generate(c.chat,'2026-11-07');await C.saveMood({owner:'user',date:'2026-11-07',mood:'happy'});await assert.rejects(A.apply(c.chat,q),/变化|失效/);});
test('calendar AI rejects foreign updates and never lets response fields enable sharing',async()=>{const c=fixture(),A=c.UvUCalendarAI,C=c.UvUCalendar;assert.ok(A);c.fetchAiResponse=async()=>JSON.stringify({events:[{owner:'user',title:'越权',start:'2026-11-07',end:'2026-11-07'}],shareHealth:true});const p=await A.generate(c.chat,'2026-11-07');await A.apply(c.chat,p);assert.equal(C.state().events[0].owner,C.owner(c.chat));assert.equal(C.profile(C.owner(c.chat)).shareHealth,false);});
test('calendar AI malformed output leaves records unchanged',async()=>{const c=fixture(),A=c.UvUCalendarAI;assert.ok(A);c.fetchAiResponse=async()=>'{bad';await assert.rejects(A.generate(c.chat,'2026-11-07'),/格式|JSON/);assert.equal(c.UvUCalendar.state().events.length,0);});

test('calendar AI preview date cannot be changed before applying',async()=>{const c=fixture(),A=c.UvUCalendarAI,p=await A.generate(c.chat,'2026-11-07');await assert.rejects(A.apply(c.chat,{...p,date:'2026-11-08'}),/变化|失效/);assert.equal(c.UvUCalendar.state().events.length,0);});
test('calendar AI rejects malformed candidate times before preview and reports conflicts',async()=>{const c=fixture(),A=c.UvUCalendarAI,C=c.UvUCalendar;c.fetchAiResponse=async()=>JSON.stringify({events:[{title:'bad',time:'29:00',endTime:'30:00'}]});await assert.rejects(A.generate(c.chat,'2026-11-07'),/时间/);c.fetchAiResponse=async()=>JSON.stringify({events:[{title:'conflict',time:'09:00',endTime:'10:00'}]});await C.saveEvent({owner:C.owner(c.chat),title:'existing',start:'2026-11-07',time:'09:00',endTime:'10:00'});const p=await A.generate(c.chat,'2026-11-07');const result=await A.apply(c.chat,p);assert.equal(result.skipped,1);assert.match(A.status(C.owner(c.chat)),/跳过1/);assert.equal(C.state().events.length,1);});

test('calendar AI rechecks owner after waiting in shared persistence queue',async()=>{const c=fixture(),A=c.UvUCalendarAI,p=await A.generate(c.chat,'2026-11-07');let flush;c.runDataPersistence=f=>new Promise((resolve,reject)=>{flush=()=>Promise.resolve().then(f).then(resolve,reject);});const saving=A.apply(c.chat,p);await new Promise(setImmediate);c.chat.activeArchiveId='two';await flush();await assert.rejects(saving,/变化|存档/);assert.equal(c.db.calendarData,undefined);});

test('calendar autonomy tolerates a director without its internal cleaner',async()=>{const c=fixture(),C=c.UvUCalendar;c.VoiceDirector={};await C.saveProfile(C.owner(c.chat),{autonomy:true});c.fetchAiResponse=async()=>JSON.stringify({events:[]});await c.UvUCalendarAI.generate(c.chat,'2026-11-07',undefined,{update:true});assert.equal(c.calls,0);});
test('manual proposal can opt out of AI mood independently of events',async()=>{const c=fixture(),p=await c.UvUCalendarAI.generate(c.chat,'2026-11-07');await c.UvUCalendarAI.apply(c.chat,{...p,includeMood:false});assert.equal(c.UvUCalendar.state().events.length,1);assert.equal(c.UvUCalendar.state().moods.length,0);});

test('optional schedule review queues automatic proposals without changing records or repeating calls',async()=>{
    const c=fixture(),C=c.UvUCalendar,A=c.UvUCalendarAI,key=C.owner(c.chat);
    await C.saveProfile(key,{autoGenerate:true,reviewChanges:true});
    await A.afterReply(c.chat);
    assert.equal(C.state().events.length,0);assert.equal(C.state().moods.length,0);
    const proposals=A.pending(c.chat);assert.equal(proposals.length,1);
    proposals[0].events[0].title='tampered';assert.equal(A.pending(c.chat)[0].events[0].title,'备课');
    c.chat.history.push({id:'next',role:'assistant',content:'新回复'});
    await A.afterReply(c.chat);assert.equal(A.pending(c.chat).length,1,'obsolete proposal replaced after new conversation');
    const current=A.pending(c.chat)[0];await A.apply(c.chat,{...current,includeMood:false});
    assert.equal(C.state().events.length,1);assert.equal(A.pending(c.chat).length,0);
});
test('pending calendar review can be discarded and is invalidated by archive and manual changes',async()=>{
    const c=fixture(),C=c.UvUCalendar,A=c.UvUCalendarAI,key=C.owner(c.chat);
    await C.saveProfile(key,{autoGenerate:true,reviewChanges:true});await A.afterReply(c.chat);
    const p=A.pending(c.chat)[0];A.discard(c.chat,p.token);assert.equal(A.pending(c.chat).length,0);assert.equal(C.state().events.length,0);
    c.chat.history.push({id:'next',role:'user',content:'安排'});await A.afterReply(c.chat);
    c.chat.activeArchiveId='two';assert.equal(A.pending(c.chat).length,0);c.chat.activeArchiveId='one';
    await C.saveMood({owner:'user',date:C.today(),mood:'happy'});assert.equal(A.pending(c.chat).length,0);
});
test('duplicate selected calendar action cannot be applied twice',async()=>{
    const c=fixture(),A=c.UvUCalendarAI,p=await A.generate(c.chat,'2026-11-07');
    await assert.rejects(A.apply(c.chat,{...p,events:[p.events[0],p.events[0]]}),/重复|变化/);
    assert.equal(c.UvUCalendar.state().events.length,0);
});

test('changing user persona invalidates pending independent schedule analysis',async()=>{
    const c=fixture(),A=c.UvUCalendarAI;let release;c.fetchAiResponse=()=>new Promise(r=>release=r);
    const waiting=A.generate(c.chat,'2026-11-07');c.chat.myPersona='另一位用户';release(JSON.stringify({events:[{title:'旧用户的约定'}]}));
    await assert.rejects(waiting,/角色|记录|变化/);assert.equal(c.UvUCalendar.state().events.length,0);
});
