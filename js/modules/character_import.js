// --- 角色导入与创建模块 ---

let pendingImportData = null;
let characterImportPending = null;

function setupAddCharModal() {
    document.getElementById('add-char-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newChar = {
            peekData: {}, 
            id: `char_${Date.now()}`,
            realName: document.getElementById('char-real-name').value,
            remarkName: document.getElementById('char-remark-name').value,
            persona: '',
            avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
            myName: document.getElementById('my-name-for-char').value || 'user',
            myRemarkName: '',
            myPersona: '',
            myAvatar: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',
            theme: 'white_pink',
            maxMemory: 100,
            chatBg: '',
            history: [],
            isPinned: false,
            status: '在线',
            worldBookIds: [],
            useCustomBubbleCss: false,
            customBubbleCss: '',
            bilingualBubbleStyle: 'under',
            unreadCount: 0,
            memoryJournals: [],
            journalWorldBookIds: [],
            peekScreenSettings: { wallpaper: '', customIcons: {}, unlockAvatar: '' },
            lastUserMessageTimestamp: null,
            statusPanel: {
                enabled: false,
                promptSuffix: '',
                regexPattern: '',
                replacePattern: '',
                historyLimit: 3,
                currentStatusRaw: '',
                currentStatusHtml: '',
                history: []
            },
            autoReply: {
                enabled: false,
                interval: 60,
                lastTriggerTime: 0
            }
       };
        db.characters.push(newChar);
        await saveData();
        renderChatList();
        document.getElementById('add-char-modal').classList.remove('visible');
        showToast(`角色“${newChar.remarkName}”创建成功！`);
        promptForBackupIfNeeded('new_char');
    });
}

async function handleCharacterImport(file) {
    if (!file) return;
    showToast('正在解析角色卡...');
    try {
        let result;
        if (/\.(docx|txt)$/i.test(file.name)) {
            const document = await readImportDocument(file);
            result = { data: { name: file.name.replace(/\.[^.]+$/, ''), description: document.text }, avatar: null };
        } else if (file.name.toLowerCase().endsWith('.png')) {
            result = await parseCharPng(file);
        } else if (file.name.toLowerCase().endsWith('.json')) {
            result = await parseCharJson(file);
        } else {
            throw new Error('不支持的文件格式。请选择 PNG、JSON、DOCX 或 TXT 文件。');
        }

        if (result) {
            showImportConfirmModal(result.data, result.avatar);
        }
    } catch (error) {
        console.error('角色卡导入失败:', error);
        showToast(`导入失败: ${error.message}`);
    }
}

async function parseCharPng(file) {
    if (file.size > window.UvUCardPng.maxFileBytes) throw new Error('角色 PNG 超过 32 MiB 上限');
    const data = window.UvUCharacterCard.retain(window.UvUCardPng.read(new Uint8Array(await file.arrayBuffer())));
    const avatar = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取角色卡封面失败'));
        reader.readAsDataURL(file);
    });
    const restoredAvatar = window.UvUCardCover ? await window.UvUCardCover.restoreAvatar(avatar, data.data) : avatar;
    return { data, avatar: restoredAvatar };
}

function parseCharJson(file) {
    return new Promise((resolve, reject) => {
        if (file.size > 8 * 1024 * 1024) return reject(new Error('角色 JSON 超过 8 MiB 上限'));
        const reader = new FileReader();
        reader.readAsText(file, 'UTF-8');
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                const data = window.UvUCharacterCard ? window.UvUCharacterCard.retain(parsed) : parsed;
                resolve({ data: data, avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg' });
            } catch (error) {
                reject(new Error(`解析JSON失败: ${error.message}`));
            }
        };
        reader.onerror = () => reject(new Error('读取JSON文件失败。'));
    });
}

function createCharacterFromData(data, avatar) {
    // Deduplication must only see imports whose save or rollback has finished.
    const task = () => materializeCharacterFromData(data, avatar);
    const pending = characterImportPending ? characterImportPending.catch(() => {}).then(task) : task();
    characterImportPending = pending;
    const cleanup = () => { if (characterImportPending === pending) characterImportPending = null; };
    pending.then(cleanup, cleanup);
    return pending;
}

