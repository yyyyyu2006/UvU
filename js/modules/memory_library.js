// 向量记忆的派生管理界面。原始聊天和总结提示词保持原样。
function memoryLibrarySnapshot(chat) {
    const archive = chat.activeArchiveId, history = chat.history, journals = chat.memoryJournals;
    return () => chat.activeArchiveId === archive && chat.history === history && chat.memoryJournals === journals &&
        [...(db.characters || []), ...(db.groups || [])].includes(chat);
}
function memoryLibraryGroups(journals, size = 6) {
    const categories = new Map();
    for (const journal of journals) {
        const key = journal.category || '未分类';
        if (!categories.has(key)) categories.set(key, []);
        categories.get(key).push(journal);
    }
    const groups = [];
    for (const [category, items] of categories) {
        items.sort((a, b) => String(a.timeline || '').localeCompare(String(b.timeline || ''), 'zh-CN', { numeric: true }) || a.createdAt - b.createdAt);
        for (let i = 0; i < items.length; i += size) groups.push({ category, sources: items.slice(i, i + size) });
    }
    return groups;
}
async function saveLibraryMemory(chat, fields, { existing = null, sources = [], isCurrent = memoryLibrarySnapshot(chat) } = {}) {
    if (!isCurrent()) throw new Error('存档已切换，请重新打开记忆管理');
    const content = String(fields.content || '').trim(), title = String(fields.title || '').trim();
    if (!title || !content) throw new Error('请填写标题和记忆正文');
    const before = (chat.memoryJournals || []).slice();
    if (existing && !before.includes(existing) || sources.some(source => !before.includes(source))) throw new Error('来源记忆已变化，请重新打开');
    const id = existing?.id || `manual_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`}`;
    const journal = { ...(existing || {}), id, title, content, category: String(fields.category || '').trim(),
        timeline: String(fields.timeline || '').trim(), createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
        range: existing?.range || { start: 0, end: 0 }, isFavorited: existing?.isFavorited ?? true, manualMemory: true };
    if (sources.length) journal.manualMergeSources = sources.map(source => ({ id: source.id, title: source.title, content: source.content,
        category: source.category || '', timeline: source.timeline || '', createdAt: source.createdAt, range: source.range }));
    const next = before.filter(item => item.id !== id).map(item => sources.includes(item) ? { ...item, vectorSupersededBy: id } : item);
    next.push(journal);
    chat.memoryJournals = next;
    try { await saveData(); }
    catch (error) { if (chat.memoryJournals === next) chat.memoryJournals = before; throw error; }
    return journal;
}

function openMemoryLibrary() {
    const type = currentChatType;
    const chat = (type === 'private' ? db.characters : db.groups).find(item => item.id === currentChatId);
    if (!chat) return;
    let isCurrent = memoryLibrarySnapshot(chat), closed = false;
    const jobs = new Set();
    const overlay = document.createElement('div'); overlay.className = 'feature-dialog memory-library';
    overlay.innerHTML = '<div class="feature-dialog-card"><header><strong>记忆管理</strong><button type="button" data-action="close">关闭</button></header><p class="feature-help">手动记忆和有效总结均可被向量检索。整合按分类分组，每组最多 6 篇；先对照原文与日期，再手动保存。旧记忆保留供追溯，确认合并后不再重复召回。历史剧情将在聊天请求时自动过滤并建立索引。</p><div class="memory-library-toolbar"><button type="button" data-action="add">添加记忆</button><button type="button" data-action="integrate">整合所选</button><button type="button" data-action="index">建立 / 更新剧情索引</button><label>分类<select class="memory-library-filter"><option value="">全部分类</option></select></label></div><p class="memory-library-status" aria-live="polite"></p><div class="memory-library-list"></div><div class="memory-library-groups"></div></div>';
    const list = overlay.querySelector('.memory-library-list'), status = overlay.querySelector('.memory-library-status');
    const filter = overlay.querySelector('.memory-library-filter');
    const selection = new Set();
    const assertCurrent = () => { if (closed || !isCurrent()) throw new Error('存档或记忆已变化，请重新打开记忆管理'); };
    const element = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
    const button = (text, callback) => { const el = element('button', text); el.type = 'button'; el.onclick = callback; return el; };
    const describe = journal => `剧情时间：${journal.timeline || '未指定'} · 创建：${new Date(journal.createdAt || 0).toLocaleString()} · 分类：${journal.category || '未分类'}`;
    const original = (journal, host) => {
        const details = element('details'), summary = element('summary', '对照原始聊天 / 合并来源'); details.append(summary);
        details.addEventListener('toggle', () => {
            if (!details.open || details.dataset.loaded) return;
            details.dataset.loaded = 'true';
            if (journal.manualMergeSources?.length) {
                for (const source of journal.manualMergeSources) details.append(element('pre', `${source.title}\n${describe(source)}\n${source.content}`));
            }
            const ids = new Set(journal.autoMemory?.sources?.map(source => source.id) || []);
            const start = Math.max(0, (journal.range?.start || 0) - 1), end = journal.range?.end || 0;
            const messages = ids.size ? (chat.history || []).filter(message => ids.has(message.id)) : (chat.history || []).slice(start, end);
            details.append(element('pre', messages.map(message => `${new Date(message.timestamp || 0).toLocaleString()} · ${message.role}\n${message.content || ''}`).join('\n\n') || '手动记忆，无关联聊天楼层。'));
        });
        host.append(details);
    };
    const fields = (host, value) => {
        const inputs = {};
        for (const [key, label] of [['title', '标题'], ['category', '分类'], ['timeline', '剧情时间线（可填日期或时间范围）'], ['content', '记忆正文']]) {
            const wrap = element('label', label), input = element(key === 'content' ? 'textarea' : 'input');
            input.value = value[key] || ''; if (key === 'content') input.rows = 8;
            inputs[key] = input; wrap.append(input); host.append(wrap);
        }
        return () => Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
    };
    const refresh = () => {
        selection.clear(); list.replaceChildren();
        const all = chat.memoryJournals || [];
        const previousFilter = filter.value;
        filter.replaceChildren(new Option('全部分类', ''));
        for (const category of [...new Set(all.map(journal => journal.category || '未分类'))].sort()) filter.add(new Option(category, category));
        if ([...filter.options].some(option => option.value === previousFilter)) filter.value = previousFilter;
        const valid = getAutoMemoryState(chat).validIds;
        const visible = all.filter(journal => !filter.value || (journal.category || '未分类') === filter.value)
            .sort((a, b) => b.createdAt - a.createdAt);
        for (const journal of visible) {
            const card = element('section', undefined, 'memory-library-card');
            const heading = element('label', undefined, 'memory-library-pick'), checkbox = element('input'); checkbox.type = 'checkbox';
            checkbox.disabled = Boolean(journal.vectorSupersededBy || journal.autoMemory && !valid.has(journal.id));
            checkbox.onchange = () => checkbox.checked ? selection.add(journal.id) : selection.delete(journal.id);
            heading.append(checkbox, element('strong', journal.title)); card.append(heading, element('p', describe(journal), 'feature-help'));
            if (checkbox.disabled) card.append(element('p', journal.vectorSupersededBy ? '已合并，保留原文；不再单独召回' : '总结来源已变化，不参与召回', 'feature-help'));
            card.append(element('pre', journal.content)); original(journal, card);
            card.append(button('编辑内容 / 分类 / 时间线', () => edit(journal)));
            list.append(card);
        }
        status.textContent = `共 ${all.length} 篇记忆；历史剧情索引 ${Object.keys(chat.memoryVectorIndex || {}).filter(id => id.startsWith('history:')).length} 组。`;
    };
    const edit = journal => {
        try { assertCurrent(); } catch (error) { showToast(error.message); return; }
        const editor = element('div', undefined, 'feature-dialog memory-library');
        const card = element('div', undefined, 'feature-dialog-card'); editor.append(card);
        card.append(element('h3', journal ? '编辑记忆' : '添加记忆'));
        const read = fields(card, journal || {});
        if (journal) original(journal, card);
        const actions = element('div', undefined, 'memory-library-toolbar');
        actions.append(button('取消', () => editor.remove()), button('保存', async event => {
            event.currentTarget.disabled = true;
            try {
                assertCurrent(); await saveLibraryMemory(chat, read(), { existing: journal, isCurrent });
                isCurrent = memoryLibrarySnapshot(chat); editor.remove(); refresh(); renderJournalList();
            } catch (error) { showToast(error.message); event.target.disabled = false; }
        }));
        card.append(actions); overlay.append(editor);
    };
    overlay.querySelector('[data-action="add"]').onclick = () => edit(null);
    filter.onchange = refresh;
    overlay.querySelector('[data-action="close"]').onclick = () => { closed = true; for (const job of jobs) { job.cancelled = true; job.controller?.abort(); } overlay.remove(); };
    overlay.querySelector('[data-action="index"]').onclick = async event => {
        const target = event.currentTarget;
        const control = new AbortController(); const job = { controller: control }; jobs.add(job);
        target.disabled = true; status.textContent = '正在过滤历史剧情并建立索引…';
        try {
            assertCurrent();
            if (!getAutoMemorySettings(chat).vectorSearchEnabled) throw new Error('请先在自动记忆设置中启用并配置向量 API');
            if (!db.vectorMemoryApiSettings?.embeddingModel || !db.vectorMemoryApiSettings?.url || !db.vectorMemoryApiSettings?.key) throw new Error('请填写独立向量 API 的地址、密钥和嵌入模型');
            await getVectorMemoryContext(chat, '回顾历史剧情的重要事件、约定和关系', control.signal);
            assertCurrent(); refresh(); status.textContent += ' 索引已更新。';
        } catch (error) { if (!closed) status.textContent = error.message; }
        finally { jobs.delete(job); target.disabled = false; }
    };
    overlay.querySelector('[data-action="integrate"]').onclick = () => {
        try { assertCurrent(); } catch (error) { showToast(error.message); return; }
        if (selection.size < 2) return showToast('请至少选择两篇记忆');
        const host = overlay.querySelector('.memory-library-groups'); host.replaceChildren();
        const groups = memoryLibraryGroups((chat.memoryJournals || []).filter(journal => selection.has(journal.id)));
        for (const group of groups) {
            const section = element('section', undefined, 'memory-library-card'); host.append(section);
            section.append(element('h3', `${group.category} · ${group.sources.length} 篇`));
            for (const source of group.sources) {
                const details = element('details'), summary = element('summary', `${source.title} · ${describe(source)}`);
                details.append(summary, element('pre', source.content)); original(source, details); section.append(details);
            }
            const output = element('div'), progress = element('p', '可以直接编辑合并内容，或让 AI 整合后再核对。', 'feature-help');
            const read = fields(output, { title: `${group.category} · 合并记忆`, category: group.category === '未分类' ? '' : group.category,
                timeline: [...new Set(group.sources.map(source => source.timeline).filter(Boolean))].join('；'),
                content: group.sources.map(source => `【${source.title}】\n${describe(source)}\n${source.content}`).join('\n\n') });
            const inputs = output.querySelectorAll('input,textarea');
            const hashes = group.sources.map(source => autoMemoryFingerprint(source));
            const sourcesCurrent = () => isCurrent() && group.sources.every((source, index) =>
                (chat.memoryJournals || []).includes(source) && autoMemoryFingerprint(source) === hashes[index]);
            let job = null;
            const ai = button('AI 整合 / 重试本组', async () => {
                if (job) return;
                try {
                    assertCurrent(); if (!sourcesCurrent()) throw new Error('来源记忆已变化，请重新选择');
                    job = { cancelled: false, controller: null }; jobs.add(job); ai.disabled = true; save.disabled = true; progress.textContent = '正在整合本组…';
                    const sources = group.sources.map(source => ({ ...source, range: source.range || { start: 0, end: 0 },
                        content: `剧情时间：${source.timeline || '未指定'}；创建日期：${new Date(source.createdAt || 0).toLocaleString()}\n${source.content}` }));
                    const result = await requestAutoMemory(chat, type, sources, 'merged', getAutoMemorySettings(chat), job);
                    assertCurrent(); if (job.cancelled || !sourcesCurrent()) throw new Error('操作已取消或来源已变化');
                    inputs[0].value = result.title; inputs[3].value = result.content;
                    progress.textContent = '整合完成；请对照上方原文和日期后保存。';
                } catch (error) { if (!closed) progress.textContent = `未应用：${error.message}。可重试本组或保留原样。`; }
                finally { jobs.delete(job); job = null; ai.disabled = false; save.disabled = false; }
            });
            const keep = button('保留原样', () => { if (job) { job.cancelled = true; job.controller?.abort(); } section.remove(); });
            const save = button('确认手动合并', async () => {
                save.disabled = true;
                try {
                    assertCurrent(); if (!sourcesCurrent()) throw new Error('来源记忆已变化，请重新选择');
                    await saveLibraryMemory(chat, read(), { sources: group.sources, isCurrent: sourcesCurrent });
                    isCurrent = memoryLibrarySnapshot(chat); section.remove(); refresh(); renderJournalList();
                } catch (error) { progress.textContent = error.message; save.disabled = false; }
            });
            const actions = element('div', undefined, 'memory-library-toolbar'); actions.append(ai, keep, save);
            section.append(output, progress, actions);
        }
        host.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    document.body.append(overlay); refresh();
}
function setupMemoryLibrary() {
    const entry = document.querySelector('#memory-journal-screen .auto-memory-entry');
    if (!entry) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-secondary';
    button.id = 'memory-library-open'; button.textContent = '记忆管理 / 手动合并'; button.onclick = openMemoryLibrary;
    entry.append(button);
}
