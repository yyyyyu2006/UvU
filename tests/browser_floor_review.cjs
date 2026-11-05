const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '../node_modules/playwright');
const root = path.join(__dirname, '..');
(async () => {
    const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    try {
        const page = await browser.newPage({viewport: {width: 320, height: 844}, isMobile: true, hasTouch: true});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://floor-review.test/**', route => route.fulfill({contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1">'}));
        await page.goto('https://floor-review.test/');
        const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        const start = html.indexOf('<div id="uvu-story-bridge-screen"'), end = html.indexOf('<div id="wallpaper-screen"', start);
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">' + html.slice(start, end).replace('class="screen"', 'class="screen active"'));
        for (const file of ['base.css', 'layout.css', 'settings.css']) await page.addStyleTag({content: fs.readFileSync(path.join(root, 'css', file), 'utf8')});
        await page.evaluate(() => {
            window.currentChatId = 'c'; window.currentChatType = 'private';
            window.db = {characters: [{id: 'c', name: '角色', activeArchiveId: 'a', memoryJournals: [{
                id: 'scene', externalSceneId: 's', source: 'sillytavern', title: '测试剧情', createdAt: 1793836800000, isFavorited: false,
                content: '原始剧情', bridgeReview: {version: 2, sceneFormat: 'floors-v1', archiveId: 'a', status: 'pending', sourceText: '原始剧情',
                    items: [
                        {id: 'f1', text: '第一段。\n\n第二段。', selected: false, floor: {number: 8, speaker: '角色', createdAt: 1793836800000, extraction: 'tagged', bodyTag: 'content'}},
                        {id: 'f2', text: 'User 的回答。', selected: false, floor: {number: 9, speaker: 'User', createdAt: 1793836800000, extraction: 'plain', bodyTag: ''}}
                    ]}
            }]}], uvuStoryBridgeSettings: {}};
            window.saveData = async () => {window.saved = structuredClone(window.db);};
        });
        await page.addScriptTag({content: fs.readFileSync(path.join(root, 'js/modules/bridge_text.js'), 'utf8')});
        await page.addScriptTag({content: fs.readFileSync(path.join(root, 'js/modules/story_bridge.js'), 'utf8')});
        await page.evaluate(() => UvUStoryBridge.renderReview(true));
        await page.locator('#uvu-bridge-review-list > details > summary').click();
        const all = page.getByRole('checkbox', {name: '全选本场剧情', exact: true});
        assert.equal(await all.count(), 1);
        await all.check();
        const picks = page.getByRole('checkbox', {name: '允许这条剧情加入上下文', exact: true});
        assert.equal(await picks.count(), 2); assert.equal(await picks.nth(0).isChecked(), true);
        await picks.nth(1).uncheck();
        assert.equal(await all.evaluate(element => element.indeterminate), true);
        const floor = page.locator('.uvu-bridge-review-floor').first();
        await floor.locator('summary').click();
        await floor.locator('textarea').fill('审核后修改的完整一层。');
        await page.evaluate(() => UvUStoryBridge.renderReview(true));
        assert.equal(await page.locator('.uvu-bridge-review-floor textarea').first().inputValue(), '审核后修改的完整一层。');
        for (const width of [320, 390]) {
            await page.setViewportSize({width, height: 844});
            const metrics = await page.locator('#uvu-bridge-review-list').evaluate(element => ({width: element.clientWidth, scrollWidth: element.scrollWidth}));
            assert.ok(metrics.scrollWidth <= metrics.width, JSON.stringify(metrics));
            await page.screenshot({path: path.join(root, '../uvu-verification-deps/floor-review-' + width + '.png'), fullPage: true});
        }
        await page.getByRole('button', {name: '原文直接加入记忆', exact: true}).click();
        const result = await page.evaluate(() => ({journal: saved.characters[0].memoryJournals[0], allowed: UvUStoryBridge.allowedMemory(db.characters[0], db.characters[0].memoryJournals[0])}));
        assert.equal(result.allowed, true); assert.equal(result.journal.category, '酒馆线下剧情');
        assert.match(result.journal.content, /审核后修改的完整一层/); assert.doesNotMatch(result.journal.content, /User 的回答/);
        await page.evaluate(() => {db = structuredClone(saved); UvUStoryBridge.renderReview(true);});
        assert.equal(await page.locator('.uvu-bridge-review-floor textarea').first().inputValue(), '审核后修改的完整一层。');
        await page.evaluate(() => {
            const legacy = {id: 'legacy', source: 'sillytavern', externalSceneId: 'old', title: '旧待审', content: '旧正文', isFavorited: false,
                bridgeReview: {version: 1, archiveId: 'a', status: 'pending', sourceText: '[2026-11-05T00:00:00.000Z | 角色]\n第一段。\n\n第二段。',
                    items: [{id: '1', text: '第一段。', selected: false}, {id: '2', text: '第二段。', selected: false}]}};
            db.characters[0].memoryJournals = [legacy]; UvUStoryBridge.renderReview(true);
        });
        await page.locator('#uvu-bridge-review-list > details > summary').click();
        page.on('dialog', dialog => dialog.accept());
        await page.getByRole('button', {name: '按旧原文重新整理楼层', exact: true}).click();
        assert.equal(await page.locator('.uvu-bridge-review-floor').count(), 1);
        assert.equal(await page.locator('.uvu-bridge-review-floor textarea').inputValue(), '第一段。\n\n第二段。');
        await page.getByRole('checkbox', {name: '全选本场剧情', exact: true}).check();
        await page.getByRole('button', {name: '原文直接加入记忆', exact: true}).click();
        assert.equal(await page.evaluate(() => saved.characters[0].memoryJournals[0].bridgeReview.items[0].floor.speaker), '角色');
        assert.equal(await page.getByRole('button', {name: '按旧原文重新整理楼层', exact: true}).count(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS whole-floor review, select-all/partial selection, edit-preserving refresh, memory approval/reload, mobile widths 320/390.');
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
