const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
    const messages = [
        { id: 'u1', role: 'user', content: 'one', timestamp: 10 },
        { id: 'thinking', role: 'user', content: 'hidden', isThinking: true, timestamp: 11 },
        { id: 'rejected', role: 'user', content: 'rejected', relationshipDelivery: 'blocked', timestamp: 12 },
        { id: 'a1', role: 'assistant', content: 'reply', timestamp: 13 },
        { id: 'u2', role: 'user', content: 'two', timestamp: 20 }
    ];
    const chat = { id: 'a', persona: 'persona', history: messages, memoryJournals: [],
        avatarAutonomy: { enabled: true, every: 3, condition: 'keep', lastUserCount: 50, lastCheck: 123,
            lastRequestKey: 'future', cache: { stale: { description: 'future image' } }, lastResult: 'future result', lastChangedAt: 100 },
        friendRelationship: { peer: { blocked: true }, recovery: { mode: 'condition', condition: 'keep' }, autonomy: { enabled: true, everyUserMessages: 3, condition: 'keep', lastCheckUserCount: 50 } },
        memoryVectorIndex: { 'history:future': { text: 'future' } } };
    const opened = [], toasts = [];
    const c = vm.createContext({ db: { characters: [chat, { id: 'b', history: [] }], groups: [] }, currentChatId: 'a', currentChatType: 'private',
        window: {}, document: { getElementById: () => null }, structuredClone, prompt: () => 'new', confirm: () => true,
        saveData: async () => {}, openChatRoom: (...args) => opened.push(args), showToast: message => toasts.push(message) });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_archives.js'), 'utf8'), c);
    c.ensureChatArchives(chat);
    const first = chat.archives[0];
    first.id = 'first'; chat.activeArchiveId = 'first';
    chat.archives.push({ id: 'second', name: 'second', createdAt: 1, updatedAt: 1, data: { persona: 'second persona', history: [{ id: 'second-message', role: 'assistant', content: 'second' }], memoryJournals: [] } });
    return { c, chat, first, opened, toasts };
}

test('blank archive clears derived runtime without changing persona or relationship policy', async () => {
    const { c, chat } = fixture(); await c.createBlankArchive();
    assert.equal(chat.persona, 'persona'); assert.equal(chat.history.length, 0);
    assert.equal(chat.avatarAutonomy.enabled, true); assert.equal(chat.avatarAutonomy.every, 3);
    assert.equal(chat.avatarAutonomy.condition, 'keep'); assert.equal(chat.avatarAutonomy.lastUserCount, 0);
    assert.equal(chat.avatarAutonomy.lastCheck, 0); assert.equal(chat.avatarAutonomy.lastRequestKey, '');
    assert.equal(chat.avatarAutonomy.lastChangedAt, 0); assert.equal(chat.avatarAutonomy.lastResult, '');
    assert.deepEqual(plain(chat.avatarAutonomy.cache), {}); assert.deepEqual(plain(chat.memoryVectorIndex), {});
    assert.equal(chat.friendRelationship.peer.blocked, true); assert.equal(chat.friendRelationship.recovery.condition, 'keep');
    assert.equal(chat.friendRelationship.autonomy.lastCheckUserCount, 0);
});

test('branch clamps autonomy counts to retained eligible history and invalidates derived caches', async () => {
    const { c, chat } = fixture(); await c.createBranchArchiveAtMessage('a1');
    assert.deepEqual(chat.history.map(message => message.id), ['u1', 'thinking', 'rejected', 'a1']);
    assert.equal(chat.avatarAutonomy.lastUserCount, 2); // Avatar eligibility includes thinking user records.
    assert.equal(chat.friendRelationship.autonomy.lastCheckUserCount, 1);
    assert.equal(chat.avatarAutonomy.lastRequestKey, ''); assert.equal(chat.avatarAutonomy.lastCheck, 0);
    assert.deepEqual(plain(chat.avatarAutonomy.cache), {}); assert.deepEqual(plain(chat.memoryVectorIndex), {});
});

