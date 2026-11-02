// --- 偷看手机功能 (js/modules/peek.js) ---

let isBatchMode = false;
let selectedApps = new Set();

function exitBatchMode() {
    isBatchMode = false;
    selectedApps.clear();
    const peekBatchBar = document.getElementById('peek-batch-bar');
    const peekBatchBtn = document.getElementById('peek-batch-btn');
    if (peekBatchBar) peekBatchBar.style.display = 'none';
    if (peekBatchBtn) peekBatchBtn.style.display = 'block';
    document.querySelectorAll('#peek-screen .app-icon').forEach(icon => {
        icon.classList.remove('selectable', 'selected');
    });
}

function updateBatchCount() {
    const peekBatchCount = document.getElementById('peek-batch-count');
    if (peekBatchCount) {
        peekBatchCount.textContent = `已选 ${selectedApps.size} 个应用`;
    }
}

function setupPeekFeature() {
    const peekBtn = document.getElementById('peek-btn');
    const peekConfirmModal = document.getElementById('peek-confirm-modal');
    const peekConfirmYes = document.getElementById('peek-confirm-yes');
    const peekConfirmNo = document.getElementById('peek-confirm-no');
    const peekSettingsBtn = document.getElementById('peek-settings-btn');
    const peekWallpaperModal = document.getElementById('peek-wallpaper-modal');
    const peekBatchBtn = document.getElementById('peek-batch-btn');
    const peekBatchBar = document.getElementById('peek-batch-bar');
    const peekBatchCancelBtn = document.getElementById('peek-batch-cancel-btn');
    const peekBatchStartBtn = document.getElementById('peek-batch-start-btn');

    document.getElementById('clear-peek-data-btn')?.addEventListener('click', async () => {
        if (confirm('确定要清空该角色的所有偷看数据吗？清空后下次进入各应用将重新生成。')) {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char) {
                char.peekData = {}; 
                await saveData();   
                showToast('偷看数据已清空');
            }
        }
    });

    const peekActionSheet = document.getElementById('peek-actionsheet');
    const peekMenuPhoneBtn = document.getElementById('peek-menu-phone-btn');
    const peekMenuMomentsBtn = document.getElementById('peek-menu-moments-btn');
    const peekMenuCancelBtn = document.getElementById('peek-menu-cancel-btn');

    peekBtn?.addEventListener('click', () => {
        if (currentChatType !== 'private') return;
        peekActionSheet.classList.add('visible');
    });

    peekMenuCancelBtn?.addEventListener('click', () => {
        peekActionSheet.classList.remove('visible');
    });

    peekActionSheet?.addEventListener('click', (e) => {
        if (e.target === peekActionSheet) {
            peekActionSheet.classList.remove('visible');
        }
    });

    peekMenuPhoneBtn?.addEventListener('click', () => {
        peekActionSheet.classList.remove('visible');
        peekConfirmModal.classList.add('visible');
    });

    peekMenuMomentsBtn?.addEventListener('click', () => {
        peekActionSheet.classList.remove('visible');
        renderMomentsScreen();
        switchScreen('moments-screen');
    });

    peekConfirmNo?.addEventListener('click', () => {
        peekConfirmModal.classList.remove('visible');
    });

    peekConfirmYes?.addEventListener('click', () => {
        peekConfirmModal.classList.remove('visible');
        renderPeekScreen(); 
        switchScreen('peek-screen');
    });

    peekSettingsBtn?.addEventListener('click', () => {
        renderPeekSettings();
        peekWallpaperModal.classList.add('visible');
    });

    // --- 批量生成逻辑 ---
    peekBatchBtn?.addEventListener('click', () => {
        isBatchMode = true;
        selectedApps.clear();
        peekBatchBar.style.display = 'flex';
        peekBatchBtn.style.display = 'none';
        updateBatchCount();
        
        // 给所有图标添加可选状态样式
        document.querySelectorAll('#peek-screen .app-icon').forEach(icon => {
            icon.classList.add('selectable');
            icon.classList.remove('selected');
        });
    });

    peekBatchCancelBtn?.addEventListener('click', () => {
        exitBatchMode();
    });

    peekBatchStartBtn?.addEventListener('click', () => {
        if (selectedApps.size === 0) {
            showToast('请至少选择一个应用');
            return;
        }
        if (selectedApps.size > 4) {
            showToast('为了保证生成质量，一次最多选择4个应用');
            return;
        }
        generateBatchPeekContent(Array.from(selectedApps));
    });

    document.getElementById('save-peek-settings-btn')?.addEventListener('click', async () => {
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) {
            showToast('错误：未找到当前角色');
            return;
        }

        if (!character.peekScreenSettings) {
            character.peekScreenSettings = {};
        }

        if (!character.peekScreenSettings.generationCounts) {
            character.peekScreenSettings.generationCounts = {};
        }

        const countInputs = document.querySelectorAll('.peek-settings-item-control input');
        countInputs.forEach(input => {
            const appId = input.dataset.appId;
            const val = parseInt(input.value);
            if (!isNaN(val)) {
                character.peekScreenSettings.generationCounts[appId] = val;
            }
        });

        await saveData();
        showToast('配置已保存！');
        peekWallpaperModal.classList.remove('visible');
    });

    const peekMessagesScreen = document.getElementById('peek-messages-screen');
    peekMessagesScreen.addEventListener('click', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            const partnerName = chatItem.dataset.name;
            const char = db.characters.find(c => c.id === currentChatId);
            const cachedData = char ? char.peekData.messages : null;
            if (cachedData && cachedData.conversations) {
                const conversation = cachedData.conversations.find(c => c.partnerName === partnerName);
                if (conversation) {
                    renderPeekConversation(conversation.history, conversation.partnerName);
                    switchScreen('peek-conversation-screen');
                } else {
                    showToast('找不到对话记录');
                }
            }
        } else if (e.target.closest('.action-btn')) {
            generateAndRenderPeekContent('messages', { forceRefresh: true });
        }
    });

    const peekConversationScreen = document.getElementById('peek-conversation-screen');
    peekConversationScreen.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn')) {
            generateAndRenderPeekContent('messages', { forceRefresh: true });
        }
    });

    const refreshAlbumBtn = document.getElementById('refresh-album-btn');
    if(refreshAlbumBtn) {
        refreshAlbumBtn.addEventListener('click', () => generateAndRenderPeekContent('album', { forceRefresh: true }));
    }

    const photoModal = document.getElementById('peek-photo-modal');
    if(photoModal) {
        photoModal.addEventListener('click', (e) => {
            if (e.target === photoModal) {
                photoModal.classList.remove('visible');
            }
        });
    }

    setupMomentsFeature();
}

// --- 朋友圈 (Moments) 功能 ---

const MOMENT_PLACEHOLDER_IMAGES = [
    'https://i.postimg.cc/FsZ1yvgD/QQ-1782811211078.png',
    'https://i.postimg.cc/8PHsRGBX/QQ-1782811226542.png',
    'https://i.postimg.cc/cJjvvc7F/QQ-1782811241562.png',
    'https://i.postimg.cc/TPhy2sbL/QQ-1782811322250.png',
    'https://i.postimg.cc/SK5nnGLH/QQ-1782811335398.png',
    'https://i.postimg.cc/hPq78pFJ/QQ-1782811349650.png'
];

