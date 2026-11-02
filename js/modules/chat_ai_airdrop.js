// --- 隔空投送 (AirDrop) 生图逻辑 ---
async function receiveAirDropPhoto(messageId, isAuto = false) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    // --- 冷却时间校验 ---
    const settings = db.workshopSettings || {};
    const rateLimit = settings.rateLimit !== undefined ? Number(settings.rateLimit) : 45;
    const lastGenTime = settings.lastGenerationTime || 0;
    const now = Date.now();
    
    if (now - lastGenTime < rateLimit * 1000) {
        const remaining = Math.ceil((rateLimit * 1000 - (now - lastGenTime)) / 1000);
        showToast(`生图冷却中，请等待 ${remaining} 秒`);
        return;
    }
    // -------------------

    const message = chat.history.find(m => m.id === messageId);
    if (!message) return;

    const charName = chat.remarkName || chat.name;

    // 1. 显示 AirDrop 弹窗
    const modal = document.getElementById('airdrop-modal');
    const subtitle = document.getElementById('airdrop-subtitle');
    const actions = document.getElementById('airdrop-actions');
    const loading = document.getElementById('airdrop-loading');
    const loadingText = document.getElementById('airdrop-loading-text');
    const errorDiv = document.getElementById('airdrop-error');
    const errorText = document.getElementById('airdrop-error-text');

    subtitle.textContent = `${charName} 想要共享1张照片`;
    actions.style.display = 'flex';
    loading.style.display = 'none';
    errorDiv.style.display = 'none';
    modal.classList.add('visible');

    // 绑定拒绝按钮
    const rejectBtn = document.getElementById('airdrop-reject-btn');
    rejectBtn.onclick = () => {
        modal.classList.remove('visible');
    };

    // 绑定关闭按钮 (错误时显示)
    const closeBtn = document.getElementById('airdrop-close-btn');
    closeBtn.onclick = () => {
        modal.classList.remove('visible');
    };

    // 绑定头部点击折叠/展开
    const header = document.getElementById('airdrop-header');
    const windowEl = document.getElementById('airdrop-window');
    header.onclick = () => {
        // 只有在接收中状态才允许折叠
        if (loading.style.display === 'block') {
            windowEl.classList.toggle('collapsed');
        }
    };

    // 绑定接受按钮
    const acceptBtn = document.getElementById('airdrop-accept-btn');
    acceptBtn.onclick = async () => {
        actions.style.display = 'none';
        loading.style.display = 'flex';
        errorDiv.style.display = 'none';
        
        // 自动折叠
        windowEl.classList.add('collapsed');

        try {
            // 阶段 1: LLM 扩写
            loadingText.textContent = '正在建立连接';
            const tags = await generateTagsFromDescription(chat, messageId);
            
            if (!tags || tags.trim() === '') {
                throw new Error("LLM 未返回有效的提示词，已取消生图");
            }
            
            // 阶段 2: NovelAI 生图
            loadingText.textContent = '正在接收中';
            const base64Image = await generateImageFromTags(tags, chat);

            // 阶段 3: 保存并展示
            await saveAirDropPhoto(chat.id, base64Image, tags);
            
            // 更新最后生图时间
            if (!db.workshopSettings) db.workshopSettings = {};
            db.workshopSettings.lastGenerationTime = Date.now();
            await saveData();
            
            // 检查是否还在当前聊天室
            if (currentChatId === chat.id && document.getElementById('chat-room-screen').classList.contains('active')) {
                // 自动展开并显示结果
                windowEl.classList.remove('collapsed');
                loading.style.display = 'none';
                
                // 获取刚保存的记录（为了拿到 ID）
                const latestPhotos = await dexieDB.characterPhotos.where('charId').equals(chat.id).reverse().sortBy('timestamp');
                if (latestPhotos.length > 0) {
                    showAirDropPreview(latestPhotos[0], chat);
                }
            } else {
                // 不在当前聊天室，隐藏 modal 并显示 Toast
                modal.classList.remove('visible');
                windowEl.classList.remove('collapsed');
                loading.style.display = 'none';
                showToast(`已收到 ${charName} 的隔空投送照片，已存入TA相册`);
            }

        } catch (error) {
            console.error("AirDrop Error:", error);
            windowEl.classList.remove('collapsed');
            loading.style.display = 'none';
            
            // 检查是否还在当前聊天室
            if (currentChatId === chat.id && document.getElementById('chat-room-screen').classList.contains('active')) {
                errorDiv.style.display = 'block';
                errorText.textContent = `接收失败: ${error.message}`;
            } else {
                // 不在当前聊天室，隐藏 modal 并显示 Toast 报错
                modal.classList.remove('visible');
                showToast(`隔空投送失败: ${error.message}`);
            }
        }
    };

    // 如果是自动触发，直接调用接受按钮的点击事件
    if (isAuto) {
        acceptBtn.onclick();
    }
}

