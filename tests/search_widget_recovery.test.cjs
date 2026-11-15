'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../js/modules', name), 'utf8');
function fixture() {
    const c = vm.createContext({ document: { addEventListener() {} }, window: {}, console,
        escapeMessageRegex: value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') });
    vm.runInContext(source('search.js') + '\nglobalThis.search = SearchSystem;', c);
    vm.runInContext(source('widget_market.js'), c);
    return c;
}
for (const keyword of ['[', ']', '(', ')', '.', '*', '+', '?', '^', '$', '{', '}', '|', '\\', '[a-z]+', '.*']) {
    test('search highlights a literal special keyword: ' + keyword, () => {
        const c = fixture(), text = 'prefix ' + keyword + ' suffix';
        assert.equal(c.search.highlightKeyword(text, keyword), 'prefix <span class="keyword-highlight">' + keyword + '</span> suffix');
    });
}
test('search preserves HTML entities and escapes raw matched text', () => {
    const c = fixture();
    assert.equal(c.search.highlightKeyword('Tom & Jerry', 'amp'), 'Tom &amp; Jerry');
    assert.equal(c.search.highlightKeyword('<b>A&B</b>', '&'), '&lt;b&gt;A<span class="keyword-highlight">&amp;</span>B&lt;/b&gt;');
    assert.equal(c.search.highlightKeyword('<b>A&B</b>', '<b>'), '<span class="keyword-highlight">&lt;b&gt;</span>A&amp;B&lt;/b&gt;');
    assert.equal(c.search.highlightKeyword('ABC abc AbC', 'abc'), '<span class="keyword-highlight">ABC</span> <span class="keyword-highlight">abc</span> <span class="keyword-highlight">AbC</span>');
    assert.equal(c.search.highlightKeyword('中文 & <', ''), '中文 &amp; &lt;');
    assert.equal(c.search.highlightKeyword(null, '['), '');
});
const widget = () => ({ id: 'one', name: 'Fixture', size: '2x2', html: '<div>{{text}}</div>', css: '', js: '', defaultVars: { text: 'original' } });
test('widget import accepts a single item or exported array without changing its code or metadata', () => {
    const c = fixture(), first = { ...widget(), author: 'fixture' }, second = { ...widget(), id: 'two' };
    const result = c.normalizeWidgetImport([first, second]);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), [first, second]);
    assert.notEqual(result[0], first);
    assert.equal(c.normalizeWidgetImport(first).length, 1);
});
test('widget import supplies missing legacy script and variables', () => {
    const c = fixture(), old = widget(); delete old.js; delete old.defaultVars; delete old.size;
    const result = c.normalizeWidgetImport(old)[0];
    assert.equal(result.js, ''); assert.deepEqual(JSON.parse(JSON.stringify(result.defaultVars)), {});
    assert.equal(result.size, '2x2'); assert.equal(old.js, undefined);
});

test('widget import keeps valid legacy row and column sizes unchanged', () => {
    const c = fixture();
    for (const size of ['1x4', '4x2', '6x4']) {
        const input = { ...widget(), size };
        assert.equal(c.normalizeWidgetImport(input)[0].size, size);
        assert.equal(input.size, size);
    }
});
test('widget import validates the entire batch including duplicate IDs before accepting it', () => {
    const c = fixture();
    for (const input of [null, [], {}, [widget(), null], [widget(), widget()],
        { ...widget(), id: 1 }, { ...widget(), id: '  ' }, { ...widget(), name: {} },
        { ...widget(), html: [] }, { ...widget(), css: {} }, { ...widget(), js: [] },
        { ...widget(), defaultVars: [] }, { ...widget(), defaultVars: null },
        { ...widget(), size: 2 }, ...['0x1','1x7','7x1','1x5','-1x1','1x0','2xInfinity','7x7'].map(size => ({ ...widget(), size }))]) assert.throws(() => c.normalizeWidgetImport(input), /小组件|重复/);
});
