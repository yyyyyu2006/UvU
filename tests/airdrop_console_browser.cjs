'use strict';
const assert = require('node:assert/strict');
const { fullApp, stableUI } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(); let passed = 0, failed = 0;
    async function check(name, run) {
        const f = await app.page();
        try {
            await f.page.evaluate(async () => {
                db.characters = ['a', 'b'].map(id => ({ id, realName: id.toUpperCase(), remarkName: id.toUpperCase(), myName: '我', persona: '', avatar: '',
                    activeArchiveId: 'one', archives: [{ id: 'one' }, { id: 'two' }], history: [{ id: 'm', role: 'assistant', content: '图片', timestamp: 1 }],
                    maxMemory: 20, memoryJournals: [], worldBookIds: [], theme: 'blue', status: '在线' }));
                db.workshopSettings = { rateLimit: 0 }; await saveData(); openChatRoom('a', 'private');
                generateTagsFromDescription = async () => 'fixture tags';
                generateImageFromTags = () => new Promise((resolve, reject) => { window.finishImage = resolve; window.failImage = reject; window.imageCalls = (window.imageCalls || 0) + 1; });
                window.photoFixture = id => ({ id, charId: 'a', archiveId: 'one', messageId: 'm', timestamp: 1, image: 'AA==', prompt: 'fixture tags' });
                window.modalState = () => ({ visible: document.getElementById('airdrop-modal').classList.contains('visible'),
                    subtitle: document.getElementById('airdrop-subtitle').textContent,
                    loading: document.getElementById('airdrop-loading').style.display,
                    result: document.getElementById('airdrop-result-area').style.display,
                    error: document.getElementById('airdrop-error').style.display });
            });
            await run(f.page); assert.deepEqual(f.errors, [], 'no uncaught browser errors');
            passed++; console.log('PASS ' + name);
        } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
        finally { await f.context.close(); }
    }
    const startReceive = page => page.evaluate(async () => { await receiveAirDropPhoto('m'); window.pendingPhoto = document.getElementById('airdrop-accept-btn').onclick(); });
    const startPreview = page => page.evaluate(async () => { const p = photoFixture(); p.id = await dexieDB.characterPhotos.add(p); showAirDropPreview(p, db.characters[0]); window.pendingPhoto = document.getElementById('airdrop-regenerate-btn').onclick(); });
    try {
        await check('visible loading pill expands and the header collapses with flex loading', async page => {
            await startReceive(page); await stableUI(page, '#airdrop-loading');
            await page.locator('#airdrop-loading').click();
            assert.equal(await page.locator('#airdrop-window').evaluate(el => el.classList.contains('collapsed')), false);
            await page.locator('#airdrop-header').click();
            assert.equal(await page.locator('#airdrop-window').evaluate(el => el.classList.contains('collapsed')), true);
            await page.evaluate(async () => { failImage(Error('fixture')); await pendingPhoto; });
        });
        for (const stage of ['receive', 'regenerate']) for (const outcome of ['success', 'failure']) {
            await check(stage + ' late ' + outcome + ' leaves the new B modal unchanged', async page => {
                await (stage === 'receive' ? startReceive(page) : startPreview(page));
                await page.evaluate(async () => { openChatRoom('b', 'private'); await receiveAirDropPhoto('m'); });
                const before = await page.evaluate(() => modalState());
                await page.evaluate(async outcome => { outcome === 'success' ? finishImage('AQ==') : failImage(Error('fixture failed')); await pendingPhoto; }, outcome);
                assert.deepEqual(await page.evaluate(() => modalState()), before);
                if (outcome === 'success') assert.equal(await page.evaluate(() => dexieDB.characterPhotos.where('charId').equals('a').count()), stage === 'receive' ? 1 : 2);
            });
        }
        await check('reopening the same character on another archive keeps the new modal', async page => {
            await startReceive(page);
            await page.evaluate(async () => { db.characters[0].activeArchiveId = 'two'; await receiveAirDropPhoto('m'); });
            const before = await page.evaluate(() => modalState());
            await page.evaluate(async () => { finishImage('AQ=='); await pendingPhoto; });
            assert.deepEqual(await page.evaluate(() => modalState()), before);
            assert.equal(await page.evaluate(async () => (await dexieDB.characterPhotos.toArray())[0].archiveId), 'one');
        });
        await check('closed task stays closed and duplicate accept does not generate twice', async page => {
            await startReceive(page);
            await page.evaluate(() => { window.duplicatePhoto = document.getElementById('airdrop-accept-btn').onclick(); });
            assert.equal(await page.evaluate(() => window.imageCalls), 1);
            await page.evaluate(async () => { document.getElementById('airdrop-close-btn').onclick(); finishImage('AQ=='); await Promise.all([pendingPhoto, duplicatePhoto]); });
            assert.equal(await page.evaluate(() => modalState().visible), false);
        });
        await check('duplicate regenerate click starts one generation', async page => {
            await startPreview(page);
            await page.evaluate(() => { window.duplicatePhoto = document.getElementById('airdrop-regenerate-btn').onclick(); });
            assert.equal(await page.evaluate(() => imageCalls), 1);
            await page.evaluate(async () => { finishImage('AQ=='); await Promise.all([pendingPhoto, duplicatePhoto]); });
        });
        await check('preview uses the exact saved photo even if an unrelated newer one exists', async page => {
            await startReceive(page);
            await page.evaluate(async () => { await dexieDB.characterPhotos.add({ charId: 'a', timestamp: Date.now() + 100000, image: 'UNRELATED' }); finishImage('AQ=='); await pendingPhoto; });
            assert.equal(await page.locator('#airdrop-preview-img').getAttribute('src'), 'data:image/png;base64,AQ==');
        });
        await check('new receive clears the previous result without changing panel styles', async page => {
            await page.evaluate(async () => { showAirDropPreview(photoFixture(1), db.characters[0]); await receiveAirDropPhoto('m'); });
            assert.equal(await page.evaluate(() => modalState().result), 'none');
            assert.equal(await page.locator('#airdrop-actions').evaluate(el => el.style.display), 'flex');
        });
        await check('failed prompt save keeps the editor open and old prompt intact', async page => {
            const result = await page.evaluate(async () => {
                const p = photoFixture(); p.id = await dexieDB.characterPhotos.add(p); showAirDropPreview(p, db.characters[0]); document.getElementById('airdrop-details-btn').click();
                document.getElementById('airdrop-prompt-textarea').value = 'new prompt';
                const fail = () => { throw Error('fixture write failed'); }; dexieDB.characterPhotos.hook('updating', fail);
                let rejected = false;
                try { await document.getElementById('airdrop-prompt-save-btn').onclick(); } catch (_) { rejected = true; }
                finally { dexieDB.characterPhotos.hook('updating').unsubscribe(fail); }
                return { rejected, prompt: p.prompt, visible: document.getElementById('airdrop-details-modal').classList.contains('visible'), stored: (await dexieDB.characterPhotos.get(p.id)).prompt };
            });
            assert.deepEqual(result, { rejected: false, prompt: 'fixture tags', visible: true, stored: 'fixture tags' });
        });
        await check('late prompt save cannot close a newer photo editor', async page => {
            const result = await page.evaluate(async () => {
                const first = photoFixture(), second = { ...photoFixture(), charId: 'b', prompt: 'B prompt' };
                first.id = await dexieDB.characterPhotos.add(first); second.id = await dexieDB.characterPhotos.add(second);
                showAirDropPreview(first, db.characters[0]); document.getElementById('airdrop-details-btn').click(); document.getElementById('airdrop-prompt-textarea').value = 'A changed';
                const original = dexieDB.characterPhotos.update;
                let release; dexieDB.characterPhotos.update = function(...args) { return new Promise(resolve => { release = () => resolve(original.apply(this, args)); }); };
                try {
                    const pending = document.getElementById('airdrop-prompt-save-btn').onclick();
                    openChatRoom('b', 'private'); showAirDropPreview(second, db.characters[1]); document.getElementById('airdrop-details-btn').click();
                    release(); await pending;
                    return { visible: document.getElementById('airdrop-details-modal').classList.contains('visible'), text: document.getElementById('airdrop-prompt-textarea').value,
                        saved: (await dexieDB.characterPhotos.get(first.id)).prompt };
                } finally { dexieDB.characterPhotos.update = original; }
            });
            assert.deepEqual(result, { visible: true, text: 'B prompt', saved: 'A changed' });
        });
        await check('delayed A history cannot replace the newly opened B gallery', async page => {
            const result = await page.evaluate(async () => {
                await dexieDB.characterPhotos.add({ ...photoFixture(), image: 'OLD_A' });
                const table = dexieDB.characterPhotos, original = table.where; let release;
                table.where = function(...args) { const query = original.apply(this, args), equals = query.equals; query.equals = function(value) {
                    const collection = equals.call(this, value), sort = collection.sortBy;
                    if (value === 'a') collection.sortBy = function(...sortArgs) { return new Promise(resolve => { release = () => resolve(sort.apply(this, sortArgs)); }); };
                    return collection;
                }; return query; };
                try {
                    const pending = openAirDropHistory('a'); openChatRoom('b', 'private'); await openAirDropHistory('b'); const before = document.getElementById('airdrop-history-grid').innerHTML;
                    release(); await pending; return { before, after: document.getElementById('airdrop-history-grid').innerHTML };
                } finally { table.where = original; }
            });
            assert.equal(result.after, result.before); assert.match(result.after, /相册空空如也/);
        });
        await check('failed gallery deletion keeps the photo and re-enables its button', async page => {
            const result = await page.evaluate(async () => {
                const id = await dexieDB.characterPhotos.add(photoFixture()); await openAirDropHistory('a'); const button = document.querySelector('#airdrop-history-grid button');
                const original = window.confirm; window.confirm = () => true;
                const fail = () => { throw Error('fixture delete failed'); }; dexieDB.characterPhotos.hook('deleting', fail);
                try { await button.onclick({ stopPropagation() {} }); return { count: await dexieDB.characterPhotos.count(), disabled: button.disabled, connected: button.isConnected }; }
                finally { dexieDB.characterPhotos.hook('deleting').unsubscribe(fail); window.confirm = original; }
            });
            assert.deepEqual(result, { count: 1, disabled: false, connected: true });
        });
        await check('deleted character cancels saving a late generation', async page => {
            await startReceive(page);
            await page.evaluate(async () => { db.characters.shift(); finishImage('AQ=='); await pendingPhoto; });
            assert.equal(await page.evaluate(() => dexieDB.characterPhotos.count()), 0);
            assert.equal(await page.evaluate(() => modalState().visible), false);
        });
        await check('archive switch without a new modal hides the old result and keeps photo ownership', async page => {
            await startReceive(page);
            await page.evaluate(async () => { db.characters[0].activeArchiveId = 'two'; finishImage('AQ=='); await pendingPhoto; });
            assert.equal(await page.evaluate(() => modalState().visible), false);
            assert.equal(await page.evaluate(async () => (await dexieDB.characterPhotos.toArray())[0].archiveId), 'one');
        });
        await check('regeneration error uses the current close handler', async page => {
            await startPreview(page);
            await page.evaluate(async () => { failImage(Error('fixture failed')); await pendingPhoto; });
            assert.equal(await page.evaluate(() => modalState().error), 'block');
            await page.locator('#airdrop-close-btn').click();
            assert.equal(await page.evaluate(() => modalState().visible), false);
        });
        await check('failed cooldown save still previews the photo which was already stored', async page => {
            await startReceive(page);
            const result = await page.evaluate(async () => {
                const fail = () => { throw Error('fixture cooldown failure'); }; dexieDB.globalSettings.hook('updating', fail);
                try { finishImage('AQ=='); await pendingPhoto; return { count: await dexieDB.characterPhotos.count(), state: modalState(), time: db.workshopSettings.lastGenerationTime ?? null }; }
                finally { dexieDB.globalSettings.hook('updating').unsubscribe(fail); }
            });
            assert.equal(result.count, 1); assert.equal(result.state.result, 'flex'); assert.equal(result.state.error, 'none'); assert.equal(result.time, null);
        });
        await check('tag stage finishing in B cannot change B loading text', async page => {
            await page.evaluate(async () => { generateTagsFromDescription = () => new Promise(resolve => { window.finishTags = resolve; });
                await receiveAirDropPhoto('m'); window.pendingPhoto = document.getElementById('airdrop-accept-btn').onclick(); openChatRoom('b', 'private'); await receiveAirDropPhoto('m');
                document.getElementById('airdrop-loading-text').textContent = 'B sentinel'; finishTags('tags'); });
            await page.waitForFunction(() => window.finishImage);
            assert.equal(await page.locator('#airdrop-loading-text').textContent(), 'B sentinel');
            await page.evaluate(async () => { finishImage('AQ=='); await pendingPhoto; });
        });
        await check('deleted photo cannot be resurrected by saving its prompt', async page => {
            const result = await page.evaluate(async () => {
                const p = photoFixture(); p.id = await dexieDB.characterPhotos.add(p); showAirDropPreview(p, db.characters[0]); document.getElementById('airdrop-details-btn').click();
                await dexieDB.characterPhotos.delete(p.id); document.getElementById('airdrop-prompt-textarea').value = 'changed'; await document.getElementById('airdrop-prompt-save-btn').onclick();
                return { count: await dexieDB.characterPhotos.count(), prompt: p.prompt, visible: document.getElementById('airdrop-details-modal').classList.contains('visible') };
            });
            assert.deepEqual(result, { count: 0, prompt: 'fixture tags', visible: true });
        });
        await check('delayed expansion-panel album load cannot open A preview over B', async page => {
            const result = await page.evaluate(async () => {
                await dexieDB.characterPhotos.add(photoFixture());
                const table = dexieDB.characterPhotos, original = table.where; let release;
                table.where = function(...args) { const query = original.apply(this, args), equals = query.equals; query.equals = function(value) {
                    const collection = equals.call(this, value), sort = collection.sortBy;
                    collection.sortBy = function(...sortArgs) { return new Promise(resolve => { release = () => resolve(sort.apply(this, sortArgs)); }); };
                    return collection;
                }; return query; };
                try {
                    document.getElementById('airdrop-panel-btn').click(); openChatRoom('b', 'private'); await receiveAirDropPhoto('m'); const before = modalState(); release();
                    await new Promise(resolve => setTimeout(resolve, 100)); return { before, after: modalState() };
                } finally { table.where = original; }
            });
            assert.deepEqual(result.after, result.before);
        });
        await check('log filter copies the displayed warning or error rather than an info row', async page => {
            await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedLog = text; } } });
                clearConsoleLogs(); console.log('INFO_SENTINEL'); console.error('ERROR_SENTINEL'); console.warn('WARN_SENTINEL'); switchScreen('console-screen'); });
            await page.locator('.console-filter-btn[data-filter="error"]').click();
            await page.locator('.console-log-item').first().locator('.console-item-copy-btn').click();
            assert.match(await page.evaluate(() => copiedLog), /ERROR_SENTINEL$/);
            await page.locator('.console-log-item').last().locator('.console-item-copy-btn').click();
            assert.match(await page.evaluate(() => copiedLog), /WARN_SENTINEL$/);
            await page.evaluate(() => { for (let i = 0; i < 55; i++) console.log('filler' + i); console.error('NEW_ERROR'); });
            await page.locator('.console-log-item').last().locator('.console-item-copy-btn').click();
            assert.match(await page.evaluate(() => copiedLog), /NEW_ERROR$/);
        });
    } finally { await app.close(); }
    console.log(JSON.stringify({ passed, failed })); process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
