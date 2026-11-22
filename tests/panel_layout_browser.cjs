// Exercise the approved four-panel layout in the full application with isolated data.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const runtime = require('./helpers/browser_runtime.cjs'), root = path.resolve(__dirname, '..');
const out = path.join(root, 'outputs/panel-layout-20261122'); fs.mkdirSync(out, {recursive:true});
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), assets = runtime.assetMap(html);
const result = {viewports:[], interactions:[], errors:[]};
const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://fixture'), file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname)));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => { if (error) return res.writeHead(404).end(); res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'}[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'); res.end(data); });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser, page;
    try {
        const base = 'http://127.0.0.1:' + server.address().port;
        browser = await runtime.playwright().chromium.launch({headless:true, executablePath:runtime.browserPath()});
        const context = await browser.newContext({viewport:{width:390,height:844}, hasTouch:true, reducedMotion:'reduce', serviceWorkers:'block'});
        await context.addInitScript(() => { localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true'); document.addEventListener('click', () => { if (typeof globalRescueClickCount !== 'undefined') globalRescueClickCount = 0; if (typeof globalRescueLastClickTime !== 'undefined') globalRescueLastClickTime = 0; }, true); });
        await context.route('**/*', route => { const url = route.request().url(); if (assets.has(url)) return route.fulfill({path:assets.get(url), contentType:'application/javascript'}); return url.startsWith(base) || url.startsWith('blob:') || url.startsWith('data:') ? route.continue() : route.abort(); });
        page = await context.newPage(); page.on('pageerror', error => result.errors.push(error.message)); page.on('dialog', d => d.accept());
        await page.goto(base, {waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => typeof UvUMusicToolsUI !== 'undefined' && document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.evaluate(async () => {
            db.characters = [{id:'layout_char',realName:'布局测试角色',remarkName:'布局测试角色',myName:'我',myAvatar:'',avatar:'',persona:'测试',history:[],maxMemory:20,worldBookIds:[]}]; db.groups = [];
            currentChatId = 'layout_char'; currentChatType = 'private'; ensureAllChatArchives(); await saveData(); setupMemoryLibrary();
            db.characters[0].musicProfile = {version:1,autonomous:false,updatedAt:0,tracks:Array.from({length:12},(_,i)=>({provider:'netease',id:'char_'+i,title:'角色歌曲 '+i+' · '+('长歌名'.repeat(12)),artists:['林间']}))};
            await UvUMusic.mutateLibrary(lib => { lib.playlists = [{id:'layout_a',name:'工具验证歌单',tracks:Array.from({length:1000}, (_,i) => ({provider:'netease',id:String(i),title:'测试歌曲 ' + i,artists:['林间'],duration:120,availability:'unknown'}))},{id:'layout_b',name:'待合并歌单',tracks:[{provider:'netease',id:'extra',title:'新歌曲',artists:['林间']}]}]; return lib; });
        });
        const sizes = [{width:390,height:844},{width:320,height:568},{width:768,height:1024},{width:844,height:390}];
        const shot = async name => { await page.waitForTimeout(250); return page.screenshot({path:path.join(out, name + '.png'),animations:'disabled'}); };
        async function panelBounds(selector) {
            const bounds = await page.locator(selector).evaluate(el => { const card = el.querySelector('.um-sheet-card'), body = el.querySelector('.um-sheet-body'), r = card.getBoundingClientRect(); return {width:r.width,height:r.height,top:r.top,bottom:r.bottom,scrollWidth:body.scrollWidth,clientWidth:body.clientWidth,viewportWidth:innerWidth,viewportHeight:innerHeight}; });
            assert.ok(bounds.width <= bounds.viewportWidth && bounds.top >= 0 && bounds.bottom <= bounds.viewportHeight + 1, JSON.stringify(bounds));
            assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, 'horizontal overflow: ' + JSON.stringify(bounds)); return bounds;
        }
        for (const size of sizes) {
            await page.setViewportSize(size); const entry = {size};
            await page.evaluate(() => switchScreen('memory-journal-screen'));
            const buttons = page.locator('#memory-journal-screen .auto-memory-entry button');
            const rects = await buttons.evaluateAll(items => items.map(e => { const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,text:e.textContent}; }));
            assert.equal(rects.length, 3); assert.ok(rects.every(r => r.height === 34 && Math.abs(r.y - rects[0].y) < 1 && Math.abs(r.width - rects[0].width) < 1)); entry.memory = rects;
            if (size.width === 390) await shot('memory-390');
            if (size.width === 390) {
                for (const [id, heading] of [['auto-memory-settings-btn','自动总结'],['vector-memory-settings-btn','向量记忆']]) { await page.locator('#' + id).click(); await page.locator('#auto-memory-modal.visible').waitFor(); assert.ok((await page.locator('#auto-memory-heading').innerText()).startsWith(heading)); await page.locator('#auto-memory-close').click(); }
                await page.locator('#memory-library-open').click(); await page.locator('.memory-library').waitFor(); await page.locator('.memory-library [data-action=close]').click(); result.interactions.push('All three memory entries open their existing panels');
            }
            await page.evaluate(() => { UvUMusicUI.open(); UvUMusicUI.characterPlaylist('layout_char'); });
            await page.getByRole('button',{name:'推荐与邀请设置',exact:true}).click();
            const character = page.getByRole('dialog',{name:'角色音乐设置',exact:true}); entry.character = await panelBounds('.um-character-options');
            const checks = await character.locator('.um-sheet-body > .um-check').evaluateAll(items => items.map(e => { const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,bottom:r.bottom}; }));
            assert.equal(checks.length,3); assert.ok(checks.every((r,i) => r.x === checks[0].x && (!i || r.y >= checks[i-1].bottom)));
            await character.getByLabel('推荐API来源').selectOption('custom'); await character.getByLabel('独立接口地址').waitFor(); entry.characterCustom = await panelBounds('.um-character-options');
            await character.getByLabel('推荐API来源').selectOption('secondary'); assert.equal(await character.getByLabel('独立接口地址').isVisible(), false);
            if (size.width === 390) { await character.getByLabel('推荐时使用下方已确认的音乐偏好',{exact:true}).check(); await character.getByLabel('已确认的音乐偏好',{exact:true}).fill('轻柔、纯音乐'); await character.getByLabel('主动邀请间隔（分钟）',{exact:true}).fill('90'); await shot('character-390'); }
            await character.getByRole('button',{name:'保存设置',exact:true}).click(); await page.getByRole('dialog',{name:'角色歌单',exact:true}).waitFor();
            const prefs = await page.evaluate(() => UvUMusicCharacter.options(db.characters[0])); assert.equal(prefs.apiSource,'secondary'); if (size.width === 390) { assert.equal(prefs.preferenceText,'轻柔、纯音乐'); assert.equal(prefs.preferences,true); assert.equal(prefs.cooldown,90); result.interactions.push('Character source, custom fields, preferences and interval save through existing settings'); }
            await page.evaluate(() => { UvUMusicUI.close(); UvUMusicExtensionsUI.open(); });
            const extension = page.getByRole('dialog',{name:'音乐扩展',exact:true}), helpButton = extension.getByRole('button',{name:'扩展使用说明',exact:true});
            await extension.getByRole('tab',{name:'声音',exact:true}).click(); await helpButton.click(); await page.locator('.um-extension-help:not([hidden])').waitFor();
            assert.equal(await extension.getByRole('tab',{name:'声音',exact:true}).getAttribute('aria-selected'),'true'); assert.equal(await extension.getByRole('tabpanel').filter({visible:true}).count(),1);
            const help = await page.locator('.um-extension-help').evaluate(e => { const r=e.getBoundingClientRect(),g=document.querySelector('.um-extension-help-glyph').getBoundingClientRect(); e.scrollTop=9999; return {width:r.width,height:r.height,circle:g.width,scrolls:e.scrollTop>0,notes:e.querySelectorAll('p').length}; });
            assert.ok(help.width <= 218 && help.height <= 174); assert.equal(help.circle,23); assert.ok(help.scrolls); assert.equal(help.notes,5); entry.help = help;
            entry.extensions = await panelBounds('.um-extension-sheet');
            if (size.width === 390) { await page.locator('.um-extension-help').evaluate(e => e.scrollTop=0); await shot('extensions-390'); }
            await page.keyboard.press('Escape'); assert.equal(await helpButton.getAttribute('aria-expanded'),'false'); assert.equal(await extension.count(),1);
            await helpButton.click(); await extension.getByRole('tab',{name:'离线音频',exact:true}).click(); assert.equal(await helpButton.getAttribute('aria-expanded'),'false');
            await page.keyboard.press('Escape'); assert.equal(await extension.count(),0);
            await page.evaluate(() => UvUMusicToolsUI.open());
            const tools = page.getByRole('dialog',{name:'资料库工具',exact:true}); entry.tools = await panelBounds('.um-tools');
            const actions = await tools.locator('.umt-actions button').evaluateAll(items => items.map(e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,height:r.height,width:r.width,overflow:e.scrollWidth>e.clientWidth}; }));
            assert.equal(actions.length,2); assert.ok(actions.every(r => r.height === 31 && Math.abs(r.y-actions[0].y)<1 && !r.overflow)); entry.actions = actions;
            const titleBefore = await tools.locator('header').boundingBox(), navBefore = await tools.locator('nav').boundingBox();
            await tools.locator('.um-sheet-body').evaluate(e => e.scrollTop=99999); assert.deepEqual(await tools.locator('header').boundingBox(),titleBefore); assert.deepEqual(await tools.locator('nav').boundingBox(),navBefore);
            assert.ok(await tools.locator('.um-sheet-body').evaluate(e => e.scrollTop>0)); await tools.locator('.um-sheet-body').evaluate(e => e.scrollTop=0);
            if (size.width === 390) await shot('tools-390');
            if (size.width === 320) { await shot('tools-320'); await tools.getByRole('button',{name:'筛选',exact:true}).click(); await panelBounds('.um-tools'); await tools.getByRole('button',{name:'导入',exact:true}).click(); await panelBounds('.um-tools'); await tools.getByRole('button',{name:'存储',exact:true}).click(); await tools.getByRole('button',{name:'生成含音频的分包'}).waitFor(); await panelBounds('.um-tools'); }
            await page.keyboard.press('Escape'); assert.equal(await tools.count(),0); assert.notEqual(await page.evaluate(() => document.body.style.overflow),'hidden'); result.viewports.push(entry);
        }
        await page.setViewportSize({width:390,height:844});
        await page.evaluate(async () => { await UvUMusic.mutateLibrary(lib=>{lib.playlists[0].tracks=lib.playlists[0].tracks.slice(0,8);return lib;}); UvUMusicToolsUI.open(); }); const tools=page.getByRole('dialog',{name:'资料库工具'});
        await tools.getByRole('textbox',{name:'新歌单名称',exact:true}).fill('布局复制验证'); await tools.getByRole('button',{name:'复制当前歌单',exact:true}).click();
        await page.waitForFunction(() => UvUMusic.library().playlists.some(p=>p.name==='布局复制验证'));
        await tools.getByRole('checkbox',{name:'待合并歌单',exact:true}).check(); await tools.getByRole('button',{name:'预览合并到当前歌单',exact:true}).click(); await tools.getByRole('button',{name:'确认合并',exact:true}).click();
        await page.waitForFunction(() => UvUMusic.library().playlists[0].tracks.some(t=>t.id==='extra')); await tools.getByRole('button',{name:'撤销刚才操作',exact:true}).click(); await page.waitForFunction(() => !UvUMusic.library().playlists[0].tracks.some(t=>t.id==='extra'));
        await page.keyboard.press('Escape'); result.interactions.push('Copy, choose source, merge preview/confirm and undo remain functional; header/tabs stay fixed with 1000 tracks');
        await page.evaluate(() => { localStorage.setItem('uvu-music-appearance','dark'); document.getElementById('uvu-music-screen').classList.add('um-dark'); UvUMusicToolsUI.open(); }); await shot('tools-dark-390'); await page.keyboard.press('Escape');
        assert.deepEqual(result.errors,[]); result.passed=true;
        fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(result,null,2)); console.log('PASS full-app four-panel layout: 4 viewports, memory entry actions, character settings save, compact help/keyboard/dismiss, fixed tools navigation, copy/merge/undo and dark appearance.');
        await context.close();
    } catch (error) { result.failure=String(error.stack||error); fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(result,null,2)); if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{}); throw error; }
    finally { await browser?.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
