async function clearChatHistory(chat, type, archiveId = chat.activeArchiveId) {
    if (!(type === "private" ? db.characters : db.groups).includes(chat) || chat.activeArchiveId !== archiveId) return false;
    const mutation = beginChatMutation(chat, type, [], ["memoryJournals", "memoryVectorIndex", "callHistory", "lastUserMessageTimestamp", "peekData", "privateSessions", "gossipSessions"]);
    chat.history = [];
    chat.memoryJournals = [];
    chat.memoryVectorIndex = {};
    chat.callHistory = [];
    chat.lastUserMessageTimestamp = null;
    chat.peekData = {};
    if (chat.privateSessions) chat.privateSessions = {};
    if (chat.gossipSessions) chat.gossipSessions = {};
    if (chat.statusPanel) chat.statusPanel = { ...chat.statusPanel, history: [], currentStatusRaw: "", currentStatusHtml: "" };
    chat.status = "在线";
    if (!await saveChatMutation(mutation, "清空未保存，已恢复原记录，请重试")) return false;
    if (currentChatId === chat.id && currentChatType === type && chat.activeArchiveId === archiveId) openChatRoom(chat.id, type);
    renderChatList();
    showToast("已清空当前存档记录，角色设定和其他存档保留");
    return true;
}
async function deleteChatEntity(chat, type) {
    const key = type === "private" ? "characters" : "groups";
    const index = db[key].indexOf(chat);
    if (index < 0) return false;
    // Remove from live state before enqueuing deletion so later saves cannot resurrect it.
    db[key] = db[key].filter(item => item !== chat);
    try { await runDataPersistence(() => dexieDB.transaction("rw", dexieDB[key], () => dexieDB[key].delete(chat.id))); }
    catch (error) {
        if (!db[key].some(item => item.id === chat.id)) db[key].splice(Math.min(index, db[key].length), 0, chat);
        renderChatList();
        showToast("删除未保存，已恢复角色或群聊，请重试");
        return false;
    }
    if (typeof chatGenerationRequests !== "undefined") [...chatGenerationRequests].filter(request => request.chat === chat).forEach(request => request.controller?.abort());
    if (currentChatId === chat.id && currentChatType === type) { currentChatId = null; currentChatType = null; switchScreen("chat-list-screen"); }
    renderChatList();
    showToast(type === "private" ? "角色及全部存档已删除" : "群聊及全部存档已删除");
    return true;
}

async function restoreDefaultChatBeautification(chat, type) {
    if (!(type === 'private' ? db.characters : db.groups).includes(chat)) return false;
    if (!chat.useCustomBubbleCss && !chat.customBubbleCss) { showToast('此对话已使用默认美化'); return true; }
    const mutation = beginChatMutation(chat, type, [], ['useCustomBubbleCss', 'customBubbleCss']);
    chat.useCustomBubbleCss = false;
    chat.customBubbleCss = '';
    if (!await saveChatMutation(mutation, '恢复默认美化未保存，已恢复原设置，请重试')) return false;
    if (currentChatId === chat.id && currentChatType === type && typeof updateCustomBubbleStyle === 'function') {
        updateCustomBubbleStyle(chat.id, '', false);
    }
    renderChatList();
    showToast('已恢复此对话的默认美化');
    return true;
}

// --- 聊天列表与文件夹管理模块 ---

