import { parentPort, workerData } from 'node:worker_threads';
import { createEngineAdapter, createRestrictedFetch } from './engine-adapter.mjs';
import { safeProviderFailure } from './provider-errors.mjs';

try {
    const { provider, operation, args, credential } = workerData;
    globalThis.fetch = createRestrictedFetch(globalThis.fetch, provider);
    const { default: Meting } = await import('./.runtime/engine/src/meting.js');
    const adapter = createEngineAdapter(Meting, provider, credential);
    const value = await adapter[operation](...args);
    parentPort.postMessage({ ok: true, value });
} catch (error) {
    parentPort.postMessage({ ok: false, error: { code: safeProviderFailure(error).code } });
}
