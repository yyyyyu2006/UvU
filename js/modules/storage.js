// --- 存储分析与数据管理 (js/modules/storage.js) ---

const STORAGE_CATEGORIES = [
    { key: 'chats', name: '聊天记录', desc: '所有对话历史' },
    { key: 'contacts', name: '角色设定', desc: '联系人及角色卡片' },
    { key: 'worldbooks', name: '世界书', desc: '世界书条目数据' },
    { key: 'personas', name: '用户设定', desc: '用户人设数据' },
    { key: 'wallpapers', name: '壁纸与外观', desc: '自定义壁纸、主题、表情包' },
    { key: 'fonts', name: '字体', desc: '自定义字体文件' },
    { key: 'settings', name: '基础设置', desc: 'API配置、UI偏好等' },
    { key: 'other', name: '相册／工坊／阅读数据', desc: '可选大数据迁移；导入会按备份快照替换工坊和阅读数据' }
];

const STORAGE_IMPORT_SETTING_KEYS = [
    'apiSettings', 'memoryApiSettings', 'vectorMemoryApiSettings', 'apiPresets', 'cotSettings', 'cotPresets', 'homeScreenMode',
    'customIcons', 'insWidgetSettings', 'homeWidgetSettings', 'chatFolders', 'fontSizeScale', 'savedKeyboardHeight',
    'statusBarPresets', 'globalSendSound', 'globalReceiveSound', 'multiMsgSoundEnabled', 'soundPresets', 'galleryPresets',
    'hasSeenVideoCallDisclaimer', 'hasSeenVideoCallAvatarHint', 'workshopSettings', 'workshopLlmPresets',
    'workshopPromptPresets', 'homeLayoutOrder', 'homeLayoutPages', 'widgetTemplates', 'addedWidgets',
    'backupReminderSettings', 'stUnlocked'
];
const STORAGE_IMPORT_CATEGORY_KEYS = {
    personas: ['myPersonaPresets', 'homeSignature', 'activePersonaId'],
    wallpapers: ['wallpaper', 'bubbleCssPresets', 'globalCss', 'globalCssPresets', 'moreProfileCardBg', 'themeSettings', 'themePresets'],
    fonts: ['fontUrl', 'fontPresets'],
    settings: STORAGE_IMPORT_SETTING_KEYS
};

