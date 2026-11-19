const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page();
        page.setDefaultTimeout(7000);
        await page.evaluate(async () => { db.desktopPetSettings = { enabled: true, sizePx: 56, anchor: 'br' }; await saveData(); });
        await page.reload();
        const pet = page.locator('#uvu-pet-button'); await pet.waitFor();
        const drag = async (dx, dy) => {
            const box = await pet.boundingBox();
            await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
            await page.mouse.move(box.x + 20 + dx, box.y + 20 + dy, { steps: 8 });
            await page.evaluate(() => new Promise(requestAnimationFrame));
            const target = await pet.boundingBox(); await page.mouse.up();
            await page.evaluate(() => new Promise(requestAnimationFrame)); return target;
        };
        const near = (actual, expected) => {
            assert.ok(Math.abs(actual.x - expected.x) < 1 && Math.abs(actual.y - expected.y) < 1,
                `position moved from ${expected.x},${expected.y} to ${actual.x},${actual.y}`);
        };
        await page.evaluate(() => {
            window.petSaveOriginal = desktopPetSavePrefs;
            window.petSaveReleases = [];
            desktopPetSavePrefs = async (...args) => {
                await new Promise(resolve => petSaveReleases.push(resolve)); return petSaveOriginal(...args);
            };
        });
        const first = await drag(-90, -100);
        await page.waitForFunction(() => petSaveReleases.length === 1);
        near(await pet.boundingBox(), first);
        const second = await drag(-50, -60);
        near(await pet.boundingBox(), second);
        await page.evaluate(() => petSaveReleases[0]());
        await page.waitForFunction(() => petSaveReleases.length === 2);
        near(await pet.boundingBox(), second);
        await page.evaluate(() => petSaveReleases[1]());
        await page.waitForFunction(() => db.desktopPetSettings.position?.[0] < 0.8);
        await page.waitForTimeout(70); near(await pet.boundingBox(), second);
        await page.reload(); await pet.waitFor(); near(await pet.boundingBox(), second);
        console.log('PASS delayed and consecutive drag saves keep the last displayed position and survive reload');

        await page.evaluate(() => { desktopPetSavePrefs = async () => { throw new Error('simulated save failure'); }; });
        await drag(60, 50);
        await page.getByText('桌宠位置未保存，请重试', { exact: true }).waitFor();
        await page.waitForTimeout(50); near(await pet.boundingBox(), second);
        await page.reload(); await pet.waitFor();
        console.log('PASS failed position save returns to persisted position');

        await page.evaluate(() => { renderCustomizeForm(); switchScreen('customize-screen'); });
        const entry = page.getByRole('button', { name: '桌宠设置', exact: true });
        assert.equal(await entry.evaluate(el => el.parentElement.classList.contains('kkt-group')), true);
        await page.evaluate(() => renderCustomizeForm());
        assert.equal(await page.locator('#uvu-pet-settings-entry').count(), 1);
        await entry.click();
        const settings = page.locator('#uvu-pet-settings');
        await settings.getByRole('button', { name: '使用说明', exact: true }).click();
        const help = page.locator('#uvu-pet-help'); await help.waitFor();
        await page.keyboard.press('Escape'); await help.waitFor({ state: 'hidden' });
        assert.equal(await settings.evaluate(el => el.open), true);
        await settings.getByRole('button', { name: '左上', exact: true }).click();
        await settings.getByRole('button', { name: '保存', exact: true }).click();
        await settings.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => db.desktopPetSettings.anchor), 'tl');
        assert.equal(await page.evaluate(() => db.desktopPetSettings.position), null);
        await entry.click();
        assert.equal(await settings.getByRole('button', { name: '左上', exact: true }).getAttribute('aria-pressed'), 'true');
        console.log('PASS entry survives re-render, help closes independently, and corner selection persists');

        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const size = await settings.evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth + 1, rect: { top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom } }));
            assert.equal(size.overflow, false); assert.ok(size.rect.top >= 0 && size.rect.bottom <= viewport.height + 1);
            const out = process.env.UVU_BROWSER_OUTPUT_DIR;
            if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `pet-settings-${viewport.width}.png`) }); }
        }
        await page.keyboard.press('Escape');
        await pet.click();
        const menu = page.locator('#uvu-pet-menu');
        await menu.getByRole('button', { name: '桌宠设置', exact: true }).click();
        await settings.waitFor(); assert.equal(await menu.isHidden(), true);
        await settings.getByLabel('显示桌宠').uncheck();
        await settings.getByRole('button', { name: '保存', exact: true }).click();
        await pet.waitFor({ state: 'hidden' });
        assert.deepEqual(errors, []); await context.close();
        console.log('PASS narrow and short settings, menu appearance entry and hide switch; no browser errors');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
