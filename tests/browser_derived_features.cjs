// Optional visual/touch check: PLAYWRIGHT_MODULE and CHROME_PATH may override local runtimes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/15271130817/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.join(__dirname, '..');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage(), errors = [], apiCalls = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://uvu-derived.test/**', route => {
            const relative = new URL(route.request().url()).pathname.slice(1);
            if (!relative) return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><button id="char-status-btn">状态栏</button><div id="char-status-overlay" class="status-panel-overlay"><div id="char-status-content" class="status-panel-content"></div><button id="close-status-panel-btn" class="close-status-panel">关闭</button></div>' });
            const file = path.join(root, relative);
            return fs.existsSync(file) ? route.fulfill({ contentType: relative.endsWith('.json') ? 'application/json' : 'application/javascript', body: fs.readFileSync(file) }) : route.abort();
        });
        await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [{ name: '上海', latitude: 31.23, longitude: 121.47, country_code: 'CN', timezone: 'Asia/Shanghai' }] } }));
        await page.route('https://api.open-meteo.com/**', route => { apiCalls.push(route.request().url()); return route.fulfill({ json: { current: { temperature_2m: 21, weather_code: 2, time: '2026-11-04T12:00' } } }); });
        await page.goto('https://uvu-derived.test/');
        for (const file of ['css/chat.css', 'css/modules/derived_features.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
        await page.evaluate(() => {
            window.db = { characters: [{ id: 'c', activeArchiveId: 'a', realName: '测试角色', history: [], statusPanel: { history: [3, 2, 1].map(n => ({ timestamp: n, html: `<style>body{margin:0;background:#edf3fb}main{padding:32px;height:1800px}</style><main>历史状态 ${n}</main>` })) } }], groups: [] };
            window.currentChatId = 'c'; window.currentChatType = 'private'; window.processTemplate = html => html;
            window.saveData = async () => {}; window.showToast = message => { window.lastToast = message; };
        });
        for (const file of ['js/chat.js', 'js/modules/message_forward.js', 'js/modules/character_avatar.js', 'js/modules/environment.js', 'js/modules/environment_ui.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
        const chatSource = fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8');
        const start = chatSource.indexOf('    if (charStatusBtn) {'), end = chatSource.indexOf('    if (toggleExpansionBtn) {', start);
        await page.evaluate(snippet => {
            new Function('charStatusBtn', 'statusOverlay', 'closeStatusBtn', 'statusContent', snippet)(...['char-status-btn', 'char-status-overlay', 'close-status-panel-btn', 'char-status-content'].map(id => document.getElementById(id)));
        }, chatSource.slice(start, end));
        await page.locator('#char-status-btn').click(); await page.waitForTimeout(550);
        const cdp = await context.newCDPSession(page);
        async function swipe(from, to) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
            for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(650);
        }
        const initial = await page.locator('.status-swiper').evaluate(e => e.scrollLeft);
        await swipe({ x: 80, y: 340 }, { x: 320, y: 340 });
        const previous = await page.locator('.status-swiper').evaluate(e => e.scrollLeft);
        assert.ok(previous < initial - 100, `iframe swipe must change history: ${initial} -> ${previous}`);
        await page.locator('.status-flip-front [data-token-flip]').click(); await page.waitForTimeout(500);
        assert.equal(await page.locator('.status-flip-front').evaluate(e => e.inert), true);
        await page.locator('.status-flip-back [data-token-flip]').click(); await page.waitForTimeout(500);
        assert.equal(await page.locator('.status-flip-back').evaluate(e => e.inert), true);
        assert.equal(await page.locator('.status-swiper').evaluate(e => e.scrollLeft), previous);
        await swipe({ x: 320, y: 340 }, { x: 80, y: 340 });
        assert.ok(await page.locator('.status-swiper').evaluate(e => e.scrollLeft) > previous + 100);
        await page.locator('#close-status-panel-btn').click();
        const layout = [];
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(() => openCharacterAvatarSettings());
            let metrics = await page.locator('#character-avatar-settings .message-forward-dialog').evaluate(e => ({ width: e.clientWidth, scrollWidth: e.scrollWidth, height: e.clientHeight, viewport: innerHeight }));
            assert.ok(metrics.scrollWidth <= metrics.width); assert.ok(metrics.height < metrics.viewport);
            await page.screenshot({ path: path.join(root, '..', `derived-avatar-${width}.png`) });
            await page.locator('#character-avatar-settings .message-forward-close').click();
            await page.evaluate(() => openEnvironmentSettings(true));
            await page.locator('[data-place="user"] .derived-search input').fill('上海');
            await page.locator('[data-place="user"] .derived-search button').click();
            await page.locator('[data-place="user"] .derived-city-results button').click();
            await page.locator('[name="enabled"]').check();
            await page.locator('#environment-settings button[type="submit"]').click();
            await page.waitForFunction(() => db.environmentSettings?.enabled === true);
            assert.equal(await page.evaluate(() => db.characters[0].environmentProfile.aiEnabled), false);
            await page.locator('[data-mcp] summary').click();
            metrics = await page.locator('#environment-settings .message-forward-dialog').evaluate(e => ({ width: e.clientWidth, scrollWidth: e.scrollWidth, height: e.clientHeight, viewport: innerHeight }));
            assert.ok(metrics.scrollWidth <= metrics.width); assert.ok(metrics.height < metrics.viewport);
            await page.screenshot({ path: path.join(root, '..', `derived-settings-${width}.png`) });
            await page.locator('#environment-settings .message-forward-close').click();
            await page.evaluate(() => openEnvironmentCalendar());
            await page.waitForFunction(() => document.querySelector('.environment-calendar .derived-help')?.textContent.includes('21'));
            await page.getByRole('button', { name: '今天', exact: true }).click();
            assert.ok(await page.locator('.environment-day').count() >= 28);
            metrics = await page.locator('.environment-calendar').evaluate(e => ({ width: e.clientWidth, scrollWidth: e.scrollWidth }));
            assert.ok(metrics.scrollWidth <= metrics.width);
            const navRows = await page.locator('.environment-calendar .derived-toolbar').nth(1).evaluate(e => [...e.children].map(child => { const r = child.getBoundingClientRect(); return r.top + r.height / 2; }));
            assert.ok(Math.max(...navRows) - Math.min(...navRows) < 2, 'calendar month controls fit one row');
            const output = path.join(root, '..', `derived-calendar-${width}.png`); await page.screenshot({ path: output });
            await page.locator('#environment-calendar .message-forward-close').click();
            layout.push({ width, noOverflow: true, settingsSaved: true });
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ touchHistory: { initial, previous, flipPreservesPosition: true }, layout, weatherRequests: apiCalls.length, errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
