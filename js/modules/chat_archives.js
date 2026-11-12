// --- 聊天存档与分支 ---

const CHAT_ARCHIVE_META_KEYS = new Set([
    'id', 'archives', 'activeArchiveId', 'isPinned', 'unreadCount',
    'realName', 'remarkName', 'name', 'avatar', 'avatarPrevious', 'folderId', 'folderIds', 'derivedPanelAppearance'
]);

function cloneArchiveValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function createArchiveId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `archive_${crypto.randomUUID()}`;
    }
    return `archive_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getCurrentChatEntity() {
    if (!currentChatId || !currentChatType) return null;
    return currentChatType === 'private'
        ? db.characters.find(character => character.id === currentChatId)
        : db.groups.find(group => group.id === currentChatId);
}

function captureArchiveData(chat) {
    const data = {};
    Object.keys(chat).forEach(key => {
        if (!CHAT_ARCHIVE_META_KEYS.has(key)) {
            data[key] = cloneArchiveValue(chat[key]);
        }
    });
    return data;
}

function getArchiveLatestTime(data) {
    const history = Array.isArray(data.history) ? data.history : [];
    const journals = Array.isArray(data.memoryJournals) ? data.memoryJournals : [];
    const lastMessage = history.length ? Number(history[history.length - 1].timestamp) || 0 : 0;
    const lastJournal = journals.reduce((latest, journal) => Math.max(latest, Number(journal.createdAt) || 0), 0);
    return Math.max(lastMessage, lastJournal);
}

function ensureChatArchives(chat) {
    if (!chat) return false;
    let changed = false;

    if (!Array.isArray(chat.archives) || chat.archives.length === 0) {
        const now = Date.now();
        const archive = {
            id: createArchiveId(),
            name: '主存档',
            createdAt: now,
            updatedAt: Math.max(getArchiveLatestTime(chat), now),
            origin: null,
            data: captureArchiveData(chat)
        };
        chat.archives = [archive];
        chat.activeArchiveId = archive.id;
        changed = true;
    }

    if (!chat.archives.some(archive => archive.id === chat.activeArchiveId)) {
        chat.activeArchiveId = chat.archives[0].id;
        changed = true;
    }

    return changed;
}

function ensureAllChatArchives() {
    let changed = false;
    [...(db.characters || []), ...(db.groups || [])].forEach(chat => {
        if (ensureChatArchives(chat)) changed = true;
    });
    return changed;
}

function syncChatActiveArchive(chat, touch = false) {
    if (!chat) return;
    ensureChatArchives(chat);
    const archive = chat.archives.find(item => item.id === chat.activeArchiveId);
    if (!archive) return;

    const data = captureArchiveData(chat);
    const previousLatest = getArchiveLatestTime(archive.data || {});
    const nextLatest = getArchiveLatestTime(data);
    archive.data = data;
    if (touch || nextLatest !== previousLatest) {
        archive.updatedAt = Math.max(Date.now(), nextLatest);
    }
}

function syncAllActiveArchives() {
    [...(db.characters || []), ...(db.groups || [])].forEach(chat => {
        const touch = chat.id === currentChatId;
        syncChatActiveArchive(chat, touch);
    });
}

function applyArchiveData(chat, archive) {
    if (typeof window.clearStickerSuggestions === 'function') window.clearStickerSuggestions();
    Object.keys(chat).forEach(key => {
        if (!CHAT_ARCHIVE_META_KEYS.has(key)) delete chat[key];
    });
    Object.assign(chat, cloneArchiveValue(archive.data || {}));
    chat.activeArchiveId = archive.id;
}

function getActiveArchive(chat) {
    if (!chat) return null;
    ensureChatArchives(chat);
    return chat.archives.find(archive => archive.id === chat.activeArchiveId) || chat.archives[0];
}

function resetArchiveRuntime(data) {
    data.history = [];
    data.memoryJournals = [];
    data.callHistory = [];
    data.lastUserMessageTimestamp = null;
    data.status = '在线';
    data.peekData = {};
    delete data.characterMemos;
    data.gallery = [];

    if (data.statusPanel) {
        data.statusPanel.currentStatusRaw = '';
        data.statusPanel.currentStatusHtml = '';
        data.statusPanel.history = [];
    }
    if (data.autoReply) data.autoReply.lastTriggerTime = 0;
    if (data.privateSessions) data.privateSessions = {};
    if (data.gossipSessions) data.gossipSessions = {};
    resetArchiveDerivedRuntime(data);
    return data;
}

function resetArchiveDerivedRuntime(data) {
    const users = (data.history || []).filter(message => message.role === 'user' && !message.isContextDisabled && !message.relationshipDelivery && !message.isWithdrawn);
    if (data.avatarAutonomy) {
        const settings = data.avatarAutonomy;
        settings.lastUserCount = Math.min(Math.max(0, Number(settings.lastUserCount) || 0), users.length);
        settings.lastCheck = 0;
        settings.lastChangedAt = 0;
        settings.lastRequestKey = '';
        settings.lastResult = '';
        settings.currentImageId = '';
        settings.currentAvatarFingerprint = '';
        settings.cache = {};
    }
    if (data.friendRelationship?.autonomy) {
        const autonomy = data.friendRelationship.autonomy;
        const eligibleCount = users.filter(message => !message.isThinking && !message.isStatusUpdate).length;
        autonomy.lastCheckUserCount = Math.min(Math.max(0, Number(autonomy.lastCheckUserCount) || 0), eligibleCount);
    }
    // Rebuild lazily against the new archive's retained history and journals.
    data.memoryVectorIndex = {};
}

function archiveSelectionIsCurrent(chat, type, archiveId, history) {
    return currentChatType === type && getCurrentChatEntity() === chat && chat.activeArchiveId === archiveId && chat.history === history;
}

function restoreFailedArchiveSwitch(chat, previousId, archiveId, history) {
    if (chat.activeArchiveId !== archiveId || chat.history !== history) return;
    const previous = chat.archives.find(item => item.id === previousId);
    if (!previous) return;
    // New arrivals belong to the attempted destination, never to the source.
    syncChatActiveArchive(chat);
    applyArchiveData(chat, previous);
}

async function activateCreatedArchive(chat, archive) {
    const originalData = JSON.stringify(archive.data), originalName = archive.name;
    chat.archives.push(archive);
    if (await switchChatArchive(archive.id)) return true;
    // Keep any newer work, including arrivals saved into the failed destination.
    if (chat.activeArchiveId !== archive.id && archive.name === originalName && JSON.stringify(archive.data) === originalData) {
        const index = chat.archives.indexOf(archive);
        if (index >= 0) chat.archives.splice(index, 1);
    }
    return false;
}

function makeArchiveName(prefix) {
    const now = new Date();
    const date = `${now.getMonth() + 1}月${now.getDate()}日`;
    return `${prefix} · ${date}`;
}

async function createBlankArchive() {
    const chat = getCurrentChatEntity();
    if (!chat) return;
    syncChatActiveArchive(chat, true);

    const active = getActiveArchive(chat);
    const suggestedName = makeArchiveName('新存档');
    const name = prompt('存档名称', suggestedName);
    if (name === null) return;

    const now = Date.now();
    const archive = {
        id: createArchiveId(),
        name: name.trim() || suggestedName,
        createdAt: now,
        updatedAt: now,
        origin: null,
        data: resetArchiveRuntime(cloneArchiveValue(active.data))
    };
    if (!await activateCreatedArchive(chat, archive)) return false;
    showToast('新存档已创建');
    return true;
}

function journalBelongsToBranch(journal, includedMessageIds, cutoff) {
    if (journal.startMessageId && journal.endMessageId) {
        return includedMessageIds.has(journal.startMessageId) && includedMessageIds.has(journal.endMessageId);
    }
    return journal.range && Number(journal.range.end) <= cutoff;
}

async function createBranchArchiveAtMessage(messageId) {
    const chat = getCurrentChatEntity();
    if (!chat || !Array.isArray(chat.history)) return;
    const branchIndex = chat.history.findIndex(message => message.id === messageId);
    if (branchIndex < 0) return;

    syncChatActiveArchive(chat, true);
    const sourceArchive = getActiveArchive(chat);
    const suggestedName = makeArchiveName('分支');
    const name = prompt('分支存档名称', suggestedName);
    if (name === null) return;

    const data = cloneArchiveValue(sourceArchive.data);
    data.history = data.history.slice(0, branchIndex + 1);
    const includedMessageIds = new Set(data.history.map(message => message.id));
    data.memoryJournals = (data.memoryJournals || []).filter(journal =>
        journalBelongsToBranch(journal, includedMessageIds, branchIndex + 1)
    );
    data.callHistory = (data.callHistory || []).filter(call => !call.timestamp || call.timestamp <= (data.history[branchIndex].timestamp || Infinity));
    data.lastUserMessageTimestamp = [...data.history].reverse().find(message => message.role === 'user')?.timestamp || null;
    resetArchiveDerivedRuntime(data);

    const now = Date.now();
    const archive = {
        id: createArchiveId(),
        name: name.trim() || suggestedName,
        createdAt: now,
        updatedAt: now,
        origin: {
            archiveId: sourceArchive.id,
            archiveName: sourceArchive.name,
            messageId,
            createdAt: now
        },
        data
    };
    if (!await activateCreatedArchive(chat, archive)) return false;
    showToast('分支存档已创建');
    return true;
}

async function switchChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    const type = currentChatType;
    if (!chat || chat.activeArchiveId === archiveId) {
        closeArchiveManager();
        return Boolean(chat);
    }

    syncChatActiveArchive(chat, true);
    const archive = chat.archives.find(item => item.id === archiveId);
    if (!archive) return false;
    const previousId = chat.activeArchiveId;
    applyArchiveData(chat, archive);
    const history = chat.history;
    try { await saveData(); }
    catch (error) {
        restoreFailedArchiveSwitch(chat, previousId, archiveId, history);
        showToast('存档切换保存失败，已保留原存档和新消息');
        return false;
    }
    if (archiveSelectionIsCurrent(chat, type, archiveId, history)) {
        closeArchiveManager();
        openChatRoom(chat.id, type);
    }
    return true;
}

async function renameChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    const archive = chat?.archives.find(item => item.id === archiveId);
    if (!archive) return;
    const name = prompt('修改存档名称', archive.name);
    if (name === null || !name.trim()) return;
    const before = { name: archive.name, updatedAt: archive.updatedAt };
    archive.name = name.trim();
    archive.updatedAt = Date.now();
    const renamed = { name: archive.name, updatedAt: archive.updatedAt };
    try { await saveData(); }
    catch (error) {
        if (archive.name === renamed.name) archive.name = before.name;
        if (archive.updatedAt === renamed.updatedAt) archive.updatedAt = before.updatedAt;
        showToast('存档改名保存失败');
        return false;
    }
    if (getCurrentChatEntity() === chat) renderArchiveManager();
    return true;
}

async function deleteChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    if (!chat || chat.archives.length <= 1) {
        showToast('至少保留一个存档');
        return;
    }
    const archive = chat.archives.find(item => item.id === archiveId);
    if (!archive || !confirm(`确定删除“${archive.name}”吗？该操作不可恢复。`)) return;

    const type = currentChatType, index = chat.archives.indexOf(archive);
    const active = chat.activeArchiveId === archiveId;
    if (active) syncChatActiveArchive(chat, true);
    chat.archives.splice(index, 1);
    const fallback = active ? chat.archives[0] : null;
    if (active) applyArchiveData(chat, fallback);
    const history = chat.history;
    try { await saveData(); }
    catch (error) {
        if (!chat.archives.some(item => item.id === archiveId)) chat.archives.splice(Math.min(index, chat.archives.length), 0, archive);
        if (active) restoreFailedArchiveSwitch(chat, archiveId, fallback.id, history);
        showToast('存档删除保存失败，已恢复存档');
        return false;
    }
    if (active && archiveSelectionIsCurrent(chat, type, fallback.id, history)) {
        closeArchiveManager();
        openChatRoom(chat.id, type);
    } else if (!active && getCurrentChatEntity() === chat) renderArchiveManager();
    showToast('存档已删除');
    return true;
}

function formatArchiveTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function renderArchiveManager() {
    const chat = getCurrentChatEntity();
    const list = document.getElementById('chat-archive-list');
    if (!chat || !list) return;
    syncChatActiveArchive(chat, false);

    list.innerHTML = chat.archives
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(archive => {
            const active = archive.id === chat.activeArchiveId;
            const messageCount = archive.data?.history?.length || 0;
            const journalCount = archive.data?.memoryJournals?.length || 0;
            const origin = archive.origin ? `<div class="archive-origin">来自：${escapeHtml(archive.origin.archiveName || '其他存档')}</div>` : '';
            return `
                <article class="chat-archive-card ${active ? 'active' : ''}" data-archive-id="${archive.id}">
                    <div class="archive-card-main">
                        <div class="archive-name-row">
                            <strong>${escapeHtml(archive.name)}</strong>
                            ${active ? '<span class="archive-active-tag">当前</span>' : ''}
                        </div>
                        <div class="archive-meta">${messageCount} 条消息 · ${journalCount} 篇日记 · ${formatArchiveTime(archive.updatedAt)}</div>
                        ${origin}
                    </div>
                    <div class="archive-actions">
                        ${active ? '' : '<button type="button" data-action="switch">进入</button>'}
                        <button type="button" data-action="rename">改名</button>
                        <button type="button" data-action="delete" class="danger">删除</button>
                    </div>
                </article>`;
        }).join('');
}

function openArchiveManager() {
    const overlay = document.getElementById('chat-archive-overlay');
    if (!overlay) return;
    renderArchiveManager();
    overlay.classList.add('visible');
}

function closeArchiveManager() {
    document.getElementById('chat-archive-overlay')?.classList.remove('visible');
}

function injectArchiveUi() {
    if (!document.getElementById('chat-archive-overlay')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="chat-archive-overlay" class="chat-archive-overlay" aria-hidden="true">
                <section class="chat-archive-panel" role="dialog" aria-modal="true" aria-label="存档管理">
                    <header class="archive-panel-header">
                        <button type="button" id="close-chat-archives">‹</button>
                        <h2>存档管理</h2>
                        <button type="button" id="create-chat-archive">新建</button>
                    </header>
                    <p class="archive-help">新建存档会复用当前设置、人设和世界书绑定，但从空白聊天开始。</p>
                    <div id="chat-archive-list" class="chat-archive-list"></div>
                </section>
            </div>`);
    }

    const grids = document.querySelectorAll('#chat-expansion-panel .expansion-grid');
    const grid = grids[0];
    if (grid && !document.getElementById('chat-archives-btn')) {
        (grid.querySelector('#red-packet-btn') || grid).insertAdjacentHTML(grid.querySelector('#red-packet-btn') ? 'beforebegin' : 'beforeend', `
            <div class="expansion-item" id="chat-archives-btn">
                <div class="expansion-item-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v4H4V4m1 6h14v10H5V10m4 2v2h6v-2H9z"/></svg>
                </div>
                <span class="expansion-item-name">存档</span>
            </div>`);
    }
}

function setupChatArchiveSystem() {
    injectArchiveUi();
    document.getElementById('chat-archives-btn')?.addEventListener('click', openArchiveManager);
    document.getElementById('close-chat-archives')?.addEventListener('click', closeArchiveManager);
    document.getElementById('create-chat-archive')?.addEventListener('click', createBlankArchive);
    document.getElementById('chat-archive-overlay')?.addEventListener('click', event => {
        if (event.target.id === 'chat-archive-overlay') closeArchiveManager();
    });
    document.getElementById('chat-archive-list')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        const card = event.target.closest('.chat-archive-card');
        if (!button || !card) return;
        const archiveId = card.dataset.archiveId;
        if (button.dataset.action === 'switch') switchChatArchive(archiveId);
        if (button.dataset.action === 'rename') renameChatArchive(archiveId);
        if (button.dataset.action === 'delete') deleteChatArchive(archiveId);
    });
}
