// Full app in an isolated browser profile; no personal storage or real model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(), out = path.join(root, 'outputs/worldbook-static-20261122');
    fs.mkdirSync(out, { recursive: true });
    try {
        const { page, context, errors } = await app.page();
        await page.evaluate(async () => {
            GuideSystem.cleanup();
            document.addEventListener('pointerdown', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            db.worldBooks = [
                { id: 'a', type: 'entry', name: '旧高级条目', content: 'STATIC_A', position: 'before', depth: 20,
                    rules: { advancedEnabled: true, enabled: false, constant: false, keys: ['never'], probability: 0, order: 1 } },
                { id: 'b', type: 'entry', name: '旧条目B', content: 'STATIC_B', position: 'before', depth: 10 },
                { id: 'q', type: 'entry', name: '不支持位置', content: 'QUARANTINED', position: 'before', depth: 1,
                    rules: { advancedEnabled: true, unsupportedPosition: true } }
            ];
            db.characters = [{ id: 'wb-char', realName: '测试角色', myName: '我', maxMemory: 20, persona: '人设',
                history: [], memoryJournals: [], worldBookIds: ['a', 'b', 'q'] }];
            await migrateWorldBookPositions(); await saveData();
            wbPathStack = [{ id: null, name: '世界书' }];
            renderWorldBookList(); switchScreen('world-book-screen');
        });
        await page.locator('.wb-item-card[data-id="a"]').click();
        await stableUI(page, '#edit-world-book-screen');
        assert.equal(await page.locator('.worldbook-advanced,#wb-advanced-enabled,#wb-chat-depth,#wb-role').count(), 0);
        assert.equal(await page.locator('#world-book-depth').inputValue(), '20');
        assert.equal(await page.locator('input[name="world-book-position"]').count(), 4);
        for (const width of [320, 390, 768]) {
            await page.setViewportSize({ width, height: 844 });
            const box = await page.locator('.worldbook-editor-help').boundingBox();
            assert.ok(box && box.x >= 0 && box.x + box.width <= width);
        }
        await page.locator('.worldbook-editor-help').click();
        assert.match(await page.locator('#panel-explanation-dialog').innerText(), /1900原版.*仅用于排序/);
        await page.keyboard.press('Escape');
        await page.locator('#panel-explanation-dialog').waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement === document.querySelector('.worldbook-editor-help'));
        await page.locator('#world-book-depth').fill('30');
        await page.locator('#edit-world-book-form [type=submit]').click();
        await page.locator('#world-book-screen.active').waitFor();
        assert.equal(await page.evaluate(() => db.worldBooks.find(b => b.id === 'a').depth), 30);
        assert.equal(await page.evaluate(() => db.worldBooks.find(b => b.id === 'a').rules.order), 1);
        await page.locator('.wb-item-card[data-id="q"]').click();
        await page.locator('input[name="world-book-position"][value=after]').check();
        await page.locator('#edit-world-book-form [type=submit]').click();
        await page.locator('#world-book-screen.active').waitFor();
        const check = await page.evaluate(() => {
            const chat = db.characters[0], text = generatePrivateSystemPrompt(chat), count = calculateTokenBreakdown(chat.id);
            const imported = importWorldBookJson({entries: [{content: 'NO_HISTORY', position: 4}]}, null).books[0];
            return { text, details: count.worldBookDetails, imported: imported.position,
                saved: db.worldBooks.map(b => ({id:b.id, position:b.position, rules:b.rules})) };
        });
        assert.ok(check.text.indexOf('STATIC_B') < check.text.indexOf('STATIC_A'));
        for (const word of ['STATIC_A', 'STATIC_B', 'QUARANTINED']) assert.equal(check.text.split(word).length - 1, 1);
        assert.equal(check.imported, 'unsupported');
        assert.equal(check.details.length, 3);
        assert.equal(check.saved.find(b => b.id === 'q').rules.unsupportedPosition, false);
        await page.setViewportSize({width:390,height:844});
        await page.locator('.wb-item-card[data-id="a"]').click();
        await stableUI(page, '#edit-world-book-screen');
        assert.equal(await page.locator('#global-rescue-panel').isVisible(), false);
        await page.locator('#edit-world-book-screen').screenshot({path:path.join(out,'editor.png')});
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out,'browser.json'), JSON.stringify({checks: ['removed controls', 'original depth save', 'four positions', 'static prompt order', 'token details', 'unsupported import', 'manual position repair', 'help focus', 'three widths'], errors}, null, 2));
        console.log('PASS full app: nine worldbook checks, three viewport widths, zero page errors');
        await context.close();
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
