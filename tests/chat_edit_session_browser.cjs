// Isolated full app: exercise original edit controls while asynchronous work is held.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {fullApp, root, stableUI} = require('./helpers/full_app_browser.cjs');
const out = path.resolve(process.env.UVU_EDIT_OUT || path.join(root, 'outputs/chat-edit-session'));
fs.mkdirSync(out, {recursive: true});
(async () => {
    const app = await fullApp(), results = [];
    try {
        for (const width of [320, 390]) for (const mode of ['reopen', 'resubmit', 'saved-reopen']) {
            const {page, context, errors} = await app.page({viewport: {width, height: 740}});
            if (process.env.UVU_EDIT_TEST_REF) {
                const ref = process.env.UVU_EDIT_TEST_REF;
                if (!/^[a-f0-9]{40}$/.test(ref)) throw Error('UVU_EDIT_TEST_REF requires an explicit commit SHA');
                const source = execFileSync('git', ['show', ref + ':js/modules/chat_ops.js'], {cwd: root, encoding: 'utf8'});
                let intercepted = 0;
                await page.route(url => url.pathname.endsWith('/js/modules/chat_ops.js'), route => { intercepted++; return route.fulfill({body: source, contentType: 'application/javascript'}); });
                await page.reload({waitUntil: 'domcontentloaded'});
                await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
                assert.equal(intercepted, 1, 'explicit old source must actually replace the versioned script');
                assert.equal(await page.evaluate(() => saveMessageEdit.toString().includes('messageEditRevision')), false, 'old handler must not contain the fix');
            }
            await page.evaluate(async mode => {
                for (const key of ['guide_search_entry', 'guide_char_gallery', 'guide_group_summary', 'guide_group_notice', 'guide_group_gossip']) localStorage.setItem(key, 'true');
                GuideSystem.cleanup();
                db.characters = [{id: 'edit-fixture', realName: '测试角色', remarkName: '测试角色', myName: '我', persona: '', maxMemory: 20, worldBookIds: [], history: [
                    {id: 'edit-source', role: 'assistant', content: '[测试角色的消息：原始内容]', timestamp: Date.now()}
                ]}]; db.groups = []; ensureAllChatArchives(); await saveData(); openChatRoom('edit-fixture', 'private'); GuideSystem.cleanup();
                const chat = db.characters[0];
                if (mode !== 'saved-reopen') chat.statusPanel = {enabled: true, regexPattern: '<status>(.*?)</status>', replacePattern: '$1'};
                window.editWaits = []; window.editSaves = 0;
                const originalMutation = saveChatMutation;
                if (mode === 'saved-reopen') saveChatMutation = async (...args) => { editSaves++; await new Promise(resolve => editWaits.push(resolve)); return originalMutation(...args); };
                else { prepareStatusRegexJobs = () => new Promise(resolve => editWaits.push(resolve)); saveChatMutation = async (...args) => { editSaves++; return originalMutation(...args); }; }
            }, mode);
            const openEditor = async () => {
                await page.locator('.message-wrapper[data-id=edit-source] .message-bubble').click({button: 'right'});
                await page.locator('.context-menu-item').filter({hasText: /^编辑$/}).click();
                await page.locator('#message-edit-modal').waitFor({state: 'visible'});
            };
            await openEditor();
            await page.locator('#message-edit-textarea').fill('旧保存内容');
            await page.locator('#message-edit-form button[type=submit]').click();
            await page.waitForFunction(() => editWaits.length === 1);
            if (mode !== 'resubmit') { await page.locator('#cancel-edit-modal-btn').click(); await openEditor(); }
            await page.locator('#message-edit-textarea').fill('新草稿内容');
            if (mode === 'resubmit') { await page.locator('#message-edit-form button[type=submit]').click(); await page.waitForFunction(() => editWaits.length === 2); }
            await page.evaluate(() => editWaits.shift()());
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const result = await page.evaluate(async () => {
                const stored = await dexieDB.characters.get('edit-fixture');
                return {content: db.characters[0].history[0].content, stored: stored.history[0].content, saves: editSaves,
                    visible: document.getElementById('message-edit-modal').classList.contains('visible'), draft: document.getElementById('message-edit-textarea').value};
            });
            if (mode === 'resubmit' && result.saves === 0) {
                await page.evaluate(() => editWaits.shift()());
                await page.locator('#message-edit-modal').waitFor({state: 'hidden'});
                result.final = await page.evaluate(async () => ({content: db.characters[0].history[0].content, stored: (await dexieDB.characters.get('edit-fixture')).history[0].content, saves: editSaves}));
            }
            results.push({width, mode, knownLegacy: mode === 'saved-reopen', ...result, errors});
            if (mode === 'reopen') {
                await stableUI(page, '#message-edit-modal .modal-window');
                await page.screenshot({path: path.join(out, 'reopen-' + width + '.png')});
            }
            await context.close();
        }
        fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(results, null, 2));
        for (const r of results) {
            assert.equal(r.content, r.mode === 'saved-reopen' ? '[测试角色的消息：旧保存内容]' : '[测试角色的消息：原始内容]', r.mode + ' content at ' + r.width);
            assert.equal(r.stored, r.content); assert.equal(r.saves, r.mode === 'saved-reopen' ? 1 : 0);
            // Existing 1900 save-completion close is recorded, not repaired in this derivative-only patch.
            assert.equal(r.visible, r.mode !== 'saved-reopen', r.mode + ' editor state'); assert.equal(r.draft, '新草稿内容');
            if (r.mode === 'resubmit') { assert.equal(r.final.content, '[测试角色的消息：新草稿内容]'); assert.equal(r.final.stored, r.final.content); assert.equal(r.final.saves, 1); }
            assert.deepEqual(r.errors, []);
        }
        console.log('PASS 4 full-app fix checks at 320/390px; recorded 2 unchanged legacy save-close reproductions; IndexedDB checked');
    } finally { await app.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
