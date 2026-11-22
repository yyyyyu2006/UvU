// Complete app with synthetic data and mocked embeddings. No private DB or API.
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page(); page.setDefaultTimeout(6000); const missing = [];
        page.on('response', response => { if (response.url().startsWith(app.origin) && response.status() >= 400) missing.push(response.url()); });
        await page.evaluate(async () => {
            const avatar = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
            const chat = { id: 'quality', realName: '测试角色', remarkName: '测试角色', myName: '测试用户', avatar, myAvatar: avatar, maxMemory: 2,
                history: [], memoryJournals: [{ id: 'note', title: '约定', content: '周日归还。后来取消了安排。', range: { start: 0, end: 0 }, createdAt: 1700000000000 }], autoMemorySettings: {} };
            db.characters = [chat]; ensureAllChatArchives(); await saveData();
            currentChatId = chat.id; currentChatType = 'private'; openChatRoom(chat.id, 'private');
            document.getElementById('auto-memory-settings-btn').click();
        });
        await stableUI(page, '#auto-memory-modal');
        await page.locator('#auto-memory-modal .draft-summary-more > summary').click();
        await page.locator('#auto-memory-modal .draft-summary-advanced > summary').click();
        assert.equal(await page.locator('[name="summarySmartBatchEnabled"]').isChecked(), false);
        await page.locator('[name="summarySmartBatchEnabled"]').check();
        await page.locator('[name="summaryInputMaxTokens"]').fill('9000');
        await page.evaluate(() => document.getElementById('auto-memory-form').requestSubmit());
        await page.waitForFunction(() => db.characters[0].autoMemorySettings.summaryInputMaxTokens === 9000);
        await page.evaluate(() => { document.getElementById('auto-memory-close').click(); document.getElementById('vector-memory-settings-btn').click(); });
        await stableUI(page, '#auto-memory-modal');
        await page.locator('#auto-memory-modal .draft-vector-more > summary').click();
        const quality = page.locator('.vector-refinements details').filter({ has: page.locator('[name="vectorRRFEnabled"]') });
        await quality.locator('summary').click();
        for (const name of ['vectorRRFEnabled', 'vectorWeightedLexicalEnabled', 'vectorDiversityEnabled', 'vectorNeighborExpansionEnabled']) {
            assert.equal(await page.locator(`[name="${name}"]`).isChecked(), false);
            await page.locator(`[name="${name}"]`).check();
        }
        await page.evaluate(() => document.getElementById('auto-memory-form').requestSubmit());
        await page.waitForFunction(() => db.characters[0].autoMemorySettings.vectorRRFEnabled === true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        assert.deepEqual(await page.evaluate(() => ({ smart: db.characters[0].autoMemorySettings.summarySmartBatchEnabled,
            tokens: db.characters[0].autoMemorySettings.summaryInputMaxTokens, rrf: db.characters[0].autoMemorySettings.vectorRRFEnabled })), { smart: true, tokens: 9000, rrf: true });
        await page.evaluate(async () => {
            const chat = db.characters[0]; currentChatId = chat.id; currentChatType = 'private';
            Object.assign(chat.autoMemorySettings, { vectorSearchEnabled: true, vectorHybridEnabled: true, vectorThreshold: 0 });
            db.vectorMemoryApiSettings = { provider: 'newapi', url: 'https://fixture.invalid/v1', key: 'synthetic', embeddingModel: 'fixed' };
            requestMemoryEmbedding = async () => [1, 0]; requestMemoryEmbeddings = async rows => rows.map(() => [1, 0]);
            await getVectorMemoryContext(chat, '周日归还');
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('test denied'); } } });
            openMemoryLibrary();
            document.querySelector('.memory-library > .feature-dialog-card').monoNavigate?.('options');
        });
        await page.waitForFunction(() => typeof document.querySelector('.memory-library > .feature-dialog-card')?.monoNavigate === 'function');
        await page.locator('.memory-library .draft-memory-nav button[data-view="retrieval"]').click();
        const diag = page.locator('.memory-library-diagnostics'); await diag.locator(':scope > summary').click();
        await diag.getByText('查看来源 · 约定', { exact: true }).click();
        assert.match(await diag.locator('details').filter({ hasText: '查看来源 · 约定' }).first().textContent(), /后来取消/);
        await diag.getByRole('button', { name: '复制脱敏报告', exact: true }).click();
        const fallback = diag.getByRole('textbox', { name: '脱敏检索报告' }); assert.equal(await fallback.isVisible(), true);
        const report = await fallback.inputValue();
        for (const forbidden of ['周日归还', '后来取消', 'synthetic', 'fixture.invalid']) assert.ok(!report.includes(forbidden));
        assert.equal(JSON.parse(report).preparedSourceKeys.length, 0);
        const out = path.join(root, 'outputs/memory-review-20261122'); fs.mkdirSync(out, { recursive: true });
        for (const width of [320, 390, 768]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(await page.locator('.memory-library > .feature-dialog-card').first().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            await page.screenshot({ path: path.join(out, `quality-${width}.png`) });
        }
        assert.deepEqual(errors, []); assert.deepEqual(missing, []);
        console.log('PASS full app: optional defaults off, summary/vector saves and reload, source navigation, redacted copy fallback, 320/390/768 containment, no page or local resource errors.');
        await context.close();
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
