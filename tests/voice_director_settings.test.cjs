const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');

function fixture(saved = {}) {
    const elements = new Map(), toasts = [];
    function el(id) {
        if (!elements.has(id)) elements.set(id, { id, value: '', checked: false, hidden: false, dataset: {},
            listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
        return elements.get(id);
    }
    const db = { minimaxTtsSettings: saved };
    let saves = 0;
    const c = vm.createContext({ db, URL, window: {}, document: { getElementById: el },
        showToast: text => toasts.push(text), previewMiniMaxVoice() {}, saveData: async () => { saves++; if (state.fail) throw new Error('quota'); } });
    for (const file of ['js/modules/voice_director.js', 'js/modules/settings_api.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
    }
    const state = { db, el, toasts, get saves() { return saves; } };
    c.setupMiniMaxTtsSettings();
    state.director = vm.runInContext('VoiceDirector', c);
    state.save = () => el('minimax-tts-save').listeners.click();
    return state;
}
test('old settings keep director off and hide its fields', () => {
    const f = fixture({ apiKey: 'voice-key', voiceId: 'voice' });
    assert.equal(f.el('minimax-director-enabled').checked, false);
    assert.equal(f.el('minimax-director-fields').hidden, true);
});
test('voice settings preserve independent director form values and preview reads unsaved changes', async () => {
    const f = fixture({ apiKey: 'voice-key', voiceId: 'voice', director: { enabled: true, endpoint: 'https://director.test/v1',
        apiKey: 'director-key', model: 'director-model', provider: 'newapi', contextMessages: 8, timeoutSec: 9, prompt: '克制' } });
    assert.equal(f.el('minimax-director-enabled').checked, true);
    assert.equal(f.el('minimax-director-fields').hidden, false);
    assert.equal(f.el('minimax-director-key').value, 'director-key');
    f.el('minimax-director-model').value = 'unsaved-model';
    assert.equal(f.director.fromForm().model, 'unsaved-model');
    await f.save();
    assert.equal(f.db.minimaxTtsSettings.apiKey, 'voice-key');
    assert.equal(f.db.minimaxTtsSettings.director.apiKey, 'director-key');
    assert.equal(f.db.minimaxTtsSettings.director.model, 'unsaved-model');
    assert.equal(f.db.minimaxTtsSettings.director.contextMessages, 8);
});
test('incomplete enabled director settings cannot be saved', async () => {
    const f = fixture({ voiceId: 'voice' });
    f.el('minimax-director-enabled').checked = true;
    await f.save();
    assert.equal(f.saves, 0);
    assert.ok(f.toasts.some(text => /导演/.test(text)));
});
test('failed voice settings save restores the previous settings object', async () => {
    const old = { apiKey: 'voice-key', voiceId: 'voice' }, f = fixture(old);
    f.fail = true; f.el('minimax-tts-voice').value = 'new-voice';
    await assert.doesNotReject(f.save());
    assert.equal(f.db.minimaxTtsSettings, old);
    assert.ok(f.toasts.some(text => /失败/.test(text)));
});
