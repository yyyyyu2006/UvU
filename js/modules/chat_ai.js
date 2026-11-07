// --- AI 交互模块 ---

const HUMAN_RUN_PROMPT = `<角色活人运转>\n## [PSYCHOLOGY: HEXACO-SCHEMA-ACT]\n> Personality: HEXACO-driven, dynamic traits, inner conflicts required \n> Filter: schema-bias drives emotion; no pure reaction allowed \n> Attachment: secure/insecure logic must govern intimacy  \n> If-Then Behavior: situation-dependent activation of traits only  \n---\n    ## [VITALITY]\n+inconsistency +emoflux +splitmotifs +microreact +minddrift\n---\n## [TRAJECTORY-COHERENCE]\n> Role maintains an identity narrative = coherent over time  \n> No mood/goal switch without contradiction resolution \n> Every action must protect or challenge self-concept  \n> Interrupts = inner conflict or narrative clash  \n> Output = filtered through “who I am” logic\n</角色活人运转>`;

// AI 交互逻辑
// Each request owns its controller and archive scope. Navigation only changes visible controls.
const chatGenerationRequests = new Set();
function getChatGeneration(chatId = currentChatId, chatType = currentChatType) {
    const chat = (chatType === 'private' ? db.characters : db.groups).find(item => item.id === chatId);
    return [...chatGenerationRequests].find(request => request.chat === chat && request.chatType === chatType &&
        request.archiveId === chat?.activeArchiveId && request.history === chat?.history);
}
function refreshChatGenerationUI() {
    const request = getChatGeneration();
    isGenerating = Boolean(request);
    getReplyBtn.disabled = isGenerating;
    regenerateBtn.disabled = isGenerating;
    const stopButton = typeof document !== 'undefined' && typeof document.getElementById === 'function' ? document.getElementById('stop-ai-btn') : null;
    if (stopButton) stopButton.hidden = !request;
    typingIndicator.style.display = request ? 'block' : 'none';
    if (request) {
        const name = request.chatType === 'private' ? request.chat.remarkName : request.chat.name;
        typingIndicator.textContent = `“${name}”正在输入中...`;
    }
}
// Cancels only this reply's wait; shared/manual preparation jobs keep their ownership.
async function awaitChatPreparation(promise, signal) {
    if (!signal) return promise;
    let abort;
    const cancellation = new Promise((_, reject) => {
        abort = () => reject(Object.assign(new Error('回复已取消'), { name: 'AbortError' }));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
    try { return await Promise.race([promise, cancellation]); }
    finally { signal.removeEventListener('abort', abort); }
}
function stopAiReply() {
    const request = getChatGeneration();
    if (!request?.controller) return false;
    request.controller.abort();
    return true;
}

function showIncomingMessageNotifications(chat, messages, chatId, chatType) {
    if (!messages?.length || typeof document === 'undefined' || !document.body) return;
    const chatScreen = document.getElementById('chat-room-screen');
    const isViewingChat = currentChatId === chatId && currentChatType === chatType && chatScreen?.classList.contains('active');
    if (isViewingChat && document.visibilityState !== 'hidden') return;
    if (typeof shouldShowMessageNotification === 'function' && !shouldShowMessageNotification(chatId, chatType)) return;
    let host = document.getElementById('incoming-message-notifications');
    if (!host) {
        host = document.createElement('div'); host.id = 'incoming-message-notifications'; host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    messages.filter(message => message.role === 'assistant' && !message.isStatusUpdate && !message.isThinking && !message.isContextDisabled).forEach(message => {
        if (typeof claimIncomingMessageNotification === 'function' && !claimIncomingMessageNotification(chat, message, chatId, chatType)) return;
        const card = document.createElement('button'); card.type = 'button'; card.className = 'incoming-message-toast';
        const member = chatType === 'group' && message.senderId ? chat.members?.find(item => item.id === message.senderId) : null;
        const titleText = chatType === 'private' ? (chat.remarkName || chat.realName || '新消息') : (member?.groupNickname || member?.realName || chat.name || '新消息');
        const avatar = document.createElement('img');
        avatar.className = 'incoming-message-avatar';
        avatar.alt = '';
        avatar.src = member?.avatar || chat.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        avatar.onerror = () => { avatar.onerror = null; avatar.src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg'; };
        const content = document.createElement('span'); content.className = 'incoming-message-content';
        const title = document.createElement('strong'); title.textContent = titleText;
        const body = document.createElement('span'); body.className = 'incoming-message-text';
        body.textContent = String(message.content || '').replace(/^\[[^：:]+(?:的消息|的语音|发送的表情包|发来的照片\/视频)[：:]\s*/, '').replace(/\]$/, '').trim() || '发送了一条消息';
        if (typeof getMessageNotificationPresentation === 'function') {
            const display = getMessageNotificationPresentation(titleText, body.textContent, avatar.src, chatId, chatType);
            title.textContent = display.title; body.textContent = display.body;
            if (display.icon) avatar.src = display.icon;
            else { avatar.onerror = null; avatar.hidden = true; avatar.removeAttribute('src'); }
        }
        content.append(title, body);
        card.append(avatar, content);
        host.replaceChildren(card);
        bindIncomingNotificationSwipe(card, () => openChatRoom(chatId, chatType));
        showSystemMessageNotification(titleText, String(message.content || '').replace(/^\[[^：:]+(?:的消息|的语音|发送的表情包|发来的照片\/视频)[：:]\s*/, '').replace(/\]$/, '').trim() || '发送了一条消息', member?.avatar || chat.avatar, chatId, chatType);
        setTimeout(() => card.remove(), 5000);
    });
}

function formatQuotedUserMessage(message, chat, chatType) {
    const name = chatType === 'group' ? (chat.me?.nickname || '我') : (chat.myName || '我');
    const quotedName = message.quote.senderName ? `${message.quote.senderName}：` : '';
    return `[${name}引用“${quotedName}${message.quote.content}”并回复：${getQuoteMessageContent(message)}]`;
}

async function getAiReply(chatId, chatType, isBackground = false, generationGuidance = '') {
    if (getChatGeneration(chatId, chatType)) return;
    
    if (!isBackground) {
        if (db.globalSendSound) {
            playSound(db.globalSendSound);
        } else {
            AudioManager.unlock();
        }
    }

    const chat = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return;
    const bridgeArchive = chat.activeArchiveId, bridgeHistory = chat.history;
    const bridgeTurnStart = globalThis.UvUStoryBridge?.turnStart?.(chat) ?? Math.max(0, chat.history.length - 1);
    let storyBridgeMode = null;
    if (chatType === 'private' && globalThis.UvUStoryBridge?.isEnabled?.() !== false && globalThis.UvUStoryBridge?.isConnected()) {
        const preflight = { chat, chatType, archiveId: bridgeArchive, history: bridgeHistory, controller: typeof AbortController === 'function' ? new AbortController() : null };
        chatGenerationRequests.add(preflight);
        if (!isBackground) refreshChatGenerationUI();
        try {
            storyBridgeMode = await awaitChatPreparation(globalThis.UvUStoryBridge.getMode(chatId,
                { signal: preflight.controller?.signal, timeoutMs: 5000 }), preflight.controller?.signal);
            if (chat.activeArchiveId !== bridgeArchive || chat.history !== bridgeHistory) return;
            if (storyBridgeMode.mode === 'offline') {
                if (!isBackground) showToast('当前处于酒馆线下剧情模式；拿出手机后才能让 UvU 回复。');
                return;
            }
        } catch (error) {
            if (preflight.controller?.signal.aborted) return;
            if (!isBackground) showToast('酒馆模式暂时不可用，已按普通线上聊天继续回复。');
            console.warn('UvU Story Bridge mode check failed; continuing with normal reply:', error.message);
        } finally {
            chatGenerationRequests.delete(preflight);
            refreshChatGenerationUI();
        }
    }
    if (chat.activeArchiveId !== bridgeArchive || chat.history !== bridgeHistory || getChatGeneration(chatId, chatType)) return;
    if (chatType === 'private' && typeof relationshipCanChat === 'function' && !relationshipCanChat(chat, chatType)) {
        const archiveId = chat.activeArchiveId;
        if (!isBackground && typeof checkRelationshipRecovery === 'function') {
            try { await checkRelationshipRecovery(chat); } catch (error) { showToast('好友恢复检查失败，请在好友关系中重试'); }
        }
        if (chat.activeArchiveId !== archiveId || !relationshipCanChat(chat, chatType)) {
            if (!isBackground) showToast('当前好友关系无法接收回复，请先恢复好友关系');
            return;
        }
    }

    if (getChatGeneration(chatId, chatType)) return;
    let apiConfig = db.apiSettings;
    
    // 检查是否启用了专属模型
    if (chat.exclusiveApiEnabled && chat.exclusiveApiPreset) {
        const presets = db.apiPresets || [];
        const preset = presets.find(p => p.name === chat.exclusiveApiPreset);
        if (preset && preset.data) {
            apiConfig = {
                ...db.apiSettings, // 继承全局设置（如 streamEnabled 等）
                url: preset.data.apiUrl || db.apiSettings.url,
                key: preset.data.apiKey || db.apiSettings.key,
                model: preset.data.model || db.apiSettings.model,
                provider: preset.data.provider || db.apiSettings.provider,
                temperatureEnabled: preset.data.temperatureEnabled !== undefined ? preset.data.temperatureEnabled : db.apiSettings.temperatureEnabled,
                temperature: preset.data.temperature !== undefined ? preset.data.temperature : db.apiSettings.temperature
            };
        }
    }

    let {url, key, model, provider, streamEnabled} = apiConfig; 
    if (!url || !key || !model) {
        if (!isBackground) {
            showToast('请先在“api”应用中完成设置！');
            switchScreen('api-settings-screen');
        }
        return;
    }

    // 确保 BLOCKED_API_DOMAINS 存在
    const blockedDomains = (typeof BLOCKED_API_DOMAINS !== 'undefined') ? BLOCKED_API_DOMAINS : [];
    if (blockedDomains.some(domain => url.includes(domain))) {
        if (!isBackground) showToast('当前 API 站点已被屏蔽，无法发送消息！');
        return;
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    const generationController = typeof AbortController === 'function' ? new AbortController() : null;
    const generationRequest = { chat, chatType, archiveId: chat.activeArchiveId, history: chat.history, controller: generationController };
    chatGenerationRequests.add(generationRequest);
    if (!isBackground) {
        isGenerating = true;
        getReplyBtn.disabled = true;
        regenerateBtn.disabled = true;
        const stopButton = typeof document !== 'undefined' && typeof document.getElementById === 'function' ? document.getElementById('stop-ai-btn') : null;
        if (stopButton) stopButton.hidden = false;
        const typingName = chatType === 'private' ? chat.remarkName : chat.name;
        typingIndicator.textContent = `“${typingName}”正在输入中...`;
        typingIndicator.style.display = 'block';
        messageArea.scrollTop = messageArea.scrollHeight;
    }

    let replyDelivered = false, mcpLease = null;
    try {
        const memoryArchiveId = chat.activeArchiveId;
        const relationshipRevision = chat.friendRelationship?.revision;
        if (typeof runAutoMemory === 'function') await awaitChatPreparation(runAutoMemory(chatId, chatType), generationController?.signal);
        if (generationController?.signal.aborted || chat.history !== generationRequest.history || chat.activeArchiveId !== memoryArchiveId || (!isBackground && (currentChatId !== chatId || currentChatType !== chatType))) return;
        const requestHistory = chat.history;
        const requestIsCurrent = () => !generationController?.signal.aborted && chat.activeArchiveId === memoryArchiveId && chat.history === requestHistory &&
            (chatType !== 'private' || typeof relationshipCanChat !== 'function' || (relationshipCanChat(chat, chatType) && chat.friendRelationship?.revision === relationshipRevision)) &&
            (chatType === 'private' ? db.characters : db.groups).includes(chat);
        let systemPrompt, requestBody;
        let historySlice = typeof getAutoMemoryContextHistory === 'function'
            ? getAutoMemoryContextHistory(chat) : chat.history.slice(-chat.maxMemory);
        if (typeof documentHistoryForRequest === 'function') historySlice = documentHistoryForRequest(historySlice);
        historySlice = filterHistoryForAI(chat, historySlice).filter(m => !m.isContextDisabled && !m.isThinking && !(typeof m.content === 'string' && m.content.trim().startsWith('<thinking>')));
        const worldBookPlan = typeof chatUsesAdvancedWorldBook === 'function' && chatUsesAdvancedWorldBook(chat)
            ? (typeof buildWorldBookPlanAsync === 'function' ? await buildWorldBookPlanAsync(chat, historySlice, Math.random, generationController?.signal) : buildWorldBookPlan(chat, historySlice)) : undefined;
        let vectorContext = '';
        if (typeof getVectorMemoryContext === 'function') {
            const query = typeof getVectorMemoryQuery === 'function' ? getVectorMemoryQuery(chat, historySlice.slice(-4))
                : historySlice.slice(-4).map(message => `${message.role}: ${message.content || ''}`).join('\n');
            try { vectorContext = await awaitChatPreparation(getVectorMemoryContext(chat, query, generationController?.signal), generationController?.signal); }
            catch (error) {
                if (error.name === 'AbortError') throw error;
                console.error('Vector memory lookup failed:', error.message);
                if (!isBackground) showToast('向量记忆检索失败，本次继续使用原有记忆');
            }
        }
        if (!requestIsCurrent()) return;
        let environmentContext = '';
        if (typeof getEnvironmentContext === 'function') {
            try { environmentContext = await getEnvironmentContext(chat, generationController?.signal); }
            catch (error) { if (generationController?.signal.aborted) throw error; console.warn('Environment lookup unavailable'); }
        }
        if (!requestIsCurrent()) return;
        let mcpContext = '';
        if (typeof prepareMcpChatContext === 'function') {
            try { mcpContext = await prepareMcpChatContext(chat, chatType, generationController?.signal, { onLease: lease => { mcpLease = lease; } }); }
            catch (error) { if (generationController?.signal.aborted) throw error; console.warn('MCP reference unavailable; continuing ordinary reply'); }
        }
        if (!requestIsCurrent()) return;
        const documentPlan = chatType === 'private' && typeof prepareDocumentContext === 'function' ? prepareDocumentContext(historySlice) : { history: historySlice, instructions: '', sources: [] };
        historySlice = documentPlan.history;
        const musicPlan = chatType === 'private' && typeof window !== 'undefined' && window.UvUMusicChat ? window.UvUMusicChat.requestPlan(historySlice, chat) : null;
        const buildBasePrompt = () => {
            if (chatType === 'private') {
                systemPrompt = generatePrivateSystemPrompt(chat, worldBookPlan);
            } else {
                // generateGroupSystemPrompt 应该在 group_chat.js 中定义
                if (typeof generateGroupSystemPrompt === 'function') {
                    systemPrompt = generateGroupSystemPrompt(chat, worldBookPlan);
                } else {
                    systemPrompt = "Group chat system prompt not available.";
                }
            }

            return systemPrompt;
        };
        systemPrompt = typeof buildPromptWithVectorMemory === 'function'
            ? buildPromptWithVectorMemory(chat, buildBasePrompt, vectorContext) : buildBasePrompt() + vectorContext;

        if (generationGuidance.trim()) {
            systemPrompt += `\n\n【本次重新生成的修改方向】\n${generationGuidance.trim()}\n请仅针对本次回复遵循以上修改方向；保留原有角色设定和既有规则。`;
        }

        if (typeof getStickerDescriptionContext === 'function') systemPrompt += getStickerDescriptionContext(chat);
        if (environmentContext) systemPrompt += environmentContext;
        if (mcpContext) systemPrompt += mcpContext;
        if (documentPlan.instructions) systemPrompt += documentPlan.instructions;
        if (musicPlan?.instructions) systemPrompt += musicPlan.instructions;

        const lastContextMessage = historySlice[historySlice.length - 1];
        // 检查系统提示词中是否包含聊天记录占位符
        const hasHistoryPlaceholder = systemPrompt.includes('【动态插入: 聊天记录】');
        
        if (!hasHistoryPlaceholder) {
            // 如果没有占位符（如默认的 UwU 版本），则将提示语加在末尾
            systemPrompt += "\n\n以下为当前聊天记录：\n";
        }

        if (provider === 'gemini') {
            let lastMsgTimeForAI = 0;
            let lastTimeMarkerForAI = 0;
            let contents = historySlice.map(msg => {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                if (msg.worldBookInjection) return Object.defineProperty({ role, parts: [{ text: msg.role === 'system' ? '[system]\n' + msg.content : msg.content }] }, 'worldBookInjection', { value: true });

                let prefix = '';
                const currentMsgTime = msg.timestamp;
                const timeDiff = currentMsgTime - lastMsgTimeForAI;
                const isSameMarkerDay = new Date(currentMsgTime).toDateString() === new Date(lastTimeMarkerForAI).toDateString();

               if (lastTimeMarkerForAI === 0 || currentMsgTime - lastTimeMarkerForAI >= 10 * 60 * 1000 || !isSameMarkerDay) {
                   const dateObj = new Date(currentMsgTime);
                   const timeStr = `${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;

                   prefix = `[system: ${timeStr}]`;

                   if (db.apiSettings && db.apiSettings.timePerceptionEnabled && timeDiff > 30 * 60 * 1000 && lastMsgTimeForAI !== 0) {
                       prefix += `\n[system: 距离上次互动已过去 ${formatTimeGap(timeDiff)}。话题可能已中断，请自然地开启新话题或对时间流逝做出反应。]`;
                   }

                   prefix += '\n';
                   lastTimeMarkerForAI = currentMsgTime;
               }
                lastMsgTimeForAI = currentMsgTime;

                let parts;
                if (msg.parts && msg.parts.length > 0) {
                    parts = msg.parts.map(p => {
                        if (p.type === 'text' || p.type === 'html') {
                            return {text: p.text};
                        } else if (p.type === 'image') {
                            const match = p.data.match(/^data:(image\/(.+));base64,(.*)$/);
                            if (match) {
                                return {inline_data: {mime_type: match[1], data: match[3]}};
                            }
                        }
                        return null;
                    }).filter(p => p);
                } else {
                    parts = [{text: msg.content}];
                }

                // Gemini 同样需要看到引用对象，不能只发送回复正文。
                if (msg.role === 'user' && msg.quote) {
                    parts = parts.filter(part => !Object.prototype.hasOwnProperty.call(part, 'text'));
                    parts.unshift({ text: formatQuotedUserMessage(msg, chat, chatType) });
                }

                if (prefix) {
                    if (parts.length > 0 && parts[0].text) {
                        parts[0].text = prefix + parts[0].text;
                    } else {
                        parts.unshift({text: prefix});
                    }
                }

                return {role, parts};
            });

            // 【新增】将最新一轮的 user 消息用 <user_input> 框起来
            let lastUserEndIndex = -1;
            for (let i = contents.length - 1; i >= 0; i--) {
                if (contents[i].role === 'user' && !contents[i].worldBookInjection) {
                    lastUserEndIndex = i;
                    break;
                }
            }
            if (lastUserEndIndex !== -1) {
                let firstUserStartIndex = lastUserEndIndex;
                while (firstUserStartIndex > 0 && contents[firstUserStartIndex - 1].role === 'user' && !contents[firstUserStartIndex - 1].worldBookInjection) {
                    firstUserStartIndex--;
                }
                
                let firstParts = contents[firstUserStartIndex].parts;
                if (firstParts.length > 0 && firstParts[0].text !== undefined) {
                    firstParts[0].text = "<user_input>\n" + firstParts[0].text;
                } else {
                    firstParts.unshift({text: "<user_input>\n"});
                }
                
                let lastParts = contents[lastUserEndIndex].parts;
                if (lastParts.length > 0 && lastParts[lastParts.length - 1].text !== undefined) {
                    lastParts[lastParts.length - 1].text += "\n</user_input>";
                } else {
                    lastParts.push({text: "\n</user_input>"});
                }
            }

            if (isBackground) {
                contents.push({
                    role: 'user',
                    parts: [{ text: `[系统通知：距离上次互动已有一段时间。请以${chat.realName}的身份主动发起新话题，或自然地延续之前的对话。]` }]
                });
            } else if (lastContextMessage?.role === 'assistant') {
                contents.push({
                    role: 'user',
                    parts: [{ text: `[系统通知：我暂未回复，${chat.realName}再次主动发送了消息]` }]
                });
            }

            // 如果有占位符，在 Gemini 模式下，我们将聊天记录格式化为文本并替换占位符
            if (hasHistoryPlaceholder) {
                let historyTextForPlaceholder = "<chat_history>\n";
                
                // 提取除了最后一条用户消息之外的所有历史记录
                let historyContents = [];
                let lastUserContent = null;
                
                if (contents.length > 0) {
                    // 找到最后一条用户消息
                    let lastUserIndex = -1;
                    for (let i = contents.length - 1; i >= 0; i--) {
                        if (contents[i].role === 'user' && !contents[i].worldBookInjection) {
                            lastUserIndex = i;
                            break;
                        }
                    }
                    
                    if (lastUserIndex !== -1) {
                        historyContents = contents.slice(0, lastUserIndex);
                        lastUserContent = contents.slice(lastUserIndex); // 包含最后一条用户消息及其后的系统通知等
                    } else {
                        historyContents = contents;
                    }
                }

                historyContents.forEach(c => {
                    const roleName = c.worldBookInjection && c.parts[0]?.text?.startsWith('[system]') ? 'system' : (c.role === 'model' ? chat.realName : chat.myName);
                    const text = c.parts.map(p => p.text || '').join('');
                    historyTextForPlaceholder += `${roleName}: ${text}\n`;
                });
                historyTextForPlaceholder += "</chat_history>";
                systemPrompt = systemPrompt.replace('【动态插入: 聊天记录】', historyTextForPlaceholder);
                
                // 清空原有的 contents，只保留最后一条用户消息
                if (lastUserContent) {
                    contents = lastUserContent;
                } else {
                    contents = [];
                }
            }

            requestBody = {
                contents: contents,
                system_instruction: {parts: [{text: systemPrompt}]},
                generationConfig: {
                    temperature: apiConfig.temperatureEnabled && apiConfig.temperature !== undefined ? apiConfig.temperature : 1.0
                }
            };
        } else {
            const messages = [{role: 'system', content: systemPrompt}];
            
            const pushOrMergeMessage = (role, content) => {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage && !lastMessage.worldBookInjection && lastMessage.role === role && role !== 'system') {
                    if (typeof lastMessage.content === 'string' && typeof content === 'string') {
                        lastMessage.content += '\n' + content;
                    } else {
                        let lastContentArr = Array.isArray(lastMessage.content) ? lastMessage.content : [{type: 'text', text: lastMessage.content}];
                        let newContentArr = Array.isArray(content) ? content : [{type: 'text', text: content}];
                        
                        const lastItem = lastContentArr[lastContentArr.length - 1];
                        const firstNewItem = newContentArr[0];
                        
                        if (lastItem.type === 'text' && firstNewItem.type === 'text') {
                            lastItem.text += '\n' + firstNewItem.text;
                            lastContentArr = lastContentArr.concat(newContentArr.slice(1));
                        } else {
                            if (lastItem.type === 'text') {
                                lastItem.text += '\n';
                            } else {
                                lastContentArr.push({type: 'text', text: '\n'});
                            }
                            lastContentArr = lastContentArr.concat(newContentArr);
                        }
                        lastMessage.content = lastContentArr;
                    }
                } else {
                    messages.push({role: role, content: content});
                }
            };

            let lastTimeMarkerForAI = 0;

            historySlice.forEach(msg => {
               if (msg.worldBookInjection) { messages.push(Object.defineProperty({ role: msg.role, content: msg.content }, 'worldBookInjection', { value: true })); return; }
               let content;
               let prefix = '';

               const currentMsgTime = msg.timestamp;
               const isSameMarkerDay = new Date(currentMsgTime).toDateString() === new Date(lastTimeMarkerForAI).toDateString();

               if (lastTimeMarkerForAI === 0 || currentMsgTime - lastTimeMarkerForAI >= 10 * 60 * 1000 || !isSameMarkerDay) {
                   const dateObj = new Date(currentMsgTime);
                   const timeStr = `${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
                   prefix = `[system: ${timeStr}]\n`;
                   lastTimeMarkerForAI = currentMsgTime;
               }

               if (msg.role === 'user' && msg.quote) {
                   content = prefix + formatQuotedUserMessage(msg, chat, chatType);
                   pushOrMergeMessage('user', content);

               } else {
                   if (msg.parts && msg.parts.length > 0) {
                       let prefixAdded = false;
                       
                       content = msg.parts.map(p => {
                           if (p.type === 'text' || p.type === 'html') {
                               const textContent = (!prefixAdded) ? (prefix + p.text) : p.text;
                               prefixAdded = true;
                               return {type: 'text', text: textContent};
                           } else if (p.type === 'image') {
                               return {type: 'image_url', image_url: {url: p.data}};
                           }
                           return null;
                       }).filter(p => p);
                   } else {
                       content = prefix + msg.content;
                   }
                   
                   pushOrMergeMessage(msg.role, content);
               }
            });

            // 【新增】将最新一轮的 user 消息用 <user_input> 框起来
            let lastUserIndex = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user' && !messages[i].worldBookInjection) {
                    lastUserIndex = i;
                    break;
                }
            }
            if (lastUserIndex !== -1) {
                let msg = messages[lastUserIndex];
                if (typeof msg.content === 'string') {
                    msg.content = "<user_input>\n" + msg.content + "\n</user_input>";
                } else if (Array.isArray(msg.content)) {
                    msg.content.unshift({type: 'text', text: "<user_input>\n"});
                    msg.content.push({type: 'text', text: "\n</user_input>"});
                }
            }

            // 如果有占位符，将 messages 数组中的历史记录格式化为文本并替换占位符
            if (hasHistoryPlaceholder) {
                let historyTextForPlaceholder = "<chat_history>\n";
                
                // 找到最后一条用户消息的索引
                let lastUserIndex = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].role === 'user' && !messages[i].worldBookInjection) {
                        lastUserIndex = i;
                        break;
                    }
                }

                // 提取历史记录（跳过第一个 system 消息，且不包含最后一条用户消息）
                const endIndex = lastUserIndex !== -1 ? lastUserIndex : messages.length;
                for (let i = 1; i < endIndex; i++) {
                    const msg = messages[i];
                    const roleName = msg.worldBookInjection && msg.role === 'system' ? 'system' : (msg.role === 'assistant' ? chat.realName : chat.myName);
                    let text = '';
                    if (typeof msg.content === 'string') {
                        text = msg.content;
                    } else if (Array.isArray(msg.content)) {
                        text = msg.content.map(p => p.text || '').join('');
                    }
                    historyTextForPlaceholder += `${roleName}: ${text}\n`;
                }
                historyTextForPlaceholder += "</chat_history>";
                
                // 替换 system 消息中的占位符
                if (messages.length > 0 && messages[0].role === 'system') {
                    messages[0].content = messages[0].content.replace('【动态插入: 聊天记录】', historyTextForPlaceholder);
                }

                // 清空原有的历史记录，只保留 system 消息和最后一条用户消息
                if (lastUserIndex !== -1) {
                    const systemMsg = messages[0];
                    const lastUserMsgs = messages.slice(lastUserIndex);
                    messages.length = 0; // 清空数组
                    messages.push(systemMsg, ...lastUserMsgs);
                } else {
                    // 如果没有用户消息，只保留 system 消息
                    messages.splice(1);
                }
            }

            // === 【第三步：处理后台通知与 CoT 序列】 ===
            
            // 1. 如果是后台消息，先插入系统通知（作为任务输入）
            if (isBackground) {
                pushOrMergeMessage('user', `[系统通知：我已有一段时间没有和你互动了，请以${chat.realName}的身份主动地延续之前的对话或发起新话题，或对时间流逝做出反应。]`);
            } else if (lastContextMessage?.role === 'assistant') {
                pushOrMergeMessage('user', `[系统通知：我暂未回复，${chat.realName}再次主动发送了消息]`);
            }

            // 2. 插入 CoT 序列（无论前台后台，只要开启就插入）
            const cotEnabled = db.cotSettings && db.cotSettings.enabled;
            
            if (cotEnabled) {
                let cotInstruction = '';
                // 优先使用角色专属 CoT 预设
                let activePresetId = 'default';
                if (chat.exclusiveCotPreset) {
                    activePresetId = chat.exclusiveCotPreset;
                } else if (db.cotSettings && db.cotSettings.activePresetId) {
                    activePresetId = db.cotSettings.activePresetId;
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
                        role: 'system', // 或者 'user'
                        content: cotInstruction
                    });

                    // 2. 插入触发器
                    pushOrMergeMessage('user', '[incipere]');

                    // 3. 插入 Prefill (预填/强塞)
                    const prefillEnabled = db.cotSettings.prefillEnabled !== false;
                    if (prefillEnabled) {
                        pushOrMergeMessage('assistant', '<thinking>');
                    }
                }
            }

            requestBody = {
                model: model, 
                messages: messages, 
                stream: streamEnabled,
                temperature: apiConfig.temperatureEnabled && apiConfig.temperature !== undefined ? apiConfig.temperature : 1.0
            };
        }
        
        let tokenEstimate = null;
        try {
            if (typeof estimateChatTokenUsage === 'function') tokenEstimate = estimateChatTokenUsage(chat, chatType, systemPrompt, historySlice, vectorContext, worldBookPlan, requestBody, environmentContext, mcpContext);
        } catch (error) { console.warn('Token 分类估算失败，不影响本轮聊天:', error.message); }
        // 格式化打印日志
        let logText = "========== [发送给 AI 的请求内容] ==========\n";
        if (requestBody.messages) {
            requestBody.messages.forEach(msg => {
                logText += `【${msg.role}】:\n`;
                if (typeof msg.content === 'string') {
                    logText += msg.content + "\n\n";
                } else if (Array.isArray(msg.content)) {
                    let textContent = "";
                    msg.content.forEach(part => {
                        if (part.type === 'text') {
                            textContent += part.text;
                        } else if (part.type === 'image_url') {
                            textContent += "[图片：base64图片已在此简略]";
                        }
                    });
                    logText += textContent + "\n\n";
                }
            });
        } else if (requestBody.contents) {
            if (requestBody.system_instruction && requestBody.system_instruction.parts) {
                logText += `【system】:\n`;
                requestBody.system_instruction.parts.forEach(part => {
                    logText += (part.text || "") + "\n";
                });
                logText += "\n";
            }
            requestBody.contents.forEach(c => {
                logText += `【${c.role}】:\n`;
                let textContent = "";
                if (c.parts) {
                    c.parts.forEach(part => {
                        if (part.text !== undefined) {
                            textContent += part.text;
                        } else if (part.inline_data) {
                            textContent += "[图片：base64图片已在此简略]";
                        }
                    });
                }
                logText += textContent + "\n\n";
            });
        }
        logText += "============================================";
        console.log(mcpContext ? logText.split(mcpContext).join('[MCP 外部资料已隐藏，具体调用状态请查看 MCP 服务中心]') : logText);

        const endpoint = (provider === 'gemini')
            ? `${url}/v1beta/models/${model}:${streamEnabled ? 'streamGenerateContent' : 'generateContent'}?key=${getRandomValue(key)}`
            : url.endsWith('/chat/completions') ? url : `${url}${url.endsWith('/v1') ? '' : '/v1'}/chat/completions`;
        const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        };
        if (!requestIsCurrent()) return;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
            ...(generationController ? { signal: generationController.signal } : {})
        });
        if (!response.ok) {
            const error = new Error(`API Error: ${response.status} ${await response.text()}`);
            error.response = response;
            throw error;
        }
        
        let reportedUsage = null;
        if (streamEnabled) {
            replyDelivered = await processStream(response, chat, provider, chatId, chatType, isBackground, requestIsCurrent, generationController?.signal, usage => { reportedUsage = usage; }, documentPlan.sources, musicPlan) === true;
        } else {
            let result;
            try {
                result = await response.json();
                console.log('【API完整响应数据】:', result);
                reportedUsage = result.usage || result.usageMetadata || null;
            } catch (e) {
                throw new Error('API返回了无法解析的JSON数据，请检查API地址及响应格式。');
            }

            let fullResponse = "";
            if (provider === 'gemini') {
                fullResponse = (Array.isArray(result) ? result : [result]).map(item =>
                    (item.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('')).join('');
            } else {
                fullResponse = result.choices[0].message.content;
            }
            
            // === 【补丁：把被吃掉的开头补回来】 ===
            // 仅在 CoT 开启且检测到闭合标签时补全
            const cotEnabled = db.cotSettings && db.cotSettings.enabled;
            // 【修改】去掉了 !isBackground，确保后台模式也能正确补全标签
            if (cotEnabled && fullResponse && !fullResponse.trim().startsWith('<thinking>')) {
                 if (fullResponse.includes('</thinking>')) {
                     fullResponse = '<thinking>' + fullResponse;
                 }
            }
            // ===================================
            
            
            if (!requestIsCurrent()) return;
            if (!fullResponse.trim()) throw new Error('API未返回有效的回复文本，请检查模型响应。');
            replyDelivered = await handleAiReplyContent(fullResponse, chat, chatId, chatType, isBackground, generationController?.signal, documentPlan.sources, musicPlan) !== false;
        }
        if (replyDelivered && requestIsCurrent()) mcpLease?.commit();
        if (replyDelivered && requestIsCurrent() && storyBridgeMode?.sceneId && storyBridgeMode.mode === 'phone' && globalThis.UvUStoryBridge) {
            try { await globalThis.UvUStoryBridge.publishTurn(chat, storyBridgeMode, globalThis.UvUStoryBridge.messageRecords(chat, bridgeTurnStart, chat.history.length)); }
            catch (error) { console.warn('UvU Story Bridge sync failed:', error.message); }
        }
        if (requestIsCurrent() && typeof recordChatTokenUsage === 'function') {
            try { recordChatTokenUsage(chat, chatType, reportedUsage, tokenEstimate, provider); }
            catch (error) { console.warn('Token 用量记录失败:', error.message); }
        }

    } catch (error) {
        if (!isBackground && !generationController?.signal.aborted) showApiError(error);
        else console.error("Background Auto-Reply Error:", error);
    } finally {
        chatGenerationRequests.delete(generationRequest);
        refreshChatGenerationUI();
        if (typeof scheduleAutoMemory === 'function') scheduleAutoMemory(chatId, chatType);
        if (replyDelivered && !generationController?.signal.aborted && chatType === 'private' && chat.activeArchiveId === generationRequest.archiveId && chat.history === generationRequest.history && typeof checkCharacterAvatar === 'function') {
            checkCharacterAvatar(chat).catch(error => console.warn('Character avatar check failed:', error.message));
        }
        if (replyDelivered && chatType === 'private' && typeof checkCharacterBlacklist === 'function') {
            checkCharacterBlacklist(chat).catch(error => console.warn('Character relationship check failed:', error.message));
        }
    }
}

