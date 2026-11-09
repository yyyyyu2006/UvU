const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const file = name => path.join(__dirname, '../js/modules/', name);
function fixture(handler) {
    const requests = [];
    const c = vm.createContext({ window: {}, URL, TextEncoder, TextDecoder, AbortController, DOMException, setTimeout, clearTimeout, btoa,
        fetch: async (url, init) => { const body = JSON.parse(init.body); requests.push({ url, init, body }); return handler(body, init, requests.length); } });
    assert.ok(fs.existsSync(file('mcp_transport.js')), 'MCP transport must be implemented');
    vm.runInContext(fs.readFileSync(file('mcp_transport.js'), 'utf8'), c);
    return { api: c.window.MCPTransport, requests };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const reply = (body, result) => json({ jsonrpc: '2.0', id: body.id, result });
test('MCP modern discovery uses request metadata without legacy initialize and follows pagination', async () => {
    const { api, requests } = fixture(body => reply(body, { resultType: 'complete', tools: [{ name: body.params.cursor ? 'b' : 'a', inputSchema: { type: 'object' } }], ...(!body.params.cursor ? { nextCursor: 'next' } : {}) }));
    const client = api.create({ url: 'https://tools.test/mcp', protocol: 'auto' }, 'secret');
    assert.equal((await client.listTools()).length, 2);
    assert.equal(requests[0].body.method, 'tools/list');
    assert.equal(requests[0].body.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer secret');
    assert.equal(requests[0].init.redirect, 'error');
    assert.equal(requests[0].init.credentials, 'omit');
});
test('MCP negotiates legacy only on discovery and keeps session/version; tool calls never retry', async () => {
    const { api, requests } = fixture(body => {
        if (body.method === 'tools/list' && body.params?._meta) return json({ error: 'legacy needs initialize' }, 400);
        if (body.method === 'initialize') return json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }, 200, { 'Mcp-Session-Id': 'session' });
        if (!body.id) return new Response(null, { status: 202 });
        if (body.method === 'tools/call') return json({}, 404);
        return reply(body, { tools: [{ name: 'test', inputSchema: { type: 'object' } }] });
    });
    const client = api.create({ url: 'https://tools.test/mcp' }); await client.listTools();
    assert.equal(client.version, '2025-06-18');
    await assert.rejects(client.call('test', {}), /404/);
    assert.equal(requests.filter(r => r.body.method === 'tools/call').length, 1);
    assert.equal(requests.at(-1).init.headers['Mcp-Session-Id'], 'session');
});
test('recognized modern errors do not blindly fall back; supported version can negotiate', async () => {
    const { api, requests } = fixture(body => json({ jsonrpc: '2.0', id: body.id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2025-11-25'] } } }, 400));
    // The server must actually support initialize after advertising a legacy version; a repeated error is surfaced.
    await assert.rejects(api.create({ url: 'https://tools.test/mcp' }).listTools(), /协议|版本/);
    assert.equal(requests.filter(r => r.body.method === 'initialize').length, 1);
    const other = fixture(body => json({ jsonrpc: '2.0', id: body.id, error: { code: -32001, message: 'capability missing' } }, 400));
    await assert.rejects(other.api.create({ url: 'https://tools.test/mcp' }).listTools());
    assert.equal(other.requests.length, 1);
});
test('MCP SSE handles split UTF-8, CRLF, notifications and closes on matching response', async () => {
    let cancelled = false;
    const { api } = fixture(body => {
        const text = ': ping\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: '天气', inputSchema: { type: 'object' } }] } }) + '\r\n\r\n';
        const bytes = new TextEncoder().encode(text);
        return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    assert.equal((await api.create({ url: 'https://tools.test/mcp' }).listTools())[0].name, '天气');
    assert.equal(cancelled, true);
});
test('MCP rejects malformed IDs, huge results, cursor loops and unsupported interactive results', async () => {
    let f = fixture(body => json({ jsonrpc: '2.0', id: body.id + 1, result: {} }));
    await assert.rejects(f.api.create({ url: 'https://tools.test/mcp' }).listTools(), /ID|响应/);
    f = fixture(body => reply(body, { text: 'x'.repeat(1024 * 1024 + 1) }));
    await assert.rejects(f.api.create({ url: 'https://tools.test/mcp' }).listTools(), /过大/);
    f = fixture(body => reply(body, { tools: [], nextCursor: 'same' }));
    await assert.rejects(f.api.create({ url: 'https://tools.test/mcp' }).listTools(), /分页/);
    f = fixture(body => reply(body, body.method === 'tools/list' ? { tools: [] } : { resultType: 'input_required', inputRequests: {} }));
    const client = f.api.create({ url: 'https://tools.test/mcp' }); await client.listTools();
    await assert.rejects(client.call('x', {}), /交互|input_required/);
});
test('MCP endpoint safety, abort and HTTP auth errors are explicit', async () => {
    const { api, requests } = fixture(() => json({}, 401));
    for (const url of ['javascript:x', 'http://remote.test/mcp', 'https://name:secret@tools.test', 'https://tools.test/?token=secret']) assert.throws(() => api.create({ url }));
    assert.ok(api.create({ url: 'http://127.0.0.1:9000/mcp' }));
    const ac = new AbortController(); ac.abort();
    await assert.rejects(api.create({ url: 'https://tools.test/mcp' }).listTools(ac.signal), /取消|abort/i);
    assert.equal(requests.length, 0);
    await assert.rejects(api.create({ url: 'https://tools.test/mcp' }).listTools(), /401.*令牌|令牌.*401/);
});
test('modern MCP headers encode non-ASCII names and mirror approved primitive parameters', async () => {
    const { api, requests } = fixture(body => reply(body, body.method === 'tools/list' ? {tools:[]} : {content:[{type:'text',text:'ok'}]}));
    const client=api.create({url:'https://tools.test/mcp'});await client.listTools();
    await client.call('天气',{location:{city:'北京'},count:2},undefined,[{name:'City',path:['location','city'],type:'string'},{name:'Count',path:['count'],type:'integer'}]);
    const headers=requests.at(-1).init.headers;assert.match(headers['Mcp-Name'],/^=\?base64\?/);assert.equal(headers['Mcp-Param-Count'],'2');assert.match(headers['Mcp-Param-City'],/^=\?base64\?/);
});

test('modern resource reads mirror URI into Mcp-Name and legacy reads never emit modern headers', async () => {
    for (const protocol of ['2026-07-28', '2025-06-18']) {
        const f = fixture((body, init) => {
            if (body.method === 'initialize') return reply(body, { protocolVersion: protocol, capabilities: { resources: {} } });
            if (!body.id) return new Response(null, { status: 202 });
            if (protocol === '2026-07-28') assert.ok(init.headers['Mcp-Name'], 'strict modern resource routing requires a URI name');
            else assert.equal(init.headers['Mcp-Name'], undefined);
            return reply(body, { contents: [{ uri: body.params.uri, text: 'ok' }] });
        });
        const uri = 'memo://人物/约定';
        const result = await f.api.create({ url: 'https://tools.test/mcp', protocol }).readResource(uri);
        assert.equal(result.contents[0].text, 'ok');
        if (protocol === '2026-07-28') assert.match(f.requests.at(-1).init.headers['Mcp-Name'], /^=\?base64\?/);
    }
});
test('expired legacy sessions recover once only for explicitly safe reads', async () => {
    let sessions = 0, calls = 0;
    const f = fixture(body => {
        if (body.method === 'initialize') return json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{},resources:{},prompts:{}}}},200,{'Mcp-Session-Id':'s'+(++sessions)});
        if (!body.id) return new Response(null,{status:202});
        if (body.method === 'tools/call') return ++calls === 1 ? json({},404) : reply(body,{content:[{type:'text',text:'ok'}]});
        return reply(body,{tools:[]});
    });
    const c=f.api.create({url:'https://tools.test/mcp',protocol:'2025-06-18'});await c.listTools();
    assert.equal((await c.call('read',{},undefined,[],{safeRead:true})).content[0].text,'ok');
    assert.equal(sessions,2);assert.equal(calls,2);assert.equal(c.version,'2025-06-18');
});
test('resources and prompts require explicit preview and preserve protocol/session', async () => {
    const f=fixture(body=>reply(body,body.method==='tools/list'?{tools:[]}:body.method==='resources/list'?{resources:[{name:'notes',uri:'memo://notes'}]}:body.method==='prompts/list'?{prompts:[{name:'review'}]}:body.method==='resources/read'?{contents:[{uri:body.params.uri,text:'hello'}]}:{messages:[{role:'user',content:{type:'text',text:'preview'}}]}));
    const c=f.api.create({url:'https://tools.test/mcp'});await c.listTools();
    assert.equal((await c.listResources())[0].uri,'memo://notes');assert.equal((await c.listPrompts())[0].name,'review');
    assert.equal((await c.readResource('memo://notes')).contents[0].text,'hello');assert.equal((await c.getPrompt('review',{topic:'x'})).messages[0].content.text,'preview');
    await assert.rejects(c.readResource('javascript:alert(1)'),/资源/);
    await assert.rejects(c.getPrompt('review',{topic:{x:1}}),/参数/);
    assert.equal(f.requests.filter(x=>x.body.method==='tools/call').length,0);
});
test('legacy resources-only services can be discovered without requiring tools capability',async()=>{
    const f=fixture(body=>body.method==='initialize'?reply(body,{protocolVersion:'2025-11-25',capabilities:{resources:{}}}):!body.id?new Response(null,{status:202}):body.method==='resources/list'?reply(body,{resources:[{name:'a',uri:'memo://a'}]}):json({},400));
    const client=f.api.create({url:'https://tools.test/mcp',protocol:'2025-11-25'});assert.equal((await client.listTools()).length,0);assert.equal((await client.listResources()).length,1);assert.equal(f.requests.some(x=>x.body.method==='tools/list'),false);
});
