const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(); let failed = 0, passed = 0;
    async function check(name, run) {
        const f = await app.page();
        try {
            await f.page.evaluate(async () => {
                const char = { id: 'transport-fixture', realName: '测试角色', remarkName: '测试角色', myName: '我',
                    persona: '测试人设', myPersona: '', avatar: '', activeArchiveId: 'one', history: [
                        { id: 'user-one', role: 'user', content: '[我的消息：你好]', timestamp: Date.now() }
                    ], maxMemory: 20, memoryJournals: [], worldBookIds: [], theme: 'blue', status: '在线' };
                db.characters = [char]; db.groups = []; db.worldBooks = [];
                db.cotSettings.enabled = false; db.cotSettings.callEnabled = false;
                db.apiSettings = { provider: 'newapi', url: 'https://fixture.invalid', key: 'fixture', model: 'fixture', streamEnabled: false };
                await saveData(); openChatRoom(char.id, 'private');
                const original = window.fetch;
                window.fixtureRequests = [];
                window.fetch = (url, init) => {
                    if (String(url).startsWith('https://fixture.invalid')) {
                        fixtureRequests.push({ url, body: JSON.parse(init.body) });
                        return window.transportResponse(url, init);
                    }
                    return original(url, init);
                };
            });
            await run(f.page);
            assert.deepEqual(f.errors, [], 'no uncaught browser errors'); passed++; console.log('PASS ' + name);
        } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
        finally { await f.context.close(); }
    }
    try {
        await check('reply button reports provider errors and unlocks without changing history', async page => {
            await page.evaluate(() => { window.transportResponse = async () => new Response('{"error":{"code":"LIMIT","message":"fixture quota exhausted"}}'); });
            const before = await page.evaluate(() => JSON.stringify(db.characters[0].history));
            await page.locator('#get-reply-btn').click();
            await page.locator('#error-modal-overlay').waitFor();
            await page.waitForFunction(() => chatGenerationRequests.size === 0);
            assert.match(await page.locator('#error-modal-overlay').innerText(), /LIMIT.*fixture quota exhausted/);
            assert.equal(await page.evaluate(() => JSON.stringify(db.characters[0].history)), before);
            assert.equal(await page.locator('#get-reply-btn').isEnabled(), true);
            assert.equal(await page.locator('#get-reply-btn').getAttribute('aria-label'), 'AI 回复');
        });
        await check('stream requested but JSON returned still renders one ordinary reply', async page => {
            await page.evaluate(() => {
                db.apiSettings.streamEnabled = true;
                window.transportResponse = async () => new Response(JSON.stringify({ choices: [{ message: { content: '[测试角色的消息：模拟回复完成]' } }], usage: { total_tokens: 12 } }), { headers: { 'content-type': 'application/json' } });
            });
            await page.locator('#get-reply-btn').click();
            await page.waitForFunction(() => chatGenerationRequests.size === 0 && db.characters[0].history.some(m => m.role === 'assistant'), { timeout: 20000 });
            const replies = await page.evaluate(() => db.characters[0].history.filter(m => m.role === 'assistant').map(m => m.content));
            assert.deepEqual(replies, ['[测试角色的消息：模拟回复完成]']);
            assert.match(await page.locator('#message-area').innerText(), /模拟回复完成/);
            assert.equal(await page.locator('#error-modal-overlay').count(), 0);
        });
        await check('partial stream followed by error does not save or render a fake complete reply', async page => {
            await page.evaluate(() => {
                db.apiSettings.streamEnabled = true;
                window.transportResponse = async () => new Response('data:{"choices":[{"delta":{"content":"[测试角色的消息：半截回复]"}}]}\n\ndata:{"error":{"message":"fixture interrupted"}}\n\n', { headers: { 'content-type': 'text/event-stream' } });
            });
            await page.locator('#get-reply-btn').click(); await page.locator('#error-modal-overlay').waitFor();
            await page.waitForFunction(() => chatGenerationRequests.size === 0);
            assert.match(await page.locator('#error-modal-overlay').innerText(), /fixture interrupted/);
            assert.equal(await page.evaluate(() => db.characters[0].history.filter(m => m.role === 'assistant').length), 0);
            assert.doesNotMatch(await page.locator('#message-area').innerText(), /半截回复/);
        });
        await check('actual Gemini nonstream call uses generateContent and delivers once', async page => {
            const result = await page.evaluate(async () => {
                db.apiSettings.provider = 'gemini'; const updates = [];
                window.transportResponse = async () => new Response('{"candidates":[{"content":{"parts":[{"text":"通话模拟回复"}]}}]}');
                const value = await getCallReply(db.characters[0], 'voice', [], text => updates.push(text));
                return { value, updates, url: fixtureRequests[0].url };
            });
            assert.equal(result.value, '通话模拟回复'); assert.deepEqual(result.updates, ['通话模拟回复']);
            assert.match(result.url, /:generateContent\?/);
        });
        await check('call stream handles CRLF, no space and unfinished final event', async page => {
            const result = await page.evaluate(async () => {
                db.apiSettings.streamEnabled = true; const updates = [];
                window.transportResponse = async () => new Response('data:{"choices":[{"delta":{"content":"第一段"}}]}\r\n\r\ndata:{"choices":[{"delta":{"content":"第二段🌸"}}]}');
                return { value: await getCallReply(db.characters[0], 'voice', [], text => updates.push(text)), updates };
            });
            assert.equal(result.value, '第一段第二段🌸'); assert.deepEqual(result.updates, ['第一段第二段🌸']);
        });
        await check('protocol DONE returns while connection stays open and releases the reader', async page => {
            const result = await page.evaluate(async () => {
                let cancelled = false;
                const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data:{"choices":[{"delta":{"content":"完成"}}]}\n\ndata:[DONE]\n\n')); }, cancel() { cancelled = true; } }));
                const text = await readStreamResponse(response, 'newapi');
                return { text, cancelled, locked: response.body.locked };
            });
            assert.deepEqual(result, { text: '完成', cancelled: true, locked: false });
        });
        await check('summary rejects HTTP500 text even when body looks like a successful reply', async page => {
            const result = await page.evaluate(async () => {
                window.transportResponse = async () => new Response('{"choices":[{"message":{"content":"bad summary"}}]}', { status: 500 });
                return await generateCallSummary(db.characters[0], []);
            });
            assert.equal(result, null);
        });
    } finally { await app.close(); }
    console.log(JSON.stringify({ passed, failed })); process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
