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
    database.version(1).stores({ characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id', globalSettings: 'key', customFonts: '&id',
        workshopHistory: '++id', workshopVibeGroups: '++id', characterPhotos: '++id', reader_books: '&id', reader_chapters: '&id', reader_comments: '++id' });
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

test('optional media migration round-trips galleries, archived galleries and all cache tables without writing prompts', async t => {
    const f = await fixture(t), chat = f.c.db.characters[0];
    chat.gallery = [{ url: 'data:image/png;base64,AA==' }];
    f.c.syncChatActiveArchive(chat);
    await f.database.workshopHistory.put({ id: 2, image: 'data:image/png;base64,AA==', prompt: 'Source' });
    await f.database.reader_books.put({ id: 'book', title: 'Title' });
    await f.database.reader_chapters.put({ id: 'chapter', bookId: 'book', content: 'Chapter' });
    const mediaCache = await f.c.storageExportMediaCache();
    chat.gallery = []; chat.archives[0].data.gallery = [];
    await f.database.workshopHistory.put({ id: 3, image: 'extra' }); f.writes.length = 0;
    await f.c.storageCommitImport({ other: true }, { mediaCache });
    assert.equal(f.c.db.characters[0].gallery[0].url, 'data:image/png;base64,AA==');
    assert.equal((await f.database.characters.get('c')).archives[0].data.gallery[0].url, 'data:image/png;base64,AA==');
    assert.equal(await f.database.workshopHistory.count(), 1);
    assert.equal((await f.database.reader_chapters.get('chapter')).bookId, 'book');
    assert.equal(f.writes.some(item => item.startsWith('globalSettings:')), false);
    assert.equal(f.c.db.characters[0].persona, 'original persona');
});

test('media restore failure rolls back cache and chat tables and preserves live data', async t => {
    const f = await fixture(t), chat = f.c.db.characters[0]; chat.gallery = [{ url: 'old' }];
    await f.database.workshopHistory.put({ id: 1, image: 'old' });
    const hook = () => { throw new Error('cache quota'); }; f.database.reader_books.hook('creating', hook);
    const mediaCache = { version: 1, characters: [{ id: 'c', gallery: [{ url: 'new' }] }], tables: {
        workshopHistory: [{ id: 2, image: 'new' }], reader_books: [{ id: 'b', title: 'Book' }] } };
    await assert.rejects(f.c.storageCommitImport({ other: true }, { mediaCache }), /cache quota/);
    assert.equal(f.c.db.characters[0], chat); assert.equal(chat.gallery[0].url, 'old');
    assert.equal((await f.database.workshopHistory.get(1)).image, 'old'); assert.equal(await f.database.workshopHistory.get(2), undefined);
});

