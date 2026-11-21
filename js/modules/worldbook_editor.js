function setupWorldBookDocumentTools() {
    const menu = document.getElementById('world-book-new-menu');
    const button = document.createElement('div'); button.className = 'menu-item'; button.id = 'wb-menu-import'; button.textContent = '导入 DOCX / TXT / JSON';
    button.addEventListener('click', () => chooseImportFile('.docx,.txt,.json', importWorldBookDocument)); menu.appendChild(button);
    const manage = document.createElement('div');
    manage.className = 'menu-item'; manage.id = 'wb-menu-multi-select'; manage.textContent = '多选管理';
    manage.addEventListener('click', () => {
        menu.style.display = 'none';
        enterWorldBookMultiSelectMode();
    });
    menu.appendChild(manage);

    const header = document.querySelector('#edit-world-book-screen > .app-header');
    if (header && !header.querySelector('.worldbook-editor-help')) {
        const help = document.createElement('button');
        help.type = 'button'; help.className = 'worldbook-editor-help'; help.setAttribute('aria-label', '使用说明');
        help.innerHTML = window.UvULucide?.['circle-help'] || '?';
        help.addEventListener('click', () => {
            const dialog = createMessageForwardDialog('使用说明', 'panel-explanation-dialog', () => queueMicrotask(() => { if (help.isConnected) help.focus({ preventScroll: true }); }));
            dialog.panel.classList.add('derived-settings');
            const text = document.createElement('p'); text.className = 'feature-help';
            text.textContent = '世界书沿用1900原版：绑定后按四类原位置加入提示词，插入深度仅用于排序，数值越小越靠前；0按原版视为100。没有关键词、概率或历史深度触发。导入的上游规则仅保留备份，不执行；不支持的位置需在条目中手动选择原版位置并保存后才能使用。';
            dialog.panel.append(text);
            // The panel decorator replaces the header; focus its final close control.
            requestAnimationFrame(() => {
                if (dialog.panel.isConnected) dialog.panel.querySelector('.sheet-close,.message-forward-close')?.focus({ preventScroll: true });
            });
        });
        const placeholder = header.querySelector('.placeholder');
        if (placeholder) placeholder.replaceWith(help); else header.append(help);
    }

}

const pendingWorldBookRenames = new Set();
async function renameWorldBookItem(id, value) {
    const item = db.worldBooks.find(book => book.id === id);
    if (!item) throw new Error('该世界书或文件夹已不存在');
    const name = String(value ?? '').trim();
    if (!name) throw new Error('名称不能为空');
    if (pendingWorldBookRenames.has(id)) throw new Error('正在保存，请稍后再试');
    if (name === item.name) return false;
    const previousName = item.name;
    pendingWorldBookRenames.add(id);
    item.name = name;
    try {
        await saveData();
    } catch (error) {
        if (item.name === name) item.name = previousName;
        throw error;
    } finally {
        pendingWorldBookRenames.delete(id);
    }
    if (db.worldBooks.includes(item)) {
        for (const stack of [wbPathStack, selectorPathStack]) {
            for (const part of stack) if (part.id === id) part.name = name;
        }
    }
    return true;
}

async function requestWorldBookRename(id) {
    const item = db.worldBooks.find(book => book.id === id);
    if (!item || pendingWorldBookRenames.has(id)) return;
    const value = prompt('重命名' + (item.type === 'folder' ? '文件夹' : '条目'), item.name);
    if (value === null) return;
    try {
        const changed = await renameWorldBookItem(id, value);
        renderWorldBookList();
        if (document.getElementById('world-book-selection-modal')?.classList.contains('visible')) renderWorldBookSelectorList();
        const container = document.getElementById('world-book-list-container');
        const card = [...container.querySelectorAll('.wb-item-card')].find(node => node.dataset.id === id);
        card?.querySelector('.wb-item-name')?.focus({ preventScroll: true });
        if (changed) showToast('名称已更新');
    } catch (error) {
        showToast('改名失败：' + (error.message || '请重试'));
    }
}

function requestWorldBookActions(id) {
    const item = db.worldBooks.find(book => book.id === id);
    if (!item || isWorldBookMultiSelectMode) return;
    const dialog = createMessageForwardDialog(item.name, 'worldbook-item-actions');
    for (const [action, label] of [['select', '多选管理'], ['rename', '重命名']]) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label; button.dataset.wbAction = action;
        button.addEventListener('click', () => {
            dialog.dismiss();
            if (!db.worldBooks.includes(item) || isWorldBookMultiSelectMode ||
                !document.getElementById('world-book-screen')?.classList.contains('active')) return;
            if (action === 'select') enterWorldBookMultiSelectMode(id);
            else requestWorldBookRename(id);
        });
        dialog.panel.appendChild(button);
    }
}