let currentStorageSizes = {};
let selectedModules = {
    chats: true,
    contacts: true,
    worldbooks: true,
    personas: true,
    wallpapers: true,
    fonts: true,
    settings: true,
    other: false
};
const selectedImportModules = { ...selectedModules };
let storageBackupMode = 'export';
let storageBackupBusy = false;
function storageCurrentSelection() {
    return storageBackupMode === 'import' ? selectedImportModules : selectedModules;
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function stringifySize(obj) {
    try {
        const text = JSON.stringify(obj);
        return text === undefined ? 0 : new Blob([text]).size;
    } catch (e) {
        return 0;
    }
}

// Stream JSON in bounded chunks so large exports do not create one extra giant
// UTF-16 string before compression. The payload schema and key order remain the
// same as JSON.stringify for ordinary data.
function* storageJsonPieces(value, key = '', ancestors = new Set()) {
    if (value && typeof value.toJSON === 'function') value = value.toJSON(key);
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return;
    if (typeof value === 'string') {
        yield '"';
        for (let start = 0; start < value.length; start += 16384) yield JSON.stringify(value.slice(start, start + 16384)).slice(1, -1);
        yield '"'; return;
    }
    if (!value || typeof value !== 'object') { yield JSON.stringify(value); return; }
    if (ancestors.has(value)) throw new Error('备份数据包含循环引用');
    ancestors.add(value);
    if (Array.isArray(value)) {
        yield '[';
        for (let i = 0; i < value.length; i++) {
            if (i) yield ',';
            const pieces = storageJsonPieces(value[i], String(i), ancestors);
            let emitted = false;
            for (const piece of pieces) { yield piece; emitted = true; }
            if (!emitted) yield 'null';
        }
        yield ']';
    } else {
        yield '{';
        let first = true;
        for (const name of Object.keys(value)) {
            const pieces = storageJsonPieces(value[name], name, ancestors);
            const next = pieces.next();
            if (next.done) continue;
            if (!first) yield ',';
            first = false;
            yield JSON.stringify(name); yield ':';
            yield next.value;
            yield* pieces;
        }
        yield '}';
    }
    ancestors.delete(value);
}

function storageJsonStream(value) {
    if (typeof ReadableStream !== 'function' || typeof TextEncoder !== 'function') return null;
    const iterator = storageJsonPieces(value);
    const encoder = new TextEncoder();
    let chunks = 0;
    return new ReadableStream({
        async pull(controller) {
            try {
                if (++chunks % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                let text = '';
                while (text.length < 65536) {
                    const next = iterator.next();
                    if (next.done) {
                        if (text) controller.enqueue(encoder.encode(text));
                        controller.close();
                        return;
                    }
                    text += next.value;
                }
                controller.enqueue(encoder.encode(text));
            } catch (error) { controller.error(error); }
        },
        cancel() { iterator.return(); }
    });
}

async function calculateStorageSize() {
    let sizes = {
        chats: 0,
        contacts: 0,
        worldbooks: 0,
        personas: 0,
        wallpapers: 0,
        fonts: 0,
        settings: 0,
        other: 0,
        total: 0
    };

    if (!db || !db.characters) await loadData();

    // Serialized UTF-8 payload includes actual saved archive snapshots.
    const classifyChat = (chat, nested = false) => {
        Object.entries(chat).forEach(([key, value]) => {
            if (key === 'archives') return;
            if (key === 'gallery') sizes.other += stringifySize(value);
            else if (key === 'statusPanel' && value) {
                const settings = {}, runtime = {};
                Object.entries(value).forEach(([name, item]) => { (STORAGE_STATUS_KEYS.includes(name) ? runtime : settings)[name] = item; });
                sizes.contacts += stringifySize(settings); sizes.chats += stringifySize(runtime);
            } else if (STORAGE_CHAT_KEYS.includes(key) || key === 'activeArchiveId' || key === 'memoryVectorIndex') sizes.chats += stringifySize(value);
            else sizes.contacts += stringifySize(value);
        });
        if (!nested) (chat.archives || []).forEach(({ data, ...metadata }) => {
            sizes.chats += stringifySize(metadata);
            classifyChat(data || {}, true);
        });
    };
    [...(db.characters || []), ...(db.groups || [])].forEach(chat => classifyChat(chat));

    // 2. worldbooks
    sizes.worldbooks += stringifySize(db.worldBooks);

    // 3. personas
    sizes.personas += stringifySize(db.myPersonaPresets);
    sizes.personas += stringifySize(db.homeSignature);
    sizes.personas += stringifySize(db.activePersonaId);

    // 4. wallpapers
    sizes.wallpapers += stringifySize(db.wallpaper);
    sizes.wallpapers += stringifySize(db.bubbleCssPresets);
    sizes.wallpapers += stringifySize(db.globalCss);
    sizes.wallpapers += stringifySize(db.globalCssPresets);
    sizes.wallpapers += stringifySize(db.myStickers);
    sizes.wallpapers += stringifySize(db.moreProfileCardBg);
    sizes.wallpapers += stringifySize(db.themeSettings);
    sizes.wallpapers += stringifySize(db.themePresets);

    // 5. fonts
    sizes.fonts += stringifySize(db.fontUrl);
    sizes.fonts += stringifySize(db.fontPresets);

    // 6. settings
    const settingsKeys = STORAGE_IMPORT_SETTING_KEYS;
    settingsKeys.forEach(key => {
        sizes.settings += stringifySize(db[key]);
    });

    // 7. other (Dexie)
    try {
        if (dexieDB) {
            const workshopItems = await dexieDB.workshopHistory.toArray();
            workshopItems.forEach(item => sizes.other += stringifySize(item));
            
            const vibeItems = await dexieDB.workshopVibeGroups.toArray();
            vibeItems.forEach(item => sizes.other += stringifySize(item));
            
            const photoItems = await dexieDB.characterPhotos.toArray();
            photoItems.forEach(item => sizes.other += stringifySize(item));
            
            if (dexieDB.reader_comments) {
                const comments = await dexieDB.reader_comments.toArray();
                comments.forEach(item => sizes.other += stringifySize(item));
            }
            for (const name of ['reader_books', 'reader_chapters']) {
                if (dexieDB[name]) (await dexieDB[name].toArray()).forEach(item => sizes.other += stringifySize(item));
            }
            
            if (dexieDB.customFonts) {
                const fonts = await dexieDB.customFonts.toArray();
                fonts.forEach(font => {
                    if (font.file && font.file.size) {
                        sizes.fonts += font.file.size;
                    }
                });
            }
        }
    } catch (e) {
        console.warn("Could not calculate dexie data size:", e);
    }

    sizes.total = Object.keys(sizes).reduce((sum, key) => key !== 'total' ? sum + sizes[key] : sum, 0);
    return sizes;
}

function renderStorageUI() {
    const totalEl = document.getElementById('storage-total-size');
    const barChart = document.getElementById('storage-bar-chart');
    const legendContainer = document.getElementById('storage-legend-container');
    const backupOptions = document.getElementById('storage-backup-options');

    if (!totalEl || !barChart || !legendContainer || !backupOptions) return;

    totalEl.textContent = formatBytes(currentStorageSizes.total);

    // Render Bar Chart
    barChart.innerHTML = '';
    STORAGE_CATEGORIES.forEach(cat => {
        const size = currentStorageSizes[cat.key] || 0;
        if (size > 0 && currentStorageSizes.total > 0) {
            const percentage = (size / currentStorageSizes.total) * 100;
            const segment = document.createElement('div');
            segment.className = `storage-segment ${cat.key}`;
            segment.style.width = `${percentage}%`;
            barChart.appendChild(segment);
        }
    });

    // Render Legend
    legendContainer.innerHTML = '';
    STORAGE_CATEGORIES.forEach(cat => {
        const size = currentStorageSizes[cat.key] || 0;
        legendContainer.innerHTML += `
            <div class="storage-legend-item">
                <div class="storage-legend-color ${cat.key}"></div>
                <div class="storage-legend-info">
                    <span class="storage-legend-name">${cat.name}</span>
                    <span class="storage-legend-size">${formatBytes(size)}</span>
                </div>
            </div>
        `;
    });

    // Render Backup Options
    const currentSelection = storageCurrentSelection();
    document.querySelectorAll('[data-backup-mode]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.backupMode === storageBackupMode));
    });
    document.getElementById('storage-export-btn').hidden = storageBackupMode !== 'export';
    document.getElementById('storage-export-format-row').hidden = storageBackupMode !== 'export';
    document.getElementById('storage-import-control').hidden = storageBackupMode !== 'import';
    backupOptions.innerHTML = '';
    STORAGE_CATEGORIES.forEach(cat => {
        const size = currentStorageSizes[cat.key] || 0;
        const isChecked = currentSelection[cat.key] ? 'checked' : '';
        backupOptions.innerHTML += `
            <div class="storage-setting-item">
                <div class="storage-setting-info">
                    <span class="storage-setting-name">${cat.name}</span>
                    <span class="storage-setting-desc">${cat.desc} (${formatBytes(size)})</span>
                </div>
                <label class="kkt-switch">
                    <input type="checkbox" class="backup-module-checkbox" data-key="${cat.key}" ${isChecked}>
                    <span class="kkt-slider"></span>
                </label>
            </div>
        `;
    });
    
    backupOptions.innerHTML += `
        <div style="font-size: 12px; color: #888; margin-top: 15px; text-align: center;">
            * 相册／工坊／阅读数据默认不勾选。跨设备迁移时可另外导出；导入只恢复已存在角色与存档的相册，并替换包内的工坊／阅读数据表。JSON／EE 格式保持兼容，旧版可能忽略此新增分类。
        </div>
    `;

    // Bind Checkbox Events
    document.querySelectorAll('.backup-module-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            storageCurrentSelection()[e.target.dataset.key] = e.target.checked;
            updateSelectAllBtn();
        });
    });
    updateSelectAllBtn();
}

function updateSelectAllBtn() {
    const btn = document.getElementById('storage-select-all-btn');
    if (!btn) return;
    const allSelected = Object.values(storageCurrentSelection()).every(v => v);
    btn.textContent = allSelected ? '全不选' : '全选';
}

function setupStorageAnalysisScreen() {
    const screen = document.getElementById('storage-analysis-screen');
    if (!screen) return;

    const observer = new MutationObserver(async (mutations) => {
        if (screen.classList.contains('active')) {
            showToast('正在分析存储空间...');
            currentStorageSizes = await calculateStorageSize();
            renderStorageUI();
            updatePersistenceStatus();
        }
    });

    observer.observe(screen, { attributes: true, attributeFilter: ['class'] });

    // Select All Button
    document.querySelectorAll('[data-backup-mode]').forEach(button => {
        button.addEventListener('click', () => {
            if (storageBackupBusy) return;
            storageBackupMode = button.dataset.backupMode;
            renderStorageUI();
        });
    });
    const selectAllBtn = document.getElementById('storage-select-all-btn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            if (storageBackupBusy) return;
            const selection = storageCurrentSelection();
            const allSelected = Object.values(selection).every(v => v);
            const newValue = !allSelected;
            Object.keys(selection).forEach(k => selection[k] = newValue);
            renderStorageUI();
        });
    }

    // Export Button
    const exportBtn = document.getElementById('storage-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', handleExport);
    }

    // Import Input
    const importInput = document.getElementById('storage-import-file');
    if (importInput) {
        importInput.addEventListener('change', handleImport);
    }

    async function updatePersistenceStatus() {
        if (navigator.storage && navigator.storage.persisted) {
            const isPersisted = await navigator.storage.persisted();
            let statusContainer = document.getElementById('storage-persistence-container');
            if (!statusContainer) return;
            
            statusContainer.innerHTML = `
                <div style="padding: 12px; background: #ffffff; border-radius: 10px; margin-top: 16px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #abafb5; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div style="font-weight: bold; font-size: 0.9rem; color: #495057;">持久化存储保护</div>
                        <div style="font-size: 0.8rem; color: ${isPersisted ? '#51cf66' : '#ff922b'}; display: flex; align-items: center; gap: 4px;">
                            ${isPersisted ? '已开启 (数据受保护)' : '未开启 (容易被清理)'}
                        </div>
                    </div>
                    ${!isPersisted ? '<button id="manual-persist-btn" class="storage-action-btn" style="width: auto; padding: 6px 12px; font-size: 0.85rem; background: #f8f9fa; border: 1px solid #ced4da; color: #495057;">立即开启</button>' : ''}
                </div>
            `;

            const btn = document.getElementById('manual-persist-btn');
            if (btn) {
                btn.onclick = async () => {
                    const persisted = await navigator.storage.persist();
                    if (persisted) {
                        showToast("已成功开启持久化存储！");
                        updatePersistenceStatus();
                    } else {
                        showToast("开启失败，可能是浏览器策略限制。");
                    }
                };
            }
        }
    }
}

