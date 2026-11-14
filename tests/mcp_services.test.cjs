const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture() {
    const store = () => { const map = new Map(); return { map, getItem: k => map.get(k) || null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) }; };
    const chat = { id: 'a', activeArchiveId: 'one', history: [{role:'user', content:'天气怎么样'}] }, local = store(), session = store(), calls = [];
    const c = vm.createContext({ window: {}, db: { characters: [chat], groups: [] }, localStorage: local, sessionStorage: session,
        TextEncoder, TextDecoder, URL, DOMException, AbortController, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
        saveData: async () => {}, Date, structuredClone, btoa, console });
    c.window.MCPTransport = { endpoint: v => { const u=new URL(v); if(u.protocol!=='https:'||u.search||u.username)throw Error('地址');return u.href; },
        create: (cfg, token) => ({ version: '2026-07-28', listTools: async () => [{ name: 'weather', description: 'weather', inputSchema: { type: 'object', required: ['city'], additionalProperties: false, properties: { city: {type:'string'} } } }],
            call: async (name,args,signal) => { calls.push({name,args,signal,token}); return { content: [{type:'text',text:'晴天'}] }; } }) };
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/vendor/mcp_schema.js'),'utf8'),c);
    const file=path.join(__dirname,'../js/modules/mcp_services.js'); assert.ok(fs.existsSync(file),'MCP service manager required'); vm.runInContext(fs.readFileSync(file,'utf8'),c);
    return { c, api:c.window.MCPServices, chat, local, session, calls };
}
const config = () => ({ enabled:true, services:[{ id:'s', name:'天气', url:'https://tools.test/mcp', enabled:true, auth:'bearer', tools:{} }], policies:[] });
test('MCP last discovery survives permission saves and reload without retaining executable tools', async()=>{
    const f=fixture();await f.api.save(config());f.api.vault.set(f.api.service('s'),'token');await f.api.discover('s');
    const at=f.api.health('s').checkedAt;await f.api.save(f.api.settings());
    assert.equal(f.api.health('s').tools,1);assert.equal(f.api.health('s').checkedAt,at);assert.equal(f.api.health('s').connectionReady,false);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/mcp_services.js'),'utf8'),f.c);
    assert.equal(f.c.window.MCPServices.health('s').tools,1);assert.equal(f.c.window.MCPServices.cachedTools('s').length,0);
    const next=f.api.settings();next.services[0].url='https://other.test/mcp';await f.api.save(next);assert.equal(f.api.health('s').checkedAt,null);
});
test('MCP discovery history distinguishes empty, unknown, revoked and unavailable local storage',async()=>{
 const f=fixture();await f.api.save(config());assert.equal(f.api.health('s').tools,null);f.api.vault.set(f.api.service('s'),'token');
 f.c.window.MCPTransport.create=()=>({version:'2025-03-26',listTools:async()=>[]});await f.api.discover('s');await f.api.save(f.api.settings());assert.equal(f.api.health('s').tools,0);assert.ok(f.api.health('s').checkedAt);
 f.api.vault.clear(f.api.service('s'));assert.equal(f.api.health('s').tools,null);f.api.vault.set(f.api.service('s'),'new');
 f.local.setItem=()=>{throw Error('quota');};assert.deepEqual(Array.from(await f.api.discover('s')),[]);assert.equal(f.api.health('s').historySaved,false);assert.equal(f.api.health('s').connectionReady,true);
});
test('MCP restored configuration cannot reuse a previous endpoint tool list',async()=>{
 const f=fixture();await f.api.save(config());f.api.vault.set(f.api.service('s'),'token');await f.api.discover('s');assert.equal(f.api.cachedTools('s').length,1);
 f.c.db.mcpSettings.services[0].url='https://restored.test/mcp';assert.equal(f.api.cachedTools('s').length,0);assert.equal(f.api.health('s').checkedAt,null);assert.equal(f.api.health('s').tools,null);
});
async function enabled(f) {
    await f.api.save(config()); f.api.vault.set(f.api.settings().services[0],'private-token',false);
    const list=await f.api.discover('s'); const next=f.api.settings(); next.services[0].tools.weather={enabled:true,readOnly:true,signature:list[0].signature,cacheSeconds:30};
    next.policies=[{chatId:'a',type:'private',enabled:true,auto:false,grants:[{serviceId:'s',toolName:'weather'}]}]; await f.api.save(next); return list;
}

