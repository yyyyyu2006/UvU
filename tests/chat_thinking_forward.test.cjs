const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
    const c = vm.createContext({ window: {} });
    for (const file of ['chat_thinking', 'chat_features']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/' + file + '.js'), 'utf8'), c);
    return c;
}
test('saved thinking links distinguish consecutive responses, missing/pruned reasoning and archive ownership', () => {
    const c = fixture();
    const history = [
        { id: 'u', role: 'user', content: '你好' },
        { id: 't', role: 'assistant', isThinking: true, content: '<thinking>已保存的内容</thinking>' },
        { id: 'a', role: 'assistant', thinkingMessageId: 't' },
        { id: 'b', role: 'assistant', thinkingMessageId: 't' },
        { id: 'c', role: 'assistant', thinkingMessageId: null },
        { id: 'd', role: 'assistant', thinkingMessageId: 'pruned' },
    ];
    const chat = { history }, before = JSON.stringify(chat);
    for (const id of ['a', 'b']) {
        assert.equal(c.getSavedMessageThinking(chat, id).text, '已保存的内容');
        assert.equal(c.getSavedMessageThinking(chat, id).legacy, false);
    }
    for (const id of ['u', 't', 'c', 'd', 'missing']) assert.equal(c.getSavedMessageThinking(chat, id), null);
    assert.equal(c.getSavedMessageThinking({ history: [] }, 'a'), null);
    assert.equal(JSON.stringify(chat), before);
    history[1].isWithdrawn = true;
    assert.equal(c.getSavedMessageThinking(chat, 'a'), null);
});
test('old archives only use prior saved thinking in the same user segment and report uncertainty', () => {
    const c = fixture(), chat = { history: [
        { id: 't', role: 'assistant', content: '<thinking>旧记录</thinking>' },
        { id: 'a', role: 'assistant' }, { id: 'b', role: 'assistant' },
        { id: 'u', role: 'user' }, { id: 'c', role: 'assistant' },
    ] };
    assert.equal(c.getSavedMessageThinking(chat, 'b').legacy, true);
    assert.equal(c.getSavedMessageThinking(chat, 'b').text, '旧记录');
    assert.equal(c.getSavedMessageThinking(chat, 'c'), null);
    chat.history[0].content = '<thinking>incomplete';
    assert.equal(c.getSavedMessageThinking(chat, 'a'), null);
});

test('viewer preserves returned thinking whitespace and treats markup as text, without fabricating missing content',()=>{
    const c=fixture(),text='\n  原文第一行\n\n    <b>原文标签</b>\n';
    const chat={history:[{id:'t',role:'assistant',isThinking:true,content:'<thinking>'+text+'</thinking>'},
        {id:'r',role:'assistant',thinkingMessageId:'t'}]};
    assert.equal(c.getSavedMessageThinking(chat,'r').text,text);
    chat.history[0].content='<thinking>  \n </thinking>';
    assert.equal(c.getSavedMessageThinking(chat,'r'),null);
});
test('forward display splits real and protocol-escaped newlines without changing stored text', () => {
    const c = fixture();
    for (const separator of ['\n', '\r\n', '\r', '\\n', '\\r\\n', '\\r']) {
        const source = '陈硕:谁啊' + separator + '谢濯：少打听' + separator + '谢濯:反正比你有福气';
        assert.deepEqual(Array.from(c.splitForwardedChatLines(source)), ['陈硕:谁啊', '谢濯：少打听', '谢濯:反正比你有福气']);
    }
    for (const source of [String.raw`陈硕:C:\new\notes.txt`, String.raw`陈硕:代码里的\\n谢濯:literal`, String.raw`陈硕:保留\n没有下一个发言人`]) {
        assert.deepEqual(Array.from(c.splitForwardedChatLines(source)), [source]);
    }
});