// 将设定和运行数据分开；存档也遵循同一勾选范围。
const STORAGE_CHAT_KEYS = ['history', 'callHistory', 'memoryJournals', 'memoryVectorIndex', 'lastUserMessageTimestamp',
    'status', 'peekData', 'privateSessions', 'gossipSessions', 'friendRelationship'];
const STORAGE_STATUS_KEYS = ['currentStatusRaw', 'currentStatusHtml', 'history'];
const STORAGE_CACHE_TABLES = ['workshopHistory', 'workshopVibeGroups', 'characterPhotos', 'reader_books', 'reader_chapters', 'reader_comments'];
const storageClone = value => value === undefined ? undefined : (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
function storageRuntimeData(chat) {
    const result = {};
    STORAGE_CHAT_KEYS.forEach(key => { if (chat[key] !== undefined) result[key] = storageClone(chat[key]); });
    if (chat.statusPanel) {
        result.statusPanel = {};
        STORAGE_STATUS_KEYS.forEach(key => { if (chat.statusPanel[key] !== undefined) result.statusPanel[key] = storageClone(chat.statusPanel[key]); });
    }
    return result;
}
function storageContactData(chat) {
    const excluded = new Set([...STORAGE_CHAT_KEYS, 'archives', 'activeArchiveId', 'gallery']);
    const result = {};
    Object.keys(chat).forEach(key => { if (!excluded.has(key)) result[key] = storageClone(chat[key]); });
    if (result.statusPanel) STORAGE_STATUS_KEYS.forEach(key => delete result.statusPanel[key]);
    return result;
}
function storageExportChat(chat, contacts, chats) {
    const result = contacts ? storageContactData(chat) : { id: chat.id, name: chat.name };
    if (chats) {
        Object.assign(result, storageRuntimeData(chat));
        if (contacts && chat.statusPanel) result.statusPanel = storageClone(chat.statusPanel);
        result.activeArchiveId = chat.activeArchiveId;
        result.archives = (chat.archives || []).map(archive => {
            const metadata = {};
            Object.keys(archive).forEach(key => { if (key !== 'data') metadata[key] = storageClone(archive[key]); });
            return { ...metadata, data: contacts ? { ...storageContactData(archive.data || {}), ...storageRuntimeData(archive.data || {}) } : storageRuntimeData(archive.data || {}) };
        });
        result.archives.forEach(archive => {
            if (contacts && archive.data.statusPanel && chat.archives.find(item => item.id === archive.id)?.data?.statusPanel) {
                archive.data.statusPanel = storageClone(chat.archives.find(item => item.id === archive.id).data.statusPanel);
            }
            if (archive.id === chat.activeArchiveId) archive.data = { ...archive.data, ...storageRuntimeData(chat),
                ...(contacts && chat.statusPanel ? { statusPanel: storageClone(chat.statusPanel) } : {}) };
        });
    }
    return result;
}

function storagePrepareImport(selection, modules) {
    const pending = {};
    if (selection.chats || selection.contacts) {
        for (const key of ['characters', 'groups']) {
            if (!Array.isArray(modules[key])) continue;
            const ids = new Set(modules[key].map(chat => chat.id));
            // 合并只替换顶层字段及新建的存档对象；保留未修改的大历史数组，避免整份回滚副本。
            pending[key] = db[key].map(chat => ids.has(chat.id) ? { ...chat } : chat);
            storageMergeChats(pending[key], modules[key], selection.contacts, selection.chats);
        }
    }
    if (selection.worldbooks && modules.worldBooks !== undefined) pending.worldBooks = modules.worldBooks;
    if (selection.wallpapers && modules.myStickers !== undefined) pending.myStickers = modules.myStickers;
    Object.entries(STORAGE_IMPORT_CATEGORY_KEYS).forEach(([category, keys]) => {
        if (selection[category]) keys.forEach(key => { if (modules[key] !== undefined) pending[key] = modules[key]; });
    });
    if (selection.other && modules.mediaCache) {
        for (const key of ['characters', 'groups']) {
            const galleries = modules.mediaCache[key];
            if (!galleries) continue;
            pending[key] = (pending[key] || db[key]).map(chat => {
                const incoming = galleries.find(item => item.id === chat.id);
                if (!incoming) return chat;
                const result = { ...chat };
                if (incoming.gallery !== undefined) result.gallery = storageClone(incoming.gallery);
                if (chat.archives) result.archives = chat.archives.map(archive => {
                    const source = incoming.archives?.find(item => item.id === archive.id);
                    return source ? { ...archive, data: { ...archive.data, gallery: storageClone(source.gallery) } } : archive;
                });
                return result;
            });
        }
    }
    return pending;
}

function storageValidateModules(modules) {
    const fail = (path, expected) => { throw new Error(path + ' 必须是' + expected); };
    const object = (value, path) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '对象');
    };
    const optional = (value, path, type) => {
        if (value !== undefined && (typeof value !== type || (type === 'number' && !Number.isFinite(value)))) fail(path, type === 'string' ? '文本' : type === 'number' ? '有效数字' : '布尔值');
    };
    const list = (value, path, validate, uniqueIds = false) => {
        if (value === undefined) return;
        if (!Array.isArray(value)) fail(path, '列表');
        const ids = new Set();
        value.forEach((item, index) => {
            const location = `${path}[${index}]`;
            object(item, location);
            if (uniqueIds && (typeof item.id !== 'string' || !item.id || ids.has(item.id))) throw new Error(location + ' 包含无效或重复的 ID');
            if (uniqueIds) ids.add(item.id);
            validate(item, location);
        });
    };
    const message = (item, path) => {
        for (const key of ['id', 'role', 'content', 'senderId', 'originalContent']) optional(item[key], path + '.' + key, 'string');
        optional(item.timestamp, path + '.timestamp', 'number');
        for (const key of ['isWithdrawn', 'isThinking', 'isStatusUpdate', 'isContextDisabled']) optional(item[key], path + '.' + key, 'boolean');
        list(item.parts, path + '.parts', (part, location) => {
            optional(part.type, location + '.type', 'string');
            optional(part.text, location + '.text', 'string');
            optional(part.data, location + '.data', 'string');
        });
        if (item.quote !== undefined && item.quote !== null) {
            object(item.quote, path + '.quote');
            for (const key of ['messageId', 'senderId', 'senderName', 'content']) optional(item.quote[key], path + '.quote.' + key, 'string');
        }
        if (item.forwardedChat !== undefined) {
            object(item.forwardedChat, path + '.forwardedChat');
            list(item.forwardedChat.records, path + '.forwardedChat.records', message);
        }
    };
    const runtime = (item, path) => {
        list(item.history, path + '.history', message);
        list(item.callHistory, path + '.callHistory', (call, location) => {
            optional(call.summary, location + '.summary', 'string');
            list(call.context, location + '.context', message);
        });
        list(item.memoryJournals, path + '.memoryJournals', (journal, location) => {
            for (const key of ['id', 'title', 'content', 'timeline', 'category', 'vectorSupersededBy']) optional(journal[key], location + '.' + key, 'string');
            optional(journal.createdAt, location + '.createdAt', 'number');
            optional(journal.isFavorited, location + '.isFavorited', 'boolean');
            if (journal.range !== undefined) {
                object(journal.range, location + '.range');
                for (const name of ['start', 'end']) optional(journal.range[name], location + '.range.' + name, 'number');
            }
            if (journal.autoMemory !== undefined) {
                object(journal.autoMemory, location + '.autoMemory');
                optional(journal.autoMemory.version, location + '.autoMemory.version', 'number');
                optional(journal.autoMemory.kind, location + '.autoMemory.kind', 'string');
                optional(journal.autoMemory.committed, location + '.autoMemory.committed', 'boolean');
                list(journal.autoMemory.sources, location + '.autoMemory.sources', (source, sourcePath) => {
                    optional(source.id, sourcePath + '.id', 'string');
                    optional(source.hash, sourcePath + '.hash', 'string');
                }, true);
                list(journal.autoMemory.children, location + '.autoMemory.children', (child, childPath) => {
                    optional(child.id, childPath + '.id', 'string');
                    optional(child.hash, childPath + '.hash', 'string');
                }, true);
                if (journal.autoMemory.version === 1 && journal.autoMemory.committed) {
                    if (!journal.range || !Number.isInteger(journal.range.start) || journal.range.start < 1 || !Number.isInteger(journal.range.end) || journal.range.end < journal.range.start) fail(location + '.range', '有效楼层范围');
                    const sources = journal.autoMemory.kind === 'summary' ? journal.autoMemory.sources : journal.autoMemory.children;
                    if (!['summary', 'merged'].includes(journal.autoMemory.kind) || !Array.isArray(sources) || !sources.length || sources.some(source => typeof source.hash !== 'string' || !source.hash)) fail(location + '.autoMemory', '有效来源记录');
                }
            }
        });
        if (item.memoryVectorIndex !== undefined) {
            object(item.memoryVectorIndex, path + '.memoryVectorIndex');
            Object.entries(item.memoryVectorIndex).forEach(([indexId, entry]) => {
                const entryPath = `${path}.memoryVectorIndex.${indexId}`;
                object(entry, entryPath);
                optional(entry.version, entryPath + '.version', 'number');
                // Version 1 indexes are accepted for backward compatibility and are rebuilt lazily.
                if (entry.version !== 2) {
                    if (entry.vector !== undefined) {
                        if (!Array.isArray(entry.vector) || !entry.vector.length || entry.vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) fail(entryPath + '.vector', '有效数字列表');
                    }
                    return;
                }
                if (!Array.isArray(entry.chunks)) fail(entryPath + '.chunks', '列表');
                let dimension = null;
                entry.chunks.forEach((chunk, chunkIndex) => {
                    const chunkPath = `${entryPath}.chunks[${chunkIndex}]`;
                    object(chunk, chunkPath);
                    if (typeof chunk.key !== 'string' || !chunk.key) fail(chunkPath + '.key', '文本');
                    if (!Number.isInteger(chunk.start) || chunk.start < 0) fail(chunkPath + '.start', '非负整数');
                    if (!Number.isInteger(chunk.end) || chunk.end <= chunk.start) fail(chunkPath + '.end', '大于 start 的整数');
                    if (!Array.isArray(chunk.vector) || !chunk.vector.length || chunk.vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) fail(chunkPath + '.vector', '有效数字列表');
                    if (dimension === null) dimension = chunk.vector.length;
                    if (chunk.vector.length !== dimension) fail(chunkPath + '.vector', '维度一致的数字列表');
                });
            });
        }
        list(item.members, path + '.members', (member, location) => {
            optional(member.id, location + '.id', 'string');
            optional(member.realName, location + '.realName', 'string');
        });
        if (item.gallery !== undefined && !Array.isArray(item.gallery)) fail(path + '.gallery', '列表');
        for (const key of ['statusPanel', 'autoMemorySettings', 'vectorMemorySettings', 'friendRelationship', 'privateSessions', 'gossipSessions', 'peekData']) {
            if (item[key] !== undefined && item[key] !== null) object(item[key], path + '.' + key);
        }
        for (const key of ['persona', 'myPersona', 'realName', 'remarkName', 'myName', 'name', 'avatar']) optional(item[key], path + '.' + key, 'string');
        for (const key of ['privateSessions', 'gossipSessions']) {
            if (item[key]) Object.entries(item[key]).forEach(([id, session]) => {
                object(session, path + '.' + key + '.' + id);
                list(session.history, path + '.' + key + '.' + id + '.history', message);
            });
        }
    };
    object(modules, '备份内容');
    for (const key of ['characters', 'groups', 'worldBooks', 'myStickers', 'customFonts']) {
        list(modules[key], key, (item, path) => {
            if (key === 'characters' || key === 'groups') {
                runtime(item, path);
                optional(item.activeArchiveId, path + '.activeArchiveId', 'string');
                list(item.archives, path + '.archives', (archive, location) => {
                    if (archive.data !== undefined) { object(archive.data, location + '.data'); runtime(archive.data, location + '.data'); }
                }, true);
            }
            if (key === 'worldBooks') {
                optional(item.content, path + '.content', 'string');
                if (item.keys !== undefined && (!Array.isArray(item.keys) || item.keys.some(key => typeof key !== 'string'))) fail(path + '.keys', '文本列表');
            }
            if (key === 'customFonts' && (typeof item.dataUrl !== 'string' || !/^data:[^,]*;base64,/.test(item.dataUrl))) throw new Error(path + '.dataUrl 字体数据无效');
        }, true);
    }
    if (modules.mediaCache !== undefined) {
        object(modules.mediaCache, 'mediaCache');
        if (modules.mediaCache.version !== 1) throw new Error('相册与缓存迁移格式版本不支持');
        for (const key of ['characters', 'groups']) list(modules.mediaCache[key], 'mediaCache.' + key, (item, path) => {
            if (item.gallery !== undefined && !Array.isArray(item.gallery)) fail(path + '.gallery', '列表');
            list(item.archives, path + '.archives', (archive, location) => {
                if (!Array.isArray(archive.gallery)) fail(location + '.gallery', '列表');
            }, true);
        }, true);
        object(modules.mediaCache.tables, 'mediaCache.tables');
        for (const key of Object.keys(modules.mediaCache.tables)) {
            if (!STORAGE_CACHE_TABLES.includes(key)) throw new Error('缓存包包含不支持的数据表');
            const ids = new Set();
            list(modules.mediaCache.tables[key], 'mediaCache.tables.' + key, (item, path) => {
                if (!['string', 'number'].includes(typeof item.id) || (typeof item.id === 'number' && !Number.isFinite(item.id)) || ids.has(item.id)) throw new Error(path + ' 包含无效或重复 ID');
                ids.add(item.id);
                if (key === 'characterPhotos' && typeof item.charId !== 'string') fail(path + '.charId', '文本');
                if (key === 'workshopHistory' && typeof item.image !== 'string') fail(path + '.image', '文本');
                if (key.startsWith('reader_') && key !== 'reader_books' && typeof item.bookId !== 'string') fail(path + '.bookId', '文本');
                if (key === 'reader_books' && typeof item.title !== 'string') fail(path + '.title', '文本');
                if (key === 'reader_chapters' && typeof item.content !== 'string') fail(path + '.content', '文本');
            });
        }
    }
    for (const key of ['apiSettings', 'memoryApiSettings', 'vectorMemoryApiSettings', 'cotSettings', 'customIcons', 'insWidgetSettings', 'homeWidgetSettings', 'themeSettings', 'backupReminderSettings', 'workshopSettings']) {
        if (modules[key] !== undefined) object(modules[key], key);
    }
    for (const key of ['apiPresets', 'cotPresets', 'myPersonaPresets', 'bubbleCssPresets', 'globalCssPresets', 'fontPresets', 'statusBarPresets', 'themePresets', 'soundPresets', 'galleryPresets', 'chatFolders', 'workshopLlmPresets', 'workshopPromptPresets', 'widgetTemplates', 'addedWidgets']) list(modules[key], key, () => {});
    for (const key of ['wallpaper', 'globalCss', 'fontUrl', 'homeSignature', 'moreProfileCardBg', 'homeScreenMode']) optional(modules[key], key, 'string');
    if (modules.homeLayoutOrder !== undefined && (!Array.isArray(modules.homeLayoutOrder) || modules.homeLayoutOrder.some(id => typeof id !== 'string'))) fail('homeLayoutOrder', '文本列表');
    if (modules.homeLayoutPages !== undefined && modules.homeLayoutPages !== null && (!Array.isArray(modules.homeLayoutPages) || modules.homeLayoutPages.some(page => !Array.isArray(page) || page.some(id => typeof id !== 'string')))) fail('homeLayoutPages', '页面列表');
}

