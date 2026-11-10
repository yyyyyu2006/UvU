const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const mp3 = 'fffb9064' + '00'.repeat(413);
const reply = () => ({ ok: true, status: 200, json: async () => ({
    base_resp: { status_code: 0 }, data: { audio: mp3, status: 2 },
    extra_info: { audio_format: 'mp3' }, trace_id: 'test-trace'
}) });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}
function bubble() {
    const classes = new Set(), attributes = new Map();
    return {
        dataset: {}, classes, attributes, disabled: false,
        classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)) },
        setAttribute: (key, value) => attributes.set(key, value),
        removeAttribute: key => attributes.delete(key)
    };
}
function harness() {
    const sounds = [], toasts = [], urls = new Set(), elements = new Map();
    let requests = 0, playHook;
    class TestAudio extends EventTarget {
        constructor(src) { super(); this.src = src || ''; this.paused = true; this.handlers = {}; sounds.push(this); }
        addEventListener(name, listener, options) { super.addEventListener(name, listener, options); this.handlers[name] = listener; }
        play() { this.paused = false; return playHook ? playHook(this) : Promise.resolve(); }
        pause() { this.paused = true; }
        load() {}
        removeAttribute(name) { if (name === 'src') this.src = ''; }
        emit(name) { this.dispatchEvent(new Event(name)); }
    }
    class TestURL extends URL {}
    TestURL.createObjectURL = () => { const url = `blob:test-${urls.size}-${sounds.length}`; urls.add(url); return url; };
    TestURL.revokeObjectURL = url => urls.delete(url);
    const settings = { apiKey: 'test-key', voiceId: 'voice' };
    for (const [id, value] of Object.entries({ key: settings.apiKey, endpoint: '', 'group-id': '', model: '', voice: 'voice', speed: '1', pitch: '0' })) {
        elements.set(`minimax-tts-${id}`, { value });
    }
    const preview = bubble(); preview.id = 'minimax-tts-preview'; elements.set('minimax-tts-preview', preview);
    const context = vm.createContext({
        Blob, URL: TestURL, Uint8Array, AbortController, Map, Audio: TestAudio, setTimeout, clearTimeout,
        window: {}, db: { minimaxTtsSettings: settings },
        document: { getElementById: id => elements.get(id) },
        showToast: message => toasts.push(message),
        fetch: async (...args) => { requests++; return state.fetch(...args); }
    });
    const state = { sounds, toasts, urls, preview, fetch: async () => reply(),
        get requests() { return requests; }, set playHook(hook) { playHook = hook; } };
    const directorFile = path.join(__dirname, '../js/modules/voice_director.js');
    if (fs.existsSync(directorFile)) vm.runInContext(fs.readFileSync(directorFile, 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_features.js'), 'utf8'), context);
    state.tts = vm.runInContext('MiniMaxTTS', context);
    state.director = fs.existsSync(directorFile) ? vm.runInContext('VoiceDirector', context) : null;
    state.db = context.db;
    state.window = context.window;
    state.previewVoice = vm.runInContext('previewMiniMaxVoice', context);
    return state;
}

test('voice playback suspends music, and pausing or blocked audio releases it once', async () => {
    const h=harness(), b=bubble();let suspended=0,resumed=0;
    h.window.UvUMusic={player:{suspendVoice(){suspended++;let used=false;return async()=>{if(!used){used=true;resumed++;}};}}};
    await h.tts.play(b,'one');assert.equal(suspended,1);assert.equal(resumed,0);
    await h.tts.play(b,'one');assert.equal(resumed,1,'manual voice pause resumes music');
    h.playHook=()=>Promise.reject(Object.assign(new Error('blocked'),{name:'NotAllowedError'}));
    await h.tts.play(b,'one');assert.equal(suspended,2);assert.equal(resumed,2,'permission failure resumes music');
    h.sounds.at(-1).emit('ended');assert.equal(resumed,2,'cleanup does not resume twice');
});

test('public stop pauses active audio and releases playback resources', async () => {
    const h = harness(), b = bubble(); let resumed = 0;
    h.window.UvUMusic = { player: { suspendVoice: () => async () => { resumed++; } } };
    await h.tts.play(b, 'stop this voice');
    const audio = h.sounds.at(-1);
    assert.equal(audio.paused, false);
    h.tts.stop();
    assert.equal(audio.paused, true);
    assert.equal(b.classes.has('voice-playing'), false);
    assert.equal(b.attributes.has('aria-busy'), false);
    assert.equal(resumed, 1);
    h.tts.stop();
    assert.equal(resumed, 1, 'repeated stops must not resume music twice');
});

test('late events from an old voice cannot stop or mark the new voice', async () => {
    const h = harness(), first = bubble(), second = bubble();
    await h.tts.play(first, 'one');
    const old = h.sounds.at(-1), oldError = old.handlers.error, oldEnded = old.handlers.ended;
    await h.tts.play(second, 'two');
    old.error = { code: 4 }; oldError(); oldEnded();
    assert.equal(h.sounds.at(-1).paused, false);
    assert.equal(second.classes.has('voice-playing'), true);
    assert.deepEqual(h.toasts, []);
    assert.equal(first.attributes.has('aria-busy'), false);
});

function enableDirector(h) {
    h.db.minimaxTtsSettings.director = { enabled: true, endpoint: 'https://director.test/v1', apiKey: 'director-key', model: 'director-model' };
    const calls = [];
    h.fetch = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return url.includes('director.test')
            ? { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ emotion: 'sad', speedMultiplier: 0.9,
                pauses: [{ after: '对不起，', seconds: 0.4 }] }) } }] }) }
            : reply();
    };
    return calls;
}

