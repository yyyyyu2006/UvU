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
