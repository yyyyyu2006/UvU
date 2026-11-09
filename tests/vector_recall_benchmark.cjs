// No real APIs. Synthetic quality contract, not a provider leaderboard.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks'), cases = require('./fixtures/vector-recall-cases.json');
async function run(mode, query) {
    const chat = { id: 'fixture', activeArchiveId: 'a', history: [], memoryJournals: cases.documents.map(({ vector, ...journal }) => journal),
        autoMemorySettings: { vectorSearchEnabled: true, vectorTopK: 1, vectorThreshold: .8, keepRecent: 0,
            vectorHybridEnabled: mode !== 'cosine', vectorRerankEnabled: mode === 'hybrid+rerank', vectorRewriteEnabled: mode === 'hybrid+rewrite' } };
    let requests = 0;
    const c = vm.createContext({ db: { characters: [chat], groups: [], vectorMemoryApiSettings: { provider: 'newapi', url: 'https://fixture.invalid', key: 'fixture', embeddingModel: 'fixed', batchSize: 16,
        ...(mode === 'hybrid+rerank' ? { rerankModel: 'fixture-rerank', rerankMode: 'native' } : {}), rewriteUrl: 'https://fixture.invalid', rewriteKey: 'fixture', rewriteModel: 'fixture-rewrite' } },
        console, URL, AbortController, setTimeout, clearTimeout, document: { getElementById() { return null; } }, saveData: async () => {}, getRandomValue: x => x,
        fetch: async (url, init) => {
            requests++; const body = JSON.parse(init.body); let payload;
            if (url.endsWith('/chat/completions')) payload = { choices: [{ message: { content: JSON.stringify({ queries: [query.text] }) } }] };
            else if (url.endsWith('/rerank')) payload = { results: body.documents.map((text, index) => ({ index, relevance_score: text.includes(cases.documents.find(doc => query.expected.includes(doc.id))?.content || 'no-match') ? .95 : .1 })) };
            else { const values = Array.isArray(body.input) ? body.input : [body.input]; payload = { data: values.map(text => ({ embedding: cases.documents.find(doc => text.includes(doc.content))?.vector || query.vector })) }; }
            return { ok: true, json: async () => payload };
        } });
    for (const name of ['vector_memory_tools', 'auto_memory']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/' + name + '.js'), 'utf8'), c);
    const started = performance.now(), text = await c.getVectorMemoryContext(chat, query.text), diagnostics = c.getVectorMemoryDiagnostics(chat);
    const found = Array.from(diagnostics.selected || [], item => item.id), expected = new Set(query.expected);
    assert.equal(found.some(id => expected.has(id)), expected.size > 0, query.kind + '/' + mode);
    assert.ok(found.every(id => expected.has(id)), 'false reference ' + query.kind + '/' + mode);
    return { case: query.kind, mode, hit: expected.size ? found.some(id => expected.has(id)) : found.length === 0,
        falseReferences: found.filter(id => !expected.has(id)).length, estimatedTokens: vm.runInContext('VectorMemoryTools', c).tokens(text), requests,
        milliseconds: +(performance.now() - started).toFixed(2) };
}
(async () => { for (const mode of ['cosine', 'hybrid', 'hybrid+rerank', 'hybrid+rewrite']) for (const query of cases.queries) console.log(JSON.stringify(await run(mode, query))); })().catch(error => { console.error(error); process.exitCode = 1; });
