// Isolated full application; real controls and IndexedDB, with image completion held until the dialog opens.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fullApp, root } = require('./helpers/full_app_browser.cjs');
const out = path.resolve(process.env.UVU_REGEN_OUT || path.join(root, 'outputs/regenerate-guard'));
fs.mkdirSync(out, { recursive: true });
(async () => {
    const app = await fullApp(), results = [];
    try {
        for (const width of [320, 390]) {
            const { page, context, errors } = await app.page({ viewport: { width, height: 740 } });
            await page.evaluate(() => { for (const key of ['guide_search_entry', 'guide_char_gallery', 'guide_group_summary', 'guide_group_notice', 'guide_group_gossip']) localStorage.setItem(key, 'true'); GuideSystem.cleanup(); });
            if (process.env.UVU_REGEN_TEST_REF) {
                const ref = process.env.UVU_REGEN_TEST_REF;
                if (!/^[a-f0-9]{40}$/.test(ref)) throw Error('UVU_REGEN_TEST_REF requires an explicit commit SHA');
                const oldSource = execFileSync('git', ['show', ref + ':js/modules/chat_ai.js'], { cwd: root, encoding: 'utf8' });
                const start = oldSource.indexOf('async function handleRegenerate('), end = oldSource.indexOf('function showRegenerateGuidanceDialog(', start);
                if (start < 0 || end < 0) throw Error('Cannot locate regeneration handler in the requested commit');
                await page.addScriptTag({ content: oldSource.slice(start, end) });
                await page.evaluate(() => { const button = document.getElementById('regenerate-btn'); const replacement = button.cloneNode(true); button.replaceWith(replacement); regenerateBtn = replacement; replacement.addEventListener('click', handleRegenerate); });
            }
            await page.evaluate(async () => {
                db.characters = [{ id: 'regen-fixture', realName: '测试角色', remarkName: '测试角色', myName: '我', persona: '', maxMemory: 20, worldBookIds: [], history: [
                    { id: 'user-source', role: 'user', content: '[我的消息：你好]', timestamp: 1 },
                    { id: 'ai-source', role: 'assistant', content: '[测试角色的消息：你好呀]', timestamp: 2 }
                ] }];
                db.groups = []; ensureAllChatArchives(); await saveData(); openChatRoom('regen-fixture', 'private');
                window.regenerateRequests = []; getAiReply = async (...args) => regenerateRequests.push(args);
                const originalCompress = compressImage;
                compressImage = (...args) => new Promise((resolve, reject) => { window.releaseFixtureImage = () => originalCompress(...args).then(resolve, reject); });
            });
            await page.locator('#image-upload-input').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
            await page.waitForFunction(() => typeof releaseFixtureImage === 'function');
            await page.locator('#toggle-expansion-btn').click();
            await page.evaluate(() => GuideSystem.cleanup());
            await page.locator('#regenerate-btn').click();
            await page.locator('.regenerate-guidance-card').waitFor({ state: 'visible' });
            await page.getByLabel('回复修改方向', { exact: true }).fill('保留之前的语气');
            await page.evaluate(() => releaseFixtureImage());
            await page.waitForFunction(() => db.characters[0].history.length === 3);
            const before = await page.evaluate(() => JSON.stringify(db.characters[0].history));
            await page.locator('.regenerate-guidance-card [data-action=reroll]').click();
            await page.locator('.regenerate-guidance-card').waitFor({ state: 'detached' });
            await page.waitForFunction(() => !isGenerating);
            const result = await page.evaluate(async () => {
                const chat = db.characters[0], stored = await dexieDB.characters.get(chat.id);
                return { history: JSON.stringify(chat.history), storedMatches: JSON.stringify(stored.history) === JSON.stringify(chat.history), ids: chat.history.map(message => message.id), requests: regenerateRequests.length,
                    hasImage: chat.history.some(message => message.parts?.some(part => part.type === 'image')),
                    feedback: document.getElementById('toast-notification')?.textContent || '' };
            });
            const { history, ...summary } = result;
            results.push({ width, ...summary, unchanged: before === history, errors });
            await page.screenshot({ path: path.join(out, 'after-' + width + '.png') });
            await context.close();
        }
        fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(results, null, 2));
        for (const result of results) {
            assert.equal(result.unchanged, true, 'newly completed image must survive stale reroll at ' + result.width);
            assert.equal(result.hasImage, true); assert.equal(result.storedMatches, true);
            assert.equal(result.requests, 0); assert.deepEqual(result.errors, []);
            assert.match(result.feedback, /聊天内容已有变化/);
        }
        console.log('PASS full application: pending image survives stale reroll at 320/390px; IndexedDB unchanged; zero requests/page errors');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
