const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const load=(c,name)=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules',name),'utf8'),c);
const storage=()=>{const map=new Map();return {map,getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
function bridge(fetchImpl){
 const local=storage(),chat={id:'a',activeArchiveId:'one',memoryJournals:[]};
 const c=vm.createContext({window:{},db:{characters:[chat],uvuStoryBridgeSettings:{baseUrl:'http://127.0.0.1:8765/api/plugins/uvu-story-bridge'}},localStorage:local,document:{getElementById:()=>null},navigator:{},fetch:fetchImpl,URL,TextEncoder,TextDecoder,AbortController,DOMException,setTimeout,clearTimeout,structuredClone,crypto:require('node:crypto').webcrypto,saveData:async()=>{}});
 for(const name of ['bridge_text.js','bridge_file.js','story_bridge.js'])load(c,name);
 local.setItem('uvu-story-bridge.v1',JSON.stringify({token:'secret'}));return {c,api:c.window.UvUStoryBridge,local,chat};
}
const raw=fs.readFileSync(path.join(__dirname,'../js/modules/story_bridge.js'),'utf8');
function requestBridge(fetchImpl){const f=bridge(fetchImpl);vm.runInContext(raw.replace('window.setupUvUStoryBridge =','window.__request=request; window.setupUvUStoryBridge ='),f.c);f.api=f.c.window.UvUStoryBridge;return f;}
test('IS19/21 bridge rejects oversized and non-JSON streamed bodies without changing state',async()=>{
 for(const response of [new Response('x',{headers:{'content-type':'text/html'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':String(16*1024*1024+1)}})]){
  const f=requestBridge(async()=>response);await assert.rejects(f.c.window.__request('/client/service'),/JSON|过大|大小/);assert.equal(f.chat.memoryJournals.length,0);assert.equal(f.api.diagnosticsSnapshot().request.stage,'response');
 }
});
test('IS19 chunked size limit and pre-aborted caller cancel without mutating the cursor',async()=>{
 let cancelled=false;const f=requestBridge(async()=>new Response(new ReadableStream({start(c){for(let i=0;i<17;i++)c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
 f.c.db.uvuStoryBridgeSettings.cursorByCharacter={a:3};await assert.rejects(f.c.window.__request('/client/events'),/过大/);assert.equal(cancelled,true);assert.equal(f.c.db.uvuStoryBridgeSettings.cursorByCharacter.a,3);
 const aborted=new AbortController();aborted.abort();await assert.rejects(f.c.window.__request('/client/events',{signal:aborted.signal}),/abort|取消/i);
});
test('IS20 bridge allows LAN and rejects remote cleartext and URL secrets before fetch',async()=>{
 let count=0,init;const f=requestBridge(async(_url,options)=>{count++;init=options;return new Response('{}',{headers:{'content-type':'application/json'}});});
 for(const address of ['http://public.test/bridge','https://user:pass@relay.test','https://relay.test?secret=x','https://relay.test/#secret']){f.c.db.uvuStoryBridgeSettings.baseUrl=address;await assert.rejects(f.c.window.__request('/client/service',{auth:false}),/地址|HTTPS|明文/);}
 assert.equal(count,0);f.c.db.uvuStoryBridgeSettings.baseUrl='http://192.168.1.2:8765/bridge';await f.c.window.__request('/client/service',{auth:false});assert.equal(init.redirect,'error');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.credentials,'omit');
});
test('IS21 body timeout works without AbortSignal timeout/any and cancels reader',async()=>{
 let cancelled=false;const f=requestBridge(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
 await assert.rejects(f.c.window.__request('/client/service',{timeoutMs:15}),/超时|Timeout|abort/i);assert.equal(cancelled,true);
});
test('IS22 editable review versions are bounded; quota fallback retains current draft',()=>{
 const f=bridge(),journal={id:'j',externalSceneId:'scene',content:'original',bridgeReview:{channel:'st',archiveId:'one',items:[{id:'1',text:'0'}]}};
 for(let i=0;i<20;i++){journal.bridgeReview.items[0].text=String(i);f.api.writeReviewDraft(f.chat,journal,[{id:'1',text:'edit'+i}]);}
 const saved=f.api.readReviewDraft(f.chat,journal);assert.ok(saved.previousVersions.length<=5);assert.equal(saved.items[0].text,'edit19');
 const original=f.local.setItem;f.local.setItem=(key,value)=>{if(JSON.parse(value).previousVersions?.length)throw Error('quota');original(key,value);};
 f.api.writeReviewDraft(f.chat,journal,[{id:'1',text:'latest'}]);assert.equal(f.api.readReviewDraft(f.chat,journal).items[0].text,'latest');
});
test('IS26 resource-only legacy server supports repeated discovery without tools/list',async()=>{
 const calls=[],c=vm.createContext({window:{},URL,TextEncoder,TextDecoder,DOMException,AbortController,setTimeout,clearTimeout,btoa,fetch:async(_url,init)=>{const b=JSON.parse(init.body);calls.push(b.method);if(!b.id)return new Response(null,{status:202});return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:b.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{resources:{}}}:{resources:[]}}),{headers:{'content-type':'application/json'}});}});
 load(c,'mcp_transport.js');const client=c.window.MCPTransport.create({url:'https://tools.test/mcp',protocol:'2025-11-25'});await client.listTools();await client.listTools();await client.listResources();assert.equal(calls.includes('tools/list'),false);
});
test('IS29 remote credential removal invalidates runtime and session shadow',()=>{
 const events={},local=storage(),session=storage(),c=vm.createContext({window:{addEventListener:(name,fn)=>events[name]=fn,MCPTransport:{endpoint:v=>new URL(v).href}},db:{},localStorage:local,sessionStorage:session,URL,TextEncoder,TextDecoder,AbortController,DOMException,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto});
 load(c,'mcp_services.js');const api=c.window.MCPServices,s={id:'s',url:'https://tools.test/mcp',auth:'bearer'};api.vault.set(s,'session-old');const key=[...session.map.keys()][0];assert.equal(typeof events.storage,'function');events.storage({key,oldValue:'remembered',newValue:null,storageArea:local});assert.equal(api.vault.get(s),'');
});
test('IS27 multiple OAuth issuers require an explicit listed choice',async()=>{
 const calls=[],c=vm.createContext({window:{},location:{href:'https://uvu.test/',origin:'https://uvu.test'},URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,DOMException,setTimeout,clearTimeout,fetch:async(url)=>{calls.push(url);if(calls.length===1)return new Response(null,{status:401});return new Response(JSON.stringify({resource:'https://tools.test/mcp',authorization_servers:['https://first.test','https://second.test']}),{headers:{'content-type':'application/json'}});}});load(c,'mcp_oauth.js');await assert.rejects(c.window.MCPOAuth.discover({url:'https://tools.test/mcp',oauth:{clientId:'public'}}),/issuer|颁发|选择/);assert.equal(calls.length,2);
});
test('IS27 OAuth issuer choice survives normalization and diagnostic export excludes identifiers',()=>{
 const c=vm.createContext({window:{MCPTransport:{endpoint:v=>new URL(v).href}},db:{},localStorage:storage(),sessionStorage:storage(),URL,TextEncoder,TextDecoder,AbortController,DOMException,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto});load(c,'mcp_services.js');const api=c.window.MCPServices;
 const normalized=api.normalize({services:[{id:'s',url:'https://tools.test/mcp',auth:'oauth',oauth:{clientId:'public',issuer:'https://issuer.test/tenant'}}]});assert.equal(normalized.services[0].oauth.issuer,'https://issuer.test/tenant');assert.throws(()=>api.normalize({services:[{id:'s',url:'https://tools.test/mcp',auth:'oauth',oauth:{issuer:'http://remote.test'}}]}),/HTTPS|issuer/);
 api.log({serviceId:'private-role',toolName:'private-tool',stage:'discovery',code:'HTTP_401',status:'error',message:'secret',ms:2});const diagnostic=JSON.stringify(api.diagnostics());assert.match(diagnostic,/HTTP_401/);assert.ok(!/private-role|private-tool|secret|tools.test/.test(diagnostic));
});
test('IS29 session-only credential changes emit a token-free cross-page invalidation notice',()=>{
 const local=storage(),writes=[],set=local.setItem;local.setItem=(k,v)=>{writes.push({k,v});set(k,v);};const c=vm.createContext({window:{MCPTransport:{endpoint:v=>new URL(v).href}},db:{},localStorage:local,sessionStorage:storage(),URL,TextEncoder,TextDecoder,AbortController,DOMException,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto});load(c,'mcp_services.js');c.window.MCPServices.vault.clear({id:'s',url:'https://tools.test/mcp',auth:'bearer'});assert.ok(writes.some(({k})=>k.startsWith('uvu.mcp.invalidate.v1:')));assert.equal(local.map.size,0);
});
test('IS27 OAuth network failures expose a safe discovery stage code',async()=>{
 const c=vm.createContext({window:{},location:{href:'https://uvu.test/'},URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,DOMException,setTimeout,clearTimeout,fetch:async()=>{throw TypeError('secret-query-token');}});load(c,'mcp_oauth.js');await assert.rejects(c.window.MCPOAuth.discover({url:'https://tools.test/mcp'}),error=>error.code==='OAUTH_NETWORK' && error.stage==='resource-probe' && !error.message.includes('secret-query-token'));
});
const recovery=()=>({format:'uvu-bridge-recovery',version:1,channel:'st',createdAt:1,outbox:[],pendingScenes:{'a:scene':{characterKey:'a',archiveId:'one',partCount:2,parts:{1:'retained'},title:'scene',createdAt:1,sceneFormat:'',floorParts:{}}},receipts:{},cursorByCharacter:{a:7}});
test('IS23 recovery preview and merge preserve pending fragments, receipts and cursors without approving journals',async()=>{
 const f=bridge();const state=f.c.db.uvuStoryBridgeSettings;state.pendingScenes={'a:scene':{...recovery().pendingScenes['a:scene'],parts:{2:'later'}}};state.receipts={'a:done':{archiveId:'one',at:1}};state.cursorByCharacter={a:12};
 const preview=await f.api.importRecovery(JSON.stringify(recovery()));assert.equal(preview.pendingScenes,1);assert.equal(state.pendingScenes['a:scene'].parts[1],undefined);
 await f.api.importRecovery(JSON.stringify(recovery()),{confirmed:true});assert.equal(state.pendingScenes['a:scene'].parts[1],'retained');assert.equal(state.pendingScenes['a:scene'].parts[2],'later');assert.equal(state.cursorByCharacter.a,12);assert.ok(state.receipts['a:done']);assert.equal(f.chat.memoryJournals.length,0);
});
test('IS23 recovery rejects prototype fields, unknown targets and conflicts, and rolls back a failed save',async()=>{
 const f=bridge(),before=JSON.stringify(f.c.db.uvuStoryBridgeSettings),invalid=recovery();invalid.pendingScenes['a:scene'].archiveId='missing';await assert.rejects(f.api.importRecovery(JSON.stringify(invalid)),/存档|目标/);
 await assert.rejects(f.api.importRecovery('{"format":"uvu-bridge-recovery","__proto__":{}}'),/字段|格式|恢复/);
 f.c.db.uvuStoryBridgeSettings.pendingScenes={'a:scene':{...recovery().pendingScenes['a:scene'],parts:{1:'conflict'}}};await assert.rejects(f.api.importRecovery(JSON.stringify(recovery())),/冲突/);delete f.c.db.uvuStoryBridgeSettings.pendingScenes;
 f.c.saveData=async()=>{throw Error('quota');};await assert.rejects(f.api.importRecovery(JSON.stringify(recovery()),{confirmed:true}),/quota/);assert.equal(JSON.stringify(f.c.db.uvuStoryBridgeSettings),before);
});
test('IS23 pending recovery persistence pins the channel until commit',async()=>{
 const f=bridge();let finish;f.c.saveData=()=>new Promise(resolve=>finish=resolve);const pending=f.api.importRecovery(JSON.stringify(recovery()),{confirmed:true});await assert.rejects(f.api.changeChannel('tt'),/等待/);finish();await pending;assert.equal(f.c.db.uvuStoryBridgeSettings.channel,undefined);
});
