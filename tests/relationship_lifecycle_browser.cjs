'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        // Optional countercheck against the committed pre-patch source, without changing the checkout.
        const sourceRef = process.argv.find(arg => arg.startsWith('--source-ref='))?.slice('--source-ref='.length);
        if (sourceRef) {
            const source = require('node:child_process').execFileSync('git', ['show', sourceRef + ':js/modules/chat_relationship.js'], { encoding: 'utf8' });
            let replacements = 0;
            await page.route(/\/js\/modules\/chat_relationship\.js(?:\?|$)/, route => { replacements++; return route.fulfill({ body: source, contentType: 'application/javascript' }); });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
            assert.equal(replacements, 1, 'the requested source must actually replace the full-app module');
        }
        const result = await page.evaluate(async () => {
            GuideSystem.cleanup();
            const originalFetch = window.fetchAiResponse, originalRefresh = window.refreshRelationshipUI;
            window.refreshRelationshipUI = () => {};
            db.apiSettings = { provider: 'newapi', url: 'https://fixture.invalid', key: 'synthetic', model: 'fixture' };
            const rows = []; let seq = 0;
            const seed = mode => {
                const chat = { id: 'relationship-fixture-' + ++seq, realName: 'Fixture', myName: 'User', persona: 'OLD_PERSONA', maxMemory: 20,
                    history: [{ id: 'accepted', role: 'user', content: 'ACCEPTED_STORY' }], memoryJournals: [], worldBookIds: [] };
                db.characters = [chat]; db.groups = []; ensureAllChatArchives();
                currentChatId = chat.id; currentChatType = 'private';
                chat.friendRelationship = mode === 'block' ? { autonomy: { enabled: true, everyUserMessages: 1 } }
                    : { peer: { blocked: true }, recovery: { mode: 'condition', condition: 'fixture' } };
                return chat;
            };
            try {
                const withdrawn = seed('restore');
                withdrawn.history.push({ id: 'withdrawn', role: 'user', content: '[用户 撤回了一条消息：WITHDRAWN_SECRET]', originalContent: 'WITHDRAWN_SECRET', isWithdrawn: true });
                const storedBefore = JSON.stringify(withdrawn.history); let submitted;
                window.fetchAiResponse = async (_config, body) => { submitted = JSON.parse(body.messages[1].content); return '{"restore":false}'; };
                await checkRelationshipRecovery(withdrawn, true);
                rows.push({ id: 'withdrawn', passed: submitted.acceptedHistory === 'ACCEPTED_STORY' && storedBefore === JSON.stringify(withdrawn.history), submitted });

                for (const mode of ['block', 'restore']) for (const change of ['persona', 'history', 'avatar', 'unchanged']) {
                    const chat = seed(mode); let release, begin, sent, calls = 0;
                    const ready = new Promise(resolve => begin = resolve);
                    window.fetchAiResponse = async (_config, body) => { calls++; sent = JSON.parse(body.messages[1].content); begin(); return new Promise(resolve => release = resolve); };
                    const pending = mode === 'block' ? checkCharacterBlacklist(chat) : checkRelationshipRecovery(chat, true);
                    await ready;
                    if (change === 'persona') chat.persona = 'NEW_PERSONA';
                    if (change === 'history') chat.history[0].content = 'CHANGED_STORY';
                    if (change === 'avatar') chat.avatar = 'data:image/png;base64,fixture';
                    await saveData();
                    release(JSON.stringify({ [mode]: true }));
                    const applied = await pending, expected = change === 'avatar' || change === 'unchanged';
                    rows.push({ id: mode + '-' + change, passed: applied === expected && calls === 1 && sent.persona === 'OLD_PERSONA'
                        && chat.friendRelationship.peer.blocked === (expected ? mode === 'block' : mode === 'restore'), applied, calls });
                }
                const disabled = seed('block'); disabled.friendRelationship.autonomy.enabled = false;
                let calls = 0; window.fetchAiResponse = async () => { calls++; return '{"restore":true}'; };
                const blocked = await checkCharacterBlacklist(disabled);
                disabled.friendRelationship = { peer: { blocked: true } };
                const manual = await checkRelationshipRecovery(disabled, true);
                disabled.friendRelationship = { peer: { blocked: true }, recovery: { mode: 'timer', restoreAt: Date.now() - 1 } };
                const timer = await checkRelationshipRecovery(disabled, true);
                rows.push({ id: 'off-manual-timer', passed: !blocked && !manual && timer && calls === 0 });
                return rows;
            } finally { window.fetchAiResponse = originalFetch; window.refreshRelationshipUI = originalRefresh; }
        });
        console.log(JSON.stringify({ source: 'full local app; real filtering and saveData; synthetic provider responses', result, pageErrors: errors }, null, 2));
        assert.equal(errors.length, 0, JSON.stringify(errors));
        assert.ok(result.every(row => row.passed), JSON.stringify(result.filter(row => !row.passed)));
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
