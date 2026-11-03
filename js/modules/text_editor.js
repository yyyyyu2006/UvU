function findEditorMatches(text, query, caseSensitive = false) {
    if (!query) return [];
    const escaped = query.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
    return Array.from(text.matchAll(new RegExp(escaped, caseSensitive ? 'gu' : 'giu')), m => ({ start: m.index, end: m.index + m[0].length }));
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
    let matches = [], active = -1;
    const status = () => { overlay.querySelector('.editor-count').textContent = (active < 0 ? 0 : active + 1) + ' / ' + matches.length; };
    const update = () => { matches = findEditorMatches(draft.value, find.value, caseBox.checked); active = -1; status(); };
    const select = index => {
        if (!matches.length) return;
        active = (index + matches.length) % matches.length;
        draft.focus(); draft.setSelectionRange(matches[active].start, matches[active].end);
        const line = draft.value.slice(0, matches[active].start).split('\n').length - 1;
        draft.scrollTop = Math.max(0, line * 24 - draft.clientHeight / 3); status();
    };
    const close = () => { overlay.remove(); target.focus({ preventScroll: true }); };
    find.addEventListener('input', update); caseBox.addEventListener('change', update); draft.addEventListener('input', update);
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
    document.body.appendChild(overlay); update(); draft.focus();
}
function setupExpandedEditors() {
    const attach = () => document.querySelectorAll('textarea:not([data-expanded-editor])').forEach(target => {
        if (target.closest('.feature-dialog') || !target.id) return;
        target.dataset.expandedEditor = 'true';
        const toolbar = document.createElement('div'); toolbar.className = 'document-edit-tools';
        const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'document-edit-expand'; expand.textContent = '展开编辑 / 查找替换'; expand.addEventListener('click', () => openExpandedEditor(target)); toolbar.appendChild(expand);
        if (/persona|personality/.test(target.id)) {
            const importButton = document.createElement('button'); importButton.type = 'button'; importButton.textContent = '导入 DOCX / TXT';
            importButton.addEventListener('click', () => chooseImportFile('.docx,.txt', async file => { const result = await readImportDocument(file); openExpandedEditor(target, result.text); })); toolbar.appendChild(importButton);
        }
        const host = target.parentElement;
        if (host?.classList.contains('form-group') && host.children.length === 1) host.appendChild(toolbar);
        else target.insertAdjacentElement('afterend', toolbar);
    });
    attach();
    new MutationObserver(records => { if (records.some(r => Array.from(r.addedNodes).some(n => n.nodeType === 1 && (n.matches?.('textarea') || n.querySelector?.('textarea'))))) attach(); }).observe(document.body, { childList: true, subtree: true });
}
