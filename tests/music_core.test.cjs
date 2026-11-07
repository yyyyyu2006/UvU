const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { IDBFactory } = require('fake-indexeddb');

const file = path.join(__dirname, '../js/modules/music_core.js');
const plain = value => JSON.parse(JSON.stringify(value));
const track = (id, extra = {}) => ({ provider: 'netease', id, title: 'Song ' + id, artists: ['Artist'], album: 'Album', duration: 120, ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(initial = {}, extras = {}) {
    const sounds = [], calls = [], writes = [], session = new Map(), local = new Map(), urls = new Set();
    let playHook, failSave = false;
    class TestAudio extends EventTarget {
        constructor() { super(); this.src = ''; this.paused = true; this.currentTime = 0; this.duration = 120; sounds.push(this); }
        play() { this.paused = false; return playHook ? playHook(this) : Promise.resolve(); }
        pause() { this.paused = true; }
        load() {}
        removeAttribute() { this.src = ''; }
        emit(name) { this.dispatchEvent(new Event(name)); }
    }
    class TestURL extends URL {}
    TestURL.createObjectURL = () => { const url = 'blob:test-' + urls.size; urls.add(url); return url; };
    TestURL.revokeObjectURL = url => urls.delete(url);
    const storage = map => ({ getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
    const h = { sounds, calls, writes, session, local, urls, status: 200, fetch: async url => url.endsWith('/session') ? { token: 'session-' + new URL(url).hostname } : { url: 'https://media.test/song.mp3', availability: 'full' },
        set playHook(value) { playHook = value; }, set failSave(value) { failSave = value; } };
    const context = vm.createContext({ window: new EventTarget(), Event, CustomEvent: class extends Event { constructor(name, options) { super(name); this.detail = options.detail; } },
        Audio: TestAudio, URL: TestURL, Blob, TextDecoder, AbortController, DOMException, setTimeout, clearTimeout,
        sessionStorage: storage(session), localStorage: storage(local), navigator: {}, db: initial,
        runDataPersistence: async fn => fn(), dexieDB: { globalSettings: { put: async value => { if (failSave) throw new Error('disk full'); writes.push(plain(value)); } }, transaction: async (mode, table, fn) => fn() },
        fetch: async (url, options) => { calls.push({ url, options }); const body = await h.fetch(url, options); return { ok: h.status >= 200 && h.status < 300, status: h.status, headers: { get: () => null }, text: async () => JSON.stringify(body) }; }, ...extras });
    vm.runInContext(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', context);
    h.music = context.window.UvUMusic; h.context = context; h.db = initial;
    return h;
}

test('portable tracks allowlist fields and reject active URLs', () => {
    const h = harness(); assert.ok(h.music, 'UvUMusic global is installed');
    const value = h.music.normalizeTrack(track('1', { cookie: 'secret', url: 'https://signed.test/song?token=private', cover: 'javascript:alert(1)', pageUrl: 'https://bad.test/?token=secret', artists: ['A', 2] }));
    assert.deepEqual(plain(value), { provider: 'netease', id: '1', title: 'Song 1', artists: ['A'], album: 'Album', cover: '', duration: 120, availability: 'unknown' });
    assert.throws(() => h.music.normalizeTrack({ ...track('1'), provider: 'evil' }));
    assert.equal(h.music, h.context.UvUMusic);
});

test('library writes serialize, use partial persistence and roll back on failure', async () => {
    const h = harness();
    await Promise.all([h.music.toggleFavorite(track('1')), h.music.toggleFavorite(track('2'))]);
    assert.equal(h.music.library().favorites.length, 2);
    assert.deepEqual(h.writes.map(item => item.key), ['musicLibrary', 'musicLibrary']);
    h.failSave = true;
    await assert.rejects(h.music.toggleFavorite(track('3')), /disk full/);
    assert.deepEqual(plain(h.music.library().favorites.map(item => item.id)), ['1', '2']);
    assert.ok(!JSON.stringify(h.db).includes('session-'));
});

test('gateway tokens stay outside settings and are scoped to canonical endpoint', async () => {
    const h = harness();
    await h.music.saveSettings({ endpoint: 'https://one.test/', remember: true, cookie: 'no' });
    await h.music.accounts();
    await h.music.saveSettings({ endpoint: 'https://two.test' });
    await h.music.accounts();
    const authenticated = h.calls.filter(call => call.url.endsWith('/accounts'));
    assert.equal(authenticated[0].options.headers.Authorization, 'Bearer session-one.test');
    assert.equal(authenticated[1].options.headers.Authorization, 'Bearer session-two.test');
    assert.ok(h.calls.every(call => call.options.credentials === 'omit'));
    assert.equal(h.local.size, 2);
    assert.deepEqual(Object.keys(h.db.musicSettings).sort(), ['endpoint', 'providers', 'remember']);
    assert.throws(() => h.music.request('https://other.test/accounts'));
});

test('unconfigured gateway has clear errors and cancelled requests do not create sessions', async () => {
    const h = harness();
    await assert.rejects(h.music.search('song'), /gateway/i);
    await h.music.saveSettings({ endpoint: 'https://one.test' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(h.music.search('song', ['qq'], 1, controller.signal), { name: 'AbortError' });
    assert.equal(h.calls.length, 0);
});

test('a late stream response cannot replace a newer playback intent', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } }), slow = deferred();
    h.fetch = async url => url.endsWith('/session') ? { token: 'token' } : url.includes('/1/stream') ? slow.promise : { url: 'https://media.test/two.mp3', availability: 'preview' };
    const first = h.music.player.play(track('1')); await tick();
    await h.music.player.play(track('2'));
    slow.resolve({ url: 'https://media.test/one.mp3', availability: 'full' }); await first;
    assert.equal(h.music.player.snapshot().track.id, '2');
    assert.equal(h.music.player.snapshot().track.availability, 'preview');
    assert.equal(h.sounds.filter(sound => !sound.paused).length, 1);
    assert.ok(h.sounds.at(-1).src.includes('two.mp3'));
    assert.ok(!JSON.stringify(h.music.library()).includes('media.test'));
    h.music.player.stop();
});

test('autoplay denial becomes blocked and retry reuses the loaded audio synchronously', async () => {
    const h = harness(); h.playHook = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const song = h.music.importURL('https://media.test/one.mp3', { title: 'Direct' });
    await h.music.player.play(song);
    assert.equal(h.music.player.snapshot().phase, 'blocked');
    let immediate = false; h.playHook = () => { immediate = true; return Promise.resolve(); };
    const retry = h.music.player.toggle(); assert.equal(immediate, true); await retry;
    assert.equal(h.music.player.snapshot().playing, true);
    assert.equal(h.sounds.length, 1); assert.equal(h.calls.length, 0);
    h.music.player.stop();
});

test('queue is bounded, restored without autoplay and old audio events are ignored', async () => {
    const h = harness({ musicLibrary: { queue: [track('restore')], playerPrefs: { mode: 'one' } } });
    assert.equal(h.music.player.snapshot().playing, false); assert.equal(h.sounds.length, 0);
    assert.equal(h.music.player.snapshot().queue.length, 1);
    const one = h.music.importURL('https://media.test/one.mp3', { id: 'a' }), two = h.music.importURL('https://media.test/two.mp3', { id: 'b' });
    await h.music.player.play(one, [one, two]); const old = h.sounds.at(-1);
    await h.music.player.next(); old.emit('ended'); old.emit('error');
    assert.equal(h.music.player.snapshot().track.id, 'b');
    for (let i = 0; i < 510; i++) h.music.player.enqueue(track(String(i)));
    assert.equal(h.music.player.snapshot().queue.length, 500);
    h.music.player.stop();
});

test('voice resume only resumes the same uninterrupted user intent', async () => {
    const h = harness(), song = h.music.importURL('https://media.test/one.mp3');
    await h.music.player.play(song); const resume = h.music.player.suspendVoice();
    assert.equal(h.music.player.snapshot().playing, false); await resume();
    assert.equal(h.music.player.snapshot().playing, true);
    const obsolete = h.music.player.suspendVoice(); await h.music.player.toggle(); await h.music.player.toggle(); await obsolete();
    assert.equal(h.music.player.snapshot().playing, false);
    h.music.player.stop();
});

test('unsafe stream URLs fail closed and oversized JSON is rejected', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } });
    h.fetch = async url => url.endsWith('/session') ? { token: 'token' } : { url: 'javascript:alert(1)', availability: 'full' };
    await h.music.player.play(track('1'));
    assert.equal(h.music.player.snapshot().phase, 'error'); assert.equal(h.sounds.length, 0);
    h.fetch = async () => ({ lyric: 'x'.repeat(2100000) });
    await assert.rejects(h.music.lyrics(track('1')), /large|limit/i);
});

