const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const track = () => ({ provider: 'netease', id: '1', title: 'Song', artists: ['Artist'], album: 'Album', cover: 'https://example.com/cover.jpg', duration: 180 });
function fixture() {
    const chat = { id: 'char-a', activeArchiveId: 'archive-a', history: [] };
    const plays = [];
    const c = vm.createContext({ console, URL, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout,
        db: { characters: [chat], groups: [] }, currentChatType: 'private', currentChatId: chat.id,
        captureChatSendTarget: () => ({ chat, chatId: chat.id, archiveId: chat.activeArchiveId, history: chat.history, type: 'private' }),
        isChatSendTargetValid: target => !!target && target.archiveId === chat.activeArchiveId && target.history === chat.history,
        relationshipCanSend: () => true, relationshipCanChat: () => true,
        beginChatMutation: (chat, type, messages = []) => ({ chat, before: JSON.parse(JSON.stringify(chat.history)), messages }),
        saveChatMutation: async () => true, isChatTargetVisible: () => false, renderChatList() {},
        UvUMusic: { lyrics: async () => ({ lyric: 'line one\nline two' }), player: { play: async value => plays.push(value), snapshot: () => ({ track: track(), playing: true, phase: 'playing' }), stop() {} } }
    });
    c.window = c;
    const file = path.join(__dirname, '../js/modules/music_chat.js');
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), c);
    return { c, api: c.UvUMusicChat, chat, plays };
}
const command = (id, action = 'accept') => '<uvu_music>' + JSON.stringify({ invitationId: id, action }) + '</uvu_music>';

