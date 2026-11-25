const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

// Reuse the existing integration harness without registering its tests a second time.
function harness(name, exports) {
    const c = vm.createContext({ require: id => id === 'node:test' ? { test() {} } : require(id),
        __dirname, console, Event, AbortController, Blob, File, Response, structuredClone, setImmediate,
        TextEncoder, TextDecoder, URL, DOMException, CompressionStream, DecompressionStream, ReadableStream,
        setTimeout, clearTimeout, btoa, atob });
    vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8') + '\n globalThis.fixtureExports = {' + exports + '};', c);
    return c.fixtureExports;
}

test('main reply reaches provider without waiting for a summary; stop only cancels the reply', async () => {
    const { fixture } = harness('chat_safety.test.cjs', 'fixture');
    const f = fixture(); let summaryCalls = 0, replyCalls = 0, sharedCancelled = false;
    f.c.runAutoMemory = () => { summaryCalls++; return new Promise(() => {}); };
    f.c.cancelAutoMemory = () => { sharedCancelled = true; };
    f.c.fetch = (_, init) => { replyCalls++; return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), { name: 'AbortError' })), { once: true })); };
    const pending = f.c.getAiReply('a', 'private');
    await new Promise(setImmediate);
    assert.equal(replyCalls, 1);
    assert.equal(summaryCalls, 0);
    assert.equal(f.c.stopAiReply(), true); await pending;
    assert.equal(f.c.getReplyBtn.disabled, false);
    assert.equal(sharedCancelled, false);
});

test('a retrieval deadline failure still permits the ordinary provider reply', async () => {
    const { fixture } = harness('chat_safety.test.cjs', 'fixture');
    const f = fixture(); let requests = 0;
    f.c.getMixedContent = text => [{ type: 'text', content: text }];
    f.c.escapeMessageRegex = text => text;
    f.c.showIncomingMessageNotifications = () => {};
    f.c.getVectorMemoryContext = async () => { const error = new Error('整轮检索超时'); error.name = 'TimeoutError'; throw error; };
    f.c.fetch = async () => { requests++; return { ok: true, json: async () => ({ choices: [{ message: { content: '[a的消息：reply]' } }] }) }; };
    await f.c.getAiReply('a', 'private', true);
    assert.equal(requests, 1); assert.equal(f.c.getReplyBtn.disabled, false);
    assert.ok(f.chats[0].history.some(message => message.role === 'assistant' && message.content.includes('reply')));
});

test('MCP automatic planner excludes withdrawn, rejected, hidden and status records', async () => {
    const { fixture, enabled, planner } = harness('mcp_services.test.cjs', 'fixture,enabled,planner');
    const f = fixture(); await enabled(f);
    const next = f.api.settings(); next.policies[0].auto = true; next.planner.source = 'primary'; next.planner.recentMessages = 20; await f.api.save(next); planner(f);
    f.chat.history = [{role:'user',content:'帮我联网查一下今天的天气'},
        {role:'user',content:'WITHDRAWN',isWithdrawn:true}, {role:'user',content:'REJECTED',relationshipDelivery:{blocked:true}},
        {role:'assistant',content:'HIDDEN',isHidden:true}, {role:'assistant',content:'STATUS_SECRET',isStatusUpdate:true}];
    const before = JSON.stringify(f.chat.history);
    await f.c.prepareMcpChatContext(f.chat, 'private');
    const sent = JSON.stringify(f.plannerRequests[0].body);
    assert.match(sent, /今天的天气/);
    assert.doesNotMatch(sent, /WITHDRAWN|REJECTED|HIDDEN|STATUS_SECRET/);
    assert.equal(JSON.stringify(f.chat.history), before);
});

