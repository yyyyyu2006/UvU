const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const runtime = require('./helpers/browser_runtime.cjs');

const root = path.resolve(__dirname, '..');
const libs = runtime.assetMap(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
const output = path.join(os.tmpdir(), 'uvu-gomoku-browser');
fs.mkdirSync(output, { recursive: true });
let receivedRequest;
let responseText = '{"row":7,"col":8,"say":"这一步不错。"}';
let delayApi = false;

async function assertGameNavigation(page, activeId) {
    const ids = ['home-screen', 'uvu-game-hub-screen', 'uvu-minesweeper-screen', 'uvu-gomoku-screen'];
    const rendered = await page.evaluate(screenIds => screenIds.filter(id => {
        const screen = document.getElementById(id);
        return getComputedStyle(screen).display !== 'none' && screen.getClientRects().length > 0;
    }), ids);
    assert.deepEqual(rendered, [activeId], 'only the current screen may occupy space');
}

const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'));
        res.end(data);
    });
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await runtime.playwright().chromium.launch({ headless: true, executablePath: runtime.browserPath() });
    const errors = [];
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
        await context.addInitScript(() => {
            localStorage.setItem('lastSeenVersion', '1.8.9');
            localStorage.setItem('storage_persist_prompted', 'true');
        });
        await context.route('**/*', async route => {
            const url = route.request().url();
            if (url.includes('example.test/v1/chat/completions')) {
                receivedRequest = route.request().postDataJSON();
                if (delayApi) await new Promise(resolve => setTimeout(resolve, 350));
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: responseText } }] }) });
            }
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
            if (route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>' });
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-id="app-minesweeper"]') && document.getElementById('uvu-gomoku-screen'));
        await assertGameNavigation(page, 'home-screen');
        await page.locator('[data-id="app-minesweeper"] .app-icon').click();
        const hub = page.locator('#uvu-game-hub-screen');
        await hub.waitFor({ state: 'visible' });
        await assertGameNavigation(page, 'uvu-game-hub-screen');
        assert.equal(await hub.getByRole('listitem').count(), 2);
        assert.equal(await hub.getByRole('button', { name: /五子棋/ }).count(), 1);
        await hub.getByRole('button', { name: /五子棋/ }).click();
        const screen = page.locator('#uvu-gomoku-screen');
        await screen.waitFor({ state: 'visible' });
        await assertGameNavigation(page, 'uvu-gomoku-screen');
        assert.equal(await screen.locator('[data-gm-cell]').count(), 225);
        assert.equal(await screen.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');

        await screen.locator('[data-gm-start]').click();
        assert.equal(await screen.locator('.gm-setup').evaluate(node => node.hidden), true, 'setup hides once a game starts');
        assert.equal(await screen.locator('[data-gm-game]').evaluate(node => node.hidden), false, 'board view appears after starting');
        const cells = screen.locator('[data-gm-cell]');
        await cells.nth(112).focus();
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.gmCell), '97', 'arrow navigation follows the board grid');
        await page.keyboard.press('Enter');
        assert.equal(await screen.locator('[data-gm-count]').textContent(), '2 手', 'keyboard activation makes a legal move');
        await screen.locator('[data-gm-reset]').click();
        await cells.nth(112).focus();
        await cells.nth(112).click();
        assert.equal(await screen.locator('[data-gm-count]').textContent(), '2 手', 'local AI replies after the human move');
        assert.equal(await screen.locator('[data-gm-board] [data-stone="black"]').count(), 1);
        assert.equal(await screen.locator('[data-gm-board] [data-stone="white"]').count(), 1);
        const firstStone = await screen.locator('[data-gm-board] [data-stone="black"]').first().boundingBox();
        const firstIntersection = await screen.locator('[data-gm-cell][data-stone="black"]').boundingBox();
        assert.ok(Math.abs((firstStone.x + firstStone.width / 2) - (firstIntersection.x + firstIntersection.width / 2)) <= 1, 'stones sit on grid intersections');
        await screen.locator('[data-gm-undo]').click();
        assert.equal(await screen.locator('[data-gm-count]').textContent(), '0 手', 'undo removes both moves when the human played black');
        await page.evaluate(() => {
            const key = 'uvu.gomoku.session.v1:local:local';
            const saved = JSON.parse(localStorage.getItem(key));
            saved.moves = [{ color: 'black', row: 7, col: 7 }];
            localStorage.setItem(key, JSON.stringify(saved));
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-id="app-minesweeper"]') && document.getElementById('uvu-gomoku-screen'));
        await assertGameNavigation(page, 'home-screen');
        await page.evaluate(() => applyGlobalCss('#home-screen { background-color: #e5f1f7 !important; }'));
        await page.locator('[data-id="app-minesweeper"] .app-icon').click();
        await page.locator('#uvu-game-hub-screen').getByRole('button', { name: /五子棋/ }).click();
        assert.match(await page.locator('#uvu-gomoku-screen [data-gm-start]').textContent(), /继续/);
        await page.locator('#uvu-gomoku-screen [data-gm-start]').click();
        await page.waitForFunction(() => document.querySelector('#uvu-gomoku-screen [data-gm-count]')?.textContent === '2 手');
        assert.equal(await page.locator('#uvu-gomoku-screen [data-gm-count]').textContent(), '2 手', 'an incomplete local turn resumes and receives its AI response');
        await page.locator('#uvu-gomoku-screen [data-gm-change]').click();
        await page.locator('#uvu-gomoku-screen [data-gm-fresh]').click();
        assert.equal(await page.locator('#uvu-gomoku-screen [data-gm-count]').textContent(), '0 手', 'a separate explicit control starts a fresh game');
        await cells.nth(112).click();
        assert.equal(await page.locator('#uvu-gomoku-screen [data-gm-count]').textContent(), '2 手', 'the local AI replies to a new game');
        await screen.locator('[data-gm-undo]').click();
        assert.equal(await screen.locator('[data-gm-count]').textContent(), '0 手', 'undo is safe after a resumed turn');
        await screen.locator('[data-gm-reset]').click();
        assert.equal(await screen.locator('[data-gm-count]').textContent(), '0 手');

        await screen.locator('[data-gm-change]').click();
        await page.evaluate(() => {
            db.characters = [{ id: 'gomoku-char-1', realName: '测试角色', description: '沉稳，喜欢下棋。' }];
            db.apiSettings = { url: 'https://example.test/v1', key: 'fake-test-key', model: 'test-model', provider: 'openai', streamEnabled: true };
        });
        await screen.locator('input[name="gm-mode"][value="character"]').check();
        await screen.locator('[data-gm-character]').selectOption('gomoku-char-1');
        await screen.locator('[data-gm-start]').click();
        const historyBefore = await page.evaluate(() => db.characters[0].history?.length || 0);
        await cells.nth(112).click();
        await page.waitForFunction(() => document.querySelector('#uvu-gomoku-screen [data-gm-count]')?.textContent === '2 手');
        assert.equal(await screen.locator('[data-gm-line]').textContent(), '“这一步不错。”');
        assert.equal(await page.evaluate(() => db.characters[0].history?.length || 0), historyBefore, 'character game does not write to chat history');
        assert.ok(receivedRequest, 'character mode calls the mocked configured endpoint');
        assert.equal(receivedRequest.stream, false, 'game calls are non-streaming');
        assert.equal(receivedRequest.messages.length, 2, 'game request contains only a fixed rule and the board payload');
        const userPayload = receivedRequest.messages[1].content;
        assert.match(userPayload, /legalCandidates/);
        assert.doesNotMatch(userPayload, /chat_history|memory|worldbook/i);

        responseText = '{"row":7,"col":9,"say":"晚一点的回复。"}';
        delayApi = true;
        await screen.locator('[data-gm-reset]').click();
        await cells.nth(112).click();
        await screen.locator('[data-gm-cancel]').click();
        await page.waitForTimeout(450);
        assert.equal(await screen.locator('[data-gm-count]').textContent(), '1 手', 'a cancelled late response cannot alter the board');
        assert.equal(await screen.locator('[data-gm-board] [data-stone="white"]').count(), 0);

        await page.setViewportSize({ width: 320, height: 640 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'the board fits a narrow mobile viewport');
        await screen.locator('[data-gm-help]').click();
        assert.equal(await screen.locator('.gm-help').evaluate(node => node.open), true);
        await page.keyboard.press('Escape');
        assert.equal(await screen.locator('.gm-help').evaluate(node => node.open), false);
        await page.screenshot({ path: path.join(output, 'gomoku-320.png'), animations: 'disabled' });
        await screen.getByRole('button', { name: '返回游戏大厅' }).click();
        await assertGameNavigation(page, 'uvu-game-hub-screen');
        await hub.getByRole('button', { name: /扫雷/ }).click();
        await assertGameNavigation(page, 'uvu-minesweeper-screen');
        await page.locator('#uvu-minesweeper-screen .back-btn').click();
        await assertGameNavigation(page, 'uvu-game-hub-screen');
        await hub.locator('.back-btn').click();
        await assertGameNavigation(page, 'home-screen');
        assert.equal(await page.locator('#home-screen').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(229, 241, 247)', 'the custom desktop style survives game navigation');
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(output, 'home-after-games-320.png'), animations: 'disabled' });
        console.log('Gomoku browser checks passed: exclusive screen visibility on startup, reload and back, custom desktop style, board and isolated character API.');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
