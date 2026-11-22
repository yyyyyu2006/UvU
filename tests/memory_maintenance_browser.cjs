// Whole application, real IndexedDB and UI. Synthetic sources and mocked vectors only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fullApp, root, stableUI } = require('./helpers/full_app_browser.cjs');
(async () => {
    const app = await fullApp();
    try {
        const { page, context, errors } = await app.page(), missing = [];
        page.setDefaultTimeout(7000);
        page.on('response', response => { if (response.url().startsWith(app.origin) && response.status() >= 400) missing.push(response.url()); });
        await page.evaluate(async () => {
            const avatar = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
            const chat = { id: 'maintenance', activeArchiveId: 'a', realName: '测试角色', remarkName: '测试角色', myName: '测试用户', avatar, myAvatar: avatar,
                maxMemory: 2, history: [], memoryJournals: ['相关甲', '相关乙', '无关甲', '无关乙', '删除'].map((title, i) => ({ id: 's' + i, title,
                    content: title + '的合成正文。', range: { start: 0, end: 0 }, createdAt: 1700000000000 + i })),
                autoMemorySettings: { vectorSearchEnabled: true, vectorExternalIndex: true, vectorRetrievalOnly: false, vectorThreshold: .95 } };
            db.characters = [chat]; ensureAllChatArchives();
            db.vectorMemoryApiSettings = { provider: 'newapi', url: 'https://fixture.invalid/v1', key: 'synthetic', embeddingModel: 'fixed' };
            globalThis.maintenanceCalls = [];
            requestMemoryEmbedding = async () => { maintenanceCalls.push('query'); return [1, 0]; };
            requestMemoryEmbeddings = async texts => { maintenanceCalls.push('documents'); return texts.map(text => text.includes('无关') ? [.2, Math.sqrt(.96)] : [.8, .6]); };
            await getVectorMemoryContext(chat, '建立合成索引');
            globalThis.maintenanceScope = VectorMemoryTools.indexScope(chat, vectorMemoryApiFingerprint(resolveVectorMemoryApi()));
            const old = await VectorIndexStore.read(maintenanceScope); await VectorIndexStore.commit('other-maintenance', old.index, 'other');
            chat.memoryJournals.pop(); chat.autoMemorySettings.vectorRetrievalOnly = true;
            maintenanceCalls.length = 0; currentChatId = chat.id; currentChatType = 'private';
            await saveData(); openChatRoom(chat.id, 'private'); openMemoryLibrary();
            globalThis.maintenanceSourceBefore = JSON.stringify([chat.history, chat.memoryJournals, chat.autoMemorySettings]);
        });
        await stableUI(page, '.memory-library');
        await page.locator('.draft-memory-nav [data-view="retrieval"]').click();
        const diag = page.locator('.memory-library-diagnostics'); await diag.locator(':scope > summary').click();
        const calibration = page.locator('.memory-library-calibration'); await calibration.locator(':scope > summary').click();
        for (const query of ['问题甲', '问题乙']) {
            await calibration.getByRole('searchbox', { name: '阈值试查问题' }).fill(query);
            await calibration.getByRole('button', { name: '请求阈值采样', exact: true }).click();
            await assert.doesNotReject(() => calibration.locator(':scope > pre').getByText(/本轮采样 4/).waitFor());
        }
        const sampleRows = calibration.locator(':scope > div > details'); assert.equal(await sampleRows.count(), 8);
        for (let i = 0; i < 8; i++) {
            const row = sampleRows.nth(i); await row.locator(':scope > summary').click();
            const title = await row.locator(':scope > summary').textContent();
            await row.locator('select').selectOption(title.includes('无关') ? 'no' : 'yes');
        }
        await calibration.getByRole('button', { name: '计算阈值建议' }).click();
        assert.match(await calibration.locator(':scope > pre').textContent(), /余弦：当前 0.95 → 建议/);
        assert.match(await calibration.locator(':scope > pre').textContent(), /建议不会自动写入/);
        assert.deepEqual(await page.evaluate(() => maintenanceCalls), ['query', 'query']);
        await page.evaluate(() => { db.vectorMemoryApiSettings.embeddingModel = 'changed-model'; });
        await calibration.getByRole('button', { name: '计算阈值建议' }).click();
        assert.match(await calibration.locator(':scope > pre').textContent(), /旧样本已失效/); assert.equal(await sampleRows.count(), 0);
        await page.evaluate(() => { db.vectorMemoryApiSettings.embeddingModel = 'fixed'; });
        await page.locator('.draft-memory-nav [data-view="options"]').click();
        const cache = page.locator('.memory-library-cache'); await cache.locator(':scope > summary').click();
        const prune = page.locator('.memory-library-prune'); await prune.locator(':scope > summary').click();
        await prune.getByRole('button', { name: '预览当前失效分块' }).click();
        await page.waitForFunction(() => !document.querySelector('.memory-library-prune button:last-child')?.disabled);
        assert.match(await prune.locator('pre').textContent(), /来源删除\/撤销\/不可读 1/);
        const apply = prune.getByRole('button', { name: '清理已预览的失效分块' });
        await apply.click(); // Default fixture dismisses the confirmation.
        assert.equal(await page.evaluate(async () => Object.keys((await VectorIndexStore.read(maintenanceScope)).index).length), 5);
        page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss());
        await page.evaluate(async () => {
            const saved = await VectorIndexStore.read(maintenanceScope);
            await VectorIndexStore.commit(maintenanceScope, saved.index, 'peer-update', undefined, saved.updatedAt);
        });
        await apply.click(); await page.waitForFunction(() => document.querySelector('.memory-library-prune pre')?.textContent.includes('索引已更新'));
        assert.equal(await apply.isDisabled(), true);
        await prune.getByRole('button', { name: '预览当前失效分块' }).click();
        await page.waitForFunction(() => !document.querySelector('.memory-library-prune button:last-child')?.disabled);
        await apply.click(); await page.waitForFunction(() => document.querySelector('.memory-library-prune pre')?.textContent.startsWith('已清理'));
        await page.waitForFunction(() => document.querySelector('.memory-library-cache-list')?.textContent.includes('4 个来源 / 4 块'));
        assert.deepEqual(await page.evaluate(async () => ({ current: Object.keys((await VectorIndexStore.read(maintenanceScope)).index).length,
            other: Object.keys((await VectorIndexStore.read('other-maintenance')).index).length,
            unchanged: JSON.stringify([db.characters[0].history, db.characters[0].memoryJournals, db.characters[0].autoMemorySettings]) === maintenanceSourceBefore })),
            { current: 4, other: 5, unchanged: true });
        const out = path.join(root, 'outputs/memory-review-20261122'); fs.mkdirSync(out, { recursive: true });
        for (const width of [320, 390, 768]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(await page.locator('.memory-library > .feature-dialog-card').first().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            await page.screenshot({ path: path.join(out, `maintenance-${width}.png`) });
        }
        await page.locator('.draft-memory-nav [data-view="retrieval"]').click();
        await page.evaluate(() => { requestMemoryEmbedding = (_text, _config, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { const error = Error('cancelled'); error.name = 'AbortError'; reject(error); }, { once: true })); });
        await calibration.getByRole('searchbox', { name: '阈值试查问题' }).fill('取消测试');
        await calibration.getByRole('button', { name: '请求阈值采样', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.memory-library-calibration button:nth-of-type(2)')?.disabled);
        await calibration.getByRole('button', { name: '取消采样', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.memory-library-calibration > pre')?.textContent.includes('采样已取消'));
        assert.deepEqual(errors, []); assert.deepEqual(missing, []);
        console.log('PASS full app: pre-threshold sample labels+suggestion/no parameter writes, model invalidation, cancel, cleanup preview/dismiss/stale revision/confirm, source and other-scope preservation, read-only retrieval, 320/390/768, no page or local-resource errors.');
        await context.close();
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
