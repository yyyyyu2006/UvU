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
        await page.evaluate(()=>UvUMusicUI.accounts());
        assert.match(await page.locator('.um-sheet-body').innerText(),/音乐登录服务尚未部署/);
        assert.equal(await page.getByRole('button',{name:'扫码登录',exact:true}).count(),2);
        assert.equal(await page.getByRole('button',{name:'扫码登录',exact:true}).first().isDisabled(),true);
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.evaluate(async base=>{
            db.characters=[{id:'music-char',realName:'林间',remarkName:'林间',myName:'我',myAvatar:'',avatar:'',persona:'温柔的朋友',myPersona:'我',history:[],maxMemory:20,worldBookIds:[]}]; db.groups=[];db.backupReminderSettings={enabled:false};ensureAllChatArchives();await saveData();await UvUMusic.saveSettings({endpoint:base});setupHomeScreen();
        },base);
        assert.equal(await page.locator('[data-id="app-uvu-music"]').count(),1); assert.equal(await page.locator('[data-id="app-placeholder"] [data-target="uvu-story-bridge-screen"]').count(),1);
        assert.equal(await page.locator('[data-id="app-uvu-music"] img').getAttribute('src'),'assets/music/app-icon.png','music uses the user-provided default icon');
        assert.ok(await page.locator('[data-id="app-uvu-music"] img').evaluate(n=>n.complete&&n.naturalWidth>0),'default music icon loads');
        await page.evaluate(()=>UvUMusicUI.open());
        assert.deepEqual(await page.locator('#uvu-music-screen [data-um-tab]').allTextContents(),['主页','新发现','广播','资料库','搜索'],'approved five-tab navigation');
        assert.equal(await page.locator('.um-hero h1').evaluate(n=>getComputedStyle(n).fontSize),'34px');
        assert.equal(await page.locator('#uvu-music-screen').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 255, 255)','music has a white surface');
        assert.equal(await page.locator('[data-um-tab=search]').evaluate(n=>n.parentElement.className),'um-nav','all five tabs share the screenshot navigation pill');
        assert.equal(await page.locator('#uvu-music-screen').evaluate(n=>n.parentElement.className),'phone-screen');
        await page.locator('#uvu-music-screen [data-um-tab="search"]').click();
        await page.getByRole('searchbox',{name:'搜索音乐'}).fill('滚动');await page.getByRole('searchbox',{name:'搜索音乐'}).press('Enter');
        await page.waitForFunction(()=>document.querySelectorAll('.um-search-results .um-track').length===30);
        await page.locator('.um-main').evaluate(n=>n.scrollTop=300);
        await page.locator('#uvu-music-screen [data-um-tab="library"]').click();await page.locator('#uvu-music-screen [data-um-tab="search"]').click();
        assert.ok(await page.locator('.um-main').evaluate(n=>n.scrollTop>=290),'search scroll survives tab changes');
        await page.locator('.um-main').evaluate(n=>n.scrollTop=0);
        await page.getByRole('searchbox',{name:'搜索音乐'}).fill('秋日');await page.getByRole('searchbox',{name:'搜索音乐'}).press('Enter');
        await page.waitForFunction(()=>document.querySelectorAll('.um-search-results .um-track').length===2);assert.ok(searches>=1);
        assert.equal(await page.getByRole('searchbox',{name:'搜索音乐'}).evaluate(n=>document.activeElement===n),true,'async search preserves focused field');
        await page.getByRole('button',{name:'播放 秋日来信 1',exact:true}).click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing);
        await page.evaluate(async()=>{const track=UvUMusic.player.snapshot().track;UvUMusic.player.stop();await UvUMusic.player.play(track);});
        assert.equal(await page.locator('.um-mini-open').count(),1,'replaying same song after stop rebuilds mini controls');
        await page.locator('.um-home-title').click();assert.equal(await page.locator('#home-screen').evaluate(n=>n.classList.contains('active')),true,'title returns directly to phone desktop');assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().playing),true,'title navigation keeps audio playing');await page.evaluate(()=>UvUMusicUI.open());
        // Real HTMLAudio naturally emits pause before ended: prove automatic advance without synthetic events.
        await page.evaluate(async()=>{const a=UvUMusic.player.snapshot().track,b={...a,id:'2',title:'暮色',provider:'qq'};UvUMusic.player.setMode('order');await UvUMusic.player.play(a,[a,b],{label:'浏览器测试队列'});UvUMusic.player.seek(9.9);});
        await page.waitForFunction(()=>UvUMusic.player.snapshot().track?.id==='2'&&UvUMusic.player.snapshot().playing);
        await page.evaluate(()=>{UvUMusic.player.setMode('list');UvUMusic.player.seek(9.9);});
        await page.waitForFunction(()=>UvUMusic.player.snapshot().track?.id==='1'&&UvUMusic.player.snapshot().playing);
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.waitForSelector('.um-artwork');
        await page.getByRole('button',{name:'更多播放选项',exact:true}).click();await page.getByRole('button',{name:'列表循环',exact:true}).click();await page.getByRole('button',{name:'单曲循环',exact:true}).click();
        assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().mode),'one');
        await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'player-390.png')});
        await page.getByRole('button',{name:'歌词',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.um-lyrics')?.textContent.includes('给你写'));
        assert.match(await page.locator('.um-lyrics-sheet [aria-label="下一首"] img').getAttribute('src'),/skip-forward\.svg$/,'next-track uses a skip icon');
        assert.doesNotMatch(await page.locator('.um-lyrics').innerText(),/\[\d{1,3}:\d{2}/,'lyric timestamps stay out of the reading card');
        assert.equal(await page.locator('.um-lyrics').evaluate(n=>getComputedStyle(n).textAlign),'center');
        for (const width of [320,390,768]) {
            await page.setViewportSize({width,height:844});
            assert.ok(await page.locator('.um-lyrics-line').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).fontSize==='14px')),'all lyric lines stay 14px at '+width);
            assert.ok(await page.locator('.um-lyrics-sheet .um-sheet-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'lyrics fit at '+width);
        }
        for (const height of [480,420,320]) {
            await page.setViewportSize({width:390,height});
            assert.equal(await page.locator('.um-lyrics-body').evaluate(n=>getComputedStyle(n).overflowY),'auto','short lyric sheet can scroll by touch');
            await page.locator('.um-lyrics-sheet .um-player-tools').scrollIntoViewIfNeeded();
            assert.ok(await page.locator('.um-lyrics-sheet .um-player-tools').evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight),'lyric transport remains reachable at height '+height);
            assert.ok(await page.locator('.um-lyrics-sheet .um-lyrics').evaluate(n=>n.clientHeight>=40),'lyrics retain an internally scrollable reading region at height '+height);
        }
        await page.setViewportSize({width:390,height:844});
        await page.waitForTimeout(600);await page.screenshot({path:path.join(out,'lyrics-white-390.png')});
        await page.locator('.um-lyrics-sheet').getByRole('button',{name:'下一首',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.um-lyrics-heading strong')?.textContent===UvUMusic.player.snapshot().track?.title);
        assert.equal(await page.locator('.um-lyrics-sheet').count(),1,'switching tracks replaces the lyric sheet without duplicate subscriptions');
        assert.equal(await page.locator('.um-lyrics-line').first().evaluate(n=>getComputedStyle(n).fontSize),'14px');
        await page.locator('.um-lyrics-sheet').getByRole('button',{name:'上一首',exact:true}).click();
        await page.waitForFunction(()=>UvUMusic.player.snapshot().track?.id==='1'&&document.querySelector('.um-lyrics-heading strong')?.textContent===UvUMusic.player.snapshot().track?.title);
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.getByRole('button',{name:'播放队列',exact:true}).click();assert.equal(await page.locator('.um-queue-title').count(),2);await page.getByRole('button',{name:'关闭',exact:true}).click();
        // Captured private-chat destination, music card and explicit invitation acceptance.
        await page.evaluate(()=>{openChatRoom('music-char','private'); document.getElementById('share-music-btn').click();});
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.getByRole('button',{name:'一起听',exact:true}).click();
        await page.evaluate(()=>{window.originalMusicLyrics=UvUMusic.lyrics;UvUMusic.lyrics=async()=>{throw Error('公共音乐源连接失败，请检查网络或切换账号源');};});
        await page.getByRole('button',{name:'读取歌词',exact:true}).click();
        await page.getByText('歌词读取失败，可重试或直接发送邀请',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'重试读取歌词',exact:true}).isEnabled(),true);
        assert.equal(await page.getByRole('button',{name:'发送邀请',exact:true}).isEnabled(),true,'lyric failure never blocks invitation');
        await page.getByRole('textbox',{name:'分享歌词片段',exact:true}).fill('手动填写的歌词');
        await page.evaluate(()=>{UvUMusic.lyrics=()=>new Promise(resolve=>window.resolveShareLyrics=resolve);});
        await page.getByRole('button',{name:'重试读取歌词',exact:true}).click();
        await page.getByRole('textbox',{name:'分享歌词片段',exact:true}).fill('读取时仍可编辑');
        await page.evaluate(()=>window.resolveShareLyrics({lyric:'[00:00]返回的歌词'}));
        await page.getByText('已保留手动填写的歌词',{exact:true}).waitFor();
        assert.equal(await page.getByRole('textbox',{name:'分享歌词片段',exact:true}).inputValue(),'读取时仍可编辑');
        await page.evaluate(()=>{UvUMusic.lyrics=window.originalMusicLyrics;delete window.originalMusicLyrics;delete window.resolveShareLyrics;});
        await page.getByRole('button',{name:'读取歌词',exact:true}).click();await page.getByRole('button',{name:'发送邀请',exact:true}).click();
        await page.waitForFunction(()=>db.characters[0].history.some(m=>m.music?.invitation));
        assert.equal(await page.locator('.uvu-music-card .uvu-music-transport button').count(),5,'shared music has five compact transport controls');
        assert.equal(await page.locator('.uvu-music-card input[aria-label="歌曲播放进度"]').count(),1);
        assert.equal(await page.evaluate(()=>{const source=db.characters[0].history.find(m=>m.music),message={...source,music:{version:1,track:source.music.track}};return UvUMusicChat.createElement(message,db.characters[0]).querySelector('.uvu-music-continuous').hidden;}),true,'ordinary shares do not expose invitation controls');
        const decision=await page.evaluate(async()=>{
            const chat=db.characters[0],file=documentMessage(makeSharedDocument('说明.txt','原文'),'user');chat.history.push(file);
            const sources=prepareDocumentContext(chat.history).sources,plan=UvUMusicChat.requestPlan(chat.history,chat),id=plan.invitations[0].id;
            const literal='文字里的示例 <uvu_music>'+JSON.stringify({invitationId:id,action:'decline'})+'</uvu_music>';
            const raw='<uvu_file>'+JSON.stringify({sourceId:file.id,name:'回信.txt',text:literal})+'</uvu_file><uvu_music>'+JSON.stringify({invitationId:id,action:'accept'})+'</uvu_music>';
            const originalPlay=UvUMusic.player.play;UvUMusic.player.play=async()=>false;
            try{await handleAiReplyContent(raw,chat,chat.id,'private',false,undefined,sources,plan);}finally{UvUMusic.player.play=originalPlay;}
            return{status:chat.history.find(m=>m.music)?.music.invitation.status,returned:chat.history.findLast(m=>m.type==='document')?.document.text,literal};
        });assert.equal(decision.status,'accepted');assert.equal(decision.returned,decision.literal,'file body protocol examples remain literal content');
        assert.equal(await page.evaluate(()=>UvUMusicChat.session()),null,'initial playback failure leaves no active together session');
        await page.locator('.uvu-music-card .uvu-music-main-play').click();await page.waitForTimeout(200);
        assert.ok(await page.evaluate(()=>UvUMusicChat.session()),'accepted invitation retry recreates its together session');
        await page.waitForSelector('.um-together-float:not([hidden])');
        assert.match(await page.locator('.um-together-float').innerText(),/一起听/);
        const togetherVisible = async label => {
            const view=await page.locator('.um-together-float').evaluate(bar=>{const r=bar.getBoundingClientRect(),at=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{hidden:bar.hidden,inViewport:r.width>0&&r.top>=0&&r.bottom<=innerHeight,onTop:!!at&&bar.contains(at)};});
            assert.deepEqual(view,{hidden:false,inViewport:true,onTop:true},label);
        };
        const togetherId=await page.evaluate(()=>UvUMusicChat.session().id);
        await page.locator('.um-together-float [aria-label="打开一起听播放器"]').click();await page.waitForSelector('.um-player-sheet');
        await page.locator('.um-player-sheet [aria-label="下一首"]').click();await page.waitForFunction(()=>UvUMusic.player.snapshot().track?.id==='2'&&UvUMusic.player.snapshot().playing);
        await togetherVisible('changing songs in the full player keeps the room visible and reachable');
        for(const width of [320,390,768]){
            await page.setViewportSize({width,height:844});await togetherVisible('together controls remain reachable in player at '+width);
            assert.ok(await page.locator('.um-player-sheet').evaluate(sheet=>sheet.querySelector('.um-sheet-body').getBoundingClientRect().top>=sheet.querySelector('.um-together-float').getBoundingClientRect().bottom-1),'indicator does not cover the player contents');
        }
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'together-player-390.png')});
        assert.equal(await page.evaluate(()=>UvUMusicChat.session().id),togetherId);
        assert.match(await page.locator('.um-together-float').innerText(),/已暂停/,'single-song room does not attribute unrelated playback to char');
        await page.locator('.um-together-float [aria-label="继续一起听"]').click();await page.waitForFunction(()=>UvUMusic.player.snapshot().track?.id==='1'&&UvUMusic.player.snapshot().playing);
        await page.locator('.um-player-sheet [aria-label="播放队列"]').click();await page.waitForSelector('[role="dialog"][aria-label="播放队列"]');
        await togetherVisible('replacing a music sheet preserves the same together controls');
        await page.getByRole('button',{name:'关闭',exact:true}).click();await togetherVisible('closing a sheet returns the float to the phone');
        assert.equal(await page.locator('.um-together-float').evaluate(n=>n.parentElement.classList.contains('phone-screen')),true);
        assert.equal(await page.locator('.um-together-open').evaluate(n=>document.activeElement===n),true,'closing the music sheet restores focus to the together opener');
        await page.locator('.uvu-music-continuous').click();assert.equal(await page.evaluate(()=>UvUMusicChat.session().continuous),true);
        await page.evaluate(()=>UvUMusic.player.next());await page.waitForFunction(()=>UvUMusicChat.session()?.track.id==='2');
        await togetherVisible('manual next keeps continuous room visible');
        assert.equal(await page.locator('.uvu-music-title').first().innerText(),'秋日来信 1','historical card keeps the invited song');
        await page.evaluate(()=>UvUMusic.player.previous());await page.waitForFunction(()=>UvUMusicChat.session()?.track.id==='1');
        await page.evaluate(()=>{UvUMusic.player.setMode('list');UvUMusic.player.seek(9.9);});
        await page.waitForFunction(()=>UvUMusicChat.session()?.track.id==='2'&&UvUMusicChat.session()?.localPlayback);
        await togetherVisible('native ended advances songs without hiding the float');
        await page.evaluate(()=>UvUMusic.player.previous());await page.waitForFunction(()=>UvUMusicChat.session()?.track.id==='1');
        await page.locator('.uvu-music-continuous').click();
        await page.waitForTimeout(650);await page.screenshot({path:path.join(out,'together-white-390.png')});
        for(const width of [320,390]) { await page.setViewportSize({width,height:844});assert.ok(await page.locator('.um-together-float').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'together indicator fits '+width);assert.ok(await page.locator('.uvu-music-card').first().evaluate(n=>n.scrollWidth<=n.clientWidth+1),'music card fits '+width); }
        assert.ok(await page.locator('.um-together-float').evaluate(n=>n.getBoundingClientRect().top>=document.getElementById('chat-room-header-default').getBoundingClientRect().bottom-1),'together indicator stays below original header');
        await page.locator('.um-together-float [aria-label="暂停一起听"]').click();
        await page.waitForFunction(()=>!UvUMusic.player.snapshot().playing);
        assert.match(await page.locator('.um-together-float').innerText(),/已暂停/);
        await page.locator('.um-together-float [aria-label="继续一起听"]').click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing);
        await page.locator('.um-together-float [aria-label="打开一起听播放器"]').click();await page.waitForSelector('.um-artwork');await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.evaluate(()=>{currentChatId='different-char';document.getElementById('chat-room-title').textContent='别的角色';});
        await page.waitForSelector('.um-together-float:not([hidden])');
        await page.evaluate(()=>switchScreen('home-screen'));await page.waitForSelector('.um-together-float:not([hidden])');
        assert.ok(await page.locator('.um-together-float').evaluate(n=>n.parentElement.classList.contains('phone-screen')),'float survives navigation outside chat');
        await page.evaluate(()=>openChatRoom('music-char','private'));await page.waitForSelector('.um-together-float:not([hidden])');
        await page.evaluate(()=>document.getElementById('chat-room-screen').classList.add('multi-select-active'));await page.waitForSelector('.um-together-float:not([hidden])');
        await page.evaluate(()=>document.getElementById('chat-room-screen').classList.remove('multi-select-active'));await page.waitForSelector('.um-together-float:not([hidden])');
        await page.locator('.um-together-float [aria-label="暂停一起听"]').click();
        await page.evaluate(()=>{window.musicTestArchive=db.characters[0].activeArchiveId;db.characters[0].activeArchiveId='other-archive';document.getElementById('chat-room-title').textContent='其他存档';});
        await page.waitForFunction(()=>document.querySelector('.um-together-float').hidden);
        await page.evaluate(async()=>{const chat=db.characters[0];chat.activeArchiveId=window.musicTestArchive;const message=chat.history.find(m=>m.music?.invitation);await UvUMusicChat.listen(message.music.track,{chat,message});});
        await page.waitForSelector('.um-together-float:not([hidden])');
        await page.evaluate(()=>UvUMusicUI.open());await page.locator('#uvu-music-screen [data-um-tab="home"]').click();
        assert.match(await page.locator('.um-main').innerText(),/与林间一起听/);
        const beforeMenu = await page.evaluate(()=>UvUMusic.player.snapshot().track.id);
        assert.ok(await page.locator('.um-artwork-shelf [aria-label="更多 · 秋日来信 1"]').count(),'recent artwork keeps its song menu');
        await page.locator('.um-artwork-shelf [aria-label="更多 · 秋日来信 1"]').click();
        await page.getByRole('button',{name:'播放下一首',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().track.id),beforeMenu,'opening a recent-song menu does not replace playback');
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'home-white-390.png')});
        await page.evaluate(()=>openChatRoom('music-char','private'));await page.waitForSelector('.um-together-float:not([hidden])');
        await page.locator('.um-together-float [aria-label="结束一起听"]').click();await page.waitForFunction(()=>document.querySelector('.um-together-float').hidden);
        assert.equal(await page.evaluate(()=>db.characters[0].history.find(m=>m.music?.invitation).music.invitation.status),'ended','indicator end saves the existing invitation state');
        await page.evaluate(()=>UvUMusicUI.open());
        await page.evaluate(()=>UvUMusic.player.stop());
        assert.doesNotMatch(await page.locator('.um-main').innerText(),/与林间一起听/,'stop clears home listening status');
        await page.evaluate(()=>openChatRoom('music-char','private'));await page.waitForSelector('.uvu-music-card');await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'card-390.png')});
        await page.evaluate(()=>UvUMusicUI.open());
        await page.getByRole('button',{name:'音乐账号与设置',exact:true}).click();await page.waitForSelector('.um-account');
        await page.getByRole('button',{name:'扫码登录',exact:true}).first().click();await page.waitForSelector('.um-qr svg');await page.screenshot({path:path.join(out,'qr-390.png')});
        await page.waitForFunction(()=>document.querySelector('.um-account small')?.textContent==='本地测试账号',{},{timeout:15000});await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.getByRole('button',{name:'音乐账号与设置',exact:true}).click();
        await page.getByRole('button',{name:'扫码登录',exact:true}).last().click();
        await page.waitForSelector('.um-qr svg');
        assert.match(await page.locator('.um-sheet-body').innerText(),/QQ App/,'QQ Music account QR must be scanned with QQ');
        assert.doesNotMatch(await page.locator('.um-sheet-body').innerText(),/请用QQ 音乐官方 App/);
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        // Paste, preview and commit a platform playlist without touching playback or chat history.
        await page.locator('#uvu-music-screen [data-um-tab="library"]').click();await page.getByRole('button',{name:'播放列表',exact:true}).click();
        await page.getByRole('button',{name:'导入歌单',exact:true}).click();
        await page.getByRole('textbox',{name:'歌单链接',exact:true}).fill('https://music.163.com/#/playlist?id=123');
        await page.getByRole('button',{name:'预览歌单',exact:true}).click();await page.waitForSelector('.um-import-preview .um-track');
        assert.equal(await page.locator('.um-import-preview .um-track').count(),3,'preview combines pages and removes duplicate tracks');
        assert.equal(await page.evaluate(()=>UvUMusic.library().playlists.length),0,'preview is not a saved playlist');
        for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.um-sheet-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'import sheet fits '+width);}
        await page.setViewportSize({width:390,height:844});await page.getByRole('textbox',{name:'歌单名称',exact:true}).fill('链接导入测试');await page.screenshot({path:path.join(out,'playlist-import-390.png')});
        await page.getByRole('button',{name:'保存歌单',exact:true}).click();await page.waitForFunction(()=>UvUMusic.library().playlists.some(p=>p.name==='链接导入测试'&&p.tracks.length===3));
        assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().playing),false,'import never starts audio');
        // Imported platform identities stay intact while the global preference routes audio/lyrics publicly.
        await page.locator('.um-playlist').filter({hasText:'链接导入测试'}).click();
        await page.getByRole('checkbox',{name:'公共源播放',exact:true}).check();
        await page.waitForFunction(()=>UvUMusic.settings().playbackSource==='public');
        for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.um-sheet-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'public playback row fits '+width);}
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'playlist-public-390.png')});
        const accountBeforePublic=accountStreams;
        await page.getByRole('button',{name:'播放 秋日来信 1',exact:true}).click();
        await page.waitForFunction(()=>UvUMusic.player.snapshot().playing&&UvUMusic.player.snapshot().track.provider==='netease');
        assert.equal(accountStreams,accountBeforePublic,'imported NetEase songs bypass account stream');
        assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().track.id),'1');
        assert.match(await page.evaluate(async()=> (await UvUMusic.lyrics(UvUMusic.player.snapshot().track)).lyric),/公共歌词/);
        await page.getByRole('checkbox',{name:'公共源播放',exact:true}).uncheck();await page.waitForFunction(()=>!UvUMusic.player.snapshot().playing);
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.getByRole('button',{name:'导入歌单',exact:true}).click();await page.getByRole('combobox',{name:'音乐平台',exact:true}).selectOption('qq');await page.getByRole('textbox',{name:'歌单链接',exact:true}).fill('456');
        await page.getByRole('button',{name:'预览歌单',exact:true}).click();await page.waitForSelector('.um-import-preview .um-track');await page.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await page.evaluate(()=>UvUMusic.library().playlists.length),1,'closing a QQ preview saves nothing');
        // Existing account playlists use the same preview and atomic import flow.
        await page.getByRole('button',{name:'音乐账号与设置',exact:true}).click();await page.getByRole('button',{name:'歌单',exact:true}).click();await page.getByRole('button',{name:'秋日歌单',exact:true}).click();
        await page.getByRole('button',{name:'导入到资料库',exact:true}).click();await page.waitForSelector('.um-import-preview .um-track');assert.equal(await page.getByRole('textbox',{name:'歌单名称',exact:true}).inputValue(),'秋日歌单');await page.getByRole('button',{name:'保存歌单',exact:true}).click();
        await page.waitForFunction(()=>UvUMusic.library().playlists.length===2);
        await page.evaluate(async()=>{const draft=await UvUMusic.previewPlaylist('456','qq');await UvUMusic.importPlaylist({...draft,name:'QQ 公共播放测试'});UvUMusicUI.open();});
        await page.locator('#uvu-music-screen [data-um-tab="library"]').click();await page.getByRole('button',{name:'播放列表',exact:true}).click();
        await page.locator('.um-playlist').filter({hasText:'QQ 公共播放测试'}).click();await page.getByRole('checkbox',{name:'公共源播放',exact:true}).check();
        await page.waitForFunction(()=>UvUMusic.settings().playbackSource==='public');
        const beforeQQPublic=accountStreams;
        await page.getByRole('button',{name:'播放 秋日来信 1',exact:true}).click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing&&UvUMusic.player.snapshot().track.provider==='qq');
        assert.equal(accountStreams,beforeQQPublic,'QQ matches a public recording without account playback');
        assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().track.id),'1','QQ identity is retained');
        await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
        assert.equal(await page.evaluate(()=>UvUMusic.settings().playbackSource),'public','public playback preference survives reload');
        await page.evaluate(()=>UvUMusicUI.accounts());assert.equal(await page.getByRole('checkbox',{name:'公共源播放',exact:true}).isChecked(),true);
        await page.getByRole('checkbox',{name:'启用 GD 音乐台公共源'}).uncheck();await page.waitForFunction(()=>UvUMusic.settings().playbackSource!=='public');
        assert.equal(await page.getByRole('checkbox',{name:'公共源播放',exact:true}).isChecked(),false);
        await page.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>UvUMusicUI.open());
        // Actual IndexedDB local import + HTMLAudio decode/play, not an Audio stub.
        await page.locator('#um-local-files').setInputFiles({name:'本地测试.wav',mimeType:'audio/wav',buffer:wav});await page.waitForFunction(()=>UvUMusic.library().favorites.length===1);
        await page.getByRole('dialog',{name:'导入音乐',exact:true}).getByRole('status').filter({hasText:'导入完成'}).waitFor();
        await page.getByRole('dialog',{name:'导入音乐',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
        await page.evaluate(()=>UvUMusic.player.stop());await page.locator('#uvu-music-screen [data-um-tab="library"]').click();await page.getByRole('button',{name:'歌曲',exact:true}).click();await page.getByRole('button',{name:'播放 本地测试',exact:true}).click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing&&UvUMusic.player.snapshot().track.provider==='local');
        await page.evaluate(async()=>{const list=await UvUMusic.addPlaylist('晚风与来信');await UvUMusic.addToPlaylist(list.id,UvUMusic.library().favorites[0]);UvUMusicUI.open();});
        await page.getByRole('button',{name:'更多 · 本地测试',exact:true}).click();await page.getByRole('button',{name:'编辑歌曲资料',exact:true}).click();
        await page.getByRole('textbox',{name:'歌名',exact:true}).fill('本地新歌名');await page.getByRole('textbox',{name:'歌手',exact:true}).fill('测试歌手');await page.getByRole('textbox',{name:'封面链接',exact:true}).fill(base+'/assets/music/icons/heart.svg');await page.getByRole('button',{name:'保存',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.um-mini-open strong')?.textContent==='本地新歌名');assert.match(await page.locator('.um-mini-open .um-cover').getAttribute('src'),/heart\.svg$/,'same-track metadata cover updates mini player');
        await page.evaluate(async()=>{const list=await UvUMusic.addPlaylist('管理测试');window.managedMusicList=list.id;await UvUMusic.addToPlaylist(list.id,UvUMusic.library().favorites[0]);await UvUMusic.addToPlaylist(list.id,{provider:'netease',id:'1',title:'秋日来信 1',artists:['林间']});UvUMusicUI.open();});
        await page.locator('#uvu-music-screen [data-um-tab="library"]').click();await page.getByRole('button',{name:'播放列表',exact:true}).click();await page.locator('.um-playlist').filter({hasText:'管理测试'}).click();
        const beforeRename = await page.evaluate(() => ({ tracks: UvUMusic.library().playlists.find(p=>p.id===window.managedMusicList).tracks, state: UvUMusic.player.snapshot() }));
        await page.getByRole('button',{name:'歌单选项',exact:true}).click();
        await page.getByRole('button',{name:'修改歌单名称',exact:true}).click();
        const playlistName=page.getByRole('textbox',{name:'歌单名称',exact:true});
        assert.equal(await playlistName.inputValue(),'管理测试','rename starts with current name');
        assert.equal(await playlistName.evaluate(n=>document.activeElement===n),true,'rename input receives focus');
        assert.equal(await playlistName.getAttribute('maxlength'),'160');
        await playlistName.fill('   ');await page.getByRole('button',{name:'保存',exact:true}).click();
        assert.equal(await playlistName.evaluate(n=>n.checkValidity()),false,'blank name is rejected');
        assert.equal(await page.evaluate(()=>UvUMusic.library().playlists.find(p=>p.id===window.managedMusicList).name),'管理测试');
        await page.getByRole('button',{name:'取消',exact:true}).click();
        assert.equal(await page.locator('.um-collection-name h1').innerText(),'管理测试','cancel returns to unchanged playlist');
        await page.getByRole('button',{name:'歌单选项',exact:true}).click();await page.getByRole('button',{name:'修改歌单名称',exact:true}).click();
        await playlistName.fill('  晚风歌单  ');
        await page.setViewportSize({width:320,height:568});
        assert.ok(await page.locator('.um-sheet-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'rename fits narrow screen');
        await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
        assert.ok(await page.getByRole('button',{name:'保存',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'save remains clickable above music controls');
        await page.screenshot({path:path.join(out,'playlist-rename-320.png')});
        await page.setViewportSize({width:390,height:844});await playlistName.press('Enter');
        await page.waitForFunction(()=>document.querySelector('.um-collection-name h1')?.textContent==='晚风歌单');
        assert.equal(await page.locator('.um-playlist').filter({hasText:'晚风歌单'}).count(),1,'library title updates immediately');
        const afterRename=await page.evaluate(()=>({tracks:UvUMusic.library().playlists.find(p=>p.id===window.managedMusicList).tracks,state:UvUMusic.player.snapshot()}));
        assert.deepEqual(afterRename.tracks,beforeRename.tracks,'rename preserves songs and order');
        assert.deepEqual(afterRename.state.queue,beforeRename.state.queue,'rename preserves play queue');
        assert.equal(afterRename.state.track.id,beforeRename.state.track.id,'rename preserves current song');
        assert.equal(afterRename.state.playing,beforeRename.state.playing,'rename does not interrupt playback');
        await page.getByRole('button',{name:'歌单选项',exact:true}).click();await page.getByRole('button',{name:'修改歌单名称',exact:true}).click();
        await page.evaluate(()=>{window.originalPlaylistRename=UvUMusic.renamePlaylist;UvUMusic.renamePlaylist=async()=>{throw Error('模拟保存失败');};});
        await playlistName.fill('不应保存');await page.getByRole('button',{name:'保存',exact:true}).click();
        assert.equal(await playlistName.inputValue(),'不应保存','failed save keeps draft for retry');
        assert.equal(await page.evaluate(()=>UvUMusic.library().playlists.find(p=>p.id===window.managedMusicList).name),'晚风歌单','failed save preserves stored name');
        await page.evaluate(()=>{UvUMusic.renamePlaylist=window.originalPlaylistRename;delete window.originalPlaylistRename;});
        await page.getByRole('button',{name:'取消修改',exact:true}).click();
        await page.getByRole('button',{name:'歌单选项',exact:true}).click();await page.getByRole('button',{name:'管理歌曲',exact:true}).click();await page.getByRole('button',{name:'上移 秋日来信 1',exact:true}).click();
        for(const label of ['全选','移除所选','重命名','删除歌单'])assert.ok(await page.getByRole('button',{name:label,exact:true}).evaluate(n=>{const s=getComputedStyle(n);return s.color!==s.backgroundColor;}),'readable collection action '+label);
        await page.waitForFunction(()=>UvUMusic.library().playlists.find(p=>p.id===window.managedMusicList).tracks[0].id==='1');
        await page.getByRole('button',{name:'全选',exact:true}).click();assert.equal(await page.locator('.um-sheet-body input:checked').count(),2);await page.getByRole('button',{name:'移除所选',exact:true}).click();
        await page.waitForFunction(()=>UvUMusic.library().playlists.find(p=>p.id===window.managedMusicList).tracks.length===0);await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByRole('textbox',{name:'歌单名称',exact:true}).fill('新的歌单名称');await page.getByRole('button',{name:'保存',exact:true}).click();
        await page.waitForFunction(()=>UvUMusic.library().playlists.some(p=>p.name==='新的歌单名称'));
        await page.waitForFunction(()=>document.querySelector('.um-collection-name h1')?.textContent==='新的歌单名称');
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        for(const width of [320,390,768]){
            await page.setViewportSize({width,height:844});await page.evaluate(()=>UvUMusicUI.open());await page.locator('#uvu-music-screen [data-um-tab="library"]').click();
            const issues=await page.evaluate(()=>{const screen=document.getElementById('uvu-music-screen'),box=screen.getBoundingClientRect();return[...screen.querySelectorAll('button,input,.um-section')].filter(n=>n.getClientRects().length&& !n.hidden).filter(n=>{const r=n.getBoundingClientRect();return r.left<box.left-1||r.right>box.right+1;}).map(n=>n.outerHTML.slice(0,180));});assert.deepEqual(issues,[],'music controls fit '+width);
            await page.screenshot({path:path.join(out,'library-'+width+'.png')});
            await page.getByRole('button',{name:'展开播放器',exact:true}).click();assert.ok(await page.locator('.um-sheet-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1));await page.getByRole('button',{name:'关闭',exact:true}).click();
        }
        await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
        assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().playing),false,'refresh does not autoplay');assert.equal(await page.evaluate(()=>UvUMusic.library().favorites.length),1,'library survives reload');
        assert.equal(await page.evaluate(()=>UvUMusic.library().playlists.find(p=>p.name==='链接导入测试')?.tracks.length),3,'imported playlist survives reload');
        assert.equal(await page.evaluate(()=>UvUMusic.library().playlists.filter(p=>p.name==='新的歌单名称').length),1,'renamed playlist survives reload');
        // Public source works with no gateway, only after explicit activation.
        await page.evaluate(async()=>{await UvUMusic.saveSettings({endpoint:'',publicSources:[]});UvUMusicUI.open();});
        const beforeDisabledPublic=publicCalls;
        await page.locator('#uvu-music-screen [data-um-tab="search"]').click();
        await page.getByRole('searchbox',{name:'搜索音乐'}).fill('公共');await page.getByRole('searchbox',{name:'搜索音乐'}).press('Enter');
        assert.equal(publicCalls,beforeDisabledPublic,'disabled source sends no public requests');
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
        await page.getByRole('button',{name:'展开播放器',exact:true}).click();await page.getByRole('button',{name:'更多播放选项',exact:true}).click();await page.getByRole('button',{name:'分享',exact:true}).click();await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.uvu-music-target').first().click();
        await page.waitForFunction(()=>db.characters[0].history.some(m=>m.music?.track.provider==='gd-netease'));
        await page.evaluate(()=>openChatRoom('music-char','private'));
        assert.equal(await page.locator('.uvu-music-card').last().locator('.uvu-music-continuous').evaluate(n=>n.hidden),true,'ordinary shares never display a continuous invitation control');
        await page.evaluate(()=>UvUMusicUI.open());await page.locator('#uvu-music-screen [data-um-tab="search"]').click();await page.screenshot({path:path.join(out,'public-search-390.png')});
        await page.getByRole('button',{name:'音乐账号与设置',exact:true}).click();await page.getByRole('checkbox',{name:'启用 GD 音乐台公共源'}).uncheck();
        await page.waitForFunction(()=>!UvUMusic.player.snapshot().playing);await page.getByRole('button',{name:'关闭',exact:true}).click();
        // Approved page geometry and real collection actions, with fixture artwork only.
        await page.setViewportSize({width:390,height:844});
        await page.evaluate(async base=>{
            await UvUMusic.saveSettings({endpoint:base});
            const titles=['暮色来信','沿着海岸','透明的雨','日落之前','夜间航线','微光','与风同行'];
            const songs=titles.map((title,i)=>UvUMusic.normalizeTrack({provider:'netease',id:String(i+10),title,artists:[['林间','晚风','小岛'][i%3]],album:title,cover:base+'/fixture-cover.svg?i='+i,duration:10}));
            for(const track of songs)await UvUMusic.toggleFavorite(track);
            const p=await UvUMusic.addPlaylist('把旋律留在今天');for(const track of songs)await UvUMusic.addToPlaylist(p.id,track);
            window.visualMusic=songs;await UvUMusic.player.play(songs[0],songs);UvUMusicUI.open();
        },base);
        await page.addStyleTag({content:'#toast-notification { visibility:hidden!important; }'}); // Keep transient fixture messages out of visual captures.
        for(const id of ['home','discover','radio','library','search']){
            await page.locator('[data-um-tab="'+id+'"]').click();await page.locator('.um-main').evaluate(n=>n.scrollTop=0);
            if(id==='search'){await page.getByRole('searchbox',{name:'搜索音乐'}).fill('');await page.getByRole('searchbox',{name:'搜索音乐'}).press('Enter');}
            await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'approved-'+id+'-390.png')});
        }
        await page.locator('[data-um-tab="library"]').click();
        assert.deepEqual(await page.locator('.um-library-link').allTextContents(),['播放列表','角色歌单','艺人','专辑','歌曲','本地音乐'],'category labels appear once');
        await page.getByRole('button',{name:'艺人',exact:true}).click();await page.getByRole('button',{name:'林间',exact:true}).click();
        assert.ok(await page.locator('.um-playlist-songs .um-track').count()>=2,'artist drilldown contains actual tracks');await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.locator('[data-um-tab="library"]').click();await page.getByRole('button',{name:'播放列表',exact:true}).click();await page.getByRole('button',{name:'喜爱歌曲',exact:true}).click();
        await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'approved-playlist-390.png')});
        assert.equal(await page.locator('.um-collection-name h1').evaluate(el=>getComputedStyle(el).color),'rgb(16, 16, 19)','playlist title remains visible on its white surface');
        assert.equal(await page.locator('.um-play-pill').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 16, 19)','playlist play pill contrasts with its background');
        await page.locator('.um-collection-sheet [aria-label="播放全部"]').click();await page.locator('.um-collection-sheet [aria-label="展开播放器"]').click();
        await page.evaluate(()=>UvUMusic.player.play(window.visualMusic[0],window.visualMusic));
        await page.getByRole('slider',{name:'音量',exact:true}).fill('0.35');assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().volume),.35);
        await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'approved-player-390.png')});await page.getByRole('button',{name:'关闭',exact:true}).click();
        // Remove the intentionally disabled public-source playback fixture from station history.
        await page.evaluate(()=>UvUMusic.clearRecent());
        await page.locator('[data-um-tab="radio"]').click();await page.locator('.um-feature').first().click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing&&UvUMusic.player.snapshot().mode==='shuffle');assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().queueLabel),'你的音乐电台');
        await page.getByRole('button',{name:'音乐账号与设置',exact:true}).click();await page.locator('.um-appearance-settings > summary').click();await page.getByRole('button',{name:'深色',exact:true}).click();
        assert.equal(await page.locator('.uvu-music-sheet').evaluate(n=>n.classList.contains('um-dark')),true);await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.locator('[data-um-tab="discover"]').click();await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'approved-discover-dark-390.png')});
        for(const width of [320,390,768]){await page.setViewportSize({width,height:844});for(const id of ['discover','radio','library','search']){await page.locator('[data-um-tab="'+id+'"]').click();assert.ok(await page.locator('.um-main').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'page fits '+id+' '+width);}}
        await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.UvUMusicUI);await page.evaluate(()=>UvUMusicUI.open());assert.equal(await page.locator('#uvu-music-screen').evaluate(n=>n.classList.contains('um-dark')),true,'appearance survives reload');
        // A shipped HTTPS gateway needs no manual address or Connect click.
        await page.evaluate(async()=>{await UvUMusic.saveSettings({endpoint:''});localStorage.setItem('uvu-music-appearance','light');});
        shippedEndpoint='https://music-default.test'; authorized=false;
        await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.UvUMusicUI);
        await page.evaluate(()=>UvUMusicUI.accounts());
        await page.waitForFunction(()=>document.querySelector('.um-hosting-note')?.hidden===false);
        assert.match(await page.locator('.um-hosting-note').innerText(),/重启后需重新扫码/);
        assert.equal(await page.locator('.um-gateway-settings').evaluate(n=>n.open),false);
        assert.equal(await page.getByLabel('音乐服务地址',{exact:true}).inputValue(),'');
        for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.um-sheet-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'account sheet fits '+width);}
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'built-in-gateway-390.png')});
        await page.getByRole('button',{name:'扫码登录',exact:true}).first().click();await page.waitForSelector('.um-qr svg');
        await page.waitForFunction(()=>document.querySelector('.um-account small')?.textContent==='本地测试账号',{},{timeout:15000});
        assert.equal(await page.evaluate(()=>db.musicSettings.endpoint),'','login preferences never pin the shipped endpoint in backup');
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        gatewayOffline=true;await page.evaluate(()=>UvUMusicUI.accounts());
        await page.waitForFunction(()=>document.querySelector('.um-sheet-body')?.textContent.includes('正在连接音乐服务'));
        await page.getByRole('button',{name:'扫码登录',exact:true}).last().click();
        await page.waitForFunction(()=>document.querySelector('.um-qr')?.nextElementSibling.textContent.includes('正在连接音乐服务'));
        await page.getByRole('button',{name:'关闭',exact:true}).click(); gatewayOffline=false;
        await page.waitForFunction(()=>!document.querySelector('.um-sheet-card'));
        await page.evaluate(async()=>{
            await UvUMusicChat.end();UvUMusicUI.open();
            window.savedMusicAPI=db.apiSettings;db.apiSettings={provider:'newapi',url:'https://fixture.test',key:'fixture',model:'fixture'};
            window.savedMusicFetch=fetchAiResponse;fetchAiResponse=async()=>JSON.stringify({songs:[{title:'秋日来信 1',artists:['林间']}]});
            UvUMusicUI.characterPlaylist('music-char');
        });
        const originalCharacterProfile = await page.evaluate(()=>JSON.stringify(db.characters[0].musicProfile));
        await page.getByRole('button',{name:'刷新角色歌单',exact:true}).click();
        await page.getByRole('button',{name:'保存所选版本',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>JSON.stringify(db.characters[0].musicProfile)),originalCharacterProfile,'preview does not replace the saved playlist');
        await page.getByRole('button',{name:'取消刷新',exact:true}).click();
        assert.equal(await page.evaluate(()=>JSON.stringify(db.characters[0].musicProfile)),originalCharacterProfile,'cancel keeps the original playlist');
        await page.getByRole('button',{name:'刷新角色歌单',exact:true}).click();
        await page.getByRole('button',{name:'保存所选版本',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.um-character-status')?.textContent.includes('已保存'));
        assert.equal(await page.locator('.um-character-tracks .um-track').count(),1);
        assert.ok(await page.getByRole('button',{name:'播放全部',exact:true}).evaluate(n=>n.getBoundingClientRect().height<50),'character play-all label stays on one line');
        assert.equal(await page.evaluate(()=>{const chat=db.characters[0];storageValidateModules({characters:[{id:chat.id,musicProfile:chat.musicProfile}]});try{storageValidateModules({characters:[{id:chat.id,musicProfile:{...chat.musicProfile,autonomous:'yes'}}]});return false;}catch(_){return true;}}),true,'backup validates nested character playlist fields');
        await page.getByRole('button',{name:'播放全部',exact:true}).click();await page.waitForFunction(()=>UvUMusic.player.snapshot().playing&&UvUMusic.player.snapshot().queueLabel==='林间的歌单');
        await page.getByRole('checkbox',{name:'允许角色主动邀请一起听',exact:true}).check();
        await page.waitForFunction(()=>db.characters[0].musicProfile?.autonomous===true);
        for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.um-sheet-card').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'character playlist fits '+width);}
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'character-playlist-390.png')});
        await page.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>UvUMusicUI.characterPlaylist());assert.equal(await page.getByLabel('选择歌单角色',{exact:true}).inputValue(),'music-char');await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.evaluate(async()=>{
            fetchAiResponse=savedMusicFetch;db.apiSettings=savedMusicAPI;const chat=db.characters[0];chat.history.length=0;
            UvUMusic.player.stop();await openChatRoom(chat.id,'private');
            const plan=UvUMusicChat.requestPlan(chat.history,chat),candidate=plan.invitations.find(i=>i.kind==='offer');
            if(!candidate)throw new Error('missing character invitation candidate');
            const response='一起听歌吧。<uvu_music>'+JSON.stringify({invitationId:candidate.id,action:'invite'})+'</uvu_music>';
            await handleAiReplyContent(response,chat,chat.id,'private',false,undefined,[],plan);
        });
        await page.waitForSelector('.uvu-music-message.received [aria-label="接受一起听邀请"]');
        assert.equal(await page.evaluate(()=>UvUMusic.player.snapshot().playing),false,'incoming invitation never autoplays');
        assert.equal(await page.evaluate(()=>db.characters[0].history.some(m=>m.content?.includes('offer_'))),false,'invitation protocol is removed from displayed reply');
        const hostile=await page.addStyleTag({content:'.message-bubble { background:green!important;color:white!important;padding:30px!important;border-radius:0!important; } .message-bubble::after { content:"tail"!important;display:block!important; }'});
        const card=page.locator('.uvu-music-message.received .uvu-music-card').last();
        assert.equal(await card.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 255, 255)');
        assert.equal(await card.evaluate(n=>getComputedStyle(n).padding),'12px');
        assert.equal(await card.evaluate(n=>getComputedStyle(n,'::after').display),'none');
        for(const width of [320,390,768]){
            await page.setViewportSize({width,height:844});
            const overflow=await card.evaluate(n=>[n,...n.querySelectorAll('*')].map(e=>({cls:e.className,width:e.clientWidth,scroll:e.scrollWidth,display:getComputedStyle(e).display,min:getComputedStyle(e).minWidth})).filter(e=>e.scroll>e.width+1));
            assert.ok(await card.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'compact card fits '+width+' '+JSON.stringify(overflow));
            assert.ok(await card.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),'compact card stays within viewport '+width);
        }
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'character-invite-390.png')});
        await page.getByRole('button',{name:'接受一起听邀请',exact:true}).click();await page.waitForFunction(()=>UvUMusicChat.session()?.chatId==='music-char');
        assert.equal(await card.locator('.uvu-music-status .uvu-music-continuous').count(),1,'continuous control remains in the single footer after response');
        await hostile.evaluate(n=>n.remove());
        await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'character-together-390.png')});
        await page.evaluate(() => {
            window.candidateOriginal = {provider:'qq',id:'original_qq',title:'候选测试',artists:['林间'],album:'旧版'};
            window.savedCandidateAPI = UvUPublicMusic; window.savedCandidatePlay = UvUMusic.player.play;
            window.candidatePicked = null; window.candidatePlayed = null;
            UvUPublicMusic = {candidates:async()=>[{provider:'netease',id:'candidate_1',title:'候选测试',artists:['林间'],album:'新版'}],chooseMatch:(original,choice)=>{candidatePicked={original,choice};},clearMatch:()=>{}};
            UvUMusic.player.play=async track=>{candidatePlayed=track;};
            db.musicSettings.playbackSource='public'; db.musicSettings.publicSources=['gd-netease']; UvUMusicUI.trackMenu(candidateOriginal);
        });
        await page.getByRole('button',{name:'选择公共音源',exact:true}).click();
        await page.getByRole('button',{name:'候选测试 · 新版',exact:true}).click();
        assert.equal(await page.evaluate(()=>candidatePicked.choice.id),'candidate_1');
        assert.equal(await page.evaluate(()=>candidatePlayed.id),'original_qq','candidate mapping keeps original platform identity');
        await page.evaluate(()=>{UvUPublicMusic=savedCandidateAPI;UvUMusic.player.play=savedCandidatePlay;});
        assert.deepEqual(errors,[]);console.log('Music browser checks passed: full app, 320/390/768, search, gateway, QR, WAV audio, invite/card, queue/lyrics, character refresh/playback/selection, opt-in incoming invitation, custom CSS isolation, reload.');
    } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
