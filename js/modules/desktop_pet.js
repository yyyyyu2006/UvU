const desktopPetDefaultArt = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M9 40c0-6 3-11 5-12l-1-13c0-2 3-3 5-1l10 8h8l10-8c2-2 5-1 5 1l-1 13c3 3 5 7 5 12 0 10-9 15-23 15S9 50 9 40Z" fill="#d4e9f2" stroke="#456276" stroke-width="2.5"/><path d="M24 36v2m16-2v2m-11 5q3 4 6 0" fill="none" stroke="#334b5d" stroke-width="2.7" stroke-linecap="round"/><path d="M16 43h4m24 0h4" stroke="#d28c91" stroke-width="2" stroke-linecap="round"/></svg>');
const desktopPetCorners = { br: [1, 1], bl: [0, 1], tr: [1, 0], tl: [0, 0] };
const desktopPetClamp = (value, min, max) => Math.min(max, Math.max(min, value));

function desktopPetPrefs(value) {
    const corner = Object.prototype.hasOwnProperty.call(desktopPetCorners, value?.anchor) ? value.anchor : 'br';
    const position = Array.isArray(value?.position) && value.position.length === 2 && value.position.every(Number.isFinite)
        ? value.position.map(n => desktopPetClamp(n, 0, 1)) : null;
    const image = typeof value?.image === 'string' && value.image.length < 490000 && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value.image) ? value.image : '';
    return { version: 1, enabled: value?.enabled === true, anchor: corner, position, sizePx: Number.isFinite(value?.sizePx) ? desktopPetClamp(value.sizePx, 40, 96) : 56, image };
}

async function desktopPetReadImage(file) {
    if (!file || file.size > 4 * 1024 * 1024) throw new Error('请选择 4 MB 以内的 PNG、JPEG 或 WebP');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const is = (at, ...bytes) => bytes.every((v, i) => header[at + i] === v);
    const type = is(0, 137, 80, 78, 71, 13, 10, 26, 10) ? 'image/png' : is(0, 255, 216, 255) ? 'image/jpeg'
        : is(0, 82, 73, 70, 70) && is(8, 87, 69, 66, 80) ? 'image/webp' : '';
    if (!type) throw new Error('图片格式不支持');
    const url = URL.createObjectURL(new Blob([file], { type }));
    try {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('无法读取这张图片')); image.src = url; });
        const edge = Math.max(image.naturalWidth, image.naturalHeight);
        if (!edge || edge > 4096) throw new Error('图片最长边不能超过 4096 像素');
        const canvas = document.createElement('canvas'), scale = Math.min(1, 512 / edge);
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        let result = canvas.toDataURL('image/webp', 0.86);
        if (result.length > 478000) result = canvas.toDataURL('image/webp', 0.65);
        if (result.length > 478000) throw new Error('图片压缩后仍过大，请换一张');
        return result;
    } finally { URL.revokeObjectURL(url); }
}

async function desktopPetSavePrefs(value, previous) {
    const next = desktopPetPrefs(value);
    await runDataPersistence(async () => {
        if (db.desktopPetSettings !== previous) throw new Error('桌宠设置已变化，请重新打开');
        await dexieDB.transaction('rw', dexieDB.globalSettings, () => putGuardedSettings([{ key: 'desktopPetSettings', value: next }]));
        db.desktopPetSettings = next;
    });
}

function desktopPetApiConfig(raw, needsModel = true) {
    const provider = raw.provider || 'newapi', rawUrl = String(raw.apiUrl || '').trim();
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('请输入完整的 API 地址'); }
    if (!['newapi', 'deepseek', 'claude', 'gemini'].includes(provider)) throw new Error('该服务商不受支持');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入不含账号、查询参数或片段的 HTTP(S) 地址');
    if (BLOCKED_API_DOMAINS.some(domain => rawUrl.includes(domain))) throw new Error('该 API 站点已被屏蔽');
    const key = String(raw.apiKey || '').trim(), model = String(raw.model || '').trim();
    if (!key || (needsModel && !model)) throw new Error(needsModel ? '请填写模型和 API 密钥' : '请填写 API 密钥');
    return { provider, url: url.href.replace(/\/+$/, ''), key, model,
        ...(typeof raw.temperatureEnabled === 'boolean' ? { temperatureEnabled: raw.temperatureEnabled } : {}),
        ...(Number.isFinite(raw.temperature) && raw.temperature >= 0 && raw.temperature <= 2 ? { temperature: raw.temperature } : {}) };
}

