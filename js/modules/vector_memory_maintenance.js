// Explicit maintenance previews. They never change retrieval defaults or source records.
const vectorCacheCleanupPlans = new WeakMap();

function vectorThresholdIdentity(chat) {
    return autoMemoryFingerprint([chat.id, chat.activeArchiveId, vectorSourceFingerprint(chat), resolveVectorMemoryApi()]);
}

async function sampleVectorMemoryThresholds(chat, query, ranked, config, signal, assertCurrent, withRerank) {
    // Sample before admission/TopK: excluded low scores must also be labelable.
    let sample = ranked.toSorted((a, b) => b.vectorScore - a.vectorScore || a.journal.id.localeCompare(b.journal.id)).slice(0, 20);
    const rerank = { executed: false, succeeded: false, skipped: '未请求专用重排评分' };
    if (withRerank && sample.length) {
        if (!config.rerankModel || getVectorRerankMode(config) !== 'native') throw Error('阈值标定需要专用重排的真实分数；聊天式排序没有可标定分数');
        sample = await rerankMemoryCandidates(query, sample, config, signal, rerank);
        rerank.succeeded = true; rerank.skipped = '';
    }
    assertCurrent(true);
    return { calibration: true, identity: vectorThresholdIdentity(chat), queryKey: autoMemoryFingerprint(query), rerank,
        totalCandidates: ranked.length, sampled: sample.length, model: config.embeddingModel, rerankModel: withRerank ? config.rerankModel : '',
        selected: sample.map(item => ({ id: item.journal.id, title: item.journal.title || '记忆', content: item.journal.content,
            cosine: item.vectorScore, lexical: item.lexicalScore, rerank: item.rerankScore, relevant: null })) };
}

function suggestVectorMemoryThresholds(samples, settings, stage = 'cosine') {
    const labelled = samples.filter(row => typeof row.relevant === 'boolean');
    const rows = stage === 'rerank' ? labelled.filter(row => row.cosine >= settings.vectorThreshold || settings.vectorHybridEnabled && row.lexical >= .6) : labelled;
    const positive = rows.filter(row => row.relevant).length, negative = rows.length - positive;
    if (positive < 2 || negative < 2 || new Set(rows.map(row => row.queryKey)).size < 2)
        return { ready: false, reason: '至少用两种问题，分别标记两条相关和两条不相关资料；样本不足，不提供建议。' };
    const field = stage === 'rerank' ? 'rerank' : 'cosine';
    if (rows.some(row => !Number.isFinite(row[field]) || row[field] > 1 || row[field] < (stage === 'rerank' ? 0 : -1)))
        return { ready: false, reason: '有样本缺少有效分数或超出当前阈值控件的范围，不能把排序名次或缺失值当作分数。' };
    const current = stage === 'rerank' ? settings.vectorRerankThreshold : settings.vectorThreshold;
    const evaluate = threshold => {
        let tp = 0, fp = 0;
        for (const row of rows) if (row[field] >= threshold || stage === 'cosine' && settings.vectorHybridEnabled && row.lexical >= .6) {
            if (row.relevant) tp++; else fp++;
        }
        const fn = positive - tp;
        return { threshold, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : 0, recall: tp / positive,
            f1: 2 * tp / (2 * tp + fp + fn), labelled: rows.length };
    };
    const choices = Array.from({ length: 101 }, (_, i) => evaluate(i / 100));
    const best = choices.toSorted((a, b) => b.f1 - a.f1 || a.fp - b.fp || Math.abs(a.threshold - current) - Math.abs(b.threshold - current))[0];
    return { ready: true, stage, current: evaluate(current), proposed: best,
        lexicalBypass: stage === 'cosine' && settings.vectorHybridEnabled && rows.some(row => !row.relevant && row.lexical >= .6) };
}

