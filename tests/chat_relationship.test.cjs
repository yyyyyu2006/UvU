const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../js', file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
    const chat = { id: 'c', activeArchiveId: 'a', history: [{ id: 'good', role: 'user', content: 'accepted story' }] };
    const requests = [], toasts = [];
    const c = vm.createContext({ db: { characters: [chat], groups: [], apiSettings: {} },
        currentChatId: 'c', currentChatType: 'private', AbortController, setTimeout, clearTimeout,
        showToast: message => toasts.push(message), saveData: async () => {},
        resolveAutoMemoryApi: () => ({ url: 'https://test.invalid', key: 'fake', model: 'test' }),
        buildChatApiRequest: (config, messages) => ({ requestBody: messages, endpoint: config.url, headers: {} }),
        fetchAiResponse: async (config, body) => { requests.push(body); return '{"restore":true}'; },
        filterHistoryForAI: (chat, history) => history });
    vm.runInContext(read('modules/chat_relationship.js'), c);
    c.refreshRelationshipUI = () => {};
    return { c, chat, requests, toasts };
}

test('legacy contacts default to friends; both blocking directions are independent and groups remain usable', () => {
    const { c, chat } = fixture();
    assert.equal(c.relationshipCanChat(chat), true);
    for (const side of ['self', 'peer']) for (const kind of ['blocked', 'deleted']) {
        chat.friendRelationship = { [side]: { [kind]: true } };
        assert.equal(c.relationshipCanChat(chat), false);
        assert.equal(c.relationshipCanChat(chat, 'group'), true);
        assert.equal(c.relationshipCanSend(chat), side !== 'self');
    }
});

test('failed media/text/forward messages retain data and stay excluded after recovery or context toggle', () => {
    const { c, chat } = fixture();
    for (const [kind, reason] of [['blocked', 'blocked'], ['deleted', 'deleted']]) {
        chat.friendRelationship = { peer: { [kind]: true } };
        const m = { id: 'bad', role: 'user', content: 'not delivered', parts: [{ type: 'image', data: 'data:image/png;base64,abc' }] };
        c.prepareRelationshipMessage(chat, m);
        assert.equal(m.relationshipDelivery, reason); assert.equal(m.isContextDisabled, true);
        chat.friendRelationship = {};
        c.prepareRelationshipMessage(chat, m);
        assert.equal(m.relationshipDelivery, reason);
        const utils = read('utils.js');
        vm.runInContext(utils.slice(utils.indexOf('function filterHistoryForAI('), utils.indexOf('function resolveAuxiliaryApiConfig(')), c);
        m.isContextDisabled = false;
        assert.equal(c.filterHistoryForAI(chat, [m], true).length, 0);
        assert.match(m.parts[0].data, /^data:/);
    }
});

test('ordinary outgoing messages do not receive relationship fields', () => {
    const { c, chat } = fixture();
    const m = { role: 'user', content: 'normal' };
    c.prepareRelationshipMessage(chat, m);
    assert.deepEqual(m, { role: 'user', content: 'normal' });
    chat.friendRelationship = { peer: { blocked: true } };
    c.prepareRelationshipMessage(chat, m, 'group');
    assert.equal(m.relationshipDelivery, undefined);
});

test('manual recovery is default and never calls an API', async () => {
    const f = fixture(); f.chat.friendRelationship = { peer: { blocked: true } };
    assert.equal(await f.c.checkRelationshipRecovery(f.chat, true), false);
    assert.equal(f.requests.length, 0);
});

