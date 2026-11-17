'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fullApp, stableUI, root } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp(), out = path.join(root, 'outputs/calendar-queue');
    fs.mkdirSync(out, { recursive: true });
    try {
        const { page, errors } = await app.page();
        page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept());
        await page.evaluate(() => {
            document.addEventListener('pointerdown', () => { globalRescueClickCount = 0; globalRescueLastClickTime = 0; }, true);
            window.calendarQueueOriginal = runDataPersistence;
            window.calendarQueueTheme = '.message-bubble{border-radius:22px!important}.voice-bubble .wave{animation-duration:1s}';
            db.globalCss = calendarQueueTheme; applyGlobalCss(calendarQueueTheme);
        });
        const cases = [
            { scope: 'one', remove: false }, { scope: 'future', remove: false },
            { scope: 'one', remove: true }, { scope: 'future', remove: true },
            { scope: 'series', remove: true }, { mood: true, remove: true }
        ];
        for (const [index, sample] of cases.entries()) {
            await page.setViewportSize(index === 0 ? { width: 320, height: 568 } : index === 1 ? { width: 844, height: 390 } : { width: 390, height: 844 });
            await page.evaluate(async ({ index, sample }) => {
                const chat = { id: 'queue-' + index, activeArchiveId: 'one', archives: [{ id: 'one', name: '存档一' }, { id: 'two', name: '存档二' }], realName: '排队测试角色', history: [] };
                db.characters = [chat]; window.calendarQueueChat = chat;
                const C = UvUCalendar, owner = C.owner(chat);
                if (sample.mood) {
                    const mood = await C.saveMood({ owner, date: '2026-11-12', mood: 'happy', note: '原心情' });
                    UvUCalendarUI.editMood(owner, mood.date, mood);
                } else {
                    await C.saveEvent({ owner, title: '原日程', start: '2026-11-12', repeat: 'weekly', except: ['2026-12-03'] });
                    UvUCalendarUI.editEvent(owner, { start: '2026-11-19', end: '2026-11-19' }, C.events(owner, '2026-11-19')[0]);
                }
                window.calendarQueueBefore = JSON.stringify(C.state());
                runDataPersistence = fn => new Promise((resolve, reject) => {
                    window.calendarQueueFlush = () => Promise.resolve().then(fn).then(resolve, reject);
                });
            }, { index, sample });
            const editor = page.locator('#calendar-editor');
            await stableUI(page, '#calendar-editor');
            if (!sample.mood) {
                await editor.locator('.draft-calendar-advanced > summary').click();
                await editor.getByLabel('修改范围', { exact: true }).selectOption(sample.scope);
            }
            if (!sample.remove) await editor.getByLabel('标题', { exact: true }).fill('修改后的日程');
            const action = sample.remove ? editor.getByRole('button', { name: '删除', exact: true }) : editor.locator('button[type=submit]');
            await action.click();
            await page.waitForFunction(() => typeof window.calendarQueueFlush === 'function');
            await page.evaluate(async () => { calendarQueueChat.activeArchiveId = 'two'; await calendarQueueFlush(); });
            await page.waitForFunction(() => /角色|存档/.test(document.querySelector('#calendar-editor .calendar-feedback')?.textContent));
            assert.equal(await editor.isVisible(), true, 'failed save keeps the editor available');
            assert.equal(await page.evaluate(() => JSON.stringify(UvUCalendar.state()) === calendarQueueBefore), true, 'rejected write preserves every calendar record');
            assert.equal(await editor.locator('button[type=submit]').isEnabled(), true);
            if (index < 2) {
                await stableUI(page, '#calendar-editor');
                assert.equal(await editor.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
                assert.equal(await editor.evaluate(e => {
                    const feedback = e.querySelector('.calendar-feedback').getBoundingClientRect();
                    const body = e.querySelector('.calendar-editor-body').getBoundingClientRect();
                    return feedback.top >= body.top && feedback.bottom <= body.bottom + 1;
                }), true, 'failed-save explanation stays inside the visible scroll area');
                await page.screenshot({ path: path.join(out, 'rejected-' + page.viewportSize().width + '.png') });
            }
            await page.evaluate(() => { runDataPersistence = calendarQueueOriginal; calendarQueueChat.activeArchiveId = 'one'; delete window.calendarQueueFlush; });
            await action.click(); await editor.waitFor({ state: 'hidden' });
            const state = await page.evaluate(() => {
                const owner = UvUCalendar.owner(calendarQueueChat), s = UvUCalendar.state();
                return { visible: UvUCalendar.events(owner, '2026-11-19'), next: UvUCalendar.events(owner, '2026-11-26'), excluded: UvUCalendar.events(owner, '2026-12-03'), moods: s.moods.filter(m => m.owner === owner) };
            });
            if (sample.mood) assert.equal(state.moods.length, 0);
            else {
                assert.equal(state.visible.length, sample.remove ? 0 : 1);
                if (!sample.remove) assert.equal(state.visible[0].title, '修改后的日程');
                assert.equal(state.next.length, sample.remove && sample.scope !== 'one' ? 0 : 1);
                assert.equal(state.excluded.length, 0, 'future splits preserve existing exceptions');
            }
        }
        assert.equal(await page.evaluate(() => db.globalCss === calendarQueueTheme), true);
        assert.deepEqual(errors, []);
        console.log('PASS 6 queued edit/delete archive-switch cases, unchanged records, error feedback, retry, recurrence exceptions, narrow/short layouts; page errors: 0');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
