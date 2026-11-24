'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const characterApi = require('../js/modules/gomoku_character.js');

test('parses only a legal candidate and clamps character dialogue', () => {
    const candidates = [{ row: 7, col: 7 }, { row: 7, col: 8 }];
    assert.deepEqual(characterApi.parseMove('```json\n{"row":7,"col":8,"say":"落在这里。"}\n```', candidates), { row: 7, col: 8, say: '落在这里。' });
    assert.throws(() => characterApi.parseMove('{"row":1,"col":1}', candidates), /不可落子/);
    assert.throws(() => characterApi.parseMove('not json', candidates), /JSON/);
    assert.equal(characterApi.parseMove(JSON.stringify({ row: 7, col: 7, say: '语'.repeat(100) }), candidates).say.length, 60);
});

test('builds isolated non-streaming OpenAI-compatible requests with no chat history', () => {
    const request = characterApi.toRequestPayload({ url: 'https://example.test/v1', key: 'secret', model: 'test', provider: 'openai' },
        { realName: '阿青', description: '沉静' },
        { size: 15, turn: 'white', board: Array(225).fill(null) }, [{ row: 7, col: 8 }]);
    assert.equal(request.endpoint, 'https://example.test/v1/chat/completions');
    assert.equal(request.body.stream, false);
    assert.equal(request.body.messages.length, 2);
    assert.equal(request.body.messages[0].role, 'system');
    assert.equal(request.body.messages[1].content.includes('chat_history'), false);
    assert.equal(request.body.messages[1].content.includes('uvu'), false);
    assert.deepEqual(JSON.parse(request.body.messages[1].content.match(/\{[\s\S]*\}$/)[0]).legalCandidates, [{ row: 7, col: 8 }]);
    assert.equal(request.headers.Authorization, 'Bearer secret');
});

test('uses the selected character exclusive API preset without mutating global settings', () => {
    const appDb = {
        apiSettings: { url: 'https://global.test/v1', key: 'global-key', model: 'global-model', provider: 'openai' },
        apiPresets: [{ name: 'role', data: { apiUrl: 'https://role.test/v1', apiKey: 'role-key', model: 'role-model', provider: 'openai' } }]
    };
    const config = characterApi.resolveApiConfig({ exclusiveApiEnabled: true, exclusiveApiPreset: 'role' }, appDb, () => 'role-key');
    assert.equal(config.url, 'https://role.test/v1');
    assert.equal(config.model, 'role-model');
    assert.equal(appDb.apiSettings.url, 'https://global.test/v1');
});

test('retries one invalid move and accepts the corrected legal candidate', async () => {
    const state = { size: 15, turn: 'white', board: Array(225).fill(null) };
    const candidates = [{ row: 7, col: 7 }];
    let calls = 0;
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(calls++ ? { row: 7, col: 7, say: '好。' } : { row: 1, col: 1 }) } }] }) });
    const move = await characterApi.requestMove({ character: {}, appDb: { apiSettings: { url: 'https://example.test/v1', key: 'k', model: 'm', provider: 'openai' } }, state, candidates, fetchImpl });
    assert.equal(calls, 2);
    assert.deepEqual(move, { row: 7, col: 7, say: '好。' });
});

test('fails closed after two illegal model moves', async () => {
    let calls = 0;
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ row: calls++, col: 0 }) } }] }) });
    await assert.rejects(characterApi.requestMove({ character: {}, appDb: { apiSettings: { url: 'https://example.test/v1', key: 'k', model: 'm', provider: 'openai' } }, state: { size: 15, turn: 'white', board: Array(225).fill(null) }, candidates: [{ row: 7, col: 7 }], fetchImpl }), /两次/);
    assert.equal(calls, 2);
});

test('supports Gemini response parsing and request shape', () => {
    const request = characterApi.toRequestPayload({ url: 'https://generativelanguage.googleapis.com', key: 'secret', model: 'gemini-2.0-flash', provider: 'gemini' }, {},
        { size: 15, turn: 'white', board: Array(225).fill(null) }, [{ row: 7, col: 7 }]);
    assert.match(request.endpoint, /models\/gemini-2\.0-flash:generateContent\?key=secret$/);
    assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(characterApi.extractText({ candidates: [{ content: { parts: [{ text: '{"row":7,' }, { text: '"col":7}' }] } }] }, 'gemini'), '{"row":7,"col":7}');
});
