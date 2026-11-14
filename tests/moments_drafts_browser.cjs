'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        await page.evaluate(() => {
            const chat = { id: 'draft-owner', realName: '角色', myName: '用户', persona: '测试人设',
                history: [], memoryJournals: [], moments: [{ id: 'draft-post', content: '公开动态',
                    authorRef: { kind: 'character', id: 'draft-owner' }, comments: [], likes: [] }] };
            db.characters = [chat]; currentChatId = chat.id; currentChatType = 'private';
            chat.momentsSocial = UvUMoments.settings(chat); chat.momentsSocial.enabled = true;
            chat.momentsSocial.npcs = [{ id: 'draft-npc', name: '配角', persona: '测试配角', enabled: true }];
            switchScreen('moments-screen'); renderMomentsScreen();
            window.realDraftFunctions = { draftPost: UvUMomentsAI.draftPost, summarize: UvUMomentsAI.summarize };
            UvUMomentsAI.draftPost = UvUMomentsAI.summarize = () => new Promise((resolve, reject) => {
                window.releaseDraft = resolve; window.failDraft = () => reject(new Error('模拟请求失败'));
            });
        });
        const failures = [];
        async function check(name, fn) {
            try { await fn(); console.log('PASS ' + name); }
            catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
            finally { await page.evaluate(() => document.querySelectorAll('.ms-overlay').forEach(el => el.remove())); }
        }
        async function open(kind) {
            if (kind === 'post') await page.evaluate(() => UvUMomentsUI.publish(db.characters[0]));
            else {
                await page.getByRole('button', { name: '动态操作', exact: true }).click();
                await page.locator('.ms-overlay').last().getByRole('button', { name: '整理为记忆', exact: true }).click();
            }
            const dialog = page.locator('.ms-overlay').last(), input = dialog.locator('textarea').first();
            const run = dialog.getByRole('button', { name: kind === 'post' ? '生成草稿' : '生成摘要', exact: true });
            const by = dialog.locator('select').first();
            if (kind === 'post') await by.selectOption('1');
            return { dialog, input, run, by };
        }
        async function release(run, fail = false) {
            await page.evaluate(fail => fail ? window.failDraft() : window.releaseDraft('返回的生成内容'), fail);
            await run.evaluate(el => el.disabled ? new Promise((resolve, reject) => {
                const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('生成按钮未恢复')); }, 5000);
                const observer = new MutationObserver(() => { if (!el.disabled) { clearTimeout(timeout); observer.disconnect(); resolve(); } });
                observer.observe(el, { attributes: true, attributeFilter: ['disabled'] });
            }) : undefined);
        }
        for (const kind of ['post', 'summary']) {
            await check(kind + ' fills unchanged draft', async () => {
                const { input, run } = await open(kind); await run.click(); await release(run);
                assert.equal(await input.inputValue(), '返回的生成内容');
            });
            await check(kind + ' preserves edits while waiting', async () => {
                const { input, run } = await open(kind); await run.click(); await input.fill('手动写的内容'); await release(run);
                assert.equal(await input.inputValue(), '手动写的内容');
            });
            await check(kind + ' preserves edit even when reverted', async () => {
                const { input, run } = await open(kind); await run.click(); await input.fill('输入后又清空'); await input.fill(''); await release(run);
                assert.equal(await input.inputValue(), '');
            });
            await check(kind + ' ignores result after archive switch', async () => {
                const { input, run } = await open(kind); await run.click();
                await page.evaluate(() => { db.characters[0].activeArchiveId = 'changed'; }); await release(run);
                assert.equal(await input.inputValue(), '');
                await page.evaluate(() => { delete db.characters[0].activeArchiveId; });
            });
            await page.evaluate(() => { delete db.characters[0].activeArchiveId; });
            await check(kind + ' failure permits retry', async () => {
                const { input, run } = await open(kind); await run.click(); await release(run, true);
                await run.click(); await release(run); assert.equal(await input.inputValue(), '返回的生成内容');
            });
        }
        for (const revert of [false, true]) await check('post rejects changed author, revert=' + revert, async () => {
            const { input, run, by } = await open('post'); await run.click(); await by.selectOption('2');
            if (revert) await by.selectOption('1'); await release(run); assert.equal(await input.inputValue(), '');
        });
        await check('post accepts unchanged NPC', async () => {
            const { input, run, by } = await open('post'); await by.selectOption('2'); await run.click(); await release(run);
            assert.equal(await input.inputValue(), '返回的生成内容');
        });
        await check('closed dialog cannot refill replacement', async () => {
            const { run } = await open('post'); await run.click();
            await page.locator('.ms-overlay').last().getByRole('button', { name: '关闭', exact: true }).click();
            const replacement = await open('post'); await replacement.input.fill('新窗口的内容');
            await page.evaluate(() => window.releaseDraft('旧请求内容'));
            assert.equal(await replacement.input.inputValue(), '新窗口的内容');
        });
        // Exercise the real JSON parser, identity checks and request builder as well as UI guards.
        await page.evaluate(() => {
            Object.assign(UvUMomentsAI, window.realDraftFunctions);
            db.apiSettings = { ...db.apiSettings, provider: 'newapi', url: location.origin, key: 'fixture', model: 'fixture' };
            fetchAiResponse = async (_config, body) => {
                window.lastDraftPayload = JSON.parse(body.messages.at(-1).content);
                return new Promise(resolve => { window.releaseDraft = value => resolve(JSON.stringify({ content: value, summary: value })); });
            };
        });
        for (const kind of ['post', 'summary']) await check(kind + ' real request path preserves edits', async () => {
            const { input, run } = await open(kind); await run.click(); await input.fill('真实组装路径中的手改'); await release(run);
            assert.equal(await input.inputValue(), '真实组装路径中的手改');
        });
        await check('real post request retains original speaker and ignores changed selection', async () => {
            const { input, run, by } = await open('post'); await run.click(); await by.selectOption('2'); await release(run);
            assert.equal(await page.evaluate(() => window.lastDraftPayload.speaker.name), '角色');
            assert.equal(await input.inputValue(), '');
        });
        assert.deepEqual(await page.evaluate(() => [db.characters[0].history.length, db.characters[0].memoryJournals.length]), [0, 0]);
        assert.deepEqual(errors, []); assert.deepEqual(failures, []);
        console.log('PASS all 17 draft ownership cases; no chat history or journal writes, no external APIs.');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
