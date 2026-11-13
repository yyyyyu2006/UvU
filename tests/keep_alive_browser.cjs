// Full application, isolated storage and local media only; no live accounts or AI calls.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/keepalive-browser');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'application/javascript', '.css':'text/css' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'); res.end(bytes);
    });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        const errors = [], geometry = [];
        await context.addInitScript(() => {
            localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true');
            document.addEventListener('click', () => { if (typeof globalRescueClickCount !== 'undefined') globalRescueClickCount = 0; if (typeof globalRescueLastClickTime !== 'undefined') globalRescueLastClickTime = 0; }, true);
        });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        async function open() {
            const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
            await page.goto(origin, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
            await page.evaluate(() => switchScreen('api-settings-screen')); return page;
        }
        const page = await open();
        await page.locator('#keep-alive-diagnostics > summary').click();
        for (const [width, height] of [[320,568],[390,420],[390,844],[768,1024]]) {
            await page.setViewportSize({ width, height });
            await page.locator('#keep-alive-diagnostics').scrollIntoViewIfNeeded();
            const g = await page.locator('#keep-alive-diagnostics').evaluate(el => {
                const box = el.getBoundingClientRect();
                return { x: box.x, right: box.right, overflow: el.scrollWidth - el.clientWidth, fontSize: getComputedStyle(el).fontSize };
            });
            assert.ok(g.x >= 0 && g.right <= width + 1 && g.overflow <= 1, JSON.stringify(g)); geometry.push({ width, height, ...g });
        }
        await page.setViewportSize({ width:390, height:844 });
        await page.locator('label:has(#keep-alive-switch)').click();
        await page.waitForFunction(() => db.apiSettings.keepAliveEnabled === true && !document.getElementById('keep-alive-switch').disabled);
        await page.waitForFunction(() => KeepAliveManager.getDiagnostics().audioPlaying);
        await page.evaluate(() => { navigator.mediaSession.metadata = new MediaMetadata({ title:'Fixture song', artist:'Test' }); navigator.mediaSession.playbackState = 'playing'; });
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('music-state', { detail: { phase:'loading' } })));
        assert.equal(await page.evaluate(() => KeepAliveManager.getDiagnostics().audioPlaying), false);
        await page.evaluate(() => { window.fixtureRelease = KeepAliveManager.suspendForMedia(); window.dispatchEvent(new CustomEvent('music-state', { detail:{ phase:'paused' } })); });
        assert.equal(await page.evaluate(() => KeepAliveManager.getDiagnostics().audioPlaying), false);
        await page.evaluate(() => fixtureRelease());
        await page.waitForFunction(() => KeepAliveManager.getDiagnostics().audioPlaying);
        assert.equal(await page.evaluate(() => navigator.mediaSession.metadata.title), 'Fixture song');
        await page.locator('#keep-alive-audio-switch').uncheck();
        await page.waitForFunction(() => db.apiSettings.keepAliveOptions?.compatibilityAudio === false && !document.getElementById('keep-alive-switch').disabled);
        assert.equal(await page.evaluate(() => KeepAliveManager.getDiagnostics().audioPlaying), false);
        await page.reload(); await page.waitForFunction(() => typeof db !== 'undefined' && document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.evaluate(() => switchScreen('api-settings-screen'));
        assert.equal(await page.locator('#keep-alive-switch').isChecked(), true);
        assert.equal(await page.evaluate(() => KeepAliveManager.getOptions().compatibilityAudio), false);
        await page.locator('#keep-alive-diagnostics > summary').click();
        await page.locator('#keep-alive-diagnostics').scrollIntoViewIfNeeded();
        assert.match(await page.locator('#keep-alive-diagnostic-result').innerText(), /网络/);
        await page.screenshot({ path:path.join(out,'settings-390.png') });
        await page.evaluate(() => { window.fixtureTransaction = dexieDB.transaction; dexieDB.transaction = async () => { throw Error('fixture quota'); }; });
        await page.locator('label:has(#keep-alive-switch)').click();
        await page.waitForFunction(() => !document.getElementById('keep-alive-switch').disabled);
        assert.equal(await page.locator('#keep-alive-switch').isChecked(), true);
        assert.equal(await page.evaluate(() => KeepAliveManager.isEnabled()), true);
        await page.evaluate(() => { dexieDB.transaction = fixtureTransaction; });
        const other = await open();
        await page.evaluate(() => { localStorage.removeItem('uvu-keepalive-tasks.v1'); localStorage.removeItem('uvu-keepalive-tasks.v1:autoReply'); });
        const calls = await Promise.all([page,other].map(p => p.evaluate(async () => { window.fixtureChecks = 0; await KeepAliveManager.scheduled('autoReply', () => { fixtureChecks++; }); return fixtureChecks; })));
        assert.equal(calls.reduce((a,b) => a+b, 0), 1);
        await Promise.all([page,other].map(p => p.evaluate(() => KeepAliveManager.setEnabled(false))));
        assert.equal(await page.evaluate(() => KeepAliveManager.getDiagnostics().audioPlaying), false);
        assert.equal(await page.evaluate(() => KeepAliveManager.getDiagnostics().screenAwake), false);
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out,'checks.json'), JSON.stringify({ geometry, checks:['settings controls','WAV playback','music and voice coexistence','reload preferences','save rollback','two pages one coordinator','teardown'], errors }, null, 2));
        console.log('Keepalive browser checks passed: full app, 320/390/768 and short screens, real WAV playback, media coexistence, persistence, rollback, two tabs, teardown.');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
