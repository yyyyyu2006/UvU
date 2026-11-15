'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawnSync } = require('node:child_process'), runtime = require('./helpers/browser_runtime.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvu-preview-')), site = path.join(dir, 'site');
    const build = spawnSync(process.execPath, ['tools/build_pages.cjs', '--main', root, '--test', root, '--out', site, '--main-sha', 'a'.repeat(40), '--test-sha', 'b'.repeat(40)], { cwd: root, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const libraries = runtime.assetMap(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/storage-probe') return res.end('<!doctype html><title>Storage probe</title>');
        const file = path.resolve(site, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
        if (!file.startsWith(site + path.sep)) return res.writeHead(403).end();
        fs.readFile(file, (error, body) => { if (error) return res.writeHead(404).end(); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'); res.end(body); });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await runtime.playwright().chromium.launch({ headless: true, executablePath: runtime.browserPath() });
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        await context.route('**/*', route => {
            const url = route.request().url(); if (libraries.has(url)) return route.fulfill({ path: libraries.get(url), contentType: 'application/javascript' });
            return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        await context.addInitScript(() => { for (const prefix of ['', 'uvu-test:']) { localStorage.setItem(prefix + 'lastSeenVersion', '1.8.9'); localStorage.setItem(prefix + 'storage_persist_prompted', 'true'); } });
        const errors = [], stable = await context.newPage(), preview = await context.newPage(), probe = await context.newPage();
        for (const page of [stable, preview]) { page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.dismiss()); }
        const ready = page => page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await stable.goto(origin + '/'); await ready(stable);
        await stable.evaluate(async () => {
            GuideSystem.cleanup(); db.characters = [{ id: 'stable-only', realName: 'Stable fixture', history: [] }]; await saveData();
            localStorage.setItem('channel-probe', 'stable'); sessionStorage.setItem('channel-probe', 'stable-session');
        });
        await preview.goto(origin + '/test/'); await ready(preview);
        assert.equal(await preview.title(), 'UvU 测试版');
        const isolated = await preview.evaluate(() => ({ ids: db.characters.map(c => c.id), local: localStorage.getItem('channel-probe'), session: sessionStorage.getItem('channel-probe'), dbName: dexieDB.name }));
        assert.deepEqual(isolated.ids, []); assert.equal(isolated.local, null); assert.equal(isolated.session, null); assert.equal(isolated.dbName, 'uvu-test:章鱼喷墨机DB_ee');
        await preview.evaluate(async () => { GuideSystem.cleanup(); db.characters = [{ id: 'test-only', realName: 'Test fixture', history: [] }]; await saveData(); localStorage.setItem('channel-probe', 'test'); });
        assert.equal(await stable.evaluate(() => localStorage.getItem('channel-probe')), 'stable');
        await preview.reload(); await ready(preview); assert.deepEqual(await preview.evaluate(() => db.characters.map(c => c.id)), ['test-only']);
        assert.deepEqual(await stable.evaluate(async () => (await dexieDB.characters.toArray()).map(c => c.id)), ['stable-only']);
        console.log('PASS full main/test apps start and persist independent IndexedDB, localStorage and sessionStorage');
        await probe.goto(origin + '/storage-probe');
        await preview.evaluate(() => { window.storageEvents = []; window.addEventListener('storage', event => storageEvents.push({ key: event.key, value: event.newValue, ownStorage: event.storageArea === localStorage })); });
        await probe.evaluate(() => localStorage.setItem('production-event', 'stable'));
        await preview.waitForTimeout(150); assert.deepEqual(await preview.evaluate(() => storageEvents), []);
        await probe.evaluate(() => localStorage.setItem('uvu-test:test-event', 'test'));
        await preview.waitForFunction(() => storageEvents.length === 1);
        assert.deepEqual(await preview.evaluate(() => storageEvents[0]), { key: 'test-event', value: 'test', ownStorage: true });
        assert.ok(await preview.evaluate(() => Object.keys(localStorage).includes('test-event')));
        await preview.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
        assert.equal(await probe.evaluate(() => localStorage.getItem('channel-probe')), 'stable');
        assert.equal(await probe.evaluate(() => localStorage.getItem('production-event')), 'stable');
        assert.equal(await probe.evaluate(() => localStorage.getItem('uvu-test:channel-probe')), null);
        console.log('PASS test storage clear, enumeration and cross-tab events leave production keys intact');
        await preview.evaluate(() => { window.testChannel = new BroadcastChannel('channel-fixture'); window.channelMessages = []; testChannel.onmessage = event => channelMessages.push(event.data); });
        await probe.evaluate(() => { window.stableChannel = new BroadcastChannel('channel-fixture'); stableChannel.postMessage('production'); });
        await preview.waitForTimeout(150); assert.deepEqual(await preview.evaluate(() => channelMessages), []);
        await probe.evaluate(() => { window.namespacedChannel = new BroadcastChannel('uvu-test:channel-fixture'); namespacedChannel.postMessage('test'); });
        await preview.waitForFunction(() => channelMessages.length === 1); assert.deepEqual(await preview.evaluate(() => channelMessages), ['test']);
        await preview.evaluate(() => { navigator.locks.request('fixture-lock', () => new Promise(resolve => { window.releaseFixtureLock = resolve; })); });
        await preview.waitForFunction(() => typeof releaseFixtureLock === 'function');
        const locks = await probe.evaluate(async () => (await navigator.locks.query()).held.map(lock => lock.name)); assert.ok(locks.includes('uvu-test:fixture-lock')); assert.ok(!locks.includes('fixture-lock'));
        await preview.evaluate(() => releaseFixtureLock()); console.log('PASS test background channels and locks use their own namespace');
        assert.deepEqual(errors, []); await context.close(); console.log('PASS no uncaught errors in either full app');
    } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
