const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Dexie = require('dexie');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');

let serial = 0;
async function fixture(t) {
    const database = new Dexie(`uvu-regression-${Date.now()}-${serial++}`, { indexedDB, IDBKeyRange });
    database.version(1).stores({ characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id', globalSettings: 'key', customFonts: '&id' });
    await database.open();
    t.after(() => database.delete());
    const c = vm.createContext({ Dexie, console, structuredClone, Blob, File, atob, window: {}, document: { addEventListener() {} } });
    for (const file of ['db.js', 'modules/chat_archives.js', 'modules/storage.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), c);
    }
    c.dexieDB = database;
    c.db = { characters: [{ id: 'c', history: [{ id: 'm', content: 'original', timestamp: 1 }], persona: 'original persona' }],
        groups: [{ id: 'g', history: [] }], worldBooks: [{ id: 'w', content: 'world' }], myStickers: [{ id: 's', data: 'image' }],
        apiSettings: { model: 'original-model' }, cotPresets: [{ content: 'original prompt' }] };
    const save = () => vm.runInContext('saveData()', c);
    await save();
    const writes = [];
    for (const table of database.tables) {
        table.hook('creating', (_key, value) => { writes.push(`${table.name}:${value.id || value.key}`); });
        table.hook('updating', (_changes, key) => { writes.push(`${table.name}:${key}`); });
    }
    return { c, database, save, writes };
}

test('unchanged save writes no records; in-place mutations save only affected records and active archive', async t => {
    const f = await fixture(t);
    await f.save();
    assert.deepEqual(f.writes, []);
    f.c.db.characters[0].history[0].content = 'edited in place';
    await f.save();
    assert.deepEqual(f.writes, ['characters:c']);
    const saved = await f.database.characters.get('c');
    assert.equal(saved.history[0].content, 'edited in place');
    assert.equal(saved.archives[0].data.history[0].content, 'edited in place');
    assert.deepEqual(await f.database.globalSettings.get('cotPresets'), { key: 'cotPresets', value: [{ content: 'original prompt' }] });
});

test('failure rolls back all tables and next save retries every unapplied change', async t => {
    const f = await fixture(t);
    f.c.db.characters[0].history.push({ id: 'new', content: 'new message' });
    f.c.db.groups[0].name = 'changed group';
    const fail = () => { throw new Error('simulated disk failure'); };
    f.database.groups.hook('updating', fail);
    await assert.rejects(f.save(), /simulated disk failure/);
    assert.equal((await f.database.characters.get('c')).history.length, 1);
    f.database.groups.hook('updating').unsubscribe(fail);
    await f.save();
    assert.equal((await f.database.characters.get('c')).history.length, 2);
    assert.equal((await f.database.groups.get('g')).name, 'changed group');
});

test('nested save joins outer transaction and rolls back with it', async t => {
    const f = await fixture(t);
    f.c.db.characters[0].persona = 'changed';
    await assert.rejects(f.database.transaction('rw', f.database.tables, async () => {
        await f.database.myStickers.delete('s');
        f.c.db.myStickers = [];
        await f.save();
        throw new Error('outer rollback');
    }), /outer rollback/);
    assert.equal((await f.database.characters.get('c')).persona, 'original persona');
    assert.ok(await f.database.myStickers.get('s'));
});

test('concurrent saves serialize and retain latest state', async t => {
    const f = await fixture(t);
    f.c.db.characters[0].persona = 'first';
    const first = f.save();
    f.c.db.characters[0].persona = 'latest';
    const second = f.save();
    await Promise.all([first, second]);
    assert.equal((await f.database.characters.get('c')).persona, 'latest');
});

test('fire-and-forget save captures active archive before an immediate archive switch', async t => {
    const f = await fixture(t);
    const chat = f.c.db.characters[0];
    const originalArchiveId = chat.activeArchiveId;
    chat.history.push({ id: 'pending', content: 'keep before switch', timestamp: 2 });
    const saving = f.save();
    chat.archives.push({ id: 'second', data: { history: [] } });
    chat.activeArchiveId = 'second';
    chat.history = [];
    await saving;
    const stored = await f.database.characters.get('c');
    assert.equal(stored.archives.find(archive => archive.id === originalArchiveId).data.history.at(-1).content, 'keep before switch');
});

test('category restore transaction failure preserves database and live objects', async t => {
    const f = await fixture(t), originalCharacters = f.c.db.characters;
    const originalChat = originalCharacters[0];
    const originalBooks = f.c.db.worldBooks;
    const fail = () => { throw new Error('import failure'); };
    f.database.worldBooks.hook('creating', fail);
    await assert.rejects(f.c.storageCommitImport({ contacts: true, chats: true, worldbooks: true }, {
        characters: [{ id: 'c', persona: 'imported', history: [{ id: 'imported' }] }], worldBooks: [{ id: 'imported-book' }]
    }), /import failure/);
    assert.equal(f.c.db.characters, originalCharacters);
    assert.equal(f.c.db.characters[0], originalChat);
    assert.equal(f.c.db.worldBooks, originalBooks);
    assert.equal(originalChat.persona, 'original persona');
    assert.equal((await f.database.characters.get('c')).persona, 'original persona');
    assert.ok(await f.database.worldBooks.get('w'));
});

test('category restore changes only selected records and leaves prompts intact', async t => {
    const f = await fixture(t);
    await f.c.storageCommitImport({ wallpapers: true }, { wallpaper: 'new wallpaper', apiSettings: { model: 'ignored' }, cotPresets: [{ content: 'ignored' }] });
    assert.deepEqual(f.writes, ['globalSettings:wallpaper']);
    assert.equal(f.c.db.apiSettings.model, 'original-model');
    assert.equal(f.c.db.cotPresets[0].content, 'original prompt');
    assert.equal((await f.database.globalSettings.get('wallpaper')).value, 'new wallpaper');
    f.writes.length = 0;
    await f.c.storageCommitImport({ contacts: true }, { characters: [{ id: 'c', persona: 'restored persona' }] });
    assert.deepEqual(f.writes, ['characters:c']);
    assert.equal((await f.database.characters.get('c')).history[0].content, 'original');
    assert.equal(f.c.db.groups[0].id, 'g');
});

test('malformed category backup is rejected before any data changes', async t => {
    const f = await fixture(t);
    await assert.rejects(f.c.storageCommitImport({ worldbooks: true }, { worldBooks: {} }), /必须是列表/);
    assert.ok(await f.database.worldBooks.get('w'));
    assert.deepEqual(f.writes, []);
});
