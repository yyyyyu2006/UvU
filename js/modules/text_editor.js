function findEditorMatches(text, query, caseSensitive = false) {
    if (!query) return [];
    const escaped = query.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
    return Array.from(text.matchAll(new RegExp(escaped, caseSensitive ? 'gu' : 'giu')), m => ({ start: m.index, end: m.index + m[0].length }));
}
const EXPANDED_EDITOR_SCROLL_PREFIX = 'uvu:expanded-editor-scroll:';
function getExpandedEditorScrollKey(target) {
    if (!target) return '';
    if (target.scrollKey) return target.scrollKey;
    const id = target.id || target.name || '';
    if (!id) return '';
    let owner = target.dataset?.editorOwner || '';
    if (!owner && id.startsWith('world-book-')) {
        owner = 'worldbook:' + (typeof document !== 'undefined' ? document.getElementById('world-book-id')?.value || 'new' : 'new');
    } else if (!owner && /^setting-(?:char-|my-|group-|status-|custom-bubble)/.test(id) && typeof currentChatId !== 'undefined' && currentChatId) {
        owner = (typeof currentChatType !== 'undefined' ? currentChatType : 'private') + ':' + currentChatId;
    }
    return EXPANDED_EDITOR_SCROLL_PREFIX + (owner ? encodeURIComponent(owner) + ':' : '') + id;
}
function readExpandedEditorScroll(target) {
    const key = getExpandedEditorScrollKey(target);
    if (!key || typeof localStorage === 'undefined') return null;
    try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (!saved || !Number.isFinite(saved.ratio)) return null;
        return { ratio: Math.max(0, Math.min(1, saved.ratio)) };
    } catch (_) { return null; }
}
function saveExpandedEditorScroll(target, draft) {
    const key = getExpandedEditorScrollKey(target);
    if (!key || !draft || typeof localStorage === 'undefined') return;
    const max = Math.max(0, (draft.scrollHeight || 0) - (draft.clientHeight || 0));
    const ratio = max > 0 ? Math.max(0, Math.min(1, draft.scrollTop / max)) : 0;
    try { localStorage.setItem(key, JSON.stringify({ ratio, updatedAt: Date.now() })); } catch (_) { /* storage is optional */ }
}
function restoreExpandedEditorScroll(target, draft) {
    const saved = readExpandedEditorScroll(target);
    if (!saved || !draft) return;
    const apply = () => {
        const max = Math.max(0, (draft.scrollHeight || 0) - (draft.clientHeight || 0));
        draft.scrollTop = max * saved.ratio;
    };
    apply();
    // Textarea metrics may settle one frame after the overlay is attached.
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
    }
}
function openExpandedEditor(target, importedText) {
    if (target.disabled || target.readOnly) return showToast('请先启用此项设置');
    if (document.getElementById('expanded-text-editor')) return;
    const original = target.value;
    const overlay = document.createElement('div');
    overlay.id = 'expanded-text-editor'; overlay.className = 'feature-dialog'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = '<div class="feature-dialog-card text-editor-card"><header><strong class="editor-title"></strong><button type="button" data-action="cancel">取消</button><button type="button" data-action="apply">应用</button></header><div class="editor-search"><input type="search" class="editor-find" placeholder="查找文字" aria-label="查找文字"><label><input type="checkbox" class="editor-case">区分大小写</label><span class="editor-count" aria-live="polite"></span><button type="button" data-action="previous">上一个</button><button type="button" data-action="next">下一个</button><input type="text" class="editor-replace" placeholder="替换为" aria-label="替换为"><button type="button" data-action="replace">替换</button><button type="button" data-action="replaceAll">全部替换</button></div><div class="editor-import-options" hidden><span>文档已解析，请选择：</span><button type="button" data-action="importReplace">替换原文</button><button type="button" data-action="importAppend">追加到原文</button></div><textarea class="editor-draft" spellcheck="false" aria-label="展开编辑内容"></textarea><footer>仅编辑草稿；应用后请按原界面的保存方式保存。</footer></div>';
    const label = target.id ? document.querySelector('label[for="' + CSS.escape(target.id) + '"]') : null;
    overlay.querySelector('.editor-title').textContent = (label?.textContent || target.getAttribute('placeholder') || '展开编辑').slice(0, 45);
    const draft = overlay.querySelector('.editor-draft'), find = overlay.querySelector('.editor-find'), replacement = overlay.querySelector('.editor-replace'), caseBox = overlay.querySelector('.editor-case');
    draft.value = importedText ?? original;
    overlay.querySelector('.editor-import-options').hidden = importedText === undefined;
    const scrollTarget = { scrollKey: getExpandedEditorScrollKey(target) };
    let matches = [], active = -1;
    let scrollSaveTimer = null;
    const persistScroll = () => {
        if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(() => { scrollSaveTimer = null; saveExpandedEditorScroll(scrollTarget, draft); }, 80);
    };
    const status = () => { overlay.querySelector('.editor-count').textContent = (active < 0 ? 0 : active + 1) + ' / ' + matches.length; };
    const update = () => { matches = findEditorMatches(draft.value, find.value, caseBox.checked); active = -1; status(); };
    const select = index => {
        if (!matches.length) return;
        active = (index + matches.length) % matches.length;
        draft.focus(); draft.setSelectionRange(matches[active].start, matches[active].end);
        const line = draft.value.slice(0, matches[active].start).split('\n').length - 1;
        draft.scrollTop = Math.max(0, line * 24 - draft.clientHeight / 3); status();
    };
    const close = () => {
        if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
        saveExpandedEditorScroll(scrollTarget, draft);
        overlay.remove(); target.focus({ preventScroll: true });
    };
    find.addEventListener('input', update); caseBox.addEventListener('change', update); draft.addEventListener('input', update); draft.addEventListener('scroll', persistScroll, { passive: true });
    overlay.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'cancel') { if (draft.value === original || confirm('放弃未应用的编辑？')) close(); }
        if (action === 'apply') {
            if (!target.isConnected) return showToast('原编辑界面已关闭，请先复制草稿');
            target.value = draft.value; target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); close();
        }
        if (action === 'next') select(active + 1);
        if (action === 'previous') select(active < 0 ? matches.length - 1 : active - 1);
        if (action === 'importReplace') { draft.value = importedText; update(); }
        if (action === 'importAppend') { draft.value = original + (original ? '\n\n' : '') + importedText; update(); }
        if (action === 'replace') {
            if (active < 0) return select(0);
            const at = matches[active].start; draft.setRangeText(replacement.value, at, matches[active].end, 'end'); update();
            const next = matches.findIndex(m => m.start >= at + replacement.value.length); select(next < 0 ? 0 : next);
        }
        if (action === 'replaceAll' && matches.length) {
            for (let i = matches.length - 1; i >= 0; i--) draft.value = draft.value.slice(0, matches[i].start) + replacement.value + draft.value.slice(matches[i].end);
            update();
        }
    });
    overlay.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && ['f', 'h'].includes(e.key.toLowerCase())) { e.preventDefault(); find.focus(); find.select(); }
        if (e.key === 'Enter' && e.target === find) { e.preventDefault(); select(active + (e.shiftKey ? -1 : 1)); }
        if (e.key === 'Escape') { e.preventDefault(); overlay.querySelector('[data-action=cancel]').click(); }
        if (e.key === 'Tab') {
            const focusable = Array.from(overlay.querySelectorAll('button,input,textarea')).filter(n => !n.disabled && n.getClientRects().length);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });
    document.body.appendChild(overlay); update(); draft.focus({ preventScroll: true });
    if (importedText === undefined) restoreExpandedEditorScroll(scrollTarget, draft);
}
function setupExpandedEditors() {
    const attach = () => document.querySelectorAll('textarea:not([data-expanded-editor])').forEach(target => {
        if (target.closest('.feature-dialog') || !target.id) return;
        target.dataset.expandedEditor = 'true';
        const toolbar = document.createElement('div'); toolbar.className = 'document-edit-tools';
        const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'document-edit-expand'; expand.textContent = '展开'; expand.addEventListener('click', () => openExpandedEditor(target)); toolbar.appendChild(expand);
        if (/persona|personality/.test(target.id)) {
            const importButton = document.createElement('button'); importButton.type = 'button'; importButton.textContent = '导入';
            importButton.addEventListener('click', () => chooseImportFile('.docx,.txt', async file => { const result = await readImportDocument(file); openExpandedEditor(target, result.text); })); toolbar.appendChild(importButton);
        }
        const host = target.parentElement;
        const documentTools = target.id === 'global-beautification-css'
            ? host?.querySelector('.global-css-document-tools')
            : null;
        if (documentTools) {
            // Keep the global CSS editor's three primary actions in one compact row.
            documentTools.insertBefore(expand, documentTools.firstChild);
            const exportButton = documentTools.querySelector('#global-css-document-export');
            if (exportButton) documentTools.insertBefore(exportButton, documentTools.querySelector('#global-css-export-menu'));
        } else if (host?.classList.contains('form-group') && host.children.length === 1) host.appendChild(toolbar);
        else target.insertAdjacentElement('afterend', toolbar);
    });
    attach();
    new MutationObserver(records => { if (records.some(r => Array.from(r.addedNodes).some(n => n.nodeType === 1 && (n.matches?.('textarea') || n.querySelector?.('textarea'))))) attach(); }).observe(document.body, { childList: true, subtree: true });
}
