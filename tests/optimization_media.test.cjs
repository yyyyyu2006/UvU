const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../js/modules', name + '.js'), 'utf8');
function tts(fetch) {
    const timers = new Map();
    const c = vm.createContext({ Blob, URL, Uint8Array, AbortController, fetch, window: {},
        db: { minimaxTtsSettings: { apiKey: 'secret', voiceId: 'v' } },
        setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } });
    vm.runInContext(source('chat_features'), c);
    return { feature: vm.runInContext('MiniMaxTTS', c), timers, c };
}
const mp3 = 'fffb9064' + '00'.repeat(413);
const reply = audio => ({ ok: true, status: 200, json: async () => ({ data: { audio } }) });
test('synthesis times out even if the provider ignores AbortSignal and cleans its timer', async () => {
    const f = tts(() => new Promise(() => {}));
    const pending = f.feature.synthesize('test');
    assert.equal(f.timers.size, 1, 'synthesis owns a deadline');
    [...f.timers.values()][0]();
    await assert.rejects(pending, error => error.name === 'TimeoutError' && error.stage === 'request');
    assert.equal(f.timers.size, 0);
});
test('synthesis cancellation rejects stalled JSON and never caches a late response', async () => {
    let finish;
    const f = tts(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => finish = resolve) }));
    const controller = new AbortController(), pending = f.feature.synthesize('test', undefined, controller.signal);
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(Error('operation did not cancel')), 80))]), { name: 'AbortError' });
    finish({ data: { audio: mp3 } });
    assert.equal(f.feature.getCacheInfo().entries, 0);
    assert.equal(f.timers.size, 0);
});
test('voice cache evicts by bytes and clear reports discarded memory', async () => {
    let requests = 0;
    const audio = mp3 + '00'.repeat(4 * 1024 * 1024);
    const f = tts(async () => { requests++; return reply(audio); });
    for (let i = 0; i < 7; i++) await f.feature.synthesize('line ' + i);
    const info = f.feature.getCacheInfo();
    assert.ok(info.bytes <= info.maxBytes);
    await f.feature.synthesize('line 0');
    assert.equal(requests, 8, 'oldest audio was evicted before reaching the entry limit');
    assert.ok(f.feature.clearCache().bytes > 0);
    assert.equal(f.feature.getCacheInfo().entries, 0);
});
test('synthesis response and decoding failures carry their stage', async () => {
    await assert.rejects(tts(async () => ({ json: async () => { throw Error('bad'); }, status: 200 })).feature.synthesize('test'), e => e.stage === 'response');
    await assert.rejects(tts(async () => reply('garbage')).feature.synthesize('test'), e => e.stage === 'decode');
});
function image(fetch) {
    const c = vm.createContext({ Blob, Uint8Array, URL, AbortController, fetch });
    vm.runInContext(source('chat_image_generation').replace('return { setup, open, isSelected, send, cancel };', 'return { readImageBlob };'), c);
    return vm.runInContext('ChatImageGeneration', c);
}
test('image streaming cancels immediately above the actual byte limit without consuming the tail', async () => {
    let reads = 0, cancelled = false;
    const response = { headers: { get: () => null }, body: { getReader: () => ({
        async read() { reads++; return { done: false, value: new Uint8Array(8 * 1024 * 1024) }; },
        async cancel() { cancelled = true; }, releaseLock() {} }) }, blob() { throw Error('must not buffer'); } };
    await assert.rejects(image().readImageBlob(response, new AbortController().signal), /15MB/);
    assert.equal(reads, 2); assert.equal(cancelled, true);
});
test('image streaming abort cancels a stalled reader and releases the lock', async () => {
    let cancelled = false, released = false;
    const response = { headers: { get: () => null }, body: { getReader: () => ({
        read: () => new Promise(() => {}), cancel() { cancelled = true; }, releaseLock() { released = true; } }) } };
    const controller = new AbortController(), pending = image().readImageBlob(response, controller.signal);
    controller.abort();
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(Error('operation did not cancel')), 80))]), { name: 'AbortError' });
    assert.equal(cancelled, true); assert.equal(released, true);
});
test('single pass replacement preserves CRLF and treats replacement dollar signs literally', () => {
    const c = vm.createContext({}); vm.runInContext(source('text_editor'), c);
    assert.equal(c.replaceEditorMatches('a\r\na a', c.findEditorMatches('a\r\na a', 'a'), '$&'), '$&\r\n$& $&');
});
test('editor state isolates archives and refuses to restore a draft over externally changed original', () => {
    const c = vm.createContext({ currentChatId: 'a', currentChatType: 'private', db: { characters: [{ id: 'a', activeArchiveId: 'one' }], groups: [] } });
    vm.runInContext(source('text_editor'), c);
    const target = { id: 'setting-char-persona' };
    c.rememberExpandedEditorState(target, { original: 'old', value: 'draft', selectionStart: 2 });
    assert.equal(c.getExpandedEditorState(target, 'old').value, 'draft');
    assert.equal(c.getExpandedEditorState(target, 'changed').conflict, true);
    c.db.characters[0].activeArchiveId = 'two';
    assert.equal(c.getExpandedEditorState(target, 'old'), null);
});
test('director skips catastrophic patterns and reports the skipped cleanup to the user', async () => {
    let requests = 0;
    const previous = { role: 'assistant', content: 'a'.repeat(18) + '!' }, current = { id: 'm', role: 'assistant', content: 'line' };
    const chat = { id: 'c', history: [previous, current], statusPanel: { enabled: true, regexPattern: '(a+)+$' } }, bubble = {};
    const c = vm.createContext({ db: { characters: [chat] }, AbortController, URL, setTimeout, clearTimeout,
        fetch: async () => { requests++; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"emotion":"calm"}' } }] }) }; } });
    vm.runInContext(source('voice_director'), c);
    const d = vm.runInContext('VoiceDirector', c), config = { enabled: true, endpoint: 'https://test.example', apiKey: 'key', model: 'model' };
    d.bind(bubble, chat, current, 'private');
    const captured = d.capture(bubble, 'line', config);
    const result = await d.prepare('line', config, captured);
    assert.match(result.warning, /正则/);
    assert.equal(requests, 0, 'unsafe cleanup falls back without sending unclean status context to the director');
});
test('avatar exclusions and an explicit candidate choice constrain independent action candidates', async () => {
    const chat = { id: 'c', history: [1,2,3].map(n => ({id:String(n),role:'user',parts:[{type:'image',data:'https://example.test/'+n+'.png'}]})), avatarAutonomy: {excludedCandidateIds:['message:1:0'],preferredCandidateId:'message:3:0'} };
    const c=vm.createContext({db:{characters:[chat]},URL});vm.runInContext(source('character_avatar'),c);
    assert.deepEqual(JSON.parse(JSON.stringify((await c.collectAvatarCandidates(chat)).map(x=>x.id))),['message:3:0']);
    assert.equal((await c.collectAvatarCandidates(chat,{includeExcluded:true})).length,3);
});
test('TXT import explicit encoding and cancellation are honored without mutating source', async () => {
    const c=vm.createContext({TextDecoder,Uint8Array,DOMException});vm.runInContext(source('document_import'),c);
    const file={name:'a.txt',size:2,arrayBuffer:async()=>new Uint8Array([0xc4,0xe3]).buffer};
    const result=await c.readImportDocument(file,{encoding:'gb18030'});assert.equal(result.text,'你');assert.equal(result.encoding,'gb18030');
    const controller=new AbortController();controller.abort();
    await assert.rejects(c.readImportDocument(file,{signal:controller.signal}),{name:'AbortError'});
});
test('bound group speaker voice prefers the source character then group while absent configuration uses global', () => {
    const character={id:'source',minimaxTtsVoiceId:'member-voice'},message={senderId:'member',content:'line'},group={id:'g',history:[],minimaxTtsVoiceId:'group-voice',members:[{id:'member',originalCharId:'source'}]};group.history.push(message);
    const c=vm.createContext({db:{characters:[character],groups:[group]}});vm.runInContext(source('voice_director'),c);const d=vm.runInContext('VoiceDirector',c),bubble={};d.bind(bubble,group,message,'group');
    assert.equal(d.voiceIdFor(bubble),'member-voice');character.minimaxTtsVoiceId='';assert.equal(d.voiceIdFor(bubble),'group-voice');group.minimaxTtsVoiceId='';assert.equal(d.voiceIdFor(bubble),'');assert.equal(d.voiceIdFor({}),null);
});
test('group voice playback uses bound priority even with the director disabled and ignores stale bubble attributes', async () => {
    const voices=[], f=tts(async (url,init)=>{voices.push(JSON.parse(init.body).voice_setting.voice_id);return reply(mp3);});
    f.c.Audio=class{addEventListener(){}removeEventListener(){}pause(){}load(){}removeAttribute(){}play(){return Promise.resolve();}};
    const character={id:'source',minimaxTtsVoiceId:'member-voice'},message={senderId:'member',content:'line'},group={id:'g',history:[message],minimaxTtsVoiceId:'group-voice',members:[{id:'member',originalCharId:'source'}]};
    f.c.db.characters=[character];f.c.db.groups=[group];f.c.showToast=()=>{};
    vm.runInContext(source('voice_director'),f.c);const d=vm.runInContext('VoiceDirector',f.c),bubble={dataset:{voiceId:'stale-group'},classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){}};d.bind(bubble,group,message,'group');
    await f.feature.play(bubble,'first');character.minimaxTtsVoiceId='';await f.feature.play(bubble,'second');group.minimaxTtsVoiceId='';await f.feature.play(bubble,'third');
    assert.deepEqual(voices,['member-voice','group-voice','v']);
});
