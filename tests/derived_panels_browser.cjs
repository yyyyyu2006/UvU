// Actual application layout and disclosure regression; no external/paid requests.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(root, '../../outputs/derived-panels');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0], file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
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
        await context.addInitScript(() => { localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true'); });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.accept());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.evaluate(async () => {
            const avatar = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
            db.characters = [{ id: 'layout-char', realName: '林间', remarkName: '林间', avatar, myAvatar: avatar, myName: '我', persona: '人物设定', myPersona: '用户设定', maxMemory: 20, worldBookIds: [],
                history: Array.from({ length: 60 }, (_, i) => ({ id: 'floor-' + i, role: i % 2 ? 'assistant' : 'user', content: i % 2 ? '[林间的消息：周末一起去看展吧。]' : '好呀，周六见。', timestamp: Date.now() - (60 - i) * 60000 })),
                memoryJournals: [{ id: 'journal-layout', title: '周末的约定', content: '我们约好周六上午一起去看展，之后在附近吃午饭。', createdAt: Date.now(), category: '日常' }] }];
            db.groups = [];
            db.environmentSettings = { enabled: true, service: 'public', userLocation: { name: '上海', countryCode: 'CN', timezone: 'Asia/Shanghai', latitude: 31, longitude: 121 } };
            window.getEnvironmentWeather = async () => ({ text: '晴', temperature: 22, source: 'LOCAL_FIXTURE', fetchedAt: Date.now() });
            window.getEnvironmentHolidays = async () => ({ days: [], source: 'LOCAL_FIXTURE', fetchedAt: Date.now() });
            await saveData(); openChatRoom('layout-char', 'private');
        });
        const original = await page.evaluate(() => {
            const b = document.getElementById('send-message-btn') || document.querySelector('#chat-room-screen .chat-input-area');
            return b ? { html: b.outerHTML, width: getComputedStyle(b).width } : null;
        });
        assert.notEqual(original, null, 'Original chat button must exist for compatibility assertion');
        async function shot(name, selector, widths = [320, 390, 768]) {
            const panel = page.locator(selector); await panel.waitFor({ state: 'visible' });
            for (const width of widths) {
                await page.setViewportSize({ width, height: 844 });
                const info = await panel.evaluate(el => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth, hidden: el.querySelectorAll('[hidden]').length }));
                assert.ok(info.width <= width + 1, `${name}/${width}: ${JSON.stringify(info)}`);
                assert.ok(info.scroll <= info.client + 1, `${name}/${width}: horizontal overflow ${JSON.stringify(info)}`);
                await page.screenshot({ path: path.join(out, `${name}-${width}.png`), animations: 'disabled' });
            }
            if (!['voice', 'tavern'].includes(name)) {
                await page.setViewportSize({ width: 390, height: 420 });
                assert.ok((await panel.boundingBox()).height <= 420 * .95 + 2, `${name}: fits shortened mobile viewport`);
                assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${name}: no horizontal overflow with keyboard`);
            }
            await page.setViewportSize({ width: 390, height: 844 });
        }
        await page.evaluate(() => openSharedDocumentDialog());
        await shot('file-empty', '#shared-document-dialog .shared-document-dialog');
        assert.equal(await page.locator('#shared-document-dialog .message-forward-close').evaluate(el => getComputedStyle(el).borderRadius), '999px');
        await page.evaluate(() => document.getElementById('shared-document-dialog').dismissForward());
        await page.evaluate(() => openMemoryLibrary()); await shot('memory', '.memory-library .feature-dialog-card');
        await page.locator('.memory-library [data-action=close]').click();
        await page.evaluate(() => document.getElementById('auto-memory-settings-btn').click());
        assert.equal(await page.locator('.vector-memory-fieldset').isVisible(), false);
        await shot('summary', '#auto-memory-modal .auto-memory-dialog');
        const summaryHelp = page.locator('#auto-memory-form > .auto-memory-guide:first-of-type');
        assert.equal(await summaryHelp.locator('p').isVisible(), false); await summaryHelp.locator('summary').click();
        assert.equal(await summaryHelp.locator('p').isVisible(), true); await page.locator('#auto-memory-close').click();
        await page.evaluate(() => document.getElementById('vector-memory-settings-btn').click());
        assert.equal(await summaryHelp.isVisible(), false); assert.equal(await page.locator('.auto-memory-range').isVisible(), false);
        await page.locator('#vector-api-panel > summary').click(); await shot('vector', '#auto-memory-modal .auto-memory-dialog');
        await page.locator('#auto-memory-close').click();
        await page.evaluate(() => openMcpSettings()); await shot('mcp', '#mcp-services .mcp-settings');
        await page.evaluate(() => document.getElementById('mcp-services').dismissForward());
        await page.evaluate(() => openRelationshipDialog()); await shot('relationship', '.relationship-dialog');
        await page.evaluate(() => document.getElementById('chat-relationship-dialog').dismissForward());
        await page.evaluate(() => openEnvironmentSettings(true)); await shot('environment', '#environment-settings .derived-settings');
        await page.evaluate(() => document.getElementById('environment-settings').dismissForward());
        await page.evaluate(() => openEnvironmentCalendar()); await shot('calendar', '.environment-calendar');
        const dayStyles = await page.locator('.environment-calendar .environment-day').first().evaluate(el => {
            const result = {};
            for (const state of ['', 'is-today', 'is-offday', 'is-workday', 'is-selected']) {
                el.className = 'environment-day ' + state;
                const style = getComputedStyle(el);
                result[state || 'normal'] = { color: style.color, background: style.backgroundColor, border: style.borderTopColor, padding: style.padding, radius: style.borderTopLeftRadius };
            }
            return result;
        });
        assert.notEqual(dayStyles['is-today'].color, dayStyles.normal.color, 'Today stays visually distinct');
        assert.notEqual(dayStyles['is-offday'].background, dayStyles.normal.background, 'Holiday stays visually distinct');
        assert.notEqual(dayStyles['is-workday'].color, dayStyles.normal.color, 'Working day stays visually distinct');
        assert.notEqual(dayStyles['is-selected'].border, dayStyles.normal.border, 'Selected date keeps its border');
        assert.equal(dayStyles.normal.padding, '4px 2px'); assert.equal(dayStyles.normal.radius, '12px');
        await page.evaluate(() => document.getElementById('environment-calendar').dismissForward());
        await page.evaluate(() => openStickerDescriptionSettings()); await shot('sticker', '.sticker-description-card');
        await page.locator('#sticker-description-settings [data-action=close]').click();
        await page.evaluate(() => {
            const target = document.createElement('textarea'); target.id = 'layout-edit-source'; target.value = '正文\n'.repeat(80); document.body.append(target); openExpandedEditor(target);
        });
        await shot('editor', '.text-editor-card'); await page.locator('#expanded-text-editor [data-action=cancel]').click();
        await page.evaluate(() => { switchScreen('api-settings-screen'); const select = document.getElementById('api-model'); select.replaceChildren(new Option('模型 A', 'a'), new Option('模型 B', 'b')); });
        await page.locator('#api-model-picker').click(); await shot('models', '.model-picker-card');
        await page.getByRole('searchbox', { name: '搜索模型' }).fill('模型 B');
        assert.equal(await page.locator('.model-picker-list [role=option]').count(), 1);
        await page.locator('.model-picker-list [role=option]').click();
        assert.equal(await page.locator('#api-model').inputValue(), 'b');
        await page.locator('#minimax-tts-settings').scrollIntoViewIfNeeded();
        assert.deepEqual(await page.locator('.minimax-settings-section > strong').allTextContents(), ['语音接口', '音色与播放']);
        await page.locator('#minimax-director-enabled').check(); assert.equal(await page.locator('#minimax-director-fields').isVisible(), true);
        await shot('voice', '#minimax-tts-settings'); await page.locator('#minimax-director-fields').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'voice-director-390.png'), animations: 'disabled' });
        await page.evaluate(() => switchScreen('uvu-story-bridge-screen'));
        assert.equal(await page.locator('.uvu-bridge-review').isVisible(), true);
        assert.equal(await page.locator('#uvu-bridge-st-guide').getAttribute('open'), null);
        await shot('tavern', '#uvu-story-bridge-screen .uvu-bridge-page');
        await page.locator('.uvu-bridge-review').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'tavern-review-390.png'), animations: 'disabled' });
        await page.locator('#uvu-bridge-st-guide > summary').click(); assert.equal(await page.locator('#uvu-bridge-st-guide ol').isVisible(), true);
        await page.evaluate(() => openChatRoom('layout-char', 'private'));
        const after = await page.evaluate(() => { const b = document.getElementById('send-message-btn') || document.querySelector('#chat-room-screen .chat-input-area'); return b ? { html: b.outerHTML, width: getComputedStyle(b).width } : null; });
        assert.deepEqual(after, original); assert.deepEqual(errors, []);
        console.log('PASS actual app: 12 derived panels at 320/390/768; file close pill, summary/vector separation and help, visible Tavern review/tutorial, voice director, model search, original chat controls unchanged.');
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
