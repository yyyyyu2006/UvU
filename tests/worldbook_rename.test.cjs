const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
    const book = { id: 'entry', type: 'entry', parentId: 'folder', name: '旧条目', content: '保留正文', position: 'guidelines', depth: 200,
        rules: { advancedEnabled: false, keys: ['习惯'], order: 23 }, importSource: { comment: '原始导入资料' } };
    const folder = { id: 'folder', type: 'folder', parentId: null, name: '旧文件夹' };
    const c = vm.createContext({ document: { addEventListener() {} }, db: { worldBooks: [folder, book], characters: [{ worldBookIds: ['entry'] }], groups: [{ worldBookIds: ['entry'] }] },
        saves: 0, saveData: async () => { c.saves++; c.persisted = plain(c.db); } });
    for (const name of ['worldbook', 'worldbook_editor']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/' + name + '.js'), 'utf8'), c);
    return { c, book, folder };
}

test('worldbook rename changes only the name and persists existing bindings and all imported settings', async () => {
    const { c, book } = fixture(), before = plain(c.db);
    assert.equal(await c.renameWorldBookItem('entry', '  新条目  '), true);
    before.worldBooks[1].name = '新条目';
    assert.deepEqual(plain(c.db), before);
    assert.deepEqual(c.persisted, before);
    assert.equal(c.db.worldBooks[1], book);
    assert.equal(c.saves, 1);
});

test('folder rename preserves descendants and updates navigation labels by ID', async () => {
    const { c, book } = fixture();
    vm.runInContext("wbPathStack.push({id:'folder',name:'旧文件夹'}); selectorPathStack.push({id:'folder',name:'旧文件夹'},{id:'other',name:'旧文件夹'});", c);
    assert.equal(await c.renameWorldBookItem('folder', '新的文件夹'), true);
    assert.equal(book.parentId, 'folder');
    assert.equal(book.name, '旧条目');
    assert.equal(vm.runInContext('wbPathStack[1].name', c), '新的文件夹');
    assert.equal(vm.runInContext('selectorPathStack[1].name', c), '新的文件夹');
    assert.equal(vm.runInContext('selectorPathStack[2].name', c), '旧文件夹');
    assert.deepEqual(c.persisted.characters[0].worldBookIds, ['entry']);
});

test('empty names and removed items are rejected without saving; unchanged names need no write', async () => {
    const { c, book } = fixture();
    await assert.rejects(c.renameWorldBookItem('entry', ' \n\t '), /名称不能为空/);
    await assert.rejects(c.renameWorldBookItem('missing', '名称'), /不存在/);
    assert.equal(await c.renameWorldBookItem('entry', '旧条目'), false);
    assert.equal(book.name, '旧条目'); assert.equal(c.saves, 0);
});

test('failed rename restores its own name without reverting unrelated edits or navigation', async () => {
    const { c, book } = fixture();
    c.saveData = async () => { book.content = '保存期间的新正文'; throw new Error('模拟保存失败'); };
    await assert.rejects(c.renameWorldBookItem('entry', '未保存名称'), /模拟保存失败/);
    assert.equal(book.name, '旧条目'); assert.equal(book.content, '保存期间的新正文');
    c.saveData = async () => {};
    assert.equal(await c.renameWorldBookItem('entry', '重试成功'), true);
});

test('pending rename prevents a second write to the same item and never targets a different current folder', async () => {
    const { c, folder } = fixture(); let finish;
    c.saveData = () => new Promise(resolve => { finish = resolve; });
    const pending = c.renameWorldBookItem('folder', '正在保存');
    vm.runInContext("wbPathStack.push({id:'another-folder',name:'另一个文件夹'});", c);
    await assert.rejects(c.renameWorldBookItem('folder', '再次保存'), /正在保存/);
    finish(); assert.equal(await pending, true);
    assert.equal(folder.name, '正在保存');
    assert.equal(vm.runInContext('wbPathStack.at(-1).name', c), '另一个文件夹');
});

