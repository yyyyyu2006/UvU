const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../js/modules', name), 'utf8');
const shanghai = { name: '上海', latitude: 31.23, longitude: 121.47, countryCode: 'CN', timezone: 'Asia/Shanghai', subdivision: 'CN-SH' };
const ny = { name: '纽约', latitude: 40.71, longitude: -74, countryCode: 'US', timezone: 'America/New_York', subdivision: 'US-NY' };
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
    const storage = new Map(), requests = [];
    const chat = { id: 'char', activeArchiveId: 'a', avatar: 'https://test.invalid/old.png', persona: '角色人设', history: [], archives: [{ id: 'a', data: {} }] };
    const c = vm.createContext({ db: { characters: [chat], groups: [] }, AbortController, DOMException, URL, Intl, Date, TextEncoder, TextDecoder,
        crypto: require('node:crypto').webcrypto, structuredClone, setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
        navigator: {}, window: {}, currentChatId: 'char', currentChatType: 'private',
        saveData: async () => {}, resolveAuxiliaryApiConfig: () => ({ provider: 'newapi', url: 'https://test.invalid', model: 'vision', key: 'fake' }),
        recognizeStickerImage: async () => '白色的小猫照片', buildChatApiRequest: (config, messages) => ({ requestBody: { messages }, endpoint: config.url, headers: {} }),
        fetchAiResponse: async () => '{"action":"keep"}', compressImage: async () => 'data:image/png;base64,YQ==',
        fetch: async (url, init = {}) => { requests.push({ url, init }); throw Error('unexpected fetch'); } });
    vm.runInContext(source('character_avatar.js'), c); vm.runInContext(source('environment.js'), c);
    return { c, chat, requests, storage };
}

