'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp(), failures = [];
    try {
        async function check(name, run) {
            const { page, context, errors } = await app.page();
            try {
                await page.evaluate(async () => {
                    for (const key of ['guide_search_entry', 'guide_char_gallery']) localStorage.setItem(key, 'true');
                    db.characters = [{ id: 'delete-char', realName: '测试角色', myName: '我', persona: '固定人设', maxMemory: 20,
                        worldBookIds: [], memoryJournals: [], history: Array.from({ length: 5 }, (_, i) => ({
                            id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: '消息' + i, timestamp: Date.now() + i
                        })) }];
                    db.cotPresets = [{ id: 'fixed', items: [{ content: '固定提示词' }] }];
                    db.globalCss = '.fixture { color: gray; }';
                    await saveData(); openChatRoom('delete-char', 'private');
                    window.deleteCheck = { job: null };
                });
                await run(page);
                assert.equal(await page.evaluate(() => db.cotPresets[0].items[0].content), '固定提示词');
                assert.equal(await page.evaluate(() => db.globalCss), '.fixture { color: gray; }');
                assert.deepEqual(errors, []);
                console.log('PASS ' + name);
            } catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
            finally { await context.close(); }
        }
        await check('长按菜单正常删除单条并保存', async page => {
            await page.evaluate(() => {
                const original = deleteSingleMessage;
                deleteSingleMessage = (...args) => deleteCheck.job = original(...args);
                handleMessageLongPress(document.querySelector('.message-wrapper[data-id="m2"]'), 160, 250);
            });
            await page.locator('.context-menu-item').filter({ hasText: /^删除$/ }).click();
            await page.evaluate(() => deleteCheck.job);
            assert.deepEqual(await page.evaluate(() => db.characters[0].history.map(message => message.id)), ['m0', 'm1', 'm3', 'm4']);
            assert.deepEqual(await page.evaluate(async () => (await dexieDB.characters.get('delete-char')).history.map(message => message.id)), ['m0', 'm1', 'm3', 'm4']);
            assert.equal(await page.locator('.message-wrapper[data-id="m2"]').count(), 0);
        });
        await check('多选按钮正常删除并退出多选', async page => {
            await page.evaluate(() => enterMultiSelectMode('m2'));
            await page.locator('#delete-selected-btn').click();
            await page.waitForFunction(() => !isInMultiSelectMode);
            assert.equal(await page.evaluate(async () => (await dexieDB.characters.get('delete-char')).history.some(message => message.id === 'm2')), false);
        });
        for (const selection of [false, true]) {
            await check((selection ? '多选' : '单条') + '删除失败保留新编辑及其他删除，重试可落盘', async page => {
                const result = await page.evaluate(async selection => {
                    const chat = db.characters[0], fail = () => {
                        chat.history = chat.history.filter(message => message.id !== 'm3').map(message =>
                            message.id === 'm1' ? { ...message, content: '后来编辑' } : message);
                        chat.history.push({ id: 'arrival', role: 'assistant', content: '新到消息', timestamp: Date.now() + 10 });
                        syncChatActiveArchive(chat);
                        throw Error('fixture quota');
                    };
                    dexieDB.characters.hook('updating', fail);
                    if (selection) { enterMultiSelectMode('m2'); await deleteSelectedMessages(); }
                    else await deleteSingleMessage('m2', chat, 'private', chat.activeArchiveId);
                    const live = structuredClone(chat.history), archived = structuredClone(getActiveArchive(chat).data.history);
                    const diskBefore = await dexieDB.characters.get(chat.id);
                    const selected = isInMultiSelectMode && selectedMessageIds.has('m2');
                    dexieDB.characters.hook('updating').unsubscribe(fail);
                    await saveData();
                    const diskAfter = await dexieDB.characters.get(chat.id);
                    return { live, archived, diskBefore: diskBefore.history, diskAfter: diskAfter.history, selected };
                }, selection);
                for (const history of [result.live, result.archived, result.diskAfter]) {
                    assert.deepEqual(history.map(message => message.id), ['m0', 'm1', 'm2', 'm4', 'arrival']);
                    assert.equal(history[1].content, '后来编辑');
                }
                assert.deepEqual(result.diskBefore.map(message => message.id), ['m0', 'm1', 'm2', 'm3', 'm4']);
                if (selection) assert.equal(result.selected, true);
                assert.equal(await page.locator('.message-wrapper[data-id="m2"]').count(), 1);
            });
        }
        await check('失败只恢复来源存档，保留当前存档', async page => {
            const result = await page.evaluate(async () => {
                const chat = db.characters[0], archiveId = chat.activeArchiveId;
                const fail = () => {
                    syncChatActiveArchive(chat);
                    const original = getActiveArchive(chat);
                    original.data.history[0] = { ...original.data.history[0], content: '旧存档新编辑' };
                    const other = { id: 'other', name: '其他存档', data: { ...captureArchiveData(chat), history: [{ id: 'other-message', content: '独立内容' }] } };
                    chat.archives.push(other); applyArchiveData(chat, other);
                    throw Error('fixture failure');
                };
                dexieDB.characters.hook('updating', fail);
                await deleteSingleMessage('m2', chat, 'private', archiveId);
                dexieDB.characters.hook('updating').unsubscribe(fail);
                return { active: chat.activeArchiveId, live: chat.history, original: chat.archives.find(item => item.id === archiveId).data.history };
            });
            assert.equal(result.active, 'other');
            assert.deepEqual(result.live.map(message => message.id), ['other-message']);
            assert.equal(result.original[0].content, '旧存档新编辑');
            assert.equal(result.original[2].id, 'm2');
        });
        await check('删除状态消息失败后恢复顶栏状态文字', async page => {
            await page.evaluate(async () => {
                const chat = db.characters[0];
                chat.history.push({ id: 'status', role: 'assistant', content: '[测试角色更新状态为：忙碌]', timestamp: Date.now() + 20 });
                recalculateChatStatus(chat); await saveData();
                const fail = () => { throw Error('fixture quota'); };
                dexieDB.characters.hook('updating', fail);
                await deleteSingleMessage('status', chat, 'private', chat.activeArchiveId);
                dexieDB.characters.hook('updating').unsubscribe(fail);
            });
            assert.equal(await page.evaluate(() => db.characters[0].status), '忙碌');
            assert.equal(await page.locator('#chat-room-status-text').textContent(), '忙碌');
        });
        await check('旧删除完成后保留新一轮多选和可点击按钮', async page => {
            await page.evaluate(async () => {
                deleteCheck.blocker = runDataPersistence(() => new Promise(resolve => { deleteCheck.finish = resolve; }));
                await Promise.resolve();
                enterMultiSelectMode('m2'); deleteCheck.job = deleteSelectedMessages();
                enterMultiSelectMode('m4');
            });
            await page.evaluate(async () => { deleteCheck.finish(); await deleteCheck.blocker; await deleteCheck.job; });
            assert.equal(await page.evaluate(() => isInMultiSelectMode), true);
            assert.deepEqual(await page.evaluate(() => [...selectedMessageIds]), ['m4']);
            assert.equal(await page.locator('#delete-selected-btn').isEnabled(), true);
            assert.equal(await page.locator('#delete-selected-btn').evaluate(button => {
                const rect = button.getBoundingClientRect();
                return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
            }), true);
        });
    } finally { await app.close(); }
    if (failures.length) throw Error(failures.join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; });
