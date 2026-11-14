const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');

function playwright() {
    try { return require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
    catch (cause) { throw new Error('浏览器测试依赖缺失。请在仓库执行 npm ci，再执行 npm run test:browser:prepare。可用 PLAYWRIGHT_MODULE 指定已有安装。', { cause }); }
}
function browserPath() {
    const explicit = process.env.UVU_CHROME_PATH || process.env.CHROME_PATH;
    const system = process.platform === 'win32'
        ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
            .flatMap(base => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(file => path.join(base, file)))
        : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
            : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    const target = explicit || system.find(file => fs.existsSync(file)) || playwright().chromium.executablePath();
    if (!fs.existsSync(target)) throw new Error('浏览器不存在：' + target + '。执行 npx playwright install chromium，或用 UVU_CHROME_PATH 指定浏览器。');
    return target;
}
function assetMap(html) {
    const manifest = require('../browser-assets.json');
    const urls = [...html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map(m => m[1]);
    const entries = new Map(manifest.map(entry => [entry.url, entry]));
    const result = new Map(), missing = [];
    for (const url of urls) {
        const entry = entries.get(url);
        const file = entry && path.join(root, 'tests/.cache/browser-assets', entry.file);
        if (!entry || !fs.existsSync(file) || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== entry.sha256) missing.push(url);
        else result.set(url, file);
    }
    if (missing.length) throw new Error('浏览器测试资源缺失或校验不符：\n' + missing.join('\n') + '\n执行 npm run test:browser:prepare；新增外链需同时更新 tests/browser-assets.json。');
    return result;
}
function preflight() {
    playwright();
    browserPath();
    assetMap(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
}
module.exports = { playwright, browserPath, assetMap, preflight };
