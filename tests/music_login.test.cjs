const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('NetEase QR creation and polling use the same current login type without modifying other operations', async () => {
    const { createEngineAdapter } = await import(pathToFileURL(path.join(__dirname, '../services/music-gateway/engine-adapter.mjs')));
    const calls = [];
    class Engine {
        constructor() {
            this.provider = {
                loginQrKey: () => ({ method:'POST', url:'https://music.163.com/weapi/login/qrcode/unikey', body:{type:1,other:'key'}, encode:'netease_weapi' }),
                loginQrCheck: key => ({ method:'POST', url:'https://music.163.com/weapi/login/qrcode/client/login', body:{type:1,key}, encode:'netease_weapi' })
            };
        }
        format() {}
        async loginQr() { calls.push(this.provider.loginQrKey()); return { state:'PRIVATE', qrurl:'https://music.163.com/login?codekey=TEST' }; }
        async loginQrCheck(key) { calls.push(this.provider.loginQrCheck(key)); return {code:801}; }
    }
    const adapter = createEngineAdapter(Engine, 'netease');
    await adapter.createQR(); assert.equal((await adapter.pollQR('PRIVATE')).status,'waiting');
    assert.deepEqual(calls.map(c=>c.body.type),[3,3]);
    assert.equal(calls[0].body.other,'key'); assert.equal(calls[1].body.key,'PRIVATE');
    assert.ok(calls.every(c=>c.encode==='netease_weapi' && c.method==='POST'));
    calls.length=0;
    const qq = createEngineAdapter(Engine, 'qq'); await qq.createQR(); await qq.pollQR('PRIVATE');
    assert.deepEqual(calls.map(c=>c.body.type),[1,1],'QQ login requests are unchanged');
});
