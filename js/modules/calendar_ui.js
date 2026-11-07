(function (root) {
    'use strict';
    const C = () => root.UvUCalendar;
    const node = (tag, text, cls = '') => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const button = (text, action, cls = '') => { const b = node('button', text, cls); b.type = 'button'; b.onclick = action; return b; };
    const iconButton = (name, label, action) => { const b = button('', action, 'calendar-icon-button'); b.setAttribute('aria-label', label); b.title = label; const icon = root.DerivedIcons?.create(name); if (icon) b.append(icon); else b.textContent = label; return b; };
    const colors = ['#171719', '#85a9c7', '#9a8cc1', '#cfac6c', '#91ad99', '#c88d95'];
    const moodPaths = { happy: 'M12 21 Q20 29 28 21', calm: 'M14 24 L26 24', tired: 'M14 25 Q20 22 26 25', sad: 'M12 27 Q20 18 28 27', upset: 'M13 25 L27 25' };
    function face(mood, color = '#171719') {
        const wrap = node('span', undefined, 'calendar-face' + (mood ? ' is-recorded' : ''));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('aria-hidden', 'true');
        const part = (tag, attrs) => { const e = document.createElementNS(svg.namespaceURI, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); };
        part('circle', { cx: 20, cy: 20, r: 19, fill: mood ? color : '#f0f0f3' });
        if (mood) { part('circle', { cx: 14, cy: 15, r: 1.8, fill: '#fff' }); part('circle', { cx: 26, cy: 15, r: 1.8, fill: '#fff' }); part('path', { d: moodPaths[mood] || moodPaths.calm, fill: 'none', stroke: '#fff', 'stroke-width': 2.3, 'stroke-linecap': 'round' }); }
        wrap.append(svg); return wrap;
    }
    function field(form, label, type = 'text', value = '') {
        const row = node('label', label, 'calendar-field'), input = node(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') input.type = type;
        input.value = value; input.setAttribute('aria-label', label); row.append(input); form.append(row); return input;
    }
    function select(form, label, options, value) {
        const row = node('label', label, 'calendar-field'), input = node('select'); input.setAttribute('aria-label', label); for (const [v, t] of options) input.append(new Option(t, v)); input.value = value; row.append(input); form.append(row); return input;
    }
    function check(form, label, value) { const row = node('label', undefined, 'calendar-check'), input = node('input'); input.type = 'checkbox'; input.checked = value; input.setAttribute('aria-label', label); row.append(input, node('span', label)); form.append(row); return input; }
    function editor(title, id = 'calendar-editor') {
        const dialog = createMessageForwardDialog(title, id); dialog.panel.classList.add('calendar-editor', 'uvu-calendar-surface');
        const form = node('form', undefined, 'calendar-editor-body'), status = node('p', '', 'calendar-feedback'); status.setAttribute('aria-live', 'polite');
        const footer = node('footer', undefined, 'calendar-editor-actions'), save = button('保存'); save.type = 'submit'; footer.append(save); dialog.panel.append(form); form.append(status, footer);
        const fields = node('div', undefined, 'calendar-editor-fields'); form.prepend(fields);
        const run = async action => { save.disabled = true; try { await action(); dialog.dismiss(); } catch (e) { status.textContent = e.message; } finally { save.disabled = false; } };
        return { ...dialog, form, fields, footer, status, run };
    }
    function editEvent(key, span, original) {
        const d = editor(original ? '编辑日程' : '添加日程'), e = original || {}, dateSpan = span || { start: e.date || e.start, end: e.occurrenceEnd || e.end };
        const title = field(d.fields, '标题', 'text', e.title || ''), dates = node('div', undefined, 'calendar-fields-row'); d.fields.append(dates);
        title.maxLength = 120; title.required = true;
        const start = field(dates, '开始日期', 'date', dateSpan.start), end = field(dates, '结束日期', 'date', dateSpan.end), times = node('div', undefined, 'calendar-fields-row'); d.fields.append(times);
        const time = field(times, '开始时间', 'time', e.time || ''), endTime = field(times, '结束时间', 'time', e.endTime || '');
        const location = field(d.fields, '地点', 'text', e.location || ''), note = field(d.fields, '备注', 'textarea', e.note || ''); location.maxLength = 200; note.maxLength = 2000; note.rows = 3;
        const repeat = select(d.fields, '重复', [['none', '不重复'], ['daily', '每天'], ['weekdays', '周一至周五'], ['weekly', '每周'], ['monthly', '每月']], e.repeat || 'none');
        const until = field(d.fields, '重复至', 'date', e.until || ''), color = field(d.fields, '颜色', 'color', e.color || '#9bbde3');
        const state = select(d.fields, '状态', [['planned', '待开始'], ['done', '已完成'], ['cancelled', '已取消']], e.status || 'planned');
        const locked = check(d.fields, '锁定，保留手动安排', e.locked || false);
        const scope = original?.repeat !== 'none' && original ? select(d.fields, '修改范围', [['one', '仅本次'], ['future', '此后所有'], ['series', '整个系列']], 'one') : null;
        const valid = () => key === 'user' || C().resolve(key);
        const save = async remove => {
            if (!valid()) throw new Error('角色或存档已变化，请重新选择');
            if (remove && !original) return;
            const updated = { ...e, owner: key, title: title.value, start: start.value, end: end.value, time: time.value, endTime: endTime.value, location: location.value, note: note.value, repeat: repeat.value, until: until.value, color: color.value, locked: locked.checked, status: state.value, source: 'manual' };
            if (scope && scope.value !== 'series') {
                await C().mutate(s => {
                    const old = s.events.find(r => r.id === e.id); if (!old || old.rev !== e.rev) throw new Error('日程已变化，请重新编辑');
                    const occurrence = e.date || e.start;
                    if (scope.value === 'one') old.except = [...new Set([...old.except, occurrence])];
                    else if (occurrence === old.start) s.events.splice(s.events.indexOf(old), 1);
                    else old.until = C().addDays(occurrence, -1);
                    old.rev++;
                    if (!remove) s.events.push({ ...updated, id: C().id(), rev: 1, repeat: scope.value === 'one' ? 'none' : updated.repeat, except: [], until: scope.value === 'one' ? '' : updated.until });
                });
            } else if (remove) await C().removeEvent(e.id, e.rev);
            else {
                // A series editor starts from the original anchor, not the displayed occurrence.
                if (scope?.value === 'series') { const shift = C().distance(e.date, updated.start); updated.start = C().addDays(e.start, shift); updated.end = C().addDays(updated.start, C().distance(start.value, end.value)); }
                await C().saveEvent(updated, e.rev);
            }
        };
        d.form.onsubmit = ev => { ev.preventDefault(); d.run(() => save(false)); };
        if (original) d.footer.prepend(button('删除', () => { if (confirm('删除所选范围内的日程？')) d.run(() => save(true)); }, 'calendar-danger'));
    }
    function editMood(key, date, original) {
        const d = editor('记录心情'); let mood = original?.mood || 'happy', color = original?.color || '#171719';
        const picker = node('div', undefined, 'calendar-mood-picker'); d.fields.append(picker);
        for (const [value, label] of Object.entries(C().moods)) {
            const b = button('', () => { mood = value; paint(); }); b.dataset.mood = value; b.setAttribute('aria-label', label); b.append(face(value), node('span', label)); picker.append(b);
        }
        const palette = node('div', undefined, 'calendar-palette'); d.fields.append(palette);
        colors.forEach(value => { const b = button('', () => { color = value; paint(); }); b.style.backgroundColor = value; b.setAttribute('aria-label', '颜色 ' + value); b.dataset.color = value; palette.append(b); });
        const note = field(d.fields, '心情备注', 'textarea', original?.note || ''); note.maxLength = 1000; note.rows = 3;
        const day = field(d.fields, '日期', 'date', date);
        function paint() { picker.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mood === mood))); palette.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === color))); }
        paint(); d.form.onsubmit = ev => { ev.preventDefault(); d.run(async () => { if (key !== 'user' && !C().resolve(key)) throw new Error('角色或存档已变化'); await C().saveMood({ id: original?.id, owner: key, date: day.value, mood, color, note: note.value }, original); }); };
        if (original) d.footer.prepend(button('删除', () => { if (confirm('删除这条心情？')) d.run(() => C().removeRecord('moods', original.id, original)); }, 'calendar-danger'));
    }
    function editPeriod(span, original) {
        const d = editor('记录经期'), p = original || {};
        const dates = node('div', undefined, 'calendar-fields-row'); d.fields.append(dates);
        const start = field(dates, '开始日期', 'date', p.start || span.start), end = field(dates, '结束日期', 'date', p.end || (!original && span.end <= C().today(C().timezone()) ? span.end : ''));
        start.max = end.max = C().today(C().timezone()); end.disabled = Boolean(original && !p.end); check(d.fields, '尚未结束', end.disabled).onchange = ev => { end.disabled = ev.target.checked; if (ev.target.checked) end.value = ''; };
        const flow = select(d.fields, '流量', [['', '不记录'], ['light', '少量'], ['medium', '适中'], ['heavy', '较多']], p.flow || '');
        const symptoms = field(d.fields, '身体感受', 'text', p.symptoms || ''), note = field(d.fields, '经期备注', 'textarea', p.note || ''); symptoms.maxLength = 500; note.maxLength = 1000; note.rows = 3;
        d.fields.append(node('p', '预测仅作生活记录参考。', 'calendar-muted'));
        d.form.onsubmit = ev => { ev.preventDefault(); d.run(() => C().savePeriod({ id: p.id, start: start.value, end: end.value, flow: flow.value, symptoms: symptoms.value, note: note.value }, original)); };
        if (original) d.footer.prepend(button('删除', () => { if (confirm('删除这段经期记录？')) d.run(() => C().removeRecord('periods', p.id, original)); }, 'calendar-danger'));
    }
    function preferences(key, settingsAction) {
        const d = editor('日历设置', 'calendar-preferences'), s = C().state(), who = C().resolve(key), profile = C().profile(key);
        const general = node('section'); general.append(node('h3', '记录')); d.fields.append(general);
        const cycle = field(general, '通常周期（天）', 'number', s.prefs.cycleDays), length = field(general, '通常经期（天）', 'number', s.prefs.periodDays); cycle.min = 15; cycle.max = 90; length.min = 1; length.max = 30;
        const predictionEnabled = check(general, '显示经期预测', s.prefs.predictionEnabled !== false);
        const controls = {};
        let routine;
        if (who) {
            const automation = node('section'); automation.append(node('h3', (who.remarkName || who.realName || '角色') + ' · 行程')); d.fields.append(automation);
            routine = field(automation, '作息与固定安排', 'textarea', profile.routine); routine.rows = 4; routine.maxLength = 4000; routine.placeholder = '例如：周一到周五上课，晚上散步';
            controls.autoGenerate = check(automation, '自动生成每日行程', profile.autoGenerate);
            controls.autonomy = check(automation, '允许角色调整自己的行程和心情', profile.autonomy);
            automation.append(node('p', '打开日历或聊天后检查；使用当前聊天 API。锁定事项不被 AI 修改。', 'calendar-muted'));
            const sharing = node('section'); sharing.append(node('h3', '允许本角色参考')); d.fields.append(sharing);
            for (const [flag, label] of [['shareSchedule', '分享角色日程'], ['shareUserSchedule', '分享我的日程'], ['shareMood', '分享角色心情'], ['shareUserMood', '分享我的心情'], ['shareHealth', '分享经期状态与预测']]) controls[flag] = check(sharing, label, profile[flag]);
            sharing.append(node('p', '仅此角色当前存档；关闭后停止后续参考。', 'calendar-muted'));
        } else d.fields.append(node('p', '选择角色后，可设置其作息、自动安排和共享。', 'calendar-muted'));
        const actions = node('div', undefined, 'calendar-inline-actions'); d.fields.append(actions);
        actions.append(button('天气与位置', () => settingsAction()), button('导出记录', () => exportRecords(false)), button('导出含经期', () => { if (confirm('导出将包含经期等私人记录，确定继续？')) exportRecords(true); }));
        const upload = node('input'); upload.type = 'file'; upload.accept = '.json'; upload.hidden = true; d.fields.append(upload);
        actions.append(button('导入记录', () => upload.click())); upload.onchange = async () => { try { const f = upload.files[0]; if (!f || f.size > 8 * 1024 * 1024) throw new Error('请选择8MB以内的日历 JSON'); const data = C().validate(JSON.parse(await f.text())); if (confirm('用此文件替换全部日历记录？可在保存后撤销。')) { await C().mutate(s => Object.assign(s, data)); d.dismiss(); } } catch (e) { d.status.textContent = e.message; } };
        const tutorial = node('details'); tutorial.append(node('summary', '使用说明'));
        for (const text of ['点日期查看当天；点“选择范围”再点起止日期，或长按日期后拖动。选区预览不会自动写入记录。', '日程支持重复、锁定和撤销。选择角色后可生成行程，预览核对后保存；自动安排需在本页开启。', '心情模式用表情显示每天最近一次记录；点击日期可查看或修改当天全部记录。经期实色为记录，虚线为预测。', '日历分享卡片会进入选定私聊；持续参考需单独授权。记录只保存在本机，设置备份包含日历与经期，分享备份前请核对。', '网页关闭后不会继续调用 AI，也不保证后台定时提醒。预测不用于避孕或诊断。']) tutorial.append(node('p', text, 'calendar-muted'));
        d.fields.append(tutorial);
        d.form.onsubmit = ev => { ev.preventDefault(); d.run(async () => {
            if (who && C().owner(who) !== key) throw new Error('角色存档已变化，请重新设置');
            await C().mutate(s => { s.prefs = { ...s.prefs, cycleDays: Number(cycle.value), periodDays: Number(length.value), predictionEnabled: predictionEnabled.checked }; if (who) { const p = { ...profile, routine: routine.value, ...Object.fromEntries(Object.entries(controls).map(([flag, el]) => [flag, el.checked])) }; const index = s.profiles.findIndex(p => p.owner === key); if (index >= 0) s.profiles[index] = p; else s.profiles.push(p); } }, { expected: s.revision, guard: () => !who || C().resolve(key) === who });
        }); };
    }
    function exportRecords(health) { const value = C().state(); if (!health) { value.periods = []; value.profiles.forEach(p => p.shareHealth = false); } const a = node('a'), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); a.href = url; a.download = 'uvu-calendar' + (health ? '-private' : '') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    function open() {
        const life = new AbortController(); let weatherController, clockTimer, rangeTimer, edgeTimer, drag = null, suppressClickUntil = 0, paintId = 0;
        let view; try { view = JSON.parse(localStorage.getItem('uvu-calendar-view.v1') || '{}'); } catch (_) { view = {}; }
        const d = createMessageForwardDialog('日历', 'environment-calendar', () => { life.abort(); weatherController?.abort(); clearInterval(clockTimer); clearTimeout(rangeTimer); clearTimeout(edgeTimer); saveView(); });
        d.panel.classList.add('derived-settings', 'environment-calendar', 'uvu-calendar');
        const headerTitle = d.panel.querySelector('.message-forward-header strong'); const home = button('日历', () => { d.dismiss(); switchScreen('home-screen'); }, 'calendar-home'); headerTitle.replaceChildren(home);
        const body = node('div', undefined, 'calendar-body'), top = node('div', undefined, 'calendar-topbar'); d.panel.append(body); body.append(top);
        const side = node('select'); side.setAttribute('aria-label', '日历所属位置'); side.append(new Option('我的日历', 'user')); db.characters.forEach(c => side.append(new Option((c.remarkName || c.realName || c.name || '未命名角色') + ' 的日历', 'character:' + c.id)));
        const settings = iconButton('map-pin', '设置', () => { if (valid()) openEnvironmentSettings(false, chat); }), prefs = iconButton('settings-2', '日历设置', () => preferences(key, () => settings.click()));
        const refresh = iconButton('refresh-cw', '刷新', () => { const loc = place(); if (loc) { const cache = environmentCacheKey('weather', loc, getEnvironmentSettings()); environmentCache.delete(cache); try { const saved = JSON.parse(localStorage.getItem('uvu-environment-cache') || '{}'); delete saved[cache]; localStorage.setItem('uvu-environment-cache', JSON.stringify(saved)); } catch (_) {} } loadWeather(); });
        top.append(side, prefs, settings, refresh);
        let chat = null, key = 'user', archiveId, mode = ['schedule', 'mood', 'period'].includes(view.mode) ? view.mode : 'schedule', selected = C().today(), span = C().range(selected), month = selected.slice(0, 7), rangeMode = false, rangeAnchor = null, holidayData = null;
        if (typeof view.month === 'string') { try { C().date(view.month + '-01'); month = view.month; } catch (_) {} }
        if (typeof view.date === 'string') { try { selected = C().date(view.date); span = C().range(selected); } catch (_) {} }
        side.value = [...side.options].some(o => o.value === view.side) ? view.side : 'user';
        const clock = node('p', '', 'environment-clock calendar-clock'), weather = node('p', '', 'calendar-weather'); body.append(clock, weather);
        const monthCard = node('section', undefined, 'calendar-month-card'), nav = node('div', undefined, 'calendar-month-nav'), title = node('h2');
        const previous = button('‹', () => shiftMonth(-1)), next = button('›', () => shiftMonth(1)), todayButton = button('今天', () => { selected = currentDay(); span = C().range(selected); rangeAnchor = null; month = selected.slice(0, 7); paint(); loadWeather(); });
        previous.setAttribute('aria-label', '上月'); next.setAttribute('aria-label', '下月'); nav.append(title, todayButton, previous, next); monthCard.append(nav);
        const weekdays = node('div', undefined, 'calendar-weekdays'); ['一', '二', '三', '四', '五', '六', '日'].forEach(t => weekdays.append(node('span', t))); monthCard.append(weekdays);
        const grid = node('div', undefined, 'calendar-month'); grid.setAttribute('aria-label', '月份日历'); monthCard.append(grid); body.append(monthCard);
        const rangeBar = node('div', undefined, 'calendar-range-bar'), rangeLabel = node('span', '', 'calendar-range-label'), choose = button('选择范围', () => { rangeMode = !rangeMode; rangeAnchor = null; paint(); }), clear = button('清除', () => { span = C().range(selected); rangeMode = false; rangeAnchor = null; paint(); }); rangeBar.append(rangeLabel, choose, clear); body.append(rangeBar);
        const tabs = node('div', undefined, 'calendar-tabs'); tabs.setAttribute('role', 'tablist');
        const tabButtons = Object.entries({ schedule: '日程', mood: '心情', period: '经期' }).map(([value, text]) => { const b = button(text, () => { mode = value; paint(); }); b.setAttribute('role', 'tab'); b.dataset.mode = value; tabs.append(b); return b; }); body.insertBefore(tabs, monthCard);
        const section = node('section', undefined, 'calendar-detail'), feedback = node('p', '', 'calendar-feedback'); feedback.setAttribute('aria-live', 'polite'); body.append(section, feedback);
        const metadata = node('p', '', 'environment-data-status calendar-muted'), source = node('p', '', 'calendar-muted'), detail = node('p', '', 'calendar-muted'), sources = node('details', undefined, 'calendar-data-details'); sources.append(node('summary', '节假日与数据来源'), detail, metadata, source); body.append(sources);
        const annotation = node('details'), annTitle = node('summary', '本机节假日补注'); annotation.append(annTitle);
        const kind = select(annotation, '显示类型', [['note', '备注'], ['offday', '休息日'], ['workday', '上班日'], ['observance', '节日']], 'note'), note = field(annotation, '补注', 'text'); note.maxLength = 500;
        annotation.append(button('保存补注', () => annotationSave(false)), button('删除补注', () => annotationSave(true))); sources.append(annotation);
        function valid() { return !life.signal.aborted && (!chat || (db.characters.includes(chat) && (chat.activeArchiveId || '') === archiveId)); }
        function place() { const s = getEnvironmentSettings(), p = getChatEnvironmentProfile(chat); return !s.enabled ? null : chat ? p.remoteEnabled ? p.charLocation : null : s.userLocation; }
        function currentDay() { return C().today(place()?.timezone); }
        function saveView() { try { localStorage.setItem('uvu-calendar-view.v1', JSON.stringify({ side: side.value, date: selected, month, mode, scroll: body.scrollTop })); } catch (_) {} }
        function setOwner(reset) { chat = side.value === 'user' ? null : db.characters.find(c => 'character:' + c.id === side.value); if (!chat) side.value = 'user'; key = C().owner(chat); archiveId = chat?.activeArchiveId || ''; if (reset) { selected = currentDay(); span = C().range(selected); month = selected.slice(0, 7); } rangeAnchor = null; paint(); loadWeather(); maybeGenerate(); }
        function shiftMonth(delta) { const a = month.split('-').map(Number), nextMonth = new Date(Date.UTC(a[0], a[1] - 1 + delta, 1)); if (nextMonth.getUTCFullYear() < 1900 || nextMonth.getUTCFullYear() > 2200) return; month = nextMonth.toISOString().slice(0, 7); paint(); loadWeather(); }
        function updateClock() { const loc = place(); clock.textContent = loc ? loc.name + ' · ' + environmentClock(loc, new Date()) + ' · ' + loc.timezone : '本机日历'; const p = getChatEnvironmentProfile(chat), user = getEnvironmentSettings().userLocation; if (chat && loc && user && p.remoteEnabled) { const n = (environmentTimezoneOffset(loc.timezone, new Date()) - environmentTimezoneOffset(user.timezone, new Date())) / 60; clock.textContent += ' · 时差 ' + (n > 0 ? '+' : '') + n + '小时'; } }
        async function loadWeather() {
            weatherController?.abort(); weatherController = new AbortController(); const signal = weatherController.signal, serial = ++paintId, loc = place(); updateClock(); holidayData = null; paintDays();
            if (!loc) { weather.textContent = ''; metadata.textContent = ''; source.textContent = ''; return; }
            weather.textContent = '正在获取天气…'; const year = +month.slice(0, 4), config = getEnvironmentSettings();
            const result = await Promise.allSettled([getEnvironmentWeather(loc, config, signal), getEnvironmentHolidays(loc, year, config, signal)]);
            if (!valid() || serial !== paintId || signal.aborted) return;
            const [w, h] = result;
            weather.textContent = w.status === 'fulfilled' ? w.value.text + ' · ' + w.value.temperature + '℃' : '天气暂不可用';
            metadata.textContent = w.status === 'fulfilled' ? environmentDataStatus(w.value, { kind: 'weather', location: loc }).text : '天气获取失败，可点击刷新';
            if (h.status === 'fulfilled') { holidayData = h.value; source.textContent = environmentDataStatus(h.value, { kind: 'holidays', year, location: loc }).text + ' · ' + (h.value.regionalNote || ''); }
            else source.textContent = '节假日暂未获取，不代表当天没有节日'; paintDays(); paintAnnotation();
        }
        function paintAnnotation() { const loc = place(), annotationData = loc ? getEnvironmentHolidayDisplayNote(loc, selected) : null; kind.value = annotationData?.kind || 'note'; note.value = annotationData?.note || ''; kind.disabled = note.disabled = !loc; const day = holidayData?.days.filter(d => d.date === selected) || []; detail.textContent = selected + ' · ' + (environmentHolidayDisplay(day, annotationData).text || '未记录节假日'); }
        function annotationSave(remove) { try { if (!valid() || !place()) throw new Error('请先选择有效位置'); saveEnvironmentHolidayDisplayNote(place(), selected, remove ? null : { kind: kind.value, note: note.value }); paintDays(); paintAnnotation(); feedback.textContent = remove ? '已删除补注' : '已保存补注'; } catch (e) { feedback.textContent = e.message; } }
        function paint() { if (!valid()) { feedback.textContent = '角色或存档已变化，请重新选择角色'; return; } title.textContent = +month.slice(0, 4) + '年' + +month.slice(5) + '月'; tabButtons.forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode))); rangeLabel.textContent = span.days > 1 ? span.start + '—' + span.end + ' · ' + span.days + '天' : selected; choose.setAttribute('aria-pressed', String(rangeMode)); clear.hidden = span.days === 1 && !rangeMode; grid.classList.toggle('is-range-mode', rangeMode); paintDays(); paintDetail(); paintAnnotation(); saveView(); }
        function paintDays() {
            grid.replaceChildren(); const state = C().state(), first = month + '-01', a = new Date(first + 'T12:00:00Z'), offset = (a.getUTCDay() + 6) % 7, days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate();
            for (let i = 0; i < offset; i++) grid.append(node('span', undefined, 'calendar-empty'));
            const last = month + '-' + String(days).padStart(2, '0'), occurrences = C().events(key, first, last), prediction = mode === 'period' && key === 'user' ? C().predict() : null;
            for (let i = 1; i <= days; i++) {
                const day = month + '-' + String(i).padStart(2, '0'), moods = state.moods.filter(m => m.owner === key && m.date === day).sort((a, b) => b.at - a.at), m = moods[0];
                const b = button('', () => { pick(day); }, 'calendar-day'); b.dataset.date = day;
                b.setAttribute('aria-label', day + (m ? ' ' + C().moods[m.mood] : '')); b.setAttribute('aria-pressed', String(day >= span.start && day <= span.end));
                const disc = mode === 'mood' ? face(m?.mood, m?.color) : node('span', undefined, 'calendar-disc'); b.append(disc, node('span', String(i), 'calendar-day-number'));
                b.classList.toggle('is-today', day === currentDay()); b.classList.toggle('is-selected', day === selected); b.classList.toggle('in-range', day >= span.start && day <= span.end && span.days > 1); b.classList.toggle('range-start', day === span.start); b.classList.toggle('range-end', day === span.end);
                if (mode === 'schedule' && occurrences.some(e => e.status !== 'cancelled' && e.date <= day && e.occurrenceEnd >= day)) b.classList.add('has-event');
                if (mode === 'period' && key === 'user') { const p = state.periods.find(p => p.start <= day && (p.end || currentDay()) >= day); b.classList.toggle('has-period', Boolean(p)); b.classList.toggle('predicted-period', !p && !!prediction && day >= prediction.expected && day <= prediction.end); }
                const local = place(), holidays = holidayData?.days.filter(h => h.date === day) || [], display = environmentHolidayDisplay(holidays, local ? getEnvironmentHolidayDisplayNote(local, day) : null);
                if (display.kind !== 'unknown') { const mark = node('small', ({ offday: '休', workday: '班', observance: '节' })[display.kind] || '注', 'calendar-holiday'); b.append(mark); b.title = display.text; }
                grid.append(b);
            }
        }
        function pick(day) {
            const next = C().range(rangeMode && rangeAnchor ? rangeAnchor : day, day);
            if (next.days > 400) { feedback.textContent = '每次最多选择400天'; return; }
            selected = day; span = next; rangeAnchor = rangeMode && !rangeAnchor ? day : null; paint();
        }
        function paintDetail() {
            section.replaceChildren(); const heading = node('div', undefined, 'calendar-section-heading'); heading.append(node('h3', span.days > 1 ? span.days + '天的记录' : selected)); section.append(heading);
            const actions = node('div', undefined, 'calendar-inline-actions'); section.append(actions);
            actions.append(button(mode === 'mood' ? '记录心情' : mode === 'period' ? '记录经期' : '添加日程', () => { if (!valid()) return; if (mode === 'mood') editMood(key, selected); else if (mode === 'period') { if (key !== 'user') { feedback.textContent = '经期记录属于我的日历'; return; } editPeriod(span); } else editEvent(key, span); }, 'calendar-primary'));
            actions.append(button('撤销', async () => { try { await C().undo(); feedback.textContent = '已撤销'; } catch (e) { feedback.textContent = e.message; } }));
            if (chat && mode === 'schedule') actions.append(button('生成行程', () => generate(false)));
            if (mode === 'period' && key !== 'user') { section.append(node('p', '切换至“我的日历”记录经期。', 'calendar-muted')); return; }
            const s = C().state();
            if (mode === 'schedule') {
                const list = C().events(key, span.start, span.end); if (!list.length) section.append(node('p', '这天留给自由安排。', 'calendar-empty-state'));
                const timeline = node('div', undefined, 'calendar-timeline'); section.append(timeline);
                list.forEach(e => { const row = node('div', undefined, 'calendar-timeline-row'), clock = node('time', (e.date !== selected || span.days > 1 ? e.date.slice(5) + '\n' : '') + (e.time || '全天')), card = button('', () => editEvent(key, { start: e.date, end: e.occurrenceEnd }, e), 'calendar-event-card'); card.style.setProperty('--event-color', e.color); card.append(node('strong', e.title), node('span', [e.location, e.locked ? '已锁定' : '', e.status === 'done' ? '已完成' : e.status === 'cancelled' ? '已取消' : ''].filter(Boolean).join(' · '))); if (e.note) card.append(node('p', e.note)); row.append(clock, card); timeline.append(row); });
                if (chat) actions.append(button('分享当天', () => share(chat, '日程', list.map(e => (e.time || '全天') + ' ' + e.title + (e.location ? ' · ' + e.location : '')).join('\n') || '暂无安排')));
            } else if (mode === 'mood') {
                const owners = key === 'user' ? ['user'] : ['user', key];
                owners.forEach(who => { const group = node('div', undefined, 'calendar-mood-records'); group.append(node('h4', who === 'user' ? '我' : chat.remarkName || chat.realName)); section.append(group); const records = s.moods.filter(m => m.owner === who && m.date >= span.start && m.date <= span.end).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
                    if (!records.length) group.append(node('span', '未记录', 'calendar-muted'));
                    records.forEach(m => { const b = button('', () => editMood(who, m.date, m), 'calendar-mood-record'); b.append(face(m.mood, m.color), node('strong', C().moods[m.mood]), node('span', m.note || m.date)); group.append(b); });
                    if (who !== key) group.append(button('记录我的心情', () => editMood('user', selected)));
                });
                if (chat) actions.append(button('分享我的心情', () => { const m = s.moods.filter(m => m.owner === 'user' && m.date === selected).at(-1); if (!m) { feedback.textContent = '请先记录我的心情'; return; } share(chat, '心情', C().moods[m.mood] + (m.note ? ' · ' + m.note : '')); }));
            } else {
                const p = C().predict(); if (p) { const summary = node('div', undefined, 'calendar-prediction'); summary.append(node('strong', '预计 ' + p.expected), node('p', p.earliest + '—' + p.latest), node('small', p.basis + ' · ' + p.cycleDays + '天' + (p.overdue ? ' · 已超过预计日，等待实际记录' : '') + (p.ongoing ? ' · 当前记录尚未结束' : ''))); section.append(summary); }
                else section.append(node('p', s.prefs.predictionEnabled === false ? '经期预测已关闭。' : '记录开始日期后，显示预计范围。', 'calendar-muted'));
                s.periods.slice().sort((a, b) => b.start.localeCompare(a.start)).forEach(p => { const b = button('', () => editPeriod(span, p), 'calendar-period-record'); b.append(node('strong', p.start + '—' + (p.end || '进行中')), node('span', p.note || p.symptoms)); section.append(b); });
                const shareTarget = node('select'); shareTarget.setAttribute('aria-label', '经期分享给角色'); shareTarget.append(new Option('选择分享角色', '')); db.characters.forEach(c => shareTarget.append(new Option(c.remarkName || c.realName, c.id))); actions.append(shareTarget, button('分享状态', () => { const c = db.characters.find(c => c.id === shareTarget.value); if (!c) { feedback.textContent = '请选择分享角色'; return; } const actual = s.periods.find(p => p.start <= selected && (!p.end || p.end >= selected)); share(c, '经期', (actual ? '已记录经期：' + actual.start + '—' + (actual.end || '进行中') : '该日未记录经期') + (p ? '\n预计下次：' + p.earliest + '—' + p.latest + '（估计）' : '')); }));
            }
        }
        async function share(target, kind, text) { try { if (!valid()) throw new Error('请重新打开日历'); if (!confirm('将' + kind + '卡片发送给“' + (target.remarkName || target.realName) + '”？')) return; const sent = await root.UvUCalendarChat.share(target, { title: kind, date: selected, text }); feedback.textContent = sent ? '已分享' : '当前关系状态下无法分享'; } catch (e) { feedback.textContent = e.message; } }
        async function generate(auto) { if (!chat || !valid() || !root.UvUCalendarAI) return; const target = chat, owner = key; feedback.textContent = '正在安排…'; try { const proposal = await root.UvUCalendarAI.generate(target, auto ? currentDay() : selected, life.signal); if (!valid() || owner !== key) return; if (auto) { await root.UvUCalendarAI.apply(target, proposal); feedback.textContent = root.UvUCalendarAI.status(owner); } else showProposal(target, proposal); } catch (e) { if (valid() && e.name !== 'AbortError') feedback.textContent = e.message; } }
        function maybeGenerate() { if (chat && C().profile(key).autoGenerate && !C().profile(key).generatedDates.includes(currentDay())) generate(true); }
        function showProposal(target, proposal) { const dialog = editor('行程预览', 'calendar-plan-preview'); dialog.fields.append(node('p', '勾选后保存', 'calendar-muted')); const choices = proposal.events.map(e => { const b = check(dialog.fields, (e.time || '全天') + ' ' + e.title, true); return { e, b }; }); if (proposal.mood) dialog.fields.append(node('p', '心情：' + C().moods[proposal.mood.mood], 'calendar-muted')); dialog.form.onsubmit = ev => { ev.preventDefault(); dialog.run(() => root.UvUCalendarAI.apply(target, { ...proposal, events: choices.filter(x => x.b.checked).map(x => x.e) })); }; }
        // Explicit range mode disables touch scrolling only on the grid; ordinary swipes still scroll.
        grid.addEventListener('pointerdown', ev => {
            suppressClickUntil = 0; const day = ev.target.closest('[data-date]')?.dataset.date; if (!day || ev.button > 0) return;
            drag = { id: ev.pointerId, day, x: ev.clientX, y: ev.clientY, active: false, moved: false, before: { selected, span: { ...span }, month, rangeMode, rangeAnchor } };
            const activate = () => { if (!drag) return; rangeMode = true; drag.active = true; rangeAnchor = day; span = C().range(day); selected = day; grid.classList.add('is-range-mode'); grid.setPointerCapture?.(ev.pointerId); };
            if (rangeMode && ev.pointerType !== 'mouse') { /* taps still use start/end selection; activate on movement */ }
            rangeTimer = setTimeout(activate, ev.pointerType === 'mouse' ? 200 : 380);
        });
        grid.addEventListener('pointermove', ev => {
            if (!drag || drag.id !== ev.pointerId) return; const moved = Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 8;
            if (!drag.active && moved) { clearTimeout(rangeTimer); if (rangeMode || ev.pointerType === 'mouse') { drag.active = true; rangeAnchor = drag.day; } else { drag = null; return; } }
            if (!drag?.active) return; ev.preventDefault(); drag.moved = true;
            const day = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-date]')?.dataset.date; if (day) { const next = C().range(rangeAnchor, day); if (next.days > 400) { feedback.textContent = '每次最多选择400天'; return; } selected = day; span = next; rangeLabel.textContent = span.start + '—' + span.end + ' · ' + span.days + '天'; grid.querySelectorAll('[data-date]').forEach(b => { const v = b.dataset.date; b.classList.toggle('in-range', v >= span.start && v <= span.end); b.classList.toggle('range-start', v === span.start); b.classList.toggle('range-end', v === span.end); }); }
            clearTimeout(edgeTimer); const rect = grid.getBoundingClientRect(); if (ev.clientY < rect.top + 8 || ev.clientY > rect.bottom - 8) edgeTimer = setTimeout(() => { if (drag?.active) shiftMonth(ev.clientY < rect.top + 8 ? -1 : 1); }, 650);
        }, { passive: false });
        grid.addEventListener('pointerup', () => { clearTimeout(rangeTimer); clearTimeout(edgeTimer); if (drag?.active) { suppressClickUntil = performance.now() + 250; rangeAnchor = null; paint(); } drag = null; });
        grid.addEventListener('pointercancel', () => { clearTimeout(rangeTimer); clearTimeout(edgeTimer); if (drag?.before) { ({ selected, span, month, rangeMode, rangeAnchor } = drag.before); } drag = null; paint(); });
        grid.addEventListener('click', ev => { if (performance.now() < suppressClickUntil) { suppressClickUntil = 0; ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
        // Prevent the native pan only after a long press activated range selection.
        grid.addEventListener('touchmove', ev => { if (drag?.active && ev.cancelable) ev.preventDefault(); }, { passive: false });
        grid.addEventListener('keydown', ev => { if (ev.key === 'Escape') { rangeMode = false; rangeAnchor = null; span = C().range(selected); paint(); } if (ev.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); rangeMode = true; rangeAnchor ||= selected; const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key]; try { const day = C().addDays(selected, delta), next = C().range(rangeAnchor, day); if (next.days > 400) { feedback.textContent = '每次最多选择400天'; return; } selected = day; span = next; month = selected.slice(0, 7); paint(); grid.querySelector('[data-date="' + selected + '"]')?.focus(); } catch (_) {} } });
        side.onchange = () => { weatherController?.abort(); setOwner(true); };
        document.addEventListener('uvu-calendar-ai-status', ev => { if (valid() && ev.detail.owner === key) feedback.textContent = ev.detail.text; }, { signal: life.signal });
        document.addEventListener('uvu-calendar-changed', () => { if (valid()) paint(); }, { signal: life.signal });
        document.addEventListener('uvu-environment-settings-changed', () => { if (valid()) { loadWeather(); paint(); } }, { signal: life.signal });
        clockTimer = setInterval(() => { if (valid()) updateClock(); }, 30000); body.addEventListener('scroll', saveView, { signal: life.signal, passive: true }); setOwner(false); body.scrollTop = Number(view.scroll) || 0;
    }
    root.UvUCalendarUI = { open, face, editEvent, editMood, editPeriod };
})(window);
