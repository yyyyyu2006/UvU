const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const moduleURL = pathToFileURL(path.resolve(__dirname, '../services/music-gateway/render-start.mjs'));

test('Render config uses platform port and public listener with only the Pages origin by default', async () => {
    const { renderConfig } = await import(moduleURL);
    const env = renderConfig({ PORT: '12345', MUSIC_PORT: '8787', MUSIC_HOST: '127.0.0.1' }, '/tmp/private-render');
    assert.equal(env.MUSIC_HOST, '0.0.0.0'); assert.equal(env.MUSIC_PORT, '12345');
    assert.equal(env.MUSIC_ORIGINS, 'https://yyyyyu2006.github.io');
    assert.equal(env.MUSIC_DEPLOYMENT, 'render-free');
    assert.equal(renderConfig({}, '/tmp/private-render').MUSIC_PORT, '10000');
    assert.equal(renderConfig({ MUSIC_ORIGINS: 'https://custom.test' }, '/tmp/private-render').MUSIC_ORIGINS, 'https://custom.test');
});
test('Render startup creates a fresh private vault configuration and leaves TLS to the platform', async () => {
    const { renderConfig } = await import(moduleURL);
    const original = { MUSIC_TLS_CERT: 'old-cert', MUSIC_TLS_KEY: 'old-key', MUSIC_VAULT_KEY: 'old-key', MUSIC_VAULT_PATH: 'old-vault' };
    const a = renderConfig(original, '/tmp/first'), b = renderConfig(original, '/tmp/second');
    assert.equal(Buffer.from(a.MUSIC_VAULT_KEY, 'base64').length, 32);
    assert.notEqual(a.MUSIC_VAULT_KEY, b.MUSIC_VAULT_KEY);
    assert.equal(a.MUSIC_VAULT_PATH, path.resolve('/tmp/first', 'vault.json'));
    assert.equal(a.MUSIC_TLS_CERT, ''); assert.equal(a.MUSIC_TLS_KEY, '');
    assert.equal(original.MUSIC_VAULT_KEY, 'old-key', 'input environment is unchanged');
});
test('Render rejects invalid platform ports before opening a listener', async () => {
    const { renderConfig } = await import(moduleURL);
    for (const PORT of ['0', '-1', '65536', '3.5', 'oops']) assert.throws(() => renderConfig({ PORT }, '/tmp/test'), /PORT/);
});
