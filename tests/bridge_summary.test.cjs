const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(){
 const calls=[],ctx=vm.createContext({console,structuredClone,AbortController,setTimeout,clearTimeout,TextEncoder,
  UvUBridgeText:require('../js/modules/bridge_text.js'),
  buildJournalSummaryPrompt:(chat,type,messages,include)=>{calls.push({kind:'prompt',chat,messages,include});return 'ORIGINAL_SUMMARY\n'+messages.map(m=>m.content).join('\n');},
  buildJournalMergePrompt:(chat,text)=>'ORIGINAL_MERGE\n'+text,
  resolveAuxiliaryApiConfig:()=>({url:'https://example.test',key:'private',model:'model'}),
  resolveAutoMemoryApi:()=>({url:'https://memory.test',key:'private2',model:'embedding-not-used'}),
  buildChatApiRequest:(config,messages)=>({requestBody:{messages},endpoint:config.url,headers:{}}),
  fetchAiResponse:async(config,body)=>{calls.push({kind:'api',config,body});return '<title>摘要</title><content>客观记录约定。</content>';}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/bridge_summary.js'),'utf8'),ctx);
 return {ctx,api:ctx.UvUBridgeSummary,calls};
}
const items=[{id:'f1',text:'已选剧情。',selected:true,floor:{number:1,speaker:'甲',createdAt:0}},{id:'f2',text:'不应总结的剧情',selected:false}];
test('summary fact comparison contains only selected floors with speaker and unknown plot date', () => {
 const f=setup(),rows=f.api.factChecklist(items);assert.equal(rows.length,1);assert.equal(rows[0].speaker,'甲');assert.equal(rows[0].date,'未知');assert.equal(rows[0].floor,1);assert.match(rows[0].text,/已选剧情/);
});
test('external summary uses existing third-person factory without changing style/history or adding unselected stories',async()=>{
 const f=setup(),chat={id:'c',journalStyleSettings:{mode:'default'},history:[{content:'LOCAL_HISTORY'}]};const before=JSON.stringify(chat);
 const result=await f.api.generate(chat,items,{});
 assert.equal(result.content,'客观记录约定。');assert.equal(JSON.stringify(chat),before);
 const prompt=f.calls.find(c=>c.kind==='prompt');assert.equal(prompt.chat.journalStyleSettings.mode,'summary');assert.equal(prompt.include,false);
 const sent=JSON.stringify(f.calls.filter(c=>c.kind==='api'));assert.match(sent,/已选剧情/);assert.doesNotMatch(sent,/不应总结|LOCAL_HISTORY|1970/);
 assert.match(sent,/未知/);assert.equal(result.items.length,1);
});
test('long floors are bounded, merged and successful batches are reused after a later failure',async()=>{
 const f=setup(),cache=new Map();let count=0;
 f.ctx.fetchAiResponse=async()=>{if(++count===2)throw new Error('offline');return '<title>摘要</title><content>分段摘要。</content>';};
 const source=[{id:'long',selected:true,text:'长剧情。'.repeat(3000),floor:{speaker:'甲'}}];
 await assert.rejects(f.api.generate({id:'c'},source,{batchChars:4000,cache}),/offline/);
 assert.ok(cache.size>0);let retried=0;
 f.ctx.fetchAiResponse=async()=>{retried++;return '<title>摘要</title><content>分段摘要。</content>';};
 const result=await f.api.generate({id:'c'},source,{batchChars:4000,cache});
 assert.ok(result.content);assert.ok(retried<count+5);assert.ok(result.batchCount>1);
 for(const call of f.calls.filter(c=>c.kind==='prompt'))assert.ok(call.messages.reduce((n,m)=>n+m.content.length,0)<=4300);
});
test('cancelled or stale requests and malformed API output never become summary results',async()=>{
 const f=setup(),control=new AbortController();control.abort();
 await assert.rejects(f.api.generate({},items,{signal:control.signal}),/取消/);
 await assert.rejects(f.api.generate({},items,{assertCurrent:()=>{throw new Error('stale');}}),/stale/);
 f.ctx.fetchAiResponse=async()=>'<content>broken';
 await assert.rejects(f.api.generate({},items,{}),/格式|完整/);
});
test('emoji and long metadata respect each source batch bound without broken surrogate pairs',()=>{
 const f=setup(),text='😀'.repeat(8000),groups=f.api.batches([{id:'f',text,floor:{speaker:'甲'.repeat(120)}}],2000);
 assert.ok(groups.length>1);
 for(const group of groups){assert.ok(group.reduce((n,m)=>n+m.content.length,0)<=2000);for(const message of group)assert.doesNotMatch(message.content,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);}
 assert.equal(groups.flat().map(message=>message.content.slice(message.content.indexOf('\n')+1)).join(''),text);
});
test('real journal summary factory retains its third-person requirements and leaves original style and messages unchanged',async()=>{
 const f=setup();f.ctx.db={worldBooks:[]};f.ctx.pad=value=>String(value).padStart(2,'0');
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/journal.js'),'utf8'),f.ctx);
 const chat={id:'c',realName:'甲',history:[{content:'LOCAL_HISTORY'}],memoryJournals:[{content:'OLD_FAVORITE',isFavorited:true}],journalStyleSettings:{mode:'custom',customWorldBookIds:['original']}};
 const before=JSON.stringify(chat);await f.api.generate(chat,items,{});
 const prompt=f.calls.find(call=>call.kind==='api').body.messages[0].content;
 assert.match(prompt,/专业的对话记录总结助手/);assert.match(prompt,/第三人称/);assert.match(prompt,/关键原话摘录/);
 assert.doesNotMatch(prompt,/LOCAL_HISTORY|OLD_FAVORITE|1970|\[系统时间:/);assert.equal(JSON.stringify(chat),before);
});

test('summary request budget stops before extra paid calls and resumes successful groups',async()=>{
 const f=setup(),cache=new Map(),source=[{id:'long',selected:true,text:'剧情'.repeat(5000)}];
 await assert.rejects(f.api.generate({},source,{batchChars:2000,maxCalls:1,cache}),/预算/);
 assert.equal(f.calls.filter(x=>x.kind==='api').length,1);assert.equal(cache.size,1);
 const plan=f.api.estimate(source,{batchChars:2000});assert.ok(plan.batchCount>1);assert.equal(plan.sourceChars,10000);
 const progress=[];const result=await f.api.generate({},source,{batchChars:2000,maxCalls:20,cache,onBudgetProgress:x=>progress.push(x)});
 assert.ok(result.content);assert.ok(progress.some(x=>x.cached>0));assert.ok(result.callCount<=20);
});

test('successful summary groups emit safe bounded resume keys and can continue after a fresh cache',async()=>{
 const f=setup();f.ctx.crypto=require('node:crypto').webcrypto;const saved=[];const source=[{id:'long',selected:true,text:'长剧情。'.repeat(2000)}];
 await assert.rejects(f.api.generate({},source,{batchChars:2000,maxCalls:1,onCache:(key,value)=>saved.push([key,value])}),/预算/);
 assert.equal(saved.length,1);assert.match(saved[0][0],/^[a-f0-9]{64}$/);assert.doesNotMatch(saved[0][0],/example|剧情|private/);
 const resumed=await f.api.generate({},source,{batchChars:2000,maxCalls:20,cache:new Map(saved)});assert.equal(resumed.cachedCount,1);
});

test('cancelling while a summary cache key is calculated prevents the API request',async()=>{
 const f=setup(),control=new AbortController();let release,started;
 const reached=new Promise(resolve=>started=resolve);
 f.ctx.crypto={subtle:{digest:()=>new Promise(resolve=>{release=()=>resolve(new Uint8Array(32).buffer);started();})}};
 const pending=f.api.generate({},items,{signal:control.signal});
 await reached;control.abort();release();
 await assert.rejects(pending,/取消/);
 assert.equal(f.calls.filter(call=>call.kind==='api').length,0);
});

test('an archive becoming stale during summary hashing cannot dispatch a paid request',async()=>{
 const f=setup();let release,started,current=true;
 const reached=new Promise(resolve=>started=resolve);
 f.ctx.crypto={subtle:{digest:()=>new Promise(resolve=>{release=()=>resolve(new Uint8Array(32).buffer);started();})}};
 const pending=f.api.generate({},items,{assertCurrent:()=>{if(!current)throw new Error('stale');}});
 await reached;current=false;release();
 await assert.rejects(pending,/stale/);
 assert.equal(f.calls.filter(call=>call.kind==='api').length,0);
});

test('cancellation from a summary progress callback stops before dispatch',async()=>{
 const f=setup(),control=new AbortController();
 await assert.rejects(f.api.generate({},items,{signal:control.signal,onBudgetProgress:()=>control.abort()}),/取消/);
 assert.equal(f.calls.filter(call=>call.kind==='api').length,0);
});
