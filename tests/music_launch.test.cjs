const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, stat } = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), { pathToFileURL } = require('node:url');
test('one-command music configuration creates a private vault key once and preserves operator settings', async () => {
    const { initializeConfig } = await import(pathToFileURL(path.resolve(__dirname, '../services/music-gateway/launch.mjs')));
    const dir = await mkdtemp(path.join(os.tmpdir(), 'uvu-music-launch-'));
    try {
        const file = path.join(dir, '.env');
        assert.equal(await initializeConfig(file, path.join(dir, '.runtime')), true);
        const text = await readFile(file, 'utf8');
        assert.match(text, /MUSIC_HOST=127\.0\.0\.1/);
        assert.match(text, /https:\/\/yyyyyu2006.github.io/);
        const key = text.match(/MUSIC_VAULT_KEY=(.+)/)[1]; assert.equal(Buffer.from(key, 'base64').length, 32);
        const vault = JSON.parse(text.match(/MUSIC_VAULT_PATH=(.+)/)[1]); assert.equal(vault, path.resolve(dir, '.runtime/vault.json').replaceAll('\\', '/'));
        assert.equal(await initializeConfig(file, path.join(dir, '.runtime')), false);
        assert.equal(await readFile(file, 'utf8'), text);
        if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
