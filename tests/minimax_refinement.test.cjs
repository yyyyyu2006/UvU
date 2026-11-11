const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
function fixture(extra = {}) {
    const c = vm.createContext({ window: {}, Blob, URL, Uint8Array, TextEncoder, TextDecoder, AbortController,
        setTimeout, clearTimeout, crypto: webcrypto, ...extra });
    const file = path.join(__dirname, '../js/modules/minimax_speech.js');
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), c);
    assert.ok(c.window.MiniMaxSpeech, 'speech refinements module required');
    return c.window.MiniMaxSpeech;
}
test('model controls omit unsupported emotion and constrain registered capabilities', () => {
    const s = fixture();
    assert.equal(s.capabilities('speech-2.8-hd').emotions.includes('whisper'), false);
    assert.equal(s.capabilities('speech-2.6-turbo').emotions.includes('whisper'), true);
    assert.equal(s.requestOptions({ model: 'custom-proxy', emotion: 'happy' }).voice_setting.emotion, undefined);
    assert.equal(s.requestOptions({ model: 'speech-2.6-hd', emotion: 'whisper' }).voice_setting.emotion, 'whisper');
});
test('bounded reader rejects oversized declared and actual body without parsing unbounded JSON', async () => {
    const s = fixture();
    let parsed = false, cancelled = false;
    await assert.rejects(s.readResponse({ headers: { get: () => '99999999' }, body: { cancel: async () => { cancelled = true; } },
        json: async () => { parsed = true; return {}; } }), /过大/);
    assert.equal(parsed, false); assert.equal(cancelled, true);
    const text = JSON.stringify({ content: 'x'.repeat(2048) });
    await assert.rejects(s.readResponse(new Response(text), null, null, 1000), /过大/);
});
test('SSE split lines and final aggregate never duplicate synthesized audio', async () => {
    const s = fixture(); const chunks = [];
    const packets = [ { data: { audio: 'fffb', status: 1 } }, { data: { audio: '9064', status: 1 } },
        { data: { audio: 'fffb9064', status: 2 }, extra_info: { usage_characters: 7, audio_length: 500, audio_format: 'mp3' } } ];
    const encoded = new TextEncoder().encode(packets.map(p => 'data: ' + JSON.stringify(p) + '\r\n\r\n').join(''));
    const body = new ReadableStream({ start(controller) { for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3)); controller.close(); } });
    const result = await s.readResponse(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), null, hex => chunks.push(hex));
    assert.equal(result.data.audio, 'fffb9064'); assert.deepEqual(chunks, ['fffb', '9064']);
    assert.equal(s.usage(result).usageCharacters, 7); assert.equal(s.usage(result).audioMs, 500);
});
test('SSE missing final result, cancellation and invalid hex fail explicitly', async () => {
    const s = fixture();
    await assert.rejects(s.readResponse(new Response('data: {"data":{"audio":"ff","status":1}}\n\n', { headers: { 'content-type': 'text/event-stream' } })), /完成/);
    await assert.rejects(s.readResponse(new Response('data: {"data":{"audio":"bad","status":2}}\n\n', { headers: { 'content-type': 'text/event-stream' } })), /音频/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(s.readResponse(new Response('{}'), controller.signal), { name: 'AbortError' });
});
test('role overrides retain API defaults while dictionaries affect only synthesis parameters', () => {
    const s = fixture(); const saved = { apiKey: 'secret', voiceId: 'default', director: { enabled: true }, speech: { stream: false },
        profiles: { a: { voiceId: 'alice', directorMode: 'off', dictionary: ['晴/(qing2)'] } } };
    const before = JSON.stringify(saved), role = { id: 'a', minimaxTtsVoiceId: 'legacy-alice' };
    const actual = s.resolveSettings(saved, role);
    assert.equal(actual.voiceId, 'legacy-alice'); assert.equal(actual.director.enabled, false);
    assert.equal(actual.apiKey, 'secret'); assert.equal(s.requestOptions(actual).pronunciation_dict.tone[0], '晴/(qing2)');
    assert.equal(JSON.stringify(saved), before);
    assert.throws(() => s.dictionary(['恶意/<script>']), /发音/);
});
test('long-line segmentation preserves all original text and limits paid request fanout', () => {
    const s = fixture(); const text = '第一段。\n第二段！\n第三段。';
    assert.equal(s.segments(text, 8).join(''), text);
    assert.throws(() => s.segments('x'.repeat(10000), 300), /分段|段/);
});
test('persistent cache uses hashed identities, enforces TTL and degrades on quota errors', async () => {
    const s = fixture(), rows = new Map();
    const store = { list: async () => [...rows.values()], get: async key => rows.get(key), put: async row => rows.set(row.key, row), delete: async key => rows.delete(key), clear: async () => rows.clear() };
    const cache = s.createCache(store), settings = { persistentCache: true, cacheMiB: 8, cacheDays: 1 };
    await cache.put('secret-key|hello', new Blob(['audio']), { usageCharacters: 3 }, settings);
    assert.equal(rows.size, 1); assert.doesNotMatch([...rows.keys()][0], /secret|hello/);
    const result = await cache.get('secret-key|hello', settings); assert.equal(await result.blob.text(), 'audio');
    [...rows.values()][0].expires = 0; assert.equal(await cache.get('secret-key|hello', settings), null);
    const broken = s.createCache({ ...store, put: async () => { throw Error('quota'); } });
    assert.equal(await broken.put('other', new Blob(['a']), {}, settings), false);
});
test('voice list parses system, cloned and designed voices without exposing API credentials', async () => {
    let sent;
    const s = fixture({ fetch: async (url, init) => { sent = { url, init }; return new Response(JSON.stringify({ base_resp: { status_code: 0 },
        system_voice: [{ voice_id: 'one', voice_name: '晴' }], voice_cloning: [{ voice_id: 'two', voice_name: '雪' }] })); } });
    const voices = await s.listVoices({ endpoint: 'https://api.minimaxi.com/v1/t2a_v2', apiKey: 'secret', groupId: 'g' });
    assert.equal(voices.length, 2); assert.equal(voices[1].id, 'two'); assert.match(sent.url, /\/v1\/get_voice/);
    assert.doesNotMatch(JSON.stringify(voices), /secret/);
});

function ttsFixture(fetch, extra = {}) {
    const c = vm.createContext({ window: {}, Blob, URL, Uint8Array, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
        crypto: webcrypto, fetch, db: { minimaxTtsSettings: { apiKey: 'key', voiceId: 'voice' } }, ...extra });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/minimax_speech.js'), 'utf8'), c);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_features.js'), 'utf8'), c);
    return { tts: vm.runInContext('MiniMaxTTS', c), speech: c.window.MiniMaxSpeech, c };
}
const mp3Hex = 'fffb9064' + '00'.repeat(413);
test('actual synthesis uses capabilities and dictionary, exposes API usage and cached metadata', async () => {
    let body, calls = 0;
    const f = ttsFixture(async (url, init) => { body = JSON.parse(init.body); calls++; return new Response(JSON.stringify({ data: { audio: mp3Hex, status: 2 },
        extra_info: { audio_format: 'mp3', usage_characters: 4, audio_length: 1200 }, trace_id: 'trace-a' })); });
    const cfg = { apiKey: 'key', voiceId: 'voice', model: 'speech-2.6-hd', emotion: 'whisper', pronunciation: ['晴/(qing2)'] };
    const blob = await f.tts.synthesize('晴你好', cfg);
    assert.equal(body.voice_setting.emotion, 'whisper'); assert.equal(body.pronunciation_dict.tone[0], '晴/(qing2)');
    assert.equal(f.tts.getAudioDetails(blob).usageCharacters, 4);
    await f.tts.synthesize('晴你好', cfg); assert.equal(calls, 1);
});
test('actual streamed synthesis returns one complete MP3 and preserves final billing metadata', async () => {
    let body; const chunks = [];
    const f = ttsFixture(async (url, init) => { body = JSON.parse(init.body); return new Response([
        { data: { audio: mp3Hex, status: 1 } }, { data: { audio: mp3Hex, status: 2 }, extra_info: { usage_characters: 8 } }
    ].map(p => 'data: ' + JSON.stringify(p) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } }); });
    const blob = await f.tts.synthesize('test', { apiKey: 'key', voiceId: 'voice', model: 'speech-2.8-hd', speech: { stream: true } }, null, hex => chunks.push(hex));
    assert.equal(body.stream, true); assert.equal(blob.size, 417); assert.equal(chunks.length, 1);
    assert.equal(f.tts.getAudioDetails(blob).usageCharacters, 8);
});
test('oversized direct hex adapter is rejected before conversion and error includes response stage', async () => {
    const f = ttsFixture(async () => ({ ok: true, status: 200, json: async () => ({ data: { audio: 'ab'.repeat(13 * 1048576), status: 2 } }) }));
    await assert.rejects(f.tts.synthesize('test'), /过大/);
});


