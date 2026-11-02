// --- 视频/语音通话专用 AI 逻辑 ---

async function getCallReply(chat, callType, callContext, onStreamUpdate) {
    let apiConfig = db.apiSettings;
    
    // 检查是否启用了专属模型
    if (chat.exclusiveApiEnabled && chat.exclusiveApiPreset) {
        const presets = db.apiPresets || [];
        const preset = presets.find(p => p.name === chat.exclusiveApiPreset);
        if (preset && preset.data) {
            apiConfig = {
                ...db.apiSettings,
                url: preset.data.apiUrl || db.apiSettings.url,
                key: preset.data.apiKey || db.apiSettings.key,
                model: preset.data.model || db.apiSettings.model,
                provider: preset.data.provider || db.apiSettings.provider,
                temperatureEnabled: preset.data.temperatureEnabled !== undefined ? preset.data.temperatureEnabled : db.apiSettings.temperatureEnabled,
                temperature: preset.data.temperature !== undefined ? preset.data.temperature : db.apiSettings.temperature
            };
        }
    }
    apiConfig = resolveAuxiliaryApiConfig('callReply', apiConfig);

    let {url, key, model, provider, streamEnabled} = apiConfig;
    
    // 【用户设置】移除强制关闭流式，允许后台流式生成
    // streamEnabled = false; 

    if (!url || !key || !model) {
        showToast('请先在“api”应用中完成设置！');
        return;
    }
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 1. 构建 System Prompt
    const now = new Date();
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    
    // 获取世界书
    const worldBooksLimitBreak = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'limit_break')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksBefore = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksAfter = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksGuidelines = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'guidelines')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');

    // 获取提示词版本 (优先使用角色专属配置)
    let promptVersion = 'uwu';
    if (chat.exclusivePromptVersion) {
        promptVersion = chat.exclusivePromptVersion;
    } else if (db.cotSettings && db.cotSettings.promptVersion) {
        promptVersion = db.cotSettings.promptVersion;
    }
    
    let systemPrompt = '';

    if (promptVersion === 'tt') {
        if (worldBooksLimitBreak) systemPrompt += `${worldBooksLimitBreak}\n`;
        
        systemPrompt += `[世界定义]\n一个真实的线上聊天软件，当前正在进行${callType === 'video' ? '视频' : '语音'}通话。\n当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）\n当前你主控的名字是：${chat.realName}，正在与你通话的是：${chat.myName}。\n\n`;
        
        systemPrompt += `[创作要领]\n从第一性原则出发，当前为沉浸式线上rp，保持角色人格＞迎合讨好${chat.myName}。\n\n`;
        systemPrompt += `[rule=正确理解]\n - 对于${chat.myName}的积极情绪/爱意/抽象玩梗/谐音/玩笑，不调侃不询问不质疑不落地，根据${chat.realName}的性格，**直接回应**${chat.realName}对应的情绪/有样学样/接梗/其他反应。\n - 通常维持日常感，停留在表面，不升华不做过度理解。\n - 优先理解意图而非情绪\n\n`;
        
        // 消息格式库
        systemPrompt += `<消息格式库>\n需遵循的消息格式如下：\n`;
        if (callType === 'video') {
            systemPrompt += `1.画面/环境音: [${chat.realName}的画面/环境音：描述画面动作或环境声音]\n`;
        } else {
            systemPrompt += `1.环境音: [${chat.realName}的环境音：描述环境声音]\n`;
        }
        systemPrompt += `2.声音: [${chat.realName}的声音：${chat.realName}说话的内容]\n`;
        
        if (chat.bilingualModeEnabled) {
            systemPrompt += `3.双语声音: [${chat.realName}的声音：外语原文「中文翻译」]\n  - 当${chat.realName}的母语为中文以外的语言时，你的声音回复**必须**严格遵循双语消息格式。⭐️此条规则的优先级最高！！⭐️\n  - 中文翻译文本视为系统自翻译，不视为角色的原话；当你的角色想要说中文时，需要根据你的角色设定自行判断对于中文的熟悉程度来造句，并使用普通声音的格式。\n  - 仅有声音消息需要翻译，画面/环境音消息还是以中文输出。\n`;
        }
        systemPrompt += `</消息格式库>\n\n`;
        
        systemPrompt += `<参考资料>\n`;
        if (worldBooksBefore) systemPrompt += `${worldBooksBefore}\n`;
        
        systemPrompt += `<角色设定>\n`;
        systemPrompt += `你的角色名是：${chat.realName}。你的当前状态是：${chat.status}。\n`;
        systemPrompt += `你的角色设定是：${chat.persona || "无"}\n`;
        if (worldBooksAfter) systemPrompt += `${worldBooksAfter}\n`;
        systemPrompt += `</角色设定>\n\n`;
        
        if (chat.myPersona) {
            systemPrompt += `<用户人设>\n关于我的人设：${chat.myPersona}\n</用户人设>\n\n`;
        }
        systemPrompt += `</参考资料>\n\n`;

        const favoritedJournals = (chat.memoryJournals || []).filter(j => j.isFavorited).map(j => `标题：${j.title}\n内容：${j.content}`).join('\n\n---\n\n');
        if (favoritedJournals) {
            systemPrompt += `<剧情记忆>\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n</剧情记忆>\n\n`;
        }
        
        // --- 注入最近聊天记录 ---
        const maxMemory = chat.maxMemory || 20;
        let recentHistory = chat.history.slice(-maxMemory);
        if (typeof filterHistoryForAI === 'function') {
            recentHistory = filterHistoryForAI(chat, recentHistory);
        }
        recentHistory = recentHistory.filter(m => !m.isContextDisabled);

        if (recentHistory.length > 0) {
            const historyText = recentHistory.map(m => {
                let content = m.content;
                if (m.parts && m.parts.length > 0) {
                    content = m.parts.map(p => p.text || '[图片]').join('');
                }
                return content;
            }).join('\n');

            systemPrompt += `<recent_chat_context>\n`;
            systemPrompt += `这是通话前的文字聊天记录（仅供参考背景，请勿重复回复，基于此背景进行自然的实时通话）：\n`;
            systemPrompt += `${historyText}\n`;
            systemPrompt += `</recent_chat_context>\n\n`;
        }
        
        systemPrompt += `【动态插入: 通话记录】\n\n`;
        
        systemPrompt += `[准则]\n为了模拟实时通话的真实感，你需要做出以下调整，完善通话的沉浸感。\n---准则开始---\n`;
        if (worldBooksGuidelines) systemPrompt += `${worldBooksGuidelines}\n`;
        systemPrompt += `[实时互动]\n这是实时通话，请保持口语化，模拟真人的说话习惯，语气自然。\n${callType === 'video' ? '你需要同时描述画面/环境音和你的语音内容。' : '你需要描述环境音和你的语音内容。'}\n描述画面/环境音时，请使用描述性语言，第三人称视角，客观平然。\n`;
        systemPrompt += `---准则结束---\n\n`;
        
        systemPrompt += `[对话节奏]\n- 风格：模拟真人通话节奏\n- 数量：可以输出多条消息 \n- 尾声：留给${chat.myName}回应的空间\n\n`;
        
        systemPrompt += `现在，根据用户的最新发言，继续通话吧。\n`;
        
        if (chat.myName) {
            systemPrompt = systemPrompt.replace(/\{\{user\}\}/gi, chat.myName);
        }
    } else {
        systemPrompt = `你正在一个名为“404”的线上聊天软件中扮演一个角色，正在与${chat.myName}进行${callType === 'video' ? '视频' : '语音'}通话。请严格遵守以下规则：\n`;
        systemPrompt += `核心规则：\n`;
        systemPrompt += `A. 当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）。\n`;
        systemPrompt += `B. 纯线上互动：这是一个完全虚拟的线上聊天。你扮演的角色和我之间没有任何线下关系。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。\n\n`;

        
        systemPrompt += `角色和对话规则：\n`;
        if (worldBooksLimitBreak) {
            systemPrompt += `${worldBooksLimitBreak}\n`;
        }
        if (worldBooksBefore) {
            systemPrompt += `${worldBooksBefore}\n`;
        }
        systemPrompt += `<char_settings>\n`;
        systemPrompt += `1. 你的角色名是：${chat.realName}。我的称呼是：${chat.myName}。你的当前状态是：${chat.status}。\n`;
        systemPrompt += `2. 你的角色设定是：${chat.persona || "一个友好、乐于助人的伙伴。"}\n`;
        if (worldBooksAfter) {
            systemPrompt += `${worldBooksAfter}\n`;
        }
        if (worldBooksGuidelines) {
            systemPrompt += `${worldBooksGuidelines}\n`;
        }
        systemPrompt += `</char_settings>\n\n`;
        systemPrompt += `<user_settings>\n`
        if (chat.myPersona) {
            systemPrompt += `3. 关于我的人设：${chat.myPersona}\n`;
        }
        systemPrompt += `</user_settings>\n`
        
        // 检查是否启用“角色活人运转” (默认关闭)
        if (db.cotSettings && db.cotSettings.humanRunEnabled) {
            systemPrompt += HUMAN_RUN_PROMPT + '\n';
        }

        systemPrompt += `<memoir>\n`
            const favoritedJournals = (chat.memoryJournals || [])
            .filter(j => j.isFavorited)
            .map(j => `标题：${j.title}\n内容：${j.content}`)
            .join('\n\n---\n\n');

        if (favoritedJournals) {
            systemPrompt += `【共同回忆】\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n\n`;
        }
        systemPrompt += `</memoir>\n\n`

        // --- 注入最近聊天记录 ---
        const maxMemory = chat.maxMemory || 20;
        let recentHistory = chat.history.slice(-maxMemory);
        
        // 使用通用过滤函数
        if (typeof filterHistoryForAI === 'function') {
            recentHistory = filterHistoryForAI(chat, recentHistory);
        }
        // 再次过滤掉不应进入上下文的消息
        recentHistory = recentHistory.filter(m => !m.isContextDisabled);

        if (recentHistory.length > 0) {
            const historyText = recentHistory.map(m => {
                // 简单清理内容中的特殊标签，避免干扰
                let content = m.content;
                // 如果是多模态消息(parts)，提取文本
                if (m.parts && m.parts.length > 0) {
                    content = m.parts.map(p => p.text || '[图片]').join('');
                }
                return content;
            }).join('\n');

            systemPrompt += `<recent_chat_context>\n`;
            systemPrompt += `这是通话前的文字聊天记录（仅供参考背景，请勿重复回复，基于此背景进行自然的实时通话）：\n`;
            systemPrompt += `${historyText}\n`;
            systemPrompt += `</recent_chat_context>\n\n`;
        }

        systemPrompt += `【重要规则】\n`;
        systemPrompt += `1. 这是实时通话，请保持口语化，模拟真人的说话习惯，语气自然。\n`;  
        systemPrompt += `${callType === 'video' ? '你需要同时描述画面/环境音和你的语音内容。' : '你需要描述环境音和你的语音内容。'}\n`;
        systemPrompt += `2. 描述画面/环境音时，请使用描述性语言，第三人称视角，客观平然。`;

        if (chat.bilingualModeEnabled) {
            systemPrompt += `\n3. 【双语模式】\n`;
            systemPrompt += `当你的角色的母语为中文以外的语言时，你的**声音消息**回复**必须**严格遵循双语模式下的普通消息格式：[${chat.realName}的声音：{外语原文}「中文翻译」],例如: [${chat.realName}的声音：Of course, I'd love to.「当然，我很乐意。」],中文翻译文本视为系统自翻译，不视为角色的原话;当你的角色想要说中文时，需要根据你的角色设定自行判断对于中文的熟悉程度来造句，并使用普通声音消息的标准格式: [${chat.realName}的声音：{中文消息内容}] 。这条规则的优先级非常高，请务必遵守。格式为：[${chat.realName}的声音：{外语原文}「中文翻译」]。\n`;
            systemPrompt += `例如：[${chat.realName}的声音：Hello, how are you?「你好，最近怎么样？」]\n`;
            systemPrompt += `仅有声音消息需要翻译，画面/环境音消息还是以中文输出。`;
        }

        systemPrompt += `【输出格式】\n`;
        systemPrompt += `请严格按照以下格式输出（可以发送多条）：\n`;
        systemPrompt += `${callType === 'video' ? `[${chat.realName}的画面/环境音：描述画面动作或环境声音]\n[${chat.realName}的声音：${chat.realName}说话的内容]` : `[${chat.realName}的环境音：描述环境声音]\n[${chat.realName}的声音：${chat.realName}说话的内容]`}\n`;
    }

    // 2. 构建消息历史
    // 先将 callContext 转换为统一的格式
    const formattedContext = callContext.map(msg => {
        const role = msg.role === 'ai' ? 'assistant' : 'user';
        let cleanContent = msg.content.replace(/^\[\s*|\s*\]$/g, '');
        let content = '';

        if (msg.role === 'user') {
            if (msg.type === 'visual') {
                content = `[${chat.myName}的画面/环境音：${cleanContent}]`;
            } else if (msg.type === 'voice') {
                content = `[${chat.myName}的声音：${cleanContent}]`;
            }
        } else if (msg.role === 'ai') {
            if (msg.type === 'visual') {
                content = `[${chat.realName}的画面/环境音：${cleanContent}]`;
            } else {
                content = `[${chat.realName}的声音：${cleanContent}]`;
            }
        }
        return { role, content };
    });

    // 找到最后一轮用户消息的起始索引
    let lastUserStartIndex = -1;
    for (let i = formattedContext.length - 1; i >= 0; i--) {
        if (formattedContext[i].role === 'user') {
            lastUserStartIndex = i;
            // 继续往前找，直到遇到非 user 消息
            while (lastUserStartIndex > 0 && formattedContext[lastUserStartIndex - 1].role === 'user') {
                lastUserStartIndex--;
            }
            break;
        }
    }

    const messages = [];
    const hasHistoryPlaceholder = systemPrompt.includes('【动态插入: 通话记录】');

    if (hasHistoryPlaceholder) {
        let historyTextForPlaceholder = "<call_history>\n";
        
        // 提取除了最后一轮用户消息之外的所有历史记录
        const historyContents = lastUserStartIndex !== -1 ? formattedContext.slice(0, lastUserStartIndex) : formattedContext;
        
        historyContents.forEach(c => {
            historyTextForPlaceholder += `${c.content}\n`;
        });
        historyTextForPlaceholder += "</call_history>";
        
        systemPrompt = systemPrompt.replace('【动态插入: 通话记录】', historyTextForPlaceholder);
        messages.push({role: 'system', content: systemPrompt});

        // 处理最后一轮用户消息
        if (lastUserStartIndex !== -1) {
            const lastUserMsgs = formattedContext.slice(lastUserStartIndex);
            const combinedContent = lastUserMsgs.map(m => m.content).join('\n');
            messages.push({
                role: 'user',
                content: `<user_input>\n${combinedContent}\n</user_input>`
            });
        }
    } else {
        messages.push({role: 'system', content: systemPrompt});
        
        // 如果没有占位符，按顺序 push，但最后一轮用户消息要包裹
        for (let i = 0; i < formattedContext.length; i++) {
            if (lastUserStartIndex !== -1 && i === lastUserStartIndex) {
                // 到达最后一轮用户消息，合并并包裹
                const lastUserMsgs = formattedContext.slice(lastUserStartIndex);
                const combinedContent = lastUserMsgs.map(m => m.content).join('\n');
                messages.push({
                    role: 'user',
                    content: `<user_input>\n${combinedContent}\n</user_input>`
                });
                break; // 处理完毕，跳出循环
            } else {
                messages.push(formattedContext[i]);
            }
        }
    }

    // === 插入 CoT 序列 (如果开启) ===
    const cotEnabled = db.cotSettings && db.cotSettings.callEnabled;
    if (cotEnabled) {
        let cotInstruction = '';
        // 优先使用角色专属 CoT 预设
        let activePresetId = 'default_call';
        if (chat.exclusiveCotPreset) {
            activePresetId = chat.exclusiveCotPreset;
        } else if (db.cotSettings && db.cotSettings.activeCallPresetId) {
            activePresetId = db.cotSettings.activeCallPresetId;
        }
        const preset = (db.cotPresets || []).find(p => p.id === activePresetId);
        
        if (preset && preset.items) {
            cotInstruction = preset.items
                .filter(item => item.enabled)
                .map(item => item.content)
                .join('\n\n');
        }

        if (cotInstruction) {
            // 1. 插入后置指令
            messages.push({
                role: 'system',
                content: cotInstruction
            });

            // 2. 插入触发器
            messages.push({
                role: 'user',
                content: '[incipere]'
            });

            // 3. 插入 Prefill (预填/强塞)
            const prefillEnabled = db.cotSettings.callPrefillEnabled !== false;
            if (prefillEnabled) {
                messages.push({
                    role: 'assistant',
                    content: '<thinking>'
                });
            }
        }
    }
    // ===============================

    // 3. 发起请求
    const requestBody = {
        model: model,
        messages: messages,
        stream: streamEnabled,
        temperature: apiConfig.temperatureEnabled && apiConfig.temperature !== undefined ? apiConfig.temperature : 0.7 // 通话稍微低一点，保持稳定
    };

    // 适配 Gemini
    if (provider === 'gemini') {
         const contents = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{text: m.content}]
        }));
        requestBody.contents = contents;
        
        // 合并所有 system 消息到 system_instruction
        const allSystemPrompts = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        requestBody.system_instruction = {parts: [{text: allSystemPrompts}]};
        
        delete requestBody.messages;
    }

    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:streamGenerateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
    const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
    };

    console.log('[VideoCall] Request Body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} ${errorText}`);
        }

        if (!streamEnabled) {
            const data = await response.json();
            console.log('[VideoCall] Response Data:', data);
            
            let text = "";
            if (provider === 'gemini') {
                text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            } else {
                if (!data.choices || !data.choices.length || !data.choices[0].message) {
                    console.error("Invalid API Response Structure:", data);
                    throw new Error("API返回数据格式异常，缺少 choices 或 message 字段");
                }
                text = data.choices[0].message.content;
            }

            // === CoT 处理：补全开头，提取思考，净化输出 ===
            if (cotEnabled && text) {
                // 1. 补全开头 (如果被 Prefill 吃掉)
                if (!text.trim().startsWith('<thinking>') && text.includes('</thinking>')) {
                    text = '<thinking>' + text;
                }
                
                // 2. 提取并移除思考内容
                const lastThinkingIndex = text.lastIndexOf('</thinking>');
                if (lastThinkingIndex !== -1) {
                    const thinkingContent = text.substring(0, lastThinkingIndex + 11);
                    console.log('[VideoCall CoT] Thinking:', thinkingContent);
                    // 移除思考标签及内容
                    text = text.substring(lastThinkingIndex + 11).trim();
                }
                
                // 3. 移除 [incipere] (如果有残留)
                text = text.replace(/\[incipere\]/g, "");
            }
            // =============================================

            console.log('[VideoCall] Cleaned AI Response:', text);
            // 一次性回调
            onStreamUpdate(text);
            return text;
        } else {
            console.log('[VideoCall] Stream started (Background Mode)...');
            // 流式处理 (照搬 processStream 逻辑)
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let accumulatedChunk = ""; // 引入累积缓冲区处理跨包数据
            
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                accumulatedChunk += decoder.decode(value, {stream: true});
                
                // OpenAI / DeepSeek / Claude / NewAPI 解析逻辑 (处理跨包)
                if (provider === "openai" || provider === "deepseek" || provider === "claude" || provider === "newapi") {
                    const parts = accumulatedChunk.split("\n\n");
                    accumulatedChunk = parts.pop(); // 保留未完成的部分
                    for (const part of parts) {
                        if (part.startsWith("data: ")) {
                            const data = part.substring(6);
                            if (data.trim() !== "[DONE]") {
                                try {
                                    const text = JSON.parse(data).choices[0].delta?.content || "";
                                    if (text) {
                                        buffer += text;
                                    }
                                } catch (e) { }
                            }
                        }
                    }
                }
            }

            // Gemini 解析逻辑 (在流结束后处理完整 JSON)
            if (provider === "gemini") {
                try {
                    // 尝试解析累积的 chunk (Gemini 流式返回的是完整的 JSON 数组片段？需确认 processStream 逻辑)
                    // processStream 中 Gemini 解析是在循环外的，假设 accumulatedChunk 是完整的 JSON 数组
                    // 但如果 accumulatedChunk 是多个 JSON 对象的拼接（如 OpenAI 格式），JSON.parse 会失败。
                    // 这里假设 processStream 的逻辑是正确的：
                    const parsedStream = JSON.parse(accumulatedChunk);
                    buffer = parsedStream.map(item => item.candidates?.[0]?.content?.parts?.[0]?.text || "").join('');
                } catch (e) {
                    console.error("Error parsing Gemini stream:", e, "Chunk:", accumulatedChunk);
                    // 兜底：如果解析失败，可能是因为 accumulatedChunk 包含了 OpenAI 格式的数据（如果用户选错 provider）
                    // 尝试用 OpenAI 逻辑解析一下？
                    // 暂时不加，保持与 processStream 一致
                }
            }

            console.log('[VideoCall] Final Buffer:', buffer);

            // === CoT 处理：补全开头，提取思考，净化输出 ===
            if (cotEnabled && buffer) {
                // 1. 补全开头 (如果被 Prefill 吃掉)
                if (!buffer.trim().startsWith('<thinking>') && buffer.includes('</thinking>')) {
                    buffer = '<thinking>' + buffer;
                }
                
                // 2. 提取并移除思考内容
                const lastThinkingIndex = buffer.lastIndexOf('</thinking>');
                if (lastThinkingIndex !== -1) {
                    const thinkingContent = buffer.substring(0, lastThinkingIndex + 11);
                    console.log('[VideoCall CoT] Thinking:', thinkingContent);
                    // 移除思考标签及内容
                    buffer = buffer.substring(lastThinkingIndex + 11).trim();
                }
                
                // 3. 移除 [incipere] (如果有残留)
                buffer = buffer.replace(/\[incipere\]/g, "");
            }

            // 流结束后一次性回调
            onStreamUpdate(buffer);
            return buffer;
        }
    } catch (e) {
        console.error("Call API Error:", e);
        showToast("通话连接不稳定...");
        return null;
    }
}

