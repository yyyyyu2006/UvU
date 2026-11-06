const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/text_editor.js'), 'utf8');
function editor() {
    const tasks = new Map(); let id = 0;
    const c = vm.createContext({ AbortController, DOMException, setTimeout(fn) { tasks.set(++id, fn); return id; }, clearTimeout(key) { tasks.delete(key); } });
    vm.runInContext(source, c);
    return { c, tasks, tick() { const [key, fn] = tasks.entries().next().value; tasks.delete(key); fn(); } };
}
const plain = value => JSON.parse(JSON.stringify(value));
test('long editor search yields before finishing and cancellation discards partial results', async () => {
    const f = editor(), controller = new AbortController();
    assert.equal(typeof f.c.findEditorMatchesAsync, 'function', 'long text needs a cooperative search helper');
    const pending = f.c.findEditorMatchesAsync('a'.repeat(200000), 'a', false, controller.signal);
    let completed = false; pending.then(() => { completed = true; }, () => {});
    await Promise.resolve(); assert.equal(completed, false, 'search must yield to input/close events');
    assert.ok(f.tasks.size); f.tick();
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(f.tasks.size, 0, 'cancel also removes the scheduled continuation');
});
test('cooperative search preserves Unicode folds, literal punctuation, non-overlap and window boundary matches', async () => {
    const f = editor();
    assert.equal(typeof f.c.findEditorMatchesAsync, 'function', 'long text needs a cooperative search helper');
    for (const [text, query, sensitive, expected] of [
        ['x'.repeat(32767) + '😀Kſ' + 'x'.repeat(33000) + '😀kS', '😀kS', false, [{start:32767,end:32771},{start:65771,end:65775}]],
        ['x'.repeat(32767) + 'a.b aXb a.b', 'a.b', true, [{start:32767,end:32770},{start:32775,end:32778}]],
        ['x'.repeat(32767) + 'aaaaa', 'aa', false, [{start:32767,end:32769},{start:32769,end:32771}]],
        ['x'.repeat(32767) + '😀\ud83d', '\ud83d', false, [{start:32769,end:32770}]],
        ['x'.repeat(32767) + 'KkK', 'k', true, [{start:32768,end:32769}]],
        ['x'.repeat(70000), '', false, []]
    ]) {
        const pending = f.c.findEditorMatchesAsync(text, query, sensitive);
        while (f.tasks.size) f.tick();
        assert.deepEqual(plain(await pending), expected);
    }
});
test('dense matches complete across continuation and window boundaries without gaps', async () => {
    const f = editor(), pending = f.c.findEditorMatchesAsync('a'.repeat(70000), 'aa');
    let ticks = 0;
    while (f.tasks.size) { f.tick(); ticks++; }
    const matches = plain(await pending);
    assert.ok(ticks > 2, 'dense scans yield several times before completing');
    assert.equal(matches.length, 35000);
    assert.deepEqual(matches[0], { start: 0, end: 2 });
    assert.deepEqual(matches[16383], { start: 32766, end: 32768 });
    assert.deepEqual(matches[16384], { start: 32768, end: 32770 });
    assert.deepEqual(matches[34999], { start: 69998, end: 70000 });
    assert.equal(f.c.replaceEditorMatches('a'.repeat(70000), matches, '$&'), '$&'.repeat(35000));
});
test('already cancelled search never schedules work or exposes matches', async () => {
    const f = editor(), controller = new AbortController(); controller.abort();
    await assert.rejects(f.c.findEditorMatchesAsync('a'.repeat(70000), 'a', false, controller.signal), { name: 'AbortError' });
    assert.equal(f.tasks.size, 0);
});
