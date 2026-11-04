// --- 核心聊天逻辑 (js/chat.js) ---
// 此文件保留核心入口和胶水代码，具体功能已拆分至 js/modules/chat_*.js

// 全局函数：显示红包详情
window.showRedPacketDetails = function(message, chat) {
    const modal = document.getElementById('red-packet-details-modal');
    if (!modal) return;

    const amountElem = document.getElementById('red-packet-modal-amount');
    const infoElem = document.getElementById('red-packet-modal-info');
    const listElem = document.getElementById('red-packet-detail-list');

    // 设置金额
    let myAmount = 0;
    if (message.distributions && message.distributions['user_me']) {
        myAmount = message.distributions['user_me'];
    }
    amountElem.innerHTML = `${myAmount.toFixed(2)}<span>元</span>`;

    // 设置信息
    const totalCount = message.count || 1;
    const grabbedCount = message.distributions ? Object.keys(message.distributions).length : 0;
    infoElem.textContent = `共 ${totalCount} 个红包，已领取 ${grabbedCount}/${totalCount} 个`;

    // 渲染列表
    listElem.innerHTML = '';
    if (message.distributions) {
        // 找出运气王
        let maxAmount = 0;
        let luckyId = null;
        Object.entries(message.distributions).forEach(([id, amt]) => {
            if (amt > maxAmount) {
                maxAmount = amt;
                luckyId = id;
            }
        });

        Object.entries(message.distributions).forEach(([memId, amt]) => {
            let name = '未知成员';
            let avatar = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
            
            if (memId === 'user_me') {
                name = chat.me ? chat.me.nickname : '我';
                avatar = chat.me ? chat.me.avatar : 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg';
            } else {
                const member = chat.members ? chat.members.find(m => m.id === memId) : null;
                if (member) {
                    name = member.groupNickname;
                    avatar = member.avatar;
                }
            }
            
            const isLucky = memId === luckyId;
            const timeStr = new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

            const itemDiv = document.createElement('div');
            itemDiv.className = 'red-packet-detail-item';
            itemDiv.innerHTML = `
                <div class="red-packet-detail-user">
                    <img src="${avatar}" class="red-packet-detail-avatar">
                    <div class="red-packet-detail-name-time">
                        <span class="red-packet-detail-name">${name}</span>
                        <span class="red-packet-detail-time">${timeStr}</span>
                    </div>
                </div>
                <div class="red-packet-detail-amount-box">
                    <span class="red-packet-detail-amount">${amt.toFixed(2)}元</span>
                    ${isLucky ? '<span class="red-packet-detail-luck"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>运气王</span>' : ''}
                </div>
            `;
            listElem.appendChild(itemDiv);
        });
    }

    modal.classList.add('visible');
};

