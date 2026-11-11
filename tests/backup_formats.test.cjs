const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
    const blobs = [], downloads = [], toasts = [], imports = [];
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: id === 'storage-export-format' ? 'ee' : '', classList: { add() {}, remove() {} } });
        return elements.get(id);
    };
    const c = vm.createContext({ console: { warn() {}, error() {} }, window: {}, structuredClone, Blob, File, Response,
        CompressionStream, DecompressionStream, ReadableStream, TextEncoder, setTimeout() {}, showToast: text => toasts.push(text),
        document: { addEventListener() {}, getElementById: element, body: { appendChild() {} },
            createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }) },
        URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} } });
    for (const file of ['db.js', 'modules/storage.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), c);
    c.db.characters = [{ id: 'c', persona: 'original persona', history: [{ id: 'm', content: 'private history' }] }];
    c.storageCommitImport = async (selection, modules) => imports.push({ selection, modules });
    vm.runInContext('Object.keys(selectedModules).forEach(key => selectedModules[key] = key === "contacts"); Object.keys(selectedImportModules).forEach(key => selectedImportModules[key] = key === "worldbooks");', c);
    return { c, blobs, downloads, toasts, imports, element };
}

test('JSON export needs no compression API and contains only selected categories', async () => {
    const f = fixture(); f.element('storage-export-format').value = 'json';
    f.c.CompressionStream = undefined;
    await f.c.handleExport();
    assert.match(f.downloads[0], /[.]json$/);
    const data = JSON.parse(await f.blobs[0].text());
    assert.equal(data.modules.characters[0].persona, 'original persona');
    assert.equal(data.modules.characters[0].history, undefined);
    assert.equal(data.modules.cotPresets, undefined);
    assert.equal(data.modules.apiSettings, undefined);
});

test('contact-only backup excludes private memo evidence while chat backup preserves it', async () => {
    const f=fixture();f.element('storage-export-format').value='json';
    f.c.db.characters[0].characterMemos={notes:[{id:'memo',fact:'private habit',sources:[{quote:'private evidence'}]}]};
    f.c.db.characters[0].archives=[{id:'old',data:{characterMemos:{notes:[{id:'archived-memo',fact:'archived private habit'}]}}}];
    await f.c.handleExport();const contacts=JSON.parse(await f.blobs[0].text());
    assert.equal(contacts.modules.characters[0].characterMemos,undefined);
    assert.equal(contacts.modules.characters[0].archives,undefined);
    vm.runInContext('Object.keys(selectedModules).forEach(key => selectedModules[key] = key === "chats");',f.c);
    await f.c.handleExport();const chats=JSON.parse(await f.blobs[1].text());
    assert.equal(chats.modules.characters[0].characterMemos.notes[0].fact,'private habit');
    assert.equal(chats.modules.characters[0].archives[0].data.characterMemos.notes[0].fact,'archived private habit');
    const imported=f.c.storagePrepareImport({contacts:true},{characters:[{id:'c',persona:'updated',characterMemos:{notes:[{fact:'unselected import'}]}}]});
    assert.equal(imported.characters[0].persona,'updated');assert.equal(imported.characters[0].characterMemos.notes[0].fact,'private habit');
    assert.equal(imported.characters[0].archives[0].data.characterMemos.notes[0].fact,'archived private habit');
    assert.equal(f.c.db.characters[0].characterMemos.notes[0].sources[0].quote,'private evidence');
});

test('selected media galleries are frozen before asynchronous vector materialization', async () => {
    const f=fixture();f.element('storage-export-format').value='json';f.c.db.characters[0].gallery=[{url:'before'}];
    vm.runInContext('Object.keys(selectedModules).forEach(key => selectedModules[key] = ["chats","other"].includes(key));',f.c);
    f.c.VectorMemoryTools={portableExport:async()=>{f.c.db.characters[0].gallery=[{url:'after'}];}};
    await f.c.handleExport();const data=JSON.parse(await f.blobs[0].text());
    assert.equal(data.modules.mediaCache.characters[0].gallery[0].url,'before');
});

test('chat export materializes independent vector cache only when chat and index export selected', async () => {
    const f = fixture(); let calls = 0;
    f.c.VectorMemoryTools = { portableExport: async modules => { calls++; modules.characters[0].memoryVectorIndex = { fromCache: true }; } };
    vm.runInContext('Object.keys(selectedModules).forEach(key => selectedModules[key] = key === "chats");', f.c);
    f.element('storage-export-format').value = 'json';
    await f.c.handleExport(); assert.equal(calls, 1);
    const data = JSON.parse(await f.blobs[0].text()); assert.equal(data.modules.characters[0].memoryVectorIndex.fromCache, true);
    f.element('storage-export-vector-index').checked = false;
    await f.c.handleExport(); assert.equal(calls, 1);
});

test('backup snapshots selected data before awaiting external vector materialization', async () => {
    const f = fixture(); f.element('storage-export-format').value = 'json';
    f.c.db.worldBooks = [{ id: 'w', content: 'before' }]; f.c.db.apiSettings = { model: 'before' };
    f.c.db.myPersonaPresets = [{ id: 'p', content: 'before' }];
    vm.runInContext('Object.keys(selectedModules).forEach(key => selectedModules[key] = ["chats", "settings", "worldbooks", "personas"].includes(key));', f.c);
    let resume; const paused = new Promise(resolve => { resume = resolve; });
    f.c.VectorMemoryTools = { portableExport: async () => paused };
    const exporting = f.c.handleExport();
    f.c.db.characters[0].history[0].content = 'after';
    f.c.db.worldBooks[0].content = 'after'; f.c.db.apiSettings.model = 'after';
    f.c.db.myPersonaPresets[0].content = 'after';
    resume(); await exporting;
    const data = JSON.parse(await f.blobs[0].text());
    assert.equal(data.modules.characters[0].history[0].content, 'private history');
    assert.equal(data.modules.worldBooks[0].content, 'before');
    assert.equal(data.modules.apiSettings.model, 'before');
    assert.equal(data.modules.myPersonaPresets[0].content, 'before');
});

test('derived memory and speech settings reject malformed nested backup values', () => {
    const f = fixture();
    for (const value of [
        { characters: [{ id: 'c', autoMemorySettings: { vectorChunkMaxTokens: 'oops' } }] },
        { characters: [{ id: 'c', autoMemorySettings: { vectorExternalIndex: 'yes' } }] },
        { vectorMemoryApiSettings: { rewriteKey: {} } },
        { minimaxTtsSettings: { speech: { cacheMiB: -1 } } },
        { minimaxTtsSettings: { profiles: { c: { directorMode: 'unknown' } } } },
        { minimaxTtsSettings: { pronunciation: [{}] } }
    ]) assert.throws(() => f.c.storageValidateModules(value));
    assert.doesNotThrow(() => f.c.storageValidateModules({ characters: [{ id: 'c' }], minimaxTtsSettings: { voiceId: 'old' } }));
});

test('EE export remains gzip JSON; unsupported compression falls back to JSON', async () => {
    const f = fixture(); await f.c.handleExport();
    assert.match(f.downloads[0], /[.]ee$/);
    assert.equal(f.blobs[0].type, 'application/octet-stream');
    const json = await new Response(f.blobs[0].stream().pipeThrough(new DecompressionStream('gzip'))).json();
    assert.equal(json.modules.characters[0].persona, 'original persona');
    const legacy = fixture(); legacy.c.CompressionStream = undefined;
    await legacy.c.handleExport();
    assert.match(legacy.downloads[0], /[.]json$/);
    assert.equal(JSON.parse(await legacy.blobs[0].text()).modules.characters[0].id, 'c');
});

test('old raw JSON, modules JSON and uppercase EE import using independent import selection', async () => {
    const modules = { worldBooks: [{ id: 'w', content: 'world text' }] };
    for (const kind of ['raw', 'json', 'ee']) {
        const f = fixture();
        const data = new Blob([JSON.stringify(kind === 'raw' ? modules : { version: 'old', modules })]);
        const body = kind === 'ee' ? await new Response(data.stream().pipeThrough(new CompressionStream('gzip'))).blob() : data;
        const file = new File([body], kind === 'ee' ? 'old.EE' : 'old.json');
        await f.c.handleImport({ target: { files: [file], value: 'selected' } });
        assert.equal(f.imports.length, 1);
        assert.equal(f.imports[0].modules.worldBooks[0].content, 'world text');
        assert.equal(f.imports[0].selection.worldbooks, true);
        assert.equal(f.imports[0].selection.contacts, false);
    }
});

test('unsupported EE decompression explains the JSON alternative without changing data', async () => {
    const f = fixture(); f.c.DecompressionStream = undefined;
    const input = { files: [new File(['gzip'], 'backup.ee')], value: 'selected' };
    await f.c.handleImport({ target: input });
    assert.equal(f.imports.length, 0);
    assert.match(f.toasts.at(-1), /不支持解压.*json/);
    assert.equal(input.value, '');
    assert.equal(f.c.db.characters[0].persona, 'original persona');
});

test('chat backup carries the active archive vector index without changing prompt fields', async () => {
    const f = fixture();
    f.c.db.characters[0].memoryVectorIndex = { note: { version: 2, chunks: [{ key: 'h', start: 0, end: 4, vector: [1, 0] }] } };
    const exported = f.c.storageExportChat(f.c.db.characters[0], true, true);
    assert.deepEqual(exported.memoryVectorIndex.note.chunks[0].vector, [1, 0]);
    assert.equal(exported.persona, 'original persona');
    assert.equal(exported.history[0].content, 'private history');
});

test('streamed backup JSON matches the normal JSON structure', async () => {
    const f = fixture();
    const value = { modules: { characters: [{ id: 'c', text: '中文😀', longText: 'a'.repeat(16383) + '😀中文', optional: undefined }],
        array: [null, undefined, true], settings: { enabled: true, skipped: { toJSON() {} } } } };
    const stream = f.c.storageJsonStream(value);
    assert.ok(stream);
    assert.deepEqual(await new Response(stream).json(), JSON.parse(JSON.stringify(value)));
});

test('settings backup includes complete MiniMax voice configuration and excludes bridge credentials', async () => {
    const f = fixture(); f.element('storage-export-format').value = 'json';
    const voice = { endpoint: 'https://voice.test/v1/t2a_v2', apiKey: 'voice-key', groupId: 'group', model: 'speech-2.8-hd', voiceId: 'voice', speed: 1.2, pitch: -2, extension: { future: true } };
    voice.director = { enabled: true, endpoint: 'https://director.test', apiKey: 'director-key', model: 'model', contextMessages: 12, timeoutSec: 12, prompt: 'natural' };
    f.c.db.minimaxTtsSettings = voice;
    f.c.db.uvuStoryBridgeSettings = { pairingToken: 'PAIRING-SECRET', adminToken: 'ADMIN-SECRET' };
    vm.runInContext('Object.keys(selectedModules).forEach(key => selectedModules[key] = key === "settings");', f.c);
    await f.c.handleExport();
    const data = JSON.parse(await f.blobs[0].text());
    assert.deepEqual(data.modules.minimaxTtsSettings, voice);
    assert.equal(data.modules.uvuStoryBridgeSettings, undefined);
    assert.ok(!JSON.stringify(data).includes('PAIRING-SECRET'));
    assert.ok(!JSON.stringify(data).includes('ADMIN-SECRET'));
});

test('voice director imports validate nested types while accepting legacy voice settings', () => {
    const f = fixture();
    assert.doesNotThrow(() => f.c.storageValidateModules({ minimaxTtsSettings: { voiceId: 'legacy' } }));
    for (const director of [[], { enabled: 'true' }, { apiKey: {} }, { contextMessages: 'twelve' }, { prompt: [] }]) {
        assert.throws(() => f.c.storageValidateModules({ minimaxTtsSettings: { director } }), /director/);
    }
});


test('1900 and current group-only members retain null original character links', () => {
    const f=fixture();
    const modules={groups:[{id:'g',members:[{id:'member',originalCharId:null,realName:'群友',persona:'原设定'}],history:[{content:'消息'}]}]};
    assert.doesNotThrow(()=>f.c.storageValidateModules(modules));
    assert.equal(modules.groups[0].members[0].originalCharId,null);
    modules.groups[0].members[0].originalCharId={bad:true};assert.throws(()=>f.c.storageValidateModules(modules),/originalCharId/);
});


test('calendar records export with settings and old backups preserve existing calendar', async () => {
    const f=fixture(); for(const name of ['calendar_core.js','calendar_chat.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules',name),'utf8'),f.c);
    const C=f.c.window.UvUCalendar;f.c.db.calendarData=C.state();f.c.db.calendarData.moods.push({id:'m',owner:'user',date:'2026-11-07',mood:'happy',color:'#171719',note:'test',at:10,source:'manual'});
    vm.runInContext('Object.keys(selectedModules).forEach(key => selectedModules[key] = key === "settings");',f.c);
    f.element('storage-export-format').value='json';await f.c.handleExport();const json=JSON.parse(await f.blobs[0].text());assert.equal(json.modules.calendarData.moods[0].note,'test');
    assert.doesNotThrow(()=>f.c.storageValidateModules(json.modules));assert.equal(f.c.storagePrepareImport({settings:true},json.modules).calendarData.moods.length,1);
    const before=JSON.stringify(f.c.db.calendarData);assert.equal(f.c.storagePrepareImport({settings:true},{apiSettings:{}}).calendarData,undefined);assert.equal(JSON.stringify(f.c.db.calendarData),before);
    assert.throws(()=>f.c.storageValidateModules({calendarData:{...json.modules.calendarData,events:{}}}),/结构/);
    const card={id:'c',role:'user',content:'日历分享',type:'calendar',calendar:{version:1,title:'日程',date:'2026-11-07',text:'散步'}};assert.doesNotThrow(()=>f.c.storageValidateModules({characters:[{id:'x',history:[card]}]}));card.calendar.date='2026-02-30';assert.throws(()=>f.c.storageValidateModules({characters:[{id:'x',history:[card]}]}),/日期/);
});

 test('renamed EE TXT and gzip signature imports preserve legacy backup contents', async () => {
    const raw = new Blob([JSON.stringify({ modules: { worldBooks: [{ id: 'w', content: 'restored' }] } })]);
    const gzip = await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    for (const name of ['backup.ee.txt', 'backup.ee (1).txt', 'renamed.txt']) {
        const f = fixture(); await f.c.handleImport({ target: { files: [new File([gzip], name)], value: 'chosen' } });
        assert.equal(f.imports.length, 1, name); assert.equal(f.imports[0].modules.worldBooks[0].content, 'restored');
    }
 });