async function previewVectorMemoryCacheCleanup(chat, isCurrent = () => true) {
    const scope = VectorMemoryTools.indexScope(chat, vectorMemoryApiFingerprint(resolveVectorMemoryApi()));
    const snapshot = vectorThresholdIdentity(chat), archive = chat.activeArchiveId;
    const guard = () => {
        if (!isCurrent() || chat.activeArchiveId !== archive || ![...(db.characters || []), ...(db.groups || [])].includes(chat) ||
            vectorThresholdIdentity(chat) !== snapshot) throw Error('来源、模型或存档已变化，请重新预览；本次未清理');
    };
    guard();
    const stored = await VectorIndexStore.read(scope, true); guard();
    const candidates = getVectorMemoryCandidates(chat), allowed = new Map(candidates.map(row => [row.id, row]));
    const planned = await planVectorMemoryChunks(chat, candidates, vectorMemoryApiFingerprint(resolveVectorMemoryApi()), guard);
    const wanted = new Map();
    for (const row of planned) { if (!wanted.has(row.journal.id)) wanted.set(row.journal.id, new Map()); wanted.get(row.journal.id).set(row.hash, row.chunk); }
    const next = Object.create(null), keptKeys = new Set(), reasons = { unavailable: 0, changed: 0, invalid: 0, dimension: 0 };
    const inventory = new Map(stored.inventory.map(row => [row.key, row])), referencedKeys = new Set();
    let keptReferences = 0;
    for (const entry of stored.entries) for (const chunk of entry.chunks) {
        referencedKeys.add(chunk.key);
        const physical = inventory.get(chunk.key), current = wanted.get(entry.id)?.get(chunk.key);
        const reason = !allowed.has(entry.id) ? 'unavailable' : !physical?.valid ? 'invalid' :
            stored.descriptor?.dimension && physical.dimension !== stored.descriptor.dimension ? 'dimension' : !current ? 'changed' : '';
        if (reason) { reasons[reason]++; continue; }
        const vector = stored.index[entry.id]?.chunks.find(row => row.key === chunk.key)?.vector;
        if (!vector) { reasons.invalid++; continue; }
        if (!next[entry.id]) next[entry.id] = { version: 2, chunks: [] };
        next[entry.id].chunks.push({ key: chunk.key, start: current.start, end: current.end, vector });
        keptKeys.add(chunk.key); keptReferences++;
    }
    const removed = stored.inventory.filter(row => !keptKeys.has(row.key));
    const references = stored.entries.reduce((sum, entry) => sum + entry.chunks.length, 0);
    const preview = Object.freeze({ scope, updatedAt: stored.updatedAt, reasons: Object.freeze(reasons), keptReferences,
        removedReferences: references - keptReferences, removedVectors: removed.length,
        orphanVectors: removed.filter(row => !referencedKeys.has(row.key)).length,
        estimatedVectorBytes: removed.reduce((sum, row) => sum + row.estimatedVectorBytes, 0) });
    vectorCacheCleanupPlans.set(preview, { chat, scope, next, guard, stored, fingerprint: vectorSourceFingerprint(chat) });
    return preview;
}

async function applyVectorMemoryCacheCleanup(chat, preview) {
    const plan = vectorCacheCleanupPlans.get(preview);
    if (!plan || plan.chat !== chat) throw Error('请先重新预览当前存档的失效分块');
    plan.guard();
    await VectorIndexStore.commit(plan.scope, plan.next, plan.fingerprint, plan.guard, preview.updatedAt, plan.stored.descriptor);
    vectorCacheCleanupPlans.delete(preview);
    VectorMemoryTools.invalidateResultCache(chat); vectorMemoryResults.delete(chat); vectorMemoryDiagnostics.delete(chat);
    // Independent cache only: portable backup mirrors and all originals are untouched.
    return { removedVectors: preview.removedVectors, removedReferences: preview.removedReferences };
}

