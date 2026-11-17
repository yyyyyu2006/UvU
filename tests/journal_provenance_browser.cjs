'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fullApp, stableUI, root } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(), output = path.join(root, 'outputs/daily-audit-20261117-journal-api');
    fs.mkdirSync(output, { recursive: true });
    try {
        const { page, errors } = await app.page({ viewport: { width: 320, height: 568 }, hasTouch: false });
        await page.evaluate(async () => {
            document.addEventListener('pointerdown', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            const chat = { id: 'journal-audit', realName: '测试角色', myName: '测试用户', persona: '', maxMemory: 20, worldBookIds: [],
                history: Array.from({ length: 4 }, (_, i) => ({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: '合成测试消息', timestamp: Date.now() + i })),
                memoryJournals: [{ id: 'one', title: '来源一', content: '合成剧情', range: { start: 1, end: 2 }, createdAt: 1, source: 'sillytavern', isFavorited: true,
                    bridgeReview: { channel: 'tt', status: 'approved', items: [{ selected: true, text: '合成剧情' }] } },
                    { id: 'two', title: '来源二', content: '普通日记', range: { start: 3, end: 4 }, createdAt: 2 }] };
            db.characters = [chat]; db.groups = []; ensureAllChatArchives();
            chat.memoryJournals[0].bridgeReview.archiveId = chat.activeArchiveId;
            db.uvuStoryBridgeSettings = { ttSettings: { bridgeEnabled: true, injectionByCharacter: {} } };
            db.apiSettings = { provider: 'newapi', url: 'https://journal-fixture.invalid/v1', key: 'fixture', model: 'fixture', streamEnabled: false };
            window.auditCalls = 0; window.auditHold = false;
            const original = window.fetch;
            window.fetch = async (url, init) => {
                if (!String(url).startsWith('https://journal-fixture.invalid/')) return original(url, init);
                auditCalls++;
                if (auditHold) await new Promise(resolve => { window.auditRelease = resolve; });
                return new Response(JSON.stringify({ choices: [{ message: { content: '<title>合并测试</title><content>合成合并正文</content>' } }] }));
            };
            await saveData(); openChatRoom(chat.id, 'private'); showPanel('none');
            renderJournalList(); switchScreen('memory-journal-screen');
        });
        async function merge(ids) {
            await page.locator('#journal-manage-btn').click();
            for (const id of ids) await page.locator('.journal-card[data-id="' + id + '"] .journal-card-title').click();
            await page.locator('#journal-merge-btn').click();
        }
        await merge(['one', 'two']);
        await page.waitForFunction(() => db.characters[0].memoryJournals.length === 3 && !isGenerating);
        const mergedId = await page.evaluate(() => db.characters[0].memoryJournals.at(-1).id);
        assert.equal(await page.evaluate(() => memoryJournalSourcesAllowed(db.characters[0], db.characters[0].memoryJournals.at(-1))), true);
        await page.locator('.journal-card[data-id="' + mergedId + '"] .favorite-journal-btn').click();
        await page.evaluate(async () => { const chat = db.characters[0]; chat.memoryJournals[0].bridgeReview.status = 'pending'; await saveData(); });
        assert.equal(await page.evaluate(() => getContextMemoryJournals(db.characters[0]).some(j => j.title === '合并测试')), false);
        await page.evaluate(async () => {
            const chat = db.characters[0]; chat.memoryJournals = [chat.memoryJournals.at(-1)];
            db.uvuStoryBridgeSettings.ttSettings.bridgeEnabled = false; await saveData();
        });
        await page.reload();
        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        assert.equal(await page.evaluate(() => getContextMemoryJournals(db.characters.find(c => c.id === 'journal-audit')).length), 0);
        await page.evaluate(async () => {
            document.addEventListener('pointerdown', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            const chat = db.characters.find(c => c.id === 'journal-audit');
            chat.memoryJournals = [{ id: 'a', title: '日记甲', content: '旧正文', range: { start: 1, end: 2 }, createdAt: 1 },
                { id: 'b', title: '日记乙', content: '另一篇', range: { start: 3, end: 4 }, createdAt: 2 }];
            db.apiSettings = { provider: 'newapi', url: 'https://journal-fixture.invalid/v1', key: 'fixture', model: 'fixture' };
            window.auditCalls = 0;
            window.fetch = async () => { auditCalls++; await new Promise(resolve => { window.auditRelease = resolve; });
                return new Response(JSON.stringify({ choices: [{ message: { content: '<title>过期合并</title><content>旧结果</content>' } }] })); };
            openChatRoom(chat.id, 'private'); showPanel('none'); renderJournalList(); switchScreen('memory-journal-screen');
        });
        await merge(['a', 'b']);
        await page.waitForFunction(() => typeof auditRelease === 'function');
        await page.evaluate(() => { db.characters.find(c => c.id === 'journal-audit').memoryJournals[0].content = '更正后的正文'; auditRelease(); });
        await page.waitForFunction(() => !isGenerating);
        await page.locator('#error-modal-overlay').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.getElementById('error-modal-overlay')?.textContent.includes('来源日记已变化'));
        assert.equal(await page.evaluate(() => db.characters.find(c => c.id === 'journal-audit').memoryJournals.length), 2);
        assert.equal(await page.evaluate(() => db.characters.find(c => c.id === 'journal-audit').memoryJournals[0].content), '更正后的正文');
        await stableUI(page, '#error-modal-overlay');
        assert.equal(await page.evaluate(() => Boolean(document.elementFromPoint(160, 285)?.closest('#error-modal-overlay'))), true);
        const box = await page.locator('#error-modal-overlay .modal-window').boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 320 && box.y + box.height <= 568);
        await page.screenshot({ path: path.join(output, 'source-changed-320.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log('PASS full App: real manage/select/merge/favorite controls; approved source retained; live revocation blocked; disabled channel after originals deleted and IndexedDB reload blocked; edited source during API wait discarded; 320px no overflow; pageerror 0.');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
