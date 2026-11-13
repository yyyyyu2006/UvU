// Real page, isolated storage; no remote services or personal data.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fullApp, root } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(), results = [], failures = [];
    const out = path.join(root, 'outputs/ui-flow-20261113'); fs.mkdirSync(out, { recursive: true });
    const check = async (name, run) => { try { await run(); results.push({ name, pass: true }); } catch (e) { failures.push(name + ': ' + e.message); results.push({ name, pass: false, error: e.message }); } };
    try {
        const { page, context, errors } = await app.page();
        await page.evaluate(async () => {
            db.characters = [{ id: 'flow-char', realName: '测试角色', remarkName: '测试角色', myName: '我', persona: '', myPersona: '', maxMemory: 20, history: [], worldBookIds: [], memoryJournals: [] }];
            db.myStickers = [{ id: 's', name: '开心', group: '未分类', data: 'data:image/png;base64,AA==' }];
            await saveData(); openChatRoom('flow-char', 'private');
        });
        await page.locator('#chat-settings-btn').click();
        for (const [width, height] of [[320, 568], [390, 844], [768, 844]]) {
            await page.setViewportSize({ width, height });
            await check('sticker actions share row ' + width, async () => {
                const tag = page.locator('#setting-char-sticker-groups-container .sticker-group-tag').first(), action = page.locator('#sticker-description-settings-open');
                await action.scrollIntoViewIfNeeded();
                const a = await tag.boundingBox(), b = await action.boundingBox();
                assert(a && b); assert(Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= 2, JSON.stringify({ a, b }));
                assert(b.x >= a.x + a.width + 4); assert(b.x + b.width <= width);
            });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#sticker-description-settings-open').click();
        await page.locator('#sticker-description-settings [data-action=close]').click();
        await page.locator('.sticker-assist-settings-row').screenshot({ path: path.join(out, 'sticker-groups.png') });
        await check('many sticker groups scroll without displacing the action', async () => {
            await page.evaluate(() => { const container = document.getElementById('setting-char-sticker-groups-container'); for (let i = 0; i < 12; i++) { const tag = container.firstElementChild.cloneNode(true); tag.textContent = '分组' + i; container.append(tag); } });
            await page.setViewportSize({ width: 320, height: 568 });
            const group = page.locator('#setting-char-sticker-groups-container'), action = page.locator('#sticker-description-settings-open');
            await action.scrollIntoViewIfNeeded();
            assert(await group.evaluate(el => el.scrollWidth > el.clientWidth));
            const a = await group.boundingBox(), b = await action.boundingBox();
            assert(Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= 2); assert(b.x + b.width <= 320);
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => UvUPanelLayout.appearance());
        for (const [width, height] of [[320, 568], [390, 844], [768, 844], [390, 420]]) {
            await page.setViewportSize({ width, height });
            await check('font selector fits ' + width + 'x' + height, async () => {
                const size = page.getByLabel('二改面板正文大小', { exact: true });
                await size.scrollIntoViewIfNeeded();
                const box = await size.evaluate(el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return { width: r.width, height: r.height, font: parseFloat(s.fontSize), line: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2, top: parseFloat(s.paddingTop), bottom: parseFloat(s.paddingBottom) }; });
                assert(box.font <= 13, JSON.stringify(box)); assert(box.width >= 76); assert(box.height >= box.line + box.top + box.bottom - 1, JSON.stringify(box));
            });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#draft-appearance-workspace .derived-body').evaluate(el => el.scrollTop = 0);
        await page.locator('#draft-appearance-workspace .uvu-lenso-panel').screenshot({ path: path.join(out, 'appearance.png') });
        await page.locator('#draft-appearance-workspace .sheet-close').click();
        await page.evaluate(() => switchScreen('api-settings-screen'));
        await check('keepalive summary aligns to adjacent settings', async () => {
            const summary = page.locator('#keep-alive-diagnostics > summary'), title = page.locator('#system-notification-switch').locator('xpath=ancestor::div[contains(@class,"kkt-item")]').locator('.kkt-item-title');
            await summary.scrollIntoViewIfNeeded(); const a = await summary.boundingBox(), b = await title.boundingBox();
            assert(Math.abs(a.x - b.x) <= 2, JSON.stringify({ a, b }));
            await summary.click(); assert(await page.locator('#keep-alive-screen-switch').isVisible()); await summary.click();
        });
        await page.locator('#keep-alive-diagnostics').screenshot({ path: path.join(out, 'keepalive.png') });
        await page.evaluate(async () => { const settings = MCPServices.settings(); settings.services = [{ id: 'flow-service', name: '测试搜索', url: 'https://example.com/mcp', enabled: true, auth: 'none', protocol: '2025-03-26' }]; await MCPServices.save(settings); openMcpSettings(); });
        const panel = page.locator('#mcp-services .mcp-settings');
        fs.writeFileSync(path.join(out, 'mcp-dom.html'), await panel.innerHTML());
        await check('MCP common actions need no disclosure', async () => {
            assert(await panel.getByRole('button', { name: '测试 / 刷新工具', exact: true }).isVisible());
            assert(await panel.getByRole('button', { name: '编辑', exact: true }).isVisible());
            assert.equal(await panel.getByText('管理所选服务', { exact: true }).count(), 0);
            await panel.getByRole('button', { name: '编辑', exact: true }).click();
            const editor = page.locator('#mcp-service-editor');
            assert.equal(await editor.getByLabel('名称', { exact: true }).inputValue(), '测试搜索');
            await editor.getByRole('button', { name: '保存', exact: true }).click();
            await editor.waitFor({ state: 'detached' });
            assert(await panel.getByRole('button', { name: '测试 / 刷新工具', exact: true }).isVisible());
            await panel.locator('.mono-service-management > summary').click();
            assert(await panel.getByRole('button', { name: '删除', exact: true }).isVisible());
        });
        await panel.locator('.mono-service-management > summary').click();
        await panel.locator('.mcp-body').evaluate(el => el.scrollTop = 0);
        await panel.screenshot({ path: path.join(out, 'mcp.png') });
        await check('empty MCP service list has no active service actions', async () => {
            await panel.locator('.sheet-close').click();
            await page.evaluate(async () => { const settings = MCPServices.settings(); settings.services = []; await MCPServices.save(settings); openMcpSettings(); });
            assert(await panel.getByRole('button', { name: '编辑', exact: true }).isDisabled());
            assert(await panel.getByRole('button', { name: '测试 / 刷新工具', exact: true }).isDisabled());
        });
        await check('no relevant page errors', async () => assert.deepEqual(errors, []));
        fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(results, null, 2));
        await context.close(); assert.deepEqual(failures, []); console.log('PASS', results.length, 'panel layout and MCP edit-return checks');
    } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
