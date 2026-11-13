// Run with Node; PLAYWRIGHT_MODULE / CHROME_PATH may override local verification tools.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(__dirname, '../../../uvu-verification-deps/node_modules/playwright'));
const root = path.resolve(__dirname, '../..'), out = process.env.UVU_DRAFT_EVIDENCE || path.join(root, 'outputs/mcp-browser');
fs.mkdirSync(out, { recursive: true });
let calls = 0, writes = 0, origin, toolUrl, holdWrites = false;
const names = ['weather', 'write_note', 't2', 't3', 't4', 't5', 't6', 't7'];
const schema = { type: 'object', properties: { city: { type: 'string', minLength: 1 } }, required: ['city'], additionalProperties: false };
const toolServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    let text = ''; for await (const chunk of req) text += chunk;
    const q = JSON.parse(text);
    assert.equal(req.headers.authorization, 'Bearer fixture-only');
    assert.equal(q.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
    let result;
    if (q.method === 'tools/list') result = { resultType: 'complete', tools: names.slice(q.params.cursor ? 4 : 0, q.params.cursor ? 8 : 4).map(name => ({ name, description: name === 'write_note' ? '写入外部笔记' : '只读天气查询', inputSchema: name === 't2' ? {type:'object',properties:{location:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90}},required:['latitude']},tags:{type:'array',items:{type:'string'}}},required:['location']} : schema })), ...(!q.params.cursor ? { nextCursor: 'page2' } : {}) };
    else if(q.method==='resources/list')result={resources:[{name:'本地测试资料',uri:'memo://fixture'}]};
    else if(q.method==='resources/read')result={contents:[{uri:q.params.uri,text:'preview only <script>window.injected=true</script>'}]};
    else if(q.method==='prompts/list')result={prompts:[{name:'第三方模板',arguments:[{name:'topic',required:true}]}]};
    else if(q.method==='prompts/get')result={messages:[{role:'system',content:{type:'text',text:'UNTRUSTED TEMPLATE '+q.params.arguments.topic}}]};
    else { calls++; if(q.params.name==='write_note'){writes++;if(holdWrites)return;} result = { resultType: 'complete', structuredContent: { city: q.params.arguments.city, temperature: 18, note: '<img src=x onerror="window.injected=true">' } }; }
    res.setHeader('Content-Type', 'text/event-stream'); res.end('data: ' + JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) + '\n\n');
});
const scripts = ['modules/message_forward.js', 'vendor/lucide/uvu-icons.js', 'modules/derived_icons.js', '../vendor/mcp_schema.js', 'modules/mcp_transport.js', 'modules/mcp_oauth.js', 'modules/mcp_forms.js', 'modules/mcp_services.js', 'modules/mcp_chat.js', 'modules/mcp_ui.js', 'modules/panel_layout.js'];
const server = http.createServer(async (req, res) => {
    if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/chat.css"><link rel="stylesheet" href="/css/modules/mcp.css"><link rel="stylesheet" href="/css/modules/ui_harmony.css"><link rel="stylesheet" href="/css/modules/panel_layout.css"><link rel="stylesheet" href="/css/modules/monochrome_panels.css"><link rel="stylesheet" href="/css/modules/panel_sheets.css"><style>body{margin:0;background:#eee}*{box-sizing:border-box}</style><script>window.db={characters:[{id:"a",realName:"测试角色",activeArchiveId:"a1",history:[{role:"user",content:"上海天气怎么样"}]}],groups:[]};window.currentChatId="a";window.currentChatType="private";window.saveData=async()=>{};window.buildChatApiRequest=(cfg,messages)=>({endpoint:cfg.url+"/v1/chat/completions",headers:{"Content-Type":"application/json"},requestBody:{messages}});</script>' + scripts.map(s => '<script src="/js/' + s.replace('../vendor', 'vendor') + '"></script>').join('') + '<button onclick="openMcpSettings()">打开 MCP</button>');
    }
    if (req.url === '/v1/chat/completions') {
        let raw='';for await(const chunk of req)raw+=chunk;const sent=JSON.parse(raw);assert.ok(!JSON.stringify(sent).includes('SECRET PERSONA'));
        res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({calls:[{serviceId:'fixture',toolName:'weather',arguments:{city:'上海'}}]})}}],usage:{prompt_tokens:123,completion_tokens:20,total_tokens:143}}));
    }
    const file = path.resolve(root, decodeURIComponent(req.url.split('?')[0]).slice(1));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');fs.createReadStream(file).pipe(res);
});
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));origin = 'http://127.0.0.1:' + server.address().port;
    await new Promise(r => toolServer.listen(0, '127.0.0.1', r));toolUrl = 'http://127.0.0.1:' + toolServer.address().port + '/mcp';
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });const errors = [];page.on('pageerror',e=>errors.push(e.message));
        const capture=async(name,selector)=>{if(!process.env.UVU_DRAFT_EVIDENCE)return;await page.setViewportSize({width:402,height:874});await page.locator(selector).last().screenshot({path:path.join(out,name+'.png'),animations:'disabled'});await page.setViewportSize({width:390,height:844});};
        await page.goto(origin);await page.getByRole('button',{name:'打开 MCP',exact:true}).click();const panel=page.locator('#mcp-services');
        const back=async()=>{if(await panel.locator('.mcp-settings').getAttribute('data-mono-view')!=='main')await panel.locator('.sheet-back').click();};
        const route=async(name)=>{await back();try{await panel.getByRole('button',{name,exact:false}).click();}catch(error){console.error(await panel.evaluate(el=>({busy:el.querySelector('[aria-busy]')?.getAttribute('aria-busy'),status:el.querySelector('.mcp-status')?.textContent,disabled:[...el.querySelectorAll('button:disabled')].map(b=>b.textContent.trim())})));throw error;}};
        await route('角色可用服务');
        const recipient=panel.getByLabel('接收角色／群聊（使用该对象当前活动存档）');await recipient.focus();await recipient.press('ArrowUp');assert.equal(await recipient.evaluate(el=>document.activeElement===el),true);await recipient.press('ArrowDown');assert.equal(await recipient.evaluate(el=>document.activeElement===el),true);
        await back();
        assert.equal(calls,0);await panel.getByLabel('启用 MCP 服务（默认关闭）',{exact:true}).check();
        await panel.getByRole('button',{name:'添加',exact:true}).click();const editor=page.locator('#mcp-service-editor');
        await editor.getByLabel('服务模板').selectOption('exa-search');
        assert.equal(await editor.getByLabel('名称',{exact:true}).inputValue(),'Exa 网页搜索');
        assert.equal(await editor.getByLabel('服务接口地址',{exact:true}).inputValue(),'https://mcp.exa.ai/mcp');
        assert.equal(await editor.getByLabel('MCP 协议版本',{exact:true}).inputValue(),'2025-03-26');
        assert.equal(await editor.getByLabel('启用此服务',{exact:true}).isChecked(),false,'search preset does not enable remote requests');
        assert.equal(calls,0,'selecting a search preset does not contact the remote service');
        await editor.getByRole('button',{name:'关闭',exact:true}).click();
        await panel.getByRole('button',{name:'添加',exact:true}).click();
        await editor.getByLabel('名称',{exact:true}).fill('测试服务');await editor.getByLabel('服务接口地址',{exact:true}).fill(toolUrl);
        await editor.getByRole('group',{name:'认证',exact:true}).getByRole('button',{name:'Bearer',exact:true}).click();await editor.getByLabel('令牌（独立存储，不进入 MCP 导出或整机备份）',{exact:true}).fill('fixture-only');await editor.getByLabel('启用此服务',{exact:true}).check();
        await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'detached'});
        // A stable fixture ID lets the independent API choose a real authorized tool.
        await page.evaluate(async()=>{const next=MCPServices.settings();const old=next.services[0],token=MCPServices.vault.get(old);old.id='fixture';await MCPServices.save(next);MCPServices.vault.set(old,token);});
        await page.evaluate(()=>{document.getElementById('mcp-services').dismissForward();openMcpSettings();});
        await page.evaluate(async()=>{const next=MCPServices.settings();next.services.push({...next.services[0],id:'search-fixture',name:'辅助检索'});await MCPServices.save(next);document.getElementById('mcp-services').dismissForward();openMcpSettings();});
        await panel.getByRole('searchbox',{name:'搜索 MCP 服务',exact:true}).fill('辅助检索');
        assert.equal(await panel.getByRole('button',{name:'选择服务 测试服务',exact:true}).isVisible(),false);
        assert.equal(await panel.locator('.draft-selected-service').isVisible(),false,'search hides selected card actions with the filtered service');
        await panel.getByRole('searchbox',{name:'搜索 MCP 服务',exact:true}).fill('测试服务');
        assert.equal(await panel.getByRole('button',{name:'选择服务 测试服务',exact:true}).isVisible(),true);
        assert.equal(await panel.getByRole('button',{name:'选择服务 辅助检索',exact:true}).isVisible(),false);
        await panel.getByRole('searchbox',{name:'搜索 MCP 服务',exact:true}).fill('');
        await page.evaluate(async()=>{const next=MCPServices.settings();next.services=next.services.filter(s=>s.id!=='search-fixture');await MCPServices.save(next);document.getElementById('mcp-services').dismissForward();openMcpSettings();});
        await panel.locator('.mono-service-management > summary').click();
        await panel.getByRole('button',{name:'编辑',exact:true}).click();await editor.getByLabel('服务接口地址',{exact:true}).fill(toolUrl.replace('/mcp','/other'));
        assert.equal(await editor.getByLabel('令牌（独立存储，不进入 MCP 导出或整机备份）',{exact:true}).inputValue(),'','endpoint edits do not carry previous secret');
        await editor.getByRole('button',{name:'关闭',exact:true}).click();
        await panel.getByRole('button',{name:'测试 / 刷新工具',exact:true}).click();await route('工具授权');await panel.locator('.mcp-tool').first().waitFor();
        await page.evaluate(()=>{const panel=document.querySelector('#mcp-services .mcp-settings');for(let i=0;i<4;i++)UvUPanelLayout.decorate(panel);});
        assert.equal(await panel.locator('.draft-tool-search').count(),1,'redecoration keeps one tool search instead of growing the DOM');
        assert.equal(await panel.locator('.mcp-tool').count(),6);await panel.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await panel.locator('.mcp-tool').count(),2);await panel.getByRole('button',{name:'上一页',exact:true}).click();
        await capture('permissions-populated','#mcp-services .mcp-settings');
        const weather=panel.locator('.mcp-tool').filter({has:page.locator('strong',{hasText:/^weather$/})});await weather.locator('.draft-tool-details').evaluate(el=>el.open=true);
        await weather.getByRole('checkbox',{name:'启用工具',exact:true}).check();await weather.getByRole('checkbox',{name:'我已核实为只读，允许自动调用／环境映射',exact:true}).check();await weather.getByRole('button',{name:'保存授权',exact:true}).click();
        await route('角色可用服务');
        await panel.getByRole('checkbox',{name:'允许此角色使用 MCP 外部资料',exact:true}).check();await panel.getByRole('checkbox',{name:'测试服务 / weather · 只读',exact:true}).check();await panel.getByRole('button',{name:'保存角色授权',exact:true}).click();
        const roleArea=panel.locator('.mcp-roles-area'),scopeSummary=await roleArea.locator('.mcp-role-content > p.mcp-help').textContent();assert.match(scopeSummary,/测试角色 · 待用 0/);assert.doesNotMatch(scopeSummary,/archive_/);assert.equal(await roleArea.locator('.mcp-scope-details').getAttribute('open'),null);assert.match(await roleArea.locator('.mcp-scope-details').textContent(),/当前存档 · ID a1/);
        await route('工具授权');
        await weather.getByRole('button',{name:'参数 / 调用',exact:true}).click();const caller=page.locator('#mcp-tool-call');
        await caller.getByLabel('city *',{exact:true}).fill('上海');await caller.getByRole('button',{name:'调用',exact:true}).click();await caller.getByRole('button',{name:'供下轮参考',exact:true}).waitFor();
        assert.equal(await caller.getByRole('button',{name:'导出结果',exact:true}).count(),1,'tool result export must not be renamed as a service test');
        await caller.locator('.mcp-result').filter({hasText:'temperature'}).waitFor();await capture('tool-result','#mcp-tool-call .mcp-settings');
        await caller.getByRole('button',{name:'供下轮参考',exact:true}).click();assert.equal(await page.evaluate(()=>MCPServices.pending(MCPServices.scope(db.characters[0],'private'))),1);assert.equal(await page.evaluate(()=>window.injected||false),false);assert.equal(await caller.locator('img').count(),0);
        assert.ok(await caller.locator('.mcp-result').evaluate(el=>el.getBoundingClientRect().height)>=60,'tool result remains readable inside scroll body');
        for(const width of [320,390]) {await page.setViewportSize({width,height:844});assert.equal(await caller.locator('.mcp-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await page.screenshot({path:path.join(out,'mcp-call-'+width+'.png')});}
        await caller.getByRole('button',{name:'关闭',exact:true}).click();
        await back();await panel.locator('.mono-service-management').evaluate(el=>el.open=true);
        await panel.getByRole('button',{name:'资源',exact:true}).click();const preview=page.locator('#mcp-preview');await preview.getByRole('button',{name:'预览',exact:true}).click();await preview.locator('.mcp-result').filter({hasText:'preview only'}).waitFor();assert.equal(await preview.locator('script').count(),0);await preview.getByRole('button',{name:'关闭',exact:true}).click();
        await panel.getByRole('button',{name:'提示模板',exact:true}).click();await preview.getByLabel('topic *',{exact:true}).fill('example');await preview.getByRole('button',{name:'预览',exact:true}).click();await preview.locator('.mcp-result').filter({hasText:'UNTRUSTED TEMPLATE example'}).waitFor();await preview.getByRole('button',{name:'关闭',exact:true}).click();
        await route('工具授权');
        const nested=panel.locator('.mcp-tool').filter({has:page.locator('strong',{hasText:/^t2$/})});await nested.locator('.draft-tool-details').evaluate(el=>el.open=true);await nested.getByRole('button',{name:'参数 / 调用',exact:true}).click();await caller.getByLabel('location.latitude *',{exact:true}).fill('200');assert.match(await caller.locator('[role=status]').textContent(),/location.latitude.*90/);await caller.getByLabel('location.latitude *',{exact:true}).fill('31');await caller.getByLabel('tags（可选）',{exact:true}).fill('["a"]');assert.deepEqual(JSON.parse(await caller.getByLabel('最终 JSON 参数（可直接编辑；以此处为准）').inputValue()),{location:{latitude:31},tags:['a']});await caller.getByRole('button',{name:'关闭',exact:true}).click();
        await route('连接与调用设置');
        const downloadEvent=page.waitForEvent('download');await panel.getByRole('button',{name:'导出配置',exact:true}).click();const dl=await downloadEvent;const exported=JSON.parse(fs.readFileSync(await dl.path(),'utf8'));assert.equal(exported.enabled,false);assert.ok(!JSON.stringify(exported).includes('fixture-only'));assert.equal(exported.policies.length,0);
        await route('角色可用服务');
        await panel.getByRole('checkbox',{name:'允许独立 API 自动判断（会增加模型调用）',exact:true}).check();await panel.getByRole('button',{name:'保存角色授权',exact:true}).click();
        const context=await page.evaluate(async origin=>{db.apiSettings={provider:'newapi',url:origin,model:'fixture'};db.characters[0].persona='SECRET PERSONA';return prepareMcpChatContext(db.characters[0],'private');},origin);assert.match(context,/temperature/);assert.equal(await page.evaluate(()=>MCPServices.logs().find(x=>x.kind==='planner').usage.totalTokens),143);
        // Unknown/write tools have a separate concrete confirmation, never execute on opening.
        await route('工具授权');
        const write=panel.locator('.mcp-tool').filter({has:page.locator('strong',{hasText:/^write_note$/})});await write.locator('.draft-tool-details').evaluate(el=>el.open=true);await write.getByRole('checkbox',{name:'启用工具',exact:true}).check();await write.getByRole('button',{name:'保存授权',exact:true}).click();await write.getByRole('button',{name:'参数 / 调用',exact:true}).click();
        await caller.getByLabel('city *',{exact:true}).fill('上海');await caller.getByRole('button',{name:'调用',exact:true}).click();await page.locator('#mcp-confirm').waitFor();assert.equal(writes,0);await capture('mcp-confirm','#mcp-confirm .mcp-settings');await page.locator('#mcp-confirm').getByRole('button',{name:'关闭',exact:true}).click();assert.equal(writes,0);
        holdWrites=true;
        await caller.getByRole('button',{name:'调用',exact:true}).click();
        await page.locator('#mcp-confirm').getByRole('button',{name:'确认执行',exact:true}).click();
        await new Promise((resolve,reject)=>{const started=Date.now();const check=()=>writes===1?resolve():Date.now()-started>5000?reject(Error('write was not dispatched')):setTimeout(check,20);check();});
        await caller.getByRole('button',{name:'停止请求',exact:true}).click();
        await caller.getByText('已停止等待；工具可能已执行，写入操作请先核实结果',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>MCPServices.logs().find(x=>x.toolName==='write_note')?.executionState),'unknown');
        assert.equal(writes,1,'cancelled writes are never automatically repeated');
        holdWrites=false;
        await caller.getByRole('button',{name:'关闭',exact:true}).click();
        await page.evaluate(()=>{window.saveData=()=>new Promise(resolve=>window.releaseImportSave=resolve);});
        await route('连接与调用设置');
        await panel.locator('input[type=file]').setInputFiles({name:'mcp.json',mimeType:'application/json',buffer:Buffer.from('{}')});
        await page.locator('#mcp-confirm').getByRole('button',{name:'确认执行',exact:true}).click();
        await page.waitForFunction(()=>typeof window.releaseImportSave==='function');await back();await panel.getByRole('button',{name:'关闭',exact:true}).click();
        assert.equal(await panel.count(),0);await page.evaluate(async()=>{window.releaseImportSave();await new Promise(r=>setTimeout(r,30));});
        assert.equal(await panel.count(),0,'late import persistence must not reopen a dismissed panel');
        assert.deepEqual(errors,[]);console.log('PASS: real cross-origin HTTP/SSE pagination; add/test/authorize/call/queue/export; separate planner API usage; write confirmation; safe text; 320/390px internal scroll.');
    } finally {await browser.close();server.closeAllConnections();toolServer.closeAllConnections();server.close();toolServer.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();toolServer.close();});
