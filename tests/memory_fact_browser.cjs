// Complete app, isolated synthetic records, no remote model requests.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page(); page.setDefaultTimeout(6000);
        const missing = []; page.on('response', response => { if (response.url().startsWith(app.origin) && response.status() >= 400) missing.push(response.url()); });
        await page.evaluate(async () => {
            const avatar = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
            const chat = { id: 'facts', realName: '事实核对测试', myName: '测试用户', avatar, myAvatar: avatar, history: [], maxMemory: 2,
                memoryJournals: [{ id: 'old', title: '早期偏好', content: '我喜欢喝茶。', createdAt: 1700000000000, range: { start: 0, end: 0 } },
                    { id: 'new', title: '近期偏好', content: '我不喜欢喝茶。', createdAt: 1700000000001, range: { start: 0, end: 0 } }] };
            db.characters = [chat]; ensureAllChatArchives(); await saveData(); currentChatId = chat.id; currentChatType = 'private'; openChatRoom(chat.id, 'private');
            window.factBaseline = JSON.stringify(chat.memoryJournals.map(j => [j.id, j.content, j.isFavorited]));
            openMemoryLibrary();
        });
        await stableUI(page, '.memory-library');
        const openFact = async id => {
            await page.locator(`.memory-library-card[data-memory-id="${id}"]`).getByRole('button', { name: '阅读记忆', exact: true }).click();
            const reader = page.locator('#draft-memory-reader');
            await reader.getByRole('button', { name: '查看原文', exact: true }).click();
            const panel = reader.locator('.memory-fact-review'); await panel.locator(':scope > summary').click(); return panel;
        };
        let panel = await openFact('old');
        const fill = async (host, fact, polarity) => {
            await host.getByLabel('事实原句（从本篇复制）').fill(fact);
            await host.getByLabel('主体', { exact: true }).selectOption('user');
            await host.getByLabel('属性（例如饮品偏好）').fill('饮品偏好'); await host.getByLabel('取值（例如茶）').fill('茶');
            await host.getByLabel('肯定或否定').selectOption(polarity); await host.getByLabel('事件时期').selectOption('current');
            assert.equal(await host.getByLabel('事件开始日期').isDisabled(), true);
            await host.getByRole('button', { name: '确认事实标签', exact: true }).click();
        };
        await fill(panel, '我喜欢喝茶。', 'positive'); await panel.getByRole('button', { name: '移除标签', exact: true }).waitFor();
        await page.locator('#draft-memory-reader').getByRole('button', { name: '关闭', exact: true }).click();
        panel = await openFact('new'); await fill(panel, '我不喜欢喝茶。', 'negative');
        await panel.locator('.memory-fact-pair').waitFor();
        await panel.getByRole('button', { name: '记录新旧变化', exact: true }).click();
        await page.waitForFunction(() => db.characters[0].memoryJournals[1].memoryFactRelations?.[0]?.decision === 'changed');
        await page.waitForFunction(() => document.querySelector('.memory-fact-pair')?.textContent.includes('已确认关系：新旧变化'));
        assert.match(await panel.locator('.memory-fact-pair').textContent(), /已确认关系：新旧变化/);
        for (const width of [320, 390, 768]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(await page.locator('#draft-memory-reader').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            const out = path.join(root, 'outputs/memory-review-20261122'); fs.mkdirSync(out, { recursive: true });
            await page.screenshot({ path: path.join(out, `facts-${width}.png`) });
        }
        assert.equal(await page.evaluate(() => JSON.stringify(db.characters[0].memoryJournals.map(j => [j.id, j.content, j.isFavorited])) === factBaseline), true);
        await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        assert.equal(await page.evaluate(() => db.characters[0].memoryJournals[1].memoryFactRelations[0].decision), 'changed');
        await page.evaluate(() => { currentChatId = db.characters[0].id; currentChatType = 'private'; openChatRoom(currentChatId, 'private'); openMemoryLibrary(); });
        await stableUI(page, '.memory-library');
        panel = await openFact('old');
        await panel.locator('.memory-fact-pair').waitFor();
        assert.match(await panel.locator('.memory-fact-pair').textContent(), /已确认关系：新旧变化/, 'the reverse journal shows the saved relationship after reload');
        assert.deepEqual(errors, []); assert.deepEqual(missing, []);
        console.log('PASS complete app: facts, cross-journal suggestions, both journal directions, unchanged originals, persisted reload, 320/390/768 containment.');
        await context.close();
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
