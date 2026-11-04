// Additive world-info rules. Legacy depth remains an ordering field.
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
        enabled: entries.filter(book => book.rules?.enabled !== false).length };
}
function escapeWorldBookHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function worldBookMatches(key, text, rules) {
    if (key.startsWith('/')) {
        const end = key.lastIndexOf('/');
        if (end > 0) {
            try { return new RegExp(key.slice(1, end), key.slice(end + 1).replace(/[gy]/g, '')).test(text); } catch (_) { return false; }
        }
    }
    if (!rules.caseSensitive) { key = key.toLocaleLowerCase(); text = text.toLocaleLowerCase(); }
    if (!rules.wholeWords) return text.includes(key);
    const escaped = key.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
    return new RegExp('(?:^|[^\\p{L}\\p{N}_])' + escaped + '(?=$|[^\\p{L}\\p{N}_])', 'u').test(text);
}
function buildWorldBookPlan(chat, history = chat.history || [], random = Math.random) {
    return (chat.worldBookIds || []).map(id => db.worldBooks.find(w => w.id === id)).filter(w => {
        if (!w || w.type === 'folder') return false;
        const r = w.rules;
        if (!r) return true;
        if (r.enabled === false) return false;
        const count = Math.floor(worldBookNumber(r.scanDepth, 20, 0, 10000));
        const text = (count ? history.slice(-count) : []).map(m => m.content || '').join('\n');
        if (r.constant === false) {
            if (!worldBookKeys(r.keys).some(k => worldBookMatches(k, text, r))) return false;
            const secondary = worldBookKeys(r.secondaryKeys);
            if (secondary.length && r.selective !== false) {
                const hits = secondary.map(k => worldBookMatches(k, text, r));
                const mode = Number(r.selectiveLogic || 0);
                if (!(mode === 1 ? !hits.every(Boolean) : mode === 2 ? !hits.some(Boolean) : mode === 3 ? hits.every(Boolean) : hits.some(Boolean))) return false;
            }
        }
        const probability = worldBookNumber(r.probability, 100, 0, 100);
        return probability === 100 || (probability > 0 && random() * 100 < probability);
    }).sort((a, b) => worldBookNumber(a.rules?.order, a.depth || 100) - worldBookNumber(b.rules?.order, b.depth || 100));
}
function worldBookSection(plan, position) {
    return plan.filter(w => (w.position === position || (position === 'before' && w.position === 'chat')) && !w.rules?.unsupportedPosition)
        .map(w => w.content).join('\n');
}
function importWorldBookJson(value, parentId) {
    const source = value?.data?.character_book || value?.character_book || value;
    const entries = Array.isArray(source) ? source : source?.entries;
    if (!entries || typeof entries !== 'object') throw new Error('JSON 中未找到世界书 entries');
    const warnings = [];
    const books = Object.values(entries).filter(e => e && typeof e.content === 'string').map((e, index) => {
        const ext = e.extensions || {};
        const rawPosition = ext.position ?? e.position ?? 'before';
        const positions = { 0: 'before', 1: 'after', 4: 'chat', before_char: 'before', after_char: 'after' };
        const importedPosition = Object.hasOwn(positions, rawPosition) ? positions[rawPosition] : (['before', 'after', 'limit_break', 'guidelines', 'chat'].includes(rawPosition) ? rawPosition : 'before');
        const position = importedPosition === 'chat' ? 'before' : importedPosition;
        const unsupported = !Object.hasOwn(positions, rawPosition) && !['before', 'after', 'limit_break', 'guidelines', 'chat'].includes(rawPosition);
        if (unsupported) warnings.push(`${e.comment || e.name || index + 1}：插入位置 ${rawPosition} 暂不支持，已停用`);
        const supplied = e.rules;
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
        if (!supplied && e.type === 'entry' && typeof e.position === 'string' && e.constant == null && e.key == null && e.keys == null) rules.constant = true;
        return { id: 'wb_' + crypto.randomUUID(), parentId, type: 'entry', name: e.comment || e.name || `条目 ${index + 1}`, content: e.content, position, depth: e.depth ?? 100, rules, importSource: e };
    });
    if (!books.length) throw new Error('没有可导入的世界书内容');
    if (books.length > 3000) throw new Error('单次最多导入 3000 条');
    return { books, warnings };
}