function storageMergeChats(targets, incoming, contacts, chats) {
    if (!Array.isArray(incoming)) return;
    incoming.forEach(imported => {
        if (!imported || typeof imported.id !== 'string') throw new Error('角色或群聊数据无效');
        let target = targets.find(item => item.id === imported.id);
        if (!target && !contacts) return;
        if (!target) { target = { id: imported.id, history: [], callHistory: [], memoryJournals: [] }; targets.push(target); }
        if (contacts) {
            const contact = storageContactData(imported);
            if (contact.statusPanel) contact.statusPanel = { ...target.statusPanel, ...contact.statusPanel };
            Object.assign(target, contact);
        }
        if (!chats) return;
        const applyRuntime = (destination, source) => {
            const data = storageRuntimeData(source);
            // Old backups have no index. Never pair newly restored history with
            // vectors from a different local story; the derived cache rebuilds lazily.
            if (source.history !== undefined && source.memoryVectorIndex === undefined) data.memoryVectorIndex = {};
            if (data.statusPanel) data.statusPanel = { ...destination.statusPanel, ...data.statusPanel };
            Object.assign(destination, data);
        };
        if (Array.isArray(imported.archives) && imported.archives.length) {
            const previous = target.archives || [];
            const archives = imported.archives.map(archive => {
                const existing = previous.find(item => item.id === archive.id);
                const data = contacts ? storageContactData(archive.data || {}) : { ...storageContactData(target), ...storageContactData(existing?.data || {}) };
                applyRuntime(data, archive.data || {});
                if (contacts && archive.data?.statusPanel) data.statusPanel = storageClone(archive.data.statusPanel);
                if (existing?.data?.gallery) data.gallery = existing.data.gallery;
                return { ...storageClone(archive), data };
            });
            previous.forEach(archive => { if (!archives.some(item => item.id === archive.id)) archives.push(archive); });
            target.archives = archives;
            target.activeArchiveId = archives.some(item => item.id === imported.activeArchiveId) ? imported.activeArchiveId : archives[0].id;
            applyRuntime(target, archives.find(item => item.id === target.activeArchiveId).data);
        }
        applyRuntime(target, imported);
    });
}
async function storageExportFonts() {
    if (!dexieDB?.customFonts) return [];
    const fonts = await dexieDB.customFonts.toArray();
    return Promise.all(fonts.filter(font => font.file).map(async font => ({ id: font.id, timestamp: font.timestamp,
        name: font.file.name || font.id, type: font.file.type || 'application/octet-stream',
        dataUrl: await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(font.file); }) })));
}

