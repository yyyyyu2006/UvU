// Real Sortable + touch input: the preview must follow the finger, and sorting must persist.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://test').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
        res.end(data);
    });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
        await context.addInitScript(() => { localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true'); });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            return url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.evaluate(async () => {
            db.backupReminderSettings = { enabled: false };
            db.homeLayoutPages = [['app-chat', 'app-worldbook', 'app-api', 'app-customize', 'app-uvu-music'], ['app-placeholder', 'app-reader', 'app-wallpaper', 'app-tutorial', 'app-console', 'app-widget-market']];
            setupHomeScreen(); await saveData();
        });
        const cdp = await context.newCDPSession(page);
        const center = async id => { const b = await page.locator('[data-id="' + id + '"] .icon-img').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
        const start = await center('app-uvu-music');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        await page.waitForTimeout(1000);
        for (let i = 1; i <= 10; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (160 - start.x) * i / 10, y: start.y + (470 - start.y) * i / 10 }] });
            await page.waitForTimeout(60);
        }
        const preview = await page.locator('.sortable-fallback').boundingBox();
        assert.ok(preview && Math.abs(preview.x + preview.width / 2 - 160) < 35 && Math.abs(preview.y + preview.height / 2 - 470) < 35, 'drag preview follows the finger rather than staying at the original icon');
        const target = await center('app-chat');
        for (let i = 1; i <= 12; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160 + (target.x - 160) * i / 12, y: 470 + (target.y - 470) * i / 12 }] });
            await page.waitForTimeout(60);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => db.homeLayoutPages[0][0] === 'app-uvu-music');
        assert.equal(await page.evaluate(() => document.querySelector('.screen.active')?.id), 'home-screen', 'drag does not open music');
        await page.waitForFunction(async () => (await dexieDB.globalSettings.get('homeLayoutPages'))?.value?.[0]?.[0] === 'app-uvu-music');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.home-grid-layout > div')?.dataset.id === 'app-uvu-music');
        assert.deepEqual(errors, []);
        console.log('Home drag checks passed: real touch preview, music reorder, navigation isolation, IndexedDB persistence and reload.');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