test('search preserves provider failures without exposing extra account fields', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } });
    h.fetch = async url => url.endsWith('/session') ? { token: 'token' } : url.includes('/search?')
        ? { tracks: [track('1', { cookie: 'no', url: 'https://signed.test/secret' })], errors: [{ provider: 'qq', message: 'Unavailable' }], hasMore: true }
        : { accounts: [{ provider: 'netease', loggedIn: true, cookie: 'secret', user: { id: '1', name: 'Name', avatar: 'data:text/html,evil', cookie: 'secret' } }] };
    const results = await h.music.search('Song', ['netease', 'qq']);
    assert.equal(results.tracks.length, 1); assert.equal(results.hasMore, true); assert.equal(results.errors[0].provider, 'qq');
    assert.ok(!JSON.stringify(results).includes('cookie'));
    assert.deepEqual(plain(await h.music.accounts()), { accounts: [{ provider: 'netease', loggedIn: true, user: { id: '1', name: 'Name', avatar: '' } }] });
});

test('changing remember preference migrates the current endpoint token', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test', remember: true } });
    await h.music.accounts(); assert.equal(h.local.size, 1);
    await h.music.saveSettings({ remember: false });
    assert.equal(h.local.size, 0); assert.equal(h.session.size, 1);
    assert.ok(!JSON.stringify(h.db).includes('session-one.test'));
});

