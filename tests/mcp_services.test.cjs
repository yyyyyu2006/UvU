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
async function enabled(f) {
    await f.api.save(config()); f.api.vault.set(f.api.settings().services[0],'private-token',false);
    const list=await f.api.discover('s'); const next=f.api.settings(); next.services[0].tools.weather={enabled:true,readOnly:true,signature:list[0].signature,cacheSeconds:30};
    next.policies=[{chatId:'a',type:'private',enabled:true,auto:false,grants:[{serviceId:'s',toolName:'weather'}]}]; await f.api.save(next); return list;
}
test('MCP defaults off, normalizes imports to disabled and excludes credentials and grants', async () => {
    const f=fixture(); assert.equal(f.api.settings().enabled,false); const raw=config(); raw.token='secret';raw.services[0].token='secret';raw.planner={key:'secret',source:'independent',url:'https://ai.test',model:'m'};
    await f.api.save(raw); const exp=f.api.exportConfig(); assert.ok(!JSON.stringify(exp).includes('secret')); assert.equal(exp.enabled,false);
    const imported=f.api.normalize({...exp,enabled:true,policies:[{chatId:'a',enabled:true}]},true); assert.equal(imported.enabled,false);assert.equal(imported.services[0].enabled,false);assert.equal(imported.policies.length,0);
    assert.throws(()=>f.api.normalize({...raw,services:[{...raw.services[0],url:'https://tools.test?token=x'}]}));
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
