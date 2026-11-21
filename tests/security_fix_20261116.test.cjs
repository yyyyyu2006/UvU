const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { Worker: Thread } = require('node:worker_threads');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function runtime(options = {}) {
    let workers = 0;
    const workerSource = read('js/workers/status_regex_worker.js');
    class BrowserWorker {
        constructor() {
            workers++;
            this.queue = [];
            this.loading = setTimeout(() => {
            if (options.failFirstStartup && workers === 1) { this.onerror?.({}); return; }
            this.thread = new Thread(`const {parentPort}=require('node:worker_threads');
                global.self={postMessage:value=>parentPort.postMessage(value)};
                ${workerSource}
                parentPort.on('message',data=>self.onmessage({data}));`, {eval: true});
            this.thread.on('message', data => this.onmessage?.({data}));
            this.thread.on('error', error => this.onerror?.(error));
            for (const value of this.queue) this.thread.postMessage(value);
            this.queue = [];
            }, options.startupDelay || 0);
        }
        postMessage(value) { if (this.thread) this.thread.postMessage(value); else this.queue.push(value); }
        terminate() { clearTimeout(this.loading); return this.thread?.terminate(); }
    }
    const chat = {id: 'c', activeArchiveId: 'a', history: [], memoryJournals: [], maxMemory: ''};
    const toasts = [];
    const c = vm.createContext({window: {}, Worker: BrowserWorker, URL, AbortController, setTimeout, clearTimeout, console,
        document: {baseURI: 'https://app.test/sub/', addEventListener() {}}, db: {characters: [chat], groups: [], worldBooks: []},
        showToast: text => toasts.push(text), saveData: async () => {}});
    const utils = read('js/utils.js');
    vm.runInContext(utils.slice(0, utils.indexOf('// Toast 通知系统')) + utils.slice(utils.indexOf('// 触感反馈工具')), c);
    return {c, chat, toasts, workers: () => workers};
}

test('destination keys stay bound to provider and full tenant base, with explicit-key override', () => {
    const {c} = runtime(), resolve = c.resolveDestinationKey;
    for (const destination of ['https://evil.test/v1', 'https://api.test/other/v1', 'http://api.test/team/v1',
        'https://api.test/team/v1?tenant=other', 'https://user@api.test/team/v1']) {
        assert.equal(resolve(destination, '', 'https://api.test/team/v1', 'SECRET', 'newapi', 'newapi'), '');
    }
    assert.equal(resolve('https://API.test:443/team/v1/', '', 'https://api.test/team/v1', 'SECRET', 'newapi', 'newapi'), 'SECRET');
    assert.equal(resolve('', '', 'https://api.test/team/v1', 'SECRET', 'gemini', 'newapi'), '');
    assert.equal(resolve('https://evil.test', 'EXPLICIT', 'https://api.test', 'SECRET', 'newapi', 'newapi'), 'EXPLICIT');
    assert.equal(resolve('https://api.test/v1/rerank', '', 'https://api.test/v1/embeddings', 'SECRET', 'newapi', 'newapi', true), 'SECRET');
});

test('display encoding and URL parsing preserve ordinary names, local images, blobs and data images', () => {
    const {c} = runtime();
    assert.equal(c.escapeDisplayHtml('<img src=x onerror="run()"> & 中文'), '&lt;img src=x onerror=&quot;run()&quot;&gt; &amp; 中文');
    for (const value of ['../avatars/a.png', '/a.svg', 'blob:https://app.test/id', 'data:image/png;base64,AA==', 'https://image.test/p.png']) assert.equal(c.safeDisplayImageUrl(value), value);
    for (const value of ['javascript:alert(1)', 'data:text/html,<script>bad()</script>', 'file:///a.png']) assert.equal(c.safeDisplayImageUrl(value), '');
});

test('bounded status worker retains captures and history semantics after thinking and bilingual formatting', async () => {
    const f = runtime(), {c, chat} = f;
    chat.bilingualModeEnabled = true;
    chat.statusPanel = {enabled: true, regexPattern: '/<status>(.*?)<\/status>/i', historyLimit: 0};
    chat.history = [{role: 'assistant', content: '<thinking>secret</thinking>Hello (你好)<status>busy</status>',
        parts: [{type: 'text', text: 'Hello<status>busy</status>'}]}];
    const before = plain(chat.history);
    await c.prepareStatusRegexHistory(chat, chat.history);
    const filtered = c.filterHistoryForAI(chat, chat.history);
    assert.equal(filtered[0].content, 'Hello (你好)');
    assert.equal(filtered[0].parts[0].text, 'Hello');
    await c.prepareStatusRegexJobs([{source: '<status>(.*?)</status>', flags: 's', text: 'A<status>中文\nline</status>B'}]);
    assert.equal(c.createStatusRegex('<status>(.*?)</status>', 's').exec('A<status>中文\nline</status>B')[1], '中文\nline');
    assert.deepEqual(plain(chat.history), before);
    assert.ok(f.workers() > 0);
});

