// --- 聊天辅助功能模块 ---

// 辅助功能
function setupVoiceMessageSystem() {
    const voiceMessageBtn = document.getElementById('voice-message-btn');
    const sendVoiceForm = document.getElementById('send-voice-form');
    const sendVoiceModal = document.getElementById('send-voice-modal');
    const voiceDurationPreview = document.getElementById('voice-duration-preview');
    const voiceTextInput = document.getElementById('voice-text-input');

    voiceMessageBtn.addEventListener('click', () => {
        sendVoiceForm.reset();
        voiceDurationPreview.textContent = '0"';
        sendVoiceModal.classList.add('visible');
    });
    sendVoiceForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyVoiceMessage(voiceTextInput.value.trim());
    });
}

function sendMyVoiceMessage(text) {
    const target = captureChatSendTarget();
    if (!target) return;
    const relationshipTarget = currentChatType === 'private' && db.characters.find(c => c.id === currentChatId);
    if (relationshipTarget && typeof relationshipCanSend === 'function' && !relationshipCanSend(relationshipTarget)) return;
    if (!text) return;
    document.getElementById('send-voice-modal').classList.remove('visible');
    return new Promise(resolve => setTimeout(resolve, 100)).then(async () => {
        if (!isChatSendTargetValid(target)) return false;
        const { chat, type: currentChatType, chatId: currentChatId } = target;
        const mutation = beginChatMutation(chat, currentChatType);
        const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
        const content = `[${myName}的语音：${text}]`;
        const message = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: content,
            parts: [{type: 'text', text: content}],
            timestamp: Date.now()
        };
        if (currentChatType === 'group') {
            message.senderId = 'user_me';
        }
        if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, currentChatType);
        chat.history.push(message);
        if (isChatTargetVisible(target)) addMessageBubble(message, currentChatId, currentChatType);
        const saved = await saveChatMutation(mutation, '发送未保存，请重试');
        renderChatList();
        return saved;
    });
}

