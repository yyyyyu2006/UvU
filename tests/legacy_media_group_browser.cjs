'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { fullApp, stableUI } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(); let passed = 0, failed = 0;
    async function check(name, run, options) {
        if (process.argv[2] && !name.includes(process.argv[2])) return;
        const f = await app.page(options);
        try { await run(f.page); assert.deepEqual(f.errors, [], 'no uncaught page errors'); passed++; console.log('PASS ' + name); }
        catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
        finally { await f.context.close(); }
    }
    async function group(page, messages, me = 'User_U') {
        await page.evaluate(async ({ messages, me }) => {
            db.groups = [{ id: 'bounds-group', name: 'Fixture', me: { nickname: me }, members: [], allowGossip: true,
                history: messages.map((content, i) => ({ id: 'fixture-' + i, content, role: 'assistant', timestamp: i + 1 })) }];
            currentChatId = 'bounds-group'; currentChatType = 'group'; activePrivateSessionId = null;
            await saveData(); document.getElementById('private-chat-overlay').classList.add('visible'); renderPrivateChatMonitor();
        }, { messages, me });
    }
    async function profile(page) {
        await page.evaluate(async () => {
            db.characters = [{ id: 'profile-fixture', realName: '测试角色', remarkName: '测试角色', myName: '测试用户',
                persona: '测试资料。'.repeat(200), history: [], maxMemory: 20, worldBookIds: [], avatar: 'assets/music/cover-placeholder.svg' }];
            ensureAllChatArchives(); await saveData(); switchScreen('contacts-screen'); renderContactList(); openProfileCard('profile-fixture');
        });
        await stableUI(page, '#profile-card-modal');
    }
    async function hit(page, selector) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const result = await page.locator(selector).evaluate(button => {
            const r = button.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { hit: button === top || button.contains(top), inView: r.top >= 0 && r.bottom <= innerHeight, top: top?.id };
        });
        assert.equal(result.inView, true, selector + ' must be within viewport'); assert.equal(result.hit, true, selector + ' blocked by ' + result.top);
    }
    try {
        await check('real image compression obeys unequal bounds and preserves GIF bytes', async page => {
            const result = await page.evaluate(async () => {
                const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1000;
                const file = new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], 'bounds.png', { type: 'image/png' });
                const img = new Image(); img.src = await compressImage(file, { maxWidth: 800, maxHeight: 200 }); await img.decode();
                const gif = new File(['fixture-gif-bytes'], 'animated.gif', { type: 'image/gif' });
                return { size: [img.width, img.height], gif: await compressImage(gif) };
            });
            assert.deepEqual(result.size, [240, 200]); assert.equal(result.gif, 'data:image/gif;base64,Zml4dHVyZS1naWYtYnl0ZXM=');
        });
        await check('red packet form rejects insufficient totals without writing history', async page => {
            await group(page, []);
            const result = await page.evaluate(async () => {
                document.getElementById('send-red-packet-modal').classList.add('visible');
                document.getElementById('red-packet-amount-input').value = '0.01'; document.getElementById('red-packet-count-input').value = '3';
                document.getElementById('send-red-packet-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                await saveData(); return { length: db.groups[0].history.length, visible: document.getElementById('send-red-packet-modal').classList.contains('visible') };
            });
            assert.deepEqual(result, { length: 0, visible: true });
        });
        await check('unreadable images and unavailable encoders reject without uncaught errors', async page => {
            const result = await page.evaluate(async () => {
                let decodeRejected = false, encodeRejected = false;
                try { await compressImage(new File(['invalid image'], 'broken.jpg', { type: 'image/jpeg' })); } catch (_) { decodeRejected = true; }
                const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const original = HTMLCanvasElement.prototype.toDataURL;
                try {
                    HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('fixture encoder failure'); };
                    try { await compressImage(new File([blob], 'valid.png', { type: 'image/png' })); } catch (error) { encodeRejected = error.message === 'fixture encoder failure'; }
                } finally { HTMLCanvasElement.prototype.toDataURL = original; }
                return { decodeRejected, encodeRejected };
            });
            assert.deepEqual(result, { decodeRejected: true, encodeRejected: true });
        });
        await check('valid cent-only red packets save exact positive allocations', async page => {
            await group(page, []);
            const result = await page.evaluate(async () => {
                document.getElementById('red-packet-amount-input').value = '0.03'; document.getElementById('red-packet-count-input').value = '3';
                document.getElementById('send-red-packet-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                await saveData(); return (await dexieDB.groups.get('bounds-group')).history[0];
            });
            assert.deepEqual(result.pool, [0.01, 0.01, 0.01]); assert.equal(result.totalAmount, 0.03); assert.equal(result.count, 3);
        });
        await check('private replies preserve underscores in both names', async page => {
            await group(page, ['[Private: Alice_A -> User_U: Hello]']);
            await stableUI(page, '#private-chat-overlay'); await page.locator('#private-chat-input').fill('Reply'); await page.locator('#private-chat-input').press('Enter');
            assert.equal(await page.evaluate(() => db.groups[0].history.at(-1).content), '[Private: User_U -> Alice_A: Reply]');
        });
        await check('ending a private session preserves complete participant names', async page => {
            await group(page, ['[Private: Alice_A -> User_U: Hello]']);
            page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept());
            await stableUI(page, '#private-chat-overlay'); await page.locator('#private-chat-tabs .close-tab').click();
            assert.equal(await page.evaluate(() => db.groups[0].history.at(-1).content), '[Private-End: Alice_A -> User_U]');
            assert.equal(await page.locator('#private-chat-input-area').evaluate(n => n.classList.contains('visible')), false);
        });
        await check('underscore name pairs cannot collide into one tab', async page => {
            await group(page, ['[Private: A_B -> C: First]', '[Private: A -> B_C: Second]'], 'A');
            assert.equal(await page.locator('#private-chat-tabs .tab-open').count(), 2);
            await page.locator('#private-chat-tabs .tab-open').filter({ hasText: 'A_B & C' }).click();
            assert.match(await page.locator('#private-chat-content').innerText(), /First/); assert.doesNotMatch(await page.locator('#private-chat-content').innerText(), /Second/);
        });
        await check('open private session uses the same identity for unread tracking', async page => {
            await group(page, ['[Private: Alice_A -> User_U: Hello]']);
            const unread = await page.evaluate(() => { gossipUnreadMap = {}; handleGossipMessage(db.groups[0], '[Private: User_U -> Alice_A: Next]'); return Object.values(gossipUnreadMap); });
            assert.deepEqual(unread, []);
        });
        await check('user cannot send into a private session between two NPCs', async page => {
            await group(page, ['[Private: Alice_A -> Bob_B: Hello]']);
            await page.evaluate(() => sendGossipMessage('Wrong destination'));
            assert.equal(await page.evaluate(() => db.groups[0].history.length), 1);
        });
        await check('legacy private sessions retain their text after migration and rebuilding tabs', async page => {
            await group(page, []);
            const result = await page.evaluate(async () => {
                const group = db.groups[0];
                group.privateSessions = { old_key: { memberNames: ['Alice_A', 'User_U'], history: [{ id: 'old-msg', sender: 'Alice_A', content: 'Legacy', timestamp: 1 }] } };
                migratePrivateSessionsToHistory(group); await saveData();
                db.groups[0] = await dexieDB.groups.get(group.id); activePrivateSessionId = null; renderPrivateChatMonitor();
                sendGossipMessage('Reply'); await saveData();
                return (await dexieDB.groups.get(group.id)).history.map(message => message.content);
            });
            assert.deepEqual(result, ['[Private: Alice_A -> User_U: Legacy]', '[Private: User_U -> Alice_A: Reply]']);
        });
        for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 568, height: 320 }]) {
            await check(`profile actions remain reachable ${size.width}x${size.height}`, async page => {
                await profile(page); await hit(page, '#pc-message-btn'); await hit(page, '#pc-settings-btn');
                const out = process.env.UVU_TEST_OUTPUT_DIR;
                if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `profile-fixed-${size.width}x${size.height}.png`) }); }
                await page.locator('#pc-message-btn').click();
                assert.equal(await page.locator('#chat-room-screen').evaluate(n => n.classList.contains('active')), true);
            }, { viewport: size });
        }
        await check('profile token breakdown stays above the profile and can be closed', async page => {
            await profile(page);
            await page.locator('#pc-stat-memory').click(); await stableUI(page, '#token-breakdown-modal');
            await hit(page, '#close-token-breakdown-btn'); await page.locator('#close-token-breakdown-btn').click();
            await hit(page, '#pc-message-btn');
        }, { viewport: { width: 320, height: 568 } });
        console.log(`RESULT ${passed} passed; ${failed} failed`); if (failed) process.exitCode = 1;
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