test('character-led blacklist is opt-in, rate-limited, and only evaluates delivered context', async () => {
    const f = fixture();
    f.chat.history = [
        { role: 'user', content: 'A' }, { role: 'assistant', content: 'a' },
        { role: 'user', content: 'B' }, { role: 'user', content: 'rejected', relationshipDelivery: 'blocked' },
        { role: 'assistant', content: '<thinking>hidden reasoning</thinking>', isThinking: true }
    ];
    assert.equal(await f.c.checkCharacterBlacklist(f.chat), false);
    assert.equal(f.requests.length, 0);
    f.chat.friendRelationship = { autonomy: { enabled: true, everyUserMessages: 2 } };
    f.c.fetchAiResponse = async (_config, body) => { f.requests.push(body); return '{"block":true}'; };
    assert.equal(await f.c.checkCharacterBlacklist(f.chat), true);
    assert.equal(f.c.relationshipCanChat(f.chat), false);
    const sent = JSON.stringify(f.requests[0]);
    assert.match(sent, /acceptedHistory/);
    assert.doesNotMatch(sent, /rejected|hidden reasoning/);
    assert.equal(f.chat.friendRelationship.peer.blocked, true);
    assert.equal(await f.c.checkCharacterBlacklist(f.chat), false);
    assert.equal(f.requests.length, 1);
});

test('character blacklist decisions reject malformed and stale API results', async () => {
    for (const stale of [false, true]) {
        const f = fixture();
        f.chat.history = [{ role: 'user', content: 'one' }];
        f.chat.friendRelationship = { autonomy: { enabled: true, everyUserMessages: 1 } };
        if (!stale) f.c.fetchAiResponse = async () => '{"block":"true"}';
        else {
            let finish, started;
            const ready = new Promise(resolve => started = resolve);
            f.c.fetchAiResponse = async () => { started(); return new Promise(resolve => finish = resolve); };
            const pending = f.c.checkCharacterBlacklist(f.chat);
            await ready;
            f.chat.activeArchiveId = 'b';
            f.chat.history.push({ role: 'user', content: 'new message while judging' });
            finish('{"block":true}');
            assert.equal(await pending, false);
        }
        if (!stale) assert.equal(await f.c.checkCharacterBlacklist(f.chat), false);
        assert.equal(f.chat.friendRelationship.peer?.blocked, false);
    }
});

test('timed recovery restores peer relation without clearing my blacklist or deleting history', async () => {
    const f = fixture(); const history = f.chat.history;
    f.chat.friendRelationship = { self: { blocked: true }, peer: { blocked: true, deleted: true }, recovery: { mode: 'timer', restoreAt: Date.now() - 1 } };
    assert.equal(await f.c.checkRelationshipRecovery(f.chat), true);
    assert.equal(f.chat.friendRelationship.self.blocked, true);
    assert.deepEqual(plain(f.chat.friendRelationship.peer), { blocked: false, deleted: false });
    assert.equal(f.chat.history, history); assert.equal(f.requests.length, 0);
});

test('future timer does not restore early', async () => {
    const f = fixture(); f.chat.friendRelationship = { peer: { deleted: true }, recovery: { mode: 'timer', restoreAt: Date.now() + 100000 } };
    assert.equal(await f.c.checkRelationshipRecovery(f.chat), false);
    assert.equal(f.c.relationshipCanChat(f.chat), false);
});

test('conditional recovery uses independent instructions, accepted story and friend request, and respects cooldown', async () => {
    const f = fixture();
    f.chat.friendRelationship = { peer: { blocked: true }, outgoingRequest: { text: 'a sincere apology' }, recovery: { mode: 'condition', condition: 'after apology' } };
    f.chat.history.push({ id: 'bad', role: 'user', content: 'rejected secret', relationshipDelivery: 'blocked' }, { id: 'thinking', role: 'assistant', content: 'private reasoning', isThinking: true });
    f.c.fetchAiResponse = async (config, body) => { f.requests.push(body); return '{"restore":false}'; };
    assert.equal(await f.c.checkRelationshipRecovery(f.chat), false);
    const data = JSON.parse(f.requests[0][1].content);
    assert.match(data.acceptedHistory, /accepted story/);
    assert.ok(!data.acceptedHistory.includes('rejected secret'));
    assert.ok(!data.acceptedHistory.includes('private reasoning'));
    assert.equal(data.friendRequest, 'a sincere apology');
    await f.c.checkRelationshipRecovery(f.chat); assert.equal(f.requests.length, 1);
    f.c.fetchAiResponse = async () => '{"restore":true}';
    assert.equal(await f.c.checkRelationshipRecovery(f.chat, true), true);
    assert.equal(f.c.relationshipCanChat(f.chat), true);
});

