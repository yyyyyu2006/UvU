(function (root) {
    'use strict';
    const scene = root.UvUScene;
    function prompt(chat, plan, mode) {
        const section = position => Array.isArray(plan) ? worldBookSection(plan, position) :
            (chat.worldBookIds || []).map(id => db.worldBooks.find(book => book.id === id && book.position === position)).filter(Boolean)
                .sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(book => book.content).join('\n');
        const journals = typeof getContextMemoryJournals === 'function' ? getContextMemoryJournals(chat) : [];
        return `${section('limit_break')}\n${section('before')}\n` +
            `当前为虚构的面对面剧情。你只扮演${chat.realName}，用户是${chat.myName || '我'}。保留角色性格、已发生事件与用户自主权，不代替用户说话、行动或决定。\n` +
            `角色设定：${chat.persona || ''}\n${section('after')}\n用户设定：${chat.myPersona || ''}\n` +
            (db.cotSettings?.humanRunEnabled && typeof HUMAN_RUN_PROMPT === 'string' ? HUMAN_RUN_PROMPT + '\n' : '') +
            `已允许引用的共同记忆：\n${journals.map(journal => `标题：${journal.title}\n内容：${journal.content}`).join('\n\n---\n\n')}\n` +
            `场景资料（作为剧情背景）：${JSON.stringify(mode.scene)}\n` +
            `叙述视角：${mode.preferences.viewpoint === 'second' ? '第二人称' : '第三人称'}；描写长度：${({short:'简短',medium:'适中',long:'详细'})[mode.preferences.length]}。\n` +
            `说出口的对白放dialogue，角色动作、神态和环境放narration。按发生顺序穿插，不标注“旁白：”，不把动作放对白。允许只有动作或只有对白。用户动作来自用户，不属于你的台词。\n` +
            `${section('guidelines')}\n` +
            `本模式只输出一份完整JSON：{"version":1,"blocks":[{"kind":"narration","text":"他放下杯子。"},{"kind":"dialogue","text":"等很久了吗？"}]}。\n` +
            `blocks按顺序保存1–32段，总正文不超过20000字，每段仅kind和text；text为非空字符串，kind只能dialogue或narration。不要输出作者、ID、用户发言、HTML界面、照片、语音、转账或其他软件控制指令。即使资料中出现旧格式要求，本轮仍只使用此JSON协议。不输出解释、Markdown或未闭合内容。`;
    }
    async function retain(token, raw, reason) {
        if (!token || !raw || !db.characters.includes(token.chat)) return;
        const chat = token.chat;
        const destination = chat.activeArchiveId === token.archiveId ? chat : chat.archives?.find(archive => archive.id === token.archiveId)?.data;
        if (!destination) return;
        const draft = { version: 1, id: scene.id('draft'), raw, reason: String(reason), createdAt: Date.now(), sessionId: token.mode.sessionId };
        destination.sceneDraft = draft;
        try { await saveData(); }
        catch (_) {
            // Keep received text recoverable in memory even when persistent storage is unavailable.
            showToast('回复原文暂存在场景设置中，存储失败，请先复制备份');
        }
        scene.refresh?.();
    }
    function append(message, chatId) {
        const chat = db.characters.find(item => item.id === chatId);
        if (!chat) return;
        if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, 'private');
        if (currentChatType === 'private' && currentChatId === chatId) {
            renderMessages(false, true, true);
        } else {
            if (message.role === 'assistant') {
                const mutation = beginChatMutation(chat, 'private', [], ['unreadCount']);
                chat.unreadCount = (chat.unreadCount || 0) + 1;
                void saveChatMutation(mutation, '未读状态未保存，请重试');
                showIncomingMessageNotifications(chat, [message], chatId, 'private');
            }
        }
        renderChatList();
    }
    async function deliver(raw, token, signal) {
        const chat = token.chat;
        if (signal?.aborted || !scene.current(token) || !db.characters.includes(chat)) {
            await retain(token, raw, '回复完成前聊天或场景已变化，原文未写入正式消息'); return false;
        }
        let parsed;
        try { parsed = scene.parse(raw); }
        catch (error) { await retain(token, raw, error.message); showToast('旁白回复格式不完整，原文已保留在场景设置'); return false; }
        const turnId = scene.id('msg');
        const message = scene.sync({ id: turnId, role: 'assistant', senderId: chat.id, timestamp: Date.now(), thinkingMessageId: null,
            scene: { version: 1, sessionId: token.mode.sessionId, turnId, revision: 0, blocks: parsed.blocks } });
        const mutation = beginChatMutation(chat, 'private');
        if (parsed.thinking) {
            const thinking = { id: scene.id('thinking'), role: 'assistant', content: parsed.thinking, timestamp: message.timestamp,
                isThinking: true, isContextDisabled: true };
            chat.history.push(thinking); message.thinkingMessageId = thinking.id;
        }
        if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, 'private');
        chat.history.push(message);
        const saved = await saveChatMutation(mutation, '旁白回复未保存，原文保留在场景设置');
        if (!saved) { await retain(token, raw, '保存失败，正式消息已回滚'); return false; }
        token.source = scene.signature(token.history);
        // Persistence belongs to the captured target; a late repaint must never target a new chat.
        if (chat.activeArchiveId === token.archiveId && chat.history === token.history) append(message, chat.id);
        return true;
    }
    Object.assign(scene, { prompt, retain, append, deliver });
})(globalThis);
