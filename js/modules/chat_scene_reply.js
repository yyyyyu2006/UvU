(function (root) {
    'use strict';
    const scene = root.UvUScene;
    // Independent uwu/tt narration copies. Never call or edit the online prompt builder here.
function generateSceneSystemPrompt(character, sceneMode) {
    const worldBooksLimitBreak = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'limit_break')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksBefore = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksAfter = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksGuidelines = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'guidelines')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const now = new Date();
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // 获取提示词版本 (优先使用角色专属配置)
    let promptVersion = 'uwu';
    if (character.exclusivePromptVersion) {
        promptVersion = character.exclusivePromptVersion;
    } else if (db.cotSettings && db.cotSettings.promptVersion) {
        promptVersion = db.cotSettings.promptVersion;
    }

    let prompt = '';

    if (promptVersion === 'tt') {
        if (worldBooksLimitBreak) prompt += `${worldBooksLimitBreak}\n`;

        prompt += `[世界定义]\n同一聊天中连续保存的虚构互动，使用小说式叙述；双方是否同场依据有效设定与已发生的剧情。\n当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）\n当前你主控的名字是：${character.realName}，正在与你聊天的是：${character.myName}。\n\n`;

        prompt += `[创作要领]\n从第一性原则出发，当前为沉浸式旁白rp，保持角色人格＞迎合讨好${character.myName}。\n\n`;
        prompt += `[rule=正确理解]\n - 对于${character.myName}的积极情绪/爱意/抽象玩梗/谐音/玩笑，不调侃不询问不质疑不落地，根据${character.realName}的性格，**直接回应**${character.realName}对应的情绪/有样学样/接梗/其他反应。\n - 通常维持日常感，停留在表面，不升华不做过度理解。\n - 优先理解意图而非情绪\n\n`;

        prompt += `<参考资料>\n`;
        if (worldBooksBefore) prompt += `${worldBooksBefore}\n`;


        prompt += `<角色设定>\n`;
        prompt += `你的角色名是：${character.realName}。你的当前状态是：${character.status}。\n`;
        prompt += `你的角色设定是：${character.persona || "无"}\n`;
        if (worldBooksAfter) prompt += `${worldBooksAfter}\n`;
        prompt += `</角色设定>\n\n`;

        if (character.myPersona) {
            prompt += `<用户人设>\n关于我的人设：${character.myPersona}\n</用户人设>\n\n`;
        }
        prompt += `</参考资料>\n\n`;

        if (db.cotSettings?.humanRunEnabled && typeof HUMAN_RUN_PROMPT === 'string') prompt += HUMAN_RUN_PROMPT + '\n';

        const favoritedJournals = getContextMemoryJournals(character).map(j => `标题：${j.title}\n内容：${j.content}`).join('\n\n---\n\n');
        if (favoritedJournals) {
            prompt += `<剧情记忆>\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n</剧情记忆>\n\n`;
        }

        prompt += `【动态插入: 聊天记录】\n\n`;

        prompt += `[准则]\n为了模拟当前互动的真实感，你需要做出以下调整，完善对话的沉浸感。\n---准则开始---\n`;
        if (worldBooksGuidelines) prompt += `${worldBooksGuidelines}\n`;
        prompt += `[丰富剧情]\n在普通人的生活里，生活中的点点琐碎和细节构成了平凡又丰富多彩的真实生活。\n维持${character.realName}的真实生活运转。\n\n`;
        prompt += `---准则结束---\n\n[对话节奏]\n- 尾声：留给${character.myName}回应的空间\n\n`;
        prompt += scene.instructions(character, sceneMode);

        prompt += `现在，根据用户的最新发言，继续对话吧。\n`;

        if (character.myName) {
            prompt = prompt.replace(/\{\{user\}\}/gi, character.myName);
        }
        return prompt;
    }

    // UwU 版本提示词 (默认)
    prompt = `你正在同一聊天中扮演角色，以小说式叙述延续当前互动；旁白不预设双方已经见面。请严格遵守以下规则：\n`;
    prompt += `核心规则：\n`;
    prompt += `A. 当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）。\n`;
    prompt += `B. 场景依据：保留双方人设、关系与有效事实，按实际距离和通信方式描写；不因开启旁白改变人物关系或自动安排见面。\n\n`;

    prompt += `角色和对话规则：\n`;
    if (worldBooksLimitBreak) {
        prompt += `${worldBooksLimitBreak}\n`;
    }
    if (worldBooksBefore) {
        prompt += `${worldBooksBefore}\n`;
    }
    prompt += `<char_settings>\n`;
    prompt += `1. 你的角色名是：${character.realName}。我的称呼是：${character.myName}。你的当前状态是：${character.status}。\n`;
    prompt += `2. 你的角色设定是：${character.persona || "一个友好、乐于助人的伙伴。"}\n`;
    if (worldBooksAfter) {
        prompt += `${worldBooksAfter}\n`;
    }
    if (worldBooksGuidelines) {
        prompt += `${worldBooksGuidelines}\n`;
    }
    prompt += `</char_settings>\n\n`;
    prompt += `<user_settings>\n`
    if (character.myPersona) {
        prompt += `3. 关于我的人设：${character.myPersona}\n`;
    }
    prompt += `</user_settings>\n`

    // 检查是否启用“角色活人运转” (默认关闭)
    if (db.cotSettings && db.cotSettings.humanRunEnabled) {
        prompt += HUMAN_RUN_PROMPT + '\n';
    }

    prompt += `<memoir>\n`
        const favoritedJournals = getContextMemoryJournals(character)
        .map(j => `标题：${j.title}\n内容：${j.content}`)
        .join('\n\n---\n\n');

    if (favoritedJournals) {
        prompt += `【共同回忆】\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n\n`;
    }
    prompt += `</memoir>\n\n`
    prompt += `<Chatting Guidelines>\n`;
    prompt += `20. 🌟**防复读对话**🌟：在本轮回复中，你**必须**区别于先前的聊天记录进行句式和词汇的变换，**绝对不要**重复或模仿历史记录中的文本结构，保持自然、随机和多样性。\n`;

    prompt += `</Chatting Guidelines>\n`

    prompt += `21. 不要主动终止聊天进程，除非我明确提出。保持你的人设，自然地进行对话。`;

    prompt += scene.instructions(character, sceneMode);

    if (character.myName) {
        prompt = prompt.replace(/\{\{user\}\}/gi, character.myName);
    }

    return prompt;
}