function mountVectorMemoryMaintenance({ chat, diagnostics, caches, refreshCaches, element, button, assertCurrent, jobs, isBusy }) {
    const calibration = element('details', undefined, 'memory-library-calibration');
    const input = element('input'), native = element('input'), rows = element('div'), output = element('pre');
    input.type = 'search'; input.maxLength = 500; input.setAttribute('aria-label', '阈值试查问题');
    native.type = 'checkbox'; const nativeLabel = element('label', '本次也请求专用重排评分'); nativeLabel.append(native);
    const state = { samples: [], identity: '', reports: [], job: null };
    const reset = () => { state.samples = []; state.reports = []; state.identity = ''; rows.replaceChildren(); output.textContent = '样本已清空；设置未改变。'; };
    const check = () => { assertCurrent(); if (state.identity && state.identity !== vectorThresholdIdentity(chat)) { reset(); throw Error('模型、来源或设置已变化，旧样本已失效，请重新试查。'); } };
    const suggest = button('计算阈值建议', () => {
        try {
            check(); const settings = getAutoMemorySettings(chat), cosine = suggestVectorMemoryThresholds(state.samples, settings);
            const describe = (name, report) => report.ready ? `${name}：当前 ${report.current.threshold.toFixed(2)} → 建议 ${report.proposed.threshold.toFixed(2)}；已标样本误命中 ${report.current.fp} → ${report.proposed.fp}，漏掉 ${report.current.fn} → ${report.proposed.fn}，F1 ${report.proposed.f1.toFixed(2)}。${report.lexicalBypass ? '关键词通道仍放行部分不相关样本，不能只提高余弦阈值解决。' : ''}` : `${name}：${report.reason}`;
            output.textContent = [describe('余弦', cosine), describe('专用重排', suggestVectorMemoryThresholds(state.samples, settings, 'rerank')),
                `嵌入模型：${resolveVectorMemoryApi().embeddingModel}；重排模型：${resolveVectorMemoryApi().rerankModel || '未配置'}。`,
                '只评估当前已标样本，不代表真实准确率；RRF名次和关键词分数不套余弦阈值。重排建议使用当前余弦/关键词准入；建议不会自动写入设置。',
                state.reports.some(report => report.pendingCount || report.totalCandidates > report.sampled) ? '已有索引或样本窗口不完整，未覆盖全部资料。' : ''].filter(Boolean).join('\n\n');
        } catch (error) { output.textContent = error.message; }
    });
    const cancel = button('取消采样', () => state.job?.controller.abort()); cancel.disabled = true;
    const sample = button('请求阈值采样', async () => {
        if (state.job || !input.value.trim()) return;
        let job;
        try {
            check();
            if (state.reports.length >= 10) throw Error('本次最多采样10种问题，请先清空样本再继续。');
            if (!getAutoMemorySettings(chat).vectorSearchEnabled) throw Error('请先配置并启用向量检索；不会自动开启。');
            if (native.checked && getVectorRerankMode(resolveVectorMemoryApi()) !== 'native') throw Error('聊天式重排没有数值分数，请改用专用重排或取消该选项。');
            job = { controller: new AbortController() }; state.job = job; jobs.add(job);
            sample.disabled = suggest.disabled = input.disabled = native.disabled = true; cancel.disabled = false;
            output.textContent = '正在试查已有索引，未建的新块不会请求嵌入。';
            await getVectorMemoryContext(chat, input.value.trim(), job.controller.signal, { calibrateThresholds: true, trialRerank: native.checked, trial: report => {
                check(); if (!report.calibration) throw Error('没有可采样的有效索引，请先建立索引。');
                state.identity = report.identity;
                state.samples = state.samples.filter(row => row.queryKey !== report.queryKey);
                state.reports = state.reports.filter(row => row.queryKey !== report.queryKey); state.reports.push(report);
                state.samples.push(...report.selected.map(row => ({ ...row, queryKey: report.queryKey, question: input.value.trim() })));
                rows.replaceChildren();
                for (const row of state.samples) {
                    const card = element('details'), labels = element('select'); labels.setAttribute('aria-label', `相关性：${row.title}`);
                    for (const [value, text] of [['', '尚未判断'], ['yes', '相关'], ['no', '不相关']]) { const option = element('option', text); option.value = value; labels.append(option); }
                    labels.value = row.relevant === null ? '' : row.relevant ? 'yes' : 'no'; labels.onchange = () => { row.relevant = labels.value === '' ? null : labels.value === 'yes'; output.textContent = '标记已改变，请重新计算建议。'; };
                    card.append(element('summary', `${row.question} · ${row.title}`), element('p', `余弦 ${row.cosine.toFixed(3)} · 关键词 ${row.lexical.toFixed(3)} · 重排 ${Number.isFinite(row.rerank) ? row.rerank.toFixed(3) : '未评分'}`), element('pre', row.content), labels); rows.append(card);
                }
                output.textContent = `本轮采样 ${report.sampled} / ${report.totalCandidates} 个可用来源；${report.pendingCount} 块尚无索引。标记相关性后计算建议。`;
            } });
        } catch (error) { output.textContent = error.name === 'AbortError' ? '采样已取消；设置未改变。' : error.message; }
        finally { if (job) jobs.delete(job); state.job = null; sample.disabled = suggest.disabled = input.disabled = native.disabled = false; cancel.disabled = true; }
    });
    calibration.append(element('summary', '阈值建议预览'), element('p', '每次只用已有索引，最多20个来源；请求会使用已配置的向量接口，可另选专用重排。标签仅留在本面板，关闭即清空。', 'feature-help'), input, nativeLabel, sample, cancel, button('清空样本', () => { if (!state.job) reset(); }), rows, suggest, output);
    output.setAttribute('aria-live', 'polite'); diagnostics.append(calibration);
    if (!caches || typeof VectorIndexStore === 'undefined') return;
    const cleanup = element('details', undefined, 'memory-library-prune'), summary = element('pre'); let preview;
    const apply = button('清理已预览的失效分块', async () => {
        try {
            assertCurrent(); if (isBusy()) throw Error('请等待建库完成后清理');
            if (!preview || !confirm(`清理 ${preview.removedVectors} 个失效向量及 ${preview.removedReferences} 处分块引用？仅清理当前独立索引，原文和备份兼容镜像保留。`)) return;
            apply.disabled = true; const result = await applyVectorMemoryCacheCleanup(chat, preview); preview = null;
            summary.textContent = `已清理 ${result.removedVectors} 个向量、${result.removedReferences} 处分块引用。聊天、日记及其他模型/存档缓存保留。`;
            await refreshCaches();
        } catch (error) { preview = null; apply.disabled = true; summary.textContent = error.message; }
    }); apply.disabled = true;
    const inspect = button('预览当前失效分块', async () => {
        preview = null; apply.disabled = inspect.disabled = true;
        try {
            assertCurrent(); if (isBusy()) throw Error('请等待建库完成后预览');
            preview = await previewVectorMemoryCacheCleanup(chat, () => { try { assertCurrent(); return true; } catch (_) { return false; } });
            summary.textContent = `保留 ${preview.keptReferences} 处分块引用；清理 ${preview.removedReferences} 处引用、${preview.removedVectors} 个独立向量，向量数据约 ${(preview.estimatedVectorBytes / 1024).toFixed(1)} KiB（非磁盘占用）。\n来源删除/撤销/不可读 ${preview.reasons.unavailable}；内容或分块设置变化 ${preview.reasons.changed}；无效向量 ${preview.reasons.invalid}；维度不符 ${preview.reasons.dimension}；孤立向量 ${preview.orphanVectors}。`;
            apply.disabled = !preview.removedReferences && !preview.removedVectors;
        } catch (error) { summary.textContent = error.message; }
        finally { inspect.disabled = false; }
    });
    cleanup.append(element('summary', '当前独立索引的失效分块'), inspect, summary, apply); summary.setAttribute('aria-live', 'polite'); caches.append(cleanup);
}
