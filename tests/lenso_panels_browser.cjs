// Reference structure checks, independent from the old dialog-size assertions.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(root, '../../outputs/fusion-detail-fixes-20261112');
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
        assert.equal(await page.locator('.memo-footer .panel-primary:visible').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(212, 229, 239)');
        await page.getByRole('button',{name:'更换面板头像',exact:true}).click();
        await page.locator('#uvu-panel-artwork .uvu-lenso-panel').waitFor();
        await page.locator('#uvu-panel-artwork input[type=file]').setInputFiles(path.join(root,'assets/panels/tavern.webp'));
        await page.waitForFunction(()=>document.querySelector('.panel-artwork-preview-avatar')?.src.startsWith('data:')&&!document.querySelector('#uvu-panel-artwork .panel-primary').disabled);
        const chosenAvatar=await page.locator('.panel-artwork-preview-avatar').getAttribute('src');
        await page.locator('#uvu-panel-artwork .panel-primary').click();await page.locator('#uvu-panel-artwork').waitFor({state:'detached'});
        assert.equal(await page.locator('#character-memos-dialog .panel-artwork-avatar img').getAttribute('src'),chosenAvatar);
        assert.equal(await page.evaluate(()=>db.characters[0].avatar),'','panel avatar must not replace chat avatar');
        assert.equal(await page.evaluate(()=>captureArchiveData(db.characters[0]).derivedPanelAppearance),undefined,'panel appearance is character metadata');
        await page.getByRole('button',{name:'更换面板头像',exact:true}).click();
        await page.getByRole('button',{name:'恢复默认',exact:true}).click();
        await page.evaluate(()=>{window.artworkRealTransaction=dexieDB.transaction;dexieDB.transaction=async()=>{throw Error('fixture quota');};});
        await page.locator('#uvu-panel-artwork .panel-primary').click();
        await page.getByRole('status').filter({hasText:'图片保存失败，请重试'}).waitFor();
        assert.equal(await page.evaluate(()=>db.characters[0].derivedPanelAppearance.avatar),chosenAvatar,'failed save rolls back character metadata');
        assert.equal(await page.locator('#character-memos-dialog .panel-artwork-avatar img').getAttribute('src'),chosenAvatar,'failed save leaves visible artwork intact');
        await page.evaluate(()=>{dexieDB.transaction=artworkRealTransaction;delete window.artworkRealTransaction;});await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'更换面板背景',exact:true}).click();
        await page.locator('#uvu-panel-artwork input[type=file]').setInputFiles(path.join(root,'assets/panels/tavern.webp'));
        await page.waitForFunction(()=>document.querySelector('.panel-artwork-preview-cover')?.src.startsWith('data:')&&!document.querySelector('#uvu-panel-artwork .panel-primary').disabled);
        await page.locator('#uvu-panel-artwork .panel-primary').click();await page.locator('#uvu-panel-artwork').waitFor({state:'detached'});
        const chosenBackground=await page.locator('#character-memos-dialog .panel-artwork-cover img').getAttribute('src');
        await page.getByRole('button',{name:'更换面板背景',exact:true}).click();
        await page.getByRole('button',{name:'恢复默认',exact:true}).click();await page.keyboard.press('Escape');
        assert.equal(await page.locator('#character-memos-dialog .panel-artwork-cover img').getAttribute('src'),chosenBackground,'cancel leaves saved artwork intact');
        await page.reload();await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
        await page.evaluate(()=>openChatRoom('draft-char','private'));await page.evaluate(()=>openCharacterMemos(db.characters[0]));
        assert.equal(await page.locator('#character-memos-dialog .panel-artwork-avatar img').getAttribute('src'),chosenAvatar,'avatar survives reload');
        assert.equal(await page.locator('#character-memos-dialog .panel-artwork-cover img').getAttribute('src'),chosenBackground,'background survives reload');
        await page.evaluate(async()=>{db.characters.push({...db.characters[0],id:'artwork-other',realName:'另一位',remarkName:'另一位',archives:[],activeArchiveId:undefined,derivedPanelAppearance:undefined});await saveData();});
        await reset();await page.evaluate(()=>openCharacterMemos(db.characters.find(c=>c.id==='artwork-other')));
        assert.equal(await page.locator('#character-memos-dialog .panel-artwork-avatar img').getAttribute('src'),'assets/panels/avatar.webp','characters do not share overrides');
        await reset();await page.evaluate(()=>openCharacterMemos(db.characters[0]));
        await page.getByRole('button',{name:'更换面板背景',exact:true}).click();
        for(const [width,height]of [[320,568],[390,420]]){await page.setViewportSize({width,height});const b=await page.locator('#uvu-panel-artwork .uvu-lenso-panel').boundingBox();assert(b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1);await page.locator('#uvu-panel-artwork .panel-primary').scrollIntoViewIfNeeded();assert(await page.locator('#uvu-panel-artwork .panel-primary').isVisible());}
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'appearance.png')});
        await page.getByRole('button',{name:'恢复默认',exact:true}).click();await page.locator('#uvu-panel-artwork .panel-primary').click();await page.locator('#uvu-panel-artwork').waitFor({state:'detached'});
        assert.equal(await page.locator('#character-memos-dialog .panel-artwork-avatar img').getAttribute('src'),'assets/panels/avatar.webp');
        assert.equal(await page.locator('#character-memos-dialog .panel-artwork-cover img').getAttribute('src'),'assets/panels/memos.webp');
        await page.evaluate(async()=>{db.characters=db.characters.filter(c=>c.id!=='artwork-other');await saveData();});
        await page.getByRole('button',{name:'备忘录设置',exact:true}).click();await page.screenshot({path:path.join(out,'memo-settings.png')});
        await page.getByRole('switch',{name:'启用备忘录',exact:true}).check();await page.waitForFunction(()=>db.characters[0].characterMemos.settings.enabled);
        assert.equal(await page.getByRole('switch',{name:'启用备忘录',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(201, 234, 248)');
        await capture('summary','#auto-memory-modal .uvu-lenso-panel',()=>page.evaluate(()=>document.getElementById('auto-memory-settings-btn').click()));
        await capture('vector','#auto-memory-modal .uvu-lenso-panel',()=>page.evaluate(()=>document.getElementById('vector-memory-settings-btn').click()));
        await capture('mcp','#mcp-services .uvu-lenso-panel',()=>page.evaluate(()=>openMcpSettings()));
        await page.evaluate(()=>document.querySelector('#mcp-services .uvu-lenso-panel').monoNavigate('tools'));
        const closeBounds=await page.locator('#mcp-services .sheet-close').boundingBox(),backBounds=await page.locator('#mcp-services .sheet-back').boundingBox();
        assert(backBounds.x-closeBounds.x-closeBounds.width>=10&&backBounds.x-closeBounds.x-closeBounds.width<=14,'back sits beside close with a 12px gap');
        await page.screenshot({path:path.join(out,'mcp-authorization.png')});
        await page.locator('#mcp-services .sheet-back').click();
        assert.equal(await page.locator('#mcp-services .uvu-lenso-panel').getAttribute('data-mono-view'),'main');
        await capture('files','#shared-document-dialog .uvu-lenso-panel',()=>page.evaluate(()=>openSharedDocumentDialog()));
        assert((await page.locator('#shared-document-dialog .uvu-lenso-panel').boundingBox()).height<520,'empty send form follows its contents');
        assert.equal(await page.locator('.fusion-file-recipient strong').innerText(),'沈砚');
        assert.equal(await page.getByRole('button',{name:'取消',exact:true}).isVisible(),true);
        await page.locator('#shared-document-dialog input[type=file]').setInputFiles({name:'周末计划.md',mimeType:'text/markdown',buffer:Buffer.from(`周末计划

周六先去街角书店。
如果天气好，再沿河走一会儿。

记得带上那本还没读完的书。`)});
        await page.locator('[data-lenso-file-ready=true]').waitFor();
        assert.match(await page.locator('.lenso-file-preview').innerText(),/周六先去街角书店/);
        await page.screenshot({path:path.join(out,'file-ready.png')});
        await page.setViewportSize({width:390,height:420});
        await page.locator('.lenso-file-preview p').first().evaluate(el=>el.textContent='长文件正文用于检查短屏内部滚动。'.repeat(300));
        await page.locator('#shared-document-dialog .shared-document-actions button:visible').first().scrollIntoViewIfNeeded();
        const fileBounds=await page.locator('#shared-document-dialog .uvu-lenso-panel').boundingBox();
        assert(fileBounds.y>=0&&fileBounds.y+fileBounds.height<=420,'long file stays inside short viewport');
        assert(await page.locator('.shared-document-body').evaluate(el=>el.scrollHeight>el.clientHeight),'long file scrolls internally');
        await page.setViewportSize({width:390,height:844});
        await page.getByRole('button',{name:'编辑副本',exact:true}).click();await page.locator('#expanded-text-editor').waitFor();await page.locator('#expanded-text-editor [data-action=keepDraft]').click();
        await capture('calendar','.uvu-calendar.uvu-lenso-panel',()=>page.evaluate(()=>openEnvironmentCalendar()));
        assert.equal(await page.locator('.calendar-day.is-selected').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(212, 229, 239)');
        await page.locator('.calendar-tabs [data-mode=schedule]').click();
        assert.equal(await page.locator('.draft-calendar-week [aria-pressed=true]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(212, 229, 239)');
        await page.locator('.draft-calendar-owner select').selectOption({label:'沈砚 的日历'});
        assert.equal(await page.locator('.draft-calendar-generate').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(212, 229, 239)');
        await page.screenshot({path:path.join(out,'calendar-agenda.png')});
        await capture('environment','#environment-settings .uvu-lenso-panel',()=>page.evaluate(()=>openEnvironmentSettings(true)));
        assert.equal(await page.locator('#environment-settings .draft-form-scroll').evaluate(el=>el.firstElementChild.classList.contains('lenso-title')),true,'environment title precedes its controls after repeated decoration');
        await capture('social','.ms-dialog.uvu-lenso-panel',()=>page.evaluate(()=>UvUMomentsUI.settings(db.characters[0])));
        await capture('avatar','#character-avatar-settings .uvu-lenso-panel',()=>page.evaluate(()=>openCharacterAvatarSettings()));
        await capture('relationship','.relationship-dialog.uvu-lenso-panel',()=>page.evaluate(()=>openRelationshipDialog()));
        await capture('export','.cc-export-dialog.uvu-lenso-panel',()=>page.evaluate(()=>UvUCharacterCardUI.open(db.characters[0])));
        await capture('memory','.memory-library > .uvu-lenso-panel',()=>page.evaluate(()=>openMemoryLibrary()));
        await page.evaluate(()=>{const c=db.characters[0];c.memoryJournals.push({id:'long-layout',source:'manual',title:'记忆 · 2026年11月12日 · 周末书店的约定与很长的标题'.repeat(2),content:'这是一段较长的记忆，检查分隔线不会穿过正文和按钮。'.repeat(30),createdAt:Date.now()});});
        await capture('memory-long','.memory-library > .uvu-lenso-panel',()=>page.evaluate(()=>openMemoryLibrary()));
        for(const [width,height]of [[320,568],[390,844]]){
            await page.setViewportSize({width,height});
            const layout=await page.locator('.memory-library > .uvu-lenso-panel').evaluate(panel=>{
                const cards=[...panel.querySelectorAll('.memory-library-list > .memory-library-card')];
                return {cards:cards.map(card=>{const r=card.getBoundingClientRect(),line=r.left+parseFloat(getComputedStyle(card,'::after').left);return{line,title:card.querySelector('.memory-library-pick').getBoundingClientRect().left,text:card.querySelector('pre').getBoundingClientRect().left,date:card.querySelector('.draft-memory-date')?.getBoundingClientRect().left,card:r.left};}),nav:[...panel.querySelectorAll('.draft-memory-nav > button')].map(b=>({height:b.getBoundingClientRect().height,overflow:b.scrollWidth-b.clientWidth,whiteSpace:getComputedStyle(b).whiteSpace}))};
            });
            for(const card of layout.cards){assert(card.title>card.line&&card.text>card.line,'timeline stays in its own gutter');if(card.date!==undefined)assert(card.date>=card.card,'date stays inside card');}
            for(const b of layout.nav){assert(b.height<=34&&b.overflow<=1&&b.whiteSpace==='nowrap','compact nav labels fit on one line');}
            await page.locator('.memory-library .mono-memory-body').evaluate(el=>el.scrollTop=el.scrollHeight);
            await page.screenshot({path:path.join(out,'memory-long-'+width+'.png')});
            await page.locator('.memory-library-card[data-memory-id=long-layout]').scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(out,'memory-content-'+width+'.png')});
        }
        await page.setViewportSize({width:390,height:844});
        await page.getByRole('button',{name:'选择记忆',exact:true}).click();
        await page.locator('.memory-library-card[data-memory-id=long-layout] input[type=checkbox]').check();
        assert(await page.locator('.memory-library-card[data-memory-id=long-layout] input[type=checkbox]').isChecked());
        const expand=page.locator('.memory-library-card[data-memory-id=long-layout] button[aria-expanded]');
        await expand.click();assert.equal(await expand.getAttribute('aria-expanded'),'true');await expand.click();
        await capture('archives','#chat-archive-overlay .uvu-lenso-panel',()=>page.evaluate(()=>openArchiveManager()));
        await page.locator('#close-chat-archives').click();
        await capture('css-import','#global-css-import-preview .uvu-lenso-panel',()=>page.evaluate(()=>{window.lensoCssReview=previewGlobalCssImport('body {color:black}','body {color:navy}');}));
        await page.locator('#global-css-import-preview [data-cancel]').click();assert.equal(await page.evaluate(()=>lensoCssReview),false);
        await capture('forward','#message-forward-picker .uvu-lenso-panel',()=>page.evaluate(()=>{enterMultiSelectMode('draft-0');openMessageForwardPicker(db.characters[0],'private',new Set(['draft-0']));}));
        await page.locator('#message-forward-picker .sheet-close').click();await page.evaluate(()=>exitMultiSelectMode());
        await capture('resources','.resource-health.uvu-lenso-panel',()=>page.evaluate(()=>UvUResourceHealth.open()));
        await capture('sticker-settings','#sticker-description-settings .uvu-lenso-panel',()=>page.evaluate(()=>openStickerDescriptionSettings()));
        assert((await page.locator('#sticker-description-settings .uvu-lenso-panel').boundingBox()).height<560,'short sticker form does not reserve a full-page height');
        await page.setViewportSize({width:390,height:420});
        await page.locator('#sticker-description-settings [data-preview]').evaluate(el=>el.textContent=Array(300).fill('表情说明预览。').join(String.fromCharCode(10)));
        await page.locator('#sticker-description-settings [data-action=save]').scrollIntoViewIfNeeded();
        const saveBounds=await page.locator('#sticker-description-settings [data-action=save]').boundingBox();
        assert(saveBounds.y>=0&&saveBounds.y+saveBounds.height<=420,'sticker save remains reachable on short screens');
        assert(await page.locator('#sticker-description-settings [data-preview]').evaluate(el=>el.scrollHeight>el.clientHeight),'long sticker preview scrolls internally');
        await page.setViewportSize({width:390,height:844});
        await capture('notifications','#uvu-notification-preferences .uvu-lenso-panel',()=>page.evaluate(()=>{switchScreen('api-settings-screen');document.getElementById('uvu-notification-preferences').open=true;}));
        await capture('home-presets','.draft-preset-workspace.uvu-lenso-panel',()=>page.evaluate(()=>{switchScreen('customize-screen');document.querySelector('.home-preset-card > button').click();}));
        await page.locator('.draft-preset-workspace .sheet-close').click();
        await capture('tavern','#uvu-story-bridge-screen.uvu-lenso-panel',()=>page.evaluate(()=>switchScreen('uvu-story-bridge-screen')));
        assert.equal(await page.locator('#uvu-story-bridge-screen .panel-artwork-cover img').getAttribute('src'),'assets/panels/tavern.webp','memo background does not replace Tavern background');
        await page.getByRole('button',{name:'更换面板背景',exact:true}).click();
        await page.evaluate(()=>{const s=document.getElementById('uvu-bridge-handoff-character');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));});
        await page.locator('#uvu-panel-artwork .panel-primary').click();
        await page.getByRole('status').filter({hasText:'角色已改变，请重新打开外观设置'}).waitFor();
        await page.keyboard.press('Escape');
        await page.evaluate(()=>{const s=document.getElementById('uvu-bridge-handoff-character');s.value='draft-char';s.dispatchEvent(new Event('change',{bubbles:true}));});
        await page.getByRole('button',{name:'绑定',exact:true}).click();await page.screenshot({path:path.join(out,'tavern-binding.png')});
        await page.evaluate(()=>document.querySelector('#uvu-story-bridge-screen').monoNavigate('online'));await page.screenshot({path:path.join(out,'handoff.png')});
        await reset();
        await page.evaluate(()=>switchScreen('api-settings-screen'));
        const voice=page.locator('#minimax-tts-settings');await voice.scrollIntoViewIfNeeded();
        assert.equal(await voice.evaluate(el=>el.classList.contains('uvu-fusion-inline')),true);
        assert.equal(await voice.evaluate(el=>el.classList.contains('mono-page')),false,'MiniMax remains in the native API page');
        assert.equal(await voice.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
        await page.screenshot({path:path.join(out,'voice-inline.png')});
        await page.evaluate(()=>switchScreen('storage-analysis-screen'));await page.locator('#storage-import-label').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#storage-import-label').isVisible(),true);
        assert.equal(await page.locator('#storage-backup-options').evaluate(el=>!!el.closest('#storage-analysis-screen')),true,'backup stays in the native data page');
        await page.screenshot({path:path.join(out,'backup-inline.png')});
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
        assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({checks,errors},null,2));console.log('PASS Lenso production panels, light-blue switch, file preview/edit, scoped protection and responsive bounds');
    } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