// 聊天列表屏幕逻辑
function setupChatListScreen() {
    renderChatList();

    // 初始化商城系统 (集成点)
    if (typeof setupShopSystem === 'function') {
        setupShopSystem();
    }
    
    // 绑定旧按钮事件 (如果存在)
    const addChatBtn = document.getElementById('add-chat-btn');
    if(addChatBtn) {
        addChatBtn.addEventListener('click', () => {
            const addCharModal = document.getElementById('add-char-modal');
            const addCharForm = document.getElementById('add-char-form');
            addCharModal.classList.add('visible');
            addCharForm.reset();
        });
    }

    // 绑定 KKT 风格 Header 新按钮
    const addChatBtnKkt = document.getElementById('add-chat-btn-kkt');
    if (addChatBtnKkt) {
        addChatBtnKkt.addEventListener('click', () => {
            const addCharModal = document.getElementById('add-char-modal');
            const addCharForm = document.getElementById('add-char-form');
            addCharModal.classList.add('visible');
            addCharForm.reset();
        });
    }

    const createGroupBtnKkt = document.getElementById('create-group-btn-kkt');
    if (createGroupBtnKkt) {
        createGroupBtnKkt.addEventListener('click', () => {
            renderMemberSelectionList();
            document.getElementById('create-group-modal').classList.add('visible');
        });
    }

    const importBtnKkt = document.getElementById('import-btn-kkt');
    const cardInput = document.getElementById('character-card-input');
    if (importBtnKkt) {
        importBtnKkt.addEventListener('click', () => {
            // 检查是否已解锁 SillyTavern 认证
            if (db.stUnlocked) {
                cardInput.click();
            } else {
                const unlockModal = document.getElementById('st-unlock-modal');
                if (unlockModal) {
                    unlockModal.classList.add('visible');
                } else {
                    // 如果模态框不存在（可能还没加载），回退到直接导入
                    cardInput.click();
                }
            }
        });
    }
    
    cardInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleCharacterImport(file);
        }
        e.target.value = null;
    });

    const chatListContainer = document.getElementById('chat-list-container');
    chatListContainer.addEventListener('click', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            currentChatId = chatItem.dataset.id;
            currentChatType = chatItem.dataset.type;

            const chat = (currentChatType === 'private') 
                ? db.characters.find(c => c.id === currentChatId) 
                : db.groups.find(g => g.id === currentChatId);
            
            if (chat) {
                updateCustomBubbleStyle(currentChatId, chat.customBubbleCss, chat.useCustomBubbleCss);
            }

            openChatRoom(currentChatId, currentChatType);
        }
    });

    chatListContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const chatItem = e.target.closest('.chat-item');
        if (!chatItem) return;
        handleChatListLongPress(chatItem.dataset.id, chatItem.dataset.type, e.clientX, e.clientY);
    });
    chatListContainer.addEventListener('touchstart', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (!chatItem) return;
        longPressTimer = setTimeout(() => {
            const touch = e.touches[0];
            handleChatListLongPress(chatItem.dataset.id, chatItem.dataset.type, touch.clientX, touch.clientY);
        }, 400);
    });
    chatListContainer.addEventListener('touchend', () => clearTimeout(longPressTimer));
    chatListContainer.addEventListener('touchmove', () => clearTimeout(longPressTimer));
    
    setupFolderManagement();
    setupImportConfirmModal();
}