function setupMomentsFeature() {
    const momentsScreen = document.getElementById('moments-screen');
    const momentsContentArea = document.getElementById('moments-content-area');
    const momentsHeader = document.getElementById('moments-header');
    const momentsTitle = document.getElementById('moments-title');
    const refreshBtn = document.getElementById('moments-refresh-btn');
    const commentInputArea = document.getElementById('moments-comment-input-area');
    const commentInput = document.getElementById('moments-comment-input');
    const commentSendBtn = document.getElementById('moments-comment-send-btn');
    const coverImg = document.getElementById('moments-cover-img');
    const signatureEl = document.getElementById('moments-user-signature');
    if (signatureEl) {
        signatureEl.title = '点击修改个性签名';
        signatureEl.style.cursor = 'pointer';
    }
    const coverUploadInput = document.createElement('input');
    coverUploadInput.type = 'file';
    coverUploadInput.accept = 'image/*';
    coverUploadInput.style.display = 'none';
    document.body.appendChild(coverUploadInput);

    let currentActionMomentId = null;
    let currentActionReplyTo = null; // 新增：用于存储回复对象

    // 滚动时改变头部样式
    momentsContentArea?.addEventListener('scroll', () => {
        if (momentsContentArea.scrollTop > 200) {
            momentsHeader.classList.add('scrolled');
            momentsTitle.style.opacity = '1';
        } else {
            momentsHeader.classList.remove('scrolled');
            momentsTitle.style.opacity = '0';
        }
    });

    // 刷新按钮
    refreshBtn?.addEventListener('click', () => {
        renderMomentsScreen();
        showToast('动态已刷新');
    });

    // 点击角色签名，由用户直接修改
    signatureEl?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const char = db.characters.find(c => c.id === currentChatId);
        if (!char) return;

        const input = prompt('修改个性签名（最多80字）', char.momentsSignature || '');
        if (input === null) return;

        const newSignature = input.trim();
        if (!newSignature) {
            showToast('个性签名不能为空');
            return;
        }
        if (Array.from(newSignature).length > 80) {
            showToast('个性签名不能超过80字');
            return;
        }
        if (newSignature === (char.momentsSignature || '').trim()) return;

        await updateMomentsSignature(newSignature);
    });

    // 点击背景图更换
    coverImg?.addEventListener('click', () => {
        coverUploadInput.click();
    });

    coverUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const char = db.characters.find(c => c.id === currentChatId);
        if (!char) return;

        try {
            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 1080 });
            if (!char.peekScreenSettings) {
                char.peekScreenSettings = {};
            }
            char.peekScreenSettings.momentsCover = compressedUrl;
            await saveData();
            renderMomentsScreen();
            showToast('朋友圈封面已更换');
        } catch (error) {
            showToast('封面更换失败');
            console.error('Failed to change moments cover:', error);
        }
    });

    // 委托处理动态列表的点击事件
    const feedContainer = document.getElementById('moments-feed-container');
    
    let longPressTimer;
    let isLongPress = false;

    // 统一处理长按事件（支持动态本体和单条评论）
    const handleTouchStart = (e) => {
        const target = e.target;
        const momentItem = target.closest('.moment-item');
        if (!momentItem) return;

        isLongPress = false;
        longPressTimer = setTimeout(() => {
            isLongPress = true;
            
            // 检查是否长按了某条评论
            const commentItem = target.closest('.moment-comment');
            if (commentItem) {
                const momentId = momentItem.dataset.id;
                const commentId = commentItem.dataset.commentId;
                if (confirm('确定要删除这条评论吗？')) {
                    deleteMomentComment(momentId, commentId);
                }
                return;
            }

            // 否则认为是长按了动态本体
            const momentId = momentItem.dataset.id;
            if (confirm('确定要删除这条动态吗？')) {
                deleteMoment(momentId);
            }
        }, 800); // 800ms 算作长按
    };

    const handleTouchEnd = () => {
        clearTimeout(longPressTimer);
    };

    // 兼容鼠标和触摸事件
    feedContainer?.addEventListener('mousedown', handleTouchStart);
    feedContainer?.addEventListener('touchstart', handleTouchStart, { passive: true });

    feedContainer?.addEventListener('mouseup', handleTouchEnd);
    feedContainer?.addEventListener('mouseleave', handleTouchEnd);
    feedContainer?.addEventListener('touchend', handleTouchEnd);
    feedContainer?.addEventListener('touchcancel', handleTouchEnd);

    feedContainer?.addEventListener('click', (e) => {
        if (isLongPress) {
            e.stopPropagation();
            e.preventDefault();
            return;
        }
        // 隐藏所有已打开的操作弹窗
        document.querySelectorAll('.moment-action-popup.show').forEach(popup => {
            popup.classList.remove('show');
        });

        // 点击操作按钮 (··)
        const actionBtn = e.target.closest('.moment-action-btn');
        if (actionBtn) {
            e.stopPropagation();
            const popup = actionBtn.nextElementSibling;
            if (popup && popup.classList.contains('moment-action-popup')) {
                popup.classList.toggle('show');
            }
            return;
        }

        // 点击点赞
        const likeBtn = e.target.closest('.moment-action-item.like');
        if (likeBtn) {
            e.stopPropagation();
            const momentId = likeBtn.closest('.moment-item').dataset.id;
            toggleMomentLike(momentId);
            likeBtn.closest('.moment-action-popup').classList.remove('show');
            return;
        }

        // 点击评论
        const commentBtn = e.target.closest('.moment-action-item.comment');
        if (commentBtn) {
            e.stopPropagation();
            currentActionMomentId = commentBtn.closest('.moment-item').dataset.id;
            currentActionReplyTo = null; // 重置回复对象
            commentInput.placeholder = '评论';
            commentInputArea.style.display = 'flex';
            commentInput.focus();
            commentBtn.closest('.moment-action-popup').classList.remove('show');
            return;
        }

        // 点击单个评论进行回复
        const singleComment = e.target.closest('.moment-comment');
        if (singleComment) {
            e.stopPropagation();
            const author = singleComment.querySelector('.moment-comment-name')?.textContent;
            const myName = db.characters.find(c => c.id === currentChatId)?.myName || '我';
            // 不能回复自己
            if (author && author !== myName) {
                currentActionMomentId = singleComment.closest('.moment-item').dataset.id;
                currentActionReplyTo = author;
                commentInput.placeholder = `回复 ${author}:`;
                commentInputArea.style.display = 'flex';
                commentInput.focus();
            }
            return;
        }

        // 点击带图动态的遮罩区域
        const imageWrapper = e.target.closest('.moment-image-wrapper');
        if (imageWrapper) {
            e.stopPropagation();
            imageWrapper.classList.toggle('show-text');
        }
    });

    // 点击屏幕其他地方隐藏评论框和操作弹窗
    momentsScreen?.addEventListener('click', (e) => {
        if (!e.target.closest('.moment-action-btn') && !e.target.closest('.moment-action-popup')) {
            document.querySelectorAll('.moment-action-popup.show').forEach(popup => {
                popup.classList.remove('show');
            });
        }
        
        if (!e.target.closest('.moments-comment-input-area') && !e.target.closest('.moment-action-item.comment')) {
            commentInputArea.style.display = 'none';
        }
    });

    // 发送评论
    const sendComment = () => {
        const text = commentInput.value.trim();
        if (text && currentActionMomentId) {
            addMomentComment(currentActionMomentId, text, currentActionReplyTo);
            commentInput.value = '';
            commentInputArea.style.display = 'none';
            currentActionReplyTo = null; // 重置
            commentInput.placeholder = '评论';
        }
    };

    commentSendBtn?.addEventListener('click', sendComment);
    commentInput?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        sendComment();
    });
}

async function updateMomentsSignature(newSignature) {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char) return;

    char.momentsSignature = newSignature;
    if (!char.history) char.history = [];

    const timestamp = Date.now();
    const noticeText = `${char.myName || '我'}更改了${char.realName}的个性签名为：${newSignature}`;

    // 可见通知负责展示；隐藏消息负责让后续上下文知道这次修改。
    char.history.push(
        {
            id: `msg_visual_signature_${timestamp}`,
            role: 'system',
            content: `[system-display:${noticeText}]`,
            timestamp,
            isContextDisabled: true
        },
        {
            id: `msg_context_signature_${timestamp}`,
            role: 'user',
            content: `[system: ${noticeText}]`,
            timestamp: timestamp + 1,
            isContextDisabled: false
        }
    );

    await saveData();
    renderMomentsScreen();
    if (typeof renderMessages === 'function') renderMessages(false, false);
    if (typeof renderChatList === 'function') renderChatList();
    showToast('个性签名已修改');
}

function renderMomentsScreen() {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char) return;

    // 渲染封面和用户信息
    const coverImg = document.getElementById('moments-cover-img');
    const userAvatar = document.getElementById('moments-user-avatar');
    const userName = document.getElementById('moments-user-name');

    const peekSettings = char.peekScreenSettings || {};
    // 优先使用自定义封面，其次是手机壁纸，然后是全局壁纸，最后是随机图
    coverImg.src = peekSettings.momentsCover || peekSettings.wallpaper || db.wallpaper || MOMENT_PLACEHOLDER_IMAGES[Math.floor(Math.random() * MOMENT_PLACEHOLDER_IMAGES.length)];
    
    userAvatar.src = char.avatar;
    userName.textContent = (char.remarkName && char.remarkName.trim()) || char.realName || 'Character';
    
    const signatureEl = document.getElementById('moments-user-signature');
    if (signatureEl) {
        signatureEl.textContent = char.momentsSignature || '暂时没有设置签名。';
    }

    // 渲染动态列表
    const feedContainer = document.getElementById('moments-feed-container');
    const moments = char.moments || [];

    if (moments.length === 0) {
        feedContainer.innerHTML = '<div style="text-align: center; padding: 50px; color: #999;">暂无动态</div>';
        return;
    }

    // 按时间倒序排列
    const sortedMoments = [...moments].sort((a, b) => b.timestamp - a.timestamp);
    
    let html = '';
    sortedMoments.forEach(moment => {
        // 处理图片
        let imagesHtml = '';
        if (moment.imageDescription) {
            const randomPlaceholder = MOMENT_PLACEHOLDER_IMAGES[Math.floor(Math.random() * MOMENT_PLACEHOLDER_IMAGES.length)];
            // 使用 pre-wrap 来保留换行和空格
            const descriptionHtml = `<div class="moment-image-description-text" style="white-space: pre-wrap;">${moment.imageDescription}</div>`;
            imagesHtml = `
                <div class="moment-images single">
                    <div class="moment-image-wrapper">
                        ${descriptionHtml}
                        <div class="moment-image-curtain">
                            <img src="${randomPlaceholder}" alt="占位图">
                            <div class="curtain-hint">点击查看</div>
                        </div>
                    </div>
                </div>
            `;
        } else if (moment.images && moment.images.length > 0) {
            const isSingle = moment.images.length === 1;
            imagesHtml = `<div class="moment-images ${isSingle ? 'single' : ''}">`;
            moment.images.forEach(img => {
                imagesHtml += `<img src="${img}" class="moment-img" alt="配图">`;
            });
            imagesHtml += `</div>`;
        }

        // 处理点赞
        let likesHtml = '';
        if (moment.likes && moment.likes.length > 0) {
            likesHtml = `
                <div class="moment-likes">
                    <svg viewBox="0 0 24 24"><path d="M12,21.35L10.55,20.03C5.4,15.36,2,12.27,2,8.5C2,5.42,4.42,3,7.5,3c1.74,0,3.41,0.81,4.5,2.09C13.09,3.81,14.76,3,16.5,3C19.58,3,22,5.42,22,8.5c0,3.78-3.4,6.86-8.55,11.54L12,21.35z"></path></svg>
                    ${moment.likes.join(', ')}
                </div>
            `;
        }

        // 处理评论
        let commentsHtml = '';
        if (moment.comments && moment.comments.length > 0) {
            commentsHtml = '<div class="moment-comments">';
            moment.comments.forEach(comment => {
                // 确保评论有 ID，如果没有则生成一个临时的（兼容旧数据）
                const commentId = comment.id || `comment_${Math.random().toString(36).substr(2, 9)}`;
                if (comment.replyTo) {
                    commentsHtml += `<div class="moment-comment" data-comment-id="${commentId}"><span class="moment-comment-name">${comment.author}</span> 回复 <span class="moment-comment-name">${comment.replyTo}</span>: <span class="moment-comment-text">${comment.content}</span></div>`;
                } else {
                    commentsHtml += `<div class="moment-comment" data-comment-id="${commentId}"><span class="moment-comment-name">${comment.author}</span>: <span class="moment-comment-text">${comment.content}</span></div>`;
                }
            });
            commentsHtml += '</div>';
        }

        // 互动区容器
        let interactionHtml = '';
        if (likesHtml || commentsHtml) {
            interactionHtml = `
                <div class="moment-interaction">
                    ${likesHtml}
                    ${commentsHtml}
                </div>
            `;
        }

        // 时间格式化
        const timeStr = formatMomentTime(moment.timestamp);

        html += `
            <div class="moment-item" data-id="${moment.id}">
                <img src="${char.avatar}" class="moment-avatar" alt="Avatar">
                <div class="moment-main">
                    <div class="moment-name">${(char.remarkName && char.remarkName.trim()) || char.realName || 'Character'}</div>
                    <div class="moment-text">${moment.content.replace(/\n/g, '<br>')}</div>
                    ${imagesHtml}
                    <div class="moment-footer">
                        <span class="moment-time">${timeStr}</span>
                        <div style="position: relative;">
                            <button class="moment-action-btn">···</button>
                            <div class="moment-action-popup">
                                <div class="moment-action-item like">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12,21.35L10.55,20.03C5.4,15.36,2,12.27,2,8.5C2,5.42,4.42,3,7.5,3c1.74,0,3.41,0.81,4.5,2.09C13.09,3.81,14.76,3,16.5,3C19.58,3,22,5.42,22,8.5c0,3.78-3.4,6.86-8.55,11.54L12,21.35z"></path></svg>
                                    赞
                                </div>
                                <div class="moment-action-item comment">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9,22A1,1 0 0,1 8,21V18H4A2,2 0 0,1 2,16V4C2,2.89 2.9,2 4,2H20A2,2 0 0,1 22,4V16A2,2 0 0,1 20,18H13.9L10.2,21.71C10,21.9 9.75,22 9.5,22V22H9Z"></path></svg>
                                    评论
                                </div>
                            </div>
                        </div>
                    </div>
                    ${interactionHtml}
                </div>
            </div>
        `;
    });

    feedContainer.innerHTML = html;
}

function formatMomentTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 172800000) return '昨天';
    
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
}

async function toggleMomentLike(momentId) {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char || !char.moments) return;

    const moment = char.moments.find(m => m.id === momentId);
    if (!moment) return;

    if (!moment.likes) moment.likes = [];
    
    const myName = char.myName || '我';
    const index = moment.likes.indexOf(myName);
    
    const momentSnippet = moment.content.substring(0, 20); // 缩略内容
    let systemMsg = '';

    if (index > -1) {
        moment.likes.splice(index, 1);
        systemMsg = `[system: ${myName}取消点赞了${char.realName}的动态：${momentSnippet}...]`;
        char.history.push({
            id: `msg_${Date.now()}_${Math.random()}`,
            role: 'user',
            content: systemMsg,
            timestamp: Date.now(),
            isContextDisabled: true // 取消点赞不进入上下文
        });
    } else {
        moment.likes.push(myName);
        systemMsg = `[system: ${myName}点赞了${char.realName}的动态：${momentSnippet}...]`;
        char.history.push({
            id: `msg_${Date.now()}_${Math.random()}`,
            role: 'user',
            content: systemMsg,
            timestamp: Date.now(),
            isContextDisabled: false // 点赞进入上下文
        });
    }

    await saveData();
    renderMomentsScreen();
    if (typeof renderMessages === 'function') renderMessages(false, false);
}

async function deleteMoment(momentId) {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char || !char.moments) return;

    const momentIndex = char.moments.findIndex(m => m.id === momentId);
    if (momentIndex > -1) {
        const momentToDelete = char.moments[momentIndex];
        
        // 1. 从聊天记录中删除对应的指令消息
        // 寻找包含该动态内容的原始指令消息
        const snippet = momentToDelete.content.substring(0, 20);
        const msgIndex = char.history.findIndex(m => 
            m.content.includes('发布了一条动态') && m.content.includes(snippet) ||
            m.content.includes('发布了一条带图动态') && m.content.includes(snippet)
        );
        
        if (msgIndex > -1) {
            char.history.splice(msgIndex, 1);
        }

        // 2. 删除动态本身
        char.moments.splice(momentIndex, 1);
        
        await saveData();
        renderMomentsScreen();
        if (typeof renderMessages === 'function') renderMessages(false, false);
        showToast('动态已删除');
    }
}

async function deleteMomentComment(momentId, commentId) {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char || !char.moments) return;

    const moment = char.moments.find(m => m.id === momentId);
    if (!moment || !moment.comments) return;

    const commentIndex = moment.comments.findIndex(c => c.id === commentId);
    if (commentIndex > -1) {
        const commentToDelete = moment.comments[commentIndex];
        
        // 1. 从聊天记录中删除对应的指令消息
        const msgIndex = char.history.findIndex(m => 
            (m.content.includes('评论了') || m.content.includes('回复了')) && 
            m.content.includes(commentToDelete.content)
        );
        
        if (msgIndex > -1) {
            char.history.splice(msgIndex, 1);
        }

        // 2. 删除评论本身
        moment.comments.splice(commentIndex, 1);
        
        await saveData();
        renderMomentsScreen();
        if (typeof renderMessages === 'function') renderMessages(false, false);
        showToast('评论已删除');
    }
}

async function addMomentComment(momentId, text, replyTo = null) {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char || !char.moments) return;

    const moment = char.moments.find(m => m.id === momentId);
    if (!moment) return;

    if (!moment.comments) moment.comments = [];
    
    const myName = char.myName || '我';
    
    const newComment = {
        id: `comment_${Date.now()}`,
        author: myName,
        content: text,
        timestamp: Date.now()
    };

    if (replyTo) {
        newComment.replyTo = replyTo;
    }

    moment.comments.push(newComment);

    // 插入系统消息到历史记录，让AI知道
    const momentSnippet = moment.content.substring(0, 20);
    let systemMsg = '';
    if (replyTo) {
        systemMsg = `[system: ${myName}回复了${replyTo}在${char.realName}的动态“${momentSnippet}...”下的评论：${text}]`;
    } else {
        systemMsg = `[system: ${myName}评论了${char.realName}的动态“${momentSnippet}...”：${text}]`;
    }

    char.history.push({
        id: `msg_${Date.now()}_${Math.random()}`,
        role: 'user',
        content: systemMsg,
        timestamp: Date.now(),
        isContextDisabled: false // 评论进入上下文
    });

    await saveData();
    renderMomentsScreen();
    if (typeof renderMessages === 'function') renderMessages(false, false);
}

function renderPeekSettings() {
    const character = db.characters.find(c => c.id === currentChatId);
    const peekSettings = character?.peekScreenSettings || {};
    const genCounts = peekSettings.generationCounts || {};

    const defaultCounts = {
        messages: 5,
        album: 6,
        memos: 3,
        cart: 4,
        browser: 5,
        transfer: 6,
        drafts: 1,
        steps: 6,
        unlock: 4,
        bag: 5
    };

    const groups = {
        social: ['messages', 'unlock'],
        life: ['album', 'memos', 'steps', 'bag'],
        tools: ['cart', 'browser', 'transfer', 'drafts']
    };

    const renderList = (containerId, appIds) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        appIds.forEach(appId => {
            const appData = peekScreenApps[appId];
            if (!appData) return;

            const count = genCounts[appId] || defaultCounts[appId] || 5;
            const item = document.createElement('div');
            item.className = 'peek-settings-item';
            item.innerHTML = `
                <div class="peek-settings-item-icon">
                    <img src="${appData.url}" style="width: 20px; height: 20px; border-radius: 4px;">
                </div>
                <div class="peek-settings-item-info">
                    <div class="peek-settings-item-name">${appData.name}</div>
                </div>
                <div class="peek-settings-item-control">
                    <input type="number" data-app-id="${appId}" value="${count}" min="1" max="20">
                </div>
            `;
            container.appendChild(item);
        });
    };

    renderList('peek-gen-social-list', groups.social);
    renderList('peek-gen-life-list', groups.life);
    renderList('peek-gen-tools-list', groups.tools);
}