function renderTokenUsagePanel(container, chat, chatType = 'private') {
    if (!container || !chat) return;
    const snapshot = typeof getChatTokenUsageSnapshot === 'function'
        ? getChatTokenUsageSnapshot(chat.id, chatType)
        : null;
    const data = snapshot || { baseSystem: 0, cot: 0, worldBook: 0, charPersona: 0, userPersona: 0, memory: 0, vectorMemory: 0, history: 0, worldBookDetails: [], totalTokens: 0, floorCount: 0, source: '暂无数据' };
    container.replaceChildren();

    const formatTokens = value => Number(value || 0).toLocaleString();
    const formatSignedTokens = value => `${value > 0 ? '+' : ''}${formatTokens(value)}`;
    const worldBookDetails = Array.isArray(data.worldBookDetails)
        ? data.worldBookDetails.filter(item => item && item.triggered !== false)
        : [];

    const heading = document.createElement('div');
    heading.className = 'status-token-heading';
    const title = document.createElement('strong');
    title.textContent = '本轮 Token 消耗';
    const source = document.createElement('span');
    source.textContent = data.source || '本地估算';
    heading.append(title, source);

    const summary = document.createElement('div');
    summary.className = 'status-token-summary';
    const floor = document.createElement('span');
    floor.textContent = `当前聊天楼层 ${chat.history?.length || 0}`;
    const total = document.createElement('b');
    total.textContent = `${formatTokens(data.totalTokens || data.total || 0)} token`;
    summary.append(floor, total);

    const context = document.createElement('p');
    context.className = 'status-token-context';
    const inputLabel = data.actual ? 'API 实际输入' : '输入估算';
    const outputLabel = data.actual ? 'API 实际输出' : '输出估算';
    context.textContent = `本轮上下文楼层 ${data.floorCount || 0} · ${inputLabel} ${formatTokens(data.promptTokens || 0)} · ${outputLabel} ${formatTokens(data.completionTokens || 0)}`;

    const list = document.createElement('div');
    list.className = 'status-token-list';
    const items = [
        ['提示词 / 系统基础', data.baseSystem],
        ['思维链指令', data.cot],
        ['角色人设', data.charPersona],
        ['用户人设', data.userPersona],
        ['记忆总结', data.memory],
        ['向量记忆', data.vectorMemory],
        ['聊天记录', data.history],
        ['思维链输出', data.reasoningTokens],
        ['本轮输出', data.completionTokens]
    ];
    const appendRow = (name, value, valueText = formatTokens(value), extraClass = '') => {
        const row = document.createElement('div');
        row.className = `status-token-row${extraClass ? ` ${extraClass}` : ''}`;
        const label = document.createElement('span');
        label.textContent = name;
        const amount = document.createElement('b');
        amount.textContent = valueText;
        row.append(label, amount);
        list.appendChild(row);
    };
    items.forEach(([name, value]) => appendRow(name, value));

    if (worldBookDetails.length) {
        const worldBookSection = document.createElement('div');
        worldBookSection.className = 'status-token-worldbook';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'status-token-worldbook-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = `世界书（${worldBookDetails.length} 本，点击查看）`;
        const details = document.createElement('div');
        details.className = 'status-token-worldbook-details';
        details.hidden = true;
        worldBookDetails.forEach(item => {
            const row = document.createElement('div');
            row.className = 'status-token-worldbook-row';
            const name = document.createElement('span');
            name.textContent = item.name || '未命名世界书';
            const triggered = document.createElement('span');
            triggered.textContent = item.triggered ? '已触发' : '未触发';
            const amount = document.createElement('b');
            amount.textContent = `${formatTokens(item.tokenEstimate)} token`;
            row.append(name, triggered, amount);
            details.appendChild(row);
        });
        toggle.addEventListener('click', () => {
            details.hidden = !details.hidden;
            toggle.setAttribute('aria-expanded', String(!details.hidden));
        });
        worldBookSection.append(toggle, details);
        list.appendChild(worldBookSection);
    }

    if (data.actual) {
        const estimatedInput = [data.baseSystem, data.cot, data.worldBook, data.charPersona, data.userPersona, data.memory, data.vectorMemory, data.history]
            .reduce((sum, value) => sum + Number(value || 0), 0);
        const difference = Number(data.promptTokens || 0) - estimatedInput;
        if (difference !== 0) appendRow('未分类 / 协议差异', difference, `${formatSignedTokens(difference)} token`, 'status-token-difference');
    }
    container.append(heading, summary, context, list);
}

