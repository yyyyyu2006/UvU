'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture(provider = 'newapi') {
    const requests = [], logs = [];
    const chat = { id: 'c', realName: 'CHAR', myName: 'USER', persona: 'PERSONA', history: [
        { id: 'm', role: 'assistant', content: 'CONTEXT', timestamp: 1 }
    ] };
    const config = { provider, url: 'https://fixture.invalid', key: 'fixture', model: 'fixture' };
    const c = vm.createContext({ Response, console: { log: (...args) => logs.push(args) },
        db: { workshopSettings: {} }, resolveWorkshopLlmApiConfig: () => config,
        pad: x => String(x).padStart(2, '0'), getRandomValue: x => x,
        fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) });
            return new Response(JSON.stringify(c.packet)); } });
    c.window = c;
    require('./helpers/api_transport.cjs')(c);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_ai_airdrop.js'), 'utf8'), c);
    c.packet = { choices: [{ message: { content: '<image>blue sky, clouds</image>' } }] };
    return { c, chat, config, requests, logs };
}
test('AirDrop preserves tag prompt bodies and history selection against the previous implementation', async () => {
    const { c, chat, requests, config } = fixture();
    const source = fs.readFileSync(path.join(__dirname, '../js/modules/chat_ai_airdrop.js'), 'utf8');
    const start = source.indexOf('async function generateTagsFromDescription(');
    const assembly = source.slice(start, source.indexOf('    console.log(', start)).replace(/\r\n/g, '\n');
    // Frozen from the prompt/history assembly at 7974b08; independent of local Git history.
    assert.equal(require('node:crypto').createHash('sha256').update(assembly).digest('hex'), '1c6ff720232ea81ec48721f49590c65a6e68b9527f557552ee139e7c90a228c3');
    for (const provider of ['newapi', 'gemini']) {
        config.provider = provider;
        c.packet = provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'tags' }] } }] } : { choices: [{ message: { content: 'tags' } }] };
        chat.history = Array.from({ length: 35 }, (_, i) => ({ id: String(i), role: i % 2 ? 'user' : 'assistant', content: 'context' + i, timestamp: i + 1, isContextDisabled: i === 7, isThinking: i === 9 }));
        await c.generateTagsFromDescription(chat, '34');
        const body = requests.at(-1).body, text = JSON.stringify(body);
        assert.equal(body.stream, false); assert.equal(body.temperature, 0.7);
        assert.match(text, /context5/); assert.match(text, /context34/);
        assert.doesNotMatch(text, /context4[^0-9]|context7[^0-9]|context9[^0-9]/);
        assert.equal(provider === 'gemini' ? body.contents.length : body.messages.length, provider === 'gemini' ? 1 : 2);
    }
});
test('AirDrop accepts tagged or fenced valid text without exposing prompt bodies in routine logs', async () => {
    const { c, chat, logs } = fixture();
    assert.equal(await c.generateTagsFromDescription(chat, 'm'), 'blue sky, clouds');
    c.packet.choices[0].message.content = '```text\nblue sky\n```';
    assert.equal(await c.generateTagsFromDescription(chat, 'm'), 'blue sky');
    assert.doesNotMatch(JSON.stringify(logs), /PERSONA|CONTEXT|blue sky/);
});
for (const [label, packet, expected] of [
    ['business error', { error: { code: 'LIMIT', message: 'fixture exhausted' } }, /LIMIT.*fixture exhausted/],
    ['null', null, /API.*格式/], ['missing choices', {}, /API.*文本/],
    ['empty choices', { choices: [] }, /API.*文本/],
    ['numeric content', { choices: [{ message: { content: 123 } }] }, /content应为字符串/],
    ['object content', { choices: [{ message: { content: {} } }] }, /content应为字符串/],
    ['empty text', { choices: [{ message: { content: '  ' } }] }, /API.*文本/]
]) test('AirDrop rejects ' + label + ' with a readable error', async () => {
    const { c, chat } = fixture(); c.packet = packet;
    await assert.rejects(c.generateTagsFromDescription(chat, 'm'), expected);
});
test('AirDrop rejects malformed JSON and HTTP errors', async () => {
    const { c, chat } = fixture(); c.fetch = async () => new Response('<html>wrong endpoint</html>');
    await assert.rejects(c.generateTagsFromDescription(chat, 'm'), /JSON/);
    c.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(c.generateTagsFromDescription(chat, 'm'), /503/);
});
test('AirDrop Gemini joins text parts and detects blocked or non-text responses', async () => {
    const { c, chat } = fixture('gemini');
    c.packet = { candidates: [{ content: { parts: [{ text: 'blue ' }, { text: 'sky' }] } }] };
    assert.equal(await c.generateTagsFromDescription(chat, 'm'), 'blue sky');
    c.packet = { promptFeedback: { blockReason: 'SAFETY' } };
    await assert.rejects(c.generateTagsFromDescription(chat, 'm'), /SAFETY/);
    c.packet = { candidates: [{ content: { parts: [{ text: 123 }] } }] };
    await assert.rejects(c.generateTagsFromDescription(chat, 'm'), /格式/);
});
test('AirDrop full endpoint does not acquire a second v1/chat/completions suffix', async () => {
    const { c, chat, config, requests } = fixture(); config.url += '/v1/chat/completions';
    await c.generateTagsFromDescription(chat, 'm'); assert.equal(requests[0].url, config.url);
});
test('saving AirDrop returns its own generated key instead of querying the latest photo', async () => {
    const { c } = fixture(); let saved;
    c.dexieDB = { characterPhotos: { add: async row => { saved = row; return 41; } } };
    const photo = await c.saveAirDropPhoto('c', 'image', 'tags', { archiveId: 'one', messageId: 'm' });
    assert.equal(photo.id, 41); assert.equal(photo.image, saved.image); assert.equal(photo.archiveId, 'one');
});
test('AirDrop cannot report success when the database or image is absent', async () => {
    const { c } = fixture(); c.dexieDB = null;
    await assert.rejects(c.saveAirDropPhoto('c', 'image'), /数据库/);
    c.dexieDB = { characterPhotos: { add: async () => { throw Error('must not save'); } } };
    for (const image of ['', null, undefined, {}, '  ']) await assert.rejects(c.saveAirDropPhoto('c', image), /有效图片/);
});
