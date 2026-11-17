'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
const out = path.join(root, 'outputs/message-menu-20261117');
fs.mkdirSync(out, { recursive: true });

(async () => {
    const app = await fullApp(), results = [], failures = [];
    try {
        for (const height of [740, 400, 260]) {
            const { page, context, errors } = await app.page({ viewport: { width: 320, height }, isMobile: true });
            try {
                await page.evaluate(async () => {
                    for (const key of ['guide_search_entry', 'guide_char_gallery', 'guide_group_summary', 'guide_group_notice', 'guide_group_gossip']) localStorage.setItem(key, 'true');
                    GuideSystem.cleanup();
                    db.characters = [{ id: 'menu-test', realName: '测试角色', remarkName: '测试角色', myName: '我', persona: '', maxMemory: 20, worldBookIds: [],
                        bilingualModeEnabled: true, history: [{ id: 'source', role: 'assistant', content: '[测试角色的消息：Hello「你好」]', timestamp: Date.now() }] }];
                    db.groups = []; ensureAllChatArchives(); await saveData(); openChatRoom('menu-test', 'private'); GuideSystem.cleanup();
                });
                for (const y of [20, 80, height - 10]) {
                    await page.evaluate(y => handleMessageLongPress(document.querySelector('.message-wrapper[data-id=source]'), 300, y), y);
                    await stableUI(page, '.context-menu');
                    const geometry = await page.locator('.context-menu').evaluate(menu => ({ rect: menu.getBoundingClientRect().toJSON(), scrollHeight: menu.scrollHeight, clientHeight: menu.clientHeight, overflowY: getComputedStyle(menu).overflowY }));
                    const labels = await page.locator('.context-menu-item').allTextContents();
                    const entry = { height, y, geometry, labels }; results.push(entry);
                    try {
                        assert.ok(geometry.rect.top >= 9 && geometry.rect.bottom <= height - 9, 'menu must fit visible viewport');
                        assert.ok(geometry.rect.left >= 9 && geometry.rect.right <= 311, 'menu must fit horizontal edges');
                        assert.ok(labels.includes('引用') && labels.includes('从这里创建分支'));
                        if (geometry.scrollHeight > geometry.clientHeight + 1) assert.match(geometry.overflowY, /auto|scroll/);
                        await page.locator('.context-menu-item').filter({ hasText: /^引用$/ }).tap();
                        assert.equal(await page.evaluate(() => currentQuoteInfo?.id), 'source');
                        assert.equal(await page.locator('#reply-preview-bar').getAttribute('aria-hidden'), 'false');
                        await page.evaluate(() => { cancelQuoteReply(); messageInput.blur(); });
                        await page.evaluate(y => handleMessageLongPress(document.querySelector('.message-wrapper[data-id=source]'), 300, y), y);
                        await page.locator('.context-menu-item').last().evaluate(element => element.scrollIntoView({ block: 'nearest' }));
                        const bottom = await page.locator('.context-menu-item').last().boundingBox();
                        assert.ok(bottom.y >= 0 && bottom.y + bottom.height <= height, 'last action must remain reachable');
                    } catch (error) { failures.push({ height, y, error: error.message }); }
                    if (y === 80) {
                        await page.locator('.context-menu').evaluate(menu => { menu.scrollTop = 0; });
                        await page.screenshot({ path: path.join(out, 'menu-' + height + '.png') });
                    }
                    await page.evaluate(() => { removeContextMenu(); cancelQuoteReply(); messageInput.blur(); });
                }
                if (height === 740) {
                    // CDP zoom stays at 1 in this app. Simulate API values explicitly;
                    // real keyboard/pinch zoom remains a separate device check.
                    await page.evaluate(() => {
                        window.menuViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
                        Object.defineProperty(window, 'visualViewport', { value: { offsetLeft: 40, offsetTop: 120, width: 240, height: 280 }, configurable: true });
                        handleMessageLongPress(document.querySelector('.message-wrapper[data-id=source]'), 300, 700);
                    });
                    await stableUI(page, '.context-menu');
                    const zoom = await page.evaluate(() => {
                        const v = visualViewport, rect = document.querySelector('.context-menu').getBoundingClientRect();
                        return { rect: rect.toJSON(), left: v.offsetLeft, top: v.offsetTop, width: v.width, height: v.height };
                    });
                    assert.ok(zoom.rect.left >= zoom.left + 9 && zoom.rect.right <= zoom.left + zoom.width - 9);
                    assert.ok(zoom.rect.top >= zoom.top + 9 && zoom.rect.bottom <= zoom.top + zoom.height - 9);
                    results.push({ case: 'simulated offset/reduced visualViewport', zoom });
                    await page.evaluate(() => {
                        Object.defineProperty(window, 'visualViewport', window.menuViewportDescriptor);
                        delete window.menuViewportDescriptor;
                    });
                    const fallback = await page.evaluate(() => {
                        const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
                        try {
                            Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
                            handleMessageLongPress(document.querySelector('.message-wrapper[data-id=source]'), 300, 700);
                            const menu = document.querySelector('.context-menu');
                            return { top: parseFloat(menu.style.top), left: parseFloat(menu.style.left), height: menu.offsetHeight, width: menu.offsetWidth };
                        } finally {
                            if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor);
                            else delete window.visualViewport;
                        }
                    });
                    assert.ok(fallback.top >= 10 && fallback.top + fallback.height <= height - 10);
                    assert.ok(fallback.left >= 10 && fallback.left + fallback.width <= 310);
                    results.push({ case: 'visualViewport absent fallback', fallback });
                }
                assert.deepEqual(errors, []);
            } finally { await context.close(); }
        }
        fs.writeFileSync(path.join(out, 'menu-regression.json'), JSON.stringify({ results, failures }, null, 2));
        assert.deepEqual(failures, []);
        console.log('PASS 9 mobile menu bounds/quote/reachability cases, simulated offset/reduced visualViewport, and absent-API fallback');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