test('MCP rejects expensive input checks before a tool request and rejects expensive output before injection', async () => {
    for (const output of [false, true]) {
        const f = fixture();
        const schema = { type: 'object', properties: { rows: { type: 'array', allOf: Array.from({ length: 400 }, () => ({ uniqueItems: true })) } } };
        const rows = Array.from({ length: 1248 }, (_, n) => ({ n }));
        const original = f.c.window.MCPTransport.create;
        f.c.window.MCPTransport.create = (...args) => ({ ...original(...args),
            listTools: async () => [{ name: 'weather', inputSchema: output ? { type: 'object' } : schema, ...(output ? { outputSchema: schema } : {}) }],
            call: async () => { f.calls.push({ name: 'weather' }); return { structuredContent: { rows } }; }
        });
        await enabled(f);
        const scope = f.api.scope(f.chat);
        await assert.rejects(f.api.call('s', 'weather', output ? {} : { rows }, { scope }), output ? /结果结构/ : /参数/);
        assert.equal(f.calls.length, output ? 1 : 0);
        assert.equal(f.api.pending(scope), 0);
    }
});
test('external-memory review accepts only genuine current granted results and does not stage context',async()=>{
    const f=fixture();await enabled(f);const scope=f.api.scope(f.chat),result=await f.api.call('s','weather',{city:'上海'},{scope});
    assert.equal(f.api.reviewable(result,scope),true);assert.equal(f.api.pending(scope),0);
    assert.equal(f.api.reviewable({...result},scope),false);f.chat.activeArchiveId='other';assert.equal(f.api.reviewable(result,scope),false);
    f.chat.activeArchiveId='one';const next=f.api.settings();next.policies[0].enabled=false;await f.api.save(next);assert.equal(f.api.reviewable(result,scope),false);
});

