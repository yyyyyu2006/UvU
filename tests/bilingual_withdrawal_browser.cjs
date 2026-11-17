'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
const out = path.join(root, 'outputs/message-menu-20261117');
fs.mkdirSync(out, { recursive: true });

(async () => {
    const app = await fullApp(), results = [], failures = [];
    try {
        // Representative CSS samples, not the user's unavailable third-party theme.
        const themes = {
            default: '',
            mail: '.received .message-bubble{border:1px solid #ddd;border-radius:3px;padding:28px 18px 16px;background:#fff;position:relative}.received .message-bubble::before{content:"New Message";position:absolute;top:4px;left:12px;font-size:10px;color:#888}.translation-bubble{background:#222;color:#fff}',
            compact: '.message-bubble{border-radius:20px;padding:8px 12px;background:#e5effa}.translation-bubble{font-size:12px;border-radius:8px}'
        };
        for (const type of ['private', 'group']) for (const [theme, css] of Object.entries(themes)) {
            const { page, context, errors } = await app.page({ viewport: { width: 390, height: 740 }, isMobile: true });
            try {
                await page.evaluate(async ({ type, css }) => {
                    for (const key of ['guide_search_entry', 'guide_char_gallery', 'guide_group_summary', 'guide_group_notice', 'guide_group_gossip']) localStorage.setItem(key, 'true');
                    GuideSystem.cleanup();
                    const chat = { id: 'recall-test', realName: '测试角色', remarkName: '测试角色', name: '测试群', myName: '我', persona: '', maxMemory: 20, worldBookIds: [],
                        me: { nickname: '我' }, members: [{ id: 'member', realName: '测试角色', groupNickname: '测试角色' }],
                        customBubbleCss: css, useCustomBubbleCss: Boolean(css),
                        bilingualModeEnabled: true, history: [{ id: 'source', role: 'assistant', senderId: 'member', content: '[测试角色的消息：Hello「你好」]', timestamp: Date.now() }] };
                    db.characters = type === 'private' ? [chat] : []; db.groups = type === 'group' ? [chat] : []; db.myStickers = [];
                    ensureAllChatArchives(); await saveData(); openChatRoom(chat.id, type); GuideSystem.cleanup();
                }, { type, css });
                const cdp = await context.newCDPSession(page);
                const box = await page.locator('.message-wrapper[data-id=source] .message-bubble').boundingBox();
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
                await page.waitForTimeout(650);
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                await page.locator('.context-menu-item').filter({ hasText: /^引用$/ }).tap();
                assert.equal(await page.evaluate(() => currentQuoteInfo?.id), 'source');
                assert.equal(await page.evaluate(() => document.activeElement.id), 'message-input');
                await page.locator('#message-input').fill('引用回复');
                await page.evaluate(() => sendMessage());
                const sent = await page.evaluate(type => (type === 'private' ? db.characters : db.groups)[0].history.at(-1), type);
                assert.equal(sent.quote?.messageId, 'source');
                assert.equal(sent.quote.content, 'Hello「你好」');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
                await page.evaluate(type => { GuideSystem.cleanup(); openChatRoom('recall-test', type); GuideSystem.cleanup(); }, type);
                const quoted = page.locator('.message-wrapper[data-id="' + sent.id + '"] .quoted-message');
                assert.equal(await quoted.locator('.quoted-text').textContent(), 'Hello「你好」');
                assert.equal(await page.evaluate(type => (type === 'private' ? db.characters : db.groups)[0].history.at(-1).quote?.messageId, type), 'source');
                await page.evaluate(async type => {
                    cancelQuoteReply(); messageInput.blur();
                    const chat = (type === 'private' ? db.characters : db.groups)[0];
                    await handleAiReplyContent('[测试角色撤回了一条消息：Secret「已撤回内容」]', chat, chat.id, type, true);
                }, type);
                await page.waitForFunction(type => (type === 'private' ? db.characters : db.groups)[0].history.some(message => message.isWithdrawn), type);
                await page.waitForTimeout(100);
                const recall = await page.evaluate(type => {
                    const chat = (type === 'private' ? db.characters : db.groups)[0], message = chat.history.at(-1);
                    const row = [...document.querySelectorAll('.message-wrapper')].find(row => row.dataset.id === message.id);
                    handleMessageLongPress(row, 100, 200);
                    return { classes: row.className, text: row.textContent, notice: row.querySelector('.withdrawn-message')?.textContent,
                        labels: [...document.querySelectorAll('.context-menu-item')].map(item => item.textContent),
                        contentDisplay: row.querySelector('.withdrawn-content') && getComputedStyle(row.querySelector('.withdrawn-content')).display };
                }, type);
                results.push({ type, theme, persistedQuote: sent.quote, recall });
                try {
                    assert.match(recall.notice || '', /撤回了一条消息/, 'automatic recall must render a withdrawal notice');
                    assert.equal(recall.contentDisplay, 'none', 'withdrawn text stays collapsed');
                    assert.ok(!recall.labels.includes('引用') && recall.labels.includes('删除'));
                } catch (error) { failures.push({ type, theme, error: error.message }); }
                await stableUI(page, '.context-menu');
                await page.screenshot({ path: path.join(out, 'recall-' + type + '-' + theme + '.png') });
                await page.evaluate(() => { removeContextMenu(); renderMessages(false, true); });
                try { assert.equal(await page.locator('.withdrawn-message').count(), 1, 'rerender preserves withdrawal presentation'); }
                catch (error) { failures.push({ type, theme, rerender: error.message }); }
                assert.deepEqual(errors, []);
            } finally { await context.close(); }
        }
        fs.writeFileSync(path.join(out, 'recall-regression.json'), JSON.stringify({ results, failures }, null, 2));
        assert.deepEqual(failures, []);
        console.log('PASS 6 private/group and representative-style scenarios: native touch quote, send/reload persistence, automatic bilingual withdrawal and rerender');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
