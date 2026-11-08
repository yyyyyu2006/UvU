const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { IDBObjectStore } = require('fake-indexeddb');
function fixture() {
    const c = vm.createContext({ indexedDB: new IDBFactory(), IDBKeyRange, console, setTimeout, clearTimeout, structuredClone });
    const file = path.join(__dirname, '../js/modules/vector_index_store.js');
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), c);
    return c;
}
const index = (value = 1) => ({ source: { version: 2, chunks: [{ key: 'hash', start: 0, end: 10, vector: [value, 0] }] } });

test('scope inventory contains only cache metadata and deletion is isolated and revision guarded', async () => {
    const store = fixture().VectorIndexStore;
    await store.commit('old', index(), 'before'); await store.commit('active', index(2), 'other');
    const rows = await store.listScopes();
    assert.equal(rows.length, 2);
    const old = rows.find(row => row.id === 'old');
    assert.equal(old.chunkCount, 1); assert.equal(old.sourceCount, 1);
    assert.equal('entries' in old, false); assert.equal('index' in old, false);
    await assert.rejects(store.removeScope('old', old.updatedAt - 1), /更新/);
    assert.equal((await store.read('old')).fingerprint, 'before');
    await store.removeScope('old', old.updatedAt);
    assert.deepEqual(Object.keys((await store.read('old')).index), []);
    assert.equal((await store.read('active')).index.source.chunks[0].vector[0], 2);
    assert.deepEqual(Array.from(await store.listScopes(), row => row.id), ['active']);
    const activeBefore = (await store.listScopes())[0];
    await store.commit('active', index(3), 'revised');
    await assert.rejects(store.removeScope('active', activeBefore.updatedAt), /更新/);
});

test('late index connections close after timeout or blocked opening', async () => {
    for (const blocked of [false, true]) {
        const requests = [], timers = [];
        const c = vm.createContext({
            indexedDB: { open() { const request = {}; requests.push(request); return request; } },
            setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}
        });
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/vector_index_store.js'), 'utf8'), c);
        const pending = c.VectorIndexStore.read('scope');
        const rejected = assert.rejects(pending, blocked ? /旧页面/ : /超时/);
        if (blocked) requests[0].onblocked(); else timers[0]();
        await rejected;
        let closed = 0;
        requests[0].result = { close() { closed++; } };
        requests[0].onsuccess();
        assert.equal(closed, 1, 'a connection arriving after rejection must close');
        const retry = c.VectorIndexStore.read('scope');
        const retryRejected = assert.rejects(retry, /超时/);
        assert.equal(requests.length, 2, 'rejected connection may be retried');
        timers[1](); await retryRejected;
    }
});
test('separate index persists only changed chunks and isolates archive/model scope', async () => {
    const c = fixture(); const store = c.VectorIndexStore;
    assert.ok(store, 'independent index store exists');
    assert.equal((await store.commit('character:c:a:model1', index(), 'sources')).written, 1);
    assert.equal((await store.commit('character:c:a:model1', index(), 'sources')).written, 0);
    assert.equal((await store.commit('character:c:a:model1', index(2), 'sources')).written, 1);
    assert.deepEqual(JSON.parse(JSON.stringify((await store.read('character:c:a:model1')).index)), index(2));
    assert.deepEqual(Object.keys((await store.read('character:c:b:model1')).index), []);
    assert.deepEqual(Object.keys((await store.read('character:c:a:model2')).index), []);
    await store.commit('character:c:a:model1', {}, 'changed');
    assert.deepEqual(Object.keys((await store.read('character:c:a:model1')).index), []);
});
test('invalid/aborted incremental update preserves previous committed index', async () => {
    const c = fixture(), store = c.VectorIndexStore; assert.ok(store);
    await store.commit('scope', index(), 'before');
    await assert.rejects(store.commit('scope', index(NaN), 'invalid'), /向量|index/i);
    await assert.rejects(store.commit('scope', index(2), 'switched', () => { throw Error('archive changed'); }), /archive changed/);
    const saved = await store.read('scope');
    assert.equal(saved.fingerprint, 'before'); assert.equal(saved.index.source.chunks[0].vector[0], 1);
});

test('quota failure after one chunk write aborts all incremental changes', async () => {
    const c = fixture(), store = c.VectorIndexStore; await store.commit('scope', index(), 'before');
    const put = IDBObjectStore.prototype.put; let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'chunks' && ++writes === 2) throw Object.assign(Error('quota'), { name: 'QuotaExceededError' });
        return put.apply(this, args);
    };
    try {
        const next = index(3); next.source.chunks.push({ key: 'new', start: 10, end: 20, vector: [2, 1] });
        await assert.rejects(store.commit('scope', next, 'failed'), /quota/);
    } finally { IDBObjectStore.prototype.put = put; }
    const saved = await store.read('scope'); assert.equal(saved.fingerprint, 'before'); assert.equal(saved.index.source.chunks.length, 1); assert.equal(saved.index.source.chunks[0].vector[0], 1);
});
