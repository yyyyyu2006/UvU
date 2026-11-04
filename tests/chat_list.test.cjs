const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname, '../js/modules', file), 'utf8');

function fixture() {
    const privateChat = { id: 'c', remarkName: '角色', activeArchiveId: 'a', history: [], archives: [{ id: 'a', data: { history: [] } }], useCustomBubbleCss: true, customBubbleCss: '.chat-bubble{color:red}' };
    const group = { id: 'g', name: '群聊', activeArchiveId: 'b', history: [], archives: [{ id: 'b', data: { history: [] } }], useCustomBubbleCss: true, customBubbleCss: '.chat-bubble{color:blue}' };
    let items, saves = 0, styleUpdates = 0, confirms = 0;
    const c = vm.createContext({ db: { characters: [privateChat], groups: [group] }, currentChatId: 'c', currentChatType: 'private',
        longPressTimer: null,
        window: {}, document: { addEventListener() {}, getElementById() { return null; } }, console: { log() {}, warn() {}, error() {} },
        saveData: async () => { saves++; }, renderChatList() {}, showToast() {}, confirm: () => { confirms++; return true; },
        updateCustomBubbleStyle: () => { styleUpdates++; }, createContextMenu: menu => { items = menu; },
        setTimeout, clearTimeout });
    vm.runInContext(source('chat_ops.js'), c);
    vm.runInContext(source('chat_list.js'), c);
    c.renderChatList = () => {};
    return { c, privateChat, group, menu: () => items, saves: () => saves, styleUpdates: () => styleUpdates, confirms: () => confirms };
}

test('long-press menu restores only the selected chat custom beautification', async () => {
    const f = fixture(); f.c.handleChatListLongPress('c', 'private', 10, 10);
    const action = f.menu().find(item => item.label === '恢复默认对话美化').action;
    await action();
    assert.equal(f.privateChat.useCustomBubbleCss, false); assert.equal(f.privateChat.customBubbleCss, '');
    assert.equal(f.group.useCustomBubbleCss, true); assert.equal(f.group.customBubbleCss, '.chat-bubble{color:blue}');
    assert.equal(f.styleUpdates(), 1); assert.equal(f.saves(), 1); assert.equal(f.confirms(), 1);
});

test('restoring background chat CSS does not remove the active chat style tag', async () => {
    const f = fixture(); f.c.handleChatListLongPress('g', 'group', 10, 10);
    await f.menu().find(item => item.label === '恢复默认对话美化').action();
    assert.equal(f.group.useCustomBubbleCss, false); assert.equal(f.styleUpdates(), 0);
});

test('failed default-style persistence restores the original beautification', async () => {
    const f = fixture(); f.c.saveData = async () => { throw Error('quota'); };
    f.c.handleChatListLongPress('c', 'private', 10, 10);
    const action = f.menu().find(item => item.label === '恢复默认对话美化').action;
    await action();
    assert.equal(f.privateChat.useCustomBubbleCss, true); assert.equal(f.privateChat.customBubbleCss, '.chat-bubble{color:red}');
    assert.equal(f.styleUpdates(), 0);
});