test('bridge mode lookup is cancellable without starting a model reply', async () => {
    const { fixture } = harness('chat_safety.test.cjs', 'fixture'); const f = fixture();
    let release, signal, calls = 0;
    f.c.UvUStoryBridge = {isEnabled:()=>true,isConnected:()=>true,
        getMode:(_,options)=>{signal=options?.signal;return new Promise(resolve=>{release=resolve;});}};
    f.c.fetch = async()=>{calls++;throw Error('should not call');};
    let done=false; const pending=f.c.getAiReply('a','private').then(()=>{done=true;});
    await new Promise(setImmediate); const accepted=f.c.stopAiReply(); await new Promise(setImmediate);
    const immediate=done; release({mode:'online'});await pending;
    assert.equal(accepted,true);assert.equal(immediate,true);assert.equal(signal?.aborted,true);assert.equal(calls,0);
});

test('import validation rejects malformed review arrays and COT nested items', () => {
    const { fixture } = harness('backup_formats.test.cjs', 'fixture'); const { c } = fixture();
    for (const items of [{bad:true}, 'wrong', [null], [{text:42}]]) {
        assert.throws(() => c.storageValidateModules({characters:[{id:'a',memoryJournals:[{id:'j',range:{start:0,end:0},bridgeReview:{items}}]}]}), /bridgeReview/);
    }
    assert.throws(() => c.storageValidateModules({cotPresets:[{id:'p',items:{bad:true}}]}), /cotPresets/);
    assert.doesNotThrow(() => c.storageValidateModules({cotPresets:[{id:'old'}],characters:[{id:'a',memoryJournals:[{id:'legacy',range:{start:1,end:2},content:'保留原文'}]}]}));
});

test('MCP manual result leases survive a failed reply and consume only the successful attempt snapshot', async () => {
    const {fixture,enabled}=harness('mcp_services.test.cjs','fixture,enabled');const f=fixture();await enabled(f);
    const scope=f.api.scope(f.chat,'private');
    const first=await f.api.call('s','weather',{city:'上海'},{scope});f.api.queue(first,scope);
    const failedAttempt=f.api.lease(scope);assert.match(failedAttempt.text,/晴天/);assert.equal(f.api.pending(scope),1);
    const successfulAttempt=f.api.lease(scope);
    const second=await f.api.call('s','weather',{city:'北京'},{scope});f.api.queue(second,scope);
    successfulAttempt.commit();assert.equal(f.api.pending(scope),1);
    successfulAttempt.commit();assert.equal(f.api.pending(scope),1);
    f.chat.activeArchiveId='other';failedAttempt.commit();assert.equal(f.api.pending(f.api.scope(f.chat)),0);
});

test('MCP leased context is committed only after a delivered reply, not a failed or cancelled request',async()=>{
 const {fixture}=harness('chat_safety.test.cjs','fixture');
 for(const mode of ['success','failure','cancel']) {
  const f=fixture();let commits=0;f.c.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'reply'}}]})});
  f.c.prepareMcpChatContext=async(_chat,_type,_signal,options)=>{options.onLease({text:'资料',commit(){commits++;}});return '资料';};
  if(mode==='failure')f.c.fetch=async()=>{throw Error('network');};
  if(mode==='cancel')f.c.fetch=async()=>{f.c.stopAiReply();throw Object.assign(Error('cancelled'),{name:'AbortError'});};
  f.c.handleAiReplyContent=async()=>true;
  await f.c.getAiReply('a','private');assert.equal(commits,mode==='success'?1:0,mode);
 }
});

test('MCP health diagnostics expose readiness and grants without credentials or tool data',async()=>{
 const {fixture,enabled}=harness('mcp_services.test.cjs','fixture,enabled');const f=fixture();await enabled(f);await f.api.discover('s');
 const info=f.api.health('s');assert.equal(info.enabled,true);assert.equal(info.tools,1);assert.equal(info.roles,1);
 assert.equal(info.credentialsPresent,true);assert.equal(typeof info.checkedAt,'number');
 assert.doesNotMatch(JSON.stringify(info),/private-token|晴天/);
});
