const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const failures = [];
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const check = async (name, task) => { try { await task(); console.log('PASS:', name); } catch (e) { failures.push(name + ': ' + e.message); } };
        await page.route('http://uvu-fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="background"><button id="opener">打开</button><label for="field">编辑</label><textarea id="field">original</textarea><label><select id="api-model"><option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></select></label><div id="home-screen"></div></main>' }));
        await page.goto('http://uvu-fixture.test/');
        await page.addStyleTag({ path: path.join(root, 'css/modules/document_features.css') });
        await page.addStyleTag({ path: path.join(root, 'css/modules/model_picker.css') });
        await page.evaluate(() => { window.showToast = text => (window.toasts ||= []).push(text); });
        for (const file of ['text_editor', 'model_picker', 'feature_dialogs', 'resource_health']) await page.addScriptTag({ path: path.join(root, 'js/modules/' + file + '.js') });
        await check('editor keeps both versions on concurrent source change', async () => {
            await page.evaluate(() => openExpandedEditor(document.getElementById('field')));
            await page.locator('.editor-draft').fill('my draft');
            await page.evaluate(() => { document.getElementById('field').value = 'new server version'; });
            await page.locator('[data-action=apply]').click();
            assert.equal(await page.locator('#field').inputValue(), 'new server version');
            assert.equal(await page.locator('.editor-draft').inputValue(), 'my draft');
            assert.match(await page.locator('.editor-draft-notice').textContent(), /变化|冲突/);
        });
        await page.evaluate(() => document.getElementById('expanded-text-editor')?.remove());
        await check('model list supports arrow End Enter without extra change events', async () => {
            await page.evaluate(() => { setupSearchableModelPickers(); window.changes = 0; document.getElementById('api-model').addEventListener('change', () => changes++); });
            await page.locator('#api-model-picker').click();
            await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
            assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Beta');
            await page.keyboard.press('End'); assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Gamma');
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('#api-model').inputValue(), 'c');
            assert.equal(await page.evaluate(() => changes), 1);
        });
        await page.evaluate(() => document.querySelector('.model-picker-overlay')?.remove());
        await check('nested derived dialogs isolate background and restore existing accessibility state', async () => {
            await page.evaluate(() => {
                document.getElementById('background').setAttribute('aria-hidden', 'false');
                const show = id => { const el = document.createElement('div'); el.id = id; el.className = 'feature-dialog'; el.innerHTML = '<section class="feature-dialog-card"><button data-action="close">关闭</button><input></section>'; el.querySelector('button').onclick = () => el.remove(); document.body.append(el); };
                window.showDialog = show; document.getElementById('opener').focus(); show('outer');
            });
            await page.waitForFunction(() => document.activeElement?.closest('#outer'));
            assert.equal(await page.locator('#background').evaluate(el => el.inert), true);
            await page.evaluate(() => document.getElementById('opener').focus());
            assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#outer'))), true);
            await page.evaluate(() => showDialog('inner'));
            await page.waitForFunction(() => document.activeElement?.closest('#inner'));
            assert.equal(await page.locator('#outer').evaluate(el => el.inert), true);
            await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement?.closest('#outer'));
            assert.equal(await page.locator('#outer').evaluate(el => el.inert), false);
            await page.evaluate(() => {
                const editor = document.createElement('div'); editor.id = 'calendar-child'; editor.className = 'message-forward-overlay';
                editor.innerHTML = '<section><button>心情</button></section>'; document.body.append(editor);
            });
            await page.waitForFunction(() => document.getElementById('outer').inert);
            await page.locator('#calendar-child button').click();
            assert.equal(await page.locator('#calendar-child').evaluate(el => el.inert), false);
            await page.evaluate(() => document.getElementById('calendar-child').remove());
            await page.waitForFunction(() => !document.getElementById('outer').inert);
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.getElementById('background').inert);
            assert.equal(await page.locator('#background').getAttribute('aria-hidden'), 'false');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
        });
        await check('expanded editor returns focus inside the restored parent dialog', async () => {
            await page.evaluate(() => { showDialog('edit-parent'); const field = document.createElement('textarea'); field.id = 'nested-field'; field.value = 'source'; document.getElementById('edit-parent').append(field); field.focus(); openExpandedEditor(field); });
            await page.locator('#expanded-text-editor [data-action=cancel]').click();
            await page.waitForFunction(() => !document.getElementById('edit-parent').inert);
            assert.equal(await page.evaluate(() => document.activeElement.id), 'nested-field');
            await page.evaluate(() => document.getElementById('edit-parent').remove());
        });
        await check('resource scan discloses truncation and preserves source markup', async () => {
            const result = await page.evaluate(() => {
                const home = document.getElementById('home-screen'); home.innerHTML = '<div></div>'.repeat(600); const before = home.innerHTML;
                const rows = UvUResourceHealth.inspect(home); return { rows, unchanged: before === home.innerHTML };
            });
            assert.equal(result.unchanged, true);
            assert.ok(result.rows.some(row => /扫描/.test(row.type) && /500/.test(row.state)));
        });
        assert.deepEqual(failures, []);
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
