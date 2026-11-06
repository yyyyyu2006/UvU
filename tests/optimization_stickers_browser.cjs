const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, '../../uvu-verification-deps/node_modules/playwright'));
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="setting-char-sticker-groups-container"></div><form id="add-sticker-form"><button type="submit">保存</button></form><button id="menu-add-new-btn"></button><button id="edit-sticker-btn"></button><div id="sticker-grid-container"></div><form id="batch-add-sticker-form"></form><input id="batch-sticker-group"><main id="chat-room-screen" class="active"><div id="reply-preview-bar"></div><textarea id="message-input"></textarea></main>');
        await page.addStyleTag({ content: '.sticker-suggestions{display:flex;overflow-x:auto;width:350px}.sticker-suggestions button{flex:none;width:60px}.sticker-suggestions img{width:40px;height:40px}' });
        await page.addStyleTag({ path: path.join(__dirname, '../css/modules/document_features.css') });
        await page.addStyleTag({ path: path.join(__dirname, '../css/modules/feature_refinements.css') });
        await page.addStyleTag({ path: path.join(__dirname, '../css/modules/ui_harmony.css') });
        await page.evaluate(() => {
            window.currentChatId = 'c'; window.currentChatType = 'private'; window.isInMultiSelectMode = false;
            window.db = { characters: [{ id: 'c', activeArchiveId: 'a', stickerGroups: '猫', history: [{ role: 'user', content: '开心' }] }], groups: [],
                myStickers: Array.from({ length: 75 }, (_, i) => ({ id: `s${i}`, name: `开心${i}`, keywords: ['开心'], description: '开心的猫', group: '猫', data: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' })) };
            window.worldBookKeys = value => value || []; window.validStickerImage = value => typeof value === 'string' && value.startsWith('data:image/'); window.saveData = async () => {};
            window.sendSticker = async () => {}; window.showToast = () => {};
        });
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../js/modules/sticker_assist.js'), 'utf8') });
        await page.evaluate(() => { setupStickerAssist(); document.getElementById('message-input').value = '开心'; document.getElementById('message-input').dispatchEvent(new Event('input')); });
        await page.waitForTimeout(220);
        assert.equal(await page.locator('#sticker-description-settings-open').textContent(), '表情说明');
        assert.equal(await page.locator('#sticker-description-settings-open').getAttribute('aria-label'), '表情画面说明注入与预算设置');
        assert.equal(await page.locator('#sticker-suggestions img').count(), 24);
        await page.locator('#sticker-suggestions [data-more]').click();
        assert.equal(await page.locator('#sticker-suggestions img').count(), 48);
        await page.evaluate(() => { document.getElementById('sticker-suggestions').scrollLeft = 120; document.getElementById('message-input').dispatchEvent(new Event('input')); });
        await page.waitForTimeout(220);
        assert.ok(await page.locator('#sticker-suggestions').evaluate(el => el.scrollLeft >= 120));
        await page.locator('#sticker-description-settings-open').click();
        assert.equal(await page.locator('#sticker-description-settings .feature-help').first().textContent(), '控制本轮发送给模型的表情说明。');
        assert.equal(await page.locator('#sticker-description-settings .sticker-description-toggle').count(), 2);
        assert.ok(await page.locator('#sticker-description-settings [data-action="save"]').evaluate(el => el.getBoundingClientRect().width < 120));
        await page.locator('#sticker-description-settings [name="enabled"]').uncheck();
        await page.locator('#sticker-description-settings [data-action="save"]').click();
        assert.equal(await page.evaluate(() => getStickerDescriptionContext(db.characters[0])), '');
        assert.deepEqual(errors, []); console.log('PASS sticker suggestion lazy 24/48, preserved scroll, dynamic settings explicit off.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
