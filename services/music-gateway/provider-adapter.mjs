import { Worker } from 'node:worker_threads';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { providerError, safeProviderFailure } from './provider-errors.mjs';

// Shared by every account/provider adapter in this process; no unbounded queue.
let activeWorkers = 0;
const MAX_WORKERS = 8;

export const ENGINE_REVISION = '4d83862b063b31af3eab1d823cfc7ff584609234';
export const ENGINE_DIRECTORY = fileURLToPath(new URL('./.runtime/engine/', import.meta.url));
export async function engineInstalled() {
    try {
        await access(new URL('./.runtime/engine/src/meting.js', import.meta.url));
        return (await readFile(new URL('./.runtime/revision', import.meta.url), 'utf8')).trim() === ENGINE_REVISION;
    } catch { return false; }
}

// A fresh worker owns each engine operation, so its mutable headers/raw response
// cannot race with another request or keep temporary login cookies alive.
export function createPlaylistPager(load, render, now = Date.now) {
    const cache = new Map(); let generation = 0;
    return {
        clear() { generation++; cache.clear(); },
        async page(id, page = 1) {
            const epoch = generation; let entry = cache.get(id);
            if (!entry || entry.expires <= now()) {
                if (cache.size >= 4) cache.delete(cache.keys().next().value);
                entry = { expires: now() + 30000, rows: load(id), pages: new Map() }; cache.set(id, entry);
                entry.rows.catch(() => { if (cache.get(id) === entry) cache.delete(id); });
            }
            const rows = await entry.rows;
            if (epoch !== generation) throw Error('Playlist session changed');
            if (!entry.pages.has(page)) {
                const request = render(rows.slice((page - 1) * 30, page * 30)); entry.pages.set(page, request);
                request.catch(() => { if (entry.pages.get(page) === request) entry.pages.delete(page); });
            }
            const tracks = await entry.pages.get(page);
            if (epoch !== generation) throw Error('Playlist session changed');
            return { tracks, hasMore: rows.length > page * 30, total: rows.length };
        }
    };
}
export function createProviderAdapter(provider, options = {}) {
    let credential = '';
    let closed = false;
    const workers = new Map();
    async function invoke(operation, args = []) {
        if (closed) throw providerError('provider_cancelled');
        if (!(await engineInstalled())) throw providerError();
        if (closed) throw providerError('provider_cancelled');
        if (activeWorkers >= MAX_WORKERS) throw providerError('provider_busy');
        activeWorkers++;
        return new Promise((resolve, reject) => {
            let worker;
            try {
                worker = new Worker(new URL('./engine-worker.mjs', import.meta.url), {
                    workerData: { provider, operation, args, credential },
                    resourceLimits: { maxOldGenerationSizeMb: 96 }, stdout: true, stderr: true
                });
            } catch { activeWorkers--; reject(providerError()); return; }
            worker.stdout.resume(); worker.stderr.resume();
            let finishing;
            const finish = (failure, value) => {
                if (finishing) return finishing;
                clearTimeout(timer);
                finishing = Promise.resolve().then(() => worker.terminate()).catch(() => {}).then(() => {
                    activeWorkers--; workers.delete(worker);
                    if (failure) reject(safeProviderFailure(failure)); else resolve(value);
                });
                return finishing;
            };
            workers.set(worker, () => finish(providerError('provider_cancelled')));
            const timer = setTimeout(() => finish({ status: 504, code: 'provider_timeout' }), options.timeoutMs ?? 14000);
            worker.once('message', message => finish(message?.ok === true ? null : safeProviderFailure(message?.error), message?.value));
            worker.once('error', () => finish({}));
            worker.once('exit', () => finish({}));
        });
    }
    const playlists = createPlaylistPager(id => invoke('playlistSnapshot', [id]), rows => invoke('playlistRows', [rows]));
    return {
        async setCredential(value) { playlists.clear(); credential = value; },
        createQR: () => invoke('createQR'), pollQR: state => invoke('pollQR', [state]),
        search: (query, page) => invoke('search', [query, page]),
        stream: id => invoke('stream', [id]), lyrics: id => invoke('lyrics', [id]),
        playlists: user => invoke('playlists', [user]), playlist: (id, page) => playlists.page(id, page),
        async close() { closed = true; playlists.clear(); credential = ''; await Promise.all([...workers.values()].map(cancel => cancel())); }
    };
}