function playerFixture(fetch, extra = {}) {
    const sounds = [], toasts = [], urls = new Set();
    class TestAudio extends EventTarget {
        constructor() { super(); this.paused = true; sounds.push(this); }
        play() { this.paused = false; return Promise.resolve(); }
        pause() { this.paused = true; } load() {}
        removeAttribute(name) { if (name === 'src') this.src = ''; }
    }
    class TestURL extends URL {}
    let nextUrl = 0;
    TestURL.createObjectURL = () => { const url = 'blob:test-' + ++nextUrl; urls.add(url); return url; };
    TestURL.revokeObjectURL = url => urls.delete(url);
    const f = ttsFixture(fetch, { Audio: TestAudio, EventTarget, URL: TestURL, showToast: x => toasts.push(x), ...extra });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/voice_director.js'), 'utf8'), f.c);
    f.director = vm.runInContext('VoiceDirector', f.c);
    const classes = new Set();
    f.bubble = { dataset: {}, classList: { add: x => classes.add(x), remove: x => classes.delete(x) },
        setAttribute() {}, removeAttribute() {} };
    return { ...f, sounds, toasts, urls, classes };
}
const audioReply = () => new Response(JSON.stringify({ data: { audio: mp3Hex, status: 2 }, extra_info: { usage_characters: 3, audio_length: 100 } }));