test('catastrophic status expressions time out without blocking the caller or losing original text', async () => {
    const f = runtime(), text = 'a'.repeat(30000) + '!';
    let ticked = false;
    const timer = setTimeout(() => { ticked = true; }, 10), start = Date.now();
    await f.c.prepareStatusRegexJobs([{source: '(a+)+$', flags: '', text}]);
    clearTimeout(timer);
    assert.ok(ticked); assert.ok(Date.now() - start < 5000);
    assert.equal(text.replace(f.c.createStatusRegex('(a+)+$', ''), ''), text);
    assert.equal(f.toasts.length, 1);
});

test('status worker loading time does not consume the regex execution budget', async () => {
    const f = runtime({startupDelay: 400}), text = 'hello<status>busy</status>';
    await f.c.prepareStatusRegexJobs([{source: '<status>(.*?)</status>', flags: 's', text}]);
    assert.equal(f.c.createStatusRegex('<status>(.*?)</status>', 's').exec(text)?.[1], 'busy');
    assert.deepEqual(f.toasts, []);
});

test('a transient worker startup failure can recover on the next preparation', async () => {
    const f = runtime({failFirstStartup: true}), text = 'hello<status>busy</status>';
    const job = {source: '<status>(.*?)</status>', flags: 's', text};
    await f.c.prepareStatusRegexJobs([job]);
    assert.equal(text.replace(f.c.createStatusRegex(job.source, job.flags), ''), text);
    await f.c.prepareStatusRegexJobs([job]);
    assert.equal(f.workers(), 2);
    assert.equal(f.c.createStatusRegex(job.source, job.flags).exec(text)?.[1], 'busy');
});

test('status worker cancellation terminates pending work; disabled panels start no workers', async () => {
    const f = runtime();
    await f.c.prepareStatusRegexHistory({statusPanel: {enabled: false, regexPattern: '(a+)+$'}}, [{role: 'assistant', content: 'a'.repeat(30000) + '!'}]);
    assert.equal(f.workers(), 0);
    const controller = new AbortController();
    const pending = f.c.prepareStatusRegexJobs([{source: '(a+)+$', flags: '', text: 'a'.repeat(30000) + '!'}], controller.signal);
    controller.abort();
    await assert.rejects(pending, {name: 'AbortError'});
});

test('reader enforces count, matching IDs, nonempty anchors and duplicate rejection before generation', () => {
    const {c} = runtime(); vm.runInContext(read('js/modules/reader_view.js'), c);
    const block = (id, quote, prompt = 'tags', close = id) => `<image${id}><原文段落>${quote}</原文段落><image>${prompt}</image></image${close}>`;
    const text = block('000', '') + block('001', 'A') + block('001', 'B') + block('002', 'A') + block('003', 'C', '', '003') +
        block('004', 'D', 'tags', '005') + block('006', 'E') + block('007', 'F') + block('008', 'G');
    assert.deepEqual(plain(c.parseReaderIllustrations(text, 3)).map(b => b.quote), ['A', 'E', 'F']);
    assert.equal(c.parseReaderIllustrations(text, 1).length, 1);
    for (const count of [0, 2, 100, NaN]) assert.throws(() => c.parseReaderIllustrations(text, count), /数量/);
});

test('empty history limit preserves the 1900 full window while explicit zero remains zero', () => {
    const {c, chat} = runtime(); vm.runInContext(read('js/modules/auto_memory.js'), c);
    chat.history = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    for (const limit of ['', undefined, null]) assert.equal(c.getAutoMemoryContextHistory(chat, limit).length, 3);
    for (const limit of [0, '0']) assert.equal(c.getAutoMemoryContextHistory(chat, limit).length, 0);
    assert.deepEqual(plain(c.getAutoMemoryContextHistory(chat, 2)).map(m => m.id), ['b', 'c']);
});

test('worldbook failed creation rolls back only its record and leaves concurrent additions intact', async () => {
    const {c} = runtime(); vm.runInContext(read('js/modules/worldbook.js'), c);
    const first = {id: 'saved'}, failed = {id: 'failed'}, arrival = {id: 'arrival'};
    c.db.worldBooks = [first];
    c.saveData = async () => { c.db.worldBooks.push(arrival); throw Error('quota'); };
    assert.equal(await c.saveWorldBookAddition(failed), false);
    assert.deepEqual(plain(c.db.worldBooks), [first, arrival]);
});