function setupChatRoom() {
    // 重新获取 DOM 元素，因为它们可能是动态注入的
    chatRoomScreen = document.getElementById('chat-room-screen');
    chatExpansionPanel = document.getElementById('chat-expansion-panel');
    panelFunctionArea = document.getElementById('panel-function-area');
    panelStickerArea = document.getElementById('panel-sticker-area');
    messageArea = document.getElementById('message-area');
    chatRoomHeaderDefault = document.getElementById('chat-room-header-default');
    chatRoomHeaderSelect = document.getElementById('chat-room-header-select');
    multiSelectBar = document.getElementById('multi-select-bar');
    multiSelectTitle = document.getElementById('multi-select-title');
    selectCount = document.getElementById('select-count');
    deleteSelectedBtn = document.getElementById('delete-selected-btn');
    chatRoomTitle = document.getElementById('chat-room-title');
    chatRoomStatusText = document.getElementById('chat-room-status-text');
    typingIndicator = document.getElementById('typing-indicator');
    messageInput = document.getElementById('message-input');
    getReplyBtn = document.getElementById('get-reply-btn');
    regenerateBtn = document.getElementById('regenerate-btn');
    const stopAiButton = document.getElementById('stop-ai-btn');
    if (stopAiButton) stopAiButton.addEventListener('click', () => {
        if (typeof stopAiReply === 'function' && stopAiReply()) showToast('已请求停止 AI 回复');
    });

    const memoryJournalBtn = document.getElementById('memory-journal-btn');
    const deleteHistoryBtn = document.getElementById('delete-history-btn');
    const captureBtn = document.getElementById('capture-btn');
    const toggleExpansionBtn = document.getElementById('toggle-expansion-btn');
    const charStatusBtn = document.getElementById('char-status-btn');
    const statusOverlay = document.getElementById('char-status-overlay');
    const closeStatusBtn = document.getElementById('close-status-panel-btn');
    const statusContent = document.getElementById('char-status-content');

    if (charStatusBtn) {
        charStatusBtn.addEventListener('click', () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (!char || !char.statusPanel) return;

            statusContent.innerHTML = ''; // Clear previous content

            // Prepare data: combine history and current if needed
            let slidesData = [];
            if (char.statusPanel.history && char.statusPanel.history.length > 0) {
                // history is [newest, older, oldest...]
                // We want to display newest last (on the right), so history is on the left
                slidesData = [...char.statusPanel.history].reverse();
            } else if (char.statusPanel.currentStatusHtml) {
                slidesData = [{ html: char.statusPanel.currentStatusHtml, timestamp: Date.now() }];
            }

            const flipShell = document.createElement('div');
            flipShell.className = 'status-flip-shell';
            const flipCard = document.createElement('div');
            flipCard.className = 'status-flip-card';
            const front = document.createElement('div');
            front.className = 'status-flip-face status-flip-front';
            const back = document.createElement('div');
            back.className = 'status-flip-face status-flip-back';
            const frontToggle = document.createElement('button');
            frontToggle.type = 'button';
            frontToggle.className = 'status-token-toggle';
            frontToggle.dataset.tokenFlip = 'true';
            frontToggle.textContent = 'Token';
            frontToggle.setAttribute('aria-label', '查看本轮 Token 消耗');
            front.appendChild(frontToggle);
            const backToggle = document.createElement('button');
            backToggle.type = 'button';
            backToggle.className = 'status-token-toggle';
            backToggle.dataset.tokenFlip = 'true';
            backToggle.textContent = '返回状态';
            backToggle.setAttribute('aria-label', '返回状态栏');
            back.appendChild(backToggle);
            const tokenPanel = document.createElement('div');
            tokenPanel.className = 'status-token-panel';
            back.appendChild(tokenPanel);
            renderTokenUsagePanel(tokenPanel, char, 'private');
            flipCard.append(front, back);
            flipShell.appendChild(flipCard);
            statusContent.appendChild(flipShell);

            if (slidesData.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'status-empty-message';
                empty.textContent = '暂无状态信息';
                front.appendChild(empty);
                statusOverlay.classList.add('visible');
                return;
            }

            // Build Swiper Structure
            const swiper = document.createElement('div');
            swiper.className = 'status-swiper';

            // Helper function for Lazy Loading
            const loadSlideContent = (index) => {
                if (index < 0 || index >= slidesData.length) return;
                const slide = swiper.children[index];
                if (!slide) return;
                const slideInner = slide.querySelector('.status-slide-inner');
                if (slideInner.hasChildNodes()) return; // Already loaded

                const item = slidesData[index];
                const htmlContent = item.html;
                if (htmlContent.includes('<!DOCTYPE html>') || htmlContent.includes('<html') || htmlContent.includes('<style')) {
                    const iframe = document.createElement('iframe');
                    iframe.style.cssText = "width: 100%; height: 100%; min-height: 80vh; border: none; background: transparent; display: block;";
                    iframe.srcdoc = processTemplate(htmlContent, char);
                    slideInner.appendChild(iframe);
                } else {
                    slideInner.innerHTML = processTemplate(htmlContent, char);
                }
            };

            // Create empty slides first
            slidesData.forEach((item, index) => {
                const slide = document.createElement('div');
                slide.className = 'status-slide';
                
                const slideInner = document.createElement('div');
                slideInner.className = 'status-slide-inner';
                // Content will be loaded lazily
                
                slide.appendChild(slideInner);
                swiper.appendChild(slide);
            });

            // Indicator
            const indicator = document.createElement('div');
            indicator.className = 'status-indicator';
            indicator.textContent = `${slidesData.length} / ${slidesData.length}`;

            front.appendChild(swiper);
            front.appendChild(indicator);

            // Initial Load: Load the last slide (newest) and previous ones
            const lastIndex = slidesData.length - 1;
            loadSlideContent(lastIndex);
            if (lastIndex > 0) loadSlideContent(lastIndex - 1);
            if (lastIndex > 1) loadSlideContent(lastIndex - 2);

            // Scroll to the end (newest) initially
            setTimeout(() => {
                swiper.style.scrollBehavior = 'auto';
                swiper.scrollLeft = swiper.scrollWidth;
                setTimeout(() => {
                    swiper.style.scrollBehavior = 'smooth';
                }, 50);
            }, 0);

            // Scroll Listener for Indicator & Lazy Loading
            swiper.addEventListener('scroll', () => {
                const width = swiper.offsetWidth;
                if (width > 0) {
                    const currentIndex = Math.round(swiper.scrollLeft / width);
                    indicator.textContent = `${currentIndex + 1} / ${slidesData.length}`;
                    
                    // Lazy load adjacent slides (current +/- 2)
                    for (let i = currentIndex - 2; i <= currentIndex + 2; i++) {
                        loadSlideContent(i);
                    }
                }
            });

            statusOverlay.classList.add('visible');
        });
    }

    if (closeStatusBtn) {
        closeStatusBtn.addEventListener('click', () => {
            statusOverlay.classList.remove('visible');
        });
    }
    
    if (statusOverlay) {
        statusOverlay.addEventListener('click', (e) => {
            if (e.target === statusOverlay) {
                statusOverlay.classList.remove('visible');
            }
        });
    }

    // 状态栏交互事件委托
    if (statusContent) {
        statusContent.addEventListener('click', (e) => {
            const tokenToggle = e.target.closest('[data-token-flip]');
            if (tokenToggle) {
                const card = tokenToggle.closest('.status-flip-card');
                if (card) card.classList.toggle('is-flipped');
                return;
            }
            const target = e.target.closest('[data-send-msg]');
            if (target) {
                const msg = target.dataset.sendMsg;
                if (msg) {
                    const input = document.getElementById('message-input');
                    if (input) {
                        input.value = msg;
                        document.getElementById('send-message-btn').click();
                        // 关闭状态栏面板
                        statusOverlay.classList.remove('visible');
                    }
                }
            }
        });
    }

    window.refreshCurrentTokenUsagePanel = () => {
        const panel = document.querySelector('#char-status-content .status-token-panel');
        const chat = currentChatType === 'private' ? db.characters.find(c => c.id === currentChatId) : null;
        if (panel && chat) renderTokenUsagePanel(panel, chat, 'private');
    };

    if (toggleExpansionBtn) {
        toggleExpansionBtn.addEventListener('click', () => {
            if (chatExpansionPanel.classList.contains('visible') && panelFunctionArea.style.display !== 'none') {
                showPanel('none');
            } else {
                showPanel('function');
            }
        });
    }

    if (memoryJournalBtn) {
        memoryJournalBtn.addEventListener('click', () => {
            renderJournalList();
            switchScreen('memory-journal-screen');
            showPanel('none'); 
        });
    }

    if (deleteHistoryBtn) {
        deleteHistoryBtn.addEventListener('click', () => {
            openDeleteChunkModal();
            showPanel('none'); 
        });
    }

    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
            enterMultiSelectMode(null, 'capture');
            showPanel('none');
        });
    }

    const shopBtn = document.getElementById('shop-btn');
    if (shopBtn) {
        shopBtn.addEventListener('click', () => {
            if (typeof openShopScreen === 'function') {
                openShopScreen();
                showPanel('none');
            } else {
                showToast('商城模块未加载');
            }
        });
    }

    const videoCallBtn = document.getElementById('video-call-btn');
    if (videoCallBtn) {
        videoCallBtn.addEventListener('click', () => {
            if (window.VideoCallModule) {
                window.VideoCallModule.showCallTypeModal();
                showPanel('none');
            } else {
                showToast('视频通话模块未加载');
            }
        });
    }

    const charGalleryManageBtn = document.getElementById('char-gallery-manage-btn');
    if (charGalleryManageBtn) {
        charGalleryManageBtn.addEventListener('click', () => {
            if (typeof openGalleryManager === 'function') {
                openGalleryManager();
                showPanel('none');
            } else {
                showToast('相册功能未加载');
            }
        });
    }

    const redPacketBtn = document.getElementById('red-packet-btn');
    if (redPacketBtn) {
        redPacketBtn.addEventListener('click', () => {
            if (currentChatType !== 'group') {
                showToast('红包功能仅限群聊使用');
                return;
            }
            document.getElementById('send-red-packet-form').reset();
            document.getElementById('send-red-packet-modal').classList.add('visible');
            showPanel('none');
        });
    }

    const closeRedPacketDetailsBtn = document.getElementById('close-red-packet-details-btn');
    if (closeRedPacketDetailsBtn) {
        closeRedPacketDetailsBtn.addEventListener('click', () => {
            document.getElementById('red-packet-details-modal').classList.remove('visible');
        });
    }

    document.getElementById('send-message-btn').addEventListener('click', sendMessage);
    document.getElementById('send-message-btn').addEventListener('touchend', (e) => {
        e.preventDefault();
        sendMessage();
        setTimeout(() => {
            messageInput.focus();
        }, 50);
    });
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.isComposing && !isGenerating) sendMessage();
    });
    const updateSendButton = () => {
        const hasText = Boolean(messageInput.value.trim());
        document.getElementById('send-message-btn').style.display = hasText ? 'inline-flex' : 'none';
        getReplyBtn.style.display = hasText ? 'none' : 'inline-flex';
    };
    messageInput.addEventListener('input', updateSendButton);
    updateSendButton();

    // 监听输入框聚焦事件：自动收起底部面板，避免与键盘冲突
    messageInput.addEventListener('focus', () => {
        if (chatExpansionPanel.classList.contains('visible')) {
            // 立即禁用动画，防止键盘弹出时面板被顶起
            chatExpansionPanel.classList.add('no-transition');
            showPanel('none');
            // 恢复动画属性
            setTimeout(() => {
                chatExpansionPanel.classList.remove('no-transition');
            }, 100);
        }
    });

    getReplyBtn.addEventListener('click', () => getAiReply(currentChatId, currentChatType));
    regenerateBtn.addEventListener('click', handleRegenerate);
    
    messageArea.addEventListener('click', (e) => {
        if (isDebugMode && !isInMultiSelectMode) {
            const messageWrapper = e.target.closest('.message-wrapper');
            if (messageWrapper) {
                startDebugEdit(messageWrapper.dataset.id);
                return; 
            }
        }

        if (chatExpansionPanel.classList.contains('visible')) {
            showPanel('none');
            return;
        }

        if (e.target && e.target.id === 'load-more-btn') {
            loadMoreMessages();
        } else if (isInMultiSelectMode) {
            const messageWrapper = e.target.closest('.message-wrapper');
            if (messageWrapper) {
                toggleMessageSelection(messageWrapper.dataset.id);
            }
        } else {
            const voiceBubble = e.target.closest('.voice-bubble');
            if (voiceBubble) {
                const transcript = voiceBubble.closest('.message-wrapper').querySelector('.voice-transcript');
                if (transcript) {
                    transcript.classList.toggle('active');
                }
            }
            
            const bilingualBubble = e.target.closest('.bilingual-bubble');
            if (bilingualBubble) {
                const translationText = bilingualBubble.closest('.message-wrapper').querySelector('.translation-text');
                if (translationText) {
                    translationText.classList.toggle('active');
                }
            }

            const pvCard = e.target.closest('.pv-card');
            if (pvCard) {
                const imageOverlay = pvCard.querySelector('.pv-card-image-overlay');
                const footer = pvCard.querySelector('.pv-card-footer');
                imageOverlay.classList.toggle('hidden');
                footer.classList.toggle('hidden');
            }
            const giftCard = e.target.closest('.gift-card');
            if (giftCard) {
                const description = giftCard.closest('.message-wrapper').querySelector('.gift-card-description');
                if (description) {
                    description.classList.toggle('active');
                }
            }
            const transferCard = e.target.closest('.transfer-card.received-transfer');
            if (transferCard && currentChatType === 'private') {
                const messageWrapper = transferCard.closest('.message-wrapper');
                const messageId = messageWrapper.dataset.id;
                const character = db.characters.find(c => c.id === currentChatId);
                const message = character.history.find(m => m.id === messageId);
                if (message && message.transferStatus === 'pending') {
                    handleReceivedTransferClick(messageId);
                }
            }
        }
    });
    
    messageArea.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (e.target.id === 'load-more-btn') return;
        const messageWrapper = e.target.closest('.message-wrapper');
        if (!messageWrapper) return;
        handleMessageLongPress(messageWrapper, e.clientX, e.clientY);
    });
    setupMessageReplyGestures(messageArea);
    setupMessageRangeShortcut();
    
    const messageEditForm = document.getElementById('message-edit-form');
    if(messageEditForm) {
        messageEditForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveMessageEdit();
        });
    }

    const cancelEditModalBtn = document.getElementById('cancel-edit-modal-btn');
    if(cancelEditModalBtn) {
        cancelEditModalBtn.addEventListener('click', cancelMessageEdit);
    }

    const hideTimestampBtn = document.getElementById('hide-timestamp-btn');
    if (hideTimestampBtn) {
        hideTimestampBtn.addEventListener('click', () => {
            if (!editingMessageId) return;
            
            const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
            const messageIndex = chat.history.findIndex(m => m.id === editingMessageId);
            
            let targetTime;
            if (messageIndex > 0) {
                const prevMsg = chat.history[messageIndex - 1];
                targetTime = prevMsg.timestamp + 60000; 
            } else {
                targetTime = Date.now(); 
            }
            
            const date = new Date(targetTime);
            const Y = date.getFullYear();
            const M = String(date.getMonth() + 1).padStart(2, '0');
            const D = String(date.getDate()).padStart(2, '0');
            const h = String(date.getHours()).padStart(2, '0');
            const m = String(date.getMinutes()).padStart(2, '0');
            
            const timestampInput = document.getElementById('message-edit-timestamp');
            if (timestampInput) {
                timestampInput.value = `${Y}-${M}-${D}T${h}:${m}`;
            }
        });
    }

    document.getElementById('cancel-multi-select-btn').addEventListener('click', exitMultiSelectMode);
    document.getElementById('delete-selected-btn').addEventListener('click', deleteSelectedMessages);
    document.getElementById('share-selected-btn').addEventListener('click', shareSelectedMessages);
    document.getElementById('capture-selected-btn').addEventListener('click', generateCapture);
    document.getElementById('generate-capture-btn').addEventListener('click', generateCapture);
    document.getElementById('close-capture-modal-btn').addEventListener('click', () => {
        document.getElementById('capture-result-modal').classList.remove('visible');
    });
    document.getElementById('cancel-reply-btn').addEventListener('click', cancelQuoteReply);
}

