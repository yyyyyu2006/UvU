// 主页分享预设：使用独立白名单，绝不序列化整个 db。
(function () {
    'use strict';

    const FORMAT = 'uwu-home-preset';
    const VERSION = 1;
    const MAX_BYTES = 50 * 1024 * 1024;
    const APP_IDS = new Set(['app-chat', 'app-api', 'app-wallpaper', 'app-worldbook',
        'app-customize', 'app-tutorial', 'app-console', 'app-widget-market', 'app-reader', 'app-placeholder']);
    const HOME_KEYS = ['wallpaper', 'homeScreenMode', 'customIcons', 'homeSignature',
        'insWidgetSettings', 'homeWidgetSettings', 'homeLayoutPages'];
    const clone = value => JSON.parse(JSON.stringify(value));
    const fail = message => { throw new Error(message); };
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const text = (value, label, max = 2000000) => {
        if (typeof value !== 'string' || value.length > max) fail(`${label}格式不正确`);
        return value;
    };
    const identifier = (value, label) => {
        if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,159}$/.test(value)) fail(`${label}无效`);
        return value;
    };

    function checkKeys(value, depth = 0) {
        if (depth > 20) fail('预设数据层级过深');
        if (!value || typeof value !== 'object') return;
        for (const key of Object.keys(value)) {
            if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('预设包含不支持的数据字段');
            checkKeys(value[key], depth + 1);
        }
    }

    function resource(value, label, font = false) {
        text(value, label, MAX_BYTES);
        if (!value) return value;
        // 资源随后会进入现有的 HTML/CSS 渲染器，拒绝脚本地址和属性分隔符。
        if (/[\s"'<>`\\]/.test(value) || !(/^(https?:\/\/)/i.test(value) ||
            (font ? /^data:(font\/[\w.+-]+|application\/[\w.+-]+);base64,/i : /^data:image\/[\w.+-]+;base64,/i).test(value))) {
            fail(`${label}需使用 HTTP(S) 链接或内嵌文件，不能使用临时 blob 地址`);
        }
        return value;
    }

    function stringFields(value, fields, label) {
        if (!record(value)) fail(`${label}格式不正确`);
        const result = {};
        fields.forEach(key => {
            if (Object.hasOwn(value, key)) result[key] = text(value[key], label);
        });
        return result;
    }

    function variables(value) {
        if (!record(value) || Object.keys(value).length > 200) fail('小组件变量格式不正确');
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,99}$/.test(key) ||
                !['string', 'number', 'boolean'].includes(typeof item) ||
                (typeof item === 'number' && !Number.isFinite(item))) fail('小组件变量格式不正确');
            if (typeof item === 'string') text(item, '小组件变量', MAX_BYTES);
            if (typeof item === 'string' && /^blob:/i.test(item)) fail('小组件中有临时图片地址，请重新上传图片后导出');
            result[key] = item;
        }
        return result;
    }

    // 导入、导出共用校验器；投影到已知字段，忽略夹带的聊天、密钥等数据。
    function validate(raw) {
        if (!record(raw) || raw.format !== FORMAT) fail('请选择通过“导出主页预设”生成的 JSON 文件');
        if (raw.version !== VERSION) fail('不支持此预设版本，请更新小手机后再试');
        checkKeys(raw);
        if (!record(raw.settings)) fail('预设缺少主页设置');
        const source = raw.settings;
        const settings = {};
        settings.wallpaper = resource(source.wallpaper, '壁纸');
        if (!['day', 'night'].includes(source.homeScreenMode)) fail('主页显示模式无效');
        settings.homeScreenMode = source.homeScreenMode;
        if (!record(source.customIcons)) fail('图标设置格式不正确');
        settings.customIcons = {};
        for (const [key, url] of Object.entries(source.customIcons)) {
            if (Object.hasOwn(defaultIcons, key)) settings.customIcons[key] = resource(url, '图标');
        }
        settings.homeSignature = text(source.homeSignature, '主页签名', 10000);
        settings.insWidgetSettings = stringFields(source.insWidgetSettings, ['avatar1', 'avatar2', 'bubble1', 'bubble2'], '对话小组件');
        ['avatar1', 'avatar2'].forEach(key => {
            if (settings.insWidgetSettings[key]) resource(settings.insWidgetSettings[key], '小组件头像');
        });
        settings.homeWidgetSettings = stringFields(source.homeWidgetSettings, ['centralCircleImage', 'polaroidImage'], '主页小组件');
        ['centralCircleImage', 'polaroidImage'].forEach(key => {
            if (settings.homeWidgetSettings[key]) resource(settings.homeWidgetSettings[key], '小组件图片');
        });
        ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].forEach(key => {
            const value = source.homeWidgetSettings[key] || defaultWidgetSettings[key];
            settings.homeWidgetSettings[key] = stringFields(value, ['emoji', 'text'], '主页小组件文字');
        });
        if (!Array.isArray(source.widgetTemplates) || source.widgetTemplates.length > 500 ||
            !Array.isArray(source.addedWidgets) || source.addedWidgets.length > 500) fail('小组件列表格式不正确');
        const templateIds = new Set();
        settings.widgetTemplates = source.widgetTemplates.map(template => {
            if (!record(template)) fail('小组件模板格式不正确');
            const id = identifier(template.id, '小组件模板 ID');
            if (templateIds.has(id)) fail('小组件模板 ID 重复');
            templateIds.add(id);
            if (!['1x1', '2x2', '4x2', '4x4'].includes(template.size)) fail('小组件尺寸不受支持');
            return { id, name: text(template.name, '小组件名称', 200), size: template.size,
                html: text(template.html, '小组件 HTML', MAX_BYTES), css: text(template.css, '小组件 CSS', MAX_BYTES),
                js: text(template.js || '', '小组件 JS'), defaultVars: variables(template.defaultVars || {}) };
        });
        const instanceIds = new Set();
        settings.addedWidgets = source.addedWidgets.map(instance => {
            if (!record(instance)) fail('小组件实例格式不正确');
            const id = identifier(instance.id, '小组件实例 ID');
            if (APP_IDS.has(id) || instanceIds.has(id)) fail('小组件实例 ID 重复或与应用冲突');
            instanceIds.add(id);
            if (!templateIds.has(instance.templateId)) fail('预设缺少小组件模板，无法完整还原主页');
            return { id, templateId: instance.templateId, vars: variables(instance.vars || {}) };
        });
        if (!Array.isArray(source.homeLayoutPages) || source.homeLayoutPages.length === 0 ||
            source.homeLayoutPages.length > 100) fail('主页分页格式不正确');
        const placed = new Set();
        settings.homeLayoutPages = source.homeLayoutPages.map(page => {
            if (!Array.isArray(page) || page.length > 500) fail('主页分页格式不正确');
            return page.map(id => {
                if (!APP_IDS.has(id) && !instanceIds.has(id)) fail('布局含有无法识别的应用或小组件');
                if (placed.has(id)) fail('同一个主页项目不能重复放置');
                placed.add(id);
                return id;
            });
        });
        if ([...instanceIds].some(id => !placed.has(id))) fail('小组件缺少主页位置');
        settings.homeLayoutOrder = settings.homeLayoutPages.flat();
        // 空白桌面仍需能进入个性化设置；沿用主页现有的自动补齐应用逻辑。
        if (Object.hasOwn(source, 'appearance')) {
            if (!record(source.appearance)) fail('外观设置格式不正确');
            const appearance = source.appearance;
            if (typeof appearance.fontSizeScale !== 'number' || appearance.fontSizeScale < 0.8 || appearance.fontSizeScale > 1.5) fail('字号需在 0.8 至 1.5 之间');
            settings.appearance = {
                fontUrl: resource(appearance.fontUrl, '字体', true),
                fontSizeScale: appearance.fontSizeScale,
                globalCss: text(appearance.globalCss, '全局 CSS')
            };
        }
        return { format: FORMAT, version: VERSION,
            name: text(raw.name || '未命名主页预设', '预设名称', 80), settings };
    }

    function readAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('读取本地字体失败'));
            reader.readAsDataURL(file);
        });
    }

    async function createPreset(name, includeAppearance) {
        const settings = {};
        HOME_KEYS.forEach(key => {
            const defaults = { customIcons: {}, homeSignature: '', insWidgetSettings: {}, homeWidgetSettings: defaultWidgetSettings };
            settings[key] = clone(db[key] === undefined ? defaults[key] : db[key]);
        });
        // 仅打包桌面上实际使用的实例及模板，避免分享整个组件库。
        const visible = new Set(settings.homeLayoutPages.flat());
        settings.addedWidgets = (db.addedWidgets || []).filter(item => visible.has(item.id));
        const usedTemplates = new Set(settings.addedWidgets.map(item => item.templateId));
        settings.widgetTemplates = (db.widgetTemplates || []).filter(item => usedTemplates.has(item.id));
        if (includeAppearance) {
            let fontUrl = db.fontUrl || '';
            if (fontUrl.startsWith('CustomFont_')) {
                const preset = (db.fontPresets || []).find(item => item.fontFamily === fontUrl && item.isCustom);
                const stored = preset && await dexieDB.customFonts.get(preset.id);
                if (!stored || !stored.file) fail('当前本地字体文件缺失，请重新上传字体或取消勾选字体与 CSS');
                // 直接嵌入当前字体，不导出本地字体库和其他预设。
                fontUrl = await readAsDataURL(stored.file);
                fontUrl = fontUrl.replace(/^data:;base64,/, 'data:application/octet-stream;base64,');
            }
            settings.appearance = { fontUrl, fontSizeScale: db.fontSizeScale || 1, globalCss: db.globalCss || '' };
        }
        const preset = validate({ format: FORMAT, version: VERSION, name: name.trim() || '我的主页', settings });
        preset.createdAt = new Date().toISOString();
        preset.appVersion = typeof appVersion === 'string' ? appVersion : '';
        return preset;
    }

    function mergeTemplates(incoming) {
        const templates = clone(db.widgetTemplates || []);
        const ids = new Set(templates.map(item => item.id));
        const incomingIds = new Set(incoming.map(item => item.id));
        const mapping = new Map();
        const same = (left, right) => ['name', 'size', 'html', 'css', 'js', 'defaultVars'].every(key =>
            JSON.stringify(left[key] || (key === 'defaultVars' ? {} : '')) === JSON.stringify(right[key]));
        incoming.forEach(template => {
            let copy = clone(template);
            const existing = templates.find(item => item.id === copy.id);
            if (existing && same(existing, copy)) return;
            if (ids.has(copy.id)) {
                const original = copy.id;
                let suffix = 1;
                let match;
                do {
                    copy = clone(template);
                    copy.id = `imported-${original.slice(0,120)}-${suffix++}`;
                    // 标准模板用 {{id}}；也兼容以 #id 或字符串字面量写死的 DOM ID。
                    ['html', 'css', 'js'].forEach(key => {
                        copy[key] = copy[key].replace(new RegExp(`([#"'])${original}(?=["'\\s.:>{\\[]|$)`, 'g'), (_, prefix) => prefix + copy.id);
                    });
                    match = templates.find(item => item.id === copy.id);
                } while ((match && !same(match, copy)) || incomingIds.has(copy.id));
                mapping.set(original, copy.id);
                if (match) return;
            }
            ids.add(copy.id);
            templates.push(copy);
        });
        return { templates, mapping };
    }

    let undoState = null, presetQueue = Promise.resolve();
    // Share the existing backup/save queue; old programmatic callers remain trusted.
    function persistPreset(task) {
        if (typeof runDataPersistence === 'function') return runDataPersistence(task);
        const pending = presetQueue.then(task); presetQueue = pending.catch(() => {}); return pending;
    }
    function inspectResources(raw) {
        const preset = validate(raw), resources = new Set();
        const visit = value => {
            if (typeof value === 'string') {
                for (const match of value.matchAll(/https?:\/\/[^\s"'<>)]{1,2048}/gi)) {
                    if (resources.size >= 100) break;
                    resources.add(match[0].replace(/^(https?:\/\/)(?:[^/@]+@)/i, '$1').replace(/[?#].*$/, '').slice(0, 250));
                }
            } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
        };
        visit(preset.settings);
        return { resources: Array.from(resources), hasCss: Boolean(preset.settings.appearance?.globalCss || preset.settings.widgetTemplates.some(item => item.css)),
            requiresTrust: preset.settings.widgetTemplates.some(item => item.html.trim() || item.js.trim()),
            hasScripts: preset.settings.widgetTemplates.some(item => item.js.trim() || /<script|\bon\w+\s*=|javascript:/i.test(item.html)) };
    }
    function undoPreset() {
        const source = db, entry = undoState;
        return persistPreset(() => {
            if (db !== source || undoState !== entry) fail('主页或恢复任务已变化，请重新检查后撤销');
            return undoPresetNow();
        });
    }
    async function undoPresetNow() {
        if (!undoState) fail('没有可撤销的主页预设导入');
        const current = Object.fromEntries(undoState.keys.map(key => [key, db[key]]));
        if (JSON.stringify(current) !== undoState.applied) fail('主页已有后续修改，请先导出当前主页后再恢复');
        const saved = undoState;
        await dexieDB.transaction('rw', dexieDB.globalSettings, async () => {
            for (const [key, entry] of Object.entries(saved.snapshot)) {
                if (entry.exists) await dexieDB.globalSettings.put({ key, value: entry.value });
                else await dexieDB.globalSettings.delete(key);
            }
        });
        for (const [key, entry] of Object.entries(saved.snapshot)) { if (entry.exists) db[key] = entry.value; else delete db[key]; }
        saved.addedTemplates.forEach(id => document.getElementById('custom-widget-style-' + id)?.remove?.());
        if (saved.keys.includes('fontUrl')) { applyGlobalFont(db.fontUrl || '', false); applyFontSize(db.fontSizeScale || 1); applyGlobalCss(db.globalCss || ''); }
        setupHomeScreen(); renderCustomizeForm(); undoState = null;
    }
    function previewPreset(preset, summary, includesCode) {
        return new Promise(resolve => {
            const overlay = document.createElement('div'); overlay.className = 'feature-dialog'; overlay.id = 'home-preset-preview'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '主页预设导入预览');
            overlay.innerHTML = '<div class="feature-dialog-card"><header><strong>主页预设导入预览</strong><button type="button" data-cancel>取消</button></header><p class="preset-summary" style="white-space:pre-wrap"></p><p>资源地址仅做清单预览，不会提前加载；外链可能因网络、跨域或过期而失效。</p><ul></ul><label data-trust hidden><input type="checkbox">我信任此预设来源，同意运行其小组件代码</label><p>成功导入后可撤销一次主页配置；脚本已产生的外部操作无法撤回。</p><button type="button" data-confirm>确认导入主页预设</button></div>';
            overlay.querySelector('.preset-summary').textContent = summary.join('\n\n');
            const info = inspectResources(preset), list = overlay.querySelector('ul');
            info.resources.forEach(url => { const li = document.createElement('li'); li.textContent = url; list.appendChild(li); });
            if (!info.resources.length) list.textContent = '没有检测到 HTTP(S) 外部资源。';
            const accept = overlay.querySelector('[data-confirm]'), trust = overlay.querySelector('[data-trust]'); trust.hidden = !includesCode; accept.disabled = includesCode;
            trust.querySelector('input').onchange = event => { accept.disabled = !event.target.checked; };
            const finish = yes => { overlay.remove(); resolve(yes); };
            overlay.querySelector('[data-cancel]').onclick = () => finish(false); accept.onclick = () => finish(true);
            overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); } });
            document.body.appendChild(overlay); overlay.querySelector('[data-cancel]').focus();
        });
    }

    async function applyPreset(raw, options = {}) {
        const preset = validate(raw), source = db;
        const homeStamp = JSON.stringify([...HOME_KEYS, 'widgetTemplates', 'addedWidgets', 'fontUrl', 'fontSizeScale', 'globalCss'].map(key => db[key]));
        if (options.requireTrust && inspectResources(preset).requiresTrust && options.trusted !== true) return Promise.reject(new Error('请明确确认信任此预设的小组件代码'));
        return persistPreset(() => {
            if (db !== source || homeStamp !== JSON.stringify([...HOME_KEYS, 'widgetTemplates', 'addedWidgets', 'fontUrl', 'fontSizeScale', 'globalCss'].map(key => db[key]))) fail('主页或恢复数据已变化，请重新导入主页预设');
            return applyPresetNow(preset);
        });
    }
    async function applyPresetNow(preset) {
        const settings = clone(preset.settings);
        const { templates, mapping } = mergeTemplates(settings.widgetTemplates);
        settings.widgetTemplates = templates;
        settings.addedWidgets.forEach(item => { item.templateId = mapping.get(item.templateId) || item.templateId; });
        if (settings.appearance) Object.assign(settings, settings.appearance);
        delete settings.appearance;
        if (!dexieDB) fail('数据库尚未就绪，请稍后重试');
        const snapshot = Object.fromEntries(Object.keys(settings).map(key => [key, { exists: Object.hasOwn(db, key), value: db[key] === undefined ? undefined : clone(db[key]) }]));
        const oldTemplateIds = new Set((db.widgetTemplates || []).map(item => item.id));
        // 先原子保存白名单设置，成功后才更新内存与页面；失败不覆盖原主页。
        await dexieDB.transaction('rw', dexieDB.globalSettings, async () => {
            for (const [key, value] of Object.entries(settings)) {
                await dexieDB.globalSettings.put({ key, value });
            }
        });
        Object.assign(db, settings);
        undoState = { snapshot, keys: Object.keys(settings), applied: JSON.stringify(settings), addedTemplates: settings.widgetTemplates.filter(item => !oldTemplateIds.has(item.id)).map(item => item.id) };
        settings.widgetTemplates.forEach(template => {
            const id = `custom-widget-style-${template.id}`;
            let style = document.getElementById(id);
            if (!style) { style = document.createElement('style'); style.id = id; document.head.appendChild(style); }
            style.textContent = template.css.replace(/{{id}}/g, template.id);
        });
        if (Object.hasOwn(settings, 'fontUrl')) {
            applyGlobalFont(db.fontUrl, false);
            applyFontSize(db.fontSizeScale);
            applyGlobalCss(db.globalCss);
        }
        if (typeof isHomeEditMode !== 'undefined' && isHomeEditMode && typeof exitHomeEditMode === 'function') exitHomeEditMode();
        setupHomeScreen();
        renderCustomizeForm();
        const preview = document.getElementById('wallpaper-preview');
        if (preview) preview.style.backgroundImage = `url("${db.wallpaper}")`;
        undoState.applied = JSON.stringify(Object.fromEntries(undoState.keys.map(key => [key, db[key]])));
        return preset;
    }

    function setup() {
        const exportButton = document.getElementById('home-preset-export-btn');
        const importButton = document.getElementById('home-preset-import-btn');
        const fileInput = document.getElementById('home-preset-import-input');
        if (!exportButton || !importButton || !fileInput || exportButton.dataset.bound) return;
        exportButton.dataset.bound = 'true';
        const status = document.getElementById('home-preset-status');
        const report = (message, error = false) => {
            status.textContent = message;
            status.style.color = error ? '#c0392b' : '#666';
            showToast(message);
        };
        let undoButton;
        if (importButton.insertAdjacentElement) {
            undoButton = document.createElement('button'); undoButton.type = 'button'; undoButton.id = 'home-preset-undo'; undoButton.textContent = '撤销上次主页导入'; undoButton.hidden = !undoState;
            importButton.insertAdjacentElement('afterend', undoButton);
            undoButton.onclick = async () => { busy(true); try { await undoPreset(); undoButton.hidden = true; report('已恢复导入前的主页配置'); } catch (error) { report('撤销失败：' + error.message, true); } finally { busy(false); } };
        }
        const busy = value => { exportButton.disabled = value; importButton.disabled = value; fileInput.disabled = value; if (undoButton) undoButton.disabled = value; };
        exportButton.addEventListener('click', async () => {
            busy(true);
            try {
                const preset = await createPreset(document.getElementById('home-preset-name').value,
                    document.getElementById('home-preset-include-appearance').checked);
                const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
                if (blob.size > MAX_BYTES) fail('预设超过 50MB，请缩小图片或减少组件后导出');
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `主页预设-${preset.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 30000);
                report('主页预设已导出，可将 JSON 文件分享给其他人');
            } catch (error) { report(`导出失败：${error.message}`, true); }
            finally { busy(false); }
        });
        importButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;
            busy(true);
            try {
                if (file.size > MAX_BYTES) fail('预设文件不能超过 50MB');
                let raw;
                try { raw = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
                catch (error) { fail('文件不是有效的 JSON 主页预设'); }
                const preset = validate(raw);
                const settings = preset.settings;
                const includesCode = inspectResources(preset).requiresTrust;
                const summary = [`导入主页预设「${preset.name}」？`,
                    `${settings.homeLayoutPages.length} 页布局 · ${Object.keys(settings.customIcons).length} 个自定义图标 · ${settings.addedWidgets.length} 个小组件`,
                    '将替换当前主页布局、壁纸、图标和桌面小组件。原有组件库会保留。',
                    settings.appearance ? '同时应用字体、字号和全局 CSS（会影响应用内其他页面）。' : '保留当前字体、字号和全局 CSS。',
                    '聊天记录、角色卡和 API 设置保持不变。建议先导出自己的主页留作备份。'];
                if (includesCode) summary.push('此预设包含原始 HTML 小组件，导入后可能执行代码，请仅导入信任来源的文件。');
                if (!await previewPreset(preset, summary, includesCode)) { report('已取消导入'); return; }
                await applyPreset(preset, { requireTrust: true, trusted: true });
                if (undoButton) undoButton.hidden = false;
                document.getElementById('home-preset-name').value = preset.name;
                report(`已应用主页预设「${preset.name}」，返回主页即可查看`);
            } catch (error) { report(`导入失败：${error.message}`, true); }
            finally { fileInput.value = ''; busy(false); }
        });
    }

    window.HomePresets = Object.freeze({ createPreset, validate, applyPreset, inspectResources, undoPreset, canUndo: () => Boolean(undoState) });
    window.setupHomePresets = setup;
})();
