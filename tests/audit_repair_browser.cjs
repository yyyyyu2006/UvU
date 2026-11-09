// Real app, isolated browser profile, local fixture data and no external API calls.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/audit-repair-browser');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'); res.end(bytes);
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
            document.addEventListener('click', () => { if (typeof globalRescueClickCount !== 'undefined') globalRescueClickCount = 0; }, true);
        });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.evaluate(async () => {
            db.characters = [{ id: 'repair', activeArchiveId: 'a', realName: '测试角色', remarkName: '测试角色', myName: '我', history: [{ id: 'one', role: 'user', content: '原聊天' }],
                memoryJournals: [{ id: 'journal', title: '保留日记', content: '原内容' }], maxMemory: 20, worldBookIds: [],
                archives: [{ id: 'a', name: '当前档', data: {} }, { id: 'old', name: '旧模型存档', data: {} }],
                statusPanel: { enabled: true, currentStatusHtml: '<p>当前状态</p>', history: [{ html: '<p>状态内容</p>', timestamp: 1 }] } }];
            db.groups = []; db.backupReminderSettings = { enabled: false }; await saveData();
            currentChatId = 'repair'; currentChatType = 'private'; openChatRoom('repair', 'private');
            const chat = db.characters[0], index = { journal: { version: 2, chunks: [{ key: 'v', start: 0, end: 3, vector: [1, 0] }] } };
            await VectorIndexStore.commit(VectorMemoryTools.indexScope(chat, vectorMemoryApiFingerprint(resolveVectorMemoryApi())), index, 'current');
            await VectorIndexStore.commit(JSON.stringify(['character', 'repair', 'old', 'old-model']), index, 'old');
            await VectorIndexStore.commit(JSON.stringify(['character', 'other', 'old', 'old-model']), index, 'other');
            openMemoryLibrary();
        });
        await page.locator('.memory-library-cache > summary').click();
        await page.waitForFunction(() => document.querySelectorAll('.memory-library-cache-row').length === 2);
        assert.equal(await page.locator('.memory-library-cache-row button:disabled').textContent(), '使用中');
        for (const width of [320, 390, 768]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(await page.locator('.memory-library > .feature-dialog-card').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            await page.screenshot({ path: path.join(out, 'cache-' + width + '.png') });
        }
        await page.locator('.memory-library-cache-row button:not(:disabled)').click();
        await page.waitForFunction(() => document.querySelectorAll('.memory-library-cache-row').length === 1);
        const preserved = await page.evaluate(async () => ({
            scopes: (await VectorIndexStore.listScopes()).length, history: db.characters[0].history[0].content,
            journal: db.characters[0].memoryJournals[0].content
        }));
        assert.deepEqual(preserved, { scopes: 2, history: '原聊天', journal: '原内容' });
        await page.locator('.memory-library [data-action=close]').click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#char-status-btn').click();
        try { await page.waitForFunction(() => document.activeElement?.id === 'close-status-panel-btn', null, { timeout: 3000 }); }
        catch (error) { console.error(await page.evaluate(() => ({ active: document.activeElement?.outerHTML?.slice(0,120), overlays:[...document.querySelectorAll('.feature-dialog,.message-forward-overlay,#char-status-overlay')].map(el=>({id:el.id,cls:el.className,inert:el.inert,anc:el.closest('[inert]')?.id,visible:getComputedStyle(el).visibility,display:getComputedStyle(el).display})),close:document.getElementById('close-status-panel-btn')?.outerHTML })), errors); throw error; }
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.getElementById('char-status-overlay').contains(document.activeElement)), true);
        await page.locator('.status-token-toggle[data-token-flip]').click();
        assert.equal(await page.locator('.status-flip-front').getAttribute('aria-hidden'), 'true');
        await page.screenshot({ path: path.join(out, 'token-390.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('char-status-overlay').classList.contains('visible'));
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'char-status-btn');
        await page.locator('#char-status-btn').click(); await page.locator('#close-status-panel-btn').click();
        await page.waitForFunction(() => document.activeElement?.id === 'char-status-btn');
        assert.deepEqual(errors, []);
        console.log('PASS cache scope isolation/deletion/current protection/originals retained; 320/390/768 layouts; status Tab/Escape/focus return/token flip/body containment; isolated real Chromium.');
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
