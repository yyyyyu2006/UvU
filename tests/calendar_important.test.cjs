'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture() {
    const c = vm.createContext({ console, Date, Intl, structuredClone, crypto: require('node:crypto').webcrypto, db: { characters: [] }, fail: false, saved: [] }); c.window = c;
    c.dexieDB = { globalSettings: { put: async row => { if (c.fail) throw Error('quota'); c.saved.push(structuredClone(row)); } }, transaction: async (...a) => a.at(-1)() };
    c.runDataPersistence = fn => fn();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/calendar_core.js'), 'utf8'), c);
    c.chat = { id: 'char', activeArchiveId: 'one' }; c.db.characters.push(c.chat); return c;
}
const important = (patch = {}) => ({ owner: 'user', title: '相识', kind: 'anniversary', start: '2020-02-29', repeat: 'yearly', ...patch });
test('important dates upgrade only on save, preserve fields and leave failed migrations untouched', async () => {
    const c = fixture(), C = c.UvUCalendar;
    assert.equal(C.state().version, 1); assert.equal(c.db.calendarData, undefined);
    await C.saveEvent({ owner: 'user', title: '旧日程', start: '2026-11-16' }); const previous = c.db.calendarData;
    assert.equal(previous.version, 1); c.fail = true;
    await assert.rejects(C.saveEvent(important()), /quota/); assert.equal(c.db.calendarData, previous);
    c.fail = false; const e = await C.saveEvent(important()); assert.equal(C.state().version, 3);
    assert.equal(e.anchorDate, '2020-02-29'); assert.equal(e.yearlyMonthDay, '02-29'); assert.equal(e.shareWithChat, false);
    const edited = await C.saveEvent({ ...e, title: '相识日' }, e.rev); assert.equal(edited.leapDayPolicy, 'leap-only');
    assert.equal(C.state().events[0].kind, undefined);
    const data = C.state(); data.version = 999; assert.throws(() => C.validate(data), /版本/);
});
test('yearly dates handle leap policies, century years, exclusions and range bounds', async () => {
    const C = fixture().UvUCalendar; const e = await C.saveEvent(important({ start: '1904-02-29' }));
    assert.equal(C.events('user', '2000-02-29').length, 1); assert.equal(C.events('user', '2100-02-28').length, 0);
    assert.equal(C.events('user', '2026-03-29').length, 0); assert.equal(C.nextImportant(e, '2097-01-01'), '2104-02-29');
    const feb = await C.saveEvent({ ...e, leapDayPolicy: 'feb28' }, e.rev);
    assert.equal(C.events('user', '2100-02-28').length, 1);
    const mar = await C.saveEvent({ ...feb, leapDayPolicy: 'mar1', except: ['2100-03-01'], until: '2101-03-01' }, feb.rev);
    assert.equal(C.nextImportant(mar, '2100-01-01'), '2101-03-01'); assert.equal(C.nextImportant(mar, '2101-03-02'), null);
    assert.equal(C.upcoming('user', '2200-12-31').length, 0);
    assert.throws(() => C.date('1900-02-29'), /日期/); assert.throws(() => C.date('2100-02-29'), /日期/);
});
test('important date validation rejects multi-day timed AI records and invalid options', async () => {
    const C = fixture().UvUCalendar;
    await assert.rejects(C.saveEvent(important({ kind: 'unknown', repeat: 'none' })), /类别/);
    for (const p of [{ end: '2020-03-01' }, { time: '09:00' }, { source: 'ai' }, { kind: 'unknown' }, { yearlyMonthDay: '02-30' }, { shareWithChat: 'yes' }, { leapDayPolicy: 'overflow' }, { repeat: 'monthly' }])
        await assert.rejects(C.saveEvent(important(p)));
    const e = await C.saveEvent(important()); const v1 = C.state(); v1.version = 1; assert.throws(() => C.validate(v1));
    assert.equal(C.importantLabel({ ...e, date: '2024-02-29', showAnniversaryCount: true }, '2024-02-28'), '纪念日 · 还有1天 · 4周年');
    assert.doesNotMatch(C.importantLabel({ ...e, date: '2024-02-29' }, '2024-02-29'), /周年/);
    assert.match(C.importantLabel({ ...e, kind: 'birthday', date: '2024-02-29', showAnniversaryCount: true }, '2024-02-29'), /4岁/);
});
test('recurrence split preserves leap anchor, atomic exceptions and stale editor protection', async () => {
    const c = fixture(), C = c.UvUCalendar; let e = await C.saveEvent(important({ leapDayPolicy: 'feb28' }));
    c.fail = true; await assert.rejects(C.changeImportant({ ...e, start: '2026-03-02', end: '2026-03-02' }, e.rev, 'one', '2026-02-28'), /quota/);
    assert.equal(C.state().events[0].except.length, 0); c.fail = false;
    await C.changeImportant({ ...e, start: '2026-03-02', end: '2026-03-02' }, e.rev, 'one', '2026-02-28');
    assert.equal(C.events('user', '2026-02-28').length, 0); assert.equal(C.events('user', '2026-03-02')[0].anchorDate, '2020-02-29');
    await assert.rejects(C.changeImportant(e, e.rev, 'series'), /变化/);
    await C.undo(); e = C.state().events[0];
    await C.changeImportant({ ...e, start: '2026-02-28', end: '2026-02-28' }, e.rev, 'future', '2026-02-28');
    assert.equal(C.events('user', '2028-02-29').length, 1); assert.equal(C.events('user', '2028-02-28').length, 0);
    assert.equal(C.state().events[1].anchorDate, '2020-02-29');
});
test('important deletion respects one, future and series boundaries with undo', async () => {
    const C = fixture().UvUCalendar; let e = await C.saveEvent(important({ start: '2020-11-16' }));
    await C.changeImportant(e, e.rev, 'one', '2026-11-16', true);
    assert.equal(C.events('user', '2026-11-16').length, 0); assert.equal(C.events('user', '2027-11-16').length, 1);
    await C.undo(); e = C.state().events[0];
    await C.changeImportant(e, e.rev, 'future', '2026-11-16', true);
    assert.equal(C.events('user', '2025-11-16').length, 1); assert.equal(C.events('user', '2027-11-16').length, 0);
    await C.undo(); e = C.state().events[0]; await C.changeImportant(e, e.rev, 'series', undefined, true);
    assert.equal(C.state().events.length, 0); await C.undo(); assert.equal(C.state().events.length, 1);
});

