'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        page.setDefaultTimeout(7000);
        await page.evaluate(() => {
            const originalText = File.prototype.text;
            window.importChecks = { confirms: 0, accept: true, reads: 0, releases: [], jobs: [] };
            window.calendarPersistRunner = runDataPersistence;
            window.confirm = () => { importChecks.confirms++; importChecks.onConfirm?.(); return importChecks.accept; };
            File.prototype.text = function () {
                importChecks.reads++;
                if (this.name.startsWith('delayed')) return new Promise(resolve => importChecks.releases.push(() => originalText.call(this).then(resolve)));
                return originalText.call(this);
            };
            document.addEventListener('click', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
        });
        const panel = () => page.locator('#calendar-preferences');
        const failures = [];
        async function reset() {
            await page.evaluate(async () => {
                for (const id of ['calendar-preferences', 'environment-calendar']) document.getElementById(id)?.dismissForward?.();
                runDataPersistence = calendarPersistRunner;
                db.calendarData = undefined;
                await UvUCalendar.saveEvent({ owner: 'user', title: '原来的日程', start: '2026-11-10' });
                const data = UvUCalendar.state();
                data.events[0].title = '导入的日程';
                data.periods = [{ id: 'test-period', start: '2026-11-01', end: '2026-11-03', flow: '', note: '', symptoms: '' }];
                data.observations = [{ id: 'test-observation', date: '2026-11-09', kind: 'note', disturbed: false, note: '测试记录' }];
                window.importFixture = JSON.stringify(data);
                Object.assign(importChecks, { confirms: 0, accept: true, reads: 0, releases: [], jobs: [], onConfirm: null, writeBlocked: false });
                UvUCalendarUI.open();
            });
            await page.locator('#environment-calendar').getByRole('button', { name: '日历设置', exact: true }).click();
            await page.evaluate(() => {
                const input = document.querySelector('#calendar-preferences input[type="file"]'), run = input.onchange;
                input.onchange = function (event) { const job = run.call(this, event); importChecks.jobs.push(Promise.resolve(job)); return job; };
            });
        }
        async function upload(name = 'calendar.json', text) {
            const body = text ?? await page.evaluate(() => importFixture);
            await panel().locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) });
        }
        async function release() {
            await page.evaluate(async () => { importChecks.releases.forEach(fn => fn()); await Promise.all(importChecks.jobs); });
        }
        const titles = () => page.evaluate(() => UvUCalendar.state().events.map(e => e.title));
        const check = async (name, run) => {
            try { await reset(); await run(); console.log('PASS ' + name); }
            catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
            finally { await release(); }
        };
        await check('正常导入保存全部记录，且可撤销', async () => {
            await upload(); await release();
            assert.deepEqual(await titles(), ['导入的日程']);
            assert.deepEqual(await page.evaluate(async () => {
                const saved = (await dexieDB.globalSettings.get('calendarData')).value;
                return [saved.periods.length, saved.observations.length];
            }), [1, 1]);
            assert.equal(await panel().count(), 0);
            await page.evaluate(() => UvUCalendar.undo());
            assert.deepEqual(await titles(), ['原来的日程']);
        });
        await check('取消替换保留原数据', async () => {
            await page.evaluate(() => importChecks.accept = false);
            await upload(); await release();
            assert.deepEqual(await titles(), ['原来的日程']); assert.equal(await panel().count(), 1);
        });
        await check('关闭面板后旧读取不再确认或覆盖', async () => {
            await upload('delayed-close.json');
            await page.evaluate(() => document.getElementById('calendar-preferences').dismissForward());
            await release();
            assert.equal(await page.evaluate(() => importChecks.confirms), 0);
            assert.deepEqual(await titles(), ['原来的日程']);
        });
        await check('重开同名设置面板后旧读取失效', async () => {
            await upload('delayed-reopen.json');
            await page.evaluate(() => document.getElementById('calendar-preferences').dismissForward());
            await page.locator('#environment-calendar').getByRole('button', { name: '日历设置', exact: true }).click();
            await release();
            assert.equal(await page.evaluate(() => importChecks.confirms), 0);
            assert.deepEqual(await titles(), ['原来的日程']); assert.equal(await panel().count(), 1);
        });
        await check('读取期间新增记录不会被覆盖', async () => {
            await upload('delayed-edit.json');
            await page.evaluate(() => UvUCalendar.saveEvent({ owner: 'user', title: '刚添加的日程', start: '2026-11-11' }));
            await release();
            assert.deepEqual(await titles(), ['原来的日程', '刚添加的日程']);
            assert.equal(await page.evaluate(() => importChecks.confirms), 0);
        });
        await check('相同版本号的数据集替换也使旧读取失效', async () => {
            await upload('delayed-restore.json');
            await page.evaluate(() => { db.calendarData = JSON.parse(JSON.stringify(db.calendarData)); db.calendarData.events[0].title = '恢复的日程'; });
            await release();
            assert.deepEqual(await titles(), ['恢复的日程']);
            assert.equal(await page.evaluate(() => importChecks.confirms), 0);
        });
        await check('并行选择第二个文件不发起重叠导入', async () => {
            await upload('delayed-first.json');
            await upload('second.json');
            await release();
            assert.equal(await page.evaluate(() => importChecks.reads), 1);
            assert.equal(await page.evaluate(() => importChecks.confirms), 1);
        });
        await check('确认时排队的新增记录受到版本检查保护', async () => {
            await page.evaluate(() => { importChecks.onConfirm = () => { importChecks.concurrent = UvUCalendar.saveEvent({ owner: 'user', title: '确认时新增的日程', start: '2026-11-11' }); }; });
            await upload(); await release();
            await page.evaluate(() => importChecks.concurrent);
            assert.deepEqual(await titles(), ['原来的日程', '确认时新增的日程']);
            assert.equal(await panel().count(), 1);
        });
        await check('等待写入时关闭面板也取消替换', async () => {
            await page.evaluate(() => { runDataPersistence = task => new Promise((resolve, reject) => { importChecks.writeBlocked = true; importChecks.releases.push(() => calendarPersistRunner(task).then(resolve, reject)); }); });
            await upload(); await page.waitForFunction(() => importChecks.writeBlocked);
            await page.evaluate(() => document.getElementById('calendar-preferences').dismissForward());
            await release();
            assert.deepEqual(await titles(), ['原来的日程']);
        });
        await check('保存失败可重新选择同一文件重试', async () => {
            await page.evaluate(() => { runDataPersistence = async () => { throw new Error('模拟磁盘保存失败'); }; });
            await upload(); await release();
            assert.deepEqual(await titles(), ['原来的日程']);
            assert.match(await panel().locator('.calendar-feedback').textContent(), /模拟磁盘保存失败/);
            assert.equal(await panel().getByRole('button', { name: '导入记录', exact: true }).isEnabled(), true);
            assert.equal(await panel().locator('input[type="file"]').inputValue(), '');
            await page.evaluate(() => { runDataPersistence = calendarPersistRunner; });
            await upload(); await release();
            assert.deepEqual(await titles(), ['导入的日程']);
        });
        await check('超过8MB的文件读取前拒绝', async () => {
            await upload('oversized.json', ' '.repeat(8 * 1024 * 1024 + 1)); await release();
            assert.equal(await page.evaluate(() => importChecks.reads), 0);
            assert.equal(await page.evaluate(() => importChecks.confirms), 0);
            assert.deepEqual(await titles(), ['原来的日程']);
        });
        await check('无效文件不确认并保留原数据', async () => {
            await upload('invalid.json', '{bad json'); await release();
            assert.equal(await page.evaluate(() => importChecks.confirms), 0);
            assert.deepEqual(await titles(), ['原来的日程']);
            assert.ok((await panel().locator('.calendar-feedback').textContent()).length);
        });
        await check('拒绝结构不符的文件', async () => {
            await upload('invalid-schema.json', '{}'); await release();
            assert.equal(await page.evaluate(() => importChecks.confirms), 0);
            assert.deepEqual(await titles(), ['原来的日程']);
        });
        await check('旧版文件缺少观测字段仍可导入', async () => {
            const data = JSON.parse(await page.evaluate(() => importFixture)); delete data.observations;
            await upload('legacy.json', JSON.stringify(data)); await release();
            assert.deepEqual(await titles(), ['导入的日程']);
            assert.deepEqual(await page.evaluate(() => UvUCalendar.state().observations), []);
        });
        assert.deepEqual(errors, [], '浏览器无未处理异常');
        assert.deepEqual(failures, []);
        console.log('PASS calendar imports: 14 cases');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
