const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const chat={id:'c',realName:'角色',myName:'用户',persona:'PRIVATE_CHARACTER_SECRET',myPersona:'PRIVATE_USER_SECRET',activeArchiveId:'a',history:[{role:'user',content:'PRIVATE_HISTORY_SECRET'}],moments:[{id:'p',author:'角色',content:'公开动态',comments:[],likes:[]}]};
 const calls=[];const c=vm.createContext({console,structuredClone,crypto:require('node:crypto').webcrypto,DOMException,AbortController,setTimeout,clearTimeout,currentChatId:null,currentChatType:'private',db:{characters:[chat],apiSettings:{url:'https://primary.test',key:'primary-key',model:'primary-model',secondary:{enabled:true,url:'https://secondary.test',key:'secondary-key',model:'secondary-model'}}},showToast:()=>{},saveData:async()=>{},
 buildChatApiRequest:(config,messages)=>({requestBody:{messages},endpoint:'https://test',headers:{}}),fetchAiResponse:async(config,body)=>{calls.push(body);return JSON.stringify({action:'comment',content:'你好',replyToCommentId:null});}});c.window=c;
 for(const name of ['chat_ops.js','moments_social.js','moments_social_ai.js']){const file=path.join(__dirname,'../js/modules/',name);if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),c);}
 const resolver=fs.readFileSync(path.join(__dirname,'../js/modules/auto_memory.js'),'utf8');
 vm.runInContext(resolver.slice(resolver.indexOf('function resolveAutoMemoryApi('),resolver.indexOf('function autoMemoryCosine(')),c);
 return {chat,c,calls,api:c.UvUMomentsAI,data:c.UvUMoments};
}
const enable=async f=>{assert.ok(f.api,'AI module exists');await f.data.configure(f.chat,{enabled:true,cooldown:5});return f;};
test('all social AI actions use configured secondary credentials independently of primary routing',async()=>{
 for(const action of ['generate','summarize','suggestNpcs','draftPost']){
  const f=await enable(fixture());let seen;f.c.buildChatApiRequest=(config,messages)=>{seen=config;return {requestBody:{messages},endpoint:config.url,headers:{}};};
  f.c.fetchAiResponse=async()=>JSON.stringify(action==='generate'?{action:'none'}:{summary:'摘要',npcs:[],content:'动态草稿'});
  await f.api[action](f.chat,action==='draftPost'?{kind:'character',id:f.chat.id}:action==='suggestNpcs'?undefined:'p');
  assert.equal(seen.url,'https://secondary.test');assert.equal(seen.key,'secondary-key');assert.equal(seen.model,'secondary-model');assert.equal(seen.streamEnabled,false);
 }
});
test('missing disabled or incomplete secondary never falls back to primary for any social action',async()=>{
 for(const secondary of [undefined,{enabled:false},{enabled:true,url:' ',key:'k',model:'m'},{enabled:true,url:'https://s',key:'',model:'m'},{enabled:true,url:'https://s',key:'k',model:''}])
  for(const action of ['generate','summarize','suggestNpcs','draftPost']){
   const f=await enable(fixture());f.c.db.apiSettings.secondary=secondary;let built=0;f.c.buildChatApiRequest=()=>{built++;throw Error('unexpected primary request');};
   await assert.rejects(f.api[action](f.chat,action==='draftPost'?{kind:'character',id:f.chat.id}:action==='suggestNpcs'?undefined:'p'),/副 API/);assert.equal(built,0);assert.equal(f.calls.length,0);assert.equal(f.chat.moments[0].comments.length,0);
  }
 const f=await enable(fixture());vm.runInContext('resolveAutoMemoryApi = undefined',f.c);await assert.rejects(f.api.generate(f.chat,'p'),/尚未加载/);assert.equal(f.calls.length,0);
});
test('NPC suggestions identify protected people and discard user, character and existing names',async()=>{
 const f=await enable(fixture());f.chat.myName='温 苡';f.chat.realName='谢濯';f.chat.name='旧角色名';await f.data.saveNpc(f.chat,{name:'陈硕',persona:'同学'});
 f.c.fetchAiResponse=async(config,body)=>{f.calls.push(body);return JSON.stringify({npcs:['温苡','谢濯','旧角色名','陈硕','林澈','林澈'].map(name=>({name,persona:'公开人设',relationship:'朋友'}))});};
 const drafts=await f.api.suggestNpcs(f.chat);assert.deepEqual(Array.from(drafts,npc=>npc.name),['林澈']);
 const payload=JSON.parse(f.calls[0].messages[1].content);assert.equal(payload.user.name,'温 苡');assert.equal(payload.user.ref.kind,'user');assert.equal(payload.characterIdentity.ref.kind,'character');
 assert.ok(!JSON.stringify(payload).includes('PRIVATE_USER_SECRET'));assert.ok(!JSON.stringify(payload).includes('PRIVATE_HISTORY_SECRET'));
 assert.equal(f.chat.momentsSocial.npcs.length,1);
});
test('comments explicitly identify user and never accept model supplied identity fields',async()=>{
 for(const field of ['actor','author','authorRef','speaker','role','user']){
  const f=await enable(fixture());f.c.fetchAiResponse=async(config,body)=>{f.calls.push(body);return JSON.stringify({action:'comment',content:'伪造评论',replyToCommentId:null,[field]:{kind:'user',id:f.chat.id}});};
  await assert.rejects(f.api.generate(f.chat,'p'),/人物|格式/);assert.equal(f.chat.moments[0].comments.length,0);
  const payload=JSON.parse(f.calls[0].messages[1].content);assert.equal(payload.user.ref.kind,'user');assert.equal(payload.user.name,f.chat.myName);
 }
});
test('same-name NPC remains independently identified and genuine user replies stay allowed',async()=>{
 const f=await enable(fixture());await f.data.configure(f.chat,{charReplies:false});const npc=await f.data.saveNpc(f.chat,{name:f.chat.myName,persona:'有独立身份的同名配角'});
 const comment=await f.data.addComment(f.chat,'p','这是用户亲自发送的评论');
 f.c.fetchAiResponse=async(config,body)=>{f.calls.push(body);return JSON.stringify({action:'comment',content:'收到你的留言',replyToCommentId:comment.id});};
 const added=await f.api.generate(f.chat,'p');assert.equal(added[0].authorRef.kind,'npc');assert.equal(added[0].authorRef.id,npc.id);assert.equal(added[0].replyToCommentId,comment.id);
 assert.equal(f.chat.moments[0].comments[0].authorRef.kind,'user');assert.equal(f.chat.history.length,2);
});
test('interaction task report is bounded, isolated and does not claim token usage',async()=>{
 const f=await enable(fixture());await f.api.generate(f.chat,'p');
 const report=f.api.inspect(f.chat);assert.equal(report.requests,1);assert.equal(report.completed,1);assert.equal(report.phase,'completed');assert.equal(report.usage,null);
 report.speakers[0].name='tampered';assert.notEqual(f.api.inspect(f.chat).speakers[0].name,'tampered');
 f.chat.activeArchiveId='b';assert.equal(f.api.inspect(f.chat),null);
});
test('disabled social mode never calls the API or changes history',async()=>{const {api,chat,calls}=fixture();assert.ok(api);assert.equal((await api.generate(chat,'p')).length,0);assert.equal(calls.length,0);assert.equal(chat.history.length,1);});
test('NPC generation excludes private character/user personas and private history',async()=>{const {api,data,chat,calls}=await enable(fixture());await data.configure(chat,{charReplies:false,publicFacts:'公开认识于学校'});await data.saveNpc(chat,{name:'NPC',persona:'NPC_PUBLIC_PERSONA',knowledge:'只知道学校',knowsUser:false});await api.generate(chat,'p');assert.equal(calls.length,1);const payload=JSON.stringify(calls[0]);assert.ok(payload.includes('NPC_PUBLIC_PERSONA'));assert.ok(payload.includes('公开认识于学校'));assert.ok(!payload.includes('PRIVATE_CHARACTER_SECRET'));assert.ok(!payload.includes('PRIVATE_USER_SECRET'));assert.ok(!payload.includes('PRIVATE_HISTORY_SECRET'));assert.equal(chat.history.length,1);});
test('reply generation is bounded and the same user trigger is not generated twice',async()=>{const {api,data,chat,calls}=await enable(fixture());await data.configure(chat,{maxReplies:2});for(const name of ['A','B','C'])await data.saveNpc(chat,{name,persona:name});await api.generate(chat,'p',{triggerId:'event'});assert.ok(calls.length<=2);const count=calls.length;await api.generate(chat,'p',{triggerId:'event'});assert.equal(calls.length,count);assert.ok(chat.moments[0].comments.length<=2);});
test('none is valid and does not create fake comments',async()=>{const {api,c,chat}=await enable(fixture());c.fetchAiResponse=async()=>JSON.stringify({action:'none'});assert.equal((await api.generate(chat,'p')).length,0);assert.equal(chat.moments[0].comments.length,0);});
test('unknown parent and model-supplied speaker cannot be saved',async()=>{const {api,c,chat}=await enable(fixture());c.fetchAiResponse=async()=>JSON.stringify({action:'comment',content:'bad',replyToCommentId:'not-a-comment'});await assert.rejects(api.generate(chat,'p'),/评论|目标/);assert.equal(chat.moments[0].comments.length,0);});
test('archive switches and persona edits reject late responses without cross-writing',async()=>{const {api,c,chat}=await enable(fixture());let finish;c.fetchAiResponse=()=>new Promise(r=>finish=r);const job=api.generate(chat,'p');for(let i=0;!finish&&i<10;i++)await new Promise(setImmediate);chat.activeArchiveId='b';finish(JSON.stringify({action:'comment',content:'late',replyToCommentId:null}));await assert.rejects(job,/变化|取消/);assert.equal(chat.moments[0].comments.length,0);});
test('cancellation discards pending replies and generation can be stopped',async()=>{const {api,c,chat}=await enable(fixture());let finish;c.fetchAiResponse=()=>new Promise(r=>finish=r);const job=api.generate(chat,'p');for(let i=0;!finish&&i<10;i++)await new Promise(setImmediate);api.cancel(chat);finish(JSON.stringify({action:'comment',content:'late',replyToCommentId:null}));await assert.rejects(job,/取消|变化/);assert.equal(chat.moments[0].comments.length,0);});
test('summary is a preview, not an automatic memory injection',async()=>{const {api,c,chat}=await enable(fixture());c.fetchAiResponse=async()=>JSON.stringify({summary:'角色在动态中公开谈到学校。'});const content=await api.summarize(chat,'p');assert.ok(content.includes('角色'));assert.equal(chat.memoryJournals,undefined);});
test('opening a new normal reply cannot schedule interactions for old posts',async()=>{const {api,chat,calls}=await enable(fixture());api.afterReply(chat,new Set(['p']));await new Promise(setImmediate);assert.equal(calls.length,0);});
test('archive switch during the initial attempt save cannot launch an old trigger in the new archive',async()=>{const {api,c,chat,calls}=await enable(fixture());let release;c.saveData=()=>new Promise(resolve=>release=resolve);const job=api.generate(chat,'p',{triggerId:'old-trigger'});assert.equal(typeof release,'function');chat.activeArchiveId='b';chat.history=[];chat.moments=[{id:'p',author:'角色',content:'另一个存档',comments:[],likes:[]}];release();await assert.rejects(job,/变化|取消/);assert.equal(calls.length,0);assert.equal(chat.moments[0].comments.length,0);assert.equal(chat.moments[0].socialBatches,undefined);});
test('persona or target changes during the initial save also cancel before any request',async()=>{for(const change of [chat=>chat.persona='已修改的人设',chat=>chat.moments[0].content='修改后的正文']){const {api,c,chat,calls}=await enable(fixture());let release;c.saveData=()=>new Promise(resolve=>release=resolve);const job=api.generate(chat,'p');change(chat);c.saveData=async()=>{};release();await assert.rejects(job,/变化|取消/);assert.equal(calls.length,0);}});