test('playback uses saved role profile and plain override without touching main chat data', async () => {
    const calls = [];
    const f = playerFixture(async (url, init) => { calls.push(JSON.parse(init.body)); return audioReply(); });
    const m = { id: 'm', role: 'assistant', content: '你好。' }, role = { id: 'r', activeArchiveId: 'a', history: [m] };
    f.c.db.characters = [role]; f.c.db.minimaxTtsSettings.profiles = { r: { voiceId: 'role-voice', directorMode: 'off', dictionary: ['晴/(qing2)'] } };
    f.director.bind(f.bubble, role, m, 'private');
    await f.tts.play(f.bubble, m.content, undefined, { plain: true });
    assert.equal(calls[0].voice_setting.voice_id, 'role-voice'); assert.equal(calls[0].pronunciation_dict.tone[0], '晴/(qing2)');
    assert.equal(f.classes.has('voice-playing'), true); assert.equal(role.history.length, 1); assert.equal(m.content, '你好。');
    f.sounds[0].dispatchEvent(new Event('ended'));
});

test('archive changes during ordinary synthesis prevent late audio playback even with director off', async () => {
    let resolve;
    const f = playerFixture(() => new Promise(done => { resolve = done; }));
    const m = { id: 'm', role: 'assistant', content: '你好。' }, role = { id: 'r', activeArchiveId: 'a', history: [m] };
    f.c.db.characters = [role]; f.director.bind(f.bubble, role, m, 'private');
    const task = f.tts.play(f.bubble, m.content); role.activeArchiveId = 'b'; resolve(audioReply()); await task;
    assert.equal(f.urls.size, 0); assert.equal(f.sounds[0].paused, true);
});

