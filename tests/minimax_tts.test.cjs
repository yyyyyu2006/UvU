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

function response(audio, extra = {}) {
    return { ok: true, status: 200, json: async () => ({
        base_resp: { status_code: 0 }, data: { audio, status: 2 },
        extra_info: { audio_format: 'mp3' }, ...extra
    }) };
}

const mp3Hex = 'fffb9064' + '00'.repeat(413);

test('MiniMax TTS sends configured voice data and decodes returned hex audio', async () => {
    let request;
    const tts = loadTts(async (url, options) => {
        request = { url, options };
        return response(mp3Hex);
    });
    const audio = await tts.synthesize('你好');
    const body = JSON.parse(request.options.body);
    assert.equal(request.url, 'https://api.minimaxi.com/v1/t2a_v2');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.equal(body.voice_setting.voice_id, 'test-voice');
    assert.equal(body.model, 'speech-2.8-hd');
    assert.equal(body.output_format, 'hex');
    assert.equal(audio.type, 'audio/mpeg');
    assert.equal(audio.size, 417);
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
        return response(mp3Hex);
    });
    const settings = { apiKey: 'test-key', voiceId: 'default-voice', groupId: 'group-123' };
    await tts.synthesize('你好', settings);
    assert.equal(new URL(requestUrl).searchParams.get('GroupId'), 'group-123');
    assert.equal(tts.resolveVoiceId('character-voice', settings), 'character-voice');
    assert.equal(tts.resolveVoiceId('', settings), 'default-voice');
    assert.equal(tts.resolveVoiceId('   ', settings), 'default-voice');
});

test('MiniMax rejects non-MP3 bytes, mismatched formats and unfinished responses', async () => {
    for (const reply of [
        response('0001feff'),
        response('fffb9064'),
        response(mp3Hex, { extra_info: { audio_format: 'pcm' } }),
        response(mp3Hex, { data: { audio: mp3Hex, status: 1 } })
    ]) {
        const tts = loadTts(async () => reply);
        await assert.rejects(tts.synthesize('test'), /音频|完成|MP3/);
    }
});

test('MiniMax accepts requested 32 kHz MP3 and ID3-tagged audio without optional response metadata', async () => {
    const frame32k = 'fffb9864' + '00'.repeat(572);
    for (const audio of [frame32k, '49443304000000000000' + frame32k]) {
        const tts = loadTts(async () => ({ ok: true, status: 200,
            json: async () => ({ base_resp: { status_code: 0 }, data: { audio } }) }));
        const blob = await tts.synthesize('test');
        assert.equal(blob.type, 'audio/mpeg');
        assert.equal(blob.size, audio.length / 2);
    }
});

test('MiniMax cache does not reuse audio across API accounts', async () => {
    let requests = 0;
    const tts = loadTts(async () => { requests++; return response(mp3Hex); });
    const settings = { apiKey: 'first-key', voiceId: 'voice' };
    await tts.synthesize('test', settings);
    await tts.synthesize('test', { ...settings, apiKey: 'second-key' });
    assert.equal(requests, 2);
});
