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
test('activation explanations reuse the same plan and do not reroll probability or reorder legacy books', () => {
    const c = fixture(); c.db.worldBooks = [
        { id: 'legacy', content: '旧', depth: 1 },
        { id: 'hit', content: '中', position: 'after', rules: { advancedEnabled: true, constant: false, keys: ['星河'], scanDepth: 1, probability: 50 } },
        { id: 'miss', content: '无', rules: { advancedEnabled: true, constant: false, keys: ['不存在'], scanDepth: 1 } },
        { id: 'off', content: '关', rules: { advancedEnabled: true, enabled: false } } ];
    const chat = { worldBookIds: ['legacy', 'hit', 'miss', 'off'], history: [{ content: '星河' }] }; let rolls = 0;
    const plan = c.buildWorldBookPlan(chat, chat.history, () => { rolls++; return 0.1; });
    assert.deepEqual(Array.from(plan, book => book.id), ['legacy', 'hit']); assert.equal(rolls, 1);
    const rows = c.getWorldBookPlanDiagnostics(chat);
    assert.equal(rows, plan.activationDiagnostics); assert.equal(rolls, 1);
    assert.equal(rows.find(row => row.id === 'hit').matchedKeys[0], '星河');
    assert.equal(rows.find(row => row.id === 'hit').position, 'after');
    assert.equal(rows.find(row => row.id === 'miss').reason, '主要关键词未匹配');
    assert.equal(rows.find(row => row.id === 'off').reason, '条目已停用');
    assert.equal(c.worldBookSection(plan, 'after'), '中'); assert.equal(rolls, 1);
});
test('many simultaneously active books and explicit empty plan retain deterministic order without extra activation', () => {
    const c = fixture(); c.db.worldBooks = Array.from({ length: 500 }, (_, i) => ({ id: String(i), content: 'BOOK_' + i,
        depth: i, rules: { advancedEnabled: true, constant: true, probability: 50, order: 500 - i } }));
    const chat = { worldBookIds: c.db.worldBooks.map(book => book.id), history: [] }; let rolls = 0;
    const plan = c.buildWorldBookPlan(chat, [], () => { rolls++; return .1; });
    assert.equal(plan.length, 500); assert.equal(plan[0].id, '499'); assert.equal(rolls, 500);
    assert.equal(c.worldBookSection([], 'before'), ''); assert.equal(rolls, 500);
    assert.equal(c.getWorldBookPlanDiagnostics(chat).length, 500);
});
