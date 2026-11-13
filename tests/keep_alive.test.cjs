const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness(sharedStorage = new Map(), sessionStorage = new Map()) {
    let now = 1000000;
    const sounds = [], urls = new Set(), timers = new Map(), status = { textContent: '', dataset: {} };
    const document = new EventTarget(); document.visibilityState = 'visible';
    document.getElementById = id => id === 'keep-alive-status' ? status : null;
    const window = new EventTarget();
    class Audio extends EventTarget {
        constructor() { super(); this.paused = true; sounds.push(this); }
        play() { return Promise.resolve(state.play(this)).then(() => { this.paused = false; this.dispatchEvent(new Event('playing')); }); }
        pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
        load() {} setAttribute() {} removeAttribute() {}
    }
    class TestURL extends URL {}
    TestURL.createObjectURL = () => { const url = 'blob:test-' + sounds.length; urls.add(url); return url; };
    TestURL.revokeObjectURL = url => urls.delete(url);
    class CustomEvent extends Event { constructor(name, options = {}) { super(name); this.detail = options.detail; } }
    class Clock extends Date { static now() { return now; } }
    const storage = { getItem: k => sharedStorage.get(k) ?? null, setItem: (k, v) => sharedStorage.set(k, String(v)), removeItem: k => sharedStorage.delete(k) };
    const state = { window, document, sounds, urls, timers, status, sharedStorage, sessionStorage, play: () => Promise.resolve(),
        autoReply: () => Promise.resolve(), backup: () => Promise.resolve(), autoChecks: 0, backupChecks: 0, resumeEvents: [], locks: [],
        advance(ms) { now += ms; }, async visible(value) { document.visibilityState = value; document.dispatchEvent(new Event('visibilitychange')); await tick(); } };
    const navigator = { onLine: true, mediaSession: { metadata: { title: 'Real song' }, playbackState: 'playing' }, wakeLock: { request: async () => {
        const lock = new EventTarget(); lock.released = false; lock.release = async () => { lock.released = true; lock.dispatchEvent(new Event('release')); }; state.locks.push(lock); return lock;
    } } };
    state.navigator = navigator;
    const context = vm.createContext({ window, document, navigator, Date: Clock, Audio, URL: TestURL, Blob, CustomEvent, Event,
        console: { debug() {}, warn() {}, log() {} }, localStorage: storage, sessionStorage: {
            getItem: k => sessionStorage.get(k) ?? null, setItem: (k, v) => sessionStorage.set(k, String(v)), removeItem: k => sessionStorage.delete(k) },
        setInterval: (fn, ms) => { const id = {}; timers.set(id, { fn, ms }); return id; }, clearInterval: id => timers.delete(id), setTimeout, clearTimeout,
        updateClock() {}, checkAutoReply: () => { state.autoChecks++; return state.autoReply(); },
        checkBackupReminder: () => { state.backupChecks++; return state.backup(); } });
    window.addEventListener('uwu:app-resume', e => state.resumeEvents.push(e.detail));
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/keep_alive.js'), 'utf8'), context);
    state.manager = window.KeepAliveManager; state.context = context; return state;
}

test('keepalive releases a wake lock that resolves after disabling', async () => {
    const h = harness(), pending = deferred();
    h.navigator.wakeLock.request = () => pending.promise;
    const enabling = h.manager.init(true); await tick(); await h.manager.setEnabled(false);
    let released = 0; const lock = new EventTarget(); lock.release = async () => { released++; };
    pending.resolve(lock); await enabling;
    assert.equal(released, 1); assert.equal(h.manager.isEnabled(), false); assert.equal(h.timers.size, 0);
});

test('keepalive never replaces music Media Session metadata or playback state', async () => {
    const h = harness(), metadata = h.navigator.mediaSession.metadata;
    await h.manager.init(true); assert.equal(h.navigator.mediaSession.metadata, metadata);
    await h.manager.setEnabled(false); assert.equal(h.navigator.mediaSession.metadata, metadata);
    assert.equal(h.navigator.mediaSession.playbackState, 'playing');
});

test('a late audio play cannot reactivate disabled keepalive', async () => {
    const h = harness(), pending = deferred(); h.play = () => pending.promise;
    const enabling = h.manager.init(true); await tick(); await h.manager.setEnabled(false); pending.resolve(); await enabling;
    assert.ok(h.sounds.every(a => a.paused)); assert.equal(h.urls.size, 0); assert.equal(h.status.dataset.state, 'off');
});

