'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(fetchImpl, permissionState = 'granted') {
    const values = new Map([['uvu-story-bridge.v1', JSON.stringify({ token: 'paired-token' })]]);
    const output = { textContent: '', dataset: {} };
    const chat = { id: 'char-1', memoryJournals: [] };
    const db = { characters: [chat], uvuStoryBridgeSettings: { baseUrl: 'http://127.0.0.1:8765/api/plugins/uvu-story-bridge' } };
    const context = vm.createContext({
        window: {},
        URL,
        db,
        document: { visibilityState: 'visible', getElementById: () => output, addEventListener() {} },
        localStorage: {
            getItem: key => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
            removeItem: key => values.delete(key)
        },
        navigator: { permissions: { query: async () => ({ state: permissionState }) } },
        fetch: fetchImpl,
        structuredClone,
        crypto,
        TextEncoder,
        AbortSignal,
        saveData: async () => {},
        setInterval: () => 1,
        clearInterval() {},
        console
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/bridge_text.js'), 'utf8'), context);
    const source = fs.readFileSync(path.join(__dirname, '../js/modules/story_bridge.js'), 'utf8');
    vm.runInContext(source, context);
    return { bridge: context.window.UvUStoryBridge, db, chat, output };
}

test('bridge mode lookup uses the paired bearer token and requested character key', async () => {
    const calls = [];
    const { bridge } = harness(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ mode: 'offline' }) };
    });

    const mode = await bridge.getMode('char-1');
    assert.equal(mode.mode, 'offline');
    assert.match(calls[0].url, /\/client\/state\?characterKey=char-1$/);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer paired-token');
    assert.equal(calls[0].options.targetAddressSpace, 'loopback');
});

test('connection errors report the browser loopback permission state', async () => {
    const { bridge } = harness(async () => { throw new TypeError('Failed to fetch'); }, 'denied');
    await assert.rejects(bridge.getMode('char-1'), /loopback-network: denied.*Chrome 已拒绝此网站/);
});

test('paired UvU sends stable character IDs and clear names to the local directory', async () => {
    const calls = [];
    const { bridge, db } = harness(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ characters: [{ id: 'char-1', name: '角色甲' }] }) };
    });
    db.characters[0].realName = '角色甲';

    await bridge.publishCharacterDirectory(true);
    assert.match(calls[0].url, /\/client\/characters$/);
    assert.equal(calls[0].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].options.body), { characters: [{ id: 'char-1', name: '角色甲' }] });
});

test('large outgoing messages label each part so SillyTavern can reassemble them', async () => {
    const calls = [];
    const { bridge, chat } = harness(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({}) };
    });
    await bridge.publishTurn(chat, null, [{ id: 'long-1', text: '一'.repeat(5001), createdAt: 10 }]);
    const sent = calls.filter(call => call.url.endsWith('/client/events')).map(call => JSON.parse(call.options.body));
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map(event => [event.payload.messages[0].messagePart, event.payload.messages[0].messagePartCount]), [[1, 2], [2, 2]]);
    assert.equal(sent[0].payload.messages[0].sourceMessageId, sent[1].payload.messages[0].sourceMessageId);
});

test('scene transcript parts form one draft memory before the event cursor is acknowledged', async () => {
    const calls = [];
    const { bridge, chat, db } = harness(async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/client/events?')) {
            return { ok: true, json: async () => ({
                events: [
                    { seq: 1, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'scene-a', createdAt: 1000, payload: { title: '夜晚散步', part: 1, partCount: 2, text: '两人走到河边。' } },
                    { seq: 2, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'scene-a', createdAt: 1000, payload: { title: '夜晚散步', part: 2, partCount: 2, text: '角色答应下周再见。' } }
                ]
            }) };
        }
        return { ok: true, json: async () => ({ cursor: 2 }) };
    });

    const imported = await bridge.syncIncoming('char-1');
    assert.equal(imported, 1);
    assert.equal(chat.memoryJournals.length, 1);
    assert.equal(chat.memoryJournals[0].content, '两人走到河边。\n\n角色答应下周再见。');
    assert.equal(chat.memoryJournals[0].isFavorited, false);
    assert.equal(chat.memoryJournals[0].source, 'sillytavern');
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter['char-1'], 2);
    assert.equal(calls.at(-1).url.endsWith('/client/ack'), true);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { seq: 2, characterKey: 'char-1' });
});

