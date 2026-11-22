// Full application, isolated browser storage and synthetic data. No model requests.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page();
        const missing = []; page.on('response', response => { if (response.url().startsWith(app.origin) && response.status() >= 400) missing.push(response.url()); });
        await page.evaluate(async () => {
            const avatar = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
            const chat = { id: 'reading', realName: '测试角色', remarkName: '测试角色', myName: '测试用户', avatar, myAvatar: avatar, maxMemory: 20,
                history: [{ id: 'original', role: 'user', content: '周五还书，尚未完成。', timestamp: 1700000000000 }], memoryJournals: [],
                autoMemorySettings: { enabled: false, useMemory: true, hideSummarized: true, contextInjectionOptIn: true } };
            db.characters = [chat]; ensureAllChatArchives();
            chat.memoryJournals.push({ id: 'summary', title: '测试总结', content: '测试用户计划周五还书，尚未完成。', range: { start: 1, end: 1 }, createdAt: 1700000001000, isFavorited: false,
                autoMemory: { version: 1, kind: 'summary', committed: true, sources: [{ id: 'original', hash: autoMemoryMessageHash(chat.history[0]) }] } });
            await saveData(); currentChatId = chat.id; currentChatType = 'private'; openChatRoom(chat.id, 'private');
        });
        assert.equal(await page.locator('#message-area .message-wrapper[data-id="original"]').count(), 1);
        assert.equal(await page.locator('.auto-memory-fold-notice').count(), 0);
        await page.evaluate(() => document.getElementById('auto-memory-settings-btn').click());
        await stableUI(page, '#auto-memory-modal');
        assert.equal(await page.locator('[name="useMemory"],[name="hideSummarized"],#auto-memory-show-original').count(), 0);
        assert.match(await page.locator('#auto-memory-migration-notice').textContent(), /不再替代或折叠/);
        assert.equal(await page.locator('#auto-memory-migration-notice').isVisible(), true);
        const out = path.join(root, 'outputs/memory-review-20261122'); fs.mkdirSync(out, { recursive: true });
        for (const width of [320, 390, 768]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(await page.locator('#auto-memory-modal .auto-memory-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            await page.screenshot({ path: path.join(out, `summary-${width}.png`) });
        }
        await page.evaluate(() => document.getElementById('auto-memory-form').requestSubmit());
        await page.waitForFunction(() => db.characters[0].autoMemorySettings.summaryReadingVersion === 2);
        assert.equal(await page.evaluate(() => db.characters[0].autoMemorySettings.useMemory), true);
        await page.evaluate(() => { document.getElementById('auto-memory-close').click(); switchScreen('memory-journal-screen'); renderJournalList(); });
        const star = page.locator('.journal-card[data-id="summary"] .favorite-journal-btn');
        assert.equal(await star.isEnabled(), true); await star.click();
        assert.equal(await page.evaluate(() => getContextMemoryJournals(db.characters[0]).length), 1);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        assert.deepEqual(await page.evaluate(() => ({ favorite: getContextMemoryJournals(db.characters[0]).length, history: getAutoMemoryContextHistory(db.characters[0]).length,
            oldSetting: db.characters[0].autoMemorySettings.useMemory, notice: getAutoMemoryMigrationNotice(db.characters[0]) })), { favorite: 1, history: 1, oldSetting: true, notice: '' });
        assert.deepEqual(errors, []); assert.deepEqual(missing, []);
        console.log('PASS full app: retired controls absent, originals visible, migration notice+save, favorite+reload, 320/390/768 containment, no page errors or local asset failures.');
        await context.close();
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
