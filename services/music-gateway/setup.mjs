import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ENGINE_REVISION, ENGINE_DIRECTORY } from './provider-adapter.mjs';

const exec = promisify(execFile);
const runtime = fileURLToPath(new URL('./.runtime/', import.meta.url));
try {
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    let exists = false;
    try { await access(ENGINE_DIRECTORY); exists = true; } catch {}
    if (!exists) await exec('git', ['clone', '--no-checkout', 'https://github.com/jimmyshuixin/Music-api.git', ENGINE_DIRECTORY], { timeout: 120000, windowsHide: true });
    const run = args => exec('git', args, { cwd: ENGINE_DIRECTORY, timeout: 120000, windowsHide: true });
    const changes = await run(['status', '--porcelain']);
    // A new --no-checkout clone reports deleted files until the first checkout.
    const marker = fileURLToPath(new URL('./.runtime/revision', import.meta.url));
    let initialized = false;
    try { await access(marker); initialized = true; } catch {}
    if (initialized && changes.stdout.trim()) throw Error('Engine directory has local modifications; setup will not overwrite them');
    try { await run(['cat-file', '-e', ENGINE_REVISION + '^{commit}']); }
    catch { await run(['fetch', 'origin', ENGINE_REVISION]); }
    await run(['checkout', '--detach', ENGINE_REVISION]);
    const revision = (await run(['rev-parse', 'HEAD'])).stdout.trim();
    if (revision !== ENGINE_REVISION) throw Error('Engine revision mismatch');
    await access(new URL('./.runtime/engine/src/meting.js', import.meta.url));
    await writeFile(marker, revision + '\n', { mode: 0o600 });
    console.log('Music provider installed at pinned revision ' + revision + '. No npm dependencies or account credentials were installed.');
} catch (e) {
    console.error(e.message === 'Engine directory has local modifications; setup will not overwrite them' ? e.message : 'Music provider setup failed. Check Git installation/network and retry; existing files were preserved.');
    process.exitCode = 1;
}