test('directed playback sends controls only to MiniMax and preserves transcript data', async () => {
    const h = harness(), b = bubble(), calls = enableDirector(h);
    b.dataset.voiceText = '对不起，是我没考虑周全。';
    await h.tts.play(b, b.dataset.voiceText);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.text, '对不起，<#0.4#>是我没考虑周全。');
    assert.equal(calls[1].body.voice_setting.emotion, 'sad');
    assert.equal(calls[1].body.voice_setting.speed, 0.9);
    assert.equal(b.dataset.voiceText, '对不起，是我没考虑周全。');
    h.sounds.at(-1).emit('ended');
    await h.tts.play(b, b.dataset.voiceText);
    assert.equal(calls.length, 2, 'successful director and speech plans should both be reused');
});

test('directed autoplay retry stays synchronous and never repeats director or TTS requests', async () => {
    const h = harness(), b = bubble(), calls = enableDirector(h);
    h.playHook = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    await h.tts.play(b, '对不起，是我没考虑周全。');
    let played = false; h.playHook = () => { played = true; return Promise.resolve(); };
    const retry = h.tts.play(b, '对不起，是我没考虑周全。');
    assert.equal(played, true); await retry;
    assert.equal(calls.length, 2);
});

test('directed voice can pause and resume, then switch bubbles without repeating synthesis', async () => {
    const h = harness(), b = bubble(), calls = enableDirector(h);
    await h.tts.play(b, '对不起，是我没考虑周全。');
    const audio = h.sounds.at(-1);
    await h.tts.play(b, '对不起，是我没考虑周全。');
    assert.equal(audio.paused, true);
    assert.equal(b.classes.has('voice-playing'), false);
    await h.tts.play(b, '对不起，是我没考虑周全。');
    assert.equal(audio.paused, false); assert.equal(calls.length, 2);
    await h.tts.play(bubble(), 'another line');
    assert.equal(audio.paused, true);
    assert.equal(b.attributes.has('aria-busy'), false);
});

test('director HTTP failure falls back to original TTS without sending error text to speech', async () => {
    const h = harness(), b = bubble(); enableDirector(h);
    let spoken;
    h.fetch = async (url, init) => {
        if (url.includes('director.test')) return { ok: false, status: 503 };
        spoken = JSON.parse(init.body); return reply();
    };
    await h.tts.play(b, '原文');
    assert.equal(spoken.text, '原文');
    assert.equal(spoken.voice_setting.emotion, undefined);
    assert.equal(b.classes.has('voice-playing'), true);
    assert.ok(h.toasts.some(text => /503/.test(text)));
});

