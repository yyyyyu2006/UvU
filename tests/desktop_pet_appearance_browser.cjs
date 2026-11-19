const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page();
        page.setDefaultTimeout(7000);
        const out = process.env.UVU_BROWSER_OUTPUT_DIR;
        if (out) fs.mkdirSync(out, { recursive: true });
        const screenshot = async name => { if (out) await page.screenshot({ path: path.join(out, name + '.png') }); };
        await page.evaluate(async () => {
            db.desktopPetSettings = { enabled: true, sizePx: 56, anchor: 'br' };
            await saveData();
        });
        await page.reload();
        const pet = page.locator('#uvu-pet-button'), art = pet.locator('.uvu-pet-art');
        await pet.waitFor();
        const appearance = () => art.evaluate(el => {
            const s = getComputedStyle(el), box = el.getBoundingClientRect();
            return { shape: el.dataset.shape, width: box.width, height: box.height, radius: s.borderRadius,
                background: s.backgroundColor, fit: getComputedStyle(el.firstElementChild).objectFit };
        });
        assert.deepEqual(await appearance(), { shape: 'original', width: 56, height: 56, radius: '0%',
            background: 'rgba(0, 0, 0, 0)', fit: 'contain' });
        await page.evaluate(() => { renderCustomizeForm(); switchScreen('customize-screen'); });
        const entry = page.getByRole('button', { name: '桌宠设置', exact: true });
        const settings = page.locator('#uvu-pet-settings');
        const open = async () => { await entry.click(); await settings.waitFor(); };
        const select = shape => settings.locator('button[data-shape="' + shape + '"]').click();
        const save = async () => {
            await settings.getByRole('button', { name: '保存', exact: true }).click();
            await settings.waitFor({ state: 'hidden' }); await pet.waitFor();
        };
        await open();
        await select('rectangle'); await settings.getByRole('slider', { name: /^圆角/ }).fill('22');
        await settings.getByLabel('显示背景').check();
        await settings.getByLabel('背景颜色').fill('#d4e5ef');
        const draft = await settings.locator('.uvu-pet-art').evaluate(el => ({
            radius: el.style.borderRadius, background: el.style.backgroundColor,
            width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height
        }));
        assert.equal(draft.radius, '22%'); assert.equal(draft.background, 'rgb(212, 229, 239)');
        assert.ok(draft.width > draft.height);
        assert.equal(await page.evaluate(() => db.desktopPetSettings.shape), undefined, 'preview never changes stored appearance');
        await page.keyboard.press('Escape'); await open();
        assert.equal(await settings.locator('button[data-shape=original]').getAttribute('aria-pressed'), 'true');
        assert.equal(await settings.getByLabel('显示背景').isChecked(), false);
        console.log('PASS legacy settings preserve original artwork and cancelled preview does not persist');

        const png = await page.evaluate(() => {
            const c = document.createElement('canvas'); c.width = 160; c.height = 80;
            const x = c.getContext('2d'); x.fillStyle = '#dba6ac'; x.fillRect(0, 0, 160, 80);
            x.fillStyle = '#9cbdce'; x.fillRect(0, 0, 40, 80);
            x.fillStyle = '#e5ceb0'; x.fillRect(120, 0, 40, 80);
            return c.toDataURL('image/png').split(',')[1];
        });
        await settings.locator('input[type=file]').setInputFiles({ name: 'appearance.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
        await page.waitForFunction(() => document.querySelector('#uvu-pet-settings img').src.startsWith('data:image/webp'));
        await select('rectangle'); await settings.getByRole('slider', { name: /^圆角/ }).fill('22');
        await settings.getByLabel('显示背景').check(); await settings.getByLabel('背景颜色').fill('#d4e5ef');
        await screenshot('pet-rectangle-settings-390');
        await save();
        assert.deepEqual(await appearance(), { shape: 'rectangle', width: 75, height: 56, radius: '22%',
            background: 'rgb(212, 229, 239)', fit: 'cover' });
        await page.reload(); await pet.waitFor();
        assert.equal((await appearance()).shape, 'rectangle');
        const box = await pet.boundingBox();
        await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
        await page.mouse.move(box.x - 60, box.y - 70, { steps: 8 }); await page.mouse.up();
        await page.waitForFunction(() => Array.isArray(db.desktopPetSettings.position));
        const position = await page.evaluate(() => db.desktopPetSettings.position);
        await page.reload(); await pet.waitFor();
        assert.deepEqual(await page.evaluate(() => db.desktopPetSettings.position), position);
        assert.equal((await appearance()).radius, '22%');
        await pet.click();
        const menu = page.locator('#uvu-pet-menu'); await menu.waitFor();
        const menuBox = await menu.boundingBox(), petBox = await pet.boundingBox();
        assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 391);
        assert.ok(menuBox.y + menuBox.height <= petBox.y || menuBox.y >= petBox.y + petBox.height);
        await page.keyboard.press('Escape');
        console.log('PASS rectangle geometry, appearance, position and menu survive drag and reload');

        await page.evaluate(() => { renderCustomizeForm(); switchScreen('customize-screen'); });
        await open(); await select('circle');
        assert.equal(await settings.getByRole('slider', { name: /^圆角/ }).isDisabled(), true);
        assert.equal(await settings.getByRole('slider', { name: /^圆角/ }).inputValue(), '50');
        await save(); await pet.locator('img').evaluate(el => el.decode());
        assert.deepEqual(await appearance(), { shape: 'circle', width: 56, height: 56, radius: '50%',
            background: 'rgb(212, 229, 239)', fit: 'cover' });
        await screenshot('pet-circle-live');
        await open(); await select('square');
        assert.equal(await settings.getByRole('slider', { name: /^圆角/ }).inputValue(), '22');
        await settings.getByRole('slider', { name: /^圆角/ }).fill('0');
        await settings.getByLabel('显示背景').uncheck(); await save();
        assert.deepEqual(await appearance(), { shape: 'square', width: 56, height: 56, radius: '0%',
            background: 'rgba(0, 0, 0, 0)', fit: 'cover' });
        console.log('PASS true circle, square and transparent background with retained adjustable radius');

        await open(); await select('rectangle');
        await settings.getByRole('slider', { name: /^圆角/ }).fill('35');
        await page.evaluate(() => {
            window.originalAppearanceSave = desktopPetSavePrefs;
            desktopPetSavePrefs = async () => { throw new Error('simulated disk failure'); };
        });
        await settings.getByRole('button', { name: '保存', exact: true }).click();
        await settings.getByText('桌宠设置未保存。请刷新页面后重试。').waitFor();
        assert.equal(await settings.getByRole('slider', { name: /^圆角/ }).inputValue(), '35');
        assert.equal(await page.evaluate(() => db.desktopPetSettings.shape), 'square');
        await page.evaluate(() => { desktopPetSavePrefs = originalAppearanceSave; });
        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.equal(await settings.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
            const rect = await settings.boundingBox(); assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height + 1);
            await screenshot('pet-shapes-settings-' + viewport.width);
        }
        await settings.getByRole('button', { name: '恢复默认外观', exact: true }).click();
        assert.equal(await settings.getByRole('slider', { name: /^圆角/ }).inputValue(), '0');
        assert.equal(await settings.getByLabel('显示背景').isChecked(), false);
        await save();
        assert.equal((await appearance()).shape, 'original');
        assert.equal(await page.evaluate(() => db.desktopPetSettings.image), '');
        assert.deepEqual(errors, []); await context.close();
        console.log('PASS failed save keeps draft; narrow and short views scroll to reset and save; no page errors');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
