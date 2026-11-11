// Device permission and preference stay local; notification clicks use the normal chat entry.
let systemNotificationsEnabled = false;
let notificationNavigationReady = false;
let pendingNotificationTarget = null;
let systemNotificationSequence = 0;
const systemChatNotificationSequences = new Map();
try { systemNotificationsEnabled = localStorage.getItem('uvu-system-notifications') === 'true'; } catch (_) {}

function getMessageNotificationPreferences() {
    let raw;try{raw=JSON.parse(localStorage.getItem('uvu-notification-preferences.v1') || '{}');}catch{}
    if(!raw || typeof raw!=='object')raw={};
    const time=value=>typeof value==='string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
    return {groupByChat:raw.groupByChat===true,duplicateProtection:raw.duplicateProtection===true,privacy:['full','hide-body','private'].includes(raw.privacy)?raw.privacy:'full',
        quietHours:{enabled:raw.quietHours?.enabled===true,start:time(raw.quietHours?.start)?raw.quietHours.start:'22:00',end:time(raw.quietHours?.end)?raw.quietHours.end:'08:00'},
        mutedChats:Object.fromEntries(Object.entries(raw.mutedChats || {}).filter(([key,value])=>value===true && key.length<400))};
}
function saveMessageNotificationPreferences(input) {
    const current=getMessageNotificationPreferences(),next={...current,...input,quietHours:{...current.quietHours,...input.quietHours}};
    if(!['full','hide-body','private'].includes(next.privacy))throw new Error('通知隐私选项无效。');
    if(![next.quietHours.start,next.quietHours.end].every(value=>/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)))throw new Error('请填写有效的24小时时间。');
    next.mutedChats=Object.fromEntries(Object.entries(next.mutedChats || {}).filter(([key,value])=>value===true && key.length<400));
    localStorage.setItem('uvu-notification-preferences.v1',JSON.stringify(next));return next;
}
function shouldShowMessageNotification(chatId, chatType, now = new Date()) {
    const prefs=getMessageNotificationPreferences();if(prefs.mutedChats[JSON.stringify([String(chatType),String(chatId)])])return false;
    if(!prefs.quietHours.enabled)return true;
    const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3)),start=minute(prefs.quietHours.start),end=minute(prefs.quietHours.end),current=now.getHours()*60+now.getMinutes();
    const quiet=start===end || (start<end?current>=start && current<end:current>=start || current<end);
    return !quiet;
}
// Exact IDs only; this bounded, page-local ledger never changes messages or unread state.
const incomingNotificationClaims = new Map(), incomingNotificationObjects = new WeakMap();
let incomingNotificationObjectSequence = 0;
// Render and reply completion can report the same in-memory message. This is
// delivery ownership, independent of optional ID-based duplicate protection.
const incomingNotificationDeliveries = new WeakMap();
function claimIncomingNotificationDelivery(chat, message) {
    if (!chat || typeof chat !== 'object' || !message || typeof message !== 'object') return true;
    let scope = incomingNotificationDeliveries.get(chat);
    if (!scope || scope.history !== chat.history || scope.archiveId !== chat.activeArchiveId) {
        scope = { history: chat.history, archiveId: chat.activeArchiveId, messages: new WeakSet() };
        incomingNotificationDeliveries.set(chat, scope);
    }
    if (scope.messages.has(message)) return false;
    scope.messages.add(message); return true;
}
function claimIncomingMessageNotification(chat, message, chatId, chatType, now = Date.now()) {
    if (!getMessageNotificationPreferences().duplicateProtection) return true;
    const id = message?.id;
    if (!chat || typeof chat !== 'object' || !(typeof id === 'string' && id.length > 0 && id.length <= 400 || typeof id === 'number' && Number.isFinite(id))) return true;
    const objectId = value => {
        if (!value || typeof value !== 'object') return null;
        if (!incomingNotificationObjects.has(value)) incomingNotificationObjects.set(value, ++incomingNotificationObjectSequence);
        return incomingNotificationObjects.get(value);
    };
    const key = JSON.stringify([objectId(chat), objectId(chat.history), chatType, String(chatId), chat.activeArchiveId ?? null, message.role ?? null, message.senderId ?? null, id]);
    for (const [remembered, time] of incomingNotificationClaims) if (now - time >= 10 * 60000 || time > now) incomingNotificationClaims.delete(remembered);
    if (incomingNotificationClaims.has(key)) return false;
    incomingNotificationClaims.set(key, now);
    while (incomingNotificationClaims.size > 1024) incomingNotificationClaims.delete(incomingNotificationClaims.keys().next().value);
    return true;
}
function getMessageNotificationPresentation(title, body, icon, chatId, chatType) {
    const mode=getMessageNotificationPreferences().privacy;
    if(mode==='private')return {title:'UvU 新消息',body:'你收到一条新消息',icon:''};
    return {title,body:mode==='hide-body'?'你收到一条新消息':body,icon};
}
function getMessageNotificationCapabilities() {
    const secure=typeof window!=='undefined' && window.isSecureContext===true,api=typeof Notification!=='undefined',worker=typeof navigator!=='undefined' && 'serviceWorker' in navigator;
    return {supported:secure && api && worker,secureContext:secure,notificationApi:api,serviceWorker:worker,permission:api?Notification.permission:'unavailable',
        installed:typeof window!=='undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches===true || typeof navigator!=='undefined' && navigator.standalone===true),delivery:'page-dependent'};
}
function renderMessageNotificationPreferences() {
    const existing=document.getElementById('uvu-notification-preferences');if(existing){existing.refreshNotificationTargets?.();return;}
    const status=document.getElementById('system-notification-status');if(!status?.parentElement?.append || !document.createElement)return;
    const host=document.createElement('details');host.id='uvu-notification-preferences';host.className='uvu-notification-preferences';
    const heading=document.createElement('summary'),help=document.createElement('p'),capability=document.createElement('p');heading.textContent='通知免打扰、隐私与能力';
    const info=getMessageNotificationCapabilities();capability.textContent='安全上下文：'+(info.secureContext?'是':'否')+' · 系统通知API：'+(info.notificationApi?'有':'无')+' · Service Worker：'+(info.serviceWorker?'有':'无')+' · 权限：'+info.permission+' · 主屏幕应用：'+(info.installed?'是':'未检测到');
    help.textContent='站内横幅依赖页面运行；系统通知还需授权与服务就绪。当前未配置离站Push后端，页面挂起或关闭后不能保证持续接收。前台测试成功不等于后台常驻。设置仅存本机；相同时间表示全天免打扰，时间按设备时区。';
    const preferences=getMessageNotificationPreferences();
    const row=(text,node)=>{const label=document.createElement('label');label.append(text,node);host.append(label);};
    host.append(heading,capability,help);
    const duplicates=document.createElement('input');duplicates.type='checkbox';duplicates.checked=preferences.duplicateProtection;row('防止相同消息ID重复通知（可选，仅本次页面，最多记忆10分钟；不影响未读数）',duplicates);
    const groupByChat=document.createElement('input');groupByChat.type='checkbox';groupByChat.checked=preferences.groupByChat;row('系统通知按聊天聚合',groupByChat);
    const quiet=document.createElement('input');quiet.type='checkbox';quiet.checked=preferences.quietHours.enabled;row('启用静音时段',quiet);
    const start=document.createElement('input'),end=document.createElement('input');start.type=end.type='time';start.value=preferences.quietHours.start;end.value=preferences.quietHours.end;row('开始（设备时间）',start);row('结束（设备时间）',end);
    const privacy=document.createElement('select');for(const [value,text] of [['full','显示标题与正文（默认）'],['hide-body','隐藏正文，保留聊天名'],['private','隐藏聊天名、头像与正文']]){const option=document.createElement('option');option.value=value;option.textContent=text;privacy.append(option);}privacy.value=preferences.privacy;row('通知隐私',privacy);
    const target=document.createElement('select'),empty=document.createElement('option');empty.value='';empty.textContent='选择一个聊天设置免打扰';target.append(empty);
    row('聊天',target);
    const mute=document.createElement('input');mute.type='checkbox';mute.disabled=true;row('此聊天免打扰（横幅与系统通知）',mute);
    const muteDrafts=new Map();
    const refreshTargets=()=>{
        const selected=target.value,known=new Set();
        target.replaceChildren(empty);
        if(typeof db!=='undefined')for(const [type,list] of [['private',db.characters || []],['group',db.groups || []]])for(const chat of list){const option=document.createElement('option');option.value=JSON.stringify([type,String(chat.id)]);known.add(option.value);option.textContent=(type==='group'?'群聊 · ':'角色 · ')+(chat.remarkName || chat.realName || chat.name || chat.id);target.append(option);}
        for(const key of muteDrafts.keys())if(!known.has(key))muteDrafts.delete(key);
        target.value=known.has(selected)?selected:'';mute.disabled=!target.value;mute.checked=Boolean(target.value && (muteDrafts.has(target.value)?muteDrafts.get(target.value):getMessageNotificationPreferences().mutedChats[target.value]));
        return known;
    };
    host.refreshNotificationTargets=refreshTargets;
    target.addEventListener('focus',refreshTargets);
    host.addEventListener('toggle',()=>{if(host.open)refreshTargets();});
    target.addEventListener('change',()=>{mute.disabled=!target.value;mute.checked=Boolean(muteDrafts.has(target.value)?muteDrafts.get(target.value):getMessageNotificationPreferences().mutedChats[target.value]);});
    mute.addEventListener('change',()=>{if(target.value)muteDrafts.set(target.value,mute.checked);});
    refreshTargets();
    const settingsScreen=document.getElementById('api-settings-screen');
    if(settingsScreen && typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(settingsScreen.classList.contains('active'))refreshTargets();}).observe(settingsScreen,{attributes:true,attributeFilter:['class']});
    const save=document.createElement('button'),result=document.createElement('p');save.type='button';save.className='btn btn-secondary';save.textContent='保存通知偏好';result.setAttribute('aria-live','polite');
    save.addEventListener('click',()=>{try{if(target.value)muteDrafts.set(target.value,mute.checked);const known=refreshTargets(),prefs=getMessageNotificationPreferences(),mutedChats=Object.fromEntries(Object.entries(prefs.mutedChats).filter(([key])=>known.has(key)));for(const [key,value] of muteDrafts){if(value)mutedChats[key]=true;else delete mutedChats[key];}saveMessageNotificationPreferences({groupByChat:groupByChat.checked,duplicateProtection:duplicates.checked,quietHours:{enabled:quiet.checked,start:start.value,end:end.value},privacy:privacy.value,mutedChats});result.textContent='已保存；仅影响通知展示，聊天消息仍正常保存。';}catch(error){result.textContent='保存失败：'+error.message;}});host.append(save,result);status.parentElement.append(host);
}

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