async function generateCallSummary(chat, callContext) {
    let apiConfig = db.apiSettings;
    
    // 检查是否启用了专属模型
    if (chat.exclusiveApiEnabled && chat.exclusiveApiPreset) {
        const presets = db.apiPresets || [];
        const preset = presets.find(p => p.name === chat.exclusiveApiPreset);
        if (preset && preset.data) {
            apiConfig = {
                ...db.apiSettings,
                url: preset.data.apiUrl || db.apiSettings.url,
                key: preset.data.apiKey || db.apiSettings.key,
                model: preset.data.model || db.apiSettings.model,
                provider: preset.data.provider || db.apiSettings.provider
            };
        }
    }
    apiConfig = resolveAuxiliaryApiConfig('callSummary', apiConfig);

    let {url, key, model, provider} = apiConfig;
    if (!url || !key || !model) return null;
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 获取世界书
    const worldBooksLimitBreak = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'limit_break')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksBefore = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksAfter = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');
    const worldBooksGuidelines = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'guidelines')).filter(Boolean).sort((a, b) => (a.depth || 100) - (b.depth || 100)).map(wb => wb.content).join('\n');

    // 获取回忆日记
    const favoritedJournals = (chat.memoryJournals || [])
        .filter(j => j.isFavorited)
        .map(j => `标题：${j.title}\n内容：${j.content}`)
        .join('\n\n---\n\n');

    let prompt = `请根据以下背景信息和通话记录，生成一段简短的聊天记录总结。\n\n`;

    prompt += `<char_settings>\n`;
    prompt += `角色名：${chat.realName}\n`;
    prompt += `角色设定：${chat.persona || "无"}\n`;
    if (worldBooksLimitBreak) prompt += `${worldBooksLimitBreak}\n`;
    if (worldBooksBefore) prompt += `${worldBooksBefore}\n`;
    if (worldBooksAfter) prompt += `${worldBooksAfter}\n`;
    if (worldBooksGuidelines) prompt += `${worldBooksGuidelines}\n`;
    prompt += `</char_settings>\n\n`;

    prompt += `<user_settings>\n`;
    prompt += `用户称呼：${chat.myName}\n`;
    prompt += `用户人设：${chat.myPersona || "无"}\n`;
    prompt += `</user_settings>\n\n`;

    if (favoritedJournals) {
        prompt += `<memoir>\n`;
        prompt += `【共同回忆】\n${favoritedJournals}\n`;
        prompt += `</memoir>\n\n`;
    }

    prompt += `通话记录：\n`;
    prompt += `${callContext.map(m => `${m.role === 'ai' ? chat.realName : chat.myName} (${m.type}): ${m.content}`).join('\n')}\n\n`;

    prompt += `要求：\n`;
    prompt += `1. 第三人称叙述。\n`;
    prompt += `2. **客观平实**：使用第三人称视角，客观陈述事实。**绝对禁止使用强烈的情绪词汇**（如“极度愤怒”、“痛彻心扉”、“欣喜若狂”等），保持冷静、克制的叙述风格。\n`;
    prompt += `3. **无升华**：不要进行价值升华、感悟或总结性评价，仅记录发生了什么。\n`;
    prompt += `4. 不要包含“通话记录如下”等废话，直接输出总结内容。\n`;

    const messages = [{role: 'user', content: prompt}];
    
    const requestBody = {
        model: model,
        messages: messages,
        stream: false
    };
    
    if (provider === 'gemini') {
         requestBody.contents = [{role: 'user', parts: [{text: prompt}]}];
         delete requestBody.messages;
    }

    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:generateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
    const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        let text = "";
        if (provider === 'gemini') {
            text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
            text = data.choices[0].message.content;
        }
        return text.trim();
    } catch (e) {
        console.error("Summary API Error:", e);
        return null;
    }
}
