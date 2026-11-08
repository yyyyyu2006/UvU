import { readFile } from 'node:fs/promises';
import { createGateway } from './gateway.mjs';

const env = process.env;
try {
    const host = env.MUSIC_HOST || '127.0.0.1';
    const port = Number(env.MUSIC_PORT || 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid MUSIC_PORT');
    const origins = (env.MUSIC_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(v => v.trim()).filter(Boolean);
    const persistPath = env.MUSIC_VAULT_PATH || undefined;
    const encryptionKey = env.MUSIC_VAULT_KEY ? Buffer.from(env.MUSIC_VAULT_KEY, 'base64') : undefined;
    if (encryptionKey && encryptionKey.length !== 32) throw Error('MUSIC_VAULT_KEY must contain 32 random bytes in base64');
    let tls;
    if (env.MUSIC_TLS_CERT || env.MUSIC_TLS_KEY) {
        if (!env.MUSIC_TLS_CERT || !env.MUSIC_TLS_KEY) throw Error('Both MUSIC_TLS_CERT and MUSIC_TLS_KEY are required');
        tls = { cert: await readFile(env.MUSIC_TLS_CERT), key: await readFile(env.MUSIC_TLS_KEY), minVersion: 'TLSv1.2' };
    }
    const gateway = await createGateway({ origins, persistPath, encryptionKey, tls, ephemeralDeployment: env.MUSIC_DEPLOYMENT === 'render-free' });
    await new Promise((resolve, reject) => { gateway.server.once('error', reject); gateway.server.listen(port, host, resolve); });
    console.log('UvU music gateway listening on ' + (tls ? 'https://' : 'http://') + host + ':' + port + '/v1');
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await gateway.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch (e) {
    console.error(/^Invalid MUSIC_PORT|^MUSIC_VAULT_KEY|^Both MUSIC_TLS/.test(e.message) ? e.message : 'Music gateway could not start. Check origin, TLS and encrypted vault configuration.');
    process.exitCode = 1;
}
