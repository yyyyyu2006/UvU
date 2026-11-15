const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp(), results = [];
    try {
        const { page, context, errors } = await app.page({ hasTouch: false });
        page.on('pageerror', error => console.error('PAGE:', error.message));
        await page.clock.setSystemTime(new Date());
        page.setDefaultTimeout(6000);
        let gestureTime = Date.now();
        const gesture = async action => { gestureTime += 2000; await page.clock.setFixedTime(new Date(gestureTime)); await action(); };
        await page.evaluate(async () => {
            const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ddd"/></svg>');
            const chat = { id: 'voice-text-fixture', realName: '测试角色', myName: '我', avatar, myAvatar: avatar,
                history: [{ id: 'voice-received', role: 'assistant', content: '[测试角色的语音：这是一条合成测试文字。]', timestamp: Date.now() },
                    { id: 'voice-sent', role: 'user', content: '[我的语音：这是自己发送的测试文字。]', timestamp: Date.now() + 1 }],
                worldBookIds: [], maxMemory: 20 };
            db.characters = [chat]; db.groups = []; db.minimaxTtsSettings = {};
            ensureAllChatArchives(); await saveData(); openChatRoom(chat.id, 'private'); showPanel('none');
            window.textOnlyBefore = JSON.stringify(chat.history);
            window.textOnlyToasts = []; window.showToast = m => textOnlyToasts.push(m);
            window.textOnlyAudio = []; const NativeAudio = window.Audio;
            window.Audio = function (...args) { const audio = new NativeAudio(...args); textOnlyAudio.push(audio); return audio; };
            window.textOnlyRequests = 0; const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (String(url).startsWith('https://speech-fixture.invalid/')) {
                    textOnlyRequests++;
                    return new Response(JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: ('fffb9064' + '00'.repeat(413)).repeat(70), status: 2 }, extra_info: { audio_format: 'mp3' } }), { headers: { 'content-type': 'application/json' } });
                }
                return originalFetch(url, options);
            };
        });
        const bubble = page.locator('[data-id="voice-received"] .voice-bubble');
        assert.deepEqual(errors, []);
        const transcript = page.locator('[data-id="voice-received"] .voice-transcript');
        for (const settings of [{}, { apiKey: 'fixture' }, { voiceId: 'fixture' }]) {
            await page.evaluate(settings => { db.minimaxTtsSettings = settings; }, settings);
            await gesture(() => bubble.click()); assert.equal(await transcript.isVisible(), true);
            await gesture(() => bubble.click()); assert.equal(await transcript.isVisible(), false);
            await gesture(() => bubble.press('Enter'));
            const state = await page.evaluate(() => ({ audio: textOnlyAudio.length, calls: textOnlyRequests, toasts: textOnlyToasts,
                playing: document.querySelector('.voice-bubble').classList.contains('voice-playing'), busy: document.querySelector('.voice-bubble').hasAttribute('aria-busy') }));
            assert.deepEqual(state, { audio: 0, calls: 0, toasts: [], playing: false, busy: false });
        }
        results.push('empty/key-only/voice-only: transcript toggles; click and keyboard create no audio, request, toast, or playing state');
        await gesture(() => page.locator('[data-id="voice-sent"] .voice-bubble').click());
        assert.equal(await page.locator('[data-id="voice-sent"] .voice-transcript').isVisible(), true);
        const skins = [
            '.voice-bubble .play-icon { animation: fixture-wave .4s infinite alternate !important; } .message-wrapper:has(.voice-transcript.active) .voice-bubble::after { content: ""; display: block; width: 12px; height: 10px; background: currentColor; animation: fixture-wave .4s infinite alternate !important; }',
            '#message-area .voice-bubble::before, #message-area .voice-bubble .duration::after { content: ""; display: block; width: 6px; height: 12px; background: currentColor; animation: fixture-wave .4s infinite alternate !important; } #message-area .voice-bubble { animation: fixture-wave .4s infinite alternate !important; }'
        ];
        const states = () => page.evaluate(() => { const b = document.querySelector('[data-id="voice-received"] .voice-bubble'); return [
            getComputedStyle(b).animationPlayState, getComputedStyle(b, '::before').animationPlayState,
            getComputedStyle(b, '::after').animationPlayState, getComputedStyle(b.querySelector('.play-icon')).animationPlayState,
            getComputedStyle(b.querySelector('.duration'), '::after').animationPlayState
        ]; });
        for (let i = 0; i < skins.length; i++) {
            await page.evaluate(css => {
                const chat = db.characters[0]; chat.useCustomBubbleCss = true; chat.customBubbleCss = '@keyframes fixture-wave { from { opacity: .3; } to { opacity: 1; } } ' + css;
                updateCustomBubbleStyle(chat.id, chat.customBubbleCss, true);
            }, skins[i]);
            await gesture(() => bubble.click()); assert.equal(await transcript.isVisible(), true);
            assert.ok((await states()).every(s => s === 'paused'), 'skin ' + i + ': text expansion must not animate idle voice bubbles');
            await gesture(() => bubble.click()); assert.equal(await transcript.isVisible(), false);
            assert.ok((await states()).every(s => s === 'paused'));
        }
        results.push('two custom CSS samples: bubble, SVG, descendants, and pseudo-element waves pause even when transcript is active');
        await page.evaluate(() => { db.minimaxTtsSettings = { apiKey: 'fixture', voiceId: 'fixture', endpoint: 'https://speech-fixture.invalid/v1/t2a_v2' }; });
        await gesture(() => bubble.click()); await page.waitForFunction(() => document.querySelector('.voice-bubble').classList.contains('voice-playing'));
        assert.ok((await states()).every(s => s === 'running'), 'real playback retains the custom skin animations');
        await gesture(() => bubble.click()); assert.equal(await bubble.getAttribute('data-speech-phase'), 'paused');
        assert.ok((await states()).every(s => s === 'paused'));
        await gesture(() => bubble.click()); await page.waitForFunction(() => document.querySelector('.voice-bubble').dataset.speechPhase === 'stopped');
        assert.ok((await states()).every(s => s === 'paused'));
        assert.equal(await page.evaluate(() => textOnlyRequests), 1);
        assert.equal(await page.evaluate(() => JSON.stringify(db.characters[0].history) === textOnlyBefore), true);
        assert.deepEqual(errors, []);
        results.push('configured native Audio: waves run during playback, pause on pause/end; cached resume needs no new synthesis; history unchanged');
        if (process.env.UVU_VOICE_OUTPUT) {
            fs.mkdirSync(process.env.UVU_VOICE_OUTPUT, { recursive: true });
            await page.screenshot({ path: path.join(process.env.UVU_VOICE_OUTPUT, 'voice-text-only.png') });
            fs.writeFileSync(path.join(process.env.UVU_VOICE_OUTPUT, 'browser-verification.json'), JSON.stringify({ browser: app.browser.version(), results, errors }, null, 2));
        }
        console.log(JSON.stringify({ browser: app.browser.version(), results, errors }, null, 2));
        await context.close();
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
