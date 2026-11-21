// Worldbook import and display helpers only. Runtime selection follows the 1900 callers.
function worldBookNumber(value, fallback, min = 0, max = 9999) {
    const n = value === '' || value == null ? NaN : Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function worldBookKeys(value) {
    return (Array.isArray(value) ? value : String(value || '').split(/[,，\n]/)).map(String).map(s => s.trim()).filter(Boolean);
}
function getWorldBookBindingStats(ids) {
    const uniqueIds = [...new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])];
    const entries = uniqueIds.map(id => db.worldBooks.find(book => book.id === id)).filter(book => book && book.type !== 'folder');
    const validIds = new Set(entries.map(book => book.id));
    return { entries, missingIds: uniqueIds.filter(id => !validIds.has(id)),
        enabled: entries.filter(book => ['limit_break', 'before', 'after', 'guidelines'].includes(book.position)).length };
}
function escapeWorldBookHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function importWorldBookJson(value, parentId) {
    const source = value?.data?.character_book || value?.character_book || value;
    const entries = Array.isArray(source) ? source : source?.entries;
    if (!entries || typeof entries !== 'object') throw new Error('JSON 中未找到世界书 entries');
    const warnings = [];
    const candidates = [];
    for (const key in entries) {
        if (!Object.hasOwn(entries, key)) continue;
        const entry = entries[key];
        if (!entry || typeof entry.content !== 'string') continue;
        if (candidates.length === 3000) throw new Error('单次最多导入 3000 条');
        candidates.push(entry);
    }
    const books = candidates.map((e, index) => {
        const ext = e.extensions || {};
        const portable = ext.uvu?.version === 1 ? ext.uvu.original : null;
        const rawPosition = portable?.position ?? ext.position ?? e.position ?? 'before';
        const positions = { 0: 'before', 1: 'after', before_char: 'before', after_char: 'after' };
        const importedPosition = Object.hasOwn(positions, rawPosition) ? positions[rawPosition] : (['before', 'after', 'limit_break', 'guidelines'].includes(rawPosition) ? rawPosition : 'unsupported');
        const unsupported = (!Object.hasOwn(positions, rawPosition) && !['before', 'after', 'limit_break', 'guidelines'].includes(rawPosition)) || (e.rules ?? portable?.rules)?.unsupportedPosition === true;
        const position = unsupported ? 'unsupported' : importedPosition;
        if (unsupported) warnings.push(`${e.comment || e.name || index + 1}：插入位置 ${rawPosition} 暂不支持，已停用`);
        const supplied = e.rules ?? portable?.rules;
        if (supplied != null && (typeof supplied !== 'object' || Array.isArray(supplied))) throw new Error('世界书规则字段无效');
        const rules = supplied ? { ...supplied } : {
            enabled: !e.disable && e.enabled !== false && !unsupported, constant: e.constant ?? false,
            keys: worldBookKeys(e.key ?? e.keys), secondaryKeys: worldBookKeys(e.keysecondary ?? e.secondary_keys),
            selective: e.selective ?? true, selectiveLogic: ext.selectiveLogic ?? e.selectiveLogic ?? 0,
            probability: (ext.useProbability ?? e.useProbability) === false ? 100 : worldBookNumber(ext.probability ?? e.probability, 100, 0, 100),
            order: worldBookNumber(e.order ?? e.insertion_order, 100), chatDepth: worldBookNumber(ext.depth ?? e.depth, 4),
            scanDepth: worldBookNumber(ext.scanDepth ?? e.scanDepth, 20),
            role: ['system', 'user', 'assistant'].includes(ext.role ?? e.role) ? (ext.role ?? e.role) : (['system', 'user', 'assistant'][ext.role ?? e.role ?? 0] || 'system'),
            caseSensitive: ext.caseSensitive ?? e.caseSensitive ?? false, wholeWords: ext.matchWholeWords ?? e.matchWholeWords ?? false,
            unsupportedPosition: unsupported
        };
        // Trigger metadata is retained only for roundtripping; UvU does not execute it.
        rules.advancedEnabled = false;
        if (unsupported) rules.unsupportedPosition = true;
        if (!supplied && e.type === 'entry' && typeof e.position === 'string' && e.constant == null && e.key == null && e.keys == null) rules.constant = true;
        const preservedOnly = ['sticky', 'cooldown', 'delay', 'delayUntilRecursion', 'excludeRecursion', 'preventRecursion', 'ignoreBudget', 'budget', 'tokenBudget', 'group', 'groupOverride', 'groupWeight']
            .filter(key => Object.hasOwn(e, key) || Object.hasOwn(ext, key));
        const importCompatibility = { supported: ['正文', '原版四类位置与 depth 排序'], ignored: ['关键词', '启停规则', '概率', '扫描范围', '高级顺序', '历史深度与角色'], preservedOnly };
        if (preservedOnly.length) warnings.push(`${e.comment || e.name || index + 1}：仅保留 ${preservedOnly.join('、')}，未执行其上游生命周期、递归或预算语义`);
        return { id: 'wb_' + crypto.randomUUID(), parentId, type: 'entry', name: e.comment || e.name || `条目 ${index + 1}`, content: e.content, position, depth: Number.isFinite(portable?.depth) ? portable.depth : (e.depth ?? 100), rules, importSource: e, importCompatibility };
    });
    if (!books.length) throw new Error('没有可导入的世界书内容');
    return { books, warnings };
}
