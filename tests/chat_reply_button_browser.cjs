// Real chat controls with isolated data and a cancellable local API fixture.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fullApp, root } = require('./helpers/full_app_browser.cjs');
const out = path.join(root, 'outputs/reply-button'); fs.mkdirSync(out, { recursive: true });
(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        await page.evaluate(async () => {
            db.characters = ['a', 'b'].map(id => ({ id, realName: id, remarkName: id, myName: '我', persona: '', history: [], maxMemory: 20, worldBookIds: [] }));
            ensureAllChatArchives(); db.apiSettings = { url: 'https://reply-fixture.invalid', key: 'fixture', model: 'fixture', provider: 'newapi', streamEnabled: false };
            await saveData(); openChatRoom('a', 'private');
            const original = window.fetch; window.replyFixtureCalls = [];
            window.fetch = (url, init) => {
                if (!String(url).startsWith('https://reply-fixture.invalid')) return original(url, init);
                const record = { aborted: false }; replyFixtureCalls.push(record);
                return new Promise((resolve, reject) => {
                    init.signal.addEventListener('abort', () => { record.aborted = true; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
                });
            };
        });
        const reply = page.locator('#get-reply-btn');
        let clickTime = Date.parse('2026-11-12T05:00:00Z');
        const clickReply = async name => {
            // The shared fixture freezes Date.now; advance it so ordinary test
            // clicks do not count as the app's five-tap emergency gesture.
            await page.clock.setFixedTime(new Date(clickTime += 1000));
            await page.getByRole('button', { name, exact: true }).click();
        };
        const originalIcon = await reply.innerHTML();
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await clickReply('AI 回复');
            await page.waitForFunction(() => replyFixtureCalls.at(-1)?.aborted === false && document.getElementById('get-reply-btn').dataset.generating === 'true');
            assert.equal(await page.locator('#stop-ai-btn').count(), 0, 'no overlapping second stop button');
            await page.locator('#message-input').fill('保留草稿');
            assert.equal(await reply.isVisible(), true);
            assert.equal(await reply.isEnabled(), true);
            const hit = await reply.evaluate(n => { const r = n.getBoundingClientRect(); return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
            assert.equal(hit, true, 'same reply button remains reachable with a draft at ' + width);
            if (width === 390) await page.screenshot({ path: path.join(out, 'stop-390.png') });
            const count = await page.evaluate(() => replyFixtureCalls.length);
            await clickReply('停止 AI 回复');
            await page.waitForFunction(() => !isGenerating);
            assert.equal(await page.evaluate(() => replyFixtureCalls.length), count);
            assert.equal(await page.evaluate(() => replyFixtureCalls.at(-1).aborted), true);
            assert.equal(await page.locator('#message-input').inputValue(), '保留草稿');
            assert.equal(await reply.innerHTML(), originalIcon, 'original customisable icon is preserved');
            await page.locator('#message-input').fill('');
            assert.equal(await reply.getAttribute('aria-label'), 'AI 回复');
            assert.equal(await reply.isVisible(), true);
        }
        await clickReply('AI 回复'); await page.waitForFunction(() => isGenerating);
        await page.evaluate(() => openChatRoom('b', 'private'));
        assert.equal(await reply.getAttribute('aria-label'), 'AI 回复');
        await clickReply('AI 回复'); await page.waitForFunction(() => replyFixtureCalls.length === 4);
        await clickReply('停止 AI 回复');
        await page.waitForFunction(() => replyFixtureCalls[3].aborted);
        assert.equal(await page.evaluate(() => replyFixtureCalls[2].aborted), false, 'B stop does not cancel A');
        await page.evaluate(() => openChatRoom('a', 'private'));
        await clickReply('停止 AI 回复');
        await page.waitForFunction(() => replyFixtureCalls[2].aborted && !isGenerating);
        assert.deepEqual(errors, []);
        console.log('PASS same-button reply/cancel, draft, original icon, 320/390px hit testing, and independent character requests');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
