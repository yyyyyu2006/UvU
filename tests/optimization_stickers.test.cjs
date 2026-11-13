const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture() {
    const c = vm.createContext({ console, setTimeout, clearTimeout, AbortController,
        db: { myStickers: [] }, worldBookKeys: value => Array.isArray(value) ? value : String(value || '').split(/[,，]/).filter(Boolean),
        validStickerImage: value => typeof value === 'string' && /^(data:image\/|https?:)/.test(value), saveData: async () => {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/sticker_assist.js'), 'utf8'), c);
    return c;
}
test('description injection requires explicit opt-in and bounds the enabled relevant subset', () => {
    const c = fixture(), chat = { stickerGroups: '猫', history: [{ role: 'user', content: '开心' }] };
    c.db.myStickers = [{ id: 'a', group: '猫', name: '开心', keywords: ['高兴'], description: '开心的猫', data: 'https://image/a' },
        { id: 'b', group: '猫', name: '难过', description: '难过的猫', data: 'https://image/b' }];
    assert.equal(c.getStickerDescriptionContext(chat), '');
    chat.stickerDescriptionSettings = { maxItems: 12 }; assert.equal(c.getStickerDescriptionContext(chat), '');
    chat.stickerDescriptionSettings = { enabled: false }; assert.equal(c.getStickerDescriptionContext(chat), '');
    chat.stickerDescriptionSettings = { enabled: true, relevantOnly: true, maxChars: 200, maxItems: 1 };
    const context = c.getStickerDescriptionContext(chat); assert.match(context, /开心的猫/); assert.doesNotMatch(context, /难过的猫/); assert.ok(context.length <= 200);
});
test('failed sticker import removes its IDs and preserves concurrent additions and edits', async () => {
    const c = fixture(); c.db.myStickers = [{ id: 'old', name: 'original' }];
    c.saveData = async () => { c.db.myStickers[0].name = 'edited'; c.db.myStickers.push({ id: 'concurrent' }); throw new Error('quota'); };
    await assert.rejects(c.saveImportedStickers([{ id: 'new', name: 'new' }]), /quota/);
    assert.deepEqual(Array.from(c.db.myStickers, item => item.id), ['old', 'concurrent']); assert.equal(c.db.myStickers[0].name, 'edited');
});
test('pending image recognition does not overwrite a user edit even if reset to original text', async () => {
    const c = fixture(); let finish;
    c.recognizeStickerImage = async () => new Promise(resolve => { finish = resolve; });
    const listeners = new Set(), input = { value: '', addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) };
    const pending = c.recognizeStickerIntoInput('https://image/a', input);
    input.value = 'my edit'; for (const listener of listeners) listener(); input.value = ''; for (const listener of listeners) listener();
    finish('model description'); assert.equal(await pending, false); assert.equal(input.value, ''); assert.equal(listeners.size, 0);
});
test('import duplicate preview distinguishes existing and repeated document images', () => {
    const c = fixture();
    const duplicates = c.getStickerImportDuplicates([{ data: 'https://image/a' }, { data: 'https://image/b' }, { data: 'https://image/b' }], [{ id: 'existing', data: 'https://image/a' }]);
    assert.equal(duplicates[0].duplicate, true); assert.equal(duplicates[1].duplicate, false); assert.equal(duplicates[2].duplicate, true);
});
test('suggestion keyword cache observes in-place name and keyword edits', () => {
    const c = fixture(), sticker = { name: '开心', keywords: ['高兴'], data: 'https://image/a' };
    assert.equal(c.getStickerSuggestions('高兴', [sticker]).length, 1); sticker.keywords[0] = '难过';
    assert.equal(c.getStickerSuggestions('高兴', [sticker]).length, 0); assert.equal(c.getStickerSuggestions('难过', [sticker]).length, 1);
});
test('queued batch recognition skips a description filled before its worker starts', async () => {
    const c = fixture(); let requested = false;
    c.recognizeStickerImage = async () => { requested = true; return 'model text'; };
    const input = { value: 'manual before queue starts', addEventListener() {}, removeEventListener() {} };
    assert.equal(await c.recognizeStickerIntoInput('https://image/a', input, { onlyIfEmpty: true }), false);
    assert.equal(requested, false); assert.equal(input.value, 'manual before queue starts');
});
