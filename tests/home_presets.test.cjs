const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/home_presets.js'), 'utf8');
const image = 'data:image/png;base64,aGVsbG8=';
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
    const template = { id: 'my-clock', name: '时钟', size: '2x2',
        html: '<div id="{{id}}">{{caption}}</div>', css: '#{{id}} { color: pink; }',
        js: '', defaultVars: { caption: '你好', image } };
    const db = {
        wallpaper: image, homeScreenMode: 'day', customIcons: { 'chat-list-screen': image },
        homeSignature: '我的桌面', insWidgetSettings: { avatar1: image, bubble1: '你好' },
        homeWidgetSettings: { centralCircleImage: image, topLeft: { emoji: '🌸', text: '早安' } },
        homeLayoutPages: [['app-customize', 'custom-widget-1'], ['app-chat']],
        addedWidgets: [{ id: 'custom-widget-1', templateId: 'my-clock', vars: { caption: '我的文字', image } }],
        widgetTemplates: [template, { ...template, id: 'unused', name: '不分享的组件' }],
        fontUrl: '', fontSizeScale: 1.1, globalCss: '#home-screen { color: pink; }',
        characters: [{ id: 'private-person', history: ['private-history'] }],
        apiSettings: { key: 'SECRET_API_KEY', url: 'https://api.example.com' },
        apiPresets: [{ key: 'SECRET_PRESET_KEY' }], fontPresets: []
    };
    const nodes = new Map();
    const persisted = new Map();
    let failing = false;
    const context = vm.createContext({
        window: {}, db, appVersion: 'test', console,
        defaultIcons: { 'chat-list-screen': {}, 'customize-screen': {} },
        defaultWidgetSettings: { topLeft: { emoji: '', text: '' }, topRight: { emoji: '', text: '' },
            bottomLeft: { emoji: '', text: '' }, bottomRight: { emoji: '', text: '' } },
        dexieDB: {
            globalSettings: { put: async ({ key, value }) => {
                if (failing) throw new Error('disk full');
                persisted.set(key, plain(value));
            } },
            customFonts: { get: async () => ({ file: { dataURL: 'data:font/woff2;base64,Zm9udA==' } }) },
            transaction: async (mode, table, callback) => {
                const old = new Map(persisted);
                try { await callback(); } catch (error) {
                    persisted.clear(); old.forEach((value, key) => persisted.set(key, value)); throw error;
                }
            }
        },
        FileReader: class { readAsDataURL(file) { this.result = file.dataURL; this.onload(); } },
        document: { getElementById: id => nodes.get(id), createElement: () => ({ style: {} }),
            head: { appendChild: node => nodes.set(node.id, node) } },
        applyGlobalFont() {}, applyFontSize() {}, applyGlobalCss() {},
        setupHomeScreen() {}, renderCustomizeForm() {}
    });
    vm.runInContext(source, context);
    return { db, api: context.window.HomePresets, persisted, context,
        setFailing: value => { failing = value; } };
}

test('export includes visible layout, images, variables and templates; excludes private data and unused templates', async () => {
    const { db, api } = fixture();
    db.widgetTemplates[0].apiKey = 'SECRET_TEMPLATE_METADATA';
    const preset = plain(await api.createPreset('奶油桌面', true));
    assert.equal(preset.name, '奶油桌面');
    assert.equal(preset.settings.wallpaper, image);
    assert.equal(preset.settings.addedWidgets[0].vars.image, image);
    assert.deepEqual(preset.settings.homeLayoutPages, db.homeLayoutPages);
    assert.equal(preset.settings.widgetTemplates.length, 1);
    assert.equal(preset.settings.appearance.fontSizeScale, 1.1);
    const json = JSON.stringify(preset);
    for (const secret of ['SECRET_', 'private-person', 'private-history', 'unused', 'apiSettings']) assert.equal(json.includes(secret), false);
});

test('export can omit font, size and global CSS', async () => {
    const { api } = fixture();
    const preset = await api.createPreset('', false);
    assert.equal(preset.name, '我的主页');
    assert.equal(Object.hasOwn(preset.settings, 'appearance'), false);
});

test('active locally uploaded font is embedded so another user can use it', async () => {
    const { db, api } = fixture();
    db.fontUrl = 'CustomFont_123';
    db.fontPresets = [{ id: 'font_123', fontFamily: db.fontUrl, isCustom: true }];
    const preset = await api.createPreset('本地字体', true);
    assert.equal(preset.settings.appearance.fontUrl, 'data:font/woff2;base64,Zm9udA==');
    assert.equal(JSON.stringify(preset).includes('fontPresets'), false);
});

test('missing local font fails export instead of creating a broken shared font', async () => {
    const { db, api } = fixture();
    db.fontUrl = 'CustomFont_missing';
    await assert.rejects(api.createPreset('字体', true), /字体文件缺失/);
});