// 文件夹管理
function setupFolderManagement() {
    const folderModal = document.getElementById('folder-manage-modal');
    const folderNameInput = document.getElementById('folder-name-input');
    const confirmBtn = document.getElementById('folder-confirm-btn');
    const deleteBtn = document.getElementById('folder-delete-btn');
    const cancelBtn = document.getElementById('folder-cancel-btn');

    window.openCreateFolderModal = () => {
        currentFolderActionTarget = null; 
        document.getElementById('folder-modal-title').textContent = '新建文件夹';
        folderNameInput.value = '';
        deleteBtn.style.display = 'none';
        folderModal.classList.add('visible');
    };

    window.openEditFolderModal = (folderId) => {
        const folder = db.chatFolders.find(f => f.id === folderId);
        if (!folder) return;
        
        currentFolderActionTarget = folderId; 
        document.getElementById('folder-modal-title').textContent = '管理文件夹';
        folderNameInput.value = folder.name;
        deleteBtn.style.display = 'block';
        folderModal.classList.add('visible');
    };

    confirmBtn.addEventListener('click', async () => {
        const name = folderNameInput.value.trim();
        if (!name) return showToast('请输入文件夹名称');

        if (currentFolderActionTarget) {
            const folder = db.chatFolders.find(f => f.id === currentFolderActionTarget);
            if (folder) folder.name = name;
            showToast('文件夹已更新');
        } else {
            const newFolder = {
                id: `folder_${Date.now()}`,
                name: name
            };
            if (!db.chatFolders) db.chatFolders = [];
            db.chatFolders.push(newFolder);
            showToast('文件夹已创建');
        }
        
        await saveData();
        renderChatFolders();
        folderModal.classList.remove('visible');
    });

    deleteBtn.addEventListener('click', async () => {
        if (!currentFolderActionTarget) return;
        if (confirm('确定删除此文件夹吗？其中的聊天不会被删除，将归入"全部"列表。')) {
            db.chatFolders = db.chatFolders.filter(f => f.id !== currentFolderActionTarget);
            
            db.characters.forEach(c => { if (c.folderId === currentFolderActionTarget) delete c.folderId; });
            db.groups.forEach(g => { if (g.folderId === currentFolderActionTarget) delete g.folderId; });
            
            if (currentFolderId === currentFolderActionTarget) {
                currentFolderId = 'all';
            }

            await saveData();
            renderChatFolders();
            renderChatList(); 
            folderModal.classList.remove('visible');
            showToast('文件夹已删除');
        }
    });

    cancelBtn.addEventListener('click', () => folderModal.classList.remove('visible'));

    const moveFolderModal = document.getElementById('move-to-folder-modal');
    const folderSelectionList = document.getElementById('folder-selection-list');
    const closeMoveModalBtn = document.getElementById('close-move-folder-modal');
    let chatToMove = null;

    window.openMoveToFolderModal = (chatId, chatType) => {
        chatToMove = { id: chatId, type: chatType };
        folderSelectionList.innerHTML = '';
        
        const removeLi = document.createElement('li');
        removeLi.className = 'list-item';
        removeLi.textContent = '❌ 移出文件夹 (归入全部)';
        removeLi.onclick = async () => {
            await moveChatToFolder(null);
            moveFolderModal.classList.remove('visible');
        };
        folderSelectionList.appendChild(removeLi);

        if (db.chatFolders && db.chatFolders.length > 0) {
            db.chatFolders.forEach(folder => {
                const li = document.createElement('li');
                li.className = 'list-item';
                li.textContent = `📁 ${folder.name}`;
                li.onclick = async () => {
                    await moveChatToFolder(folder.id);
                    moveFolderModal.classList.remove('visible');
                };
                folderSelectionList.appendChild(li);
            });
        } else {
            const emptyLi = document.createElement('li');
            emptyLi.textContent = '暂无自定义文件夹，请先创建';
            emptyLi.style.padding = '15px';
            emptyLi.style.color = '#999';
            emptyLi.style.textAlign = 'center';
            folderSelectionList.appendChild(emptyLi);
        }
        
        moveFolderModal.classList.add('visible');
    };

    closeMoveModalBtn.addEventListener('click', () => moveFolderModal.classList.remove('visible'));

    async function moveChatToFolder(folderId) {
        if (!chatToMove) return;
        const { id, type } = chatToMove;
        const chat = (type === 'private') ? db.characters.find(c => c.id === id) : db.groups.find(g => g.id === id);
        
        if (chat) {
            if (folderId) {
                chat.folderId = folderId;
                showToast('已移动到文件夹');
            } else {
                delete chat.folderId; 
                showToast('已移出文件夹');
            }
            await saveData();
            renderChatList();
        }
    }
}

