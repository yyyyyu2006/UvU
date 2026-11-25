const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const fetchTool = (name = 'web_fetch') => ({ serviceId: 'web', name, description: 'Fetch and read webpage content from the provided URL.',
    inputSchema: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string' } } },
    validate: args => !!args && typeof args.url === 'string' && Object.keys(args).length === 1 });
const searchTool = () => ({ serviceId: 'web', name: 'web_search', description: 'Search the web for pages matching a query.',
    inputSchema: { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string' } } },
    validate: args => !!args && typeof args.query === 'string' && Object.keys(args).length === 1 });

function fixture(message, tools = []) {
    const chat = { id: 'chat-1', activeArchiveId: 'archive-1', history: [{ id: 'msg-1', role: 'user', content: message }] };
    const calls = [], planners = [], logs = [];
    const manager = {
        settings: () => ({ enabled: true, planner: { source: 'secondary', recentMessages: 3, timeoutMs: 30000, maxCalls: 2, maxContextChars: 4000, concurrency: 1 } }),
        take: () => '', scope: (value, type) => ({ chat: value, type, archive: value.activeArchiveId, history: value.history }),
        policy: () => ({ enabled: true, auto: true }),
        valid: s => s.chat === chat && s.archive === chat.activeArchiveId && s.history === chat.history,
        stamp: () => 'stable', lease: () => ({ text: '', withResults: values => values.map(v => v.text).join('\n'), commit: () => true }),
        authorized: async () => tools,
        call: async (serviceId, toolName, args) => { calls.push({ serviceId, toolName, args }); return { text: 'FETCHED PAGE BODY', serviceId, toolName }; },
        pool: async (items, _concurrency, work) => Promise.all(items.map(work)),
        context: values => values.map(v => v.text).join('\n'), log: entry => logs.push(entry)
    };
    const c = vm.createContext({ window: { MCPServices: manager }, db: { apiSettings: { secondary: { enabled: true, provider: 'newapi', url: 'https://secondary.test/v1', model: 'cheap-model', key: 'test' } } },
        URL, DOMException, AbortController, setTimeout, clearTimeout, Date, console,
        buildChatApiRequest: (cfg, messages) => { planners.push(cfg); return { endpoint: cfg.url, headers: {}, requestBody: { messages } }; },
        fetch: async (_url, options) => { c.lastRequest = JSON.parse(options.body); return { ok: true, status: 200, body: { cancel: async () => {} } }; } });
    c.window.MCPTransport = { endpoint: value => value, wait: promise => promise, readBody: async () => ({ choices: [{ message: { content: JSON.stringify({ calls: [{ serviceId: 'web', toolName: tools.find(t => t.name.startsWith('web_fetch'))?.name, arguments: { url: 'https://example.com/article' } }] }) } }] }) };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/mcp_chat.js'), 'utf8'), c);
    return { c, chat, calls, planners, logs, run: () => c.window.MCPChat.prepare(chat, 'private') };
}

test('ordinary chat skips MCP discovery and planner token use', async () => {
    let discoveries = 0;
    const f = fixture('今天心情有点低落。');
    f.c.window.MCPServices.authorized = async () => { discoveries++; return []; };
    assert.equal(await f.run(), '');
    assert.equal(discoveries, 0);
    assert.equal(f.planners.length, 0);
});

test('a single public URL directly calls the uniquely authorized URL reader without planner', async () => {
    const f = fixture('https://example.com/article', [fetchTool(), searchTool()]);
    assert.match(await f.run(), /FETCHED PAGE BODY/);
    assert.equal(JSON.stringify(f.calls), JSON.stringify([{ serviceId: 'web', toolName: 'web_fetch', args: { url: 'https://example.com/article' } }]));
    assert.equal(f.planners.length, 0);
});

test('ambiguous URL readers are sent to the secondary planner with only fetch candidates and a small output cap', async () => {
    const f = fixture('帮我看看 https://example.com/article', [fetchTool('web_fetch_a'), fetchTool('web_fetch_b'), searchTool()]);
    assert.match(await f.run(), /FETCHED PAGE BODY/);
    assert.equal(f.planners.length, 1);
    assert.equal(f.planners[0].url, 'https://secondary.test/v1');
    assert.deepEqual(f.c.lastRequest.max_tokens, 512);
    const sentTools = JSON.parse(f.c.lastRequest.messages[1].content).availableTools;
    assert.deepEqual(sentTools.map(tool => tool.toolName), ['web_fetch_a', 'web_fetch_b']);
    assert.equal(f.calls.length, 1);
});

test('unsafe URL destinations and sensitive query values never reach an automatic fetch tool', async () => {
    const cases = ['http://127.0.0.1/admin', 'http://192.168.1.4/private', 'https://user:pass@example.com/private', 'https://example.com/?token=secret&item=1'];
    for (const value of cases) {
        const f = fixture(value, [fetchTool()]);
        await f.run();
        if (value.includes('token=secret')) assert.equal(f.calls[0]?.args.url.includes('token=secret'), false);
        else assert.equal(f.calls.length, 0);
    }
});

test('planner failures say the URL was not read and never invoke a tool', async () => {
    const f = fixture('请查看这个 https://example.com/article', [fetchTool('web_fetch_a'), fetchTool('web_fetch_b')]);
    f.c.window.MCPTransport.readBody = async () => { throw new Error('planner unavailable'); };
    const result = await f.run();
    assert.match(result, /planner unavailable/);
    assert.match(result, /请勿声称已读到网页或评论/);
    assert.equal(f.calls.length, 0);
});

test('a URL without an authorized fetch tool is marked unread instead of sent to a search-only tool', async () => {
    const f = fixture('https://example.com/article', [searchTool()]);
    const result = await f.run();
    assert.match(result, /没有可自动使用的只读网页读取工具/);
    assert.match(result, /请勿声称已读到网页或评论/);
    assert.equal(f.planners.length, 0);
    assert.equal(f.calls.length, 0);
});
