const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { baseline1900 } = require('./helpers/baseline_1900.cjs');
const env = { ...process.env, UVU_1900_STRICT: '1' };
try {
    baseline1900(env);
    const result = spawnSync(process.execPath, ['--test', '--test-isolation=none', 'tests/legacy_1900_compat.test.cjs', 'tests/call_1900_compat.test.cjs'],
        { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', windowsHide: true });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.error) throw result.error;
    const skipped = result.stdout?.match(/^ℹ skipped (\d+)|^# skipped (\d+)/m);
    if (!skipped || Number(skipped[1] || skipped[2]) !== 0) throw new Error('1900严格验收缺少零跳过证据。');
    process.exitCode = result.status || 0;
} catch (error) { console.error(error.message); process.exitCode = 1; }