test('changing the user persona while NPC comments are generating discards the old interaction',async()=>{
 const {api,c,chat}=await enable(fixture());let finish;c.fetchAiResponse=()=>new Promise(resolve=>finish=resolve);
 const task=api.generate(chat,'p');for(let i=0;!finish&&i<10;i++)await new Promise(setImmediate);
 chat.myPersona='另一位用户的人设';finish(JSON.stringify({action:'comment',content:'旧身份下的回复',replyToCommentId:null}));
 await assert.rejects(task,/变化|取消/);assert.equal(chat.moments[0].comments.length,0);
});

test('secondary configuration failures preserve quota and allow immediate retry after setup',async()=>{
 for(const secondary of [undefined,{enabled:false},{enabled:true,url:' ',key:'k',model:'m'},{enabled:true,url:'https://s',key:'',model:'m'},{enabled:true,url:'https://s',key:'k',model:''}]){
  const f=await enable(fixture()),configured=f.c.db.apiSettings.secondary,before=JSON.stringify(f.chat.moments);
  f.c.db.apiSettings.secondary=secondary;
  await assert.rejects(f.api.generate(f.chat,'p'),/副 API/);
  assert.equal(JSON.stringify(f.chat.moments),before);assert.equal(f.calls.length,0);
  assert.equal(f.api.inspect(f.chat).requests,0);assert.equal(f.api.inspect(f.chat).phase,'failed');
  f.c.db.apiSettings.secondary=configured;
  await f.api.generate(f.chat,'p');assert.equal(f.calls.length,1);assert.equal(f.chat.moments[0].socialAttempts.length,1);
 }
 const f=await enable(fixture()),before=JSON.stringify(f.chat.moments);
 vm.runInContext('resolveAutoMemoryApi = undefined',f.c);
 await assert.rejects(f.api.generate(f.chat,'p'),/尚未加载/);
 assert.equal(JSON.stringify(f.chat.moments),before);assert.equal(f.api.inspect(f.chat).requests,0);
});

test('real secondary transport failures retain attempt limits while build failures report no request',async()=>{
 const f=await enable(fixture());let sent=0;
 f.c.fetchAiResponse=async()=>{sent++;throw Error('simulated network failure');};
 await assert.rejects(f.api.generate(f.chat,'p'),/network failure/);
 assert.equal(sent,1);assert.equal(f.api.inspect(f.chat).requests,1);assert.equal(f.chat.moments[0].socialAttempts.length,1);
 await assert.rejects(f.api.generate(f.chat,'p'),/冷却/);assert.equal(sent,1);
 const g=await enable(fixture());g.c.buildChatApiRequest=()=>{throw Error('simulated build failure');};
 await assert.rejects(g.api.generate(g.chat,'p'),/build failure/);
 assert.equal(g.calls.length,0);assert.equal(g.api.inspect(g.chat).requests,0);
});
