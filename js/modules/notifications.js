// Device permission and preference stay local; notification clicks use the normal chat entry.
let systemNotificationsEnabled = false;
let notificationNavigationReady = false;
let pendingNotificationTarget = null;
let systemNotificationSequence = 0;
try { systemNotificationsEnabled = localStorage.getItem('uvu-system-notifications') === 'true'; } catch (_) {}

function bindIncomingNotificationSwipe(card, open) {
    let start = null, moved = false;
    card.addEventListener('pointerdown', event => {
        if (event.isPrimary === false || event.button > 0) return;
        start = { x: event.clientX, y: event.clientY, id: event.pointerId }; moved = false;
        card.setPointerCapture?.(event.pointerId);
    });
    card.addEventListener('pointermove', event => {
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 10) moved = true;
        if (dy < 0 && Math.abs(dy) > Math.abs(dx)) {
            if (event.cancelable) event.preventDefault();
            card.style.transform = `translateY(${Math.max(-120, dy)}px)`;
            card.style.opacity = String(Math.max(0.1, 1 + dy / 120));
        }
    });
    const finish = event => {
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 10 || event.type === 'pointercancel') moved = true;
        if (event.type !== 'pointercancel' && dy < -32 && Math.abs(dy) > Math.abs(dx)) { moved = true; card.remove(); }
        if (event.type === 'pointerup' && event.pointerType === 'touch' && !moved) {
            moved = true;
            if (event.cancelable) event.preventDefault();
            card.remove(); open();
        }
        start = null; card.style.transform = ''; card.style.opacity = '';
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') moved = false; });
    card.addEventListener('click', event => {
        if (moved) { event.preventDefault(); event.stopPropagation(); return; }
        card.remove(); open();
    });
}

function navigateMessageNotification(target) {
    if (!target || !['private', 'group'].includes(target.chatType) || typeof target.chatId !== 'string') return;
    if (!notificationNavigationReady) { pendingNotificationTarget = target; return; }
    const chat = (target.chatType === 'private' ? db.characters : db.groups).find(item => item.id === target.chatId);
    if (chat) openChatRoom(chat.id, target.chatType);
    else showToast('该聊天已不存在');
}

async function getMessageNotificationRegistration() {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) throw new Error('当前环境不支持系统通知');
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active || typeof registration.showNotification !== 'function') throw new Error('通知服务尚未就绪，请稍后重试');
    return registration;
}

async function showSystemMessageNotification(title, body, icon, chatId, chatType) {
    if (!systemNotificationsEnabled || document.visibilityState !== 'hidden' ||
        typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const sequence = ++systemNotificationSequence;
    try {
        const registration = await getMessageNotificationRegistration();
        if (sequence !== systemNotificationSequence || !systemNotificationsEnabled || document.visibilityState !== 'hidden') return;
        await registration.showNotification(title, { body, icon, tag: 'uvu-incoming-message',
            data: { chatId, chatType }, timestamp: Date.now() });
    } catch (_) {
        const status = document.getElementById('system-notification-status');
        if (status) status.textContent = '系统通知暂不可用；站内通知仍可使用';
    }
}

function setupMessageNotifications() {
    const toggle = document.getElementById('system-notification-switch');
    const status = document.getElementById('system-notification-status');
    const supported = window.isSecureContext && typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
    const refresh = () => {
        if (!toggle || !status) return;
        toggle.checked = systemNotificationsEnabled && supported && Notification.permission === 'granted';
        status.textContent = !supported ? '此浏览器不支持；iOS 请添加到主屏幕后打开' : Notification.permission === 'denied' ?
            '通知权限已被拒绝，请在浏览器或系统设置中开启' : toggle.checked ? '已开启；网页暂停或关闭后无法持续接收' : '未开启';
    };
    toggle?.addEventListener('change', async () => {
        const desired = toggle.checked;
        toggle.disabled = true;
        try {
            if (desired) {
                if (!supported) throw new Error('请使用支持通知的浏览器；iOS 请先添加到主屏幕');
                // The permission call must occur directly inside the user's gesture.
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') throw new Error('未获得系统通知权限');
                await getMessageNotificationRegistration();
            }
            localStorage.setItem('uvu-system-notifications', String(desired));
            systemNotificationsEnabled = desired;
        } catch (error) { showToast(error.message); }
        finally { toggle.disabled = false; refresh(); }
    });
    notificationNavigationReady = true;
    if (location.hash.startsWith('#uvu-notification=')) {
        try {
            const target = JSON.parse(decodeURIComponent(location.hash.slice('#uvu-notification='.length)));
            history.replaceState(null, '', location.pathname + location.search);
            navigateMessageNotification(target);
        } catch (_) {}
    }
    if (pendingNotificationTarget) { const target = pendingNotificationTarget; pendingNotificationTarget = null; navigateMessageNotification(target); }
    refresh();
    document.addEventListener('visibilitychange', refresh);
}

if (typeof navigator !== 'undefined') navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'uvu-open-chat') navigateMessageNotification(event.data);
});
