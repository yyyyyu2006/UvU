'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const baselineRef = process.env.UVU_DRAFT_TEST_REF;
const baselineSource = baselineRef ? execFileSync('git', ['show', `${baselineRef}:js/modules/image-workshop/prompts.js`], {encoding:'utf8', cwd:path.resolve(__dirname, '..')}) : null;
const {fullApp} = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    let passed = 0;
    try {
        for (const gpt of [true, false]) {
            for (const scenario of ['failure-retry', 'pending-edit-success', 'pending-edit-failure', 'switch-away-back', 'normal-save']) {
                const {page, context, errors} = await app.page();
                try {
                    if (baselineSource !== null) {
                        await page.route('**/js/modules/image-workshop/prompts.js*', route => route.fulfill({
                            body:baselineSource,
                            contentType:'application/javascript'
                        }));
                        await page.reload({waitUntil:'domcontentloaded'});
                        await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
                    }
                    const result = await page.evaluate(async ({gpt, scenario}) => {
                        await dataPersistenceQueue;
                        const key = gpt ? 'gptLlmPresetGroups' : 'llmPresetGroups';
                        const active = gpt ? 'activeGptLlmPresetGroupId' : 'activeLlmPresetGroupId';
                        const prefix = gpt ? 'workshop-gpt-' : 'workshop-';
                        const init = gpt ? initWorkshopGPTLLMPrompts : initWorkshopLLMPrompts;
                        const settings = db.workshopSettings;
                        settings[key] = [{id:'draft-a', name:'A', prompts:[{id:'p', role:'user', title:'Original title', content:'Original content', enabled:true}]}, {id:'draft-b', name:'B', prompts:[]}];
                        settings[active] = 'draft-a';
                        init();
                        await saveData();
                        await dataPersistenceQueue;
                        // Let startup UI migrations finish before injecting storage faults.
                        await new Promise(resolve => setTimeout(resolve, 100));
                        await dataPersistenceQueue;
                        const list = document.getElementById(prefix + 'llm-prompt-list');
                        const row = list.firstElementChild;
                        row.querySelector('.edit-btn').click();
                        const title = row.querySelector('.title-input');
                        const content = row.querySelector('.content-input');
                        const role = row.querySelector('.role-select');
                        const button = row.querySelector('.save-btn');
                        title.value = ' Draft title ';
                        content.value = ' Draft content ';
                        role.value = 'assistant';
                        let release;
                        const gate = new Promise(resolve => { release = resolve; });
                        let calls = 0, saveCalls = 0, settled = false;
                        const originalSave = saveLocalSettingsFields;
                        saveLocalSettingsFields = async changes => {
                            if (changes.some(change => change.target === settings[key][0].prompts[0])) saveCalls++;
                            return originalSave(changes);
                        };
                        const original = dexieDB.transaction.bind(dexieDB);
                        dexieDB.transaction = async (...args) => {
                            if (!String(args[0]).startsWith('rw')) return original(...args);
                            calls++;
                            await gate;
                            try {
                                if (scenario.includes('failure')) throw new Error('fixture storage full');
                                return await original(...args);
                            } finally { settled = true; }
                        };
                        button.click();
                        // The second click must not enqueue another write.
                        button.click();
                        const disabledDuringSave = button.disabled;
                        if (scenario.startsWith('pending-edit')) {
                            title.value = ' Newer title ';
                            content.value = ' Newer content ';
                            role.value = 'system';
                        }
                        if (scenario === 'switch-away-back') {
                            settings[active] = 'draft-b'; init();
                            settings[active] = 'draft-a'; init();
                            const current = list.firstElementChild;
                            current.querySelector('.edit-btn').click();
                            current.querySelector('.content-input').value = 'Reopened draft';
                        }
                        release();
                        await dataPersistenceQueue;
                        // Flush saveLocalSettingsFields and the click continuation.
                        await new Promise(resolve => setTimeout(resolve, 30));
                        dexieDB.transaction = original;
                        const first = {
                            calls, saveCalls, settled, disabledDuringSave, disabledAfterSave:button.disabled,
                            sameRow:list.firstElementChild === row,
                            draft:list.querySelector('.content-input').value,
                            title:list.querySelector('.title-input').value,
                            role:list.querySelector('.role-select').value,
                            visible:list.firstElementChild.lastElementChild.style.display,
                            memory:settings[key][0].prompts[0].content,
                            disk:(await dexieDB.globalSettings.get('workshopSettings')).value[key][0].prompts[0].content
                        };
                        if (scenario === 'failure-retry' || scenario.startsWith('pending-edit')) {
                            list.querySelector('.save-btn').click();
                            await dataPersistenceQueue;
                            await new Promise(resolve => setTimeout(resolve, 30));
                            first.retry = {content:(await dexieDB.globalSettings.get('workshopSettings')).value[key][0].prompts[0].content, visible:list.firstElementChild.lastElementChild.style.display};
                        }
                        saveLocalSettingsFields = originalSave;
                        return first;
                    }, {gpt, scenario});
                    console.log(JSON.stringify({gpt, scenario, result}));
                    if (scenario === 'failure-retry') {
                        assert.equal(result.draft, ' Draft content ', 'failed save must retain the unsaved draft');
                        assert.equal(result.visible, 'block');
                    }
                    assert.equal(result.disabledDuringSave, true, 'pending save disables duplicate submission');
                    assert.equal(result.saveCalls, 1, 'one prompt save per click while pending');
                    assert.equal(result.settled, true);
                    assert.equal(result.disabledAfterSave, false, 'button is available for retry');
                    const failed = scenario.includes('failure');
                    assert.equal(result.disk, failed ? 'Original content' : 'Draft content');
                    assert.equal(result.memory, result.disk);
                    if (scenario === 'failure-retry' || scenario.startsWith('pending-edit')) {
                        const newer = scenario.startsWith('pending-edit');
                        assert.equal(result.sameRow, true, 'keep the original editor and draft');
                        assert.equal(result.visible, 'block');
                        assert.equal(result.draft, newer ? ' Newer content ' : ' Draft content ');
                        assert.equal(result.title, newer ? ' Newer title ' : ' Draft title ');
                        assert.equal(result.role, newer ? 'system' : 'assistant');
                        assert.equal(result.retry.content, newer ? 'Newer content' : 'Draft content');
                        assert.equal(result.retry.visible, 'none');
                    } else if (scenario === 'switch-away-back') {
                        assert.equal(result.draft, 'Reopened draft', 'old save cannot replace a reopened editor');
                        assert.equal(result.visible, 'block');
                    } else {
                        assert.equal(result.visible, 'none');
                        assert.equal(result.draft, 'Draft content');
                    }
                    assert.deepEqual(errors, []);
                    passed++;
                } finally { await context.close(); }
            }
        }
        console.log(`Workshop prompt drafts: ${passed} scenarios passed`);
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