test('environment and avatar defaults are disabled and do not make network calls', async () => {
    const { c, chat, requests } = fixture();
    assert.equal(await c.getEnvironmentContext(chat), ''); assert.equal(await c.checkCharacterAvatar(chat), false);
    assert.equal(requests.length, 0); assert.equal(chat.environmentProfile, undefined);
});
test('environment coordinates, country, timezone and endpoints are validated', () => {
    const { c } = fixture();
    assert.equal(c.normalizeEnvironmentLocation({ ...shanghai, latitude: '31' }), null);
    assert.equal(c.normalizeEnvironmentLocation({ ...shanghai, longitude: 181 }), null);
    assert.equal(c.normalizeEnvironmentLocation({ ...shanghai, timezone: 'missing/zone' }), null);
    assert.equal(c.normalizeEnvironmentLocation({ ...shanghai, countryCode: 'fake' }), null);
    assert.equal(c.normalizeEnvironmentLocation(shanghai).timezone, 'Asia/Shanghai');
    for (const value of ['javascript:alert(1)', 'http://remote.test/mcp', 'https://user:secret@test.invalid']) assert.throws(() => c.environmentEndpoint(value));
    assert.equal(c.environmentEndpoint('http://127.0.0.1:9000/mcp'), 'http://127.0.0.1:9000/mcp');
});
test('timezone offsets handle DST, fractional hours and different local dates', () => {
    const { c } = fixture();
    assert.equal(c.environmentTimezoneOffset(ny.timezone, new Date('2026-03-08T06:30:00Z')), -300);
    assert.equal(c.environmentTimezoneOffset(ny.timezone, new Date('2026-03-08T07:30:00Z')), -240);
    assert.equal(c.environmentTimezoneOffset('Asia/Kathmandu', new Date('2026-11-04T00:00:00Z')), 345);
    assert.equal(c.environmentDateKey(ny.timezone, new Date('2026-11-04T01:00:00Z')), '2026-11-03');
    assert.equal(c.environmentDateKey(shanghai.timezone, new Date('2026-11-04T01:00:00Z')), '2026-11-04');
});
test('holiday scope excludes other states and preserves Chinese working-day adjustments', () => {
    const { c } = fixture();
    const days = c.normalizeEnvironmentHolidays([
        { date: '2026-01-01', name: 'national', global: true, types: ['Public'] },
        { date: '2026-02-01', name: 'CA', counties: ['US-CA'], global: false },
        { date: '2026-03-01', name: 'NY', counties: ['US-NY'], global: false },
        { date: '2026-04-01', name: 'unknown region', global: false },
        { date: '2025-01-01', name: 'wrong year', global: true }
    ], ny, 2026);
    assert.deepEqual(plain(days).map(day => day.name), ['national', 'NY']);
    const cn = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/holidays/cn-2026.json'), 'utf8'));
    const normalized = c.normalizeEnvironmentHolidays(cn, shanghai, 2026);
    assert.ok(normalized.some(day => day.date === '2026-01-04' && !day.isOffDay));
    assert.ok(normalized.some(day => day.name === '春节' && day.isOffDay));
    const observance = c.normalizeEnvironmentHolidays([{ date: '2026-04-02', name: '纪念日', global: true, types: ['Observance'] }], ny, 2026)[0];
    assert.equal(observance.isOffDay, false); assert.equal(observance.isWorkDay, false);
});
test('weather cache avoids repeated calls; failed weather is not cached as sunshine', async () => {
    const { c } = fixture(); let calls = 0;
    c.fetch = async () => { calls++; return { ok: true, json: async () => ({ current: { temperature_2m: 21.5, weather_code: 61, time: '2026-11-04T10:00' } }) }; };
    const settings = c.getEnvironmentSettings();
    assert.equal((await c.getEnvironmentWeather(shanghai, settings)).text, '雨');
    await c.getEnvironmentWeather(shanghai, settings); assert.equal(calls, 1);
    c.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(c.getEnvironmentWeather(ny, settings), /503/);
    c.fetch = async () => ({ ok: true, json: async () => ({ current: { temperature_2m: 0, weather_code: 0 } }) });
    assert.equal((await c.getEnvironmentWeather(ny, settings)).temperature, 0);
});
test('unsupported holidays report unavailable instead of an empty supported calendar', async () => {
    const { c } = fixture(); c.fetch = async () => ({ ok: true, json: async () => [{ countryCode: 'US' }] });
    await assert.rejects(c.getEnvironmentHolidays({ ...shanghai, countryCode: 'ZZ' }, 2026), /不覆盖/);
});
test('geolocation denial leaves manual city search available', async () => {
    const { c } = fixture(); c.navigator.geolocation = { getCurrentPosition: (_, reject) => reject({ code: 1 }) };
    await assert.rejects(c.locateEnvironmentUser(), /定位失败或未授权/);
    c.fetch = async () => ({ ok: true, json: async () => ({ results: [{ ...shanghai, country_code: 'CN' }] }) });
    assert.equal((await c.searchEnvironmentCities('上海'))[0].name, '上海');
});
test('environment tool templates escape city strings and preserve numeric types', () => {
    const { c } = fixture();
    const args = c.environmentToolArguments('{"name":"{{name}}","latitude":{{latitude}}}', { name: 'x"},"evil":true,"x":"', latitude: 1.25 });
    assert.deepEqual(plain(args), { name: 'x"},"evil":true,"x":"', latitude: 1.25 });
    assert.throws(() => c.environmentToolArguments('{"year":{{year}}}', {}), /缺少/);
    assert.throws(() => c.environmentToolArguments('[]', {}), /对象/);
});
test('real MCP handshake, session header, version and tool result are supported', async () => {
    const { c, requests } = fixture();
    const config = c.getEnvironmentSettings(); config.service = 'mcp'; config.mcp.url = 'https://mcp.test/rpc'; config.mcp.token = 'test-secret';
    c.fetch = async (url, init) => {
        const body = JSON.parse(init.body); requests.push({ url, init, body });
        const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } } : { structuredContent: { temperature: 8, text: '多云' } };
        return { ok: true, headers: new Headers({ 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-1' }), body: { cancel: async () => {} }, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
    };
    assert.equal((await c.getEnvironmentWeather(ny, config)).temperature, 8);
    assert.deepEqual(requests.map(r => r.body.method), ['initialize', 'notifications/initialized', 'tools/call']);
    assert.equal(requests[2].init.headers['Mcp-Session-Id'], 'session-1');
    assert.equal(requests[2].init.headers['MCP-Protocol-Version'], '2025-06-18');
    assert.equal(requests[2].body.params.arguments.latitude, ny.latitude);
    assert.equal(requests[2].init.credentials, 'omit');
});
test('MCP SSE parses split events, ignores notifications and cancels an open stream after its result', async () => {
    const { c } = fixture(); let cancelled = false;
    c.fetch = async (_, init) => {
        const id = JSON.parse(init.body).id;
        const text = 'event: message\ndata: {"method":"notifications/progress"}\n\ndata: ' + JSON.stringify({ id, result: { ok: true } }) + '\n\n';
        const bytes = new TextEncoder().encode(text); let i = 0;
        return { ok: true, headers: new Headers({ 'Content-Type': 'text/event-stream' }), body: { getReader: () => ({ read: async () => ({ value: bytes.slice(i, i += 7), done: i > bytes.length + 7 }), cancel: async () => { cancelled = true; }, releaseLock() {} }) } };
    };
    const result = await c.environmentMcpRpc({ url: 'https://mcp.test', token: '', version: '' }, 'tools/list', {});
    assert.equal(result.ok, true); assert.equal(cancelled, true);
});
test('MCP cache is isolated between credentials and is never persisted', async () => {
    const { c, storage } = fixture(); let calls = 0;
    c.callEnvironmentMcp = async () => ({ temperature: ++calls });
    const a = c.getEnvironmentSettings(); a.service = 'mcp'; a.mcp.url = 'https://mcp.test'; a.mcp.token = 'secret-a';
    const b = structuredClone(a); b.mcp.token = 'secret-b';
    assert.equal((await c.getEnvironmentWeather(ny, a)).temperature, 1);
    assert.equal((await c.getEnvironmentWeather(ny, b)).temperature, 2);
    const persisted = [...storage.values()].join('');
    assert.equal(persisted.includes('secret-a'), false); assert.equal(persisted.includes('mcp.test'), false);
});
test('AI environment awareness is separately gated, uses both locations and omits exact coordinates', async () => {
    const { c, chat } = fixture();
    c.db.environmentSettings = { enabled: true, userLocation: shanghai };
    assert.equal(await c.getEnvironmentContext(chat), '');
    chat.environmentProfile = { aiEnabled: true, remoteEnabled: true, charLocation: ny };
    c.getEnvironmentWeather = async () => ({ temperature: 21, text: '多云', fetchedAt: 123 });
    c.getEnvironmentHolidays = async () => ({ days: [] });
    const context = await c.getEnvironmentContext(chat);
    assert.match(context, /上海/); assert.match(context, /纽约/); assert.match(context, /时差/);
    assert.equal(context.includes('latitude'), false); assert.equal(context.includes('longitude'), false);
});
test('avatar candidates only include real delivered images from the current character archive', async () => {
    const { c, chat } = fixture();
    chat.history = [{ id: 'text', role: 'user', content: '[照片：小猫]' },
        { id: 'image', role: 'user', timestamp: 1, parts: [{ type: 'image', data: 'data:image/png;base64,YQ==' }] },
        { id: 'rejected', role: 'user', relationshipDelivery: 'blocked', parts: [{ type: 'image', data: 'data:image/png;base64,Yg==' }] },
        { id: 'gen', role: 'assistant', timestamp: 2 }];
    c.dexieDB = { characterPhotos: { where: () => ({ equals: id => { assert.equal(id, 'char'); return { reverse: () => ({ limit: () => ({ toArray: async () => [
        { id: 1, archiveId: 'a', messageId: 'gen', image: 'Yw==', timestamp: 3 },
        { id: 2, archiveId: 'b', messageId: 'gen', image: 'ZA==', timestamp: 4 }
    ] }) }) }; } }) } };
    assert.deepEqual(plain(await c.collectAvatarCandidates(chat)).map(item => item.id), ['message:image:0', 'photo:1']);
});
function enableAvatar(f) {
    f.chat.avatarAutonomy = { enabled: true, every: 1 };
    f.chat.history.push({ id: 'u', role: 'user', timestamp: 1, content: 'data:image/png;base64,YQ==', parts: [{ type: 'image', data: 'data:image/png;base64,YQ==' }] });
}
test('avatar action uses validated image ID, compresses a Blob and can preserve the previous avatar', async () => {
    const f = fixture(); enableAvatar(f); let descriptions = 0, decisions = 0;
    f.c.recognizeStickerImage = async () => { descriptions++; return '猫'; };
    f.c.fetchAiResponse = async (_, body) => { decisions++; assert.equal(JSON.stringify(body).includes('data:image'), false); return '{"action":"set_avatar","imageId":"message:u:0"}'; };
    f.c.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) });
    f.c.compressImage = async blob => { assert.ok(blob instanceof Blob); return 'data:image/png;base64,Yg=='; };
    f.c.refreshCharacterAvatar = () => {};
    assert.equal(await f.c.checkCharacterAvatar(f.chat, true), true);
    assert.equal(f.chat.avatarPrevious, 'https://test.invalid/old.png'); assert.equal(f.chat.avatar, 'data:image/png;base64,Yg==');
    f.c.fetchAiResponse = async () => '{"action":"keep"}';
    assert.equal(await f.c.checkCharacterAvatar(f.chat, true), false); assert.equal(descriptions, 1); assert.equal(decisions, 1);
    f.c.resolveAuxiliaryApiConfig = () => ({ url: 'https://test.invalid', provider: 'newapi', model: 'different', key: 'fake' });
    await f.c.checkCharacterAvatar(f.chat, true); assert.equal(descriptions, 2);
});
test('invalid avatar IDs and stale archive decisions cannot change the avatar', async () => {
    for (const stale of [false, true]) {
        const f = fixture(); enableAvatar(f);
        f.c.fetchAiResponse = async () => { if (stale) { f.chat.activeArchiveId = 'b'; f.chat.history = []; } return '{"action":"set_avatar","imageId":"made-up"}'; };
        if (stale) assert.equal(await f.c.checkCharacterAvatar(f.chat, true), false);
        else await assert.rejects(f.c.checkCharacterAvatar(f.chat, true), /不存在/);
        assert.equal(f.chat.avatar, 'https://test.invalid/old.png');
    }
});
test('failed derived save restores only its fields and preserves a newly switched archive', async () => {
    for (const switched of [false, true]) {
        const f = fixture(); f.chat.avatarAutonomy = { enabled: false }; f.chat.archives[0].data.avatarAutonomy = { enabled: false };
        const original = f.chat.avatarAutonomy, changes = { avatar: 'https://test.invalid/new.png', avatarAutonomy: { enabled: true } };
        f.c.saveData = async () => {
            f.chat.archives[0].data.avatarAutonomy = structuredClone(changes.avatarAutonomy);
            if (switched) { f.chat.activeArchiveId = 'b'; f.chat.avatarAutonomy = { enabled: false, condition: 'new branch' }; }
            throw Error('quota');
        };
        await assert.rejects(f.c.saveDerivedChatFields(f.chat, changes), /保存失败/);
        assert.equal(f.chat.avatar, 'https://test.invalid/old.png');
        if (switched) assert.equal(f.chat.avatarAutonomy.condition, 'new branch'); else assert.equal(f.chat.avatarAutonomy, original);
        assert.equal(f.chat.archives[0].data.avatarAutonomy.enabled, false);
    }
});
test('new environment settings and archive extensions survive the existing backup format', () => {
    const { c, chat } = fixture(); vm.runInContext(source('storage.js'), c);
    c.db.environmentSettings = { enabled: true, userLocation: shanghai };
    chat.environmentProfile = { aiEnabled: false, remoteEnabled: true, charLocation: ny };
    chat.avatarAutonomy = { enabled: true, every: 5 };
    const backup = c.storageExportChat(chat, true, true);
    assert.deepEqual(plain(backup.environmentProfile), chat.environmentProfile);
    assert.equal(backup.avatarAutonomy.enabled, true);
    const contact = c.storageExportChat(chat, true, false); assert.equal(contact.avatarAutonomy, undefined);
    c.storageValidateModules({ characters: [backup], environmentSettings: c.db.environmentSettings });
});