test('voice interruption prevents pending music from beginning over speech', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } }), pending = deferred();
    let streams = 0;
    h.fetch = async url => url.endsWith('/session') ? { token: 'token' } : (++streams === 1 ? pending.promise : { url: 'https://media.test/song.mp3' });
    const playing = h.music.player.play(track('1')); await tick();
    const resume = h.music.player.suspendVoice();
    pending.resolve({ url: 'https://media.test/song.mp3' }); await playing;
    assert.equal(h.music.player.snapshot().playing, false); assert.equal(h.sounds.length, 0);
    await resume(); assert.equal(h.music.player.snapshot().playing, true);
    h.music.player.stop();
});

test('audio bytes, signed sources and imported secrets never enter portable library', async () => {
    const h = harness();
    const song = h.music.importURL('https://media.test/song?token=transient', { cookie: 'secret', title: 'Track' });
    await h.music.toggleFavorite(song); h.music.player.enqueue(song);
    const portable = h.music.normalizeLibrary({ ...h.music.portableLibrary(), cookie: 'secret', queue: [track('1', { token: 'secret' })], playerPrefs: { token: 'secret', mode: 'shuffle' } });
    const encoded = JSON.stringify(portable);
    assert.ok(!encoded.includes('secret')); assert.ok(!encoded.includes('transient')); assert.ok(!encoded.includes('media.test'));
    await assert.rejects(h.music.importLocal({ size: 30 * 1024 * 1024 + 1, type: 'audio/mpeg' }), /30 MB/);
    await assert.rejects(h.music.importLocal({ size: 2, type: 'text/html' }), /audio/);
    h.music.player.stop();
});

test('local blobs stay in separate IndexedDB and object URLs are revoked on stop', async () => {
    const indexedDB = new IDBFactory(), h = harness({}, { indexedDB });
    const file = Object.assign(new Blob(['audio'], { type: 'audio/mpeg' }), { name: 'Track.mp3' });
    const song = await h.music.importLocal(file);
    assert.equal(song.provider, 'local'); assert.equal(song.title, 'Track');
    assert.equal(h.music.library().favorites.length, 1);
    assert.ok(!JSON.stringify(h.music.portableLibrary()).includes('blob:'));
    await h.music.player.play(song); assert.equal(h.urls.size, 1);
    h.music.player.stop(); assert.equal(h.urls.size, 0);
    const reopened = harness(plain(h.db), { indexedDB });
    await reopened.music.player.play(song); assert.equal(reopened.music.player.snapshot().playing, true);
    reopened.music.player.stop();
});

