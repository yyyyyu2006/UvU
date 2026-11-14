'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        page.setDefaultTimeout(7000);
        await page.evaluate(() => {
            for (const key of ['guide_search_entry', 'guide_char_gallery', 'guide_group_summary', 'guide_group_notice', 'guide_group_gossip']) localStorage.setItem(key, 'true');
            GuideSystem.cleanup();
            document.addEventListener('click', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            db.characters = [{ id: 'history-char', realName: '测试角色', remarkName: '测试角色', myName: '我', history: [], maxMemory: 20, worldBookIds: [], memoryJournals: [] }];
            openChatRoom('history-char', 'private');
            window.historyChecks = { originalDelete: dexieDB.workshopHistory.delete.bind(dexieDB.workshopHistory) };
            window.confirm = () => historyChecks.accept;
        });
        await page.locator('#toggle-expansion-btn').click();
        await page.locator('#photo-video-btn').click();
        await page.locator('#pv-mode-ai').check();
        const panel = () => page.locator('#draft-image-history');
        const detail = () => panel().locator('.draft-image-history-detail');
        const choose = id => panel().locator('[data-record-id="' + id + '"]').click();
        const failures = [];
        async function open() {
            await page.locator('#send-pv-modal .pv-send-actions').getByRole('button', { name: '记录', exact: true }).click();
            await panel().locator('.draft-image-gallery button').first().waitFor();
        }
        async function reset() {
            await page.evaluate(async () => {
                document.getElementById('draft-image-history')?.dismissForward?.();
                Object.assign(historyChecks, { accept: true, pending: false, fail: false, release: null, job: null });
                dexieDB.workshopHistory.delete = historyChecks.originalDelete;
                await dexieDB.workshopHistory.clear();
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
                await dexieDB.workshopHistory.bulkAdd([1, 2].map(id => ({ id, timestamp: id, prompt: '图片 ' + id, image: canvas.toDataURL() })));
                dexieDB.workshopHistory.delete = async id => {
                    if (historyChecks.pending) await new Promise(resolve => { historyChecks.release = resolve; });
                    if (historyChecks.fail) throw new Error('模拟存储失败');
                    return historyChecks.originalDelete(id);
                };
            });
            await open();
        }
        async function remove({ pending = false, fail = false } = {}) {
            await page.evaluate(({ pending, fail }) => {
                Object.assign(historyChecks, { pending, fail });
                const button = document.querySelector('#draft-image-history .draft-image-history-actions button:last-child');
                const run = button.onclick;
                button.onclick = () => { historyChecks.job = run(); };
            }, { pending, fail });
            await detail().getByRole('button', { name: '删除', exact: true }).click();
        }
        async function finish() {
            await page.evaluate(async () => { historyChecks.release?.(); await historyChecks.job; });
        }
        async function retained(id) {
            assert.equal(await detail().isVisible(), true, '另一张图片的详情应保持可见');
            assert.equal(await detail().locator('.draft-image-history-prompt').textContent(), '图片 ' + id);
            assert.equal(await panel().locator('[data-record-id="' + id + '"]').getAttribute('aria-pressed'), 'true');
        }
        async function check(name, run) {
            try { await reset(); await run(); console.log('PASS ' + name); }
            catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
            finally { await finish(); }
        }
        await check('正常删除选中图片并收起对应详情', async () => {
            await choose(1); await remove(); await finish();
            assert.equal(await detail().isVisible(), false);
            assert.equal(await panel().locator('[data-record-id="1"]').count(), 0);
            assert.equal(await page.evaluate(() => dexieDB.workshopHistory.get(1)), undefined);
        });
        await check('删除等待期间切换图片，保留新选中的详情', async () => {
            await choose(1); await remove({ pending: true }); await choose(2); await finish();
            await retained(2);
            assert.equal(await panel().locator('[data-record-id="1"]').count(), 0);
            assert.equal(await page.evaluate(() => dexieDB.workshopHistory.get(1)), undefined);
        });
        await check('删除等待期间搜索并切换图片，保留新详情', async () => {
            await choose(1); await remove({ pending: true });
            await panel().getByRole('searchbox').fill('图片 2'); await choose(2); await finish();
            await retained(2);
        });
        await check('删除等待期间切回被删图片，正确收起已删除详情', async () => {
            await choose(1); await remove({ pending: true }); await choose(2); await choose(1); await finish();
            assert.equal(await detail().isVisible(), false);
        });
        await check('删除失败保留记录与新选择，并允许重试', async () => {
            await choose(1); await remove({ pending: true, fail: true }); await choose(2); await finish();
            await retained(2);
            assert.ok(await page.evaluate(() => dexieDB.workshopHistory.get(1)));
            assert.match(await panel().locator('[role="status"]').textContent(), /删除失败/);
            await choose(1); await remove(); await finish();
            assert.equal(await page.evaluate(() => dexieDB.workshopHistory.get(1)), undefined);
        });
        await check('取消删除不更改记录和当前选择', async () => {
            await choose(1); await page.evaluate(() => { historyChecks.accept = false; }); await remove(); await finish();
            await retained(1);
            assert.equal(await page.evaluate(() => dexieDB.workshopHistory.count()), 2);
        });
        assert.deepEqual(errors, [], '页面不应产生未处理异常');
        assert.deepEqual(failures, []);
        console.log('PASS 6 image history selection and deletion cases');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
