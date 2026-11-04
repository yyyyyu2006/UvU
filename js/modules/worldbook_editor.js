function setupWorldBookDocumentTools() {
    const menu = document.getElementById('world-book-new-menu');
    const button = document.createElement('div'); button.className = 'menu-item'; button.id = 'wb-menu-import'; button.textContent = '导入 DOCX / TXT / JSON';
    button.addEventListener('click', () => chooseImportFile('.docx,.txt,.json', importWorldBookDocument)); menu.appendChild(button);
    const form = document.getElementById('edit-world-book-form');
    const advanced = document.createElement('details'); advanced.className = 'worldbook-advanced';
    advanced.innerHTML = '<summary>进阶设置：触发 / 概率</summary><label><input id="wb-enabled" type="checkbox" checked>启用此条目</label><label>触发方式<select id="wb-strategy"><option value="constant">常驻（无需关键词）</option><option value="keyword">关键词触发</option></select></label><label>主要关键词（逗号分隔，任一匹配）<input id="wb-keys" type="text"></label><label>可选筛选关键词<input id="wb-secondary" type="text"></label><label>筛选逻辑<select id="wb-logic"><option value="0">AND ANY：至少一个匹配</option><option value="3">AND ALL：全部匹配</option><option value="2">NOT ANY：均不匹配</option><option value="1">NOT ALL：不全部匹配</option></select></label><label>扫描最近消息数<input id="wb-scan" type="number" min="0" max="10000" value="20"></label><label>触发概率 %<input id="wb-probability" type="number" min="0" max="100" value="100"></label><label><input id="wb-case" type="checkbox">关键词区分大小写</label><label><input id="wb-whole" type="checkbox">完整单词匹配（中文建议关闭）</label><p class="feature-help">排序数值越大越靠后。关键词默认扫描最近 20 条有效上下文消息；概率每次请求只判断一次。暂不执行酒馆脚本、递归、向量检索和定时效果。</p>';
    form.querySelector('[type=submit]').before(advanced);
    document.querySelector('label[for="world-book-depth"]').textContent = '插入顺序（数值越小越靠前）';
    const order = document.getElementById('world-book-depth'); order.min = '0'; order.max = '9999';
    function fill(book) {
        const r = book?.rules || {};
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
    }
    document.getElementById('world-book-list-container').addEventListener('click', e => {
        const book = db.worldBooks.find(w => w.id === e.target.closest('.wb-item-card')?.dataset.id);
        if (book?.type === 'entry' && !isWorldBookMultiSelectMode) fill(book);
    });
    document.getElementById('wb-menu-new-entry').addEventListener('click', () => fill());
    form.addEventListener('submit', () => {
        const read = id => document.getElementById(id).value;
        const rules = { enabled: document.getElementById('wb-enabled').checked, constant: read('wb-strategy') === 'constant', keys: worldBookKeys(read('wb-keys')), secondaryKeys: worldBookKeys(read('wb-secondary')), selective: true, selectiveLogic: Number(read('wb-logic')), scanDepth: Number(read('wb-scan')), probability: Number(read('wb-probability')), order: Number(order.value), caseSensitive: document.getElementById('wb-case').checked, wholeWords: document.getElementById('wb-whole').checked };
        form.worldBookRules = rules;
    }, true);
    fill();
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
    const previous = db.worldBooks.slice();
    db.worldBooks.push({ id: folderId, parentId: wbPathStack[wbPathStack.length - 1].id, type: 'folder', name: file.name.replace(/\.[^.]+$/, '') }, ...result.books);
    try { await saveData(); } catch (error) { db.worldBooks = previous; throw error; }
    renderWorldBookList(); showToast('已导入 ' + result.books.length + ' 条世界书' + (result.warnings.length ? '；不支持的位置已停用，请编辑确认' : ''));
}
