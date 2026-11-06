const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../js', name), 'utf8');
const modulePath = path.join(__dirname, '../js/modules/chat_image_generation.js');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=';
const dataUrl = `data:image/png;base64,${png}`;

function fixture() {
    const elements = new Map(), timers = new Map(), calls = [], bubbles = [], toasts = [];
    const element = id => {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, { value: '', textContent: '', checked: false, disabled: false, hidden: false,
                classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
                addEventListener(name, fn) { this[name] = fn; }, setAttribute() {}, removeAttribute() {},
                querySelector() { return element(id + '-child'); } });
        }
        return elements.get(id);
    };
    const chats = ['a', 'b'].map(id => ({ id, myName: 'me', activeArchiveId: 'first', history: [] }));
    const c = vm.createContext({ window: {}, document: { getElementById: element },
        db: { characters: chats, groups: [], workshopSettings: { provider: 'gpt', gptModel: 'image-model',
            gptApiUrl: 'https://image.test', gptApiKey: 'test-key', gptAspectRatio: '1024x1024' } },
        currentChatId: 'a', currentChatType: 'private', Blob, URL, AbortController, structuredClone, atob, btoa,
        setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
        saveData: async () => {}, renderChatList() {}, renderMessages() {},
        addMessageBubble: (...args) => bubbles.push(args), showToast: text => toasts.push(text), console,
        relationshipCanSend: () => true, prepareRelationshipMessage(chat, message) { message.prepared = true; },
        fetch: async () => { throw Error('unexpected fetch'); },
        FileReader: class {
            readAsDataURL(blob) {
                blob.arrayBuffer().then(buffer => {
                    this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
                    this.onload?.();
                }, error => this.onerror?.(error));
            }
        }
    });
    vm.runInContext(read('modules/chat_ops.js'), c);
    if (fs.existsSync(modulePath)) vm.runInContext(fs.readFileSync(modulePath, 'utf8'), c);
    const feature = fs.existsSync(modulePath) ? vm.runInContext('ChatImageGeneration', c) : undefined;
    c.window.executeImageGeneration = async (...args) => {
        calls.push(args);
        return { imageData: png, payload: { prompt: args[1] } };
    };
    if (feature) {
        feature.setup();
        feature.open();
        element('pv-mode-ai').checked = true;
        element('pv-mode-text').checked = false;
        element('send-pv-modal').classList.add('visible');
    }
    return { c, chats, feature, element, calls, bubbles, toasts, timers };
}

test('AI image mode sends one normal image with the entered description, without changing workshop settings', async () => {
    const f = fixture(); assert.ok(f.feature, 'chat generation module exists');
    const before = JSON.stringify(f.c.db.workshopSettings);
    assert.equal(await f.feature.send('窗边的一杯咖啡'), true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1], '窗边的一杯咖啡');
    assert.equal(JSON.stringify(f.c.db.workshopSettings), before);
    const message = f.chats[0].history[0];
    assert.equal(message.role, 'user'); assert.equal(message.content, dataUrl);
    assert.equal(message.parts[1].type, 'image'); assert.equal(message.parts[1].data, dataUrl);
    assert.match(message.parts[0].text, /窗边的一杯咖啡/);
    assert.equal(message.prepared, true);
    assert.equal(f.element('send-pv-modal').classList.contains('visible'), false);
    assert.equal(f.timers.size, 0);
});

test('changing open chat during generation still sends only to the captured chat', async () => {
    const f = fixture(); assert.ok(f.feature);
    let finish;
    f.c.window.executeImageGeneration = (...args) => { f.calls.push(args); return new Promise(resolve => finish = resolve); };
    const pending = f.feature.send('first draft');
    f.c.currentChatId = 'b'; f.c.db.workshopSettings.gptModel = 'later-model';
    finish({ imageData: png });
    assert.equal(await pending, true);
    assert.equal(f.calls[0][0].gptModel, 'image-model');
    assert.equal(f.chats[0].history.length, 1); assert.equal(f.chats[1].history.length, 0);
    assert.equal(f.bubbles.length, 0);
});