function renderChatFolders() {
    const container = document.getElementById('chat-category-tabs');
    if (!container) return;
    
    container.innerHTML = ''; 

    const allTab = document.createElement('div');
    allTab.className = `tab-item ${currentFolderId === 'all' ? 'active pill-black' : 'pill-white'}`;
    allTab.textContent = 'All';
    allTab.onclick = () => {
        currentFolderId = 'all';
        renderChatFolders(); 
        renderChatList();    
    };
    container.appendChild(allTab);

    if (db.chatFolders && db.chatFolders.length > 0) {
        db.chatFolders.forEach(folder => {
            const tab = document.createElement('div');
            tab.className = `tab-item ${currentFolderId === folder.id ? 'active pill-black' : 'pill-white'}`;
            tab.textContent = folder.name;
            
            tab.onclick = () => {
                currentFolderId = folder.id;
                renderChatFolders();
                renderChatList();
            };

            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                window.openEditFolderModal(folder.id);
            });
            let pressTimer;
            tab.addEventListener('touchstart', () => {
                pressTimer = setTimeout(() => window.openEditFolderModal(folder.id), 500);
            });
            tab.addEventListener('touchend', () => clearTimeout(pressTimer));
            
            container.appendChild(tab);
        });
    }

    const addTab = document.createElement('div');
    addTab.className = 'tab-item tab-manage';
    addTab.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-list-stars" viewBox="0 0 16 16">
