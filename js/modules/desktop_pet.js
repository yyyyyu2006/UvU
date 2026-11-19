const desktopPetDefaultArt = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M9 40c0-6 3-11 5-12l-1-13c0-2 3-3 5-1l10 8h8l10-8c2-2 5-1 5 1l-1 13c3 3 5 7 5 12 0 10-9 15-23 15S9 50 9 40Z" fill="#d4e9f2" stroke="#456276" stroke-width="2.5"/><path d="M24 36v2m16-2v2m-11 5q3 4 6 0" fill="none" stroke="#334b5d" stroke-width="2.7" stroke-linecap="round"/><path d="M16 43h4m24 0h4" stroke="#d28c91" stroke-width="2" stroke-linecap="round"/></svg>');
const desktopPetCorners = { br: [1, 1], bl: [0, 1], tr: [1, 0], tl: [0, 0] };
const desktopPetClamp = (value, min, max) => Math.min(max, Math.max(min, value));

function desktopPetIcon(name) {
    const paths = {
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 0 1 5 1c0 2-2.5 2-2.5 4M12 17h.01"/>',
        check: '<path d="m5 12 4 4L19 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
        settings: '<path d="m9 3-1 3-3 1-2 4 2 3v4l4 2 3-1 3 1 4-2v-4l2-3-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
        tl: '<path d="M6 16V6h10"/>', tr: '<path d="M8 6h10v10"/>',
        bl: '<path d="M6 8v10h10"/>', br: '<path d="M8 18h10V8"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function desktopPetPrefs(value) {
    const corner = Object.prototype.hasOwnProperty.call(desktopPetCorners, value?.anchor) ? value.anchor : 'br';
    const position = Array.isArray(value?.position) && value.position.length === 2 && value.position.every(Number.isFinite)
        ? value.position.map(n => desktopPetClamp(n, 0, 1)) : null;
    const image = typeof value?.image === 'string' && value.image.length < 490000 && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value.image) ? value.image : '';
    const shape = ['original', 'square', 'rectangle', 'circle'].includes(value?.shape) ? value.shape : 'original';
    const cornerRadius = Number.isFinite(value?.cornerRadius) ? desktopPetClamp(value.cornerRadius, 0, 50) : 0;
    const backgroundColor = typeof value?.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.backgroundColor) ? value.backgroundColor.toLowerCase() : '';
    return { version: 1, shape, cornerRadius, backgroundColor, enabled: value?.enabled === true, anchor: corner, position, sizePx: Number.isFinite(value?.sizePx) ? desktopPetClamp(value.sizePx, 40, 96) : 56, image };
}

function desktopPetDimensions(prefs) {
    return { width: prefs.shape === 'rectangle' ? Math.round(prefs.sizePx * 4 / 3) : prefs.sizePx, height: prefs.sizePx };
}