async function storageExportMediaCache() {
    const tables = {};
    const galleries = chat => ({ id: chat.id, gallery: storageClone(chat.gallery || []),
        archives: (chat.archives || []).map(archive => ({ id: archive.id,
            gallery: storageClone((archive.id === chat.activeArchiveId ? chat : archive.data)?.gallery || []) })) });
    const result = { version: 1, characters: db.characters.map(galleries), groups: db.groups.map(galleries), tables };
    const names = STORAGE_CACHE_TABLES.filter(key => dexieDB?.[key]);
    // Current cache tables store JSON and data URLs; never silently drop a future Blob field.
    const assertPortable = value => {
        if ((typeof Blob !== 'undefined' && value instanceof Blob) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
            throw new Error('缓存中包含暂不支持的二进制字段，请保留原设备数据');
        }
        if (value && typeof value === 'object') Object.values(value).forEach(assertPortable);
    };
    if (names.length) await dexieDB.transaction('r', names.map(key => dexieDB[key]), async () => {
        for (const key of names) {
            const rows = await dexieDB[key].toArray(); rows.forEach(assertPortable); tables[key] = rows;
        }
    });
    return result;
}

async function storageReadBackup(file, selection) {
    if (/\.ee$/i.test(file.name) && typeof DecompressionStream !== 'function') {
        throw new Error('当前浏览器不支持解压 .ee 备份，请升级浏览器，或使用原设备导出 .json 备份后导入');
    }
    if (typeof Worker === 'function') {
        const keys = [
            ...(selection.contacts || selection.chats ? ['characters', 'groups'] : []),
            ...(selection.worldbooks ? ['worldBooks'] : []), ...(selection.wallpapers ? ['myStickers'] : []),
            ...(selection.fonts ? ['customFonts'] : []), ...(selection.other ? ['mediaCache'] : []),
            ...Object.entries(STORAGE_IMPORT_CATEGORY_KEYS).flatMap(([category, items]) => selection[category] ? items : [])
        ];
        return new Promise((resolve, reject) => {
            let worker;
            try { worker = new Worker('js/modules/storage_backup_worker.js?v=20261104-memory-safety'); }
            catch (_) { reject(new Error('备份后台解析无法启动，请检查浏览器或网站脚本策略')); return; }
            const finish = () => { worker.terminate(); clearTimeout(timer); };
            const timer = setTimeout(() => { finish(); reject(new Error('备份解析超时，请按类别拆分后重试')); }, 180000);
            worker.onmessage = event => {
                finish();
                if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.modules);
            };
            worker.onerror = () => { finish(); reject(new Error('备份后台解析失败，请检查文件或按类别拆分')); };
            try { worker.postMessage({ file, keys }); }
            catch (_) { finish(); reject(new Error('无法将备份文件交给后台解析')); }
        });
    }
    if (file.size > 8 * 1024 * 1024) throw new Error('当前浏览器不支持后台解析，请升级浏览器或导入小于 8 MB 的分类备份');
    let text;
    if (/\.ee$/i.test(file.name)) {
        const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
        const parts = []; let bytes = 0;
        try {
            while (true) {
                const { value, done } = await reader.read(); if (done) break;
                bytes += value.byteLength;
                if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('当前浏览器不支持大备份后台解析，请升级浏览器或拆分备份'); }
                parts.push(value);
            }
            text = await new Blob(parts).text();
        } finally { reader.releaseLock(); }
    } else text = await file.text();
    const imported = JSON.parse(text);
    return imported?.modules ?? imported;
}
async function storageImportFonts(fonts) {
    if (!Array.isArray(fonts) || !fonts.length) return;
    if (!dexieDB?.customFonts) throw new Error('字体数据库尚未就绪');
    for (const font of fonts) {
        if (typeof font.id !== 'string' || typeof font.dataUrl !== 'string' || !/^data:[^,]*;base64,/.test(font.dataUrl)) throw new Error('备份字体数据无效');
        const bytes = Uint8Array.from(atob(font.dataUrl.slice(font.dataUrl.indexOf(',') + 1)), char => char.charCodeAt(0));
        await dexieDB.customFonts.put({ id: font.id, timestamp: font.timestamp, file: new File([bytes], font.name || font.id, { type: font.type || 'application/octet-stream' }) });
    }
}

