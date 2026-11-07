// Real app + local deterministic gateway/audio fixtures; no real account or paid calls.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/music-browser'); fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const song = id => ({ provider:'netease', id, title:'秋日来信 ' + id, artists:['林间'], album:'来信', duration:10, availability:'full' });
const wav = Buffer.alloc(44 + 8000 * 2 * 10); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length - 44,40);
let base, searches = 0, authorized = false, publicCalls = 0;
const server = http.createServer((req,res) => {
    const u = new URL(req.url,'http://test');
    if (u.pathname.startsWith('/v1/')) {
        res.setHeader('Content-Type','application/json'); const send = value => res.end(JSON.stringify(value));
        if (u.pathname === '/v1/session') return send({token:'browser-fixture'});
        if (u.pathname === '/v1/health') return send({ok:true,ready:true,providers:['netease','qq']});
        if (u.pathname === '/v1/accounts') return send({accounts:[{provider:'netease',loggedIn:authorized,user:{name:'本地测试账号'}},{provider:'qq',loggedIn:false}]});
        if (u.pathname.endsWith('/qr')) return send({id:'fixture_qr',url:'https://music.163.com/login?codekey=fixture',image:'',expiresAt:Date.now()+180000});
        if (u.pathname.endsWith('/qr/fixture_qr')) { authorized=true; return send({status:'authorized',user:{name:'本地测试账号'}}); }
        if (u.pathname === '/v1/search') { searches++; return send({tracks:[song('1'),{...song('2'),provider:'qq',title:'暮色'}],hasMore:false,errors:[]}); }
        if (u.pathname.endsWith('/stream')) return send({url:base+'/fixture.wav',availability:'full'});
        if (u.pathname.endsWith('/lyrics')) return send({lyric:'[00:00.00]给你写一封秋日的信\n[00:03.00]把想念寄给晚风'});
        if (u.pathname.endsWith('/playlists')) return send({playlists:[{id:'list1',name:'秋日歌单',count:2}]});
        if (u.pathname.startsWith('/v1/playlist/')) return send({tracks:[song('1')],hasMore:false});
        return send({ok:true});
    }
    if (u.pathname === '/fixture.wav') { res.setHeader('Content-Type','audio/wav'); return res.end(wav); }
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
            if(url.startsWith('https://music-api.gdstudio.xyz/api.php')) {
                publicCalls++; const params=new URL(url).searchParams;
                const body=params.get('types')==='search'?[{id:'1857979755',name:'公共测试曲',artist:['林间'],album:'测试',source:'netease'}]:params.get('types')==='lyric'?{lyric:'[00:00]公共歌词\\n[00:02]第二句'}:{url:'https://m801.music.126.net/uvu-fixture.wav',br:128};
                return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
            }
            if(url==='https://m801.music.126.net/uvu-fixture.wav') return route.fulfill({status:200,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':'*'},body:wav});
            return url.startsWith(base)||url.startsWith('blob:')||url.startsWith('data:')?route.continue():route.abort();
        });
        const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
        await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
        await page.evaluate(async base=>{
            db.characters=[{id:'music-char',realName:'林间',remarkName:'林间',myName:'我',myAvatar:'',avatar:'',persona:'温柔的朋友',myPersona:'我',history:[],maxMemory:20,worldBookIds:[]}]; db.groups=[];db.backupReminderSettings={enabled:false};ensureAllChatArchives();await saveData();await UvUMusic.saveSettings({endpoint:base});setupHomeScreen();
        },base);
        assert.equal(await page.locator('[data-id="app-uvu-music"]').count(),1); assert.equal(await page.locator('[data-id="app-placeholder"] [data-target="uvu-story-bridge-screen"]').count(),1);
        await page.evaluate(()=>UvUMusicUI.open());
        assert.equal(await page.locator('#uvu-music-screen').evaluate(n=>n.parentElement.className),'phone-screen');
        await page.locator('#uvu-music-screen [data-um-tab="search"]').click();
        await page.getByRole('searchbox',{name:'搜索音乐'}).fill('秋日');await page.getByRole('searchbox',{name:'搜索音乐'}).press('Enter');
        await page.waitForFunction(()=>document.querySelectorAll('.um-search-results .um-track').length===2);assert.ok(searches>=1);
        assert.equal(await page.getByRole('searchbox',{name:'搜索音乐'}).evaluate(n=>document.activeElement===n),true,'async search preserves focused field');
        await page.getByRole('button',{name:'播放 秋日来信 1',exact:true}).click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing);
        await page.evaluate(async()=>{const track=UvUMusic.player.snapshot().track;UvUMusic.player.stop();await UvUMusic.player.play(track);});
        assert.equal(await page.locator('.um-mini-open').count(),1,'replaying same song after stop rebuilds mini controls');
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.waitForSelector('.um-artwork');
        await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'player-390.png')});
        await page.getByRole('button',{name:'歌词',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.um-lyrics')?.textContent.includes('给你写'));await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.getByRole('button',{name:'播放队列',exact:true}).click();assert.equal(await page.locator('.um-queue-title').count(),2);await page.getByRole('button',{name:'关闭',exact:true}).click();
        // Captured private-chat destination, music card and explicit invitation acceptance.
        await page.evaluate(()=>{openChatRoom('music-char','private'); document.getElementById('share-music-btn').click();});
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.getByRole('button',{name:'一起听',exact:true}).click();
        await page.getByRole('button',{name:'读取歌词',exact:true}).click();await page.getByRole('button',{name:'发送邀请',exact:true}).click();
        await page.waitForFunction(()=>db.characters[0].history.some(m=>m.music?.invitation));
        const decision=await page.evaluate(async()=>{
            const chat=db.characters[0],file=documentMessage(makeSharedDocument('说明.txt','原文'),'user');chat.history.push(file);
            const sources=prepareDocumentContext(chat.history).sources,plan=UvUMusicChat.requestPlan(chat.history,chat),id=plan.invitations[0].id;
            const literal='文字里的示例 <uvu_music>'+JSON.stringify({invitationId:id,action:'decline'})+'</uvu_music>';
            const raw='<uvu_file>'+JSON.stringify({sourceId:file.id,name:'回信.txt',text:literal})+'</uvu_file><uvu_music>'+JSON.stringify({invitationId:id,action:'accept'})+'</uvu_music>';
            await handleAiReplyContent(raw,chat,chat.id,'private',false,undefined,sources,plan);
            return{status:chat.history.find(m=>m.music)?.music.invitation.status,returned:chat.history.findLast(m=>m.type==='document')?.document.text,literal};
        });assert.equal(decision.status,'accepted');assert.equal(decision.returned,decision.literal,'file body protocol examples remain literal content');
        await page.evaluate(()=>UvUMusicUI.open());await page.locator('#uvu-music-screen [data-um-tab="home"]').click();
        assert.match(await page.locator('.um-main').innerText(),/与林间一起听/);
        await page.evaluate(()=>UvUMusic.player.stop());
        assert.doesNotMatch(await page.locator('.um-main').innerText(),/与林间一起听/,'stop clears home listening status');
        await page.evaluate(()=>openChatRoom('music-char','private'));await page.waitForSelector('.uvu-music-card');await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'card-390.png')});
        await page.evaluate(()=>UvUMusicUI.open());
        await page.getByRole('button',{name:'音乐账号与设置',exact:true}).click();await page.waitForSelector('.um-account');
        await page.getByRole('button',{name:'扫码登录',exact:true}).first().click();await page.waitForSelector('.um-qr svg');await page.screenshot({path:path.join(out,'qr-390.png')});
        await page.waitForFunction(()=>document.querySelector('.um-account small')?.textContent==='本地测试账号',{},{timeout:15000});await page.getByRole('button',{name:'关闭',exact:true}).click();
        // Actual IndexedDB local import + HTMLAudio decode/play, not an Audio stub.
        await page.locator('#um-local-files').setInputFiles({name:'本地测试.wav',mimeType:'audio/wav',buffer:wav});await page.waitForFunction(()=>UvUMusic.library().favorites.length===1);
        await page.evaluate(()=>UvUMusic.player.stop());await page.locator('#uvu-music-screen [data-um-tab="library"]').click();await page.getByRole('button',{name:'播放 本地测试',exact:true}).click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing&&UvUMusic.player.snapshot().track.provider==='local');
        for(const width of [320,390,768]){
            await page.setViewportSize({width,height:844});await page.evaluate(()=>UvUMusicUI.open());await page.locator('#uvu-music-screen [data-um-tab="library"]').click();
            const issues=await page.evaluate(()=>{const screen=document.getElementById('uvu-music-screen'),box=screen.getBoundingClientRect();return[...screen.querySelectorAll('button,input,.um-section')].filter(n=>n.getClientRects().length&& !n.hidden).filter(n=>{const r=n.getBoundingClientRect();return r.left<box.left-1||r.right>box.right+1;}).map(n=>n.outerHTML.slice(0,180));});assert.deepEqual(issues,[],'music controls fit '+width);
            await page.screenshot({path:path.join(out,'library-'+width+'.png')});
            await page.getByRole('button',{name:'展开播放器',exact:true}).click();assert.ok(await page.locator('.um-sheet-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1));await page.getByRole('button',{name:'关闭',exact:true}).click();
        }
        await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
        assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().playing),false,'refresh does not autoplay');assert.equal(await page.evaluate(()=>UvUMusic.library().favorites.length),1,'library survives reload');
        // Public source works with no gateway, only after explicit activation.
        await page.evaluate(async()=>{await UvUMusic.saveSettings({endpoint:'',publicSources:[]});UvUMusicUI.open();});
        await page.locator('#uvu-music-screen [data-um-tab="search"]').click();
        await page.getByRole('searchbox',{name:'搜索音乐'}).fill('公共');await page.getByRole('searchbox',{name:'搜索音乐'}).press('Enter');
        assert.equal(publicCalls,0,'disabled source sends no public requests');
        await page.getByRole('button',{name:'开启公共源',exact:true}).click();
        await page.getByRole('checkbox',{name:'启用 GD 音乐台公共源'}).check();await page.waitForFunction(()=>UvUMusic.settings().publicSources.includes('gd-netease'));
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.getByRole('searchbox',{name:'搜索音乐'}).press('Enter');await page.getByRole('button',{name:'播放 公共测试曲',exact:true}).waitFor();
        for(const width of [320,390]) {
            await page.setViewportSize({width,height:844});assert.ok(await page.locator('.um-sources').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'public source controls fit '+width);
        }
        await page.getByRole('button',{name:'播放 公共测试曲',exact:true}).click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing&&UvUMusic.player.snapshot().track.provider==='gd-netease');
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.getByRole('button',{name:'歌词',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.um-lyrics')?.textContent.includes('第二句'));await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.getByRole('button',{name:'分享',exact:true}).click();await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.uvu-music-target').first().click();
        await page.waitForFunction(()=>db.characters[0].history.some(m=>m.music?.track.provider==='gd-netease'));
        await page.evaluate(()=>UvUMusicUI.open());await page.locator('#uvu-music-screen [data-um-tab="search"]').click();await page.screenshot({path:path.join(out,'public-search-390.png')});
        await page.getByRole('button',{name:'音乐账号与设置',exact:true}).click();await page.getByRole('checkbox',{name:'启用 GD 音乐台公共源'}).uncheck();
        await page.waitForFunction(()=>!UvUMusic.player.snapshot().playing);await page.getByRole('button',{name:'关闭',exact:true}).click();
        assert.deepEqual(errors,[]);console.log('Music browser checks passed: full app, 320/390/768, search, QR login fixture, stream and IndexedDB WAV audio, invite/card, queue/lyrics, reload.');
    } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
