const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/storage_backup_worker.js'), 'utf8');
async function parse(file, keys) {
    let result;
    const self = { postMessage: value => result = value };
    vm.runInNewContext(source, { self, TextDecoder, DecompressionStream });
    await self.onmessage({ data: { file, keys } }); return result;
}
test('backup worker parses legacy/modules JSON and gzip and returns only selected categories', async () => {
    for (const raw of [true, false]) for (const compressed of [true, false]) {
        const modules = { worldBooks: [{ id: 'w', content: 'Chinese 中文' }], characters: [{ id: 'private' }], apiSettings: { key: 'secret' } };
        const body = new Blob([JSON.stringify(raw ? modules : { modules })]);
        const file = new File([compressed ? await new Response(body.stream().pipeThrough(new CompressionStream('gzip'))).blob() : body], compressed ? 'test.EE' : 'test.json');
        const result = await parse(file, ['worldBooks']);
        assert.equal(result.modules.worldBooks[0].content, 'Chinese 中文');
        assert.equal(result.modules.characters, undefined); assert.equal(result.modules.apiSettings, undefined);
    }
});
test('backup worker reports malformed roots and syntax without sending any imported data', async () => {
    for (const text of ['{bad', '[]', 'null', '{"modules": []}']) {
        const result = await parse(new File([text], 'broken.json'), ['worldBooks']);
        assert.ok(result.error); assert.equal(result.modules, undefined);
    }
});

test('incremental backup parser matches JSON semantics across every text boundary', () => {
    const c = vm.createContext({ self: {}, TextDecoder, DecompressionStream }); vm.runInContext(source, c);
    const values = { worldBooks: [{ id: 'w', content: '中文😀\\"\n\t', unknown: { nested: [true, false, null, -1.23e-6] } }], ignored: 'x'.repeat(1000) };
    const samples = [JSON.stringify(values), JSON.stringify({ version: '1900', modules: values }),
        '{"worldBooks":[],"modules":null}', '{"modules":{"worldBooks":[]},"modules":{"worldBooks":[{"id":"last"}]}}'];
    for (const text of samples) for (const size of [1, 2, 7, 61]) {
        const parser = c.createBackupParser(['worldBooks']);
        for (let i = 0; i < text.length; i += size) parser.write(text.slice(i, i + size));
        const all = JSON.parse(text), modules = all.modules ?? all;
        assert.deepEqual(JSON.parse(JSON.stringify(parser.finish())), { worldBooks: modules.worldBooks });
    }
});

test('incremental parser validates discarded data, trailing commas and prototype keys', () => {
    const c = vm.createContext({ self: {}, TextDecoder, DecompressionStream }); vm.runInContext(source, c);
    for (const text of ['{"worldBooks":[],}', '{"worldBooks":[1,]}', '{"ignored":"\\q"}', '{"ignored":01}', '{}{}', '{"modules":true}']) {
        const parser = c.createBackupParser(['worldBooks']);
        assert.throws(() => { parser.write(text); parser.finish(); }, text);
    }
    const parser = c.createBackupParser(['worldBooks']);
    parser.write('{"worldBooks":[{"__proto__":{"polluted":true}}]}');
    const result = parser.finish();
    assert.equal(Object.getPrototypeOf(result.worldBooks[0]).polluted, undefined);
    assert.equal(Object.hasOwn(result.worldBooks[0], '__proto__'), true);
});

test('incremental backup parser agrees with JSON.parse on nested deterministic fixtures', () => {
    const c = vm.createContext({ self: {}, TextDecoder, DecompressionStream }); vm.runInContext(source, c);
    let seed = 71231;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const value = depth => {
        const type = Math.floor(random() * (depth > 3 ? 4 : 6));
        if (type === 0) return null;
        if (type === 1) return random() > 0.5;
        if (type === 2) return (random() - 0.5) * 1e12;
        if (type === 3) return ['换行\n', '引号"\\', '😀中文', '', '\u0000\t\r'][Math.floor(random() * 5)];
        if (type === 4) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
        return Object.fromEntries(Array.from({ length: Math.floor(random() * 4) }, (_, index) => ['key' + index, value(depth + 1)]));
    };
    for (let i = 0; i < 300; i++) {
        const modules = { worldBooks: value(0), ignored: value(0) };
        const text = JSON.stringify(i % 2 ? { modules } : modules), parser = c.createBackupParser(['worldBooks']);
        for (let offset = 0; offset < text.length;) { const size = 1 + Math.floor(random() * 11); parser.write(text.slice(offset, offset + size)); offset += size; }
        assert.deepEqual(JSON.parse(JSON.stringify(parser.finish())), { worldBooks: modules.worldBooks });
    }
});
