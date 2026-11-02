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
        messageArea: { querySelector: selector => rows.find(row => selector.includes('"' + row.dataset.id + '"')), querySelectorAll: selector => selector === '.select-message-range-btn' ? [] : rows },
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

test('sharing opens internal recipient picker and retains selection until sending', async () => {
    const f = fixture(); f.c.enterMultiSelectMode('m0'); const opened = [];
    f.c.openMessageForwardPicker = (...args) => opened.push(args);
    await f.c.shareSelectedMessages();
    assert.equal(opened.length, 1); assert.equal(opened[0][0], f.chat);
    assert.equal(opened[0][1], 'private'); assert.deepEqual([...opened[0][2]], ['m0']);
    assert.equal(f.downloads.length, 0); assert.equal(f.c.selectedMessageIds.size, 1);
});

test('floating range endpoint follows visible bounds and arrow direction in both directions', () => {
    const f = fixture(), rows = f.rows.map((row, i) => ({ id: row.dataset.id, top: i * 50, bottom: i * 50 + 40 }));
    const target = (anchor, selected, top, bottom) => f.c.getMessageRangeShortcutTarget(f.chat.history, anchor, new Set(selected), rows, { top, bottom });
    assert.equal(JSON.stringify(target('m7', ['m7'], 52, 245)), JSON.stringify({ id: 'm2', direction: 'up' }));
    assert.equal(JSON.stringify(target('m0', ['m0'], 52, 245)), JSON.stringify({ id: 'm4', direction: 'down' }));
    assert.equal(target('m0', ['m0', 'm2', 'm3', 'm4'], 52, 245), null);
    assert.equal(target('deleted', [], 0, 400), null);
    assert.equal(target('m0', ['m0'], 500, 600), null);
});

test('floating shortcut handles tall media, excludes hidden or missing rows, and respects selected rows', () => {
    const f = fixture();
    const target = f.c.getMessageRangeShortcutTarget(f.chat.history, 'm7', new Set(['m7']),
        [{ id: 'hidden-system', top: 30, bottom: 40 }, { id: 'm2', top: -100, bottom: 900 }], { top: 0, bottom: 400 });
    assert.equal(target.id, 'm2'); assert.equal(target.direction, 'up');
    const selected = f.c.getMessageRangeShortcutTarget(f.chat.history, 'm7', new Set(['m7', 'm1']),
        [{ id: 'm1', top: 10, bottom: 50 }, { id: 'm2', top: 60, bottom: 100 }], { top: 0, bottom: 400 });
    assert.equal(selected.id, 'm2');
});

test('visible anchor defaults downward even when there are more messages above it', () => {
    const f = fixture(), rows = f.rows.map((row, i) => ({ id: row.dataset.id, top: i * 50, bottom: i * 50 + 40 }));
    const target = direction => f.c.getMessageRangeShortcutTarget(f.chat.history, 'm5', new Set(['m5']), rows, { top: 0, bottom: 400, direction });
    assert.equal(target().id, 'm7'); assert.equal(target().direction, 'down');
    assert.equal(target('up').id, 'm0'); assert.equal(target('up').direction, 'up');
});

test('requested direction never falls back to selecting the opposite side', () => {
    const f = fixture(), rows = f.rows.map((row, i) => ({ id: row.dataset.id, top: i * 50, bottom: i * 50 + 40 }));
    assert.equal(f.c.getMessageRangeShortcutTarget(f.chat.history, 'm5', new Set(['m5','m6','m7']), rows, { top: 0, bottom: 400, direction: 'down' }), null);
});

test('failed deletion restores history and synchronized archive without clearing selection', async () => {
    const f = fixture(); f.chat.archives = [{ id: 'archive1', data: {} }];
    f.c.enterMultiSelectMode('m1'); f.c.selectMessagesTo('m4');
    f.c.saveData = async () => { f.chat.archives[0].data.history = JSON.parse(JSON.stringify(f.chat.history)); throw new Error('quota'); };
    await f.c.deleteSelectedMessages();
    assert.equal(f.chat.history.length, 8); assert.equal(f.chat.archives[0].data.history.length, 8);
    assert.equal(f.c.selectedMessageIds.size, 4); assert.equal(f.c.isInMultiSelectMode, true);
    assert.match(f.toasts.at(-1), /恢复/);
});
