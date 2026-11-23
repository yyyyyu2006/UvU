// 完整应用、隔离 IndexedDB：新默认、旧存档不覆盖、主动应用/撤销和编辑持久化。
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const assert = require('node:assert/strict');
const runtime = require('./helpers/browser_runtime.cjs');
const root = path.resolve(__dirname, '..');
const libs = runtime.assetMap(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
const output = process.env.UVU_HOME_OUTPUT || path.join(root, 'outputs/home-default-layout');
fs.mkdirSync(output, { recursive: true });
const iconData = process.env.UVU_HOME_ICON_DATA ? JSON.parse(fs.readFileSync(process.env.UVU_HOME_ICON_DATA, 'utf8')) : {};
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
const icons = vm.runInNewContext(dbSource.slice(dbSource.indexOf('const defaultIcons'), dbSource.indexOf('const peekScreenApps')) + '\ndefaultIcons');
const imageUrls = new Map(Object.entries(iconData).map(([id, data]) => [icons[id].url, data]));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream'));
        res.end(data);
    });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await runtime.playwright().chromium.launch({ headless: true, executablePath: runtime.browserPath() });
    const checks = [], errors = [];
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
        await context.addInitScript(() => { localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true'); });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
            if (imageUrls.has(url)) { const data = imageUrls.get(url), comma = data.indexOf(','); return route.fulfill({ body: Buffer.from(data.slice(comma + 1), 'base64'), contentType: data.slice(5, data.indexOf(';')) }); }
            if (route.request().resourceType() === 'image') return route.fulfill({ body: png, contentType: 'image/png' });
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => { errors.push(error.message); console.error('Browser exception:',error.message); });
        page.on('dialog', dialog => dialog.accept());
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        const expected = await page.evaluate(() => db.homeLayoutPages);
        assert.deepEqual(expected.map(ids => ids.filter(id => id.startsWith('app-')).length), [4,8]);
        assert.deepEqual(expected.map(ids => ids.filter(id => id.startsWith('uvu-home-')).length), [2,2]);
        assert.equal(new Set(expected.flat()).size, 16);
        assert.equal(await page.locator('.uvu-home-default-page').count(), 2);
        assert.equal(await page.evaluate(() => atob(db.wallpaper.split(',')[1]).includes('fill="white"')), true);
        await page.waitForFunction(async () => (await dexieDB.globalSettings.get('homeLayoutPages'))?.value?.length === 2);
        for (const [width,height] of [[390,844],[320,844],[390,640],[768,900]]) {
            await page.setViewportSize({width,height});
            for (let number=1; number<=2; number++) {
                await page.evaluate(n => { const swiper=document.getElementById('home-screen-swiper'); swiper.style.scrollBehavior='auto'; swiper.scrollLeft=(n-1)*swiper.clientWidth; }, number);
                const geometry=await page.locator('#home-grid-layout-'+number).evaluate(grid => {
                    const b=grid.getBoundingClientRect(), nodes=[...grid.children].map(el=>({id:el.dataset.id,rect:el.getBoundingClientRect()}));
                    const overlap=nodes.some((a,i)=>nodes.slice(i+1).some(c=>Math.min(a.rect.right,c.rect.right)>Math.max(a.rect.left,c.rect.left)+1&&Math.min(a.rect.bottom,c.rect.bottom)>Math.max(a.rect.top,c.rect.top)+1));
                    return { overlap, fit:nodes.every(n=>n.rect.left>=b.left-1&&n.rect.right<=b.right+1), htmlOverflow:document.documentElement.scrollWidth>innerWidth };
                });
                assert.deepEqual(geometry,{overlap:false,fit:true,htmlOverflow:false});
                await page.screenshot({path:path.join(output,`home-${width}x${height}-page-${number}.png`)});
            }
            checks.push({width,height,overlap:false,horizontalOverflow:false});
        }
        await page.setViewportSize({width:390,height:844});
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => window.UvUDefaultHome && document.querySelectorAll('.uvu-home-default-page').length===2);
        assert.deepEqual(await page.evaluate(() => db.homeLayoutPages), expected);
        // 修改图文变量之后重绘/刷新仍保留；原模板和其他实例不变。
        await page.evaluate(async () => { db.addedWidgets.find(item=>item.id==='uvu-home-v1-quote').vars.title='我的新短句'; await saveData(); setupHomeScreen(); });
        assert.equal(await page.locator('#uvu-home-v1-quote .text-box').textContent(),'我的新短句');
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => document.querySelector('#uvu-home-v1-quote .text-box')?.textContent==='我的新短句');
        // 新主页正常入口可点击，不是草稿说明按钮。
        await page.locator('[data-target="chat-list-screen"]').first().click();
        await page.waitForFunction(()=>document.querySelector('.screen.active')?.id==='chat-list-screen');
        const original=await page.evaluate(async () => {
            db.homeLayoutPages=[['app-chat','app-api','app-wallpaper','app-worldbook','app-customize','app-tutorial','app-console','app-widget-market','app-reader','app-placeholder','app-uvu-music']];
            db.homeLayoutOrder=db.homeLayoutPages.flat(); db.addedWidgets=[];
            db.wallpaper='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
            db.customIcons={'chat-list-screen':db.wallpaper}; db.globalCss='#home-screen .app-name { letter-spacing: .2px; }';
            db.apiSettings={model:'offline'};
            db.backupReminderSettings={enabled:false}; await saveData(); setupHomeScreen();
            return {pages:db.homeLayoutPages,wallpaper:db.wallpaper,icons:db.customIcons,css:db.globalCss};
        });
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.getElementById('home-preset-export-btn')?.dataset.bound==='true');
        assert.deepEqual(await page.evaluate(()=>({pages:db.homeLayoutPages,wallpaper:db.wallpaper,icons:db.customIcons,css:db.globalCss})),original);
        assert.equal(await page.locator('.uvu-home-default-page').count(),0,'existing database is not silently replaced');
        await page.evaluate(()=>{renderCustomizeForm();switchScreen('customize-screen');});
        await page.getByRole('button',{name:'管理主页预设',exact:true}).click({timeout:5000}).catch(async error=>{throw new Error(error.message+'\nAPP MODAL: '+await page.locator('#error-modal-overlay').textContent());});
        if (await page.locator('#error-modal-overlay').isVisible()) throw new Error('Unexpected app error before applying default: '+await page.locator('#error-modal-overlay').textContent());
        await page.locator('#home-default-layout-btn').click({timeout:5000}).catch(async error=>{throw new Error(error.message+'\nAPP MODAL: '+await page.locator('#error-modal-overlay').textContent());});
        await page.locator('#home-preset-preview [data-cancel]').click();
        assert.deepEqual(await page.evaluate(()=>db.homeLayoutPages), original.pages);
        await page.locator('#home-default-layout-btn').click();
        await page.locator('#home-preset-preview [data-confirm]').click();
        await page.waitForFunction(()=>document.getElementById('home-preset-status').textContent.includes('已应用白色默认布局'));
        assert.deepEqual(await page.evaluate(()=>db.homeLayoutPages),expected);
        assert.deepEqual(await page.evaluate(()=>db.customIcons),original.icons);
        assert.equal(await page.evaluate(()=>db.globalCss),original.css);
        assert.equal(await page.evaluate(()=>db.apiSettings.model),'offline');
        await page.locator('#home-preset-undo').click();
        await page.waitForFunction(()=>document.getElementById('home-preset-status').textContent.includes('已恢复')&&!HomePresets.canUndo());
        assert.deepEqual(await page.evaluate(()=>({pages:db.homeLayoutPages,wallpaper:db.wallpaper,icons:db.customIcons,css:db.globalCss})),original,'undo restores the exact old home settings');
        await page.locator('#home-default-layout-btn').click();
        await page.locator('#home-preset-preview [data-confirm]').click();
        await page.waitForFunction(()=>document.querySelectorAll('.uvu-home-default-page').length===2);
        // 默认布局的留空位置和模板都能经过现有主页导入导出往返，并可撤销。
        await page.evaluate(async()=>{const preset=await HomePresets.createPreset('default roundtrip',false);await HomePresets.applyPreset(preset);});
        assert.equal(await page.locator('.uvu-home-default-page').count(),2);
        await page.locator('#home-default-layout-btn').click();
        await page.locator('#home-preset-preview [data-confirm]').click();
        await page.waitForFunction(()=>HomePresets.canUndo());
        await page.locator('#home-preset-undo').click();
        await page.waitForFunction(()=>!HomePresets.canUndo());
        // 上一次更换是另一个默认主页，撤销也保留其自定义图标。
        assert.deepEqual(await page.evaluate(()=>db.customIcons),original.icons);
        await page.evaluate(()=>{switchScreen('home-screen');enterHomeEditMode();});
        assert.equal(await page.locator('.uvu-home-default-page > [data-id]').evaluateAll(nodes=>nodes.every(n=>!n.style.gridColumn&&!n.style.gridRow)),true,'editing releases default positions');
        await page.evaluate(()=>exitHomeEditMode());
        assert.equal(await page.locator('.uvu-home-default-page > [data-id]').evaluateAll(nodes=>nodes.every(n=>n.style.gridColumn&&n.style.gridRow)),true);
        // 对新版默认网格实际长按拖动，不能只调用编辑模式函数自证。
        await page.evaluate(()=>{document.getElementById('home-screen-swiper').scrollLeft=0;});
        const cdp=await context.newCDPSession(page);
        const center=async id=>{const b=await page.locator(`[data-id="${id}"] .icon-img`).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
        const from=await center('app-uvu-music'), to=await center('app-chat');
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
        await page.waitForTimeout(1000);
        for(let n=1;n<=12;n++) {
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*n/12,y:from.y+(to.y-from.y)*n/12}]});
            await page.waitForTimeout(60);
        }
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForFunction(()=>db.homeLayoutPages[0].indexOf('app-uvu-music')<db.homeLayoutPages[0].indexOf('app-chat'));
        await page.waitForFunction(async()=>JSON.stringify((await dexieDB.globalSettings.get('homeLayoutPages')).value)===JSON.stringify(db.homeLayoutPages));
        const reordered=await page.evaluate(()=>db.homeLayoutPages);
        assert.equal(new Set(reordered.flat()).size,16);
        assert.deepEqual(reordered[1],expected[1]);
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelector('.uvu-home-default-page'));
        assert.deepEqual(await page.evaluate(()=>db.homeLayoutPages),reordered);
        assert.deepEqual(errors,[]);
        fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({completeApp:true,checks,existingSettingsPreserved:true,applyCancelUndo:true,editableVariablesPersist:true,exportImport:true,realTouchReorderAndReload:true,errors},null,2));
        console.log('Default home checks passed: white new database, 4/8 apps and four editable widgets, 4 viewports, reload, existing settings, apply/cancel/undo, preset roundtrip and edit-mode positions.');
    } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