<path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
<path d="M2.242 2.194a.27.27 0 0 1 .516 0l.162.53c.035.115.14.194.258.194h.551c.259 0 .37.333.164.493l-.468.363a.277.277 0 0 0-.094.3l.173.569c.078.256-.213.462-.423.3l-.417-.324a.267.267 0 0 0-.328 0l-.417.323c-.21.163-.5-.043-.423-.299l.173-.57a.277.277 0 0 0-.094-.299l-.468-.363c-.206-.16-.095-.493.164-.493h.55a.271.271 0 0 0 .259-.194l.162-.53zm0 4a.27.27 0 0 1 .516 0l.162.53c.035.115.14.194.258.194h.551c.259 0 .37.333.164.493l-.468.363a.277.277 0 0 0-.094.3l.173.569c.078.255-.213.462-.423.3l-.417-.324a.267.267 0 0 0-.328 0l-.417.323c-.21.163-.5-.043-.423-.299l.173-.57a.277.277 0 0 0-.094-.299l-.468-.363c-.206-.16-.095-.493.164-.493h.55a.271.271 0 0 0 .259-.194l.162-.53zm0 4a.27.27 0 0 1 .516 0l.162.53c.035.115.14.194.258.194h.551c.259 0 .37.333.164.493l-.468.363a.277.277 0 0 0-.094.3l.173.569c.078.255-.213.462-.423.3l-.417-.324a.267.267 0 0 0-.328 0l-.417.323c-.21.163-.5-.043-.423-.299l.173-.57a.277.277 0 0 0-.094-.299l-.468-.363c-.206-.16-.095-.493.164-.493h.55a.271.271 0 0 0 .259-.194l.162-.53z"/>
</svg>`;
    addTab.onclick = () => window.openCreateFolderModal();
    container.appendChild(addTab);
}

function handleChatListLongPress(chatId, chatType, x, y) {
    clearTimeout(longPressTimer);
    // 清除可能存在的文本选择，防止干扰菜单点击
    if (window.getSelection) {
        window.getSelection().removeAllRanges();
    }
    const chatItem = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chatItem) return;
    const itemName = chatType === 'private' ? chatItem.remarkName : chatItem.name;
    const menuItems = [
        {
            label: chatItem.isPinned ? '取消置顶' : '置顶聊天',
            action: async () => {
                chatItem.isPinned = !chatItem.isPinned;
                await saveData();
                renderChatList();
            }
        },
        {
            label: '移动到文件夹...',
            action: () => {
                window.openMoveToFolderModal(chatId, chatType);
            }
        },
        {
            label: '清空当前存档记录',
            danger: true,
            action: async () => {
                const archiveId = chatItem.activeArchiveId;
                if (confirm(`确定清空“${itemName}”当前存档的聊天、通话、记忆及偷看记录吗？角色设定、提示词、好友关系和其他存档保留。此操作不可恢复。`)) await clearChatHistory(chatItem, chatType, archiveId);
            }
        },
        {
            label: '恢复默认对话美化',
            action: async () => {
                if (confirm(`确定清除“${itemName}”的自定义对话美化并恢复默认样式吗？只影响此${chatType === 'private' ? '角色' : '群聊'}。`)) {
                    await restoreDefaultChatBeautification(chatItem, chatType);
                }
            }
        },
        {
            label: chatType === 'private' ? '删除整个角色' : '删除整个群聊',
            danger: true,
            action: async () => {
                if (confirm(`确定删除“${itemName}”整个${chatType === 'private' ? '角色' : '群聊'}吗？该对象的设定、全部存档、聊天及记忆都会删除。此操作不可恢复。`)) await deleteChatEntity(chatItem, chatType);
            }
        }
    ];
    createContextMenu(menuItems, x, y);
}

function renderChatList() {
    const chatListContainer = document.getElementById('chat-list-container');
    chatListContainer.innerHTML = '';
    
    if (document.getElementById('chat-category-tabs').children.length === 0) {
        renderChatFolders();
    }

    const allChats = [...db.characters.map(c => ({...c, type: 'private'})), ...db.groups.map(g => ({
        ...g,
        type: 'group'
    }))];
    
    let filteredChats;
    if (currentFolderId === 'all') {
        filteredChats = allChats.filter(chat => !chat.folderId);
    } else {
        filteredChats = allChats.filter(chat => chat.folderId === currentFolderId);
    }

    document.getElementById('no-chats-placeholder').style.display = filteredChats.length === 0 ? 'block' : 'none';
    
    const sortedChats = filteredChats.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const lastMsgTimeA = a.history && a.history.length > 0 ? a.history[a.history.length - 1].timestamp : 0;
        const lastMsgTimeB = b.history && b.history.length > 0 ? b.history[b.history.length - 1].timestamp : 0;
        return lastMsgTimeB - lastMsgTimeA;
    });
    
    sortedChats.forEach(chat => {
        let lastMessageText = '开始聊天吧...';
        if (chat.history && chat.history.length > 0) {
            let invisibleRegex;
            if (chat.showStatusUpdateMsg) {
                invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?已接收礼物\]|\[system:.*?\]|\[.*?邀请.*?加入了群聊\]|\[.*?修改群名为：.*?\]|\[system-display:.*?\]/;
            } else {
                invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[system:.*?\]|\[.*?邀请.*?加入了群聊\]|\[.*?修改群名为：.*?\]|\[system-display:.*?\]/;
            }
            const visibleHistory = chat.history.filter(msg => !invisibleRegex.test(msg.content));
            if (visibleHistory.length > 0) {
                const lastMsg = visibleHistory[visibleHistory.length - 1];
                const urlRegex = /^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)|data:image\/[a-z]+;base64,)/i;
                const imageRecogRegex = /\[.*?发来了一张图片：\]/
                const voiceRegex = /\[.*?的语音：.*?\]/;
                const photoVideoRegex = /\[.*?发来的照片\/视频：.*?\]/;
                const transferRegex = /\[.*?的转账：.*?元.*?\]|\[.*?给你转账：.*?元.*?\]|\[.*?向.*?转账：.*?元.*?\]/;
                const stickerRegex = /\[.*?的表情包：.*?\]|\[.*?发送的表情包：.*?\]/;
                const giftRegex = /\[.*?送来的礼物：.*?\]|\[.*?向.*?送来了礼物：.*?\]/;

                if (giftRegex.test(lastMsg.content)) {
                    lastMessageText = '[礼物]';
                } else if (stickerRegex.test(lastMsg.content)) {
                    lastMessageText = '[表情包]';
                } else if (voiceRegex.test(lastMsg.content)) {
                    lastMessageText = '[语音]';
                } else if (photoVideoRegex.test(lastMsg.content)) {
                    lastMessageText = '[照片/视频]';
                } else if (transferRegex.test(lastMsg.content)) {
                    lastMessageText = '[转账]';
                } else if (imageRecogRegex.test(lastMsg.content) || (lastMsg.parts && lastMsg.parts.some(p => p.type === 'image'))) {
                    lastMessageText = '[图片]';
                }else if ((lastMsg.parts && lastMsg.parts.some(p => p.type === 'html'))) {
                    lastMessageText = '[互动]';
                } else {
                    let text = lastMsg.content.trim();
                    const plainTextMatch = text.match(/^\[.*?：([\s\S]*)\]$/);
                    if (plainTextMatch && plainTextMatch[1]) {
                        text = plainTextMatch[1].trim();
                    }
                    text = text.replace(/\[发送时间:.*?\]$/, '').trim(); 
                    const htmlRegex = /<[a-z][\s\S]*>/i;
                    if (htmlRegex.test(text)) {
                        lastMessageText = '[互动]';
                    } else {
                        lastMessageText = urlRegex.test(text) ? '[图片]' : text;
                    }
                }
            } else {
                const lastEverMsg = chat.history[chat.history.length - 1];
                const inviteRegex = /\[(.*?)邀请(.*?)加入了群聊\]/;
                const renameRegex = /\[.*?修改群名为：.*?\]/;
                const timeSkipRegex = /\[system-display:([\s\S]+?)\]/;
                const timeSkipMatch = lastEverMsg.content.match(timeSkipRegex);

                if (timeSkipMatch) {
                    lastMessageText = timeSkipMatch[1];
                } else if (inviteRegex.test(lastEverMsg.content)) {
                    lastMessageText = '新成员加入了群聊';
                } else if (renameRegex.test(lastEverMsg.content)) {
                    lastMessageText = '群聊名称已修改';
                    } else {
                    lastMessageText = 'ta正在等你';
                }
                
            }
        }
        const li = document.createElement('li');
        li.className = 'list-item chat-item';
        if (chat.isPinned) li.classList.add('pinned');
        li.dataset.id = chat.id;
        li.dataset.type = chat.type;
        const avatarClass = chat.type === 'group' ? 'group-avatar' : '';
        const itemName = chat.type === 'private' ? chat.remarkName : chat.name;
        const pinBadgeHTML = chat.isPinned ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="color: #999; margin-left: 4px; flex-shrink: 0;"><path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z" /></svg>' : '';
        
        let timeString = '';
        const lastMessage = chat.history && chat.history.length > 0 ? chat.history[chat.history.length - 1] : null;
        if (lastMessage) {
            const date = new Date(lastMessage.timestamp);
            const now = new Date();
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);

            if (date.toDateString() === now.toDateString()) {
                timeString = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
            } else if (date.toDateString() === yesterday.toDateString()) {
                timeString = '昨天';
            } else {
                timeString = `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`;
            }
        }

        const unreadCount = chat.unreadCount || 0;
        const unreadClass = unreadCount > 0 ? 'visible' : '';
        const unreadText = unreadCount > 99 ? '99+' : unreadCount;

        li.innerHTML = `
            <img class="chat-avatar ${avatarClass}">
            <div class="item-details">
                <div class="item-details-row" style="justify-content: flex-start; align-items: center;">
                    <div class="item-name"></div>
                    ${pinBadgeHTML}
                </div>
                <div class="item-preview-wrapper">
                    <div class="item-preview"></div>
                </div>
            </div>
            <div class="item-meta-container">
                <span class="item-time">${timeString}</span>
                <span class="unread-badge ${unreadClass}"></span>
            </div>`;

        li.querySelector('.chat-avatar').src = chat.avatar || '';
        li.querySelector('.chat-avatar').alt = itemName || '';
        li.querySelector('.item-name').textContent = itemName || '';
        li.querySelector('.item-preview').textContent = lastMessageText;
        li.querySelector('.unread-badge').textContent = unreadText;
        chatListContainer.appendChild(li);
    });
}
