'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page();
        let now = Date.parse('2026-11-14T06:00:00Z');
        const click = async selector => {
            await page.clock.setFixedTime(new Date(now += 1000));
            await page.locator(selector).click({ timeout: 7000 });
        };
        await page.evaluate(() => {
            window.callChecks = { transaction: dexieDB.transaction.bind(dexieDB), failures: 0, calls: 0 };
            dexieDB.transaction = async (...args) => {
                if (callChecks.failures > 0) { callChecks.failures--; throw new Error('模拟通话保存失败'); }
                return callChecks.transaction(...args);
            };
            generateCallSummary = async () => { callChecks.calls++; return '测试通话总结'; };
        });
        async function reset() {
            await page.evaluate(async () => {
                const chat = { id: 'call-summary-char', realName: '测试角色', remarkName: '测试角色', myName: '我',
                    persona: '保持原人设', maxMemory: 20, worldBookIds: [], memoryJournals: [], activeArchiveId: 'one',
                    history: [{ id: 'call-message', role: 'assistant', callRecordId: 'call-one', content: '原始通话消息', timestamp: 1 }],
                    callHistory: [{ id: 'call-one', startTime: 1, duration: 30, type: 'voice', summary: '',
                        context: [{ role: 'user', type: 'voice', content: '测试通话' }] }] };
                db.characters = [chat]; db.groups = [];
                Object.assign(callChecks, { failures: 0, calls: 0, chat });
                VideoCallModule.state.pendingCallSave = null;
                await saveData();
                openChatRoom(chat.id, 'private');
                GuideSystem.cleanup();
                VideoCallModule.showHistoryModal();
            });
            await click('#vc-history-list .vc-history-header');
        }
        const button = '#vc-gen-summary-call-one';
        const failures = [];
        async function check(name, run) {
            try { await reset(); await run(); console.log('PASS ' + name); }
            catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
        }
        async function assertSummary() {
            await page.waitForFunction(async () => callChecks.chat.callHistory[0]?.summary === '测试通话总结' &&
                (await dexieDB.characters.get(callChecks.chat.id))?.callHistory[0]?.summary === '测试通话总结', null, { timeout: 5000 });
            const state = await page.evaluate(async () => ({ live: callChecks.chat.callHistory[0].summary,
                saved: (await dexieDB.characters.get(callChecks.chat.id)).callHistory[0].summary,
                persona: callChecks.chat.persona, maxMemory: callChecks.chat.maxMemory, count: callChecks.chat.history.length }));
            assert.equal(state.live, '测试通话总结'); assert.equal(state.saved, state.live);
            assert.equal(state.persona, '保持原人设'); assert.equal(state.maxMemory, 20); assert.equal(state.count, 1);
        }
        await check('正常生成总结并保存至 IndexedDB', async () => { await click(button); await assertSummary(); });
        await check('保存失败后在同一面板直接重试总结', async () => {
            await page.evaluate(() => { callChecks.failures = 1; });
            await click(button);
            await page.waitForFunction(() => callChecks.calls === 1 && document.getElementById('vc-gen-summary-call-one')?.disabled === false);
            assert.equal(await page.evaluate(() => callChecks.chat.callHistory[0].summary), '');
            await click(button); await assertSummary();
        });
        await check('其他保存失败重建记录对象后仍可生成总结', async () => {
            await page.evaluate(async () => {
                const chat = callChecks.chat;
                const mutation = beginChatMutation(chat, 'private', [], ['callHistory']);
                chat.callHistory[0].summary = '尚未保存的总结'; callChecks.failures = 1;
                await saveChatMutation(mutation);
            });
            await click(button); await assertSummary();
        });
        await check('连续保存失败后仍可在原面板重试且不重复新增消息', async () => {
            await page.evaluate(() => { callChecks.failures = 2; });
            for (let attempt = 1; attempt <= 2; attempt++) {
                await click(button);
                await page.waitForFunction(count => callChecks.calls === count &&
                    document.getElementById('vc-gen-summary-call-one')?.disabled === false, attempt);
            }
            await click(button); await assertSummary();
        });
        await check('点击前已切换存档不会发起总结请求', async () => {
            await page.evaluate(() => { callChecks.chat.activeArchiveId = 'two'; callChecks.chat.history = []; callChecks.chat.callHistory = []; });
            await click(button);
            assert.equal(await page.evaluate(() => callChecks.calls), 0);
            assert.equal(await page.evaluate(() => callChecks.chat.history.length + callChecks.chat.callHistory.length), 0);
        });
        await check('点击前记录已删除不会发起总结请求', async () => {
            await page.evaluate(() => { callChecks.chat.callHistory = []; });
            await click(button);
            assert.equal(await page.evaluate(() => callChecks.calls), 0);
        });
        await check('生成中切换存档不会把总结写入新存档', async () => {
            await page.evaluate(() => {
                generateCallSummary = async () => { callChecks.calls++; return new Promise(resolve => { callChecks.release = resolve; }); };
            });
            await click(button);
            await page.waitForFunction(() => Boolean(callChecks.release));
            await page.evaluate(() => {
                callChecks.chat.activeArchiveId = 'two'; callChecks.chat.history = [];
                callChecks.chat.callHistory = []; callChecks.release('过期总结');
            });
            await page.waitForFunction(() => document.getElementById('vc-gen-summary-call-one')?.disabled === false);
            assert.equal(await page.evaluate(() => callChecks.chat.history.length + callChecks.chat.callHistory.length), 0);
            await page.evaluate(() => { generateCallSummary = async () => { callChecks.calls++; return '测试通话总结'; }; });
        });
        assert.deepEqual(errors, [], '不应出现未处理的页面异常');
        assert.deepEqual(failures, []);
        console.log('PASS 7 call summary browser checks');
        await context.close();
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