function desktopPetApplyAppearance(art, prefs, scale = 1) {
    const size = desktopPetDimensions(prefs);
    art.dataset.shape = prefs.shape;
    art.style.width = size.width * scale + 'px';
    art.style.height = size.height * scale + 'px';
    art.style.borderRadius = (prefs.shape === 'circle' ? 50 : prefs.cornerRadius) + '%';
    art.style.backgroundColor = prefs.backgroundColor || 'transparent';
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
        <button type="button" id="uvu-pet-button" aria-label="桌宠 API 快捷菜单" aria-controls="uvu-pet-menu" aria-expanded="false" hidden><span class="uvu-pet-art"><img alt="" draggable="false"></span></button>
        <section id="uvu-pet-menu" class="uvu-pet-panel" aria-label="API 快捷切换" hidden></section>
        <dialog id="uvu-pet-settings" class="uvu-pet-panel uvu-pet-dialog" aria-labelledby="uvu-pet-settings-title">
          <form><div class="uvu-pet-head"><h2 id="uvu-pet-settings-title">桌宠设置</h2><button type="button" data-help class="uvu-pet-icon" aria-label="使用说明">${desktopPetIcon('help')}</button><button type="button" data-close class="uvu-pet-icon" aria-label="关闭桌宠设置">${desktopPetIcon('close')}</button></div>
          <label class="uvu-pet-inline"><span>显示桌宠</span><span class="uvu-pet-switch"><input name="enabled" type="checkbox" autofocus><span aria-hidden="true"></span></span></label>
          <div class="uvu-pet-image-row"><div class="uvu-pet-preview"><span class="uvu-pet-art"><img alt="桌宠预览"></span></div><div class="uvu-pet-image-actions"><button type="button" data-image>更换图片</button><button type="button" data-default class="uvu-pet-text">使用默认图片</button></div><input name="image" type="file" accept="image/png,image/jpeg,image/webp" aria-label="桌宠图片" hidden></div>
          <div class="uvu-pet-size"><label for="uvu-pet-size">大小 <output for="uvu-pet-size"></output></label><input id="uvu-pet-size" name="size" type="range" min="40" max="96" step="1"><div class="uvu-pet-range-ends"><span>40</span><span>96</span></div></div>
          <div class="uvu-pet-shape"><span id="uvu-pet-shape-title">外形</span><input name="shape" type="hidden"><div class="uvu-pet-shapes" role="group" aria-labelledby="uvu-pet-shape-title"><button type="button" data-shape="original" aria-pressed="false">原图</button><button type="button" data-shape="square" aria-pressed="false">正方形</button><button type="button" data-shape="rectangle" aria-pressed="false">长方形</button><button type="button" data-shape="circle" aria-pressed="false">圆形</button></div></div>
          <div class="uvu-pet-size"><label for="uvu-pet-radius">圆角 <output for="uvu-pet-radius"></output></label><input id="uvu-pet-radius" name="radius" type="range" min="0" max="50" step="1"></div>
          <div class="uvu-pet-background"><label class="uvu-pet-inline"><span>显示背景</span><span class="uvu-pet-switch"><input name="backgroundEnabled" type="checkbox"><span aria-hidden="true"></span></span></label><label class="uvu-pet-color">背景颜色<input name="backgroundColor" type="color" value="#ffffff"></label></div>
          <div class="uvu-pet-position"><div class="uvu-pet-field-head"><span id="uvu-pet-position-title">位置</span><span data-position-label></span></div><input name="corner" type="hidden"><div class="uvu-pet-corners" role="group" aria-labelledby="uvu-pet-position-title">${[['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下']].map(([key, text]) => `<button type="button" data-corner="${key}" aria-pressed="false">${desktopPetIcon(key)}${text}</button>`).join('')}</div></div>
          <p class="uvu-pet-status" role="status"></p>
          <div class="uvu-pet-actions"><button type="button" data-reset>恢复默认外观</button><button class="uvu-pet-primary">保存</button></div></form>
        </dialog>
        <dialog id="uvu-pet-api-dialog" class="uvu-pet-panel uvu-pet-dialog" aria-labelledby="uvu-pet-api-title">
          <form><div class="uvu-pet-head"><h2 id="uvu-pet-api-title">新建 API</h2><button type="button" data-help class="uvu-pet-icon" aria-label="使用说明">${desktopPetIcon('help')}</button><button type="button" data-close class="uvu-pet-icon" aria-label="取消新建 API">${desktopPetIcon('close')}</button></div>
          <p class="uvu-pet-status" data-destination></p>
          <label>预设名称<input name="label" required maxlength="80" autocomplete="off"></label>
          <label>服务商<select name="provider"></select></label>
          <label>API 地址<input name="apiUrl" type="url" required maxlength="2048" autocomplete="off" placeholder="https://"></label>
          <label>模型<input name="model" list="uvu-pet-models" required maxlength="256" autocomplete="off"></label><datalist id="uvu-pet-models"></datalist>
          <label>API 密钥<input name="apiKey" type="password" required autocomplete="new-password" maxlength="8192"></label>
          <p class="uvu-pet-status" role="status"></p>
          <button type="button" data-api-test>测试连接并读取模型</button>
          <div class="uvu-pet-actions"><button name="saveOnly" value="save">保存为预设</button><button name="apply" class="uvu-pet-primary" value="apply">保存并切换</button></div></form>
        </dialog>
        <dialog id="uvu-pet-help" class="uvu-pet-panel uvu-pet-dialog" aria-labelledby="uvu-pet-help-title"><div class="uvu-pet-head"><h2 id="uvu-pet-help-title">使用说明</h2><button type="button" data-close class="uvu-pet-icon" aria-label="关闭使用说明" autofocus>${desktopPetIcon('close')}</button></div><div class="uvu-pet-help-body"><p>桌宠显示在 UvU 页面内。按住拖动，松手后记住位置，也可以在设置中直接选择四角。</p><p>点击桌宠可切换聊天默认 API，或绑定当前私聊／群聊的预设。切换只影响之后发起的请求，正在生成的回复继续使用原设置。会话绑定由该会话的各存档共享。</p><p>图片支持 4 MB 以内的 PNG、JPEG、WebP，最长边不超过 4096 像素，读取后会压缩保存。</p><p>新建 API 时，只有点击“测试连接并读取模型”才会请求服务商。密钥保存在当前浏览器，导出设置备份时可能包含，请妥善保管。</p><p>外形可选原图、正方形、4:3 长方形或圆形。原图保留完整图片，其他外形会居中裁切；圆形固定圆角，其他外形可调整。关闭“显示背景”即为透明背景，透明图片仍保留自身透明部分。</p><p>要收起桌宠，请在桌宠设置中关闭“显示桌宠”并保存。</p></div></dialog>`;
    document.body.append(host);
    const [button, menu, settings, apiDialog] = host.children, art = button.firstElementChild, icon = art.firstElementChild;
    const help = host.querySelector('#uvu-pet-help');
    help.querySelector('[data-close]').onclick = () => help.close();
    const showHelp = () => { help.showModal(); schedule(); };
    help.onclose = () => schedule();
    for (const panel of [settings, apiDialog]) panel.querySelector('[data-help]').onclick = showHelp;
    const form = settings.querySelector('form'), fields = form.elements, preview = form.querySelector('img');
    for (const image of [icon, preview]) image.onerror = () => {
        if (image.getAttribute('src') && image.getAttribute('src') !== desktopPetDefaultArt) image.src = desktopPetDefaultArt;
    };
    const apiForm = apiDialog.querySelector('form'), apiFields = apiForm.elements, apiStatus = apiForm.querySelector('[role=status]');
    const apiTest = apiForm.querySelector('[data-api-test]'), modelChoices = apiForm.querySelector('datalist');
    const providerOptions = document.getElementById('api-provider')?.options;
    for (const option of providerOptions || []) apiFields.provider.add(new Option(option.textContent, option.value));
    let draftImage = '', draftPosition, draftPrevious, draftRadius = 0, imageRead = 0, draftBusy = false;
    let active = false, frame = 0, gesture = null, draggedClick = false, openScreen = null;
    let pendingMove = null, positionSaving = false;
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
    function limits(petWidth, petHeight) {
        const view = window.visualViewport, left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
        const width = view?.width || innerWidth, height = view?.height || innerHeight;
        const bounds = phone.getBoundingClientRect(), edge = 10;
        const xmin = Math.max(bounds.left, left) + edge, xmax = Math.min(bounds.right, left + width) - edge - petWidth;
        const ymin = Math.max(bounds.top, top) + edge, bottom = Math.min(bounds.bottom, top + height) - edge;
        let ymax = bottom - petHeight;
        for (const el of [screen()?.querySelector('.message-input-area'), document.getElementById('global-bottom-nav')]) {
            const box = el?.getBoundingClientRect();
            if (box?.height && box.top > ymin && box.top < bottom && getComputedStyle(el).visibility !== 'hidden') ymax = Math.min(ymax, box.top - edge - petHeight);
        }
        return { xmin, xmax, ymin, ymax, bottom, right: Math.min(bounds.right, left + width) - edge };
    }
    function place() {
        frame = 0;
        if (!active) return;
        for (const dialog of [settings, apiDialog, help]) if (dialog.open) {
            const viewport = window.visualViewport;
            dialog.style.maxHeight = `${Math.max(0, (viewport?.height || innerHeight) - 24)}px`;
            dialog.style.insetBlockStart = `${viewport?.offsetTop || 0}px`;
        }
        const prefs = desktopPetPrefs(db.desktopPetSettings), dimensions = desktopPetDimensions(prefs);
        const width = Math.max(44, dimensions.width), height = Math.max(44, dimensions.height), box = limits(width, height);
        const covered = host.hasAttribute('inert') || settings.open || apiDialog.open || help.open || !!document.fullscreenElement ||
            !!phone.querySelector('.modal-overlay.visible,.modal-overlay.open,.action-sheet-overlay.visible,.action-sheet-overlay.open,.settings-sidebar.open,.vc-incoming-overlay.visible,.vc-type-modal.visible,.vc-scene:not(.vc-hidden)');
        button.hidden = Boolean(covered || box.xmax < box.xmin || box.ymax < box.ymin);
        if (button.hidden) { closeMenu(false); finishDrag(null, false); return; }
        const [rx, ry] = pendingMove?.position || prefs.position || desktopPetCorners[prefs.anchor];
        const x = gesture?.dragging ? gesture.x : box.xmin + rx * (box.xmax - box.xmin);
        const y = gesture?.dragging ? gesture.y : box.ymin + ry * (box.ymax - box.ymin);
        const left = desktopPetClamp(x, box.xmin, box.xmax), top = desktopPetClamp(y, box.ymin, box.ymax);
        if (gesture?.dragging) {
            button.style.left = `${gesture.left}px`; button.style.top = `${gesture.top}px`;
            button.style.transform = `translate3d(${left - gesture.left}px, ${top - gesture.top}px, 0)`;
        } else {
            button.style.transform = 'none'; button.style.left = `${left}px`; button.style.top = `${top}px`;
        }
        if (menuOpen()) {
            const rect = button.getBoundingClientRect(), gap = 8;
            menu.style.width = `${Math.min(276, box.right - box.xmin)}px`;
            const below = box.ymax + height - rect.bottom - gap, above = rect.top - box.ymin - gap;
            const openBelow = below >= above;
            menu.style.maxHeight = `${Math.max(0, openBelow ? below : above)}px`;
            menu.style.left = `${desktopPetClamp(rect.right - menu.offsetWidth, box.xmin, box.right - menu.offsetWidth)}px`;
            menu.style.top = `${openBelow ? rect.bottom + gap : rect.top - gap - menu.offsetHeight}px`;
            if (Math.max(below, above) < 72) {
                menu.style.top = `${box.ymin}px`;
                menu.style.maxHeight = `${box.ymax + height - box.ymin}px`;
            }
        }
    }
    function schedule() { if (!frame && active) frame = requestAnimationFrame(place); }
    function refresh() {
        const prefs = desktopPetPrefs(db.desktopPetSettings), dimensions = desktopPetDimensions(prefs);
        entry.querySelector('[data-state]').textContent = prefs.enabled ? '已开启' : '未开启';
        if (prefs.enabled) icon.src = prefs.image || desktopPetDefaultArt; else icon.removeAttribute('src');
        desktopPetApplyAppearance(art, prefs);
        button.style.width = Math.max(44, dimensions.width) + 'px';
        button.style.height = Math.max(44, dimensions.height) + 'px';
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
    async function savePosition() {
        if (positionSaving) return;
        positionSaving = true;
        try {
            while (pendingMove) {
                const move = pendingMove;
                try {
                    await desktopPetSavePrefs({ ...desktopPetPrefs(move.previous), position: move.position }, move.previous);
                    // A later drag may have started before this transaction committed.
                    if (pendingMove !== move && pendingMove.previous === move.previous) pendingMove.previous = db.desktopPetSettings;
                } catch { showToast('桌宠位置未保存，请重试'); }
                if (pendingMove === move) pendingMove = null;
                schedule();
            }
        } finally { positionSaving = false; }
    }
    function finishDrag(event, save) {
        if (!gesture || (event && event.pointerId !== gesture.id)) return;
        const previous = db.desktopPetSettings, prefs = desktopPetPrefs(previous), last = gesture;
        gesture = null; delete button.dataset.dragging;
        if (button.hasPointerCapture?.(last.id)) button.releasePointerCapture(last.id);
        if (last.dragging && save && screen() === last.screen) {
            const dimensions = desktopPetDimensions(prefs);
            const { xmin, xmax, ymin, ymax } = limits(Math.max(44, dimensions.width), Math.max(44, dimensions.height));
            const position = [desktopPetClamp((last.x - xmin) / Math.max(1, xmax - xmin), 0, 1), desktopPetClamp((last.y - ymin) / Math.max(1, ymax - ymin), 0, 1)];
            pendingMove = { position, previous }; void savePosition();
        }
        if (last.dragging || !save) { draggedClick = true; setTimeout(() => { draggedClick = false; }, 0); }
        schedule();
    }
    function endDrag(event) { finishDrag(event, true); }
    function cancelDrag(event) { finishDrag(event, false); }
    function previewDraft() {
        preview.src = draftImage || desktopPetDefaultArt;
        const prefs = desktopPetPrefs({ sizePx: Number(fields.size.value), shape: fields.shape.value,
            cornerRadius: draftRadius, backgroundColor: fields.backgroundEnabled.checked ? fields.backgroundColor.value : '' });
        const dimensions = desktopPetDimensions(prefs);
        desktopPetApplyAppearance(preview.parentElement, prefs, Math.min(1, 88 / dimensions.width, 80 / dimensions.height));
        fields.radius.value = prefs.shape === 'circle' ? 50 : draftRadius;
        fields.radius.disabled = prefs.shape === 'circle';
        fields.backgroundColor.disabled = !fields.backgroundEnabled.checked;
        form.querySelector('output[for="uvu-pet-radius"]').textContent = (prefs.shape === 'circle' ? 50 : prefs.cornerRadius) + '%';
        fields.radius.style.setProperty('--uvu-pet-range', (prefs.shape === 'circle' ? 100 : prefs.cornerRadius * 2) + '%');
        for (const control of form.querySelectorAll('button[data-shape]')) control.setAttribute('aria-pressed', String(control.dataset.shape === prefs.shape));
        form.querySelector('output').textContent = `${fields.size.value} px`;
        fields.size.style.setProperty('--uvu-pet-range', `${(Number(fields.size.value) - 40) / 56 * 100}%`);
        const selected = fields.corner.value;
        const names = { tl: '左上', tr: '右上', bl: '左下', br: '右下', custom: '拖动位置' };
        form.querySelector('[data-position-label]').textContent = names[selected];
        for (const control of form.querySelectorAll('[data-corner]')) control.setAttribute('aria-pressed', String(control.dataset.corner === selected));
    }
    const mountEntry = () => {
        const group = document.querySelector('#customize-form .kkt-settings-container > .kkt-group');
        if (group) { group.prepend(entry); entry.hidden = false; }
    };
    document.addEventListener('uvu-customize-rendered', mountEntry); mountEntry();
    const openSettings = () => {
        if (draftBusy) return;
        draftPrevious = db.desktopPetSettings;
        const prefs = desktopPetPrefs(draftPrevious);
        fields.enabled.checked = prefs.enabled; fields.size.value = prefs.sizePx; fields.corner.value = prefs.position ? 'custom' : prefs.anchor;
        fields.shape.value = prefs.shape; draftRadius = prefs.cornerRadius; fields.radius.value = draftRadius;
        fields.backgroundEnabled.checked = Boolean(prefs.backgroundColor); fields.backgroundColor.value = prefs.backgroundColor || '#ffffff';
        fields.image.value = ''; draftImage = prefs.image; draftPosition = prefs.position;
        form.querySelector('.uvu-pet-primary').disabled = draftBusy;
        form.querySelector('[role=status]').textContent = '';
        previewDraft(); settings.showModal(); schedule();
    };
    entry.onclick = openSettings;
    settings.onclose = () => { imageRead++; schedule(); };
    settings.oncancel = event => { if (draftBusy) event.preventDefault(); };
    for (const field of [fields.size, fields.backgroundEnabled, fields.backgroundColor]) field.oninput = previewDraft;
    fields.radius.oninput = () => { draftRadius = Number(fields.radius.value); previewDraft(); };
    for (const control of form.querySelectorAll('button[data-shape]')) control.onclick = () => { fields.shape.value = control.dataset.shape; previewDraft(); };
    form.querySelector('[data-image]').onclick = () => fields.image.click();
    form.querySelector('[data-default]').onclick = () => { imageRead++; draftImage = ''; fields.image.value = ''; form.querySelector('.uvu-pet-primary').disabled = draftBusy; previewDraft(); };
    for (const control of form.querySelectorAll('[data-corner]')) control.onclick = () => { fields.corner.value = control.dataset.corner; previewDraft(); };
    form.querySelector('[data-close]').onclick = () => { if (!draftBusy) settings.close(); };
    form.querySelector('[data-reset]').onclick = () => {
        imageRead++; draftImage = ''; draftPosition = null; fields.shape.value = 'original'; draftRadius = 0; fields.radius.value = 0;
        fields.backgroundEnabled.checked = false; fields.backgroundColor.value = '#ffffff'; fields.size.value = 56; fields.corner.value = 'br'; fields.image.value = '';
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
            shape: fields.shape.value, cornerRadius: draftRadius, backgroundColor: fields.backgroundEnabled.checked ? fields.backgroundColor.value : '',
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
        menu.innerHTML = `<div class="uvu-pet-head"><h2>切换 API</h2><button type="button" data-help class="uvu-pet-icon" aria-label="使用说明">${desktopPetIcon('help')}</button><button type="button" data-close class="uvu-pet-icon" aria-label="收起 API 快捷菜单">${desktopPetIcon('close')}</button></div>
          <div class="uvu-pet-scopes" role="group" aria-label="API 生效范围"><button type="button" data-scope="default" aria-pressed="${scope === 'default'}">聊天默认</button><button type="button" data-scope="session" aria-pressed="${scope === 'session'}" ${menuTarget ? '' : 'disabled'}>当前会话</button></div>
          <p class="uvu-pet-status" role="status"></p><div class="uvu-pet-list"></div>
          <div class="uvu-pet-actions"><button type="button" data-new class="uvu-pet-text">${desktopPetIcon('plus')}新建 API</button><button type="button" data-settings class="uvu-pet-icon" aria-label="桌宠设置">${desktopPetIcon('settings')}</button></div>`;
        const status = menu.querySelector('[role=status]'), list = menu.querySelector('.uvu-pet-list');
        const session = scope === 'session' && menuTarget, presets = _getApiPresets().filter(p => p && typeof p.name === 'string' && p.name.trim());
        for (const control of menu.querySelectorAll('[data-scope]')) control.onclick = () => {
            scope = control.dataset.scope; renderMenu(); menu.querySelector(`[data-scope="${scope}"]`).focus(); place();
        };
        const bound = session && session.chat.exclusiveApiEnabled;
        const same = (left, right) => Object.entries(left).every(([key, value]) => key === 'url' ? String(right?.url || '').replace(/\/+$/, '') === value : right?.[key] === value);
        const matches = presets.filter(p => {
            if (session) return bound && p.name === session.chat.exclusiveApiPreset;
            try { return same(desktopPetApiConfig(p.data || {}), db.apiSettings); } catch { return false; }
        });
        const current = matches.length === 1 ? matches[0] : null;
        status.textContent = current || (session && !bound) ? '' : session ? '专属绑定失效或重名，请重选' : (db.apiSettings?.model ? '当前：自定义设置' : '尚未设置主 API');
        const pick = (name, checked, selected) => {
            const item = document.createElement('button'); item.type = 'button'; item.title = name;
            item.setAttribute('aria-label', name);
            const text = document.createElement('span'), title = document.createElement('span');
            text.className = 'uvu-pet-option-text'; title.textContent = name; text.append(title);
            if (selected) {
                const detail = document.createElement('small'), data = selected.data || {};
                const names = { newapi: 'OpenAI 兼容', gemini: 'Gemini', deepseek: 'DeepSeek', claude: 'Claude' };
                detail.textContent = [names[data.provider || 'newapi'] || '自定义服务', String(data.model || '').trim()].filter(Boolean).join(' · ');
                text.append(detail);
            }
            item.append(text); item.insertAdjacentHTML('beforeend', desktopPetIcon('check'));
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
        menu.querySelector('[data-help]').onclick = showHelp;
        menu.querySelector('[data-settings]').onclick = () => { closeMenu(false); openSettings(); };
        menu.querySelector('[data-new]').onclick = () => {
            closeMenu(false); formTarget = session || null;
            apiForm.querySelector('[data-destination]').textContent = formTarget ? '切换范围：当前会话' : '切换范围：聊天默认';
            apiDialog.showModal(); schedule();
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