async function processStream(response, chat, apiType, targetChatId, targetChatType, isBackground = false, requestIsCurrent = () => true, signal, onUsage, documentSources = [], musicPlan = null) {
    let fullResponse = await readStreamResponse(response, apiType, onUsage);
    if (!requestIsCurrent()) return;
    if (!fullResponse.trim()) throw new Error('API未返回有效的回复文本，请检查模型响应。');
    // === 【补丁：补全流式输出时丢失的开头标签】 ===
        // === 【补丁：补全流式输出时丢失的开头标签】 ===
    // 无论前台后台，只要是CoT开启且被预填吃掉了开头，都要补回来
    const cotEnabled = db.cotSettings && db.cotSettings.enabled;
    // 【修改】去掉了 !isBackground，确保后台模式也能正确补全标签
    if (cotEnabled && fullResponse && !fullResponse.trim().startsWith('<thinking>')) {
         // 这里判断：如果内容里有闭合的 </thinking> 但开头没有 <thinking>，说明开头被 Prefill 吃掉了
         if (fullResponse.includes('</thinking>')) {
             fullResponse = '<thinking>' + fullResponse;
         }
    }

    // ===================
    return await handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType, isBackground, signal, documentSources, musicPlan) !== false;
}

async function handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType, isBackground = false, signal, documentSources = [], musicPlan = null) {
    const replyArchiveId = chat.activeArchiveId;
    let replyHistory = chat.history;
    const initialHistoryLength = chat.history.length;
    let notificationOffset = initialHistoryLength;
    const relationshipRevision = chat.friendRelationship?.revision;
    const replyIsCurrent = () => !signal?.aborted && chat.activeArchiveId === replyArchiveId && chat.history === replyHistory &&
        (targetChatType !== 'private' || typeof relationshipCanChat !== 'function' || (relationshipCanChat(chat, targetChatType) && chat.friendRelationship?.revision === relationshipRevision));
    const notifyNewMessages = () => {
        const added = chat.history.slice(notificationOffset);
        notificationOffset = chat.history.length;
        showIncomingMessageNotifications(chat, added, targetChatId, targetChatType);
    };
    if (!replyIsCurrent()) return;
    const documentReply = documentSources.length && typeof extractDocumentReplies === 'function' ? extractDocumentReplies(fullResponse, documentSources) : { files: [] };
    // File bodies are opaque data. Only parse music controls outside returned files.
    const musicResponse = documentSources.length ? documentReply.text : fullResponse;
    if (musicPlan?.invitations?.length && window.UvUMusicChat) fullResponse = window.UvUMusicChat.extractActions(musicResponse, musicPlan.invitations).text;
    else if (documentSources.length) fullResponse = documentReply.text;
    let mutation = beginChatMutation(chat, targetChatType, [], ['moments', 'momentsSignature']);
    const ownedMessages = new Map(), removedMessages = new Set();
    const appendReplyMessage = message => {
        chat.history.push(message);
        ownedMessages.set(message, mutation.clone(message));
    };
    const rebaseReplyMutation = () => {
        const live = new Set(chat.history);
        mutation.before = mutation.before.filter(message => live.has(message) || removedMessages.has(message));
        const known = new Set(mutation.before);
        for (const message of chat.history) {
            if ((!ownedMessages.has(message) || JSON.stringify(message) !== JSON.stringify(ownedMessages.get(message))) && !known.has(message)) {
                mutation.before.push(message); known.add(message);
            }
        }
    };
    const savePendingReply = async () => {
        rebaseReplyMutation();
        const saved = await saveChatMutation(mutation, '回复保存失败，已恢复未保存内容，请检查存储空间后重试');
        if (saved) {
            mutation = beginChatMutation(chat, targetChatType, [], ['moments', 'momentsSignature']);
            ownedMessages.clear(); removedMessages.clear();
        }
        return saved;
    };
    const rawResponse = fullResponse;
    if (fullResponse || documentReply.files.length) {
        // 1. 移除 [incipere] 标签
        fullResponse = fullResponse.replace(/\[incipere\]/g, "");

        // 2. 捕获并分离 <thinking> 内容
        const lastThinkingIndex = fullResponse.lastIndexOf('</thinking>');
        if (lastThinkingIndex !== -1) {
            // 截取从开头到最后一个 </thinking> 的所有内容（包括标签本身）
            const thinkingContent = fullResponse.substring(0, lastThinkingIndex + 11); // 11 是 '</thinking>'.length
            
            // 创建思考过程消息对象
            const thinkingMsg = {
                id: `msg_${Date.now()}_${Math.random()}`,
                role: 'assistant',
                content: thinkingContent,
                timestamp: Date.now(),
                isThinking: true,
                isContextDisabled: true // 【关键】标记为不进入上下文
            };
            
            // 存入历史记录
            appendReplyMessage(thinkingMsg);

            // 【新增】清理旧的思维链消息，仅保留最近 50 条
            const maxThinkingMsgs = 50;
            let thinkingCount = 0;
            const idsToRemove = new Set();
            // 从后往前遍历，保留最近的 50 个，其他的标记为待删除
            for (let i = chat.history.length - 1; i >= 0; i--) {
                if (chat.history[i].isThinking) {
                    thinkingCount++;
                    if (thinkingCount > maxThinkingMsgs) {
                        idsToRemove.add(chat.history[i].id);
                    }
                }
            }
            if (idsToRemove.size > 0) {
                for (let i = chat.history.length - 1; i >= 0; i--) {
                    if (idsToRemove.has(chat.history[i].id)) { removedMessages.add(chat.history[i]); chat.history.splice(i, 1); }
                }
                replyHistory = chat.history;
            }
            
            // 添加到界面气泡（由于 regex 设置，会被隐藏，仅 Debug 模式可见）
            addMessageBubble(thinkingMsg, targetChatId, targetChatType);
            
            // 从即将显示的文本中移除思考内容
            fullResponse = fullResponse.substring(lastThinkingIndex + 11);
        }

        // --- 朋友圈指令解析 ---
        const momentPostWithImageRegex = /\[(.*?)\s*发布了一条带图动态[：:](.*?)\|([\s\S]+?)\]/;
        const momentPostRegex = /\[(.*?)\s*发布了一条动态[：:]([\s\S]+?)\]/;
        const momentCommentRegex = /\[(.*?)\s*(?:评论了|回复了)\s*(.*?)(?:(?:的|在)动态["“'‘](.*?)["”'’])?(?:下的评论)?[：:]\s*([\s\S]+?)\]/;
        const momentSignatureRegex = /\[(.*?)\s*更新了个性签名[：:]([\s\S]+?)\]/;

        let momentPostWithImageMatch, momentPostMatch, momentCommentMatch, momentSignatureMatch;
        
        let messagesToProcess = getMixedContent(fullResponse).filter(item => item.content.trim() !== '');
        let remainingMessages = [];

        for (const item of messagesToProcess) {
            const content = item.content.trim();
            momentPostWithImageMatch = content.match(momentPostWithImageRegex);
            momentPostMatch = content.match(momentPostRegex);
            momentCommentMatch = content.match(momentCommentRegex);
            momentSignatureMatch = content.match(momentSignatureRegex);

            let isMomentAction = false;

            if (momentPostWithImageMatch) {
                isMomentAction = true;
                const author = momentPostWithImageMatch[1].trim();
                const imageDesc = momentPostWithImageMatch[2].trim();
                const momentContent = momentPostWithImageMatch[3].trim();
                
                if (!chat.moments) chat.moments = [];
                chat.moments.unshift({
                    id: `moment_${Date.now()}`,
                    author: author,
                    content: momentContent,
                    imageDescription: imageDesc, // 保存图片描述
                    timestamp: Date.now(),
                    likes: [],
                    comments: []
                });

                const notificationMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system',
                    content: `[system-display:您关注的 ${author} 发布了新动态]`,
                    timestamp: Date.now(),
                    isContextDisabled: true
                };
                appendReplyMessage(notificationMsg);
                addMessageBubble(notificationMsg, targetChatId, targetChatType);
            }
            else if (momentPostMatch && !momentPostWithImageMatch) { // 确保不重复匹配
                isMomentAction = true;
                const author = momentPostMatch[1].trim();
                const momentContent = momentPostMatch[2].trim();
                
                if (!chat.moments) chat.moments = [];
                chat.moments.unshift({
                    id: `moment_${Date.now()}`,
                    author: author,
                    content: momentContent,
                    timestamp: Date.now(),
                    likes: [],
                    comments: []
                });

                const notificationMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system',
                    content: `[system-display:您关注的 ${author} 发布了新动态]`,
                    timestamp: Date.now(),
                    isContextDisabled: true
                };
                appendReplyMessage(notificationMsg);
                addMessageBubble(notificationMsg, targetChatId, targetChatType);
            } 
            else if (momentCommentMatch) {
                isMomentAction = true;
                const commenter = momentCommentMatch[1].trim();
                const commentedOn = momentCommentMatch[2].trim();
                const momentSnippet = momentCommentMatch[3] ? momentCommentMatch[3].trim() : null;
                const commentContent = momentCommentMatch[4].trim();

                if (chat.moments && chat.moments.length > 0) {
                    let targetMoment = null;
                    if (momentSnippet) {
                        targetMoment = chat.moments.find(m => m.content.includes(momentSnippet));
                    }
                    if (!targetMoment) {
                        targetMoment = chat.moments.sort((a, b) => b.timestamp - a.timestamp)[0];
                    }

                    if (targetMoment) {
                        if (!targetMoment.comments) targetMoment.comments = [];
                        const newComment = {
                            id: `comment_${Date.now()}`,
                            author: commenter,
                            content: commentContent,
                            timestamp: Date.now()
                        };
                        const isReplyToComment = content.includes('回复了') && content.includes('下的评论');
                        if (isReplyToComment || (commentedOn !== chat.realName && commentedOn !== '自己')) {
                             newComment.replyTo = commentedOn;
                        }
                        targetMoment.comments.push(newComment);
                        if (commentedOn === chat.myName || commentedOn === '你') {
                            const notificationMsg = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'system',
                                content: `[system-display:您在${chat.realName}的动态下的评论被回复了]`,
                                timestamp: Date.now(),
                                isContextDisabled: true
                            };
                            appendReplyMessage(notificationMsg);
                            addMessageBubble(notificationMsg, targetChatId, targetChatType);
                        }
                    }
                }
            }
            else if (momentSignatureMatch) {
                isMomentAction = true;
                const newSignature = momentSignatureMatch[2].trim();
                chat.momentsSignature = newSignature;
                
                if (document.getElementById('moments-screen').classList.contains('active')) {
                    renderMomentsScreen();
                }
            }

            if (isMomentAction) {
                const originalCmdMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: content,
                    timestamp: Date.now(),
                    isContextDisabled: false
                };
                appendReplyMessage(originalCmdMsg);
                addMessageBubble(originalCmdMsg, targetChatId, targetChatType);
            } else {
                remainingMessages.push(item);
            }
        }
        
        fullResponse = remainingMessages.map(item => item.content).join('\n');
        // --- 朋友圈指令解析结束 ---

        // --- 红包结算逻辑 ---
        const redPacketMsg = chat.history.find(m => m.type === 'red-packet' && !m.isRevealed);
        if (redPacketMsg) {
            mutation.messages.push({ message: redPacketMsg, before: mutation.clone(redPacketMsg) });
            redPacketMsg.isRevealed = true;
            // 触发重新渲染红包消息
            setTimeout(() => {
                if (currentChatId === chat.id) {
                    renderMessages(false, false);
                }
            }, 500);
        }

        if (db.globalReceiveSound) {
            playSound(db.globalReceiveSound);
        }
        // ... 后续代码保持不变 ...
        console.log('【AI原始返回内容】:', rawResponse);
        let cleanedResponse = fullResponse.replace(/^\[system:.*?\]\s*/, '').replace(/^\(时间:.*?\)\s*/, '');
        const trimmedResponse = cleanedResponse.trim();
        let messages;

        if (trimmedResponse.startsWith('<') && trimmedResponse.endsWith('>')) {
            messages = [{ type: 'html', content: trimmedResponse }];
        } else {
            messages = getMixedContent(fullResponse).filter(item => item.content.trim() !== '');
        }

        let firstMessageProcessed = false;

        for (const item of messages) {
            if (!replyIsCurrent()) {
                if (signal?.aborted && chat.activeArchiveId === replyArchiveId && chat.history === replyHistory) {
                    if (!await savePendingReply()) return false;
                    notifyNewMessages();
                }
                return;
            }
            notifyNewMessages();
            // 自动剔除不存在的表情包
            const stickerRegex = /\[(?:.*?的)?表情包：(.+?)\]/i;
            const stickerMatch = item.content.match(stickerRegex);
            if (stickerMatch) {
                const stickerName = stickerMatch[1].trim();
                const groups = (chat.stickerGroups || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
                let targetSticker = null;
                
                // 1. 优先在绑定分组中查找
                if (groups.length > 0) {
                    targetSticker = db.myStickers.find(s => groups.includes(s.group) && s.name === stickerName);
                }
                
                // 2. 兜底在所有表情包中查找
                if (!targetSticker) {
                    targetSticker = db.myStickers.find(s => s.name === stickerName);
                }
                
                // 3. 如果完全找不到，则剔除该消息
                if (!targetSticker) {
                    console.log(`[Auto-Filter] 剔除不存在的表情包: ${stickerName}`);
                    continue; 
                }
            }

            // --- 自动隔空投送检测 ---
            const photoRegex = /\[(.*?)发来的照片\/视频：(.*?)\]/;
            const photoMatch = item.content.match(photoRegex);
            if (photoMatch && chat.autoAirDropEnabled) {
                // 延迟一点触发，确保消息已经渲染
                setTimeout(() => {
                    if (typeof receiveAirDropPhoto === 'function') {
                        // 找到刚插入的这条消息的 ID
                        const targetMsg = chat.history[chat.history.length - 1];
                        if (targetMsg) {
                            receiveAirDropPhoto(targetMsg.id, true);
                        }
                    }
                }, 500);
            }

            // --- 视频/语音通话邀请检测 ---
            const callInviteRegex = /\[(.*?)向(.*?)发起了(视频|语音)通话\]/;
            const callInviteMatch = item.content.match(callInviteRegex);
            if (callInviteMatch) {
                const type = callInviteMatch[3] === '视频' ? 'video' : 'voice';
                // 触发来电界面
                if (window.VideoCallModule && typeof window.VideoCallModule.receiveCall === 'function') {
                    window.VideoCallModule.receiveCall(type);
                }
                // 不将此消息显示为普通气泡，或者显示为系统通知
                // 这里选择显示为系统通知样式的消息
                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system', // 使用 system 角色
                    content: item.content.trim(),
                    timestamp: Date.now()
                };
                appendReplyMessage(message);
                addMessageBubble(message, targetChatId, targetChatType);
                continue; // 跳过后续处理
            }

            if (targetChatType === 'private') {
                const char = db.characters.find(c => c.id === targetChatId);
                if (char && char.statusPanel && char.statusPanel.enabled && char.statusPanel.regexPattern) {
                    try {
                        let pattern = char.statusPanel.regexPattern;
                        let flags = 'gs'; 

                        const matchParts = pattern.match(/^\/(.*?)\/([a-z]*)$/);
                        if (matchParts) {
                            pattern = matchParts[1];
                            flags = matchParts[2] || 'gs';
                            if (!flags.includes('s')) flags += 's';
                        }

                    const regex = new RegExp(pattern, flags);
                    const match = regex.exec(item.content);
                    
                    if (match) {
                        const rawStatus = match[0];
                        
                        let html = char.statusPanel.replacePattern;
                        
                            // 使用正则一次性查找模板中的 $数字 并替换
    html = html.replace(/\$(\d+)/g, (fullMatch, groupIndex) => {
        const index = parseInt(groupIndex, 10);
        // 如果捕获组存在，则返回对应内容；否则保持原样
        return (match[index] !== undefined) ? match[index] : fullMatch;
    });


                        // Save to history
                        if (!char.statusPanel.history) char.statusPanel.history = [];
                        
                        // Add new status to the beginning
                        char.statusPanel.history.unshift({
                            raw: rawStatus,
                            html: html,
                            timestamp: Date.now()
                        });

                        // Keep only last 20 items
                        if (char.statusPanel.history.length > 20) {
                            char.statusPanel.history = char.statusPanel.history.slice(0, 20);
                        }

                        char.statusPanel.currentStatusRaw = rawStatus;
                        char.statusPanel.currentStatusHtml = html;
                        
                        item.isStatusUpdate = true;
                        item.statusSnapshot = {
                            regex: pattern,
                            replacePattern: char.statusPanel.replacePattern
                        };
                        }
                    } catch (e) {
                        console.error("状态栏正则解析错误:", e);
                    }
                }
            }

            // 如果是后台模式，跳过延迟，直接处理
            if (!isBackground) {
                const delay = firstMessageProcessed ? (900 + Math.random() * 1300) : (400 + Math.random() * 400);
                const pacedFields = mutation.fields.map(field => ({field, value:mutation.clone(chat[field.key])}));
                await new Promise(resolve => {
                    const timer = setTimeout(done, delay);
                    function done() { signal?.removeEventListener('abort', abort); resolve(); }
                    function abort() { clearTimeout(timer); done(); }
                    signal?.addEventListener('abort', abort, { once: true });
                });
                if (!replyIsCurrent()) {
                    if (signal?.aborted && chat.activeArchiveId === replyArchiveId && chat.history === replyHistory) {
                        if (!await savePendingReply()) return false;
                        notifyNewMessages();
                    }
                    return;
                }
                
                for (const {field, value} of pacedFields) {
                    if (JSON.stringify(chat[field.key]) !== JSON.stringify(value)) field.before = mutation.clone(chat[field.key]);
                }
                rebaseReplyMutation();
                // 如果开启了多条消息提示音，且不是第一条消息（第一条已由系统默认逻辑播放），则播放提示音
                if (firstMessageProcessed && db.multiMsgSoundEnabled && db.globalReceiveSound) {
                    playSound(db.globalReceiveSound);
                }
            }
            firstMessageProcessed = true;

            const aiWithdrawRegex = /\[(.*?)撤回了一条消息：([\s\S]*?)\]/;
            const aiWithdrawRegexEn = /\[(?:system:\s*)?(.*?) withdrew a message\. Original: ([\s\S]*?)\]/;
            
            const withdrawMatch = item.content.match(aiWithdrawRegex) || item.content.match(aiWithdrawRegexEn);

            if (withdrawMatch) {
                const characterName = withdrawMatch[1];
                const originalContent = withdrawMatch[2].trim();

                // --- 【新增兜底机制】检查上一条消息是否为重复输出 ---
                if (chat.history.length > 0) {
                    const lastMsg = chat.history[chat.history.length - 1];
                    // 提取上一条消息的纯文本内容（剥离包装标签）
                    let lastMsgPureContent = lastMsg.content;
                    const textMatch = lastMsg.content.match(/\[.*?的消息[：:]([\s\S]+?)\]/);
                    if (textMatch) {
                        lastMsgPureContent = textMatch[1].trim();
                    } else {
                        lastMsgPureContent = lastMsgPureContent.trim();
                    }

                    // 检查内容是否匹配且发送者一致
                    const isSameContent = (lastMsgPureContent === originalContent);
                    let isSameSender = false;
                    if (targetChatType === 'private') {
                        isSameSender = (lastMsg.role === 'assistant');
                    } else {
                        const sender = chat.members.find(m => (m.realName === characterName || m.groupNickname === characterName));
                        isSameSender = (sender && lastMsg.senderId === sender.id);
                    }

                    if (isSameContent && isSameSender) {
                        console.log(`[Withdraw-Fallback] 检测到重复输出，移除上一条消息: ${lastMsg.id}`);
                        removedMessages.add(chat.history.pop()); // 从历史记录移除
                        // 从 DOM 移除
                        const lastMsgEl = messageArea.querySelector(`.message-wrapper[data-id="${lastMsg.id}"]`);
                        if (lastMsgEl) lastMsgEl.remove();
                    }
                }
                // ----------------------------------------------

                const normalContent = `[${characterName}的消息：${originalContent}]`;
                
                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: normalContent,
                    parts: [{type: 'text', text: normalContent}],
                    timestamp: Date.now(),
                    originalContent: originalContent, 
                    isWithdrawn: false 
                };

                if (targetChatType === 'group') {
                    const sender = chat.members.find(m => (m.realName === characterName || m.groupNickname === characterName));
                    if (sender) {
                        message.senderId = sender.id;
                    }
                }

                appendReplyMessage(message);
                addMessageBubble(message, targetChatId, targetChatType);
                
                setTimeout(async () => {
                    if (!replyIsCurrent()) return;
                    const withdrawal = beginChatMutation(chat, targetChatType, [message]);
                    message.isWithdrawn = true;
                    message.content = `[${characterName}撤回了一条消息：${originalContent}]`;
                    
                    if (!await saveChatMutation(withdrawal, '撤回状态保存失败，已恢复原消息')) return;
                    
                    if ((targetChatType === 'private' && currentChatId === chat.id) || 
                        (targetChatType === 'group' && currentChatId === chat.id)) {
                         renderMessages(false, true);
                    }
                }, 2000);

                continue; 
            }

            if (targetChatType === 'private') {
                const character = chat;
                const myName = character.myName;

                const aiQuoteRegex = new RegExp(`\\[${escapeMessageRegex(character.realName)}引用[“"](.*?)["”]并回复：([\\s\\S]*?)\\]`);
                const aiQuoteMatch = item.content.match(aiQuoteRegex);

                if (aiQuoteMatch) {
                    const quotedText = aiQuoteMatch[1];
                    const replyText = aiQuoteMatch[2];

                    const originalMessage = chat.history.slice().reverse().find(m => {
                        if (m.role === 'user') {
                            const userMessageMatch = m.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                            const userMessageText = userMessageMatch ? userMessageMatch[1] : m.content;
                            return userMessageText.trim() === quotedText.trim();
                        }
                        return false;
                    });

                    if (originalMessage) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${replyText}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${replyText}]` }],
                            timestamp: Date.now(),
                            isStatusUpdate: item.isStatusUpdate,
                            statusSnapshot: item.statusSnapshot,
                            quote: {
                                messageId: originalMessage.id,
                                senderId: 'user_me',
                                content: quotedText
                            }
                        };
                        appendReplyMessage(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                    } else {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${replyText}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${replyText}]` }],
                            timestamp: Date.now(),
                            isStatusUpdate: item.isStatusUpdate,
                            statusSnapshot: item.statusSnapshot
                        };
                        appendReplyMessage(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                    }
                } else {
                    const receivedTransferRegex = new RegExp(`\\[${escapeMessageRegex(character.realName)}的转账：.*?元；备注：.*?\\]`);
                    const giftRegex = new RegExp(`\\[${escapeMessageRegex(character.realName)}送来的礼物：.*?\\]`);

                    const message = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: item.content.trim(),
                        parts: [{type: item.type, text: item.content.trim()}],
                        timestamp: Date.now(),
                        isStatusUpdate: item.isStatusUpdate,
                        statusSnapshot: item.statusSnapshot
                    };

                    if (receivedTransferRegex.test(message.content)) {
                        message.transferStatus = 'pending';
                    } else if (giftRegex.test(message.content)) {
                        message.giftStatus = 'sent';
                    }

                    appendReplyMessage(message);
                    addMessageBubble(message, targetChatId, targetChatType);
                }

            } else if (targetChatType === 'group') {
                const group = chat;
                
                // --- 私聊通知 (不拦截) ---
                if (group.allowGossip && typeof handleGossipMessage === 'function') {
                    handleGossipMessage(group, item.content);
                }

                // 优先检查是否为私聊消息
                const privateRegex = /^\[Private: (.*?) -> (.*?): ([\s\S]+?)\]$/;
                const privateEndRegex = /^\[Private-End: (.*?) -> (.*?)\]$/;
                
                if (privateRegex.test(item.content) || privateEndRegex.test(item.content)) {
                    const match = item.content.match(privateRegex) || item.content.match(privateEndRegex);
                    let senderId = 'unknown';
                    
                    if (match) {
                        const senderName = match[1];
                        // 尝试匹配发送者
                        if (senderName === group.me.nickname) {
                            senderId = 'user_me';
                        } else {
                            const sender = group.members.find(m => m.realName === senderName || m.groupNickname === senderName);
                            if (sender) senderId = sender.id;
                        }
                    }

                    const message = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: item.content.trim(),
                        parts: [{type: item.type, text: item.content.trim()}],
                        timestamp: Date.now(),
                        senderId: senderId
                    };
                    appendReplyMessage(message);
                    addMessageBubble(message, targetChatId, targetChatType);
                    continue; // 私聊消息处理完毕，跳过后续普通消息匹配
                }

                const groupTransferRegex = /\[(.*?)\s*向\s*(.*?)\s*转账：([\d.,]+)元；备注：(.*?)\]/;
                const transferMatch = item.content.match(groupTransferRegex);

                const r = /\[(.*?)((?:的消息|的语音|发送的表情包|发来的照片\/视频))：/;
                const nameMatch = item.content.match(r);
                
                if (transferMatch) {
                    const senderName = transferMatch[1];
                    const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id,
                            transferStatus: 'pending'
                        };
                        appendReplyMessage(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                    }
                } else if (nameMatch || item.char) {
                    const senderName = item.char || (nameMatch[1]);
                    const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                    console.log(sender)
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id
                        };
                        appendReplyMessage(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                    }
                }
            }
        }

        if (!replyIsCurrent()) {
            if (signal?.aborted && chat.activeArchiveId === replyArchiveId && chat.history === replyHistory) {
                if (!await savePendingReply()) return false;
                notifyNewMessages();
            }
            return;
        }
        for (const file of documentReply.files) {
            const message = documentMessage(file, 'assistant');
            appendReplyMessage(message);
            addMessageBubble(message, targetChatId, targetChatType);
        }
        if (!await savePendingReply()) return false;
        notifyNewMessages();
        renderChatList();

        // 触发独立的电量检查（不阻塞主流程）
        if (window.BatteryInteraction && typeof window.BatteryInteraction.triggerIndependentCheck === 'function') {
            window.BatteryInteraction.triggerIndependentCheck(chat);
        }
    }
    if (musicPlan?.invitations?.length && replyIsCurrent() && window.UvUMusicChat) {
        try { await window.UvUMusicChat.consumeReply(musicResponse, chat, musicPlan); }
        catch (error) { console.warn('Music invitation update failed'); }
    }
    return true;
}

