const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fullApp, stableUI, root } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp(), out = path.join(root, 'outputs/panel-help-tabs-20261116'), checks = [];
    fs.mkdirSync(out, { recursive: true });
    try {
        const { page, context, errors } = await app.page();
        await page.evaluate(async () => {
            document.addEventListener('pointerdown', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            db.characters = [{ id: 'panel-fixture', realName: '测试好友', remarkName: '测试好友', myName: '我', persona: '', myPersona: '', maxMemory: 20, history: [], worldBookIds: [], memoryJournals: [] }];
            await saveData(); openChatRoom('panel-fixture', 'private');
        });
        async function inspect(name, selector) {
            for (const [width, height] of [[320, 568], [390, 844], [768, 844], [1440, 900], [390, 420]]) {
                await page.setViewportSize({ width, height }); await stableUI(page, selector);
                const box = await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, overflow: el.scrollWidth > el.clientWidth + 1 }; });
                assert(box.x >= 0 && box.y >= 0 && box.right <= width + 1 && box.bottom <= height + 1 && !box.overflow, name + JSON.stringify(box));
                checks.push({ name, width, height, box });
                if (width === 390 && height === 844) await page.locator(selector).screenshot({ path: path.join(out, name + '.png') });
            }
            await page.setViewportSize({ width: 390, height: 844 });
        }
        async function help(panel, text) {
            const opener=panel.getByRole('button', { name: '使用说明', exact: true });await opener.click();
            const guide = page.locator('#panel-explanation-dialog'); await guide.waitFor();
            assert.match(await guide.innerText(), text);
            await page.keyboard.press('Tab');assert(await guide.evaluate(el=>el.contains(document.activeElement)));
            await page.keyboard.press('Escape'); await guide.waitFor({ state: 'detached' });
            assert(await opener.evaluate(el=>document.activeElement===el));
        }
        await page.evaluate(() => openRelationshipDialog());
        const relationship = page.locator('.relationship-dialog');
        await inspect('relationship', '.relationship-dialog');
        assert.equal(await relationship.getByText('规则说明', { exact: true }).count(), 0);
        assert.equal(await relationship.locator('.relationship-help').first().isVisible(), false);
        await help(relationship, /定时恢复会解除对方的拉黑/);
        const noteCount=await relationship.locator('.panel-help-source .relationship-help').count();
        await relationship.getByRole('button',{name:'拉黑对方',exact:true}).click();
        await relationship.getByRole('button',{name:'解除拉黑',exact:true}).waitFor();
        assert.equal(await relationship.locator('.panel-help-source .relationship-help').count(),noteCount);
        await help(relationship,/拉黑不会自动删除好友/);
        await relationship.locator('.draft-relationship-rule').first().locator('summary').click();
        assert(await relationship.locator('#relationship-autonomy-enabled').isVisible());
        await relationship.locator('.sheet-close').click();
        await page.evaluate(() => openSharedDocumentDialog());
        const files = page.locator('.shared-document-dialog'); await stableUI(page, '.shared-document-dialog');
        const border = await files.locator('[data-action=cancel]').evaluate(el => getComputedStyle(el).borderTopWidth); assert.equal(border, '0px');
        await inspect('files', '.shared-document-dialog'); await files.locator('.sheet-close').click();
        await page.evaluate(() => switchScreen('edit-world-book-screen'));
        await page.locator('#world-book-name').fill('灰色标题测试');await page.locator('#world-book-content').fill('保持世界书内容和触发设置。');
        assert.equal(await page.locator('.worldbook-advanced > summary').evaluate(el => getComputedStyle(el).color), 'rgb(110, 110, 118)');
        await page.locator('.worldbook-editor-help').click();assert.match(await page.locator('#panel-explanation-dialog').innerText(), /未勾选/);await page.locator('#panel-explanation-dialog .sheet-close').click();
        await page.locator('.worldbook-advanced > summary').click();
        await inspect('worldbook', '.worldbook-advanced .draft-inline-workspace');
        const worldbook = page.locator('.worldbook-advanced .draft-inline-workspace');await help(worldbook, /按原方式注入/);
        assert(await worldbook.locator('#wb-advanced-enabled').isVisible());await worldbook.locator('.sheet-close').click();
        await page.evaluate(() => { switchScreen('storage-analysis-screen'); renderStorageUI(); });
        const detector = page.locator('[data-resource-health]'), selectAll = page.locator('#storage-select-all-btn');
        assert.equal(await detector.count(), 1);assert.equal(await detector.evaluate(el => el.parentElement.className), 'storage-group-title');
        for(const width of [320,390,768]){await page.setViewportSize({width,height:844});await detector.scrollIntoViewIfNeeded();const a=await detector.boundingBox(),b=await selectAll.boundingBox();assert(Math.abs(a.y+a.height/2-b.y-b.height/2)<=2);assert(a.x+a.width<=b.x && b.x+b.width<=width);}
        await page.setViewportSize({width:390,height:844});await detector.locator('..').screenshot({path:path.join(out,'backup-header.png')});
        await detector.click();await page.locator('.resource-health').waitFor();await page.locator('.resource-health .sheet-close').click();
        await page.evaluate(() => switchScreen('customize-screen'));await page.getByRole('button', { name: '管理主页预设', exact: true }).click();
        await inspect('preset', '.draft-preset-workspace');
        const preset = page.locator('.draft-preset-workspace');assert((await preset.boundingBox()).height < 600);
        assert.equal(await preset.getByText('导入与分享说明', { exact: true }).count(), 0);await help(preset, /导入|分享/);await preset.locator('.sheet-close').click();
        await page.evaluate(() => switchScreen('uvu-story-bridge-screen'));
        assert.equal(await page.locator('#uvu-story-bridge-screen .mono-bridge-footer').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
        const routes=page.locator('#uvu-story-bridge-screen .mono-route-list');
        assert.equal(await routes.isVisible(),false,'an empty or hidden-only route list must not leave a separator');
        await routes.evaluate(el=>{const entry=el.firstElementChild;entry.hidden=false;});
        assert(await routes.isVisible(),'a real visible route remains usable');
        await routes.evaluate(el=>{el.firstElementChild.hidden=true;});
        await page.locator('#uvu-story-bridge-screen').screenshot({path:path.join(out,'tavern.png')});
        await page.evaluate(() => { UvUMusicUI.open(); UvUMusicUI.accounts(); });
        const music = page.locator('.um-settings-sheet');await inspect('music-account', '.um-settings-sheet .um-sheet-card');
        assert.equal(await music.locator('.um-settings-help-button svg').count(), 1);
        const colors=await music.evaluate(el=>{const selectors=['.um-sheet-head h2','[role=tab]','.um-check','.um-account strong','.um-account small','.um-account .um-button','.um-gateway-settings > summary','.um-appearance-settings > summary'];return selectors.flatMap(selector=>[...el.querySelectorAll(selector)].map(node=>getComputedStyle(node).color));});
        assert(colors.length>=10);assert(colors.every(color=>color==='rgb(106, 106, 114)'),JSON.stringify(colors));
        assert(await music.locator('.um-account,.um-gateway-settings,.um-appearance-settings').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).borderTopWidth==='0px'&&getComputedStyle(node).borderBottomWidth==='0px')));
        await music.locator('.um-appearance-settings > summary').click();
        await music.getByRole('button',{name:'深色',exact:true}).click();
        assert.equal(await music.locator('.um-sheet-head h2').evaluate(el=>getComputedStyle(el).color),'rgb(185, 185, 192)');
        await music.getByRole('button',{name:'白色',exact:true}).click();
        await music.locator('.um-appearance-settings > summary').click();
        assert(await music.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
        const accountTab = music.getByRole('tab', { name: '账号音乐', exact: true }), publicTab = music.getByRole('tab', { name: '公共音乐', exact: true });
        assert.equal(await accountTab.getAttribute('aria-selected'), 'true');assert.equal(await music.getByLabel('启用 GD 音乐台公共源', { exact: true }).isVisible(), false);
        const before = await music.locator('.um-sheet-card').boundingBox();await publicTab.click();const after = await music.locator('.um-sheet-card').boundingBox();assert.equal(before.height, after.height);
        assert(await music.getByLabel('启用 GD 音乐台公共源', { exact: true }).isVisible());
        await music.getByLabel('启用 GD 音乐台公共源',{exact:true}).check();
        await page.waitForFunction(()=>UvUMusic.settings().publicSources.includes('gd-netease'));
        await accountTab.click();await publicTab.click();assert(await music.getByLabel('启用 GD 音乐台公共源',{exact:true}).isChecked());
        await inspect('music-public', '.um-settings-sheet .um-sheet-card');
        await music.getByRole('button', { name: '使用说明', exact: true }).click();assert(await music.getByText('连接教程', { exact: true }).isHidden());assert.match(await music.locator('.um-settings-help').innerText(), /每 5 分钟最多 50 次/);
        await music.getByRole('button', { name: '返回音乐设置', exact: true }).click();assert.equal(await publicTab.getAttribute('aria-selected'), 'true');
        await publicTab.focus();await page.keyboard.press('ArrowLeft');assert.equal(await accountTab.getAttribute('aria-selected'), 'true');
        await page.keyboard.press('End');assert.equal(await publicTab.getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Escape');await music.waitFor({ state: 'detached' });
        assert.deepEqual(errors, []);fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
        await context.close();console.log('PASS seven panel changes: full app layouts, help, retained controls, detection and music tabs');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
