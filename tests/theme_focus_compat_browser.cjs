// Real app cascade. Optional UVU_THEME_CSS checks a local theme without copying it into the repo.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
const out = path.join(root, 'outputs/theme-focus'); fs.mkdirSync(out, { recursive: true });
const themeFixture = `
#chat-room-screen#chat-room-screen #get-reply-btn {position:absolute!important;right:8px!important;top:50%!important;width:28px!important;height:28px!important;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;color:transparent!important;transform:translateY(-50%)!important}
#chat-room-screen#chat-room-screen #get-reply-btn > * {opacity:0!important}
#chat-room-screen#chat-room-screen #get-reply-btn::after {content:"";position:absolute;inset:4px;background:#888;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='8'/%3E%3C/svg%3E") center/contain no-repeat}
#chat-room-screen#chat-room-screen .message-input-area:focus-within #get-reply-btn {background:#0a84ff!important}
#chat-room-screen#chat-room-screen .message-input-area:focus-within #get-reply-btn::after {inset:5px!important;background:white!important}
`;
async function iconSnapshot(reply) {
    return reply.evaluate(n => {
        const c = getComputedStyle(n), p = getComputedStyle(n, '::after'), r = n.getBoundingClientRect();
        return { size: [Math.round(r.width), Math.round(r.height)], position: c.position,
            pseudo: Object.fromEntries(['content', 'width', 'height', 'inset', 'transform', 'borderRadius', 'maskImage'].map(k => [k, p[k]])) };
    });
}
(async () => {
    const baseline = require('./helpers/baseline_1900.cjs').baseline1900();
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        await page.evaluate(() => {
            db.characters = [{ id: 'theme', realName: '主题测试', remarkName: '主题测试', myName: '我', persona: '', history: [], maxMemory: 20, worldBookIds: [] }];
            ensureAllChatArchives(); openChatRoom('theme', 'private');
        });
        const reply = page.locator('#get-reply-btn');
        if (baseline.available) {
            const nativeMetrics = () => page.evaluate(() => Object.fromEntries([
                '.message-input-area', '#toggle-expansion-btn', '#sticker-toggle-btn', '#sticker-toggle-btn img', '#get-reply-btn', '#get-reply-btn svg'
            ].map(selector => {
                const c = getComputedStyle(document.querySelector(selector));
                return [selector, Object.fromEntries(['width', 'height', 'padding', 'gap'].map(k => [k, c[k]]))];
            })));
            await stableUI(page, '.message-input-area');
            const current = await nativeMetrics();
            const original = await page.addStyleTag({ content: fs.readFileSync(path.join(baseline.root, 'css/chat.css'), 'utf8') });
            await page.evaluate(() => { for (const s of document.styleSheets) if (s.href?.includes('/css/chat.css')) s.disabled = true; });
            await stableUI(page, '.message-input-area');
            assert.deepEqual(await nativeMetrics(), current, 'native chat input dimensions and spacing match 1900');
            await page.evaluate(() => { for (const s of document.styleSheets) if (s.href?.includes('/css/chat.css')) s.disabled = false; });
            await original.evaluate(n => n.remove());
            await stableUI(page, '.message-input-area');
        }
        const originalSize = (await iconSnapshot(reply)).size;
        await reply.evaluate(n => n.dataset.generating = 'true');
        assert.deepEqual((await iconSnapshot(reply)).size, originalSize, 'default stop keeps reply dimensions');
        assert.equal(await reply.locator('.uvu-reply-stop-mark').evaluate(n => getComputedStyle(n).display), 'block');
        await reply.evaluate(n => n.dataset.generating = 'false');
        assert.equal(await reply.locator('.uvu-reply-stop-mark').evaluate(n => getComputedStyle(n).display), 'none');
        const theme = await page.addStyleTag({ content: themeFixture });
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            for (const focused of [false, true]) {
                await page.locator('#message-input').evaluate((n, focus) => focus ? n.focus() : n.blur(), focused);
                const before = await iconSnapshot(reply);
                await reply.evaluate(n => n.dataset.generating = 'true');
                assert.deepEqual(await iconSnapshot(reply), before, 'theme pseudo-element remains unchanged during generation');
                await reply.evaluate(n => n.dataset.generating = 'false');
            }
        }
        await theme.evaluate(n => n.remove());
        if (process.env.UVU_THEME_CSS) {
            await page.addStyleTag({ content: fs.readFileSync(process.env.UVU_THEME_CSS, 'utf8') });
            for (const focused of [false, true]) {
                await page.locator('#message-input').evaluate((n, focus) => focus ? n.focus() : n.blur(), focused);
                const before = await iconSnapshot(reply);
                await reply.evaluate(n => n.dataset.generating = 'true');
                assert.deepEqual(await iconSnapshot(reply), before, 'supplied theme keeps its geometry and icon');
                await page.screenshot({ path: path.join(out, focused ? 'theme-focused.png' : 'theme-idle.png'), animations: 'disabled' });
                await reply.evaluate(n => n.dataset.generating = 'false');
            }
        }
        await page.evaluate(() => openExpandedEditor(Object.assign(document.createElement('textarea'), { value: '主题测试文本', id: 'theme-fixture-editor' })));
        await stableUI(page, '.text-editor-card');
        await page.locator('.draft-editor-toolbar button').filter({ hasText: '查找' }).click();
        const find = page.locator('.editor-find'); await find.focus();
        const focus = await find.evaluate(n => { const c = getComputedStyle(n); return { outline: c.outlineStyle, shadow: c.boxShadow }; });
        assert.equal(focus.outline, 'none', 'editor has no dark outer frame');
        assert.match(focus.shadow, /201, 234, 248/, 'soft blue focus remains visible');
        await page.screenshot({ path: path.join(out, 'editor-focus.png'), animations: 'disabled' });
        // Old chat input keeps the supplied/native theme; derivative focus styles do not reach it.
        await page.locator('#expanded-text-editor [data-action=cancel]').click();
        await page.locator('#message-input').focus();
        assert.doesNotMatch(await page.locator('#message-input').evaluate(n => getComputedStyle(n).boxShadow), /201, 234, 248/);
        await page.evaluate(() => document.getElementById('auto-memory-settings-btn').click());
        await stableUI(page, '#auto-memory-modal .auto-memory-dialog');
        const memoryCount = page.locator('[name=keepRecent]'); await memoryCount.focus();
        assert.equal(await memoryCount.evaluate(n => getComputedStyle(n).outlineStyle), 'none', 'memory inputs have no dark frame');
        assert.match(await memoryCount.evaluate(n => getComputedStyle(n).boxShadow), /201, 234, 248/);
        await page.locator('#auto-memory-close').click();
        assert.deepEqual(errors, []);
        console.log('PASS themed reply geometry, default stop icon, soft editor focus and original chat isolation');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
