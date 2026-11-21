(function (root) {
    'use strict';
    const scene = root.UvUScene, $ = id => document.getElementById(id);
    let panelTarget = null, panelSource = null, panelRevision = 0, returnFocus = null;
    function refresh() {
        const chat = currentChatType === 'private' && db.characters.find(item => item.id === currentChatId);
        const entry = $('scene-mode-btn'), bar = $('scene-mode-bar');
        if (entry) entry.hidden = !chat;
        if (!bar) return;
        bar.hidden = !scene.enabled(chat);
        if (chat) $('scene-mode-title').textContent = chat.sceneMode?.scene?.name || '线下场景';
        $('scene-failed-entry').hidden = !chat?.sceneDraft;
    }
    function close() {
        const visible = $('scene-mode-modal').classList.contains('visible');
        panelRevision++; $('scene-mode-modal').classList.remove('visible'); panelTarget = null;
        const focus = returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus : $('toggle-expansion-btn');
        if (visible && focus?.getClientRects().length) focus.focus({ preventScroll: true });
        returnFocus = null;
    }
    function open() {
        const target = captureChatSendTarget();
        if (!target || target.type !== 'private') return;
        if (!$('scene-mode-modal').classList.contains('visible')) returnFocus = document.activeElement;
        if (typeof showPanel === 'function') showPanel('none');
        panelRevision++; panelTarget = target; panelSource = JSON.stringify(target.chat.sceneMode);
        const mode = target.chat.sceneMode ? scene.clone(target.chat.sceneMode) : scene.defaultMode();
        scene.validateMode(mode);
        $('scene-enabled').checked = mode.enabled;
        for (const key of ['name', 'place', 'time', 'background']) $('scene-' + key).value = mode.scene[key];
        for (const key of ['viewpoint', 'length']) $('scene-' + key).value = mode.preferences[key];
        $('scene-draft-group').hidden = !target.chat.sceneDraft;
        $('scene-draft-text').value = target.chat.sceneDraft?.raw || '';
        $('scene-draft-error').textContent = target.chat.sceneDraft?.reason || '';
        $('scene-mode-modal').classList.add('visible');
        $('scene-enabled').focus();
    }
    async function save(event) {
        event?.preventDefault();
        const target = panelTarget, ticket = ++panelRevision;
        if (!isChatTargetVisible(target) || JSON.stringify(target.chat.sceneMode) !== panelSource) {
            showToast('聊天或场景已变化，请重新打开设置；当前草稿仍保留'); return;
        }
        const before = target.chat.sceneMode, next = before ? scene.clone(before) : scene.defaultMode();
        next.enabled = $('scene-enabled').checked;
        for (const key of ['name', 'place', 'time', 'background']) next.scene[key] = $('scene-' + key).value.trim();
        for (const key of ['viewpoint', 'length']) next.preferences[key] = $('scene-' + key).value;
        next.revision++;
        try { scene.validateMode(next); } catch (error) { showToast(error.message); return; }
        scene.abort(target.chat);
        const mutation = beginChatMutation(target.chat, 'private', [], ['sceneMode']);
        target.chat.sceneMode = next;
        if (!await saveChatMutation(mutation, '场景设置未保存，请重试')) { refresh(); return; }
        refresh();
        if (ticket === panelRevision && isChatTargetVisible(target)) { close(); showToast(next.enabled ? '已开启旁白模式' : '已回到线上'); }
    }
    async function returnOnline() {
        const target = captureChatSendTarget();
        if (!isChatTargetVisible(target) || target.type !== 'private' || !scene.enabled(target.chat)) return;
        scene.abort(target.chat);
        const mutation = beginChatMutation(target.chat, 'private', [], ['sceneMode']);
        target.chat.sceneMode = { ...target.chat.sceneMode, enabled: false, revision: target.chat.sceneMode.revision + 1 };
        if (await saveChatMutation(mutation)) { close(); refresh(); showToast('已回到线上，已有旁白保留'); }
    }
    function render(message, continuous) {
        scene.validateMessage(message);
        const container = document.createElement('div');
        container.className = 'scene-turn'; container.dataset.sceneTurnId = message.id;
        let dialogueIndex = 0;
        for (const part of message.scene.blocks) {
            let wrapper;
            if (part.kind === 'dialogue') {
                // Reuse the exact original bubble/portrait/theme DOM with an inert placeholder.
                // Never send narrative text through legacy media/HTML/command detection.
                const safe = { ...message, scene: undefined, content: '[角色的消息：场景文字]', parts: [{ type: 'text', text: '[角色的消息：场景文字]' }],
                    quote: dialogueIndex ? undefined : message.quote };
                wrapper = createBaseMessageBubbleElement(safe, continuous || dialogueIndex > 0);
                wrapper.querySelector('.bubble-content').textContent = part.text;
                dialogueIndex++;
            } else {
                wrapper = document.createElement('div');
                wrapper.className = 'message-wrapper scene-narration' + (message.isContextDisabled ? ' context-disabled' : '');
                wrapper.dataset.id = message.id;
                const row = document.createElement('div'); row.className = 'message-bubble-row';
                const body = document.createElement('span'); body.className = 'scene-narration-text'; body.textContent = part.text;
                row.appendChild(body); wrapper.appendChild(row);
            }
            wrapper.dataset.segmentId = part.id;
            wrapper.dataset.sceneTurnId = message.id;
            wrapper.tabIndex = 0;
            wrapper.addEventListener('keydown', event => {
                if (!event.isComposing && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) {
                    event.preventDefault(); const box = wrapper.getBoundingClientRect(); handleMessageLongPress(wrapper, box.x, box.y);
                }
            });
            container.appendChild(wrapper);
        }
        return container;
    }
    function setup() {
        if (!$('scene-mode-btn') || $('scene-mode-btn').dataset.bound) return;
        $('scene-mode-btn').dataset.bound = 'true';
        for (const key of ['scene-mode-btn', 'scene-mode-title', 'scene-failed-entry']) $(key).addEventListener('click', open);
        $('scene-mode-form').addEventListener('submit', save);
        $('scene-mode-close').addEventListener('click', close);
        $('scene-return-online').addEventListener('click', returnOnline);
        $('scene-panel-online').addEventListener('click', returnOnline);
        $('scene-help-btn').addEventListener('click', () => {
            const help = $('scene-help'); help.hidden = !help.hidden; $('scene-help-btn').setAttribute('aria-expanded', String(!help.hidden));
        });
        $('scene-mode-modal').addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') {
                const nodes = Array.from($('scene-mode-modal').querySelectorAll('button,input,textarea,select')).filter(el => !el.disabled && el.getClientRects().length);
                const first = nodes[0], last = nodes[nodes.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });
        $('scene-copy-draft').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText($('scene-draft-text').value); showToast('已复制原始回复'); }
            catch (_) { $('scene-draft-text').focus(); $('scene-draft-text').select(); showToast('请长按或按Ctrl+C复制已选原文'); }
        });
        refresh();
    }
    Object.assign(scene, { refresh, open, close, render, setup });
})(globalThis);