test('a failed auto reply cannot block backup checks or the resume event', async () => {
    const h = harness(); await h.manager.init(true); await h.visible('hidden'); h.advance(30000);
    h.autoReply = async () => { throw Error('provider failed'); };
    h.document.visibilityState = 'visible'; await h.manager.recover('test'); await tick();
    assert.equal(h.autoChecks, 1); assert.equal(h.backupChecks, 1); assert.equal(h.resumeEvents.length, 1);
    await h.manager.setEnabled(false);
});

test('music loading and voice playback pause compatibility audio until both release', async () => {
    const h = harness(); await h.manager.init(true);
    const sound = h.sounds.at(-1);
    const event = state => { const e = new Event('music-state'); e.detail = state; h.window.dispatchEvent(e); };
    event({ phase: 'loading' }); assert.equal(sound.paused, true);
    const release = h.manager.suspendForMedia();
    event({ phase: 'paused' }); await tick(); assert.equal(sound.paused, true);
    release(); release(); await tick(); assert.equal(sound.paused, false);
    await h.manager.setEnabled(false); release(); await tick(); assert.equal(sound.paused, true);
});

test('separate audio and screen settings work without changing enabled preference', async () => {
    const h = harness(); await h.manager.init(true, { screenAwake: false, compatibilityAudio: false });
    assert.equal(h.locks.length, 0); assert.equal(h.sounds.length, 0); assert.equal(h.manager.isEnabled(), true);
    await h.manager.setEnabled(false); assert.equal(h.timers.size, 0);
});

test('voice already playing before enable still holds compatibility audio', async () => {
    const h = harness(), release = h.manager.suspendForMedia();
    await h.manager.init(true); assert.equal(h.sounds.length, 0);
    release(); await tick(); assert.equal(h.sounds.length, 1); await h.manager.setEnabled(false);
});

test('recovery does not wait for AI completion and coalesces lifecycle bursts', async () => {
    const h = harness(), pending = deferred(); await h.manager.init(true);
    await h.visible('hidden'); h.advance(30000); h.document.visibilityState = 'visible';
    h.autoReply = () => pending.promise;
    await Promise.all([h.manager.recover('one'), h.manager.recover('two'), h.manager.recover('three')]);
    await tick(); assert.equal(h.autoChecks, 1); assert.equal(h.backupChecks, 1); assert.equal(h.resumeEvents.length, 1);
    await h.manager.setEnabled(false); pending.resolve(); await tick(); assert.equal(h.manager.isEnabled(), false);
});

test('checkpoint recovery consumes a fresh interrupted check without replaying AI', async () => {
    const h = harness(); h.sharedStorage.set('uwu_keep_alive_checkpoint', JSON.stringify({ timestamp: 970000, pending: true }));
    await h.manager.init(true, { compatibilityAudio: false }); await tick();
    assert.equal(h.autoChecks, 0); assert.equal(h.backupChecks, 1); assert.equal(h.manager.getDiagnostics().interrupted, true);
    assert.equal(h.resumeEvents.length, 1); await h.manager.recover('again'); assert.equal(h.resumeEvents.length, 1);
    await h.manager.setEnabled(false);
});

test('invalid, future, and stale checkpoints do not trigger catch-up', async () => {
    for (const raw of ['{broken', JSON.stringify({ timestamp: 2000000 }), JSON.stringify({ timestamp: -90000000 })]) {
        const h = harness(); h.sharedStorage.set('uwu_keep_alive_checkpoint', raw);
        await h.manager.init(true, { compatibilityAudio: false }); await tick(); assert.equal(h.autoChecks, 0);
        await h.manager.setEnabled(false);
    }
});

test('only one enabled tab runs scheduled catch-up and relinquishes its lease when hidden', async () => {
    const storage = new Map(), a = harness(storage), b = harness(storage);
    await a.manager.init(true, { compatibilityAudio: false }); await b.manager.init(true, { compatibilityAudio: false });
    await a.manager.scheduled('autoReply', () => { a.autoChecks++; });
    await b.manager.scheduled('autoReply', () => { b.autoChecks++; });
    assert.equal(a.autoChecks + b.autoChecks, 1);
    await a.visible('hidden'); await b.manager.scheduled('autoReply', () => { b.autoChecks++; }); assert.equal(b.autoChecks, 1);
    await a.manager.setEnabled(false); await b.manager.setEnabled(false);
});

test('disabled manager delegates the original scheduler directly', async () => {
    const h = harness(); await h.manager.init(false);
    let calls = 0; await h.manager.scheduled('autoReply', () => { calls++; });
    assert.equal(calls, 1); assert.equal(h.sounds.length, 0); assert.equal(h.locks.length, 0); assert.equal(h.timers.size, 0);
});

