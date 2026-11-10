// Actual derived speech settings, local response fixtures; no paid API calls.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = html.indexOf('<div class="kkt-group minimax-tts-settings"');
const panel = html.slice(start, html.indexOf('<!-- 预设管理 -->', start));
const output = path.join(root, 'outputs/speech-refinement'); fs.mkdirSync(output, { recursive: true });
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        for (const width of [320, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 844 } }), errors = [], calls = [];
            page.setDefaultTimeout(7000); page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', route => {
                const url = route.request().url();
                if (url === 'https://speech-ui.test/') return route.fulfill({ contentType: 'text/html', body: '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui;background:#f6f7f9}button,input,textarea,select{font:inherit}button{cursor:pointer}</style>' + panel });
                if (/\/get_voice(?:\?|$)/.test(url)) { calls.push(url); return route.fulfill({ json: { system_voice: [
                    { voice_id: 'voice-a', voice_name: '自然女声' }, { voice_id: 'voice-b', voice_name: '明亮男声' }
                ], base_resp: { status_code: 0 } } }); }
                return route.abort();
            });
            await page.goto('https://speech-ui.test/');
            for (const css of ['derived_features', 'ui_harmony', 'minimax_speech', 'monochrome_panels']) await page.addStyleTag({ path: path.join(root, 'css/modules/' + css + '.css') });
            await page.evaluate(() => {
                window.db = { characters: [{ id: 'role-a', realName: '林间' }], groups: [], minimaxTtsSettings: { apiKey: 'fixture', voiceId: 'global' } };
                window.saved = 0; window.saveData = async () => { window.saved++; }; window.showToast = () => {};
            });
            for (const file of ['voice_director', 'minimax_speech', 'chat_features', 'settings_api']) await page.addScriptTag({ path: path.join(root, 'js/modules/' + file + '.js') });
            await page.evaluate(() => setupMiniMaxTtsSettings());
            await page.addScriptTag({path:path.join(root,'js/vendor/lucide/uvu-icons.js')});
            await page.addScriptTag({ path: path.join(root, 'js/modules/panel_layout.js') });
            assert.equal(await page.evaluate(() => window.MiniMaxSpeech.fromForm().speech.stream), false);
            await page.getByRole('button',{name:'语音设置',exact:true}).click();
            await page.getByRole('button',{name:'角色音色与播放',exact:true}).click();
            const advanced = page.locator('#minimax-speech-advanced');
            await advanced.getByLabel('音色与表达', { exact: true }).selectOption('role-a');
            await advanced.locator('.draft-voice-profile-rules > summary').click();
            await advanced.locator('.minimax-speech-profile').getByLabel('角色读音词典').fill('晴/(qing2)');
            await advanced.locator('.minimax-speech-profile').getByLabel('表达风格').selectOption('expressive');
            await advanced.getByRole('button', { name: '读取音色', exact: true }).click();
            await advanced.getByLabel('搜索', { exact: true }).fill('自然');
            assert.equal(await advanced.locator('.minimax-voice-row').count(), 1);
            await advanced.getByRole('button', { name: '自然女声', exact: true }).click();
            await page.getByRole('button', { name: '保存', exact: true }).click();
            const saved = await page.evaluate(() => ({ count: window.saved, settings: db.minimaxTtsSettings }));
            assert.equal(saved.count, 1); assert.equal(saved.settings.profiles['role-a'].voiceId, 'voice-a');
            assert.equal(saved.settings.profiles['role-a'].dictionary[0], '晴/(qing2)');
            assert.equal(saved.settings.profiles['role-a'].style, 'expressive');
            await advanced.locator('.minimax-speech-profile').getByLabel('音色 ID', { exact: true }).fill('unsaved-voice');
            await advanced.getByLabel('音色与表达', { exact: true }).selectOption('');
            assert.equal(await page.evaluate(() => db.minimaxTtsSettings.profiles['role-a'].voiceId), 'voice-a', 'unsaved form changes cannot mutate saved settings');
            await advanced.locator('.draft-voice-more > summary').click();
            await advanced.locator('summary').filter({ hasText: /^播放与缓存$/ }).click();
            const layout = await advanced.evaluate(el => {
                const box = el.getBoundingClientRect();
                const overflow = [...el.querySelectorAll('input,button,select,textarea')].filter(n => n.getClientRects().length)
                    .some(n => n.getBoundingClientRect().right > box.right + 1 || n.getBoundingClientRect().left < box.left - 1);
                return { overflow, checks: [...el.querySelectorAll('input[type=checkbox]')].filter(n => n.getClientRects().length).map(n => [n.getBoundingClientRect().width, n.getBoundingClientRect().height]), scroll: document.documentElement.scrollWidth > innerWidth };
            });
            assert.equal(layout.overflow, false, JSON.stringify(layout)); assert.equal(layout.scroll, false);
            assert.ok(layout.checks.every(([w, h]) => w === 16 && h === 16), JSON.stringify(layout));
            assert.equal(calls.length, 1); assert.deepEqual(errors, []);
            await page.screenshot({ path: path.join(output, 'speech-' + width + '.png'), fullPage: true });
            await page.close();
        }
        console.log('Speech derived settings: 320/390px layout, catalog/search, role overrides, pronunciation and persistence passed; no paid synthesis.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