test('failed switch restores source and keeps concurrent destination arrivals in that archive', async () => {
    const { c, chat, opened } = fixture();
    c.saveData = async () => { c.syncChatActiveArchive(chat); chat.history.push({ id: 'arrival', content: 'new' }); throw Error('quota'); };
    assert.equal(await c.switchChatArchive('second'), false);
    assert.equal(chat.activeArchiveId, 'first'); assert.equal(chat.persona, 'persona');
    assert.deepEqual(chat.history.map(message => message.id), ['u1', 'thinking', 'rejected', 'a1', 'u2']);
    assert.deepEqual(chat.archives[1].data.history.map(message => message.id), ['second-message', 'arrival']);
    assert.equal(opened.length, 0);
});

test('failed switch leaves a newer archive navigation and its arrivals intact', async () => {
    const { c, chat, first } = fixture();
    c.saveData = async () => { c.applyArchiveData(chat, first); chat.history.push({ id: 'newer', content: 'new' }); throw Error('quota'); };
    assert.equal(await c.switchChatArchive('second'), false);
    assert.equal(chat.activeArchiveId, 'first'); assert.equal(chat.history.at(-1).id, 'newer');
});

test('settled switch never reopens a newer chat selection', async () => {
    const { c, chat, opened } = fixture();
    c.saveData = async () => { c.currentChatId = 'b'; };
    assert.equal(await c.switchChatArchive('second'), true);
    assert.equal(chat.activeArchiveId, 'second'); assert.equal(c.currentChatId, 'b'); assert.equal(opened.length, 0);
});

for (const action of ['createBlankArchive', 'createBranchArchiveAtMessage']) {
    test(`failed ${action} removes the unsaved entry and restores the source`, async () => {
        const { c, chat, toasts } = fixture();
        c.saveData = async () => { c.syncChatActiveArchive(chat); throw Error('quota'); };
        assert.equal(await c[action]('a1'), false);
        assert.equal(chat.archives.length, 2); assert.equal(chat.activeArchiveId, 'first');
        assert.equal(toasts.some(message => /已创建/.test(message)), false);
    });
}

test('failed creation retains newer arrivals rather than discarding the only copy', async () => {
    const { c, chat } = fixture();
    c.saveData = async () => { chat.history.push({ id: 'arrival', content: 'new' }); throw Error('quota'); };
    assert.equal(await c.createBlankArchive(), false);
    assert.equal(chat.activeArchiveId, 'first'); assert.equal(chat.archives.length, 3);
    assert.equal(chat.archives[2].data.history[0].id, 'arrival');
});

test('failed rename restores just its own change and preserves newer renames', async () => {
    for (const newer of [false, true]) {
        const { c, chat } = fixture(), archive = chat.archives[1];
        c.saveData = async () => { if (newer) archive.name = 'newer'; chat.history.push({ id: 'arrival' }); throw Error('quota'); };
        assert.equal(await c.renameChatArchive('second'), false);
        assert.equal(archive.name, newer ? 'newer' : 'second'); assert.equal(chat.history.at(-1).id, 'arrival');
    }
});

test('failed active archive rename is restored even when save synchronization touches its timestamp', async () => {
    const { c, first } = fixture(), originalName = first.name;
    c.saveData = async () => { first.updatedAt += 1; throw Error('quota'); };
    assert.equal(await c.renameChatArchive('first'), false);
    assert.equal(first.name, originalName);
});

for (const active of [false, true]) {
    test(`failed ${active ? 'active' : 'inactive'} deletion restores the removed archive locally`, async () => {
        const { c, chat } = fixture();
        c.saveData = async () => { chat.history.push({ id: 'arrival' }); throw Error('quota'); };
        assert.equal(await c.deleteChatArchive(active ? 'first' : 'second'), false);
        assert.deepEqual(plain(chat.archives.map(archive => archive.id)), ['first', 'second']); assert.equal(chat.activeArchiveId, 'first');
        const arrivalData = active ? chat.archives[1].data : chat;
        assert.equal(arrivalData.history.at(-1).id, 'arrival');
    });
}
