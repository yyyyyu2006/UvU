const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { fullApp, root } = require('./helpers/full_app_browser.cjs');

// Isolated full application, actual IndexedDB font Blob, FileReader and saveData.
(async () => {
    const app = await fullApp();
    const ref = process.argv.find(arg => arg.startsWith('--source-ref='))?.slice(13);
    const output = process.env.UVU_SNAPSHOT_REPORT;
    const results = [];
    let replacements = 0;
    try {
        for (const stage of ['lookup', 'reader']) for (const replaceDatabase of [false, true]) {
            const { page, context, errors } = await app.page();
            if (ref) {
                const source = cp.execFileSync('git', ['show', `${ref}:js/modules/home_presets.js`], { cwd: root, encoding: 'utf8' });
                await page.route('**/js/modules/home_presets.js*', route => { replacements++; return route.fulfill({ body: source, contentType: 'application/javascript' }); });
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
            }
            const result = await page.evaluate(async ({ stage, replaceDatabase }) => {
                const signature = 'snapshot home', css = '/* snapshot CSS */';
                db.homeSignature = signature; db.homeLayoutPages = [['app-customize', 'snapshot-widget']];
                db.addedWidgets = [{ id: 'snapshot-widget', templateId: 'snapshot-template', vars: { caption: 'old instance' } }];
                db.widgetTemplates = [{ id: 'snapshot-template', name: 'snapshot', size: '1x1', html: '<div>{{caption}}</div>', css: '', js: '', defaultVars: { caption: 'old default' } }];
                db.fontUrl = 'CustomFont_snapshot'; db.fontSizeScale = 1; db.globalCss = css;
                db.fontPresets = [{ id: 'snapshot-font', fontFamily: db.fontUrl, isCustom: true }];
                await dexieDB.customFonts.put({ id: 'snapshot-font', file: new Blob(['snapshot font'], { type: 'font/woff2' }) });
                await saveData();
                const originalGet = dexieDB.customFonts.get, originalRead = FileReader.prototype.readAsDataURL;
                let start, release;
                const ready = new Promise(resolve => { start = resolve; }), gate = new Promise(resolve => { release = resolve; });
                if (stage === 'lookup') dexieDB.customFonts.get = async function (...args) {
                    const record = await originalGet.apply(this, args); start(); await gate; return record;
                };
                else FileReader.prototype.readAsDataURL = function (file) {
                    start(); gate.then(() => originalRead.call(this, file));
                };
                try {
                    const pending = HomePresets.createPreset('snapshot', true); await ready;
                    db.homeSignature = 'new home'; db.fontSizeScale = 1.3; db.globalCss = '/* new CSS */';
                    db.addedWidgets[0].vars.caption = 'new instance';
                    db.widgetTemplates[0].defaultVars.caption = 'new default';
                    db.widgetTemplates[0].html = '<div>new template</div>';
                    if (replaceDatabase) db = JSON.parse(JSON.stringify(db));
                    await saveData(); release();
                    const preset = await pending;
                    return { home: preset.settings.homeSignature, css: preset.settings.appearance.globalCss,
                        scale: preset.settings.appearance.fontSizeScale, instance: preset.settings.addedWidgets[0].vars.caption,
                        template: preset.settings.widgetTemplates[0].html, defaults: preset.settings.widgetTemplates[0].defaultVars.caption,
                        font: preset.settings.appearance.fontUrl, liveHome: db.homeSignature,
                        roundTrip: JSON.stringify(HomePresets.validate(JSON.parse(JSON.stringify(preset))).settings) === JSON.stringify(preset.settings) };
                } finally { dexieDB.customFonts.get = originalGet; FileReader.prototype.readAsDataURL = originalRead; }
            }, { stage, replaceDatabase });
            const passed = result.home === 'snapshot home' && result.css === '/* snapshot CSS */' && result.scale === 1 &&
                result.instance === 'old instance' && result.template === '<div>{{caption}}</div>' && result.defaults === 'old default' &&
                result.font === 'data:font/woff2;base64,c25hcHNob3QgZm9udA==' && result.liveHome === 'new home' && result.roundTrip && errors.length === 0;
            results.push({ stage, replaceDatabase, passed, result, pageErrors: errors });
            await context.close();
        }
        if (!ref) {
            const { page, context, errors } = await app.page();
            const downloadPromise = page.waitForEvent('download');
            await page.evaluate(() => {
                db.homeLayoutPages = [['app-customize']]; db.addedWidgets = []; db.widgetTemplates = [];
                db.fontUrl = ''; db.fontSizeScale = 1.1; db.globalCss = '/* download */';
                setupHomePresets();
                document.getElementById('home-preset-name').value = 'snapshot-download';
                document.getElementById('home-preset-include-appearance').checked = true;
                document.getElementById('home-preset-export-btn').click();
            });
            const download = await downloadPromise;
            const preset = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
            assert.equal(preset.name, 'snapshot-download');
            assert.equal(preset.settings.appearance.fontSizeScale, 1.1);
            assert.equal(preset.settings.appearance.globalCss, '/* download */');
            assert.equal(await page.locator('#home-preset-export-btn').isEnabled(), true);
            results.push({ stage: 'export button JSON download', passed: errors.length === 0, pageErrors: errors });
            await context.close();
        }
        if (ref) assert.equal(replacements, 4, 'all four cases must execute requested source');
        if (output) fs.writeFileSync(path.resolve(output), JSON.stringify({ ref: ref || 'working tree', replacements, results }, null, 2) + '\n');
        console.log(JSON.stringify({ ref, replacements, passed: results.filter(r => r.passed).length, total: results.length, results }, null, 2));
        assert.ok(results.every(r => r.passed), 'export must contain only initial settings');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
