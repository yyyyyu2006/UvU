const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(overrides={}) {
    const storage=()=>{const a=new Map();return {getItem:k=>a.get(k)||null,setItem:(k,v)=>a.set(k,v),removeItem:k=>a.delete(k)}};
    const listeners=new Set(),requests=[],popup={closed:false,location:{href:'about:blank'},close(){this.closed=true;}};let token='';
    const svc={id:'s',url:'https://mcp.test/mcp',auth:'oauth',oauth:{clientId:'public-client',scope:'read'}};
    const window={open:()=>popup,addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn),MCPServices:{service:()=>svc,vault:{get:()=>token,set:(_s,v)=>token=v,clear:()=>token=''}}};
    const c=vm.createContext({window,location:new URL('https://uvu.test/UvU/index.html'),URL,URLSearchParams,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,btoa,AbortController,DOMException,setTimeout,clearTimeout,setInterval,clearInterval,sessionStorage:storage(),localStorage:storage(),console,
        fetch:async(url,options)=>{requests.push({url:String(url),options});let data;
            if(String(url)==='https://mcp.test/mcp') return new Response('',{status:401,headers:{'WWW-Authenticate':'Bearer resource_metadata="https://mcp.test/meta", scope="read"'}});
            if(String(url)==='https://mcp.test/meta')data={resource:'https://mcp.test/mcp',authorization_servers:['https://auth.test/tenant']};
            else if(String(url).includes('.well-known'))data={issuer:'https://auth.test/tenant',authorization_endpoint:'https://auth.test/authorize',token_endpoint:'https://auth.test/token',code_challenge_methods_supported:['S256']};
            else data={access_token:'access',token_type:'Bearer',expires_in:3600,refresh_token:'refresh'};
            return new Response(JSON.stringify({...data,...(overrides[String(url)]||{})}),{headers:{'content-type':'application/json'}});
        }});
    const file=path.join(__dirname,'../js/modules/mcp_oauth.js');assert.ok(fs.existsSync(file),'OAuth module exists');vm.runInContext(fs.readFileSync(file,'utf8'),c);
    return {api:window.MCPOAuth,c,svc,popup,requests,emit:data=>{for(const fn of listeners)fn(data)},token:()=>token};
}
async function waitForAuthorization(f) {
    const deadline = Date.now() + 5000;
    while (f.popup.location.href === 'about:blank' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    if (f.popup.location.href === 'about:blank') { f.api.disconnect(f.svc); throw Error('OAuth authorization URL was not prepared'); }
}
test('OAuth discovery binds resource/issuer and refuses non-PKCE or unsafe endpoints',async()=>{
    const f=fixture();const d=await f.api.discover(f.svc);assert.equal(d.issuer,'https://auth.test/tenant');
    await assert.rejects(fixture({'https://mcp.test/meta':{resource:'https://other.test/mcp'}}).api.discover(f.svc),/资源|resource/);
    await assert.rejects(fixture({'https://auth.test/.well-known/oauth-authorization-server/tenant':{issuer:'https://evil.test'}}).api.discover(f.svc),/issuer|颁发/);
    await assert.rejects(fixture({'https://auth.test/.well-known/oauth-authorization-server/tenant':{code_challenge_methods_supported:['plain']}}).api.discover(f.svc),/PKCE|S256/);
});
test('OAuth opens on click, uses PKCE/resource/state and accepts only its matching callback',async()=>{
    const f=fixture();const pending=f.api.connect(f.svc,{remember:false});
    await waitForAuthorization(f);
    const auth=new URL(f.popup.location.href);assert.equal(auth.searchParams.get('resource'),f.svc.url);assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.ok(auth.searchParams.get('code_challenge').length>40);assert.equal(auth.searchParams.get('redirect_uri'),'https://uvu.test/UvU/mcp-oauth-callback.html');
    f.emit({origin:'https://evil.test',source:f.popup,data:{type:'uvu-mcp-oauth',state:auth.searchParams.get('state'),code:'stolen'}});
    f.emit({origin:'https://uvu.test',source:f.popup,data:{type:'uvu-mcp-oauth',state:'bad',code:'stolen'}});
    assert.equal(f.requests.filter(x=>x.url.endsWith('/token')).length,0);
    f.emit({origin:'https://uvu.test',source:f.popup,data:{type:'uvu-mcp-oauth',state:auth.searchParams.get('state'),code:'valid',iss:'https://auth.test/tenant'}});
    await pending;assert.equal(f.token(),'access');const request=f.requests.find(x=>x.url.endsWith('/token'));const body=new URLSearchParams(request.options.body);assert.equal(body.get('code'),'valid');assert.ok(body.get('code_verifier').length>=43);assert.equal(body.get('resource'),f.svc.url);assert.ok(!body.has('client_secret'));assert.equal(f.popup.closed,true);
    f.api.disconnect(f.svc);assert.equal(f.token(),'');
});
test('OAuth cancellation and configuration changes never retain access tokens',async()=>{
    const f=fixture(),ac=new AbortController();const p=f.api.connect(f.svc,{signal:ac.signal});ac.abort();await assert.rejects(p,/取消|abort/i);assert.equal(f.token(),'');
});
test('OAuth concurrent expiry refreshes once and uses only the original resource',async()=>{
    const f=fixture(),key='uvu.mcp.oauth.v1:'+encodeURIComponent(f.svc.id+'|'+f.svc.url+'|'+f.svc.oauth.clientId);
    f.c.sessionStorage.setItem(key,JSON.stringify({expires:Date.now()-1,resource:f.svc.url,token:'https://auth.test/token',refresh:'refresh',remember:false}));
    f.c.window.MCPServices.vault.set(f.svc,'old');
    const [a,b]=await Promise.all([f.api.access(f.svc),f.api.access(f.svc)]);assert.equal(a,'access');assert.equal(b,'access');
    assert.equal(f.requests.filter(r=>r.url==='https://auth.test/token').length,1);assert.equal(new URLSearchParams(f.requests[0].options.body).get('resource'),f.svc.url);
});

test('obsolete refresh failure does not remove a subsequent login', async () => {
    const f=fixture(),key='uvu.mcp.oauth.v1:'+encodeURIComponent(f.svc.id+'|'+f.svc.url+'|'+f.svc.oauth.clientId);
    f.c.sessionStorage.setItem(key,JSON.stringify({expires:Date.now()-1,resource:f.svc.url,token:'https://auth.test/token',refresh:'old-refresh',remember:false}));
    f.c.window.MCPServices.vault.set(f.svc,'old');
    let release;f.c.fetch=()=>new Promise(resolve=>release=resolve);
    const pending=f.api.access(f.svc),rejected=assert.rejects(pending,/400/);
    f.api.disconnect(f.svc);
    const next={expires:Date.now()+3600000,resource:f.svc.url,token:'https://auth.test/token',refresh:'new-refresh',remember:false};
    f.c.sessionStorage.setItem(key,JSON.stringify(next));f.c.window.MCPServices.vault.set(f.svc,'new-login');
    release(new Response('',{status:400}));await rejected;
    assert.equal(f.token(),'new-login');assert.deepEqual(JSON.parse(f.c.sessionStorage.getItem(key)),next);
    assert.equal(await f.api.access(f.svc),'new-login');
});
test('OAuth mismatched issuer and changed service invalidate callbacks without saving a token',async()=>{
    for(const changed of [false,true]) {
        const f=fixture(),promise=f.api.connect(f.svc);
        await waitForAuthorization(f);
        const auth=new URL(f.popup.location.href);
        if(changed)f.c.window.MCPServices.service=()=>({...f.svc,url:'https://other.test/mcp'});
        const rejected=assert.rejects(promise,/issuer|配置|失效/);
        f.emit({origin:'https://uvu.test',source:f.popup,data:{type:'uvu-mcp-oauth',state:auth.searchParams.get('state'),code:'valid',iss:changed?'https://auth.test/tenant':'https://evil.test'}});await rejected;assert.equal(f.token(),'');
    }
});
