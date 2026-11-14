const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(packets) {
    let index = 0, cancelled = 0, released = 0;
    const chunks = packets.map(packet => new TextEncoder().encode(packet));
    const c = vm.createContext({ TextDecoder, console: { log() {} } });
    c.window = c;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/image-workshop/generation.js'), 'utf8'), c);
    const response = {
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => ({
            read: async () => index < chunks.length ? { value: chunks[index++], done: false } : { done: true },
            cancel: async () => { cancelled++; },
            releaseLock: () => { released++; }
        }) }
    };
    return { parse: () => c.parseImageResponse(response), cleanup: () => ({ cancelled, released }) };
}

test('workshop stream ignores null and non-object packets before the final image', async () => {
    const f = fixture(['data: nu', 'll\n\ndata: 0\n\ndata: []\n\n', 'data: {"event_type":"intermediate","b64":"draft"}\n\n', 'data: {"b64":"final-image"}']);
    assert.equal(await f.parse(), 'final-image');
    assert.deepEqual(f.cleanup(), { cancelled: 1, released: 1 });
});

test('workshop stream still reports provider errors after a null packet', async () => {
    const f = fixture(['data: null\n\n', 'data: {"event_type":"error","message":"quota exhausted"}\n\n']);
    await assert.rejects(f.parse(), /NovelAI 错误: quota exhausted/);
    assert.deepEqual(f.cleanup(), { cancelled: 1, released: 1 });
});

test('workshop stream without a final image reports missing image data', async () => {
    const f = fixture(['data: null\n\ndata: false\n\n']);
    await assert.rejects(f.parse(), /获取图片数据失败/);
    assert.deepEqual(f.cleanup(), { cancelled: 1, released: 1 });
});
