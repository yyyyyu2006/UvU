// Local app + intercepted HTTPS OAuth fixtures; no real credentials or paid requests.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.resolve(__dirname,'../../../uvu-verification-deps/node_modules/playwright'));
const root=path.resolve(__dirname,'../..');let origin,exchange=0;
const scripts=['modules/message_forward.js','vendor/mcp_schema.js','modules/mcp_transport.js','modules/mcp_oauth.js','modules/mcp_forms.js','modules/mcp_services.js','modules/mcp_chat.js','modules/mcp_ui.js'];
const server=http.createServer((req,res)=>{
    if(req.url==='/') {res.setHeader('Content-Type','text/html;charset=utf-8');return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/chat.css"><link rel="stylesheet" href="/css/modules/mcp.css"><script>window.db={characters:[],groups:[]};window.currentChatId="";window.currentChatType="private";window.saveData=async()=>{};</script>'+scripts.map(s=>'<script src="/js/'+s+'"></script>').join('')+'<button onclick="openMcpSettings()">MCP</button>');}
    const file=path.resolve(root,req.url.split('?')[0].slice(1));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html;charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');fs.createReadStream(file).pipe(res);
});
(async()=>{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    try {
        const context=await browser.newContext({viewport:{width:390,height:844}}),errors=[];
        context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
        const json=(route,data,status=200,headers={})=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,...headers},body:JSON.stringify(data)});
        await context.route('https://mcp-oauth.test/**',async route=>{
            const req=route.request(),url=new URL(req.url());
            if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method','Access-Control-Allow-Methods':'GET,POST'}});
            if(url.pathname==='/meta')return json(route,{resource:'https://mcp-oauth.test/mcp',authorization_servers:['https://auth-oauth.test']});
            if(req.method()==='GET')return json(route,{},401,{'WWW-Authenticate':'Bearer resource_metadata="https://mcp-oauth.test/meta"','Access-Control-Expose-Headers':'WWW-Authenticate'});
            assert.equal(req.headers().authorization,'Bearer fixture-oauth');const body=req.postDataJSON();return json(route,{jsonrpc:'2.0',id:body.id,result:{tools:[]}});
        });
        await context.route('https://auth-oauth.test/**',async route=>{
            const req=route.request(),url=new URL(req.url());
            if(url.pathname.includes('.well-known'))return json(route,{issuer:'https://auth-oauth.test',authorization_endpoint:'https://auth-oauth.test/authorize',token_endpoint:'https://auth-oauth.test/token',code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true});
            if(url.pathname==='/authorize') {
                assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('client_id'),'fixture-public');
                const callback=new URL(url.searchParams.get('redirect_uri'));assert.equal(callback.pathname,'/mcp-oauth-callback.html');callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','fixture-code');callback.searchParams.set('iss','https://auth-oauth.test');
                return route.fulfill({contentType:'text/html',body:'<!doctype html><script>location.replace('+JSON.stringify(callback.href)+')</script>'});
            }
            if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST'}});
            const body=new URLSearchParams(req.postData());assert.equal(body.get('code'),'fixture-code');assert.equal(body.get('resource'),'https://mcp-oauth.test/mcp');assert.ok(body.get('code_verifier').length>=43);exchange++;
            return json(route,{token_type:'Bearer',access_token:'fixture-oauth',refresh_token:'fixture-refresh',expires_in:3600});
        });
        const page=await context.newPage();await page.goto(origin);await page.getByRole('button',{name:'MCP',exact:true}).click();const panel=page.locator('#mcp-services');await panel.getByLabel('启用 MCP 服务（默认关闭）').check();
        await panel.getByRole('button',{name:'添加',exact:true}).click();const editor=page.locator('#mcp-service-editor');await editor.getByLabel('名称',{exact:true}).fill('OAuth fixture');await editor.getByLabel('服务接口地址').fill('https://mcp-oauth.test/mcp');await editor.getByLabel('认证',{exact:true}).selectOption('oauth');await editor.getByLabel('公开客户端 ID').fill('fixture-public');await editor.getByLabel('启用此服务',{exact:true}).check();await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'detached'});
        await panel.getByRole('button',{name:'连接 OAuth',exact:true}).click();await panel.locator('.mcp-status').filter({hasText:'授权成功'}).waitFor();assert.equal(exchange,1);
        await panel.getByRole('button',{name:'测试 / 刷新工具',exact:true}).click();await panel.locator('.mcp-status').filter({hasText:'连接成功'}).waitFor();
        const exported=await page.evaluate(()=>JSON.stringify(MCPServices.exportConfig()));assert.ok(!exported.includes('fixture-oauth'));assert.ok(!exported.includes('fixture-refresh'));assert.equal((await context.pages()).length,1);
        await panel.getByRole('button',{name:'断开授权',exact:true}).click();assert.equal(await page.evaluate(()=>MCPServices.health(MCPServices.settings().services[0].id).credentialsPresent),false);assert.deepEqual(errors,[]);
        console.log('PASS: real popup, PKCE redirect callback, issuer/state/source checks, token exchange, discovery, secret-free config and disconnect.');
    } finally {await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