test('optional long speech segments preserve text, aggregate usage and bound synthesis fanout', async () => {
    const calls = [];
    const f = playerFixture(async (url, init) => { calls.push(JSON.parse(init.body)); return audioReply(); });
    f.c.db.minimaxTtsSettings.speech = { segmented: true, segmentChars: 300 };
    const text = '啊'.repeat(300) + '唉'.repeat(300) + '哦'.repeat(10);
    await f.tts.play(f.bubble, text);
    const diagnostic=f.tts.getDiagnostics();assert.equal(diagnostic.segmentDetails.length,3);
    assert.equal(diagnostic.segmentDetails.map(s=>s.text).join(''),text);assert.equal(diagnostic.segmentDetails[0].usageCharacters,3);
    assert.equal(diagnostic.segmentDetails[0].speed,1);
    diagnostic.segmentDetails[0].text='外部修改';assert.notEqual(f.tts.getDiagnostics().segmentDetails[0].text,'外部修改');
    assert.equal(calls.length, 3); assert.equal(calls.map(x => x.text).join(''), text);
    assert.equal(f.tts.getDiagnostics().usageCharacters, 9); assert.equal(f.tts.getDiagnostics().segments, 3);
    f.sounds[0].dispatchEvent(new Event('ended'));
});

test('stream response on unsupported MediaSource plays complete MP3 with only one paid request', async () => {
    let calls = 0;
    const f = playerFixture(async () => { calls++; return new Response([
        { data: { audio: mp3Hex, status: 1 } }, { data: { audio: mp3Hex, status: 2 }, extra_info: { usage_characters: 4 } }
    ].map(p => 'data: ' + JSON.stringify(p) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } }); });
    f.c.db.minimaxTtsSettings.speech = { stream: true };
    await f.tts.play(f.bubble, '你好。');
    assert.equal(calls, 1); assert.equal(f.classes.has('voice-playing'), true); assert.equal(f.tts.getDiagnostics().usageCharacters, 4);
    f.sounds[0].dispatchEvent(new Event('ended'));
});


test('progressive decoder initialization failure reuses complete MP3 instead of another API request', async () => {
    const instances = []; let calls = 0;
    class BrokenMediaSource extends EventTarget {
        constructor() { super(); this.readyState = 'closed'; instances.push(this); }
        static isTypeSupported() { return true; }
        addSourceBuffer() { throw Error('unsupported source buffer'); }
    }
    const f = playerFixture(async () => { calls++; return new Response([
        { data: { audio: mp3Hex, status: 1 } }, { data: { audio: mp3Hex, status: 2 } }
    ].map(p => 'data: ' + JSON.stringify(p) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } }); }, { MediaSource: BrokenMediaSource });
    f.c.db.minimaxTtsSettings.speech = { stream: true };
    await f.tts.play(f.bubble, '你好。');
    const progressiveURL = f.sounds[0].src;
    instances[0].readyState = 'open'; instances[0].dispatchEvent(new Event('sourceopen'));
    await new Promise(resolve => setImmediate(resolve));
    assert.notEqual(f.sounds[0].src, progressiveURL); assert.equal(f.urls.size, 1); assert.equal(calls, 1);
    assert.equal(f.classes.has('voice-playing'), true); f.sounds[0].dispatchEvent(new Event('ended')); assert.equal(f.urls.size, 0);
});

