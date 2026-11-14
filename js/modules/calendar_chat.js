(function (root) {
    'use strict';
    function validate(value) {
        if (!value || value.version !== 1 || Object.keys(value).some(k => !['version', 'title', 'date', 'text'].includes(k)) || typeof value.title !== 'string' || !value.title || value.title.length > 80 || typeof value.text !== 'string' || !value.text || value.text.length > 4000 || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error('日历卡片内容无效');
        const d = new Date(value.date + 'T12:00:00Z'); if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value.date) throw new Error('日历卡片日期无效');
        return value;
    }
    async function share(chat, input) {
        const archiveId = chat?.activeArchiveId, history = chat?.history;
        const valid = () => db.characters.includes(chat) && chat.activeArchiveId === archiveId && chat.history === history;
        if (!valid()) throw new Error('角色或存档已变化或不存在');
        if (typeof relationshipCanSend === 'function' && !relationshipCanSend(chat, 'private')) return false;
        const payload = validate({ version: 1, title: input.title, date: input.date, text: input.text });
        const content = '日历分享 · ' + payload.title + '\n' + payload.date + '\n' + payload.text;
        const message = { id: 'msg_' + crypto.randomUUID(), role: 'user', type: 'calendar', calendar: payload, content, parts: [{ type: 'text', text: content }], timestamp: Date.now() };
        if (!valid()) throw new Error('角色或存档已变化'); const mutation = beginChatMutation(chat, 'private');
        if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, 'private');
        chat.history.push(message);
        const saved = await saveChatMutation(mutation, '日历卡片未保存，已恢复，可重试');
        if (!saved) throw new Error('日历卡片发送失败，请重试');
        if (valid() && typeof currentChatId !== 'undefined' && currentChatType === 'private' && currentChatId === chat.id && typeof renderMessages === 'function') renderMessages(false, false);
        if (typeof renderChatList === 'function') renderChatList(); return true;
    }
    function createElement(message, chat, type, continuous) {
        const payload = validate(message.calendar), sent = message.role === 'user', node = (tag, text, cls = '') => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
        const wrapper = node('div', undefined, 'message-wrapper calendar-message ' + (sent ? 'sent' : 'received')); wrapper.dataset.id = message.id; wrapper.dataset.senderId = sent ? 'user_me' : chat.id;
        if (message.isContextDisabled) wrapper.classList.add('context-disabled');
        const row = node('div', undefined, 'message-bubble-row'), info = node('div', undefined, 'message-info'), avatar = node('img', undefined, 'message-avatar'); avatar.src = (sent ? chat.myAvatar : chat.avatar) || ''; avatar.alt = '';
        if (chat.avatarMode === 'hidden' || (chat.avatarMode === 'kkt' && sent)) { avatar.classList.add('avatar-hidden'); wrapper.classList.add('no-avatar-layout'); }
        else if (continuous && ['merge', 'kkt'].includes(chat.avatarMode)) { avatar.classList.add('avatar-invisible'); wrapper.classList.add('avatar-invisible-layout'); }
        info.append(avatar); const card = node('button', undefined, 'message-bubble calendar-chat-card'); card.type = 'button'; card.append(node('strong', payload.title), node('small', payload.date), node('p', payload.text));
        card.onclick = () => { if (isInMultiSelectMode || isDebugMode) return; const d = createMessageForwardDialog(payload.title, 'calendar-share-preview'); d.panel.classList.add('calendar-editor', 'uvu-calendar-surface'); const body = node('div', undefined, 'calendar-editor-body'); const text = node('p', payload.date + '\n\n' + payload.text); text.style.whiteSpace = 'pre-wrap'; body.append(text); d.panel.append(body); };
        if (message.quote && typeof createQuotedMessageElement === 'function') card.prepend(createQuotedMessageElement(message.quote, chat));
        const time = node('span', new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), 'message-time'); (chat.timestampStyle === 'avatar' ? info : card).append(time);
        row.append(info, card); wrapper.append(row); return wrapper;
    }
    root.UvUCalendarChat = { validate, share, createElement };
})(window);