test('call reply and summary consumers bind inherited keys to the selected destination', async () => {
    for (const entry of ['getCallReply', 'generateCallSummary']) for (const mode of ['foreign-empty', 'same-empty', 'foreign-explicit']) {
        const {c, chat} = runtime(), requests = [];
        c.db.apiSettings = {url: 'https://api.test/v1', key: 'GLOBAL', model: 'fixture', provider: 'newapi', streamEnabled: false};
        c.db.apiPresets = [{name: 'exclusive', data: {apiUrl: mode === 'same-empty' ? 'https://api.test/v1/' : 'https://other.test/v1', apiKey: mode === 'foreign-explicit' ? 'OWN' : ''}}];
        Object.assign(chat, {realName: 'Fixture', myName: 'Me', exclusiveApiEnabled: true, exclusiveApiPreset: 'exclusive', history: [], worldBookIds: []});
        c.resolveAuxiliaryApiConfig = (_kind, config) => config;
        vm.runInContext(read('js/modules/auto_memory.js'), c);
        c.pad = value => String(value).padStart(2, '0');
        c.fetch = async (url, init) => { requests.push({url, key: init.headers.Authorization}); return {ok: true, json: async () => ({choices: [{message: {content: 'reply'}}]})}; };
        vm.runInContext(read('js/modules/chat_ai_call.js'), c);
        if (entry === 'getCallReply') await c.getCallReply(chat, 'voice', [], () => {});
        else await c.generateCallSummary(chat, []);
        assert.equal(requests.length, mode === 'foreign-empty' ? 0 : 1, entry + '/' + mode);
        if (requests.length) assert.equal(requests[0].key, mode === 'same-empty' ? 'Bearer GLOBAL' : 'Bearer OWN');
    }
});

test('native and chat rerank consumers block foreign inherited keys and preserve legitimate requests', async () => {
    for (const mode of ['native', 'chat']) for (const destination of ['foreign-empty', 'same-empty', 'foreign-explicit']) {
        const {c} = runtime(), requests = [];
        vm.runInContext(read('js/modules/auto_memory.js'), c);
        const candidates = [{journal: {title: 'A', content: 'A'}}, {journal: {title: 'B', content: 'B'}}];
        const config = {provider: 'newapi', url: 'https://api.test/v1/embeddings', key: 'GLOBAL', model: 'fixture', rerankMode: mode,
            rerankUrl: destination === 'same-empty' ? 'https://api.test/v1/rerank' : 'https://other.test/v1', rerankKey: destination === 'foreign-explicit' ? 'OWN' : ''};
        c.requestVectorJson = async (url, body, config, signal, label, headers) => { requests.push(headers.Authorization); return {results: [{index: 1, relevance_score: 1}, {index: 0, relevance_score: 0}]}; };
        c.fetchAiResponse = async (api, body, headers) => { requests.push(headers.Authorization); return '2,1'; };
        if (destination === 'foreign-empty') await assert.rejects(c.rerankMemoryCandidates('q', candidates, config), /密钥/);
        else {
            const result = await c.rerankMemoryCandidates('q', candidates, config);
            assert.equal(result[0].journal.title, 'B');
            assert.deepEqual(requests, [destination === 'same-empty' ? 'Bearer GLOBAL' : 'Bearer OWN']);
        }
        if (destination === 'foreign-empty') assert.equal(requests.length, 0);
    }
});

test('call status preparation preserves cancellation and archive ownership before sending', async () => {
    for (const mode of ['abort', 'archive', 'history']) {
        const {c, chat} = runtime();
        const controller = new AbortController();
        let preparations = 0, requests = 0;
        Object.assign(chat, {realName: 'Fixture', myName: 'Me', worldBookIds: [],
            statusPanel: {enabled: true, regexPattern: '<status>(.*?)</status>'}});
        c.db.apiSettings = {url: 'https://api.test', key: 'FIXTURE', model: 'fixture', provider: 'newapi'};
        c.resolveAuxiliaryApiConfig = (_kind, config) => config;
        c.pad = value => String(value).padStart(2, '0');
        vm.runInContext(read('js/modules/auto_memory.js'), c);
        c.prepareStatusRegexHistory = async (_chat, _history, signal) => {
            assert.equal(signal, controller.signal);
            if (++preparations !== 2) return;
            if (mode === 'abort') controller.abort();
            if (mode === 'archive') chat.activeArchiveId = 'changed';
            if (mode === 'history') chat.history = [];
        };
        c.fetch = async () => { requests++; throw Error('stale request sent'); };
        vm.runInContext(read('js/modules/chat_ai_call.js'), c);
        assert.equal(await c.getCallReply(chat, 'voice', [], () => {}, controller.signal), null);
        assert.equal(preparations, 2);
        assert.equal(requests, 0);
    }
});
