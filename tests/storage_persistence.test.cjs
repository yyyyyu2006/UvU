const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Dexie = require('dexie');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');

let serial = 0;
async function peerOf(f) {
    const c=vm.createContext({Dexie,console,structuredClone,Blob,File,atob,window:{},document:{addEventListener(){}},localStorage:{getItem:()=>null}});
    for(const file of ['db.js','modules/chat_archives.js','modules/storage.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),c);
    c.dexieDB=f.database;c.db=structuredClone(f.c.db);await vm.runInContext('saveData()',c);return {c,save:()=>vm.runInContext('saveData()',c)};
}
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

test('MCP settings persist alone and restore disabled without credentials, grants or prompt changes', async t => {
    const f = await fixture(t);
    f.c.URL=URL;f.c.TextEncoder=TextEncoder;f.c.window.MCPTransport={endpoint:v=>new URL(v).href};
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/mcp_services.js'),'utf8'),f.c);
    await f.c.window.MCPServices.save({enabled:true,services:[{id:'m',url:'https://mcp.test',enabled:true}],policies:[]});
    assert.equal((await f.database.globalSettings.get('mcpSettings')).value.enabled,true);
    assert.deepEqual(f.writes,['globalSettings:mcpSettings']);f.writes.length=0;
    await f.c.storageCommitImport({settings:true},{mcpSettings:{enabled:true,token:'private',services:[{id:'m',url:'https://mcp.test',enabled:true,token:'private'}],policies:[]}});
    const saved=(await f.database.globalSettings.get('mcpSettings')).value;assert.equal(saved.enabled,false);assert.equal(saved.services[0].enabled,false);assert.ok(!JSON.stringify(saved).includes('private'));
    assert.equal(f.c.db.apiSettings.model,'original-model');assert.equal(f.c.db.cotPresets[0].content,'original prompt');assert.ok(f.writes.every(x=>x==='globalSettings:mcpSettings'));
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
test('unchanged stale page cannot overwrite another page memo or resurrect a deleted record',async t=>{
 const f=await fixture(t),p=await peerOf(f);f.c.db.characters[0].characterMemos={notes:[{id:'new',fact:'new fact'}]};await f.save();
 p.c.db.apiSettings.model='other model';await p.save();assert.equal((await f.database.characters.get('c')).characterMemos.notes[0].id,'new');
 await f.database.characters.delete('c');await p.save();assert.equal(await f.database.characters.get('c'),undefined);
});
test('two pages editing the same record reject stale writes atomically and preserve local draft',async t=>{
 const f=await fixture(t),p=await peerOf(f);f.c.db.characters[0].persona='saved remotely';await f.save();
 p.c.db.characters[0].persona='local draft';p.c.db.groups[0].name='must rollback';
 await assert.rejects(p.save(),/更新|冲突/);assert.equal((await f.database.characters.get('c')).persona,'saved remotely');assert.equal((await f.database.groups.get('g')).name,undefined);assert.equal(p.c.db.characters[0].persona,'local draft');
});
test('outer rollback leaves persistence baseline retryable and nested import memory unchanged',async t=>{
 const f=await fixture(t),original=f.c.db.characters;
 await assert.rejects(f.database.transaction('rw',f.database.tables,async()=>{
  await f.c.storageCommitImport({contacts:true,chats:true},{characters:[{id:'c',persona:'temporary restore',history:[]}]});throw Error('outer abort');
 }),/outer abort/);
 assert.equal(f.c.db.characters,original);assert.equal((await f.database.characters.get('c')).persona,'original persona');
 f.c.db.characters[0].persona='retry after abort';await f.save();assert.equal((await f.database.characters.get('c')).persona,'retry after abort');
});
test('restore refuses stale selected data rather than clearing a newer page worldbooks',async t=>{
 const f=await fixture(t),p=await peerOf(f),old=p.c.db.worldBooks;
 f.c.db.worldBooks.push({id:'new-book',content:'newer external book'});await f.save();
 await assert.rejects(p.c.storageCommitImport({worldbooks:true},{worldBooks:[{id:'replacement',content:'old restore'}]}),/更新|冲突/);
 assert.equal(p.c.db.worldBooks,old);assert.equal((await f.database.worldBooks.get('new-book')).content,'newer external book');assert.equal(await f.database.worldBooks.get('replacement'),undefined);
});

test('real page loading keeps normalized unchanged roles from overwriting a peer update', async t => {
    const f = await fixture(t), p = await peerOf(f);
    f.c.localStorage = p.c.localStorage = { getItem: () => null };
    await vm.runInContext('loadData()', f.c); await vm.runInContext('loadData()', p.c);
    assert.equal(p.c.db.characters[0].showTimestamp, false);
    f.c.db.characters[0].characterMemos = { notes: [{ id: 'remote', fact: 'new memory' }] }; await f.save();
    p.c.db.apiSettings.model = 'local-setting'; await p.save();
    assert.equal((await f.database.characters.get('c')).characterMemos.notes[0].id, 'remote');
    p.c.db.characters[0].persona = 'local draft';
    await assert.rejects(p.save(), /更新/); assert.equal(p.c.db.characters[0].persona, 'local draft');
});

test('loading legacy data preserves the startup archive migration signal and persists it once', async t => {
    const f = await fixture(t);
    await f.database.characters.put({ id: 'c', history: [{ id: 'legacy', content: 'legacy story' }] });
    f.c.localStorage = { getItem: () => null };
    await vm.runInContext('loadData()', f.c);
    assert.equal(f.c.ensureAllChatArchives(), true);
    await f.save(); const saved = await f.database.characters.get('c');
    assert.ok(saved.activeArchiveId); assert.equal(saved.archives[0].data.history[0].content, 'legacy story');
    await vm.runInContext('loadData()', f.c);
    assert.equal(f.c.ensureAllChatArchives(), false);
});

test('touching an open archive timestamp alone is not a local edit when another page saved new memory', async t => {
    const f = await fixture(t), p = await peerOf(f);
    f.c.db.characters[0].memoryJournals = [{ id: 'remote', content: 'saved story' }]; await f.save();
    p.c.currentChatId = 'c';
    p.c.db.characters[0].archives[0].updatedAt = Date.now() + 100;
    p.c.db.apiSettings.model = 'other setting';
    await p.save();
    assert.equal((await f.database.characters.get('c')).memoryJournals[0].id, 'remote');
});

test('table replacement stages deletions inside the same root transaction and publishes only on commit', async t => {
    const f = await fixture(t);
    await f.database.transaction('rw', f.database.tables, async () => {
        await f.c.storageCommitImport({ worldbooks: true }, { worldBooks: [{ id: 'new', content: 'first' }] });
        await f.c.storageCommitImport({ worldbooks: true }, { worldBooks: [{ id: 'second', content: 'second' }] });
    });
    assert.equal(f.c.db.worldBooks[0].id, 'second');
    await f.save(); assert.deepEqual((await f.database.worldBooks.toArray()).map(x => x.id), ['second']);
    f.c.db.worldBooks[0].content = 'normal edit'; await f.save();
    assert.equal((await f.database.worldBooks.get('second')).content, 'normal edit');
});

test('guarded setting writes and deletions detect peers and leave baselines retryable after abort', async t => {
    const f = await fixture(t), p = await peerOf(f);
    await f.database.transaction('rw', f.database.globalSettings, () => f.c.putGuardedSettings([{ key: 'apiSettings', value: { model: 'new' } }]));
    await assert.rejects(f.database.transaction('rw', f.database.globalSettings, () => p.c.putGuardedSettings([{ key: 'apiSettings', value: { model: 'stale' } }])), /更新/);
    await assert.rejects(f.database.transaction('rw', f.database.globalSettings, async () => {
        await f.c.deleteGuardedRecords(f.database.globalSettings, ['cotPresets'], 'key'); throw Error('abort');
    }), /abort/);
    await f.database.transaction('rw', f.database.globalSettings, () => f.c.deleteGuardedRecords(f.database.globalSettings, ['cotPresets'], 'key'));
    delete f.c.db.cotPresets; f.c.db.apiSettings = { model: 'new' }; await f.save();
    assert.equal(await f.database.globalSettings.get('cotPresets'), undefined);
});

test('field-only saves stay compatible with normal saves while stale field updates and deletion reject', async t => {
    const f = await fixture(t), p = await peerOf(f);
    f.c.db.characters[0].shopData = { items: ['one'] };
    await f.c.updateGuardedRecord(f.database.characters, 'c', { shopData: f.c.db.characters[0].shopData });
    await f.save();
    await assert.rejects(p.c.updateGuardedRecord(f.database.characters, 'c', { shopData: null }), /更新/);
    loadChatActions(p);
    assert.equal(await p.c.deleteChatEntity(p.c.db.characters[0], 'private'), false);
    assert.equal((await f.database.characters.get('c')).shopData.items[0], 'one');
    assert.equal(p.c.db.characters.length, 1);
    loadChatActions(f); assert.equal(await f.c.deleteChatEntity(f.c.db.characters[0], 'private'), true);
    await f.c.storageCommitImport({ contacts: true, chats: true, replaceAll: true }, { characters: [{ id: 'replacement', history: [] }] });
    await f.save(); assert.equal((await f.database.characters.get('replacement')).id, 'replacement');
});

test('Tavern receive conflict rolls back scene receipts and cursor, never acknowledging an uncommitted scene', async t => {
    const f = await fixture(t), p = await peerOf(f); let acknowledgements = 0;
    p.c.URL = URL; p.c.TextEncoder = TextEncoder; p.c.AbortSignal = AbortSignal; p.c.crypto = crypto;
    p.c.setInterval = () => 1; p.c.clearInterval = () => {};
    p.c.localStorage = { getItem: key => key === 'uvu-story-bridge.v1' ? JSON.stringify({ token: 'fixture' }) : null, setItem() {} };
    p.c.document = { visibilityState: 'visible', addEventListener() {}, getElementById: () => null };
    p.c.navigator = { permissions: { query: async () => ({ state: 'granted' }) } };
    p.c.db.uvuStoryBridgeSettings = { baseUrl: 'http://127.0.0.1:8765/api/plugins/uvu-story-bridge', bridgeEnabled: true };
    p.c.fetch = async url => {
        if (url.includes('/ack')) acknowledgements++;
        return { ok: true, json: async () => url.includes('/events?') ? { latestSeq: 1, events: [{ seq: 1, kind: 'scene_transcript', characterKey: 'c', sceneId: 'incoming', payload: { archiveId: p.c.db.characters[0].activeArchiveId, part: 1, partCount: 1, text: 'scene to review' } }] } : {} };
    };
    for (const name of ['bridge_text', 'bridge_summary', 'bridge_file', 'story_bridge']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/' + name + '.js'), 'utf8'), p.c);
    f.c.db.characters[0].characterMemos = { notes: [{ id: 'remote', fact: 'saved remotely' }] }; await f.save();
    await assert.rejects(p.c.window.UvUStoryBridge.syncIncoming('c'), /更新/);
    assert.equal(acknowledgements, 0);
    assert.equal(p.c.db.characters[0].memoryJournals.length, 0);
    assert.equal(p.c.db.uvuStoryBridgeSettings.cursorByCharacter.c || 0, 0);
    assert.deepEqual(Object.keys(p.c.db.uvuStoryBridgeSettings.receipts), []);
    assert.equal((await f.database.characters.get('c')).characterMemos.notes[0].id, 'remote');
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
        characters: [{ id: 'c', persona: 'imported', history: [{ id: 'imported', content: 'imported' }] }], worldBooks: [{ id: 'imported-book' }]
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

test('missing message content is rejected in every imported history before atomic writes', async t => {
    const f = await fixture(t), before = JSON.stringify(f.c.db);
    const invalidRuntime = [
        { history: [{ id: 'missing', role: 'user' }] },
        { history: [{ content: 'outer', forwardedChat: { records: [{}] } }] },
        { callHistory: [{ context: [{}] }] },
        { privateSessions: { pair: { history: [{}] } } },
        { gossipSessions: { pair: { history: [{}] } } },
        { archives: [{ id: 'other', data: { history: [{}] } }] }
    ];
    for (const runtime of invalidRuntime) {
        await assert.rejects(f.c.storageCommitImport({ chats: true, contacts: true, worldbooks: true }, {
            characters: [{ id: 'c', ...runtime }], worldBooks: [{ id: 'replacement', content: 'must not write' }]
        }), /content/);
        assert.equal(JSON.stringify(f.c.db), before);
    }
    assert.deepEqual(f.writes, []);
    assert.equal(await f.database.worldBooks.get('replacement'), undefined);
});

test('malformed consumed bindings, member, gallery and relationship fields reject before writes', async t => {
    const f = await fixture(t), before = JSON.stringify(f.c.db);
    const invalidRuntime = [
        { worldBookIds: 'w' }, { worldBookIds: ['w', {}] },
        { members: [{ realName: 'name', groupNickname: {} }] }, { me: 'broken' },
        { gallery: [null] }, { gallery: [{ url: {} }] },
        { friendRelationship: { self: [] } },
        { friendRelationship: { autonomy: { lastCheckUserCount: 'broken' } } },
        { friendRelationship: { recovery: { restoreAt: Infinity } } },
        { archives: [{ id: 'other', data: { worldBookIds: 'w' } }] }
    ];
    for (const runtime of invalidRuntime) {
        await assert.rejects(f.c.storageCommitImport({ chats: true, contacts: true }, { characters: [{ id: 'c', ...runtime }] }));
        assert.equal(JSON.stringify(f.c.db), before);
    }
    await assert.rejects(f.c.storageCommitImport({ other: true }, {
        mediaCache: { version: 1, characters: [{ id: 'c', archives: [{ id: 'other', gallery: [null] }] }], tables: {} }
    }));
    assert.deepEqual(f.writes, []);
});

test('1900 image and legacy optional message fields survive import with extension fields intact', async t => {
    const f = await fixture(t);
    const image = { id: 'image', role: 'user', content: 'data:image/png;base64,AA==', parts: [
        { type: 'text', text: '[我发来了一张图片：]' }, { type: 'image', data: 'data:image/png;base64,AA==', futurePart: true }
    ], timestamp: 1, extension: { future: true } };
    const legacy = { content: 'legacy without optional id or role', futureMessage: true };
    await f.c.storageCommitImport({ chats: true, contacts: true }, { characters: [{ id: 'c', worldBookIds: ['w'], history: [image, legacy], extension: { future: true } }] });
    const saved = await f.database.characters.get('c');
    assert.deepEqual(saved.history, [image, legacy]);
    assert.deepEqual(saved.extension, { future: true });
    assert.deepEqual(saved.worldBookIds, ['w']);
});

test('MiniMax voice settings restore only when selected and malformed settings do not write', async t => {
    const f = await fixture(t);
    const voice = { endpoint: 'https://voice.test/v1/t2a_v2', apiKey: 'voice-key', groupId: 'group', model: 'speech-2.8-hd', voiceId: 'voice', speed: 1.2, pitch: -2, extension: { future: true } };
    await f.c.storageCommitImport({ settings: true }, { minimaxTtsSettings: voice, uvuStoryBridgeSettings: { pairingToken: 'must-ignore' } });
    assert.deepEqual(await f.database.globalSettings.get('minimaxTtsSettings'), { key: 'minimaxTtsSettings', value: voice });
    assert.equal(await f.database.globalSettings.get('uvuStoryBridgeSettings'), undefined);
    f.writes.length = 0;
    await f.c.storageCommitImport({ worldbooks: true }, { minimaxTtsSettings: { ...voice, voiceId: 'unselected' } });
    assert.deepEqual(f.writes, []);
    for (const settings of [[], { voiceId: {} }, { speed: 'bad' }, { pitch: NaN }]) {
        await assert.rejects(f.c.storageCommitImport({ settings: true }, { minimaxTtsSettings: settings }), /minimaxTtsSettings/);
    }
    assert.deepEqual(f.writes, []);
    assert.deepEqual(await f.database.globalSettings.get('minimaxTtsSettings'), { key: 'minimaxTtsSettings', value: voice });
});

test('each save hashes a local record once and reuses only that operation result', async t => {
    const f = await fixture(t), record = f.c.db.characters[0], originalStamp = f.c.persistedRecordStamp;
    let localHashes = 0;
    f.c.persistedRecordStamp = value => { if (value === record) localHashes++; return originalStamp(value); };
    record.persona = 'first edit'; await f.save();
    assert.equal(localHashes, 1, 'baseline staging reuses the local stamp from conflict checking');
    record.persona = 'second in-place edit'; localHashes = 0; await f.save();
    assert.equal(localHashes, 1); assert.equal((await f.database.characters.get('c')).persona, 'second in-place edit');
    const peer = await peerOf(f); peer.c.db.characters[0].persona = 'peer edit'; await peer.save();
    record.persona = 'stale local draft';
    await assert.rejects(f.save(), /更新/);
    assert.equal((await f.database.characters.get('c')).persona, 'peer edit');
    assert.equal(record.persona, 'stale local draft');
});
