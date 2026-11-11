const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){let saved='';const c=vm.createContext({localStorage:{getItem:()=>saved,setItem:(_,v)=>saved=v},Date,console});vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/modules/request_memory_diagnostics.js'),'utf8'),c);return c.UvURequestDiagnostics;}
test('actual request diagnostics default off, retain no payload, isolate archive and do not mutate request',()=>{
 const d=fixture(),chat={id:'c',activeArchiveId:'a',myPersona:'u'},body={messages:[{role:'system',content:'标题：饮食\n内容：PRIVATE_FACT\nMEMOS\nVECTOR'},{role:'user',content:[{type:'text',text:'今天'}, {type:'image_url',image_url:{url:'data:image/png;base64,SECRET'}}]}]};
 assert.equal(d.begin(chat,'private',body),null);d.setEnabled(true);const before=JSON.stringify(body);
 const ticket=d.begin(chat,'private',body,{blocks:{memo:'MEMOS',vector:'VECTOR',mcp:'absent'},journals:[{id:'j',title:'饮食',fragment:'标题：饮食\n内容：PRIVATE_FACT'},{id:'missing',fragment:'NO'}]});d.finish(ticket,'completed');
 const report=d.get(chat,'private');assert.equal(report.status,'completed');assert.equal(report.fields.length,2);assert.equal(report.opaqueParts,1);assert.equal(report.blocks.find(b=>b.kind==='mcp').matched,false);assert.equal(report.journals[0].matched,true);assert.equal(report.journals[1].matched,false);
 assert.doesNotMatch(JSON.stringify(report),/PRIVATE_FACT|MEMOS|VECTOR|SECRET/);assert.equal(JSON.stringify(body),before);
 chat.activeArchiveId='b';assert.equal(d.get(chat,'private'),null);chat.activeArchiveId='a';chat.myPersona='different';assert.equal(d.get(chat,'private'),null);
});
test('diagnostic clear and opt-out reject late responses; old request cannot replace latest',()=>{
 const d=fixture(),c={id:'c',activeArchiveId:'a'},body={contents:[{role:'user',parts:[{text:'chat'}]}],system_instruction:{parts:[{text:'system'}]}};d.setEnabled(true);
 const first=d.begin(c,'private',body),second=d.begin(c,'private',body);d.finish(second,'completed');d.finish(first,'failed');assert.equal(d.get(c,'private').status,'completed');
 d.clear(c,'private');d.finish(second,'failed');assert.equal(d.get(c,'private'),null);
 const last=d.begin(c,'private',body);d.setEnabled(false);d.setEnabled(true);d.finish(last,'completed');assert.equal(d.get(c,'private'),null);
});
test('diagnostics bound details while counting final Gemini fields without invoking retrieval',()=>{
 const d=fixture(),c={id:'c'};d.setEnabled(true);const body={contents:Array.from({length:600},()=>({role:'user',parts:[{text:'x'}]})),system_instruction:{parts:[{text:'VECTOR'}]}};
 d.begin(c,'private',body,{blocks:{vector:'VECTOR'}});const r=d.get(c,'private');assert.equal(r.textChars,606);assert.equal(r.fieldCount,601);assert.ok(r.fields.length<=256);assert.equal(r.truncated,true);assert.equal(r.blocks.find(b=>b.kind==='vector').matched,true);
});
test('diagnostic retention expires, bounds chat count, and limits scan without claiming absence',()=>{
 const d=fixture();d.setEnabled(true);const first={id:'first'};d.begin(first,'private',{messages:[{role:'user',content:'hello'}]});
 for(let i=0;i<16;i++)d.begin({id:String(i)},'private',{messages:[]});assert.equal(d.get(first),null);
 const chat={id:'huge'},fragment='AFTER_LIMIT';d.begin(chat,'private',{messages:[{role:'system',content:'x'.repeat(2*1024*1024)+fragment}]},{blocks:{memo:fragment}});const r=d.get(chat);assert.equal(r.truncated,true);assert.equal(r.blocks[0].matched,null);
 const now=Date.now;try{Date.now=()=>now()+3600001;assert.equal(d.get(chat),null);}finally{Date.now=now;}
});
