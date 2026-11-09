// Real loopback official SDK fixture. Install: npm ci --prefix tests/fixtures/mcp-sdk --ignore-scripts
// Run: node --test tests/mcp_sdk_interop.cjs (no accounts, tokens or paid services).
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createRequire } = require('node:module');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sdk = createRequire(path.join(__dirname, 'fixtures/mcp-sdk/package.json'));
const { Server } = sdk('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = sdk('@modelcontextprotocol/sdk/server/streamableHttp.js');
const types = sdk('@modelcontextprotocol/sdk/types.js');
async function fixture(t, enableJsonResponse) {
    let revision = 1;
    const requests = [];
    const server = new Server({ name: 'uvu-fixture', version: '1' }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
    server.setRequestHandler(types.ListToolsRequestSchema, async request => ({ tools: [{ name: request.params?.cursor ? 'second' : 'read', description: 'revision ' + revision, inputSchema: { type: 'object' } }], ...(!request.params?.cursor ? { nextCursor: 'next' } : {}) }));
    server.setRequestHandler(types.CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'tool result' }] }));
    server.setRequestHandler(types.ListResourcesRequestSchema, async request => ({ resources: [{ uri: request.params?.cursor ? 'memo://second' : 'memo://notes', name: 'notes' }], ...(!request.params?.cursor ? { nextCursor: 'next' } : {}) }));
    server.setRequestHandler(types.ReadResourceRequestSchema, async request => {
        if (request.params.uri === 'memo://slow') await new Promise(resolve => setTimeout(resolve, 100));
        return { contents: [{ uri: request.params.uri, text: 'resource result' }] };
    });
    server.setRequestHandler(types.ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'review', arguments: [{ name: 'topic', required: true }] }] }));
    server.setRequestHandler(types.GetPromptRequestSchema, async request => ({ messages: [{ role: 'user', content: { type: 'text', text: request.params.arguments.topic } }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse });
    await server.connect(transport);
    const http = createServer(async (req, res) => {
        if (req.url === '/auth') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); return; }
        if (req.url === '/broken') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {'); setTimeout(() => res.destroy(), 10); return; }
        try {
            const chunks = []; for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks)); requests.push({ body, headers: req.headers });
            await transport.handleRequest(req, res, body);
        } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(); }
    });
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
    t.after(async () => { await server.close(); await new Promise(resolve => http.close(resolve)); });
    const c = vm.createContext({ window: {}, URL, TextEncoder, TextDecoder, AbortController, DOMException, setTimeout, clearTimeout, btoa, fetch });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/mcp_transport.js'), 'utf8'), c);
    const root = 'http://127.0.0.1:' + http.address().port;
    return { requests, api: c.window.MCPTransport, root, changeDefinition: () => revision++ };
}
for (const json of [true, false]) test('official SDK 1.24.3 loopback ' + (json ? 'JSON' : 'SSE') + ' negotiation, pagination, resource/template and failure contracts', async t => {
    const f = await fixture(t, json);
    const client = f.api.create({ url: f.root + '/mcp' });
    assert.deepEqual(Array.from(await client.listTools(), tool => tool.name), ['read', 'second']);
    assert.ok(f.requests.some(request => request.body.method === 'initialize'), 'real 2025 SDK negotiated from modern probe');
    assert.equal(client.version, '2025-11-25');
    assert.equal((await client.listResources()).length, 2);
    assert.equal((await client.readResource('memo://notes')).contents[0].text, 'resource result');
    assert.equal((await client.listPrompts())[0].name, 'review');
    assert.equal((await client.getPrompt('review', { topic: '核对约定' })).messages[0].content.text, '核对约定');
    assert.equal((await client.call('read', {})).content[0].text, 'tool result');
    f.changeDefinition(); assert.equal((await client.listTools())[0].description, 'revision 2');
    const ac = new AbortController(); const slow = client.readResource('memo://slow', ac.signal); setTimeout(() => ac.abort(), 10);
    await assert.rejects(slow, /取消|abort/i);
    await assert.rejects(f.api.create({ url: f.root + '/auth' }).listTools(), /401/);
    await assert.rejects(f.api.create({ url: f.root + '/broken' }).listTools());
    for (const request of f.requests.filter(request => request.body.method !== 'tools/list' || !request.body.params._meta)) {
        assert.equal(request.headers['mcp-name'], undefined, 'legacy SDK requests carry no modern name header');
    }
});
