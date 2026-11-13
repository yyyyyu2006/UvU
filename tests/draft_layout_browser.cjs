// Reference structure checks, independent from the old dialog-size assertions.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.UVU_DRAFT_EVIDENCE || path.resolve(root, '../../outputs/draft-fidelity');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const libs = new Map([...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map((m, i) => [m[1], path.resolve(root, '../browser-test-assets', i + '.js')]));
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => { if (error) return res.writeHead(404).end(); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'); res.end(bytes); });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        await context.addInitScript(() => { localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true'); document.addEventListener('click', () => { if (typeof globalRescueClickCount !== 'undefined') globalRescueClickCount = 0; if (typeof globalRescueLastClickTime !== 'undefined') globalRescueLastClickTime = 0; }, true); });
        await context.route('**/*', route => { const url = route.request().url(); if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' }); return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort(); });
        const page = await context.newPage(), errors = [], failures = [], checks = [];
        page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.accept());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.evaluate(async () => {
            db.characters = [{ id: 'draft-char', realName: '沈砚', remarkName: '沈砚', avatar: '', myAvatar: '', myName: '我', persona: '在旧书店工作，温和细致。', myPersona: '喜欢读书', maxMemory: 20, worldBookIds: ['draft-book'], history: Array.from({ length: 60 }, (_, i) => ({ id: 'draft-' + i, role: i % 2 ? 'assistant' : 'user', content: i % 2 ? '周末一起去书店。' : '好呀，周六见。', timestamp: Date.now() - i * 1000 })), memoryJournals: [] }];
            db.groups = []; db.worldBooks = [{ id: 'draft-book', type: 'entry', name: '海边小城', content: '旧书店在海边。', position: 'before' }]; db.backupReminderSettings = { enabled: false }; await saveData(); openChatRoom('draft-char', 'private');
        });
        async function inspect(name, selector) {
            await page.locator(selector).waitFor({ state: 'visible' });
            await page.waitForFunction(s => document.querySelector(s)?.classList.contains('mono-page'), selector);
            for (const width of [390, 320, 768]) {
                await page.setViewportSize({ width, height: 844 });
                const result = await page.locator(selector).evaluate(el => {
                    const r = el.getBoundingClientRect(), title = el.querySelector('.mono-page-title'), nav = el.querySelector('.mono-page-nav'), foot = el.querySelector(':scope > footer,:scope > .shared-document-actions,:scope > .mcp-actions');
                    const rect = n => n && ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y, w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height });
                    return { panel: rect(el), title: rect(title), titleSize: title && getComputedStyle(title).fontSize, nav: rect(nav), footer: rect(foot), overflow: el.scrollWidth - el.clientWidth, height: innerHeight };
                });
                checks.push({ name, width, ...result });
                const check = (ok, message) => { if (!ok) failures.push(name + '/' + width + ': ' + message); };
                check(parseFloat(result.titleSize)>=20&&parseFloat(result.titleSize)<=32, 'title remains readable and compact');
                check(result.title && result.title.x>=result.panel.x && result.title.x+result.title.w<=result.panel.x+result.panel.w+1, 'title fits inside its panel');
                check(result.overflow <= 1, 'no horizontal overflow');
                check(result.panel.x >= 12 && result.panel.x + result.panel.w <= width - 12, 'sheet keeps side margins');
                check(result.panel.y >= 12 && result.panel.y + result.panel.h <= 832, 'sheet remains inset vertically');
                if (result.footer) check(result.footer.y + result.footer.h <= 845, 'action bar stays in viewport');
                if (width === 390) await page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' });
            }
            await page.setViewportSize({ width: 390, height: 844 });
        }
        await page.evaluate(() => openSharedDocumentDialog());
        await page.getByLabel('选择分享文件').setInputFiles({ name: '周末计划.txt', mimeType: 'text/plain', buffer: Buffer.from('周六上午去旧书店，下午一起看场电影。\n\n周日留给散步、拍照和一顿慢慢吃的晚餐。\n'.repeat(12)) });
        await page.locator('.shared-document-actions').waitFor({ state: 'visible' });
        await inspect('file-send', '#shared-document-dialog .shared-document-dialog');
        await require('./helpers/current_panel_contract.cjs').openFilePreview(page);
        assert.match(await page.locator('#shared-document-preview .draft-document-reader').textContent(), /周六上午/);
        await page.locator('#shared-document-preview .sheet-close').click();
        await page.locator('.mono-file-shortcuts').getByRole('button', { name: '编辑副本', exact: true }).click();
        await page.locator('.editor-draft').fill('修订后的周末计划');
        await page.locator('#expanded-text-editor [data-action=apply]').click();
        assert.equal(await page.getByLabel('文件正文', { exact: true }).inputValue(), '修订后的周末计划');
        await page.evaluate(() => document.getElementById('shared-document-dialog').dismissForward());
        await page.evaluate(() => UvUCharacterCardUI.open(db.characters[0]));
        await inspect('export', '.cc-export-dialog');
        await page.locator('.cc-export-dialog .sheet-close').click();
        await page.evaluate(() => UvUMomentsUI.settings(db.characters[0]));
        await inspect('npc', '.ms-dialog');
        await page.locator('.ms-dialog [data-action=close]').click();
        await page.evaluate(() => document.getElementById('vector-memory-settings-btn').click());
        await inspect('vector', '#auto-memory-modal .auto-memory-dialog');
        await page.locator('#auto-memory-close').click();
        await page.evaluate(async () => {
            const config = MCPServices.settings();
            config.services = [{ id: 'draft-service', name: '资料助手', url: 'https://fixture.invalid/mcp', auth: 'none', protocol: 'auto', enabled: false, timeoutMs: 20000, tools: {} }];
            await MCPServices.save(config); openMcpSettings();
        });
        await inspect('mcp', '#mcp-services .mcp-settings');
        await page.getByRole('button', { name: '工具授权', exact: true }).click();
        assert.equal(await page.locator('#mcp-services .mono-page-title').textContent(), '工具授权');
        assert.equal(await page.locator('.mcp-tools-area').isVisible(), true);
        await page.locator('#mcp-services .sheet-back').click();
        assert.equal(await page.locator('.mcp-services-area').isVisible(), true);
        await page.evaluate(() => document.getElementById('mcp-services').dismissForward());
        await page.evaluate(() => openEnvironmentCalendar());
        await inspect('calendar', '.uvu-calendar');
        await page.evaluate(() => document.getElementById('environment-calendar').dismissForward());
        await page.evaluate(() => {
            const chat = db.characters[0];
            chat.memoryJournals = [{ id: 'draft-scene', externalSceneId: 'draft-scene', source: 'sillytavern', title: '旧书店的约定', createdAt: Date.now(), isFavorited: false, content: '雨停后，两人走进旧书店。', bridgeReview: { version: 2, channel: 'st', archiveId: chat.activeArchiveId, status: 'pending', sourceText: '雨停后，两人走进旧书店。', items: [
                { id: 'floor-18', text: '雨停后，两人走进旧书店。沈砚找到那本散文集，递给你时，书页里落下一张旧车票。', selected: false, floor: { number: 18, speaker: '沈砚', extraction: 'tagged', bodyTag: 'content' } },
                { id: 'floor-19', text: '你们约好下周再来。离开前，沈砚提醒你周日带上那张书签。', selected: false, floor: { number: 19, speaker: '沈砚', extraction: 'tagged', bodyTag: 'content' } }
            ] } }];
        });
        await page.evaluate(() => switchScreen('uvu-story-bridge-screen'));
        await page.locator('#uvu-story-bridge-screen.active').waitFor();
        await page.screenshot({ path: path.join(out, 'tavern.png'), animations: 'disabled' });
        await page.locator('#uvu-story-bridge-screen').getByRole('button', { name: '剧情审核', exact: true }).click();
        assert.equal(await page.locator('.uvu-bridge-review').isVisible(), true);
        assert.equal(await page.locator('#uvu-story-bridge-settings').isVisible(), false);
        await page.locator('#uvu-bridge-review-list > details[data-draft-scene] > summary').first().click();
        assert.equal(await page.locator('.uvu-bridge-review-row').count(), 2);
        assert.equal(await page.locator('.uvu-bridge-review-row input[type=checkbox]').first().isChecked(), false, 'Layout does not approve received scenes');
        await page.locator('.uvu-bridge-page').evaluate(el => el.scrollTop = 0);
        await page.screenshot({ path: path.join(out, 'tavern-review.png'), animations: 'disabled' });
        const floor = page.locator('.uvu-bridge-review-floor').first(); await floor.locator('summary').click();
        await page.locator('#draft-floor-editor').getByRole('textbox', { name: '编辑整层剧情', exact: true }).fill('修订剧情一');
        await page.locator('#draft-floor-editor').getByRole('textbox', { name: '编辑整层剧情', exact: true }).fill('修订剧情二');
        await page.getByRole('button', { name: '完成编辑', exact: true }).click();
        assert.equal(await floor.locator('xpath=..').locator('.mono-story-excerpt').textContent(), '修订剧情二', 'Repeated edits update the collapsed scene excerpt');
        await page.locator('.mono-story-summary-settings > summary').click();
        await page.locator('.mono-story-summary-settings select').waitFor({state:'visible'});
        await page.locator('#uvu-story-bridge-screen .mono-nav-back').click();
        assert.equal(await page.locator('#uvu-story-bridge-screen').getAttribute('data-mono-view'), 'main');
        await page.locator('#uvu-story-bridge-screen').getByRole('button', { name: '角色与存档', exact: true }).click();
        assert.equal(await page.locator('.draft-role-choices input[value="draft-char"]').isChecked(), true);
        assert.equal(await page.locator('#uvu-bridge-save-character').isVisible(), true);
        fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ origin, browser: 'Chrome / Playwright; Browser plugin not available', checks, failures, errors }, null, 2));
        assert.deepEqual(errors, []); assert.deepEqual(failures, []);
        console.log('PASS approved inset sheet navigation, readable compact titles, file draft edits, Tavern review isolation, fixed action bars at 320/390/768.');
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.closeAllConnections(); server.close(); process.exitCode = 1; });
