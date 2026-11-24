
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = new URL('file://' + __filename.replaceAll('\\', '/'));
const png = value => 'data:image/png;base64,' + Buffer.from(value).toString('base64');
const profile = { scene: '小猫低头捂脸', gestures: '双手捂住眼睛', emotion: '害羞', intent: '化解尴尬', suitable: ['被夸奖', '谢谢夸奖'], unsuitable: ['严肃道歉'], ambiguity: '也可能在哭', confidence: 'high', ocr: '下雨了' };
function fixture(items) {
    const c = vm.createContext({ db: { myStickers: items }, validStickerImage: x => typeof x === 'string' && x.startsWith('data:image/'),
        crypto: webcrypto, AbortController, Uint8Array, atob, setTimeout, clearTimeout, console, saveData: async () => {} });
    vm.runInContext(readFileSync(new URL('../js/modules/sticker_semantics.js', source), 'utf8'), c);
    return c;
}
const item = (id, value = id, group = '猫') => ({ id, name: '表情' + id, group, data: png(value) });
const recognize = async () => JSON.stringify(profile);
const config = { url: 'https://provider.invalid', key: 'fake', model: 'test' };
test('deduplicates image bytes, persists failures and retries only the failed rows', async () => {
    const a = item('a'), b = item('b', 'a'), bad = item('bad');
    const c = fixture([a, b, bad]); let calls = 0, saves = 0;
    c.saveData = async () => { saves++; };
    await c.runStickerSemanticBatch({ config, recognize: async image => { calls++; if (image === bad.data) throw Error('failed'); return recognize(); } });
    assert.equal(calls, 2); assert.equal(saves, 3); assert.equal(a.semanticProfile.imageHash, b.semanticProfile.imageHash);
    assert.equal(bad.semanticFailure.issue, '识图请求失败');
    await c.runStickerSemanticBatch({ config, retryOnly: true, recognize: async () => { calls++; return recognize(); } });
    assert.equal(calls, 3); assert.equal(bad.semanticFailure, undefined); assert.equal(bad.semanticProfile.status, 'review');
});
test('stopped work does not write late results; later work resumes, preserving manual corrections', async () => {
    const a = item('a'), b = item('b'), c = fixture([a, b]), controller = new AbortController();
    let finish, started;
    const ready = new Promise(resolve => { started = resolve; });
    const pending = c.runStickerSemanticBatch({ config, signal: controller.signal, recognize: async () => { started(); return new Promise(resolve => { finish = resolve; }); } });
    await ready; controller.abort(); finish(await recognize()); await pending;
    assert.equal(a.semanticProfile, undefined); assert.equal(a.semanticFailure.issue, '已暂停');
    await c.runStickerSemanticBatch({ config, recognize });
    await c.saveStickerSemanticCorrection(a, a.semanticProfile, { ...profile, intent: '谢谢你' });
    await c.runStickerSemanticBatch({ config, recognize: async () => { throw Error('should skip'); } });
    assert.equal(a.semanticProfile.status, 'confirmed'); assert.equal(a.semanticProfile.intent, '谢谢你');
    a.data = png('new');
    assert.equal(c.getStickerSemanticProfile(a), null);
    await c.runStickerSemanticBatch({ config, recognize });
    assert.equal(a.semanticProfile.status, 'review');
});
test('role picking is off by default, scoped, visual, and does not match OCR or banned context', async () => {
    const a = item('a'), b = item('b', 'a', '其他'), c = fixture([a, b]);
    await c.runStickerSemanticBatch({ config, recognize });
    const chat = { stickerGroups: '猫', stickerDescriptionSettings: {} };
    const h = text => [{ role: 'user', content: text }];
    assert.equal(await c.getStickerSemanticContext(chat, h('谢谢夸奖')), '');
    chat.stickerDescriptionSettings.semanticPick = true;
    let context = await c.getStickerSemanticContext(chat, h('谢谢夸奖'));
    assert.match(context, /表情a/); assert.match(context, /小猫低头/); assert.doesNotMatch(context, /表情b|下雨了/);
    assert.equal(await c.getStickerSemanticContext(chat, h('下雨了')), '');
    assert.equal(await c.getStickerSemanticContext(chat, h('谢谢夸奖，严肃道歉')), '');
    chat.stickerGroups = ''; assert.equal(await c.getStickerSemanticContext(chat, h('谢谢夸奖')), '');
});
test('latest user image is matched by bytes, not a description, inaccessible URL or old hidden message', async () => {
    const a = item('a'), c = fixture([a]); await c.runStickerSemanticBatch({ config, recognize });
    const chat = { stickerDescriptionSettings: { semanticRead: true } };
    assert.equal(await c.getStickerSemanticContext(chat, [{ role: 'user', content: '小猫低头捂脸' }]), '');
    const image = { role: 'user', parts: [{ type: 'image', data: a.data }] };
    assert.match(await c.getStickerSemanticContext(chat, [image]), /化解尴尬/);
    assert.match(await c.getStickerSemanticContext(chat, [{ role: 'user', stickerData: a.data }]), /化解尴尬/);
    assert.equal(await c.getStickerSemanticContext(chat, [{ ...image, isWithdrawn: true }]), '');
    assert.equal(await c.getStickerSemanticContext(chat, [image, { role: 'user', content: '后来' }]), '');
    assert.equal(await c.getStickerSemanticContext(chat, [{ role: 'user', stickerData: 'https://image.invalid/a' }]), '');
});