async function storagePersistImportedSelection(selection, modules, pending) {
    const includeChats = selection.chats || selection.contacts || selection.other && !!modules.mediaCache;
    const hasChatData = Array.isArray(pending.characters) || Array.isArray(pending.groups);
    const hasWorldBooks = selection.worldbooks && Array.isArray(modules.worldBooks);
    const hasStickers = selection.wallpapers && Array.isArray(modules.myStickers);
    const hasFonts = selection.fonts && Array.isArray(modules.customFonts) && modules.customFonts.length > 0;
    const selectedSettingKeys = [
        ...(selection.personas ? STORAGE_IMPORT_CATEGORY_KEYS.personas : []),
        ...(selection.wallpapers ? STORAGE_IMPORT_CATEGORY_KEYS.wallpapers : []),
        ...(selection.fonts ? STORAGE_IMPORT_CATEGORY_KEYS.fonts : []),
        ...(selection.settings ? STORAGE_IMPORT_SETTING_KEYS : [])
    ].filter(key => modules[key] !== undefined);

    const tables = [];
    if (includeChats && hasChatData) tables.push(dexieDB.characters, dexieDB.groups);
    if (hasWorldBooks) tables.push(dexieDB.worldBooks);
    if (hasStickers) tables.push(dexieDB.myStickers);
    if (hasFonts) tables.push(dexieDB.customFonts);
    if (selectedSettingKeys.length) tables.push(dexieDB.globalSettings);
    const cacheTables = selection.other && modules.mediaCache ? Object.keys(modules.mediaCache.tables) : [];
    for (const name of cacheTables) {
        if (!dexieDB[name]) throw new Error('当前版本缺少缓存数据表：' + name);
        tables.push(dexieDB[name]);
    }
    if (!tables.length) return;

    const putBatches = async (table, records, size = 16) => {
        for (let offset = 0; offset < records.length; offset += size) await table.bulkPut(records.slice(offset, offset + size));
    };

    await dexieDB.transaction('rw', tables, async () => {
        if (includeChats && hasChatData) {
            for (const key of ['characters', 'groups']) {
                if (!pending[key]) continue;
                const ids = new Set([...(selection.contacts || selection.chats ? modules[key] || [] : []),
                    ...(selection.other ? modules.mediaCache?.[key] || [] : [])].map(chat => chat.id));
                const changed = pending[key].filter(chat => ids.has(chat.id));
                if (typeof syncChatActiveArchive === 'function') changed.forEach(chat => {
                    // 当前存档同步会替换 archive.data，先隔离存档外壳，失败时不触及原对象。
                    if (chat.archives) chat.archives = chat.archives.map(archive => ({ ...archive }));
                    syncChatActiveArchive(chat);
                });
                if (changed.length) await putBatches(dexieDB[key], changed, 1);
            }
        }
        if (hasWorldBooks) {
            await dexieDB.worldBooks.clear();
            await putBatches(dexieDB.worldBooks, pending.worldBooks);
        }
        if (hasStickers) {
            await dexieDB.myStickers.clear();
            await putBatches(dexieDB.myStickers, pending.myStickers);
        }
        if (hasFonts) await storageImportFonts(modules.customFonts);
        for (const name of cacheTables) {
            // Cache IDs and reader relationships form a snapshot; replace selected tables atomically.
            await dexieDB[name].clear();
            if (modules.mediaCache.tables[name].length) await putBatches(dexieDB[name], modules.mediaCache.tables[name]);
        }
        await Promise.all(selectedSettingKeys.map(key => dexieDB.globalSettings.put({ key, value: pending[key] })));
    });
}

async function storageCommitImport(selection, modules) {
    storageValidateModules(modules);
    const commit = async () => {
        const pending = storagePrepareImport(selection, modules);
        await storagePersistImportedSelection(selection, modules, pending);
        Object.assign(db, pending);
    };
    return runDataPersistence(commit);
}

