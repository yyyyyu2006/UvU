// Operator entry point: install the pinned engine, initialize private local
// configuration once, then run the existing gateway in this process.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { engineInstalled } from './provider-adapter.mjs';

export async function initializeConfig(file, runtime) {
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const values = [
        'MUSIC_HOST=127.0.0.1', 'MUSIC_PORT=8787',
        'MUSIC_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://yyyyyu2006.github.io',
        'MUSIC_VAULT_PATH=' + JSON.stringify(resolve(runtime, 'vault.json').replaceAll('\\', '/')),
        'MUSIC_VAULT_KEY=' + randomBytes(32).toString('base64'), ''
    ].join('\n');
    try { await writeFile(file, values, { flag: 'wx', mode: 0o600 }); return true; }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}

export async function launch() {
    if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
    if (!await engineInstalled()) {
        console.log('Installing the pinned music engine…');
        const code = await new Promise((done, reject) => {
            const child = spawn(process.execPath, [fileURLToPath(new URL('./setup.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
            const forward = () => child.kill();
            process.once('SIGINT', forward); process.once('SIGTERM', forward);
            const cleanup = () => { process.removeListener('SIGINT', forward); process.removeListener('SIGTERM', forward); };
            child.once('error', error => { cleanup(); reject(error); });
            child.once('exit', value => { cleanup(); done(value); });
        });
        if (code !== 0 || !await engineInstalled()) throw Error('Music engine installation failed. Retry after checking Git and the network.');
    }
    const file = fileURLToPath(new URL('./.env', import.meta.url));
    const created = await initializeConfig(file, fileURLToPath(new URL('./.runtime/', import.meta.url)));
    await access(file);
    // loadEnvFile preserves values already supplied by a service manager.
    process.loadEnvFile(file);
    console.log(created ? 'Private local configuration created. Existing deployment variables take precedence.' : 'Using existing configuration; no settings were overwritten.');
    await import('./start.mjs');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    launch().catch(error => { console.error(error.message); process.exitCode = 1; });
}
