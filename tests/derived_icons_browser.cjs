const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<button id="legacy">保存</button><main id="dynamic"></main><div class="mcp-settings"><button id="save">保存</button><button id="custom"><svg viewBox="0 0 24 24"></svg>自定义</button></div>');
        for (const file of ['js/vendor/lucide/uvu-icons.js','js/modules/derived_icons.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
        assert.equal(await page.locator('#save svg').count(), 1);
        assert.equal(await page.locator('#save').textContent(), '保存');
        assert.equal(await page.locator('#legacy svg').count(), 0);
        assert.equal(await page.locator('#custom svg').count(), 1);
        assert.equal(await page.locator('#save svg').getAttribute('aria-hidden'), 'true');
        await page.evaluate(() => {
            window.clicked = 0;
            document.getElementById('dynamic').innerHTML = '<section class="memory-library"><button id="add">添加</button></section>';
            document.getElementById('add').onclick = () => clicked++;
            // Normal chat mutations must never decorate original controls.
            for (let i = 0; i < 100; i++) document.body.append(Object.assign(document.createElement('button'), { textContent: '删除' }));
        });
        await page.waitForFunction(() => document.querySelector('#add svg'));
        await page.getByRole('button', { name: '添加', exact: true }).click();
        assert.equal(await page.evaluate(() => clicked), 1);
        assert.equal(await page.locator('body > button svg').count(), 0);
        await page.evaluate(() => { document.getElementById('add').textContent = '编辑'; });
        await page.waitForFunction(() => document.querySelector('#add svg'));
        assert.equal(await page.locator('#add').textContent(), '编辑');
        await page.evaluate(() => { for (let i = 0; i < 20; i++) DerivedIcons.decorate(document.body); });
        assert.equal(await page.locator('#add svg').count(), 1);
        await page.getByRole('button', { name: '编辑', exact: true }).click();
        assert.equal(await page.evaluate(() => clicked), 2);
        assert.deepEqual(errors, []);
        console.log('PASS local icons preserve text, accessible names, event handlers and custom SVGs; dynamic new panels decorated once; legacy buttons untouched through repeated chat mutations.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