test('cancelled write records an unknown remote outcome and is never retried',async()=>{
    const f=fixture();await enabled(f);const next=f.api.settings();next.services[0].tools.weather.readOnly=false;await f.api.save(next);
    const original=f.c.window.MCPTransport.create;let invoked=0,started;
    const entered=new Promise(r=>started=r);
    f.c.window.MCPTransport.create=(...args)=>({...original(...args),call:async(_name,_args,signal)=>{invoked++;started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')),{once:true}));}});
    f.api.clearRuntime();const controller=new AbortController();const pending=f.api.call('s','weather',{city:'x'},{confirmed:true,signal:controller.signal});
    const rejected=assert.rejects(pending,e=>e.executionState==='unknown'&&/核实|确认/.test(e.message));await entered;controller.abort();await rejected;
    assert.equal(invoked,1);assert.equal(f.api.logs()[0].executionState,'unknown');assert.match(f.api.logs()[0].status,/未确认|不确定/);
});
test('preflight rejection never reports a remote write as executed',async()=>{
    const f=fixture();await enabled(f);const next=f.api.settings();next.services[0].tools.weather.readOnly=false;await f.api.save(next);
    await assert.rejects(f.api.call('s','weather',{city:'x'}),/确认/);assert.equal(f.calls.length,0);assert.ok(!f.api.logs().some(l=>l.executionState==='unknown'));
});
test('read-only cancellation stays distinct from an unknown write outcome',async()=>{
    const f=fixture();await enabled(f);const original=f.c.window.MCPTransport.create;let started;
    const entered=new Promise(r=>started=r);f.c.window.MCPTransport.create=(...args)=>({...original(...args),call:async(_n,_a,signal)=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')),{once:true}));}});
    f.api.clearRuntime();const controller=new AbortController(),pending=f.api.call('s','weather',{city:'x'},{signal:controller.signal});const rejected=assert.rejects(pending,/取消/);await entered;controller.abort();await rejected;
    assert.equal(f.api.logs()[0].executionState,'read-only');assert.ok(!f.api.logs()[0].status.includes('远端已取消'));
});
test('MCP defaults off, normalizes imports to disabled and excludes credentials and grants', async () => {
    const f=fixture(); assert.equal(f.api.settings().enabled,false); const raw=config(); raw.token='secret';raw.services[0].token='secret';raw.planner={key:'secret',source:'independent',url:'https://ai.test',model:'m'};
    await f.api.save(raw); const exp=f.api.exportConfig(); assert.ok(!JSON.stringify(exp).includes('secret')); assert.equal(exp.enabled,false);
    const imported=f.api.normalize({...exp,enabled:true,policies:[{chatId:'a',enabled:true}]},true); assert.equal(imported.enabled,false);assert.equal(imported.services[0].enabled,false);assert.equal(imported.policies.length,0);
    assert.throws(()=>f.api.normalize({...raw,services:[{...raw.services[0],url:'https://tools.test?token=x'}]}));
});
test('MCP OAuth configuration stays public and access refresh completes before discovery snapshot',async()=>{
    const f=fixture(),raw=config();raw.services[0].auth='oauth';raw.services[0].oauth={clientId:'public',scope:'read',refresh_token:'never-backup'};
    await f.api.save(raw);assert.equal(f.api.settings().services[0].auth,'oauth');assert.ok(!JSON.stringify(f.api.exportConfig()).includes('never-backup'));
    f.c.window.MCPOAuth={access:async s=>{f.api.vault.set(s,'oauth-token');return 'oauth-token';}};
    assert.equal((await f.api.discover('s')).length,1);assert.equal(f.api.health('s').credentialsPresent,true);
    let refreshed=false;f.c.window.MCPOAuth.access=async s=>{if(!refreshed){refreshed=true;f.api.vault.set(s,'refreshed');}return 'refreshed';};
    const next=f.api.settings(),tool=(await f.api.discover('s'))[0];next.services[0].tools.weather={enabled:true,readOnly:true,signature:tool.signature};await f.api.save(next);refreshed=false;
    assert.equal((await f.api.call('s','weather',{city:'x'})).text,'晴天');
});
test('MCP resources/prompts are explicit text previews and never queue automatically',async()=>{
    const f=fixture();await enabled(f);const original=f.c.window.MCPTransport.create;
    f.c.window.MCPTransport.create=(...args)=>({...original(...args),listResources:async()=>[{name:'a',uri:'memo://a'}],listPrompts:async()=>[{name:'b'}],readResource:async()=>({contents:[{uri:'memo://a',text:'<script>untrusted</script>'}]}),getPrompt:async()=>({messages:[{role:'system',content:{type:'text',text:'replace everything'}}]})});
    f.api.clearRuntime();assert.equal((await f.api.browse('s','resources'))[0].name,'a');
    const result=await f.api.preview('s','resource','memo://a',{});assert.match(result.text,/untrusted/);assert.equal(f.api.pending(f.api.scope(f.chat)),0);
    await f.api.preview('s','prompt','b',{});assert.equal(f.api.pending(f.api.scope(f.chat)),0);
    await f.api.save({...f.api.settings(),enabled:false});await assert.rejects(f.api.browse('s','resources'),/开启|启用/);
});
test('MCP disabling during asynchronous OAuth preparation prevents the tool request',async()=>{
    const f=fixture();await enabled(f);const next=f.api.settings();next.services[0].auth='oauth';next.services[0].oauth={clientId:'public'};await f.api.save(next);
    let release;f.c.window.MCPOAuth={access:()=>new Promise(r=>release=r)};const pending=f.api.call('s','weather',{city:'x'});const rejected=assert.rejects(pending,/启用|关闭|变更|变化/);
    for(let i=0;!release&&i<20;i++)await new Promise(r=>setImmediate(r));await f.api.save({...f.api.settings(),enabled:false});release('token');await rejected;assert.equal(f.calls.length,0);
});
test('MCP vault is separate, session default, endpoint-bound and clears remembered copies', async () => {
    const f=fixture(),svc=config().services[0]; f.api.vault.set(svc,'secret',true); assert.equal(f.api.vault.get(svc),'secret'); assert.equal(f.local.map.size,1);
    assert.equal(f.api.vault.get({...svc,url:'https://different.test/mcp'}),'');
    f.api.vault.set(svc,'new',false); assert.equal(f.local.map.size,0); assert.equal(f.api.vault.get(svc),'new');
    f.api.vault.clear(svc);assert.equal(f.session.map.size,0);
});
test('MCP setting persistence failure rolls back previous settings', async () => {
    const f=fixture(); await f.api.save(config()); const old=JSON.stringify(f.c.db.mcpSettings); f.c.saveData=async()=>{throw Error('quota');};
    await assert.rejects(f.api.save({...config(),enabled:false}),/quota/);assert.equal(JSON.stringify(f.c.db.mcpSettings),old);
});
test('MCP tools require enablement, validate arguments and require concrete confirmation for writes', async () => {
    const f=fixture(); await f.api.save(config()); f.api.vault.set(f.api.settings().services[0],'private-token'); await f.api.discover('s');
    await assert.rejects(f.api.call('s','weather',{city:'上海'}),/启用|授权/);
    await enabled(f); await assert.rejects(f.api.call('s','weather',{}),/参数/); assert.equal(f.calls.length,0);
    const next=f.api.settings();next.services[0].tools.weather.readOnly=false; await f.api.save(next);
    await assert.rejects(f.api.call('s','weather',{city:'上海'}),/确认/);
    const scope=f.api.scope(f.chat,'private');const result=await f.api.call('s','weather',{city:'上海'},{scope,confirmed:true});assert.equal(result.text,'晴天');assert.equal(f.calls.length,1);
    assert.ok(!JSON.stringify(f.api.logs()).includes('private-token'));assert.ok(!JSON.stringify(f.api.logs()).includes('上海'));
});
test('MCP supplied results are one-request, exact role/archive and revoked on configuration changes', async () => {
    const f=fixture(); await enabled(f); let scope=f.api.scope(f.chat,'private');const result=await f.api.call('s','weather',{city:'上海'},{scope});f.api.queue(result,scope);
    assert.equal(f.api.pending(scope),1);assert.match(f.api.take(scope),/晴天/);assert.equal(f.api.take(scope),'');
    f.api.queue(result,scope);f.chat.activeArchiveId='two';assert.equal(f.api.take(f.api.scope(f.chat,'private')),'');
    f.chat.activeArchiveId='one';scope=f.api.scope(f.chat,'private');const again=await f.api.call('s','weather',{city:'上海'},{scope});f.api.queue(again,scope);
    await f.api.save({...f.api.settings(),enabled:false});assert.equal(f.api.take(scope),'');
});
test('MCP late results are rejected after archive changes, history replacement or grant revocation', async () => {
    for (const mutation of [f=>f.chat.activeArchiveId='two', f=>f.chat.history=[], f=>f.c.db.mcpSettings.enabled=false]) {
        const f=fixture();await enabled(f);const original=f.c.window.MCPTransport.create;let finish;
        f.c.window.MCPTransport.create=(...args)=>({...original(...args),call:()=>new Promise(r=>finish=r)});
        f.api.clearRuntime();await f.api.discover('s');const p=f.api.call('s','weather',{city:'上海'},{scope:f.api.scope(f.chat,'private')});
        for(let i=0;!finish&&i<20;i++)await new Promise(r=>setImmediate(r));assert.ok(finish);mutation(f);finish({content:[{type:'text',text:'late'}]});
        await assert.rejects(p,/失效|切换|变更/);
    }
});
test('MCP grant list is user supplied and unchanged tool signatures are required for automatic reads', async () => {
    const f=fixture();await enabled(f);const scope=f.api.scope(f.chat,'private');assert.equal((await f.api.authorized(scope)).length,1);
    const next=f.api.settings();next.services[0].tools.weather.signature='changed';await f.api.save(next);assert.equal((await f.api.authorized(scope)).length,0);
});
test('MCP coalesces identical safe reads and one cancelled waiter does not cancel another', {timeout:1000}, async () => {
    const f=fixture();await enabled(f);let finish, count=0, sharedSignal;
    const original=f.c.window.MCPTransport.create;
    f.c.window.MCPTransport.create=(...args)=>({...original(...args),call:(_n,_a,signal)=>{count++;sharedSignal=signal;return new Promise(resolve=>finish=resolve);}});
    await f.api.discover('s');const scope=f.api.scope(f.chat),ac=new AbortController();
    const a=f.api.call('s','weather',{city:'x'},{scope,signal:ac.signal});const rejected=assert.rejects(a,/取消|abort/i);
    const b=f.api.call('s','weather',{city:'x'},{scope});
    for(let i=0;!finish&&i<20;i++)await new Promise(r=>setImmediate(r));ac.abort();await rejected;
    assert.equal(sharedSignal.aborted,false);finish({content:[{type:'text',text:'sun'}]});assert.equal((await b).text,'sun');assert.equal(count,1);
});
test('MCP cache expires by TTL and all cancelled read waiters abort the shared request',async()=>{
    const f=fixture();await enabled(f);let now=Date.now();f.c.Date=class extends Date {static now(){return now;}};const scope=f.api.scope(f.chat);
    await f.api.call('s','weather',{city:'x'},{scope});now+=31000;await f.api.call('s','weather',{city:'x'},{scope});assert.equal(f.calls.length,2);
    const original=f.c.window.MCPTransport.create;let shared;
    f.c.window.MCPTransport.create=(...args)=>({...original(...args),call:(_n,_a,signal)=>{shared=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));}});
    f.api.clearRuntime();await f.api.discover('s');const ac=new AbortController(),bc=new AbortController();
    const a=f.api.call('s','weather',{city:'z'},{scope,signal:ac.signal}),b=f.api.call('s','weather',{city:'z'},{scope,signal:bc.signal});
    const checked=[assert.rejects(a,/取消|abort/i),assert.rejects(b,/取消|abort/i)];for(let i=0;!shared&&i<20;i++)await new Promise(r=>setImmediate(r));
    ac.abort();bc.abort();await Promise.all(checked);assert.equal(shared.aborted,true);
});
function planner(f, result = {calls:[]}) {
    f.c.buildChatApiRequest = (cfg,messages) => ({endpoint:cfg.url,headers:{Authorization:'Bearer '+cfg.key},requestBody:{messages}});
    f.c.db.apiSettings = {url:'https://ai.test',key:'api-secret',model:'planner',provider:'newapi'};
    f.c.fetch = async (url,init) => { f.plannerRequests.push({url,init,body:JSON.parse(init.body)}); return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}),{headers:{'content-type':'application/json'}}); };
    f.plannerRequests=[]; f.c.window.MCPTransport.readBody=async r=>r.json();f.c.window.MCPTransport.wait=(p)=>p;
    const file=path.join(__dirname,'../js/modules/mcp_chat.js');assert.ok(fs.existsSync(file),'optional MCP planner required');vm.runInContext(fs.readFileSync(file,'utf8'),f.c);
}
test('MCP chat path is silent by default, manual-only needs no planner, automatic mode is explicitly per-role', async () => {
    const f=fixture();planner(f);assert.equal(await f.c.prepareMcpChatContext(f.chat,'private'),'');assert.equal(f.plannerRequests.length,0);
    await enabled(f);const s=f.api.scope(f.chat,'private');const result=await f.api.call('s','weather',{city:'上海'},{scope:s});f.api.queue(result,s);
    assert.match(await f.c.prepareMcpChatContext(f.chat,'private'),/晴天/);assert.equal(f.plannerRequests.length,0);
    assert.equal(await f.c.prepareMcpChatContext(f.chat,'private'),'');
});
test('OAuth same-grant token rotation preserves the current authorized automatic read',async()=>{
    const f=fixture();await enabled(f);const next=f.api.settings();next.services[0].auth='oauth';next.services[0].oauth={clientId:'public'};next.policies[0].auto=true;await f.api.save(next);f.api.vault.set(f.api.service('s'),'old');
    let rotated=false;f.c.window.MCPOAuth={access:async svc=>{if(!rotated){rotated=true;f.api.vault.renew(svc,'rotated');}return 'rotated';}};
    planner(f,{calls:[{serviceId:'s',toolName:'weather',arguments:{city:'上海'}}]});assert.match(await f.c.prepareMcpChatContext(f.chat,'private'),/晴天/);assert.equal(f.calls.length,1);
});

