const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('C:/Users/15271130817/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.join(__dirname, '..');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('https://editor.test/**', route => route.fulfill({ contentType: 'text/html', body: '<textarea id=setting-char-persona></textarea>' }));
        await page.goto('https://editor.test/');
        await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'css/modules/document_features.css'), 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/modules/text_editor.js'), 'utf8') });
        await page.evaluate(() => {
            window.showToast = () => {}; window.confirm = () => true;
            window.searchEvents = [];
            const realSearch = findEditorMatchesAsync;
            window.findEditorMatchesAsync = (...args) => {
                const record = { query: args[1], done: false, aborted: false }; searchEvents.push(record);
                return realSearch(...args).then(result => { record.done = true; return result; }, error => { record.aborted = error.name === 'AbortError'; throw error; });
            };
            window.startEditor = value => { const target = document.getElementById('setting-char-persona'); target.value = value; openExpandedEditor(target); };
            window.searchFor = query => { const find = document.querySelector('.editor-find'); find.value = query; find.dispatchEvent(new Event('input', { bubbles: true })); };
            window.clickAction = action => document.querySelector('[data-action=' + action + ']').click();
            startEditor('a'.repeat(250000) + 'needle');
            searchFor('a'); document.querySelector('.editor-replace').value = 'BAD'; clickAction('replaceAll');
        });
        assert.equal(await page.locator('.editor-count').textContent(), '查找中…');
        assert.equal((await page.locator('.editor-draft').inputValue()).length, 250006, 'replace-all cannot apply partial results');
        await page.evaluate(() => {
            window.heartbeats = 0; window.pulse = setInterval(() => heartbeats++, 0);
            setTimeout(() => searchFor('needle'), 20);
        });
        await page.waitForFunction(() => document.querySelector('.editor-count').textContent === '0 / 1');
        assert.ok(await page.evaluate(() => heartbeats > 2), 'long find gives the event loop opportunities to run');
        assert.equal((await page.locator('.editor-draft').inputValue()).length, 250006, 'stale queued replace-all is discarded after query change');
        assert.ok(await page.evaluate(() => searchEvents.some(record => record.query === 'a' && record.aborted)), 'query changes cancel the real running scan');
        await page.locator('[data-action=next]').click();
        assert.equal(await page.locator('.editor-draft').evaluate(t => t.value.slice(t.selectionStart, t.selectionEnd)), 'needle');
        await page.evaluate(() => {
            searchFor('a'); clickAction('replaceAll');
            setTimeout(() => { const draft = document.querySelector('.editor-draft'); draft.value = 'b'.repeat(75000) + 'needle'; draft.dispatchEvent(new Event('input', { bubbles: true })); searchFor('needle'); }, 20);
        });
        await page.waitForFunction(() => document.querySelector('.editor-draft').value.startsWith('b') && document.querySelector('.editor-count').textContent === '0 / 1');
        assert.equal(await page.locator('.editor-draft').inputValue(), 'b'.repeat(75000) + 'needle', 'draft edits invalidate the queued replacement');
        await page.evaluate(() => {
            const draft = document.querySelector('.editor-draft'); draft.value = 'a'.repeat(250000); draft.dispatchEvent(new Event('input', { bubbles: true }));
            searchFor('a'); clickAction('next');
            window.lastStatus = document.querySelector('.editor-count');
            setTimeout(() => clickAction('keepDraft'), 20);
        });
        await page.waitForFunction(() => !document.querySelector('#expanded-text-editor'));
        await page.waitForFunction(() => searchEvents.filter(record => record.query === 'a' && record.aborted).length >= 3);
        assert.equal(await page.evaluate(() => lastStatus.textContent), '查找中…', 'closed editor receives no late results');
        assert.equal((await page.locator('#setting-char-persona').inputValue()).length, 250006, 'search and close never apply draft into the source');
        await page.evaluate(() => {
            clearInterval(pulse); expandedEditorStates.clear();
            startEditor('x'.repeat(32767) + '😀Kſ' + 'x'.repeat(33000) + '😀kS');
            searchFor('😀kS'); clickAction('previous');
        });
        await page.waitForFunction(() => document.querySelector('.editor-count').textContent === '2 / 2');
        assert.equal(await page.locator('.editor-draft').evaluate(t => t.selectionStart), 65771, 'previous finds last Unicode-folded match across slices');
        await page.evaluate(() => { document.querySelector('.editor-replace').value = '$&'; clickAction('replaceAll'); });
        await page.waitForFunction(() => document.querySelector('.editor-count').textContent === '0 / 0');
        assert.equal(await page.locator('.editor-draft').inputValue(), 'x'.repeat(32767) + '$&' + 'x'.repeat(33000) + '$&', 'all complete matches are replaced literally');
        await page.locator('[data-action=undo]').click();
        await page.waitForFunction(() => document.querySelector('.editor-count').textContent === '0 / 2');
        await page.locator('[data-action=cancel]').click();
        assert.equal(await page.locator('#expanded-text-editor').count(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS: Chrome long-find cooperation; stale query/body cancellation; pending replace-all; close; Unicode previous/replace-all/undo; no page errors');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
