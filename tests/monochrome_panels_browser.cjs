// Real application checks for the approved monochrome derivative surfaces.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/monochrome-panels');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'); res.end(bytes);
    });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        await context.addInitScript(() => {
            localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true');
            document.addEventListener('click', () => { if (typeof globalRescueClickCount !== 'undefined') globalRescueClickCount = 0; if (typeof globalRescueLastClickTime !== 'undefined') globalRescueLastClickTime = 0; }, true);
        });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        const page = await context.newPage(), errors = [], checks = [];
        page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.evaluate(async () => {
            db.characters = [{ id: 'mono-char', realName: '沈砚', remarkName: '沈砚', avatar: '', myAvatar: '', myName: '我', persona: '在旧书店工作，温和细致。', myPersona: '喜欢读书', maxMemory: 20, worldBookIds: [], history: [{ id: 'one', role: 'user', content: '明天一起去书店。', timestamp: Date.now() }], memoryJournals: [] }];
            db.groups = []; db.worldBooks = []; db.backupReminderSettings = { enabled: false };
            await saveData(); openChatRoom('mono-char', 'private');
        });
        async function shot(name, selector) {
            const panel = page.locator(selector); await panel.waitFor({ state: 'visible' });
            await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('uvu-mono-panel'), selector);
            for (const width of [320, 390, 768]) {
                await page.setViewportSize({ width, height: 844 });
                await panel.evaluate(e => Promise.all(e.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
                const rect = await panel.evaluate(e => ({ width: e.getBoundingClientRect().width, overflow: e.scrollWidth - e.clientWidth }));
                assert.ok(rect.width <= width + 1, name + JSON.stringify(rect)); assert.ok(rect.overflow <= 1, name + JSON.stringify(rect)); checks.push({ name, width, ...rect });
                if (width === 390) { await panel.evaluate(e => { e.scrollTop = 0; e.querySelectorAll('.ms-dialog-body,.cc-body').forEach(n => n.scrollTop = 0); }); await page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' }); }
            }
            await page.setViewportSize({ width: 390, height: 420 });
            const fullPage = await panel.evaluate(el => el.classList.contains('mono-page'));
            assert.ok((await panel.boundingBox()).height <= 420 * (fullPage ? 1 : .95) + 2, name + ' fits short screens');
            const footer = panel.locator(':scope > footer');
            if (await footer.count()) { await footer.scrollIntoViewIfNeeded(); const r = await footer.boundingBox(); assert.ok(r.y + r.height <= 421 && r.y >= 0, name + ' footer remains reachable'); }
            await page.setViewportSize({ width: 390, height: 844 });
        }
        await page.evaluate(() => { UvUMomentsUI.settings(db.characters[0]); });
        await shot('moments', '.ms-dialog');
        await page.getByRole('button', { name: '添加人物', exact: true }).click();
        await page.locator('.ms-dialog').last().getByLabel('姓名', { exact: true }).fill('林知');
        await page.locator('.ms-dialog').last().getByLabel('人设与口吻', { exact: true }).fill('书店邻居，说话直接。');
        await page.locator('.ms-dialog').last().getByRole('button', { name: '保存', exact: true }).click();
        await page.locator('.ms-npc-row').getByText('林知', { exact: true }).waitFor({ state: 'visible' });
        assert.equal(await page.locator('.ms-npc-row').getByText('林知', { exact: true }).count(), 1);
        await page.locator('.ms-dialog [data-action=close]').click();
        await page.evaluate(() => UvUCharacterCardUI.open(db.characters[0]));
        await shot('export-settings', '.cc-export-dialog');
        assert.equal(await page.locator('.mono-cover-preview').evaluate(e => e.open), false);
        await page.getByRole('button', { name: '预览原卡', exact: true }).click();
        assert.equal(await page.locator('.cc-portrait').isVisible(), true);
        assert.equal(await page.locator('.cc-portrait').evaluate(e => e.width / e.height), .75);
        await page.locator('.cc-export-dialog .sheet-close').click();
        await page.evaluate(() => { UvUMusicUI.open(); });
        await page.locator('#uvu-music-screen.active').waitFor();
        const music = page.locator('#uvu-music-screen');
        assert.equal(await music.locator('.uvu-mono-panel').count(), 0);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const before = await music.screenshot({ animations: 'disabled' });
        await page.evaluate(() => { document.querySelector('link[href*=monochrome_panels]').disabled = true; });
        const without = await music.screenshot({ animations: 'disabled' });
        assert.equal(before.equals(without), true, 'Music pixels are identical with the new stylesheet disabled');
        await page.evaluate(() => { document.querySelector('link[href*=monochrome_panels]').disabled = false; UvUMusicUI.accounts(); });
        await page.locator('.uvu-music-sheet').waitFor();
        assert.equal(await page.locator('.uvu-music-sheet .uvu-mono-panel').count(), 0);
        const login = await page.locator('.uvu-music-sheet').screenshot({ animations: 'disabled' });
        await page.evaluate(() => { document.querySelector('link[href*=monochrome_panels]').disabled = true; });
        assert.equal(login.equals(await page.locator('.uvu-music-sheet').screenshot({ animations: 'disabled' })), true, 'Music login remains visually identical');
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks, errors, musicPixelsPreserved: true, npcSaved: true }, null, 2));
        console.log('PASS monochrome social/export 320/390/768 + short-screen footer, NPC save, ID Card preview, identical music and account pixels, no page errors.');
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.closeAllConnections(); server.close(); process.exitCode = 1; });
