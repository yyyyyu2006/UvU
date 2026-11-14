const assert = require('node:assert/strict');
const path = require('node:path');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page();
        let rename = '新的文件夹';
        page.removeAllListeners('dialog');
        page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? rename : undefined));
        await page.evaluate(async () => {
            db.worldBooks = [
                { id: 'folder', type: 'folder', name: '原文件夹', parentId: null },
                { id: 'target', type: 'folder', name: '目标文件夹', parentId: null },
                { id: 'entry', type: 'entry', name: '测试条目', content: '保留正文', position: 'before', depth: 100, parentId: null }
            ];
            wbPathStack = [{ id: null, name: '世界书' }];
            await saveData(); renderWorldBookList(); switchScreen('world-book-screen');
        });
        const session = await context.newCDPSession(page);
        const card = id => page.locator('.wb-item-card[data-id="' + id + '"]');
        const menu = page.locator('#worldbook-item-actions');
        const touchHold = async (id, part = '.wb-icon-wrapper') => {
            const target = card(id).locator(part);
            await target.scrollIntoViewIfNeeded();
            const box = await target.boundingBox();
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
            await menu.waitFor({ state: 'visible' });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            assert.equal(await menu.locator('[data-wb-action]').count(), 2);
        };
        await touchHold('entry');
        assert.equal(await page.evaluate(() => isWorldBookMultiSelectMode), false);
        const panel = menu.locator('.message-forward-dialog');
        const bounds = await panel.boundingBox();
        assert.ok(bounds.width <= 320 && bounds.height < 260, JSON.stringify(bounds));
        if (process.env.UVU_DRAFT_EVIDENCE) await page.screenshot({ path: path.join(process.env.UVU_DRAFT_EVIDENCE, 'worldbook-actions-mobile.png') });
        await menu.locator('[data-wb-action="select"]').click();
        assert.deepEqual(await page.evaluate(() => [...selectedWorldBookIds]), ['entry']);
        assert.equal(await page.locator('#world-book-multi-select-bar').isVisible(), true);
        await card('target').locator('.wb-item-name').tap();
        await page.locator('#move-selected-world-books-btn').click();
        await page.waitForFunction(() => !isWorldBookMultiSelectMode);
        assert.equal(await page.evaluate(async () => (await dexieDB.worldBooks.get('entry')).parentId), 'target');
        await touchHold('entry', '.wb-item-name');
        await menu.locator('[data-wb-action="select"]').click();
        await page.locator('#delete-selected-world-books-btn').click();
        await page.waitForFunction(() => !isWorldBookMultiSelectMode);
        assert.equal(await page.evaluate(async () => await dexieDB.worldBooks.get('entry')), undefined);
        await page.locator('#world-book-back-btn').click();
        await touchHold('folder', '.wb-item-name');
        await menu.locator('[data-wb-action="rename"]').click();
        await page.waitForFunction(() => db.worldBooks.find(item => item.id === 'folder').name === '新的文件夹');
        assert.equal(await page.evaluate(async () => (await dexieDB.worldBooks.get('folder')).name), rename);
        await touchHold('folder');
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
        await card('folder').locator('.wb-item-name').tap();
        assert.equal(await page.locator('#world-book-title').textContent(), rename);
        await page.locator('#world-book-back-btn').click();
        await page.locator('#world-book-view-toggle-btn').click();
        await touchHold('folder');
        await menu.locator('.message-forward-close').click();
        const box = await card('folder').boundingBox();
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 20, y: box.y + 20 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 20, y: box.y + 45 }] });
        await page.waitForTimeout(700);
        await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        assert.equal(await menu.count(), 0);
        await page.setViewportSize({ width: 1280, height: 900 });
        await card('folder').hover(); await page.mouse.down();
        await menu.waitFor({ state: 'visible' }); await page.mouse.up();
        await menu.locator('.message-forward-close').click();
        rename = '键盘改名';
        await card('folder').locator('.wb-item-name').focus(); await page.keyboard.press('F2');
        await page.waitForFunction(() => db.worldBooks.find(item => item.id === 'folder').name === '键盘改名');
        await page.setViewportSize({ width: 320, height: 568 });
        await page.evaluate(() => { db.worldBooks.find(item => item.id === 'folder').name = '很长的世界书名称'.repeat(30); renderWorldBookList(); });
        await touchHold('folder');
        const compact = await panel.boundingBox();
        assert.ok(compact.x >= 0 && compact.x + compact.width <= 320 && compact.height < 280, JSON.stringify(compact));
        assert.equal(await menu.locator('[data-wb-action="rename"]').isVisible(), true);
        await page.touchscreen.tap(5, 5);
        await menu.waitFor({ state: 'detached' });
        assert.deepEqual(errors, []);
        console.log('PASS: touch/mouse hold, grid/list, rename persistence, multi-select, move, delete, cancel, scroll, F2; no page errors');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
