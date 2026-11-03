const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/notifications.js'), 'utf8');
function fixture(permission = 'granted', enabled = true) {
    const handlers = {}, shown = [], opened = [], toasts = [], timers = new Map();
    const toggle = { checked: false, addEventListener(type, fn) { handlers[type] = fn; } }, status = {};
    const testButton = { disabled: false, addEventListener(type, fn) { handlers['test:' + type] = fn; } }, testStatus = {};
    let timerId = 0;
    const registration = { active: {}, showNotification: async (...args) => shown.push(args) };
    const c = vm.createContext({ window: { isSecureContext: true },
        localStorage: { getItem: () => String(enabled), setItem() {} },
        navigator: { serviceWorker: { getRegistration: async () => registration, addEventListener(type, fn) { handlers['sw:' + type] = fn; } } },
        Notification: { permission, requestPermission: async () => permission },
        document: { visibilityState: 'hidden', getElementById: id => ({ 'system-notification-switch': toggle,
            'system-notification-status': status, 'system-notification-test': testButton, 'system-notification-test-status': testStatus })[id] || null,
            addEventListener(type, fn) { handlers['document:' + type] = fn; } },
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} },
        db: { characters: [{ id: 'c' }], groups: [{ id: 'g' }] },
        openChatRoom: (...args) => opened.push(args), showToast: text => toasts.push(text) });
    vm.runInContext(source, c);
    return { c, handlers, shown, opened, toasts, toggle, registration, status, testButton, testStatus, timers };
}

test('notification test waits five seconds and uses the real system channel with a distinct tag', async () => {
    const f = fixture(); f.c.document.visibilityState = 'visible'; f.c.setupMessageNotifications();
    await f.handlers['test:click'](); await f.handlers['test:click']();
    assert.equal(f.testButton.disabled, true); assert.equal(f.shown.length, 0); assert.equal(f.timers.size, 1);
    assert.match(f.testStatus.textContent, /5 秒内返回手机主屏幕/);
    const scheduled = [...f.timers.values()][0]; assert.equal(scheduled.delay, 5000);
    f.c.document.visibilityState = 'hidden'; await scheduled.fn();
    assert.equal(f.shown.length, 1); assert.equal(f.shown[0][1].tag, 'uvu-system-notification-test');
    assert.equal(f.shown[0][1].data.type, 'uvu-notification-test');
    assert.equal(f.testButton.disabled, false); assert.match(f.testStatus.textContent, /请求已提交/);
    await f.c.showSystemMessageNotification('Actual', 'Message', '', 'c', 'private');
    assert.equal(f.shown[1][1].tag, 'uvu-incoming-message');
});

test('notification test does not send while foregrounded or without opt-in and permission', async () => {
    const foreground = fixture(); foreground.c.setupMessageNotifications();
    await foreground.handlers['test:click'](); foreground.c.document.visibilityState = 'visible';
    await [...foreground.timers.values()][0].fn();
    assert.equal(foreground.shown.length, 0); assert.match(foreground.testStatus.textContent, /未进入后台/);
    for (const f of [fixture('denied'), fixture('default'), fixture('granted', false)]) {
        f.c.setupMessageNotifications(); await f.handlers['test:click']();
        assert.equal(f.timers.size, 0); assert.equal(f.shown.length, 0); assert.match(f.testStatus.textContent, /请先开启/);
    }
});

test('turning notifications off cancels an armed test and a stale callback cannot send', async () => {
    const f = fixture(); f.c.setupMessageNotifications(); await f.handlers['test:click']();
    const scheduled = [...f.timers.values()][0];
    f.toggle.checked = false; await f.handlers.change();
    assert.equal(f.timers.size, 0); assert.equal(f.testButton.disabled, false);
    await scheduled.fn(); assert.equal(f.shown.length, 0); assert.match(f.testStatus.textContent, /取消/);
});

test('notification test handles revoked permission, unavailable service and failed display without claiming delivery', async () => {
    const revoked = fixture(); revoked.c.setupMessageNotifications(); await revoked.handlers['test:click']();
    revoked.c.Notification.permission = 'denied'; await [...revoked.timers.values()][0].fn();
    assert.equal(revoked.shown.length, 0); assert.match(revoked.testStatus.textContent, /取消/);
    const unavailable = fixture(); unavailable.c.setupMessageNotifications();
    unavailable.registration.active = null; await unavailable.handlers['test:click']();
    assert.equal(unavailable.timers.size, 0); assert.equal(unavailable.testButton.disabled, false);
    assert.match(unavailable.testStatus.textContent, /尚未就绪或不可用/);
    const failed = fixture(); failed.c.setupMessageNotifications(); await failed.handlers['test:click']();
    failed.registration.showNotification = async () => { throw new Error('denied'); };
    await [...failed.timers.values()][0].fn();
    assert.equal(failed.testButton.disabled, false); assert.match(failed.testStatus.textContent, /发送失败/);
});

test('cancelling while service lookup is pending does not arm a late test', async () => {
    const f = fixture(); f.c.setupMessageNotifications();
    let complete; f.c.navigator.serviceWorker.getRegistration = () => new Promise(resolve => { complete = resolve; });
    const pending = f.handlers['test:click']();
    f.toggle.checked = false; await f.handlers.change();
    complete(f.registration); await pending;
    assert.equal(f.timers.size, 0); assert.equal(f.shown.length, 0); assert.equal(f.testButton.disabled, false);
});

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

test('clicking a system test notification focuses or opens the app without navigating to a chat', async () => {
    for (const existing of [true, false]) {
        const handlers = {}, sent = [], urls = []; let focused = 0, pending;
        const self = { registration: { scope: 'https://site.test/UvU/' }, addEventListener: (type, fn) => handlers[type] = fn,
            clients: { matchAll: async () => existing ? [{ url: 'https://site.test/UvU/', focus: async () => focused++, postMessage: data => sent.push(data) }] : [],
                openWindow: async url => urls.push(url) } };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), { self, URL, console });
        handlers.notificationclick({ notification: { close() {}, data: { type: 'uvu-notification-test' } }, waitUntil: value => pending = value });
        await pending;
        assert.equal(sent.length, 0);
        if (existing) { assert.equal(focused, 1); assert.equal(urls.length, 0); }
        else assert.deepEqual(urls, ['https://site.test/UvU/']);
    }
});
