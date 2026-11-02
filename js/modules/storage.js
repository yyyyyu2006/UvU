// --- 存储分析与数据管理 (js/modules/storage.js) ---

const STORAGE_CATEGORIES = [
    { key: 'chats', name: '聊天记录', desc: '所有对话历史' },
    { key: 'contacts', name: '角色设定', desc: '联系人及角色卡片' },
    { key: 'worldbooks', name: '世界书', desc: '世界书条目数据' },
    { key: 'personas', name: '用户设定', desc: '用户人设数据' },
    { key: 'wallpapers', name: '壁纸与外观', desc: '自定义壁纸、主题、表情包' },
    { key: 'fonts', name: '字体', desc: '自定义字体文件' },
    { key: 'settings', name: '基础设置', desc: 'API配置、UI偏好等' },
    { key: 'other', name: '生图缓存', desc: '相册、工坊生图、阅读插图等' }
];

let currentStorageSizes = {};
let selectedModules = {
    chats: true,
    contacts: true,
    worldbooks: true,
    personas: true,
    wallpapers: true,
    fonts: true,
    settings: true
};

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
        return obj ? JSON.stringify(obj).length : 0;
    } catch (e) {
        return 0;
    }
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

    // 1. chats & contacts & other(gallery)
    (db.characters || []).forEach(char => {
        sizes.chats += stringifySize(char.history);
        sizes.chats += stringifySize(char.callHistory);
        sizes.other += stringifySize(char.gallery);
        
        const charBase = { ...char, history: undefined, callHistory: undefined, gallery: undefined };
        sizes.contacts += stringifySize(charBase);
    });
    (db.groups || []).forEach(group => {
        sizes.chats += stringifySize(group.history);
        sizes.chats += stringifySize(group.callHistory);
        
        const groupBase = { ...group, history: undefined, callHistory: undefined };
        sizes.contacts += stringifySize(groupBase);
    });

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
    const settingsKeys = [
        'apiSettings', 'apiPresets', 'cotSettings', 'cotPresets', 'homeScreenMode', 
        'customIcons', 'insWidgetSettings', 'homeWidgetSettings', 'chatFolders', 
        'fontSizeScale', 'savedKeyboardHeight', 'statusBarPresets', 'globalSendSound', 
        'globalReceiveSound', 'multiMsgSoundEnabled', 'soundPresets', 'galleryPresets', 
        'hasSeenVideoCallDisclaimer', 'hasSeenVideoCallAvatarHint', 'workshopSettings', 
        'workshopLlmPresets', 'workshopPromptPresets', 'homeLayoutOrder', 'homeLayoutPages', 
        'widgetTemplates', 'addedWidgets', 'backupReminderSettings', 'stUnlocked'
    ];
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
    backupOptions.innerHTML = '';
    STORAGE_CATEGORIES.forEach(cat => {
        if (cat.key === 'other') return; // 不在备份选项中显示其他缓存
        const size = currentStorageSizes[cat.key] || 0;
        const isChecked = selectedModules[cat.key] ? 'checked' : '';
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
            * 注：为避免备份文件过大导致崩溃，相册、工坊历史等包含大量图片的本地缓存数据不参与导出。
        </div>
    `;

    // Bind Checkbox Events
    document.querySelectorAll('.backup-module-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            selectedModules[e.target.dataset.key] = e.target.checked;
            updateSelectAllBtn();
        });
    });
    updateSelectAllBtn();
}

function updateSelectAllBtn() {
    const btn = document.getElementById('storage-select-all-btn');
    if (!btn) return;
    const allSelected = Object.values(selectedModules).every(v => v);
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
    const selectAllBtn = document.getElementById('storage-select-all-btn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const allSelected = Object.values(selectedModules).every(v => v);
            const newValue = !allSelected;
            Object.keys(selectedModules).forEach(k => selectedModules[k] = newValue);
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

// --- 导出逻辑 ---
async function handleExport() {
    if (!Object.values(selectedModules).some(v => v)) {
        showToast('请至少选择一项要导出的数据');
        return;
    }

    const exportBtn = document.getElementById('storage-export-btn');
    const exportText = document.getElementById('storage-export-text');
    exportBtn.disabled = true;
    exportText.textContent = '处理中...';

    try {
        let exportData = {
            version: appVersion,
            timestamp: new Date().toISOString(),
            modules: {}
        };

        // 1. Chats & Contacts
        if (selectedModules.chats || selectedModules.contacts) {
            exportData.modules.characters = [];
            exportData.modules.groups = [];

            db.characters.forEach(char => {
                let exportChar = { ...char };
                if (!selectedModules.chats) {
                    exportChar.history = [];
                    exportChar.callHistory = [];
                }
                if (!selectedModules.contacts) {
                    // If only exporting chats, we still need basic info to identify the char
                    exportChar = { id: char.id, name: char.name, history: char.history, callHistory: char.callHistory };
                }
                // 始终不导出 gallery
                exportChar.gallery = [];
                exportData.modules.characters.push(exportChar);
            });

            db.groups.forEach(group => {
                let exportGroup = { ...group };
                if (!selectedModules.chats) {
                    exportGroup.history = [];
                    exportGroup.callHistory = [];
                }
                if (!selectedModules.contacts) {
                    exportGroup = { id: group.id, name: group.name, history: group.history, callHistory: group.callHistory };
                }
                exportData.modules.groups.push(exportGroup);
            });
        }

        // 2. Worldbooks
        if (selectedModules.worldbooks) {
            exportData.modules.worldBooks = db.worldBooks;
        }

        // 3. Personas
        if (selectedModules.personas) {
            exportData.modules.myPersonaPresets = db.myPersonaPresets;
            exportData.modules.homeSignature = db.homeSignature;
            exportData.modules.activePersonaId = db.activePersonaId;
        }

        // 4. Wallpapers
        if (selectedModules.wallpapers) {
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
        if (selectedModules.fonts) {
            exportData.modules.fontUrl = db.fontUrl;
            exportData.modules.fontPresets = db.fontPresets;
        }

        // 6. Settings
        if (selectedModules.settings) {
            const settingsKeys = [
                'apiSettings', 'apiPresets', 'cotSettings', 'cotPresets', 'homeScreenMode', 
                'customIcons', 'insWidgetSettings', 'homeWidgetSettings', 'chatFolders', 
                'fontSizeScale', 'savedKeyboardHeight', 'statusBarPresets', 'globalSendSound', 
                'globalReceiveSound', 'multiMsgSoundEnabled', 'soundPresets', 'galleryPresets', 
                'hasSeenVideoCallDisclaimer', 'hasSeenVideoCallAvatarHint', 'workshopSettings', 
                'workshopLlmPresets', 'workshopPromptPresets', 'homeLayoutOrder', 'homeLayoutPages', 
                'widgetTemplates', 'addedWidgets', 'backupReminderSettings', 'stUnlocked'
            ];
            settingsKeys.forEach(key => {
                exportData.modules[key] = db[key];
            });
        }

        const jsonString = JSON.stringify(exportData);
        const dataBlob = new Blob([jsonString]);
        
        try {
            const compressionStream = new CompressionStream('gzip');
            const compressedStream = dataBlob.stream().pipeThrough(compressionStream);
            const compressedBlob = await new Response(compressedStream, { headers: { 'Content-Type': 'application/octet-stream' } }).blob();

            const url = URL.createObjectURL(compressedBlob);
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", url);
            downloadAnchorNode.setAttribute("download", `UwU_Backup_${new Date().toISOString().slice(0,10)}.ee`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            URL.revokeObjectURL(url);
            
            showToast('导出成功');
        } catch (compressError) {
            console.warn('压缩导出失败，尝试降级为未压缩导出:', compressError);
            // 降级为未压缩的 JSON 导出
            const url = URL.createObjectURL(dataBlob);
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", url);
            downloadAnchorNode.setAttribute("download", `UwU_Backup_${new Date().toISOString().slice(0,10)}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            URL.revokeObjectURL(url);
            
            showToast('导出成功 (未压缩)');
        }
    } catch (error) {
        console.error('导出失败:', error);
        showToast('导出失败，请重试');
    } finally {
        exportBtn.disabled = false;
        exportText.textContent = '导出备份';
    }
}

