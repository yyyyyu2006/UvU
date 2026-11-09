// Local synthetic exact-scan baseline, no API calls. Run with node --expose-gc.
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const c = vm.createContext({ setTimeout, clearTimeout, console, db: { characters: [], groups: [] } });
for (const name of ['vector_memory_tools', 'auto_memory']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/' + name + '.js'), 'utf8'), c);
const tools = vm.runInContext('VectorMemoryTools', c), p95 = values => +values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1].toFixed(2);
(async () => {
    const query = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
    for (const count of [1000, 10000, 25000]) {
        global.gc?.(); const initial = process.memoryUsage().heapUsed;
        const chat = { id: 'bench', activeArchiveId: 'a', history: [], memoryJournals: [], autoMemorySettings: { vectorChunkSize: 1200 } };
        const rows = Array.from({ length: count }, (_, index) => ({ text: `<content>来源${index}：小明约定2026-11-09归还图书。</content><status>无关状态</status>`,
            embedding: Array.from({ length: 128 }, (_, i) => Math.sin(i + index + 1)) }));
        const timing = { cleaning: [], chunking: [], fingerprint: [], exactScan: [], topK: [] };
        for (let run = 0; run < 7; run++) {
            let start = performance.now(); const cleaned = rows.map(row => c.cleanVectorStoryText(chat, row.text)); timing.cleaning.push(performance.now() - start);
            start = performance.now(); const chunks = cleaned.map(content => tools.chunks(chat, { content })); timing.chunking.push(performance.now() - start);
            start = performance.now(); chunks.forEach(items => items.forEach(chunk => c.autoMemoryFingerprint(chunk.text))); timing.fingerprint.push(performance.now() - start);
            start = performance.now(); const scores = await c.scoreVectorMemoryChunks(query, rows, () => {}); timing.exactScan.push(performance.now() - start);
            start = performance.now(); tools.topK(scores.map((score, i) => ({ score, i })), 10); timing.topK.push(performance.now() - start);
        }
        console.log(JSON.stringify({ rows: count, dimensions: 128, runs: 7, p95Ms: Object.fromEntries(Object.entries(timing).map(([stage, values]) => [stage, p95(values)])),
            heapDeltaMiB: +((process.memoryUsage().heapUsed - initial) / 1048576).toFixed(2), note: 'desktop synthetic; GC/worker scheduling differs on mobile; no ANN decision from one machine' }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
