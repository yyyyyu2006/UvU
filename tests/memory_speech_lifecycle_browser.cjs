'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fullApp, stableUI, root } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(), output = path.join(root, 'outputs/memory-speech-lifecycle');
    fs.mkdirSync(output, { recursive: true });
    try {
        const { page, errors } = await app.page({ viewport: { width: 320, height: 568 }, hasTouch: false });
        page.setDefaultTimeout(10000);
        await page.evaluate(async () => {
            document.addEventListener('pointerdown', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            const chat = { id: 'memory-speech-audit', realName: '测试角色', myName: '测试用户', persona: '', myPersona: '',
                maxMemory: 20, worldBookIds: [], memoryJournals: [{ id: 'note', title: '约定', content: 'OLD_RECALLED_FACT', isFavorited: false }],
                history: [{ id: 'one', role: 'user', content: '早些时候聊过约定。', timestamp: Date.now() - 3000 },
                    { id: 'two', role: 'assistant', content: '好的。', timestamp: Date.now() - 2000 },
                    { id: 'three', role: 'user', content: '记得那个约定吗？', timestamp: Date.now() - 1000 }],
                autoMemorySettings: { enabled: false, useMemory: false, vectorSearchEnabled: true, vectorThreshold: 0, keepRecent: 1, vectorQueryCache: true } };
            chat.avatar = chat.myAvatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="20" fill="#d4e5ef"/></svg>');
            db.characters = [chat]; db.groups = []; db.minimaxTtsSettings = {}; db.cotSettings = { enabled: false };
            db.apiSettings = { provider: 'newapi', url: 'https://chat-fixture.invalid/v1', key: 'fixture', model: 'chat', streamEnabled: false };
            db.vectorMemoryApiSettings = { provider: 'newapi', url: 'https://vector-fixture.invalid/v1', key: 'fixture', embeddingModel: 'embed' };
            ensureAllChatArchives(); await saveData(); openChatRoom(chat.id, 'private'); showPanel('none');
            window.auditToasts = [];
            new MutationObserver(() => { const toast = document.querySelector('#toast-notification.show .toast-message'); if (toast) auditToasts.push(toast.textContent); }).observe(document.getElementById('toast-notification'), { attributes: true, childList: true, subtree: true });
            window.auditRequests = []; window.auditSpeechCalls = 0;
            const originalFetch = window.fetch;
            window.fetch = async (url, init) => {
                url = String(url);
                if (url.startsWith('https://vector-fixture.invalid/')) {
                    const input = JSON.parse(init.body).input;
                    return new Response(JSON.stringify({ data: (Array.isArray(input) ? input : [input]).map((_, index) => ({ index, embedding: [1, 0] })) }));
                }
                if (url.startsWith('https://chat-fixture.invalid/')) {
                    auditRequests.push(JSON.parse(init.body));
                    return new Response(JSON.stringify({ choices: [{ message: { content: '[测试角色：收到。]' } }] }));
                }
                if (url.startsWith('https://speech-fixture.invalid/')) {
                    auditSpeechCalls++;
                    const packet = { data: { status: 2, audio: ('fffb9064' + '00'.repeat(413)).repeat(70) } };
                    return new Response(new ReadableStream({ start(controller) {
                        controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(packet) + '\n\n' + 'data: [DO'));
                    }, cancel() { window.auditReaderCancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
                }
                return originalFetch(url, init);
            };
            getEnvironmentContext = async () => { window.auditRetrievalFinished = true; await new Promise(resolve => { window.auditRelease = resolve; }); return ''; };
            window.auditReply = getAiReply(chat.id, 'private', true);
        });
        await page.waitForFunction(() => window.auditRetrievalFinished === true);
        await page.evaluate(() => { db.characters[0].memoryJournals[0].content = 'CORRECTED_LIVE_FACT'; auditRelease(); });
        await page.evaluate(() => auditReply);
        const requests = await page.evaluate(() => auditRequests);
        assert.equal(requests.length, 1);
        assert.doesNotMatch(JSON.stringify(requests[0]), /OLD_RECALLED_FACT/);
        assert.match(JSON.stringify(requests[0]), /记得那个约定吗/);
        assert.equal(await page.evaluate(() => db.characters[0].memoryJournals[0].content), 'CORRECTED_LIVE_FACT');
        await page.evaluate(() => {
            const chat = db.characters[0]; chat.autoMemorySettings.vectorSearchEnabled = false;
            chat.history.push({ id: 'voice-tail', role: 'assistant', content: '[测试角色的语音：这是一段本地合成的测试音频。]', timestamp: Date.now() });
            openChatRoom(chat.id, 'private'); showPanel('none');
            db.minimaxTtsSettings = { apiKey: 'fixture', voiceId: 'fixture', endpoint: 'https://speech-fixture.invalid/v1/t2a_v2' };
        });
        const bubble = page.locator('[data-id="voice-tail"] .voice-bubble');
        await bubble.click();
        await page.waitForFunction(() => document.querySelector('[data-id="voice-tail"] .voice-bubble')?.dataset.speechPhase === 'playing');
        assert.equal(await page.evaluate(() => auditReaderCancelled), true);
        await page.waitForFunction(() => document.querySelector('[data-id="voice-tail"] .voice-bubble')?.dataset.speechPhase === 'stopped');
        assert.equal(await bubble.getAttribute('aria-busy'), null);
        assert.equal(await bubble.evaluate(element => element.classList.contains('voice-playing')), false);
        assert.equal(await page.evaluate(() => auditSpeechCalls), 1);
        assert.deepEqual(await page.evaluate(() => auditToasts), []);
        await stableUI(page, '#chat-room-screen');
        await page.screenshot({ path: path.join(output, 'ended-320.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log('PASS full App: source edit after retrieval omitted from actual provider request; raw recent message retained; SSE terminal audio with partial tail played and ended; transport cancelled; one synthesis; 320px/no overflow/pageerror 0.');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