test('discovery started before OAuth rotation cannot overwrite the renewed connection', async () => {
    const f=fixture();await enabled(f);const next=f.api.settings();next.services[0].auth='oauth';next.services[0].oauth={clientId:'public'};await f.api.save(next);
    const svc=f.api.service('s');f.api.vault.set(svc,'old');f.c.window.MCPOAuth={access:async s=>f.api.vault.get(s)};
    const original=f.c.window.MCPTransport.create;let release,used;
    f.c.window.MCPTransport.create=(s,token)=>{
        const client=original(s,token);
        return {...client,listTools:()=>token==='old'?new Promise(resolve=>release=()=>client.listTools().then(resolve)):client.listTools(),
            call:async()=>{used=token;return {content:[{type:'text',text:'fresh'}]};}};
    };
    const stale=f.api.discover('s');
    const staleChecked=stale.then(()=>false,()=>true);
    for(let i=0;!release&&i<20;i++)await new Promise(r=>setImmediate(r));assert.ok(release);
    f.api.vault.renew(svc,'new');await f.api.discover('s');release();
    assert.equal(await staleChecked,true,'old-token discovery must be discarded');
    await f.api.call('s','weather',{city:'上海'});assert.equal(used,'new');
});
test('MCP planner is independent, bounded, grant-checked and records separate provider usage', async () => {
    const f=fixture();await enabled(f);const next=f.api.settings();next.policies[0].auto=true;await f.api.save(next);
    f.chat.persona='SECRET PERSONA';f.chat.history.unshift({role:'system',content:'SECRET SYSTEM'}, {role:'assistant',isThinking:true,content:'PRIVATE THOUGHTS'});
    planner(f,{calls:[{serviceId:'s',toolName:'weather',arguments:{city:'上海'}}]});assert.match(await f.c.prepareMcpChatContext(f.chat,'private'),/晴天/);
    const sent=JSON.stringify(f.plannerRequests[0].body);assert.ok(!sent.includes('SECRET'));assert.ok(!sent.includes('PRIVATE THOUGHTS'));
    assert.equal(f.calls.length,1);assert.equal(f.api.logs().find(x=>x.kind==='planner').usage.totalTokens,120);assert.equal(f.chat.lastTokenUsage,undefined);
});
test('MCP planner cannot invoke unauthorized/write tools or apply after user/archive/config changes', async () => {
    const f=fixture();await enabled(f);const next=f.api.settings();next.policies[0].auto=true;await f.api.save(next);
    planner(f,{calls:[{serviceId:'s',toolName:'delete',arguments:{}}]});assert.equal(await f.c.prepareMcpChatContext(f.chat,'private'),'');assert.equal(f.calls.length,0);
    planner(f,{calls:[{serviceId:'s',toolName:'weather',arguments:{city:'上海'}}]});const oldFetch=f.c.fetch;f.c.fetch=async(...args)=>{const r=await oldFetch(...args);f.chat.activeArchiveId='two';return r;};
    assert.equal(await f.c.prepareMcpChatContext(f.chat,'private'),'');assert.equal(f.calls.length,0);
});
test('MCP planner failure falls back; cancellation never continues tool calls', async () => {
    const f=fixture();await enabled(f);const next=f.api.settings();next.policies[0].auto=true;await f.api.save(next);planner(f);
    f.c.fetch=async()=>{throw Error('network');};assert.equal(await f.c.prepareMcpChatContext(f.chat,'private'),'');assert.equal(f.calls.length,0);
    const ac=new AbortController();ac.abort();await assert.rejects(f.c.prepareMcpChatContext(f.chat,'private',ac.signal),/取消|abort/i);
});


