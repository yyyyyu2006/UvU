const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
    const classes = new Set();
    const name = { textContent: '' };
    const content = { textContent: '', title: '', removeAttribute(key) { delete this[key]; } };
    const preview = { classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
        setAttribute(key, value) { this[key] = value; },
        querySelector: selector => selector === '.reply-preview-name' ? name : content };
    const chat = { id: 'alice', myName: '我', myRemarkName: '我的备注', remarkName: '阿晴',
        activeArchiveId: 'archive-1', history: [] };
    const context = vm.createContext({ window: {}, console, setTimeout, clearTimeout, Event,
        db: { characters: [chat], groups: [], apiSettings: {} },
        currentChatId: 'alice', currentChatType: 'private', currentQuoteInfo: null,
        isInMultiSelectMode: false, isGenerating: false,
        messageInput: { value: '已经写好的草稿', focus() { this.focused = true; }, dispatchEvent() {} },
        document: { getElementById: id => id === 'reply-preview-bar' ? preview : null },
        addMessageBubble() {}, triggerHapticFeedback() {}, saveData: async () => {}, renderChatList() {}
    });
    ['chat_ops.js', 'chat_ai.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules', file), 'utf8'), context));
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/chat.js'), 'utf8'), context);
    return { context, chat, preview, name, content, classes };
}

test('quote keeps the complete message and nested brackets instead of truncating at 100 characters', () => {
    const { context, chat, content, classes } = fixture();
    const text = '第一行[括号内容]\n' + '这是一条很长的消息。'.repeat(40);
    chat.history.push({ id: 'long', role: 'assistant', content: `[阿晴的消息：${text}]`, timestamp: 123 });
    context.startQuoteReply('long');
    assert.equal(context.currentQuoteInfo.content, text);
    assert.equal(content.textContent, text);
    assert.equal(context.currentQuoteInfo.archiveId, 'archive-1');
    assert.equal(context.currentQuoteInfo.senderName, '阿晴');
    assert.equal(classes.has('visible'), true);
    assert.equal(context.messageInput.value, '已经写好的草稿');
});

test('self messages use the user display name and retain only the reply text for nested quotes', () => {
    const { context, chat, name } = fixture();
    chat.history.push({ id: 'self', role: 'user', content: '[我引用“前一条”并回复：这是新的回复]' });
    context.startQuoteReply('self');
    assert.equal(context.currentQuoteInfo.senderId, 'user_me');
    assert.equal(context.currentQuoteInfo.content, '这是新的回复');
    assert.equal(name.textContent, '回复 我的备注');
});

test('group quote resolves the sender and remains usable if a member was removed', () => {
    const { context } = fixture();
    context.currentChatType = 'group';
    context.currentChatId = 'group-1';
    context.db.groups.push({ id: 'group-1', members: [{ id: 'member-1', groupNickname: '群友' }],
        history: [{ id: 'group-msg', role: 'assistant', senderId: 'member-1', content: '[群友的消息：下午见]' }] });
    context.startQuoteReply('group-msg');
    assert.equal(context.currentQuoteInfo.senderName, '群友');
    assert.equal(context.currentQuoteInfo.senderId, 'member-1');
    context.db.groups[0].members = [];
    context.startQuoteReply('group-msg');
    assert.equal(context.currentQuoteInfo.senderId, 'member-1');
    assert.equal(context.currentQuoteInfo.senderName, '未知成员');
});

test('media quotes use a readable label and never copy embedded image data', () => {
    const { context } = fixture();
    const cases = [
        [{ content: '[我申请图片识别]', parts: [{ type: 'image', data: 'data:image/png;base64,SECRET' }] }, '[图片]'],
        [{ content: '[阿晴发送的表情包：https://example.com/a.png]' }, '[表情包]'],
        [{ content: '[阿晴的语音：下午好]' }, '[语音]'],
        [{ content: '[阿晴发来的照片/视频：一张照片]' }, '[照片/视频]'],
        [{ content: '', type: 'red-packet' }, '[红包]']
    ];
    cases.forEach(([message, expected]) => assert.equal(context.getQuoteMessageContent(message), expected));
});

