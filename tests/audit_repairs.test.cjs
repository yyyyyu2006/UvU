const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname, '../js', file), 'utf8');

test('status recalculation handles punctuation with the actual loaded script order', () => {
    const c=vm.createContext({window:{},document:{addEventListener(){},getElementById(){return null;}},currentChatId:null,console});
    for(const file of ['utils.js','modules/chat_ops.js','modules/settings_chat.js']) vm.runInContext(source(file),c);
    for(const name of ['A[', 'A+B', 'A(猫)', 'x.*']) {
        const chat={id:'c',realName:name,history:[{content:`[${name}更新状态为：忙碌]`}]};
        c.recalculateChatStatus(chat);assert.equal(chat.status,'忙碌');
    }
});

test('expanded editor progress belongs to its character, worldbook or global field', () => {
    const values=new Map();let world='book-a';
    const c=vm.createContext({currentChatType:'private',currentChatId:'a',localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},document:{getElementById:id=>id==='world-book-id'?{value:world}:null}});
    vm.runInContext(source('modules/text_editor.js'),c);
    const field={id:'setting-char-persona'};
    c.saveExpandedEditorScroll(field,{scrollTop:50,scrollHeight:200,clientHeight:100});
    c.currentChatId='b';assert.equal(c.readExpandedEditorScroll(field),null);
    c.saveExpandedEditorScroll(field,{scrollTop:80,scrollHeight:200,clientHeight:100});
    c.currentChatId='a';assert.equal(c.readExpandedEditorScroll(field).ratio,0.5);
    const book={id:'world-book-content'};c.saveExpandedEditorScroll(book,{scrollTop:30,scrollHeight:200,clientHeight:100});
    world='book-b';assert.equal(c.readExpandedEditorScroll(book),null);world='book-a';assert.equal(c.readExpandedEditorScroll(book).ratio,0.3);
    const global={id:'global-css-input'};const key=c.getExpandedEditorScrollKey(global);c.currentChatId='b';assert.equal(c.getExpandedEditorScrollKey(global),key);
});
