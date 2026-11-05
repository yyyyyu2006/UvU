const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker: ThreadWorker } = require('node:worker_threads');
const root = path.join(__dirname, '..');

// Run the browser worker source in a real isolated thread; no regex is mocked.
class BrowserWorker {
    constructor(url) {
        const source = fs.readFileSync(path.join(root, url.split('?')[0]), 'utf8');
        this.thread = new ThreadWorker(`const { parentPort } = require('node:worker_threads');
            global.self = { postMessage: data => parentPort.postMessage(data) };
            ${source}
            parentPort.on('message', data => self.onmessage({ data }));`, { eval: true });
        this.thread.on('message', data => this.onmessage?.({ data }));
        this.thread.on('error', error => this.onerror?.(error));
    }
    postMessage(data) { this.thread.postMessage(data); }
    terminate() { this.thread.terminate(); }
}
function fixture(books, worker = BrowserWorker) {
    const warnings = [];
    const c = vm.createContext({ db: { worldBooks: books }, Worker: worker,
        setTimeout, clearTimeout, AbortController, console: { warn() {} },
        showToast: message => warnings.push(message) });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/worldbook_rules.js'), 'utf8'), c);
    const chat = { worldBookIds: books.map(book => book.id), history: [] };
    return { c, chat, warnings };
}
function entry(id, keys, extra = {}) {
    return { id, content: id, depth: 100, rules: { advancedEnabled: true, constant: false, keys, ...extra } };
}
const ids = plan => Array.from(plan, book => book.id);

test('legacy synchronous regex cannot block the calling thread', () => {
    const { c } = fixture([]);
    assert.equal(vm.runInContext("worldBookMatches('/(a+)+$/', 'a'.repeat(28) + '!', {})", c, { timeout: 150 }), false);
    assert.equal(c.worldBookMatches('/HELLO/i', 'hello', {}), true);
});

test('async regex uses the full scanned message and rolls probability once in plan order', async () => {
    const f = fixture([
        entry('later', ['/never/'], { constant: true, probability: 50, order: 30 }),
        entry('match', ['/(?<=needle)\\d+/'], { secondaryKeys: ['/answer\\s+yes/i'], probability: 50, order: 20 }),
        { id: 'legacy', content: 'legacy', depth: 1 },
        entry('disabled', ['/(a+)+$/'], { enabled: false })
    ]);
    f.chat.history = [{ content: 'x'.repeat(80000) + ' needle42 ANSWER yes' }];
    let rolls = 0;
    const plan = await f.c.buildWorldBookPlanAsync(f.chat, f.chat.history, () => { rolls++; return 0.1; });
    assert.deepEqual(ids(plan), ['legacy', 'match', 'later']);
    assert.equal(rolls, 2);
    assert.deepEqual(f.warnings, []);
});

test('pathological regex times out without suppressing static books or activating negative secondary rules', async () => {
    const f = fixture([
        { id: 'legacy', content: 'legacy' },
        entry('hang', ['/(a+)+$/']),
        entry('negative', ['a'], { secondaryKeys: ['/(a+)+$/'], selectiveLogic: 2 })
    ]);
    f.chat.history = [{ content: 'a'.repeat(30) + '!' }];
    const started = Date.now();
    const plan = await f.c.buildWorldBookPlanAsync(f.chat);
    assert.ok(Date.now() - started < 1500, 'regex worker must be terminated within the request budget');
    assert.deepEqual(ids(plan), ['legacy']);
    assert.equal(f.warnings.length, 1);
});

test('abort terminates an in-flight regex evaluation before probability selection', async () => {
    const f = fixture([entry('hang', ['/(a+)+$/']), entry('static', [], { constant: true, probability: 50 })]);
    f.chat.history = [{ content: 'a'.repeat(30) + '!' }];
    const controller = new AbortController();
    let rolls = 0;
    const pending = f.c.buildWorldBookPlanAsync(f.chat, f.chat.history, () => { rolls++; return 0; }, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(rolls, 0);
    assert.deepEqual(f.warnings, []);
});

test('completed regex results survive a later timeout and all negative selective modes reject unknown results', async () => {
    const f = fixture([
        entry('finished', ['/a+/']),
        entry('hang', ['/(a+)+$/']),
        entry('negative-all', ['a'], { secondaryKeys: ['/(a+)+$/'], selectiveLogic: 1 }),
        entry('negative-any', ['a'], { secondaryKeys: ['/(a+)+$/'], selectiveLogic: 2 })
    ]);
    f.chat.history = [{ content: 'a'.repeat(30) + '!' }];
    const plan = await f.c.buildWorldBookPlanAsync(f.chat);
    assert.deepEqual(ids(plan), ['finished']);
    assert.equal(f.warnings.length, 1);
    assert.equal(plan.regexWarnings.length, 1);
    assert.ok(!JSON.stringify(plan).includes('regexWarnings'));
});

test('plain and safe regex keywords work without Worker, while unsupported regex is visible and skipped', async () => {
    const f = fixture([
        entry('literal', ['hello']), entry('simple', ['/HELLO/i']),
        entry('complex', ['/(?<=h)ello/'])
    ], undefined);
    f.c.Worker = undefined;
    f.chat.history = [{ content: 'hello' }];
    assert.deepEqual(ids(await f.c.buildWorldBookPlanAsync(f.chat)), ['literal', 'simple']);
    assert.equal(f.warnings.length, 1);
    f.chat.worldBookIds = ['literal', 'simple'];
    await f.c.buildWorldBookPlanAsync(f.chat);
    assert.equal(f.warnings.length, 1);
});

test('an already aborted plan rejects even without regex jobs', async () => {
    const f = fixture([{ id: 'legacy' }]);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.c.buildWorldBookPlanAsync(f.chat, [], Math.random, controller.signal), { name: 'AbortError' });
});

test('plain keywords and inactive complex triggers never create a worker', async () => {
    class UnavailableWorker { constructor() { throw new Error('Worker must not be used'); } }
    const f = fixture([
        entry('plain', ['literal']), entry('constant', ['/(a+)+$/'], { constant: true }),
        entry('disabled', ['/(a+)+$/'], { enabled: false }),
        entry('dormant', ['/(a+)+$/'], { advancedEnabled: false }),
        entry('simple', ['/l[i]teral/'])
    ], UnavailableWorker);
    f.chat.history = [{ content: 'literal' }];
    assert.deepEqual(ids(await f.c.buildWorldBookPlanAsync(f.chat)), ['plain', 'constant', 'dormant', 'simple']);
    assert.deepEqual(f.warnings, []);
});
