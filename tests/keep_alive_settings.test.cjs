const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(settings = {}) {
    const fields = new Map();
    for (const id of ['keep-alive-switch', 'keep-alive-screen-switch', 'keep-alive-audio-switch']) {
        const field = new EventTarget(); Object.assign(field, { checked: false, disabled: false, dataset: {} }); fields.set(id, field);
    }
    const state = { db: { apiSettings: { ...settings } }, calls: [], saves: 0, toasts: [], save: async () => {} };
    let enabled = Boolean(settings.keepAliveEnabled);
    const context = vm.createContext({ db: state.db, document: { getElementById: id => fields.get(id) },
        window: { KeepAliveManager: {
            async setEnabled(value, options) { enabled = value; state.calls.push({ value, options }); },
            getDiagnostics: () => ({ screenAwake: false, audioPlaying: false })
        } },
        showToast: text => state.toasts.push(text), saveData: async () => { state.saves++; return state.save(); } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/settings_api.js'), 'utf8'), context);
    context.setupKeepAliveSettings();
    Object.assign(state, { fields, context, get enabled() { return enabled; } });
    state.change = async (id, value) => { const field = fields.get(id); field.checked = value; field.dispatchEvent(new Event('change')); await tick(); };
    return state;
}
test('legacy keepalive preference keeps separate capabilities without automatically enabling', async () => {
    const h = harness();
    assert.equal(h.fields.get('keep-alive-switch').checked, false); assert.equal(h.calls.length, 0);
    assert.equal(h.fields.get('keep-alive-screen-switch').checked, true);
    await h.change('keep-alive-audio-switch', false);
    assert.equal(h.db.apiSettings.keepAliveEnabled, false); assert.equal(h.db.apiSettings.keepAliveOptions.compatibilityAudio, false);
});
test('failed preference save restores data, controls, and running state', async () => {
    const h = harness({ keepAliveEnabled: true, keepAliveOptions: { screenAwake: false, compatibilityAudio: true } });
    h.save = async () => { throw Error('quota'); };
    await h.change('keep-alive-switch', false);
    assert.equal(h.db.apiSettings.keepAliveEnabled, true); assert.equal(h.fields.get('keep-alive-switch').checked, true);
    assert.equal(h.calls.at(-1).value, true); assert.equal(h.calls.at(-1).options.screenAwake, false);
    assert.ok([...h.fields.values()].every(f => !f.disabled)); assert.match(h.toasts.at(-1), /保存失败/);
});
test('pending saves serialize control changes and setup cannot bind twice', async () => {
    const h = harness(); let finish; h.save = () => new Promise(resolve => { finish = resolve; });
    h.context.setupKeepAliveSettings();
    await h.change('keep-alive-switch', true); assert.equal(h.saves, 1);
    assert.ok([...h.fields.values()].every(f => f.disabled));
    finish(); await tick(); assert.ok([...h.fields.values()].every(f => !f.disabled));
    assert.match(h.toasts.at(-1), /浏览器限制/);
});