const MiniMaxTTS = (() => {
    let activeAudio = null;
    let activeUrl = null;
    let activeBubble = null;
    let pendingBubble = null;
    let pendingRequest = null;
    let playbackToken = 0;
    const audioCache = new Map();
    const maxCachedAudio = 8;

    function getSettings() {
        return db.minimaxTtsSettings || {};
    }

    function decodeHexAudio(hex) {
        if (typeof hex !== 'string' || !/^(?:[\da-f]{2})+$/i.test(hex)) {
            throw new Error('语音服务返回了无法识别的音频数据');
        }
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return new Blob([bytes], { type: 'audio/mpeg' });
    }

    function cacheAudio(key, blob) {
        audioCache.delete(key);
        audioCache.set(key, blob);
        while (audioCache.size > maxCachedAudio) audioCache.delete(audioCache.keys().next().value);
    }

    async function synthesize(text, settings = getSettings(), signal) {
        const apiKey = String(settings.apiKey || '').trim();
        const endpoint = String(settings.endpoint || 'https://api.minimaxi.com/v1/t2a_v2').trim();
        const model = String(settings.model || 'speech-2.8-hd').trim();
        const voiceId = String(settings.voiceId || '').trim();
        if (!apiKey || !voiceId) throw new Error('请先在 API 设置中填写 MiniMax 密钥和音色 ID');
        if (!/^https:\/\//i.test(endpoint)) throw new Error('MiniMax API 地址必须使用 HTTPS');
        if (!text || text.length > 10000) throw new Error('语音文本不能为空，且不能超过 10000 个字符');

        const requestUrl = new URL(endpoint);
        const groupId = String(settings.groupId || '').trim();
        if (groupId) requestUrl.searchParams.set('GroupId', groupId);
        const cacheKey = JSON.stringify([requestUrl.href, model, voiceId, settings.speed || 1, settings.pitch || 0, text]);
        if (audioCache.has(cacheKey)) return audioCache.get(cacheKey);

        const response = await fetch(requestUrl.href, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                model,
                text,
                stream: false,
                output_format: 'hex',
                voice_setting: {
                    voice_id: voiceId,
                    speed: Number(settings.speed) || 1,
                    vol: 1,
                    pitch: Number(settings.pitch) || 0
                },
                audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }
            })
        });
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error(`MiniMax 返回了无效响应 (${response.status})`);
        }
        if (!response.ok || (result.base_resp && result.base_resp.status_code !== 0)) {
            const detail = result.base_resp?.status_msg || result.message || `HTTP ${response.status}`;
            throw new Error(`MiniMax 语音生成失败：${detail}`);
        }
        const blob = decodeHexAudio(result.data?.audio);
        cacheAudio(cacheKey, blob);
        return blob;
    }

    async function play(bubble, text) {
        if (activeBubble === bubble && activeAudio && !activeAudio.paused) {
            activeAudio.pause();
            bubble.classList.remove('voice-playing');
            return;
        }
        if (pendingBubble === bubble) {
            stop();
            return;
        }
        stop();
        const token = playbackToken;
        pendingRequest = new AbortController();
        pendingBubble = bubble;
        bubble.classList.add('voice-loading');
        bubble.setAttribute('aria-busy', 'true');
        try {
            const savedSettings = getSettings();
            const ttsSettings = {
                ...savedSettings,
                voiceId: resolveVoiceId(bubble.dataset.voiceId, savedSettings)
            };
            const blob = await synthesize(text, ttsSettings, pendingRequest.signal);
            if (token !== playbackToken) return;
            pendingRequest = null;
            pendingBubble = null;
            activeUrl = URL.createObjectURL(blob);
            activeAudio = new Audio(activeUrl);
            activeBubble = bubble;
            activeAudio.addEventListener('ended', stop, { once: true });
            activeAudio.addEventListener('error', () => {
                const mediaErrorCode = activeAudio?.error?.code || 0;
                stop();
                showToast(getAudioPlaybackErrorMessage(mediaErrorCode));
            }, { once: true });
            await activeAudio.play();
            bubble.classList.add('voice-playing');
        } catch (error) {
            if (token === playbackToken) {
                stop();
                if (error?.name === 'NotAllowedError') showToast('浏览器拦截了音频播放，请再次点击语音气泡播放');
                else if (error?.name !== 'AbortError') showToast(error?.message || '语音生成失败，请检查 MiniMax 设置和网络');
            }
        } finally {
            if (token === playbackToken) {
                bubble.classList.remove('voice-loading');
                bubble.removeAttribute('aria-busy');
            }
        }
    }

    function stop() {
        playbackToken++;
        if (pendingRequest) pendingRequest.abort();
        pendingRequest = null;
        if (pendingBubble) {
            pendingBubble.classList.remove('voice-loading');
            pendingBubble.removeAttribute('aria-busy');
        }
        if (activeAudio) {
            activeAudio.pause();
            activeAudio.src = '';
        }
        if (activeUrl) URL.revokeObjectURL(activeUrl);
        if (activeBubble) activeBubble.classList.remove('voice-playing', 'voice-loading');
        activeAudio = activeUrl = activeBubble = null;
        pendingBubble = null;
    }

    function resolveVoiceId(characterVoiceId, settings = getSettings()) {
        return String(characterVoiceId || settings.voiceId || '').trim();
    }

    return { play, synthesize, resolveVoiceId };
})();

function getAudioPlaybackErrorMessage(code) {
    const messages = {
        1: '音频播放已取消',
        2: '语音已生成，但浏览器读取音频失败，请检查网络或重试',
        3: '语音已生成，但浏览器无法解码音频；请确认 MiniMax 返回格式为 MP3',
        4: '语音已生成，但当前浏览器不支持返回的音频格式'
    };
    return messages[code] || '语音已生成，但浏览器播放失败；请再次点击重试并检查浏览器音频支持';
}