test('deep validation rejects corrupt new fields before import without rejecting legacy backups', () => {
    const { c } = fixture(); vm.runInContext(source('storage.js'), c);
    c.storageValidateModules({ characters: [{ id: 'old', history: [] }] });
    for (const payload of [
        { environmentSettings: { enabled: 'yes' } },
        { environmentSettings: { userLocation: { latitude: 91 } } },
        { environmentSettings: { mcp: { tools: { weather: 'not an object' } } } },
        { characters: [{ id: 'a', avatarAutonomy: { cache: { img: { description: [] } } } }] },
        { characters: [{ id: 'a', archives: [{ id: 'b', data: { environmentProfile: { aiEnabled: 'yes' } } }] }] }
    ]) assert.throws(() => c.storageValidateModules(payload));
});
test('cancelled environment request and changed settings never inject stale location data', async () => {
    for (const cancelled of [true, false]) {
        const { c, chat } = fixture();
        c.db.environmentSettings = { enabled: true, userLocation: shanghai }; chat.environmentProfile = { aiEnabled: true };
        const controller = new AbortController();
        c.getEnvironmentWeather = async () => { if (cancelled) controller.abort(); else c.db.environmentSettings = { enabled: false }; return { temperature: 10 }; };
        c.getEnvironmentHolidays = async () => ({ days: [] });
        if (cancelled) await assert.rejects(c.getEnvironmentContext(chat, controller.signal), error => error.name === 'AbortError');
        else assert.equal(await c.getEnvironmentContext(chat, controller.signal), '');
    }
});
test('a selected compressed avatar is not recompressed or replaced on a later identical decision', async () => {
    const f = fixture(); enableAvatar(f); let compressed = 0;
    f.c.fetchAiResponse = async () => '{"action":"set_avatar","imageId":"message:u:0"}';
    f.c.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) });
    f.c.compressImage = async () => { compressed++; return 'data:image/png;base64,Yg=='; }; f.c.refreshCharacterAvatar = () => {};
    await f.c.checkCharacterAvatar(f.chat, true); const previous = f.chat.avatarPrevious;
    await f.c.checkCharacterAvatar(f.chat, true);
    assert.equal(compressed, 1); assert.equal(f.chat.avatarPrevious, previous);
});
function mainFixture(provider) {
    const f = fixture(), c = f.c;
    f.chat.realName = '角色'; f.chat.myName = '用户'; f.chat.maxMemory = 20;
    f.chat.history = [{ id: 'u', role: 'user', content: '[用户的消息：你好]', timestamp: 1700000000000 }];
    c.db.apiSettings = { provider, url: 'https://test.invalid', key: 'fake', model: 'model', streamEnabled: false };
    Object.assign(c, { document: { addEventListener() {}, getElementById: () => null }, window: {}, isGenerating: false,
        AudioManager: { unlock() {} }, getReplyBtn: {}, regenerateBtn: {}, typingIndicator: { style: {} }, messageArea: {},
        generatePrivateSystemPrompt: () => '原始提示词', getRandomValue: value => value, showApiError: error => { throw error; } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/utils.js'), 'utf8'), c);
    vm.runInContext(source('chat_ai.js'), c);
    c.handleAiReplyContent = async () => {};
    c.fetch = async (url, init) => {
        f.requests.push({ url, body: JSON.parse(init.body) });
        return { ok: true, json: async () => provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: '回复' }] } }] } : { choices: [{ message: { content: '回复' } }] } };
    };
    return f;
}
test('loading optional modules with defaults preserves exact main request bodies for both providers', async () => {
    for (const provider of ['newapi', 'gemini']) {
        const f = mainFixture(provider);
        await f.c.getAiReply('char', 'private'); const withModules = JSON.stringify(f.requests[0].body);
        f.c.getEnvironmentContext = undefined; f.c.checkCharacterAvatar = undefined;
        await f.c.getAiReply('char', 'private');
        assert.equal(JSON.stringify(f.requests[1].body), withModules);
    }
});
test('enabled environment appends data without changing original messages or persona/worldbook builders', async () => {
    for (const provider of ['newapi', 'gemini']) {
        const f = mainFixture(provider); const before = JSON.stringify(f.chat.history);
        f.c.getEnvironmentContext = async () => '\n【可选真实环境资料】\n上海多云';
        await f.c.getAiReply('char', 'private');
        const body = f.requests[0].body;
        const system = provider === 'gemini' ? body.system_instruction.parts[0].text : body.messages.find(m => m.role === 'system').content;
        assert.ok(system.startsWith('原始提示词')); assert.match(system, /上海多云/);
        assert.equal(JSON.stringify(f.chat.history), before);
    }
});
test('environment token classification reads the final body without double-counting it as base prompts', () => {
    const { c, chat } = fixture();
    c.getAutoMemoryContextHistory = () => []; c.buildWorldBookPlan = () => []; c.getContextMemoryJournals = () => [];
    vm.runInContext(source('chat_ai_prompt.js'), c);
    const env = '\n【可选真实环境资料】\n上海多云', body = { messages: [{ role: 'system', content: '基础' + env }] }, before = JSON.stringify(body);
    const result = c.estimateChatTokenUsage(chat, 'private', body.messages[0].content, [], '', [], body, env);
    assert.ok(result.environment > 0); assert.ok(result.baseSystem > 0);
    assert.equal(result.total, result.environment + result.baseSystem); assert.equal(JSON.stringify(body), before);
});
test('deleting an older candidate outside the recent context still invalidates its avatar decision', async () => {
    const f = fixture(); enableAvatar(f);
    for (let i = 0; i < 30; i++) f.chat.history.push({ id: 'later-' + i, role: 'user', content: '继续聊天', timestamp: 10 + i });
    f.c.fetchAiResponse = async () => { f.chat.history.splice(0, 1); return '{"action":"set_avatar","imageId":"message:u:0"}'; };
    assert.equal(await f.c.checkCharacterAvatar(f.chat, true), false);
    assert.equal(f.chat.avatar, 'https://test.invalid/old.png');
});
test('archive switch during asynchronous avatar compression cannot save the new branch', async () => {
    const f = fixture(); enableAvatar(f); let saves = 0;
    f.c.fetchAiResponse = async () => '{"action":"set_avatar","imageId":"message:u:0"}';
    f.c.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) });
    f.c.compressImage = async () => { f.chat.activeArchiveId = 'b'; return 'data:image/png;base64,Yg=='; };
    f.c.saveData = async () => { saves++; };
    assert.equal(await f.c.checkCharacterAvatar(f.chat, true), false);
    assert.equal(saves, 0); assert.equal(f.chat.avatar, 'https://test.invalid/old.png');
});

