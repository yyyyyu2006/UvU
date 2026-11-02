const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
    const makeElement = id => {
        const classes = new Set();
        return { dataset: { id }, style: {}, textContent: '', disabled: false, attributes: {},
            classList: { add: value => classes.add(value), remove: value => classes.delete(value),
                toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); }, contains: value => classes.has(value) },
            setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } };
    };
    const rows = Array.from({ length: 8 }, (_, i) => makeElement('m' + i));
    const elements = new Map();
    const element = id => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); };
    const chat = { id: 'alice', activeArchiveId: 'archive1', realName: '晴', remarkName: '晴', myName: '我',
        history: rows.map((row, i) => ({ id: row.dataset.id, role: i % 2 ? 'assistant' : 'user', content: '[' + (i % 2 ? '晴' : '我') + '的消息：正文' + i + ']', timestamp: 1700000000000 + i * 1000 })) };
    const menu = [], toasts = [], downloads = [];
    const c = vm.createContext({ db: { characters: [chat], groups: [] }, console, window: {},
        currentChatId: chat.id, currentChatType: 'private', isInMultiSelectMode: false, selectedMessageIds: new Set(), longPressTimer: null, isDebugMode: false,
        chatRoomHeaderDefault: element('default'), chatRoomHeaderSelect: element('select'), multiSelectBar: element('bar'), chatRoomScreen: element('screen'),
        selectCount: element('count'), deleteSelectedBtn: element('delete'),
        messageArea: { querySelector: selector => rows.find(row => selector.includes('"' + row.dataset.id + '"')), querySelectorAll: () => rows },
        document: { getElementById: element, querySelector: () => element('input'), body: { appendChild() {} }, createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }) },
        File, navigator: {}, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, setTimeout: () => 0, clearTimeout() {},
        createContextMenu: items => menu.push(items), removeContextMenu() {}, triggerHapticFeedback() {}, showToast: message => toasts.push(message),
        saveData: async () => {}, renderMessages() {}, renderChatList() {}, currentPage: 1,
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_ops.js'), 'utf8'), c);
    c.recalculateChatStatus = () => {};
    return { c, chat, rows, element, menu, toasts, downloads };
}

test('range includes both ends in either direction, preserves other selections, and has no duplicates', () => {
    const f = fixture(); f.c.enterMultiSelectMode('m2'); f.c.selectMessagesTo('m5');
    assert.deepEqual([...f.c.selectedMessageIds], ['m2', 'm3', 'm4', 'm5']);
    f.c.selectMessagesTo('m0'); assert.equal(f.c.selectedMessageIds.size, 6);
    assert.ok(f.rows.slice(0, 6).every(row => row.classList.contains('multi-select-selected')));
    f.c.toggleMessageSelection('m7'); f.c.selectMessagesTo('m6');
    assert.equal(f.c.selectedMessageIds.size, 8); assert.equal(f.c.selectCount.textContent, '已选择 8 项');
});

test('range excludes unrendered messages, including hidden originals and system data', () => {
    const f = fixture(); f.rows.splice(3, 1); f.c.enterMultiSelectMode('m1'); f.c.selectMessagesTo('m5');
    assert.deepEqual([...f.c.selectedMessageIds], ['m1', 'm2', 'm4', 'm5']);
});

test('unchecking the anchor falls back to a remaining selection; empty selection starts at target', () => {
    const f = fixture(); f.c.enterMultiSelectMode('m1'); f.c.toggleMessageSelection('m4'); f.c.toggleMessageSelection('m4');
    f.c.selectMessagesTo('m3'); assert.deepEqual([...f.c.selectedMessageIds], ['m1', 'm2', 'm3']);
    f.c.enterMultiSelectMode(); f.c.selectMessagesTo('m6'); assert.deepEqual([...f.c.selectedMessageIds], ['m6']);
});

test('long press offers multi-select normally and select-to-here in screenshot mode', () => {
    const f = fixture(); f.c.handleMessageLongPress(f.rows[0], 10, 10);
    assert.ok(f.menu.at(-1).some(item => item.label === '多选'));
    f.c.enterMultiSelectMode('m0', 'capture'); f.c.handleMessageLongPress(f.rows[3], 10, 10);
    assert.equal(f.menu.at(-1)[0].label, '选到这里'); f.menu.at(-1)[0].action();
    assert.equal(f.element('capture-select-count').textContent, '已选择 4 项');
});

test('archive change blocks selection, sharing and deletion using an old selection', async () => {
    const f = fixture(); f.c.enterMultiSelectMode('m0'); f.chat.activeArchiveId = 'archive2';
    f.c.selectMessagesTo('m5'); await f.c.shareSelectedMessages(); await f.c.deleteSelectedMessages();
    assert.equal(f.c.selectedMessageIds.size, 1); assert.equal(f.chat.history.length, 8); assert.equal(f.downloads.length, 0);
});

test('range deletion removes exactly selected records and clears selection', async () => {
    const f = fixture(); f.c.enterMultiSelectMode('m1'); f.c.selectMessagesTo('m4'); await f.c.deleteSelectedMessages();
    assert.deepEqual(f.chat.history.map(m => m.id), ['m0', 'm5', 'm6', 'm7']);
    assert.equal(f.c.isInMultiSelectMode, false); assert.equal(f.c.selectedMessageIds.size, 0);
});

test('transcript preserves order, names and quotes while labeling media and withdrawals', () => {
    const f = fixture(); f.chat.history[1].quote = { senderName: '我', content: '原引用' };
    f.chat.history[2].isWithdrawn = true; f.chat.history[3].parts = [{ type: 'image', data: 'secret-image-data' }];
    const text = f.c.buildSelectedChatText(f.chat, 'private', new Set(['m3', 'm2', 'm1']));
    assert.match(text, /共 3 条消息/); assert.match(text, /引用 我：原引用/); assert.match(text, /\[消息已撤回\]/);
    assert.match(text, /\[图片\]/); assert.ok(!text.includes('正文2')); assert.ok(!text.includes('secret-image-data'));
    assert.ok(text.indexOf('正文1') < text.indexOf('[消息已撤回]'));
    const group = { ...f.chat, name: '群聊', me: { nickname: '群里的我' }, members: [{ id: 'member', groupNickname: '阿晴同学' }] };
    group.history[1].senderId = 'member';
    assert.match(f.c.buildSelectedChatText(group, 'group', new Set(['m0', 'm1'])), /群里的我[\s\S]*阿晴同学/);
});

test('native sharing cancellation keeps selection; unsupported browser downloads text', async () => {
    const f = fixture(); f.c.enterMultiSelectMode('m0'); const shared = [];
    f.c.navigator.canShare = () => true; f.c.navigator.share = async data => shared.push(data);
    await f.c.shareSelectedMessages(); assert.equal(shared.length, 1); assert.match(await shared[0].files[0].text(), /正文0/);
    f.c.navigator.share = async () => { const error = new Error(); error.name = 'AbortError'; throw error; };
    await f.c.shareSelectedMessages(); assert.equal(f.downloads.length, 0); assert.equal(f.c.selectedMessageIds.size, 1);
    delete f.c.navigator.share; await f.c.shareSelectedMessages(); assert.equal(f.downloads.length, 1); assert.match(f.downloads[0], /\.txt$/);
});