function renderPeekAlbum(photos) {
    const screen = document.getElementById('peek-album-screen');
    const grid = screen.querySelector('.album-grid');
    grid.innerHTML = ''; 

    if (!photos || photos.length === 0) {
        grid.innerHTML = '<p class="placeholder-text">正在生成相册内容...</p>';
        return;
    }

    photos.forEach(photo => {
        const photoEl = document.createElement('div');
        photoEl.className = 'album-photo';
        photoEl.dataset.imageDescription = photo.imageDescription;
        photoEl.dataset.description = photo.description;

        const img = document.createElement('img');
        img.src = 'https://i.postimg.cc/1tH6ds9g/1752301200490.jpg'; 
        img.alt = "相册照片";
        photoEl.appendChild(img);

        if (photo.type === 'video') {
            const videoIndicator = document.createElement('div');
            videoIndicator.className = 'video-indicator';
            videoIndicator.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>`;
            photoEl.appendChild(videoIndicator);
        }
        
        photoEl.addEventListener('click', () => {
            const modal = document.getElementById('peek-photo-modal');
            const imgContainer = document.getElementById('peek-photo-image-container');
            const descriptionEl = document.getElementById('peek-photo-description');
            
            imgContainer.innerHTML = `<div style="padding: 20px; text-align: left; color: #555; font-size: 16px; line-height: 1.6; height: 100%; overflow-y: auto;">${photo.imageDescription}</div>`;
            descriptionEl.textContent = `批注：${photo.description}`;
            
            modal.classList.add('visible');
        });

        grid.appendChild(photoEl);
    });
}

function renderPeekUnlock(data) {
    const screen = document.getElementById('peek-unlock-screen');
    if (!screen) return;

    if (!data) {
        screen.innerHTML = `
            <header class="app-header">
                <button class="back-btn" data-target="peek-screen">‹</button>
                <div class="title-container"><h1 class="title">...</h1></div>
                <button class="action-btn">···</button>
            </header>
            <main class="content"><p class="placeholder-text">正在生成小号内容...</p></main>
        `;
        return;
    }

    const { nickname, handle, bio, posts } = data;
    const character = db.characters.find(c => c.id === currentChatId);
    const peekSettings = character?.peekScreenSettings || { unlockAvatar: '' };
    const fixedAvatar = peekSettings.unlockAvatar || 'https://i.postimg.cc/SNwL1XwR/chan-11.png';

    const randomFollowers = (Math.random() * 5 + 1).toFixed(1) + 'k';
    const randomFollowing = Math.floor(Math.random() * 500) + 50;

    let postsHtml = '';
    if (posts && posts.length > 0) {
        posts.forEach(post => {
            const randomComments = Math.floor(Math.random() * 100);
            const randomLikes = Math.floor(Math.random() * 500);
            postsHtml += `
                <div class="unlock-post-card">
                    <div class="unlock-post-card-header">
                        <img src="${fixedAvatar}" alt="Profile Avatar">
                        <div class="unlock-post-card-author-info">
                            <span class="username">${nickname}</span>
                            <span class="timestamp">${post.timestamp}</span>
                        </div>
                    </div>
                    <div class="unlock-post-card-content">
                        ${post.content.replace(/\n/g, '<br>')}
                    </div>
                    <div class="unlock-post-card-actions">
                        <div class="action"><svg viewBox="0 0 24 24"><path d="M18,16.08C17.24,16.08 16.56,16.38 16.04,16.85L8.91,12.7C8.96,12.47 9,12.24 9,12C9,11.76 8.96,11.53 8.91,11.3L16.04,7.15C16.56,7.62 17.24,7.92 18,7.92C19.66,7.92 21,6.58 21,5C21,3.42 19.66,2 18,2C16.34,2 15,3.42 15,5C15,5.24 15.04,5.47 15.09,5.7L7.96,9.85C7.44,9.38 6.76,9.08 6,9.08C4.34,9.08 3,10.42 3,12C3,13.58 4.34,14.92 6,14.92C6.76,14.92 7.44,14.62 7.96,14.15L15.09,18.3C15.04,18.53 15,18.76 15,19C15,20.58 16.34,22 18,22C19.66,22 21,20.58 21,19C21,17.42 19.66,16.08 18,16.08Z"></path></svg> <span>分享</span></div>
                        <div class="action"><svg viewBox="0 0 24 24"><path d="M20,2H4C2.9,0,2,0.9,2,2v18l4-4h14c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2z M18,14H6v-2h12V14z M18,11H6V9h12V11z M18,8H6V6h12V8z"></path></svg> <span>${randomComments}</span></div>
                        <div class="action"><svg viewBox="0 0 24 24"><path d="M12,21.35L10.55,20.03C5.4,15.36,2,12.27,2,8.5C2,5.42,4.42,3,7.5,3c1.74,0,3.41,0.81,4.5,2.09C13.09,3.81,14.76,3,16.5,3C19.58,3,22,5.42,22,8.5c0,3.78-3.4,6.86-8.55,11.54L12,21.35z"></path></svg> <span>${randomLikes}</span></div>
                    </div>
                </div>
            `;
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container">
                <h1 class="title">${nickname}</h1>
            </div>
            <button class="action-btn" id="refresh-unlock-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content">
            <div class="unlock-profile-header">
                <img src="${fixedAvatar}" alt="Profile Avatar" class="unlock-profile-avatar">
                <div class="unlock-profile-info">
                    <h2 class="unlock-profile-username">${nickname}</h2>
                    <p class="unlock-profile-handle">${handle}</p>
                </div>
            </div>
            <div class="unlock-profile-bio">
                <p>${bio.replace(/\n/g, '<br>')}</p>
            </div>
            <div class="unlock-profile-stats">
                <div class="unlock-profile-stat">
                    <span class="count">${posts.length}</span>
                    <span class="label">帖子</span>
                </div>
                <div class="unlock-profile-stat">
                    <span class="count">${randomFollowers}</span>
                    <span class="label">粉丝</span>
                </div>
                <div class="unlock-profile-stat">
                    <span class="count">${randomFollowing}</span>
                    <span class="label">关注</span>
                </div>
            </div>
            <div class="unlock-post-feed">
                ${postsHtml}
            </div>
        </main>
    `;

    screen.querySelector('#refresh-unlock-btn').addEventListener('click', () => {
        generateAndRenderPeekContent('unlock', { forceRefresh: true });
    });
}

function renderPeekConversation(history, partnerName) {
    const titleEl = document.getElementById('peek-conversation-title');
    const messageAreaEl = document.getElementById('peek-message-area');

    titleEl.textContent = partnerName;
    messageAreaEl.innerHTML = '';

    if (!history || history.length === 0) {
        messageAreaEl.innerHTML = '<p class="placeholder-text">正在生成对话...</p>';
        return;
    }

    history.forEach(msg => {
        const isSentByChar = msg.sender === 'char'; 
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isSentByChar ? 'sent' : 'received'}`;

        const bubbleRow = document.createElement('div');
        bubbleRow.className = 'message-bubble-row';

        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${isSentByChar ? 'sent' : 'received'}`;
        bubble.textContent = msg.content;

        if (isSentByChar) {
            bubbleRow.appendChild(bubble);
        } else {
            const avatar = document.createElement('img');
            avatar.className = 'message-avatar';
            avatar.src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
            bubbleRow.appendChild(avatar);
            bubbleRow.appendChild(bubble);
        }
        
        wrapper.appendChild(bubbleRow);
        messageAreaEl.appendChild(wrapper);
    });
    messageAreaEl.scrollTop = messageAreaEl.scrollHeight;
}

function renderPeekScreen() {
    const peekScreen = document.getElementById('peek-screen');
    const contentArea = peekScreen.querySelector('main.content');

    contentArea.innerHTML = `
        <div class="time-widget">
            <div class="time" id="peek-time-display"></div>
            <div class="date" id="peek-date-display"></div>
        </div>
        <div class="app-grid"></div>
    `;

    const character = db.characters.find(c => c.id === currentChatId);
    const peekSettings = character?.peekScreenSettings || { wallpaper: '', customIcons: {} };

    const wallpaper = peekSettings.wallpaper;
    if (wallpaper) {
        peekScreen.style.backgroundImage = `url(${wallpaper})`;
    } else {
        peekScreen.style.backgroundImage = `url(${db.wallpaper})`; 
    }
    peekScreen.style.backgroundSize = 'cover';
    peekScreen.style.backgroundPosition = 'center';

    const appGrid = contentArea.querySelector('.app-grid');
    Object.keys(peekScreenApps).forEach(id => {
        const iconData = peekScreenApps[id];
        const iconEl = document.createElement('a');
        iconEl.href = '#';
        iconEl.className = 'app-icon';
        iconEl.dataset.peekAppId = id;
        const customIconUrl = peekSettings.customIcons?.[id];
        const iconUrl = customIconUrl || iconData.url;
        iconEl.innerHTML = `
            <img src="${iconUrl}" alt="${iconData.name}" class="icon-img">
            <span class="app-name">${iconData.name}</span>
        `;
        iconEl.addEventListener('click', (e) => {
            e.preventDefault();
            if (isBatchMode) {
                if (selectedApps.has(id)) {
                    selectedApps.delete(id);
                    iconEl.classList.remove('selected');
                } else {
                    if (selectedApps.size >= 4) {
                        showToast('最多只能选择4个应用');
                        return;
                    }
                    selectedApps.add(id);
                    iconEl.classList.add('selected');
                }
                updateBatchCount();
            } else {
                generateAndRenderPeekContent(id);
            }
        });
        appGrid.appendChild(iconEl);
    });

    updateClock();
}

function renderPeekChatList(conversations = []) {
    const container = document.getElementById('peek-chat-list-container');
    container.innerHTML = '';

    if (!conversations || conversations.length === 0) {
        return;
    }

    conversations.forEach((convo) => {
        const history = convo.history || [];
        const lastMessage = history.length > 0 ? history[history.length - 1] : null;
        const lastMessageText = lastMessage ? (lastMessage.content || '').replace(/\[.*?的消息：([\s\S]+)\]/, '$1') : '...';
        
        const li = document.createElement('li');
        li.className = 'list-item chat-item';
        li.dataset.name = convo.partnerName;

        const avatarUrl = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';

        li.innerHTML = `
            <img src="${avatarUrl}" alt="${convo.partnerName}" class="chat-avatar">
            <div class="item-details">
                <div class="item-details-row"><div class="item-name">${convo.partnerName}</div></div>
                <div class="item-preview-wrapper">
                    <div class="item-preview">${lastMessageText}</div>
                </div>
            </div>`;
        container.appendChild(li);
    });
}

function renderMemosList(memos) {
    const screen = document.getElementById('peek-memos-screen');
    let listHtml = '';
    if (!memos || memos.length === 0) {
        listHtml = '<p class="placeholder-text">正在生成备忘录...</p>';
    } else {
        memos.forEach(memo => {
            const firstLine = memo.content.split('\n')[0];
            listHtml += `
                <li class="memo-item" data-id="${memo.id}">
                    <h3 class="memo-item-title">${memo.title}</h3>
                    <p class="memo-item-preview">${firstLine}</p>
                </li>
            `;
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">备忘录</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content"><ul id="peek-memos-list">${listHtml}</ul></main>
    `;

    screen.querySelector('.action-btn').addEventListener('click', () => {
        generateAndRenderPeekContent('memos', { forceRefresh: true });
    });

    screen.querySelectorAll('.memo-item').forEach(item => {
        item.addEventListener('click', () => {
            const memo = memos.find(m => m.id === item.dataset.id); 
    
            if (memo) {
                renderMemoDetail(memo);
                switchScreen('peek-memo-detail-screen');
            }
        });
    });
}

function renderMemoDetail(memo) {
    const screen = document.getElementById('peek-memo-detail-screen');
    if (!memo) return;
    const contentHtml = memo.content.replace(/\n/g, '<br>');
    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-memos-screen">‹</button>
            <div class="title-container"><h1 class="title">${memo.title}</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content" style="padding: 20px; line-height: 1.6;">${contentHtml}</main>
    `;
}

function renderPeekCart(items) {
    const screen = document.getElementById('peek-cart-screen');
    let itemsHtml = '';
    let totalPrice = 0;

    if (!items || items.length === 0) {
        itemsHtml = '<p class="placeholder-text">正在生成购物车内容...</p>';
    } else {
        items.forEach(item => {
            itemsHtml += `
                <li class="cart-item" data-id="${item.id}">
                    <img src="https://i.postimg.cc/wMbSMvR9/export202509181930036600.png" class="cart-item-image" alt="${item.title}">
                    <div class="cart-item-details">
                        <h3 class="cart-item-title">${item.title}</h3>
                        <p class="cart-item-spec">规格：${item.spec}</p>
                        <p class="cart-item-price">¥${item.price}</p>
                    </div>
                </li>
            `;
            totalPrice += parseFloat(item.price);
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">购物车</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content"><ul class="cart-item-list">${itemsHtml}</ul></main>
        <footer class="cart-footer">
            <div class="cart-total-price">
                <span class="label">合计：</span>¥${totalPrice.toFixed(2)}
            </div>
            <button class="checkout-btn">结算</button>
        </footer>
    `;
    
    screen.querySelector('.action-btn').addEventListener('click', () => {
        generateAndRenderPeekContent('cart', { forceRefresh: true });
    });
    screen.querySelector('.checkout-btn').addEventListener('click', async () => {
        const char = db.characters.find(c => c.id === currentChatId);
        if (!char) return;

        const cartItems = char.peekData?.cart?.items;
        if (!cartItems || cartItems.length === 0) {
            showToast('购物车是空的');
            return;
        }

        let totalPrice = 0;
        const itemsStrList = [];

        cartItems.forEach(item => {
            totalPrice += parseFloat(item.price);
            itemsStrList.push(`${item.title} x1`);
        });

        const itemsStr = itemsStrList.join(', ');
        const myName = char.myName;
        const realName = char.realName;

        // 清空购物车
        char.peekData.cart.items = [];
        await saveData();
        
        renderPeekCart([]);

        // 跳转回聊天界面
        switchScreen('chat-room-screen');

        // 发送消息
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-message-btn');

        if (input && sendBtn) {
            // 1. 发送系统提示
            input.value = `[system-display:${myName}帮${realName}清空了ta的购物车]`;
            sendBtn.click();

            // 2. 延迟发送订单消息
            setTimeout(() => {
                input.value = `[${myName}为${realName}下单了：即时送达|${totalPrice.toFixed(2)}|${itemsStr}]`;
                sendBtn.click();
            }, 300);
        }
    });
}

function renderPeekTransferStation(entries) {
    const screen = document.getElementById('peek-transfer-station-screen');
    let messagesHtml = '';

    if (!entries || entries.length === 0) {
        messagesHtml = '<p class="placeholder-text">正在生成中转站内容...</p>';
    } else {
        entries.forEach(entry => {
            messagesHtml += `
                <div class="message-wrapper sent">
                    <div class="message-bubble-row">
                        <div class="message-bubble sent" style="background-color: #98E165; color: #000;">${entry}</div>
                    </div>
                </div>
            `;
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container">
                <h1 class="title">文件传输助手</h1>
            </div>
            <button class="action-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg>
            </button>
        </header>
        <main class="content">
            <div class="message-area" style="padding: 10px;">
                ${messagesHtml}
            </div>
            <div class="transfer-station-input-area">
                <div class="fake-input"></div>
                <button class="plus-btn"></button>
            </div>
        </main>
    `;
    
    screen.querySelector('.action-btn').addEventListener('click', () => {
        generateAndRenderPeekContent('transfer', { forceRefresh: true });
    });

    const messageArea = screen.querySelector('.message-area');
    if (messageArea) {
        messageArea.scrollTop = messageArea.scrollHeight;
    }
}

function renderPeekBrowser(historyItems) {
    const screen = document.getElementById('peek-browser-screen');
    let itemsHtml = '';
    if (!historyItems || historyItems.length === 0) {
        itemsHtml = '<p class="placeholder-text">正在生成浏览记录...</p>';
    } else {
        historyItems.forEach(item => {
            itemsHtml += `
                <li class="browser-history-item">
                    <h3 class="history-item-title">${item.title}</h3>
                    <p class="history-item-url">${item.url}</p>
                    <div class="history-item-annotation">${item.annotation}</div>
                </li>
            `;
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">浏览器</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content"><ul class="browser-history-list">${itemsHtml}</ul></main>
    `;
    screen.querySelector('.action-btn').addEventListener('click', () => {
        generateAndRenderPeekContent('browser', { forceRefresh: true });
    });
}

function renderPeekDrafts(drafts) {
    const screen = document.getElementById('peek-drafts-screen');
    
    // 兼容旧格式：如果传入的是单个对象而非数组
    if (drafts && !Array.isArray(drafts) && typeof drafts === 'object') {
        drafts = [drafts];
    }

    if (!drafts || drafts.length === 0) {
        screen.innerHTML = `
            <header class="app-header">
                <button class="back-btn" data-target="peek-screen">‹</button>
                <div class="title-container"><h1 class="title">草稿箱</h1></div>
                <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
            </header>
            <main class="content">
                <p class="placeholder-text">正在生成草稿...</p>
            </main>
        `;
        screen.querySelector('.action-btn').addEventListener('click', () => {
            generateAndRenderPeekContent('drafts', { forceRefresh: true });
        });
        return;
    }

    // Slider implementation
    let html = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">草稿箱</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content drafts-slider-container">
            <div class="drafts-slider-track">`;

    // Add clones for infinite loop: [Last, Item1, Item2, ..., ItemN, First]
    const items = [drafts[drafts.length - 1], ...drafts, drafts[0]];
    
    items.forEach((draft) => {
        // 处理换行并允许 HTML 标签（如删除线）
        // 同时对每一行进行 trim() 处理，消除 AI 产生的多余缩进空格
        const formattedContent = (draft.content || '')
            .split('\n')
            .map(line => line.trim())
            .join('<br>');
            
        html += `
            <div class="draft-slide">
                <div class="draft-paper">
                    <div class="draft-to">To: ${draft.to}</div>
                    <div class="draft-content">${formattedContent}</div>
                </div>
            </div>`;
    });

    html += `
            </div>
            <div class="draft-indicators">
                ${drafts.map((_, i) => `<span class="indicator ${i === 0 ? 'active' : ''}"></span>`).join('')}
            </div>
        </main>
    `;

    screen.innerHTML = html;
    screen.querySelector('.action-btn').addEventListener('click', () => {
        generateAndRenderPeekContent('drafts', { forceRefresh: true });
    });

    // Slider Logic
    const track = screen.querySelector('.drafts-slider-track');
    const indicators = screen.querySelectorAll('.indicator');
    let currentIndex = 1; // Start at the first real item
    let startX = 0;
    let currentTranslate = 0;
    let prevTranslate = 0;
    let animationID = 0;
    let isDragging = false;
    let startTime = 0;

    const setSliderPosition = () => {
        track.style.transform = `translateX(${currentTranslate}px)`;
    };

    const updateTranslate = () => {
        currentTranslate = -currentIndex * screen.offsetWidth;
        prevTranslate = currentTranslate;
        setSliderPosition();
    };

    // Initial position
    updateTranslate();

    const touchStart = (event) => {
        isDragging = true;
        startX = event.type.includes('mouse') ? event.pageX : event.touches[0].clientX;
        startTime = Date.now();
        track.style.transition = 'none';
        animationID = requestAnimationFrame(animation);
    };

    const touchMove = (event) => {
        if (isDragging) {
            const currentX = event.type.includes('mouse') ? event.pageX : event.touches[0].clientX;
            currentTranslate = prevTranslate + currentX - startX;
        }
    };

    const touchEnd = () => {
        isDragging = false;
        cancelAnimationFrame(animationID);
        
        const movedBy = currentTranslate - prevTranslate;
        const timeElapsed = Date.now() - startTime;
        const velocity = Math.abs(movedBy) / timeElapsed;

        // Swipe detection: moved more than 1/3 width or high velocity
        if (movedBy < -screen.offsetWidth / 3 || (velocity > 0.5 && movedBy < 0)) {
            currentIndex += 1;
        } else if (movedBy > screen.offsetWidth / 3 || (velocity > 0.5 && movedBy > 0)) {
            currentIndex -= 1;
        }

        transitionToSlide();
    };

    const transitionToSlide = () => {
        track.style.transition = 'transform 0.3s ease-out';
        currentTranslate = -currentIndex * screen.offsetWidth;
        prevTranslate = currentTranslate;
        setSliderPosition();

        // Handle infinite loop after transition
        setTimeout(() => {
            if (currentIndex === 0) {
                currentIndex = drafts.length;
                track.style.transition = 'none';
                updateTranslate();
            } else if (currentIndex === drafts.length + 1) {
                currentIndex = 1;
                track.style.transition = 'none';
                updateTranslate();
            }
            updateIndicators();
        }, 300);
    };

    const updateIndicators = () => {
        indicators.forEach((dot, i) => {
            dot.classList.toggle('active', i === (currentIndex - 1 + drafts.length) % drafts.length);
        });
    };

    const animation = () => {
        setSliderPosition();
        if (isDragging) requestAnimationFrame(animation);
    };

    track.addEventListener('touchstart', touchStart, { passive: true });
    track.addEventListener('touchend', touchEnd);
    track.addEventListener('touchmove', touchMove, { passive: true });
    track.addEventListener('mousedown', touchStart);
    track.addEventListener('mouseup', touchEnd);
    track.addEventListener('mousemove', touchMove);
    track.addEventListener('mouseleave', touchEnd);
}

function renderPeekSteps(data) {
    const screen = document.getElementById('peek-steps-screen');
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char) return; 

    const avatarEl = screen.querySelector('#steps-char-avatar');
    const nameEl = screen.querySelector('#steps-char-name');
    const currentStepsEl = screen.querySelector('#steps-current-count');
    const goalStepsEl = screen.querySelector('.steps-label');
    const progressRingEl = screen.querySelector('#steps-progress-ring');
    const trackListEl = screen.querySelector('#activity-track-list');
    const annotationEl = screen.querySelector('#steps-annotation-content');

    avatarEl.src = char.avatar;
    nameEl.textContent = char.realName;
    goalStepsEl.textContent = '/ 6000 步';

    if (!data) {
        currentStepsEl.textContent = '----';
        trackListEl.innerHTML = '<li class="activity-track-item">正在生成活动轨迹...</li>';
        annotationEl.textContent = '正在生成角色批注...';
        progressRingEl.style.setProperty('--steps-percentage', 0);
        return;
    }

    currentStepsEl.textContent = data.currentSteps;
    
    const percentage = (data.currentSteps / 6000) * 100;
    progressRingEl.style.setProperty('--steps-percentage', percentage);

    trackListEl.innerHTML = data.trajectory.map(item => `<li class="activity-track-item">${item}</li>`).join('');
    annotationEl.textContent = data.annotation;
}

function getAppPromptSnippet(char, appType, targetCount) {
    switch (appType) {
        case 'messages':
            return `
【消息应用】
请为 ${char.realName} 编造恰好 ${targetCount} 个最近的对话。对话内容需要强烈反映Ta的人设以及和我的聊天上下文。
<messages>
  <conversations>
    <conversation>
      <partnerName>与Ta对话的人的称呼</partnerName>
      <history>
        <message sender="char">${char.realName}发送的消息内容</message>
        <message sender="partner">对方发送的消息内容</message>
      </history>
    </conversation>
  </conversations>
</messages>`;
        case 'steps':
            return `
【步数应用】
请为 ${char.realName} 生成今天的步数信息。你需要生成Ta的当前步数(currentSteps)，Ta的恰好 ${targetCount} 条运动轨迹(trajectory)（禁止照搬示例）以及批注(annotation)。内容需要与Ta的人设和我们的聊天上下文高度相关。
<steps>
  <currentSteps>8102</currentSteps>
  <trajectory>
    <item>08:30 AM - 公司楼下咖啡馆</item>
    <item>10:00 AM - 宠物用品店</item>
  </trajectory>
  <annotation>角色对自己今天运动情况的批注</annotation>
</steps>`;
        case 'album':
            return `
【相册应用】
请为 ${char.realName} 的相册生成恰好 ${targetCount} 个条目（照片或视频）。内容需要与Ta的人设和我们的聊天上下文高度相关。'imageDescription' 是对这张照片/视频的详细文字描述，它将代替真实的图片展示给用户。'description' 是 ${char.realName} 自己对这张照片/视频的一句话批注，会显示在描述下方。
<album>
  <photos>
    <photo type="photo">
      <imageDescription>对一张照片的详细文字描述，例如：一张傍晚在海边的自拍，背景是橙色的晚霞和归来的渔船。</imageDescription>
      <description>角色对这张照片的一句话批注，例如：那天的风很舒服。</description>
    </photo>
    <photo type="video">
      <imageDescription>对一段视频的详细文字描述，例如：一段在猫咖撸猫的视频，视频里有一只橘猫在打哈欠。</imageDescription>
      <description>角色对这段视频的一句话批注，例如：下次还来这里！</description>
    </photo>
  </photos>
</album>`;
        case 'memos':
            return `
【备忘录应用】
请生成恰好 ${targetCount} 条备忘录，内容要与Ta的人设和我们的聊天上下文相关。
<memos>
  <memo id="memo_1">
    <title>备忘录标题</title>
    <content>备忘录内容，可以包含换行符</content>
  </memo>
</memos>`;
        case 'cart':
            return `
【购物车应用】
请生成恰好 ${targetCount} 件商品，这些商品应该反映Ta的兴趣、需求或我们最近聊到的话题。
<cart>
  <items>
    <item id="cart_1">
      <title>商品标题</title>
      <spec>商品规格</spec>
      <price>25.00</price>
    </item>
  </items>
</cart>`;
        case 'browser':
            return `
【浏览器历史记录】
请生成恰好 ${targetCount} 条浏览记录。记录本身要符合Ta的人设和我们的聊天上下文，'annotation'字段则要站在角色自己的视角，记录Ta对这条浏览记录的想法或批注。
<browser>
  <history>
    <item>
      <title>网页标题</title>
      <url>example.com/path</url>
      <annotation>角色对于这条浏览记录的想法或批注</annotation>
    </item>
  </history>
</browser>`;
        case 'drafts':
            return `
【草稿箱】
请生成恰好 ${targetCount} 份Ta写给我但犹豫未决、未发送的草稿。内容要深刻、细腻，反映Ta的内心挣扎和与我的关系。
<drafts>
  <draft>
    <to>${char.myName}</to>
    <content>一封写给我但未发送的草稿内容，可以使用HTML的<span class='strikethrough'></span>标签来表示划掉的文字。</content>
  </draft>
</drafts>`;
        case 'transfer':
            return `
【文件传输助手】
请为 ${char.realName} 生成恰好 ${targetCount} 条Ta发送给自己的、简短零碎的消息。这些内容应该像是Ta的临时备忘、灵感闪现或随手保存的链接，要与Ta的人设和我们的聊天上下文相关，但比“备忘录”应用的内容更随意、更口语化。
<transfer>
  <entries>
    <entry>要记得买牛奶。</entry>
    <entry>https://example.com/interesting-article</entry>
    <entry>刚刚那个想法不错，可以深入一下...</entry>
  </entries>
</transfer>`;
        case 'unlock':
            return `
【微博小号】
请为 ${char.realName} 生成一个符合其人设的微博小号。你需要生成昵称、ID、个性签名，以及恰好 ${targetCount} 条最近的微博。微博内容要生活化、碎片化，符合小号的风格，并与Ta的人设和我们的聊天上下文高度相关。
<unlock>
  <nickname>角色的微博昵称</nickname>
  <handle>@角色的微博ID</handle>
  <bio>角色的个性签名，可以包含换行符</bio>
  <posts>
    <post>
      <timestamp>2小时前</timestamp>
      <content>第一条微博正文内容，140字以内。</content>
    </post>
    <post>
      <timestamp>昨天</timestamp>
      <content>第二条微博正文内容。</content>
    </post>
    <post>
      <timestamp>3天前</timestamp>
      <content>第三条微博正文内容。</content>
    </post>
  </posts>
</unlock>`;
        case 'bag':
            return `
【随身包包】
请为 ${char.realName} 生成Ta今天随身携带的包包款式(bagName)，以及包里恰好 ${targetCount} 件物品(items)。
'location' 是物品在包里的具体位置。
'name' 是物品的名称。
'annotation' 是Ta放进这件物品时，脑海中浮现的想法。
内容需要与Ta的人设和我们的聊天上下文相关，体现出生活细节。
<bag>
  <bagName>包包的款式描述，例如：黑色做旧复古邮差包</bagName>
  <items>
    <item>
      <location>在包里的侧边夹层袋内</location>
      <name>一盒薄荷糖</name>
      <annotation>Ta最近好像总是咳嗽……不知道会不会遇见Ta，算了，随身带着吧。</annotation>
    </item>
  </items>
</bag>`;
        default:
            return '';
    }
}

function generatePeekContentPrompt(char, appType, mainChatContext) {
    const appNameMapping = {
        messages: "消息应用（模拟与他人的对话）",
        memos: "备忘录应用",
        cart: "电商平台的购物车",
        transfer: "文件传输助手（用于记录临时想法、链接等）",
        browser: "浏览器历史记录",
        drafts: "邮件或消息的草稿箱",
        steps: "健康步数应用",
        unlock: "微博小号应用",
        bag: "随身包包（模拟翻找包里的物品）"
    };
    const appName = appNameMapping[appType] || appType;

    // 获取自定义生成条数
    const peekSettings = char.peekScreenSettings || {};
    const genCounts = peekSettings.generationCounts || {};
    const defaultCounts = {
        messages: 5, album: 6, memos: 3, cart: 4, browser: 5, transfer: 6, drafts: 1, steps: 6, unlock: 4, bag: 5
    };
    const targetCount = genCounts[appType] || defaultCounts[appType] || 5;

    const worldBooksLimitBreak = (char.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'limit_break'))
        .filter(Boolean)
        .sort((a, b) => (a.depth || 100) - (b.depth || 100))
        .map(wb => wb.content).join('\n');

    const worldBooksBefore = (char.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before'))
        .filter(Boolean)
        .sort((a, b) => (a.depth || 100) - (b.depth || 100))
        .map(wb => wb.content).join('\n');

    const worldBooksAfter = (char.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after'))
        .filter(Boolean)
        .sort((a, b) => (a.depth || 100) - (b.depth || 100))
        .map(wb => wb.content).join('\n');

    const worldBooksGuidelines = (char.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'guidelines'))
        .filter(Boolean)
        .sort((a, b) => (a.depth || 100) - (b.depth || 100))
        .map(wb => wb.content).join('\n');

    let prompt = `你正在模拟一个名为 ${char.realName} 的角色的手机内部信息。`;

    if (worldBooksLimitBreak) {
        prompt += `\n${worldBooksLimitBreak}\n`;
    }
    if (worldBooksBefore) {
        prompt += `\n为了更好地理解背景，请参考以下世界观设定：\n${worldBooksBefore}\n`;
    }
    prompt += `该角色的核心人设是：${char.persona}。\n`;

    if (worldBooksAfter) {
        prompt += `\n${worldBooksAfter}\n`;
    }

    if (worldBooksGuidelines) {
        prompt += `\n${worldBooksGuidelines}\n`;
    }

    if (char.myPersona) {
        prompt += `\n作为参考，我（用户）的人设是：${char.myPersona}\n`;
    }

    prompt += `最近，我（称呼为 ${char.myName}）和 ${char.realName} 的对话如下（这是你们关系和当前状态的核心参考）：\n---\n${mainChatContext}\n---\n`;
    prompt += `现在，我正在偷看Ta手机上的“${appName}”。请你基于Ta的人设和我们最近的聊天内容，生成符合该应用场景的、高度相关且富有沉浸感的内容。\n`;
    
    if (char.bilingualModeEnabled) {
        prompt += `✨双语模式特别指令✨：当Ta的母语为中文以外的语言时，你的app内容文本**必须**遵循双语模式下的形式：{外语原文}「中文翻译」,例如: Of course, I'd love to.「当然，我很乐意。」,主要语言逻辑为角色母语，中文翻译文本视为系统自翻译，不视为原话;当需要表达中文时，需要根据角色设定自行判断对于中文的熟悉程度。这条规则的优先级非常高，请务必遵守。\n`;
    }

    prompt += `你的输出必须是XML格式，且只包含XML内容，必须以<result>作为根节点，不要有任何额外的解释或标记。根据应用类型，XML结构如下：\n`;

    prompt += `<result>\n`;
    prompt += getAppPromptSnippet(char, appType, targetCount);
    prompt += `\n</result>`;

    return prompt;
}

function generateBatchPeekContentPrompt(char, appTypes, mainChatContext) {
    const worldBooksLimitBreak = (char.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'limit_break'))
        .filter(Boolean)
        .sort((a, b) => (a.depth || 100) - (b.depth || 100))
        .map(wb => wb.content).join('\n');

    const worldBooksBefore = (char.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before'))
        .filter(Boolean)
        .sort((a, b) => (a.depth || 100) - (b.depth || 100))
        .map(wb => wb.content).join('\n');

    const worldBooksAfter = (char.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after'))
        .filter(Boolean)
        .sort((a, b) => (a.depth || 100) - (b.depth || 100))
        .map(wb => wb.content).join('\n');

    const worldBooksGuidelines = (char.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'guidelines'))
        .filter(Boolean)
        .sort((a, b) => (a.depth || 100) - (b.depth || 100))
        .map(wb => wb.content).join('\n');

    let prompt = `你正在模拟一个名为 ${char.realName} 的角色的手机内部信息。`;

    if (worldBooksLimitBreak) {
        prompt += `\n${worldBooksLimitBreak}\n`;
    }
    if (worldBooksBefore) {
        prompt += `\n为了更好地理解背景，请参考以下世界观设定：\n${worldBooksBefore}\n`;
    }
    prompt += `该角色的核心人设是：${char.persona}。\n`;

    if (worldBooksAfter) {
        prompt += `\n${worldBooksAfter}\n`;
    }

    if (worldBooksGuidelines) {
        prompt += `\n${worldBooksGuidelines}\n`;
    }

    if (char.myPersona) {
        prompt += `\n作为参考，我（用户）的人设是：${char.myPersona}\n`;
    }

    prompt += `最近，我（称呼为 ${char.myName}）和 ${char.realName} 的对话如下（这是你们关系和当前状态的核心参考）：\n---\n${mainChatContext}\n---\n`;
    prompt += `现在，我正在偷看Ta手机上的多个应用。请你基于Ta的人设和我们最近的聊天内容，一次性生成这些应用的内容。\n`;
    
    if (char.bilingualModeEnabled) {
        prompt += `✨双语模式特别指令✨：当角色的母语为中文以外的语言时，你的app内容文本**必须**遵循双语模式下的形式：{外语原文}「中文翻译」,例如: Of course, I'd love to.「当然，我很乐意。」,主要语言逻辑为角色母语，中文翻译文本视为系统自翻译，不视为原话;当角色需要表达中文时，需要根据角色设定自行判断对于中文的熟悉程度。这条规则的优先级非常高，请务必遵守。\n`;
    }

    prompt += `你的输出必须是XML格式，且只包含XML内容，必须以<result>作为根节点，不要有任何额外的解释或标记。你需要生成的应用内容及对应格式如下：\n`;

    const peekSettings = char.peekScreenSettings || {};
    const genCounts = peekSettings.generationCounts || {};
    const defaultCounts = {
        messages: 5, album: 6, memos: 3, cart: 4, browser: 5, transfer: 6, drafts: 1, steps: 6, unlock: 4, bag: 5
    };

    appTypes.forEach(appType => {
        // 批量生成时，稍微减少每个应用的生成数量以防截断
        let targetCount = genCounts[appType] || defaultCounts[appType] || 5;
        if (targetCount > 3) targetCount = Math.max(3, Math.floor(targetCount * 0.8));
        
        prompt += getAppPromptSnippet(char, appType, targetCount) + '\n';
    });

    prompt += `\n请确保最终输出的完整XML结构严格如下所示（不要输出任何多余的解释文字）：\n<result>\n`;
    appTypes.forEach(appType => {
        prompt += `  <${appType}>...</${appType}>\n`;
    });
    prompt += `</result>`;

    return prompt;
}

function parsePeekXML(xmlString, appType, rootNode = null) {
    let targetDoc = rootNode;

    if (!targetDoc) {
        const xmlMatch = xmlString.match(/<result>[\s\S]*<\/result>/i);
        const cleanXml = xmlMatch ? xmlMatch[0] : xmlString;

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(cleanXml, "text/xml");

        if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            throw new Error("XML 解析错误");
        }
        
        // 如果是单应用生成，可能没有包裹在 <appType> 标签里，直接用 xmlDoc
        // 如果有包裹，则取包裹的节点
        targetDoc = xmlDoc.querySelector(appType) || xmlDoc;
    }

    if (!targetDoc) return null;

    const result = {};

    const getText = (node, tag) => {
        const el = node.querySelector(tag);
        return el ? el.textContent.trim() : '';
    };

    switch (appType) {
        case 'messages':
            result.conversations = Array.from(targetDoc.querySelectorAll('conversation')).map(conv => ({
                partnerName: getText(conv, 'partnerName'),
                history: Array.from(conv.querySelectorAll('message')).map(msg => ({
                    sender: msg.getAttribute('sender'),
                    content: msg.textContent.trim()
                }))
            }));
            break;
        case 'steps':
            result.currentSteps = parseInt(getText(targetDoc, 'currentSteps')) || 0;
            result.trajectory = Array.from(targetDoc.querySelectorAll('trajectory item')).map(item => item.textContent.trim());
            result.annotation = getText(targetDoc, 'annotation');
            break;
        case 'album':
            result.photos = Array.from(targetDoc.querySelectorAll('photo')).map(photo => ({
                type: photo.getAttribute('type') || 'photo',
                imageDescription: getText(photo, 'imageDescription'),
                description: getText(photo, 'description')
            }));
            break;
        case 'memos':
            result.memos = Array.from(targetDoc.querySelectorAll('memo')).map(memo => ({
                id: memo.getAttribute('id') || `memo_${Math.random().toString(36).substr(2, 9)}`,
                title: getText(memo, 'title'),
                content: getText(memo, 'content')
            }));
            break;
        case 'cart':
            result.items = Array.from(targetDoc.querySelectorAll('item')).map(item => ({
                id: item.getAttribute('id') || `cart_${Math.random().toString(36).substr(2, 9)}`,
                title: getText(item, 'title'),
                spec: getText(item, 'spec'),
                price: getText(item, 'price')
            }));
            break;
        case 'browser':
            result.history = Array.from(targetDoc.querySelectorAll('history item')).map(item => ({
                title: getText(item, 'title'),
                url: getText(item, 'url'),
                annotation: getText(item, 'annotation')
            }));
            break;
        case 'drafts':
            result.drafts = Array.from(targetDoc.querySelectorAll('draft')).map(draft => {
                const contentEl = draft.querySelector('content');
                return {
                    to: getText(draft, 'to'),
                    // 使用 innerHTML 以保留删除线等 HTML 标签
                    content: contentEl ? contentEl.innerHTML.trim() : ''
                };
            });
            break;
        case 'transfer':
            result.entries = Array.from(targetDoc.querySelectorAll('entry')).map(entry => entry.textContent.trim());
            break;
        case 'unlock':
            result.nickname = getText(targetDoc, 'nickname');
            result.handle = getText(targetDoc, 'handle');
            result.bio = getText(targetDoc, 'bio');
            result.posts = Array.from(targetDoc.querySelectorAll('post')).map(post => ({
                timestamp: getText(post, 'timestamp'),
                content: getText(post, 'content')
            }));
            break;
        case 'bag':
            result.bagName = getText(targetDoc, 'bagName');
            result.items = Array.from(targetDoc.querySelectorAll('item')).map(item => ({
                location: getText(item, 'location'),
                name: getText(item, 'name'),
                annotation: getText(item, 'annotation')
            }));
            break;
    }
    return result;
}

function renderPeekBag(data) {
    const screen = document.getElementById('peek-bag-screen');
    if (!screen) return;

    if (!data) {
        screen.innerHTML = `
            <header class="app-header">
                <button class="back-btn" data-target="peek-screen">‹</button>
                <div class="title-container"><h1 class="title">翻包</h1></div>
                <button class="action-btn">···</button>
            </header>
            <main class="content bag-content-area">
                <p class="placeholder-text">正在生成包包内容...</p>
            </main>
        `;
        return;
    }

    const { bagName, items } = data;

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">翻包</h1></div>
            <button class="action-btn" id="refresh-bag-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg>
            </button>
        </header>
        <main class="content bag-content-area">
            <div class="bag-interactive-section">
                <div class="bag-icon-container" id="bag-icon-container">
                    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="currentColor" class="bi bi-briefcase bag-svg-icon" viewBox="0 0 16 16">
                      <path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H1.5A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 14.5 3H11v-.5A1.5 1.5 0 0 0 9.5 1h-3zm0 1h3a.5.5 0 0 1 .5.5V3H6v-.5a.5.5 0 0 1 .5-.5zm1.886 6.914L15 7.151V12.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V7.15l6.614 1.764a1.5 1.5 0 0 0 .772 0zM1.5 4h13a.5.5 0 0 1 .5.5v1.616L8.129 7.948a.5.5 0 0 1-.258 0L1 6.116V4.5a.5.5 0 0 1 .5-.5z"/>
                    </svg>
                </div>
                <div class="bag-name-highlight">[${bagName}]</div>
                <div class="bag-hint-text" id="bag-hint-text">点击包包开始翻找...</div>
            </div>
            
            <div class="bag-items-list" id="bag-items-list">
                <!-- 物品卡片将在这里动态生成 -->
            </div>
        </main>
    `;

    screen.querySelector('#refresh-bag-btn').addEventListener('click', () => {
        generateAndRenderPeekContent('bag', { forceRefresh: true });
    });

    const bagIconContainer = screen.querySelector('#bag-icon-container');
    const hintText = screen.querySelector('#bag-hint-text');
    const itemsList = screen.querySelector('#bag-items-list');
    const contentArea = screen.querySelector('.bag-content-area');

    let currentItemIndex = 0;
    let isExploring = false;

    bagIconContainer.addEventListener('click', () => {
        if (isExploring || currentItemIndex >= items.length) return;

        isExploring = true;
        bagIconContainer.classList.add('shaking');
        hintText.textContent = '正在翻找...';

        setTimeout(() => {
            bagIconContainer.classList.remove('shaking');
            
            const item = items[currentItemIndex];
            const itemCard = document.createElement('div');
            itemCard.className = 'bag-item-card show';
            itemCard.innerHTML = `
                <div class="bag-item-header">
                    <span class="bag-item-location">📍 ${item.location}</span>
                    <span class="bag-item-progress">${currentItemIndex + 1}/${items.length}</span>
                </div>
                <div class="bag-item-name">${item.name}</div>
                <div class="bag-item-annotation">“${item.annotation}”</div>
            `;
            
            itemsList.appendChild(itemCard);
            
            currentItemIndex++;
            
            if (currentItemIndex >= items.length) {
                hintText.textContent = '包包已经空啦~';
                bagIconContainer.classList.add('empty');
            } else {
                hintText.textContent = '继续点击包包翻找...';
            }
            
            // 滚动到底部
            setTimeout(() => {
                contentArea.scrollTo({
                    top: contentArea.scrollHeight,
                    behavior: 'smooth'
                });
            }, 100);

            isExploring = false;
        }, 600); // 摇晃动画持续时间
    });
}

async function generateAndRenderPeekContent(appType, options = {}) {
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('该应用内容正在生成中，请稍候...');
        return;
    }

    const char = db.characters.find(c => c.id === currentChatId);
    if (!char) return showToast('无法找到当前角色');
    
    if (!char.peekData) char.peekData = {};

    if (!forceRefresh && char.peekData[appType]) {
        const cachedData = char.peekData[appType];
        // 检查缓存是否有效（针对草稿箱做特殊兼容处理）
        if (appType === 'drafts' && !cachedData.drafts && !cachedData.draft) {
            // 如果既没有新版数组也没有旧版对象，视为无效缓存，继续生成
        } else {
            switch (appType) {
            case 'messages':
                renderPeekChatList(cachedData.conversations);
                switchScreen('peek-messages-screen');
                break;
            case 'album':
                renderPeekAlbum(cachedData.photos);
                switchScreen('peek-album-screen');
                break;
            case 'memos':
                renderMemosList(cachedData.memos);
                switchScreen('peek-memos-screen');
                break;
           case 'transfer':
               renderPeekTransferStation(cachedData.entries);
               switchScreen('peek-transfer-station-screen');
               break;
            case 'cart':
                renderPeekCart(cachedData.items);
                switchScreen('peek-cart-screen');
                break;
            case 'browser':
                renderPeekBrowser(cachedData.history);
                switchScreen('peek-browser-screen');
                break;
            case 'drafts':
                // 优先使用新版数组，兼容旧版对象
                renderPeekDrafts(cachedData.drafts || cachedData.draft);
                switchScreen('peek-drafts-screen');
                break;
           case 'steps':
              renderPeekSteps(cachedData);
              switchScreen('peek-steps-screen');
              break;
           case 'unlock':
               renderPeekUnlock(cachedData);
               switchScreen('peek-unlock-screen');
               break;
           case 'bag':
               renderPeekBag(cachedData);
               switchScreen('peek-bag-screen');
               break;
            }
            return; 
        }
    }

    const apiConfig = resolveAuxiliaryApiConfig('peek');
    let { url, key, model } = apiConfig;
    if (!url || !key || !model) {
        showToast('请先在“api”应用中完成设置！');
        return switchScreen('api-settings-screen');
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    generatingPeekApps.add(appType); 
    let targetContainer;

    switch (appType) {
        case 'messages':
            switchScreen('peek-messages-screen');
            targetContainer = document.getElementById('peek-chat-list-container');
            targetContainer.innerHTML = '<p class="placeholder-text">正在生成对话列表...</p>';
            break;
        case 'album':
            switchScreen('peek-album-screen');
            renderPeekAlbum([]); 
            break;
        case 'memos':
            switchScreen('peek-memos-screen');
            renderMemosList([]); 
            break;
       case 'transfer':
           switchScreen('peek-transfer-station-screen');
           renderPeekTransferStation([]);
           break;
        case 'cart':
            switchScreen('peek-cart-screen');
            renderPeekCart([]);
            break;
        case 'browser':
            switchScreen('peek-browser-screen');
            renderPeekBrowser([]);
            break;
        case 'drafts':
            switchScreen('peek-drafts-screen');
            renderPeekDrafts([]);
            break;
        case 'steps':
            switchScreen('peek-steps-screen');
            renderPeekSteps(null); 
            break;
       case 'unlock':
           switchScreen('peek-unlock-screen');
           renderPeekUnlock(null); 
           break;
       case 'bag':
           switchScreen('peek-bag-screen');
           renderPeekBag(null);
           break;
       default:
           showToast('无法打开');
           generatingPeekApps.delete(appType); 
           return;
   }

    try {
        let historySlice = char.history.slice(-30);
        historySlice = filterHistoryForAI(char, historySlice);
        const mainChatContext = historySlice.map(m => m.content).join('\n');

        const systemPrompt = generatePeekContentPrompt(char, appType, mainChatContext);
        console.log(systemPrompt);
        
        const { requestBody, endpoint, headers } = buildChatApiRequest(
            apiConfig,
            [{ role: 'user', content: systemPrompt }],
            { temperature: 0.8, topP: 0.9 }
        );

        const contentStr = await fetchAiResponse(apiConfig, requestBody, headers, endpoint);
        console.log(`AI Peek Content (${appType}):`, contentStr);
        
        const generatedData = parsePeekXML(contentStr, appType);

        let isValid = false;
        switch (appType) {
            case 'messages': isValid = generatedData && Array.isArray(generatedData.conversations); break;
            case 'memos': isValid = generatedData && Array.isArray(generatedData.memos); break;
            case 'album': isValid = generatedData && Array.isArray(generatedData.photos); break;
            case 'cart': isValid = generatedData && Array.isArray(generatedData.items); break;
            case 'transfer': isValid = generatedData && Array.isArray(generatedData.entries); break;
            case 'browser': isValid = generatedData && Array.isArray(generatedData.history); break;
            case 'drafts': isValid = generatedData && Array.isArray(generatedData.drafts); break;
            case 'steps': isValid = generatedData && generatedData.currentSteps !== undefined; break;
            case 'unlock': isValid = generatedData && generatedData.nickname && Array.isArray(generatedData.posts); break;
            case 'bag': isValid = generatedData && generatedData.bagName && Array.isArray(generatedData.items); break;
            default: isValid = false;
        }

        if (!isValid) {
            throw new Error("AI返回的数据格式不符合应用要求。");
        }

        char.peekData[appType] = generatedData;
        await saveData(); 

        if (appType === 'messages') {
            renderPeekChatList(generatedData.conversations);
        } else if (appType === 'memos') {
            renderMemosList(generatedData.memos);
        } else if (appType === 'album') {
            renderPeekAlbum(generatedData.photos);
        } else if (appType === 'transfer') {
           renderPeekTransferStation(generatedData.entries);
        } else if (appType === 'cart') {
            renderPeekCart(generatedData.items);
        } else if (appType === 'browser') {
            renderPeekBrowser(generatedData.history);
        } else if (appType === 'drafts') {
            renderPeekDrafts(generatedData.drafts);
        } else if (appType === 'steps') {
            renderPeekSteps(generatedData);
        } else if (appType === 'unlock') {
            renderPeekUnlock(generatedData);
        } else if (appType === 'bag') {
            renderPeekBag(generatedData);
        }

    } catch (error) {
        showApiError(error);
        const errorMessage = "内容生成失败，请刷新重试。";
        if (appType === 'album') {
            document.querySelector('#peek-album-screen .album-grid').innerHTML = `<p class="placeholder-text">${errorMessage}</p>`;
        } else if (appType === 'unlock') {
            document.getElementById('peek-unlock-screen').innerHTML = `<header class="app-header"><button class="back-btn" data-target="peek-screen">‹</button><div class="title-container"><h1 class="title">错误</h1></div><button class="action-btn">···</button></header><main class="content"><p class="placeholder-text">${errorMessage}</p></main>`;
        } else if (appType === 'bag') {
            document.getElementById('peek-bag-screen').innerHTML = `<header class="app-header" style="background: transparent; border: none;"><button class="back-btn" data-target="peek-screen" style="color: #fff;">‹</button><div class="title-container"><h1 class="title" style="color: #fff;">错误</h1></div></header><main class="content" style="display: flex; align-items: center; justify-content: center; background: #1a1a1a;"><p class="placeholder-text" style="color: #888;">${errorMessage}</p></main>`;
        } else if (targetContainer) {
            targetContainer.innerHTML = `<p class="placeholder-text">${errorMessage}</p>`;
        }
    } finally {
        generatingPeekApps.delete(appType); 
    }
}

async function generateBatchPeekContent(appTypes) {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char) return showToast('无法找到当前角色');

    const apiConfig = resolveAuxiliaryApiConfig('peek');
    let { url, key, model } = apiConfig;
    if (!url || !key || !model) {
        showToast('请先在“api”应用中完成设置！');
        return switchScreen('api-settings-screen');
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    // 检查是否有正在生成的应用
    for (const appType of appTypes) {
        if (generatingPeekApps.has(appType)) {
            showToast(`应用 ${peekScreenApps[appType]?.name || appType} 正在生成中，请稍候...`);
            return;
        }
    }

    // 标记为正在生成
    appTypes.forEach(appType => generatingPeekApps.add(appType));
    
    // 显示全局 Loading
    const loadingToast = document.createElement('div');
    loadingToast.className = 'toast visible';
    loadingToast.style.zIndex = '99999';
    loadingToast.innerHTML = `
        <div class="toast-content" style="display: flex; align-items: center; gap: 10px;">
            <div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
            <div class="toast-message">正在批量生成 ${appTypes.length} 个应用的内容...</div>
        </div>
    `;
    document.body.appendChild(loadingToast);

    try {
        let historySlice = char.history.slice(-30);
        historySlice = filterHistoryForAI(char, historySlice);
        const mainChatContext = historySlice.map(m => m.content).join('\n');

        const systemPrompt = generateBatchPeekContentPrompt(char, appTypes, mainChatContext);
        console.log('Batch Peek Prompt:', systemPrompt);
        
        const { requestBody, endpoint, headers } = buildChatApiRequest(
            apiConfig,
            [{ role: 'user', content: systemPrompt }],
            { temperature: 0.8, topP: 0.9 }
        );

        const contentStr = await fetchAiResponse(apiConfig, requestBody, headers, endpoint);
        console.log(`AI Batch Peek Content:`, contentStr);
        
        const xmlMatch = contentStr.match(/<result>[\s\S]*<\/result>/i);
        const cleanXml = xmlMatch ? xmlMatch[0] : contentStr;

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(cleanXml, "text/xml");

        if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            throw new Error("XML 解析错误");
        }

        if (!char.peekData) char.peekData = {};
        let successCount = 0;

        for (const appType of appTypes) {
            try {
                const appNode = xmlDoc.querySelector(appType);
                if (!appNode) {
                    console.warn(`Batch generation: Missing node for ${appType}`);
                    continue;
                }

                const generatedData = parsePeekXML(null, appType, appNode);
                
                let isValid = false;
                switch (appType) {
                    case 'messages': isValid = generatedData && Array.isArray(generatedData.conversations); break;
                    case 'memos': isValid = generatedData && Array.isArray(generatedData.memos); break;
                    case 'album': isValid = generatedData && Array.isArray(generatedData.photos); break;
                    case 'cart': isValid = generatedData && Array.isArray(generatedData.items); break;
                    case 'transfer': isValid = generatedData && Array.isArray(generatedData.entries); break;
                    case 'browser': isValid = generatedData && Array.isArray(generatedData.history); break;
                    case 'drafts': isValid = generatedData && Array.isArray(generatedData.drafts); break;
                    case 'steps': isValid = generatedData && generatedData.currentSteps !== undefined; break;
                    case 'unlock': isValid = generatedData && generatedData.nickname && Array.isArray(generatedData.posts); break;
                    case 'bag': isValid = generatedData && generatedData.bagName && Array.isArray(generatedData.items); break;
                }

                if (isValid) {
                    char.peekData[appType] = generatedData;
                    successCount++;
                } else {
                    console.warn(`Batch generation: Invalid data format for ${appType}`);
                }
            } catch (e) {
                console.error(`Error parsing batch data for ${appType}:`, e);
            }
        }

        await saveData();
        
        // 退出多选模式
        // @ts-ignore
        if (typeof exitBatchMode === 'function') exitBatchMode();
        
        showToast(`批量生成完成！成功: ${successCount}/${appTypes.length}`);

    } catch (error) {
        showApiError(error);
        showToast('批量生成失败，请重试。');
    } finally {
        appTypes.forEach(appType => generatingPeekApps.delete(appType));
        if (loadingToast.parentNode) {
            loadingToast.parentNode.removeChild(loadingToast);
        }
    }
}