test('explicit avatar requests bypass interval 100 once, with the exact selection sent independently', async () => {
    const f = fixture(); enableAvatar(f); f.chat.avatarAutonomy.every = 100;
    let decisions = 0;
    f.c.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) });
    f.c.compressImage = async () => 'data:image/png;base64,Yg=='; f.c.refreshCharacterAvatar = () => {};
    f.chat.history.push({ id: 'ask', role: 'user', content: '[用户的消息：我们换这对情头吧]' });
    const original = JSON.stringify(f.chat.history);
    f.c.fetchAiResponse = async (_, body) => {
        decisions++;
        const data = JSON.parse(body.messages[1].content);
        assert.equal(data.explicitRequest.text, '我们换这对情头吧');
        return '{"action":"set_avatar","imageId":"message:u:0"}';
    };
    assert.equal(await f.c.checkCharacterAvatar(f.chat), true);
    await f.c.checkCharacterAvatar(f.chat);
    assert.equal(decisions, 1); assert.equal(JSON.stringify(f.chat.history), original);
    assert.equal(f.chat.avatar, 'data:image/png;base64,Yg==');
    assert.ok(f.chat.avatarAutonomy.lastRequestKey.includes('ask'));
    f.chat.history.push({ id: 'pick', role: 'user', content: '[用户的消息：你用男生]' });
    f.c.fetchAiResponse = async (_, body) => {
        decisions++;
        const data = JSON.parse(body.messages[1].content);
        assert.equal(data.explicitRequest.text, '你用男生');
        assert.equal(data.explicitRequest.previousRequest, '我们换这对情头吧');
        return '{"action":"keep"}';
    };
    await f.c.checkCharacterAvatar(f.chat);
    assert.equal(decisions, 2);
});

