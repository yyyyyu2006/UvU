'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function source(name) {
    const file = 'js/modules/' + name + '.js';
    return process.env.UVU_REPAIR_BASELINE
        ? require('node:child_process').execFileSync('git', ['show', process.env.UVU_REPAIR_BASELINE + ':' + file], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
        : fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}
function node(value = '') {
    return { value, src: value, disabled: false, handlers: {}, classList: { remove() {} },
        addEventListener(type, fn) { this.handlers[type] = fn; }, click() { this.clicked = true; } };
}
test('persona preset waits for persistence, rolls back failures, and retries without duplicate entries', async () => {
    const nodes = new Map([['setting-my-persona', node('new persona')], ['setting-my-avatar-preview', node('avatar')]]);
    const previous = [{ name: 'existing', persona: 'old' }], notices = [];
    let reject, resolve;
    const c = vm.createContext({ window: {}, db: { myPersonaPresets: previous }, console: { error() {} },
        document: { getElementById: id => nodes.get(id) }, prompt: () => 'new', showToast: text => notices.push(text),
        saveData: () => new Promise((yes, no) => { resolve = yes; reject = no; }) });
    vm.runInContext(source('settings_presets'), c);
    const failed = c.saveCurrentMyPersonaAsPreset();
    assert.equal(notices.length, 0);
    reject(new Error('isolated persistence failure')); await failed;
    assert.equal(c.db.myPersonaPresets, previous);
    assert.equal(previous.length, 1); assert.match(notices.at(-1), /失败/);
    const success = c.saveCurrentMyPersonaAsPreset(); resolve(); await success;
    assert.equal(c.db.myPersonaPresets.length, 2); assert.match(notices.at(-1), /已保存/);
});
test('unlock persistence failure retains credential, restores flag, and permits retry', async () => {
    const nodes = new Map(['st-unlock-modal', 'st-unlock-image-input', 'st-unlock-key-input', 'st-unlock-verify-btn', 'st-unlock-cancel-btn', 'character-card-input'].map(id => [id, node()]));
    const entries = new Map([['st_unlock_uuid', 'fixture-uuid'], ['st_unlock_name', 'fixture-name'], ['st_unlock_time', String(Date.now())]]);
    nodes.get('st-unlock-key-input').value = btoa('fixture-uuid|fixture-name');
    let fail = true; const notices = [];
    const c = vm.createContext({ window: {}, db: { stUnlocked: false }, atob, Date, console: { error() {} },
        document: { getElementById: id => nodes.get(id) },
        localStorage: { getItem: key => entries.get(key) ?? null, removeItem: key => entries.delete(key) },
        showToast: value => notices.push(value), saveData: async () => { if (fail) throw new Error('isolated failure'); } });
    vm.runInContext(source('st_unlock'), c); c.setupStUnlock();
    const verify = nodes.get('st-unlock-verify-btn');
    await verify.handlers.click();
    assert.equal(c.db.stUnlocked, false); assert.equal(entries.size, 3); assert.equal(verify.disabled, false);
    assert.equal(nodes.get('character-card-input').clicked, undefined); assert.match(notices.at(-1), /失败/);
    fail = false; await verify.handlers.click();
    assert.equal(c.db.stUnlocked, true); assert.equal(entries.size, 0); assert.equal(nodes.get('character-card-input').clicked, true);
});
for (const bad of ['null', '[]', '1', 'true', '"text"']) {
    test('widget editor rejects non-object variables: ' + bad, async () => {
        const ids = ['widget-editor-modal', 'widget-editor-form', 'widget-editor-cancel-btn', 'widget-edit-id', 'widget-edit-name', 'widget-edit-size', 'widget-edit-html', 'widget-edit-css', 'widget-edit-js', 'widget-edit-vars'];
        const nodes = new Map(ids.map(id => [id, node()]));
        nodes.get('widget-edit-vars').value = bad; nodes.get('widget-edit-id').value = 'fixture';
        const ready = [], notices = []; let saved = 0;
        const c = vm.createContext({ window: {}, db: { widgetTemplates: [] }, document: { addEventListener: (type, fn) => ready.push(fn), getElementById: id => nodes.get(id), querySelectorAll: () => [] },
            console, showToast: text => notices.push(text), saveData: async () => { saved++; }, setupHomeScreen() {} });
        vm.runInContext(source('widget_market'), c); ready.forEach(fn => fn());
        await nodes.get('widget-editor-form').handlers.submit({ preventDefault() {} });
        assert.equal(saved, 0); assert.equal(c.db.widgetTemplates.length, 0); assert.match(notices.at(-1), /JSON/);
    });
}
