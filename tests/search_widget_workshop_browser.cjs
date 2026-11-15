'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');
const tpl = (id, extra = {}) => ({ id, name: 'Fixture ' + id, size: '2x2', html: '<div id="{{id}}">{{text}}</div>', css: '#{{id}} { color: rgb(10, 20, 30); }', js: '', defaultVars: { text: id }, ...extra });
(async () => {
    const app = await fullApp(); let passed = 0, failed = 0;
    async function check(name, run) {
        if (process.argv[2] && !name.includes(process.argv[2])) return;
        const f = await app.page();
        try {
            await f.page.evaluate(async () => {
                db.widgetTemplates = []; db.addedWidgets = []; await saveData();
                // The actual market retains its automatic built-in template initialization.
                window.onlyFixtureWidgets = items => items.filter(t => !extractedBuiltInTemplates.some(b => b.id === t.id));
                window.fixtureWidgets = () => onlyFixtureWidgets(db.widgetTemplates);
                window.fixtureStoredWidgets = async () => onlyFixtureWidgets((await dexieDB.globalSettings.get('widgetTemplates')).value);
            });
            await run(f.page); assert.deepEqual(f.errors, [], 'no uncaught browser errors'); passed++; console.log('PASS ' + name);
        } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
        finally { await f.context.close(); }
    }
    async function importJson(page, value) {
        await page.locator('#widget-import-input').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
        await page.waitForFunction(() => document.getElementById('widget-import-input').value === '' && !document.getElementById('widget-import-input').disabled);
        await page.evaluate(async () => { await saveData().catch(() => {}); });
    }
    async function setupTags(page) {
        await page.evaluate(async () => {
            db.workshopSettings.gptTags = [{ id: 'fixture-tag', name: '#旧标签#', prompt: '', enabled: true }];
            db.workshopSettings.gptTestPrompt = 'original'; await saveData();
            document.getElementById('workshop-gpt-test-prompt').value = 'original';
            window.confirm = () => true;
            initGPTTagsSystem();
        });
    }
    const diskTags = page => page.evaluate(async () => (await dexieDB.globalSettings.get('workshopSettings')).value);
    try {
        await check('actual search details render literal punctuation without errors', async page => {
            const result = await page.evaluate(() => {
                const keyword = '[a-z]+', content = 'literal ' + keyword + ' only';
                SearchSystem.open(); SearchSystem.renderDetail({ name: 'Fixture', count: 1, chatType: 'private', messages: [{ role: 'assistant', content, timestamp: 1 }] }, keyword);
                return { text: document.querySelector('.search-result-content').textContent, highlights: [...document.querySelectorAll('.keyword-highlight')].map(e => e.textContent) };
            });
            assert.deepEqual(result, { text: 'literal [a-z]+ only', highlights: ['[a-z]+'] });
        });
        await check('XML help shows six literal labels without changing prompt settings', async page => {
            const result = await page.evaluate(() => {
                const before = JSON.stringify({ presets: db.cotPresets, settings: db.cotSettings });
                initXmlHelpFeature(); openXmlHelpModal();
                return { labels: [...document.querySelectorAll('#cot-xml-help-modal code')].map(e => e.textContent), before, after: JSON.stringify({ presets: db.cotPresets, settings: db.cotSettings }) };
            });
            assert.deepEqual(result.labels, ['<char_settings>', '<user_settings>', '<logic_rules>', '<output_formats>', '<Chatting Guidelines>', '<thinking>']);
            assert.equal(result.after, result.before);
        });
        await check('actual exported widget batch can be imported unchanged', async page => {
            const widgets = [tpl('one'), tpl('two')];
            await page.evaluate(widgets => { db.widgetTemplates = widgets; }, widgets);
            const downloadEvent = page.waitForEvent('download'); await page.evaluate(() => exportWidgets(db.widgetTemplates));
            const download = await downloadEvent, stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
            const exported = Buffer.concat(chunks).toString('utf8'); assert.deepEqual(JSON.parse(exported), widgets);
            await page.evaluate(async () => { db.widgetTemplates = []; await saveData(); });
            await importJson(page, exported);
            assert.deepEqual(await page.evaluate(() => fixtureWidgets()), widgets);
            assert.deepEqual(await page.evaluate(() => fixtureStoredWidgets()), widgets);
        });
        await check('legacy single widget with empty CSS and missing optional fields imports', async page => {
            const old = { id: 'legacy', name: 'Legacy', html: '<div>legacy</div>', css: '' };
            await importJson(page, old);
            const actual = await page.evaluate(() => fixtureWidgets()[0]);
            assert.deepEqual(actual, { ...old, js: '', defaultVars: {}, size: '2x2' });
        });
        await check('malformed or partly invalid batches leave all stored widgets unchanged', async page => {
            const existing = tpl('existing');
            await page.evaluate(async existing => { db.widgetTemplates = [existing]; await saveData(); }, existing);
            for (const invalid of ['{broken', [tpl('new'), { id: 'bad' }], [tpl('dup'), tpl('dup')]]) {
                await importJson(page, invalid);
                assert.deepEqual(await page.evaluate(() => fixtureWidgets()), [existing]);
                assert.deepEqual(await page.evaluate(() => fixtureStoredWidgets()), [existing]);
            }
        });
        await check('canceling duplicate replacement cancels the complete batch', async page => {
            const existing = tpl('existing');
            await page.evaluate(async existing => { db.widgetTemplates = [existing]; await saveData(); window.confirm = () => false; }, existing);
            await importJson(page, [tpl('new'), tpl('existing', { name: 'replacement' })]);
            assert.deepEqual(await page.evaluate(() => fixtureWidgets()), [existing]);
        });
        await check('duplicate replacement refreshes preview and global styles with the original CSS', async page => {
            await importJson(page, tpl('same'));
            const next = tpl('same', { css: '#{{id}} { color: rgb(40, 50, 60); }', name: 'replacement' });
            await page.evaluate(() => { window.confirm = () => true; }); await importJson(page, next);
            assert.deepEqual(await page.evaluate(() => fixtureWidgets()), [next]);
            for (const id of ['preview-style-same', 'custom-widget-style-same']) assert.equal(await page.locator('#' + id).textContent(), '#same { color: rgb(40, 50, 60); }');
        });
        await check('widget save failure restores memory and does not inject new styles', async page => {
            const existing = tpl('existing');
            await page.evaluate(async existing => {
                db.widgetTemplates = [existing]; await saveData(); window.confirm = () => true;
                window.failWidgetSave = () => { throw Error('fixture failed write'); }; dexieDB.globalSettings.hook('updating', failWidgetSave);
            }, existing);
            try { await importJson(page, [tpl('new'), tpl('existing', { name: 'unsaved' })]); }
            finally { await page.evaluate(() => dexieDB.globalSettings.hook('updating').unsubscribe(failWidgetSave)); }
            assert.deepEqual(await page.evaluate(() => fixtureWidgets()), [existing]);
            assert.deepEqual(await page.evaluate(() => fixtureStoredWidgets()), [existing]);
            assert.equal(await page.locator('#custom-widget-style-new').count(), 0);
        });
        for (const outcome of ['error', 'abort']) await check('file read ' + outcome + ' unlocks the import input without changing data', async page => {
            await page.evaluate(outcome => {
                window.originalFixtureReader = window.FileReader;
                window.FileReader = class { readAsText() { queueMicrotask(() => this[outcome === 'error' ? 'onerror' : 'onabort']()); } };
            }, outcome);
            try { await importJson(page, tpl('failed-read')); }
            finally { await page.evaluate(() => { window.FileReader = originalFixtureReader; }); }
            assert.deepEqual(await page.evaluate(() => fixtureWidgets()), []);
            assert.equal(await page.locator('#widget-import-input').isEnabled(), true);
            await importJson(page, tpl('retry')); assert.equal(await page.evaluate(() => fixtureWidgets()[0].id), 'retry');
        });
        await check('a repeated change during file reading does not start a second import', async page => {
            await page.evaluate(() => {
                window.originalFixtureReader = window.FileReader; window.fixtureReadCount = 0;
                window.FileReader = class { readAsText(file) { fixtureReadCount++; window.releaseWidgetRead = async () => { this.result = await file.text(); this.onload(); }; } };
            });
            try {
                await page.locator('#widget-import-input').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([tpl('one'), tpl('two')])) });
                await page.evaluate(() => document.getElementById('widget-import-input').dispatchEvent(new Event('change')));
                assert.equal(await page.evaluate(() => fixtureReadCount), 1);
                assert.equal(await page.locator('#widget-import-input').isEnabled(), false);
                await page.evaluate(() => releaseWidgetRead());
                await page.waitForFunction(() => !document.getElementById('widget-import-input').disabled);
                assert.deepEqual(await page.evaluate(() => fixtureWidgets().map(t => t.id)), ['one', 'two']);
            } finally { await page.evaluate(() => { window.FileReader = originalFixtureReader; }); }
        });
        await check('an old file read cannot import into a replaced database object', async page => {
            await page.evaluate(() => {
                window.originalFixtureReader = window.FileReader;
                window.FileReader = class { readAsText(file) { window.releaseWidgetRead = async () => { this.result = await file.text(); this.onload(); }; } };
            });
            try {
                await page.locator('#widget-import-input').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tpl('old-read'))) });
                await page.evaluate(async () => { db = { ...db, widgetTemplates: [] }; await releaseWidgetRead(); });
                await page.waitForFunction(() => !document.getElementById('widget-import-input').disabled);
                assert.deepEqual(await page.evaluate(() => fixtureWidgets()), []);
            } finally { await page.evaluate(() => { window.FileReader = originalFixtureReader; }); }
        });
        await check('quick tag click is saved and still present after page reload', async page => {
            await setupTags(page);
            await page.evaluate(() => document.querySelector('#workshop-gpt-test-tags-container button').click());
            await page.evaluate(async () => { await Promise.resolve(); await saveData(); });
            assert.equal((await diskTags(page)).gptTestPrompt, 'original #旧标签#');
            await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
            assert.equal(await page.evaluate(() => db.workshopSettings.gptTestPrompt), 'original #旧标签#');
        });
        await check('renaming a tag immediately refreshes its test button', async page => {
            await setupTags(page);
            await page.evaluate(() => { const input = document.querySelector('#workshop-gpt-tags-list .tag-name-input'); input.value = '#新名字#'; input.dispatchEvent(new Event('change')); });
            await page.evaluate(async () => { await Promise.resolve(); await saveData(); });
            assert.equal(await page.locator('#workshop-gpt-test-tags-container button').textContent(), '#新名字#');
            await page.evaluate(() => document.querySelector('#workshop-gpt-test-tags-container button').click());
            await page.evaluate(async () => { await Promise.resolve(); await saveData(); });
            assert.equal((await diskTags(page)).gptTestPrompt, 'original #新名字#');
        });
        await check('deleting the last tag clears its old test button', async page => {
            await setupTags(page);
            await page.evaluate(() => document.querySelector('#workshop-gpt-tags-list .remove-tag-btn').click());
            await page.evaluate(async () => { await Promise.resolve(); await saveData(); });
            assert.equal(await page.locator('#workshop-gpt-test-tags-container button').count(), 0);
            assert.deepEqual((await diskTags(page)).gptTags, []);
        });
        await check('quick tag save failure restores the previous prompt', async page => {
            await setupTags(page);
            const result = await page.evaluate(async () => {
                const fail = () => { throw Error('fixture write failed'); }; dexieDB.globalSettings.hook('updating', fail);
                try { document.querySelector('#workshop-gpt-test-tags-container button').click(); await Promise.resolve(); await saveData().catch(() => {}); }
                finally { dexieDB.globalSettings.hook('updating').unsubscribe(fail); }
                return { memory: db.workshopSettings.gptTestPrompt, input: document.getElementById('workshop-gpt-test-prompt').value };
            });
            assert.deepEqual(result, { memory: 'original', input: 'original' });
        });
        await check('tag rename save failure keeps the old button label and stored name', async page => {
            await setupTags(page);
            const result = await page.evaluate(async () => {
                const fail = () => { throw Error('fixture rename failed'); }; dexieDB.globalSettings.hook('updating', fail);
                try {
                    const input = document.querySelector('#workshop-gpt-tags-list .tag-name-input'); input.value = '#unsaved#'; input.dispatchEvent(new Event('change'));
                    await Promise.resolve(); await saveData().catch(() => {});
                    return { input: input.value, button: document.querySelector('#workshop-gpt-test-tags-container button').textContent, name: db.workshopSettings.gptTags[0].name };
                } finally { dexieDB.globalSettings.hook('updating').unsubscribe(fail); }
            });
            assert.deepEqual(result, { input: '#旧标签#', button: '#旧标签#', name: '#旧标签#' });
        });
        await check('tag deletion save failure restores its test button', async page => {
            await setupTags(page);
            const result = await page.evaluate(async () => {
                const fail = () => { throw Error('fixture delete failed'); }; dexieDB.globalSettings.hook('updating', fail);
                try { document.querySelector('#workshop-gpt-tags-list .remove-tag-btn').click(); await Promise.resolve(); await saveData().catch(() => {}); }
                finally { dexieDB.globalSettings.hook('updating').unsubscribe(fail); }
                return { count: db.workshopSettings.gptTags.length, button: document.querySelector('#workshop-gpt-test-tags-container button')?.textContent };
            });
            assert.deepEqual(result, { count: 1, button: '#旧标签#' });
        });
        await check('disabled tags disappear from test buttons without changing saved prompt text', async page => {
            await setupTags(page);
            await page.evaluate(() => { const input = document.querySelector('#workshop-gpt-tags-list .tag-enable-toggle'); input.checked = false; input.dispatchEvent(new Event('change')); });
            await page.evaluate(async () => { await Promise.resolve(); await saveData(); });
            assert.equal(await page.locator('#workshop-gpt-test-tags-container button').count(), 0);
            const stored = await diskTags(page); assert.equal(stored.gptTags[0].enabled, false); assert.equal(stored.gptTestPrompt, 'original');
        });
    } finally { await app.close(); }
    console.log(JSON.stringify({ passed, failed })); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