test('stale conditional response after archive switch cannot restore the new story', async () => {
    const f = fixture(); f.chat.friendRelationship = { peer: { blocked: true }, recovery: { mode: 'condition', condition: 'test' } };
    let finish, begin; const ready = new Promise(resolve => begin = resolve);
    f.c.fetchAiResponse = async () => { begin(); return new Promise(resolve => finish = resolve); };
    const pending = f.c.checkRelationshipRecovery(f.chat, true); await ready;
    f.chat.activeArchiveId = 'b'; f.chat.history = [];
    f.chat.friendRelationship = { peer: { deleted: true } };
    finish('{"restore":true}'); assert.equal(await pending, false);
    assert.equal(f.chat.friendRelationship.peer.deleted, true);
});

test('conditional recovery discards decisions after same-array edits, withdrawal or deletion', async () => {
    for (const mutate of [history => { history[0].content = 'edited'; },
        history => { history[0].isWithdrawn = true; }, history => { history.splice(0, 1); }]) {
        const f = fixture();
        f.chat.friendRelationship = { peer: { blocked: true }, recovery: { mode: 'condition', condition: 'test' } };
        let finish, begin; const ready = new Promise(resolve => begin = resolve);
        f.c.fetchAiResponse = async () => { begin(); return new Promise(resolve => finish = resolve); };
        const pending = f.c.checkRelationshipRecovery(f.chat, true); await ready;
        mutate(f.chat.history); finish('{"restore":true}');
        assert.equal(await pending, false);
        assert.equal(f.chat.friendRelationship.peer.blocked, true);
    }
});

test('concurrent conditional checks share one request and changed settings invalidate the result', async () => {
    const f = fixture(); f.chat.friendRelationship = { peer: { blocked: true }, recovery: { mode: 'condition', condition: 'test' } };
    let finish, begin; const ready = new Promise(resolve => begin = resolve);
    f.c.fetchAiResponse = async () => { f.requests.push(1); begin(); return new Promise(resolve => finish = resolve); };
    const pending = f.c.checkRelationshipRecovery(f.chat, true); await ready;
    assert.equal(await f.c.checkRelationshipRecovery(f.chat, true), false);
    await f.c.updateChatRelationship(f.chat, r => { r.recovery.mode = 'manual'; });
    finish('{"restore":true}'); assert.equal(await pending, false); assert.equal(f.requests.length, 1);
});

test('relationship save failure restores live relation and archive snapshot', async () => {
    const f = fixture(); const before = { peer: { blocked: true }, revision: 3 };
    f.chat.friendRelationship = before;
    f.chat.archives = [{ id: 'a', data: {} }];
    f.c.saveData = async () => { f.chat.archives[0].data.friendRelationship = plain(f.chat.friendRelationship); throw new Error('quota'); };
    await assert.rejects(f.c.updateChatRelationship(f.chat, r => { r.peer.blocked = false; }), /保存失败/);
    assert.equal(f.chat.friendRelationship, before);
    assert.deepEqual(plain(f.chat.archives[0].data.friendRelationship), before);
    f.c.saveData = async () => {};
    await f.c.updateChatRelationship(f.chat, r => { r.peer.blocked = false; });
    assert.equal(f.c.relationshipCanChat(f.chat), true);
});