test('legacy schedule sharing never discloses important dates and new sharing requires both permissions', async () => {
    const c = fixture(), C = c.UvUCalendar, owner = C.owner(c.chat);
    let e = await C.saveEvent(important({ start: '2020-11-16', note: 'secret-note', location: 'secret-location' }));
    await C.saveProfile(owner, { shareUserSchedule: true }); assert.equal(C.context(c.chat, '2026-11-16'), '');
    await C.saveProfile(owner, { shareUserImportantDays: true }); assert.equal(C.context(c.chat, '2026-11-16'), '');
    e = await C.saveEvent({ ...e, shareWithChat: true }, e.rev); assert.equal(C.context(c.chat, '2026-11-16'), '', 'legacy permission needs explicit recipient');
    e = await C.saveEvent({ ...e, shareTargets: [owner] }, e.rev); const context = C.context(c.chat, '2026-11-16');
    assert.match(context, /相识/); assert.doesNotMatch(context, /secret-note|secret-location|2020/);
    c.chat.activeArchiveId = 'two'; assert.equal(C.context(c.chat, '2026-11-16'), '');
    Object.defineProperty(c.db.calendarData, 'events', { get() { throw Error('events traversed'); } });
    assert.equal(C.context(c.chat), '');
});
test('explicit recipients isolate characters and archives, survive backups, and revoke without leaking notes', async () => {
 const c=fixture(),C=c.UvUCalendar,other={id:'other',activeArchiveId:'one'};c.db.characters.push(other);
 const a=C.owner(c.chat),b=C.owner(other);for(const key of [a,b])await C.saveProfile(key,{shareUserImportantDays:true});
 let e=await C.saveEvent(important({start:'2020-11-16',shareWithChat:true,shareTargets:[a],note:'PRIVATE'}));
 assert.match(C.context(c.chat,'2026-11-16'),/相识/);assert.equal(C.context(other,'2026-11-16'),'');
 c.chat.activeArchiveId='two';await C.saveProfile(C.owner(c.chat),{shareUserImportantDays:true});assert.equal(C.context(c.chat,'2026-11-16'),'');c.chat.activeArchiveId='one';
 const raw=JSON.parse(JSON.stringify(C.state()));C.validate(raw);await C.mutate(s=>Object.assign(s,raw));assert.match(C.context(c.chat,'2026-11-16'),/相识/);
 e=await C.saveEvent({...e,shareTargets:[b]},e.rev);assert.equal(C.context(c.chat,'2026-11-16'),'');assert.match(C.context(other,'2026-11-16'),/相识/);assert.doesNotMatch(C.context(other,'2026-11-16'),/PRIVATE/);
 await C.undo();assert.match(C.context(c.chat,'2026-11-16'),/相识/);assert.equal(C.context(other,'2026-11-16'),'');
 e=C.state().events[0];await C.saveProfile(a,{shareUserImportantDays:false});assert.equal(C.context(c.chat,'2026-11-16'),'');await C.saveProfile(a,{shareUserImportantDays:true});
 e=await C.saveEvent({...e,shareWithChat:false,shareTargets:[]},e.rev);assert.equal(C.context(c.chat,'2026-11-16'),'');
 for(const shareTargets of ['all',['user'],[a,a],['char:bad'],Array(1001).fill(a),[null]]){const bad=C.state();bad.events[0].shareTargets=shareTargets;assert.throws(()=>C.validate(bad),/同步对象/);}
 const legacy=C.state();delete legacy.events[0].shareTargets;legacy.events[0].shareWithChat=true;assert.doesNotThrow(()=>C.validate(legacy));await C.mutate(s=>Object.assign(s,legacy));assert.equal(C.context(c.chat,'2026-11-16'),'');
 await assert.rejects(C.saveEvent(important({owner:a,shareTargets:[b]})),/同步对象/);
});

test('legacy export expands one year without changing live data and strips new permissions', async () => {
    const C = fixture().UvUCalendar; await C.saveEvent(important({ leapDayPolicy: 'feb28', shareWithChat: true }));
    await C.saveEvent(important({ title: 'cancelled', status: 'cancelled' }));
    await C.saveEvent({ owner: 'user', title: '普通', start: '2026-11-16', repeat: 'weekly' });
    const before = JSON.stringify(C.state()), result = C.legacyExport(2026); assert.equal(result.data.version, 1);
    assert.equal(result.converted, 1); assert.equal(result.excluded, 1); assert.equal(result.data.events.length, 2);
    assert.equal(result.data.events[1].start, '2026-02-28'); assert.equal(result.data.events[1].repeat, 'none');
    assert.equal(result.data.events[1].anchorDate, undefined); assert.equal(JSON.stringify(C.state()), before);
    assert.doesNotThrow(() => C.validate(result.data));
    assert.ok(result.data.events.every(e => ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(e.repeat)));
    assert.ok(result.data.events.every(e => e.kind === undefined));
});