test('persistent cache survives runtime cache clear without another request and excludes credentials from records', async () => {
    const rows = new Map(); let calls = 0;
    const f = ttsFixture(async () => { calls++; return audioReply(); });
    f.speech.persistent = f.speech.createCache({ list: async () => [...rows.values()], get: async key => rows.get(key),
        put: async row => rows.set(row.key, row), delete: async key => rows.delete(key), clear: async () => rows.clear() });
    const config = { apiKey: 'secret-unique', voiceId: 'voice', speech: { persistentCache: true } };
    await f.tts.synthesize('你好', config); await new Promise(resolve => setImmediate(resolve)); f.tts.clearCache();
    const restored = await f.tts.synthesize('你好', config);
    assert.equal(calls, 1); assert.equal(f.tts.getAudioDetails(restored).persistentHit, true);
    assert.doesNotMatch(JSON.stringify([...rows.values()]), /secret-unique|cacheKey|你好/);
});


test('ordinary override bypasses cached director while retry re-analyzes only the selected speech', async () => {
    let directorCalls = 0, ttsCalls = 0;
    const f = playerFixture(async (url, init) => {
        if (url.includes('director.test')) { directorCalls++; return new Response(JSON.stringify({ choices: [{ message: { content: '{"emotion":"sad","speedMultiplier":1,"pauses":[]}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } })); }
        ttsCalls++; return audioReply();
    });
    f.c.db.minimaxTtsSettings.director = { enabled: true, endpoint: 'https://director.test/v1', apiKey: 'dkey', model: 'dmodel' };
    await f.tts.play(f.bubble, '你好。'); f.sounds.at(-1).dispatchEvent(new Event('ended'));
    await f.tts.play(f.bubble, '你好。', undefined, { plain: true }); f.sounds.at(-1).dispatchEvent(new Event('ended'));
    assert.equal(directorCalls, 1); assert.equal(ttsCalls, 2);
    await f.tts.play(f.bubble, '你好。', undefined, { retry: true });
    assert.equal(directorCalls, 2); assert.equal(ttsCalls, 2);
    assert.equal(f.tts.getDiagnostics().currentUsageCharacters, 0);
    f.sounds.at(-1).dispatchEvent(new Event('ended'));
});


test('persistent cache refuses entries larger than the newly selected size limit', async () => {
    const s = fixture(), rows = new Map();
    const store = { list: async () => [...rows.values()], get: async key => rows.get(key), put: async row => rows.set(row.key, row), delete: async key => rows.delete(key), clear: async () => rows.clear() };
    const cache = s.createCache(store);
    await cache.put('large', new Blob([new Uint8Array(9 * 1048576)]), {}, { persistentCache: true, cacheMiB: 16, cacheDays: 1 });
    assert.equal(await cache.get('large', { persistentCache: true, cacheMiB: 8 }), null); assert.equal(rows.size, 0);
});


test('manual speech controls bypass director, clamp speed and leave conversation text unchanged', async () => {
    const calls = [];
    const f = playerFixture(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return audioReply(); });
    f.c.db.minimaxTtsSettings.director = { enabled: true, endpoint: 'https://director.test/v1', apiKey: 'dkey', model: 'dmodel' };
    await f.tts.play(f.bubble, '原文', undefined, { manual: { emotion: 'sad', speed: 1.1 } });
    assert.equal(calls.length, 1); assert.equal(calls[0].body.text, '原文');
    assert.equal(calls[0].body.voice_setting.emotion, 'sad'); assert.equal(calls[0].body.voice_setting.speed, 1.1);
    f.sounds[0].dispatchEvent(new Event('ended'));
});


test('invalid audio eviction waits for queued persistent writes and removes only its cache identity', async () => {
    const s = fixture(), rows = new Map();
    const store = { list: async () => [...rows.values()], get: async key => rows.get(key), put: async row => rows.set(row.key, row), delete: async key => rows.delete(key), clear: async () => rows.clear() };
    const cache = s.createCache(store), config = { persistentCache: true };
    const first = cache.put('bad', new Blob(['a']), {}, config), second = cache.put('good', new Blob(['b']), {}, config);
    await cache.remove('bad'); await Promise.all([first, second]);
    assert.equal(await cache.get('bad', config), null); assert.equal((await cache.get('good', config)).blob.size, 1);
});
