// UI is isolated from original beautification and chat settings layouts.
function environmentDataStatus(data = {}, options = {}) {
    const now=options.now ?? Date.now(),time=Number(data.fetchedAt),known=Number.isFinite(time) && time>0,age=known?now-time:null;
    const ttl=options.kind==='holidays'?24*3600000:15*60000;
    const status=!known?'unknown':age < -60000?'clock-skew':data.stale || age>=ttl?'stale':'fresh';
    const ageMinutes=known?Math.max(0,Math.floor(age/60000)):null;
    const freshness={unknown:'获取时间未知', 'clock-skew':'获取时间在设备未来，请核对设备时钟',stale:'缓存已过建议时效，请刷新',fresh:'数据在缓存时效内（可能来自缓存）'}[status];
    const location=options.location || {},region=[location.countryCode,location.subdivision].filter(Boolean).join(' / ') || '地区未知';
    const text='来源：'+String(data.source || '未知')+' · 年份：'+(options.year || '以观测时间为准')+' · 地区：'+region+' · 时区：'+(location.timezone || '未知')+' · '+freshness+(known?' · 获取于（设备时间） '+new Date(time).toLocaleString()+' · 约 '+ageMinutes+' 分钟前':'');
    return {status,ageMinutes,text};
}
function environmentNode(tag, text, className = '') {
    const element = document.createElement(tag); element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

// Display-only local annotations; never merged into provider caches or environment prompts.
function environmentHolidayNoteKey(location, date) {
    if (!location?.countryCode || !location?.timezone || !/^\d{4}-\d{2}-\d{2}$/.test(date) || +date.slice(0,4)<1900 || +date.slice(0,4)>2200) throw new Error('请选择有效地区、时区和1900至2200年内的日期');
    const parsed = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date) throw new Error('日期无效');
    return JSON.stringify([location.countryCode, location.subdivision || '', location.timezone, date]);
}
function getEnvironmentHolidayDisplayNote(location, date) {
    try {
        const note=JSON.parse(localStorage.getItem('uvu-holiday-display-notes.v1') || '{}')[environmentHolidayNoteKey(location,date)];
        return note && ['note','offday','workday','observance'].includes(note.kind) && typeof note.note==='string' && note.note.length<=500 ? {kind:note.kind,note:note.note} : null;
    } catch (_) { return null; }
}
function saveEnvironmentHolidayDisplayNote(location, date, note) {
    const key=environmentHolidayNoteKey(location,date);
    if (note && (!['note','offday','workday','observance'].includes(note.kind) || typeof note.note!=='string' || note.note.length>500)) throw new Error('请选择显示类型，备注限500字');
    let saved; try { saved=JSON.parse(localStorage.getItem('uvu-holiday-display-notes.v1') || '{}'); } catch (_) {}
    if (!saved || typeof saved!=='object' || Array.isArray(saved)) saved={};
    if (!note) delete saved[key];
    else { if (!Object.hasOwn(saved,key) && Object.keys(saved).length>=500) throw new Error('本机补注已达500条，请先删除不需要的补注'); saved[key]={kind:note.kind,note:note.note.trim()}; }
    localStorage.setItem('uvu-holiday-display-notes.v1',JSON.stringify(saved));
}
function environmentHolidayDisplay(days, manual) {
    const kind=day=>day.isOffDay?'offday':day.isWorkDay?'workday':'observance';
    const labels={offday:'公共假日／休息日（来源标记）',workday:'调休上班（来源标记）',observance:'节日／纪念日（未标记放假）'};
    let text=days.map(day=>day.name+'（'+labels[kind(day)]+'）').join('；');
    if (manual) text+=(text?'；':'')+'本机手动'+(manual.kind==='note'?'备注':'显示修正：'+{offday:'休息日',workday:'上班日',observance:'节日／纪念日'}[manual.kind])+(manual.note?' · '+manual.note:'')+'（仅日历展示）';
    return {text,kind:manual && manual.kind!=='note'?manual.kind:days.some(day=>day.isOffDay)?'offday':days.some(day=>day.isWorkDay)?'workday':days.length?'observance':'unknown'};
}

