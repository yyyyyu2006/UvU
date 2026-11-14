const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(books = []) {
    let ids = 0;
    const c = vm.createContext({
        db: { worldBooks: books }, crypto: { randomUUID: () => 'generated-' + ++ids },
        confirm: () => true, wbPathStack: [{ id: 'root' }],
        saveData: async () => {}, renderWorldBookList() {}, showToast() {}
    });
    for (const name of ['worldbook_rules', 'worldbook_editor']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/' + name + '.js'), 'utf8'), c);
    }
    return { c, ids: () => ids };
}

test('worldbook rejects 3001 valid entries before constructing any internal records', () => {
    for (const asObject of [false, true]) {
        const { c, ids } = fixture();
        const rows = Array.from({ length: 3001 }, () => ({ content: '' }));
        const entries = asObject ? Object.fromEntries(rows.map((row, i) => ['key' + i, row])) : rows;
        assert.throws(() => c.importWorldBookJson({ entries }, 'root'), /3000/);
        assert.equal(ids(), 0);
    }
});

test('worldbook keeps valid-entry limits, own-property order and existing wrapper formats', () => {
    const { c, ids } = fixture();
    const rows = Array.from({ length: 3000 }, (_, i) => ({ name: 'entry-' + i, content: String(i) }));
    const result = c.importWorldBookJson({ data: { character_book: { entries: [null, {}, ...rows, false] } } }, 'root');
    assert.equal(result.books.length, 3000);
    assert.equal(ids(), 3000);
    assert.equal(result.books[0].name, 'entry-0');
    assert.equal(result.books[2999].name, 'entry-2999');
    const entries = Object.assign(Object.create({ inherited: { content: 'ignored' } }), { b: { content: 'B' }, a: { content: 'A' } });
    assert.deepEqual(Array.from(c.importWorldBookJson({ character_book: { entries } }, 'root').books, b => b.content), ['B', 'A']);
    assert.equal(c.importWorldBookJson([{ content: 'flat' }], 'root').books[0].content, 'flat');
});

test('failed worldbook import only removes its own records and preserves concurrent additions, deletions and replacements', async () => {
    const original = { id: 'original', content: 'original' }, shared = { id: 'shared', content: 'before' };
    const { c } = fixture([original, shared]);
    let rejectSave, entered;
    const started = new Promise(resolve => { entered = resolve; });
    c.saveData = () => { entered(); return new Promise((_, reject) => { rejectSave = reject; }); };
    const pending = c.importWorldBookDocument({ name: 'import.json', size: 32, text: async () => JSON.stringify({ entries: [{ content: 'new import' }] }) });
    await started;
    const replacement = { id: 'original', content: 'replacement' }, addition = { id: 'addition', content: 'keep' };
    c.db.worldBooks = c.db.worldBooks.filter(book => book !== original);
    c.db.worldBooks.push(replacement, addition);
    shared.content = 'edited while saving';
    rejectSave(new Error('save failed'));
    await assert.rejects(pending, /save failed/);
    assert.deepEqual(Array.from(c.db.worldBooks), [shared, replacement, addition]);
    assert.equal(shared.content, 'edited while saving');
});