function gestureFixture() {
    const { c } = fixture();
    const listeners = new Map(), timers = new Map(); let serial = 0;
    const surface = name => ({ dataset: {}, addEventListener(type, fn, capture) {
        const key = name + ':' + type;
        const values = listeners.get(key) || []; values.push({ fn, capture }); listeners.set(key, values);
    } });
    const container = surface('list'), doc = surface('document'), win = surface('window');
    const card = { dataset: { id: 'entry' }, isConnected: true };
    const name = { closest: selector => selector === '.wb-item-card' ? card : selector === '.wb-item-name' ? name : null };
    const icon = { closest: selector => selector === '.wb-item-card' ? card : null };
    doc.getElementById = () => ({ classList: { contains: () => true } });
    Object.assign(c, { document: doc, window: win, isWorldBookMultiSelectMode: false,
        setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
        renames: [], selections: [], requestWorldBookRename: id => c.renames.push(id),
        enterWorldBookMultiSelectMode: id => c.selections.push(id) });
    c.setupWorldBookLongPress(container);
    const emit = (type, target = name, options = {}, source = 'list') => {
        const event = { target, pointerId: 1, isPrimary: true, button: 0, clientX: 20, clientY: 30,
            preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...options };
        for (const { fn } of listeners.get(source + ':' + type) || []) { fn(event); if (event.stopped) break; }
        return event;
    };
    const hold = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
    return { c, container, card, name, icon, emit, hold, timers };
}

test('holding a name renames once and blocks the release click; a fresh tap still opens normally', () => {
    const { c, emit, hold } = gestureFixture();
    emit('pointerdown'); hold();
    assert.deepEqual(c.renames, ['entry']); assert.deepEqual(c.selections, []);
    emit('pointerup', undefined, {}, 'document');
    assert.equal(emit('click').prevented, true);
    emit('pointerdown'); emit('pointerup', undefined, {}, 'document');
    assert.equal(emit('click').prevented, undefined);
});

test('holding an icon keeps original multi-select and prevents release from deselecting it', () => {
    const { c, icon, emit, hold } = gestureFixture();
    emit('pointerdown', icon); hold();
    assert.deepEqual(c.selections, ['entry']); assert.deepEqual(c.renames, []);
    assert.equal(emit('click', icon).prevented, true);
});

test('scroll, pointer cancellation, leaving the list, hidden page and a removed card cancel pending holds', () => {
    for (const action of ['move', 'cancel', 'leave', 'scroll', 'hidden', 'removed', 'release', 'blur']) {
        const { c, card, emit, hold } = gestureFixture(); emit('pointerdown');
        if (action === 'move') emit('pointermove', undefined, { clientX: 40 });
        if (action === 'cancel') emit('pointercancel', undefined, {}, 'document');
        if (action === 'leave') emit('pointerleave');
        if (action === 'scroll') emit('scroll', undefined, {}, 'document');
        if (action === 'hidden') { c.document.hidden = true; emit('visibilitychange', undefined, {}, 'document'); }
        if (action === 'removed') card.isConnected = false;
        if (action === 'release') emit('pointerup', undefined, {}, 'document');
        if (action === 'blur') emit('blur', undefined, {}, 'window');
        hold(); assert.deepEqual(c.renames, [], action); assert.deepEqual(c.selections, [], action);
    }
});

test('multi-select mode, additional pointers and a secondary mouse button never open rename', () => {
    const { c, emit, hold } = gestureFixture();
    c.isWorldBookMultiSelectMode = true; emit('pointerdown'); hold();
    c.isWorldBookMultiSelectMode = false;
    emit('pointerdown', undefined, { button: 2 }); hold();
    emit('pointerdown'); emit('pointerdown', undefined, { isPrimary: false, pointerId: 2 }); hold();
    assert.deepEqual(c.renames, []); assert.deepEqual(c.selections, []);
});

test('F2 offers keyboard rename while long-press context menus are suppressed only on cards', () => {
    const { c, emit } = gestureFixture();
    assert.equal(emit('keydown', undefined, { key: 'F2' }).prevented, true);
    assert.deepEqual(c.renames, ['entry']);
    emit('pointerdown'); assert.equal(emit('contextmenu').prevented, true);
});
