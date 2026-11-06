const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, '../../uvu-verification-deps/node_modules/playwright'));
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="memory-journal-screen"></main>');
        for (const file of ['document_features.css', 'journal.css', 'ui_harmony.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../css/modules', file), 'utf8') });
        await page.evaluate(() => {
            window.currentChatId = 'c'; window.currentChatType = 'private'; window.renderJournalList = () => {}; window.saveData = async () => {}; window.showToast = () => {};
            window.db = { characters: [{ id: 'c', activeArchiveId: 'a', history: [{ id: 'source', role: 'user', content: '去海边看日落', timestamp: 1700000000000 }],
                memoryJournals: Array.from({ length: 45 }, (_, i) => ({ id: `j${i}`, title: `manual${i}`, content: `事实${i}`, createdAt: 1700000000000 + i })), autoMemorySettings: { summaryQualityReviewEnabled: true } }], groups: [] };
        });
        for (const file of ['auto_memory.js', 'memory_library.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../js/modules', file), 'utf8') });
        await page.evaluate(() => {
            const chat = db.characters[0]; chat.memoryJournals.push({ id: 'draft', title: '待审约定', content: '过短草稿', createdAt: 1700000001000, range: { start: 1, end: 1 },
                autoMemory: { version: 1, kind: 'summary', committed: false, sources: [{ id: 'source', hash: autoMemoryMessageHash(chat.history[0]) }] },
                qualityReview: { status: 'pending', archiveId: 'a', warnings: ['核对时间线'] } });
            openMemoryLibrary();
        });
        const filters = page.locator('.memory-library-filter-disclosure');
        assert.equal(await filters.count(), 1);
        assert.equal(await filters.locator('summary').textContent(), '筛选');
        assert.equal(await filters.locator('.memory-library-filters').isVisible(), false);
        assert.equal(await page.locator('.memory-library-list > .memory-library-card').count(), 20);
        await page.getByRole('button', { name: '编辑并确认总结', exact: true }).click();
        const editor = page.locator('.memory-library').last();
        await editor.locator('textarea').fill('核对后的去海边看日落约定。');
        await editor.getByRole('button', { name: '确认并启用总结', exact: true }).click();
        assert.equal(await page.evaluate(() => getAutoMemoryState(db.characters[0]).covered.size), 1);
        await filters.locator('summary').click();
        await page.locator('.memory-library-filters input[type="search"]').fill('manual44'); await page.waitForTimeout(220);
        assert.equal(await page.locator('.memory-library-list > .memory-library-card').count(), 1);
        for (const width of [320, 390, 768]) {
            await page.setViewportSize({ width, height: 844 });
            const card = await page.locator('.memory-library > .feature-dialog-card').first().boundingBox();
            assert.ok(card.x >= 0 && card.x + card.width <= width + 1, JSON.stringify(card));
        }
        assert.deepEqual(errors, []); console.log('PASS memory 20-item pagination/search, pending draft edit+approve, 320/390/768 dialog containment.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