test('archive switches, removed chats and changed relationship revisions discard late images', async () => {
    for (const change of [f => { f.chats[0].activeArchiveId = 'second'; f.chats[0].history = []; },
        f => { f.c.db.characters = [f.chats[1]]; }, f => { f.chats[0].friendRelationship = { revision: 2 }; }]) {
        const f = fixture(); assert.ok(f.feature);
        let finish;
        f.c.window.executeImageGeneration = () => new Promise(resolve => finish = resolve);
        const pending = f.feature.send('draft'); change(f); finish({ imageData: png });
        assert.equal(await pending, false);
        assert.equal(f.chats[0].history.length, 0); assert.equal(f.chats[1].history.length, 0);
        assert.equal(f.timers.size, 0);
    }
});

test('cancel and duplicate submission do not send late results even when a provider ignores abort', async () => {
    const f = fixture(); assert.ok(f.feature);
    let finish, signal;
    f.c.window.executeImageGeneration = (_, __, options) => {
        f.calls.push([]); signal = options.signal; return new Promise(resolve => finish = resolve);
    };
    const pending = f.feature.send('draft');
    assert.equal(await f.feature.send('duplicate'), false); assert.equal(f.calls.length, 1);
    f.feature.cancel(); assert.equal(signal.aborted, true);
    finish({ imageData: png });
    assert.equal(await pending, false); assert.equal(f.chats[0].history.length, 0);
    assert.equal(f.timers.size, 0);
});

test('failed save restores history and retry reuses the picture instead of buying another generation', async () => {
    const f = fixture(); assert.ok(f.feature);
    f.c.saveData = async () => { throw Error('quota'); };
    assert.equal(await f.feature.send('draft'), false); assert.equal(f.chats[0].history.length, 0);
    assert.equal(f.calls.length, 1); assert.equal(f.element('send-pv-modal').classList.contains('visible'), true);
    f.c.saveData = async () => {};
    assert.equal(await f.feature.send('draft'), true); assert.equal(f.calls.length, 1);
    assert.equal(f.chats[0].history.length, 1);
});

test('changed draft after a failed save generates the new picture rather than reusing the old one', async () => {
    const f = fixture(); assert.ok(f.feature);
    f.c.saveData = async () => { throw Error('quota'); };
    await f.feature.send('old draft');
    f.c.saveData = async () => {};
    assert.equal(await f.feature.send('new draft'), true); assert.equal(f.calls.length, 2);
    assert.match(f.chats[0].history[0].parts[0].text, /new draft/);
});

test('an old save finishing cannot close or overwrite a reopened dialog for another chat', async () => {
    const f = fixture();
    let finishSave;
    f.c.saveData = () => new Promise(resolve => finishSave = resolve);
    const first = f.feature.send('first picture');
    while (!finishSave) await new Promise(setImmediate);
    f.c.currentChatId = 'b'; f.feature.open();
    f.element('send-pv-modal').classList.add('visible');
    f.element('pv-text-input').value = 'second picture';
    let finishGeneration;
    f.c.window.executeImageGeneration = () => new Promise(resolve => finishGeneration = resolve);
    const second = f.feature.send('second picture');
    assert.equal(typeof finishGeneration, 'function');
    finishSave(); assert.equal(await first, true);
    assert.equal(f.element('send-pv-modal').classList.contains('visible'), true);
    assert.equal(f.element('pv-text-input').value, 'second picture');
    assert.equal(f.element('pv-send-btn').disabled, true);
    f.c.saveData = async () => {}; finishGeneration({ imageData: png });
    assert.equal(await second, true); assert.equal(f.chats[1].history.length, 1);
});

test('remote results are downloaded without credentials and saved as durable image data', async () => {
    const f = fixture(); assert.ok(f.feature);
    f.c.window.executeImageGeneration = async () => ({ imageData: 'https://cdn.test/temporary?token=temporary' });
    const requests = [];
    f.c.fetch = async (url, options) => {
        requests.push({ url, options });
        return { ok: true, headers: new Headers(), blob: async () => new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }) };
    };
    assert.equal(await f.feature.send('draft'), true);
    assert.equal(requests.length, 1); assert.equal(requests[0].options.credentials, 'omit');
    assert.equal(requests[0].options.headers, undefined);
    assert.equal(f.chats[0].history[0].content, dataUrl);
});