// Stable opaque tag: chat names and message bodies never enter system grouping metadata.
function messageNotificationTag(chatId, chatType) {
    const key=JSON.stringify([String(chatType),String(chatId)]);let a=2166136261,b=5381;
    for(let i=0;i<key.length;i++){a=Math.imul(a ^ key.charCodeAt(i),16777619);b=Math.imul(b,33)^key.charCodeAt(i);}
    return 'uvu-chat-'+(a>>>0).toString(36)+'-'+(b>>>0).toString(36);
}
async function showSystemMessageNotification(title, body, icon, chatId, chatType) {
    if (!systemNotificationsEnabled || document.visibilityState !== 'hidden' ||
        typeof Notification === 'undefined' || Notification.permission !== 'granted' || !shouldShowMessageNotification(chatId,chatType)) return;
    const grouped = getMessageNotificationPreferences().groupByChat;
    const key = JSON.stringify([String(chatType),String(chatId)]);
    const sequence = grouped ? (systemChatNotificationSequences.get(key) || 0) + 1 : ++systemNotificationSequence;
    if (grouped) { systemChatNotificationSequences.set(key, sequence); if (systemChatNotificationSequences.size > 1024) systemChatNotificationSequences.delete(systemChatNotificationSequences.keys().next().value); }
    const current = () => grouped ? systemChatNotificationSequences.get(key) === sequence : sequence === systemNotificationSequence;
    try {
        const registration = await getMessageNotificationRegistration();
        if (!current() || !systemNotificationsEnabled || Notification.permission !== 'granted' || document.visibilityState !== 'hidden' || !shouldShowMessageNotification(chatId,chatType)) return;
        const display=getMessageNotificationPresentation(title,body,icon,chatId,chatType);
        await registration.showNotification(display.title, { body:display.body, icon:display.icon, tag: grouped ? messageNotificationTag(chatId,chatType) : 'uvu-incoming-message',
            data: { chatId, chatType }, timestamp: Date.now() });
    } catch (_) {
        const status = document.getElementById('system-notification-status');
        if (status) status.textContent = '系统通知暂不可用；站内通知仍可使用';
    }
}

