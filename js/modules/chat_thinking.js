// Read saved output only. This viewer never requests or generates reasoning.
function getSavedMessageThinking(chat, messageId) {
    const history = chat?.history;
    if (!Array.isArray(history)) return null;
    const index = history.findIndex(message => message.id === messageId);
    const message = history[index];
    if (!message || message.role !== 'assistant' || message.isWithdrawn || message.isThinking) return null;
    const read = (record, legacy = false) => {
        if (!record || record.role !== 'assistant' || record.isWithdrawn ||
            !(record.isThinking || /^\s*<thinking>/i.test(record.content || ''))) return null;
        const blocks = [...String(record.content || '').matchAll(/<thinking>([\s\S]*?)<\/thinking>/gi)];
        const text = blocks.map(block => block[1].trim()).filter(Boolean).join('\n\n');
        return text ? { text, legacy } : null;
    };
    // An explicit null means this response had no saved thinking. Never borrow a
    // previous response's reasoning, including when the referenced record was pruned.
    if (Object.hasOwn(message, 'thinkingMessageId')) {
        if (typeof message.thinkingMessageId !== 'string') return null;
        return read(history.slice(0, index).find(record => record.id === message.thinkingMessageId));
    }
    // Older archives have no response link. Limit lookup to this conversation
    // segment and label that uncertainty rather than claiming an exact response.
    for (let cursor = index - 1; cursor >= 0; cursor--) {
        const record = history[cursor];
        if (record.role === 'user' || Object.hasOwn(record, 'thinkingMessageId')) return null;
        if (record.isThinking || /^\s*<thinking>/i.test(record.content || '')) return read(record, true);
    }
    return null;
}

function decorateMessageThinkingAvatar(element, message) {
    if (!element || currentChatType !== 'private' || message.role !== 'assistant' ||
        message.isWithdrawn || message.isThinking || message.isStatusUpdate || /^\s*<thinking>/i.test(message.content || '')) return element;
    const avatar = element.querySelector('.message-avatar:not(.avatar-hidden):not(.avatar-invisible)');
    if (avatar) {
        avatar.dataset.thinkingAvatar = 'true';
        avatar.setAttribute('role', 'button');
        avatar.setAttribute('tabindex', '0');
        avatar.setAttribute('aria-label', '查看已保存的思考');
        avatar.setAttribute('aria-haspopup', 'dialog');
    }
    return element;
}

function setupMessageThinkingViewer(area) {
    if (!area || area.dataset.thinkingViewerBound) return;
    area.dataset.thinkingViewerBound = 'true';
    const open = event => {
        if (currentChatType !== 'private' || isDebugMode || isInMultiSelectMode ||
            !area.closest('.screen')?.classList.contains('active') ||
            document.getElementById('chat-expansion-panel')?.classList.contains('visible')) return;
        const avatar = event.target.closest('[data-thinking-avatar]');
        if (!avatar || !area.contains(avatar)) return;
        const chat = db.characters.find(item => item.id === currentChatId);
        const saved = getSavedMessageThinking(chat, avatar.closest('.message-wrapper')?.dataset.id);
        if (!saved) { showToast('这条回复没有已保存的思考内容'); return; }
        if (document.getElementById('char-thinking-dialog')) return;
        const dialog = document.createElement('dialog');
        dialog.id = 'char-thinking-dialog';
        dialog.setAttribute('aria-labelledby', 'char-thinking-title');
        const header = document.createElement('header');
        const title = document.createElement('h3'); title.id = 'char-thinking-title';
        title.textContent = saved.legacy ? '该段聊天保存的思考' : '本轮思考';
        const close = document.createElement('button'); close.type = 'button';
        close.className = 'icon-btn-simple'; close.textContent = '✕'; close.setAttribute('aria-label', '关闭思考内容');
        const body = document.createElement('div'); body.className = 'char-thinking-content';
        body.tabIndex = 0; body.textContent = saved.text;
        header.append(title, close); dialog.append(header, body); document.body.append(dialog);
        const archive = chat.activeArchiveId, history = chat.history;
        const observer = new MutationObserver(() => {
            if (currentChatType !== 'private' || currentChatId !== chat.id || !db.characters.includes(chat) ||
                chat.activeArchiveId !== archive || chat.history !== history ||
                !area.closest('.screen')?.classList.contains('active')) dialog.close();
        });
        observer.observe(document.getElementById('chat-room-screen'), { attributes: true, attributeFilter: ['class'] });
        observer.observe(area, { childList: true });
        dialog.addEventListener('close', () => {
            observer.disconnect(); dialog.remove();
            if (avatar.isConnected && currentChatId === chat.id && chat.activeArchiveId === archive &&
                area.closest('.screen')?.classList.contains('active')) avatar.focus({ preventScroll: true });
        }, { once: true });
        close.addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', event => {
            if (event.target !== dialog) return;
            const rect = dialog.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
        });
        dialog.showModal(); close.focus({ preventScroll: true });
    };
    area.addEventListener('click', open);
    area.addEventListener('keydown', event => {
        if (event.isComposing || !['Enter', ' '].includes(event.key) || !event.target.closest('[data-thinking-avatar]')) return;
        if (isDebugMode || isInMultiSelectMode) return;
        event.preventDefault(); open(event);
    });
}
