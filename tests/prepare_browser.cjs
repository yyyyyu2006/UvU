const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const manifest = require('./browser-assets.json');
async function main() {
    const target = path.join(__dirname, '.cache/browser-assets');
    await fs.mkdir(target, { recursive: true });
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    for (const entry of manifest) {
        const file = path.join(target, entry.file);
        const cached = await fs.readFile(file).catch(() => null);
        if (cached && hash(cached) === entry.sha256) continue;
        const response = await fetch(entry.url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(entry.url + ': HTTP ' + response.status);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (hash(bytes) !== entry.sha256) throw new Error(entry.url + ' 内容哈希变化，未保存；请核对来源和版本，不能直接跳过校验。');
        await fs.writeFile(file, bytes);
        console.log('准备资源：' + entry.file);
    }
    if (!process.argv.includes('--assets-only')) {
        const result = spawnSync(process.execPath, [path.join(path.dirname(require.resolve('playwright')), 'cli.js'), 'install', 'chromium'], { stdio: 'inherit', windowsHide: true });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error('浏览器安装失败；可重试 npx playwright install chromium。');
    }
    console.log('测试资源准备完成；这些资源仅供测试，不改变网页依赖。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
