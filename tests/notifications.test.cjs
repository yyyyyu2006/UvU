const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/notifications.js'), 'utf8');
function fixture(permission = 'granted', enabled = true) {
    const handlers = {}, shown = [], opened = [], toasts = [];
    const toggle = { checked: false, addEventListener(type, fn) { handlers[type] = fn; } }, status = {};
    const registration = { active: {}, showNotification: async (...args) => shown.push(args) };
    const c = vm.createContext({ window: { isSecureContext: true },
        localStorage: { getItem: () => String(enabled), setItem() {} },
        navigator: { serviceWorker: { getRegistration: async () => registration, addEventListener(type, fn) { handlers['sw:' + type] = fn; } } },
        Notification: { permission, requestPermission: async () => permission },
        document: { visibilityState: 'hidden', getElementById: id => id === 'system-notification-switch' ? toggle : status, addEventListener() {} },
        location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} },
        db: { characters: [{ id: 'c' }], groups: [{ id: 'g' }] },
        openChatRoom: (...args) => opened.push(args), showToast: text => toasts.push(text) });
    vm.runInContext(source, c);
    return { c, handlers, shown, opened, toasts, toggle, registration, status };
}

test('upward banner swipe dismisses without opening a chat; horizontal movement and cancellation do not dismiss', () => {
    const { c } = fixture();
    function banner() {
        const handlers = {}, node = { style: {}, addEventListener: (type, fn) => handlers[type] = fn, remove() { this.removed = true; } };
        let opens = 0; c.bindIncomingNotificationSwipe(node, () => opens++);
        const emit = (type, x, y) => handlers[type]({ type, pointerId: 1, clientX: x, clientY: y, button: 0, preventDefault() {}, stopPropagation() {} });
        return { node, emit, opens: () => opens };
    }
    const swipe = banner(); swipe.emit('pointerdown', 50, 80); swipe.emit('pointermove', 51, 20); swipe.emit('pointerup', 51, 20); swipe.emit('click');
    assert.equal(swipe.node.removed, true); assert.equal(swipe.opens(), 0);
    const horizontal = banner(); horizontal.emit('pointerdown', 50, 80); horizontal.emit('pointerup', 150, 77);
    assert.equal(horizontal.node.removed, undefined);
    const cancel = banner(); cancel.emit('pointerdown', 50, 80); cancel.emit('pointermove', 50, 20); cancel.emit('pointercancel', 50, 20);
    assert.equal(cancel.node.removed, undefined); assert.equal(cancel.node.style.transform, '');
    const tap = banner(); tap.emit('pointerdown', 50, 80); tap.emit('pointerup', 50, 80); tap.emit('click'); assert.equal(tap.opens(), 1);
});

test('system notifications require opt-in, permission and a hidden page and contain the target', async () => {
    const f = fixture();
    await f.c.showSystemMessageNotification('Name', 'Hello', 'avatar', 'g', 'group');
    assert.equal(f.shown.length, 1); assert.equal(f.shown[0][1].data.chatId, 'g');
    f.c.document.visibilityState = 'visible'; await f.c.showSystemMessageNotification('Name', 'No', '', 'g', 'group');
    assert.equal(f.shown.length, 1);
    for (const f of [fixture('denied'), fixture('default'), fixture('granted', false)]) {
        await f.c.showSystemMessageNotification('Name', 'No', '', 'g', 'group'); assert.equal(f.shown.length, 0);
    }
});

test('permission denial and unsupported browser keep the toggle off; service failure does not reject delivery', async () => {
    const denied = fixture('denied', false); denied.c.setupMessageNotifications();
    denied.toggle.checked = true; await denied.handlers.change();
    assert.equal(denied.toggle.checked, false); assert.match(denied.toasts[0], /权限/);
    const unsupported = fixture(); unsupported.c.Notification = undefined; unsupported.c.setupMessageNotifications();
    assert.match(unsupported.status.textContent, /不支持/);
    const broken = fixture(); broken.c.navigator.serviceWorker.getRegistration = async () => { throw new Error('offline'); };
    await broken.c.showSystemMessageNotification('N', 'B', '', 'c', 'private'); assert.equal(broken.shown.length, 0);
});

test('notification navigation handles private/group targets and startup hashes but rejects unknown targets', () => {
    const f = fixture(); f.c.location.hash = '#uvu-notification=' + encodeURIComponent(JSON.stringify({ chatId: 'g', chatType: 'group' }));
    f.c.setupMessageNotifications();
    f.handlers['sw:message']({ data: { type: 'uvu-open-chat', chatId: 'c', chatType: 'private' } });
    f.c.navigateMessageNotification({ chatId: 'gone', chatType: 'private' });
    f.c.navigateMessageNotification({ chatId: 'g', chatType: 'invalid' });
    assert.deepEqual(f.opened, [['g', 'group'], ['c', 'private']]); assert.equal(f.toasts.length, 1);
});

test('service-worker navigation arriving before initialization is deferred until chats are ready', () => {
    const f = fixture();
    f.handlers['sw:message']({ data: { type: 'uvu-open-chat', chatId: 'c', chatType: 'private' } });
    assert.equal(f.opened.length, 0); f.c.setupMessageNotifications(); assert.deepEqual(f.opened, [['c', 'private']]);
});

test('service-worker notification click focuses its own app or opens the app with a safe target hash', async () => {
    for (const existing of [true, false]) {
        const handlers = {}, sent = [], urls = []; let focused = 0, pending;
        const self = { registration: { scope: 'https://site.test/UvU/' }, addEventListener: (type, fn) => handlers[type] = fn,
            clients: { matchAll: async () => [{ url: 'https://site.test/other/' }, ...(existing ? [{ url: 'https://site.test/UvU/index.html', focus: async () => focused++, postMessage: data => sent.push(data) }] : [])],
                openWindow: async url => urls.push(url) } };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), { self, URL, console });
        handlers.notificationclick({ notification: { close() {}, data: { chatId: 'a"&/#', chatType: 'group' } }, waitUntil: value => pending = value });
        await pending;
        if (existing) { assert.equal(focused, 1); assert.equal(sent[0].chatId, 'a"&/#'); assert.equal(urls.length, 0); }
        else { const url = new URL(urls[0]); assert.equal(url.pathname, '/UvU/'); assert.equal(JSON.parse(decodeURIComponent(url.hash.slice('#uvu-notification='.length))).chatId, 'a"&/#'); }
    }
});
