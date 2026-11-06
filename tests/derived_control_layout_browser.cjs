const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, '../../uvu-verification-deps/node_modules/playwright'));

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main></main>');
        for (const file of ['css/modules/chat_relationship.css', 'css/modules/ui_harmony.css']) {
            await page.addStyleTag({ path: path.resolve(__dirname, '..', file) });
        }
        await page.evaluate(() => {
            window.currentChatId = 'c'; window.currentChatType = 'private';
            window.db = { characters: [{ id: 'c', activeArchiveId: 'a', history: [] }], groups: [] };
            window.createMessageForwardDialog = () => {
                const panel = document.createElement('section'); document.body.append(panel);
                return { panel, dismiss() {}, setBusy() {} };
            };
            window.showToast = () => {};
            window.saveData = async () => {};
        });
        await page.addScriptTag({ path: path.join(__dirname, '../js/modules/chat_relationship.js') });
        await page.evaluate(() => openRelationshipDialog());
        const layout = await page.locator('#relationship-autonomy-enabled').evaluate(input => {
            const box = input.getBoundingClientRect(), label = input.closest('label'), text = label.querySelector('span').getBoundingClientRect();
            return { boxWidth: box.width, boxHeight: box.height, boxTop: box.top, textTop: text.top, boxLeft: box.left, textLeft: text.left, labelHeight: label.getBoundingClientRect().height };
        });
        assert.equal(layout.boxWidth, 16, JSON.stringify(layout));
        assert.equal(layout.boxHeight, 16, JSON.stringify(layout));
        assert.ok(Math.abs(layout.boxTop + layout.boxHeight / 2 - (layout.textTop + 8)) <= 3, JSON.stringify(layout));
        assert.ok(layout.textLeft > layout.boxLeft, JSON.stringify(layout));
        console.log('PASS relationship autonomy checkbox is compact and aligned with its label.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
