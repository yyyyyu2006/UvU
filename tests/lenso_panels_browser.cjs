// Reference structure checks, independent from the old dialog-size assertions.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(root, '../../outputs/lenso-production-20261112');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => { if (error) return res.writeHead(404).end(); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg':'image/svg+xml' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'); res.end(bytes); });
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


        await page.evaluate(async()=>{
            const c=db.characters[0];
            await addManualCharacterMemo(c,{fact:'咖啡不加糖',content:'最近更喜欢清淡的口味。'});
            await addManualCharacterMemo(c,{fact:'周五上午有面试',content:'时间已改为10:00。'});
            c.memoryJournals.push({id:'summary-fixture',title:'书店与周五的面试',content:'雨停前，你们在书店待了一会儿。离开时，他确认了周五上午的面试时间。',source:'summary',createdAt:Date.now()});
            const next=MCPServices.settings();next.services=[{id:'fixture',name:'日程工具',url:'https://fixture.invalid/mcp',enabled:true,transport:'streamable-http',auth:'none'}];await MCPServices.save(next);
        });
        async function reset(){await page.evaluate(()=>{for(const el of [...document.querySelectorAll('.message-forward-overlay,.feature-dialog')].reverse()){if(el.dismissForward)el.dismissForward();else el.querySelector('.sheet-close,[data-action=close],.cc-close,.message-forward-close')?.click();if(el.isConnected)el.remove();}document.getElementById('auto-memory-modal')?.classList.remove('visible');document.getElementById('chat-archive-overlay')?.classList.remove('visible');const details=document.getElementById('uvu-notification-preferences');if(details)details.open=false;openChatRoom('draft-char','private');});}
        async function capture(id,selector,open){
            await reset();await open();const panel=page.locator(selector);await panel.waitFor();
            await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
            const geometry=[];
            for(const [width,height]of [[390,844],[320,568],[390,420],[768,1024]]){
                await page.setViewportSize({width,height});
                const value=await panel.evaluate(p=>{const r=p.getBoundingClientRect(),c=getComputedStyle(p);return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,overflow:p.scrollWidth-p.clientWidth,bg:c.backgroundColor,canvas:c.getPropertyValue('--draft-canvas'),title:p.querySelector('.lenso-title')?.textContent}});
                assert.ok(value.x>=-1&&value.y>=-1&&value.right<=width+1&&value.bottom<=height+1,id+' bounds '+JSON.stringify(value));assert.ok(value.overflow<=1,id+' overflow '+JSON.stringify(value));geometry.push({width,height,...value});
            }
            await page.setViewportSize({width:390,height:844});
            await panel.evaluate(el=>{for(const b of el.querySelectorAll('.draft-scroll,.derived-body,.draft-form-scroll,.mcp-body,.calendar-body,.mono-memory-body,#auto-memory-form'))b.scrollTop=0;});
            await page.screenshot({path:path.join(out,id+'.png')});checks.push({id,geometry});
        }
        await capture('memos','#character-memos-dialog .uvu-lenso-panel',()=>page.evaluate(()=>openCharacterMemos(db.characters[0])));
        await page.getByRole('button',{name:'备忘录设置',exact:true}).click();await page.screenshot({path:path.join(out,'memo-settings.png')});
        await page.getByRole('switch',{name:'启用备忘录',exact:true}).check();await page.waitForFunction(()=>db.characters[0].characterMemos.settings.enabled);
        assert.equal(await page.getByRole('switch',{name:'启用备忘录',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(52, 199, 89)');
        await capture('summary','#auto-memory-modal .uvu-lenso-panel',()=>page.evaluate(()=>document.getElementById('auto-memory-settings-btn').click()));
        await capture('vector','#auto-memory-modal .uvu-lenso-panel',()=>page.evaluate(()=>document.getElementById('vector-memory-settings-btn').click()));
        await capture('mcp','#mcp-services .uvu-lenso-panel',()=>page.evaluate(()=>openMcpSettings()));
        await capture('files','#shared-document-dialog .uvu-lenso-panel',()=>page.evaluate(()=>openSharedDocumentDialog()));
        await page.locator('#shared-document-dialog input[type=file]').setInputFiles({name:'周末计划.md',mimeType:'text/markdown',buffer:Buffer.from(`周末计划

周六先去街角书店。
如果天气好，再沿河走一会儿。

记得带上那本还没读完的书。`)});
        await page.locator('[data-lenso-file-ready=true]').waitFor();
        assert.match(await page.locator('.lenso-file-preview').innerText(),/周六先去街角书店/);
        await page.screenshot({path:path.join(out,'file-ready.png')});
        await page.getByRole('button',{name:'编辑副本',exact:true}).click();await page.locator('#expanded-text-editor').waitFor();await page.locator('#expanded-text-editor [data-action=keepDraft]').click();
        await capture('calendar','.uvu-calendar.uvu-lenso-panel',()=>page.evaluate(()=>openEnvironmentCalendar()));
        await capture('environment','#environment-settings .uvu-lenso-panel',()=>page.evaluate(()=>openEnvironmentSettings(true)));
        assert.equal(await page.locator('#environment-settings .draft-form-scroll').evaluate(el=>el.firstElementChild.classList.contains('lenso-title')),true,'environment title precedes its controls after repeated decoration');
        await capture('social','.ms-dialog.uvu-lenso-panel',()=>page.evaluate(()=>UvUMomentsUI.settings(db.characters[0])));
        await capture('avatar','#character-avatar-settings .uvu-lenso-panel',()=>page.evaluate(()=>openCharacterAvatarSettings()));
        await capture('relationship','.relationship-dialog.uvu-lenso-panel',()=>page.evaluate(()=>openRelationshipDialog()));
        await capture('export','.cc-export-dialog.uvu-lenso-panel',()=>page.evaluate(()=>UvUCharacterCardUI.open(db.characters[0])));
        await capture('memory','.memory-library > .uvu-lenso-panel',()=>page.evaluate(()=>openMemoryLibrary()));
        await capture('archives','#chat-archive-overlay .uvu-lenso-panel',()=>page.evaluate(()=>openArchiveManager()));
        await page.locator('#close-chat-archives').click();
        await capture('css-import','#global-css-import-preview .uvu-lenso-panel',()=>page.evaluate(()=>{window.lensoCssReview=previewGlobalCssImport('body {color:black}','body {color:navy}');}));
        await page.locator('#global-css-import-preview [data-cancel]').click();assert.equal(await page.evaluate(()=>lensoCssReview),false);
        await capture('forward','#message-forward-picker .uvu-lenso-panel',()=>page.evaluate(()=>{enterMultiSelectMode('draft-0');openMessageForwardPicker(db.characters[0],'private',new Set(['draft-0']));}));
        await page.locator('#message-forward-picker .sheet-close').click();await page.evaluate(()=>exitMultiSelectMode());
        await capture('resources','.resource-health.uvu-lenso-panel',()=>page.evaluate(()=>UvUResourceHealth.open()));
        await capture('sticker-settings','#sticker-description-settings .uvu-lenso-panel',()=>page.evaluate(()=>openStickerDescriptionSettings()));
        await capture('notifications','#uvu-notification-preferences .uvu-lenso-panel',()=>page.evaluate(()=>{switchScreen('api-settings-screen');document.getElementById('uvu-notification-preferences').open=true;}));
        await capture('home-presets','.draft-preset-workspace.uvu-lenso-panel',()=>page.evaluate(()=>{switchScreen('customize-screen');document.querySelector('.home-preset-card > button').click();}));
        await page.locator('.draft-preset-workspace .sheet-close').click();
        await capture('tavern','#uvu-story-bridge-screen.uvu-lenso-panel',()=>page.evaluate(()=>switchScreen('uvu-story-bridge-screen')));
        await page.getByRole('button',{name:'绑定',exact:true}).click();await page.screenshot({path:path.join(out,'tavern-binding.png')});
        await page.evaluate(()=>document.querySelector('#uvu-story-bridge-screen').monoNavigate('online'));await page.screenshot({path:path.join(out,'handoff.png')});
        await reset();
        const cover=await page.evaluate(()=>{const canvas=document.createElement('canvas'),data={name:'沈砚',description:'旧书店',creator:'作者'};UvUCardCover.draw(canvas,data,{});const before=canvas.toDataURL();document.querySelector('link[href*=lenso_panels]').disabled=true;UvUCardCover.draw(canvas,data,{});const equal=before===canvas.toDataURL()&&canvas.getContext('2d').getImageData(0,0,1,1).data[3]===0;document.querySelector('link[href*=lenso_panels]').disabled=false;return equal;});assert.equal(cover,true,'export artwork and transparent corners remain identical');
        const flags=await page.evaluate(()=>({music:!!document.querySelector('#uvu-music-screen.uvu-lenso-panel'),status:!!document.querySelector('#char-status-overlay .uvu-lenso-panel'),sent:!!document.querySelector('.message-bubble.uvu-lenso-panel')}));assert.deepEqual(flags,{music:false,status:false,sent:false});
        for(const [id,open] of [
            ['chat',()=>page.evaluate(()=>openChatRoom('draft-char','private'))],
            ['music',()=>page.evaluate(()=>switchScreen('uvu-music-screen'))]
        ]){
            await open();await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
            const before=await page.screenshot({animations:'disabled'});
            await page.evaluate(()=>document.querySelector('link[href*=lenso_panels]').disabled=true);
            const after=await page.screenshot({animations:'disabled'});
            await page.evaluate(()=>document.querySelector('link[href*=lenso_panels]').disabled=false);
            assert.ok(before.equals(after),id+' renders identically with the new stylesheet enabled or disabled');
        }
        assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({checks,errors},null,2));console.log('PASS Lenso production panels, green switch, file preview/edit, scoped protection and responsive bounds');
    } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