// --- 导出逻辑 ---
async function handleExport() {
    if (storageBackupBusy) return;
    const exportSelection = { ...selectedModules };
    if (!Object.values(exportSelection).some(v => v)) {
        showToast('请至少选择一项要导出的数据');
        return;
    }

    const exportBtn = document.getElementById('storage-export-btn');
    const exportText = document.getElementById('storage-export-text');
    const format = document.getElementById('storage-export-format')?.value || 'ee';
    storageBackupBusy = true;
    exportBtn.disabled = true;
    exportText.textContent = '处理中...';

    try {
        let exportData = {
            version: appVersion,
            timestamp: new Date().toISOString(),
            modules: {}
        };

        // 1. Chats & Contacts
        if (exportSelection.chats || exportSelection.contacts) {
            exportData.modules.characters = [];
            exportData.modules.groups = [];

            exportData.modules.characters = db.characters.map(chat => storageExportChat(chat, exportSelection.contacts, exportSelection.chats));
            exportData.modules.groups = db.groups.map(chat => storageExportChat(chat, exportSelection.contacts, exportSelection.chats));
        }

        // 2. Worldbooks
        if (exportSelection.worldbooks) {
            exportData.modules.worldBooks = db.worldBooks;
        }

        // 3. Personas
        if (exportSelection.personas) {
            exportData.modules.myPersonaPresets = db.myPersonaPresets;
            exportData.modules.homeSignature = db.homeSignature;
            exportData.modules.activePersonaId = db.activePersonaId;
        }

        // 4. Wallpapers
        if (exportSelection.wallpapers) {
            exportData.modules.wallpaper = db.wallpaper;
            exportData.modules.bubbleCssPresets = db.bubbleCssPresets;
            exportData.modules.globalCss = db.globalCss;
            exportData.modules.globalCssPresets = db.globalCssPresets;
            exportData.modules.myStickers = db.myStickers;
            exportData.modules.moreProfileCardBg = db.moreProfileCardBg;
            exportData.modules.themeSettings = db.themeSettings;
            exportData.modules.themePresets = db.themePresets;
        }

        // 5. Fonts
        if (exportSelection.fonts) {
            exportData.modules.fontUrl = db.fontUrl;
            exportData.modules.fontPresets = db.fontPresets;
            exportData.modules.customFonts = await storageExportFonts();
        }

        // 6. Settings
        if (exportSelection.settings) {
            STORAGE_IMPORT_SETTING_KEYS.forEach(key => {
                exportData.modules[key] = db[key];
            });
        }

        if (exportSelection.other) exportData.modules.mediaCache = await storageExportMediaCache();
        let outputBlob;
        let extension = 'json';
        if (format !== 'json') {
            try {
                const stream = storageJsonStream(exportData) || new Blob([JSON.stringify(exportData)]).stream();
                const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
                outputBlob = await new Response(compressedStream).blob();
                extension = 'ee';
            } catch (compressError) {
                console.warn('压缩导出失败，改为兼容的 JSON 备份:', compressError);
            }
        }
        if (!outputBlob) {
            const stream = storageJsonStream(exportData);
            outputBlob = stream ? await new Response(stream).blob() : new Blob([JSON.stringify(exportData)]);
        }
        const url = URL.createObjectURL(outputBlob);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.href = url;
        downloadAnchorNode.download = `UwU_Backup_${new Date().toISOString().slice(0,10)}.${extension}`;
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(extension === 'ee' ? '导出成功' : '导出成功 (未压缩 JSON)');
    } catch (error) {
        console.error('导出失败:', error);
        showToast('导出失败，请重试');
    } finally {
        storageBackupBusy = false;
        exportBtn.disabled = false;
        exportText.textContent = '导出备份';
    }
}

// --- 导入逻辑 ---
async function handleImport(event) {
    const input = event.target;
    if (!input.files || input.files.length === 0) return;

    if (storageBackupBusy) { input.value = ''; return; }
    const importSelection = { ...selectedImportModules };
    if (!Object.values(importSelection).some(v => v)) {
        showToast('请至少选择一项要导入的数据类型');
        input.value = '';
        return;
    }

    const file = input.files[0];

    const importLabel = document.getElementById('storage-import-label');
    const importText = document.getElementById('storage-import-text');
    storageBackupBusy = true;
    importLabel.classList.add('disabled');
    importText.textContent = '处理中...';

    try {
        if (file.size > 32 * 1024 * 1024) showToast('大备份正在后台解析，请保持页面打开；内存不足时可按类别拆分备份');
        const mods = await storageReadBackup(file, importSelection);
        await storageCommitImport(importSelection, mods);
        showToast('导入成功，即将刷新页面');
        setTimeout(() => { window.location.reload(); }, 1500);
    } catch (error) {
        console.error('导入出错:', error);
        showToast('导入失败：' + error.message);
        storageBackupBusy = false;
        importLabel.classList.remove('disabled');
        importText.textContent = '导入备份';
        input.value = '';
    }
}

// --- 持久化存储逻辑 ---
async function checkAndRequestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted();
        if (isPersisted) {
            console.log("Storage is already persisted.");
            return;
        }

        const hasPrompted = localStorage.getItem('storage_persist_prompted');
        if (hasPrompted) return;

        showPersistencePrompt();
    }
}

