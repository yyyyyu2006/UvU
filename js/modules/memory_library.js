// 向量记忆的派生管理界面。原始聊天和总结提示词保持原样。
function memoryLibrarySnapshot(chat) {
    const archive = chat.activeArchiveId, history = chat.history, journals = chat.memoryJournals;
    return () => chat.activeArchiveId === archive && chat.history === history && chat.memoryJournals === journals &&
        [...(db.characters || []), ...(db.groups || [])].includes(chat);
}
function memorySummarySentenceLinks(chat, journal) {
    const ids = new Set(journal.autoMemory?.sources?.map(s => s.id) || []), start = journal.range?.start || 0, end = journal.range?.end || 0;
    const normalize = text => String(text || '').replace(/\s+/g, '');
    const sources = (chat.history || []).map((message,index) => ({ message, floor:index+1 }))
        .filter(({message,floor}) => (ids.size ? ids.has(message.id) : start > 0 && floor >= start && floor <= end) &&
            ['user','assistant'].includes(message.role) && !message.isWithdrawn && !message.isHidden && !message.isContextDisabled && !message.isThinking && !message.isStatusUpdate)
        .slice(0,200).map(item => ({...item,text:normalize(String(item.message.content || '').slice(0,12000))}));
    return String(journal.content || '').slice(0,24000).split(/(?<=[。！？!?\n])/u).map(s => s.trim()).filter(Boolean).slice(0,80).map(sentence => {
        const text = normalize(sentence);
        return { sentence, matches: text.length < 4 ? [] : sources.filter(item => item.text.includes(text)).slice(0,5).map(({message,floor}) => ({id:message.id,floor})) };
    });
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
    const archiveId = chat.activeArchiveId;
    const before = (chat.memoryJournals || []).slice();
    if (existing && !before.includes(existing) || sources.some(source => !before.includes(source))) throw new Error('来源记忆已变化，请重新打开');
    const id = existing?.id || `manual_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`}`;
    const journal = { ...(existing || {}), id, title, content, category: String(fields.category || '').trim(),
        timeline: String(fields.timeline || '').trim(), createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
        range: existing?.range || { start: 0, end: 0 }, isFavorited: existing?.isFavorited ?? true, manualMemory: true };
    if (sources.length) journal.manualMergeSources = sources.map(source => JSON.parse(JSON.stringify({ id: source.id, title: source.title, content: source.content,
        category: source.category || '', timeline: source.timeline || '', createdAt: source.createdAt, range: source.range,
        source: source.source, bridgeReview: source.bridgeReview, externalSceneId: source.externalSceneId, isFavorited: source.isFavorited,
        characterMemoId: source.characterMemoId, characterMemoReference: source.characterMemoReference,
        autoMemory: source.autoMemory, manualMergeSources: source.manualMergeSources,
        memorySourceTarget: { chatId: chat.id, archiveId: String(archiveId || 'default') } })));
    const next = before.filter(item => item.id !== id).map(item => sources.includes(item) ? { ...item, vectorSupersededBy: id } : item);
    next.push(journal);
    const changes = new Map(next.filter(item => !before.includes(item)).map(item => [item.id,
        { applied: JSON.stringify(item), original: before.find(previous => previous.id === item.id) }]));
    chat.memoryJournals = next;
    try { await saveData(); }
    catch (error) {
        const restore = data => {
            if (!Array.isArray(data?.memoryJournals)) return;
            data.memoryJournals = data.memoryJournals.flatMap(item => {
                const change = changes.get(item.id);
                if (!change || JSON.stringify(item) !== change.applied) return [item];
                return change.original ? [change.original] : [];
            });
        };
        if (chat.activeArchiveId === archiveId) restore(chat);
        restore(chat.archives?.find(item => item.id === archiveId)?.data);
        throw error;
    }
    return journal;
}

function queryMemoryLibrary(journals, { query = '', category = '', source = '', status = '', from = '', to = '', page = 0, pageSize = 20, states = new Map() } = {}) {
    const terms = String(query).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const day = value => { const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/); return match ? match[0] : ''; };
    const matches = journals.filter(journal => {
        const actualSource = journal.source === 'sillytavern' ? 'sillytavern' : journal.autoMemory ? 'summary' : 'manual';
        const actualStatus = journal.qualityReview?.status === 'pending' ? 'review' : journal.vectorSupersededBy ? 'superseded' : states.get(journal.id) || 'pending';
        const stamp = day(journal.timeline) || (Number(journal.createdAt) > 0 ? new Date(journal.createdAt).toISOString().slice(0, 10) : '');
        const text = `${journal.title || ''}\n${journal.content || ''}\n${journal.timeline || ''}`.toLocaleLowerCase();
        return (!category || (journal.category || '未分类') === category) && (!source || source === actualSource) && (!status || status === actualStatus) &&
            (!from || stamp && stamp >= from) && (!to || stamp && stamp <= to) && terms.every(term => text.includes(term));
    }).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    pageSize = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 20)));
    const pages = Math.max(1, Math.ceil(matches.length / pageSize)); page = Math.max(0, Math.min(pages - 1, Math.floor(Number(page) || 0)));
    return { items: matches.slice(page * pageSize, (page + 1) * pageSize), total: matches.length, pages, page };
}
function inspectMemoryMerge(sources) {
    const warnings = [], texts = new Map(), titles = new Map();
    for (const source of sources) {
        const text = String(source.content || '').replace(/\s+/g, '').trim();
        if (text && texts.has(text)) warnings.push(`“${source.title || source.id}”与“${texts.get(text)}”正文重复`);
        else if (text) texts.set(text, source.title || source.id);
        const key = String(source.title || '').trim();
        if (key && titles.has(key) && titles.get(key).content !== source.content) warnings.push(`同名记忆“${key}”内容不同，请核对人物、日期与事件`);
        else titles.set(key, source);
    }
    const timelines = new Set(sources.map(source => source.timeline).filter(Boolean));
    if (timelines.size > 1) warnings.push('来源包含不同剧情时间，请对照日期，避免把多次事件当成同一次');
    return warnings;
}
async function undoLibraryMemoryMerge(chat, merged, { isCurrent = memoryLibrarySnapshot(chat) } = {}) {
    if (!isCurrent() || !(chat.memoryJournals || []).includes(merged)) throw new Error('存档或合并记忆已变化，请重新打开');
    if (!merged.manualMergeSources?.length || merged.vectorSupersededBy) throw new Error('该记忆无法撤销，请先处理后续合并');
    const before = chat.memoryJournals, archiveId = chat.activeArchiveId;
    const next = before.filter(item => item !== merged).map(item => {
        if (item.vectorSupersededBy !== merged.id) return item;
        const restored = { ...item }; delete restored.vectorSupersededBy; return restored;
    });
    const changes = new Map(before.filter(item => !next.includes(item)).map(item => [item.id, item]));
    chat.memoryJournals = next;
    try { await saveData(); }
    catch (error) {
        const restore = target => {
            if (!Array.isArray(target?.memoryJournals)) return;
            target.memoryJournals = target.memoryJournals.map(item => {
                const applied = next.find(entry => entry.id === item.id), old = changes.get(item.id);
                return old && applied && JSON.stringify(item) === JSON.stringify(applied) ? old : item;
            });
            if (!target.memoryJournals.some(item => item.id === merged.id)) target.memoryJournals.push(merged);
        };
        if (chat.activeArchiveId === archiveId) restore(chat);
        restore(chat.archives?.find(item => item.id === archiveId)?.data);
        throw error;
    }
}

function memoryLibraryCacheScopes(rows, chat, type, activeScope) {
    return rows.flatMap(row => {
        let scope; try { scope = JSON.parse(row.id); } catch (_) { return []; }
        if (!Array.isArray(scope) || scope.length !== 4 || scope[0] !== type || scope[1] !== chat.id) return [];
        return [{ ...row, archiveId: scope[2], current: row.id === activeScope }];
    });
}

async function memoryLibraryMigrationPreview(chat, type) {
    const api = vectorMemoryApiFingerprint(resolveVectorMemoryApi()), snapshot = JSON.stringify(chat);
    const guard = () => { if (JSON.stringify(chat) !== snapshot || vectorMemoryApiFingerprint(resolveVectorMemoryApi()) !== api) throw Error('存档或向量配置已变化，请刷新预览'); };
    const scopes = typeof VectorIndexStore !== 'undefined' ? memoryLibraryCacheScopes(await VectorIndexStore.listScopes(), chat, type, '') : [];
    guard();
    const active = chat.activeArchiveId || 'default';
    const archives = new Map((chat.archives || []).map(archive => [archive.id, archive]));
    if (!archives.has(active)) archives.set(active, { id: active, name: '当前存档' });
    for (const row of scopes) if (!archives.has(row.archiveId)) archives.set(row.archiveId, { id: row.archiveId, name: '旧存档（原文不可用）', unavailable: true });
    const result = [];
    for (const [archiveId, archive] of archives) {
        const target = { ...chat, ...(archiveId === active ? {} : archive.data || {}), activeArchiveId: archiveId, autoMemorySettings: chat.autoMemorySettings };
        if (archiveId !== active) { target.history = archive.data?.history || []; target.memoryJournals = archive.data?.memoryJournals || []; target.memoryVectorIndex = archive.data?.memoryVectorIndex || {}; }
        const scope = VectorMemoryTools.indexScope(target, api, type), matching = scopes.filter(row => row.archiveId === archiveId);
        if (getAutoMemorySettings(chat).vectorExternalIndex && typeof VectorIndexStore !== 'undefined') {
            const stored = await VectorIndexStore.read(scope); guard();
            target.memoryVectorIndex = { ...target.memoryVectorIndex, ...stored.index };
        }
        const preview = archive.unavailable ? null : getVectorMemoryIndexPreview(target);
        result.push({ archiveId, name: archive.name || archiveId, active: archiveId === active, unavailable: Boolean(archive.unavailable),
            currentChunks: matching.filter(row => row.id === scope).reduce((n, row) => n + row.chunkCount, 0),
            oldVersions: matching.filter(row => row.id !== scope).length, oldChunks: matching.filter(row => row.id !== scope).reduce((n, row) => n + row.chunkCount, 0),
            totalSources: preview?.totalSources || 0, newChunks: preview?.newChunks || 0, reusedChunks: preview?.reusedChunks || 0 });
    }
    guard(); return result;
}

function openMemoryLibrary() {
    const type = currentChatType;
    const chat = (type === 'private' ? db.characters : db.groups).find(item => item.id === currentChatId);
    if (!chat) return;
    let isCurrent = memoryLibrarySnapshot(chat), closed = false;
    const jobs = new Set();
    const overlay = document.createElement('div'); overlay.className = 'feature-dialog memory-library';
    overlay.innerHTML = '<div class="feature-dialog-card"><header><strong>记忆管理</strong><button type="button" data-action="close">关闭</button></header><div class="memory-library-toolbar"><button type="button" data-action="add">添加</button><button type="button" data-action="integrate">整合</button><button type="button" data-action="index">续建索引</button><button type="button" data-action="rebuild">重建索引</button><button type="button" data-action="pause" disabled>暂停</button><label><span class="sr-only">分类</span><select class="memory-library-filter" aria-label="分类"><option value="">全部分类</option></select></label></div><p class="memory-library-status" aria-live="polite"></p><div class="memory-library-list"></div><div class="memory-library-groups"></div></div>';
    const list = overlay.querySelector('.memory-library-list'), status = overlay.querySelector('.memory-library-status');
    const filter = overlay.querySelector('.memory-library-filter');
    const selection = new Set();
    let page = 0, indexJob = null;
    const stateLabels = { valid: '有效', pending: '待建立 / 续建', changed: '来源或模型改变', missing: '来源已移除', dimension: '维度不匹配', superseded: '已合并', review: '待质量审阅' };
    const assertCurrent = () => { if (closed || !isCurrent()) throw new Error('存档或记忆已变化，请重新打开记忆管理'); };
    const element = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
    const button = (text, callback) => { const el = element('button', text); el.type = 'button'; el.onclick = callback; return el; };
    const toolbar = overlay.querySelector('.memory-library-toolbar');
    const indexActions = element('details', undefined, 'memory-library-index-actions');
    indexActions.append(element('summary', '索引'));
    for (const action of ['index', 'rebuild', 'pause']) indexActions.append(toolbar.querySelector(`[data-action="${action}"]`));
    toolbar.insertBefore(indexActions, toolbar.querySelector('label'));
    const filters = element('div', undefined, 'memory-library-filters');
    const addInput = (label, type) => { const wrap = element('label', label), input = element('input'); input.type = type; wrap.append(input); filters.append(wrap); return input; };
    const search = addInput('搜索标题 / 正文 / 时间线', 'search'), from = addInput('开始日期', 'date'), to = addInput('结束日期', 'date');
    const addSelect = (label, entries) => { const wrap = element('label', label), select = element('select');
        for (const [value, text] of entries) { const option = element('option', text); option.value = value; select.append(option); }
        wrap.append(select); filters.append(wrap); return select; };
    const sourceFilter = addSelect('来源', [['', '全部来源'], ['manual', '手动记忆'], ['summary', '自动总结'], ['sillytavern', '酒馆导入']]);
    const stateFilter = addSelect('索引状态', [['', '全部状态'], ...Object.entries(stateLabels)]);
    const filterDisclosure = element('details', undefined, 'memory-library-filter-disclosure');
    filterDisclosure.append(element('summary', '筛选'), filters);
    toolbar.after(filterDisclosure);
    const tuning = element('details', undefined, 'memory-library-tuning'); tuning.append(element('summary', '本存档记忆限额与总结审阅（默认关闭）'));
    const tuningInputs = {};
    const settings = getAutoMemorySettings(chat);
    for (const [key, label, type, min, max] of [
        ['summaryQualityReviewEnabled', '自动总结先保存为待审草稿；人工确认后才覆盖来源', 'checkbox'],
        ['vectorIndexBudgetEnabled', '启用每轮建库限额，未完成时使用已有有效索引', 'checkbox'],
        ['vectorIndexMaxBatches', '每轮最多嵌入批次（0 = 只检索已有索引）', 'number', 0, 100],
        ['vectorIndexTimeBudgetMs', '建库等待预算（毫秒；单请求计时精度 1 秒）', 'number', 100, 120000],
        ['vectorContextBudgetEnabled', '启用向量命中正文字数限额', 'checkbox'],
        ['vectorContextMaxChars', '向量命中正文最多字数（不含标题；不是精确 Token）', 'number', 200, 60000]
    ]) {
        const wrap = element('label', label), input = element('input'); input.type = type;
        if (type === 'checkbox') input.checked = settings[key]; else { input.value = settings[key]; input.min = min; input.max = max; }
        tuningInputs[key] = input; wrap.append(input); tuning.append(wrap);
    }
    tuning.append(element('p', '限额仅作用于向量派生内容；原收藏与自动总结注入继续使用原规则。手动续建不受每轮批次限额约束，可随时暂停。', 'feature-help'));
    tuning.append(element('p', '待审总结可编辑确认、重试或放弃。保存报错时先检查存储，不要直接刷新；待审稿可能仅保留在当前页面，原文继续保留。', 'feature-help'));
    tuning.append(button('保存记忆选项', async () => {
        try {
            assertCurrent(); const before = chat.autoMemorySettings;
            const changes = Object.fromEntries(Object.entries(tuningInputs).map(([key, input]) => [key, input.type === 'checkbox' ? input.checked : Number(input.value)]));
            const next = mergeAutoMemorySettings(before, changes); chat.autoMemorySettings = next;
            try { await saveData(); } catch (error) { if (chat.autoMemorySettings === next) chat.autoMemorySettings = before; throw error; }
            isCurrent = memoryLibrarySnapshot(chat); status.textContent = '记忆选项已保存。';
        } catch (error) { status.textContent = error.message; }
    }));
    const diagnostics = element('details', undefined, 'memory-library-diagnostics'); diagnostics.append(element('summary', '本轮检索诊断 / 来源索引状态'));
    const diagnosticText = element('pre'); diagnostics.append(diagnosticText);
    const migration = element('details', undefined, 'memory-library-migration');
    migration.append(element('summary', '模型 / 分块变更：各存档重建预览'));
    const migrationText = element('pre');
    let migrationSequence = 0;
    const loadMigration = async () => {
        const sequence = ++migrationSequence; migrationText.textContent = '正在读取索引范围…';
        try {
            assertCurrent();
            const rows = await memoryLibraryMigrationPreview(chat, type === 'private' ? 'character' : 'group');
            assertCurrent(); if (sequence !== migrationSequence) return;
            migrationText.textContent = rows.map(row => `${row.name}${row.active ? '（当前）' : ''}：${row.totalSources} 个来源；待嵌入 ${row.newChunks} 块 / 可复用 ${row.reusedChunks} 块；当前模型索引 ${row.currentChunks} 块；其他模型版本 ${row.oldVersions} 份 / ${row.oldChunks} 块${row.unavailable ? '；仅缓存，原存档内容不可用' : ''}`).join('\n') + '\n按当前已保存的模型和分块设置估算；不发送请求。重建按钮只处理当前存档，其他模型缓存保留，失败后可恢复旧模型继续使用。';
        } catch (error) { if (!closed && sequence === migrationSequence) migrationText.textContent = error.message; }
    };
    migration.append(button('刷新各存档预览', loadMigration), migrationText);
    migration.addEventListener('toggle', () => { if (migration.open) loadMigration(); });
    const pagination = element('div', undefined, 'memory-library-toolbar'); list.after(pagination);
    overlay.querySelector('.feature-dialog-card').append(tuning, diagnostics, migration);
    if (typeof VectorIndexStore !== 'undefined' && typeof VectorMemoryTools !== 'undefined') {
        const caches = element('details', undefined, 'memory-library-cache');
        caches.append(element('summary', '独立索引缓存'));
        const cacheList = element('div', undefined, 'memory-library-cache-list');
        const loadCaches = async () => {
            cacheList.textContent = '正在读取…';
            try {
                assertCurrent();
                const activeScope = VectorMemoryTools.indexScope(chat, vectorMemoryApiFingerprint(resolveVectorMemoryApi()));
                const rows = memoryLibraryCacheScopes(await VectorIndexStore.listScopes(), chat, type === 'private' ? 'character' : 'group', activeScope);
                assertCurrent(); cacheList.replaceChildren();
                if (!rows.length) cacheList.append(element('p', '暂无独立索引', 'feature-help'));
                for (const row of rows) {
                    const archive = chat.archives?.find(item => item.id === row.archiveId);
                    const item = element('div', undefined, 'memory-library-cache-row');
                    const label = `${archive?.name || (row.archiveId === (chat.activeArchiveId || 'default') ? '当前存档' : '旧存档')} · ${row.sourceCount} 个来源 / ${row.chunkCount} 块`;
                    item.append(element('span', label));
                    const remove = button(row.current ? '使用中' : '清理', async event => {
                        if (indexJob) return showToast('请等待建库完成后清理');
                        if (!confirm('清理这份旧索引缓存？原聊天、日记和待审稿会保留，可重新建立索引。')) return;
                        const target = event.currentTarget; target.disabled = true;
                        try {
                            assertCurrent();
                            const latestScope = VectorMemoryTools.indexScope(chat, vectorMemoryApiFingerprint(resolveVectorMemoryApi()));
                            if (row.id === latestScope) throw Error('当前索引正在使用，请刷新清单');
                            await VectorIndexStore.removeScope(row.id, row.updatedAt);
                            if (!closed) await loadCaches();
                        } catch (error) { if (!closed) { status.textContent = error.message; target.disabled = false; } }
                    });
                    remove.disabled = row.current; item.append(remove); cacheList.append(item);
                }
            } catch (error) { if (!closed) cacheList.textContent = error.message; }
        };
        caches.append(button('刷新清单', loadCaches), cacheList);
        caches.addEventListener('toggle', () => { if (caches.open) loadCaches(); });
        overlay.querySelector('.feature-dialog-card').append(caches);
    }
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
            const facts = element('details'); facts.append(element('summary', '人物 / 日期 / 约定 / 待办对照'));
            const sourceFacts = journal.manualMergeSources?.length ? journal.manualMergeSources : messages;
            facts.append(element('pre', getMemoryFactChecklist(sourceFacts).map(row => `来源 ${row.id || row.floor} · ${row.speaker}\n日期线索：${row.dates.join('、') || '未知；不使用发送时间推断剧情日期'}\n约定：${row.commitments.join(' ') || '未识别，请核对原文'}\n待办：${row.todos.join(' ') || '未识别，请核对原文'}`).join('\n\n') || '无关联来源；请对照手动输入。'));
            details.append(facts);
            const links = element('details'); links.append(element('summary', '逐句核对'), element('p', '按原文文字匹配，最多80句；改写或未命中请人工核对，不代表事实已确认。', 'feature-help'));
            links.addEventListener('toggle', () => {
                if (!links.open || links.dataset.loaded) return;
                if (closed || !isCurrent()) { status.textContent = '存档或记忆已变化，请重新打开记忆管理'; return; } links.dataset.loaded = 'true';
                for (const row of memorySummarySentenceLinks(chat, journal)) {
                    const item = element('section'); item.append(element('p', row.sentence));
                    const excerpt = element('pre'); excerpt.hidden = true;
                    const stale = message => { status.textContent = message; excerpt.textContent = message; excerpt.hidden = false; };
                    for (const match of row.matches) item.append(button('第 '+match.floor+' 楼', () => {
                        if (closed || !isCurrent()) { stale('存档或记忆已变化，请重新打开记忆管理'); return; }
                        const original = chat.history[match.floor-1];
                        if (!memorySummarySentenceLinks(chat,journal).some(candidate => candidate.sentence === row.sentence && candidate.matches.some(m => m.id === match.id && m.floor === match.floor))) { stale('原消息已变化，请重新打开核对'); return; }
                        excerpt.textContent = original.content; excerpt.hidden = false; excerpt.scrollIntoView?.({block:'nearest'});
                    }));
                    if (!row.matches.length) item.append(element('small', '无逐字匹配，请对照完整来源'));
                    item.append(excerpt); links.append(item);
                }
            }); details.append(links);
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
        list.replaceChildren();
        const all = chat.memoryJournals || [];
        const previousFilter = filter.value;
        filter.replaceChildren(new Option('全部分类', ''));
        for (const category of [...new Set(all.map(journal => journal.category || '未分类'))].sort()) filter.add(new Option(category, category));
        if ([...filter.options].some(option => option.value === previousFilter)) filter.value = previousFilter;
        const valid = getAutoMemoryState(chat).validIds;
        const sourceStates = getVectorMemorySourceStates(chat);
        const states = new Map(sourceStates.map(item => [item.id, item.status]));
        const result = queryMemoryLibrary(all, { category: filter.value, query: search.value, from: from.value, to: to.value,
            source: sourceFilter.value, status: stateFilter.value, states, page, pageSize: 20 });
        page = result.page;
        const visible = result.items;
        pagination.replaceChildren(button('上一页', () => { page--; refresh(); }), element('span', `第 ${page + 1}/${result.pages} 页 · 匹配 ${result.total} 篇`), button('下一页', () => { page++; refresh(); }));
        pagination.firstChild.disabled = page === 0; pagination.lastChild.disabled = page + 1 >= result.pages;
        const diag = getVectorMemoryDiagnostics(chat);
        const indexPreview = getVectorMemoryIndexPreview(chat, sourceStates);
        diagnosticText.textContent = [diag.cleaningWarning || '', diag.query ? `查询：${diag.query}` : '尚无本轮查询',
            `续建预览：待嵌入 ${indexPreview.newChunks} 块；复用 ${indexPreview.reusedChunks} 块；更新 ${indexPreview.updatedSources} 个来源；移除 ${indexPreview.deletedChunks} 块。至少 ${indexPreview.minimumBatches} 批嵌入（Token 分批可能增加；不估算费用）。`,
            indexPreview.batchLimit !== null ? `回复前预算 ${indexPreview.batchLimit} 批 / ${indexPreview.timeBudgetMs} ms；手动续建可暂停。` : '',
            `分块：${diag.totalChunks || 0}；待续建：${diag.pendingChunks || 0}；本次完成 ${diag.completedBatches || 0} 批`,
            `重排前：${(diag.beforeRerank || []).join(' → ') || '无'}；重排后：${(diag.afterRerank || []).join(' → ') || '无'}`,
            ...sourceStates.map(item => `${item.title}：${stateLabels[item.status]}（${item.chunks}/${item.totalChunks} 块）`),
            ...(diag.selected || []).map(item => `命中 ${item.title} · 相似度 ${item.score.toFixed(3)} · ${diag.ranking} · ${item.timeline || '时间未指定'}\n${item.content}`),
            ...(diag.favoriteDeduplication || []).map(item => `${item.id}：${item.reason}`),
            ...(diag.excluded || []).map(item => `未完整注入 ${item.id}：${item.reason}`)
        ].filter(Boolean).join('\n\n');
        for (const journal of visible) {
            const card = element('section', undefined, 'memory-library-card');
            card.dataset.memoryId = journal.id;
            card.dataset.memorySource = journal.source || (journal.autoMemory ? 'summary' : 'manual');
            card.dataset.memoryCreatedAt = String(journal.createdAt || 0);
            // Presentation only: preserve the library's captured character/archive ownership.
            card.memoryPresentation = {
                archive: chat.archives?.find(item => item.id === chat.activeArchiveId)?.name || '当前存档',
                floors: journal.bridgeReview?.selectedFloorIds?.join('、') ||
                    (journal.range?.start ? journal.range.start + '—' + journal.range.end : ''),
                favorite: Boolean(journal.isFavorited),
                canFavorite: !journal.autoMemory && !journal.vectorSupersededBy &&
                    (journal.source !== 'sillytavern' || journal.bridgeReview?.status === 'approved'),
                edit: () => edit(journal),
                source: host => { assertCurrent(); original(journal, host); },
                async setFavorite(value) {
                    assertCurrent();if(!card.memoryPresentation.canFavorite)throw new Error('请先完成记忆审核。');
                    const previous=journal.isFavorited;journal.isFavorited=Boolean(value);
                    try { await saveData(); } catch(error) { if(journal.isFavorited===Boolean(value))journal.isFavorited=previous;throw error; }
                    if(!closed&&isCurrent()){isCurrent=memoryLibrarySnapshot(chat);refresh();renderJournalList();}
                },
                async remove() {
                    assertCurrent();if(!confirm('确定删除这篇记忆？原始聊天会保留。'))return false;
                    const archiveId=chat.activeArchiveId,history=chat.history,previous=chat.memoryJournals,next=previous.filter(item=>item!==journal);chat.memoryJournals=next;
                    try { await saveData(); } catch(error) {
                        if(chat.activeArchiveId===archiveId&&chat.memoryJournals===next)chat.memoryJournals=previous;
                        const archived=chat.archives?.find(item=>item.id===archiveId)?.data;if(archived?.memoryJournals===next)archived.memoryJournals=previous;
                        throw error;
                    }
                    selection.delete(journal.id);if(!closed&&chat.activeArchiveId===archiveId&&chat.history===history&&chat.memoryJournals===next){isCurrent=memoryLibrarySnapshot(chat);refresh();renderJournalList();}return true;
                }
            };
            const heading = element('label', undefined, 'memory-library-pick'), checkbox = element('input'); checkbox.type = 'checkbox';
            checkbox.disabled = Boolean(journal.vectorSupersededBy || journal.autoMemory && !valid.has(journal.id));
            checkbox.checked = selection.has(journal.id);
            checkbox.onchange = () => checkbox.checked ? selection.add(journal.id) : selection.delete(journal.id);
            heading.append(checkbox, element('strong', journal.title)); card.append(heading, element('p', describe(journal), 'feature-help'));
            if (checkbox.disabled) card.append(element('p', journal.qualityReview?.status === 'pending' ? '待质量审阅；原始聊天继续进入上下文，确认后才启用总结。' : journal.vectorSupersededBy ? '已合并，保留原文；不再单独召回' : '总结来源已变化，不参与召回', 'feature-help'));
            card.append(element('pre', journal.content)); original(journal, card);
            const usage = getMemoryUsageExplanation(chat, journal), useDetail = element('details');
            useDetail.append(element('summary', '引用：' + usage.status), element('p', usage.reason, 'feature-help')); card.append(useDetail);
            card.append(element('p', `索引：${stateLabels[states.get(journal.id) || 'pending']}`, 'feature-help'));
            if (journal.qualityReview?.status === 'pending') {
                for (const warning of journal.qualityReview.warnings || []) card.append(element('p', `质量提醒：${warning}`, 'memory-library-warning'));
                const actions = element('div', undefined, 'memory-library-toolbar');
                const review = async (action, target) => {
                    if (target) target.disabled = true;
                    const job = { cancelled: false, controller: null }; jobs.add(job);
                    try {
                        assertCurrent(); await saveAutoMemoryReview(chat, journal, { action, type, control: job });
                        isCurrent = memoryLibrarySnapshot(chat); refresh(); renderJournalList();
                    } catch (error) { status.textContent = error.message; if (target) target.disabled = false; }
                    finally { jobs.delete(job); }
                };
                actions.append(button('编辑并确认总结', () => edit(journal)), button('重试生成待审稿', event => review('retry', event.currentTarget)),
                    button('保留原文 / 放弃待审稿', event => review('discard', event.currentTarget)));
                card.append(actions);
            } else card.append(button('编辑内容 / 分类 / 时间线', () => edit(journal)));
            if (journal.manualMergeSources?.length && !journal.vectorSupersededBy) card.append(button('撤销此次手动合并', async () => {
                try { assertCurrent(); await undoLibraryMemoryMerge(chat, journal, { isCurrent }); isCurrent = memoryLibrarySnapshot(chat); refresh(); renderJournalList(); }
                catch (error) { status.textContent = error.message; }
            }));
            list.append(card);
        }
        status.textContent = `共 ${all.length} 篇记忆；历史剧情索引 ${Object.keys(chat.memoryVectorIndex || {}).filter(id => /^(history|message):/.test(id)).length} 组。`;
    };
    const edit = journal => {
        try { assertCurrent(); } catch (error) { showToast(error.message); return; }
        const editor = element('div', undefined, 'feature-dialog memory-library');
        const card = element('div', undefined, 'feature-dialog-card'); editor.append(card);
        const reviewing = journal?.qualityReview?.status === 'pending';
        card.append(element('h3', reviewing ? '核对并确认总结' : journal ? '编辑记忆' : '添加记忆'));
        if (reviewing) card.append(element('p', '请核对来源、时间与事件；确认后总结才生效。取消保留待审稿，原文继续保留。', 'feature-help'));
        const read = fields(card, journal || {});
        if (journal) original(journal, card);
        const actions = element('div', undefined, 'memory-library-toolbar');
        actions.append(button('取消', () => editor.remove()), button(reviewing ? '确认并启用总结' : '保存', async event => {
            event.currentTarget.disabled = true;
            try {
                assertCurrent();
                if (reviewing) await saveAutoMemoryReview(chat, journal, { action: 'approve', fields: read(), type });
                else await saveLibraryMemory(chat, read(), { existing: journal, isCurrent });
                isCurrent = memoryLibrarySnapshot(chat); editor.remove(); refresh(); renderJournalList();
            } catch (error) { showToast(error.message); event.target.disabled = false; }
        }));
        card.append(actions); overlay.append(editor);
    };
    overlay.querySelector('[data-action="add"]').onclick = () => edit(null);
    for (const input of [filter, from, to, sourceFilter, stateFilter]) input.onchange = () => { page = 0; refresh(); };
    let searchTimer;
    search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (!closed) { page = 0; refresh(); } }, 180); };
    overlay.querySelector('[data-action="close"]').onclick = () => { closed = true; for (const job of jobs) { job.cancelled = true; job.controller?.abort(); } overlay.remove(); };
    overlay.querySelector('[data-action="pause"]').onclick = () => { if (indexJob) { indexJob.paused = true; status.textContent = '正在暂停；当前批次完成后保存进度。'; } };
    const index = async (event, rebuild = false) => {
        if (indexJob) return;
        const target = event.currentTarget, control = new AbortController();
        const job = { controller: control, paused: false }; jobs.add(job); indexJob = job;
        const pause = overlay.querySelector('[data-action="pause"]');
        target.disabled = true; pause.disabled = false; status.textContent = '正在过滤历史剧情并建立索引…';
        try {
            assertCurrent();
            if (!getAutoMemorySettings(chat).vectorSearchEnabled) throw new Error('请先在自动记忆设置中启用并配置向量 API');
            await getVectorMemoryContext(chat, '回顾历史剧情的重要事件、约定和关系', control.signal, { fullIndex: true, indexOnly: true, rebuild, shouldPause: () => job.paused,
                onProgress: progress => { if (!closed) status.textContent = `共 ${progress.totalSources} 个来源 / ${progress.totalChunks} 个分块；待建立 ${progress.pendingChunks} 块；本次已完成 ${progress.completedBatches} 批。`; } });
            assertCurrent(); refresh(); status.textContent += job.paused ? ' 已暂停，完成的索引已保存。' : ' 索引已更新。';
        } catch (error) { if (!closed) status.textContent = error.message; }
        finally { jobs.delete(job); indexJob = null; target.disabled = false; pause.disabled = true; }
    };
    overlay.querySelector('[data-action="index"]').onclick = event => index(event);
    overlay.querySelector('[data-action="rebuild"]').onclick = event => index(event, true);
    overlay.querySelector('[data-action="integrate"]').onclick = () => {
        try { assertCurrent(); } catch (error) { showToast(error.message); return; }
        if (selection.size < 2) return showToast('请至少选择两篇记忆');
        const host = overlay.querySelector('.memory-library-groups'); host.replaceChildren();
        const groups = memoryLibraryGroups((chat.memoryJournals || []).filter(journal => selection.has(journal.id)));
        for (const group of groups) {
            const section = element('section', undefined, 'memory-library-card'); host.append(section);
            section.append(element('h3', `${group.category} · ${group.sources.length} 篇`));
            for (const warning of inspectMemoryMerge(group.sources)) section.append(element('p', `待核对：${warning}`, 'memory-library-warning'));
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
    if (!entry || document.getElementById('memory-library-open')) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-secondary';
    button.id = 'memory-library-open'; button.textContent = '记忆管理 / 手动合并'; button.onclick = openMemoryLibrary;
    entry.append(button);
}
