'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(fetchImpl) {
    const values = new Map([['uvu-story-bridge.v1', JSON.stringify({ token: 'paired-token' })]]);
    const output = { textContent: '', dataset: {} };
    const chat = { id: 'char-1', memoryJournals: [] };
    const db = { characters: [chat], uvuStoryBridgeSettings: { baseUrl: 'http://127.0.0.1:8000/api/plugins/uvu-story-bridge' } };
    const context = vm.createContext({
        window: {},
        db,
        document: { visibilityState: 'visible', getElementById: () => output, addEventListener() {} },
        localStorage: {
            getItem: key => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
            removeItem: key => values.delete(key)
        },
        fetch: fetchImpl,
        structuredClone,
        saveData: async () => {},
        setInterval: () => 1,
        clearInterval() {},
        console
    });
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
});

test('scene transcript parts form one draft memory before the event cursor is acknowledged', async () => {
    const calls = [];
    const { bridge, chat, db } = harness(async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/client/events?')) {
            return { ok: true, json: async () => ({
                events: [
                    { seq: 1, kind: 'scene_transcript', sceneId: 'scene-a', createdAt: 1000, payload: { title: '夜晚散步', part: 1, partCount: 2, text: '两人走到河边。' } },
                    { seq: 2, kind: 'scene_transcript', sceneId: 'scene-a', createdAt: 1000, payload: { title: '夜晚散步', part: 2, partCount: 2, text: '角色答应下周再见。' } }
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