test('import applies home settings and keeps recipient chats, credentials and template library', async () => {
    const sender = fixture();
    const preset = await sender.api.createPreset('分享', true);
    const recipient = fixture();
    recipient.db.wallpaper = 'https://example.com/old.png';
    const originalCharacters = recipient.db.characters;
    const originalApi = recipient.db.apiSettings;
    preset.settings.apiSettings = { key: 'ATTACKER_KEY' };
    preset.settings.characters = [];
    await recipient.api.applyPreset(preset);
    assert.equal(recipient.db.wallpaper, image);
    assert.equal(recipient.db.characters, originalCharacters);
    assert.equal(recipient.db.apiSettings, originalApi);
    assert.equal(recipient.db.widgetTemplates.some(item => item.id === 'unused'), true);
    assert.equal(recipient.persisted.has('apiSettings'), false);
    assert.equal(recipient.persisted.has('characters'), false);
    assert.deepEqual(recipient.persisted.get('homeLayoutPages'), plain(preset.settings.homeLayoutPages));
});

test('conflicting template ID is remapped without overwriting recipient template', async () => {
    const { api, db } = fixture();
    const preset = await api.createPreset('冲突', false);
    preset.settings.widgetTemplates[0].css = '#my-clock { color: blue; }';
    await api.applyPreset(preset);
    assert.equal(db.widgetTemplates.find(item => item.id === 'my-clock').css, '#{{id}} { color: pink; }');
    const imported = db.widgetTemplates.find(item => item.id === db.addedWidgets[0].templateId);
    assert.notEqual(imported.id, 'my-clock');
    assert.equal(imported.css, `#${imported.id} { color: blue; }`);
});

test('without appearance, recipient font and CSS remain unchanged', async () => {
    const { api, db } = fixture();
    const preset = await api.createPreset('仅桌面', false);
    db.fontUrl = 'https://example.com/private-font.woff2';
    db.globalCss = '.my-css { color: red; }';
    await api.applyPreset(preset);
    assert.equal(db.fontUrl, 'https://example.com/private-font.woff2');
    assert.equal(db.globalCss, '.my-css { color: red; }');
});

test('importing a conflicting preset repeatedly reuses its imported template', async () => {
    const { api, db } = fixture();
    const preset = await api.createPreset('重复导入', false);
    preset.settings.widgetTemplates[0].css = '#my-clock { color: blue; }';
    await api.applyPreset(preset);
    const firstTemplateId = db.addedWidgets[0].templateId;
    const count = db.widgetTemplates.length;
    await api.applyPreset(preset);
    assert.equal(db.widgetTemplates.length, count);
    assert.equal(db.addedWidgets[0].templateId, firstTemplateId);
});

test('template remapping cannot take the ID of another incoming template', async () => {
    const { api, db } = fixture();
    const preset = await api.createPreset('多个冲突', false);
    preset.settings.widgetTemplates[0].css = '#my-clock { color: blue; }';
    preset.settings.widgetTemplates.push({ ...preset.settings.widgetTemplates[0], id: 'imported-my-clock-1', name: '第二个模板' });
    await api.applyPreset(preset);
    assert.equal(db.addedWidgets[0].templateId, 'imported-my-clock-2');
    assert.equal(db.widgetTemplates.find(item => item.id === 'imported-my-clock-1').name, '第二个模板');
});

test('database failure leaves original in-memory home and saved settings intact', async () => {
    const { api, db, setFailing, persisted } = fixture();
    const preset = await api.createPreset('失败', true);
    preset.settings.wallpaper = 'https://example.com/new.png';
    const before = plain(db);
    setFailing(true);
    await assert.rejects(api.applyPreset(preset), /disk full/);
    assert.deepEqual(plain(db), before);
    assert.equal(persisted.size, 0);
});

test('reject unrelated JSON and unknown schema versions', async () => {
    const { api } = fixture();
    assert.throws(() => api.validate({}), /主页预设/);
    const preset = await api.createPreset('版本', false);
    preset.version = 2;
    assert.throws(() => api.validate(preset), /版本/);
});

test('reject prototype pollution keys', async () => {
    const { api } = fixture();
    const preset = plain(await api.createPreset('安全', false));
    preset.settings.customIcons = JSON.parse('{"__proto__":{"polluted":true}}');
    assert.throws(() => api.validate(preset), /不支持的数据字段/);
    assert.equal({}.polluted, undefined);
});

test('reject missing templates, duplicate layout positions and unsupported sizes before changing data', async () => {
    const { api, db } = fixture();
    const preset = plain(await api.createPreset('校验', false));
    const before = plain(db);
    const missing = plain(preset); missing.settings.widgetTemplates = [];
    await assert.rejects(api.applyPreset(missing), /缺少小组件模板/);
    const repeated = plain(preset); repeated.settings.homeLayoutPages[0].push('custom-widget-1');
    await assert.rejects(api.applyPreset(repeated), /重复放置/);
    const invalidSize = plain(preset); invalidSize.settings.widgetTemplates[0].size = '100x100';
    await assert.rejects(api.applyPreset(invalidSize), /尺寸/);
    assert.deepEqual(plain(db), before);
});

test('reject script URLs, HTML attribute injection and temporary resource links', async () => {
    const { api } = fixture();
    const preset = plain(await api.createPreset('资源', false));
    for (const url of ['javascript:alert(1)', 'blob:unshareable', 'https://example.com/" onerror="alert(1)']) {
        preset.settings.customIcons['chat-list-screen'] = url;
        assert.throws(() => api.validate(preset), /HTTP/);
    }
});
