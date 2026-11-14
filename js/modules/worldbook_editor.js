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
    const form = document.getElementById('edit-world-book-form');
    const advanced = document.createElement('details'); advanced.className = 'worldbook-advanced';
    advanced.innerHTML = '<summary>进阶设置：触发 / 概率</summary><label><input id="wb-advanced-enabled" type="checkbox">应用进阶触发规则</label><label><input id="wb-enabled" type="checkbox" checked>启用此条目</label><label>触发方式<select id="wb-strategy"><option value="constant">常驻（无需关键词）</option><option value="keyword">关键词触发</option></select></label><label>主要关键词（逗号分隔，任一匹配）<input id="wb-keys" type="text"></label><label>可选筛选关键词<input id="wb-secondary" type="text"></label><label>筛选逻辑<select id="wb-logic"><option value="0">AND ANY：至少一个匹配</option><option value="3">AND ALL：全部匹配</option><option value="2">NOT ANY：均不匹配</option><option value="1">NOT ALL：不全部匹配</option></select></label><label>扫描最近消息数<input id="wb-scan" type="number" min="0" max="10000" value="20"></label><label>触发概率 %<input id="wb-probability" type="number" min="0" max="100" value="100"></label><label><input id="wb-case" type="checkbox">关键词区分大小写</label><label><input id="wb-whole" type="checkbox">完整单词匹配（中文建议关闭）</label><p class="feature-help">未勾选“应用进阶触发规则”时，按原方式注入所有绑定条目并使用插入深度排序。启用后才应用本条目的常驻/关键词、扫描范围和概率设置。</p>';
    form.querySelector('[type=submit]').before(advanced);
    document.querySelector('label[for="world-book-depth"]').textContent = '插入顺序（数值越小越靠前）';
    const order = document.getElementById('world-book-depth'); order.min = '0'; order.max = '9999';
    const explanation = document.createElement('details'), explanationTitle = document.createElement('summary'), explanationText = document.createElement('pre');
    explanationTitle.textContent = '导入兼容 / 上次请求激活说明'; explanation.append(explanationTitle, explanationText); advanced.append(explanation);
    function fill(book) {
        const r = book?.rules || {};
        document.getElementById('wb-advanced-enabled').checked = r.advancedEnabled === true;
        document.getElementById('wb-enabled').checked = r.enabled !== false;
        document.getElementById('wb-strategy').value = r.constant === false ? 'keyword' : 'constant';
        document.getElementById('wb-keys').value = worldBookKeys(r.keys).join(', ');
        document.getElementById('wb-secondary').value = r.selective === false ? '' : worldBookKeys(r.secondaryKeys).join(', ');
        document.getElementById('wb-logic').value = r.selectiveLogic ?? 0;
        document.getElementById('wb-scan').value = r.scanDepth ?? 20;
        document.getElementById('wb-probability').value = r.probability ?? 100;
        document.getElementById('wb-case').checked = !!r.caseSensitive;
        document.getElementById('wb-whole').checked = !!r.wholeWords;
        if (book) order.value = r.order ?? book.depth ?? 100;
        if (book) {
            const position = form.querySelector(`input[name="world-book-position"][value="${book.position === 'chat' ? 'before' : book.position}"]`);
            if (position) position.checked = true;
        }
        const chat = typeof currentChatId !== 'undefined' ? [...(db.characters || []), ...(db.groups || [])].find(item => item.id === currentChatId) : null;
        const last = chat && getWorldBookPlanDiagnostics(chat).find(item => item.id === book?.id);
        const compatibility = book?.importCompatibility;
        explanation.hidden = !compatibility && !last;
        explanationText.textContent = [compatibility ? '支持：' + compatibility.supported.join('、') + '\n仅保留 / 未执行：' + (compatibility.preservedOnly.join('、') || '无已识别的兼容差异') + '\n高级规则需主动开启；未知上游字段保留在导入来源中。' : '',
            last ? '上次请求：' + last.reason + '\n命中关键词：' + (last.matchedKeys.join('、') || '无需关键词或未命中') + '\n扫描最近 ' + last.scanDepth + ' 条；实际位置 ' + last.position : '尚无此聊天的请求记录；打开面板不会重新激活或抽取概率。'].filter(Boolean).join('\n\n');
    }
    document.getElementById('world-book-list-container').addEventListener('click', e => {
        const book = db.worldBooks.find(w => w.id === e.target.closest('.wb-item-card')?.dataset.id);
        if (book?.type === 'entry' && !isWorldBookMultiSelectMode) fill(book);
    });
    document.getElementById('wb-menu-new-entry').addEventListener('click', () => fill());
    form.addEventListener('submit', () => {
        const read = id => document.getElementById(id).value;
        const rules = { advancedEnabled: document.getElementById('wb-advanced-enabled').checked, enabled: document.getElementById('wb-enabled').checked, constant: read('wb-strategy') === 'constant', keys: worldBookKeys(read('wb-keys')), secondaryKeys: worldBookKeys(read('wb-secondary')), selective: true, selectiveLogic: Number(read('wb-logic')), scanDepth: Number(read('wb-scan')), probability: Number(read('wb-probability')), order: Number(order.value), caseSensitive: document.getElementById('wb-case').checked, wholeWords: document.getElementById('wb-whole').checked };
        form.worldBookRules = rules;
    }, true);
    fill();
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

// Use one long-press action for the entire card; bulk management has its own menu entry.
function setupWorldBookLongPress(container) {
    if (container.dataset.longPressBound) return;
    container.dataset.longPressBound = 'true';
    let pending = null, blockedClick = null;
    const cancel = () => {
        if (pending) clearTimeout(pending.timer);
        pending = null;
    };
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
            requestWorldBookRename(gesture.id);
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
    container.addEventListener('click', event => {
        if (blockedClick?.until > Date.now() && event.target.closest('.wb-item-card')?.dataset.id === blockedClick.id) {
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
    renderWorldBookList(); showToast('已导入 ' + result.books.length + ' 条世界书' + (result.warnings.length ? '；兼容差异已保留，请展开条目说明核对' : ''));
}