test('bridge refuses a scene event routed to a different character ID', async () => {
    const { bridge, db, chat, output } = harness(async () => ({
        ok: true,
        json: async () => ({ events: [{ seq: 1, characterKey: 'char-2', kind: 'scene_transcript', sceneId: 'wrong-char', payload: { part: 1, partCount: 1, text: '错配剧情' } }] })
    }));

    const imported = await bridge.syncIncoming('char-1');
    assert.equal(imported, 0);
    assert.equal(chat.memoryJournals.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter?.['char-1'], undefined);
    assert.match(output.textContent, /角色 ID 不匹配/);
});

test('a dropped queue range is reported without advancing the local cursor', async () => {
    const { bridge, db, chat, output } = harness(async () => ({
        ok: true,
        json: async () => ({ events: [], gapDetected: true, latestSeq: 5000 })
    }));

    const imported = await bridge.syncIncoming('char-1');
    assert.equal(imported, 0);
    assert.equal(chat.memoryJournals.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter?.['char-1'], undefined);
    assert.match(output.textContent, /不能确认剧情完整/);
});

test('bridge review text removes reasoning and code blocks while preserving story prose', () => {
    const helper = require('../js/modules/bridge_text.js');
    assert.equal(helper.clean('<style>.card{color:red}</style><div>两人在车站见面。</div><thinking>内部推理</thinking>'), '两人在车站见面。');
    assert.equal(helper.clean('他们约好下周见。\n```javascript\nrenderStatus();\n```'), '他们约好下周见。');
    assert.equal(helper.clean('<thinking>没有闭合的思维链'), '');
});

test('unreviewed or unchecked Tavern journals are blocked from injection', () => {
    const { bridge, chat } = harness(async () => ({ ok: true, json: async () => ({}) }));
    const journal = { source: 'sillytavern', isFavorited: true, content: '剧情', bridgeReview: { status: 'pending', items: [{ selected: true, text: '剧情' }] } };
    assert.equal(bridge.allowedMemory(chat, journal), false);
    journal.bridgeReview.status = 'approved';
    journal.bridgeReview.items[0].selected = false;
    assert.equal(bridge.allowedMemory(chat, journal), false);
    journal.bridgeReview.items[0].selected = true;
    assert.equal(bridge.allowedMemory(chat, journal), true);
});

test('incomplete or noncontiguous scene parts are never committed', async () => {
    const { bridge, chat, db } = harness(async () => ({ ok: true, json: async () => ({ events: [
        { seq: 1, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'bad-parts', createdAt: 1, payload: { part: 1, partCount: 2, text: '第一段' } },
        { seq: 2, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'bad-parts', createdAt: 1, payload: { part: 3, partCount: 2, text: '越界片段' } }
    ] }) }));
    await assert.rejects(bridge.syncIncoming('char-1'), /分段格式无效/);
    assert.equal(chat.memoryJournals.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter?.['char-1'], undefined);
});

test('archive switch during receive cannot write scene data into the new archive', async () => {
    let resolveFetch;
    const pending = new Promise(resolve => { resolveFetch = resolve; });
    const { bridge, chat, db } = harness(async () => pending);
    chat.activeArchiveId = 'archive-a';
    const running = bridge.syncIncoming('char-1');
    chat.activeArchiveId = 'archive-b';
    resolveFetch({ ok: true, json: async () => ({ events: [{ seq: 1, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'scene-a', createdAt: 1, payload: { part: 1, partCount: 1, text: '不能写入新存档' } }] }) });
    await assert.rejects(running, /存档已切换/);
    assert.equal(chat.memoryJournals.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter?.['char-1'], undefined);
});
