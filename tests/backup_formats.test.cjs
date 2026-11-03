const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
    const blobs = [], downloads = [], toasts = [], imports = [];
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: id === 'storage-export-format' ? 'ee' : '', classList: { add() {}, remove() {} } });
        return elements.get(id);
    };
    const c = vm.createContext({ console: { warn() {}, error() {} }, window: {}, structuredClone, Blob, File, Response,
        CompressionStream, DecompressionStream, setTimeout() {}, showToast: text => toasts.push(text),
        document: { addEventListener() {}, getElementById: element, body: { appendChild() {} },
            createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }) },
        URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} } });
    for (const file of ['db.js', 'modules/storage.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), c);
    c.db.characters = [{ id: 'c', persona: 'original persona', history: [{ id: 'm', content: 'private history' }] }];
    c.storageCommitImport = async (selection, modules) => imports.push({ selection, modules });
    vm.runInContext('Object.keys(selectedModules).forEach(key => selectedModules[key] = key === "contacts"); Object.keys(selectedImportModules).forEach(key => selectedImportModules[key] = key === "worldbooks");', c);
    return { c, blobs, downloads, toasts, imports, element };
}

test('JSON export needs no compression API and contains only selected categories', async () => {
    const f = fixture(); f.element('storage-export-format').value = 'json';
    f.c.CompressionStream = undefined;
    await f.c.handleExport();
    assert.match(f.downloads[0], /[.]json$/);
    const data = JSON.parse(await f.blobs[0].text());
    assert.equal(data.modules.characters[0].persona, 'original persona');
    assert.equal(data.modules.characters[0].history, undefined);
    assert.equal(data.modules.cotPresets, undefined);
    assert.equal(data.modules.apiSettings, undefined);
});

test('EE export remains gzip JSON; unsupported compression falls back to JSON', async () => {
    const f = fixture(); await f.c.handleExport();
    assert.match(f.downloads[0], /[.]ee$/);
    const json = await new Response(f.blobs[0].stream().pipeThrough(new DecompressionStream('gzip'))).json();
    assert.equal(json.modules.characters[0].persona, 'original persona');
    const legacy = fixture(); legacy.c.CompressionStream = undefined;
    await legacy.c.handleExport();
    assert.match(legacy.downloads[0], /[.]json$/);
    assert.equal(JSON.parse(await legacy.blobs[0].text()).modules.characters[0].id, 'c');
});

test('old raw JSON, modules JSON and uppercase EE import using independent import selection', async () => {
    const modules = { worldBooks: [{ id: 'w', content: 'world text' }] };
    for (const kind of ['raw', 'json', 'ee']) {
        const f = fixture();
        const data = new Blob([JSON.stringify(kind === 'raw' ? modules : { version: 'old', modules })]);
        const body = kind === 'ee' ? await new Response(data.stream().pipeThrough(new CompressionStream('gzip'))).blob() : data;
        const file = new File([body], kind === 'ee' ? 'old.EE' : 'old.json');
        await f.c.handleImport({ target: { files: [file], value: 'selected' } });
        assert.equal(f.imports.length, 1);
        assert.equal(f.imports[0].modules.worldBooks[0].content, 'world text');
        assert.equal(f.imports[0].selection.worldbooks, true);
        assert.equal(f.imports[0].selection.contacts, false);
    }
});

test('unsupported EE decompression explains the JSON alternative without changing data', async () => {
    const f = fixture(); f.c.DecompressionStream = undefined;
    const input = { files: [new File(['gzip'], 'backup.ee')], value: 'selected' };
    await f.c.handleImport({ target: input });
    assert.equal(f.imports.length, 0);
    assert.match(f.toasts.at(-1), /不支持解压.*json/);
    assert.equal(input.value, '');
    assert.equal(f.c.db.characters[0].persona, 'original persona');
});
