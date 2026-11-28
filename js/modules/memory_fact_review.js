// Human-confirmed, local annotations. These never rewrite a journal or a prompt.
const memoryFactWrites = new WeakMap();
function memoryFactOwner(chat) {
    return autoMemoryFingerprint([String(chat.id), String(chat.activeArchiveId || 'default'), String(chat.myName || ''), String(chat.myPersona || '')]);
}
function memoryFactSourceStamp(chat, journal) {
    const ids = typeof VectorMemoryTools !== 'undefined' ? VectorMemoryTools.sourceIds(journal, chat) : [];
    const range = journal.range || {};
    const messages = (chat.history || []).filter((message, i) => ids.length ? ids.includes(message.id) : range.start > 0 && i >= range.start - 1 && i < range.end);
    return autoMemoryFingerprint([journal.content, journal.autoMemory, journal.manualMergeSources, journal.characterMemoReference,
        messages.map(message => [message.id, autoMemoryMessageHash(message), message.isHidden, message.isContextDisabled])]);
}
function memoryFactJournalAllowed(chat, journal) {
    return (chat.memoryJournals || []).includes(journal) && journal.qualityReview?.status !== 'pending' &&
        memoryJournalSourcesAllowed(chat, journal) && (!journal.autoMemory || getAutoMemoryState(chat).validIds.has(journal.id));
}
function memoryFactDate(value) {
    if (!value) return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw Error('事件日期请填写有效的年、月、日');
    return value;
}
function memoryFactFields(chat, journal, fields) {
    const text = (key, max) => String(fields[key] || '').trim().slice(0, max);
    const fact = text('fact', 600), subject = fields.subject;
    if (!fact || !String(journal.content || '').includes(fact)) throw Error('请从这篇记忆复制需要核对的完整原句');
    if (!['user', 'char', 'unknown'].includes(subject)) throw Error('请选择事实主体');
    if (!(db.characters || []).includes(chat) && subject !== 'unknown') throw Error('群聊请先保留主体未知；暂不把多人归为一个角色');
    const period = ['current', 'range'].includes(fields.period) ? fields.period : 'unknown';
    const from = period === 'range' ? memoryFactDate(fields.from) : '', to = period === 'range' ? memoryFactDate(fields.to) : '';
    if (period === 'range' && (!from || !to || to < from)) throw Error('请填写完整、有序的事件起止日期；单日事件填写同一天');
    return { fact, subject, entityId: subject === 'unknown' ? '' : subject === 'char' ? 'char:' + chat.id : 'user:' + memoryFactOwner(chat),
        attribute: text('attribute', 80), value: text('value', 200), polarity: ['positive', 'negative'].includes(fields.polarity) ? fields.polarity : 'unknown',
        period, from, to, recordedAt: Date.now(), sourceRecordedAt: Number.isFinite(journal.createdAt) ? journal.createdAt : null,
        owner: memoryFactOwner(chat), sourceStamp: memoryFactSourceStamp(chat, journal), confirmed: true };
}
function memoryFactValid(chat, journal, fact) {
    return fact?.confirmed === true && fact.owner === memoryFactOwner(chat) && typeof fact.fact === 'string' &&
        String(journal.content || '').includes(fact.fact) && fact.sourceStamp === memoryFactSourceStamp(chat, journal) && memoryFactJournalAllowed(chat, journal);
}
function memoryFactRows(chat) {
    const rows = [];
    for (const journal of (chat.memoryJournals || []).slice(-200)) {
        for (const fact of (Array.isArray(journal.memoryFacts) ? journal.memoryFacts : []).slice(0, 20)) {
            if (memoryFactValid(chat, journal, fact)) rows.push({ ...fact, key: 'journal:' + journal.id + ':' + fact.id, journalId: journal.id, title: journal.title });
        }
    }
    if (typeof queryCharacterMemoRecords === 'function') for (const note of queryCharacterMemoRecords(chat).slice(-200)) {
        if (note.status !== 'approved' || note.localOnly || note.useContext === false || !characterMemoAt(note) ||
            !characterMemoSourceValid(chat, note) || !characterMemoPrivacyAllowed(chat, note.fact + ' ' + (note.content || ''))) continue;
        const range = Number.isFinite(note.validFrom) && Number.isFinite(note.validTo);
        rows.push({ key: 'memo:' + note.id, fact: note.fact, subject: note.subject,
            entityId: note.subject === 'char' ? 'char:' + chat.id : note.subject === 'user' ? 'user:' + memoryFactOwner(chat) : '',
            attribute: note.attribute, value: note.value, polarity: note.polarity || 'unknown', period: range ? 'range' : 'unknown',
            from: range ? new Date(note.validFrom).toISOString().slice(0, 10) : '',
            to: range ? new Date(note.validTo).toISOString().slice(0, 10) : '', recordedAt: note.recordedAt || note.createdAt });
    }
    return rows;
}
function memoryFactSuggestions(chat, journalId) {
    const rows = memoryFactRows(chat), suggestions = [], normalize = value => String(value || '').trim().toLocaleLowerCase();
    for (const a of rows.filter(row => row.journalId === journalId)) for (const b of rows) {
        if (a.journalId === b.journalId) continue;
        if (!a.entityId || a.entityId !== b.entityId || !a.attribute || normalize(a.attribute) !== normalize(b.attribute) || !a.value || !b.value) continue;
        const samePeriod = a.period === 'current' && b.period === 'current' || a.period === 'range' && b.period === 'range' && a.from <= b.to && b.from <= a.to;
        if (!samePeriod || a.polarity === 'unknown' || b.polarity === 'unknown') continue;
        if (normalize(a.value) === normalize(b.value) && a.polarity === b.polarity) continue;
        const key = [a.key, b.key].sort().join('|');
        const stamp = autoMemoryFingerprint([a, b].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
        const decision = (chat.memoryJournals || []).flatMap(item => Array.isArray(item.memoryFactRelations) ? item.memoryFactRelations : [])
            .find(item => item.key === key && item.stamp === stamp && item.owner === memoryFactOwner(chat));
        suggestions.push({ key, stamp, a, b, decision: decision?.decision || '', reason: '同主体、同属性且时期重叠，内容可能不同；请人工判断' });
        if (suggestions.length === 30) return suggestions;
    }
    return suggestions;
}
function memoryFactSnapshot(chat, journal) {
    const owner = memoryFactOwner(chat), history = chat.history, journals = chat.memoryJournals;
    const stamp = memoryFactSourceStamp(chat, journal), metadata = JSON.stringify([journal.memoryFacts, journal.memoryFactRelations]);
    return () => [...(db.characters || []), ...(db.groups || [])].includes(chat) && memoryFactOwner(chat) === owner &&
        chat.history === history && chat.memoryJournals === journals && journals.includes(journal) &&
        memoryFactSourceStamp(chat, journal) === stamp &&
        JSON.stringify([journal.memoryFacts, journal.memoryFactRelations]) === metadata;
}
async function saveMemoryFactReview(chat, journal, action, fields, isCurrent = memoryFactSnapshot(chat, journal)) {
    const commit = async () => {
        if (!isCurrent()) throw Error('来源、标签或存档已变化，请重新打开事实核对');
        if (action !== 'remove' && !memoryFactJournalAllowed(chat, journal)) throw Error('来源尚未审核或已失效，请先核对原文');
        const key = action === 'relation' ? 'memoryFactRelations' : 'memoryFacts';
        const previous = journal[key], archive = chat.activeArchiveId;
        const entries = Array.isArray(previous) ? previous : [];
        let next;
        if (action === 'add') {
            if (entries.length >= 20) throw Error('每篇最多核对20条事实，请先移除不用的标签');
            next = [...entries, { ...memoryFactFields(chat, journal, fields), id: characterMemoId() }];
        } else if (action === 'remove') next = entries.filter(item => item.id !== fields.id);
        else if (action === 'relation') {
            if (!['coexist', 'changed', 'unresolved', ''].includes(fields.decision)) throw Error('请选择有效的关系');
            const pair = memoryFactSuggestions(chat, journal.id).find(item => item.key === fields.key && item.stamp === fields.stamp);
            if (!pair) throw Error('关联来源已变化，请重新核对');
            next = entries.filter(item => item.key !== fields.key);
            if (fields.decision) next.push({ key: pair.key, stamp: pair.stamp, decision: fields.decision, owner: memoryFactOwner(chat), at: Date.now() });
            if (next.length > 60) throw Error('关系记录已达上限，请先撤销不用的确认');
        } else throw Error('未知的事实核对操作');
        journal[key] = next;
        const applied = JSON.stringify(next);
        try { await saveData(); }
        catch (error) {
            const restore = data => {
                const live = data?.memoryJournals?.find(item => item.id === journal.id);
                if (live && JSON.stringify(live[key]) === applied) { if (previous === undefined) delete live[key]; else live[key] = previous; }
            };
            if (chat.activeArchiveId === archive) restore(chat);
            restore(chat.archives?.find(item => item.id === archive)?.data);
            throw error;
        }
        return next;
    };
    const prior = memoryFactWrites.get(chat), task = prior ? prior.catch(() => {}).then(commit) : commit();
    memoryFactWrites.set(chat, task);
    const cleanup = () => { if (memoryFactWrites.get(chat) === task) memoryFactWrites.delete(chat); };
    task.then(cleanup, cleanup); return task;
}

function mountMemoryFactReview({ chat, journal, host, element, button, assertCurrent }) {
    const panel = element('details', undefined, 'memory-fact-review'); panel.append(element('summary', '事实标签 / 新旧核对'));
    const body = element('div'); panel.append(body); host.append(panel);
    const render = () => {
        body.replaceChildren();
        const feedback = element('p'); feedback.setAttribute('role', 'status');
        let guard;
        try { assertCurrent(); guard = memoryFactSnapshot(chat, journal); if (!guard()) throw Error('来源已变化，请重新打开'); }
        catch (error) { body.append(element('p', error.message)); return; }
        const help = element('details'); help.append(element('summary', '?'), element('p',
            '仅保存你确认的本地标签，不改正文、收藏或聊天提示词。事件时间不从发送时间猜测；未知就留未知。跨记忆建议只比较已确认的同主体、同属性和重叠时期。确认关系只留核对记录，不自动停用旧记忆。'));
        body.append(help);
        const run = async (action, fields, target) => {
            target.disabled = true;
            try { assertCurrent(); await saveMemoryFactReview(chat, journal, action, fields, guard); assertCurrent(); render(); }
            catch (error) { feedback.textContent = error.message; target.disabled = false; }
        };
        for (const fact of (Array.isArray(journal.memoryFacts) ? journal.memoryFacts : []).filter(item => item && typeof item === 'object').slice(0, 20)) {
            const row = element('section'), valid = memoryFactValid(chat, journal, fact);
            row.append(element('pre', fact.fact), element('p', valid ?
                `${({ user: '用户', char: '角色', unknown: '主体未知' })[fact.subject]} · ${fact.attribute || '属性未知'} · ${fact.value || '取值未知'} · ${({ positive: '肯定', negative: '否定', unknown: '极性未知' })[fact.polarity]} · ${fact.period === 'range' ? fact.from + ' 至 ' + fact.to : fact.period === 'current' ? '人工确认当前状态' : '事件时间未知'}` : '来源或身份已变化，旧标签不参与核对'));
            row.append(element('small', `记忆创建：${fact.sourceRecordedAt == null ? '未知' : new Date(fact.sourceRecordedAt).toLocaleString()} · 标签确认：${new Date(fact.recordedAt).toLocaleString()}`),
                button('移除标签', event => run('remove', { id: fact.id }, event.currentTarget))); body.append(row);
        }
        const form = element('form'), inputs = {}; form.setAttribute('aria-label', '核对记忆事实');
        const input = (key, title, choices) => {
            const wrap = element('div'), label = element('label', title), control = element(choices ? 'select' : key === 'fact' ? 'textarea' : 'input');
            control.name = key; control.id = 'memory-fact-' + characterMemoId(); label.htmlFor = control.id;
            if (choices) for (const [value, text] of choices) { const option = element('option', text); option.value = value; control.append(option); }
            else { control.type = ['from', 'to'].includes(key) ? 'date' : 'text'; control.maxLength = key === 'fact' ? 600 : key === 'attribute' ? 80 : 200; }
            wrap.append(label, control); form.append(wrap); inputs[key] = control; return control;
        };
        input('fact', '事实原句（从本篇复制）').required = true;
        input('subject', '主体', [['unknown', '未知 / 其他人物'], ['user', '用户'], ['char', '角色']]);
        input('attribute', '属性（例如饮品偏好）'); input('value', '取值（例如茶）');
        input('polarity', '肯定或否定', [['unknown', '未知'], ['positive', '肯定'], ['negative', '否定']]);
        input('period', '事件时期', [['unknown', '未知'], ['current', '确认是当前状态'], ['range', '指定事件日期']]);
        input('from', '事件开始日期'); input('to', '事件结束日期');
        const dates = () => { for (const key of ['from', 'to']) { inputs[key].disabled = inputs.period.value !== 'range'; inputs[key].required = inputs.period.value === 'range'; } };
        inputs.period.onchange = dates; dates();
        const submit = element('button', '确认事实标签'); submit.type = 'submit'; form.append(submit);
        form.onsubmit = event => { event.preventDefault(); run('add', Object.fromEntries(Object.entries(inputs).map(([key, field]) => [key, field.value])), submit); };
        body.append(form);
        for (const pair of memoryFactSuggestions(chat, journal.id)) {
            const row = element('section', undefined, 'memory-fact-pair'); row.append(element('p', pair.reason), element('pre', pair.a.fact + '\n↔\n' + pair.b.fact));
            row.append(element('p', '已确认关系：' + ({ coexist: '保留并存', changed: '新旧变化', unresolved: '存在矛盾，待核实' }[pair.decision] || '未确认')));
            for (const [decision, label] of [['coexist', '保留并存'], ['changed', '记录新旧变化'], ['unresolved', '标记待核实'], ['', '撤销关系确认']])
                row.append(button(label, event => run('relation', { key: pair.key, stamp: pair.stamp, decision }, event.currentTarget)));
            body.append(row);
        }
        body.append(feedback);
    };
    panel.addEventListener('toggle', () => { if (panel.open) render(); });
}
