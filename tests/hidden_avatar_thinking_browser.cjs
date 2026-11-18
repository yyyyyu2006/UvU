'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
const out = path.join(root, 'outputs/avatar-first-bubble-20261118');
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
                    { id: 'answer-continued', role: 'assistant', content: '[测试角色的消息：第二条「第二条翻译」]', thinkingMessageId: 'thinking', timestamp: Date.now() + 2 },
                    { id: 'none', role: 'assistant', content: '[测试角色的消息：没有保存记录]', thinkingMessageId: null, timestamp: Date.now() + 2 },
                    { id: 'user', role: 'user', content: '[我的消息：你好]', timestamp: Date.now() + 3 },
                    { id: 'withdrawn', role: 'assistant', content: '[测试角色的消息：已撤回]', isWithdrawn: true, timestamp: Date.now() + 4 }
                ] };
            db.characters = [chat]; ensureAllChatArchives(); await saveData();
            openChatRoom(chat.id, 'private'); showPanel('none'); GuideSystem.cleanup();
            window.avatarTestBefore = JSON.stringify(chat); window.avatarTestRequests = 0;
            window.fetch = async () => { avatarTestRequests++; throw Error('Unexpected API call'); };
        });
        const overlayIds = () => page.locator('.thinking-avatar-hit-target').evaluateAll(targets => targets.map(el => el.closest('.message-wrapper').dataset.id));
        assert.deepEqual(await overlayIds(), ['answer'], 'only the first bubble of a reply with saved thinking has a transparent target');
        const closeThinking = async () => {
            await page.keyboard.press('Escape');
            await page.locator('#char-thinking-dialog').waitFor({state:'detached'});
        };
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
            const layout = await page.evaluate(() => {
                const trigger = document.querySelector('[data-id=answer] .thinking-avatar-hit-target');
                const measure = () => [...document.querySelectorAll('#message-area .message-wrapper, #message-area .message-bubble, #message-area .message-info')]
                    .map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
                const withTarget = measure();
                trigger.style.display = 'none';
                const withoutTarget = measure();
                trigger.style.removeProperty('display');
                return { withTarget, withoutTarget };
            });
            assert.deepEqual(layout.withTarget, layout.withoutTarget, 'transparent layer must not change any bubble, avatar slot or message position');
            assert.equal(await trigger.evaluate(el => getComputedStyle(el).position), 'absolute');
            assert.equal(await page.locator('[data-id=answer] .message-avatar').evaluate(el => getComputedStyle(el).display), 'none');
            assert.equal(await trigger.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
            await action(() => trigger.tap());
            await stableUI(page, '#char-thinking-dialog');
            assert.equal(await page.locator('.char-thinking-content').textContent(), '隔离测试保存内容');
            await page.screenshot({ path: path.join(out, `hidden-avatar-${width}-${bilingual}.png`) });
            await closeThinking();
            assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
            for (const key of ['Enter', 'Space']) {
                await action(() => trigger.press(key));
                assert.equal(await page.locator('#char-thinking-dialog').count(), 1);
                await closeThinking();
            }
            const text = await page.locator('[data-id=answer] .message-bubble').boundingBox();
            // The avatar-origin layer intentionally owns its small overlapping
            // region. The rest of the bubble retains its ordinary actions.
            await action(() => page.touchscreen.tap(text.x + text.width - 4, text.y + text.height / 2));
            assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
            if (bilingual) assert.equal(await page.locator('[data-id=answer] .translation-text').isVisible(), true);
        }
        for (const id of ['user', 'withdrawn', 'thinking']) assert.equal(await page.locator(`[data-id=${id}] [data-thinking-avatar]`).count(), 0);
        const continuation = page.locator('[data-id=answer-continued] .message-bubble');
        await action(() => continuation.tap());
        assert.equal(await page.locator('[data-id=answer-continued] .translation-text').isVisible(), true);
        assert.equal(await page.locator('[data-id=none] [data-thinking-avatar]').count(), 0);
        assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
        await page.evaluate(() => { isInMultiSelectMode = true; });
        await action(() => page.locator('[data-id=answer] [data-thinking-avatar]').tap());
        assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
        await page.evaluate(() => { isInMultiSelectMode = false; selectedMessageIds.clear(); });
        for (const [name, css] of [
            ['default', '/* original theme */'],
            ['compact', '.received .message-bubble{border-radius:4px;padding:20px 12px;background:#fff}.message-info{gap:4px}.message-avatar{border-radius:0}'],
            ['mail', '.message-bubble-row{gap:0}.received .message-bubble{background:#fff;border:1px solid #ddd;border-radius:12px;margin-left:3px}.received .message-bubble:before{content:"New Message";display:block;color:#999;font-size:10px}']
        ]) {
            const style = await page.addStyleTag({ content: css });
            for (const width of [320, 390, 768]) {
                await page.setViewportSize({ width, height: 844 });
                await page.evaluate(() => { document.activeElement.blur(); renderMessages(false, false); });
                await stableUI(page, '#message-area');
                const capture = { style: '#toast-notification{visibility:hidden !important}' };
                const before = await page.locator('#message-area').screenshot({ ...capture, path: path.join(out, `overlay-${name}-${width}.png`) });
                const dimensions = await page.evaluate(() => {
                    const measure = () => [...document.querySelectorAll('#message-area .message-wrapper, #message-area .message-bubble, #message-area .message-info')]
                        .map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
                    const withLayer = measure();
                    document.querySelectorAll('.thinking-avatar-hit-target').forEach(el => el.remove());
                    return { withLayer, withoutLayer: measure() };
                });
                const after = await page.locator('#message-area').screenshot({ ...capture, path: path.join(out, `no-overlay-${name}-${width}.png`) });
                assert.deepEqual(dimensions.withLayer, dimensions.withoutLayer, `${name}/${width}: layout unchanged`);
                assert.ok(before.equals(after), `${name}/${width}: screenshot identical with and without overlay`);
                await page.evaluate(() => renderMessages(false, false));
            }
            await style.evaluate(el => el.remove());
        }
        await action(() => page.locator('[data-id=answer] [data-thinking-avatar]').tap());
        assert.equal(await page.locator('.char-thinking-content').textContent(), '隔离测试保存内容');
        await closeThinking();
        await page.screenshot({ path: path.join(out, 'hidden-avatar-custom-style.png') });
        assert.equal(await page.evaluate(() => avatarTestRequests), 0);
        await page.evaluate(() => { db.characters[0].bilingualModeEnabled = false; });
        assert.equal(await page.evaluate(() => JSON.stringify(db.characters[0]) === avatarTestBefore), true);
        for (const mode of ['full', 'merge', 'kkt', 'hidden']) {
            await page.evaluate(mode => { db.characters[0].avatarMode = mode; renderMessages(false, false); }, mode);
            assert.equal(await page.locator('.thinking-avatar-hit-target').count(), mode === 'hidden' ? 1 : 0);
            await action(() => page.locator('[data-id=answer] [data-thinking-avatar]').click());
            assert.equal(await page.locator('#char-thinking-dialog').count(), 1);
            await closeThinking();
        }
        await page.evaluate(async () => { await saveData(); });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => db.characters.some(chat => chat.id === 'hidden-avatar'));
        await page.evaluate(() => { GuideSystem.cleanup(); openChatRoom('hidden-avatar', 'private'); showPanel('none'); });
        await action(() => page.locator('[data-id=answer] [data-thinking-avatar]').tap());
        assert.equal(await page.locator('.char-thinking-content').textContent(), '隔离测试保存内容');
        assert.deepEqual(await overlayIds(), ['answer']);
        await closeThinking();
        await page.evaluate(async () => {
            const chat = db.characters[0];
            await handleAiReplyContent('<thinking>新的一轮</thinking>[测试角色的消息：新一轮首条][测试角色的消息：新一轮第二条]', chat, chat.id, 'private', true);
            window.newReplyIds = chat.history.slice(-2).map(msg => msg.id);
        });
        const [nextFirst, nextSecond] = await page.evaluate(() => window.newReplyIds);
        assert.deepEqual(await overlayIds(), ['answer', nextFirst], 'appending two consecutive reply bubbles only adds one target');
        assert.equal(await page.locator(`[data-id="${nextSecond}"] [data-thinking-avatar]`).count(), 0);
        await action(() => page.locator(`[data-id="${nextFirst}"] [data-thinking-avatar]`).tap());
        assert.equal(await page.locator('.char-thinking-content').textContent(), '新的一轮');
        await closeThinking();
        await page.evaluate(() => {
            const chat = db.characters[0], now = Date.now();
            chat.history.push({ id: 'legacy-thinking', role: 'assistant', content: '<thinking>旧存档思考</thinking>', timestamp: now });
            for (let i=0; i<=MESSAGES_PER_PAGE; i++) chat.history.push({ id: 'legacy-' + i, role: 'assistant', content: '[测试角色的消息：旧存档第' + i + '条]', timestamp: now + i + 1 });
            currentPage = 1; renderMessages(false, true);
        });
        assert.deepEqual(await overlayIds(), [], 'pagination does not move the target to a continuation');
        await action(() => page.locator('#load-more-btn').click());
        assert.deepEqual(await overlayIds(), ['answer', nextFirst, 'legacy-0']);
        await action(() => page.locator('[data-id=legacy-0] [data-thinking-avatar]').tap());
        assert.equal(await page.locator('.char-thinking-content').textContent(), '旧存档思考');
        await closeThinking();
        assert.deepEqual(errors, []);
        console.log('PASS hidden avatar: absolute overlay, pixel-identical layout in 3 styles x 3 widths, touch/keyboard, bilingual outside overlay, no API/mutation, modes and reload');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