async function previewMiniMaxVoice() {
    const settings = {
        apiKey: document.getElementById('minimax-tts-key')?.value.trim(),
        endpoint: document.getElementById('minimax-tts-endpoint')?.value.trim(),
        groupId: document.getElementById('minimax-tts-group-id')?.value.trim(),
        model: document.getElementById('minimax-tts-model')?.value.trim(),
        voiceId: document.getElementById('minimax-tts-voice')?.value.trim(),
        speed: document.getElementById('minimax-tts-speed')?.value,
        pitch: document.getElementById('minimax-tts-pitch')?.value
    };
    const button = document.getElementById('minimax-tts-preview');
    if (button) button.disabled = true;
    try {
        const blob = await MiniMaxTTS.synthesize('你好，这是角色语音试听。', settings);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
    } catch (error) {
        showToast(error?.message || '语音试听失败');
    } finally {
        if (button) button.disabled = false;
    }
}

function setupPhotoVideoSystem() {
    const photoVideoBtn = document.getElementById('photo-video-btn');
    const sendPvForm = document.getElementById('send-pv-form');
    const sendPvModal = document.getElementById('send-pv-modal');
    const pvTextInput = document.getElementById('pv-text-input');

    photoVideoBtn.addEventListener('click', () => {
        sendPvForm.reset();
        sendPvModal.classList.add('visible');
    });
    sendPvForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyPhotoVideo(pvTextInput.value.trim());
    });
}

function sendMyPhotoVideo(text) {
    const target = captureChatSendTarget();
    if (!target) return;
    const relationshipTarget = currentChatType === 'private' && db.characters.find(c => c.id === currentChatId);
    if (relationshipTarget && typeof relationshipCanSend === 'function' && !relationshipCanSend(relationshipTarget)) return;
    if (!text) return;
    document.getElementById('send-pv-modal').classList.remove('visible');
    return new Promise(resolve => setTimeout(resolve, 100)).then(async () => {
        if (!isChatSendTargetValid(target)) return false;
        const { chat, type: currentChatType, chatId: currentChatId } = target;
        const mutation = beginChatMutation(chat, currentChatType);
        const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
        const content = `[${myName}发来的照片\/视频：${text}]`;
        const message = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: content,
            parts: [{type: 'text', text: content}],
            timestamp: Date.now()
        };
        if (currentChatType === 'group') {
            message.senderId = 'user_me';
        }
        if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, currentChatType);
        chat.history.push(message);
        if (isChatTargetVisible(target)) addMessageBubble(message, currentChatId, currentChatType);
        const saved = await saveChatMutation(mutation, '发送未保存，请重试');
        renderChatList();
        return saved;
    });
}

function setupImageRecognition() {
    const imageRecognitionBtn = document.getElementById('image-recognition-btn');
    const imageUploadInput = document.getElementById('image-upload-input');
    const cameraPhotoBtn = document.getElementById('camera-photo-btn');
    const cameraUploadInput = document.getElementById('camera-upload-input');

    const processImageFile = async (file, input) => {
        if (!file) return;
        const target = captureChatSendTarget();
        try {
            if (file.type && !file.type.startsWith('image/')) throw new Error('请选择图片文件');
            if (Number.isFinite(file.size) && file.size > 15 * 1024 * 1024) throw new Error('图片不能超过 15MB');
            const compressedUrl = await compressImage(file, {
                quality: 0.8,
                maxWidth: 1024,
                maxHeight: 1024
            });
            await sendImageForRecognition(compressedUrl, target);
        } catch (error) {
            console.error('Image processing failed:', error);
            showToast(error.message || '图片处理失败，请重试');
        } finally {
            if (input) input.value = null;
        }
    };

    if (imageRecognitionBtn && imageUploadInput) imageRecognitionBtn.addEventListener('click', () => imageUploadInput.click());
    if (imageUploadInput) imageUploadInput.addEventListener('change', e => processImageFile(e.target.files?.[0], imageUploadInput));
    if (cameraPhotoBtn && cameraUploadInput) cameraPhotoBtn.addEventListener('click', () => cameraUploadInput.click());
    if (cameraUploadInput) cameraUploadInput.addEventListener('change', e => processImageFile(e.target.files?.[0], cameraUploadInput));
}

