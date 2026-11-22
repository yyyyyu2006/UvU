// Full-app startup artwork, exit paths, style isolation and failure fallbacks.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const runtime = require('./helpers/browser_runtime.cjs'), root = path.resolve(__dirname, '..');
const out = path.join(root, 'outputs/startup-implementation-20261122');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), assets = runtime.assetMap(html);
const report = { viewports: [], checks: [], errors: [] };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
        res.end(data);
    });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await runtime.playwright().chromium.launch({ headless: true, executablePath: runtime.browserPath() });
        const base = 'http://127.0.0.1:' + server.address().port;
        async function open(options = {}) {
            const context = await browser.newContext({ viewport: options.size || { width: 390, height: 844 }, reducedMotion: options.reduce ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
            await context.addInitScript(({ noAnimate, brokenAnimate }) => {
                localStorage.setItem('lastSeenVersion', '1.8.9');
                localStorage.setItem('storage_persist_prompted', 'true');
                window.confirm = () => false;
                if (noAnimate) Element.prototype.animate = undefined;
                if (brokenAnimate) Element.prototype.animate = () => { throw new Error('Unsupported effect'); };
            }, options);
            await context.route('**/*', async route => {
                const url = route.request().url();
                if (assets.has(url)) return route.fulfill({ path: assets.get(url), contentType: 'application/javascript' });
                if (options.stallInit && url.includes('/js/main.js')) {
                    const source = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8').replace('await loadData();', 'await new Promise(() => {});');
                    return route.fulfill({ body: source, contentType: 'application/javascript' });
                }
                if (options.blockSplash && url.includes('/js/modules/startup_splash.js')) return route.abort();
                return url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror', error => report.errors.push(error.message));
            await page.goto(base, { waitUntil: 'domcontentloaded' });
            return { page, context };
        }
        for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
            const { page, context } = await open({ size });
            const art = await page.evaluate(() => {
                const host = document.getElementById('uvu-startup-screen'), shadow = host.shadowRoot;
                const sky = shadow.querySelector('.sky').getBoundingClientRect();
                const bounds = host.getBoundingClientRect();
                return { font: getComputedStyle(shadow.querySelector('h1')).fontSize, text: shadow.querySelector('h1').getAttribute('aria-label'), letters: shadow.querySelectorAll('.letter').length, sky: { x: sky.x, right: sky.right, bottom: sky.bottom }, bounds: { width: bounds.width, height: bounds.height }, glow: getComputedStyle(shadow.querySelector('.streak'), '::before').boxShadow };
            });
            assert.equal(art.font, '31px'); assert.equal(art.text, '两颗缠绕的心'); assert.equal(art.letters, 6);
            assert.equal(art.glow, 'none'); assert.equal(art.bounds.width, size.width); assert.equal(art.bounds.height, size.height);
            assert(art.sky.x >= size.width * .44 - 1); assert(art.sky.right <= size.width); assert(art.sky.bottom <= size.height * .29 + 25);
            await page.evaluate(() => {
                const shadow = document.getElementById('uvu-startup-screen').shadowRoot;
                shadow.getAnimations().forEach(a => { a.pause(); a.currentTime = 4200; });
            });
            await page.screenshot({ path: path.join(out, `actual-${size.width}x${size.height}.png`) });
            if (size.width === 390) {
                const style = await page.addStyleTag({ content: 'h1{font-size:70px!important;color:magenta!important}svg{display:none!important}button{font-size:40px!important;background:purple!important}*{font-family:Arial!important}' });
                const isolated = await page.evaluate(() => {
                    const s = document.getElementById('uvu-startup-screen').shadowRoot;
                    return { font: getComputedStyle(s.querySelector('h1')).fontSize, color: getComputedStyle(s.querySelector('h1')).color, threadDisplay: getComputedStyle(s.querySelector('.thread')).display, skipFont: getComputedStyle(s.querySelector('.skip')).fontSize };
                });
                assert.equal(isolated.font, '31px'); assert.equal(isolated.color, 'rgb(37, 39, 43)');
                assert.notEqual(isolated.threadDisplay, 'none'); assert.equal(isolated.skipFont, '12px');
                await style.evaluate(e => e.remove()); report.checks.push('Global theme sample cannot restyle startup internals');
                await page.keyboard.press('Tab');
                assert(await page.evaluate(() => document.getElementById('uvu-startup-screen').shadowRoot.activeElement.classList.contains('skip')));
            }
            await page.getByRole('button', { name: '跳过开屏动画' }).click();
            await page.waitForSelector('#uvu-startup-screen', { state: 'detached' });
            await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
            await page.evaluate(() => switchScreen('chat-list-screen'));
            assert(await page.locator('#chat-list-screen').evaluate(e => e.classList.contains('active')));
            report.viewports.push({ size, ...art, appNavigationAfterSkip: true });
            await context.close();
        }
        for (const mode of ['automatic', 'escape', 'reduce', 'reduceChange', 'noAnimate', 'brokenAnimate', 'blockSplash', 'stallInit']) {
            const { page, context } = await open({ [mode]: true });
            if (mode === 'escape') await page.keyboard.press('Escape');
            if (mode === 'reduceChange') await page.emulateMedia({ reducedMotion: 'reduce' });
            if (mode === 'reduce' || mode === 'noAnimate') {
                const staticArt = await page.evaluate(() => { const s = document.getElementById('uvu-startup-screen')?.shadowRoot; return s && { opacity: getComputedStyle(s.querySelector('.letter')).opacity, animations: s.getAnimations().length }; });
                if (staticArt) { assert.equal(staticArt.opacity, '1'); assert.equal(staticArt.animations, 0); }
            }
            await page.waitForSelector('#uvu-startup-screen', { state: 'detached', timeout: 6500 });
            if (mode !== 'stallInit') await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
            report.checks.push(mode + ': overlay removed; ' + (mode === 'stallInit' ? 'stalled init cannot trap overlay' : 'application initialized'));
            await context.close();
        }
        assert.deepEqual(report.errors, []);
        fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2));
        console.log('PASS full app: 4 viewports; theme isolation; keyboard/skip; automatic/reduced/failure exit; app navigation');
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