function desktopPetApiTarget() {
    if (!document.getElementById('chat-room-screen')?.classList.contains('active')) return null;
    const type = currentChatType;
    if (type !== 'private' && type !== 'group') return null;
    const table = type === 'private' ? 'characters' : 'groups';
    const chat = db[table].find(row => row.id === currentChatId);
    return chat ? { type, table, chat, archive: chat.activeArchiveId, id: chat.id } : null;
}

async function desktopPetCommitApi({ selected, create, destination, apply = true }) {
    const assertTarget = () => {
        const current = desktopPetApiTarget();
        if (destination && (current?.chat !== destination.chat || current?.archive !== destination.archive || current?.type !== destination.type)) {
            throw new Error('当前会话已变化，请重新打开桌宠');
        }
    };
    const result = await runDataPersistence(async () => {
        assertTarget();
        const presets = _getApiPresets(), primary = db.apiSettings;
        const preset = create || (selected && presets.find(p => p && (selected.id ? p.id === selected.id : p === selected)));
        if (selected && !preset) throw new Error('预设已删除，请重新打开菜单');
        if (preset && (!preset.name?.trim() || presets.some(p => p && p !== preset && p.name === preset.name))) throw new Error('预设名称为空或重复，请换一个名称');
        const config = preset ? desktopPetApiConfig(preset.data || {}) : null;
        if (!config && !destination) throw new Error('请选择 API 预设');
        const nextPresets = create ? [...presets, create] : null;
        const nextPrimary = apply && !destination ? { ...primary, ...config } : null;
        const binding = apply && destination ? { exclusiveApiEnabled: !!preset, exclusiveApiPreset: preset?.name || '' } : null;
        const global = dexieDB.globalSettings, table = binding ? dexieDB[destination.table] : null;
        const records = [];
        if (nextPresets) records.push({ key: 'apiPresets', value: nextPresets });
        if (nextPrimary) records.push({ key: 'apiSettings', value: nextPrimary });
        await dexieDB.transaction('rw', table ? [global, table] : [global], async () => {
            // A row read from another tab may no longer name or contain the selected preset.
            if (selected && !nextPresets) await assertPersistedRecordsCurrent(global, [{ key: 'apiPresets' }], 'key');
            if (table) {
                await assertPersistedRecordsCurrent(table, [{ id: destination.id }]);
                assertTarget();
                if (!await table.update(destination.id, binding)) throw new Error('会话尚未保存或已删除，请重新打开');
                stagePersistedRecords(table, [await table.get(destination.id)]);
            }
            assertTarget();
            if (records.length) await putGuardedSettings(records);
        });
        if (nextPresets) db.apiPresets = nextPresets;
        if (nextPrimary) db.apiSettings = nextPrimary;
        if (binding) Object.assign(destination.chat, binding);
        return { created: Boolean(nextPresets), primary: Boolean(nextPrimary) };
    });
    if (result.created) {
        populateApiSelect();
        window.dispatchEvent(new CustomEvent('api-presets-updated'));
    }
    if (result.primary) window.dispatchEvent(new CustomEvent('uvu-primary-api-committed'));
}

