// Full UvU page, isolated browser storage, and blocked external services.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const runtime = require('./helpers/browser_runtime.cjs');
const root = path.resolve(__dirname, '..');
const libs = runtime.assetMap(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
const output = path.join(os.tmpdir(), 'uvu-minesweeper-browser');
fs.mkdirSync(output, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'));
        res.end(data);
    });
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await runtime.playwright().chromium.launch({ headless: true, executablePath: runtime.browserPath() });
    const errors = [];
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
        await context.addInitScript(() => {
            localStorage.setItem('lastSeenVersion', '1.8.9');
            localStorage.setItem('storage_persist_prompted', 'true');
        });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
            if (route.request().resourceType() === 'image') return route.fulfill({ body: png, contentType: 'image/png' });
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-id="app-minesweeper"]') && document.getElementById('uvu-minesweeper-screen'));
        const homeEntry = page.locator('[data-id="app-minesweeper"] .app-icon');
        const hub = page.locator('#uvu-game-hub-screen');
        const gameCard = hub.getByRole('button', { name: '扫雷', exact: true });
        assert.equal(await homeEntry.innerText(), '游戏大厅');
        assert.equal(await homeEntry.locator('img').getAttribute('src'), 'assets/icons/game-hub.svg');
        await homeEntry.locator('img').evaluate(node => node.decode());
        await homeEntry.click();
        await hub.waitFor({ state: 'visible' });
        assert.equal(await hub.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'uvu-game-hub-title');
        assert.equal(await hub.getByRole('listitem').count(), 2, 'the game hall now lists Minesweeper and Gomoku');
        await gameCard.locator('img').evaluate(node => node.decode());
        await page.screenshot({ path: path.join(output, 'game-hub-390.png'), animations: 'disabled' });
        await page.keyboard.press('Tab');
        assert.equal(await gameCard.evaluate(node => document.activeElement === node), true);
        await page.keyboard.press('Enter');
        const screen = page.locator('#uvu-minesweeper-screen');
        await screen.waitFor({ state: 'visible' });
        assert.equal(await screen.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
        assert.equal(await page.locator('.ms-cell').count(), 81);
        assert.equal(await screen.locator('.ms-mines').textContent(), '10');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), '扫雷');

        await screen.locator('[data-ms-flag]').click();
        await screen.locator('[data-ms-cell="0"]').click();
        assert.equal(await screen.locator('.ms-mines').textContent(), '9', 'touch-friendly flag mode marks a cell');
        await screen.locator('[data-ms-flag]').click();
        await screen.locator('[data-ms-flag]').click();
        await screen.locator('[data-ms-cell="0"]').click();
        assert.equal(await screen.locator('.ms-mines').textContent(), '10', 'the flag can be removed');
        await screen.locator('[data-ms-flag]').click();
        await screen.locator('[data-ms-cell="0"]').click();
        assert.ok(!['mine', 'hit'].includes(await screen.locator('[data-ms-cell="0"]').getAttribute('data-kind')), 'the first reveal is safe');
        assert.equal(await page.locator('#global-rescue-panel').count(), 0, 'normal fast game taps do not trigger the global CSS rescue');
        await page.waitForTimeout(1100);
        assert.notEqual(await screen.locator('.ms-time').textContent(), '00:00', 'timer advances after starting');
        const revealedKind = await screen.locator('[data-ms-cell="0"]').getAttribute('data-kind');
        await screen.getByRole('button', { name: '返回游戏大厅' }).click();
        assert.equal(await gameCard.evaluate(node => node === document.activeElement), true, 'return focuses the game card');
        await hub.getByRole('button', { name: '返回桌面' }).click();
        assert.equal(await homeEntry.evaluate(node => node === document.activeElement), true, 'return focuses the desktop entry');
        await page.keyboard.press('Enter');
        await gameCard.click();
        assert.equal(await screen.locator('[data-ms-cell="0"]').getAttribute('data-kind'), revealedKind, 'leaving and reopening a game keeps its board');
        assert.notEqual(await screen.locator('.ms-time').textContent(), '00:00');
        assert.equal(await page.locator('#global-rescue-panel').count(), 0, 'navigation does not trigger the global CSS rescue');

        await screen.locator('[data-ms-reset]').click();
        assert.equal(await screen.locator('.ms-time').textContent(), '00:00');
        await screen.locator('[data-ms-level="intermediate"]').click();
        assert.equal(await page.locator('.ms-cell').count(), 256);
        await screen.locator('[data-ms-level="expert"]').click();
        await page.setViewportSize({ width: 320, height: 640 });
        assert.equal(await page.locator('.ms-cell').count(), 480);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'wide board does not widen the page');
        assert.equal(await screen.locator('.ms-board-viewport').evaluate(node => node.scrollWidth > node.clientWidth), true, 'only the expert board scrolls horizontally');
        await screen.getByRole('button', { name: '返回游戏大厅' }).click();
        assert.equal(await hub.evaluate(node => node.scrollWidth > node.clientWidth), false, 'the hub fits a 320px viewport');
        await gameCard.click();
        await screen.locator('[data-ms-level="beginner"]').click();
        await screen.locator('[data-ms-cell="0"]').focus();
        await screen.locator('[data-ms-cell="0"]').press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.msCell), '1', 'arrow navigation follows the visible grid');

        await screen.locator('[data-ms-help]').click();
        assert.equal(await screen.locator('.ms-help').evaluate(node => node.open), true);
        await page.keyboard.press('Escape');
        assert.equal(await screen.locator('.ms-help').evaluate(node => node.open), false, 'native dialog closes on Escape');

        await page.evaluate(async () => {
            db.customIcons['uvu-minesweeper-screen'] = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="1"/></svg>';
            await saveData();
            setupHomeScreen();
        });
        assert.match(await page.locator('[data-id="app-minesweeper"] img').getAttribute('src'), /^data:image\/svg\+xml/, 'custom icon overrides the default safely');

        await page.evaluate(() => {
            db.homeLayoutPages = [
                ['uvu-home-v1-top', 'uvu-home-v1-ins', 'app-chat', 'app-uvu-music', 'app-reader', 'app-placeholder'],
                ['uvu-home-v1-photo', 'app-worldbook', 'app-api', 'app-customize', 'app-widget-market', 'app-wallpaper', 'uvu-home-v1-quote', 'app-tutorial', 'app-console']
            ];
            const migrated = UvUDefaultHome.migrateLayout(db.homeLayoutPages);
            db.homeLayoutPages = migrated;
        });
        assert.equal(await page.evaluate(() => db.homeLayoutPages[1].at(-1)), 'app-minesweeper', 'old untouched default home places the new app on page two');
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(output, 'minesweeper-320.png') });
        console.log('Game hub and Minesweeper browser checks passed: round-trip navigation, keyboard focus, white UI, narrow viewport, custom icon, board retention, flag, first-safe reveal, timer, all board sizes, grid navigation, help, and layout migration.');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
