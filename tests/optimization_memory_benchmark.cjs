// Local synthetic exact-scan baseline, no API calls. Run with node --expose-gc.
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const c = vm.createContext({ setTimeout, clearTimeout, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/auto_memory.js'), 'utf8'), c);
(async () => {
    const query = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
    for (const count of [1000, 10000, 25000]) {
        global.gc?.(); const initial = process.memoryUsage().heapUsed;
        const rows = Array.from({ length: count }, (_, index) => ({ embedding: Array.from({ length: 128 }, (_, i) => Math.sin(i + index + 1)) }));
        const start = performance.now();
        const scores = await c.scoreVectorMemoryChunks(query, rows, () => {});
        console.log(JSON.stringify({ rows: count, dimensions: 128, milliseconds: +(performance.now() - start).toFixed(2),
            heapMiB: +((process.memoryUsage().heapUsed - initial) / 1048576).toFixed(2), firstScore: scores[0] }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