async function sendImageForRecognition(base64Data, target = captureChatSendTarget()) {
    if (!isChatSendTargetValid(target)) return;
    const { type: currentChatType, chatId: currentChatId } = target;
    const relationshipTarget = currentChatType === 'private' && db.characters.find(c => c.id === currentChatId);
    if (relationshipTarget && typeof relationshipCanSend === 'function' && !relationshipCanSend(relationshipTarget)) return;
    if (!base64Data || isGenerating) return;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
    const textPrompt = `[${myName}发来了一张图片：]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: base64Data,
        parts: [{type: 'text', text: textPrompt}, {type: 'image', data: base64Data}],
        timestamp: Date.now(),
    };
    if (currentChatType === 'group') {
        message.senderId = 'user_me';
    }
    if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, currentChatType);
    const mutation = beginChatMutation(chat, currentChatType);
    chat.history.push(message);
    if (isChatTargetVisible(target)) addMessageBubble(message, currentChatId, currentChatType);
    if (!await saveChatMutation(mutation, '图片发送未保存，请重试')) return;
    renderChatList();
}

function setupWalletSystem() {
    const walletBtn = document.getElementById('wallet-btn');
    const sendTransferForm = document.getElementById('send-transfer-form');
    const sendTransferModal = document.getElementById('send-transfer-modal');
    const transferAmountInput = document.getElementById('transfer-amount-input');
    const transferRemarkInput = document.getElementById('transfer-remark-input');
    const acceptTransferBtn = document.getElementById('accept-transfer-btn');
    const returnTransferBtn = document.getElementById('return-transfer-btn');

    walletBtn.addEventListener('click', () => {
        if (currentChatType === 'private') {
            sendTransferForm.reset();
            sendTransferModal.classList.add('visible');
        } else if (currentChatType === 'group') {
            // currentGroupAction 应该在 group_chat.js 或全局定义
            if (typeof currentGroupAction !== 'undefined') {
                currentGroupAction.type = 'transfer';
            }
            renderGroupRecipientSelectionList('转账给');
            document.getElementById('group-recipient-selection-modal').classList.add('visible');
        }
    });
    sendTransferForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = transferAmountInput.value;
        const remark = transferRemarkInput.value.trim();
        if (amount > 0) {
            sendMyTransfer(amount, remark);
        } else {
            showToast('请输入有效的金额');
        }
    });
    acceptTransferBtn.addEventListener('click', () => respondToTransfer('received'));
    returnTransferBtn.addEventListener('click', () => respondToTransfer('returned'));
}

function sendMyTransfer(amount, remark) {
    const target = captureChatSendTarget();
    if (!target) return;
    const recipients = typeof currentGroupAction !== 'undefined' ? [...(currentGroupAction.recipients || [])] : [];
    const relationshipTarget = currentChatType === 'private' && db.characters.find(c => c.id === currentChatId);
    if (relationshipTarget && typeof relationshipCanSend === 'function' && !relationshipCanSend(relationshipTarget)) return;
    document.getElementById('send-transfer-modal').classList.remove('visible');
    return new Promise(resolve => setTimeout(resolve, 100)).then(async () => {
        if (!isChatSendTargetValid(target)) return false;
        const { chat, type: currentChatType, chatId: currentChatId } = target;
        const mutation = beginChatMutation(chat, currentChatType);
        if (currentChatType === 'private') {
            const content = `[${chat.myName}给你转账：${amount}元；备注：${remark}]`;
            const message = {
                id: `msg_${Date.now()}`,
                role: 'user',
                content: content,
                parts: [{type: 'text', text: content}],
                timestamp: Date.now(),
                transferStatus: 'pending'
            };
            if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, currentChatType);
            chat.history.push(message);
            if (isChatTargetVisible(target)) addMessageBubble(message, currentChatId, currentChatType);
        } else { 
            if (recipients.length) {
                recipients.forEach(recipientId => {
                    const recipient = chat.members.find(m => m.id === recipientId);
                    if (recipient) {
                        const content = `[${chat.me.nickname} 向 ${recipient.realName} 转账：${amount}元；备注：${remark}]`;
                        const message = {
                            id: `msg_${Date.now()}_${recipientId}`,
                            role: 'user',
                            content: content,
                            parts: [{type: 'text', text: content}],
                            timestamp: Date.now(),
                            senderId: 'user_me'
                        };
                        if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, currentChatType);
                        chat.history.push(message);
                        if (isChatTargetVisible(target)) addMessageBubble(message, currentChatId, currentChatType);
                    }
                });
            }
        }
        const saved = await saveChatMutation(mutation, '发送未保存，请重试');
        renderChatList();
        return saved;
    });
}

function handleReceivedTransferClick(messageId) {
    currentTransferMessageId = messageId;
    document.getElementById('receive-transfer-actionsheet').classList.add('visible');
}

async function respondToTransfer(action) {
    if (!currentTransferMessageId) return;
    const character = db.characters.find(c => c.id === currentChatId);
    if (character && typeof relationshipCanChat === 'function' && !relationshipCanChat(character)) {
        showToast('请先恢复好友关系，再处理转账');
        return;
    }
    const message = character?.history.find(m => m.id === currentTransferMessageId);
    if (message) {
        const mutation = beginChatMutation(character, 'private', [message]);
        const transferId = currentTransferMessageId;
        message.transferStatus = action;
        const cardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${currentTransferMessageId}"] .transfer-card`);
        if (cardOnScreen) {
            cardOnScreen.classList.remove('received', 'returned');
            cardOnScreen.classList.add(action);
            cardOnScreen.querySelector('.transfer-status').textContent = action === 'received' ? '已收款' : '已退回';
            cardOnScreen.style.cursor = 'default';
        }
        let contextMessageContent = (action === 'received') ? `[${character.myName}接收${character.realName}的转账]` : `[${character.myName}退回${character.realName}的转账]`;
        const contextMessage = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: contextMessageContent,
            parts: [{type: 'text', text: contextMessageContent}],
            timestamp: Date.now()
        };
        if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(character, contextMessage);
        character.history.push(contextMessage);
        if (!await saveChatMutation(mutation)) return;
        renderChatList();
        if (currentChatId !== character.id || currentChatType !== 'private' || currentTransferMessageId !== transferId) return;
    }
    document.getElementById('receive-transfer-actionsheet').classList.remove('visible');
    currentTransferMessageId = null;
}

