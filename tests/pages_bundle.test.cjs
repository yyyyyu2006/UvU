'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('Pages bundle keeps main unchanged, publishes test separately and excludes source-only files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvu-pages-'));
    try {
        for (const branch of ['main', 'test']) {
            const source = path.join(dir, branch); fs.mkdirSync(path.join(source, 'js/modules'), { recursive: true });
            fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><title>Fixture</title></head><body>' + branch + '</body></html>');
            fs.writeFileSync(path.join(source, 'js/db.js'), "const db=new Dexie('章鱼喷墨机DB_ee');");
            fs.writeFileSync(path.join(source, 'js/modules/music_core.js'), "indexedDB.open('uvu-music-local',1);");
            fs.writeFileSync(path.join(source, 'sw.js'), '// fixture service worker');
            fs.writeFileSync(path.join(source, 'manifest.json'), '{"name":"UwU","short_name":"UwU","start_url":".","scope":"."}');
            for (const folder of ['outputs', 'services', 'tests', '.git']) { fs.mkdirSync(path.join(source, folder)); fs.writeFileSync(path.join(source, folder, 'private.txt'), 'must not be public'); }
        }
        const out = path.join(dir, 'public'), result = spawnSync(process.execPath, [path.join(root, 'tools/build_pages.cjs'), '--main', path.join(dir, 'main'), '--test', path.join(dir, 'test'), '--out', out, '--main-sha', 'a'.repeat(40), '--test-sha', 'b'.repeat(40)], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), fs.readFileSync(path.join(dir, 'main/index.html'), 'utf8'));
        assert.equal(fs.readFileSync(path.join(out, 'js/db.js'), 'utf8'), "const db=new Dexie('章鱼喷墨机DB_ee');");
        const html = fs.readFileSync(path.join(out, 'test/index.html'), 'utf8');
        assert.ok(html.indexOf('test_storage.js') < html.indexOf('<title>')); assert.match(html, /UvU 测试版/);
        assert.match(fs.readFileSync(path.join(out, 'test/js/db.js'), 'utf8'), /uvu-test:章鱼喷墨机DB_ee/);
        assert.match(fs.readFileSync(path.join(out, 'test/js/modules/music_core.js'), 'utf8'), /uvu-test:uvu-music-local/);
        assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'test/manifest.json'))).name, 'UvU 测试版');
        for (const folder of ['outputs', 'services', 'tests', '.git']) for (const base of [out, path.join(out, 'test')]) assert.equal(fs.existsSync(path.join(base, folder)), false, folder);
        assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'deployment.json'))).commit, 'a'.repeat(40));
        assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'test/deployment.json'))).commit, 'b'.repeat(40));
        assert.ok(fs.existsSync(path.join(out, '.nojekyll'))); assert.ok(fs.existsSync(path.join(out, 'test/js/test_storage.js')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
