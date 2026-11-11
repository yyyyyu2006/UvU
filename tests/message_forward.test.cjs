const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
    const source = { id: 'source', realName: '晴', myName: '我', apiKey: 'secret', history: [
        { id: '1', role: 'user', content: '[我的消息：原文]', timestamp: 1700000000000 },
        { id: '2', role: 'assistant', content: '[晴的消息：回复]', timestamp: 1700000001000, quote: { senderName: '我', content: '原文', messageId: 'private-id' } },
        { id: '3', role: 'assistant', content: '<thinking>secret thinking</thinking>', isThinking: true },
        { id: '4', role: 'assistant', content: 'private withdrawn', isWithdrawn: true, parts: [{ type: 'image', data: 'https://example.com/private.png' }] },
        { id: '5', role: 'user', content: '[我的消息：图片]', parts: [{ type: 'image', data: 'data:image/png;base64,YQ==' }] },
    ] };
    const target = { id: 'target', activeArchiveId: 'a', history: [], archives: [{ id: 'a', data: { history: [] } }] };
    const group = { id: 'group', activeArchiveId: 'g', history: [], members: [] };
    const c = vm.createContext({ console, db: { characters: [source, target], groups: [group] }, window: {}, saveData: async () => {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_ops.js'), 'utf8'), c);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/message_forward.js'), 'utf8'), c);
    const snapshot = () => c.buildMessageForwardSnapshot(source, 'private', new Set(source.history.map(m => m.id)));
    return { c, source, target, group, snapshot };
}

test('forward snapshot preserves chronological text, quotes and images without private settings or withdrawn content', () => {
    const f = fixture(), snapshot = f.snapshot();
    assert.equal(snapshot.records.length, 4);
    const text = f.c.messageForwardText(snapshot);
    assert.match(text, /我[\s\S]*原文[\s\S]*晴[\s\S]*引用 我：原文/);
    assert.match(text, /消息已撤回/); assert.match(text, /图片/);
    assert.equal(snapshot.records.at(-1).images[0], 'data:image/png;base64,YQ==');
    const json = JSON.stringify(snapshot);
    for (const secret of ['secret', 'private-id', 'private withdrawn', 'private.png']) assert.ok(!json.includes(secret));
    f.source.history[1].quote.content = 'changed'; assert.equal(snapshot.records[1].quote.content, '原文');
});

test('group snapshot uses original group nicknames and validates image URLs', () => {
    const f = fixture(); f.source.me = { nickname: '群里的我' }; f.source.members = [{ id: 'member', groupNickname: '晴同学' }]; f.source.history[1].senderId = 'member';
    const snapshot = f.c.buildMessageForwardSnapshot(f.source, 'group', new Set(['1', '2']));
    assert.equal(snapshot.records[0].senderName, '群里的我'); assert.equal(snapshot.records[1].senderName, '晴同学');
    for (const url of ['javascript:alert(1)', 'blob:local', 'data:image/svg+xml;base64,YQ==', 'https://bad url']) assert.equal(f.c.isForwardImageUrl(url), false);
    assert.equal(f.c.isForwardImageUrl('https://example.com/a.png'), true);
});

test('forward appends a single user card and complete normal API text without changing source or triggering API', async () => {
    const f = fixture(), before = JSON.stringify(f.source), snapshot = f.snapshot(); let saves = 0; f.c.saveData = async () => saves++;
    const message = await f.c.sendMessageForward(snapshot, 'target', 'private', 'a');
    assert.equal(f.target.history.length, 1); assert.equal(message.type, 'forwarded-chat'); assert.equal(message.role, 'user');
    assert.equal(message.parts[0].text, f.c.messageForwardText(snapshot)); assert.equal(message.content, message.parts[0].text);
    snapshot.records[0].content = 'changed'; assert.equal(message.forwardedChat.records[0].content, '原文');
    assert.equal(JSON.stringify(f.source), before); assert.equal(saves, 1);
    const groupMessage = await f.c.sendMessageForward(f.snapshot(), 'group', 'group', 'g'); assert.equal(groupMessage.senderId, 'user_me');
});

test('stale recipient or archive is rejected before writing', async () => {
    const f = fixture();
    await assert.rejects(f.c.sendMessageForward(f.snapshot(), 'target', 'private', 'stale'), /存档已改变/);
    await assert.rejects(f.c.sendMessageForward(f.snapshot(), 'deleted', 'private', 'a'), /会话/);
    assert.equal(f.target.history.length, 0);
});

test('picker target snapshot rejects a same-id replacement, history replacement and group identity change',async()=>{
    for(const action of ['replace','history','persona','members']){
        const f=fixture(),target=action==='members'?f.group:f.target,type=action==='members'?'group':'private';
        const binding=f.c.captureMessageForwardTarget(target,type),snapshot=f.snapshot();
        if(action==='replace')f.c.db.characters[1]={...target,history:[]};
        if(action==='history')target.history=[];
        if(action==='persona')target.myPersona='other user';
        if(action==='members')target.members=[{id:'new-member'}];
        await assert.rejects(f.c.sendMessageForward(snapshot,target.id,type,target.activeArchiveId,binding),/变化|改变/);
        assert.equal(target.history.length,0,action);
    }
});

test('failed save rolls back only appended card in live history and synchronized archive', async () => {
    const f = fixture(); f.target.history.push({ id: 'existing' });
    f.c.saveData = async () => { f.target.archives[0].data.history = JSON.parse(JSON.stringify(f.target.history)); f.target.history.push({ id: 'concurrent' }); throw new Error('disk full'); };
    await assert.rejects(f.c.sendMessageForward(f.snapshot(), 'target', 'private', 'a'), /保存失败/);
    assert.deepEqual(f.target.history.map(m => m.id), ['existing', 'concurrent']);
    assert.deepEqual(f.target.archives[0].data.history.map(m => m.id), ['existing']);
});

test('archive switch during a failed save does not remove new archive messages', async () => {
    const f = fixture(), oldHistory = f.target.history;
    f.c.saveData = async () => { f.target.archives[0].data.history = JSON.parse(JSON.stringify(oldHistory)); f.target.activeArchiveId = 'b'; f.target.history = [{ id: 'new-archive' }]; throw new Error('failure'); };
    await assert.rejects(f.c.sendMessageForward(f.snapshot(), 'target', 'private', 'a'));
    assert.equal(oldHistory.length, 0); assert.equal(f.target.archives[0].data.history.length, 0); assert.equal(f.target.history[0].id, 'new-archive');
});

test('forwarding a record card again includes its contents rather than only a media placeholder', () => {
    const f = fixture(); f.source.history.push({ id: 'nested', role: 'user', type: 'forwarded-chat', forwardedChat: f.snapshot(), content: 'old card' });
    const snapshot = f.c.buildMessageForwardSnapshot(f.source, 'private', new Set(['nested']));
    assert.match(snapshot.records[0].content, /原文[\s\S]*回复/);
});
test('forward preflight measures records and images and rejects oversized snapshots without writing',async()=>{const f=fixture(),snapshot=f.snapshot();assert.equal(typeof f.c.getMessageForwardSummary,'function');const report=f.c.getMessageForwardSummary(snapshot);assert.equal(report.records,4);assert.equal(report.images,1);assert.ok(report.estimatedBytes>0);snapshot.records[0].content='长'.repeat(9*1024*1024);await assert.rejects(f.c.sendMessageForward(snapshot,'target','private','a'),/过大|16MB|缩小/);assert.equal(f.target.history.length,0);});