async function generateTagsFromDescription(chat, messageId) {
    const apiConfig = resolveWorkshopLlmApiConfig();

    let {url, key, model, provider} = apiConfig;
    if (!url || !key || !model) {
        throw new Error("未配置聊天 API，无法进行提示词扩写");
    }
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 1. 截取上下文 (当前消息及之前的 29 条)
    const targetIndex = chat.history.findIndex(m => m.id === messageId);
    if (targetIndex === -1) throw new Error("未找到触发消息");
    
    const startIndex = Math.max(0, targetIndex - 29);
    let historySlice = chat.history.slice(startIndex, targetIndex + 1);
    
    // 过滤掉不应进入上下文的消息
    historySlice = historySlice.filter(m => !m.isContextDisabled && !m.isThinking);

    // 2. 格式化上下文文本
    let contextText = "";
    let lastMsgTimeForAI = 0;
    
    historySlice.forEach(msg => {
        const currentMsgTime = msg.timestamp;
        const timeDiff = currentMsgTime - lastMsgTimeForAI;
        const isSameDay = new Date(currentMsgTime).toDateString() === new Date(lastMsgTimeForAI).toDateString();
        
        if (lastMsgTimeForAI === 0 || timeDiff > 20 * 60 * 1000 || !isSameDay) {
            const dateObj = new Date(currentMsgTime);
            const timeStr = `${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
            contextText += `[${timeStr}]\n`;
        }
        lastMsgTimeForAI = currentMsgTime;

        let senderName = msg.role === 'user' ? chat.myName : chat.realName;
        if (chat.type === 'group' && msg.senderId) {
            if (msg.senderId === 'user_me') {
                senderName = chat.me.nickname;
            } else {
                const sender = chat.members.find(m => m.id === msg.senderId);
                if (sender) senderName = sender.realName || sender.groupNickname;
            }
        }

        let content = msg.content;
        if (msg.parts && msg.parts.length > 0) {
            content = msg.parts.map(p => p.text || '[图片]').join('');
        }
        
        // 简单清理系统标签
        content = content.replace(/^\[system:.*?\]\s*/, '').replace(/^\(时间:.*?\)\s*/, '');
        
        contextText += `${senderName}: ${content}\n`;
    });

    // 3. 确定当前主要角色
    let currentMainCharacter = chat.realName; // 默认
    const targetMessage = chat.history.find(m => m.id === messageId);
    if (targetMessage) {
        if (targetMessage.role === 'user') {
            currentMainCharacter = chat.myName;
            if (chat.type === 'group' && targetMessage.senderId === 'user_me') {
                currentMainCharacter = chat.me.nickname;
            }
        } else {
            if (chat.type === 'group' && targetMessage.senderId) {
                const sender = chat.members.find(m => m.id === targetMessage.senderId);
                if (sender) currentMainCharacter = sender.realName || sender.groupNickname;
            }
        }
    }

    // 4. 构建 Messages
    let messages = [];
    
    // 根据生图 provider 选择预设组
    let presetGroups = [];
    let activeGroupId = null;
    const imageProvider = db.workshopSettings?.provider || 'novelai';
    
    if (imageProvider === 'gpt') {
        presetGroups = db.workshopSettings?.gptLlmPresetGroups || [];
        activeGroupId = db.workshopSettings?.activeGptLlmPresetGroupId;
    } else {
        presetGroups = db.workshopSettings?.llmPresetGroups || [];
        activeGroupId = db.workshopSettings?.activeLlmPresetGroupId;
    }
    
    if (presetGroups.length > 0 && activeGroupId) {
        const activeGroup = presetGroups.find(g => g.id === activeGroupId);
        if (activeGroup && activeGroup.prompts) {
            // 准备标签列表字符串 (仅 GPT 模式可能用到)
            let tagsListStr = '';
            if (imageProvider === 'gpt' && db.workshopSettings?.gptTags) {
                tagsListStr = db.workshopSettings.gptTags.filter(t => t.enabled !== false).map(t => t.name).join(', ');
            }

            activeGroup.prompts.filter(p => p.enabled).forEach(p => {
                let content = p.content;
                content = content.replace(/\{\{context\}\}/g, contextText);
                content = content.replace(/\{\{角色设定\}\}/g, chat.persona || '无');
                content = content.replace(/\{\{当前主要角色\}\}/g, currentMainCharacter);
                content = content.replace(/\{\{角色真名\}\}/g, chat.realName);
                
                // 替换标签列表
                if (content.includes('{{标签列表}}')) {
                    content = content.replace(/\{\{标签列表\}\}/g, tagsListStr || '无可用标签');
                }
                
                // 合并相邻的同 role 条目
                if (messages.length > 0 && messages[messages.length - 1].role === p.role) {
                    messages[messages.length - 1].content += '\n\n' + content;
                } else {
                    messages.push({ role: p.role, content: content });
                }
            });
        }
    }
    
    // 兜底：如果没有配置预设，使用默认的
    if (messages.length === 0) {
        messages = [
            {role: 'system', content: '你是一个专业的AI绘画提示词（Prompt）生成专家，精通 Danbooru 标签语法。\n你的任务是将用户输入的【画面描述】翻译并扩写为高质量的英文提示词标签，用于 NovelAI 图像生成。\n\n【扩写与输出规则】\n1. 格式限制：仅输出英文标签，全部小写，用英文逗号和空格分隔。绝对不要输出任何中文、解释性文字、前言后语或多余的标点。\n2. 结构顺序：按照“主体特征, 服装, 动作/姿势, 表情, 背景环境, 光影/视角”的顺序排列。\n3. 细节脑补：如果用户的描述较简略，请根据语境合理脑补细节（例如：补充 cinematic lighting, detailed background, depth of field 等增强画质的词汇）。\n4. 视角与构图：根据描述自动推断合适的构图词（如 selfie, cowboy shot, looking at viewer, from above 等）。\n5. 风格词：自动在末尾加上 masterpiece, best quality, highly detailed, ultra-detailed。'},
            {role: 'user', content: `<参考资料>\n${contextText}\n</参考资料>\n请根据参考资料中最后一条消息的画面描述，结合前文语境，生成英文提示词标签。直接输出转换后的英文标签。`}
        ];
    }

    console.log('【生图 LLM 预设请求参数】:\n' + messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n------------------------\n\n'));

    const requestBody = {
        model: model,
        messages: messages,
        stream: false,
        temperature: apiConfig.temperatureEnabled !== false && Number.isFinite(Number(apiConfig.temperature))
            ? Number(apiConfig.temperature)
            : 0.7
    };

    if (provider === 'gemini') {
        requestBody.contents = [{role: 'user', parts: [{text: `<参考资料>\n${contextText}\n</参考资料>\n请根据参考资料中最后一条消息的画面描述，结合前文语境，生成英文提示词标签。直接输出转换后的英文标签。`}]}];
        requestBody.system_instruction = {parts: [{text: messages[0].content}]}; // Fix: use messages[0].content instead of undefined systemPrompt
        delete requestBody.messages;
    }

    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:generateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
    const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        throw new Error(`LLM API 请求失败 (${response.status})`);
    }

    const data = await response.json();
    let text = "";
    if (provider === 'gemini') {
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
        text = data.choices[0].message.content;
    }
    
    console.log('【生图 LLM 原始返回内容】:', text);
    
    // 尝试提取 <image> 标签内的内容
    const imageTagMatch = text.match(/<image>([\s\S]*?)<\/image>/i);
    if (imageTagMatch && imageTagMatch[1]) {
        text = imageTagMatch[1];
    }
    
    // 清理可能包含的 markdown 代码块标记
    text = text.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();
    return text;
}

async function generateImageFromTags(llmTags, chat) {
    const settings = db.workshopSettings;
    if (!settings) {
        throw new Error("未配置绘图工坊 API，请先在工坊中完成设置");
    }
    
    if (typeof window.executeImageGeneration !== 'function') {
        throw new Error("未找到统一生图函数 window.executeImageGeneration");
    }

    // 优先使用角色专属绘图预设 (仅在 NovelAI 模式下生效)
    let finalSettings = { ...settings };
    const provider = settings.provider || 'novelai';
    if (provider === 'novelai' && chat.exclusiveWorkshopPromptPreset) {
        const preset = (db.workshopPromptPresets || []).find(p => p.id === chat.exclusiveWorkshopPromptPreset);
        if (preset) {
            finalSettings.positivePrompt = preset.positive || '';
            finalSettings.characterPrompt = preset.character || '';
            finalSettings.negativePrompt = preset.negative || '';
        }
    }

    const { imageData } = await window.executeImageGeneration(finalSettings, llmTags);
    return imageData;
}

async function saveAirDropPhoto(charId, base64Image, prompt = '') {
    if (!dexieDB) return;
    const photoItem = {
        charId: charId,
        timestamp: Date.now(),
        image: base64Image,
        prompt: prompt
    };
    await dexieDB.characterPhotos.add(photoItem);
}

// 统一的 AirDrop 预览窗口逻辑
function showAirDropPreview(photoItem, chat) {
    const modal = document.getElementById('airdrop-modal');
    const subtitle = document.getElementById('airdrop-subtitle');
    const actions = document.getElementById('airdrop-actions');
    const loading = document.getElementById('airdrop-loading');
    const errorDiv = document.getElementById('airdrop-error');
    const resultArea = document.getElementById('airdrop-result-area');
    const previewImg = document.getElementById('airdrop-preview-img');
    const windowEl = document.getElementById('airdrop-window');

    const charName = chat.remarkName || chat.name;
    subtitle.textContent = `${charName} 的隔空投送记录`;
    
    actions.style.display = 'none';
    loading.style.display = 'none';
    errorDiv.style.display = 'none';
    windowEl.classList.remove('collapsed');
    
    const src = `data:image/png;base64,${photoItem.image}`;
    previewImg.src = src;
    resultArea.style.display = 'flex';
    modal.classList.add('visible');

    // 绑定预览图点击事件，打开全屏查看器
    const previewContainer = document.getElementById('airdrop-preview-container');
    previewContainer.onclick = () => {
        const fullModal = document.getElementById('full-image-modal');
        const fullImg = document.getElementById('full-image-view');
        fullImg.src = src;
        fullModal.classList.add('visible');
        
        const fullModalCloseBtn = document.getElementById('close-full-image-btn');
        if (fullModalCloseBtn) {
            fullModalCloseBtn.onclick = () => {
                fullModal.classList.remove('visible');
            };
        }
    };

    // 绑定保存按钮
    const saveBtn = document.getElementById('airdrop-save-btn');
    saveBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = src;
        a.download = `airdrop_${photoItem.timestamp}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('已保存到本地');
    };

    // 绑定重新生成按钮
    const regenerateBtn = document.getElementById('airdrop-regenerate-btn');
    regenerateBtn.onclick = async () => {
        resultArea.style.display = 'none';
        loading.style.display = 'flex';
        windowEl.classList.add('collapsed');
        const loadingText = document.getElementById('airdrop-loading-text');
        
        try {
            loadingText.textContent = '正在重新生成';
            const currentPrompt = photoItem.prompt || '';
            if (!currentPrompt) throw new Error("缺少提示词，无法重新生成");
            
            const base64Image = await generateImageFromTags(currentPrompt, chat);
            await saveAirDropPhoto(chat.id, base64Image, currentPrompt);
            
            const latestPhotos = await dexieDB.characterPhotos.where('charId').equals(chat.id).reverse().sortBy('timestamp');
            if (latestPhotos.length > 0) {
                showAirDropPreview(latestPhotos[0], chat);
            }
        } catch (error) {
            console.error("Regenerate Error:", error);
            windowEl.classList.remove('collapsed');
            loading.style.display = 'none';
            errorDiv.style.display = 'block';
            document.getElementById('airdrop-error-text').textContent = `生成失败: ${error.message}`;
        }
    };

    // 绑定详情按钮
    const detailsBtn = document.getElementById('airdrop-details-btn');
    detailsBtn.onclick = () => {
        const detailsModal = document.getElementById('airdrop-details-modal');
        const textarea = document.getElementById('airdrop-prompt-textarea');
        textarea.value = photoItem.prompt || '';
        detailsModal.classList.add('visible');

        document.getElementById('airdrop-prompt-close-btn').onclick = () => {
            detailsModal.classList.remove('visible');
        };

        document.getElementById('airdrop-prompt-save-btn').onclick = async () => {
            const newPrompt = textarea.value.trim();
            photoItem.prompt = newPrompt;
            await dexieDB.characterPhotos.put(photoItem);
            detailsModal.classList.remove('visible');
            showToast('提示词已保存');
        };
    };

    // 绑定相册按钮
    const galleryBtn = document.getElementById('airdrop-gallery-btn');
    galleryBtn.onclick = () => {
        modal.classList.remove('visible');
        resultArea.style.display = 'none';
        openAirDropHistory(chat.id);
    };

    // 绑定结果关闭按钮
    const resultCloseBtn = document.getElementById('airdrop-result-close-btn');
    resultCloseBtn.onclick = () => {
        modal.classList.remove('visible');
        resultArea.style.display = 'none';
    };
}

async function openAirDropHistory(charId) {
    const modal = document.getElementById('airdrop-history-modal');
    const grid = document.getElementById('airdrop-history-grid');
    const closeBtn = document.getElementById('airdrop-history-close-btn');

    closeBtn.onclick = () => modal.classList.remove('visible');

    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #999;">加载中...</div>';
    modal.classList.add('visible');

    if (!dexieDB) return;

    try {
        const photos = await dexieDB.characterPhotos.where('charId').equals(charId).reverse().sortBy('timestamp');
        
        grid.innerHTML = '';
        if (photos.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #999;">相册空空如也</div>';
            return;
        }

        photos.forEach(photo => {
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.style.aspectRatio = '1';
            wrapper.style.borderRadius = '8px';
            wrapper.style.overflow = 'hidden';
            wrapper.style.backgroundColor = '#eee';

            const src = `data:image/png;base64,${photo.image}`;
            
            const img = document.createElement('div');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.backgroundImage = `url(${src})`;
            img.style.backgroundSize = 'cover';
            img.style.backgroundPosition = 'center';
            img.style.cursor = 'pointer';
            img.onclick = () => {
                modal.classList.remove('visible');
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === charId) : db.groups.find(g => g.id === charId);
                if (chat) {
                    showAirDropPreview(photo, chat);
                }
            };

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            delBtn.style.position = 'absolute';
            delBtn.style.top = '4px';
            delBtn.style.right = '4px';
            delBtn.style.background = 'rgba(0,0,0,0.5)';
            delBtn.style.border = 'none';
            delBtn.style.borderRadius = '50%';
            delBtn.style.width = '24px';
            delBtn.style.height = '24px';
            delBtn.style.display = 'flex';
            delBtn.style.alignItems = 'center';
            delBtn.style.justifyContent = 'center';
            delBtn.style.cursor = 'pointer';
            
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm('确定要删除这张照片吗？')) {
                    await dexieDB.characterPhotos.delete(photo.id);
                    wrapper.remove();
                    if (grid.children.length === 0) {
                        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #999;">相册空空如也</div>';
                    }
                }
            };

            wrapper.appendChild(img);
            wrapper.appendChild(delBtn);
            grid.appendChild(wrapper);
        });

    } catch (error) {
        console.error("Load AirDrop History Error:", error);
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #ff4d4f;">加载失败</div>';
    }
}