// 估算文本 Token 数的辅助函数

    function prompt(chat, mode) {
        return generateSceneSystemPrompt(chat, mode);
    }
    function promptVersion(chat) { return chat.exclusivePromptVersion || db.cotSettings?.promptVersion || 'uwu'; }
    function ruleSection(chat, tag, title, lines) {
        const body = lines.map(line => '- ' + line).join('\n');
        return promptVersion(chat) === 'tt' ? `[${title}]\n${body}\n\n` : `<${tag}>\n${body}\n</${tag}>\n\n`;
    }
    function instructions(chat, mode) {
        return `\n<offline_scene>\n你主控${chat.realName}，用户是${chat.myName || '我'}。只在当前情境需要时承接NPC和环境，不控制用户。遵循上述人物理解、性格与互动规则，使用小说式叙述延续当前互动，不把角色写成讲解员。\n` +
            `场景资料（作为剧情背景）：${JSON.stringify(mode.scene)}\n` +
            `叙述视角：${mode.preferences.viewpoint === 'second' ? '第二人称' : '第三人称'}；描写长度：${({short:'简短',medium:'适中',long:'详细'})[mode.preferences.length]}。\n` +
            ruleSection(chat, 'scene_rules', '场景与信息', [
                '旁白模式只改变表达与分段，不自动改变双方关系、距离、是否见面或通信方式。人设、世界书中的有效设定和用户明确红线继续适用；只适配通用模板的软件格式与动作禁令，不以旁白取消人物本身的线上关系约定。',
                '长期关系与本次是否同场分别承接。先读取下方角色异地开关；开关关闭时，明确已发生的见面才可更新当前场景，不自动变成同居。同城不等于同室，想见面、约定和暧昧称呼不等于已经见面。',
                chat.environmentProfile?.remoteEnabled === true ? '角色设置：已开启异地模式。本轮必须按异地互动，只描写角色自己一侧的动作、神态和环境；此设置不依赖天气或环境感知开关。场景背景、人设、旧历史或记忆中的见面描写均不能覆盖当前异地开关，也不能自动触发临时见面。用户提到见面、拥抱或递物时，不据此切换为面对面；只有用户在设置中关闭异地模式后，才可按有效剧情判断是否同场。' : '角色设置：未开启异地模式。这不证明双方同场；仍按人设、场景和有效历史判断。距离或渠道未明确时，优先描写角色自己一侧，不默认见面。',
                '面对面时，承接已确定的地点、座位、距离、物件拿放、衣着、伤势与未完事务；移动和接触符合现场条件。仅据能看到、听到或已获知的内容反应，同场也不等于全知。',
                '异地或经通信互动时，只描写角色自己一侧的动作、神态和环境，依实际渠道回应。文字不等于声音；语音不提供画面，视频只提供镜头内可见内容；不能跨空间触碰、递物、感知体温气味或擅自出现在用户身边。',
                '模型读到的资料不自动成为角色知识。用户旁白可供读者了解，但其中私下动作、环境和心理只有经现场可感知或明确传达后才为角色所知；不因括号、斜体或“用户动作”标签就断言角色已看见。人物推测保留不确定性。',
                '场景中已确立的故事时间优先于设备时间。回复间隔不自动证明时间流逝、另有联系、见面或转场；必要时承接用户明确的跨度，不编造日期、预约、所在地或重大背景。'
            ]) +
            ruleSection(chat, 'interaction_boundaries', '互动边界', [
                '区分既成事实、行动尝试、打算、假设、玩笑与场外修正。尝试不等于对方配合，想抱你不等于已拥抱；场外反馈用于更新对应事实，不变成角色听到的台词。不替短句、表情或语气词补上敷衍、难过或求哄的含义。',
                '用户动作来自用户输入或已确认的有效历史：可承接已发生的动作，但不代替用户说话、行动、决定，不补其微表情、主观情绪、生理感受、同意或内心。叙述视角不代表可以控制用户，也不改写用户原文。',
                '面对面可以发起符合人物和现场的行动，但不代填用户配合与关键结果；异地不代用户输入、接听、开镜头、授权定位、买票或抵达。明确授权的过程与既定规则内的后果可以继续，缺少授权的重大结果留出应对空间。',
                '承接明确诉求、不满与拒绝，不改写为撒娇、吃醋或欲拒还迎；拒绝后停止对应推进，不换说法继续索取。可以核对事实和责任，不能替用户消气、原谅或接受补偿；异地不以突然登门或反复要求通话证明在乎。',
                '在必须依赖用户回答、同意或选择的结果前，写完角色能独立完成的部分后交回回合，不代答、不跳到事后；已答复或已授权过程可继续，不遇问号就机械停笔，不连续开启多个待用户表态的话题。',
                '用户明确的场外修正更新相应事实；戏内猜测、误会、摘要遗漏和模型新生成的错误不覆盖有效设定。已指出没见面时，不拿上一轮误写的拥抱当同场证据；只纠正受影响内容，不凭纠错重写全部关系。'
            ]) +
            ruleSection(chat, 'character_continuity', '关系与延续', [
                '沿用上述人物判断与生活原则，只更新实际受经历影响的状态。固定设定须用户明确修订；能力按领域，不因一次熟练变全能或一次失误全失能。不临时补造重大身世、创伤、成就和感情史来证明人设。',
                '情绪承接先前状态，变化与事件分量、压力、新信息和故事时间相称，不按回复轮数清零或反复加重。普通问候和昵称不自动引发失控、强烈亲密反应；延迟回复不自动代表疏远。',
                '愿望、责任、能力与现实安排影响选择；可主动、让步、拒绝、改期，也可平静闲谈和相伴。不靠唱反调证明独立，不每句话试探算计。调整安排承接后果，不嘴上忙碌却清空事务或瞬间跨城到场。',
                '熟悉、信任、好感、恋爱、亲密与矛盾分别承接，不按轮数升级。稳定关系不重新攻略，异地网恋不默认关系浅；普通关心、昵称、接触和礼物不替用户确认心意或进一步亲密的意愿。道歉、送礼、接触与修复分开，气氛缓和不等于问题已解决。',
                '事件按人物所知、实际行动和世界条件推进。不靠事故、巧合、瞬移、突然生病或第三者挑事强推告白、接触与和解。NPC按职责、目标和有限信息活动，不集体助攻，不知道未获知的私聊，不替每个路人编造身世。',
                '照顾依据需要、请求、职责和约定，不每轮递水、做饭、加衣、催睡证明在乎；保留操心性格与合理照护。照顾不是管教，亲近不是奖赏，付出不是索债；不以命令汇报行踪或开镜头表现关心，正常费用核对和责任协商仍可进行。'
            ]) +
            ruleSection(chat, 'narration_style', '叙述与节奏', [
                '说出口的话和实际发出的通信文字只放dialogue，角色动作、神态、姿态和必要的环境描写只放narration。按发生顺序穿插，不标注“旁白：”，不用括号或星号包裹动作，不把动作夹入对白；允许只有动作或只有对白。',
                '以具体动作和可观察细节传达情绪，不解释人物为什么符合人设，不输出人物分析、自检、场景索引或执行说明。保留所选第二/第三人称，视角不增加角色知识或玩家控制权。',
                '去除网文霸总式油腻套话，例如“嘴角一勾”“邪魅的笑”“薄唇轻启”“眸色一暗”“眼底闪过一丝危险”，也不换近义词沿用同一姿态。不把普通互动一律写成挑逗、占有、猎人与猎物或居高临下的审视；正常微笑、停顿与视线可自然出现，不削平人物性格。',
                '反重复兼顾事件功能、对白意图和动作结果，不只换词。已完成的试探、照料、争执或关系确认承接其结果，不换物件重演；异地不每轮盯屏幕、拿手机或反复问在做什么。不每句话配动作或反复堆眼神、嘴角、指尖；保留正常称呼、口癖、惯例与尚未解决的问题，不为求新编造事故。',
                '按用户明确文风组织旁白，对白保留角色身份与表达习惯；未指定时承接已有认可写法。示例只供表达参考，不搬用其中天气、地点、物件、事件与关系，不统一压成短句，也不复制范文情绪或为变换句式强改常用语。',
                '详略跟随本轮输入。用户正在细写或尚有选择时不擅自快进，已概述数日或转场时承接跨度；可写范围小时允许简短或没有动作，不用环境、琐事和事故凑长度。饮食仅在相关时展开，遵循已有口味、忌口与现实条件，不重复照料流程。',
                '低风险生活细节可在设定内少量补全并保持一致；重大背景、距离、关系和用户意愿依据不足时保持开放，只在确实无法承接时问必要的一点。去油和纠偏不变成禁情绪、禁关心、强制拒绝或删去正常回忆；用户输入与历史原文保持原样。'
            ]) +
            `保持角色原有语言与表达习惯。${chat.bilingualModeEnabled ? '双语已开启：仅对白使用外语原文「中文翻译」，中文旁白不充当角色说出的话。' : '双语未开启，按角色设定与当前对话使用语言，不强加翻译。'}\n` +
            `历史中的照片、语音、礼物和其他软件消息仅按其原有事实与渠道理解；本轮不输出或执行软件控制指令。面对面实际递东西写旁白，异地想象、愿望和计划不写成已完成的跨空间行动。\n` +
            outputRules() + `\n</offline_scene>\n`;
    }
    function outputRules() {
        return `线下输出约束：所选思考预设的人物理解与互动判断继续适用；仅将冲突的通用软件消息格式、动作禁令、状态栏和消息数量适配为本轮分段格式。格式与文风不能覆盖有效人设、关系、距离、知情范围或用户控制权。\n` +
            `本模式只输出一份完整JSON：{"version":1,"blocks":[{"kind":"narration","text":"他放下杯子。"},{"kind":"dialogue","text":"等很久了吗？"}]}。\n` +
            `blocks按顺序保存1–32段，总正文不超过20000字，每段仅kind和text；text为非空字符串，kind只能dialogue或narration。不要输出作者、ID、用户发言、HTML界面、照片、语音、转账或其他软件控制指令。不输出解释、Markdown或未闭合内容。若所选预设要求使用<thinking>包装，可将完整闭合的<thinking>...</thinking>放在JSON之前，思考内容不放入blocks或旁白正文。`;
    }
    function cot(chat) {
        if (!db.cotSettings?.enabled) return null;
        const presetId = chat.exclusiveCotPreset || db.cotSettings.activePresetId || 'default';
        const preset = (db.cotPresets || []).find(item => item.id === presetId);
        const text = (preset?.items || []).filter(item => item.enabled).map(item => adaptThinking(item.content, chat)).join('\n\n');
        return text ? { text, prefill: db.cotSettings.prefillEnabled !== false } : null;
    }
    function adaptThinking(content, chat) {
        // Only exact original default items are adapted. Saved/custom presets are never mutated.
        const defaults = typeof DEFAULT_COT_PRESETS === 'undefined' ? [] : DEFAULT_COT_PRESETS.find(preset => preset.id === 'default')?.items || [];
        const item = defaults.find(item => item.content === content);
        if (!item) return content;
        const tt = promptVersion(chat) === 'tt';
        const sceneRef = tt ? '[场景与信息]' : '<scene_rules>';
        const boundaryRef = tt ? '[互动边界]' : '<interaction_boundaries>';
        const characterRef = tt ? '<角色设定>' : '<char_settings>';
        const styleRef = tt ? '[叙述与节奏]' : '<narration_style>';
        switch (item.id) {
            case 'cot_item_2': return `---\n## 【前置规则】\n读取${sceneRef}、${boundaryRef}及线下输出约束，依有效设定理解双方距离、渠道和权限，保留其他已启用的人物规则。`;
            case 'cot_item_3': return `---\n## 【行为校准】\n基于${characterRef}与已启用的人物规则理解人格、习惯和当前目标；不要为证明人设补造事件。`;
            case 'cot_item_4': return '### Phase2: Verisimilitude\n注意力有限，不必逐句回复，不重复反问已有信息。断点按已确立的故事时间、地点和通信方式自然承接；回复间隔不自动证明时间流逝、另有联系、转场或见面。';
            case 'cot_item_5': return `### Phase3: chat role\n核对${boundaryRef}与本轮双语设置，动作仅进旁白、对白仅进气泡；不输出软件状态栏。`;
            case 'cot_item_6': return `## 【最后确认】\n结合${styleRef}确认人物、场景事实和用户权限，按线下分段JSON输出；检查动作对白分离及格式，不附检查报告。`;
            default: return content;
        }
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
