const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/global_css_io.js'), 'utf8');

function fixture({ failSave = false } = {}) {
    const handlers = new Map(), downloads = [], toasts = [], applied = [];
    const button = id => ({ id, attributes: {}, addEventListener(type, handler) { handlers.set(id + ':' + type, handler); }, setAttribute(name, value) { this.attributes[name] = String(value); }, click() { return handlers.get(id + ':click')?.({ target: this }); } });
    const textarea = { value: '.old { color: red; }' };
    const input = { files: [], value: '', clicks: 0, addEventListener(type, handler) { handlers.set('input:' + type, handler); }, click() { this.clicks++; } };
    const nodes = Object.fromEntries(['global-css-document-import', 'global-css-document-export', 'global-css-document-export-txt', 'global-css-document-export-docx'].map(id => [id, button(id)]));
    const exportMenu = { hidden: true };
    const modal = { dataset: {}, querySelector(selector) { return ({ '#global-beautification-css': textarea, '#global-css-document-input': input,
        '#global-css-document-import': nodes['global-css-document-import'], '#global-css-document-export-txt': nodes['global-css-document-export-txt'],
        '#global-css-document-export-docx': nodes['global-css-document-export-docx'], '#global-css-document-export': nodes['global-css-document-export'], '#global-css-export-menu': exportMenu })[selector]; } };
    let observer;
    class MutationObserver { constructor(callback) { observer = callback; } observe() {} }
    const context = vm.createContext({ Blob, TextEncoder, DataView, Uint8Array, MutationObserver, console: { error() {} },
        document: { body: { appendChild(link) { downloads.push(link); }, }, getElementById: id => id === 'global-css-modal' ? modal : null,
            createElement: tag => tag === 'a' ? { click() { this.clicked = true; }, remove() { this.removed = true; } } : null },
        URL: { createObjectURL(blob) { const url = 'blob:test:' + downloads.length; downloads.push({ blob, url }); return url; }, revokeObjectURL() {} },
        setTimeout() {},
        window: {}, db: { globalCss: '.old { color: red; }' }, applyGlobalCss: css => applied.push(css),
        saveData: async () => { if (failSave) throw new Error('disk full'); },
        readImportDocument: async file => ({ text: file.text }), confirm: () => true,
        showToast: text => toasts.push(text) });
    vm.runInContext(source, context);
    observer();
    return { context, modal, textarea, input, nodes, downloads, toasts, applied, handlers };
}

function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder();
    let end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    assert.ok(end >= 0, 'DOCX must have ZIP end record');
    let cursor = view.getUint32(end + 16, true), entries = {};
    const count = view.getUint16(end + 10, true);
    for (let i = 0; i < count; i++) {
        assert.equal(view.getUint32(cursor, true), 0x02014b50);
        const nameSize = view.getUint16(cursor + 28, true), extraSize = view.getUint16(cursor + 30, true), commentSize = view.getUint16(cursor + 32, true);
        const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
        const localOffset = view.getUint32(cursor + 42, true), localNameSize = view.getUint16(localOffset + 26, true), localExtraSize = view.getUint16(localOffset + 28, true);
        const contentStart = localOffset + 30 + localNameSize + localExtraSize, contentSize = view.getUint32(localOffset + 22, true);
        entries[name] = decoder.decode(bytes.subarray(contentStart, contentStart + contentSize));
        cursor += 46 + nameSize + extraSize + commentSize;
    }
    return entries;
}

test('global CSS DOCX export creates a valid stored Open XML ZIP and escapes CSS text', async () => {
    const f = fixture(), blob = f.context.window.GlobalCssIO.createDocx('/* 测试 */\n.x::after { content: "<&"; }');
    assert.match(blob.type, /wordprocessingml\.document/);
    const entries = zipEntries(new Uint8Array(await blob.arrayBuffer()));
    assert.ok(entries['[Content_Types].xml'].includes('wordprocessingml.document.main+xml'));
    assert.ok(entries['_rels/.rels'].includes('word/document.xml'));
    assert.ok(entries['word/document.xml'].includes('/* 测试 */'));
    assert.ok(entries['word/document.xml'].includes('&lt;&amp;'));
    assert.ok(entries['word/document.xml'].includes('<w:p>'));
});

test('global CSS document controls export current text and import TXT or DOCX directly into persisted style', async () => {
    const f = fixture(); f.context.window.GlobalCssIO.setup();
    f.nodes['global-css-document-export'].click();
    assert.equal(f.nodes['global-css-document-export'].attributes['aria-expanded'], 'true');
    assert.equal(f.modal.querySelector('#global-css-export-menu').hidden, false);
    assert.equal(f.handlers.has('global-css-document-export:click'), true);
    f.textarea.value = '.current { color: green; }';
    f.nodes['global-css-document-export-txt'].click();
    assert.equal(f.downloads[0].blob.type, 'text/plain;charset=utf-8');
    assert.equal(await f.downloads[0].blob.text(), f.textarea.value);
    f.nodes['global-css-document-export-docx'].click();
    assert.match(f.downloads[2].blob.type, /wordprocessingml\.document/);
    f.nodes['global-css-document-import'].click(); assert.equal(f.input.clicks, 1);
    f.input.files = [{ name: 'style.txt', text: '.imported { color: blue; }' }];
    await f.handlers.get('input:change')();
    assert.equal(f.context.db.globalCss, '.imported { color: blue; }');
    assert.equal(f.textarea.value, f.context.db.globalCss);
    assert.equal(f.applied.at(-1), f.context.db.globalCss);
    assert.match(f.toasts.at(-1), /已导入并保存/);
});

test('failed CSS import persistence restores the prior active style and editor contents', async () => {
    const f = fixture({ failSave: true }); f.context.window.GlobalCssIO.setup();
    f.input.files = [{ name: 'style.docx', text: '.broken { color: blue; }' }];
    await f.handlers.get('input:change')();
    assert.equal(f.context.db.globalCss, '.old { color: red; }');
    assert.equal(f.textarea.value, '.old { color: red; }');
    assert.equal(f.applied.at(-1), '.old { color: red; }');
    assert.match(f.toasts.at(-1), /disk full/);
});