test('failed library save deletes the newly imported local blob', async () => {
    const indexedDB = new IDBFactory(), h = harness({}, { indexedDB }); h.failSave = true;
    const file = Object.assign(new Blob(['audio'], { type: 'audio/mpeg' }), { name: 'Track.mp3' });
    await assert.rejects(h.music.importLocal(file), /disk full/);
    const connection = await new Promise((resolve, reject) => { const request = indexedDB.open('uvu-music-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    const count = await new Promise((resolve, reject) => { const transaction = connection.transaction('audio'), request = transaction.objectStore('audio').count(); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    assert.equal(count, 0); assert.equal(h.music.library().favorites.length, 0); connection.close();
});

test('sleep and repeat modes act on the player without per-second database writes', async () => {
    const h = harness(), song = h.music.importURL('https://media.test/song.mp3');
    await h.music.player.play(song); await tick();
    const writes = h.writes.length, audio = h.sounds.at(-1);
    audio.currentTime = 5; audio.emit('timeupdate'); audio.currentTime = 6; audio.emit('timeupdate');
    assert.equal(h.writes.length, writes); assert.equal(h.music.player.snapshot().position, 6);
    h.music.player.setMode('one'); audio.emit('ended'); await tick();
    assert.equal(audio.currentTime, 0); assert.equal(h.music.player.snapshot().playing, true);
    h.music.player.setSleep(0.0001); await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(h.music.player.snapshot().playing, false); assert.equal(h.music.player.snapshot().sleepAt, 0);
    h.music.player.stop();
});

test('a queued pause event from an earlier pause cannot clear a resumed player', async () => {
    const h = harness(), song = h.music.importURL('https://media.test/song.mp3');
    await h.music.player.play(song); const audio = h.sounds.at(-1);
    await h.music.player.toggle(); await h.music.player.toggle();
    audio.emit('pause');
    assert.equal(h.music.player.snapshot().playing, true);
    h.music.player.stop();
});

test('a late session response for the old endpoint cannot install credentials or run accounts', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } }), pending = deferred();
    h.fetch = async url => url.includes('one.test') ? pending.promise : { token: 'two-token' };
    const accountRequest = h.music.accounts(); await tick();
    await h.music.saveSettings({ endpoint: 'https://two.test' });
    pending.resolve({ token: 'stale-token' });
    await assert.rejects(accountRequest, { name: 'AbortError' });
    assert.equal(h.session.size, 0); assert.equal(h.local.size, 0);
    assert.equal(h.calls.length, 1);
});

test('session creation requests server persistence and explains a disabled encrypted vault', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test', remember: true } });
    h.status = 400; h.fetch = async () => ({ error: { code: 'persistence_disabled', message: 'Request could not be completed' } });
    await assert.rejects(h.music.connect(), error => error.code === 'persistence_disabled' && /记住登录/.test(error.message) && /加密/.test(error.message));
    assert.deepEqual(JSON.parse(h.calls[0].options.body), { remember: true });
    assert.equal(h.local.size, 0);
});

test('structured account errors preserve safe details without replacing the music session', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } });
    h.fetch = async url => {
        if (url.endsWith('/session')) return { token: 'token' };
        h.status = 401; return { error: { code: 'account_required', message: 'Login required' } };
    };
    await assert.rejects(h.music.playlists('qq'), error => error.code === 'account_required' && /登录/.test(error.message) && error.gatewayMessage === 'Login required');
    assert.equal(h.calls.filter(call => call.url.endsWith('/session')).length, 1);
});

test('unknown gateway error details are bounded and redact credential-looking content', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } });
    h.fetch = async url => {
        if (url.endsWith('/session')) return { token: 'token' };
        h.status = 503; return { error: { code: 'custom_failure', message: 'Try later\nBearer private-bearer token=private-token https://secret.test/a?cookie=private-cookie ' + 'x'.repeat(1000) } };
    };
    await assert.rejects(h.music.accounts(), error => error.code === 'custom_failure' && error.message.length <= 350 && !/private|secret.test/.test(error.message + error.gatewayMessage));
});

test('subscribing before loadData does not permanently discard the persisted queue', async () => {
    const h = harness(); let received;
    h.music.player.subscribe(value => { received = value; });
    assert.equal(received.queue.length, 0);
    h.db.musicLibrary = { queue: [track('restored')], playerPrefs: { mode: 'shuffle' } };
    assert.equal(h.music.player.snapshot().queue[0].id, 'restored');
    assert.equal(h.music.player.snapshot().mode, 'shuffle');
    h.music.player.enqueue(track('manual'));
    h.db.musicLibrary = { queue: [track('different')], playerPrefs: { mode: 'one' } };
    assert.deepEqual(plain(h.music.player.snapshot().queue.map(item => item.id)), ['restored', 'manual']);
    h.music.player.stop();
});

