const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(history = []) {
    const requests = [], errors = [];
    const chat = { id: 'prompt-test', realName: '晴', myName: '我', maxMemory: 20, history };
    const context = vm.createContext({
        db: { characters: [chat], groups: [], apiSettings: { provider: 'gemini', url: 'https://test.invalid', key: 'fake', model: 'test', streamEnabled: false } },
        console: { log() {}, error() {}, warn() {} }, currentChatId: chat.id, currentChatType: 'private', isGenerating: false,
        AudioManager: { unlock() {} }, getReplyBtn: {}, regenerateBtn: {}, typingIndicator: { style: {} }, messageArea: {},
        generatePrivateSystemPrompt: () => '原始角色规则\n【动态插入: 聊天记录】\n原始世界书规则',
        filterHistoryForAI: (chat, history) => history, pad: n => String(n).padStart(2, '0'), getRandomValue: value => value,
        fetch: async (url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '回复' }] } }] }) }; },
        handleAiReplyContent: async () => {}, showApiError: error => errors.push(error.message),
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_ai.js'), 'utf8'), context);
    context.handleAiReplyContent = async () => {};
    return { context, chat, requests, errors };
}

test('Gemini dynamic history placeholder preserves rules and sends latest input without const reassignment', async () => {
    const f = fixture([
        { id: 'a', role: 'assistant', content: '历史角色消息', timestamp: 1700000000000 },
        { id: 'u', role: 'user', content: '最新用户输入', timestamp: 1700000001000 },
    ]);
    await f.context.getAiReply(f.chat.id, 'private');
    assert.deepEqual(f.errors, []);
    assert.equal(f.requests.length, 1);
    const body = f.requests[0];
    const system = body.system_instruction.parts[0].text;
    assert.match(system, /^原始角色规则/);
    assert.match(system, /<chat_history>[\s\S]*历史角色消息[\s\S]*<\/chat_history>/);
    assert.match(system, /原始世界书规则$/);
    assert.ok(!system.includes('【动态插入: 聊天记录】'));
    assert.equal(body.contents.length, 1);
    assert.match(body.contents[0].parts[0].text, /<user_input>[\s\S]*最新用户输入[\s\S]*<\/user_input>/);
    assert.ok(!JSON.stringify(body.contents).includes('历史角色消息'));
});

test('Gemini dynamic history placeholder also handles an empty conversation', async () => {
    const f = fixture();
    await f.context.getAiReply(f.chat.id, 'private');
    assert.deepEqual(f.errors, []);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.requests[0].contents, []);
    assert.match(f.requests[0].system_instruction.parts[0].text, /<chat_history>\n<\/chat_history>/);
});

test('retry guidance is added only for that generation and leaves the base prompt intact', async () => {
    const f = fixture([{ id: 'user', role: 'user', content: '刚才说的地点呢？', timestamp: 1700000000000 }]);
    await f.context.getAiReply(f.chat.id, 'private', false, '请记住前文提到的地点，并简短回复');
    const system = f.requests[0].system_instruction.parts[0].text;
    assert.match(system, /^原始角色规则/);
    assert.match(system, /原始世界书规则/);
    assert.match(system, /本次重新生成的修改方向/);
    assert.match(system, /请记住前文提到的地点/);
});

test('stop action aborts the active chat request without surfacing an API error', async () => {
    const f = fixture([{ id: 'user', role: 'user', content: '继续', timestamp: 1700000000000 }]);
    f.context.AbortController = AbortController;
    let signal;
    f.context.fetch = (_url, init) => new Promise((_resolve, reject) => {
        signal = init.signal;
        signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
    });
    const pending = f.context.getAiReply(f.chat.id, 'private');
    assert.equal(f.context.stopAiReply(), true);
    await pending;
    assert.equal(signal.aborted, true);
    assert.deepEqual(f.errors, []);
    assert.equal(f.context.isGenerating, false);
});

test('finishing an old chat request always clears the global generating lock after switching chats', async () => {
    const f = fixture([{ id: 'user', role: 'user', content: '继续', timestamp: 1700000000000 }]);
    f.context.AbortController = AbortController;
    let finishFetch;
    f.context.fetch = () => new Promise(resolve => { finishFetch = resolve; });
    const pending = f.context.getAiReply(f.chat.id, 'private');
    f.context.currentChatId = 'another-chat';
    finishFetch({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '回复' }] } }] }) });
    await pending;
    assert.equal(f.context.isGenerating, false);
    assert.equal(f.context.getReplyBtn.disabled, false);
    assert.equal(f.context.regenerateBtn.disabled, false);
});

test('token accounting failures never block chat delivery or change its request body', async () => {
    const history = [{ id: 'u', role: 'user', content: '原消息', timestamp: 1700000000000 }];
    const before = fixture(history), after = fixture(history);
    after.context.estimateChatTokenUsage = () => { throw new Error('statistics failure'); };
    after.context.recordChatTokenUsage = () => { throw new Error('statistics failure'); };
    await before.context.getAiReply(before.chat.id, 'private');
    await after.context.getAiReply(after.chat.id, 'private');
    assert.deepEqual(after.requests, before.requests);
    assert.deepEqual(after.errors, []);
});

test('bridge mode lookup finishing after an archive switch never starts a reply in the new archive', async () => {
    const f=fixture([{id:'u',role:'user',content:'旧存档',timestamp:1700000000000}]);
    let finish;
    f.context.UvUStoryBridge={isEnabled:()=>true,isConnected:()=>true,getMode:()=>new Promise(resolve=>finish=resolve)};
    const pending=f.context.getAiReply(f.chat.id,'private');
    f.chat.activeArchiveId='another'; f.chat.history=[]; finish({mode:'online'});
    await pending; assert.equal(f.requests.length,0);
});
