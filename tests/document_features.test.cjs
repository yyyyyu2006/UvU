const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
function fixture(books = []) {
    const storage = { data: Object.create(null), getItem(key) { return this.data[key] ?? null; }, setItem(key, value) { this.data[key] = String(value); }, removeItem(key) { delete this.data[key]; } };
    const c = vm.createContext({ db: { worldBooks: books, myStickers: [], characters: [], groups: [] }, crypto, TextDecoder, AbortController, setTimeout, clearTimeout, console, localStorage: storage });
    for (const name of ['chat_ai_prompt', 'worldbook_rules', 'document_import', 'text_editor', 'sticker_assist']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/' + name + '.js'), 'utf8'), c);
    c.__storage = storage;
    return c;
}
const plain = value => JSON.parse(JSON.stringify(value));
test('static worldbooks retain original depth ordering even with stale advanced metadata', () => {
    const books = [{ id: 'a', position: 'before', content: 'A', depth: 20, rules: { advancedEnabled: true, enabled: false, probability: 0, order: 0 } },
        { id: 'b', position: 'before', content: 'B', depth: 10, rules: { advancedEnabled: true, constant: false, keys: ['absent'], order: 1000 } },
        { id: 'chat', position: 'chat', content: 'unsupported', rules: { chatDepth: 0, role: 'user' } }];
    const c = fixture(books), chat = { worldBookIds: ['a', 'b', 'chat'] }, before = JSON.stringify(books);
    assert.deepEqual(Array.from(c.getStaticWorldBooks(chat), b => b.id), ['b', 'a']);
    assert.equal(JSON.stringify(books), before);
    assert.equal(typeof c.buildWorldBookPlan, 'undefined');
    assert.equal(typeof c.insertDepthWorldBooks, 'undefined');
});

test('worldbook binding count ignores deleted advanced enable switches', () => {
    const c = fixture([{ id: 'on', position: 'before', rules: { advancedEnabled: true, enabled: true } },
        { id: 'off', position: 'after', rules: { advancedEnabled: true, enabled: false } }, { id: 'folder', type: 'folder' }]);
    const stats = c.getWorldBookBindingStats(['on', 'on', 'off', 'folder', 'deleted']);
    assert.deepEqual(plain(stats.entries.map(book => book.id)), ['on', 'off']);
    assert.equal(stats.enabled, 2);
    assert.deepEqual(plain(stats.missingIds), ['folder', 'deleted']);
});

test('SillyTavern and character-book imports preserve keys, zero values, roles and original fields', () => {
    const c = fixture(), source = { entries: { 7: { comment: '测试', content: '内容', key: ['猫'], constant: false, selective: true, keysecondary: ['开心'], position: 4, depth: 0, order: 0, probability: 0, role: 2, cooldown: 5 } } };
    const book = c.importWorldBookJson(source, 'folder').books[0];
    assert.equal(book.position, 'unsupported'); assert.equal(book.rules.chatDepth, 0); assert.equal(book.rules.order, 0); assert.equal(book.rules.probability, 0); assert.equal(book.rules.role, 'assistant'); assert.equal(book.importSource.cooldown, 5);
    const card = c.importWorldBookJson({ data: { character_book: { entries: [{ name: '角色书', content: '文本', keys: ['key'], extensions: { position: 4, depth: 2, role: 1 } }] } } }, null).books[0];
    assert.equal(card.rules.role, 'user'); assert.equal(card.rules.chatDepth, 2);
    assert.throws(() => c.importWorldBookJson({ bad: true }, null), /entries/);
});
test('worldbook editor no longer offers chat injection position or writes chat-depth controls', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../js/modules/worldbook_editor.js'), 'utf8');
    assert.doesNotMatch(editor, /value="chat"|wb-chat-depth|wb-role/);
    assert.doesNotMatch(editor, /wb-advanced-enabled|worldBookRules|worldbook-advanced/);
});
test('unsupported tavern positions are preserved and disabled instead of silently injected', () => {
    const c = fixture(), result = c.importWorldBookJson({ entries: { a: { content: 'unsupported', position: 7, constant: true } } }, null);
    assert.equal(result.warnings.length, 1); c.db.worldBooks = result.books;
    assert.equal(c.getStaticWorldBooks({ worldBookIds: [result.books[0].id] }).length, 0);
});
test('find treats special characters literally and supports Unicode and case settings', () => {
    const c = fixture();
    assert.deepEqual(plain(c.findEditorMatches('a.b aXb a.b', 'a.b')), [{ start: 0, end: 3 }, { start: 8, end: 11 }]);
    assert.equal(c.findEditorMatches('你好你好', '你好').length, 2); assert.equal(c.findEditorMatches('Aa', 'a', true).length, 1);
    assert.equal(c.findEditorMatches('anything', '').length, 0);
});
test('expanded document editor preserves per-field scroll progress after reopening', () => {
    const c = fixture(), target = { id: 'character-persona' };
    const firstDraft = { scrollTop: 250, scrollHeight: 1000, clientHeight: 500 };
    c.saveExpandedEditorScroll(target, firstDraft);
    assert.deepEqual(JSON.parse(c.__storage.data['uvu:expanded-editor-scroll:character-persona']), { ratio: 0.5, updatedAt: JSON.parse(c.__storage.data['uvu:expanded-editor-scroll:character-persona']).updatedAt });
    const reopenedDraft = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 };
    c.restoreExpandedEditorScroll(target, reopenedDraft);
    assert.equal(reopenedDraft.scrollTop, 750);
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
    for (const name of ['resolveAuxiliaryApiConfig','resolveChatCompletionsEndpoint','buildChatApiRequest']) {
        const start = utils.indexOf('function ' + name + '('), end = utils.indexOf('\n}',start) + 2;
        vm.runInContext(utils.slice(start,end),c);
    }
    c.fetchAiResponse = async (config,body,headers,url) => { captured.push({config,body,headers,url});return '小猫微笑，表达开心'; };
    assert.equal(await c.recognizeStickerImage('data:image/png;base64,ABC='),'小猫微笑，表达开心');
    const {config,body,url}=captured[0];assert.equal(config.model,'vision');assert.equal(config.streamEnabled,false);assert.ok(url.startsWith('https://vision.invalid'));
    if(provider==='gemini')assert.equal(body.contents[0].parts[1].inline_data.data,'ABC=');
    else assert.equal(body.messages[0].content[1].image_url.url,'data:image/png;base64,ABC=');
});