function showPersistencePrompt() {
    if (document.getElementById('persistence-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'persistence-modal';
    modal.className = 'modal-overlay visible';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
        <div class="modal-window" style="max-width: 320px;">
            <h3 style="margin-bottom: 10px;">🛡️ 防止数据丢失</h3>
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px; font-size: 14px;">
                为了避免聊天记录被浏览器自动清理，建议开启<strong>持久化存储</strong>保护。<br>
                <span style="font-size: 12px; color: #999; display: block; margin-top: 8px;">(开启后，浏览器将不会在空间不足时自动删除你的数据)</span>
            </p>
            <div style="display: flex; gap: 10px;">
                <button id="persist-allow-btn" class="btn btn-primary" style="flex: 1;">开启保护</button>
                <button id="persist-later-btn" class="btn btn-neutral" style="flex: 1;">稍后</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('persist-allow-btn').onclick = async () => {
        const persisted = await navigator.storage.persist();
        if (persisted) {
            showToast("已成功开启持久化存储！");
        } else {
            showToast("开启失败，可能是浏览器策略限制。");
        }
        localStorage.setItem('storage_persist_prompted', 'true');
        modal.remove();
    };

    document.getElementById('persist-later-btn').onclick = () => {
        localStorage.setItem('storage_persist_prompted', 'true');
        modal.remove();
    };
}

// --- 清理图片缓存逻辑 ---
function setupCleanImageCache() {
    const openBtn = document.getElementById('open-clean-cache-btn');
    const modal = document.getElementById('clean-image-cache-modal');
    const form = document.getElementById('clean-image-cache-form');
    const cancelBtn = document.getElementById('cancel-clean-btn');
    const confirmBtn = document.getElementById('confirm-clean-btn');
    const loadingDiv = document.getElementById('clean-cache-loading');
    
    // The modal might not be in DOM immediately if it's injected, but it's in index.html currently.
    if (!modal || !form) return;
    
    const checkboxes = form.querySelectorAll('input[type="checkbox"]');

    let cacheSizes = {
        generated: 0,
        chat: 0,
        gallery: 0,
        stickers: 0
    };

    function isBase64Image(str) {
        if (typeof str !== 'string') return false;
        if (str.startsWith('data:image/')) return true;
        if (str.length > 1000 && !str.startsWith('http') && !str.includes(' ')) return true;
        return false;
    }

    function getStringSize(str) {
        return typeof str === 'string' ? str.length : 0;
    }

    async function calculateCacheSizes() {
        cacheSizes = { generated: 0, chat: 0, gallery: 0, stickers: 0 };

        if (dexieDB) {
            try {
                const workshopItems = await dexieDB.workshopHistory.toArray();
                workshopItems.forEach(item => {
                    if (isBase64Image(item.image)) cacheSizes.generated += getStringSize(item.image);
                });
                const photoItems = await dexieDB.characterPhotos.toArray();
                photoItems.forEach(item => {
                    if (isBase64Image(item.image)) cacheSizes.generated += getStringSize(item.image);
                });
                if (dexieDB.reader_comments) {
                    const comments = await dexieDB.reader_comments.toArray();
                    comments.forEach(item => {
                        if (item.content && item.content.startsWith('[ILLUSTRATION]')) {
                            cacheSizes.generated += getStringSize(item.content);
                        }
                    });
                }
            } catch (e) {
                console.error("Error calculating generated images size:", e);
            }
        }

        const processHistory = (history) => {
            if (!history) return;
            history.forEach(msg => {
                if (msg.content) {
                    if (isBase64Image(msg.content)) {
                        cacheSizes.chat += getStringSize(msg.content);
                    } else {
                        const imgRegex = /!\[.*?\]\((data:image\/[^)]+)\)/g;
                        let match;
                        while ((match = imgRegex.exec(msg.content)) !== null) {
                            cacheSizes.chat += getStringSize(match[1]);
                        }
                        const htmlImgRegex = /<img[^>]+src=["'](data:image\/[^"']+)["']/g;
                        while ((match = htmlImgRegex.exec(msg.content)) !== null) {
                            cacheSizes.chat += getStringSize(match[1]);
                        }
                    }
                }
                if (msg.parts) {
                    msg.parts.forEach(part => {
                        if (part.type === 'image' && (isBase64Image(part.data) || isBase64Image(part.url))) {
                            cacheSizes.chat += getStringSize(part.data || part.url);
                        }
                    });
                }
            });
        };
        storageChatHistories().forEach(processHistory);

        (db.characters || []).forEach(char => {
            if (char.gallery) {
                char.gallery.forEach(item => {
                    if (isBase64Image(item.url)) cacheSizes.gallery += getStringSize(item.url);
                });
            }
        });

        (db.myStickers || []).forEach(sticker => {
            if (isBase64Image(sticker.data)) cacheSizes.stickers += getStringSize(sticker.data);
        });

        document.getElementById('size-generated-images').textContent = `(${formatBytes(cacheSizes.generated)})`;
        document.getElementById('size-chat-images').textContent = `(${formatBytes(cacheSizes.chat)})`;
        document.getElementById('size-gallery-images').textContent = `(${formatBytes(cacheSizes.gallery)})`;
        document.getElementById('size-sticker-images').textContent = `(${formatBytes(cacheSizes.stickers)})`;
    }

    // Use event delegation for the open button since it's injected dynamically
    document.addEventListener('click', async (e) => {
        if (e.target && (e.target.id === 'open-clean-cache-btn' || e.target.closest('#open-clean-cache-btn'))) {
            modal.classList.add('visible');
            form.style.display = 'none';
            loadingDiv.style.display = 'block';
            confirmBtn.disabled = true;
            checkboxes.forEach(cb => cb.checked = false);

            await calculateCacheSizes();

            loadingDiv.style.display = 'none';
            form.style.display = 'block';
        }
    });

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            modal.classList.remove('visible');
        };
    }

    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const anyChecked = Array.from(checkboxes).some(c => c.checked);
            confirmBtn.disabled = !anyChecked;
        });
    });

    form.onsubmit = async (e) => {
        e.preventDefault();
        const selectedCategories = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
        
        if (selectedCategories.length === 0) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = '清理中...';

        try {
            let dataChanged = false;
            let removedStickerIds = [];

            if (selectedCategories.includes('generated') && dexieDB) {
                const workshopItems = await dexieDB.workshopHistory.toArray();
                const workshopIdsToDelete = workshopItems.filter(item => isBase64Image(item.image)).map(item => item.id);
                if (workshopIdsToDelete.length > 0) {
                    await dexieDB.workshopHistory.bulkDelete(workshopIdsToDelete);
                }

                const photoItems = await dexieDB.characterPhotos.toArray();
                const photoIdsToDelete = photoItems.filter(item => isBase64Image(item.image)).map(item => item.id);
                if (photoIdsToDelete.length > 0) {
                    await dexieDB.characterPhotos.bulkDelete(photoIdsToDelete);
                }

                if (dexieDB.reader_comments) {
                    const comments = await dexieDB.reader_comments.toArray();
                    const commentIdsToDelete = comments.filter(item => item.content && item.content.startsWith('[ILLUSTRATION]')).map(item => item.id);
                    if (commentIdsToDelete.length > 0) {
                        await dexieDB.reader_comments.bulkDelete(commentIdsToDelete);
                    }
                }
            }

            if (selectedCategories.includes('chat')) {
                const cleanHistory = (history) => {
                    if (!history) return;
                    history.forEach(msg => {
                        if (msg.content) {
                            if (isBase64Image(msg.content)) {
                                msg.content = '[图片已清理]';
                                dataChanged = true;
                            } else {
                                let originalContent = msg.content;
                                msg.content = msg.content.replace(/!\[.*?\]\((data:image\/[^)]+)\)/g, '[图片已清理]');
                                msg.content = msg.content.replace(/<img[^>]+src=["'](data:image\/[^"']+)["'][^>]*>/g, '[图片已清理]');
                                if (originalContent !== msg.content) dataChanged = true;
                            }
                        }
                        if (msg.parts) {
                            msg.parts.forEach(part => {
                                if (part.type === 'image' && (isBase64Image(part.data) || isBase64Image(part.url))) {
                                    part.data = '';
                                    delete part.url;
                                    part.type = 'text';
                                    part.text = '[图片已清理]';
                                    dataChanged = true;
                                }
                            });
                        }
                    });
                };
                storageChatHistories().forEach(cleanHistory);
            }

            if (selectedCategories.includes('gallery')) {
                (db.characters || []).forEach(char => {
                    if (char.gallery) {
                        const originalLength = char.gallery.length;
                        char.gallery = char.gallery.filter(item => !isBase64Image(item.url));
                        if (originalLength !== char.gallery.length) dataChanged = true;
                    }
                });
            }

            if (selectedCategories.includes('stickers')) {
                const originalLength = db.myStickers.length;
                removedStickerIds = db.myStickers.filter(sticker => isBase64Image(sticker.data)).map(sticker => sticker.id);
                db.myStickers = db.myStickers.filter(sticker => !isBase64Image(sticker.data));
                if (originalLength !== db.myStickers.length) dataChanged = true;
            }

            if (dataChanged) {
                await dexieDB.transaction('rw', dexieDB.tables, async () => {
                    if (removedStickerIds.length) await dexieDB.myStickers.bulkDelete(removedStickerIds);
                    await saveData();
                });
            }

            showToast('清理完成！');
            modal.classList.remove('visible');
            
            const screen = document.getElementById('storage-analysis-screen');
            if (screen && screen.classList.contains('active')) {
                currentStorageSizes = await calculateStorageSize();
                renderStorageUI();
            }

        } catch (error) {
            console.error("Error cleaning cache:", error);
            showToast('清理过程中发生错误');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '确认清理';
        }
    };
}

window.checkAndRequestPersistence = checkAndRequestPersistence;
window.setupStorageAnalysisScreen = setupStorageAnalysisScreen;
window.setupCleanImageCache = setupCleanImageCache;

// 当前存档与所有非当前分支均需清理，避免切换分支后图片重新出现。
function storageChatHistories() {
    const histories = new Set();
    for (const chat of [...(db.characters || []), ...(db.groups || [])]) {
        if (Array.isArray(chat.history)) histories.add(chat.history);
        for (const archive of chat.archives || []) {
            if (Array.isArray(archive.data?.history)) histories.add(archive.data.history);
        }
    }
    return [...histories];
}