function setupGiftSystem() {
    const giftBtn = document.getElementById('gift-btn');
    const sendGiftForm = document.getElementById('send-gift-form');
    const sendGiftModal = document.getElementById('send-gift-modal');
    const giftDescriptionInput = document.getElementById('gift-description-input');

    giftBtn.addEventListener('click', () => {
        if (currentChatType === 'private') {
            sendGiftForm.reset();
            sendGiftModal.classList.add('visible');
        } else if (currentChatType === 'group') {
            if (typeof currentGroupAction !== 'undefined') {
                currentGroupAction.type = 'gift';
            }
            renderGroupRecipientSelectionList('送礼物给');
            document.getElementById('group-recipient-selection-modal').classList.add('visible');
        }
    });
    sendGiftForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyGift(giftDescriptionInput.value.trim());
    });
}

function sendMyGift(description) {
    const target = captureChatSendTarget();
    if (!target) return;
    const recipients = typeof currentGroupAction !== 'undefined' ? [...(currentGroupAction.recipients || [])] : [];
    const relationshipTarget = currentChatType === 'private' && db.characters.find(c => c.id === currentChatId);
    if (relationshipTarget && typeof relationshipCanSend === 'function' && !relationshipCanSend(relationshipTarget)) return;
    if (!description) return;
    document.getElementById('send-gift-modal').classList.remove('visible');
    return new Promise(resolve => setTimeout(resolve, 100)).then(async () => {
        if (!isChatSendTargetValid(target)) return false;
        const { chat, type: currentChatType, chatId: currentChatId } = target;
        const mutation = beginChatMutation(chat, currentChatType);

        if (currentChatType === 'private') {
            const content = `[${chat.myName}送来的礼物：${description}]`;
            const message = {
                id: `msg_${Date.now()}`,
                role: 'user',
                content: content,
                parts: [{type: 'text', text: content}],
                timestamp: Date.now(),
                giftStatus: 'sent'
            };
            if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, currentChatType);
            chat.history.push(message);
            if (isChatTargetVisible(target)) addMessageBubble(message, currentChatId, currentChatType);
        } else { 
            if (recipients.length) {
                recipients.forEach(recipientId => {
                    const recipient = chat.members.find(m => m.id === recipientId);
                    if (recipient) {
                        const content = `[${chat.me.nickname} 向 ${recipient.realName} 送来了礼物：${description}]`;
                        const message = {
                            id: `msg_${Date.now()}_${recipientId}`,
                            role: 'user',
                            content: content,
                            parts: [{type: 'text', text: content}],
                            timestamp: Date.now(),
                            senderId: 'user_me'
                        };
                        if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, currentChatType);
                        chat.history.push(message);
                        if (isChatTargetVisible(target)) addMessageBubble(message, currentChatId, currentChatType);
                    }
                });
            }
        }
        const saved = await saveChatMutation(mutation, '发送未保存，请重试');
        renderChatList();
        return saved;
    });
}