// Keep rename and the original bulk actions available from the same gesture.
function setupWorldBookLongPress(container) {
    if (container.dataset.longPressBound) return;
    container.dataset.longPressBound = 'true';
    let pending = null, blockedClick = null;
    const cancel = () => {
        if (pending) clearTimeout(pending.timer);
        pending = null;
    };
    document.addEventListener('pointerdown', () => { blockedClick = null; }, true);
    container.addEventListener('pointerdown', event => {
        cancel();
        if (event.isPrimary === false || event.button !== 0) return;
        blockedClick = null;
        const card = event.target.closest('.wb-item-card');
        if (!card || isWorldBookMultiSelectMode) return;
        const gesture = { card, id: card.dataset.id, pointerId: event.pointerId,
            x: event.clientX, y: event.clientY };
        pending = gesture;
        gesture.timer = setTimeout(() => {
            pending = null;
            if (!card.isConnected || document.hidden || isWorldBookMultiSelectMode ||
                !document.getElementById('world-book-screen')?.classList.contains('active')) return;
            blockedClick = { id: gesture.id, until: Infinity };
            requestWorldBookActions(gesture.id);
        }, 600);
    });
    container.addEventListener('pointermove', event => {
        if (pending && (event.pointerId !== pending.pointerId ||
            Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10)) cancel();
    }, { passive: true });
    container.addEventListener('pointerleave', cancel);
    document.addEventListener('pointerup', () => {
        cancel();
        if (blockedClick) blockedClick.until = Date.now() + 1000;
    }, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('scroll', cancel, true);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    container.addEventListener('contextmenu', event => {
        if (event.target.closest('.wb-item-card') && (pending || blockedClick?.until > Date.now())) event.preventDefault();
    });
    // Touch release can retarget its compatibility click to the newly opened backdrop.
    document.addEventListener('click', event => {
        if (event.detail !== 0 && blockedClick?.until > Date.now() &&
            (event.target.closest('.wb-item-card')?.dataset.id === blockedClick.id || event.target.closest('#worldbook-item-actions'))) {
            event.preventDefault(); event.stopImmediatePropagation();
            blockedClick = null;
        }
    }, true);
    container.addEventListener('keydown', event => {
        const card = event.target.closest('.wb-item-card');
        if (event.key !== 'F2' || !card || isWorldBookMultiSelectMode) return;
        event.preventDefault();
        requestWorldBookRename(card.dataset.id);
    });
}

async function importWorldBookDocument(file) {
    let result;
    const folderId = 'wb_f_' + crypto.randomUUID();
    if (/\.json$/i.test(file.name)) {
        if (file.size > 20 * 1024 * 1024) throw new Error('文件不能超过 20MB');
        result = importWorldBookJson(JSON.parse((await file.text()).replace(/^\uFEFF/, '')), folderId);
    } else {
        const doc = await readImportDocument(file);
        if (!doc.text.trim()) throw new Error('文档没有可用文字');
        result = { books: [{ id: 'wb_' + crypto.randomUUID(), parentId: folderId, type: 'entry', name: file.name.replace(/\.[^.]+$/, ''), content: doc.text.trim(), position: 'before', depth: 100 }], warnings: [] };
    }
    const note = result.warnings.length ? '\n' + result.warnings.slice(0, 5).join('\n') : '';
    if (!confirm('解析到 ' + result.books.length + ' 条世界书，导入到当前目录的新文件夹？导入后需在聊天设置中绑定。' + note)) return;
    const folder = { id: folderId, parentId: wbPathStack[wbPathStack.length - 1].id, type: 'folder', name: file.name.replace(/\.[^.]+$/, '') };
    const imported = new Set([folder, ...result.books]);
    db.worldBooks.push(folder, ...result.books);
    try { await saveData(); } catch (error) { db.worldBooks = db.worldBooks.filter(book => !imported.has(book)); throw error; }
    renderWorldBookList(); showToast('已导入 ' + result.books.length + ' 条世界书' + (result.warnings.length ? '；不支持的位置未启用，其他上游规则仅保留备份' : ''));
}
