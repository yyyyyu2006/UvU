// Real app + local deterministic gateway/audio fixtures; no real account or paid calls.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/music-browser'); fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const song = id => ({ provider:'netease', id, title:'秋日来信 ' + id, artists:['林间'], album:'来信', duration:10, availability:'full' });
const wav = Buffer.alloc(44 + 8000 * 2 * 10); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length - 44,40);
let base, searches = 0, authorized = false, publicCalls = 0, accountStreams = 0, shippedEndpoint = '', gatewayOffline = false;
const server = http.createServer((req,res) => {
    const u = new URL(req.url,'http://test');
    if (u.pathname.startsWith('/v1/')) {
        res.setHeader('Content-Type','application/json'); const send = value => res.end(JSON.stringify(value));
        if (u.pathname === '/v1/session') return send({token:'browser-fixture'});
        if (u.pathname === '/v1/health') return send({ok:true,ready:true,providers:['netease','qq'],deployment:{provider:'render',ephemeral:true}});
        if (u.pathname === '/v1/accounts') return send({accounts:[{provider:'netease',loggedIn:authorized,user:{name:'本地测试账号'}},{provider:'qq',loggedIn:false}]});
        if (u.pathname.endsWith('/qr')) return send({id:'fixture_qr',url:u.pathname.includes('/qq/')?'https://xui.ptlogin2.qq.com/cgi-bin/xlogin':'https://music.163.com/login?codekey=fixture',image:'',expiresAt:Date.now()+180000});
        if (u.pathname.endsWith('/qr/fixture_qr')) { authorized=true; return send({status:'authorized',user:{name:'本地测试账号'}}); }
        if (u.pathname === '/v1/search') { searches++; return send({tracks:u.searchParams.get('q')==='滚动'?Array.from({length:30},(_,i)=>song(String(i+1))):[song('1'),{...song('2'),provider:'qq',title:'暮色'}],hasMore:false,errors:[]}); }
        if (u.pathname.endsWith('/stream')) { accountStreams++; return send({url:base+'/fixture.wav',availability:'full'}); }
        if (u.pathname.endsWith('/lyrics')) return send({lyric:'[00:00.00]给你写一封秋日的信\n[00:03.00]把想念寄给晚风'});
        if (u.pathname.endsWith('/playlists')) return send({playlists:[{id:'123',name:'秋日歌单',count:3}]});
        if (u.pathname.startsWith('/v1/playlist/')) { const p=u.pathname.split('/')[3],tracks=(u.searchParams.get('page')==='2'?['2','3']:['1','2']).map(id=>({...song(id),provider:p}));return send({tracks,hasMore:u.searchParams.get('page')!=='2'}); }
        return send({ok:true});
    }
    if (u.pathname === '/fixture.wav') { res.setHeader('Content-Type','audio/wav'); return res.end(wav); }
    if (u.pathname === '/fixture-cover.svg') { const colors=['#b85f72','#6d839a','#a38467','#6f8977'];const i=Number(u.searchParams.get('i'))||0;res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="'+colors[i%4]+'"/><circle cx="290" cy="110" r="140" fill="#ffffff18"/><path d="M0 330L400 70V400H0Z" fill="#ffffff12"/><text x="28" y="310" fill="white" font-size="48" font-family="sans-serif">MUSIC '+(i+1)+'</text></svg>'); }
    const file = path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
    if (!file.startsWith(root+path.sep)) return res.writeHead(403).end();
    fs.readFile(file,(error,data) => { if(error) return res.writeHead(404).end(); res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');res.end(data); });
});
(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base='http://127.0.0.1:'+server.address().port;
    const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    try {
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
        await context.addInitScript(()=>{ localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true'); document.addEventListener('click',()=>{if(typeof globalRescueClickCount!=='undefined')globalRescueClickCount=0;if(typeof globalRescueLastClickTime!=='undefined')globalRescueLastClickTime=0;},true); });
        await context.route('**/*',route=>{
            const url=route.request().url(); if(libs.has(url)) return route.fulfill({path:libs.get(url),contentType:'application/javascript'});
            if (url.startsWith(base + '/js/modules/music_config.js')) return route.fulfill({contentType:'application/javascript',body:'window.UvUMusicConfig = Object.freeze({endpoint:'+JSON.stringify(shippedEndpoint)+'});'});
            if (url.startsWith('https://music-default.test/v1/')) {
                if (gatewayOffline) return route.abort('connectionrefused');
                return route.fetch({url:base + new URL(url).pathname + new URL(url).search}).then(response=>route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}}));
            }
            if(url.startsWith('https://music-api.gdstudio.xyz/api.php')) {
                publicCalls++; const params=new URL(url).searchParams;
                const matched=params.get('name')?.startsWith('秋日来信 ');
                const body=params.get('types')==='search'?[{id:'1857979755',name:matched?params.get('name').replace(/ 林间$/,''):'公共测试曲',artist:['林间'],album:matched?'来信':'测试',source:'netease'}]:params.get('types')==='lyric'?{lyric:'[00:00]公共歌词\\n[00:02]第二句'}:{url:'https://m801.music.126.net/uvu-fixture.wav',br:128};
                return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
            }
            if(url==='https://m801.music.126.net/uvu-fixture.wav') return route.fulfill({status:200,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':'*'},body:wav});
            return url.startsWith(base)||url.startsWith('blob:')||url.startsWith('data:')?route.continue():route.abort();
        });
        const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
        await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
        await page.addStyleTag({content:'#toast-notification { visibility:hidden!important; }'});
        await page.evaluate(async base=>{
            await UvUMusic.saveSettings({endpoint:base,publicSources:[]});
            window.visualMusic=Array.from({length:8},(_,i)=>UvUMusic.normalizeTrack({provider:'netease',id:String(i+10),title:'歌曲 '+i,artists:['歌手'],cover:base+'/fixture-cover.svg?i='+i}));
            db.musicLibrary={favorites:visualMusic,recent:[],queue:[],playlists:[],searches:[]};await saveData();
            await UvUMusic.player.play(visualMusic[0],visualMusic);
        },base);
        // Recommendation refresh: bounded real-result cards, cooldown, failure and stale source isolation.
        await page.evaluate(async base=>{
            await UvUMusic.saveSettings({endpoint:base,publicSources:[]});
            window.recoSearch=UvUMusic.search;window.recoClock=Date.now;window.recoNow=Date.now()+3600000;Date.now=()=>recoNow;window.recoCalls=0;window.recoFail=false;window.recoHold=false;window.recoResolve=null;
            UvUMusic.search=async(q,providers,p,signal)=>{recoCalls++;if(recoHold){await new Promise(resolve=>recoResolve=resolve);}if(recoFail)throw Error('推荐测试网络故障');return {tracks:visualMusic.map(t=>({...t,title:'推荐 '+t.title})),errors:[]};};
            UvUMusicUI.open();
        },base);
        await page.locator('[data-um-tab=home]').click();
        await page.waitForFunction(()=>document.querySelector('.um-recommendations')?.getAttribute('aria-busy')==='false'&&recoCalls===2);
        assert.equal(await page.locator('.um-recommendations .um-feature').count(),4,'two source mixes plus actual saved collections');
        await page.getByRole('button',{name:'换一批推荐',exact:true}).click();assert.equal(await page.evaluate(()=>recoCalls),2,'cooldown prevents rapid source requests');
        await page.screenshot({path:path.join(out,'recommendations-light-390.png')});
        await page.getByRole('button',{name:'音乐账号与设置',exact:true}).click();await page.locator('.um-appearance-settings > summary').click();await page.getByRole('button',{name:'深色',exact:true}).click();await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.screenshot({path:path.join(out,'recommendations-dark-390.png')});
        await page.evaluate(()=>{recoNow+=11000;});await page.getByRole('button',{name:'换一批推荐',exact:true}).click();assert.equal(await page.evaluate(()=>recoCalls),4,'one refresh makes at most two searches');
        await page.waitForFunction(()=>document.querySelector('.um-recommendations')?.getAttribute('aria-busy')==='false');await page.locator('.um-recommendations .um-feature').first().click();assert.match(await page.locator('.um-playlist-songs').innerText(),/推荐/,'recommendation opens an actual playable track list');await page.getByRole('button',{name:'关闭',exact:true}).click();
        const recommendationsBefore=await page.locator('.um-recommendations .um-feature-title').allTextContents();
        await page.evaluate(()=>{recoNow+=11000;recoFail=true;});await page.getByRole('button',{name:'换一批推荐',exact:true}).click();
        assert.match(await page.locator('.um-recommendation-status').innerText(),/推荐测试网络故障/);assert.deepEqual(await page.locator('.um-recommendations .um-feature-title').allTextContents(),recommendationsBefore,'failed refresh keeps last usable recommendations');
        await page.evaluate(()=>{recoNow+=11000;recoFail=false;recoHold=true;});
        await page.getByRole('button',{name:'换一批推荐',exact:true}).click({noWaitAfter:true});
        await page.waitForFunction(()=>!!recoResolve);
        await page.evaluate(async()=>{await UvUMusic.saveSettings({endpoint:'',publicSources:[]});recoHold=false;recoResolve();});
        await page.waitForFunction(()=>document.querySelector('.um-recommendations')?.getAttribute('aria-busy')==='false');
        assert.ok(!(await page.locator('.um-recommendations').innerText()).includes('音乐源精选'),'old source results are hidden after a settings change');
        await page.evaluate(()=>{UvUMusic.search=recoSearch;Date.now=recoClock;});
        await page.evaluate(async()=>{await UvUMusic.saveSettings({endpoint:'',publicSources:[]});UvUMusic.player.stop();db.musicLibrary={favorites:[],recent:[],queue:[],playlists:[],searches:[]};await saveData();});
        await page.locator('[data-um-tab=search]').click();await page.locator('[data-um-tab=home]').click();await page.getByRole('button',{name:'换一批推荐',exact:true}).click();
        assert.equal(await page.locator('.um-recommendations .um-feature').count(),0,'empty disconnected library invents no music');
        assert.match(await page.locator('.um-recommendations').innerText(),/搜索音乐/);
        await page.evaluate(async base=>{await UvUMusic.saveSettings({endpoint:base});db.musicLibrary={favorites:visualMusic,recent:visualMusic.slice(0,2),queue:[],playlists:[],searches:[]};await saveData();},base);
        for(const [width,height]of [[320,568],[390,420],[390,844],[768,1024]]){await page.setViewportSize({width,height});assert.ok(await page.locator('.um-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'recommendation home fits '+width);}
        await page.setViewportSize({width:390,height:844});
        assert.deepEqual(errors,[]);console.log('PASS recommendation requests, refresh, failures, source isolation and responsive home');
    } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
