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
