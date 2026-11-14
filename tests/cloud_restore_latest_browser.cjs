'use strict';
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        page.setDefaultTimeout(7000);
        let files = [], requests = [], listingStatus = 200, releaseListing, listingStarted, holdListing = false;
        await page.route('https://api.github.com/repos/fixture/repo/**', async route => {
            const url = new URL(route.request().url());
            requests.push(url);
            assert.equal(route.request().method(), 'GET', 'restore must not upload');
            if (url.pathname.endsWith('/contents/') || !/\.(?:ee|json)$/.test(url.pathname)) {
                if (holdListing) { listingStarted(); await new Promise(resolve => { releaseListing = resolve; }); }
                return route.fulfill({ status: listingStatus, contentType: 'application/json', body: JSON.stringify(files) });
            }
            const id = url.pathname.includes('_200_') ? 'newest' : 'stale';
            const body = JSON.stringify({ modules: { characters: [{ id, realName: id, history: [] }] } });
            return route.fulfill({ contentType: 'application/octet-stream', body: url.pathname.endsWith('.ee') ? gzipSync(body) : body });
        });
        await page.evaluate(() => {
            for (const key of ['guide_search_entry', 'guide_char_gallery']) localStorage.setItem(key, 'true');
            document.addEventListener('click', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            window.cloudChecks = { accept: false, confirmations: [] };
            window.confirm = text => { cloudChecks.confirmations.push(text); return cloudChecks.accept; };
            const restore = GitHubMgr.restoreLatest.bind(GitHubMgr);
            GitHubMgr.restoreLatest = event => { cloudChecks.job = restore(event); return cloudChecks.job; };
            const upload = GitHubMgr.testUpload.bind(GitHubMgr);
            GitHubMgr.testUpload = event => { cloudChecks.uploadJob = upload(event); return cloudChecks.uploadJob; };
            const defer = window.setTimeout;
            window.setTimeout = (callback, delay, ...args) => {
                if (delay === 1500 && String(callback).includes('window.location.reload')) { cloudChecks.reloadScheduled = true; return 0; }
                return defer(callback, delay, ...args);
            };
        });
        async function reset({ prefix = 'backups/user', branch = 'main', cached = 'backups/user_100_old.json' } = {}) {
            requests = []; listingStatus = 200;
            const directory = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/') + 1) : '';
            const name = prefix.slice(prefix.lastIndexOf('/') + 1) || 'AutoBackup';
            files = [100, 200].map(stamp => ({ type: 'file', name: `${name}_${stamp}_id.json`, path: `${directory}${name}_${stamp}_id.json` }));
            await page.evaluate(async ({ prefix, branch, cached }) => {
                db.characters = [{ id: 'original', realName: '原角色', persona: '保留原人设', history: [] }];
                await saveData();
                GitHubMgr.config = { token: 'fixture', repo: 'fixture/repo', fileName: prefix, branch, lastSnapshot: cached, lastSnapshotRepo: 'fixture/repo', lastSnapshotBranch: 'main', auto: false };
                GitHubMgr.persist();
                Object.assign(cloudChecks, { accept: false, confirmations: [], job: null, reloadScheduled: false });
                renderTutorialContent(); switchScreen('tutorial-screen');
            }, { prefix, branch, cached });
        }
        async function restore() {
            await page.locator('#gh-restore-btn').click();
            await page.evaluate(() => cloudChecks.job);
            assert.equal(await page.evaluate(() => GitHubMgr.inFlight), null);
            assert.equal(await page.locator('#gh-restore-btn').textContent(), '恢复最新');
        }
        const confirmation = () => page.evaluate(() => cloudChecks.confirmations.at(-1) || '');
        const original = async () => {
            assert.equal(await page.evaluate(() => db.characters[0].id), 'original');
            assert.equal(await page.evaluate(async () => (await dexieDB.characters.get('original')).persona), '保留原人设');
        };
        await reset(); await restore();
        assert.match(await confirmation(), /user_200_id.json/);
        assert.ok(requests[0].pathname.endsWith('/contents/backups'));
        assert.ok(requests.every(url => url.searchParams.get('ref') === 'main'));
        await original();
        console.log('PASS stale local cache ignored, newest remote offered, cancel preserves live and stored data');

        await reset({ prefix: 'changed/new' }); await restore();
        assert.match(await confirmation(), /changed\/new_200_id.json/);
        assert.ok(requests.every(url => !url.pathname.includes('/contents/backups')));
        console.log('PASS changed backup directory and prefix respected');

        await reset({ branch: 'backup/test' }); await restore();
        assert.ok(requests.every(url => url.searchParams.get('ref') === 'backup/test'));
        console.log('PASS selected branch used for listing and download');

        await reset({ branch: '' }); await restore();
        assert.ok(requests.every(url => !url.searchParams.has('ref')));
        assert.match(await confirmation(), /user_200_id.json/);
        console.log('PASS default branch resolved remotely despite cached branch');

        await reset(); listingStatus = 403; await restore();
        assert.equal(await confirmation(), ''); assert.equal(requests.length, 1); await original();
        console.log('PASS listing failure never falls back to an old cached backup');

        await reset(); holdListing = true;
        const started = new Promise(resolve => { listingStarted = resolve; });
        await page.locator('#gh-restore-btn').click(); await started;
        const savedController = await page.evaluate(() => { window.cloudRestoreController = GitHubMgr.controller; return GitHubMgr.inFlightType; });
        assert.equal(savedController, 'restore');
        try {
            await page.locator('#gh-backup-btn').click(); await page.evaluate(() => cloudChecks.uploadJob);
            assert.equal(await page.evaluate(() => GitHubMgr.controller === cloudRestoreController), true);
            const messages = await page.evaluate(() => [...notificationQueue, document.querySelector('#toast-notification .toast-message').textContent]);
            assert.ok(messages.some(message => /另一个备份任务/.test(message)), JSON.stringify(messages));
            assert.ok(messages.every(message => !/上传成功/.test(message)));
            assert.equal(requests.length, 1);
        } finally { holdListing = false; releaseListing(); await page.evaluate(() => cloudChecks.job); }
        await original();
        console.log('PASS upload during restore is refused without false success or controller replacement');

        await reset();
        files[1] = { type: 'file', name: 'user_200_id.ee', path: 'backups/user_200_id.ee' };
        await page.evaluate(() => { cloudChecks.accept = true; }); await restore();
        assert.match(await confirmation(), /user_200_id.ee/);
        assert.equal(await page.evaluate(() => db.characters[0].id), 'newest');
        assert.equal(await page.evaluate(async () => (await dexieDB.characters.get('newest')).realName), 'newest');
        assert.equal(await page.evaluate(() => cloudChecks.reloadScheduled), true);
        assert.deepEqual(errors, []);
        console.log('PASS confirmed newest .ee snapshot parsed in worker and saved to isolated IndexedDB');
        console.log('PASS 7 cloud restore browser cases');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