test('routine, revoked, rejected and forwarded text cannot become an explicit avatar request', () => {
    const { c } = fixture();
    for (const content of ['今天好累', '不要换头像', '别用这张头像', '你用男生']) {
        assert.equal(c.characterAvatarRequest([{ id: 'a', role: 'user', content }]), null);
    }
    for (const extra of [{ role: 'assistant' }, { role: 'user', isWithdrawn: true }, { role: 'user', isContextDisabled: true }, { role: 'user', relationshipDelivery: 'blocked' }, { role: 'user', type: 'forwarded-chat' }]) {
        assert.equal(c.characterAvatarRequest([{ id: 'x', content: '我们换这对情头吧', ...extra }]), null);
    }
    const history = [{ id: 'a', role: 'user', content: '换头像吧' }, { id: 'b', role: 'user', content: '不要换头像' }, { id: 'c', role: 'user', content: '你用男生' }];
    assert.equal(c.characterAvatarRequest(history), null);
    assert.equal(c.characterAvatarRequest([{ id: 'a', role: 'user', content: '换头像吧' }, { id: 'b', role: 'user', content: '你好' }]), null);
});

test('in-flight avatar decisions coalesce a newer request and discard the stale result', async () => {
    const f = fixture(); enableAvatar(f); f.chat.avatarAutonomy.every = 100;
    f.chat.history.push({ id: 'ask', role: 'user', content: '换这对情头吧' });
    let release, entered, decisions = 0;
    const started = new Promise(resolve => { entered = resolve; });
    f.c.fetchAiResponse = async (_, body) => {
        decisions++;
        if (decisions === 1) { entered(); await new Promise(resolve => { release = resolve; }); }
        else assert.equal(JSON.parse(body.messages[1].content).explicitRequest.text, '你用男生');
        return '{"action":"keep"}';
    };
    const first = f.c.checkCharacterAvatar(f.chat); await started;
    f.chat.history.push({ id: 'pick', role: 'user', content: '你用男生' });
    await f.c.checkCharacterAvatar(f.chat); release(); await first;
    assert.equal(decisions, 2); assert.ok(f.chat.avatarAutonomy.lastRequestKey.includes('pick'));
});