function setupDesktopPet() {
    const entry = document.getElementById('uvu-pet-settings-entry');
    if (!entry || !('showModal' in document.createElement('dialog'))) return;
    const phone = document.querySelector('body > .phone-screen');
    const host = document.createElement('div');
    host.id = 'uvu-pet-feature';
    host.innerHTML = `
        <button type="button" id="uvu-pet-button" aria-label="桌宠 API 快捷菜单" aria-controls="uvu-pet-menu" aria-expanded="false" hidden><img alt="" draggable="false"></button>
        <section id="uvu-pet-menu" class="uvu-pet-panel" aria-label="API 快捷切换" hidden></section>
        <dialog id="uvu-pet-settings" class="uvu-pet-panel uvu-pet-dialog" aria-labelledby="uvu-pet-settings-title">
          <form><div class="uvu-pet-head"><h2 id="uvu-pet-settings-title">桌宠设置</h2><button type="button" data-close aria-label="关闭桌宠设置">×</button></div>
          <label class="uvu-pet-inline"><input name="enabled" type="checkbox">显示桌宠</label>
          <div class="uvu-pet-preview"><img alt="桌宠预览"></div>
          <label>图片<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
          <label>大小 <output></output><input name="size" type="range" min="40" max="96" step="1"></label>
          <label>位置<select name="corner"><option value="custom">拖动位置</option><option value="br">右下</option><option value="bl">左下</option><option value="tr">右上</option><option value="tl">左上</option></select></label>
          <p class="uvu-pet-status" role="status"></p>
          <div class="uvu-pet-actions"><button type="button" data-reset>恢复默认外观</button><button class="uvu-pet-primary">保存</button></div></form>
        </dialog>
        <dialog id="uvu-pet-api-dialog" class="uvu-pet-panel uvu-pet-dialog" aria-labelledby="uvu-pet-api-title">
          <form><div class="uvu-pet-head"><h2 id="uvu-pet-api-title">新建 API</h2><button type="button" data-close aria-label="取消新建 API">×</button></div>
          <p class="uvu-pet-status" data-destination></p>
          <label>预设名称<input name="label" required maxlength="80" autocomplete="off"></label>
          <label>服务商<select name="provider"></select></label>
          <label>API 地址<input name="apiUrl" type="url" required maxlength="2048" autocomplete="off" placeholder="https://"></label>
          <label>模型<input name="model" list="uvu-pet-models" required maxlength="256" autocomplete="off"></label><datalist id="uvu-pet-models"></datalist>
          <label>API 密钥<input name="apiKey" type="password" required autocomplete="new-password" maxlength="8192"></label>
          <p class="uvu-pet-status" role="status"></p>
          <button type="button" data-api-test>测试连接并读取模型</button>
          <div class="uvu-pet-actions"><button name="saveOnly" value="save">保存为预设</button><button name="apply" class="uvu-pet-primary" value="apply">保存并切换</button></div></form>
        </dialog>`;
    document.body.append(host);
    const [button, menu, settings, apiDialog] = host.children, icon = button.firstElementChild;
    const form = settings.querySelector('form'), fields = form.elements, preview = form.querySelector('img');
    for (const image of [icon, preview]) image.onerror = () => {
        if (image.getAttribute('src') && image.getAttribute('src') !== desktopPetDefaultArt) image.src = desktopPetDefaultArt;
    };
    const apiForm = apiDialog.querySelector('form'), apiFields = apiForm.elements, apiStatus = apiForm.querySelector('[role=status]');
    const apiTest = apiForm.querySelector('[data-api-test]'), modelChoices = apiForm.querySelector('datalist');
    const providerOptions = document.getElementById('api-provider')?.options;
    for (const option of providerOptions || []) apiFields.provider.add(new Option(option.textContent, option.value));
    let draftImage = '', draftPosition, draftPrevious, imageRead = 0, draftBusy = false;
    let active = false, frame = 0, gesture = null, draggedClick = false, openScreen = null;
    let scope, menuTarget, formTarget, apiBusy = false, testRequest;
    const nativePopover = typeof menu.showPopover === 'function';
    const screen = () => phone.querySelector('.screen.active');
    const screenObserver = new MutationObserver(records => {
        if (!records.some(({ target }) => target instanceof Element && (target === host || target === phone || target.matches('.screen,.modal-overlay,.action-sheet-overlay,[role="dialog"],.settings-sidebar,.vc-incoming-overlay,.vc-type-modal,.vc-scene,.message-input-area,#global-bottom-nav')))) return;
        if (openScreen && openScreen !== screen()) closeMenu(false);
        if (gesture && gesture.screen !== screen()) finishDrag(null, false);
        schedule();
    });
    const menuOpen = () => nativePopover ? menu.matches(':popover-open') : !menu.hidden;
    function closeMenu(focus = true) {
        if (!menuOpen()) return;
        if (nativePopover) menu.hidePopover(); else menu.hidden = true;
        openScreen = null;
        button.setAttribute('aria-expanded', 'false');
        if (focus && !button.hidden) button.focus({ preventScroll: true });
    }
    function limits(size) {
        const view = window.visualViewport, left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
        const width = view?.width || innerWidth, height = view?.height || innerHeight;
        const bounds = phone.getBoundingClientRect(), edge = 10;
        const xmin = Math.max(bounds.left, left) + edge, xmax = Math.min(bounds.right, left + width) - edge - size;
        const ymin = Math.max(bounds.top, top) + edge, bottom = Math.min(bounds.bottom, top + height) - edge;
        let ymax = bottom - size;
        for (const el of [screen()?.querySelector('.message-input-area'), document.getElementById('global-bottom-nav')]) {
            const box = el?.getBoundingClientRect();
            if (box?.height && box.top > ymin && box.top < bottom && getComputedStyle(el).visibility !== 'hidden') ymax = Math.min(ymax, box.top - edge - size);
        }
        return { xmin, xmax, ymin, ymax, bottom, right: Math.min(bounds.right, left + width) - edge };
    }
    function place() {
        frame = 0;
        if (!active) return;
        if (apiDialog.open) {
            const viewport = window.visualViewport;
            apiDialog.style.maxHeight = `${Math.max(0, (viewport?.height || innerHeight) - 24)}px`;
            apiDialog.style.insetBlockStart = `${viewport?.offsetTop || 0}px`;
        }
        const prefs = desktopPetPrefs(db.desktopPetSettings), size = Math.max(44, prefs.sizePx), box = limits(size);
        const covered = host.hasAttribute('inert') || settings.open || apiDialog.open || !!document.fullscreenElement ||
            !!phone.querySelector('.modal-overlay.visible,.modal-overlay.open,.action-sheet-overlay.visible,.action-sheet-overlay.open,.settings-sidebar.open,.vc-incoming-overlay.visible,.vc-type-modal.visible,.vc-scene:not(.vc-hidden)');
        button.hidden = Boolean(covered || box.xmax < box.xmin || box.ymax < box.ymin);
        if (button.hidden) { closeMenu(false); finishDrag(null, false); return; }
        const [rx, ry] = prefs.position || desktopPetCorners[prefs.anchor];
        const x = gesture?.dragging ? gesture.x : box.xmin + rx * (box.xmax - box.xmin);
        const y = gesture?.dragging ? gesture.y : box.ymin + ry * (box.ymax - box.ymin);
        button.style.left = `${desktopPetClamp(x, box.xmin, box.xmax)}px`;
        button.style.top = `${desktopPetClamp(y, box.ymin, box.ymax)}px`;
        if (menuOpen()) {
            const rect = button.getBoundingClientRect(), gap = 8;
            menu.style.width = `${Math.min(224, box.right - box.xmin)}px`;
            const below = box.ymax + size - rect.bottom - gap, above = rect.top - box.ymin - gap;
            const openBelow = below >= above;
            menu.style.maxHeight = `${Math.max(0, openBelow ? below : above)}px`;
            menu.style.left = `${desktopPetClamp(rect.right - menu.offsetWidth, box.xmin, box.right - menu.offsetWidth)}px`;
            menu.style.top = `${openBelow ? rect.bottom + gap : rect.top - gap - menu.offsetHeight}px`;
            if (Math.max(below, above) < 72) {
                menu.style.top = `${box.ymin}px`;
                menu.style.maxHeight = `${box.ymax + size - box.ymin}px`;
            }
        }
    }
    function schedule() { if (!frame && active) frame = requestAnimationFrame(place); }
    function refresh() {
        const prefs = desktopPetPrefs(db.desktopPetSettings), size = Math.max(44, prefs.sizePx);
        if (prefs.enabled) icon.src = prefs.image || desktopPetDefaultArt; else icon.removeAttribute('src');
        button.style.setProperty('--uvu-pet-size', `${prefs.sizePx}px`);
        button.style.width = button.style.height = `${size}px`;
        if (active !== prefs.enabled) {
            active = prefs.enabled;
            if (active) {
                screenObserver.observe(phone, { subtree: true, attributes: true, attributeFilter: ['class', 'style'], childList: true });
                screenObserver.observe(host, { attributes: true, attributeFilter: ['inert'] });
                window.addEventListener('resize', schedule);
                window.visualViewport?.addEventListener('resize', schedule);
                window.visualViewport?.addEventListener('scroll', schedule);
                document.addEventListener('fullscreenchange', schedule);
                button.addEventListener('pointerdown', startDrag);
                button.addEventListener('pointermove', moveDrag);
                button.addEventListener('pointerup', endDrag);
                button.addEventListener('pointercancel', cancelDrag);
                button.addEventListener('lostpointercapture', cancelDrag);
            } else {
                screenObserver.disconnect();
                window.removeEventListener('resize', schedule);
                window.visualViewport?.removeEventListener('resize', schedule);
                window.visualViewport?.removeEventListener('scroll', schedule);
                document.removeEventListener('fullscreenchange', schedule);
                button.removeEventListener('pointerdown', startDrag);
                button.removeEventListener('pointermove', moveDrag);
                button.removeEventListener('pointerup', endDrag);
                button.removeEventListener('pointercancel', cancelDrag);
                button.removeEventListener('lostpointercapture', cancelDrag);
                closeMenu(false); finishDrag(null, false); button.hidden = true;
            }
        }
        schedule();
    }
    function startDrag(event) {
        if (gesture) { finishDrag(null, false); return; }
        if (!event.isPrimary || event.button !== 0 || !button.setPointerCapture) return;
        const rect = button.getBoundingClientRect();
        gesture = { id: event.pointerId, cx: event.clientX, cy: event.clientY, left: rect.left, top: rect.top, screen: screen() };
        button.setPointerCapture(event.pointerId);
    }
    function moveDrag(event) {
        if (gesture?.id !== event.pointerId) return;
        const dx = event.clientX - gesture.cx, dy = event.clientY - gesture.cy;
        if (!gesture.dragging && Math.hypot(dx, dy) < 6) return;
        gesture.dragging = true; gesture.x = gesture.left + dx; gesture.y = gesture.top + dy;
        button.dataset.dragging = ''; closeMenu(false); schedule();
    }
    function finishDrag(event, save) {
        if (!gesture || (event && event.pointerId !== gesture.id)) return;
        const previous = db.desktopPetSettings, prefs = desktopPetPrefs(previous), last = gesture;
        gesture = null; delete button.dataset.dragging;
        if (button.hasPointerCapture?.(last.id)) button.releasePointerCapture(last.id);
        if (last.dragging && save && screen() === last.screen) {
            const { xmin, xmax, ymin, ymax } = limits(Math.max(44, prefs.sizePx));
            prefs.position = [desktopPetClamp((last.x - xmin) / Math.max(1, xmax - xmin), 0, 1), desktopPetClamp((last.y - ymin) / Math.max(1, ymax - ymin), 0, 1)];
            desktopPetSavePrefs(prefs, previous).catch(() => showToast('桌宠位置未保存，请重试')).finally(schedule);
        }
        if (last.dragging || !save) { draggedClick = true; setTimeout(() => { draggedClick = false; }, 0); }
        schedule();
    }
    function endDrag(event) { finishDrag(event, true); }
    function cancelDrag(event) { finishDrag(event, false); }
    function previewDraft() {
        preview.src = draftImage || desktopPetDefaultArt;
        preview.width = preview.height = Number(fields.size.value);
        form.querySelector('output').textContent = `${fields.size.value} px`;
    }
    entry.hidden = false;
    entry.onclick = () => {
        if (draftBusy) return;
        draftPrevious = db.desktopPetSettings;
        const prefs = desktopPetPrefs(draftPrevious);
        fields.enabled.checked = prefs.enabled; fields.size.value = prefs.sizePx; fields.corner.value = prefs.position ? 'custom' : prefs.anchor;
        fields.image.value = ''; draftImage = prefs.image; draftPosition = prefs.position;
        form.querySelector('.uvu-pet-primary').disabled = draftBusy;
        form.querySelector('[role=status]').textContent = '';
        previewDraft(); settings.showModal(); schedule();
    };
    settings.onclose = () => { imageRead++; schedule(); };
    settings.oncancel = event => { if (draftBusy) event.preventDefault(); };
    fields.size.oninput = previewDraft;
    form.querySelector('[data-close]').onclick = () => { if (!draftBusy) settings.close(); };
    form.querySelector('[data-reset]').onclick = () => {
        imageRead++; draftImage = ''; draftPosition = null; fields.size.value = 56; fields.corner.value = 'br'; fields.image.value = '';
        form.querySelector('.uvu-pet-primary').disabled = draftBusy;
        form.querySelector('[role=status]').textContent = ''; previewDraft();
    };
    fields.image.onchange = async () => {
        if (!fields.image.files[0]) return;
        const revision = ++imageRead, status = form.querySelector('[role=status]'), save = form.querySelector('.uvu-pet-primary');
        save.disabled = true; status.textContent = '';
        try { const image = await desktopPetReadImage(fields.image.files[0]); if (revision === imageRead) { draftImage = image; previewDraft(); } }
        catch (error) { if (revision === imageRead) status.textContent = error.message; }
        finally { if (revision === imageRead) save.disabled = false; }
    };
    form.onsubmit = async event => {
        event.preventDefault();
        const save = form.querySelector('.uvu-pet-primary');
        if (draftBusy || save.disabled) return;
        draftBusy = save.disabled = true;
        const controls = [...fields].filter(control => !control.disabled);
        const status = form.querySelector('[role=status]');
        // Snapshot values before disabling controls; restore the original enabled state on failure.
        const custom = fields.corner.value === 'custom';
        const next = { enabled: fields.enabled.checked, sizePx: Number(fields.size.value), image: draftImage,
            anchor: custom ? desktopPetPrefs(draftPrevious).anchor : fields.corner.value, position: custom ? draftPosition : null };
        controls.forEach(control => { control.disabled = true; });
        settings.setAttribute('closedby', 'none');
        status.textContent = '正在保存…';
        try {
            await desktopPetSavePrefs(next, draftPrevious);
            settings.close(); refresh();
        } catch { status.textContent = '桌宠设置未保存。请刷新页面后重试。'; }
        finally {
            settings.removeAttribute('closedby');
            controls.forEach(control => { control.disabled = false; });
            draftBusy = save.disabled = false;
        }
    };
    const apiData = () => ({ provider: apiFields.provider.value, apiUrl: apiFields.apiUrl.value, apiKey: apiFields.apiKey.value, model: apiFields.model.value });
    const stopTest = () => { testRequest?.abort(); testRequest = null; apiTest.disabled = false; };
    const clearConnectionTest = () => { stopTest(); modelChoices.replaceChildren(); apiStatus.textContent = ''; };
    for (const name of ['provider', 'apiUrl', 'apiKey']) apiFields[name].addEventListener('input', clearConnectionTest);
    apiDialog.onclose = () => {
        clearConnectionTest(); apiForm.reset(); schedule();
        requestAnimationFrame(() => { if (!apiDialog.open && !button.hidden) button.focus({ preventScroll: true }); });
    };
    apiDialog.oncancel = event => { if (apiBusy) event.preventDefault(); };
    apiForm.querySelector('[data-close]').onclick = () => { if (!apiBusy) apiDialog.close(); };
    apiTest.onclick = async () => {
        let config;
        try { config = desktopPetApiConfig(apiData(), false); }
        catch (error) { apiStatus.textContent = error.message; return; }
        const controller = new AbortController(); testRequest = controller; apiTest.disabled = true;
        const timed = setTimeout(() => controller.abort(), 12000);
        apiStatus.textContent = `正在连接 ${new URL(config.url).host}…`;
        try {
            const gemini = config.provider === 'gemini';
            const endpoint = new URL(config.url + (gemini ? '/v1beta/models' : '/v1/models'));
            if (gemini) endpoint.searchParams.set('key', getRandomValue(config.key));
            const response = await fetch(endpoint, { signal: controller.signal, redirect: 'error', headers: gemini ? {} : { Authorization: `Bearer ${config.key}` } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (testRequest !== controller) return;
            const rows = gemini ? result.models : result.data;
            if (!Array.isArray(rows)) throw new Error('模型列表格式不兼容');
            const names = rows.map(row => gemini && typeof row?.name === 'string' ? row.name.replace(/^models\//, '') : row?.id).filter(name => typeof name === 'string' && name.length > 0 && name.length <= 256);
            modelChoices.replaceChildren(...names.slice(0, 300).map(name => new Option(name, name)));
            if (!apiFields.model.value && names.length) apiFields.model.value = names[0];
            apiStatus.textContent = names.length ? `已连接，读取到 ${names.length} 个模型` : '已连接，未返回模型；可手动填写';
        } catch (error) {
            if (testRequest === controller) apiStatus.textContent = controller.signal.aborted ? '连接超时，请重试' :
                `未能读取模型${/^HTTP \d+$|^模型列表格式不兼容$/.test(error.message) ? `（${error.message}）` : ''}，可检查地址或手动填写`;
        } finally {
            clearTimeout(timed);
            if (testRequest === controller) stopTest();
        }
    };
    apiForm.onsubmit = async event => {
        event.preventDefault();
        if (apiBusy) return;
        const apply = event.submitter?.value === 'apply', raw = apiData(), name = apiFields.label.value.trim();
        if (!name) { apiStatus.textContent = '请填写预设名称'; return; }
        apiBusy = true; stopTest();
        apiFields.saveOnly.disabled = apiFields.apply.disabled = true;
        try {
            const config = desktopPetApiConfig(raw);
            await desktopPetCommitApi({ create: { id: _createApiPresetId(), name, data: { provider: config.provider, apiUrl: config.url, apiKey: config.key, model: config.model } }, destination: apply ? formTarget : null, apply });
            apiDialog.close(); showToast(apply ? 'API 预设已保存并切换' : 'API 预设已保存');
        } catch (error) { apiStatus.textContent = error.message || '保存失败，请重试'; }
        finally { apiBusy = false; apiFields.saveOnly.disabled = apiFields.apply.disabled = false; }
    };
    function renderMenu() {
        menu.innerHTML = `<div class="uvu-pet-head"><h2>API 快捷切换</h2><button type="button" data-close aria-label="收起 API 快捷菜单">×</button></div>
          <label>生效范围<select aria-label="API 生效范围"><option value="default">聊天默认</option><option value="session">当前会话</option></select></label>
          <p class="uvu-pet-status" role="status"></p><div class="uvu-pet-list"></div>
          <div class="uvu-pet-actions"><button type="button" data-new class="uvu-pet-primary">＋ 新建 API</button><button type="button" data-hide>隐藏桌宠</button></div>`;
        const status = menu.querySelector('[role=status]'), list = menu.querySelector('.uvu-pet-list'), select = menu.querySelector('select');
        const session = scope === 'session' && menuTarget, presets = _getApiPresets().filter(p => p && typeof p.name === 'string' && p.name.trim());
        select.value = scope;
        select.lastElementChild.disabled = !menuTarget;
        select.onchange = () => { scope = select.value; renderMenu(); menu.querySelector('select').focus(); place(); };
        const bound = session && session.chat.exclusiveApiEnabled;
        const same = (left, right) => Object.entries(left).every(([key, value]) => key === 'url' ? String(right?.url || '').replace(/\/+$/, '') === value : right?.[key] === value);
        const matches = presets.filter(p => {
            if (session) return bound && p.name === session.chat.exclusiveApiPreset;
            try { return same(desktopPetApiConfig(p.data || {}), db.apiSettings); } catch { return false; }
        });
        const current = matches.length === 1 ? matches[0] : null;
        status.textContent = current ? `当前：${current.name}` : session ? (bound ? '专属绑定失效或重名，请重选' : '当前：跟随聊天默认') : (db.apiSettings?.model ? '当前：自定义设置' : '尚未设置主 API');
        const pick = (name, checked, selected) => {
            const item = document.createElement('button'); item.type = 'button'; item.textContent = name; item.title = name;
            item.setAttribute('aria-pressed', String(checked));
            item.onclick = async () => {
                if (apiBusy) return;
                apiBusy = true;
                const controls = [...menu.querySelectorAll('button:not(:disabled),select:not(:disabled)')];
                controls.forEach(el => { el.disabled = true; });
                try {
                    await desktopPetCommitApi({ selected, destination: session || null });
                    if (item.isConnected && menuOpen()) closeMenu();
                    showToast('API 设置已切换');
                } catch (error) { status.textContent = error.message || '切换失败，请重试'; }
                finally { apiBusy = false; controls.forEach(el => { el.disabled = false; }); }
            };
            list.append(item);
        };
        if (session) pick('跟随聊天默认', !bound, null);
        for (const preset of presets) pick(preset.name, preset === current, preset);
        if (!presets.length && !session) list.textContent = '还没有 API 预设';
        menu.querySelector('[data-close]').onclick = () => closeMenu();
        menu.querySelector('[data-new]').onclick = () => {
            closeMenu(false); formTarget = session || null;
            apiForm.querySelector('[data-destination]').textContent = formTarget ? '切换范围：当前会话' : '切换范围：聊天默认';
            apiDialog.showModal(); schedule();
        };
        const hide = menu.querySelector('[data-hide]');
        hide.onclick = async () => {
            const old = db.desktopPetSettings;
            hide.disabled = true;
            try { await desktopPetSavePrefs({ ...desktopPetPrefs(old), enabled: false }, old); refresh(); }
            catch { hide.disabled = false; showToast('桌宠未隐藏，请刷新页面后重试'); }
        };
    }
    const startMenu = () => {
        if (draggedClick || apiBusy || host.hasAttribute('inert')) return;
        if (menuOpen()) { closeMenu(); return; }
        openScreen = screen(); menuTarget = desktopPetApiTarget(); scope = menuTarget?.chat.exclusiveApiEnabled ? 'session' : 'default';
        renderMenu();
        if (nativePopover) { menu.hidden = false; menu.setAttribute('popover', 'auto'); menu.showPopover(); }
        else menu.hidden = false;
        button.setAttribute('aria-expanded', 'true'); place();
    };
    button.onclick = startMenu;
    menu.addEventListener('toggle', () => {
        if (!menuOpen()) {
            openScreen = null; button.setAttribute('aria-expanded', 'false');
            if (document.activeElement === document.body || menu.contains(document.activeElement)) {
                requestAnimationFrame(() => { if (!menuOpen() && !button.hidden) button.focus({ preventScroll: true }); });
            }
        }
    });
    host.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !settings.open && menuOpen()) { event.stopPropagation(); closeMenu(); }
    });
    if (!nativePopover) document.addEventListener('pointerdown', event => {
        if (menuOpen() && !menu.contains(event.target) && !button.contains(event.target)) closeMenu(false);
    });
    refresh();
}
