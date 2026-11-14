'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        page.setDefaultTimeout(7000);
        const failures = [];
        const dialog = () => page.locator('.uvu-music-sheet');
        const click = name => dialog().getByRole('button', { name, exact: true }).click();
        await page.evaluate(() => {
            window.musicSheetOriginals = {};
            for (const key of ['toggleFavorite', 'removeFromPlaylist', 'updateLocal', 'addToPlaylist', 'addPlaylist', 'deleteLocal', 'deletePlaylist']) {
                musicSheetOriginals[key] = UvUMusic[key];
            }
            // No platform account, external media or paid model is used.
            window.confirm = () => true;
            window.showConfirm = async () => true;
            document.addEventListener('click', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
        });
        async function reset() {
            await page.evaluate(async () => {
                UvUMusicUI.close();
                Object.assign(UvUMusic, musicSheetOriginals);
                db.musicLibrary = undefined;
                await UvUMusic.saveSettings({ endpoint: '', publicSources: [] });
                window.sheetSong = UvUMusic.importURL('https://media.test/fixture.mp3', { id: 'sheet-song', title: '测试歌曲' });
                window.sheetList = await UvUMusic.addPlaylist('测试歌单');
                await UvUMusic.addToPlaylist(sheetList.id, sheetSong);
                UvUMusicUI.open();
                delete window.sheetSave;
            });
        }
        async function delay(method) {
            await page.evaluate(method => {
                const original = UvUMusic[method];
                const pending = window.sheetSave = { started: false, done: false };
                const gate = new Promise(resolve => pending.release = resolve);
                UvUMusic[method] = async (...args) => {
                    pending.started = true;
                    try { await gate; return await original(...args); }
                    finally { pending.done = true; }
                };
            }, method);
        }
        async function library() {
            await page.locator('[data-um-tab="library"]').click();
            await page.locator('.um-main').getByRole('button', { name: '播放列表', exact: true }).click();
        }
        async function openList() {
            await library();
            await page.locator('.um-main').getByRole('button', { name: '测试歌单', exact: true }).click();
            await click('管理');
            await dialog().getByRole('button', { name: '删除歌单', exact: true }).waitFor();
        }
        const cases = [
            { name: '收藏歌曲', method: 'toggleFavorite', open: () => page.evaluate(() => UvUMusicUI.trackMenu(sheetSong)), run: () => click('加入喜欢'), verify: () => UvUMusic.library().favorites.some(t => t.id === sheetSong.id) },
            { name: '移出歌单', method: 'removeFromPlaylist', open: () => page.evaluate(() => UvUMusicUI.trackMenu(sheetSong, { playlistId: sheetList.id })), run: () => click('从歌单移除'), verify: () => UvUMusic.library().playlists.find(p => p.id === sheetList.id).tracks.length === 0 },
            { name: '编辑歌曲资料', method: 'updateLocal', open: async () => { await page.evaluate(() => UvUMusicUI.trackMenu(sheetSong)); await click('编辑歌曲资料'); await dialog().getByRole('textbox', { name: '歌名', exact: true }).fill('修改后的歌名'); }, run: () => click('保存'), verify: () => UvUMusic.library().playlists.find(p => p.id === sheetList.id).tracks[0].title === '修改后的歌名' },
            { name: '加入歌单', method: 'addToPlaylist', open: async () => { await page.evaluate(async () => { await UvUMusic.removeFromPlaylist(sheetList.id, UvUMusic.key(sheetSong)); UvUMusicUI.trackMenu(sheetSong); }); await click('加入歌单'); }, run: () => click('测试歌单'), verify: () => UvUMusic.library().playlists.find(p => p.id === sheetList.id).tracks.length === 1 },
            { name: '创建歌单', method: 'addPlaylist', open: async () => { await library(); await page.locator('.um-main').getByRole('button', { name: '新建歌单', exact: true }).click(); await dialog().getByRole('textbox', { name: '歌单名称', exact: true }).fill('新的歌单'); }, run: () => click('创建'), verify: () => UvUMusic.library().playlists.some(p => p.name === '新的歌单') },
            { name: '删除本地音乐', method: 'deleteLocal', open: () => page.evaluate(() => UvUMusicUI.trackMenu(sheetSong)), run: () => click('删除本地音乐'), verify: () => UvUMusic.library().playlists.find(p => p.id === sheetList.id).tracks.length === 0 },
            { name: '删除歌单', method: 'deletePlaylist', open: openList, run: () => click('删除歌单'), verify: () => !UvUMusic.library().playlists.some(p => p.id === sheetList.id) }
        ];
        for (const item of cases) {
            for (const replace of [false, true]) {
                const label = item.name + (replace ? '：旧保存不得关闭新弹窗' : '：正常保存');
                try {
                    await reset(); await item.open(); await delay(item.method); await item.run();
                    await page.waitForFunction(() => sheetSave.started);
                    if (replace) {
                        await click('关闭');
                        await page.evaluate(() => UvUMusicUI.accounts());
                        await dialog().getByRole('heading', { name: '音乐账号', exact: true }).waitFor();
                    }
                    await page.evaluate(() => sheetSave.release());
                    await page.waitForFunction(() => sheetSave.done);
                    // Finish the action continuation before observing the currently open dialog.
                    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
                    assert.equal(await page.evaluate(item.verify), true, '请求的数据修改应当保存');
                    assert.equal(await dialog().count(), replace ? 1 : 0, '保存结束只关闭原来的弹窗');
                    if (replace) assert.equal(await dialog().getAttribute('aria-label'), '音乐账号');
                    console.log('PASS ' + label);
                } catch (error) { failures.push(label + ': ' + error.message); console.error('FAIL ' + label + ': ' + error.message); }
                finally { await page.evaluate(() => window.sheetSave?.release?.()); }
            }
        }
        // Rejected writes must keep the editor open for correction/retry.
        await reset(); await library();
        await page.locator('.um-main').getByRole('button', { name: '新建歌单', exact: true }).click();
        await dialog().getByRole('textbox', { name: '歌单名称', exact: true }).fill('不应保存');
        await page.evaluate(() => { UvUMusic.addPlaylist = async () => { throw new Error('模拟保存失败'); }; });
        await click('创建');
        assert.equal(await dialog().getAttribute('aria-label'), '新建歌单');
        assert.equal(await dialog().getByRole('button', { name: '创建', exact: true }).isEnabled(), true);
        assert.equal(await page.evaluate(() => UvUMusic.library().playlists.some(p => p.name === '不应保存')), false);
        console.log('PASS 保存失败保留编辑面板并可重试');
        assert.deepEqual(errors, [], '浏览器无未处理异常');
        assert.deepEqual(failures, []);
        console.log('PASS music sheet ownership: 15 cases');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