function openChatRoom(chatId, type) {
    if (type === 'private' && typeof checkRelationshipRecovery === 'function') {
        const target = db.characters.find(c => c.id === chatId);
        checkRelationshipRecovery(target).catch(() => {});
    }
    if (typeof window.clearStickerSuggestions === 'function') window.clearStickerSuggestions();
    const chat = (type === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return;

    currentChatId = chatId;
    currentChatType = type;
    cancelQuoteReply();

    // 迁移旧的私聊数据 (仅群聊)
    if (type === 'group' && chat.privateSessions && typeof migratePrivateSessionsToHistory === 'function') {
        migratePrivateSessionsToHistory(chat);
        saveData(); // 迁移后立即保存
    }

    if (chat.unreadCount && chat.unreadCount > 0) {
        chat.unreadCount = 0;
        saveData();
        renderChatList(); 
    }
    exitMultiSelectMode();
    cancelMessageEdit();
    chatRoomTitle.textContent = (type === 'private') ? chat.remarkName : chat.name;
    const subtitle = document.getElementById('chat-room-subtitle');
    if (type === 'private') {
        subtitle.style.display = (chat.showStatus !== false) ? 'flex' : 'none';
        chatRoomStatusText.textContent = chat.status || '在线';
    } else {
        subtitle.style.display = 'none';
    }
    getReplyBtn.style.display = 'inline-flex';
    chatRoomScreen.style.backgroundImage = chat.chatBg ? `url(${chat.chatBg})` : 'none';
    refreshChatGenerationUI();
    currentPage = 1;
    chatRoomScreen.className = chatRoomScreen.className.replace(/\bchat-active-[^ ]+\b/g, '');
    chatRoomScreen.classList.add(`chat-active-${chatId}`);
    
    const avatarRadius = chat.avatarRadius !== undefined ? chat.avatarRadius : 50;
    document.documentElement.style.setProperty('--chat-avatar-radius', `${avatarRadius}%`);

    if (chat.bubbleBlurEnabled === false) {
        chatRoomScreen.classList.add('disable-blur');
    } else {
        chatRoomScreen.classList.remove('disable-blur');
    }

    if (chat.showTimestamp) {
        chatRoomScreen.classList.add('show-timestamp');
    } else {
        chatRoomScreen.classList.remove('show-timestamp');
    }
    chatRoomScreen.classList.remove('timestamp-side');

    chatRoomScreen.classList.remove('timestamp-style-bubble', 'timestamp-style-avatar');
    chatRoomScreen.classList.add(`timestamp-style-${chat.timestampStyle || 'bubble'}`);

    const header = document.getElementById('chat-room-header-default');
    if (chat.titleLayout === 'center') {
        header.classList.add('title-centered');
    } else {
        header.classList.remove('title-centered');
    }

    const journalBtnLabel = document.querySelector('#memory-journal-btn .expansion-item-name');
    if (journalBtnLabel) {
        journalBtnLabel.textContent = (type === 'group') ? '总结' : '日记';
    }

    const starBtn = document.getElementById('char-status-btn');
    if (starBtn) {
        if (type === 'private' && chat.statusPanel && chat.statusPanel.enabled) {
            starBtn.style.display = 'flex';
        } else {
            starBtn.style.display = 'none';
        }
    }

    const redPacketBtn = document.getElementById('red-packet-btn');
    if (redPacketBtn) {
        redPacketBtn.style.display = (type === 'group') ? 'flex' : 'none';
    }

    const peekBtn = document.getElementById('peek-btn');
    if (peekBtn) {
        if (type === 'private') {
            peekBtn.style.display = 'flex';
            peekBtn.classList.remove('has-unread');
            const badge = document.getElementById('gossip-badge');
            if (badge) badge.style.display = 'none';
        } else {
            // 群聊
            if (chat.allowGossip) {
                peekBtn.style.display = 'flex';
                // 检查未读
                const hasUnread = Object.values(gossipUnreadMap || {}).some(count => count > 0);
                const badge = document.getElementById('gossip-badge');
                if (hasUnread) {
                    peekBtn.classList.add('has-unread');
                    if (badge) badge.style.display = 'block';
                } else {
                    peekBtn.classList.remove('has-unread');
                    if (badge) badge.style.display = 'none';
                }
            } else {
                peekBtn.style.display = 'none';
            }
        }
    }

    updateCustomBubbleStyle(chatId, chat.customBubbleCss, chat.useCustomBubbleCss);
    renderMessages(false, true);
    if (typeof scheduleAutoMemory === 'function') scheduleAutoMemory(chatId, type);
    switchScreen('chat-room-screen');
    
    requestAnimationFrame(() => {
        void document.body.offsetHeight; 
    });
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isGenerating) return;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);

    if (!chat) return;
    if (typeof relationshipCanSend === 'function' && !relationshipCanSend(chat, currentChatType)) return;
    const quoteInfo = currentQuoteInfo?.chatId === currentChatId && currentQuoteInfo.chatType === currentChatType &&
        currentQuoteInfo.archiveId === chat.activeArchiveId ? currentQuoteInfo : null;
    messageInput.value = '';
    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (!chat.history) chat.history = [];
    const mutation = beginChatMutation(chat, currentChatType, [], ['lastUserMessageTimestamp', 'name']);
    const sendTarget = captureChatSendTarget();

    if (db.apiSettings && db.apiSettings.timePerceptionEnabled) {
        const now = new Date();
        const lastMessageTime = chat.lastUserMessageTimestamp;
        if (lastMessageTime) {
            const timeGap = now.getTime() - lastMessageTime;
            const thirtyMinutes = 30 * 60 * 1000; 

            if (timeGap > thirtyMinutes) {
                const displayContent = `[system-display:距离上次聊天已经过去 ${formatTimeGap(timeGap)}]`;
                const visualMessage = {
                    id: `msg_visual_timesense_${Date.now()}`,
                    role: 'system',
                    content: displayContent,
                    parts: [],
                    timestamp: now.getTime() - 2 
                };

                if (currentChatType === 'group') {
                    visualMessage.senderId = 'user_me';
                }

                chat.history.push(visualMessage);
                addMessageBubble(visualMessage, currentChatId, currentChatType);
            }
        }
        chat.lastUserMessageTimestamp = now.getTime();
    }

    let messageContent;
    const systemRegex = /\[system:.*?\]|\[system-display:.*?\]/;
    const inviteRegex = /\[.*?邀请.*?加入群聊\]/;
    const renameRegex = /\[(.*?)修改群名为“(.*?)”\]/;
    const shopOrderRegex = /\[.*?为你下单的商品：.*?\]/;
    const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;

    if (renameRegex.test(text)) {
        const match = text.match(renameRegex);
        chat.name = match[2];
        chatRoomTitle.textContent = chat.name;
        messageContent = `[${chat.me.nickname}修改群名为“${chat.name}”]`;
    } else if (systemRegex.test(text) || inviteRegex.test(text) || shopOrderRegex.test(text)) {
        messageContent = text;
    } else {
        let userText = text;
        messageContent = `[${myName}的消息：${userText}]`;
    }

    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: messageContent,
        parts: [{type: 'text', text: messageContent}],
        timestamp: Date.now()
    };

    if (quoteInfo) {
        message.quote = {
            messageId: quoteInfo.id,
            senderId: quoteInfo.senderId,
            senderName: quoteInfo.senderName,
            content: quoteInfo.content,
            timestamp: quoteInfo.timestamp
        };
    }

    if (currentChatType === 'group') {
        message.senderId = 'user_me';
    }
    chat.history.push(message);
    if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, currentChatType);
    if (typeof scheduleAutoMemory === 'function') scheduleAutoMemory(chat.id, currentChatType);
    addMessageBubble(message, currentChatId, currentChatType);
    // 在异步保存前清空本次引用，避免保存期间新选中的引用被旧发送操作取消。
    if (currentQuoteInfo === quoteInfo || !quoteInfo) cancelQuoteReply();
    triggerHapticFeedback('success');

    if (chat.history.length > 0 && chat.history.length % 300 === 0) {
        promptForBackupIfNeeded('history_milestone');
    }

    if (!await saveChatMutation(mutation, '发送未保存，已恢复消息和草稿')) {
        if (isChatTargetVisible(sendTarget)) {
            if (!messageInput.value) {
                messageInput.value = text;
                messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                if (quoteInfo && !currentQuoteInfo) {
                    currentQuoteInfo = quoteInfo;
                    if (typeof startQuoteReply === 'function') startQuoteReply(quoteInfo.id);
                }
            }
            chatRoomTitle.textContent = mutation.type === 'private' ? chat.remarkName : chat.name;
        }
        return;
    }
    renderChatList();

}

// 备份提示
function promptForBackupIfNeeded(triggerType) {
    if (triggerType === 'history_milestone') {
        showToast('uwu提醒您：记得备份噢');
    }
}
