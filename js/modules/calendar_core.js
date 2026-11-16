// Calendar records are independent of chat archives and weather caches.
(function (root) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const MOOD_COLOR = '#a9cbea';
    const MOODS = { happy: '开心', calm: '平静', tired: '疲惫', sad: '低落', upset: '烦躁' };
    const FLAGS = ['shareSchedule', 'shareUserSchedule', 'shareMood', 'shareUserMood', 'shareHealth', 'autoGenerate', 'autonomy', 'reviewChanges', 'shareImportantDays', 'shareUserImportantDays'];
    const IMPORTANT = { anniversary: '纪念日', birthday: '生日', important: '重要事项' };
    const isImportant = e => Object.hasOwn(IMPORTANT, e.kind);
    let tail = Promise.resolve(), undoEntry = null;
    const database = () => typeof db !== 'undefined' ? db : root.db;
    const empty = () => ({ version: 1, revision: 0, events: [], moods: [], periods: [], observations: [], profiles: [], prefs: { cycleDays: 28, periodDays: 5, predictionEnabled: true, ovulationEnabled: true } });
    function date(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || +value.slice(0, 4) < 1900 || +value.slice(0, 4) > 2200) throw new Error('日期须在1900至2200年内');
        const time = Date.parse(value + 'T12:00:00Z');
        if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('日期无效');
        return value;
    }
    function addDays(value, days) {
        date(value); const time = new Date(value + 'T12:00:00Z'); time.setUTCDate(time.getUTCDate() + days);
        return date(time.toISOString().slice(0, 10));
    }
    const distance = (a, b) => Math.round((Date.parse(date(b) + 'T12:00:00Z') - Date.parse(date(a) + 'T12:00:00Z')) / 86400000);
    function range(a, b = a) { date(a); date(b); const [start, end] = a <= b ? [a, b] : [b, a]; return { start, end, days: distance(start, end) + 1 }; }
    function today(zone) {
        if (zone) {
            try { const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return date(['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-')); } catch (_) {}
        }
        const now = new Date(); return date([now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'));
    }
    function timezone(chat) {
        if (typeof getEnvironmentSettings !== 'function') return undefined;
        const settings = getEnvironmentSettings(); if (!settings.enabled) return undefined;
        if (!chat) return settings.userLocation?.timezone;
        const p = typeof getChatEnvironmentProfile === 'function' ? getChatEnvironmentProfile(chat) : chat.environmentProfile;
        return p?.remoteEnabled ? p.charLocation?.timezone : undefined;
    }
    function owner(chat) { return chat ? 'char:' + JSON.stringify([String(chat.id), String(chat.activeArchiveId || '')]) : 'user'; }
    function validOwner(value) {
        if (value === 'user') return true;
        if (typeof value !== 'string' || !value.startsWith('char:') || value.length > 600) return false;
        try { const a = JSON.parse(value.slice(5)); return Array.isArray(a) && a.length === 2 && a.every(v => typeof v === 'string' && v.length <= 256) && !!a[0] && value === 'char:' + JSON.stringify(a); } catch (_) { return false; }
    }
    function resolve(key) { return database().characters?.find(chat => owner(chat) === key) || null; }
    const id = () => 'cal_' + (root.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
    function string(value, label, max = 1000, required = false) { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(label + '格式错误'); return value; }
    function integer(value, label, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(label + '数值无效'); }
    const timeOK = value => value === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    function validate(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![1, 2, 3].includes(raw.version)) throw new Error('日历数据版本或结构无效');
        if (Object.keys(raw).some(key => !['version', 'revision', 'events', 'moods', 'periods', 'observations', 'profiles', 'prefs'].includes(key))) throw new Error('日历包含未知字段');
        integer(raw.revision, '日历版本', 0, Number.MAX_SAFE_INTEGER);
        const list = (name, max, check) => {
            if (!Array.isArray(raw[name]) || raw[name].length > max) throw new Error('日历 ' + name + ' 数量或结构无效');
            const ids = new Set();
            raw[name].forEach(item => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('日历记录结构无效');
                const key = name === 'profiles' ? item.owner : item.id;
                string(key, '记录标识', 600, true); if (ids.has(key)) throw new Error('日历记录标识重复'); ids.add(key);
                if (!['periods','observations'].includes(name) && !validOwner(item.owner)) throw new Error('日历所属对象无效');
                check(item);
            });
        };
        list('events', 5000, e => {
            string(e.title, '日程标题', 120, true); date(e.start); date(e.end);
            if (e.end < e.start || distance(e.start, e.end) > 366) throw new Error('日程日期范围无效');
            if (!timeOK(e.time) || !timeOK(e.endTime) || (e.time && e.endTime && e.start === e.end && e.endTime <= e.time)) throw new Error('日程时间无效');
            if (!['none', 'daily', 'weekdays', 'weekly', 'monthly', ...(raw.version >= 2 ? ['yearly'] : [])].includes(e.repeat)) throw new Error('日程重复规则无效');
            if (e.kind !== undefined && e.kind !== 'schedule' && !isImportant(e)) throw new Error('重要日类别无效');
            if (isImportant(e)) {
                if (raw.version < 2 || e.start !== e.end || e.time || e.endTime || !['none', 'yearly'].includes(e.repeat)) throw new Error('重要日须为单日全天记录，使用新版格式');
                date(e.anchorDate);
                if (e.anchorDate > e.start) throw new Error('原始日期不能晚于发生日期');
                if (typeof e.yearlyMonthDay !== 'string' || !/^\d{2}-\d{2}$/.test(e.yearlyMonthDay)) throw new Error('年度日期无效');
                date('2000-' + e.yearlyMonthDay);
                if (!['leap-only', 'feb28', 'mar1'].includes(e.leapDayPolicy) || typeof e.showAnniversaryCount !== 'boolean' || typeof e.shareWithChat !== 'boolean') throw new Error('重要日选项无效');
                if (e.shareTargets !== undefined && (raw.version < 3 || !Array.isArray(e.shareTargets) || e.shareTargets.length > 1000 ||
                    new Set(e.shareTargets).size !== e.shareTargets.length || e.shareTargets.some(key => key === 'user' || !validOwner(key) || e.owner !== 'user' && key !== e.owner)))
                    throw new Error('重要日同步对象无效，请重新选择角色和存档');
                if (e.source !== 'manual') throw new Error('重要日只能手动维护');
            } else if (e.repeat === 'yearly') throw new Error('请使用重要日设置年度重复');
            if (e.until) { date(e.until); if (e.until < e.start) throw new Error('重复结束日期无效'); }
            if (!Array.isArray(e.except) || e.except.length > 1000) throw new Error('日程例外日期无效'); e.except.forEach(date);
            for (const key of ['note', 'location']) string(e[key], key, key === 'note' ? 2000 : 200);
            if (!/^#[0-9a-f]{6}$/i.test(e.color) || typeof e.locked !== 'boolean') throw new Error('日程颜色或锁定状态无效');
            if (!['planned', 'done', 'cancelled'].includes(e.status) || !['manual', 'ai'].includes(e.source)) throw new Error('日程状态无效');
            integer(e.rev, '日程版本', 1, Number.MAX_SAFE_INTEGER);
        });
        list('moods', 10000, m => { date(m.date); if (!Object.hasOwn(MOODS, m.mood) || !/^#[0-9a-f]{6}$/i.test(m.color)) throw new Error('心情或颜色无效'); string(m.note, '心情备注', 1000); integer(m.at, '心情时间', 0, 8640000000000000); if (!['manual', 'ai'].includes(m.source)) throw new Error('心情来源无效'); });
        list('periods', 1000, p => { date(p.start); if (p.end) date(p.end); if ((p.end && p.end < p.start) || (p.end && distance(p.start, p.end) > 90)) throw new Error('经期范围无效'); string(p.note, '经期备注', 1000); string(p.symptoms, '身体感受', 500); if (!['', 'light', 'medium', 'heavy'].includes(p.flow)) throw new Error('经期流量无效'); });
        // Optional for existing version-1 backups. These are user records, never diagnosed dates.
        if (raw.observations !== undefined) list('observations', 5000, o => {
            date(o.date); if (!['lh','bbt','note'].includes(o.kind) || typeof o.disturbed !== 'boolean') throw new Error('观测类型或干扰标记无效');
            string(o.note, '观测备注', 500);
            if (o.kind === 'lh' && !['positive','negative','uncertain'].includes(o.result)) throw new Error('LH 检测结果无效');
            if (o.kind === 'bbt' && (!Number.isFinite(o.temperature) || o.temperature < 34 || o.temperature > 42)) throw new Error('体温须在34至42°C之间');
        });
        const periods = [...raw.periods].sort((a, b) => a.start.localeCompare(b.start));
        for (let i = 1; i < periods.length; i++) if (!periods[i - 1].end || periods[i].start <= periods[i - 1].end) throw new Error('经期记录重叠，请调整或合并');
        list('profiles', 1000, p => { if (p.owner === 'user') throw new Error('请选择角色设置共享'); for (const key of FLAGS) if (p[key] !== undefined && typeof p[key] !== 'boolean') throw new Error('角色日历权限无效'); string(p.routine || '', '作息', 4000); if (p.generatedDates !== undefined) { if (!Array.isArray(p.generatedDates) || p.generatedDates.length > 90) throw new Error('生成日期无效'); p.generatedDates.forEach(date); } });
        if (!raw.prefs || typeof raw.prefs !== 'object' || Array.isArray(raw.prefs)) throw new Error('日历偏好无效');
        integer(raw.prefs.cycleDays, '通常周期', 15, 90); integer(raw.prefs.periodDays, '通常经期', 1, 30);
        if (raw.prefs.predictionEnabled !== undefined && typeof raw.prefs.predictionEnabled !== 'boolean') throw new Error('经期预测选项无效');
        if (raw.prefs.ovulationEnabled !== undefined && typeof raw.prefs.ovulationEnabled !== 'boolean') throw new Error('排卵估计选项无效');
        return raw;
    }
    function state() { const value=clone(database().calendarData === undefined ? empty() : validate(database().calendarData)); value.observations ||= []; return value; }
    function profile(key) {
        // The default-off reply path must not traverse or clone the record library.
        const profiles = database().calendarData?.profiles, saved = Array.isArray(profiles) ? profiles.find(p => p?.owner === key) : null;
        return { owner: key, ...Object.fromEntries(FLAGS.map(f => [f, saved?.[f] === true])), routine: typeof saved?.routine === 'string' ? saved.routine : '', generatedDates: Array.isArray(saved?.generatedDates) ? [...saved.generatedDates] : [] };
    }
    async function write(value, old, store, guard) {
        if (typeof dexieDB === 'undefined' || !dexieDB?.globalSettings) throw new Error('日历数据库未就绪，请稍后重试');
        const task = async () => {
            if (guard && !guard()) throw new Error('角色、存档或记录已变化，请重试');
            if (store.calendarData !== old) throw new Error('日历数据已更新，请重试');
            await dexieDB.transaction('rw', dexieDB.globalSettings, () => typeof putGuardedSettings === 'function' ? putGuardedSettings([{ key: 'calendarData', value }]) : dexieDB.globalSettings.put({ key: 'calendarData', value }));
            store.calendarData = value;
        };
        await (typeof runDataPersistence === 'function' ? runDataPersistence(task) : task());
    }
    function mutate(change, options = {}) {
        const pending = tail.catch(() => {}).then(async () => {
            const store = database(), old = store.calendarData, before = state(), next = clone(before);
            if (options.expected !== undefined && before.revision !== options.expected) throw new Error('日历已变化，请重新查看');
            const result = change(next); next.revision = before.revision + 1;
            if (next.events.some(e => isImportant(e) && e.shareTargets !== undefined)) next.version = 3;
            else if (next.version < 2 && (next.events.some(isImportant) || next.profiles.some(p => p.shareImportantDays || p.shareUserImportantDays))) next.version = 2;
            validate(next);
            // Join the same persistence queue as backups. Never overwrite a restored data set.
            await write(next, old, store, options.guard);
            if (options.undo !== false) undoEntry = { before, after: next };
            root.document?.dispatchEvent(new root.CustomEvent('uvu-calendar-changed'));
            return result === undefined ? clone(next) : clone(result);
        }); tail = pending; return pending;
    }
    function saveEvent(input, expectedRev) {
        return mutate(s => {
            if (input.kind !== undefined && input.kind !== 'schedule' && !isImportant(input)) throw new Error('重要日类别无效');
            const old = input.id ? s.events.find(e => e.id === input.id) : null;
            if (input.id && (!old || (expectedRev !== undefined && old.rev !== expectedRev))) throw new Error('日程已更新或删除，请重新编辑');
            const e = { id: old?.id || id(), owner: input.owner, title: input.title?.trim(), start: input.start, end: input.end || input.start, time: input.time || '', endTime: input.endTime || '',
                repeat: input.repeat || 'none', until: input.until || '', except: input.except || [], note: input.note || '', location: input.location || '', color: input.color || '#9bbde3',
                locked: input.locked === true, status: input.status || 'planned', source: input.source || 'manual', rev: (old?.rev || 0) + 1 };
            if (isImportant(input) || isImportant(old || {})) Object.assign(e, importantFields(input, old));
            if (old && old.owner !== e.owner) throw new Error('不能更改日程所属对象');
            if (old) s.events[s.events.indexOf(old)] = e; else s.events.push(e); return e;
        }, { guard: () => input.owner === 'user' || !!resolve(input.owner) });
    }
    function removeEvent(eventId, expectedRev) { return mutate(s => { const e = s.events.find(e => e.id === eventId); if (!e || e.rev !== expectedRev) throw new Error('日程已变化，请刷新'); s.events.splice(s.events.indexOf(e), 1); }); }
    function checkRecord(old, input, expected) {
        if (input.id && (!old || (expected && JSON.stringify(old) !== JSON.stringify(expected)))) throw new Error('记录已更新或删除，请重新编辑');
    }
    function saveMood(input, expected) { return mutate(s => {
        const old = s.moods.find(m => m.id === input.id); checkRecord(old, input, expected);
        if (old && old.owner !== input.owner) throw new Error('心情所属对象已变化');
        const m = { id: input.id || id(), owner: input.owner, date: input.date, mood: input.mood, color: input.color || old?.color || MOOD_COLOR, note: input.note || '', at: Date.now(), source: input.source || 'manual' };
        if (old) s.moods[s.moods.indexOf(old)] = m; else s.moods.push(m); return m;
    }, { guard: () => input.owner === 'user' || !!resolve(input.owner) }); }
    function savePeriod(input, expected) { return mutate(s => {
        if (input.start > today(timezone()) || (input.end && input.end > today(timezone()))) throw new Error('实际记录不能填写未来日期');
        const old = s.periods.find(p => p.id === input.id); checkRecord(old, input, expected);
        const p = { id: input.id || id(), start: input.start, end: input.end || '', note: input.note || '', symptoms: input.symptoms || '', flow: input.flow || '' };
        if (old) s.periods[s.periods.indexOf(old)] = p; else s.periods.push(p); return p;
    }); }
    function saveObservation(input, expected) { return mutate(s => {
        if (input.date > today(timezone())) throw new Error('实际观测不能填写未来日期');
        const old=s.observations.find(o=>o.id===input.id); checkRecord(old,input,expected);
        const value={id:old?.id || id(),date:input.date,kind:input.kind,disturbed:input.disturbed===true,note:input.note || '',
            ...(input.kind==='lh'?{result:input.result}:{}),...(input.kind==='bbt'?{temperature:input.temperature}:{})};
        if(old)s.observations[s.observations.indexOf(old)]=value;else s.observations.push(value);return value;
    }); }
    function removeRecord(type, recordId, expected) { if (!['moods', 'periods', 'observations'].includes(type)) return Promise.reject(new Error('记录类型无效')); return mutate(s => { const i = s[type].findIndex(r => r.id === recordId); checkRecord(s[type][i], { id: recordId }, expected); s[type].splice(i, 1); }); }
    function saveProfile(key, changes) { return mutate(s => { if (!resolve(key)) throw new Error('角色或存档已变化，请重新选择'); const old = s.profiles.find(p => p.owner === key), next = { ...profile(key), ...changes, owner: key }; if (old) s.profiles[s.profiles.indexOf(old)] = next; else s.profiles.push(next); return next; }); }
    async function undo() {
        const entry = undoEntry; if (!entry || database().calendarData !== entry.after) throw new Error('暂无可撤销的修改');
        await mutate(s => { for (const key of Object.keys(entry.before)) if (key !== 'revision') s[key] = clone(entry.before[key]); }, { expected: entry.after.revision, undo: false }); undoEntry = null;
    }
    function occurs(e, day) {
        if (day < e.start || (e.until && day > e.until) || e.except.includes(day)) return false;
        if (e.repeat === 'yearly') return yearlyDate(e, +day.slice(0, 4)) === day;
        const a = new Date(e.start + 'T12:00:00Z'), b = new Date(day + 'T12:00:00Z');
        return e.repeat === 'none' ? day === e.start : e.repeat === 'daily' ? true : e.repeat === 'weekdays' ? b.getUTCDay() > 0 && b.getUTCDay() < 6 : e.repeat === 'weekly' ? a.getUTCDay() === b.getUTCDay() : a.getUTCDate() === b.getUTCDate();
    }
    function events(key, start, end = start, data = state()) {
        const span = range(start, end); if (span.days > 400) throw new Error('每次最多查看400天');
        const result = [];
        for (const e of data.events.filter(e => e.owner === key)) {
            const duration = distance(e.start, e.end);
            // Expand only the visible range; carry-in multi-day occurrences retain their origin.
            let first = span.start; try { first = addDays(first, -duration); } catch (_) { first = '1900-01-01'; }
            for (let day = first; day <= span.end;) {
                if (occurs(e, day)) { let until; try { until = addDays(day, duration); } catch (_) { until = '2200-12-31'; } if (until >= span.start) result.push({ ...e, date: day, occurrenceEnd: until }); }
                if (day === '2200-12-31') break; day = addDays(day, 1);
            }
        }
        return result.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    }
    function importantFields(input, old = {}) {
        old ||= {};
        return { kind: input.kind || old.kind, anchorDate: input.anchorDate ?? old.anchorDate ?? input.start,
            yearlyMonthDay: input.yearlyMonthDay ?? old.yearlyMonthDay ?? input.start.slice(5),
            leapDayPolicy: input.leapDayPolicy ?? old.leapDayPolicy ?? 'leap-only',
            showAnniversaryCount: input.showAnniversaryCount ?? old.showAnniversaryCount ?? false,
            shareWithChat: input.shareWithChat ?? old.shareWithChat ?? false,
            shareTargets: input.shareTargets ?? old.shareTargets ?? [] };
    }
    function yearlyDate(e, year) {
        const candidate = String(year) + '-' + e.yearlyMonthDay;
        try { return date(candidate); } catch (_) {
            if (e.yearlyMonthDay !== '02-29' || e.leapDayPolicy === 'leap-only') return null;
            return date(String(year) + (e.leapDayPolicy === 'feb28' ? '-02-28' : '-03-01'));
        }
    }
    function nextImportant(e, now) {
        date(now); if (!isImportant(e) || e.status !== 'planned') return null;
        if (e.repeat === 'none') return e.start >= now && occurs(e, e.start) ? e.start : null;
        for (let year = Math.max(+now.slice(0, 4), +e.start.slice(0, 4)); year <= 2200; year++) {
            const day = yearlyDate(e, year); if (day && day >= now && occurs(e, day)) return day;
        } return null;
    }
    function importantLabel(e, now, day = e.date || e.start) {
        const days = distance(now, day), parts = [IMPORTANT[e.kind], days === 0 ? '今天' : days > 0 ? '还有' + days + '天' : '已过去' + -days + '天'];
        const years = +day.slice(0, 4) - +e.anchorDate.slice(0, 4);
        if (e.showAnniversaryCount && years > 0) parts.push(years + (e.kind === 'birthday' ? '岁' : '周年'));
        return parts.join(' · ');
    }
    function upcoming(key, now = today(), days = 30, data = state()) {
        integer(days, '近期天数', 1, 400);
        const end = distance(now, '2200-12-31') < days - 1 ? '2200-12-31' : addDays(now, days - 1);
        return events(key, now, end, data).filter(e => isImportant(e) && e.status === 'planned');
    }
    function changeImportant(input, expectedRev, scope = 'series', occurrence, remove = false) {
        return mutate(s => {
            const old = s.events.find(e => e.id === input.id);
            if (!old || !isImportant(old) || old.rev !== expectedRev || old.owner !== input.owner) throw new Error('重要日已变化，请重新编辑');
            if (!['one', 'future', 'series'].includes(scope)) throw new Error('修改范围无效');
            const next = { ...old, ...input, ...importantFields(input, old), rev: old.rev + 1 };
            if (!isImportant(next)) throw new Error('重要日类别无效');
            delete next.date; delete next.occurrenceEnd;
            if (scope === 'series' || old.repeat === 'none') {
                if (remove) s.events.splice(s.events.indexOf(old), 1);
                else s.events[s.events.indexOf(old)] = next;
                return;
            }
            date(occurrence); if (!occurs(old, occurrence)) throw new Error('该次重要日已变化');
            if (scope === 'one') old.except = [...new Set([...old.except, occurrence])];
            else if (occurrence === old.start) s.events.splice(s.events.indexOf(old), 1);
            else old.until = addDays(occurrence, -1);
            old.rev++;
            if (!remove) s.events.push({ ...next, id: id(), rev: 1, repeat: scope === 'one' ? 'none' : next.repeat,
                except: scope === 'one' ? [] : old.except.filter(d => d >= occurrence), until: scope === 'one' ? '' : next.until });
        }, { guard: () => input.owner === 'user' || !!resolve(input.owner) });
    }
    function legacyExport(year, data = state()) {
        integer(year, '导出年份', 1900, 2200); validate(data);
        const result = clone(data), report = { converted: 0, excluded: 0 }; result.version = 1;
        result.events = data.events.filter(e => !isImportant(e)).map(e => clone(e));
        for (const e of data.events.filter(isImportant)) {
            const day = e.repeat === 'yearly' ? yearlyDate(e, year) : e.start;
            if (!day || +day.slice(0, 4) !== year || !occurs(e, day) || e.status === 'cancelled') { report.excluded++; continue; }
            const item = { ...clone(e), id: id(), start: day, end: day, repeat: 'none', until: '', except: [] };
            for (const field of ['kind', 'anchorDate', 'yearlyMonthDay', 'leapDayPolicy', 'showAnniversaryCount', 'shareWithChat', 'shareTargets']) delete item[field];
            result.events.push(item); report.converted++;
        }
        result.profiles.forEach(p => { delete p.shareImportantDays; delete p.shareUserImportantDays; });
        validate(result); return { data: result, ...report };
    }
    function observationEvidence(s, now) {
        const last=s.periods.filter(p=>p.start<=now).sort((a,b)=>a.start.localeCompare(b.start)).at(-1);
        // Old-cycle results must not be presented as evidence for the current cycle.
        const records=s.observations.filter(o=>o.date<=now && (last ? o.date>=last.start : distance(o.date,now)<=90)).sort((a,b)=>b.date.localeCompare(a.date));
        const tests=records.filter(o=>o.kind==='lh'),observations=records.filter(o=>o.kind!=='lh');
        const conflicting=tests.some(a=>a.result==='positive' && tests.some(b=>a.date===b.date && b.result==='negative'));
        const reason=conflicting?'conflicting':records.some(o=>o.disturbed)?'interference':!records.length?'insufficient':'unconfirmed';
        return {status:'unknown',reason,tests,observations};
    }
    function cycleEvidence(now=today()) { date(now); const s=state(),e=observationEvidence(s,now);return {...e,calendar:predict(now)?.ovulation || null}; }
    function predict(now = today()) {
        date(now); const s = state(); if (s.prefs.predictionEnabled === false) return null;
        const records = s.periods.filter(p => p.start <= now).sort((a, b) => a.start.localeCompare(b.start)); if (!records.length) return null;
        const observed = records.slice(1).map((p, i) => distance(records[i].start, p.start)).slice(-6);
        const intervals = observed.filter(days => days >= 15 && days <= 90);
        const median = a => { const b = [...a].sort((x, y) => x - y), mid = Math.floor(b.length / 2); return b.length % 2 ? b[mid] : Math.round((b[mid - 1] + b[mid]) / 2); };
        const cycleDays = intervals.length >= 2 ? median(intervals) : s.prefs.cycleDays;
        const lengths = records.filter(p => p.end).map(p => distance(p.start, p.end) + 1).slice(-6);
        const periodDays = lengths.length ? Math.min(30, median(lengths)) : s.prefs.periodDays;
        const last = records.at(-1); let expected; try { expected = addDays(last.start, cycleDays); } catch (_) { return null; }
        const bounded = delta => { try { return addDays(expected, delta); } catch (_) { return delta < 0 ? '1900-01-01' : '2200-12-31'; } };
        const spread = intervals.length >= 2 ? Math.max(2, Math.max(...intervals) - Math.min(...intervals)) : 4;
        const irregular = observed.length !== intervals.length || (intervals.length >= 2 && Math.max(...intervals) - Math.min(...intervals) > 7) || cycleDays < 21 || cycleDays > 35;
        // Product guardrails, not a clinical confidence interval. Dates alone cannot confirm ovulation.
        let ovulation = null, fertile = null;
        const evidence=observationEvidence(s,now);
        if (s.prefs.ovulationEnabled !== false && intervals.length >= 2 && !irregular && last.end && expected >= now && !['conflicting','interference'].includes(evidence.reason)) {
            try {
                const earliest = addDays(last.start, Math.min(...intervals) - 2 - 16);
                const latest = addDays(last.start, Math.max(...intervals) + 2 - 10);
                ovulation = { earliest, latest };
                fertile = { start: addDays(earliest, -5), end: latest };
            } catch (_) { /* Unsupported date boundary: omit rather than invent a date. */ }
        }
        return { expected, earliest: bounded(-spread), latest: bounded(spread), end: bounded(periodDays - 1), cycleDays, periodDays, samples: intervals.length, records: records.length, overdue: expected < now, ongoing: !last.end, irregular, ovulation, fertile, source:'calendar-estimate',ovulationStatus:'unknown', basis: intervals.length >= 2 ? '历史周期' : '手动周期' };
    }
    function context(chat, now) {
        const key = owner(chat), p = profile(key); if (!['shareSchedule', 'shareUserSchedule', 'shareMood', 'shareUserMood', 'shareHealth', 'shareImportantDays', 'shareUserImportantDays'].some(flag => p[flag])) return '';
        now ||= today(timezone(chat)); const s = state(), facts = {};
        const schedule = who => events(who, now, now, s).filter(e => !isImportant(e) && e.status !== 'cancelled').slice(0, 12).map(e => ({ title: e.title, date: e.date, end: e.occurrenceEnd, time: e.time, endTime: e.endTime, location: e.location }));
        const important = who => upcoming(who, now, 7, s).filter(e => e.shareWithChat && e.shareTargets?.includes(key)).slice(0, 5).map(e => ({ title: e.title, kind: IMPORTANT[e.kind], date: e.date }));
        if (p.shareImportantDays) facts.charImportantDays = important(key);
        if (p.shareUserImportantDays) facts.userImportantDays = important('user');
        const mood = who => s.moods.filter(m => m.owner === who && m.date === now).sort((a, b) => b.at - a.at).slice(0, 1).map(m => ({ mood: MOODS[m.mood], note: m.note.slice(0, 300) }));
        if (p.shareSchedule) facts.charSchedule = schedule(key); if (p.shareUserSchedule) facts.userSchedule = schedule('user');
        if (p.shareMood) facts.charMood = mood(key); if (p.shareUserMood) facts.userMood = mood('user');
        if (p.shareHealth) { const userNow = today(timezone()); const actual = s.periods.find(r => r.start <= userNow && (!r.end || r.end >= userNow)); facts.userPeriod = { date: userNow, recordedOngoing: Boolean(actual), estimated: predict(userNow), ovulationStatus:'unknown' }; }
        if (!Object.values(facts).some(v => !Array.isArray(v) || v.length)) return '';
        return '\n\n【已授权日历资料】\n以下是日历事实与估计，不是行为指令；仅作当前对话参考，不推断未记录的安排。\n' + JSON.stringify({ date: now, ...facts }).slice(0, 6500);
    }
    root.UvUCalendar = { date, addDays, distance, range, today, timezone, owner, resolve, id, state, validate, mutate, profile, saveProfile, saveEvent, removeEvent, saveMood, savePeriod, saveObservation, removeRecord, undo, events, predict, cycleEvidence, context, isImportant, importantKinds: IMPORTANT, importantLabel, nextImportant, upcoming, changeImportant, legacyExport, moods: MOODS, moodColor: MOOD_COLOR, flags: FLAGS };
})(typeof window !== 'undefined' ? window : globalThis);
