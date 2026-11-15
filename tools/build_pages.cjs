'use strict';
// Package both branches without copying tests, credentials, backend code or outputs.
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw Error('Missing ' + name); return args[i + 1]; }
function copySite(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) {
        if (!['assets', 'css', 'data', 'js'].includes(name) && !/\.(?:html|css)$/.test(name) && !['manifest.json', 'sw.js'].includes(name)) continue;
        fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true, dereference: false, filter: file => !fs.lstatSync(file).isSymbolicLink() });
    }
    fs.writeFileSync(path.join(destination, '.nojekyll'), '');
}
function walk(dir, visit) {
    for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name); if (fs.statSync(file).isDirectory()) walk(file, visit); else visit(file); }
}
function build() {
    const main = path.resolve(option('--main')), test = path.resolve(option('--test')), out = path.resolve(option('--out'));
    const mainSha = option('--main-sha'), testSha = option('--test-sha');
    for (const sha of [mainSha, testSha]) if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid commit SHA');
    if (fs.existsSync(out)) throw Error('Output directory must not exist: ' + out);
    for (const source of [main, test]) if (!fs.existsSync(path.join(source, 'index.html'))) throw Error('Missing site index: ' + source);
    copySite(main, out); const preview = path.join(out, 'test'); copySite(test, preview);
    const htmlPath = path.join(preview, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    if (!/<head(?:\s[^>]*)?>/i.test(html)) throw Error('Test index has no head');
    html = html.replace(/(<head(?:\s[^>]*)?>)/i, '$1\n<script src="js/test_storage.js"></script>');
    html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>UvU 测试版</title>');
    fs.writeFileSync(htmlPath, html);
    fs.copyFileSync(path.join(__dirname, 'pages/test_storage.js'), path.join(preview, 'js/test_storage.js'));
    const databases = ['章鱼喷墨机DB_ee', 'uvu-music-local', 'uvu-vector-index-v1', 'uvu-minimax-audio-v1'];
    walk(path.join(preview, 'js'), file => {
        if (!file.endsWith('.js')) return;
        const text = fs.readFileSync(file, 'utf8'); let next = text;
        for (const match of text.matchAll(/(?:new\s+Dexie|indexedDB\.open)\(\s*(['"])([^'"]+)\1/g)) {
            if (!databases.includes(match[2])) throw Error('Unrecognized test database: ' + match[2]);
        }
        for (const name of databases) for (const quote of ["'", '"']) next = next.split(quote + name + quote).join(quote + 'uvu-test:' + name + quote);
        if (next !== text) fs.writeFileSync(file, next);
    });
    const manifestPath = path.join(preview, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    Object.assign(manifest, { name: 'UvU 测试版', short_name: 'UvU Test', start_url: '.', scope: '.', id: './' });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const builtAt = new Date().toISOString();
    for (const [site, branch, commit] of [[out, 'main', mainSha], [preview, 'test', testSha]]) {
        fs.writeFileSync(path.join(site, 'deployment.json'), JSON.stringify({ branch, commit, builtAt }, null, 2) + '\n');
    }
    console.log('Pages bundle ready: main at /, test at /test/');
}
try { build(); } catch (error) { console.error(error.message); process.exitCode = 1; }