test('unsettled media capability promises cannot block preference changes', async () => {
    const h = harness(), pending = deferred(); h.play = () => pending.promise;
    let settled = false; const enabling = h.manager.init(true).then(() => { settled = true; });
    await tick(); assert.equal(settled, true);
    await h.manager.setEnabled(false); pending.resolve(); await enabling; await tick();
    assert.equal(h.status.dataset.state, 'off');
});

test('a queued recovery must stop after the page becomes hidden again', async () => {
    const h = harness(); await h.manager.init(true, { compatibilityAudio: false });
    await h.visible('hidden'); h.advance(30000); h.document.visibilityState = 'visible';
    const pending = h.manager.recover('queued'); h.document.visibilityState = 'hidden';
    await pending; await tick(); assert.equal(h.autoChecks, 0); await h.manager.setEnabled(false);
});

test('old audio errors cannot change disabled or newer resource state', async () => {
    const h = harness(); await h.manager.init(true); const old = h.sounds.at(-1);
    await h.manager.setEnabled(false); old.dispatchEvent(new Event('error'));
    assert.equal(h.status.dataset.state, 'off');
    await h.manager.setEnabled(true); const active = h.sounds.at(-1); old.dispatchEvent(new Event('error'));
    assert.equal(active.paused, false); assert.equal(h.manager.getDiagnostics().audioPlaying, true);
    await h.manager.setEnabled(false);
});

test('pending background work is not duplicated by the new coordinator after tab handoff', async () => {
    const storage = new Map(), a = harness(storage), b = harness(storage), pending = deferred();
    await a.manager.init(true, { compatibilityAudio: false }); await b.manager.init(true, { compatibilityAudio: false });
    const first = a.manager.scheduled('autoReply', () => { a.autoChecks++; return pending.promise; });
    await tick(); await a.visible('hidden');
    await b.manager.scheduled('autoReply', () => { b.autoChecks++; });
    assert.equal(b.autoChecks, 0); pending.resolve(); await first;
    await a.manager.setEnabled(false); await b.manager.setEnabled(false);
});

test('stale tab cannot run auto replies after another page saved a newer trigger', async () => {
    const h = harness();
    h.context.db = { characters: [{ id:'role', autoReply:{ enabled:true, lastTriggerTime:1 } }] };
    h.context.dexieDB = { characters:{ bulkGet:async () => [{ id:'role', autoReply:{ enabled:true, lastTriggerTime:999999 } }] } };
    await h.manager.init(true, { compatibilityAudio:false });
    await h.manager.scheduled('autoReply', () => { h.autoChecks++; });
    assert.equal(h.autoChecks, 0); assert.equal(h.context.db.characters[0].autoReply.lastTriggerTime, 1);
    await h.manager.setEnabled(false);
});

test('independent recovery task claims queue behind short Web Locks instead of being dropped', async () => {
    const h = harness(); let occupied = false, tail = Promise.resolve();
    h.navigator.locks = { request(name, options, callback) {
        if (options.ifAvailable && occupied) return Promise.resolve(callback(null));
        const pending = tail.then(async () => { occupied = true; try { return await callback({name}); } finally { occupied = false; } });
        tail = pending.catch(() => {}); return pending;
    } };
    await h.manager.init(true, { compatibilityAudio:false }); await h.visible('hidden');
    h.advance(30000); h.document.visibilityState = 'visible';
    await h.manager.recover('locks'); await tick();
    assert.equal(h.autoChecks, 1); assert.equal(h.backupChecks, 1);
    await h.manager.setEnabled(false);
});

test('late audio errors stop reporting a running compatibility channel', async () => {
    const h = harness(); await h.manager.init(true); await tick();
    const sound = h.sounds.at(-1); sound.error = { code: 3 }; sound.dispatchEvent(new Event('error'));
    assert.equal(h.manager.getDiagnostics().audioPlaying, false);
    assert.ok(h.manager.getDiagnostics().errors.some(e => e.step === 'audio'));
    await h.manager.setEnabled(false);
});

test('disabling and pagehide close coordination channels and reenable opens a new one', async () => {
    const h = harness(), channels = [];
    h.context.BroadcastChannel = class { constructor() { this.closed = false; channels.push(this); } close() { this.closed = true; } postMessage() {} };
    await h.manager.init(true, { compatibilityAudio:false }); assert.equal(channels.length, 1);
    await h.manager.setEnabled(false); assert.equal(channels[0].closed, true);
    await h.manager.setEnabled(true); assert.equal(channels.length, 2);
    h.window.dispatchEvent(new Event('pagehide')); assert.equal(channels[1].closed, true);
    await h.manager.setEnabled(false);
});
