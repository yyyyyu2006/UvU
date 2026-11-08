// Render Free entry point: HTTPS is terminated by Render; all vault data is ephemeral.
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { engineInstalled } from './provider-adapter.mjs';

export function renderConfig(env, privateDirectory) {
    const port = env.PORT || '10000';
    if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw Error('Invalid Render PORT');
    return {
        ...env, MUSIC_HOST: '0.0.0.0', MUSIC_PORT: String(Number(port)),
        MUSIC_ORIGINS: env.MUSIC_ORIGINS || 'https://yyyyyu2006.github.io',
        MUSIC_TLS_CERT: '', MUSIC_TLS_KEY: '', MUSIC_DEPLOYMENT: 'render-free',
        MUSIC_VAULT_PATH: resolve(privateDirectory, 'vault.json'),
        MUSIC_VAULT_KEY: randomBytes(32).toString('base64')
    };
}

export async function launchRender() {
    if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
    if (!await engineInstalled()) throw Error('Music engine is not installed. Set the Render build command to: node setup.mjs');
    const directory = await mkdtemp(join(tmpdir(), 'uvu-music-render-'));
    Object.assign(process.env, renderConfig(process.env, directory));
    console.log('Render Free mode: login credentials are encrypted for this process only. Restarting the service requires signing in again.');
    await import('./start.mjs');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    launchRender().catch(error => { console.error(error.message); process.exitCode = 1; });
}
