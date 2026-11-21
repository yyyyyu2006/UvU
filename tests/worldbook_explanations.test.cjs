const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture() { const c = vm.createContext({ db: { worldBooks: [] }, crypto: require('node:crypto').webcrypto });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/worldbook_rules.js'), 'utf8'), c); return c; }
test('worldbook import distinguishes supported fields from preserved but unexecuted lifecycle and recursion rules', () => {
    const c = fixture(); const entry = { content: '说明', keys: ['星河'], extensions: { sticky: 3, cooldown: 2, delay: 1, excludeRecursion: true, ignoreBudget: true } };
    const result = c.importWorldBookJson({ entries: [entry] }, null), book = result.books[0];
    assert.deepEqual(Array.from(book.importCompatibility.preservedOnly), ['sticky', 'cooldown', 'delay', 'excludeRecursion', 'ignoreBudget']);
    assert.match(result.warnings.join('\n'), /仅保留.*未执行/);
    assert.equal(book.importSource, entry); assert.equal(book.rules.advancedEnabled, false);
});
test('removed activation engine cannot read history, roll probability or create regex workers', () => {
    const c = fixture();
    for (const name of ['buildWorldBookPlan', 'buildWorldBookPlanAsync', 'worldBookMatches', 'worldBookSection', 'getWorldBookPlanDiagnostics', 'insertDepthWorldBooks']) assert.equal(typeof c[name], 'undefined', name);
    assert.equal(fs.existsSync(path.join(__dirname, '../js/workers/worldbook_regex_worker.js')), false);
    assert.match(c.importWorldBookJson([{ content: '正文', key: ['never'], probability: 0 }], null).books[0].importCompatibility.ignored.join('、'), /关键词.*概率/);
});
