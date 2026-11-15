'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../js', file), 'utf8');
function groupFixture(random = Math.random) {
    const context = vm.createContext({ window: {}, document: { addEventListener() {} }, Math: Object.assign(Object.create(Math), { random }), console });
    vm.runInContext(read('group_chat.js'), context);
    return context;
}
for (const [width, height, options, expected] of [
    [1200, 1000, { maxWidth: 800, maxHeight: 200 }, [240, 200]],
    [1000, 1200, { maxWidth: 200, maxHeight: 800 }, [200, 240]],
    [1200, 1000, {}, [800, 667]],
    [320, 200, { maxWidth: 800, maxHeight: 800 }, [320, 200]]
]) test(`compression respects both limits without enlarging ${width}x${height} ${JSON.stringify(options)}`, async () => {
    let canvas;
    class Reader { readAsDataURL() { queueMicrotask(() => this.onload({ target: { result: 'fixture:image' } })); } }
    class Picture { constructor() { this.width = width; this.height = height; } set src(_) { queueMicrotask(() => this.onload()); } }
    const context = vm.createContext({ window: {}, console, FileReader: Reader, Image: Picture,
        document: { addEventListener() {}, createElement() { return canvas = { getContext: () => ({ drawImage() {}, fillRect() {} }), toDataURL: () => 'data:image/jpeg;fixture' }; } } });
    vm.runInContext(read('utils.js'), context);
    await context.compressImage({ type: 'image/jpeg' }, options);
    assert.deepEqual([canvas.width, canvas.height], expected);
});
test('red packet rejects totals below one cent per recipient', () => {
    const c = groupFixture();
    for (const [total, count] of [[0.01, 3], [0.02, 3], [0, 1]]) assert.throws(() => c.distributeRedPacket(total, count), /金额|0.01/);
});
test('red packet validates nonfinite totals, fractional counts and oversized allocations', () => {
    const c = groupFixture();
    for (const [total, count] of [[Infinity, 3], [NaN, 3], [-1, 1], [0.001, 1], [1.005, 1], [2, 0], [2, -1], [2, 1.5], [200, 10001]]) {
        assert.throws(() => c.distributeRedPacket(total, count), /金额|个数|0.01/);
    }
});
test('red packet always reserves a cent for later recipients and preserves exact total', () => {
    for (const random of [() => 0, () => 0.999999999, Math.random]) {
        const c = groupFixture(random);
        for (const [total, count] of [[0.03, 3], [0.04, 3], [0.29, 7], [1, 1], [1, 100], [20, 1999], [123.45, 17]]) {
            const result = Array.from(c.distributeRedPacket(total, count));
            assert.equal(result.length, count);
            assert.ok(result.every(value => value >= 0.01 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6));
            assert.equal(result.reduce((sum, value) => sum + Math.round(value * 100), 0), Math.round(total * 100));
        }
    }
});
test('compression rejects unusable dimensions before reading the file', async () => {
    const c = vm.createContext({ window: {}, document: { addEventListener() {} }, FileReader: class { constructor() { throw Error('unexpected file read'); } } });
    vm.runInContext(read('utils.js'), c);
    for (const value of [0, -1, NaN, Infinity, '800', 0.5]) {
        await assert.rejects(c.compressImage({ type: 'image/jpeg' }, { maxWidth: value }), /尺寸/);
        await assert.rejects(c.compressImage({ type: 'image/jpeg' }, { maxHeight: value }), /尺寸/);
    }
});
test('canvas encoding failure rejects compression instead of leaving a pending task', async () => {
    let picture;
    class Reader { readAsDataURL() { queueMicrotask(() => this.onload({ target: { result: 'fixture' } })); } }
    class Picture { constructor() { picture = this; this.width = 1200; this.height = 1000; } }
    const c = vm.createContext({ window: {}, document: { addEventListener() {}, createElement() { return { getContext: () => ({ drawImage() {} }), toDataURL() { throw Error('encoding unavailable'); } }; } }, FileReader: Reader, Image: Picture });
    vm.runInContext(read('utils.js'), c);
    const pending = c.compressImage({ type: 'image/jpeg' });
    await Promise.resolve();
    assert.doesNotThrow(() => picture.onload());
    await assert.rejects(pending, /encoding unavailable/);
});
