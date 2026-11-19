const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page();
        page.setDefaultTimeout(7000);
        const pet = page.locator('#uvu-pet-button'), menu = page.locator('#uvu-pet-menu');
        const settings = page.locator('#uvu-pet-settings'), api = page.locator('#uvu-pet-api-dialog');
        await page.evaluate(() => { renderCustomizeForm(); switchScreen('customize-screen'); });
        assert.equal(await pet.isHidden(), true);
        await page.getByRole('button', { name: '桌宠设置' }).click();
        await settings.getByLabel('显示桌宠').check();
        await settings.locator('input[type=file]').setInputFiles({ name: 'pet.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
        await page.waitForFunction(() => document.querySelector('#uvu-pet-settings img').src.startsWith('data:image/webp'));
        await settings.locator('input[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
        await settings.getByText('图片格式不支持').waitFor();
        await settings.locator('input[name=size]').fill('72');
        await settings.getByRole('button', { name: '保存', exact: true }).click();
        await pet.waitFor();
        assert.equal((await pet.boundingBox()).width, 72);
        assert.equal(await page.evaluate(() => db.desktopPetSettings.image.startsWith('data:image/webp')), true);
        const box = await pet.boundingBox();
        await page.mouse.move(box.x + 20, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x - 120, box.y - 130, { steps: 8 });
        await page.mouse.up();
        await page.waitForFunction(() => db.desktopPetSettings.position?.[0] < 0.9);
        assert.equal(await menu.isHidden(), true);
        const position = await page.evaluate(() => db.desktopPetSettings.position);
        await page.reload(); await pet.waitFor();
        assert.deepEqual(await page.evaluate(() => db.desktopPetSettings.position), position);
        console.log('PASS default off, image validation, sizing, drag without click and reload');

        await page.evaluate(async () => {
            const fixture = (id, name) => ({ id, realName: name, remarkName: name, myName: '我', persona: '测试', myPersona: '', avatar: '', activeArchiveId: 'one', history: [{ id: 'm', role: 'user', content: '[我的消息：你好]', timestamp: Date.now() }], maxMemory: 20, memoryJournals: [], worldBookIds: [], theme: 'blue', status: '在线' });
            db.characters = [fixture('pet-test', '测试角色')];
            db.groups = [{ ...fixture('pet-group', '测试群'), name: '测试群', history: [], members: [] }];
            db.apiSettings = { provider: 'newapi', url: 'https://a.invalid', key: 'fixture-a', model: 'a', streamEnabled: false, keepAliveEnabled: false, secondary: { provider: 'newapi', url: 'https://side.invalid', key: 'fixture-side', model: 'side', enabled: true, routes: { callReply: true } } };
            db.apiPresets = ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), data: { provider: 'newapi', apiUrl: `https://${id}.invalid`, apiKey: `fixture-${id}`, model: id } }));
            db.cotSettings.enabled = false; db.cotSettings.callEnabled = false;
            await saveData();
            window.petRequests = [];
            const originalFetch = window.fetch;
            window.fetch = (url, opts) => {
                const target = String(url);
                if (!target.includes('.invalid/')) return originalFetch(url, opts);
                petRequests.push(target);
                if (target.endsWith('/v1/models')) return Promise.resolve(Response.json({ data: [{ id: 'custom' }] }));
                return new Promise(resolve => { window.finishPetReply = () => resolve(Response.json({ choices: [{ message: { content: '[测试角色的消息：测试完成]' } }] })); });
            };
            openChatRoom('pet-test', 'private');
        });
        await page.locator('#get-reply-btn').click();
        await page.waitForFunction(() => petRequests.length === 1);
        await pet.click(); await menu.getByRole('button', { name: 'B', exact: true }).click();
        await page.waitForFunction(() => db.apiSettings.model === 'b');
        assert.deepEqual(await page.evaluate(() => petRequests.map(x => new URL(x).hostname)), ['a.invalid']);
        await page.evaluate(() => finishPetReply());
        await page.waitForFunction(() => chatGenerationRequests.size === 0);
        await page.locator('#get-reply-btn').click();
        await page.waitForFunction(() => petRequests.length === 2);
        assert.deepEqual(await page.evaluate(() => petRequests.map(x => new URL(x).hostname)), ['a.invalid', 'b.invalid']);
        await page.evaluate(() => finishPetReply());
        await page.waitForFunction(() => chatGenerationRequests.size === 0);
        assert.equal(await page.evaluate(() => resolveAuxiliaryApiConfig('callReply').model), 'side');
        await pet.click(); await menu.getByRole('button', { name: '当前会话', exact: true }).click();
        await menu.getByRole('button', { name: 'A', exact: true }).click();
        await page.waitForFunction(() => db.characters[0].exclusiveApiPreset === 'A');
        assert.equal(await page.evaluate(() => db.apiSettings.model), 'b');
        await pet.click(); assert.equal(await menu.getByRole('button', { name: '当前会话', exact: true }).getAttribute('aria-pressed'), 'true');
        await menu.getByRole('button', { name: '跟随聊天默认' }).click();
        await page.waitForFunction(() => !db.characters[0].exclusiveApiEnabled);
        console.log('PASS a running reply keeps its API; subsequent requests and private bindings select the intended API');

        await pet.click(); await menu.getByRole('button', { name: '新建 API', exact: true }).click();
        await api.getByLabel('预设名称').fill('新服务');
        await api.getByLabel('API 地址').fill('https://custom.invalid');
        await api.getByLabel('API 密钥').fill('fixture-custom');
        await api.getByRole('button', { name: '测试连接并读取模型' }).click();
        await api.getByText('已连接，读取到 1 个模型').waitFor();
        assert.equal(await api.getByLabel('模型', { exact: true }).inputValue(), 'custom');
        await page.evaluate(() => {
            window.petWrite = putGuardedSettings;
            putGuardedSettings = async records => { await petWrite(records.slice(0, 1)); throw new Error('模拟写入失败'); };
        });
        await api.getByRole('button', { name: '保存并切换' }).click();
        await api.getByText('模拟写入失败').waitFor();
        assert.deepEqual(await page.evaluate(async () => [db.apiSettings.model, db.apiPresets.length, (await dexieDB.globalSettings.get('apiPresets')).value.length]), ['b', 2, 2]);
        assert.equal(await api.getByLabel('预设名称').inputValue(), '新服务');
        await page.evaluate(() => { putGuardedSettings = petWrite; });
        await api.getByRole('button', { name: '保存并切换' }).click();
        await page.waitForFunction(() => db.apiSettings.model === 'custom');
        assert.equal(await page.evaluate(() => petRequests.filter(url => url.includes('custom.invalid')).length), 1);
        console.log('PASS explicit connection test and atomic rollback keep previous API and draft');

        await page.evaluate(() => openChatRoom('pet-group', 'group'));
        await pet.click(); await menu.getByRole('button', { name: '当前会话', exact: true }).click();
        await menu.getByRole('button', { name: 'B', exact: true }).click();
        await page.waitForFunction(() => db.groups[0].exclusiveApiPreset === 'B');
        assert.deepEqual(await page.evaluate(() => [db.characters[0].exclusiveApiEnabled, db.apiSettings.model]), [false, 'custom']);
        const other = await context.newPage(); await other.goto(app.origin);
        await other.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await other.evaluate(async () => {
            await desktopPetCommitApi({ selected: db.apiPresets.find(row => row.id === 'a') });
        });
        await pet.click(); await menu.getByRole('button', { name: '聊天默认', exact: true }).click();
        await menu.getByRole('button', { name: 'B', exact: true }).click();
        await menu.getByText(/设置已被其他页面/).waitFor();
        assert.equal(await page.evaluate(() => db.apiSettings.model), 'custom');
        await other.close();
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
        console.log('PASS group scope and stale-tab rejection');

        for (const viewport of [{ width: 320, height: 640 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
            await page.setViewportSize(viewport);
            await pet.click(); await menu.waitFor({ state: 'visible' });
            const result = await page.evaluate(() => {
                const pet = document.getElementById('uvu-pet-button').getBoundingClientRect();
                const menu = document.getElementById('uvu-pet-menu').getBoundingClientRect();
                const input = document.querySelector('#chat-room-screen .message-input-area').getBoundingClientRect();
                return { inside: menu.top >= 0 && menu.bottom <= innerHeight && menu.left >= 0 && menu.right <= innerWidth, clearsInput: pet.bottom <= input.top };
            });
            assert.deepEqual(result, { inside: true, clearsInput: true });
            const out = process.env.UVU_BROWSER_OUTPUT_DIR;
            if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `desktop-pet-${viewport.width}.png`) }); }
            await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
        }
        await pet.click(); await menu.getByRole('button', { name: '桌宠设置', exact: true }).click();
        await settings.getByLabel('显示桌宠').uncheck();
        await settings.getByRole('button', { name: '保存', exact: true }).click();
        await pet.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => db.desktopPetSettings.enabled), false);
        assert.deepEqual(errors, []);
        console.log('PASS 320px, landscape and desktop bounds; Escape and hide; no uncaught browser errors');
        await context.close();
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
