const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
    const chat = { id: 'c', activeArchiveId: 'a', history: [], memoryJournals: [],
        autoMemorySettings: { vectorSearchEnabled: true, vectorThreshold: 0, keepRecent: 20 } };
    const config = { provider: 'newapi', url: 'https://embed.test/v1', key: 'private-key', embeddingModel: 'embed' };
    const c = vm.createContext({ console, AbortController, setTimeout, clearTimeout,
        document: { addEventListener() {}, getElementById() { return null; } }, window: {},
        db: { characters: [chat], groups: [], vectorMemoryApiSettings: config },
        getRandomValue: key => key, saveData: async () => {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/auto_memory.js'), 'utf8'), c);
    return { c, chat, config };
}
const json = data => ({ ok: true, json: async () => data });
const failure = status => ({ ok: false, status });
const candidates = () => [{ journal: { title: 'one', content: 'movie' } }, { journal: { title: 'two', content: 'weekend' } }];

test('vector endpoints preserve explicit versions and normalize complete OpenAI/Gemini paths', () => {
    const { c } = fixture();
    for (const [url, expected] of [
        ['https://api.test', 'https://api.test/v1/embeddings'],
        ['https://api.test/v1/', 'https://api.test/v1/embeddings'],
        ['https://api.test/v2/embeddings/', 'https://api.test/v2/embeddings'],
        ['https://api.test/api/v1/chat/completions', 'https://api.test/api/v1/embeddings'],
    ]) assert.equal(c.vectorApiEndpoint(url, 'embeddings'), expected);
    assert.equal(c.vectorApiEndpoint('https://google.test/v1beta', 'embedContent', 'models/embed'), 'https://google.test/v1beta/models/embed:embedContent');
    assert.equal(c.vectorApiEndpoint('https://google.test/v1beta/models/embed:embedContent', 'batchEmbedContents', 'embed'), 'https://google.test/v1beta/models/embed:batchEmbedContents');
    assert.equal(c.vectorApiEndpoint('https://google.test/v1beta', 'models', 'models'), 'https://google.test/v1beta/models');
    assert.throws(() => c.vectorApiEndpoint('https://api.test?key=private', 'embeddings'), /API/);
});

test('batch embeddings map out-of-order indices back to input order', async () => {
    const { c, config } = fixture();
    c.fetch = async (url, init) => {
        assert.equal(url, 'https://embed.test/v1/embeddings');
        assert.deepEqual(JSON.parse(init.body).input, ['a', 'b']);
        assert.equal(JSON.parse(init.body).encoding_format, 'float');
        return json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
    };
    assert.deepEqual(JSON.parse(JSON.stringify(await c.requestMemoryEmbeddings(['a', 'b'], config))), [[1, 0], [0, 1]]);
});

test('invalid vector counts, indices, dimensions and zero vectors reject before indexing', async () => {
    const { c, config } = fixture();
    for (const data of [
        { data: [] }, { data: [{ embedding: [1, 0] }] },
        { data: [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [1, 0] }] },
        { data: [{ embedding: [1, 0] }, { embedding: [1] }] },
        { data: [{ embedding: [0, 0] }, { embedding: [1, 0] }] },
        { data: [{ embedding: ['bad'] }, { embedding: [1] }] },
    ]) {
        c.fetch = async () => json(data);
        await assert.rejects(c.requestMemoryEmbeddings(['a', 'b'], config), /API/);
    }
});

test('HTTP errors identify the failing stage and status without exposing secrets or bodies', async () => {
    const { c, config } = fixture();
    for (const status of [400, 401, 403, 404, 429, 500]) {
        c.fetch = async () => ({ ...failure(status), text: async () => 'private-key private conversation' });
        await assert.rejects(c.requestMemoryEmbedding('story', config), error =>
            error.message.includes(String(status)) && !/private/.test(error.message));
    }
    c.fetch = async () => { throw new TypeError('Failed to fetch private-key'); };
    await assert.rejects(c.requestMemoryEmbedding('story', config), error => /API/.test(error.message) && !/private/.test(error.message));
});

test('external cancellation and timeout abort the transport without retries', async () => {
    for (const mode of ['cancel', 'timeout']) {
        const { c, config } = fixture(); let timer, calls = 0, signal;
        c.setTimeout = fn => { timer = fn; return 1; }; c.clearTimeout = () => {};
        c.fetch = async (_, init) => { calls++; signal = init.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => {
            const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        })); };
        const controller = new AbortController();
        const pending = c.requestMemoryEmbedding('story', config, controller.signal);
        if (mode === 'cancel') controller.abort(); else timer();
        await assert.rejects(pending, error => mode === 'cancel' ? error.name === 'AbortError' : error.name !== 'AbortError');
        assert.equal(signal.aborted, true); assert.equal(calls, 1);
    }
    const { c, config } = fixture(); const controller = new AbortController(); controller.abort();
    c.fetch = () => { throw Error('must not call'); };
    await assert.rejects(c.requestMemoryEmbedding('story', config, controller.signal), { name: 'AbortError' });
});