test('withdrawn, system, thinking, status and missing messages cannot start a quote', () => {
    const { context, chat, classes } = fixture();
    const messages = [{ role: 'assistant', isWithdrawn: true }, { role: 'system' },
        { role: 'assistant', isThinking: true }, { role: 'assistant', isStatusUpdate: true },
        { role: 'assistant', content: '[system-display:系统提醒]' }];
    messages.forEach((message, i) => { chat.history.push({ id: String(i), content: 'test', ...message }); context.startQuoteReply(String(i)); });
    context.startQuoteReply('missing');
    assert.equal(context.currentQuoteInfo, null);
    assert.equal(classes.has('visible'), false);
});

test('multi-select does not activate quote and cancellation preserves the draft', () => {
    const { context, chat, classes, content, preview } = fixture();
    chat.history.push({ id: 'test', role: 'assistant', content: '[阿晴的消息：你好]' });
    context.isInMultiSelectMode = true;
    context.startQuoteReply('test');
    assert.equal(context.currentQuoteInfo, null);
    context.isInMultiSelectMode = false;
    context.startQuoteReply('test');
    context.cancelQuoteReply();
    assert.equal(context.currentQuoteInfo, null);
    assert.equal(classes.has('visible'), false);
    assert.equal(content.textContent, '');
    assert.equal(preview['aria-hidden'], 'true');
    assert.equal(context.messageInput.value, '已经写好的草稿');
});

test('send stores the sender, original ID, full content and timestamp, then clears the preview', async () => {
    const { context, chat } = fixture();
    chat.history.push({ id: 'original', role: 'assistant', content: '[阿晴的消息：原文]', timestamp: 777 });
    context.startQuoteReply('original');
    context.messageInput.value = '我的回复';
    await context.sendMessage();
    const sent = chat.history.at(-1);
    assert.equal(sent.content, '[我的消息：我的回复]');
    assert.equal(sent.quote.messageId, 'original');
    assert.equal(sent.quote.senderName, '阿晴');
    assert.equal(sent.quote.content, '原文');
    assert.equal(sent.quote.timestamp, 777);
    assert.equal(context.currentQuoteInfo, null);
    assert.equal(context.messageInput.value, '');
});

test('sending in a different chat or archive cannot attach an old quote', async () => {
    const { context, chat } = fixture();
    chat.history.push({ id: 'original', role: 'assistant', content: '[阿晴的消息：原文]' });
    context.startQuoteReply('original');
    chat.activeArchiveId = 'archive-2';
    await context.sendMessage();
    assert.equal(chat.history.at(-1).quote, undefined);
    context.startQuoteReply('original');
    context.db.characters.push({ id: 'bob', myName: '我', history: [] });
    context.currentChatId = 'bob';
    context.messageInput.value = '另一个聊天';
    await context.sendMessage();
    assert.equal(context.db.characters[1].history[0].quote, undefined);
});

test('a new quote selected while an earlier send is saving is preserved', async () => {
    const { context, chat } = fixture();
    chat.history.push({ id: 'one', role: 'assistant', content: '[阿晴的消息：第一条]' },
        { id: 'two', role: 'assistant', content: '[阿晴的消息：第二条]' });
    let finishSave;
    context.saveData = () => new Promise(resolve => { finishSave = resolve; });
    context.startQuoteReply('one');
    const sending = context.sendMessage();
    context.startQuoteReply('two');
    finishSave();
    await sending;
    assert.equal(context.currentQuoteInfo.id, 'two');
});

test('empty send keeps the pending quote and does not create a message', async () => {
    const { context, chat } = fixture();
    chat.history.push({ id: 'original', role: 'assistant', content: '[阿晴的消息：你好]' });
    context.startQuoteReply('original');
    context.messageInput.value = '   ';
    await context.sendMessage();
    assert.equal(chat.history.length, 1);
    assert.equal(context.currentQuoteInfo.id, 'original');
});

test('AI quote context uses the correct private/group speaker and keeps bracketed reply content', () => {
    const { context, chat } = fixture();
    const message = { role: 'user', content: '[我的消息：选[第二个]吧]', quote: { senderName: '阿晴', content: '选哪个？' } };
    assert.equal(context.formatQuotedUserMessage(message, chat, 'private'), '[我引用“阿晴：选哪个？”并回复：选[第二个]吧]');
    assert.equal(context.formatQuotedUserMessage(message, { me: { nickname: '群里的我' } }, 'group'), '[群里的我引用“阿晴：选哪个？”并回复：选[第二个]吧]');
});