// --- 转发聊天记录弹窗逻辑 ---
window.showForwardedChatModal = function(chatContent, charName) {
    const modal = document.getElementById('forwarded-chat-modal');
    const titleEl = document.getElementById('forwarded-chat-modal-title');
    const contentEl = document.getElementById('forwarded-chat-content');
    const closeBtn = document.getElementById('close-forwarded-chat-btn');
    
    if (!modal || !titleEl || !contentEl) return;
    
    titleEl.textContent = `${charName}的聊天记录`;
    
    // 解析聊天记录内容
    const lines = chatContent.split('\n').filter(line => line.trim() !== '');
    let html = '';
    
    lines.forEach(line => {
        // 尝试匹配 "名字：内容" 或 "名字: 内容"
        const match = line.match(/^([^：:]+)[：:]([\s\S]+)$/);
        if (match) {
            const rawName = match[1].trim();
            const nameNode = document.createElement('span');
            nameNode.textContent = rawName;
            const name = nameNode.innerHTML;
            const text = match[2].trim();
            
            // 简单的左右区分逻辑：如果名字是当前角色，放右边，否则放左边
            const isSelf = rawName === charName;
            
            html += `
                <div style="display: flex; flex-direction: column; align-items: ${isSelf ? 'flex-end' : 'flex-start'}; margin-bottom: 12px;">
                    <span style="font-size: 12px; color: #888; margin-bottom: 4px; margin-${isSelf ? 'right' : 'left'}: 4px;">${name}</span>
                    <div style="background: ${isSelf ? 'var(--primary-color)' : '#fff'}; color: ${isSelf ? '#fff' : '#333'}; padding: 8px 12px; border-radius: 12px; border-${isSelf ? 'top-right' : 'top-left'}-radius: 4px; max-width: 85%; word-wrap: break-word; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        ${DOMPurify.sanitize(text)}
                    </div>
                </div>
            `;
        } else {
            // 如果没有匹配到名字，作为系统提示或居中显示
            html += `<div style="text-align: center; font-size: 12px; color: #aaa; margin: 8px 0;">${DOMPurify.sanitize(line)}</div>`;
        }
    });
    
    contentEl.innerHTML = html;
    modal.classList.add('visible');
    
    // 绑定关闭事件
    const closeModal = () => {
        modal.classList.remove('visible');
        closeBtn.removeEventListener('click', closeModal);
    };
    closeBtn.addEventListener('click', closeModal);
};

