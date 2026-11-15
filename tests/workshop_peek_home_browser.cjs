'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(); let passed = 0, failed = 0;
    async function check(name, run) {
        if (process.argv[2] && !name.includes(process.argv[2])) return;
        const f = await app.page();
        try { await run(f.page, f.context); assert.deepEqual(f.errors, [], 'no uncaught page errors'); passed++; console.log('PASS ' + name); }
        catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
        finally { await f.context.close(); }
    }
    async function setupModels(page) {
        await page.evaluate(async () => {
            db.workshopSettings.provider = 'gpt';
            db.workshopSettings.gptModel = 'chosen';
            db.workshopSettings.apiPresets.gpt = [{ id: 'fixture', name: 'Fixture', url: 'https://models.test/v1/images/generations', key: 'fixture-key', protocol: 'openai' }];
            db.workshopSettings.activeApiPresetId.gpt = 'fixture';
            document.querySelector('input[name="workshop-provider"][value="gpt"]').checked = true;
            updateApiPresetList(); await saveData();
            const nativeFetch = window.fetch;
            window.modelRequests = [];
            window.fetch = (url, options = {}) => {
                if (!String(url).startsWith('https://models.test/')) return nativeFetch(url, options);
                return new Promise((resolve, reject) => {
                    const request = { url, options, resolve, reject }; modelRequests.push(request);
                    options.signal?.addEventListener('abort', () => reject(options.signal.reason || new DOMException('Aborted', 'AbortError')), { once: true });
                });
            };
            window.modelValues = () => [...document.getElementById('workshop-api-model').options].map(o => o.value);
        });
    }
    async function startModels(page) {
        await page.evaluate(() => document.getElementById('workshop-fetch-models-btn').click());
        await page.waitForFunction(() => modelRequests.length > 0);
    }
    async function finishModels(page, payload = { data: [{ id: 'stale-model' }] }, status = 200) {
        await page.evaluate(({ payload, status }) => modelRequests[0].resolve(new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })), { payload, status });
        await page.waitForFunction(() => !document.getElementById('workshop-fetch-models-btn').disabled);
    }
    async function setupPeek(page) {
        await page.evaluate(async () => {
            const char = { id: 'peek-a', realName: 'A', remarkName: 'A', myName: 'User', avatar: '', history: [], peekData: {} };
            db.characters = [char]; currentChatId = char.id; currentChatType = 'private'; await saveData();
            resolveAuxiliaryApiConfig = () => ({ url: 'https://peek.test/v1', key: 'fixture-key', model: 'fixture-model', provider: 'newapi' });
        });
    }
    try {
        await check('old model response cannot replace a new provider list', async page => {
            await setupModels(page); await startModels(page);
            const before = await page.evaluate(async () => {
                document.querySelector('input[name="workshop-provider"][value="novelai"]').checked = true;
                db.workshopSettings.provider = 'novelai'; updateApiPresetList(); await saveData(); return modelValues();
            });
            await finishModels(page);
            assert.deepEqual(await page.evaluate(() => modelValues()), before);
        });
        await check('old model failure cannot restore GPT defaults over a new provider', async page => {
            await setupModels(page); await startModels(page);
            const before = await page.evaluate(() => {
                document.querySelector('input[name="workshop-provider"][value="novelai"]').checked = true;
                db.workshopSettings.provider = 'novelai'; updateApiPresetList(); return modelValues();
            });
            await finishModels(page, { error: 'upstream failure' }, 503);
            assert.deepEqual(await page.evaluate(() => modelValues()), before);
        });
        await check('old model response cannot replace a changed API address', async page => {
            await setupModels(page); await startModels(page);
            const before = await page.evaluate(() => {
                const input = document.getElementById('workshop-api-url'); input.value = 'https://models.test/new/v1/images/generations';
                input.dispatchEvent(new Event('input', { bubbles: true })); return modelValues();
            });
            await finishModels(page);
            assert.deepEqual(await page.evaluate(() => modelValues()), before);
        });
        await check('current model results preserve the saved selection', async page => {
            await setupModels(page); await startModels(page);
            await finishModels(page, { data: [{ id: 'chosen' }, { id: 'other' }] });
            assert.deepEqual(await page.evaluate(() => ({ values: modelValues(), chosen: document.getElementById('workshop-api-model').value, stored: db.workshopSettings.gptModel })), { values: ['', 'chosen', 'other'], chosen: 'chosen', stored: 'chosen' });
        });
        await check('switching provider away and back does not revive its old model request', async page => {
            await setupModels(page); await startModels(page);
            const before = await page.evaluate(() => {
                for (const provider of ['novelai', 'gpt']) {
                    db.workshopSettings.provider = provider;
                    document.querySelector(`input[name="workshop-provider"][value="${provider}"]`).checked = true;
                    updateApiPresetList();
                }
                return modelValues();
            });
            await finishModels(page);
            assert.deepEqual(await page.evaluate(() => modelValues()), before);
        });
        await check('retired model request cannot unlock a newer pending request', async page => {
            await setupModels(page); await startModels(page);
            await page.evaluate(() => {
                const input = document.getElementById('workshop-api-key'); input.value = 'new-fixture-key'; input.dispatchEvent(new Event('input', { bubbles: true }));
                document.getElementById('workshop-fetch-models-btn').click();
            });
            await page.waitForFunction(() => modelRequests.length === 2);
            await page.evaluate(() => modelRequests[0].resolve(new Response(JSON.stringify({ data: [{ id: 'old' }] }))));
            assert.equal(await page.locator('#workshop-fetch-models-btn').isDisabled(), true);
            await page.evaluate(() => modelRequests[1].resolve(new Response(JSON.stringify({ data: [{ id: 'chosen' }, { id: 'new' }] }))));
            await page.waitForFunction(() => !document.getElementById('workshop-fetch-models-btn').disabled);
            assert.deepEqual(await page.evaluate(() => modelValues()), ['', 'chosen', 'new']);
        });
        await check('model request timeout releases its button and preserves existing options', async page => {
            await page.clock.install(); await setupModels(page); const before = await page.evaluate(() => modelValues());
            await startModels(page); await page.clock.fastForward(31000);
            await page.waitForFunction(() => !document.getElementById('workshop-fetch-models-btn').disabled);
            assert.equal(await page.evaluate(() => modelRequests[0].options.signal.aborted), true);
            assert.deepEqual(await page.evaluate(() => modelValues()), before);
            assert.match(await page.locator('#toast-notification .toast-message').textContent(), /超时/);
        });
        await check('reinitializing model controls keeps one live request handler', async page => {
            await setupModels(page); await page.evaluate(() => { initWorkshopModels(); initWorkshopModels(); });
            await startModels(page); await finishModels(page);
            assert.equal(await page.evaluate(() => modelRequests.length), 1);
        });
        await check('peek failures clear loading placeholders in every generated app', async page => {
            await setupPeek(page);
            const result = await page.evaluate(async () => {
                fetchAiResponse = async () => { throw new Error('fixture upstream failure'); };
                const screens = { messages: 'peek-messages-screen', album: 'peek-album-screen', memos: 'peek-memos-screen', transfer: 'peek-transfer-station-screen', cart: 'peek-cart-screen', browser: 'peek-browser-screen', drafts: 'peek-drafts-screen', steps: 'peek-steps-screen', unlock: 'peek-unlock-screen', bag: 'peek-bag-screen' };
                const result = [];
                for (const [type, id] of Object.entries(screens)) {
                    await generateAndRenderPeekContent(type, { forceRefresh: true });
                    result.push({ type, text: document.getElementById(id).innerText, locked: generatingPeekApps.has(type), back: !!document.querySelector('#' + id + ' .back-btn') });
                    document.querySelectorAll('.modal.visible').forEach(el => el.classList.remove('visible'));
                }
                return result;
            });
            for (const item of result) { assert.doesNotMatch(item.text, /正在生成/, item.type); assert.match(item.text, /失败/, item.type); assert.equal(item.locked, false, item.type); assert.equal(item.back, true, item.type); }
        });
        await check('peek save failure exits loading while keeping original cache', async page => {
            await setupPeek(page);
            const result = await page.evaluate(async () => {
                db.characters[0].peekData.browser = { history: [{ title: 'OLD', url: 'https://old.test', annotation: 'old' }] }; await saveData();
                fetchAiResponse = async () => '<result><browser><record><title>NEW</title></record></browser></result>';
                const fail = () => { throw new Error('fixture disk failure'); }; dexieDB.characters.hook('updating', fail);
                try { await generateAndRenderPeekContent('browser', { forceRefresh: true }); }
                finally { dexieDB.characters.hook('updating').unsubscribe(fail); }
                return { text: document.getElementById('peek-browser-screen').innerText, title: db.characters[0].peekData.browser.history[0].title, locked: generatingPeekApps.has('browser') };
            });
            assert.doesNotMatch(result.text, /正在生成/); assert.equal(result.title, 'OLD'); assert.equal(result.locked, false);
        });
        await check('peek browser refresh retries successfully after a failure', async page => {
            await setupPeek(page);
            await page.evaluate(async () => {
                fetchAiResponse = async () => { throw new Error('fixture failure'); };
                await generateAndRenderPeekContent('browser', { forceRefresh: true });
                document.querySelectorAll('.modal.visible').forEach(el => el.classList.remove('visible'));
                fetchAiResponse = async () => '<result><browser><history><item><title>RECOVERED</title><url>https://fixture.test</url><annotation>fixture</annotation></item></history></browser></result>';
                document.querySelector('#peek-browser-screen .action-btn').click();
            });
            await page.waitForFunction(() => !generatingPeekApps.has('browser'));
            assert.match(await page.locator('#peek-browser-screen').textContent(), /RECOVERED/);
            assert.equal(await page.evaluate(async () => (await dexieDB.characters.get('peek-a')).peekData.browser.history[0].title), 'RECOVERED');
        });
        await check('peek empty successful and cached results do not claim to still generate', async page => {
            await setupPeek(page);
            const texts = await page.evaluate(async () => {
                fetchAiResponse = async () => '<result><browser><history></history></browser></result>';
                await generateAndRenderPeekContent('browser', { forceRefresh: true }); const first = document.getElementById('peek-browser-screen').innerText;
                await generateAndRenderPeekContent('browser'); return [first, document.getElementById('peek-browser-screen').innerText];
            });
            texts.forEach(text => { assert.doesNotMatch(text, /正在生成/); assert.match(text, /暂无内容/); });
        });
        await check('peek step annotations retain actual returned text on success and reopening', async page => {
            await setupPeek(page);
            const texts = await page.evaluate(async () => {
                fetchAiResponse = async () => '<result><steps><currentSteps>42</currentSteps><trajectory><item>walk</item></trajectory><annotation>正在生成一个新计划</annotation></steps></result>';
                await generateAndRenderPeekContent('steps', { forceRefresh: true }); const first = document.getElementById('steps-annotation-content').textContent;
                await generateAndRenderPeekContent('steps'); return [first, document.getElementById('steps-annotation-content').textContent];
            });
            assert.deepEqual(texts, ['正在生成一个新计划', '正在生成一个新计划']);
        });
        await check('late peek failure does not replace a newly opened browser view', async page => {
            await setupPeek(page);
            const result = await page.evaluate(async () => {
                let reject; fetchAiResponse = () => new Promise((_, fail) => { reject = fail; });
                const pending = generateAndRenderPeekContent('browser', { forceRefresh: true });
                const other = { id: 'peek-b', realName: 'B', history: [], peekData: {} }; db.characters.push(other); currentChatId = other.id;
                renderPeekBrowser([{ title: 'B VIEW', url: 'https://b.test', annotation: 'B' }]);
                reject(new Error('late failure')); await pending;
                return { text: document.getElementById('peek-browser-screen').innerText, locked: generatingPeekApps.has('browser') };
            });
            assert.match(result.text, /B VIEW/); assert.doesNotMatch(result.text, /失败/); assert.equal(result.locked, false);
        });
        await check('home repeated setup handles a context menu only once', async page => {
            const result = await page.evaluate(() => {
                setupHomeScreen(); setupHomeScreen(); setupHomeScreen();
                const event = new Event('contextmenu', { bubbles: true, cancelable: true }); let calls = 0;
                event.preventDefault = () => { calls++; Event.prototype.preventDefault.call(event); };
                document.getElementById('home-screen').dispatchEvent(event); return { calls, prevented: event.defaultPrevented };
            });
            assert.deepEqual(result, { calls: 1, prevented: true });
        });
        await check('home repeated setup retains one close handler on the shared widget modal', async page => {
            const count = await page.evaluate(() => {
                setupHomeScreen(); setupHomeScreen(); setupHomeScreen();
                const modal = document.getElementById('widget-add-modal'), remove = modal.classList.remove.bind(modal.classList); let count = 0;
                modal.classList.remove = (...args) => { count++; remove(...args); };
                document.getElementById('close-widget-add-modal-btn').click(); return count;
            });
            assert.equal(count, 1);
        });
        await check('home context menu still allows editing text after repeated setup', async page => {
            const prevented = await page.evaluate(() => {
                setupHomeScreen(); setupHomeScreen();
                const edit = document.createElement('span'); edit.contentEditable = 'true'; document.getElementById('home-screen').appendChild(edit);
                const event = new Event('contextmenu', { bubbles: true, cancelable: true }); edit.dispatchEvent(event); return event.defaultPrevented;
            });
            assert.equal(prevented, false);
        });
        await check('home reinitializing during a drag removes old global drag tracking', async (page, context) => {
            const cdp = await context.newCDPSession(page);
            const listeners = async () => {
                const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
                const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
                return listeners.filter(item => ['mousemove', 'touchmove'].includes(item.type)).length;
            };
            const initial = await listeners();
            await page.evaluate(() => { homeSortables[0].option('onStart')(); });
            assert.ok(await listeners() > initial, 'drag installs global tracking');
            await page.evaluate(() => setupHomeScreen());
            assert.equal(await listeners(), initial, 'old drag tracking removed after rebuilding the home screen');
            assert.equal(await page.evaluate(() => edgeFlipInterval), null);
        });
    } finally { await app.close(); }
    console.log(JSON.stringify({ passed, failed })); if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