function openEnvironmentSettings(forChat = false, selectedChat = null) {
    const chat = selectedChat && db.characters.includes(selectedChat) ? selectedChat : forChat && currentChatType === 'private' ? db.characters.find(item => item.id === currentChatId) : null;
    const archiveId = chat?.activeArchiveId;
    const controller = new AbortController();
    const dialog = createMessageForwardDialog(chat ? '天气与异地模式' : '日历与环境设置', 'environment-settings', () => controller.abort());
    dialog.panel.classList.add('derived-settings');
    const form = environmentNode('form', undefined, 'derived-body'); dialog.panel.appendChild(form);
    form.innerHTML = '<label class="derived-check"><input type="checkbox" name="enabled">开启真实日历与天气</label><p class="derived-help">默认使用内置免密钥服务，无需配置 API 或 MCP。点击“定位并获取天气”即可启用；char 的城市由你设定。公共服务受网络与限流影响，Open-Meteo 免费接口用于非商业用途。</p><details data-service><summary>高级：自定义环境服务</summary><label>环境服务<select name="service"><option value="public">内置免密钥服务（默认）</option><option value="mcp">自定义远程 MCP</option></select></label></details><p class="derived-help">手动选城市或主动授权定位。定位会将坐标发送到所选地区服务；保存位置精度约为城市附近。天气和假日仅在打开界面或启用 AI 感知时查询。</p><section data-place="user"><strong>我的位置</strong></section><section data-chat hidden><label class="derived-check"><input type="checkbox" name="remoteEnabled">开启异地模式</label><section data-place="char"><strong>char 的位置</strong></section><label class="derived-check"><input type="checkbox" name="aiEnabled">允许本角色的 AI 感知真实环境</label><p class="derived-help">独立开关，默认关闭。开启后只在原有系统提示词末尾附加环境资料，不改原提示词正文和世界书位置。增加资料会增加输入用量，也可能影响回复。char 的位置由你设定。</p></section><details data-mcp><summary>MCP 服务与工具配置</summary><label>HTTPS 服务地址<input name="mcpUrl" type="url" placeholder="https://你的服务/mcp"></label><label>访问令牌（按需）<input name="mcpToken" type="password" autocomplete="off"></label><p class="derived-help">服务需允许此 Pages 站点跨域访问，并暴露 Mcp-Session-Id 响应头。支持 JSON／SSE 响应。令牌仅保存在本机及你导出的设置备份中，请勿填写到 GitHub 源码。</p><div data-tools></div><p class="derived-help">结果使用 structuredContent 或 JSON 文本：城市搜索返回 {results:[{name,latitude,longitude,countryCode,timezone,subdivision}]}；逆定位返回同样的单个地点；天气返回 {temperature,text,observedAt}（摄氏度）；节假日返回 {days:[{date,name,isOffDay,counties}]}，日期为 YYYY-MM-DD，counties 为适用行政区代码数组；全国条目省略 counties。</p><button type="button" data-test>测试 MCP 连接和工具</button></details><p class="derived-status" aria-live="polite"></p><footer><button type="submit">保存</button></footer>';
    const fields = form.elements, settings = getEnvironmentSettings(), profile = getChatEnvironmentProfile(chat);
    const centerLabel = environmentNode('label', '复用 MCP 服务中心（可选）'), center = environmentNode('select'); center.name = 'centerServiceId';
    center.appendChild(new Option('原独立 MCP 配置', ''));
    if (window.MCPServices) window.MCPServices.settings().services.forEach(service => center.appendChild(new Option(service.name, service.id)));
    if (settings.mcp.centerServiceId && ![...center.options].some(o => o.value === settings.mcp.centerServiceId)) center.appendChild(new Option('原服务已移除，请重新选择', settings.mcp.centerServiceId));
    centerLabel.appendChild(center); form.querySelector('[data-mcp]').prepend(centerLabel); center.value = settings.mcp.centerServiceId;
    const updateCenter = () => { fields.mcpUrl.parentElement.hidden = !!center.value; fields.mcpToken.parentElement.hidden = !!center.value; };
    center.onchange = updateCenter; updateCenter();
    fields.enabled.checked = settings.enabled; fields.service.value = settings.service;
    fields.mcpUrl.value = settings.mcp.url; fields.mcpToken.value = settings.mcp.token;
    fields.remoteEnabled.checked = profile.remoteEnabled; fields.aiEnabled.checked = profile.aiEnabled;
    const updateService = () => { form.querySelector('[data-mcp]').hidden = fields.service.value !== 'mcp'; };
    fields.service.onchange = updateService; updateService();
    form.querySelector('[data-service]').open = settings.service === 'mcp';
    form.querySelector('[data-chat]').hidden = !chat;
    const status = form.querySelector('.derived-status'), places = { user: settings.userLocation, char: profile.charLocation };
    const toolsArea = form.querySelector('[data-tools]');
    for (const [operation, title] of Object.entries({ search: '城市搜索', reverse: '坐标转地区', weather: '天气', holidays: '节假日' })) {
        const label = environmentNode('label', title + '工具名');
        const name = environmentNode('input'); name.name = 'tool-' + operation; name.value = settings.mcp.tools[operation].name;
        const args = environmentNode('textarea'); args.name = 'args-' + operation; args.rows = 2; args.value = settings.mcp.tools[operation].args;
        label.append(name, environmentNode('span', 'JSON 参数模板'), args); toolsArea.appendChild(label);
    }
    function readSettings() {
        return { enabled: fields.enabled.checked, service: fields.service.value, userLocation: places.user,
            mcp: { centerServiceId: center.value, url: fields.mcpUrl.value.trim(), token: fields.mcpToken.value.trim(), tools: Object.fromEntries(Object.keys(ENVIRONMENT_TOOL_DEFAULTS).map(operation => [operation, { name: fields['tool-' + operation].value.trim(), args: fields['args-' + operation].value }])) } };
    }
    form.querySelector('[data-mcp]').before(form.querySelector('[data-service]'));
    const valid = () => !controller.signal.aborted && (!chat || (db.characters.includes(chat) && chat.activeArchiveId === archiveId));
    async function run(action) {
        if (!valid()) { status.textContent = '窗口已关闭或存档已切换，请重新打开'; return; }
        form.querySelectorAll('button').forEach(button => button.disabled = true);
        try { await action(); }
        catch (error) { if (valid()) status.textContent = error.name === 'AbortError' ? '请求超时或已取消，请重试' : error.message; }
        finally { if (valid()) form.querySelectorAll('button').forEach(button => button.disabled = false); }
    }
    function renderPlace(who) {
        const label = form.querySelector(`[data-current="${who}"]`), place = places[who];
        label.textContent = place ? `${place.name} · ${place.countryCode} · ${place.timezone}` : '尚未选择城市';
        const input = form.querySelector(`[data-place="${who}"] [data-subdivision]`); input.value = place?.subdivision || '';
    }
    for (const who of ['user', 'char']) {
        const section = form.querySelector(`[data-place="${who}"]`);
        const current = environmentNode('p', '', 'derived-help'); current.dataset.current = who;
        const row = environmentNode('div', undefined, 'derived-search');
        const input = environmentNode('input'); input.placeholder = '搜索城市，例如 上海 / Tokyo'; input.setAttribute('aria-label', who === 'user' ? '我的城市' : '角色城市');
        const button = environmentNode('button', '搜索'); button.type = 'button'; row.append(input, button);
        const results = environmentNode('div', undefined, 'derived-city-results');
        const subdivision = environmentNode('label', '行政区代码（可选，如 US-CA；留空仅全国假日）');
        const code = environmentNode('input'); code.dataset.subdivision = ''; code.maxLength = 30; subdivision.appendChild(code);
        code.onchange = () => { if (places[who]) places[who] = { ...places[who], subdivision: code.value.trim().toUpperCase() }; };
        section.append(current, row, results, subdivision); renderPlace(who);
        button.onclick = () => run(async () => {
            status.textContent = '正在搜索城市…';
            const found = await searchEnvironmentCities(input.value, readSettings(), controller.signal);
            if (!valid()) return;
            results.replaceChildren();
            found.forEach(place => {
                const pick = environmentNode('button', `${place.name} · ${place.countryCode} · ${place.timezone}`); pick.type = 'button';
                pick.onclick = () => { places[who] = place; renderPlace(who); results.replaceChildren(); status.textContent = '城市已选择，点击保存生效'; };
                results.appendChild(pick);
            }); status.textContent = found.length ? '请选择搜索结果' : '未找到城市，可尝试英文名称或更大的城市';
        });
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); button.click(); } };
        if (who === 'user') {
            const locate = environmentNode('button', '定位并获取天气'); locate.type = 'button'; locate.dataset.locate = '';
            locate.onclick = () => run(async () => {
                status.textContent = '正在定位并识别地区…'; const place = await locateEnvironmentUser({ ...readSettings(), service: 'public' }, controller.signal);
                if (!valid()) return;
                const next = { ...readSettings(), service: 'public', enabled: true, userLocation: place };
                // This shortcut saves global location only; unsaved character options stay untouched.
                await saveSettings(next, false);
                if (!valid()) return;
                places.user = place; fields.service.value = 'public'; updateService(); fields.enabled.checked = true; renderPlace('user');
                status.textContent = `已定位并启用：${place.name}。正在获取天气…`;
                try {
                    const weather = await getEnvironmentWeather(place, next, controller.signal);
                    if (valid()) status.textContent = `已定位并启用：${place.name} · ${weather.text} · ${weather.temperature}℃。节假日可在日历中查看，无需再点保存。`;
                } catch (error) {
                    if (valid()) status.textContent = `位置已保存并启用；天气暂未获取：${error.message}。可打开日历刷新。`;
                }
            }); section.appendChild(locate);
        }
    }
    form.querySelector('[data-test]').onclick = () => run(async () => {
        const config = readSettings(); config.service = 'mcp'; status.textContent = '正在连接 MCP 并读取工具列表…';
        const state = config.mcp.centerServiceId ? null : await getEnvironmentMcpSession(config, controller.signal);
        const result = config.mcp.centerServiceId ? { tools: await window.MCPServices.discover(config.mcp.centerServiceId, controller.signal, true) } : await environmentMcpRpc(state, 'tools/list', {}, controller.signal);
        const names = (result.tools || []).map(tool => tool.name);
        const missing = Object.entries(config.mcp.tools).filter(([, tool]) => !names.includes(tool.name)).map(([name]) => name);
        if (missing.length) { status.textContent = `连接成功，尚未匹配：${missing.join('、')}。服务工具：${names.join('、')}`; return; }
        const found = await searchEnvironmentCities('Shanghai', config, controller.signal);
        status.textContent = `连接成功，4类工具均存在；搜索得到${found.length}个有效地点`;
    });
    async function saveSettings(next, saveProfile = true) {
        if (next.enabled && !next.userLocation) throw new Error('请先选择或定位你的城市');
        if (saveProfile && chat && fields.remoteEnabled.checked && !places.char) throw new Error('请先选择 char 的城市');
        if (next.service === 'mcp') {
        if (next.mcp.centerServiceId) window.MCPServices.service(next.mcp.centerServiceId);
        else environmentEndpoint(next.mcp.url);
        for (const tool of Object.values(next.mcp.tools)) {
            if (!tool.name) throw new Error('请填写四类 MCP 工具名');
            environmentToolArguments(tool.args, { name: '测试', latitude: 0, longitude: 0, timezone: 'UTC', countryCode: 'CN', subdivision: '', year: 2026 });
        }
        }
        const before = db.environmentSettings; db.environmentSettings = next;
        try {
        if (saveProfile && chat) await saveDerivedChatFields(chat, { environmentProfile: { remoteEnabled: fields.remoteEnabled.checked, aiEnabled: fields.aiEnabled.checked, charLocation: places.char } });
        else await saveData();
        } catch (error) { if (db.environmentSettings === next) { if (before === undefined) delete db.environmentSettings; else db.environmentSettings = before; } throw error; }
        document.dispatchEvent(new CustomEvent('uvu-environment-settings-changed'));
    }
    form.onsubmit = event => {
        event.preventDefault(); run(async () => {
            await saveSettings(readSettings());
            if (valid()) status.textContent = '已保存；位置和服务设置为全局，异地与AI感知按角色存档保存。';
        });
    };
}

