'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp, root } = require('./helpers/full_app_browser.cjs');
const out = path.join(root, 'outputs/avatar-sticker-20261118');
fs.mkdirSync(out, { recursive: true });
(async () => {
    const app = await fullApp(), findings = [];
    try {
        for (const type of ['private', 'group']) {
            const { page, context, errors } = await app.page();
            await page.evaluate(async type => {
                const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="pink"/></svg>');
                const chat = { id: 'sticker-check', realName: '测试角色', name: '测试群', remarkName: '测试角色', myName: '我', avatar: image, myAvatar: image,
                    me: { nickname: '我' }, members: [{ id: 'member', realName: '测试角色', groupNickname: '测试角色', avatar: image }],
                    stickerGroups: '测试分组', persona: '', history: [], maxMemory: 20, worldBookIds: [], memoryJournals: [] };
                db.characters = type === 'private' ? [chat] : []; db.groups = type === 'group' ? [chat] : [];
                db.myStickers = [{ id: 's', group: '测试分组', name: '开心', data: image }];
                ensureAllChatArchives(); await saveData(); openChatRoom(chat.id, type); GuideSystem.cleanup(); showPanel('none');
            }, type);
            const tag = type === 'private' ? '的表情包' : '发送的表情包';
            await page.evaluate(async ({ type, tag }) => {
                const chat = (type === 'private' ? db.characters : db.groups)[0];
                await handleAiReplyContent(`[测试角色${tag}：开心]`, chat, chat.id, type, true);
            }, { type, tag });
            const sticker = page.locator('.message-wrapper.received .image-bubble');
            assert.equal(await sticker.count(), 1, type + ' standard sticker is rendered');
            assert.equal(await sticker.locator('img').getAttribute('alt'), '表情包');
            assert.equal(await page.locator('.pv-card').count(), 0);
            const result = await page.evaluate(type => {
                const chat = (type === 'private' ? db.characters : db.groups)[0], message = chat.history.at(-1);
                const image = document.querySelector('.message-wrapper.received .image-bubble img');
                const before = JSON.stringify(message);
                const normalized = filterHistoryForAI(chat, [message])[0];
                return { type, content: message.content, parts: message.parts.map(part => part.type), alt: image.alt,
                    libraryImage: image.getAttribute('src') === db.myStickers[0].data, normalizedContent: normalized.content,
                    unchanged: JSON.stringify(message) === before };
            }, type);
            assert.equal(result.libraryImage, true); assert.equal(result.unchanged, true);
            assert.deepEqual(result.parts, ['text']); assert.match(result.normalizedContent, /表情包：开心/);
            await page.screenshot({ path: path.join(out, `standard-sticker-${type}.png`) });
            await page.evaluate(async type => {
                const chat = (type === 'private' ? db.characters : db.groups)[0];
                await handleAiReplyContent('[测试角色发来的照片/视频：开心]', chat, chat.id, type, true);
            }, type);
            assert.equal(await page.locator('.pv-card').count(), 1, 'photo tag stays a photo even when name exists in sticker library');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(type => (type === 'private' ? db.characters : db.groups).some(chat => chat.id === 'sticker-check'), type);
            await page.evaluate(type => { GuideSystem.cleanup(); openChatRoom('sticker-check', type); GuideSystem.cleanup(); }, type);
            assert.equal(await page.locator('.image-bubble img[alt=表情包]').count(), 1);
            assert.equal(await page.locator('.pv-card').count(), 1);
            assert.deepEqual(errors, []); findings.push(result); await context.close();
        }
        fs.writeFileSync(path.join(out, 'sticker-classification.json'), JSON.stringify(findings, null, 2));
        console.log('PASS private/group sticker tags: text history, exact library image, distinct photo card, no history mutation, reload');
        console.log(JSON.stringify(findings));
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
