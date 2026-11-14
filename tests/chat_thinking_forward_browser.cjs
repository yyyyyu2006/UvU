const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
const out = path.join(process.env.UVU_BROWSER_OUTPUT_DIR || path.join(root, 'outputs/avatar-forward-search'), 'thinking-ui');
fs.mkdirSync(out, { recursive: true });
(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        page.setDefaultTimeout(8000);
        await page.evaluate(async () => {
            const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#d4e5ef"/></svg>');
            const now = Date.now();
            const history = [
                { id: 'user', role: 'user', content: '[我的消息：你好]', timestamp: now },
                { id: 'thought', role: 'assistant', isThinking: true, isContextDisabled: true,
                    content: '<thinking>仅展示已有记录\n<script>window.viewerExecuted=true</script>\n' + '长内容。'.repeat(600) + '</thinking>', timestamp: now + 1 },
                { id: 'reply', role: 'assistant', content: '[谢濯的消息：你好]', thinkingMessageId: 'thought', timestamp: now + 2 },
                { id: 'none', role: 'assistant', content: '[谢濯的消息：这一轮没有思考]', thinkingMessageId: null, timestamp: now + 3 },
                { id: 'forward', role: 'assistant', content: '<谢濯转发的聊天记录>陈硕:不是哥们你真谈了？？？\\n陈硕:谁啊\\n谢濯:少打听\\n谢濯:反正比你有福气</谢濯转发的聊天记录>', timestamp: now + 4 },
            ];
            const chat = { id: 'viewer', realName: '谢濯', remarkName: '谢濯', myName: '我', avatar, myAvatar: avatar,
                history, maxMemory: 20, persona: '保留人设', worldBookIds: [], memoryJournals: [] };
            db.characters = [chat, { ...chat, id: 'other', history: [] }];
            ensureAllChatArchives(); await saveData(); openChatRoom('viewer', 'private'); showPanel('none');
            window.viewerBefore = JSON.stringify(chat);
            Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async text=>{window.copiedThinking=text;}} });
            window.viewerFetches = 0;
            const original = window.fetch;
            window.fetch = (...args) => { viewerFetches++; return original(...args); };
        });
        let time = Date.parse('2026-11-15T04:00:00Z');
        const action = async fn => { await page.clock.setFixedTime(new Date(time += 2000)); await fn(); };
        for (const [width,height] of [[320,844],[390,844],[768,844],[390,400],[768,390]]) {
            await page.setViewportSize({ width, height });
            await action(() => page.locator('[data-id="reply"] [data-thinking-avatar]').click());
            const dialog = page.locator('#char-thinking-dialog');
            await stableUI(page, '#char-thinking-dialog');
            assert.equal(await dialog.locator('script').count(), 0);
            assert.equal(await page.evaluate(() => window.viewerExecuted), undefined);
            assert.equal(await dialog.getByText('本轮思考', { exact: true }).count(), 1);
            assert.equal(await dialog.locator('.char-thinking-content').evaluate(el => el.scrollHeight > el.clientHeight), true);
            assert.equal(await dialog.locator('.char-thinking-content').evaluate(el => getComputedStyle(el).fontSize), '14px');
            assert.equal(await dialog.locator('h3').innerText(), '谢濯');
            assert.equal(await dialog.locator('.char-thinking-avatar').count(), 1);
            const buttons=await dialog.locator('header button').evaluateAll(elements=>elements.map(el=>{
                const rect=el.getBoundingClientRect(); return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,hit:el.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))};
            }));
            assert.equal(buttons.length,2); assert.ok(buttons.every(b=>b.hit));
            assert.equal(buttons[0].y,buttons[1].y);assert.equal(buttons[0].width,buttons[1].width);assert.ok(buttons[1].x>buttons[0].x+buttons[0].width);
            await action(()=>dialog.getByRole('button',{name:'复制思考内容',exact:true}).click());
            assert.equal(await page.evaluate(()=>copiedThinking),await dialog.locator('.char-thinking-content').textContent());
            const box = await dialog.boundingBox();
            assert.ok(Math.abs(box.height-(height-40))<2, 'tall popup retains 20px viewport inset');
            assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
            assert.equal(await dialog.locator('.char-thinking-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
            await page.screenshot({ animations: 'disabled', path: path.join(out, `thinking-${width}x${height}.png`) });
            await page.keyboard.press('Escape');
            assert.equal(await dialog.count(), 0);
            assert.equal(await page.locator('[data-id="reply"] [data-thinking-avatar]').evaluate(el => el === document.activeElement), true);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await action(() => page.locator('[data-id="none"] [data-thinking-avatar]').click());
        assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
        assert.equal(await page.evaluate(()=>notificationQueue.includes('这条回复没有已保存的思考内容') || document.body.innerText.includes('这条回复没有已保存的思考内容')), true);
        await action(() => page.locator('[data-id="reply"] [data-thinking-avatar]').press('Enter'));
        await page.evaluate(()=>{
            Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
            document.execCommand=command=>{window.copyFallbackSeen=document.querySelector('.char-thinking-copy-buffer')?.value;return command==='copy';};
        });
        await action(()=>page.getByRole('button',{name:'复制思考内容',exact:true}).click());
        assert.equal(await page.evaluate(()=>copyFallbackSeen),await page.locator('.char-thinking-content').textContent());
        assert.equal(await page.locator('.char-thinking-copy-buffer').count(),0);
        assert.equal(await page.getByRole('button',{name:'复制思考内容',exact:true}).evaluate(el=>el===document.activeElement),true);
        await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('permission denied');}}}));
        await action(()=>page.getByRole('button',{name:'复制思考内容',exact:true}).click());
        await page.waitForFunction(()=>notificationQueue.includes('复制失败，请选中正文后复制') || document.body.innerText.includes('复制失败，请选中正文后复制'));
        await action(() => page.getByRole('button', { name: '关闭思考内容', exact: true }).click());
        assert.equal(await page.evaluate(() => JSON.stringify(db.characters[0]) === viewerBefore), true);
        assert.equal(await page.evaluate(() => viewerFetches), 0, 'viewing never calls an API');
        await page.evaluate(() => { isInMultiSelectMode = true; });
        await action(() => page.locator('[data-id="reply"] [data-thinking-avatar]').click());
        assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
        await page.evaluate(() => { isInMultiSelectMode = false; selectedMessageIds.clear(); isDebugMode = true; });
        await action(() => page.locator('[data-id="reply"] [data-thinking-avatar]').click());
        assert.equal(await page.locator('#char-thinking-dialog').count(), 0);
        assert.equal(await page.locator('#message-edit-modal').evaluate(el => el.classList.contains('visible')), true);
        await page.evaluate(() => { cancelMessageEdit(); isDebugMode = false; });
        await action(() => page.locator('[data-id="forward"] .forwarded-chat-card').click());
        await page.locator('#forwarded-chat-modal.visible').waitFor({ state: 'visible' });
        const forward = page.locator('#forwarded-chat-content');
        assert.equal(await forward.locator(':scope > div').count(), 4);
        assert.ok(!(await forward.innerText()).includes('\\n'));
        assert.match(await forward.innerText(), /陈硕[\s\S]*谢濯/);
        assert.equal(await forward.locator(':scope > div').last().evaluate(el => getComputedStyle(el).alignItems), 'flex-end');
        await page.screenshot({ animations: 'disabled', path: path.join(out, 'forward-fixed.png') });
        await action(() => page.locator('#close-forwarded-chat-btn').click());
        await action(() => page.locator('[data-id="reply"] [data-thinking-avatar]').click());
        await page.evaluate(() => openChatRoom('other', 'private'));
        await page.waitForFunction(() => !document.getElementById('char-thinking-dialog'));
        await page.evaluate(async () => {
            openChatRoom('viewer', 'private');
            const chat = db.characters[0];
            await handleAiReplyContent('<thinking>新的一轮</thinking>\n[谢濯的消息：新回复]', chat, chat.id, 'private', true);
            const latest = chat.history.at(-1);
            if (!latest.thinkingMessageId || getSavedMessageThinking(chat, latest.id)?.text !== '新的一轮') throw Error('new response link missing');
            await handleAiReplyContent('[谢濯的消息：无思考的下一轮]', chat, chat.id, 'private', true);
            if (chat.history.at(-1).thinkingMessageId !== null || getSavedMessageThinking(chat, chat.history.at(-1).id)) throw Error('borrowed previous response thinking');
            await saveData();
            switchScreen('api-settings-screen');
            const select = document.getElementById('api-model');
            select.replaceChildren(new Option('模型一', 'one'), new Option('模型二', 'two'));
        });
        await action(() => page.locator('#api-model-picker').click());
        const search = page.getByRole('searchbox', { name: '搜索模型名称' });
        await search.focus();
        const style = await search.evaluate(el => { const s = getComputedStyle(el); return { outline: s.outlineStyle, border: s.borderTopWidth, shadow: s.boxShadow }; });
        assert.equal(style.outline, 'none'); assert.equal(style.border, '0px'); assert.match(style.shadow, /201, 234, 248/);
        await page.screenshot({ animations: 'disabled', path: path.join(out, 'search-fixed.png') });
        await search.fill('模型二'); await search.press('ArrowDown'); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#api-model').inputValue(), 'two');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => db.characters.some(c => c.id === 'viewer'));
        assert.equal(await page.evaluate(() => { const c = db.characters.find(c => c.id === 'viewer'); return c.history.at(-1).thinkingMessageId === null && getSavedMessageThinking(c, c.history.at(-2).id)?.text === '新的一轮'; }), true);
        assert.deepEqual(errors, []);
        console.log('PASS real UI: avatar click/keyboard/modes, saved reply links/reload/character switch, read-only safe text, 320/390/short landscape, forwarded speaker rows, search focus and selection');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
