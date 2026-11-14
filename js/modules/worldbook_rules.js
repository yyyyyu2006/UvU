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
        enabled: entries.filter(book => !worldBookUsesAdvancedRules(book) || book.rules.enabled !== false).length };
}
function escapeWorldBookHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function worldBookRegex(key) {
    const end = key.startsWith('/') ? key.lastIndexOf('/') : -1;
    return end > 0 ? { source: key.slice(1, end), flags: key.slice(end + 1).replace(/[gy]/g, '') } : null;
}
function worldBookRegexIsSafe(regex) {
    // Synchronous callers only accept a small linear subset. All grouping,
    // alternatives, repetition, backreferences and lookarounds require a worker.
    if (regex.source.length > 512 || /[^dimsu]/.test(regex.flags)) return false;
    let inClass = false;
    for (let i = 0; i < regex.source.length; i++) {
        const c = regex.source[i];
        if (c === '\\') {
            const escaped = regex.source[++i];
            if (!escaped || /[1-9kpP]/.test(escaped)) return false;
        } else if (inClass) {
            if (c === ']') inClass = false;
        } else if (c === '[') inClass = true;
        else if ('+*?{}()|'.includes(c)) return false;
    }
    return !inClass;
}
function worldBookMatches(key, text, rules) {
    const regex = worldBookRegex(key);
    if (regex) {
        if (!worldBookRegexIsSafe(regex)) return false;
        try { return new RegExp(regex.source, regex.flags).test(text); } catch (_) { return false; }
    }
    if (!rules.caseSensitive) { key = key.toLocaleLowerCase(); text = text.toLocaleLowerCase(); }
    if (!rules.wholeWords) return text.includes(key);
    const escaped = key.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
    return new RegExp('(?:^|[^\\p{L}\\p{N}_])' + escaped + '(?=$|[^\\p{L}\\p{N}_])', 'u').test(text);
}
function worldBookUsesAdvancedRules(book) {
    return book?.rules?.advancedEnabled === true;
}
function chatUsesAdvancedWorldBook(chat) {
    // Imported advanced entries carry this flag even while the feature is dormant.
    // A plan is still deterministic in that state and preserves the legacy depth order;
    // truly legacy books without rules keep the original static prompt path.
    return (chat?.worldBookIds || []).some(id => Object.hasOwn(db.worldBooks.find(book => book.id === id)?.rules || {}, 'advancedEnabled'));
}
const worldBookLastPlans = new WeakMap();
function getWorldBookPlanDiagnostics(chat) { return worldBookLastPlans.get(chat)?.activationDiagnostics || []; }
function buildWorldBookPlan(chat, history = chat.history || [], random = Math.random, regexResults) {
    const diagnostics = [];
    const plan = (chat.worldBookIds || []).map(id => db.worldBooks.find(w => w.id === id)).filter(w => {
        if (!w || w.type === 'folder') return false;
        const explanation = { id: w.id, name: w.name || w.id, active: false, matchedKeys: [], scanDepth: 0,
            position: w.position === 'chat' ? 'before' : w.position || 'before', reason: '' };
        diagnostics.push(explanation);
        const decide = (active, reason) => { explanation.active = active; explanation.reason = reason; return active; };
        if (w.rules?.unsupportedPosition) return decide(false, '导入位置暂不支持');
        const r = w.rules;
        if (!worldBookUsesAdvancedRules(w)) return decide(true, '按原版绑定与顺序插入');
        if (r.enabled === false) return decide(false, '条目已停用');
        const count = Math.floor(worldBookNumber(r.scanDepth, 20, 0, 10000));
        explanation.scanDepth = count;
        const text = (count ? history.slice(-count) : []).map(m => m.content || '').join('\n');
        if (r.constant === false) {
            const matches = key => {
                if (regexResults?.has(w) && regexResults.get(w).has(key)) return regexResults.get(w).get(key);
                return worldBookMatches(key, text, r);
            };
            const primary = worldBookKeys(r.keys);
            if (!primary.some(k => { const hit = matches(k) === true; if (hit) explanation.matchedKeys.push(k); return hit; })) return decide(false, '主要关键词未匹配');
            const secondary = worldBookKeys(r.secondaryKeys);
            if (secondary.length && r.selective !== false) {
                const hits = secondary.map(matches);
                // A timed-out/unsupported regex is unknown, never a negative hit.
                if (hits.some(hit => hit == null)) return decide(false, '正则结果不可用');
                const mode = Number(r.selectiveLogic || 0);
                if (!(mode === 1 ? !hits.every(Boolean) : mode === 2 ? !hits.some(Boolean) : mode === 3 ? hits.every(Boolean) : hits.some(Boolean))) return decide(false, '筛选关键词未满足');
            }
        }
        const probability = worldBookNumber(r.probability, 100, 0, 100);
        return decide(probability === 100 || (probability > 0 && random() * 100 < probability), '');
    }).sort((a, b) => {
        const aOrder = worldBookUsesAdvancedRules(a) ? worldBookNumber(a.rules.order, a.depth || 100) : (a.depth || 100);
        const bOrder = worldBookUsesAdvancedRules(b) ? worldBookNumber(b.rules.order, b.depth || 100) : (b.depth || 100);
        return aOrder - bOrder;
    });
    for (const row of diagnostics) if (!row.reason) row.reason = row.active ? '本轮已激活' : '本轮概率未命中';
    Object.defineProperty(plan, 'activationDiagnostics', { value: diagnostics });
    worldBookLastPlans.set(chat, plan);
    return plan;
}
function worldBookRegexAbortError() {
    const error = new Error('世界书匹配已取消');
    error.name = 'AbortError';
    return error;
}
function evaluateWorldBookRegexJobs(jobs, signal) {
    if (signal?.aborted) return Promise.reject(worldBookRegexAbortError());
    if (typeof Worker === 'undefined') return Promise.resolve({ results: [], warning: '世界书复杂正则暂不可用，已跳过相关触发' });
    return new Promise((resolve, reject) => {
        let worker, timer, settled = false;
        const results = [];
        const finish = (warning, error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            worker?.terminate();
            if (error) reject(error);
            else resolve({ results, warning });
        };
        const abort = () => finish(null, worldBookRegexAbortError());
        signal?.addEventListener('abort', abort, { once: true });
        try {
            worker = new Worker('js/workers/worldbook_regex_worker.js?v=20261105-bounded-regex');
            worker.onmessage = event => {
                const data = event.data;
                if (data?.done) finish();
                else if (Number.isInteger(data?.index) && typeof data.matched === 'boolean') results[data.index] = data.matched;
            };
            worker.onerror = () => finish('世界书正则匹配失败，已跳过未完成的触发');
            // One total request budget, including worker startup and every regex.
            timer = setTimeout(() => finish('世界书正则匹配超时，已跳过未完成的触发'), 250);
            worker.postMessage({ jobs });
        } catch (_) { finish('世界书复杂正则暂不可用，已跳过相关触发'); }
    });
}
async function buildWorldBookPlanAsync(chat, history = chat.history || [], random = Math.random, signal) {
    if (signal?.aborted) throw worldBookRegexAbortError();
    const regexResults = new Map(), jobs = [], targets = [];
    for (const id of chat.worldBookIds || []) {
        const book = db.worldBooks.find(w => w.id === id), r = book?.rules;
        if (!book || book.type === 'folder' || r?.unsupportedPosition || !worldBookUsesAdvancedRules(book) || r.enabled === false || r.constant !== false || regexResults.has(book)) continue;
        const count = Math.floor(worldBookNumber(r.scanDepth, 20, 0, 10000));
        const text = (count ? history.slice(-count) : []).map(m => m.content || '').join('\n');
        const results = new Map();
        regexResults.set(book, results);
        const keys = [...worldBookKeys(r.keys), ...(r.selective !== false ? worldBookKeys(r.secondaryKeys) : [])];
        for (const key of new Set(keys)) {
            const regex = worldBookRegex(key);
            if (!regex || worldBookRegexIsSafe(regex)) continue;
            results.set(key, null);
            targets.push({ results, key });
            jobs.push({ ...regex, text });
        }
    }
    let warning;
    if (jobs.length) {
        const evaluated = await evaluateWorldBookRegexJobs(jobs, signal);
        warning = evaluated.warning;
        evaluated.results.forEach((matched, i) => targets[i]?.results.set(targets[i].key, matched));
    }
    if (signal?.aborted) throw worldBookRegexAbortError();
    const plan = buildWorldBookPlan(chat, history, random, regexResults);
    if (warning) {
        Object.defineProperty(plan, 'regexWarnings', { value: [warning] });
        if (typeof showToast === 'function') showToast(warning);
        else if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(warning);
    }
    return plan;
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
        const positions = { 0: 'before', 1: 'after', 4: 'chat', before_char: 'before', after_char: 'after' };
        const importedPosition = Object.hasOwn(positions, rawPosition) ? positions[rawPosition] : (['before', 'after', 'limit_break', 'guidelines', 'chat'].includes(rawPosition) ? rawPosition : 'before');
        const position = importedPosition === 'chat' ? 'before' : importedPosition;
        const unsupported = !Object.hasOwn(positions, rawPosition) && !['before', 'after', 'limit_break', 'guidelines', 'chat'].includes(rawPosition);
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
        // Imported trigger metadata is preserved, but stays dormant until explicitly enabled in the editor.
        rules.advancedEnabled = false;
        if (!supplied && e.type === 'entry' && typeof e.position === 'string' && e.constant == null && e.key == null && e.keys == null) rules.constant = true;
        const preservedOnly = ['sticky', 'cooldown', 'delay', 'delayUntilRecursion', 'excludeRecursion', 'preventRecursion', 'ignoreBudget', 'budget', 'tokenBudget', 'group', 'groupOverride', 'groupWeight']
            .filter(key => Object.hasOwn(e, key) || Object.hasOwn(ext, key));
        const importCompatibility = { supported: ['正文', '绑定位置与顺序', '主动开启后的关键词、扫描范围与概率'], preservedOnly };
        if (preservedOnly.length) warnings.push(`${e.comment || e.name || index + 1}：仅保留 ${preservedOnly.join('、')}，未执行其上游生命周期、递归或预算语义`);
        return { id: 'wb_' + crypto.randomUUID(), parentId, type: 'entry', name: e.comment || e.name || `条目 ${index + 1}`, content: e.content, position, depth: Number.isFinite(portable?.depth) ? portable.depth : (e.depth ?? 100), rules, importSource: e, importCompatibility };
    });
    if (!books.length) throw new Error('没有可导入的世界书内容');
    return { books, warnings };
}
