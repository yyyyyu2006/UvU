(function (root) {
    'use strict';
    const scene = root.UvUScene;
    function prompt(chat, plan, mode) {
        return generatePrivateSystemPrompt(chat, plan, mode);
    }
    function instructions(chat, mode) {
        return `\n<offline_scene>\n你只扮演${chat.realName}，用户是${chat.myName || '我'}。遵循上述人物理解、性格与互动规则，使用小说式叙述延续当前互动，不把角色写成讲解员。\n` +
            `场景资料（作为剧情背景）：${JSON.stringify(mode.scene)}\n` +
            `场景中填写的时间优先于当前设备时间；没有交代的地点、距离和关系不擅自跳转。\n` +
            `叙述视角：${mode.preferences.viewpoint === 'second' ? '第二人称' : '第三人称'}；描写长度：${({short:'简短',medium:'适中',long:'详细'})[mode.preferences.length]}。\n` +
            `说出口的对白只放dialogue，角色动作、神态、姿态和必要的环境描写只放narration。按发生顺序穿插，不标注“旁白：”，不用括号或星号包裹动作，不把动作夹入对白。允许只有动作或只有对白。\n` +
            `描写应回应当前互动，以具体动作和可观察的细节传达情绪，不解释人物为什么符合人设，不输出分析过程。不要每句对白搭配一个动作，不机械复述上一轮，不反复堆砌眼神、嘴角、指尖等动作，不强凑段数或用大段环境描写拖慢互动。留给用户回应的空间。\n` +
            `旁白语言自然、具体、克制，去除网文霸总式的油腻套话，例如“嘴角一勾”“勾起一抹邪魅的笑”“薄唇轻启”“眸色一暗”“眼底闪过一丝危险”；不要改成近义词继续套用相同姿态，也不要把普通互动一律写成挑逗、占有、猎物与猎人或居高临下的审视。正常的微笑、停顿、视线和动作仍可依人物与情境自然描写，写清实际发生的细节即可；没有必要的动作就不补，不为了去套话削平角色本身的性格。此要求只约束生成的旁白，不删改用户输入或历史原文。\n` +
            `用户动作来自用户输入或已确认的历史：可承接已发生的动作，但不代替用户说话、行动、决定或编造其内心；不改写用户原文。叙述视角不代表可以控制用户。\n` +
            `保持角色原有语言与表达习惯。${chat.bilingualModeEnabled ? '双语已开启：仅对白使用外语原文「中文翻译」，中文旁白不充当角色说出的话。' : '双语未开启，按角色设定与当前对话使用语言，不强加翻译。'}\n` +
            `线上聊天中的送礼、照片、语音、转账、动态、状态栏或HTML格式在本轮仅作为往事资料，不再输出或执行；现实场景中的递东西等行为写作旁白。\n` +
            outputRules() + `\n</offline_scene>\n`;
    }
    function outputRules() {
        return `线下输出约束：所选思考预设的人物理解与互动判断继续适用；其中纯线上关系、禁止动作、旧消息格式与本轮冲突时，使用此处的线下分段格式。\n` +
            `本模式只输出一份完整JSON：{"version":1,"blocks":[{"kind":"narration","text":"他放下杯子。"},{"kind":"dialogue","text":"等很久了吗？"}]}。\n` +
            `blocks按顺序保存1–32段，总正文不超过20000字，每段仅kind和text；text为非空字符串，kind只能dialogue或narration。不要输出作者、ID、用户发言、HTML界面、照片、语音、转账或其他软件控制指令。不输出解释、Markdown或未闭合内容。若所选预设要求使用<thinking>包装，可将完整闭合的<thinking>...</thinking>放在JSON之前，思考内容不放入blocks或旁白正文。`;
    }
    function cot(chat) {
        if (!db.cotSettings?.enabled) return null;
        const presetId = chat.exclusiveCotPreset || db.cotSettings.activePresetId || 'default';
        const preset = (db.cotPresets || []).find(item => item.id === presetId);
        const text = (preset?.items || []).filter(item => item.enabled).map(item => item.content).join('\n\n');
        return text ? { text, prefill: db.cotSettings.prefillEnabled !== false } : null;
    }
    function responseText(raw, token) {
        const input = raw.trim();
        // A closing tag inside valid JSON is literal text, never a consumed prefill.
        if (token?.cot?.prefill && !/^(?:<thinking>|\{|```)/.test(input) && input.includes('</thinking>')) return '<thinking>' + input;
        return raw;
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
        try { parsed = scene.parse(responseText(raw, token)); }
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
    Object.assign(scene, { prompt, instructions, outputRules, cot, responseText, retain, append, deliver });
})(globalThis);