// --- 导入逻辑 ---
async function handleImport(event) {
    const input = event.target;
    if (!input.files || input.files.length === 0) return;

    if (!Object.values(selectedModules).some(v => v)) {
        showToast('请至少选择一项要导入的数据类型');
        input.value = '';
        return;
    }

    const file = input.files[0];

    const importLabel = document.getElementById('storage-import-label');
    const importText = document.getElementById('storage-import-text');
    importLabel.classList.add('disabled');
    importText.textContent = '处理中...';

    try {
        let jsonString;
        if (file.name.endsWith('.ee')) {
            const decompressionStream = new DecompressionStream('gzip');
            const decompressedStream = file.stream().pipeThrough(decompressionStream);
            jsonString = await new Response(decompressedStream).text();
        } else {
            jsonString = await file.text();
        }

        const importedData = JSON.parse(jsonString);
            if (!importedData.modules) {
                // 兼容旧版备份格式
                importedData.modules = importedData;
            }

            const mods = importedData.modules;

            // 1. Chats & Contacts
            if ((selectedModules.chats || selectedModules.contacts) && mods.characters) {
                mods.characters.forEach(importedChar => {
                    const existingCharIndex = db.characters.findIndex(c => c.id === importedChar.id);
                    if (existingCharIndex !== -1) {
                        let existingChar = db.characters[existingCharIndex];
                        if (selectedModules.chats && importedChar.history) {
                            existingChar.history = importedChar.history;
                            existingChar.callHistory = importedChar.callHistory || [];
                        }
                        if (selectedModules.contacts) {
                            // Merge contact info, keep existing history if not importing chats
                            const tempHistory = existingChar.history;
                            const tempCallHistory = existingChar.callHistory;
                            const tempGallery = existingChar.gallery;
                            
                            Object.assign(existingChar, importedChar);
                            
                            if (!selectedModules.chats) {
                                existingChar.history = tempHistory;
                                existingChar.callHistory = tempCallHistory;
                            }
                            // 始终保留原有的 gallery
                            existingChar.gallery = tempGallery;
                        }
                    } else if (selectedModules.contacts) {
                        // Only add new character if contacts is selected
                        db.characters.push(importedChar);
                    }
                });
            }

            if ((selectedModules.chats || selectedModules.contacts) && mods.groups) {
                mods.groups.forEach(importedGroup => {
                    const existingGroupIndex = db.groups.findIndex(g => g.id === importedGroup.id);
                    if (existingGroupIndex !== -1) {
                        let existingGroup = db.groups[existingGroupIndex];
                        if (selectedModules.chats && importedGroup.history) {
                            existingGroup.history = importedGroup.history;
                            existingGroup.callHistory = importedGroup.callHistory || [];
                        }
                        if (selectedModules.contacts) {
                            const tempHistory = existingGroup.history;
                            const tempCallHistory = existingGroup.callHistory;
                            Object.assign(existingGroup, importedGroup);
                            if (!selectedModules.chats) {
                                existingGroup.history = tempHistory;
                                existingGroup.callHistory = tempCallHistory;
                            }
                        }
                    } else if (selectedModules.contacts) {
                        db.groups.push(importedGroup);
                    }
                });
            }

            // 2. Worldbooks
            if (selectedModules.worldbooks && mods.worldBooks) {
                db.worldBooks = mods.worldBooks;
            }

            // 3. Personas
            if (selectedModules.personas) {
                if (mods.myPersonaPresets) db.myPersonaPresets = mods.myPersonaPresets;
                if (mods.homeSignature !== undefined) db.homeSignature = mods.homeSignature;
                if (mods.activePersonaId !== undefined) db.activePersonaId = mods.activePersonaId;
            }

            // 4. Wallpapers
            if (selectedModules.wallpapers) {
                if (mods.wallpaper !== undefined) db.wallpaper = mods.wallpaper;
                if (mods.bubbleCssPresets) db.bubbleCssPresets = mods.bubbleCssPresets;
                if (mods.globalCss !== undefined) db.globalCss = mods.globalCss;
                if (mods.globalCssPresets) db.globalCssPresets = mods.globalCssPresets;
                if (mods.myStickers) db.myStickers = mods.myStickers;
                if (mods.moreProfileCardBg !== undefined) db.moreProfileCardBg = mods.moreProfileCardBg;
                if (mods.themeSettings) db.themeSettings = mods.themeSettings;
                if (mods.themePresets) db.themePresets = mods.themePresets;
            }

            // 5. Fonts
            if (selectedModules.fonts) {
                if (mods.fontUrl !== undefined) db.fontUrl = mods.fontUrl;
                if (mods.fontPresets) db.fontPresets = mods.fontPresets;
            }

            // 6. Settings
            if (selectedModules.settings) {
                const settingsKeys = [
                    'apiSettings', 'apiPresets', 'cotSettings', 'cotPresets', 'homeScreenMode', 
                    'customIcons', 'insWidgetSettings', 'homeWidgetSettings', 'chatFolders', 
                    'fontSizeScale', 'savedKeyboardHeight', 'statusBarPresets', 'globalSendSound', 
                    'globalReceiveSound', 'multiMsgSoundEnabled', 'soundPresets', 'galleryPresets', 
                    'hasSeenVideoCallDisclaimer', 'hasSeenVideoCallAvatarHint', 'workshopSettings', 
                    'workshopLlmPresets', 'workshopPromptPresets', 'homeLayoutOrder', 'homeLayoutPages', 
                    'widgetTemplates', 'addedWidgets', 'backupReminderSettings', 'stUnlocked'
                ];
                settingsKeys.forEach(key => {
                    if (mods[key] !== undefined) {
                        db[key] = mods[key];
                    }
                });
            }

            await saveData();
            showToast('导入成功，即将刷新页面');
            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch (error) {
            console.error('导入出错:', error);
            showToast('导入失败，文件格式可能不正确');
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
                        if (part.type === 'image' && isBase64Image(part.data)) {
                            cacheSizes.chat += getStringSize(part.data);
                        }
                    });
                }
            });
        };
        (db.characters || []).forEach(char => processHistory(char.history));
        (db.groups || []).forEach(group => processHistory(group.history));

        (db.characters || []).forEach(char => {
            if (char.gallery) {
                char.gallery.forEach(item => {
                    if (isBase64Image(item.url)) cacheSizes.gallery += getStringSize(item.url);
                });
            }
        });

        (db.myStickers || []).forEach(sticker => {
            if (isBase64Image(sticker.url)) cacheSizes.stickers += getStringSize(sticker.url);
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
                                if (part.type === 'image' && isBase64Image(part.data)) {
                                    part.data = '';
                                    part.type = 'text';
                                    part.text = '[图片已清理]';
                                    dataChanged = true;
                                }
                            });
                        }
                    });
                };
                (db.characters || []).forEach(char => cleanHistory(char.history));
                (db.groups || []).forEach(group => cleanHistory(group.history));
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
                db.myStickers = db.myStickers.filter(sticker => !isBase64Image(sticker.url));
                if (originalLength !== db.myStickers.length) dataChanged = true;
            }

            if (dataChanged) {
                await saveData();
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