test('media data stays untouched when unchecked and malformed cache packages fail before writes', async t => {
    const f = await fixture(t); await f.database.workshopHistory.put({ id: 1, image: 'old' }); f.writes.length = 0;
    await f.c.storageCommitImport({ worldbooks: true }, { mediaCache: { version: 1, tables: { workshopHistory: [{ id: 2, image: 'new' }] } } });
    assert.equal(await f.database.workshopHistory.count(), 1); assert.equal(f.writes.length, 0);
    for (const mediaCache of [{ version: 2, tables: {} }, { version: 1, tables: { globalSettings: [] } },
        { version: 1, tables: { workshopHistory: [{ id: 1, image: 2 }] } }]) {
        await assert.rejects(f.c.storageCommitImport({ other: true }, { mediaCache }));
    }
    assert.equal(f.writes.length, 0);
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

test('nested corrupt backups reject before a transaction and leave stored prompts and history untouched', async t => {
    const f = await fixture(t), before = JSON.stringify(f.c.db);
    const samples = [
        { characters: [{ id: "c", history: "broken" }] },
        { groups: [{ id: "g", history: [null] }] },
        { characters: [{ id: "c", history: [{ content: {} }] }] },
        { characters: [{ id: "c", history: [{ parts: "broken" }] }] },
        { characters: [{ id: "c", history: [{ parts: [null] }] }] },
        { characters: [{ id: "c", history: [{ quote: [] }] }] },
        { characters: [{ id: "c", archives: [{ id: "x", data: { history: {} } }] }] },
        { characters: [{ id: "c", archives: [{ id: "x" }, { id: "x" }] }] },
        { characters: [{ id: "c", memoryJournals: "broken" }] },
        { apiSettings: [] }, { cotPresets: "broken" }, { homeLayoutPages: "broken" }
    ];
    for (const sample of samples) {
        await assert.rejects(f.c.storageCommitImport({ chats: true, contacts: true, settings: true }, sample));
        assert.equal(JSON.stringify(f.c.db), before);
    }
    assert.deepEqual(f.writes, []);
    assert.equal((await f.database.characters.get("c")).history[0].content, "original");
    assert.equal((await f.database.globalSettings.get("cotPresets")).value[0].content, "original prompt");
});

test('deep memory metadata and vector chunks are validated before import writes', async t => {
    const f = await fixture(t);
    const valid = { characters: [{ id: 'c', memoryJournals: [{ id: 'j', content: '旧事', range: { start: 1, end: 2 }, autoMemory: {
        version: 1, kind: 'summary', committed: true, sources: [{ id: 'm1', hash: 'h1' }], children: []
    } }], memoryVectorIndex: { j: { version: 2, chunks: [{ key: 'h', start: 0, end: 2, vector: [0.2, 0.8] }] } } }] };
    await f.c.storageCommitImport({ chats: true, contacts: true }, valid);
    const invalidSamples = [
        { characters: [{ id: 'c', memoryJournals: [{ id: 'j', autoMemory: { sources: [{ id: 'm1' }, { id: 'm1' }] } }] }] },
        { characters: [{ id: 'c', memoryVectorIndex: { j: { version: 2, chunks: [{ key: 'h', start: 0, end: 2, vector: [0.2, NaN] }] } } }] },
        { characters: [{ id: 'c', memoryVectorIndex: { j: { version: 2, chunks: [{ key: 'h', start: 2, end: 2, vector: [0.2] }] } } }] },
        { characters: [{ id: 'c', memoryVectorIndex: { j: { version: 2, chunks: [{ key: 'h', start: 0, end: 2, vector: [0.2], }, { key: 'h2', start: 2, end: 4, vector: [0.2, 0.8] }] } } }] }
    ];
    for (const sample of invalidSamples) await assert.rejects(f.c.storageCommitImport({ chats: true, contacts: true }, sample));
    assert.equal((await f.database.characters.get('c')).memoryJournals[0].content, '旧事');
});

test('legacy missing optional fields and future extension keys remain accepted without changing prompt text', async t => {
    const f = await fixture(t);
    await f.c.storageCommitImport({ chats: true, contacts: true, settings: true }, { characters: [{ id: "c", persona: "UwU / T.T original", history: [{ id: "legacy", content: "legacy text" }], extension: { future: true } }], cotPresets: [{ content: "UwU / T.T literal" }], homeLayoutPages: null });
    const saved = await f.database.characters.get("c");
    assert.equal(saved.history[0].content, "legacy text"); assert.equal(saved.persona, "UwU / T.T original");
    assert.equal((await f.database.globalSettings.get("cotPresets")).value[0].content, "UwU / T.T literal");
});

test('failure after a later import batch rolls back the entire selected table and keeps live data', async t => {
    const f = await fixture(t), books = f.c.db.worldBooks;
    const fail = (_key, item) => { if (item.id === 'batch-18') throw new Error('later batch failure'); };
    f.database.worldBooks.hook('creating', fail);
    await assert.rejects(f.c.storageCommitImport({ worldbooks: true }, {
        worldBooks: Array.from({ length: 35 }, (_, index) => ({ id: `batch-${index}`, content: '世界观' }))
    }), /later batch failure/);
    assert.equal(f.c.db.worldBooks, books);
    assert.equal(await f.database.worldBooks.count(), 1);
    assert.equal((await f.database.worldBooks.get('w')).content, 'world');
});

test('old history imports clear a recipient vector cache without changing unselected prompts', async t => {
    const f = await fixture(t);
    f.c.db.characters[0].memoryVectorIndex = { unrelated: { version: 2, chunks: [] } };
    await f.c.storageCommitImport({ chats: true }, { characters: [{ id: 'c', history: [{ id: 'old', content: '1900 story' }] }] });
    const saved = await f.database.characters.get('c');
    assert.deepEqual(Object.keys(saved.memoryVectorIndex), []);
    assert.equal(saved.persona, 'original persona');
    assert.equal((await f.database.globalSettings.get('cotPresets')).value[0].content, 'original prompt');
});

function loadChatActions(f) {
    for (const file of ["modules/chat_ops.js", "modules/chat_list.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js", file), "utf8"), f.c);
    f.c.showToast = () => {}; f.c.renderChatList = () => {}; f.c.currentChatId = null; f.c.currentChatType = null;
}
for (const [key, type] of [["characters", "private"], ["groups", "group"]]) {
    test(type + " clear affects current archive runtime only, preserving persona, prompts and other branches", async t => {
        const f = await fixture(t); loadChatActions(f); const chat = f.c.db[key][0];
        chat.persona = "persona"; chat.customPrompt = "original custom prompt"; chat.friendRelationship = { peer: { blocked: true } };
        chat.history = [{ id: "message", content: "story" }]; chat.memoryJournals = [{ content: "memory" }]; chat.memoryVectorIndex = { vector: [1] };
        chat.archives.push({ id: "other", data: { history: [{ content: "other story" }], persona: "other persona" } });
        await f.save();
        assert.equal(await f.c.clearChatHistory(chat, type), true);
        const saved = await f.database[key].get(chat.id);
        assert.equal(saved.history.length, 0); assert.equal(saved.memoryJournals.length, 0); assert.deepEqual(saved.memoryVectorIndex, {});
        assert.equal(saved.persona, "persona"); assert.equal(saved.customPrompt, "original custom prompt");
        assert.equal(saved.archives.find(a => a.id === "other").data.history[0].content, "other story");
        assert.equal(saved.friendRelationship.peer.blocked, true);
        assert.equal((await f.database.globalSettings.get("cotPresets")).value[0].content, "original prompt");
    });
    test(type + " clear failure restores runtime and archive; retry persists", async t => {
        const f = await fixture(t); loadChatActions(f); const chat = f.c.db[key][0];
        chat.history = [{ id: "message", content: "story" }]; chat.memoryJournals = [{ content: "memory" }]; await f.save();
        const fail = () => { throw Error("quota"); }; f.database[key].hook("updating", fail);
        assert.equal(await f.c.clearChatHistory(chat, type), false);
        assert.equal(chat.history[0].content, "story"); assert.equal(chat.memoryJournals[0].content, "memory");
        assert.equal(chat.archives.find(a => a.id === chat.activeArchiveId).data.history[0].content, "story");
        assert.equal((await f.database[key].get(chat.id)).history[0].content, "story");
        f.database[key].hook("updating").unsubscribe(fail); assert.equal(await f.c.clearChatHistory(chat, type), true);
        assert.equal((await f.database[key].get(chat.id)).history.length, 0);
    });
    test(type + " entity deletion serializes with saves and is not resurrected", async t => {
        const f = await fixture(t); loadChatActions(f); const chat = f.c.db[key][0];
        const before = f.save(), deletion = f.c.deleteChatEntity(chat, type), after = f.save();
        await Promise.all([before, deletion, after]);
        assert.equal(await f.database[key].get(chat.id), undefined); assert.equal(f.c.db[key].some(item => item.id === chat.id), false);
        await f.save(); assert.equal(await f.database[key].get(chat.id), undefined);
    });
    test(type + " entity deletion failure restores the entity and leaves database untouched", async t => {
        const f = await fixture(t); loadChatActions(f); const chat = f.c.db[key][0];
        const fail = () => { throw Error("delete failed"); }; f.database[key].hook("deleting", fail);
        assert.equal(await f.c.deleteChatEntity(chat, type), false); assert.equal(f.c.db[key][0], chat);
        assert.equal((await f.database[key].get(chat.id)).id, chat.id);
    });
}
