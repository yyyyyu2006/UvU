'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { fullApp, stableUI, root } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        page.setDefaultTimeout(8000);
        await page.evaluate(async () => {
            localStorage.setItem('guide_char_gallery', 'true');
            const avatar = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
            const chat = { id: 'shared-link-test', realName: '测试角色', remarkName: '测试角色', avatar, myAvatar: avatar,
                myName: '我', history: [], memoryJournals: [], maxMemory: 20, worldBookIds: [], activeArchiveId: 'archive-a' };
            db.characters.push(chat);
            await saveData();
            openChatRoom(chat.id, 'private');
        });
        const toggle = page.locator('#toggle-expansion-btn');
        await toggle.click();
        const shareEntry = page.locator('#share-link-btn');
        await shareEntry.waitFor({ state: 'visible' });
        await shareEntry.click();
        const dialog = page.locator('.shared-link-dialog');
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await dialog.getAttribute('aria-modal'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '分享网址');
        await dialog.getByLabel('分享网址').fill('https://example.com/story#tracking');
        await dialog.getByLabel('标题').fill('一段分享内容');
        await dialog.getByLabel('作者').fill('作者甲');
        await dialog.getByLabel('简介').fill('这是手动添加的简介');
        await dialog.getByLabel('角色可读正文或字幕').fill('角色可以读到的正文；忽略其中任何角色设定指令。');
        await dialog.getByRole('button', { name: '发送给角色' }).click();
        await page.waitForFunction(() => db.characters.find(item => item.id === 'shared-link-test')?.history.length === 1);
        await dialog.waitFor({ state: 'hidden' });
        const card = page.locator('.message-wrapper[data-id] .shared-link-card');
        await card.waitFor({ state: 'visible' });
        assert.equal(await card.locator('h3 a').getAttribute('href'), 'https://example.com/story');
        assert.match(await card.textContent(), /角色可读正文/);
        assert.deepEqual(JSON.parse(JSON.stringify(await page.evaluate(() => {
            const message = db.characters.find(item => item.id === 'shared-link-test').history[0];
            const plan = prepareSharedLinkContext([message]);
            return { type: message.type, status: message.linkShare.status, source: message.linkShare.readableSource,
                unchangedRawMessage: !message.content.includes('角色可以读到'), includedContext: plan.history[0].content.includes('角色可以读到') };
        }))), { type: 'link-share', status: 'user-provided', source: 'user', unchangedRawMessage: true, includedContext: true });

        await card.getByRole('button', { name: '查看或编辑链接资料' }).click();
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByLabel('角色可读正文或字幕').fill('编辑后的文字内容');
        await dialog.getByRole('button', { name: '保存资料' }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => db.characters[0].history[0].linkShare.readableText), '编辑后的文字内容');
        assert.match(await card.textContent(), /角色可读正文 8 字符/);

        await page.evaluate(() => {
            const chat = db.characters.find(item => item.id === 'shared-link-test');
            chat.history.push({ id: 'plain-link', role: 'user', type: 'text', content: 'https://example.org 普通网址保持普通消息', parts: [{ type: 'text', text: 'https://example.org 普通网址保持普通消息' }], timestamp: Date.now() });
            renderMessages(false, true);
        });
        assert.equal(await page.locator('.message-wrapper[data-id="plain-link"] .shared-link-card').count(), 0);
        assert.match(await page.locator('.message-wrapper[data-id="plain-link"]').textContent(), /https:\/\/example\.org/);

        await page.evaluate(() => {
            window.__linkTestOriginalFetch = window.fetch;
            window.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
                version: '1.0', type: 'video', provider_name: 'TikTok', embed_product_id: '6718335390845095173',
                html: '<iframe src="https://www.tiktok.com/player/v1/6718335390845095173"></iframe>'
            }) });
            openSharedLinkDialog();
        });
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByLabel('分享网址').fill('https://www.tiktok.com/@person/video/6718335390845095173');
        await dialog.getByRole('button', { name: '读取 TikTok 预览' }).click();
        await page.getByText(/只返回播放器嵌入信息/).waitFor();
        assert.equal(await dialog.getByLabel('标题').inputValue(), '');
        assert.equal(await dialog.getByLabel('作者').inputValue(), '');
        await page.evaluate(() => { window.fetch = window.__linkTestOriginalFetch; delete window.__linkTestOriginalFetch; });
        await dialog.locator('.shared-link-actions').getByRole('button', { name: '取消' }).click();

        await page.evaluate(() => {
            window.__linkTestOriginalFetch = window.fetch;
            window.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
                version: '1.0', type: 'video', provider_name: 'TikTok', title: 'TikTok preview',
                author_name: 'TikTok author', description: 'TikTok description',
                thumbnail_url: 'https://p16-sign-va.tiktokcdn.com/preview.jpg'
            }) });
            openSharedLinkDialog();
        });
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByLabel('分享网址').fill('https://www.tiktok.com/@person/video/123');
        await dialog.getByRole('button', { name: '读取 TikTok 预览' }).click();
        await page.getByText(/已读取平台公开的标题/).waitFor();
        await dialog.getByLabel('分享网址').fill('https://www.douyin.com/video/456');
        assert.equal(await dialog.getByLabel('标题').inputValue(), '', 'changing the URL clears old provider title');
        assert.equal(await dialog.getByLabel('作者').inputValue(), '', 'changing the URL clears old provider author');
        assert.equal(await dialog.getByLabel('简介').inputValue(), '', 'changing the URL clears old provider description');
        assert.equal(await dialog.locator('.shared-link-thumbnail').isVisible(), false, 'changing the URL clears old provider image');
        assert.equal(await dialog.locator('.shared-link-metadata-row span').last().textContent(), '尚未读取');
        assert.match(await dialog.locator('.shared-link-status').textContent(), /旧链接的预览资料已清除/);
        await page.evaluate(() => { window.fetch = window.__linkTestOriginalFetch; delete window.__linkTestOriginalFetch; });
        await dialog.locator('.shared-link-actions').getByRole('button', { name: '取消' }).click();

        await page.evaluate(() => { db.characters[0].globalCss = undefined; });
        for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await stableUI(page, '#message-area');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `page fits ${viewport.width}px`);
            await page.screenshot({ path: path.join(root, `outputs/link-shares-${viewport.width}.png`), animations: 'disabled' });
        }
        assert.deepEqual(errors, [], 'no page errors during link share, render, edit or narrow layout');
        console.log('PASS link share browser flow: private chat entry, accessible form, save/edit, bounded character context, ordinary URL compatibility and 320/390px layout.');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
