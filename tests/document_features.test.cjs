const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
function fixture(books = []) {
    const c = vm.createContext({ db: { worldBooks: books, myStickers: [], characters: [], groups: [] }, crypto, TextDecoder, console });
    for (const name of ['worldbook_rules', 'document_import', 'text_editor', 'sticker_assist']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/' + name + '.js'), 'utf8'), c);
    return c;
}
const plain = value => JSON.parse(JSON.stringify(value));
test('legacy worldbooks retain binding order and old depth sorting with no extra rules', () => {
    const books = [{ id: 'a', position: 'before', content: 'A', depth: 20 }, { id: 'b', position: 'before', content: 'B', depth: 10 }, { id: 'c', type: 'folder' }];
    const c = fixture(books), chat = { worldBookIds: ['a', 'b', 'c'] };
    assert.equal(c.worldBookSection(c.buildWorldBookPlan(chat), 'before'), 'B\nA');
    assert.deepEqual(books, [{ id: 'a', position: 'before', content: 'A', depth: 20 }, { id: 'b', position: 'before', content: 'B', depth: 10 }, { id: 'c', type: 'folder' }]);
});
test('activation honors constant, disabled, exact probability boundaries and secondary logic', () => {
    const books = [0, 1, 2, 3].map(n => ({ id: '' + n, content: '' + n, rules: { constant: false, keys: ['猫'], secondaryKeys: ['开心', '晚安'], selectiveLogic: n, probability: 100 } }));
    const c = fixture(books), chat = { worldBookIds: books.map(b => b.id), history: [{ content: '猫很开心' }] };
    assert.deepEqual(plain(c.buildWorldBookPlan(chat)).map(b => b.id), ['0', '1']);
    books[0].rules.enabled = false; books[1].rules.probability = 0;
    assert.equal(c.buildWorldBookPlan(chat).length, 0);
    books[0].rules = { constant: true, probability: 50 };
    assert.equal(c.buildWorldBookPlan(chat, [], () => 0.49).length, 1);
    assert.equal(c.buildWorldBookPlan(chat, [], () => 0.50).length, 0);
});
test('keyword matching supports literal punctuation, case, whole words and regex', () => {
    const c = fixture();
    assert.equal(c.worldBookMatches('cat', 'a cat!', { wholeWords: true }), true);
    assert.equal(c.worldBookMatches('cat', 'cats', { wholeWords: true }), false);
    assert.equal(c.worldBookMatches('C++', 'C++', { wholeWords: true }), true);
    assert.equal(c.worldBookMatches('你好', '你好呀', {}), true);
    assert.equal(c.worldBookMatches('/HELLO/i', 'hello', {}), true);
    assert.equal(c.worldBookMatches('/[/', 'hello', {}), false);
    assert.equal(c.worldBookMatches('Cat', 'cat', { caseSensitive: true }), false);
});
test('scan depth zero and finite depth exclude older trigger messages', () => {
    const book = { id: 'a', rules: { constant: false, keys: ['old'], scanDepth: 1 } }, c = fixture([book]);
    const chat = { worldBookIds: ['a'], history: [{ content: 'old' }, { content: 'new' }] };
    assert.equal(c.buildWorldBookPlan(chat).length, 0); book.rules.scanDepth = 2; assert.equal(c.buildWorldBookPlan(chat).length, 1);
    book.rules.scanDepth = 0; assert.equal(c.buildWorldBookPlan(chat).length, 0);
});
test('depth insertion counts original messages, preserves role and order without mutating history', () => {
    const c = fixture(), history = ['A', 'B', 'C'].map(content => ({ content, role: 'user' }));
    const plan = [{ position: 'chat', content: 'tail', rules: { chatDepth: 0, role: 'assistant' } }, { position: 'chat', content: 'middle', rules: { chatDepth: 2 } }, { position: 'chat', content: 'first', rules: { chatDepth: 999 } }];
    const result = c.insertDepthWorldBooks(history, plan);
    assert.deepEqual(plain(result).map(m => m.content), ['first', 'A', 'middle', 'B', 'C', 'tail']);
    assert.equal(result.at(-1).role, 'assistant'); assert.equal(history.length, 3);
});
test('SillyTavern and character-book imports preserve keys, zero values, roles and original fields', () => {
    const c = fixture(), source = { entries: { 7: { comment: '测试', content: '内容', key: ['猫'], constant: false, selective: true, keysecondary: ['开心'], position: 4, depth: 0, order: 0, probability: 0, role: 2, cooldown: 5 } } };
    const book = c.importWorldBookJson(source, 'folder').books[0];
    assert.equal(book.position, 'chat'); assert.equal(book.rules.chatDepth, 0); assert.equal(book.rules.order, 0); assert.equal(book.rules.probability, 0); assert.equal(book.rules.role, 'assistant'); assert.equal(book.importSource.cooldown, 5);
    const card = c.importWorldBookJson({ data: { character_book: { entries: [{ name: '角色书', content: '文本', keys: ['key'], extensions: { position: 4, depth: 2, role: 1 } }] } } }, null).books[0];
    assert.equal(card.rules.role, 'user'); assert.equal(card.rules.chatDepth, 2);
    assert.throws(() => c.importWorldBookJson({ bad: true }, null), /entries/);
});
test('unsupported tavern positions are preserved and disabled instead of silently injected', () => {
    const c = fixture(), result = c.importWorldBookJson({ entries: { a: { content: 'unsupported', position: 7, constant: true } } }, null);
    assert.equal(result.warnings.length, 1); c.db.worldBooks = result.books;
    assert.equal(c.buildWorldBookPlan({ worldBookIds: [result.books[0].id] }).length, 0);
});
test('find treats special characters literally and supports Unicode and case settings', () => {
    const c = fixture();
    assert.deepEqual(plain(c.findEditorMatches('a.b aXb a.b', 'a.b')), [{ start: 0, end: 3 }, { start: 8, end: 11 }]);
    assert.equal(c.findEditorMatches('你好你好', '你好').length, 2); assert.equal(c.findEditorMatches('Aa', 'a', true).length, 1);
    assert.equal(c.findEditorMatches('anything', '').length, 0);
});
test('sticker document URLs retain metadata, ignore executable URLs and trigger recommendations', () => {
    const c = fixture();
    const items = c.parseStickerDocumentLines('开心|哈哈,好耶|小猫欢呼:https://example.com/a.png\n坏:javascript:alert(1)\n晚安：https://example.com/b.gif');
    assert.equal(items.length, 2); assert.equal(items[0].description, '小猫欢呼'); assert.equal(items[1].name, '晚安');
    assert.equal(c.getStickerSuggestions('哈哈', items)[0].name, '开心'); assert.equal(c.getStickerSuggestions('', items).length, 0);
    assert.equal(c.validStickerImage('javascript:alert(1)'), false); assert.equal(c.validStickerImage('data:image/svg+xml;base64,ABC='), false);
});
test('TXT decoding handles UTF8 and GB18030 and rejects oversized files before reading', async () => {
    const c = fixture(); const bytes = Buffer.from('人设内容');
    assert.equal((await c.readImportDocument({ name: 'persona.txt', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })).text, '人设内容');
    await assert.rejects(c.readImportDocument({ name: 'big.txt', size: 21 * 1024 * 1024 }), /20MB/);
    assert.throws(() => c.validateDocxArchive(new ArrayBuffer(30)), /DOCX/);
});
for (const provider of ['newapi', 'gemini']) test('sticker vision uses secondary image route with correct image payload: ' + provider, async () => {
    const c = fixture(), captured = [];
    c.AbortSignal = AbortSignal; c.getRandomValue = v => v;
    c.db.apiSettings = { url: 'https://primary.invalid', key: 'primary-key', model: 'primary', secondary: { enabled: true, routes: { imageRecognition: true }, provider, url: 'https://vision.invalid', key: 'vision-key', model: 'vision' } };
    const utils = fs.readFileSync(path.join(__dirname, '../js/utils.js'), 'utf8');
    for (const name of ['resolveAuxiliaryApiConfig','buildChatApiRequest']) {
        const start = utils.indexOf('function ' + name + '('), end = utils.indexOf('\n}',start) + 2;
        vm.runInContext(utils.slice(start,end),c);
    }
    c.fetchAiResponse = async (config,body,headers,url) => { captured.push({config,body,headers,url});return '小猫微笑，表达开心'; };
    assert.equal(await c.recognizeStickerImage('data:image/png;base64,ABC='),'小猫微笑，表达开心');
    const {config,body,url}=captured[0];assert.equal(config.model,'vision');assert.equal(config.streamEnabled,false);assert.ok(url.startsWith('https://vision.invalid'));
    if(provider==='gemini')assert.equal(body.contents[0].parts[1].inline_data.data,'ABC=');
    else assert.equal(body.messages[0].content[1].image_url.url,'data:image/png;base64,ABC=');
});
