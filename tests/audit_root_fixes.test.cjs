const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('opening token preview never rerolls activation or claims unsent books actually triggered', () => {
    const chat = { id: 'c', activeArchiveId: 'a', history: [], worldBookIds: ['static', 'random'] };
    const books = [{ id: 'static', name: '静态', content: '静态正文', position: 'before' },
        { id: 'random', name: '概率', content: '概率正文', position: 'before', rules: { advancedEnabled: true, probability: 50 } }];
    let draws = 0;
    const c = vm.createContext({ db: { characters: [chat], groups: [], worldBooks: books },
        getAutoMemoryContextHistory: chat => chat.history, getContextMemoryJournals: () => [],
        buildWorldBookPlan: () => { draws++; return books; } });
    vm.runInContext(read('js/modules/chat_ai_prompt.js'), c);
    c.generatePrivateSystemPrompt = (_chat, plan) => plan.map(book => book.content).join('\n');
    const preview = c.getChatTokenUsageSnapshot('c');
    assert.equal(draws, 0); assert.equal(preview.preview, true);
    assert.equal(preview.worldBookPending, 1); assert.equal(preview.worldBookDetails.length, 0);
    const actualEstimate = c.estimateChatTokenUsage(chat, 'private', '静态正文', [], '', [books[0]]);
    c.recordChatTokenUsage(chat, 'private', { prompt_tokens: 25, completion_tokens: 5 }, actualEstimate);
    const frozen = c.getChatTokenUsageSnapshot('c');
    assert.equal(frozen.preview, false); assert.equal(frozen.worldBookDetails.length, 1);
    assert.equal(frozen.promptTokens, 25); assert.equal(draws, 0);
});

test('independent vector storage streams scoped rows instead of cloning all vectors with getAll', () => {
    assert.doesNotMatch(read('js/modules/vector_index_store.js'), /\.getAll\(/);
});

test('cache management filters chat and type and protects the current model/archive', () => {
    const c = vm.createContext({}); vm.runInContext(read('js/modules/memory_library.js'), c);
    const id = values => JSON.stringify(values);
    const active = id(['character', 'c', 'a', 'model1']);
    const rows = [active, id(['character', 'c', 'old', 'model0']), id(['character', 'other', 'a', 'model1']),
        id(['group', 'c', 'a', 'model1']), 'legacy'].map(id => ({ id, updatedAt: 1 }));
    const result = c.memoryLibraryCacheScopes(rows, { id: 'c' }, 'character', active);
    assert.equal(result.length, 2); assert.equal(result[0].current, true);
    assert.equal(result[1].current, false); assert.equal(result[1].archiveId, 'old');
});

function pendingCallFixture() {
    const buttons = [], nodes = new Map(), mutations = [];
    const makeNode = () => ({ style: {}, classList: { add() {} }, innerHTML: '',
        addEventListener(name, handler) { this[name] = handler; },
        appendChild(node) { if (node.click) buttons.push(node); } });
    const chat = { id: 'c', activeArchiveId: 'a', history: [], callHistory: [] };
    const c = vm.createContext({ console, AbortController, DOMException, setTimeout, clearTimeout,
        document: { addEventListener() {}, createElement: makeNode,
            getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); } },
        db: { characters: [chat], groups: [] }, currentChatId: 'c', currentChatType: 'private',
        showToast() {}, beginChatMutation(chat, type) { mutations.push({ chat, type }); return {}; },
        saveChatMutation: async () => true });
    c.window = c;
    vm.runInContext(read('js/modules/video_call.js'), c);
    const module = vm.runInContext('VideoCallModule', c);
    const pending = { scope: { chat, archiveId: 'a', history: chat.history },
        callRecord: { id: 'call' }, summaryMsg: { id: 'summary' } };
    module.state.pendingCallSave = pending;
    module.showHistoryModal();
    return { c, chat, module, pending, buttons, mutations };
}

test('call retry revalidates the selected character/archive/history and pending operation at click', async () => {
    const changes = [f => { f.chat.activeArchiveId = 'new'; }, f => { f.chat.history = []; },
        f => { f.c.currentChatId = 'other'; }, f => { f.c.currentChatType = 'group'; },
        f => { f.c.db.characters = []; }, f => { f.module.state.pendingCallSave = { ...f.pending }; }];
    for (const change of changes) {
        const f = pendingCallFixture(); change(f);
        await f.buttons[0].click();
        assert.equal(f.mutations.length, 0);
        assert.equal(f.chat.history.length, 0);
        assert.equal(f.chat.callHistory.length, 0);
    }
});

test('call retries share one in-flight save and do not clear a newer pending call', async () => {
    const f = pendingCallFixture();
    f.module.showHistoryModal();
    let resolveSave, reopened = 0;
    f.c.saveChatMutation = () => new Promise(resolve => { resolveSave = resolve; });
    f.module.showHistoryModal = () => { reopened++; };
    const first = f.buttons[0].click();
    await f.buttons[1].click();
    assert.equal(f.mutations.length, 1);
    assert.equal(f.mutations[0].type, 'private');
    assert.equal(f.chat.callHistory.length, 1);
    assert.equal(f.chat.history.length, 1);
    const newer = { ...f.pending };
    f.module.state.pendingCallSave = newer;
    f.c.currentChatId = 'other';
    resolveSave(true); await first;
    assert.equal(f.module.state.pendingCallSave, newer);
    assert.equal(reopened, 0);
});