test('MCP header discovery ignores instance data while still validating real header schemas', async () => {
    const f=fixture();await enabled(f);
    const literal={'x-mcp-header':'just data'};
    f.c.window.MCPTransport.create=()=>({listTools:async()=>[
        {name:'literal',inputSchema:{type:'object',properties:{config:{const:literal,default:literal,examples:[literal],enum:[literal]}}}},
        {name:'bad',inputSchema:{type:'object',properties:{config:{type:'string','x-mcp-header':'Invalid Header'}}}},
        {name:'real',inputSchema:{type:'object',properties:{config:{type:'string','x-mcp-header':'X-Trace'}}}}
    ]});f.api.clearRuntime();
    const tools=await f.api.discover('s');assert.equal(tools[0].unavailable,'');assert.ok(tools[1].unavailable);assert.equal(tools[2].unavailable,'');
    assert.equal(tools[2].headers[0].name,'X-Trace');
});

test('MCP retains healthy authorized tools when another service discovery fails', async () => {
    const f=fixture(); await enabled(f); const next=f.api.settings();
    next.services.unshift({...next.services[0],id:'broken',auth:'none'});
    next.policies[0].grants.push({serviceId:'broken',toolName:'weather'}); await f.api.save(next);
    const original=f.c.window.MCPTransport.create;
    f.c.window.MCPTransport.create=(cfg,...rest)=>cfg.id==='broken'?{listTools:async()=>{throw Error('offline');}}:original(cfg,...rest);
    const tools=await f.api.authorized(f.api.scope(f.chat));
    assert.equal(tools.length,1); assert.equal(tools[0].serviceId,'s');
    assert.ok(f.api.logs().some(x=>x.serviceId==='broken'&&x.stage==='discovery'));
});