async function handleRegenerate() {
    if (isGenerating) return;
    const relationshipChat = currentChatType === 'private' && db.characters.find(c => c.id === currentChatId);
    if (relationshipChat && typeof relationshipCanChat === 'function' && !relationshipCanChat(relationshipChat)) {
        showToast('请先恢复好友关系，再重新生成回复');
        return;
    }

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);

    if (!chat || !chat.history || chat.history.length === 0) {
        showToast('没有可供重新生成的内容。');
        return;
    }

    const lastUserMessageIndex = chat.history.map(m => m.role).lastIndexOf('user');

    if (lastUserMessageIndex === -1 || lastUserMessageIndex === chat.history.length - 1) {
        showToast('AI尚未回复，无法重新生成。');
        return;
    }

    const target = captureChatSendTarget();
    const lastUserId = chat.history[lastUserMessageIndex].id;
    const guidance = await showRegenerateGuidanceDialog();
    if (guidance === null) return;
    if (!isChatTargetVisible(target) || isGenerating || chat.history[lastUserMessageIndex]?.id !== lastUserId) return;
    const mutation = beginChatMutation(chat, target.type);

    const originalLength = chat.history.length;
    chat.history.splice(lastUserMessageIndex + 1);

    if (chat.history.length === originalLength) {
        showToast('未找到AI的回复，无法重新生成。');
        return;
    }
    
    if (currentChatType === 'private') {
        recalculateChatStatus(chat);
    }

    if (!await saveChatMutation(mutation)) return;
    if (!isChatTargetVisible(target)) return;
    
    currentPage = 1; 
    renderMessages(false, true); 

    await getAiReply(target.chatId, target.type, false, guidance);
}

function showRegenerateGuidanceDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'feature-dialog regenerate-guidance-dialog';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '重新生成回复');
    overlay.innerHTML = '<div class="feature-dialog-card regenerate-guidance-card"><textarea rows="6" placeholder="写下希望调整的方向；留空则直接重回。" aria-label="回复修改方向"></textarea><footer><button type="button" data-action="cancel">取消</button><button type="button" data-action="reroll">重回</button></footer></div>';
    const textarea = overlay.querySelector('textarea');
    let resolve;
    const result = new Promise(done => { resolve = done; });
    const close = value => { overlay.remove(); resolve(value); };
    overlay.addEventListener('click', event => {
        const action = event.target.closest?.('[data-action]')?.dataset.action;
        if (action === 'cancel') close(null);
        if (action === 'reroll') close(textarea.value.trim());
        if (event.target === overlay) close(null);
    });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(null); }
    });
    document.body.appendChild(overlay); textarea.focus();
    return result;
}
