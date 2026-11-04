const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadTts(fetch) {
    const context = vm.createContext({
        Blob,
        Map,
        URL,
        Uint8Array,
        fetch,
        window: {},
        db: { minimaxTtsSettings: { apiKey: 'test-key', voiceId: 'test-voice', groupId: '' } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_features.js'), 'utf8'), context);
    return vm.runInContext('MiniMaxTTS', context);
}

test('MiniMax TTS sends configured voice data and decodes returned hex audio', async () => {
    let request;
    const tts = loadTts(async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200, json: async () => ({ base_resp: { status_code: 0 }, data: { audio: '0001feff' } }) };
    });
    const audio = await tts.synthesize('你好');
    const body = JSON.parse(request.options.body);
    assert.equal(request.url, 'https://api.minimaxi.com/v1/t2a_v2');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.equal(body.voice_setting.voice_id, 'test-voice');
    assert.equal(body.model, 'speech-2.8-hd');
    assert.equal(body.output_format, 'hex');
    assert.equal(audio.type, 'audio/mpeg');
    assert.equal(audio.size, 4);
});

test('MiniMax TTS surfaces service errors and rejects malformed audio', async () => {
    const serviceFailure = loadTts(async () => ({
        ok: true, status: 200,
        json: async () => ({ base_resp: { status_code: 1004, status_msg: 'invalid voice' } })
    }));
    await assert.rejects(serviceFailure.synthesize('你好'), /invalid voice/);

    const malformedAudio = loadTts(async () => ({
        ok: true, status: 200,
        json: async () => ({ base_resp: { status_code: 0 }, data: { audio: 'not-hex' } })
    }));
    await assert.rejects(malformedAudio.synthesize('你好'), /音频数据/);
});

test('MiniMax TTS adds GroupId only when configured and prefers character voice IDs', async () => {
    let requestUrl;
    const tts = loadTts(async (url) => {
        requestUrl = url;
        return { ok: true, status: 200, json: async () => ({ base_resp: { status_code: 0 }, data: { audio: '0001' } }) };
    });
    const settings = { apiKey: 'test-key', voiceId: 'default-voice', groupId: 'group-123' };
    await tts.synthesize('你好', settings);
    assert.equal(new URL(requestUrl).searchParams.get('GroupId'), 'group-123');
    assert.equal(tts.resolveVoiceId('character-voice', settings), 'character-voice');
    assert.equal(tts.resolveVoiceId('', settings), 'default-voice');
});
