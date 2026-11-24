
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page({ viewport: { width: 390, height: 844 } });
        let requests = 0, sent = '';
        await page.route('https://provider.invalid/**', async route => {
            const body = route.request().postData() || '';
            requests++; sent += body;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
                scene: '小猫低头捂脸', gestures: '双手捂住眼睛', emotion: '害羞', intent: '化解尴尬', suitable: ['被夸奖'], unsuitable: ['严肃道歉'], ambiguity: '', confidence: 'high', ocr: '下雨了'
            }) } }] }) });
        });
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ee7799'; ctx.fillRect(0, 0, 4, 4);
            const image = canvas.toDataURL('image/png');
            const chat = { id: 'semantic-check', name: '测试角色', realName: '测试角色', activeArchiveId: 'a', history: [], maxMemory: 20, stickerGroups: '猫', worldBookIds: [] };
            db.characters = [chat]; db.groups = [];
            db.myStickers = [{ id: 'sem-a', name: '猫猫捂脸', group: '猫', data: image }, { id: 'sem-b', name: '其他分组', group: '狗', data: image }];
            await saveData(); ensureAllChatArchives(); openChatRoom(chat.id, 'private'); GuideSystem.cleanup();
            window.resolveAuxiliaryApiConfig = () => ({ url: 'https://provider.invalid', key: 'fake-test-key', model: 'vision-test', provider: 'openai', allowRemoteImageUrl: false });
        });
        await page.locator('#sticker-menu-btn').evaluate(el => el.click());
        assert.equal(await page.locator('#sticker-menu-actionsheet').evaluate(el => el.classList.contains('visible')), true);
        await page.locator('#menu-sticker-semantic-library').evaluate(el => el.click());
        const dialog = page.locator('#sticker-semantic-library');
        assert.equal(await dialog.evaluate(el => el.open), true);
        const screenshot = path.join(__dirname, '../outputs/sticker-semantic-review.png');
        fs.mkdirSync(path.dirname(screenshot), { recursive: true });
        assert.match(await dialog.locator('[data-counts]').textContent(), /2 张/);
        await page.evaluate(() => window.confirm = () => true);
        await dialog.locator('[data-run]').click();
        await page.waitForTimeout(3000);
        if (await page.evaluate(() => !db.myStickers[0].semanticProfile)) throw new Error('recognition did not save; status=' + await dialog.locator('[data-status]').textContent() + '; issue=' + JSON.stringify(await page.evaluate(() => db.myStickers[0].semanticFailure)));
        assert.equal(requests, 1);
        assert.match(sent, /视觉标注/);
        assert.match(sent, /image_url/);
        assert.equal(await dialog.locator('[data-filter]').inputValue(), 'all');
        assert.match(await dialog.locator('[data-record]').textContent(), /待核对/);
        await dialog.screenshot({ path: screenshot });
        await dialog.locator('textarea[name=intent]').fill('感谢你的夸奖');
        await dialog.locator('form[data-editor] button[type=submit]').click();
        await page.waitForFunction(() => db.myStickers[0].semanticProfile?.status === 'confirmed');
        assert.equal(await page.evaluate(() => db.myStickers[0].semanticProfile.intent), '感谢你的夸奖');
        assert.deepEqual(await page.evaluate(() => {
            storageValidateModules({ myStickers: [{ id: 'legacy', name: '旧表情', data: db.myStickers[0].data }] });
            storageValidateModules({ myStickers: [db.myStickers[0]] });
            try { storageValidateModules({ myStickers: [{ ...db.myStickers[0], semanticProfile: { version: 1, sourceKey: 'bad' } }] }); return false; }
            catch (error) { return /semanticProfile/.test(error.message); }
        }), true);
        const chat = await page.evaluate(() => {
            const chat = db.characters[0]; chat.history = [{ role: 'user', content: '我被夸奖了' }]; chat.stickerDescriptionSettings = { semanticPick: true }; return chat;
        });
        const contextText = await page.evaluate(async chat => getStickerSemanticContext(chat), chat);
        assert.match(contextText, /猫猫捂脸/);
        assert.doesNotMatch(contextText, /其他分组|下雨了/);
        await dialog.locator('[data-close]').click();
        await page.locator('#sticker-menu-btn').evaluate(el => el.click());
        await page.locator('#menu-sticker-semantic-library').evaluate(el => el.click());
        assert.equal(await page.locator('#sticker-semantic-library').evaluate(el => el.open), true);
        assert.deepEqual(errors, []);
        await context.close();
        console.log('PASS full app: sticker menu entry, image batch, duplicate-byte reuse, review, manual confirmation, group scope and reopen.');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