function openEnvironmentCalendar() {
    if (window.UvUCalendarUI) return window.UvUCalendarUI.open();
    const controller = new AbortController(); let refreshController, timer;
    const dialog = createMessageForwardDialog('日历与天气', 'environment-calendar', () => { controller.abort(); refreshController?.abort(); clearInterval(timer); });
    dialog.panel.classList.add('derived-settings', 'environment-calendar');
    const body = environmentNode('div', undefined, 'derived-body'); dialog.panel.appendChild(body);
    const toolbar = environmentNode('div', undefined, 'derived-toolbar');
    const settingsButton = environmentNode('button', '设置'), refreshButton = environmentNode('button', '刷新'), side = environmentNode('select');
    let chat = null, archiveId;
    side.setAttribute('aria-label', '日历所属位置');
    side.appendChild(new Option('我的日历', 'user'));
    db.characters.forEach(character => side.appendChild(new Option((character.remarkName || character.realName || character.name || '未命名角色') + ' 的日历', 'character:' + character.id)));
    settingsButton.title='选择城市、行政区与数据服务；不修改日历原始数据。';refreshButton.title='清除当前位置天气缓存并重新获取；节假日使用按年份缓存，失败会保留明确提示。';
    toolbar.append(side, settingsButton, refreshButton); body.appendChild(toolbar);
    const clock = environmentNode('p', '', 'environment-clock'), weather = environmentNode('p', '', 'derived-help'), metadata=environmentNode('p','','derived-help environment-data-status');
    const nav = environmentNode('div', undefined, 'derived-toolbar');
    const previous = environmentNode('button', '上月'), title = environmentNode('strong'), next = environmentNode('button', '下月'), today = environmentNode('button', '今天'); nav.append(previous, title, next, today);
    const grid = environmentNode('div', undefined, 'environment-month'); grid.setAttribute('aria-label', '月份日期');
    const detail = environmentNode('p', '', 'derived-status'), source = environmentNode('p', '', 'derived-help');
    const dataDetails = environmentNode('details', undefined, 'environment-data-details');
    dataDetails.append(environmentNode('summary', '数据来源'), metadata, source);
    body.append(clock, weather, nav, grid, detail, dataDetails);
    const annotation=environmentNode('details'),annotationHeading=environmentNode('summary','本机节日显示补注（可选）'),annotationScope=environmentNode('p','','derived-help'),annotationHelp=environmentNode('p','只保存本机的地区、时区和所选日期；不修改数据源、不进入 AI 感知。来源未标记放假时，节日／纪念日不代表法定休息日。','derived-help');
    const annotationKind=environmentNode('select'),annotationText=environmentNode('textarea'),annotationSave=environmentNode('button','保存本机补注'),annotationDelete=environmentNode('button','删除本机补注'),annotationStatus=environmentNode('p','','derived-status');
    annotationKind.setAttribute('aria-label','本机节日显示类型');annotationText.setAttribute('aria-label','本机节日备注');annotationText.maxLength=500;annotationText.rows=3;annotationText.style.width='100%';annotationText.style.boxSizing='border-box';
    for(const [value,label] of [['note','仅备注，保留来源标记'],['offday','手动显示为休息日'],['workday','手动显示为上班日'],['observance','手动显示为节日／纪念日']])annotationKind.appendChild(new Option(label,value));
    annotationSave.type=annotationDelete.type='button';annotationStatus.setAttribute('aria-live','polite');annotation.append(annotationHeading,annotationHelp,annotationScope,annotationKind,annotationText,annotationSave,annotationDelete,annotationStatus);body.appendChild(annotation);
    let applyAnnotation=()=>{};
    annotationSave.onclick=()=>applyAnnotation(false);annotationDelete.onclick=()=>applyAnnotation(true);
    let year, month, selectedDate, renderId = 0;
    const valid = () => !controller.signal.aborted && (!chat || (db.characters.includes(chat) && chat.activeArchiveId === archiveId));
    function place() {
        const settings = getEnvironmentSettings(), profile = getChatEnvironmentProfile(chat);
        if (!settings.enabled) return null;
        return chat ? (profile.remoteEnabled ? profile.charLocation : null) : settings.userLocation;
    }
    function updateClock() {
        const location = place(), settings = getEnvironmentSettings(), profile = getChatEnvironmentProfile(chat), now = new Date();
        clock.textContent = location ? `${location.name} · ${environmentClock(location, now)}（${location.timezone}）` : '请在设置中开启功能并选择城市';
        if (location && profile.remoteEnabled && settings.userLocation && profile.charLocation) {
            const minutes = environmentTimezoneOffset(profile.charLocation.timezone, now) - environmentTimezoneOffset(settings.userLocation.timezone, now);
            clock.textContent += `\n${minutes === 0 ? (chat?.remarkName || chat?.realName || chat?.name || '角色') + ' 与我时间相同' : (chat?.remarkName || chat?.realName || chat?.name || '角色') + ' 比我' + (minutes > 0 ? '快' : '慢') + Math.abs(minutes / 60).toFixed(2).replace(/\.?0+$/, '') + '小时'}（包含夏令时）`;
        }
    }
    async function render(reset = false) {
        if (!valid()) { detail.textContent = '角色或存档已切换，请重新打开日历'; return; }
        refreshController?.abort(); refreshController = new AbortController();
        const signal = refreshController.signal, id = ++renderId, location = place(); updateClock();
        if (reset || !year) {
            const date = location ? environmentDateParts(location.timezone) : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
            year = +date.year; month = +date.month; selectedDate = location ? environmentDateKey(location.timezone) : '';
        }
        title.textContent = `${year}年${month}月`; grid.replaceChildren(); detail.textContent = ''; source.textContent = ''; metadata.textContent=''; weather.textContent = location ? '正在读取天气…' : '未启用或未配置此方位置；日期仍可浏览';
        ['日', '一', '二', '三', '四', '五', '六'].forEach(day => grid.appendChild(environmentNode('span', day, 'environment-weekday')));
        for (let i = 0; i < new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); i++) grid.appendChild(environmentNode('span'));
        const cells = new Map(), dateKey = location ? environmentDateKey(location.timezone) : '';
        for (let day = 1; day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); day++) {
            const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const cell = environmentNode('button', String(day), 'environment-day'); cell.type = 'button'; cell.dataset.date = key;
            if (key === dateKey) cell.classList.add('is-today');
            cell.onclick = () => { selectedDate = key; selectDay(); }; cells.set(key, cell); grid.appendChild(cell);
        }
        let holidayData = null;
        function paintDay(key) {
            const cell=cells.get(key),days=holidayData?.days.filter(day=>day.date===key) || [],manual=location?getEnvironmentHolidayDisplayNote(location,key):null,display=environmentHolidayDisplay(days,manual);
            cell.querySelectorAll('small').forEach(node=>node.remove());cell.classList.remove('is-offday','is-workday');
            if(display.kind==='offday' || display.kind==='workday')cell.classList.add(display.kind==='offday'?'is-offday':'is-workday');
            cell.title=display.text;if(display.kind!=='unknown')cell.appendChild(environmentNode('small',({offday:'休',workday:'班',observance:'节'})[display.kind] || '注'));
            else if(manual)cell.appendChild(environmentNode('small','注'));
        }
        function selectDay() {
            cells.forEach((cell, key) => cell.classList.toggle('is-selected', key === selectedDate));
            const editable=Boolean(location && selectedDate && cells.has(selectedDate));
            annotationKind.disabled=annotationText.disabled=annotationSave.disabled=annotationDelete.disabled=!editable;
            annotationScope.textContent=editable?`${location.countryCode}${location.subdivision?' / '+location.subdivision:''} · ${location.timezone} · ${selectedDate}（所选地区日期）`:'请启用位置并选择日期';
            const manual=editable?getEnvironmentHolidayDisplayNote(location,selectedDate):null;annotationKind.value=manual?.kind || 'note';annotationText.value=manual?.note || '';annotationStatus.textContent='';
            if (!selectedDate || !cells.has(selectedDate)) return;
            const days = holidayData?.days.filter(day => day.date === selectedDate) || [];
            const display=environmentHolidayDisplay(days,manual);
            detail.textContent = selectedDate + '：' + (display.text || (holidayData ? '此数据源未收录当天的全国／已选行政区节假日' : '节假日数据尚未获取'));
        }
        applyAnnotation=remove=>{try{if(!valid() || !location || !cells.has(selectedDate))throw new Error('请选择地区与日期');saveEnvironmentHolidayDisplayNote(location,selectedDate,remove?null:{kind:annotationKind.value,note:annotationText.value});paintDay(selectedDate);selectDay();annotationStatus.textContent=remove?'已删除本机补注；显示来源标记':'已保存本机补注；仅影响此地区、时区和日期的日历显示';}catch(error){annotationStatus.textContent='保存失败：'+error.message;}};
        cells.forEach((_,key)=>paintDay(key));
        selectDay();
        if (!location) return;
        const config = getEnvironmentSettings();
        const results = await Promise.allSettled([getEnvironmentWeather(location, config, signal), getEnvironmentHolidays(location, year, config, signal)]);
        if (!valid() || id !== renderId || signal.aborted) return;
        const [w, h] = results;
        if (w.status === 'fulfilled') {
            metadata.textContent=environmentDataStatus(w.value,{kind:'weather',location}).text+(w.value.observedAt?' · 提供方观测时间：'+w.value.observedAt:' · 观测时间未提供');
            weather.replaceChildren(environmentNode('span', `${w.value.text} · ${w.value.temperature}℃ · 更新于 ${new Date(w.value.fetchedAt).toLocaleTimeString('zh-CN')} · `));
            if (w.value.source === 'Open-Meteo') {
                const credit = environmentNode('a', 'Open-Meteo'); credit.href = 'https://open-meteo.com/'; credit.target = '_blank'; credit.rel = 'noopener noreferrer'; weather.appendChild(credit);
            } else weather.appendChild(environmentNode('span', w.value.source));
            weather.appendChild(environmentNode('span', '（提供方数据，不代表设备精确实况）'));
        } else {weather.textContent = '天气获取失败，可检查网络／服务后刷新';metadata.textContent='天气获取失败；未将缺少数据视为晴天或零度。';}
        if (h.status === 'fulfilled') {
            holidayData = h.value;
            cells.forEach((_,key)=>paintDay(key));
            source.textContent = '节假日：'+environmentDataStatus(h.value,{kind:'holidays',year,location}).text+'。'+(h.value.regionalNote || '')+' 时间使用设备时钟。数据源可能不含全部地方节日；未收录不等于没有节日。';
        } else source.textContent = `节假日未获取：${h.reason?.message || '服务失败'}；不将失败视为没有节假日。`;
        selectDay();
    }
    settingsButton.onclick = () => { if (valid()) openEnvironmentSettings(false, chat); else detail.textContent = '角色或存档已变化，请重新选择角色'; };
    refreshButton.onclick = () => {
        const location = place();
        if (location) {
            const key = environmentCacheKey('weather', location, getEnvironmentSettings()); environmentCache.delete(key);
            try { const saved = JSON.parse(localStorage.getItem('uvu-environment-cache') || '{}'); delete saved[key]; localStorage.setItem('uvu-environment-cache', JSON.stringify(saved)); } catch (_) { /* Optional cache */ }
        }
        render().catch(error => { detail.textContent = error.message; });
    };
    side.onchange = () => { refreshController?.abort(); ++renderId; chat = side.value.startsWith('character:') ? db.characters.find(item => 'character:' + item.id === side.value) : null; archiveId = chat?.activeArchiveId; if (side.value !== 'user' && !chat) side.value = 'user'; render(true).catch(error => { detail.textContent = error.message; }); };
    previous.onclick = () => { if (year === 1900 && month === 1) return; if (--month < 1) { month = 12; year--; } selectedDate = ''; render().catch(error => { detail.textContent = error.message; }); };
    next.onclick = () => { if (year === 2200 && month === 12) return; if (++month > 12) { month = 1; year++; } selectedDate = ''; render().catch(error => { detail.textContent = error.message; }); };
    today.onclick = () => render(true).catch(error => { detail.textContent = error.message; });
    timer = setInterval(() => { if (valid()) updateClock(); }, 30000);
    document.addEventListener('uvu-environment-settings-changed', () => render(true).catch(error => { detail.textContent = error.message; }), { signal: controller.signal });
    render(true).catch(error => { detail.textContent = error.message; });
}