function setupMessageNotifications() {
    renderMessageNotificationPreferences();
    const toggle = document.getElementById('system-notification-switch');
    const status = document.getElementById('system-notification-status');
    const testButton = document.getElementById('system-notification-test');
    const testStatus = document.getElementById('system-notification-test-status');
    if (testButton?.parentElement && !testButton.closest('.system-notification-actions')) {
        const actions = document.createElement('div'); actions.className = 'system-notification-actions';
        testButton.before(actions); actions.append(testButton);
        const preferences = document.getElementById('uvu-notification-preferences');
        if (preferences) actions.append(preferences);
    }
    const supported = window.isSecureContext && typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
    let testJob = null;
    const setTestStatus = message => {
        if (!testStatus) return;
        testStatus.textContent = message;
        testStatus.hidden = !message;
    };
    const finishTest = (job, message) => {
        if (testJob !== job) return;
        if (job.timer !== null) clearTimeout(job.timer);
        testJob = null;
        if (testButton) {
            testButton.disabled = !supported;
            testButton.textContent = '测试系统通知';
        }
        setTestStatus(message);
    };
    const refresh = () => {
        if (!toggle || !status) return;
        toggle.checked = systemNotificationsEnabled && supported && Notification.permission === 'granted';
        status.textContent = !supported ? '此浏览器不支持；iOS 请添加到主屏幕后打开' : Notification.permission === 'denied' ?
            '通知权限已被拒绝，请在浏览器或系统设置中开启' : toggle.checked ? '已开启；网页暂停或关闭后无法持续接收' : '未开启';
        if (testJob && !toggle.checked) finishTest(testJob, '系统通知已关闭或权限不可用，测试已取消');
        if (testButton) testButton.disabled = !supported || !!testJob;
    };
    testButton?.addEventListener('click', async () => {
        if (testJob) return;
        if (!supported || !systemNotificationsEnabled || Notification.permission !== 'granted') {
            setTestStatus('请先开启系统消息通知，并允许浏览器发送通知');
            return;
        }
        const job = { timer: null };
        testJob = job;
        testButton.disabled = true;
        testButton.textContent = '等待测试…';
        try {
            const registration = await getMessageNotificationRegistration();
            if (testJob !== job) return;
            setTestStatus('请在 5 秒内返回手机主屏幕，等待测试通知；不要关闭网页。系统暂停网页时，测试可能延迟或无法执行。');
            showToast('5 秒后测试系统通知，请返回手机主屏幕查看');
            job.timer = setTimeout(async () => {
                if (testJob !== job) return;
                job.timer = null;
                if (!systemNotificationsEnabled || Notification.permission !== 'granted') {
                    finishTest(job, '系统通知已关闭或权限不可用，测试已取消');
                    return;
                }
                if (document.visibilityState !== 'hidden') {
                    finishTest(job, '未发送：网页未进入后台，请重新测试并在 5 秒内返回手机主屏幕');
                    return;
                }
                try {
                    await registration.showNotification('UwU 通知测试', {
                        body: '这是一条系统测试通知，用于检查当前设备的通知显示。',
                        tag: 'uvu-system-notification-test', data: { type: 'uvu-notification-test' }, timestamp: Date.now()
                    });
                    finishTest(job, '测试通知请求已提交，请检查系统通知栏或通知中心；是否出现横幅取决于系统设置。');
                } catch (_) {
                    finishTest(job, '测试通知发送失败，请检查浏览器权限及系统通知设置后重试');
                }
            }, 5000);
        } catch (_) {
            finishTest(job, '通知服务尚未就绪或不可用，请稍后重试');
        }
    });
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
