'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    const failures = [];
    try {
        async function check(name, run) {
            const { page, context, errors } = await app.page();
            page.setDefaultTimeout(8000);
            try {
                await page.evaluate(async () => {
                    window.cacheChecks = { submits: 0, job: null };
                    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
                    db.myStickers = [{ id: 'local', name: '原表情', data: canvas.toDataURL() },
                        { id: 'remote', name: '网络表情', data: 'https://fixture.invalid/sticker.png' }];
                    db.cotPresets = [{ id: 'fixture', items: [{ content: '固定提示词' }] }];
                    db.globalCss = '.fixture { color: gray; }';
                    await saveData();
                    const form = document.getElementById('clean-image-cache-form'), submit = form.onsubmit;
                    form.onsubmit = event => { cacheChecks.submits++; cacheChecks.job = submit(event); return cacheChecks.job; };
                    switchScreen('storage-analysis-screen');
                });
                await page.locator('#open-clean-cache-btn').click();
                await page.locator('#clean-image-cache-form').waitFor({ state: 'visible' });
                await page.locator('#clean-image-cache-form input[value="stickers"]').check();
                await run(page, context);
                assert.deepEqual(errors, []);
                console.log('PASS ' + name);
            } catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
            finally { await context.close(); }
        }
        async function submit(page) {
            await page.locator('#confirm-clean-btn').click();
            await page.evaluate(() => cacheChecks.job);
        }
        async function verifyBaseline(page) {
            assert.equal(await page.evaluate(() => db.cotPresets[0].items[0].content), '固定提示词');
            assert.equal(await page.evaluate(() => db.globalCss), '.fixture { color: gray; }');
        }
        await check('清理旧页面表情时保留另一页面刚修改的表情', async (page, context) => {
            const peer = await context.newPage();
            await peer.goto(app.origin, { waitUntil: 'domcontentloaded' });
            await peer.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
            await peer.evaluate(async () => {
                GuideSystem.cleanup(); db.myStickers.find(item => item.id === 'local').name = '另一页面新名称'; await saveData();
            });
            await submit(page);
            assert.equal(await page.evaluate(async () => (await dexieDB.myStickers.get('local'))?.name), '另一页面新名称');
            assert.equal(await page.evaluate(() => db.myStickers.find(item => item.id === 'local')?.name), '原表情');
            assert.equal(await page.locator('#clean-image-cache-modal').evaluate(el => el.classList.contains('visible')), true);
            assert.match(await page.evaluate(() => JSON.stringify(notificationQueue) + document.getElementById('toast-notification')?.textContent), /其他页面|更新/);
            await verifyBaseline(page);
        });
        await check('正常清理只删除本地表情且后续保存不会复活', async page => {
            await submit(page);
            assert.deepEqual(await page.evaluate(() => db.myStickers.map(item => item.id)), ['remote']);
            assert.deepEqual(await page.evaluate(async () => (await dexieDB.myStickers.toArray()).map(item => item.id)), ['remote']);
            await page.evaluate(() => saveData());
            assert.equal(await page.evaluate(() => dexieDB.myStickers.get('local')), undefined);
            await verifyBaseline(page);
        });
        await check('另一页面修改其他表情不阻止清理且新内容保留', async (page, context) => {
            const peer = await context.newPage();
            await peer.goto(app.origin, { waitUntil: 'domcontentloaded' });
            await peer.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
            await peer.evaluate(async () => {
                GuideSystem.cleanup(); db.myStickers.find(item => item.id === 'remote').name = '新网络表情名称'; await saveData();
            });
            await submit(page);
            assert.equal(await page.evaluate(() => dexieDB.myStickers.get('local')), undefined);
            assert.equal(await page.evaluate(async () => (await dexieDB.myStickers.get('remote')).name), '新网络表情名称');
            assert.equal(await page.locator('#clean-image-cache-modal').evaluate(el => el.classList.contains('visible')), false);
            await verifyBaseline(page);
        });
        await check('保存失败保留本地表情与数据库并允许重试', async page => {
            await page.evaluate(() => {
                cacheChecks.fail = () => { throw new Error('模拟写入失败'); };
                dexieDB.globalSettings.hook('updating', cacheChecks.fail);
                db.apiSettings.model = '触发保存';
            });
            await submit(page);
            assert.equal(await page.evaluate(() => db.myStickers.some(item => item.id === 'local')), true);
            assert.ok(await page.evaluate(() => dexieDB.myStickers.get('local')));
            await page.evaluate(() => dexieDB.globalSettings.hook('updating').unsubscribe(cacheChecks.fail));
            await submit(page);
            assert.equal(await page.evaluate(() => dexieDB.myStickers.get('local')), undefined);
            await verifyBaseline(page);
        });
        for (const change of ['append', 'same-id', 'replace']) {
            await check('清理失败不覆盖等待期间的新表情：' + change, async page => {
                await page.evaluate(() => {
                    cacheChecks.blocker = runDataPersistence(() => new Promise(resolve => { cacheChecks.release = resolve; }));
                    cacheChecks.fail = () => { throw new Error('模拟删除失败'); };
                    dexieDB.myStickers.hook('deleting', cacheChecks.fail);
                });
                await page.locator('#confirm-clean-btn').click();
                await page.evaluate(change => {
                    const added = { id: change === 'same-id' ? 'local' : 'new', name: '等待期间新增', data: 'https://fixture.invalid/new.png' };
                    if (change === 'replace') db.myStickers = [added];
                    else db.myStickers.push(added);
                    cacheChecks.release();
                }, change);
                await page.evaluate(() => cacheChecks.job);
                const stickers = await page.evaluate(() => db.myStickers.map(({ id, name }) => ({ id, name })));
                assert.equal(stickers.find(item => item.name === '等待期间新增')?.id, change === 'same-id' ? 'local' : 'new');
                assert.equal(stickers.filter(item => item.id === 'local').length, change === 'replace' ? 0 : 1);
                assert.ok(await page.evaluate(() => dexieDB.myStickers.get('local')));
                await verifyBaseline(page);
            });
        }
        assert.deepEqual(failures, []);
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