test('invalid provider data and unavailable remote images keep the draft and send no message', async () => {
    for (const result of ['not an image', 'data:text/html;base64,PHNjcmlwdD4=', 'https://cdn.test/failed']) {
        const f = fixture(); assert.ok(f.feature); f.element('pv-text-input').value = 'keep me';
        f.c.window.executeImageGeneration = async () => ({ imageData: result });
        f.c.fetch = async () => ({ ok: false, status: 403 });
        assert.equal(await f.feature.send('keep me'), false); assert.equal(f.chats[0].history.length, 0);
        assert.equal(f.element('pv-text-input').value, 'keep me'); assert.equal(f.timers.size, 0);
    }
});

test('group image messages retain user sender identity', async () => {
    const f = fixture(); assert.ok(f.feature);
    const group = { id: 'g', activeArchiveId: 'g-first', history: [], me: { nickname: 'group-me' } };
    f.c.db.groups.push(group); f.c.currentChatId = 'g'; f.c.currentChatType = 'group'; f.feature.open();
    assert.equal(await f.feature.send('group picture'), true);
    assert.equal(group.history[0].senderId, 'user_me'); assert.match(group.history[0].parts[0].text, /group-me/);
    assert.equal(f.chats[0].history.length, 0);
});

test('timeout releases the dialog even when the provider never settles', async () => {
    const f = fixture(); assert.ok(f.feature);
    let signal;
    f.c.window.executeImageGeneration = (_, __, options) => { signal = options.signal; return new Promise(() => {}); };
    const pending = f.feature.send('draft'); [...f.timers.values()][0]();
    await new Promise(setImmediate);
    assert.equal(f.element('pv-send-btn').disabled, false);
    assert.match(f.element('pv-generation-status').textContent, /超时/);
    assert.equal(signal.aborted, true);
    assert.equal(await pending, false); assert.equal(f.chats[0].history.length, 0);
});

test('workshop generation passes optional cancellation through both provider paths and keeps old callers valid', async () => {
    for (const provider of ['gpt', 'novelai']) {
        const calls = [], controller = new AbortController();
        const c = vm.createContext({ window: {}, console: { log() {} },
            fetch: async (url, options) => { calls.push({ url, options }); return { ok: true }; } });
        vm.runInContext(read('modules/image-workshop/generation.js'), c);
        c.buildGPTPayload = async () => ({ prompt: 'test' });
        c.buildNovelAIPayload = async () => ({ input: 'test' });
        c.window.parseImageResponse = async () => png;
        const settings = { provider, [provider + 'ApiUrl']: 'https://image.test', [provider + 'ApiKey']: 'test', [provider + 'Model']: 'model' };
        await c.window.executeImageGeneration(settings, 'test', { signal: controller.signal });
        assert.equal(calls[0].options.signal, controller.signal);
        await c.window.executeImageGeneration(settings, 'test');
        assert.equal(calls[1].options.signal, undefined);
    }
});

test('the existing photo dialog keeps text sending as default and routes only AI mode to generation', async () => {
    const f = fixture();
    vm.runInContext(read('modules/chat_features.js'), f.c);
    const textCalls = [];
    f.c.sendMyPhotoVideo = text => { textCalls.push(text); return true; };
    f.element('send-pv-form').reset = () => {
        f.element('pv-text-input').value = '';
        f.element('pv-mode-text').checked = true; f.element('pv-mode-ai').checked = false;
    };
    f.c.setupPhotoVideoSystem();
    f.element('photo-video-btn').click();
    assert.equal(f.feature.isSelected(), false);
    f.element('pv-text-input').value = 'text only';
    await f.element('send-pv-form').submit({ preventDefault() {} });
    assert.deepEqual(textCalls, ['text only']); assert.equal(f.calls.length, 0);
    f.element('pv-mode-ai').checked = true; f.element('pv-mode-text').checked = false;
    f.element('pv-text-input').value = 'real picture';
    await f.element('send-pv-form').submit({ preventDefault() {} });
    assert.equal(f.calls.length, 1); assert.equal(f.chats[0].history.length, 1);
});
