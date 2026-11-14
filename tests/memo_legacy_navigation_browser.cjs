const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    let failures = 0;
    try {
        for (const scenario of ['cached', 'uncached', 'busy', 'stale', 'parallel-legacy']) {
            const { page, context, errors } = await app.page();
            page.setDefaultTimeout(5000);
            let time = Date.parse('2026-11-12T04:00:00Z');
            const click = async locator => {
                time = Math.max(time, await page.evaluate(() => Date.now())) + 2000;
                await page.clock.setFixedTime(new Date(time));
                await locator.click();
            };
            try {
                await page.evaluate(async scenario => {
                    const chat = { id: 'memo-route', realName: '角色', myName: '用户', persona: 'PERSONA', myPersona: 'USER', maxMemory: 20,
                        history: [{ id: 'original', role: 'user', content: '保留聊天原文', timestamp: Date.now() }], worldBookIds: [], memoryJournals: [],
                        characterMemos: { settings: { enabled: true, useContext: false }, notes: [], processed: {}, blocked: [] },
                        peekData: scenario === 'uncached' ? {} : { memos: { memos: [{ id: 'old', title: '旧模拟便签', content: '旧便签正文' }] } } };
                    db.characters = [chat]; db.globalCss = '/* preserve theme */';
                    await saveData(); openChatRoom(chat.id, 'private');
                    window.routeOriginal = JSON.stringify({ history: chat.history, persona: chat.persona, myPersona: chat.myPersona, maxMemory: chat.maxMemory, css: db.globalCss });
                    resolveAuxiliaryApiConfig = () => ({ provider: 'newapi', url: 'https://mock.invalid/v1', key: 'fixture', model: 'fixture' });
                    window.routeCalls = 0;
                    fetchAiResponse = () => { window.routeCalls++; return new Promise(resolve => { window.finishRoute = resolve; }); };
                    if (scenario === 'parallel-legacy') window.pendingLegacyRoute = generateAndRenderPeekContent('memos', { forceRefresh: true });
                    await generateAndRenderPeekContent('memos');
                }, scenario);
                if (scenario === 'parallel-legacy') {
                    assert.equal(await page.locator('#character-memos-dialog').count(), 1, 'simulated note generation cannot block factual memo access');
                    await page.evaluate(async () => {
                        window.finishRoute('<result><memos><memo><title>新模拟便签</title><content>新便签正文</content></memo></memos></result>');
                        await window.pendingLegacyRoute;
                    });
                    assert.equal(await page.locator('#character-memos-dialog').count(), 1, 'late simulated result leaves the factual panel open');
                }
                await click(page.getByRole('button', { name: '备忘录设置', exact: true }));
                if (scenario === 'busy') {
                    await page.evaluate(() => {
                        runCharacterMemos = () => new Promise(resolve => { window.finishMemoJob = resolve; });
                    });
                    await click(page.getByRole('button', { name: '整理聊天', exact: true }));
                    await page.waitForFunction(() => typeof window.finishMemoJob === 'function');
                }
                if (scenario === 'stale') await page.evaluate(() => { db.characters[0].myPersona = 'CHANGED_USER'; });
                await click(page.getByRole('button', { name: '模拟便签', exact: true }));
                if (scenario === 'busy' || scenario === 'stale') {
                    assert.equal(await page.locator('#character-memos-dialog').count(), 1, 'blocked navigation retains memo panel');
                    assert.equal(await page.evaluate(() => document.getElementById('peek-memos-screen').classList.contains('active')), false);
                    assert.equal(await page.evaluate(() => window.routeCalls), 0);
                    if (scenario === 'busy') {
                        await page.evaluate(() => window.finishMemoJob({ added: 0 }));
                        await page.waitForFunction(() => !document.querySelector('#character-memos-dialog .sheet-close').disabled);
                        await click(page.getByRole('button', { name: '模拟便签', exact: true }));
                        await page.locator('#character-memos-dialog').waitFor({ state: 'detached' });
                    } else {
                        assert.match(await page.locator('.memo-feedback[aria-live]').textContent(), /已改变/);
                    }
                } else {
                    await page.locator('#character-memos-dialog').waitFor({ state: 'detached' });
                    if (scenario === 'uncached') {
                        await page.waitForFunction(() => typeof window.finishRoute === 'function');
                        assert.equal(await page.evaluate(() => window.routeCalls), 1);
                        await page.evaluate(() => window.finishRoute('<result><memos><memo><title>新模拟便签</title><content>新便签正文</content></memo></memos></result>'));
                        await page.waitForFunction(() => document.querySelector('#peek-memos-list .memo-item-title')?.textContent === '新模拟便签');
                    } else assert.equal(await page.evaluate(() => window.routeCalls), scenario === 'parallel-legacy' ? 1 : 0);
                    const item = page.locator('#peek-memos-list .memo-item');
                    assert.equal(await item.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'legacy note receives clicks');
                    await click(item);
                    assert.match(await page.locator('#peek-memo-detail-screen').textContent(), ['uncached', 'parallel-legacy'].includes(scenario) ? /新便签正文/ : /旧便签正文/);
                    assert.equal(await page.evaluate(() => characterMemoRecords(db.characters[0]).length), 0, 'simulated notes are not factual memory');
                }
                if (scenario !== 'stale') assert.equal(await page.evaluate(() => {
                    const chat = db.characters[0];
                    return JSON.stringify({ history: chat.history, persona: chat.persona, myPersona: chat.myPersona, maxMemory: chat.maxMemory, css: db.globalCss }) === window.routeOriginal;
                }), true, 'history, personas, range and theme stay unchanged');
                assert.deepEqual(errors, []);
                console.log('PASS memo legacy navigation: ' + scenario);
            } catch (error) {
                failures++; console.error('FAIL memo legacy navigation: ' + scenario + '\n' + error.stack);
            } finally { await context.close(); }
        }
    } finally { await app.close(); }
    if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