async function materializeCharacterFromData(data, avatar) {
    const retainedSource = window.UvUCharacterCard ? window.UvUCharacterCard.retain(data) : null;
    const charData = data.data || data;

    if (!charData || !charData.name) {
        throw new Error('角色卡数据无效，缺少角色名称。');
    }

    const newChar = {
        peekData: {},
        id: 'char_' + (globalThis.crypto?.randomUUID?.() || Date.now() + '_' + Math.random().toString(36).slice(2)),
        realName: charData.name || '未命名',
        remarkName: charData.name || '未命名',
        persona: charData.description || charData.persona || '',
        ...(retainedSource ? { characterCardSource: retainedSource } : {}),
        avatar: avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
        myName: 'user',
        myRemarkName: '',
        myPersona: '',
        myAvatar: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',
        theme: 'white_pink',
        maxMemory: 100,
        chatBg: '',
        history: [],
        isPinned: false,
        status: '在线',
            worldBookIds: [],
            useCustomBubbleCss: false,
            customBubbleCss: '',
            bilingualBubbleStyle: 'under',
            unreadCount: 0,
        memoryJournals: [],
        journalWorldBookIds: [],
        peekScreenSettings: { wallpaper: '', customIcons: {}, unlockAvatar: '' },
        lastUserMessageTimestamp: null,
        statusPanel: {
            enabled: false,
            promptSuffix: '',
            regexPattern: '',
            replacePattern: '',
            historyLimit: 3,
            currentStatusRaw: '',
            currentStatusHtml: '',
            history: []
        },
        autoReply: {
            enabled: false,
            interval: 60,
            lastTriggerTime: 0
        }
    };

    const importedWorldBookIds = [], addedBooks = [];
    const addBook = book => { db.worldBooks.push(book); addedBooks.push(book); };
    try {
    
    if (charData.character_book && Array.isArray(charData.character_book.entries)) {
        const categoryName = data.name || charData.name;
        
        let folderId = null;
        let folder = db.worldBooks.find(item => item.type === 'folder' && item.name === categoryName && !item.parentId);
        if (folder) {
            folderId = folder.id;
        } else {
            folderId = `wb_f_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            addBook({
                id: folderId,
                parentId: null,
                type: 'folder',
                name: categoryName,
                cardImportRoot: true
            });
        }

        const imported = importWorldBookJson(charData.character_book, folderId);
        imported.books.forEach(book => {
            const groupPath = book.importSource?.extensions?.uvu?.groupPath;
            const portable = book.importSource?.extensions?.uvu?.version === 1 && groupPath !== undefined;
            if (portable && (!Array.isArray(groupPath) || groupPath.length > 24 || groupPath.some(name => typeof name !== 'string' || !name.trim() || name.length > 2000))) throw new Error('世界书分组路径无效');
            const equivalent = db.worldBooks.find(w => w.type === 'entry' && !importedWorldBookIds.includes(w.id) && w.name === book.name && w.content === book.content && w.position === book.position && (w.depth ?? 100) === (book.depth ?? 100) && JSON.stringify(w.rules) === JSON.stringify(book.rules)
                && (!portable || JSON.stringify(w.importSource?.extensions?.uvu?.groupPath) === JSON.stringify(groupPath)));
            if (equivalent) { importedWorldBookIds.push(equivalent.id); return; }
            if (portable) {
                let parentId = folderId;
                for (const name of groupPath) {
                    let group = db.worldBooks.find(item => item.type === 'folder' && item.parentId === parentId && item.name === name);
                    if (!group) { group = { id: 'wb_f_' + crypto.randomUUID(), parentId, type: 'folder', name }; addBook(group); }
                    parentId = group.id;
                }
                book.parentId = parentId;
            }
            if (!portable && db.worldBooks.some(w => w.name === book.name)) book.name += ' (' + categoryName + ')';
            addBook(book); importedWorldBookIds.push(book.id);
        });
        if (imported.warnings.length) showToast('部分酒馆插入位置暂不支持，对应条目已停用，请到世界书确认');
    }
    else {
        const worldInfo = charData.world_info || charData.wi || '';
        if (worldInfo && typeof worldInfo === 'string' && worldInfo.trim() !== '') {
            const entries = worldInfo.split(/\n\s*\n/).filter(entry => entry.trim() !== '');
            
            if (entries.length > 0) {
                const categoryName = charData.name || '导入的角色设定';
                
                let folderId = null;
                let folder = db.worldBooks.find(item => item.type === 'folder' && item.name === categoryName && !item.parentId);
                if (folder) {
                    folderId = folder.id;
                } else {
                    folderId = `wb_f_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    addBook({
                        id: folderId,
                        parentId: null,
                        type: 'folder',
                        name: categoryName
                    });
                }

                entries.forEach(entryText => {
                    const lines = entryText.trim().split('\n');
                    if (lines.length > 0) {
                        const name = lines[0].trim();
                        const content = lines.slice(1).join('\n').trim();
                        if (name && content) {
                        // 策略：内容相同则复用，内容不同则重命名导入
                        const exactMatch = db.worldBooks.find(wb => wb.name.toLowerCase() === name.toLowerCase() && wb.content === content);
                        if (exactMatch) {
                            if (!importedWorldBookIds.includes(exactMatch.id)) importedWorldBookIds.push(exactMatch.id);
                        } else {
                            // 检查是否已经导入过重命名版本
                            const renamedName = `${name} (${charData.name || '未命名'})`;
                            const renamedMatch = db.worldBooks.find(wb => wb.name.toLowerCase() === renamedName.toLowerCase() && wb.content === content);
                            
                            if (renamedMatch) {
                                if (!importedWorldBookIds.includes(renamedMatch.id)) importedWorldBookIds.push(renamedMatch.id);
                            } else {
                                // 需要新建
                                let newBookName = name;
                                const nameConflict = db.worldBooks.find(wb => wb.name.toLowerCase() === name.toLowerCase());
                                if (nameConflict) {
                                    newBookName = renamedName;
                                    // 二次冲突检查
                                    if (db.worldBooks.some(wb => wb.name.toLowerCase() === newBookName.toLowerCase())) {
                                        newBookName = `${newBookName}_${Math.random().toString(36).substr(2, 4)}`;
                                    }
                                }
                                
                                const newBook = {
                                    id: `wb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                    parentId: folderId,
                                    type: 'entry',
                                    name: newBookName,
                                    content: content,
                                    position: 'after',
                                    category: categoryName
                                };
                                addBook(newBook);
                                importedWorldBookIds.push(newBook.id);
                            }
                        }
                    }
                }
                });
            }
        }
    }
    
    if (importedWorldBookIds.length > 0) {
        newChar.worldBookIds = importedWorldBookIds;
    }

    db.characters.push(newChar);
    await saveData();
    } catch (error) {
        const owned = new Set(addedBooks);
        db.worldBooks = db.worldBooks.filter(book => !owned.has(book));
        db.characters = db.characters.filter(character => character !== newChar);
        throw error;
    }
    renderChatList();
    showToast(`角色“${newChar.remarkName}”导入成功！`);
    if (importedWorldBookIds.length) setTimeout(() => showToast(`同时导入了 ${importedWorldBookIds.length} 条世界书设定。`), 1600);
    return newChar;
}

function setupImportConfirmModal() {
    const modal = document.getElementById('import-confirm-modal');
    const form = document.getElementById('import-confirm-form');
    const cancelBtn = document.getElementById('cancel-import-btn');
    const nameInput = document.getElementById('import-char-name');

    if (!modal || !form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!pendingImportData) return;

        const newName = nameInput.value.trim();
        if (!newName) return showToast('请输入角色真名');

        // 更新名字
        if (pendingImportData.data.data) {
            // 适配 V2 格式 (data.data.name)
            pendingImportData.data.data.name = newName;
        } else {
            // 适配 V1 格式 (data.name)
            pendingImportData.data.name = newName;
        }

        try {
            await createCharacterFromData(pendingImportData.data, pendingImportData.avatar);
            modal.classList.remove('visible');
            pendingImportData = null;
        } catch (error) {
            console.error(error);
            showToast('创建角色失败: ' + error.message);
        }
    });

    cancelBtn.addEventListener('click', () => {
        modal.classList.remove('visible');
        pendingImportData = null;
    });
}

function showImportConfirmModal(data, avatar) {
    const modal = document.getElementById('import-confirm-modal');
    const nameInput = document.getElementById('import-char-name');
    
    if (!modal) return;

    pendingImportData = { data, avatar };
    
    // 获取原始名字
    let originalName = '';
    if (data.data && data.data.name) {
        originalName = data.data.name;
    } else if (data.name) {
        originalName = data.name;
    }

    nameInput.value = originalName;
    modal.classList.add('visible');
}
