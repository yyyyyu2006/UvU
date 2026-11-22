const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../../js/modules/music_core.js');
const plain=v=>JSON.parse(JSON.stringify(v));
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

module.exports={harness,plain};
