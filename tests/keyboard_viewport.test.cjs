const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
const keyboardSource = source.slice(source.indexOf('function initKeyboardDetection()'), source.indexOf('function setupBottomNavigation()'));

function fixture(ios = false) {
    const handlers = {}, frames = [], timers = new Map(), classes = new Set(), properties = new Map(), panel = new Map();
    let timerId = 0, saves = 0, active = true;
    const style = values => ({ setProperty(key, value) { values.set(key, value); }, removeProperty(key) { values.delete(key); } });
    const phone = { style: style(properties), classList: { contains: name => classes.has(name), toggle(name, yes) { if (yes) classes.add(name); else classes.delete(name); } } };
    const viewport = { height: 800, offsetTop: 0, scale: 1, addEventListener(name, fn) { handlers['viewport:' + name] = fn; } };
    const input = { tagName: 'INPUT', chat: true };
    const document = { activeElement: input, querySelector: () => phone,
        documentElement: { style: style(panel) }, body: { scrollTop: 0 }, addEventListener(name, fn) { (handlers['document:' + name] ||= []).push(fn); } };
    const area = { scrollHeight: 1000, clientHeight: 500, scrollTop: 500 };
    const window = { visualViewport: viewport, innerHeight: 800, scrollY: 0, scrollTo() { this.scrollY = 0; },
        addEventListener(name, fn) { handlers['window:' + name] = fn; } };
    const c = vm.createContext({ window, document, navigator: { userAgent: ios ? 'iPhone' : 'Android', platform: '', maxTouchPoints: 1 },
        db: {}, chatRoomScreen: { classList: { contains: () => active }, contains: element => element?.chat }, messageArea: area,
        requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
        saveData: async () => { saves++; } });
    vm.runInContext(keyboardSource, c); c.initKeyboardDetection();
    const flush = () => { while (frames.length) frames.shift()(); };
    const resize = height => { viewport.height = height; handlers['viewport:resize'](); flush(); };
    return { c, viewport, document, classes, properties, panel, window, area, handlers, timers, flush, resize,
        leave: () => { active = false; window.refreshChatViewport(); flush(); }, saves: () => saves };
}

for (const ios of [false, true]) {
    test((ios ? 'iOS' : 'Android') + ' chat follows keyboard height and visual viewport offset without moving the whole layout', () => {
        const f = fixture(ios); f.resize(480);
        assert.equal(f.classes.has('chat-keyboard-open'), true);
        assert.equal(f.properties.get('--chat-viewport-height'), '480px');
        assert.equal(f.properties.get('--chat-viewport-top'), '0px');
        f.viewport.offsetTop = 75; f.handlers['viewport:scroll'](); f.flush();
        assert.equal(f.properties.get('--chat-viewport-top'), '75px');
        assert.equal(f.panel.has('--panel-height'), !ios);
        f.resize(800); assert.equal(f.classes.size, 0); assert.equal(f.properties.size, 0);
    });
}

test('focusout retains keyboard geometry during closing and leaving chat clears it immediately', () => {
    const f = fixture(); f.resize(480); f.document.activeElement = { tagName: 'BODY' };
    for (const handler of f.handlers['document:focusout']) handler({ target: { tagName: 'INPUT', chat: true } });
    f.flush(); assert.equal(f.classes.has('chat-keyboard-open'), true);
    f.leave(); assert.equal(f.classes.size, 0); assert.equal(f.properties.size, 0);
});

test('keyboard animation saves only its final measured height and does not force history to the bottom', async () => {
    const f = fixture(); f.area.scrollTop = 10;
    f.resize(550); f.resize(490); f.resize(460);
    assert.equal(f.area.scrollTop, 10); assert.equal(f.timers.size, 1);
    await [...f.timers.values()][0](); assert.equal(f.saves(), 1); assert.equal(f.c.db.savedKeyboardHeight, 340);
});

test('address bar changes, non-chat editors and pinch zoom do not activate chat keyboard layout', () => {
    const f = fixture(); f.resize(730); assert.equal(f.classes.size, 0);
    f.document.activeElement = { tagName: 'TEXTAREA', chat: false }; f.resize(480); assert.equal(f.classes.size, 0);
    f.document.activeElement = { tagName: 'INPUT', chat: true }; f.viewport.scale = 1.5;
    f.resize(400); assert.equal(f.classes.size, 0);
});

test('orientation changes reset the keyboard baseline', () => {
    const f = fixture(); f.viewport.height = 420; f.window.innerHeight = 420;
    f.handlers['window:orientationchange'](); f.flush(); assert.equal(f.classes.size, 0);
    f.resize(250); assert.equal(f.properties.get('--chat-viewport-height'), '250px');
});
