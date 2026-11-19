const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp(), failures = [];
    try {
        for (const [name, check] of [
            ['broken saved image falls back without changing stored settings', async page => {
                await page.evaluate(async () => {
                    db.desktopPetSettings = { enabled: true, image: 'data:image/png;base64,AAAA', sizePx: 56 };
                    await saveData();
                });
                await page.reload();
                await page.locator('#uvu-pet-button').waitFor();
                await page.waitForFunction(() => document.querySelector('#uvu-pet-button img').complete);
                assert.equal(await page.locator('#uvu-pet-button img').evaluate(img => img.naturalWidth > 0), true);
                await page.evaluate(() => { renderCustomizeForm(); switchScreen('customize-screen'); });
                await page.getByRole('button', { name: '桌宠设置', exact: true }).click();
                await page.waitForFunction(() => document.querySelector('#uvu-pet-settings img').complete);
                assert.equal(await page.locator('#uvu-pet-settings img').evaluate(img => img.naturalWidth > 0), true);
                assert.equal(await page.evaluate(() => db.desktopPetSettings.image), 'data:image/png;base64,AAAA');
            }],
            ['pending appearance save keeps the form and prevents new edits', async page => {
                await page.evaluate(() => {
                    renderCustomizeForm(); switchScreen('customize-screen');
                    window.originalPetSave = desktopPetSavePrefs;
                    desktopPetSavePrefs = async (...args) => {
                        await new Promise(resolve => { window.releasePetSave = resolve; });
                        return originalPetSave(...args);
                    };
                });
                await page.getByRole('button', { name: '桌宠设置', exact: true }).click();
                const settings = page.locator('#uvu-pet-settings');
                await settings.getByLabel('显示桌宠').check();
                await settings.locator('input[name=size]').fill('72');
                await settings.getByRole('button', { name: '保存', exact: true }).click();
                await page.waitForFunction(() => typeof window.releasePetSave === 'function');
                await page.keyboard.press('Escape');
                assert.equal(await settings.evaluate(el => el.open), true);
                // Older dialog implementations ignore closedby; the cancel guard must still work.
                await settings.evaluate(el => el.removeAttribute('closedby'));
                await page.keyboard.press('Escape');
                assert.equal(await settings.evaluate(el => el.open), true);
                assert.equal(await settings.locator('input[name=size]').isDisabled(), true);
                assert.equal(await settings.getByRole('button', { name: '关闭桌宠设置' }).isDisabled(), true);
                await page.evaluate(() => releasePetSave());
                await settings.waitFor({ state: 'hidden' });
                assert.equal(await page.evaluate(() => db.desktopPetSettings.sizePx), 72);
                await page.getByRole('button', { name: '桌宠设置', exact: true }).click();
                assert.equal(await settings.locator('input[name=size]').isEnabled(), true);
                await page.evaluate(() => { desktopPetSavePrefs = async () => { throw new Error('simulated disk failure'); }; });
                await settings.locator('input[name=size]').fill('80');
                await settings.getByRole('button', { name: '保存', exact: true }).click();
                await settings.getByText('桌宠设置未保存。请刷新页面后重试。').waitFor();
                assert.equal(await settings.locator('input[name=size]').inputValue(), '80');
                assert.equal(await settings.locator('input[name=size]').isEnabled(), true);
                assert.equal(await page.evaluate(() => db.desktopPetSettings.sizePx), 72);
                await page.keyboard.press('Escape');
                await settings.waitFor({ state: 'hidden' });
            }],
            ['touch drag persists and the menu works without Popover', async page => {
                await page.context().addInitScript(() => { HTMLElement.prototype.showPopover = undefined; });
                await page.evaluate(async () => { db.desktopPetSettings = { enabled: true, sizePx: 56 }; await saveData(); });
                await page.reload();
                const pet = page.locator('#uvu-pet-button'), menu = page.locator('#uvu-pet-menu');
                await pet.waitFor();
                const box = await pet.boundingBox(), x = box.x + 20, y = box.y + 20;
                const cdp = await page.context().newCDPSession(page);
                try {
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 80, y: y - 90 }] });
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                    await page.waitForFunction(() => Array.isArray(db.desktopPetSettings.position));
                    assert.equal(await menu.isHidden(), true);
                    // Reload verifies persistence and ends the injected touch sequence before testing fresh taps.
                    const position = await page.evaluate(() => db.desktopPetSettings.position);
                    await page.reload(); await pet.waitFor();
                    assert.deepEqual(await page.evaluate(() => db.desktopPetSettings.position), position);
                    await pet.tap(); await menu.waitFor();
                    assert.equal(await menu.getAttribute('popover'), null);
                    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
                    await pet.tap(); await menu.waitFor();
                    await page.touchscreen.tap(20, 30); await menu.waitFor({ state: 'hidden' });
                } finally { await cdp.detach(); }
            }]
        ]) {
            const { page, context, errors } = await app.page();
            page.setDefaultTimeout(7000);
            try { await check(page); assert.deepEqual(errors, []); console.log('PASS ' + name); }
            catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
            finally { await context.close(); }
        }
        assert.deepEqual(failures, []);
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
