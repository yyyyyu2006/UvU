// Real App, isolated data: raw recovery export, legacy EE/TXT restore and exact import diagnostics.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), zlib = require('node:zlib');
const runtime = require('./helpers/browser_runtime.cjs');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/backup-social-compat');
fs.mkdirSync(out, { recursive: true });
const libs = runtime.assetMap(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream'));
        res.end(data);
    });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await runtime.playwright().chromium.launch({ headless: true, executablePath: runtime.browserPath() });
    const errors = [];
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
        await context.addInitScript(() => { localStorage.setItem('lastSeenVersion', '1.8.9'); localStorage.setItem('storage_persist_prompted', 'true'); });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (libs.has(url)) return route.fulfill({ path: libs.get(url), contentType: 'application/javascript' });
            return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        let acceptImport = false;
        page.on('dialog', dialog => dialog.type() === 'confirm' && !acceptImport ? dialog.dismiss() : dialog.accept());
        const ready = () => page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
        await page.goto(origin, { waitUntil: 'domcontentloaded' }); await ready();
        const seed = () => page.evaluate(async () => {
            const config = UvUMoments.settings({});
            const legacy = { momentsSocial: config, history: [], moments: [
                { id: 'moment_1700000000000', content: 'old one', comments: [{ id: 'comment_1700000000000', author: 'old', content: 'first' }, { id: 'comment_1700000000000', author: 'old', content: 'second' }] },
                { id: 'moment_1700000000000', content: 'old two', comments: [] }
            ] };
            db.characters = [{ id: 'backup-char', realName: '测试角色', persona: '', myName: '我', history: [], memoryJournals: [], maxMemory: 20,
                moments: [], activeArchiveId: 'active', archives: [{ id: 'old', name: '旧存档', data: legacy }, { id: 'active', name: '当前存档', data: { history: [] } }] }];
            db.groups = []; db.backupReminderSettings = { enabled: false };
            await saveData();
            Object.keys(selectedModules).forEach(key => selectedModules[key] = ['contacts', 'chats'].includes(key));
            Object.keys(selectedImportModules).forEach(key => selectedImportModules[key] = ['contacts', 'chats'].includes(key));
            switchScreen('storage-analysis-screen');
        });
        await seed();
        const downloadJob = page.waitForEvent('download'); await page.locator('#storage-export-btn').click();
        const download = await downloadJob, payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(await download.path())));
        assert.match(download.suggestedFilename(), /\.ee$/);
        assert.equal(payload.modules.characters[0].archives[0].data.moments.length, 2);
        assert.equal(payload.modules.characters[0].archives[0].data.moments[0].comments.length, 2);
        assert.equal(payload.backupManifest.warnings, undefined);
        // The same bytes, renamed by a mobile file manager, use the actual Worker import route.
        const bytes = fs.readFileSync(await download.path());
        acceptImport = true;
        await page.locator('#storage-import-file').setInputFiles({ name: '手机备份.ee.txt', mimeType: 'text/plain', buffer: bytes });
        await page.waitForFunction(() => document.getElementById('storage-backup-progress')?.textContent.includes('导入已成功提交'));
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
        assert.equal(await page.evaluate(() => db.characters[0].archives.find(a => a.id === 'old').data.moments[0].comments[1].content), 'second');
        // Tutorial export/import shares the same data validator and must round-trip too.
        const tutorialJob = page.waitForEvent('download'); await page.evaluate(() => triggerManualBackup());
        const tutorial = await tutorialJob, tutorialBytes = fs.readFileSync(await tutorial.path());
        await page.evaluate(() => switchScreen('storage-analysis-screen'));
        await page.locator('#storage-import-file').setInputFiles({ name: '教程备份.ee.txt', mimeType: 'text/plain', buffer: tutorialBytes });
        await page.waitForFunction(() => document.getElementById('storage-backup-progress')?.textContent.includes('导入已成功提交'));
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
        await page.evaluate(async () => {
            const data = db.characters[0].archives.find(a => a.id === 'old').data;
            data.moments = [{ id: 'p', content: 'keep', comments: [{ id: 'c', content: 'keep', replyToCommentId: 'missing', authorRef: { kind: 'user', id: 'backup-char' } }] }];
            await saveData();
            Object.keys(selectedModules).forEach(key => selectedModules[key] = ['contacts', 'chats'].includes(key));
            Object.keys(selectedImportModules).forEach(key => selectedImportModules[key] = ['contacts', 'chats'].includes(key));
            switchScreen('storage-analysis-screen');
        });
        const recoveryJob = page.waitForEvent('download'); await page.locator('#storage-export-btn').click();
        const recovery = await recoveryJob, recoveryBytes = fs.readFileSync(await recovery.path());
        const original = await page.evaluate(() => JSON.stringify(db.characters));
        const recoveryData = JSON.parse(zlib.gunzipSync(recoveryBytes));
        assert.match(recoveryData.backupManifest.warnings[0], /archives\[0\].data.moments\[0\].comments\[0\].replyToCommentId/);
        await page.locator('#storage-import-file').setInputFiles({ name: 'problem.ee.txt', mimeType: 'text/plain', buffer: recoveryBytes });
        await page.waitForFunction(() => document.getElementById('storage-backup-progress')?.textContent.includes('导入失败，原数据保留'));
        assert.equal(await page.evaluate(() => JSON.stringify(db.characters)), original);
        assert.match(await page.locator('#storage-backup-progress').textContent(), /replyToCommentId/);
        await page.screenshot({ path: path.join(out, 'import-diagnostic.png') });
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ completeApp: true, workerEeTxtRoundtrip: true, tutorialRoundtrip: true, recoveryExport: true, invalidImportPreservesData: true, exactDiagnostic: true, errors }, null, 2));
        console.log('Backup social compatibility browser checks passed');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
