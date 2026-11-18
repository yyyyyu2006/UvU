'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
const out = path.join(root, 'outputs/avatar-sticker-20261118');
fs.mkdirSync(out, { recursive: true });
(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        await page.evaluate(async () => {
            const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="pink"/></svg>');
            const chat = { id: 'hidden-avatar', realName: '测试角色', remarkName: '测试角色', myName: '我', avatar, myAvatar: avatar,
                avatarMode: 'hidden', bilingualModeEnabled: false, maxMemory: 20, worldBookIds: [], memoryJournals: [],
                history: [
                    { id: 'thinking', role: 'assistant', isThinking: true, content: '<thinking>隔离测试保存内容</thinking>', timestamp: Date.now() },
                    { id: 'answer', role: 'assistant', content: '[测试角色的消息：Hello「你好」]', thinkingMessageId: 'thinking', timestamp: Date.now() + 1 },
                    { id: 'none', role: 'assistant', content: '[测试角色的消息：没有保存记录]', thinkingMessageId: null, timestamp: Date.now() + 2 },
                    { id: 'user', role: 'user', content: '[我的消息：你好]', timestamp: Date.now() + 3 },
                    { id: 'withdrawn', role: 'assistant', content: '[测试角色的消息：已撤回]', isWithdrawn: true, timestamp: Date.now() + 4 }
                ] };
            db.characters = [chat]; ensureAllChatArchives(); await saveData();
            openChatRoom(chat.id, 'private'); showPanel('none'); GuideSystem.cleanup();
            window.avatarTestBefore = JSON.stringify(chat); window.avatarTestRequests = 0;
            window.fetch = async () => { avatarTestRequests++; throw Error('Unexpected API call'); };
        });
        let time = Date.parse('2026-11-18T04:00:00Z');
        const action = async fn => { await page.clock.setFixedTime(new Date(time += 2000)); await fn(); };
        for (const width of [320, 390, 768]) for (const bilingual of [false, true]) {
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(bilingual => { db.characters[0].bilingualModeEnabled = bilingual; renderMessages(false, false); }, bilingual);
            const trigger = page.locator('[data-id=answer] [data-thinking-avatar]');
            assert.equal(await trigger.count(), 1, 'hidden mode retains an entry in the avatar slot');
            assert.equal(await trigger.evaluate(el => el.tagName), 'BUTTON');
            const hit = await trigger.boundingBox();
            const bubble = await page.locator('[data-id=answer] .message-bubble').boundingBox();
            assert.ok(hit.width >= 36 && hit.height >= 36);
            assert.ok(hit.x + hit.width <= bubble.x + 1, 'avatar target must not cover message actions');
            assert.equal(await page.locator('[data-id=answer] .message-avatar').evaluate(el => getComputedStyle(el).display), 'none');
            assert.equal(await trigger.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
            await action(() => trigger.tap());
            await stableUI(page, '#char-thinking-dialog');
            assert.equal(await page.locator('.char-thinking-content').textContent(), '隔离测试保存内容');
            await page.screenshot({ path: path.join(out, `hidden-avatar-${width}-${bilingual}.png`) });
            await page.keyboard.press('Escape');
            assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
            for (const key of ['Enter', 'Space']) {
                await action(() => trigger.press(key));
                assert.equal(await page.locator('#char-thinking-dialog').count(), 1);
                await page.keyboard.press('Escape');
            }
            await action(() => page.locator('[data-id=answer] .message-bubble').tap());
            assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
        }
        for (const id of ['user', 'withdrawn', 'thinking']) assert.equal(await page.locator(`[data-id=${id}] [data-thinking-avatar]`).count(), 0);
        await action(() => page.locator('[data-id=none] [data-thinking-avatar]').tap());
        assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
        await page.evaluate(() => { isInMultiSelectMode = true; });
        await action(() => page.locator('[data-id=answer] [data-thinking-avatar]').tap());
        assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
        await page.evaluate(() => { isInMultiSelectMode = false; selectedMessageIds.clear(); });
        await page.addStyleTag({ content: '.received .message-bubble{border-radius:4px;padding:20px 12px;background:#fff}.message-info{gap:4px}.message-avatar{border-radius:0}' });
        await action(() => page.locator('[data-id=answer] [data-thinking-avatar]').tap());
        assert.equal(await page.locator('.char-thinking-content').textContent(), '隔离测试保存内容');
        await page.keyboard.press('Escape');
        await page.screenshot({ path: path.join(out, 'hidden-avatar-custom-style.png') });
        assert.equal(await page.evaluate(() => avatarTestRequests), 0);
        await page.evaluate(() => { db.characters[0].bilingualModeEnabled = false; });
        assert.equal(await page.evaluate(() => JSON.stringify(db.characters[0]) === avatarTestBefore), true);
        for (const mode of ['full', 'merge', 'kkt', 'hidden']) {
            await page.evaluate(mode => { db.characters[0].avatarMode = mode; renderMessages(false, false); }, mode);
            assert.equal(await page.locator('.thinking-avatar-hit-target').count(), mode === 'hidden' ? 2 : 0);
            await action(() => page.locator('[data-id=answer] [data-thinking-avatar]').click());
            assert.equal(await page.locator('#char-thinking-dialog').count(), 1);
            await page.keyboard.press('Escape');
        }
        await page.evaluate(async () => { await saveData(); });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => db.characters.some(chat => chat.id === 'hidden-avatar'));
        await page.evaluate(() => { GuideSystem.cleanup(); openChatRoom('hidden-avatar', 'private'); showPanel('none'); });
        await action(() => page.locator('[data-id=answer] [data-thinking-avatar]').tap());
        assert.equal(await page.locator('.char-thinking-content').textContent(), '隔离测试保存内容');
        assert.deepEqual(errors, []);
        console.log('PASS hidden avatar: touch/Enter/Space, saved content, no overlap/API/mutation, bilingual, 320/390/768, mode switches and reload');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