test('queued avatar work never replays across an archive switch', async () => {
    const f = fixture(); enableAvatar(f);
    let release, entered, calls = 0;
    const started = new Promise(resolve => { entered = resolve; });
    f.c.fetchAiResponse = async () => { calls++; entered(); await new Promise(resolve => { release = resolve; }); return '{"action":"keep"}'; };
    const first = f.c.checkCharacterAvatar(f.chat, true); await started;
    await f.c.checkCharacterAvatar(f.chat, true);
    f.chat.activeArchiveId = 'b'; f.chat.history = []; release(); await first;
    assert.equal(calls, 1); assert.equal(f.chat.avatarAutonomy.lastCheck, undefined);
});

test('failed explicit avatar calls cool down but a new selection request can retry immediately', async () => {
    const f = fixture(); enableAvatar(f); f.chat.avatarAutonomy.every = 100;
    f.chat.history.push({ id: 'ask', role: 'user', content: '换这对情头吧' });
    let calls = 0;
    f.c.fetchAiResponse = async () => { calls++; throw Error('API unavailable'); };
    await assert.rejects(f.c.checkCharacterAvatar(f.chat), /unavailable/);
    await f.c.checkCharacterAvatar(f.chat); assert.equal(calls, 1);
    f.chat.history.push({ id: 'pick', role: 'user', content: '你用男生' });
    await assert.rejects(f.c.checkCharacterAvatar(f.chat), /unavailable/);
    assert.equal(calls, 2); assert.equal(f.chat.avatarAutonomy.lastRequestKey, undefined);
});

test('explicit requests remain unconsumed if avatar persistence rolls back', async () => {
    const f = fixture(); enableAvatar(f); f.chat.avatarAutonomy.every = 100;
    f.chat.history.push({ id: 'ask', role: 'user', content: '换这张头像吧' });
    const before = JSON.stringify(f.chat.avatarAutonomy);
    f.c.saveData = async () => { throw Error('quota exceeded'); };
    await assert.rejects(f.c.checkCharacterAvatar(f.chat), /保存失败/);
    assert.equal(JSON.stringify(f.chat.avatarAutonomy), before);
});
