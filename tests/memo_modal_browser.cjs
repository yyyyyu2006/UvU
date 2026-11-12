// Reference structure checks, independent from the old dialog-size assertions.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.UVU_DRAFT_EVIDENCE || path.resolve(root, '../../outputs/approved-atlas');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => { if (error) return res.writeHead(404).end(); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'); res.end(bytes); });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        await context.addInitScript(() => { localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true'); document.addEventListener('click', () => { if (typeof globalRescueClickCount !== 'undefined') globalRescueClickCount = 0; if (typeof globalRescueLastClickTime !== 'undefined') globalRescueLastClickTime = 0; }, true); });
        await context.route('**/*', route => { const url = route.request().url(); if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' }); return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort(); });
        const page = await context.newPage(), errors = [], failures = [], checks = [];
        page.on('pageerror', error => {errors.push(error.stack);console.error(error.stack);}); page.on('dialog', d => d.accept());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.evaluate(async () => {
            db.characters = [{ id: 'draft-char', realName: '沈砚', remarkName: '沈砚', avatar: '', myAvatar: '', myName: '我', persona: '在旧书店工作，温和细致。', myPersona: '喜欢读书', maxMemory: 20, worldBookIds: ['draft-book'], history: Array.from({ length: 60 }, (_, i) => ({ id: 'draft-' + i, role: i % 2 ? 'assistant' : 'user', content: i % 2 ? '周末一起去书店。' : '好呀，周六见。', timestamp: Date.now() - i * 1000 })), memoryJournals: [] }];
            db.groups = []; db.worldBooks = [{ id: 'draft-book', type: 'entry', name: '海边小城', content: '旧书店在海边。', position: 'before' }]; db.backupReminderSettings = { enabled: false }; await saveData(); openChatRoom('draft-char', 'private');
        });

        await page.evaluate(()=>document.getElementById('auto-memory-settings-btn').click());
        await page.waitForFunction(()=>document.querySelector('#auto-memory-modal .mono-page'));
        await page.evaluate(()=>Promise.all(document.querySelector('#auto-memory-modal').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
        await page.locator('.draft-range-summary > summary').click();
        for(const [width,height] of [[320,740],[390,844],[402,420],[768,1024]]){
            await page.setViewportSize({width,height});
            const geometry=await page.locator('.auto-memory-dialog').evaluate(p=>{const r=p.getBoundingClientRect(),f=p.querySelector('form'),range=p.querySelector('.auto-memory-range');return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,overflow:p.scrollWidth-p.clientWidth,radius:getComputedStyle(p).borderRadius,rangeInForm:f.contains(range),rangeDirect:range.parentElement.parentElement===f,client:f.clientHeight,scroll:f.scrollHeight};});
            assert.ok(geometry.x>=12&&geometry.y>=12&&geometry.right<=width-12&&geometry.bottom<=height-12,'inset summary '+JSON.stringify(geometry));
            assert.ok(geometry.rangeInForm&&geometry.rangeDirect&&geometry.scroll>geometry.client+100,'one scroll container includes expanded batch controls');
            assert.ok(geometry.overflow<=1,'no horizontal overflow');
            await page.locator('#auto-memory-form').evaluate(el=>el.scrollTop=el.scrollHeight);
            const scroll=await page.locator('#auto-memory-form').evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));assert.ok(scroll.top>0&&Math.abs(scroll.top-scroll.max)<2,'can reach last setting');
            const y=await page.evaluate(()=>window.scrollY);await page.mouse.move(2,200);await page.mouse.wheel(0,600);assert.equal(await page.evaluate(()=>window.scrollY),y,'background stays fixed');
        }
        await page.setViewportSize({width:390,height:844});
        await page.locator('#auto-memory-form').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,'auto-summary-inset.png')});
        await page.locator('#auto-memory-close').click();
        await page.evaluate(()=>openCharacterMemos(db.characters[0]));await page.locator('#character-memos-dialog .mono-page').waitFor();
        await page.getByRole('button',{name:'添加',exact:true}).click();
        await page.getByLabel('记住的事情',{exact:true}).fill('喜欢喝绿茶');await page.getByLabel('角色的便签',{exact:true}).fill('下次记得泡一杯茶。');
        await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('#character-memo-editor').waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes[0].fact),'喜欢喝绿茶');
        assert.equal(await page.evaluate(()=>getCharacterMemoContext(db.characters[0])),'','disabled settings do not inject manual notes');
        await page.getByRole('button',{name:'备忘录设置',exact:true}).click();
        await page.getByRole('switch',{name:'启用备忘录',exact:true}).check();await page.waitForFunction(()=>db.characters[0].characterMemos.settings.enabled);
        await page.getByRole('switch',{name:'用于对话',exact:true}).check();await page.waitForFunction(()=>db.characters[0].characterMemos.settings.useContext);
        await page.getByRole('button',{name:'完成',exact:true}).click();
        await page.locator('.memo-more > summary').click();await page.locator('.memo-more').getByRole('button',{name:'置顶',exact:true}).click();await page.waitForFunction(()=>db.characters[0].characterMemos.notes[0].pinned);
        assert.match(await page.evaluate(()=>getCharacterMemoContext(db.characters[0])),/喜欢喝绿茶/);
        await page.locator('.memo-more').evaluate(el=>el.open=true);await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('记住的事情',{exact:true}).fill('只喝温的绿茶');await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('#character-memo-editor').waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes[0].locked),true);await page.locator('.memo-more').evaluate(el=>el.open=true);
        await page.locator('.memo-batch').evaluate(el=>el.open=true);await page.locator('.memo-card input[type=checkbox]').check();await page.getByRole('button',{name:'加入日记',exact:true}).click();await page.waitForFunction(()=>db.characters[0].memoryJournals.some(j=>j.characterMemoId));
        assert.equal(await page.evaluate(()=>db.characters[0].memoryJournals.find(j=>j.characterMemoId).isFavorited),false,'diary import does not silently enable journal context');
        await page.locator('.memo-more').evaluate(el=>el.open=true);await page.getByRole('button',{name:'不再记这件事',exact:true}).click();await page.waitForFunction(()=>db.characters[0].characterMemos.notes.length===0);
        await page.getByRole('button',{name:'撤销删除',exact:true}).click();await page.waitForFunction(()=>db.characters[0].characterMemos.notes.length===1);assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.blocked.length),0);
        for(const [width,height] of [[320,740],[390,844],[402,420]]){await page.setViewportSize({width,height});const g=await page.locator('#character-memos-dialog .mono-page').evaluate(p=>{const r=p.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,overflow:p.scrollWidth-p.clientWidth}});assert.ok(g.x>=12&&g.y>=12&&g.right<=width-12&&g.bottom<=height-12&&g.overflow<=1,'memo dialog fits '+JSON.stringify(g));}
        await page.setViewportSize({width:390,height:844});await page.locator('#character-memos-dialog .derived-body').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,'character-memos.png')});
        const prev=await page.evaluate(()=>{const c=db.characters[0];c.myName='另一位用户';return c.characterMemos.notes.length});
        await page.locator('.memo-more').evaluate(el=>el.open=true);await page.getByRole('button',{name:'删除',exact:true}).click();assert.match(await page.locator('.memo-feedback[aria-live=polite]').textContent(),/用户已改变/);assert.equal(await page.evaluate(()=>db.characters[0].characterMemos.notes.length),prev,'stale manager cannot edit another persona');

        // Prove background extraction runs after scheduling without a second chat request.
        await page.evaluate(()=>{document.getElementById('character-memos-dialog').dismissForward();const c=db.characters[0];c.myName='我';c.history.push({id:'memo-direct-user',role:'user',content:'我习惯晚上十点睡觉',timestamp:Date.now()});c.characterMemos.settings={...c.characterMemos.settings,automatic:true,mode:'auto',threshold:2};c.characterMemos.lastRun=0;c.characterMemos.processed={[characterMemoIdentity(c)]:Object.fromEntries(c.history.slice(0,-2).map(m=>[m.id,characterMemoFingerprint(m)]))};fetchAiResponse=async()=>JSON.stringify({notes:[{subject:'user',fact:'习惯晚上十点睡觉',category:'习惯',note:'十点前提醒你休息。',sourceIds:['memo-direct-user'],evidence:[{id:'memo-direct-user',quote:'我习惯晚上十点睡觉'}]}]});resolveAutoMemoryApi=()=>({provider:'newapi',url:'https://mock.invalid',key:'fake-test',model:'mock'});scheduleCharacterMemos(c);});
        await page.waitForFunction(()=>db.characters[0].characterMemos.notes.some(n=>n.fact==='习惯晚上十点睡觉'&&n.status==='approved'));
        await page.evaluate(()=>openCharacterMemos(db.characters[0]));await page.locator('#character-memos-dialog .mono-page').waitFor();
        await page.locator('.memo-batch').evaluate(el=>el.open=true);await page.getByLabel('选择 习惯晚上十点睡觉',{exact:true}).check();
        await page.evaluate(()=>{const c=db.characters[0],archive=c.activeArchiveId,history=c.history;window.memoSaveOriginal=runDataPersistence;window.memoJournalBefore=JSON.stringify(c.memoryJournals);runDataPersistence=async()=>{const staged=structuredClone(c.memoryJournals);c.activeArchiveId='switched-away';c.history=[];c.activeArchiveId=archive;c.history=history.slice();c.memoryJournals=staged;throw Error('模拟日记保存失败');};});
        await page.getByRole('button',{name:'加入日记',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#character-memos-dialog .memo-feedback').textContent.includes('模拟日记保存失败'));
        assert.equal(await page.evaluate(()=>JSON.stringify(db.characters[0].memoryJournals)===memoJournalBefore),true,'journal rollback also restores A-B-A clone');
        await page.evaluate(()=>runDataPersistence=memoSaveOriginal);
        assert.equal(errors.length,0,errors.join('\n'));
        console.log('PASS inset summary expanded scrolling, fixed background, memo CRUD, recall gate, diary, suppression undo and stale identity');
    } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