test('invalid or failed recovery response never restores friendship', async () => {
    for (const response of ['oops', '{"restore":"true"}', '{}']) {
        const f = fixture(); f.chat.friendRelationship = { peer: { deleted: true }, recovery: { mode: 'condition', condition: 'test' } };
        f.c.fetchAiResponse = async () => response;
        try { await f.c.checkRelationshipRecovery(f.chat, true); } catch (_) {}
        assert.equal(f.chat.friendRelationship.peer.deleted, true);
    }
});

test('blocked and deleted chats do not reach foreground, background or reroll API paths', async () => {
    const f = fixture();
    Object.assign(f.c, { isGenerating: false, AudioManager: { unlock() {} }, console: { log() {}, error() {} } });
    vm.runInContext(read('modules/chat_ai.js'), f.c);
    for (const kind of ['blocked', 'deleted']) {
        f.chat.friendRelationship = { peer: { [kind]: true } };
        await f.c.getAiReply('c', 'private');
        await f.c.getAiReply('c', 'private', true);
        await f.c.handleRegenerate();
    }
    assert.equal(f.requests.length, 0);
    assert.equal(f.chat.history.length, 1);
});

test('rejected messages are ineligible for small summaries and vector history even if toggled', () => {
    const f = fixture(); vm.runInContext(read('modules/auto_memory.js'), f.c);
    assert.equal(f.c.isAutoMemoryFloor({ id: 'bad', role: 'user', content: 'rejected', relationshipDelivery: 'blocked' }), false);
    assert.match(read('modules/auto_memory.js'), /!message\.relationshipDelivery/);
});

test('relationship travels with chat backups and archives, never contact-only exports', () => {
    const f = fixture(); f.c.window = {};
    vm.runInContext(read('modules/storage.js'), f.c);
    vm.runInContext(read('modules/chat_archives.js'), f.c);
    f.chat.friendRelationship = { peer: { blocked: true } };
    assert.equal(f.c.storageExportChat(f.chat, true, false).friendRelationship, undefined);
    assert.equal(f.c.storageExportChat(f.chat, false, true).friendRelationship.peer.blocked, true);
    const a = f.c.captureArchiveData(f.chat);
    f.c.applyArchiveData(f.chat, { id: 'b', data: { history: [] } });
    assert.equal(f.c.relationshipCanChat(f.chat), true);
    f.c.applyArchiveData(f.chat, { id: 'a', data: a });
    assert.equal(f.c.relationshipCanChat(f.chat), false);
});

test('blacklist prevents incoming/outgoing calls and active-call reply requests', async () => {
    const f = fixture(); f.c.window = {};
    f.c.document = { getElementById: () => ({ classList: { remove() {} }, style: {} }) };
    vm.runInContext(read('modules/video_call.js'), f.c);
    const calls = f.c.window.VideoCallModule;
    calls.hideCallTypeModal = () => {};
    f.c.getCallReply = async () => { f.requests.push(1); return 'reply'; };
    f.chat.friendRelationship = { peer: { blocked: true } };
    calls.state.currentChat = f.chat;
    calls.receiveCall('voice', f.chat.id);
    await calls.startCall('voice', false, f.chat);
    assert.equal(await calls.fetchInitialAiResponse(f.chat, 'voice', false), null);
    await calls.triggerAiReply();
    await calls.sendUserAction('hello');
    assert.equal(f.requests.length, 0);
    assert.equal(calls.state.isCallActive, false);
});

test('late call opening response is discarded after relationship change', async () => {
    const f = fixture(); f.c.window = {};
    vm.runInContext(read('modules/video_call.js'), f.c);
    let finish;
    f.c.getCallReply = () => new Promise(resolve => finish = resolve);
    Object.assign(f.c.window.VideoCallModule.state, {currentChat:f.chat, isCallActive:true, callSession:{}, currentCallContext:[]});
    const pending = f.c.window.VideoCallModule.fetchInitialAiResponse(f.chat, 'voice', false);
    f.chat.friendRelationship = { peer: { blocked: true }, revision: 1 };
    finish('late response');
    assert.equal(await pending, null);
});