function setupTimeSkipSystem() {
    const timeSkipBtn = document.getElementById('time-skip-btn');
    const timeSkipModal = document.getElementById('time-skip-modal');
    const timeSkipForm = document.getElementById('time-skip-form');
    const timeSkipInput = document.getElementById('time-skip-input');

    timeSkipBtn.addEventListener('click', () => {
        timeSkipForm.reset();
        timeSkipModal.classList.add('visible');
    });
    timeSkipModal.addEventListener('click', (e) => {
        if (e.target === timeSkipModal) timeSkipModal.classList.remove('visible');
    });
    timeSkipForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendTimeSkipMessage(timeSkipInput.value.trim());
    });
}

async function sendTimeSkipMessage(text) {
    const target = captureChatSendTarget();
    if (!target) return;
    const relationshipTarget = target.type === 'private' && db.characters.find(c => c.id === target.chatId);
    if (relationshipTarget && typeof relationshipCanSend === 'function' && !relationshipCanSend(relationshipTarget)) return;
    if (!text) return;
    document.getElementById('time-skip-modal').classList.remove('visible');
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!isChatSendTargetValid(target)) return;
    const { chat } = target;
    const mutation = beginChatMutation(chat, target.type);
    if (!chat) return;

    const visualMessage = {
        id: `msg_visual_${Date.now()}`,
        role: 'system',
        content: `[system-display:${text}]`,
        parts: [],
        timestamp: Date.now()
    };
    const contextMessage = {
        id: `msg_context_${Date.now()}`,
        role: 'user',
        content: `[system: ${text}]`,
        parts: [{type: 'text', text: `[system: ${text}]`}],
        timestamp: Date.now()
    };
    if (target.type === 'group') {
        contextMessage.senderId = 'user_me';
        visualMessage.senderId = 'user_me';
    }

    if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, contextMessage, target.type);
    chat.history.push(visualMessage, contextMessage);
    if (isChatTargetVisible(target)) addMessageBubble(visualMessage, target.chatId, target.type);
    if (!await saveChatMutation(mutation, '发送未保存，请重试')) return;
    renderChatList();
}

const AudioManager = {
    _audio: null,
    
    get audio() {
        if (!this._audio) {
            this._audio = new Audio();
            this._audio.addEventListener('ended', () => {
                // 可选：播放结束后的清理工作
            });
            this._audio.addEventListener('error', (e) => {
                console.warn('Audio Object Error:', e);
            });
        }
        return this._audio;
    },

    play(source) {
        if (!source) return;
        const a = this.audio;
        
        // 如果当前正在播放且源相同，可以重置进度（打断重播）
        // 如果源不同，直接切换
        try {
            a.src = source;
            a.volume = 1.0; 
            a.currentTime = 0;
            
            const p = a.play();
            if (p && typeof p.catch === 'function') {
                p.catch(e => {
                    // 忽略 AbortError (被新的播放打断是正常的)
                    if (e.name !== 'AbortError') {
                        console.warn('播放提示音失败:', e);
                    }
                });
            }
        } catch (e) {
            console.warn('音频播放异常:', e);
        }
    },

    // 预热/解锁音频对象（用于在没有发送音效时获取播放权限）
    unlock() {
        if (db.globalReceiveSound) {
            const a = this.audio;
            // 记录当前状态
            const originalSrc = a.src;
            
            // 切换到接收音效进行预热
            if (!a.src || a.src !== db.globalReceiveSound) {
                 a.src = db.globalReceiveSound;
            }
            
            a.volume = 0; // 静音
            const p = a.play();
            if (p) {
                p.then(() => {
                    a.pause();
                    a.currentTime = 0;
                    a.volume = 1; 
                }).catch(e => {
                    // 预热失败也不影响流程
                    a.volume = 1;
                });
            }
        }
    }
};

function playSound(source) {
    AudioManager.play(source);
}
