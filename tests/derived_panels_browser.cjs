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
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
        await context.addInitScript(() => { localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true'); document.addEventListener('click', () => { if (typeof globalRescueClickCount !== 'undefined') globalRescueClickCount = 0; if (typeof globalRescueLastClickTime !== 'undefined') globalRescueLastClickTime = 0; }, true); });
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
                memoryJournals: [{ id: 'journal-layout', title: '周末的约定', content: '我们约好周六上午一起去看展，之后在附近吃午饭。', createdAt: Date.now(), category: '日常', range: { start: 1, end: 2 } }] }];
            db.groups = []; db.backupReminderSettings = { enabled: false };
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
        const layoutFailures = [];
        async function checkActionLayout(name, width) {
            const failures = await page.evaluate(({name, width}) => {
                const failures = [], check = (ok, text) => { if (!ok) failures.push(text); };
                const rect = el => el.getBoundingClientRect();
                if (name === 'summary') {
                    for (const [selector, count] of [['.panel-summary-guides', 2], ['.panel-summary-options', 3]]) {
                        const rows = [...document.querySelectorAll(selector + ' > details')];
                        check(rows.length === count, selector + ' retains related controls');
                        for (let i = 1; i < rows.length; i++) check(rect(rows[i]).top - rect(rows[i - 1]).bottom <= 2, selector + ' rows stay adjacent');
                        check(rows.every(el => el.open || rect(el).height <= 46), selector + ' closed rows have no padded empty card');
                    }
                }
                if (name === 'editor' || name === 'editor-tools') {
                    const editor = document.querySelector('.text-editor-card'), draft = editor.querySelector('.editor-draft');
                    check(rect(editor).width <= Math.min(680, width - 32) + 1, 'Expanded editor has narrower side margins');
                    check(getComputedStyle(draft).fontSize === '14px', 'Expanded editor body stays 14px on touch');
                }
                if (name === 'file-preview') {
                    const header = document.querySelector('.shared-document-file-header');
                    check(Boolean(header.querySelector('.shared-document-name')) && Boolean(header.querySelector('.shared-document-upload')), 'File identity and replace share a header');
                    check(rect(header.querySelector('.shared-document-upload')).width < 60, 'File replace action stays small');
                }
                if (name === 'vector') {
                    const field = document.querySelector('.vector-memory-fieldset');
                    check([...field.querySelectorAll(':scope > section')].map(el => el.dataset.vectorSection).join(',') === 'enable,embedding,retrieval,rerank', 'Vector sections follow enable → embedding → retrieval → rerank');
                    const save = document.querySelector('#auto-memory-form > .auto-memory-actions button[type=submit]');
                    check(rect(save).width >= 240 && rect(save).height >= 44, 'Vector primary action spans the draft footer');
                    const guide = field.querySelector('.panel-vector-retrieval .auto-memory-guide');
                    check(guide && parseFloat(getComputedStyle(guide).paddingTop) === 0 && parseFloat(getComputedStyle(guide).borderTopWidth) === 0, 'Retrieval help has no extra nested card');
                }
                if (name === 'mcp') {
                    const settings = document.querySelector('.panel-mcp-options'), rows = [...settings.querySelectorAll(':scope > details')];
                    check(rows.length === 4, 'MCP permission, API, logs and guide remain available');
                    check(!document.querySelector('.mcp-services-area').closest('[hidden]'), 'MCP opens on the service overview');
                    const row = document.querySelector('.mcp-service-actions');
                    const buttons = [...(row?.querySelectorAll(':scope > button') || [])];
                    check(buttons.length === 3 && Boolean(document.querySelector('.mono-service-heading button')), 'Heading retains add; management retains edit, delete and test');
                }
                if (name === 'tavern') {
                    check(document.getElementById('uvu-story-bridge-screen').dataset.monoView === 'main', 'Tavern opens on the connection dashboard');
                    check([...document.querySelectorAll('.mono-bridge-page .mono-route')].some(el => el.textContent.includes('剧情审核') && el.getClientRects().length), 'Review has a visible dashboard entry');
                    const rows = [...document.querySelectorAll('.panel-bridge-metadata > details')];
                    check(rows.length === 3, 'Tavern receipt, archive and range share one group');
                    for (let i = 1; i < rows.length; i++) check(rect(rows[i]).top - rect(rows[i - 1]).bottom <= 2, 'Tavern handoff metadata stays adjacent');
                    check(rows.every(el => el.open || rect(el).height <= 46), 'Tavern closed metadata does not retain padding');
                    const toggle = document.getElementById('uvu-bridge-enabled'), title = toggle.closest('label');
                    check(Math.abs((rect(title).y + rect(title).height / 2) - (rect(toggle).y + rect(toggle).height / 2)) < 2, 'Connection title and switch share one row');
                }
                return failures;
            }, {name, width});
            layoutFailures.push(...failures.map(text => `${name}/${width}: ${text}`));
        }
        async function shot(name, selector, widths = [320, 390, 768]) {
            const panel = page.locator(selector); await panel.waitFor({ state: 'visible' });
            await panel.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
            for (const width of widths) {
                await page.setViewportSize({ width, height: 844 });
                // Viewport changes can restart intrinsic-size disclosure transitions.
                await panel.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
                const info = await panel.evaluate(el => {
                    const edge = el.getBoundingClientRect();
                    return { width: edge.width, scroll: el.scrollWidth, client: el.clientWidth, hidden: el.querySelectorAll('[hidden]').length,
                        overflow: [...el.querySelectorAll('*')].filter(n => n.getClientRects().length && (n.getBoundingClientRect().right > edge.right + 1 || n.scrollWidth > n.clientWidth + 1)).slice(0, 6).map(n => ({ tag: n.tagName, class: n.className, text: n.textContent.slice(0, 40), width: n.getBoundingClientRect().width, scroll: n.scrollWidth, client: n.clientWidth })) };
                });
                assert.ok(info.width <= width + 1, `${name}/${width}: ${JSON.stringify(info)}`);
                assert.ok(info.scroll <= info.client + 1, `${name}/${width}: horizontal overflow ${JSON.stringify(info)}`);
                await checkActionLayout(name, width);
                await page.screenshot({ path: path.join(out, `${name}-${width}.png`), animations: 'disabled' });
            }
            if (!['voice', 'tavern', 'notification', 'backup'].includes(name)) {
                await page.setViewportSize({ width: 390, height: 420 });
                const fullPage = await panel.evaluate(el => el.classList.contains('mono-page'));
                assert.ok((await panel.boundingBox()).height <= 420 * (fullPage ? 1 : .95) + 2, `${name}: fits shortened mobile viewport`);
                assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${name}: no horizontal overflow with keyboard`);
            }
            await page.setViewportSize({ width: 390, height: 844 });
        }
        await page.evaluate(() => openSharedDocumentDialog());
        await shot('file-empty', '#shared-document-dialog .shared-document-dialog');
        assert.equal(await page.locator('#shared-document-dialog .message-forward-close').evaluate(el => getComputedStyle(el).borderRadius), '50%');
        assert.equal(await page.locator('#shared-document-dialog .shared-document-name').evaluate(el => getComputedStyle(el).fontSize), '16px', 'Touch inputs retain readable size to avoid mobile focus zoom');
        await page.getByLabel('选择分享文件').setInputFiles({ name: '约定与计划.txt', mimeType: 'text/plain', buffer: Buffer.from('周末计划\n'.repeat(80)) });
        await page.locator('#shared-document-dialog .shared-document-actions').waitFor({ state: 'visible' });
        await shot('file-preview', '#shared-document-dialog .shared-document-dialog');
        await page.getByRole('button', { name: '使用说明', exact: true }).click();
        assert.equal(await page.locator('.shared-document-tutorial').isVisible(), true);
        await page.getByRole('button', { name: '使用说明', exact: true }).click();
        assert.equal(await page.locator('.shared-document-tutorial').isVisible(), false);
        await page.locator('.mono-file-shortcuts').getByRole('button', { name: '编辑', exact:true }).click();
        await page.locator('.shared-document-tools > button').click();
        await page.locator('.editor-draft').fill('暂存的文件草稿\n'.repeat(80));
        await page.locator('.editor-draft').evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
        await page.locator('#expanded-text-editor [data-action=keepDraft]').click();
        await page.locator('.shared-document-tools > button').click();
        assert.equal(await page.locator('.editor-draft').inputValue(), '暂存的文件草稿\n'.repeat(80));
        await page.waitForFunction(() => document.querySelector('.editor-draft').scrollTop > 100);
        await page.locator('#expanded-text-editor [data-action=apply]').click();
        assert.equal(await page.getByLabel('文件正文', { exact: true }).inputValue(), '暂存的文件草稿\n'.repeat(80), 'Expanded file draft applies to existing send field');
        await page.evaluate(() => document.getElementById('shared-document-dialog').dismissForward());
        await page.evaluate(() => openMemoryLibrary()); await shot('memory', '.memory-library .feature-dialog-card');
        const memoryExpand = page.locator('.memory-library .panel-text-action');
        await memoryExpand.click(); assert.equal(await memoryExpand.getAttribute('aria-expanded'), 'true');
        await page.evaluate(() => { const root = document.querySelector('.memory-library > .feature-dialog-card'); UvUPanelLayout.decorate(root); UvUPanelLayout.decorate(root); });
        assert.equal(await page.locator('.memory-library .panel-text-action').count(), 1, 'Repeated decoration retains one preview action');
        await page.locator('.memory-library [data-action=close]').click();
        await page.evaluate(() => document.getElementById('auto-memory-settings-btn').click());
        assert.equal(await page.locator('.vector-memory-fieldset').isVisible(), false);
        await shot('summary', '#auto-memory-modal .auto-memory-dialog');
        const statusText = await page.locator('#auto-memory-status').textContent();
        assert.deepEqual(await page.locator('.panel-stats strong').allTextContents(), [/有效楼层\s+(\d+)/, /已覆盖\s+(\d+)/, /未覆盖\s+(\d+)/].map(re => statusText.match(re)?.[1] || '—'), 'Displayed coverage uses existing source counts');
        await page.locator('#auto-memory-form [name=apiSource]').selectOption('memory');
        assert.equal(await page.locator('#memory-api-panel').isVisible(), true);
        await page.locator('#auto-memory-form [name=apiSource]').selectOption('primary');
        assert.equal(await page.locator('#memory-api-panel').isVisible(), false);
        await page.evaluate(() => { const input = document.querySelector('#auto-memory-form [name=requirements]'); input.dispatchEvent(new Event('invalid', { bubbles: false })); });
        assert.equal(await page.locator('.panel-summary-extra').evaluate(el => el.open), true, 'Validation exposes collapsed settings');
        const summaryHelp = page.locator('#auto-memory-form > .panel-summary-guides > .auto-memory-guide').filter({ has: page.locator('summary', { hasText: '记忆注入说明' }) });
        assert.equal(await summaryHelp.locator('p').isVisible(), false); await summaryHelp.locator('summary').click();
        await summaryHelp.locator('p').waitFor({ state: 'visible' });
        assert.equal(await summaryHelp.locator('p').isVisible(), true);
        await summaryHelp.locator('summary').click();
        await page.locator('.panel-summary-guides').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'summary-options-390.png'), animations: 'disabled' });
        await page.locator('#auto-memory-form [name=keepRecent]').fill('10');
        await page.locator('#auto-memory-form button[type=submit]').click();
        await page.waitForFunction(() => db.characters[0].autoMemorySettings?.keepRecent === 10 && !document.getElementById('auto-memory-modal').classList.contains('visible'));
        await page.evaluate(() => document.getElementById('vector-memory-settings-btn').click());
        assert.equal(await summaryHelp.isVisible(), false); assert.equal(await page.locator('.auto-memory-range').isVisible(), false);
        assert.equal(await page.locator('#vector-api-panel').evaluate(el => el.open), false);
        const closedVector = await page.locator('#vector-api-panel').evaluate(el => ({ height: el.getBoundingClientRect().height, summaryHeight: el.firstElementChild.getBoundingClientRect().height }));
        assert.equal(closedVector.height, closedVector.summaryHeight, 'Closing embedding settings immediately hides inner content');
        await shot('vector', '#auto-memory-modal .auto-memory-dialog');
        await page.locator('#vector-api-panel > summary').click();
        await shot('vector-embedding', '#auto-memory-modal .auto-memory-dialog');
        assert.equal(await page.locator('#vector-api-url').isVisible(), true);
        assert.equal(await page.locator('#vector-api-fetch-models').isVisible(), true);
        assert.equal(await page.locator('.vector-memory-fieldset > :last-child').getAttribute('class'), 'vector-refinements');
        const refinements = page.locator('.vector-refinements');
        await refinements.locator(':scope > details').nth(0).locator('summary').click();
        await page.locator('[name=vectorBodyTags]').fill('content,正文');
        await page.locator('[aria-label="清洗预览原文"]').fill('<status>忽略</status><content>海边约定。<thinking>秘密</thinking></content>');
        await page.getByRole('button', { name: '预览清洗', exact: true }).click();
        assert.equal(await page.locator('.vector-clean-preview').textContent(), '海边约定。');
        await page.locator('[name=vectorStableSources]').check();
        await shot('vector-cleaning', '#auto-memory-modal .auto-memory-dialog', [320, 390]);
        await refinements.locator(':scope > details').nth(0).locator('summary').click();
        await page.locator('.panel-embedding-advanced > summary').click();
        await shot('vector-advanced', '#auto-memory-modal .auto-memory-dialog', [320, 390]);
        assert.equal(await page.locator('#vector-api-batch-size').isVisible(), true);
        await page.locator('[name=vectorRerankEnabled]').check(); assert.equal(await page.locator('.panel-rerank-api').isVisible(), true);
        await shot('vector-rerank', '#auto-memory-modal .auto-memory-dialog', [320, 390]);
        assert.equal(await page.locator('#vector-api-rerank-model').isVisible(), true);
        await page.locator('[name=vectorRerankEnabled]').uncheck(); assert.equal(await page.locator('.panel-rerank-api').isVisible(), false);
        await page.locator('[name=vectorSearchEnabled]').check();
        await page.locator('#vector-api-url').fill('https://fixture.invalid/v1');
        await page.locator('#vector-api-key').fill('layout-vector-fixture');
        await page.locator('#vector-api-embedding-model').fill('layout-embedding');
        await page.locator('[name=vectorTopK]').fill('4');
        await page.locator('[name=vectorThreshold]').fill('0.3');
        await page.locator('#auto-memory-form button[type=submit]').click();
        await page.waitForFunction(() => db.characters[0].autoMemorySettings?.vectorTopK === 4 && !document.getElementById('auto-memory-modal').classList.contains('visible'));
        await page.evaluate(() => document.getElementById('vector-memory-settings-btn').click());
        assert.equal(await page.locator('[name=vectorSearchEnabled]').isChecked(), true);
        assert.equal(await page.locator('[name=vectorThreshold]').inputValue(), '0.3');
        assert.equal(await page.locator('[name=vectorStableSources]').isChecked(), true);
        assert.equal(await page.locator('[name=vectorBodyTags]').inputValue(), 'content,正文');
        await page.locator('#auto-memory-close').click();
        await page.evaluate(() => openCharacterAvatarSettings()); await shot('avatar', '#character-avatar-settings .derived-settings');
        await page.evaluate(() => document.getElementById('character-avatar-settings').dismissForward());
        await page.evaluate(() => { window.layoutReroll = showRegenerateGuidanceDialog(); });
        await shot('reroll', '.regenerate-guidance-card');
        await page.getByRole('textbox', { name: '回复修改方向' }).fill('稍微温柔一点');
        await page.locator('.regenerate-guidance-card [data-action=reroll]').click();
        assert.equal(await page.evaluate(() => window.layoutReroll), '稍微温柔一点');
        await page.evaluate(async () => {
            window.layoutMcpSettings = MCPServices.settings();
            const next = MCPServices.settings();
            next.services = ['天气', '日历'].map((name, i) => ({ id:'layout-service-' + i, name, url:'https://fixture.invalid/' + i, auth:'none', protocol:'auto', enabled:false, timeoutMs:20000, tools:{} }));
            await MCPServices.save(next); openMcpSettings();
        });
        assert.equal(await page.locator('.mcp-service-item').count(), 2);
        await page.getByRole('searchbox', { name:'搜索 MCP 服务' }).fill('日历');
        assert.equal(await page.locator('.mcp-service-item:visible').count(), 1);
        await page.getByRole('button', { name:'选择服务 日历', exact:true }).click();
        assert.equal(await page.getByRole('button', { name:'选择服务 日历', exact:true }).getAttribute('aria-pressed'), 'true');
        await page.locator('.mono-service-management > summary').click();
        await page.getByRole('button', { name:'编辑', exact:true }).click();
        assert.equal(await page.locator('#mcp-service-editor').getByLabel('名称', { exact:true }).inputValue(), '日历');
        await page.keyboard.press('Escape');
        await shot('mcp', '#mcp-services .mcp-settings');
        await page.getByRole('button', { name:'使用记录与设置', exact:true }).click();
        await page.locator('.panel-mcp-options').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'mcp-options-390.png'), animations: 'disabled' });
        const permission = page.locator('.panel-mcp-options > details').first();
        await permission.locator('summary').click(); await permission.locator('p').waitFor({ state: 'visible' });
        await permission.locator('summary').click();
        await page.evaluate(() => document.getElementById('mcp-services').dismissForward());
        await page.evaluate(async () => { await MCPServices.save(window.layoutMcpSettings); delete window.layoutMcpSettings; });
        await page.evaluate(() => openRelationshipDialog()); await shot('relationship', '.relationship-dialog');
        assert.ok(await page.locator('.relationship-quick-actions .relationship-action').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=40&&n.getBoundingClientRect().height<=44&&n.getBoundingClientRect().width<220)),'relationship actions retain compact v4 touch targets');
        const actionRows=await page.locator('.relationship-quick-actions').first().locator('button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.ok(Math.abs(actionRows[0]-actionRows[1])<1,'primary relationship actions share one row');
        await page.evaluate(() => document.getElementById('chat-relationship-dialog').dismissForward());
        await page.evaluate(() => openEnvironmentSettings(true)); await shot('environment', '#environment-settings .derived-settings');
        await page.evaluate(() => document.getElementById('environment-settings').dismissForward());
        await page.evaluate(() => openEnvironmentCalendar()); await shot('calendar', '.environment-calendar');
        const sourceDetails = page.locator('.uvu-calendar .calendar-data-details');
        assert.equal(await sourceDetails.count(), 1);
        assert.equal(await sourceDetails.locator('.environment-data-status').isVisible(), false);
        await sourceDetails.locator(':scope > summary').click();
        assert.equal(await sourceDetails.locator('.environment-data-status').isVisible(), true);
        await sourceDetails.locator(':scope > summary').click();
        const day = page.locator('.uvu-calendar .calendar-day').first(); await day.click();
        assert.equal(await day.getAttribute('aria-pressed'), 'true');
        assert.ok(await day.evaluate(el=>el.classList.contains('is-selected')),'selected date remains visually marked');
        assert.equal(await day.locator('.calendar-disc').evaluate(el=>getComputedStyle(el).backgroundColor), 'rgb(17, 17, 17)', 'Schedule selection uses the draft black date disc');
        assert.ok(await page.locator('.uvu-calendar .calendar-day-number').count()>=28);
        await page.evaluate(() => document.getElementById('environment-calendar').dismissForward());
        await page.evaluate(() => openStickerDescriptionSettings()); await shot('sticker', '.sticker-description-card');
        await page.locator('#sticker-description-settings [data-action=close]').click();
        await page.evaluate(() => {
            const target = document.createElement('textarea'); target.id = 'layout-edit-source'; target.value = '正文\n'.repeat(80); document.body.append(target); openExpandedEditor(target);
        });
        await shot('editor', '.text-editor-card');
        await page.locator('#expanded-text-editor [data-action=apply]').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.panel-editor-search > summary').evaluate(el => el === document.activeElement), true, 'Tab cycles to visible search summary');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('#expanded-text-editor [data-action=apply]').evaluate(el => el === document.activeElement), true);
        await page.locator('.editor-draft').press('Control+h');
        assert.equal(await page.locator('.panel-editor-search').evaluate(el => el.open), true, 'Existing replace shortcut reveals search');
        await page.locator('.editor-find').fill('正文');
        await page.waitForFunction(() => document.querySelector('.editor-count')?.textContent.includes('80'));
        await page.locator('.editor-replace').fill('新正文');
        await shot('editor-tools', '.text-editor-card');
        await page.locator('#expanded-text-editor [data-action=replaceAll]').click();
        assert.equal(await page.locator('.editor-draft').inputValue(), '新正文\n'.repeat(80));
        await page.locator('#expanded-text-editor [data-action=undo]').click();
        assert.equal(await page.locator('.editor-draft').inputValue(), '正文\n'.repeat(80));
        await page.locator('#expanded-text-editor [data-action=cancel]').click();
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
        await page.locator('#minimax-director-enabled').uncheck(); assert.equal(await page.locator('#minimax-director-fields').isVisible(), false);
        await page.locator('#minimax-tts-key').fill('layout-fixture-key'); await page.locator('#minimax-tts-voice').fill('layout-voice');
        await page.locator('#minimax-tts-save').click();
        await page.waitForFunction(() => db.minimaxTtsSettings?.voiceId === 'layout-voice');
        assert.equal(await page.evaluate(() => db.minimaxTtsSettings.director.enabled), false, 'Reparented voice settings keep original save handlers');
        await page.locator('#uvu-notification-preferences > summary').click();
        await shot('notification', '#uvu-notification-preferences');
        await page.getByRole('button', { name: '保存通知偏好', exact: true }).click();
        assert.match(await page.locator('#uvu-notification-preferences').textContent(), /已保存/);
        const recoveredBackup = await page.evaluate(async () => {
            const raw = new Blob([JSON.stringify({modules:{worldBooks:[{id:'recover-ee',content:'完整备份内容'}]}})]);
            const gzip = await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
            const modules = await storageReadBackup(new File([gzip], 'UwU_Backup.ee (1).txt'), {worldbooks:true});
            return modules.worldBooks[0];
        });
        assert.equal(recoveredBackup.content, '完整备份内容', 'real browser Worker recovers Android renamed EE backups');
        await page.evaluate(() => switchScreen('storage-analysis-screen'));
        await page.locator('#storage-backup-options .storage-setting-item').first().waitFor({ state: 'visible' });
        await shot('backup', '.storage-backup-extras:has(#storage-export-credentials)');
        await page.locator('[data-backup-mode=import]').click();
        assert.equal(await page.locator('[data-backup-mode=import]').getAttribute('aria-pressed'), 'true');
        await page.evaluate(() => switchScreen('uvu-story-bridge-screen'));
        assert.equal(await page.locator('#uvu-story-bridge-screen .mono-route').filter({ hasText:'剧情审核' }).isVisible(), true);
        assert.equal(await page.locator('#uvu-bridge-st-guide').getAttribute('open'), null);
        await shot('tavern', '#uvu-story-bridge-screen .uvu-bridge-page');
        await page.locator('.panel-segment [data-value=tt]').click();
        assert.equal(await page.locator('#uvu-bridge-channel').inputValue(), 'tt');
        await page.locator('#uvu-bridge-url').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#uvu-bridge-url').isVisible(), false, 'TT file mode does not show a server address after layout reparenting');
        await page.locator('#uvu-bridge-sync').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#uvu-bridge-sync').isVisible(), false, 'TT file mode hides online-only collection after reparenting');
        assert.equal(await page.locator('#uvu-story-bridge-screen .mono-route').filter({ hasText:'剧情审核' }).isVisible(), true);
        await page.locator('.panel-segment [data-value=st]').click();
        assert.equal(await page.locator('#uvu-bridge-channel').inputValue(), 'st');
        assert.equal(await page.locator('#uvu-bridge-sync').evaluate(el => el.hidden), false);
        await page.evaluate(() => { window.layoutOriginalTransaction = dexieDB.transaction; dexieDB.transaction = async () => { throw Error('测试存储失败'); }; });
        await page.locator('.panel-segment [data-value=tt]').click();
        await page.waitForFunction(() => document.querySelector('#uvu-bridge-status').textContent.includes('测试存储失败'));
        assert.equal(await page.locator('#uvu-bridge-channel').inputValue(), 'st');
        assert.equal(await page.locator('.panel-segment [data-value=st]').getAttribute('aria-pressed'), 'true', 'Async save rollback restores visible channel selection');
        assert.equal(await page.locator('.panel-bridge-config').evaluate(el => el.open), true, 'Returning to ST after rollback reveals its pairing controls');
        await page.evaluate(() => { dexieDB.transaction = window.layoutOriginalTransaction; delete window.layoutOriginalTransaction; });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.locator('.panel-segment').evaluate(el => getComputedStyle(el, '::before').transitionDuration), '0s');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.locator('#uvu-story-bridge-screen .mono-route').filter({ hasText:'剧情审核' }).click();
        await page.locator('.uvu-bridge-review').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'tavern-review-390.png'), animations: 'disabled' });
        await page.locator('#uvu-story-bridge-screen .mono-nav-back').click();
        await page.locator('#uvu-story-bridge-screen .mono-bridge-footer > button').first().click();
        await page.locator('.panel-bridge-metadata').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'tavern-metadata-390.png'), animations: 'disabled' });
        await page.locator('#uvu-bridge-handoff-source > summary').click();
        assert.equal(await page.locator('#uvu-bridge-handoff-source .uvu-bridge-handoff-detail-body').isVisible(), true);
        await page.locator('#uvu-bridge-handoff-source > summary').click();
        await page.locator('#uvu-story-bridge-screen .mono-nav-back').click();
        await page.locator('#uvu-story-bridge-screen .mono-route').filter({ hasText:'使用教程' }).click();
        await page.locator('#uvu-bridge-st-guide > summary').click(); assert.equal(await page.locator('#uvu-bridge-st-guide ol').isVisible(), true);
        await page.evaluate(() => openChatRoom('layout-char', 'private'));
        const after = await page.evaluate(() => { const b = document.getElementById('send-message-btn') || document.querySelector('#chat-room-screen .chat-input-area'); return b ? { html: b.outerHTML, width: getComputedStyle(b).width } : null; });
        assert.deepEqual(after, original); assert.deepEqual(errors, []);
        assert.deepEqual(layoutFailures, [], 'Reported layouts must be organized, compact and aligned');
        console.log('PASS actual app: derived panels at 320/390/768; file close pill, summary/vector separation and help, visible Tavern review/tutorial, voice director, model search, original chat controls unchanged.');
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