test('MCP bounds external context without breaking JSON or splitting escaped text', () => {
    const f=fixture(); const text=f.api.context([{serviceId:'s',toolName:'weather',at:0,text:'"\\\n天气'.repeat(2000)}],1000);
    const json=JSON.parse(text.slice(text.indexOf('\n[')+1));
    assert.equal(json[0].service,'s'); assert.equal(json[0].truncated,true);
    assert.ok(text.slice(text.indexOf('\n[')+1).length<=1000);
});

test('MCP outputSchema is validated and changes invalidate prior grants', async () => {
    const f=fixture(); let schema={type:'object',required:['temperature'],properties:{temperature:{type:'number'}}};
    f.c.window.MCPTransport.create=()=>({listTools:async()=>[{name:'weather',inputSchema:{type:'object'},outputSchema:schema}],call:async()=>({structuredContent:{temperature:'invalid'}})});
    await enabled(f);
    await assert.rejects(f.api.call('s','weather',{}),/输出|结果.*结构/);
    const first=(await f.api.discover('s'))[0].signature;
    schema={type:'object',required:['forecast'],properties:{forecast:{type:'string'}}};
    const updated=await f.api.discover('s',undefined,true); assert.notEqual(first,updated[0].signature);
    await assert.rejects(f.api.call('s','weather',{}),/定义已变化|授权/);
});