test('public-source cards preserve their source and safe artwork ID through portable validation', async () => {
    const {api,chat}=fixture();
    await api.share({...track(),provider:'gd-netease',artworkId:'109951166139384942',pageUrl:'https://music.163.com/song?id=1',url:'https://signed.invalid/stream'});
    const payload=api.portablePayload(chat.history[0].music);
    assert.equal(payload.track.provider,'gd-netease');assert.equal(payload.track.artworkId,'109951166139384942');assert.equal(payload.track.url,undefined);
    assert.doesNotThrow(()=>api.validatePayload(payload));
    assert.throws(()=>api.validatePayload({...payload,track:{...payload.track,artworkId:'../x'}}));
});
test('ordinary history and ordinary reply are identical without an invitation', () => {
    const { api, chat } = fixture(), history = [{ role: 'user', content: 'hello' }];
    const plan = api.requestPlan(history, chat);
    assert.equal(plan.history, history); assert.equal(plan.instructions, ''); assert.equal(plan.invitations.length, 0);
    const text = 'literal ' + command('unrelated');
    assert.equal(api.extractActions(text, []).text, text);
});
test('sharing fetches lyrics only on explicit selection and preserves readable bounded song facts', async () => {
    const { api, c, chat } = fixture(); let calls = 0; c.UvUMusic.lyrics = async () => { calls++; return { lyric: 'x'.repeat(10000) }; };
    await api.share({ ...track(), cookie: 'secret', url: 'https://signed/stream' });
    assert.equal(calls, 0); assert.equal(chat.history[0].type, 'music'); assert.match(chat.history[0].content, /Song/);
    assert.equal(chat.history[0].music.track.cookie, undefined); assert.equal(chat.history[0].music.track.url, undefined);
    await api.share(track(), { lyrics: true });
    assert.equal(calls, 1); assert.ok(chat.history[1].music.lyrics.length <= 2000);
    assert.equal(api.requestPlan(chat.history, chat).instructions, '');
});
test('share captures its destination before awaited lyrics and rejects an archive change', async () => {
    const { api, c, chat } = fixture(); let finish;
    c.UvUMusic.lyrics = () => new Promise(resolve => { finish = resolve; });
    const pending = api.share(track(), { lyrics: true, invite: true });
    chat.activeArchiveId = 'archive-b'; chat.history = [];
    finish({ lyric: 'hi' }); await assert.rejects(pending, /存档/); assert.equal(chat.history.length, 0);
});
test('chat switch never reroutes a song to the newly selected character', async () => {
    const { api, c, chat } = fixture(); let finish;
    c.UvUMusic.lyrics = () => new Promise(resolve => { finish = resolve; });
    const pending = api.share(track(), { lyrics: true });
    c.currentChatId = 'char-b'; finish({ lyric: 'hi' }); await pending;
    assert.equal(chat.history.length, 1); assert.equal(chat.history[0].music.track.id, '1');
});
test('failed persistence rolls back a music send using the shared mutation contract', async () => {
    const { api, c, chat } = fixture(); c.saveChatMutation = async state => { state.chat.history.splice(0, state.chat.history.length, ...state.before); return false; };
    assert.equal(await api.share(track(), { invite: true }), false); assert.equal(chat.history.length, 0);
});
test('invitations are bound to character/archive and excluded when failed, withdrawn, disabled, expired or revoked', async () => {
    const { api, chat } = fixture(); await api.share(track(), { invite: true });
    const message = chat.history[0], invitation = message.music.invitation;
    assert.equal(invitation.status, 'pending'); assert.equal(invitation.chatId, chat.id); assert.equal(invitation.archiveId, chat.activeArchiveId);
    assert.equal(api.requestPlan(chat.history, chat).invitations.length, 1);
    for (const flag of ['relationshipDelivery', 'isWithdrawn', 'isContextDisabled', 'isRevoked']) {
        message[flag] = true; assert.equal(api.requestPlan(chat.history, chat).instructions, ''); delete message[flag];
    }
    const expiry = invitation.expiresAt; invitation.expiresAt = Date.now() - 1;
    assert.equal(api.requestPlan(chat.history, chat).instructions, ''); invitation.expiresAt = expiry;
    chat.activeArchiveId = 'other'; assert.equal(api.requestPlan(chat.history, chat).instructions, '');
});
test('only explicit bound actions outside thinking are accepted and protocol is removed from normal text', async () => {
    const { api, chat } = fixture(); await api.share(track(), { invite: true });
    const plan = api.requestPlan(chat.history, chat), id = plan.invitations[0].id;
    const parsed = api.extractActions('<thinking>' + command(id) + '</thinking>yes' + command('foreign') + command(id), plan.invitations);
    assert.equal(parsed.actions.length, 1); assert.equal(parsed.actions[0].action, 'accept'); assert.match(parsed.text, /<thinking>/); assert.ok(parsed.text.endsWith('yes'));
    assert.equal(api.extractActions('I accept', plan.invitations).actions.length, 0);
    const malformed = api.extractActions('hello<uvu_music>{bad}</uvu_music>', plan.invitations);
    assert.equal(malformed.text, 'hello'); assert.equal(malformed.actions.length, 0);
});
test('acceptance persists once, starts local playback, and is never inferred from prose or replayed', async () => {
    const { api, chat, plays } = fixture(); await api.share(track(), { invite: true });
    const plan = api.requestPlan(chat.history, chat), id = plan.invitations[0].id;
    await api.consumeReply('yes let us listen', chat, plan); assert.equal(plays.length, 0);
    const result = await api.consumeReply('Yes.' + command(id), chat, plan);
    assert.equal(result.text, 'Yes.'); assert.equal(chat.history[0].music.invitation.status, 'accepted'); assert.equal(plays.length, 1);
    assert.equal(api.session().chatId, chat.id);
    await api.consumeReply(command(id), chat, plan); assert.equal(plays.length, 1);
    await api.end(); assert.equal(chat.history[0].music.invitation.status, 'ended'); assert.equal(api.session(), null);
});
test('decline does not play and a stale request cannot accept a replaced archive/history or withdrawn message', async () => {
    const { api, chat, plays } = fixture(); await api.share(track(), { invite: true });
    const plan = api.requestPlan(chat.history, chat), id = plan.invitations[0].id;
    chat.history[0].isWithdrawn = true;
    await api.consumeReply(command(id), chat, plan); assert.equal(plays.length, 0);
    delete chat.history[0].isWithdrawn;
    const result = await api.consumeReply(command(id, 'decline'), chat, plan);
    assert.equal(result.changed, true); assert.equal(chat.history[0].music.invitation.status, 'declined'); assert.equal(plays.length, 0);
});
test('portable music metadata validates and rejects unsafe fields without retaining credentials or streams', () => {
    const { api } = fixture();
    const payload = api.portablePayload({ version: 1, track: { ...track(), cookie: 'secret', streamUrl: 'https://signed' }, token: 'secret' });
    assert.equal(payload.token, undefined); assert.equal(payload.track.streamUrl, undefined);
    assert.throws(() => api.validatePayload({ version: 1, track: { ...track(), cover: 'javascript:alert(1)' } }), /音乐|歌曲/);
    assert.throws(() => api.validatePayload({ version: 1, track: track(), lyrics: 'x'.repeat(2001) }), /歌词|音乐/);
});
test('a response cannot accept an invitation after archive/history replacement even with copied invitation ids', async () => {
    const { api, chat, plays } = fixture(); await api.share(track(), { invite: true });
    const plan = api.requestPlan(chat.history, chat), id = plan.invitations[0].id;
    chat.history = JSON.parse(JSON.stringify(chat.history));
    const result = await api.consumeReply(command(id), chat, plan);
    assert.equal(result.changed, false); assert.equal(chat.history[0].music.invitation.status, 'pending'); assert.equal(plays.length, 0);
});
test('a failed invitation state save rolls back acceptance and cannot start playback', async () => {
    const { api, c, chat, plays } = fixture(); await api.share(track(), { invite: true });
    const plan = api.requestPlan(chat.history, chat), id = plan.invitations[0].id;
    c.saveChatMutation = async state => {
        for (const message of state.messages) Object.assign(message, state.before.find(item => item.id === message.id));
        return false;
    };
    const result = await api.consumeReply(command(id), chat, plan);
    assert.equal(result.changed, false); assert.equal(chat.history[0].music.invitation.status, 'pending'); assert.equal(plays.length, 0);
});
test('relationship-blocked invitations never enter the model plan or start a session', async () => {
    const { api, c, chat, plays } = fixture(); c.prepareRelationshipMessage = (chat, message) => { message.relationshipDelivery = 'blocked'; message.isContextDisabled = true; };
    await api.share(track(), { invite: true }); const plan = api.requestPlan(chat.history, chat);
    assert.equal(plan.invitations.length, 0); assert.equal(plan.history, chat.history); assert.equal(plan.instructions, '');
    await api.consumeReply(command(chat.history[0].music.invitation.id), chat, plan); assert.equal(plays.length, 0);
});
test('nested thinking, uppercase tags and duplicate controls never create extra decisions', async () => {
    const { api, chat } = fixture(); await api.share(track(), { invite: true });
    const plan = api.requestPlan(chat.history, chat), id = plan.invitations[0].id;
    const reply = '<THINKING><thinking>' + command(id) + '</thinking>' + command(id) + '</THINKING>\nOK' + command(id, 'decline') + command(id);
    const result = api.extractActions(reply, plan.invitations);
    assert.equal(result.actions.length, 1); assert.equal(result.actions[0].action, 'decline'); assert.ok(result.text.endsWith('OK'));
});
test('changing the invited track or deleting the character while the model runs invalidates the action', async () => {
    for (const change of ['track', 'deleted', 'relationship']) {
        const { api, c, chat, plays } = fixture(); await api.share(track(), { invite: true });
        const plan = api.requestPlan(chat.history, chat), id = plan.invitations[0].id;
        if (change === 'track') chat.history[0].music.track.id = 'new-song';
        if (change === 'deleted') c.db.characters.splice(0);
        if (change === 'relationship') chat.friendRelationship = { revision: 1 };
        const result = await api.consumeReply(command(id), chat, plan);
        assert.equal(result.changed, false, change); assert.equal(plays.length, 0, change);
    }
});
test('resolved play failures keep acceptance without inventing a listening session and show a retry notice', async () => {
    for (const phase of ['blocked', 'error', 'paused']) {
        const { api, c, chat } = fixture(), notices = [];
        c.showToast = message => notices.push(message);
        c.UvUMusic.player.play = async () => undefined;
        c.UvUMusic.player.snapshot = () => ({ track: track(), playing: false, phase, error: phase === 'error' ? 'unavailable' : '' });
        await api.share(track(), { invite: true }); const plan = api.requestPlan(chat.history, chat);
        const result = await api.consumeReply(command(plan.invitations[0].id), chat, plan);
        assert.equal(result.changed, true); assert.equal(chat.history[0].music.invitation.status, 'accepted');
        assert.equal(api.session(), null, phase); assert.equal(notices.length, 1, phase); assert.match(notices[0], /播放|重试/);
        c.UvUMusic.player.snapshot = () => ({ track: track(), playing: true, phase: 'playing' });
        assert.equal(await api.listen(track(), { chat, message: chat.history[0] }), true); assert.equal(api.session().localPlayback, true);
    }
});
test('a successful newer track cannot masquerade as playback of the accepted invitation', async () => {
    const { api, c, chat } = fixture(), notices = [];
    c.showToast = message => notices.push(message);
    c.UvUMusic.player.snapshot = () => ({ track: { ...track(), id: 'different' }, playing: true, phase: 'playing' });
    await api.share(track(), { invite: true }); const plan = api.requestPlan(chat.history, chat);
    await api.consumeReply(command(plan.invitations[0].id), chat, plan);
    assert.equal(api.session(), null); assert.equal(notices.length, 1);
});
test('portable chat tracks redact credential queries and restrict provider page links without core loaded', () => {
    const { api } = fixture();
    for (const key of ['token', 'cookie', 'auth', 'sign', 'secret', 'key', 'credential', 'expires', 'access_token', 'X-Amz-Signature']) {
        const payload = { version: 1, track: { ...track(), cover: 'https://example.com/a?' + key + '=SECRET', pageUrl: 'https://music.163.com/song?id=1&' + key + '=SECRET' } };
        const clean = api.portablePayload(payload);
        assert.equal(clean.track.cover, '', key); assert.equal(clean.track.pageUrl, undefined, key);
        assert.ok(!JSON.stringify(clean).includes('SECRET')); assert.throws(() => api.validatePayload(payload), /歌曲|音乐/, key);
    }
    for (const [provider, allowed, denied] of [
        ['netease', 'https://music.163.com/song?id=1', 'https://y.qq.com/song/1'],
        ['qq', 'https://y.qq.com/n/ryqq/songDetail/1', 'https://music.163.com/song?id=1'],
        ['qq', 'https://i.y.qq.com/v8/song/1', 'https://example.com/page'],
        ['local', undefined, 'https://example.com/page']
    ]) {
        const payload = { version: 1, track: { ...track(), provider, pageUrl: denied } };
        assert.equal(api.portablePayload(payload).track.pageUrl, undefined); assert.throws(() => api.validatePayload(payload), /歌曲|音乐/);
        if (allowed) assert.equal(api.portablePayload({ version: 1, track: { ...track(), provider, pageUrl: allowed } }).track.pageUrl, allowed);
    }
    assert.throws(() => api.validatePayload({ version: 1, track: track(), token: 'SECRET' }), /音乐/);
    assert.throws(() => api.validatePayload({ version: 1, track: { ...track(), cookie: 'SECRET' } }), /歌曲|音乐/);
});
test('chat portable normalization reuses core normalizer when present and still drops unknown fields', () => {
    const { api, c } = fixture(); let calls = 0;
    c.UvUMusic.normalizeTrack = raw => { calls++; return { ...raw, cover: '', pageUrl: undefined, signedUrl: 'SECRET' }; };
    const payload = api.portablePayload({ version: 1, track: { ...track(), cover: 'https://example.com/a?token=SECRET' } });
    assert.ok(calls > 0); assert.equal(payload.track.cover, ''); assert.equal(payload.track.signedUrl, undefined);
});
test('listening session reflects voice pause and disappears when playback stops or changes tracks', async () => {
    const { api, c, chat } = fixture();
    await api.share(track(), { invite: true }); const plan = api.requestPlan(chat.history, chat);
    await api.consumeReply(command(plan.invitations[0].id), chat, plan);
    c.UvUMusic.player.snapshot = () => ({ track: track(), playing: false, phase: 'paused' });
    assert.equal(api.session().localPlayback, false); assert.equal(api.session().chatId, chat.id);
    c.UvUMusic.player.snapshot = () => ({ track: track(), playing: true, phase: 'playing' });
    assert.equal(api.session().localPlayback, true);
    c.UvUMusic.player.snapshot = () => ({ track: { ...track(), id: 'another' }, playing: true, phase: 'playing' });
    assert.equal(api.session(), null);
    c.UvUMusic.player.snapshot = () => ({ track: null, playing: false, phase: 'idle' });
    assert.equal(api.session(), null);
});