test('archive switching during direction cancels speech instead of falling back into a new archive', async () => {
    const h = harness(), b = bubble(); enableDirector(h);
    const m = { id: 'm', role: 'assistant', content: '[晴的语音：你好。]' };
    const chat = { id: 'c', activeArchiveId: 'a', realName: '晴', history: [m] };
    h.db.characters = [chat];
    h.director.bind(b, chat, m, 'private');
    const pending = deferred(); let requests = 0, requestedUrl;
    h.fetch = async url => { requests++; requestedUrl = url; return pending.promise; };
    const playing = h.tts.play(b, '你好。');
    assert.match(requestedUrl, /director\.test/);
    chat.activeArchiveId = 'b';
    pending.resolve({ ok: true, json: async () => ({ choices: [{ message: { content: '{"emotion":"calm"}' } }] }) });
    await playing;
    assert.equal(requests, 1); assert.equal(h.urls.size, 0); assert.equal(b.classes.size, 0);
});

test('normal completion releases resources without a false playback error', async () => {
    const h = harness(), b = bubble();
    await h.tts.play(b, 'one');
    const audio = h.sounds.at(-1);
    audio.emit('ended'); audio.error = { code: 4 }; audio.emit('error');
    assert.deepEqual(h.toasts, []);
    assert.equal(h.urls.size, 0);
    assert.equal(b.classes.size, 0);
    assert.equal(b.attributes.has('aria-busy'), false);
});

test('a superseded pending play cannot resurrect an old bubble', async () => {
    const h = harness(), first = bubble(), second = bubble(), pending = deferred();
    h.playHook = () => pending.promise;
    const original = h.tts.play(first, 'one'); await tick();
    h.playHook = undefined;
    await h.tts.play(second, 'two'); pending.resolve(); await original;
    assert.equal(first.classes.has('voice-playing'), false);
    assert.equal(first.attributes.has('aria-busy'), false);
    assert.equal(second.classes.has('voice-playing'), true);
});

test('decode failures evict cached audio and report safe response diagnostics once', async () => {
    const h = harness(), b = bubble();
    await h.tts.play(b, 'one');
    const audio = h.sounds.at(-1); audio.error = { code: 3 }; audio.emit('error');
    assert.equal(h.toasts.length, 1);
    assert.match(h.toasts[0], /test-trace/);
    assert.doesNotMatch(h.toasts[0], /test-key/);
    assert.equal(b.attributes.has('aria-busy'), false);
    await h.tts.play(b, 'one');
    assert.equal(h.requests, 2);
});

test('permission-blocked chat playback retries synchronously without another API call', async () => {
    const h = harness(), b = bubble();
    h.playHook = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    await h.tts.play(b, 'one');
    assert.equal(b.attributes.has('aria-busy'), false);
    assert.match(h.toasts[0], /再次点击/);
    let played = false;
    h.playHook = () => { played = true; return Promise.resolve(); };
    const retry = h.tts.play(b, 'one');
    assert.equal(played, true, 'play must be called inside the second click, before any await');
    await retry;
    assert.equal(h.requests, 1);
    assert.equal(b.classes.has('voice-playing'), true);
});

test('preview uses the same permission retry and only one active player', async () => {
    const h = harness();
    h.playHook = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    await h.previewVoice();
    assert.equal(h.preview.disabled, false);
    assert.match(h.toasts[0], /再次点击/);
    let played = false;
    h.playHook = () => { played = true; return Promise.resolve(); };
    const retry = h.previewVoice(); assert.equal(played, true); await retry;
    assert.equal(h.requests, 1);
    const previewAudio = h.sounds.at(-1);
    await h.tts.play(bubble(), 'chat');
    assert.equal(previewAudio.paused, true);
    assert.equal(h.urls.size, 1);
});

test('preview reports a late media error and releases its URL', async () => {
    const h = harness(); await h.previewVoice();
    const audio = h.sounds.at(-1); audio.error = { code: 4 }; audio.emit('error');
    assert.equal(h.toasts.length, 1);
    assert.equal(h.urls.size, 0);
    assert.equal(h.preview.disabled, false);
});

test('cancelling a pending synthesis clears UI and ignores a late response', async () => {
    const h = harness(), b = bubble(), pending = deferred();
    let signal;
    h.fetch = (url, options) => { signal = options.signal; return pending.promise; };
    const original = h.tts.play(b, 'one');
    await h.tts.play(b, 'one');
    assert.equal(signal.aborted, true);
    pending.resolve(reply()); await original;
    assert.equal(b.classes.size, 0);
    assert.equal(b.attributes.has('aria-busy'), false);
    assert.equal(h.urls.size, 0);
    assert.deepEqual(h.toasts, []);
});
