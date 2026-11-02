// --- 聊天存档与分支 ---

const CHAT_ARCHIVE_META_KEYS = new Set([
    'id', 'archives', 'activeArchiveId', 'isPinned', 'unreadCount',
    'realName', 'remarkName', 'name', 'avatar', 'folderId', 'folderIds'
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
    data.gallery = [];

    if (data.statusPanel) {
        data.statusPanel.currentStatusRaw = '';
        data.statusPanel.currentStatusHtml = '';
        data.statusPanel.history = [];
    }
    if (data.autoReply) data.autoReply.lastTriggerTime = 0;
    if (data.privateSessions) data.privateSessions = {};
    if (data.gossipSessions) data.gossipSessions = {};
    return data;
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
    chat.archives.push(archive);
    await switchChatArchive(archive.id);
    showToast('新存档已创建');
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
    chat.archives.push(archive);
    await switchChatArchive(archive.id);
    showToast('分支存档已创建');
}

async function switchChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    if (!chat || chat.activeArchiveId === archiveId) {
        closeArchiveManager();
        return;
    }

    syncChatActiveArchive(chat, true);
    const archive = chat.archives.find(item => item.id === archiveId);
    if (!archive) return;
    applyArchiveData(chat, archive);
    await saveData();
    closeArchiveManager();
    openChatRoom(currentChatId, currentChatType);
}

async function renameChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    const archive = chat?.archives.find(item => item.id === archiveId);
    if (!archive) return;
    const name = prompt('修改存档名称', archive.name);
    if (name === null || !name.trim()) return;
    archive.name = name.trim();
    archive.updatedAt = Date.now();
    await saveData();
    renderArchiveManager();
}

async function deleteChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    if (!chat || chat.archives.length <= 1) {
        showToast('至少保留一个存档');
        return;
    }
    const archive = chat.archives.find(item => item.id === archiveId);
    if (!archive || !confirm(`确定删除“${archive.name}”吗？该操作不可恢复。`)) return;

    if (chat.activeArchiveId === archiveId) {
        syncChatActiveArchive(chat, true);
        const fallback = chat.archives.find(item => item.id !== archiveId);
        chat.archives = chat.archives.filter(item => item.id !== archiveId);
        applyArchiveData(chat, fallback);
        await saveData();
        closeArchiveManager();
        openChatRoom(currentChatId, currentChatType);
        showToast('存档已删除');
        return;
    }

    chat.archives = chat.archives.filter(item => item.id !== archiveId);
    await saveData();
    renderArchiveManager();
    showToast('存档已删除');
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
        grid.insertAdjacentHTML('beforeend', `
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
