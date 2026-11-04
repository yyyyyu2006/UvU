// 合并转发只保存消息快照，沿用普通用户消息的上下文通道。
function getForwardMessageSender(chat, type, message) {
    if (message.role === 'user') return (type === 'group' ? chat.me?.nickname : chat.myRemarkName?.trim() || chat.myName) || '我';
    const member = (chat.members || []).find(item => item.id === message.senderId);
    return type === 'group' ? member?.groupNickname || member?.realName || '群成员' : chat.remarkName || chat.realName || '对方';
}

function isForwardImageUrl(url) {
    return typeof url === 'string' && /^(https?:\/\/[^\s]+|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+)$/i.test(url);
}

function buildMessageForwardSnapshot(chat, type, ids) {
    const records = chat.history.filter(message => ids.has(message.id) &&
        ['user', 'assistant'].includes(message.role) && !message.isThinking && !message.isStatusUpdate &&
        !/^\s*(?:<thinking>|\[system(?:-display)?:)/.test(message.content || '')).map(message => {
        const record = { senderName: getForwardMessageSender(chat, type, message),
            timestamp: Number(message.timestamp) || 0,
            content: message.isWithdrawn ? '[消息已撤回]' : message.type === 'forwarded-chat' && message.forwardedChat ?
                messageForwardText(message.forwardedChat) : getQuoteMessageContent(message) };
        if (!message.isWithdrawn) {
            if (message.quote) record.quote = { senderName: String(message.quote.senderName || ''), content: String(message.quote.content || '') };
            const images = (message.parts || []).filter(part => part.type === 'image')
                .map(part => part.data || part.url || part.image_url?.url).filter(isForwardImageUrl);
            if (images.length) record.images = images;
        }
        return record;
    });
    return { version: 1, title: (type === 'group' ? chat.name : chat.remarkName || chat.realName) || '聊天', records };
}

function messageForwardText(snapshot) {
    return snapshot.title + ' · 聊天记录\n共 ' + snapshot.records.length + ' 条消息\n\n' + snapshot.records.map(record => {
        const date = new Date(record.timestamp);
        const time = record.timestamp && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '';
        return record.senderName + (time ? ' · ' + time : '') + '\n' +
            (record.quote ? '引用 ' + record.quote.senderName + '：' + record.quote.content + '\n' : '') + record.content;
    }).join('\n\n');
}

function messageForwardNode(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function createMessageForwardDialog(title, id, onDismiss) {
    document.getElementById(id)?.dismissForward?.();
    const previousFocus = document.activeElement;
    const overlay = messageForwardNode('div', 'message-forward-overlay');
    overlay.id = id;
    const panel = messageForwardNode('section', 'message-forward-dialog');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title);
    const header = messageForwardNode('div', 'message-forward-header');
    header.appendChild(messageForwardNode('strong', '', title));
    const close = messageForwardNode('button', 'message-forward-close', '取消');
    close.type = 'button';
    let busy = false;
    const dismiss = () => {
        if (busy) return;
        overlay.remove(); document.removeEventListener('keydown', onKey);
        if (typeof onDismiss === 'function') onDismiss();
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const onKey = event => { if (event.key === 'Escape') dismiss(); };
    overlay.dismissForward = dismiss;
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey);
    header.appendChild(close); panel.appendChild(header); overlay.appendChild(panel); document.body.appendChild(overlay);
    close.focus({ preventScroll: true });
    return { panel, dismiss, setBusy(value) { busy = value; close.disabled = value; } };
}

function openMessageForwardPicker(source, sourceType, ids) {
    const snapshot = buildMessageForwardSnapshot(source, sourceType, ids);
    if (!snapshot.records.length) return showToast('没有可转发的聊天消息');
    const sourceScope = messageSelectionScope;
    const dialog = createMessageForwardDialog('转发聊天记录', 'message-forward-picker');
    dialog.panel.appendChild(messageForwardNode('p', 'message-forward-hint', '已选 ' + snapshot.records.length + ' 条消息，选择接收角色或群聊'));
    const search = messageForwardNode('input', 'message-forward-search');
    search.type = 'search'; search.placeholder = '搜索角色或群聊'; search.setAttribute('aria-label', search.placeholder);
    dialog.panel.appendChild(search);
    const list = messageForwardNode('div', 'message-forward-targets');
    dialog.panel.appendChild(list);
    const send = messageForwardNode('button', 'message-forward-send', '发送聊天记录');
    send.type = 'button'; send.disabled = true; dialog.panel.appendChild(send);
    let selected = null, sending = false;
    const targets = [...(db.characters || []).map(chat => ({ chat, type: 'private' })), ...(db.groups || []).map(chat => ({ chat, type: 'group' }))]
        .filter(target => target.chat.id !== source.id || target.type !== sourceType);
    const render = () => {
        list.replaceChildren();
        const filtered = targets.filter(target => ((target.chat.remarkName || '') + (target.chat.realName || '') + (target.chat.name || '')).toLowerCase().includes(search.value.trim().toLowerCase()));
        if (!filtered.length) list.appendChild(messageForwardNode('p', 'message-forward-hint', '暂无其他接收对象'));
        filtered.forEach(target => {
            const button = messageForwardNode('button', 'message-forward-target',
                (target.type === 'group' ? '群聊 · ' : '角色 · ') + ((target.type === 'group' ? target.chat.name : target.chat.remarkName || target.chat.realName) || '未命名'));
            button.type = 'button'; button.dataset.targetId = target.chat.id; button.dataset.targetType = target.type;
            button.setAttribute('aria-pressed', String(selected?.chat === target.chat && selected?.type === target.type));
            button.disabled = sending;
            button.addEventListener('click', () => {
                if (sending) return;
                selected = { ...target, archiveId: target.chat.activeArchiveId }; send.disabled = false; render();
            });
            list.appendChild(button);
        });
    };
    search.addEventListener('input', render); render();
    send.addEventListener('click', async () => {
        if (sending || !selected) return;
        if (messageSelectionScope !== sourceScope || !isCurrentMessageSelection(source)) {
            showToast('来源会话已改变，请重新选择消息'); dialog.dismiss(); return;
        }
        sending = true; dialog.setBusy(true); send.disabled = true; search.disabled = true; render();
        try {
            await sendMessageForward(snapshot, selected.chat.id, selected.type, selected.archiveId);
            dialog.setBusy(false); dialog.dismiss();
            // 保存期间切换聊天时，不打断用户正在进行的操作。
            if (messageSelectionScope === sourceScope && isCurrentMessageSelection(source) && selected.chat.activeArchiveId === selected.archiveId) {
                exitMultiSelectMode(); currentChatId = selected.chat.id; currentChatType = selected.type;
                openChatRoom(currentChatId, currentChatType);
            }
            renderChatList(); showToast('聊天记录已转发');
        } catch (error) {
            showToast(error.message || '转发失败，请重试');
            sending = false; dialog.setBusy(false); send.disabled = false; search.disabled = false; render();
        }
    });
}

async function sendMessageForward(snapshot, targetId, type, archiveId) {
    const target = (type === 'private' ? db.characters : db.groups).find(chat => chat.id === targetId);
    if (!target || target.activeArchiveId !== archiveId) throw new Error('接收会话或存档已改变，请重新选择接收对象');
    const text = messageForwardText(snapshot);
    const message = { id: 'forward_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2)),
        role: 'user', type: 'forwarded-chat', forwardedChat: JSON.parse(JSON.stringify(snapshot)),
        content: text, parts: [{ type: 'text', text }], timestamp: Date.now() };
    if (type === 'group') message.senderId = 'user_me';
    if (!Array.isArray(target.history)) target.history = [];
    const history = target.history; history.push(message);
    if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(target, message, type);
    try {
        await saveData();
    } catch (error) {
        const index = history.indexOf(message); if (index >= 0) history.splice(index, 1);
        // saveData 会同步存档快照；失败时只回滚本条消息。
        const stored = target.archives?.find(archive => archive.id === archiveId)?.data?.history;
        if (stored && stored !== history) {
            const storedIndex = stored.findIndex(item => item.id === message.id);
            if (storedIndex >= 0) stored.splice(storedIndex, 1);
        }
        throw new Error('聊天记录保存失败，请重试');
    }
    return message;
}

function showMessageForwardDetail(snapshot) {
    const dialog = createMessageForwardDialog(snapshot.title + ' · 聊天记录', 'message-forward-detail');
    dialog.panel.appendChild(messageForwardNode('p', 'message-forward-hint', '共 ' + snapshot.records.length + ' 条消息'));
    const list = messageForwardNode('div', 'message-forward-records');
    snapshot.records.forEach(record => {
        const item = messageForwardNode('article', 'message-forward-record');
        item.appendChild(messageForwardNode('strong', '', record.senderName));
        if (record.timestamp) item.appendChild(messageForwardNode('time', '', new Date(record.timestamp).toLocaleString('zh-CN', { hour12: false })));
        if (record.quote) item.appendChild(messageForwardNode('blockquote', '', '引用 ' + record.quote.senderName + '：' + record.quote.content));
        item.appendChild(messageForwardNode('div', 'message-forward-body', record.content));
        (record.images || []).filter(isForwardImageUrl).forEach(url => {
            const image = messageForwardNode('img'); image.src = url; image.alt = '聊天记录中的图片'; image.loading = 'lazy'; item.appendChild(image);
        });
        list.appendChild(item);
    });
    dialog.panel.appendChild(list);
}

function createMessageForwardElement(message, chat, type, isContinuous) {
    const sent = message.role === 'user';
    const wrapper = messageForwardNode('div', 'message-wrapper ' + (sent ? 'sent' : 'received'));
    wrapper.dataset.id = message.id; wrapper.dataset.senderId = sent ? 'user_me' : message.senderId || chat.id;
    if (message.isContextDisabled) wrapper.classList.add('context-disabled');
    const row = messageForwardNode('div', 'message-bubble-row');
    const avatar = messageForwardNode('img', 'message-avatar');
    avatar.src = (sent ? (type === 'group' ? chat.me?.avatar : chat.myAvatar) : chat.avatar) || ''; avatar.alt = '';
    if (chat.avatarMode === 'hidden' || (chat.avatarMode === 'kkt' && sent)) {
        avatar.classList.add('avatar-hidden'); wrapper.classList.add('no-avatar-layout');
    } else if (isContinuous && ['merge', 'kkt'].includes(chat.avatarMode)) {
        avatar.classList.add('avatar-invisible'); wrapper.classList.add('avatar-invisible-layout');
    }
    const card = messageForwardNode('div', 'message-bubble forwarded-chat-card message-forward-card');
    card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-label', '查看聊天记录');
    card.appendChild(messageForwardNode('strong', 'message-forward-card-title', message.forwardedChat.title + '的聊天记录'));
    message.forwardedChat.records.slice(0, 3).forEach(record => card.appendChild(messageForwardNode('div', 'message-forward-preview', record.senderName + '：' + record.content)));
    card.appendChild(messageForwardNode('div', 'message-forward-card-footer', '聊天记录 · 共 ' + message.forwardedChat.records.length + ' 条'));
    card.addEventListener('click', () => { if (!isInMultiSelectMode && !isDebugMode) showMessageForwardDetail(message.forwardedChat); });
    card.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !isInMultiSelectMode) { event.preventDefault(); showMessageForwardDetail(message.forwardedChat); }
    });
    if (message.quote) card.prepend(createQuotedMessageElement(message.quote, chat));
    const info = messageForwardNode('div', 'message-info'); info.appendChild(avatar);
    const time = messageForwardNode('span', 'message-time', new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }));
    if (chat.timestampStyle === 'avatar') info.appendChild(time); else card.appendChild(time);
    row.appendChild(info); row.appendChild(card); wrapper.appendChild(row);
    return wrapper;
}