test('seeking before a stream resolves cannot strand playback in loading', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } }), pending = deferred();
    h.fetch = async url => url.endsWith('/session') ? { token: 'token' } : pending.promise;
    const playing = h.music.player.play(track('1')); await tick();
    h.music.player.seek(10);
    pending.resolve({ url: 'https://media.test/song.mp3', availability: 'full' }); await playing;
    assert.equal(h.music.player.snapshot().playing, true);
    assert.equal(h.music.player.snapshot().phase, 'playing');
    assert.equal(h.sounds.length, 1);
    h.music.player.stop();
});

test('seeking while browser play permission is pending preserves its playback generation', async () => {
    const h = harness(), pending = deferred(), song = h.music.importURL('https://media.test/song.mp3');
    h.playHook = () => pending.promise;
    const playing = h.music.player.play(song); await tick();
    h.music.player.seek(10); pending.resolve(); await playing;
    assert.equal(h.music.player.snapshot().playing, true);
    assert.equal(h.music.player.snapshot().position, 10);
    h.music.player.stop();
});

test('successful streams with unknown availability never claim full access', async () => {
    const h = harness({ musicSettings: { endpoint: 'https://one.test' } });
    h.fetch = async url => url.endsWith('/session') ? { token: 'token' } : { url: 'https://media.test/song.mp3', availability: 'unknown' };
    await h.music.player.play(track('1'));
    assert.equal(h.music.player.snapshot().track.availability, 'unknown');
    h.music.player.stop();
});

test('deleting local audio removes every metadata reference, blob and current playback', async () => {
    const indexedDB = new IDBFactory(), h = harness({}, { indexedDB });
    const file = Object.assign(new Blob(['audio'], { type: 'audio/mpeg' }), { name: 'Track.mp3' });
    const song = await h.music.importLocal(file), list = await h.music.addPlaylist('List');
    await h.music.addToPlaylist(list.id, song); await h.music.player.play(song); await tick();
    assert.equal(h.music.library().recent.length, 1); assert.equal(h.urls.size, 1);
    await h.music.deleteLocal(song);
    const saved = h.music.library();
    assert.equal(saved.favorites.length, 0); assert.equal(saved.recent.length, 0); assert.equal(saved.queue.length, 0); assert.equal(saved.playlists[0].tracks.length, 0);
    assert.equal(h.music.player.snapshot().track, null); assert.equal(h.urls.size, 0);
    const reopened = harness({}, { indexedDB }); await reopened.music.player.play(song);
    assert.equal(reopened.music.player.snapshot().phase, 'error');
});

test('failed local deletion restores the blob and library while preserving playback', async () => {
    const indexedDB = new IDBFactory(), h = harness({}, { indexedDB });
    const file = Object.assign(new Blob(['audio'], { type: 'audio/mpeg' }), { name: 'Track.mp3' });
    const song = await h.music.importLocal(file); await h.music.player.play(song); await tick();
    const before = plain(h.music.library()); h.failSave = true;
    await assert.rejects(h.music.deleteLocal(song), /disk full/);
    assert.deepEqual(plain(h.music.library()), before); assert.equal(h.music.player.snapshot().playing, true); assert.equal(h.urls.size, 1);
    const reopened = harness({}, { indexedDB }); await reopened.music.player.play(song);
    assert.equal(reopened.music.player.snapshot().playing, true);
    reopened.music.player.stop(); h.music.player.stop();
});

test('deleting transient direct audio clears its session source and rejects remote tracks', async () => {
    const h = harness(), song = h.music.importURL('https://media.test/song.mp3');
    await h.music.toggleFavorite(song); await h.music.player.play(song);
    await h.music.deleteLocal(song);
    await h.music.player.play(song); assert.equal(h.music.player.snapshot().phase, 'error');
    await assert.rejects(h.music.deleteLocal(track('remote')), /local/i);
    h.music.player.stop();
});

test('local deletion waits for metadata commit before stopping the current player', async () => {
    const indexedDB = new IDBFactory(), h = harness({}, { indexedDB }), pending = deferred();
    const file = Object.assign(new Blob(['audio'], { type: 'audio/mpeg' }), { name: 'Track.mp3' });
    const song = await h.music.importLocal(file); await h.music.player.play(song); await tick();
    h.context.dexieDB.globalSettings.put = () => pending.promise;
    const deleting = h.music.deleteLocal(song); await tick();
    assert.equal(h.music.player.snapshot().playing, true); assert.equal(h.urls.size, 1);
    pending.resolve(); await deleting;
    assert.equal(h.music.player.snapshot().playing, false); assert.equal(h.urls.size, 0);
});