test('MCP canonical argument cache reuses key order but isolates chat and archive', async () => {
    const f=fixture(); await enabled(f); const s=f.api.scope(f.chat);
    await f.api.call('s','weather',{city:'上海',unit:'c'},{scope:s}).catch(()=>{});
    // The existing weather schema forbids extra fields; enable an object schema for this fixture.
    const original=f.c.window.MCPTransport.create;
    f.c.window.MCPTransport.create=(...args)=>({...original(...args),listTools:async()=>[{name:'weather',inputSchema:{type:'object'}}]});
    f.api.clearRuntime(); const tools=await f.api.discover('s');const next=f.api.settings();next.services[0].tools.weather.signature=tools[0].signature; await f.api.save(next);
    await f.api.call('s','weather',{city:'上海',unit:'c'},{scope:s});
    await f.api.call('s','weather',{unit:'c',city:'上海'},{scope:s});assert.equal(f.calls.length,1);
    f.chat.activeArchiveId='two';await f.api.call('s','weather',{unit:'c',city:'上海'},{scope:f.api.scope(f.chat)});assert.equal(f.calls.length,2);
});

test('MCP automatic tool failure preserves successful result from same plan', async () => {
    const f=fixture(); await enabled(f);const next=f.api.settings();next.policies[0].auto=true;next.planner={maxCalls:2};await f.api.save(next);
    planner(f,{calls:[{serviceId:'s',toolName:'weather',arguments:{city:'坏城市'}},{serviceId:'s',toolName:'weather',arguments:{city:'上海'}}]});
    const original=f.c.window.MCPTransport.create;
    f.c.window.MCPTransport.create=(...a)=>({...original(...a),call:async(name,args)=>{if(args.city==='坏城市')throw Error('offline');return {content:[{type:'text',text:'上海晴天'}]};}});
    f.api.clearRuntime(); assert.match(await f.c.prepareMcpChatContext(f.chat),/上海晴天/);
});
