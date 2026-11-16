// Full application, isolated storage and simulated discovery; no external service calls.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fullApp, stableUI, root } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(), results = [];
    const out = path.join(root, 'outputs/mcp-compact-20261116');
    fs.mkdirSync(out, { recursive: true });
    try {
        const { page, context, errors } = await app.page();
        await page.evaluate(async () => {
            document.addEventListener('pointerdown', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            const settings = MCPServices.settings();
            settings.services = [{ id: 'compact-fixture', name: 'Exa 网页搜索', url: 'https://fixture.invalid/mcp', enabled: true, auth: 'none', protocol: '2025-03-26' }];
            await MCPServices.save(settings);
            window.compactDiscoverCalls = 0;
            window.MCPServices = { ...MCPServices, discover: async () => { window.compactDiscoverCalls++; return []; } };
            openMcpSettings();
        });
        const panel = page.locator('#mcp-services .mcp-settings');
        for (const [width, height] of [[320, 568], [390, 844], [768, 844], [1440, 900], [390, 420]]) {
            await page.setViewportSize({ width, height });
            await stableUI(page, '#mcp-services .mcp-settings');
            const actions = panel.locator('.draft-service-actions');
            await actions.scrollIntoViewIfNeeded();
            const layout = await actions.evaluate(el => {
                const buttons = [...el.children].map(button => {
                    const r = button.getBoundingClientRect(), s = getComputedStyle(button), svg = button.querySelector('svg');
                    const hit = document.elementFromPoint(r.x + r.width / 2, r.y - 5);
                    return { x: r.x, y: r.y, width: r.width, height: r.height, font: s.fontSize, icon: svg?.getBoundingClientRect().width, extendedHit: hit === button || button.contains(hit) };
                });
                return { justify: getComputedStyle(el).justifyContent, buttons };
            });
            assert.equal(layout.justify, 'flex-start');
            assert.equal(layout.buttons.length, 2);
            const [a, b] = layout.buttons;
            assert(Math.abs(a.y - b.y) <= 1, JSON.stringify(layout));
            assert(Math.abs(b.x - a.x - a.width - 8) <= 1, JSON.stringify(layout));
            for (const button of [a, b]) {
                assert.equal(button.height, 30); assert.equal(button.font, '12px'); assert.equal(button.icon, 14);
                assert(button.x >= 0 && button.x + button.width <= width);
                assert(button.extendedHit, JSON.stringify(button));
            }
            const lines = await panel.locator('.draft-mcp-scope .mono-route-list > .mono-route').evaluateAll(nodes => nodes.map(el => {
                const s = getComputedStyle(el);
                return { top: s.borderTopWidth, bottom: s.borderBottomWidth, color: s.borderBottomColor };
            }));
            assert.equal(lines.length, 4);
            lines.forEach((line, i) => { assert.equal(line.top, '0px'); assert.equal(line.bottom, i === 3 ? '0px' : '1px'); if (i < 3) assert.equal(line.color, 'rgb(240, 240, 243)'); });
            assert.equal(await panel.locator('.mcp-service-item').first().evaluate(el => getComputedStyle(el).borderBottomColor), lines[0].color);
            assert(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            results.push({ viewport: `${width}x${height}`, layout, lines });
            if (width === 320 || width === 390 && height === 844) {
                await panel.locator('.mcp-body').evaluate(el => el.scrollTop = 0);
                await panel.screenshot({ path: path.join(out, `mcp-${width}.png`) });
            }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await panel.getByRole('button', { name: '编辑', exact: true }).click();
        const editor = page.locator('#mcp-service-editor');
        assert.equal(await editor.getByLabel('名称', { exact: true }).inputValue(), 'Exa 网页搜索');
        await editor.getByRole('button', { name: '保存', exact: true }).click();
        await editor.waitFor({ state: 'detached' });
        await panel.getByRole('button', { name: '测试 / 刷新工具', exact: true }).click();
        await page.waitForFunction(() => compactDiscoverCalls === 1 && !document.querySelector('#mcp-services .mcp-settings').hasAttribute('aria-busy'));
        for (const [name, view] of [['工具授权', 'tools'], ['角色可用服务', 'roles'], ['查看调用记录', 'logs'], ['连接与调用设置', 'options']]) {
            await panel.getByRole('button', { name, exact: true }).click();
            assert.equal(await panel.getAttribute('data-mono-view'), view);
            await panel.evaluate(el => el.monoNavigate('services'));
        }
        await panel.locator('.sheet-close').click();
        await page.evaluate(async () => { const settings = MCPServices.settings(); settings.services = []; await MCPServices.save(settings); openMcpSettings(); });
        assert(await panel.getByRole('button', { name: '编辑', exact: true }).isDisabled());
        assert(await panel.getByRole('button', { name: '测试 / 刷新工具', exact: true }).isDisabled());
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ results, interactions: 'edit/save, simulated connect, four routes, empty state', errors }, null, 2));
        await context.close();
        console.log('PASS MCP compact controls: five viewports, uniform separators, touch targets and existing interactions');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