test('Gemini batching uses the correct model path and provider-specific authentication', async () => {
    const { c, config } = fixture(); Object.assign(config, { provider: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta', embeddingModel: 'models/embed' });
    c.fetch = async (url, init) => {
        assert.equal(url, config.url + '/models/embed:batchEmbedContents');
        const body = JSON.parse(init.body); assert.equal(body.requests[0].model, 'models/embed');
        assert.equal(init.headers['x-goog-api-key'], 'private-key');
        return json({ embeddings: [{ values: [1, 0] }, { values: [0, 1] }] });
    };
    assert.equal((await c.requestMemoryEmbeddings(['a', 'b'], config)).length, 2);
    config.url = 'https://proxy.test/v1beta';
    c.fetch = async (_, init) => { assert.equal(init.headers.Authorization, 'Bearer private-key'); return json({ embedding: { values: [1, 0] } }); };
    await c.requestMemoryEmbedding('a', config);
});

test('native rerank uses an independent endpoint/key and sorts numeric relevance scores', async () => {
    const { c, config } = fixture(); Object.assign(config, { rerankMode: 'native', rerankModel: 'bge-reranker', rerankUrl: 'https://rank.test/v2/rerank', rerankKey: 'rank-key' });
    c.fetch = async (url, init) => {
        assert.equal(url, 'https://rank.test/v2/rerank'); assert.equal(init.headers.Authorization, 'Bearer rank-key');
        const body = JSON.parse(init.body); assert.equal(body.model, 'bge-reranker'); assert.equal(body.documents.length, 2);
        return json({ results: [{ index: 0, relevance_score: 0.1 }, { index: 1, relevance_score: 0.9 }] });
    };
    const ranked = await c.rerankMemoryCandidates('weekend', candidates(), config);
    assert.equal(ranked[0].journal.title, 'two');
});

test('rerank failure preserves embedding recall and exposes a diagnostic', async () => {
    const { c, chat, config } = fixture(); Object.assign(chat.autoMemorySettings, { vectorRerankEnabled: true });
    Object.assign(config, { rerankMode: 'native', rerankModel: 'rank' });
    chat.memoryJournals = candidates().map((item, i) => ({ ...item.journal, id: 'j' + i }));
    c.fetch = async (url, init) => url.endsWith('/rerank') ? failure(404) : json({ data: [{ embedding: [1, 0] }] });
    const context = await c.getVectorMemoryContext(chat, 'weekend');
    assert.match(context, /movie/); assert.match(context, /weekend/);
    const status = vm.runInContext('vectorMemoryStatus.get(db.characters[0])', c);
    assert.match(status.text, /404/); assert.equal(status.error, true);
});

test('batch indexing reuses cached chunks and only embeds changed memories', async () => {
    const { c, chat, config } = fixture(); config.batchSize = 4;
    chat.memoryJournals = Array.from({ length: 5 }, (_, i) => ({ id: 'j' + i, title: 'title ' + i, content: 'story ' + i }));
    const requests = [];
    c.fetch = async (_, init) => {
        const input = JSON.parse(init.body).input; requests.push(input);
        return json({ data: (Array.isArray(input) ? input : [input]).map((_, i) => ({ index: i, embedding: [1, 0] })).reverse() });
    };
    await c.getVectorMemoryContext(chat, '<thinking>private reasoning</thinking>story');
    assert.equal(requests.length, 3); assert.equal(requests[1].length, 4); assert.equal(requests[2], 'title 4\nstory 4');
    assert.doesNotMatch(requests[0], /private reasoning/);
    requests.length = 0; await c.getVectorMemoryContext(chat, 'story'); assert.equal(requests.length, 1);
    chat.memoryJournals[0].content = 'changed'; requests.length = 0;
    await c.getVectorMemoryContext(chat, 'story'); assert.equal(requests.length, 2); assert.equal(requests[1], 'title 0\nchanged');
});

test('batch failure keeps completed chunks and permits a single-input retry', async () => {
    const { c, chat, config } = fixture(); config.batchSize = 2;
    chat.memoryJournals = Array.from({ length: 3 }, (_, i) => ({ id: 'j' + i, title: 't' + i, content: 's' + i }));
    c.fetch = async (_, init) => {
        const input = JSON.parse(init.body).input;
        if (input === 't2\ns2') return failure(429);
        return json({ data: (Array.isArray(input) ? input : [input]).map((_, i) => ({ index: i, embedding: [1, 0] })) });
    };
    await assert.rejects(c.getVectorMemoryContext(chat, 'query'), /429/);
    assert.equal(Object.keys(chat.memoryVectorIndex).length, 2);
    const inputs = []; config.batchSize = 1;
    c.fetch = async (_, init) => { inputs.push(JSON.parse(init.body).input); return json({ data: [{ embedding: [1, 0] }] }); };
    await c.getVectorMemoryContext(chat, 'query'); assert.deepEqual(inputs, ['query', 't2\ns2']);
});
