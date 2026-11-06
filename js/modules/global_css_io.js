function globalCssCrc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function globalCssCreateDocx(css) {
    const encoder = new TextEncoder();
    const files = [
        ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
        ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
        ['word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
            String(css).split(/\r\n|\r|\n/).map(line => '<w:p><w:r><w:t xml:space="preserve">' + line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</w:t></w:r></w:p>').join('') +
            '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>']
    ].map(([name, text]) => ({ name: encoder.encode(name), data: encoder.encode(text) }));
    const localParts = [], centralParts = [];
    let offset = 0;
    for (const file of files) {
        const crc = globalCssCrc32(file.data);
        const local = new Uint8Array(30 + file.name.length + file.data.length);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true); localView.setUint16(6, 0x0800, true);
        localView.setUint32(14, crc, true); localView.setUint32(18, file.data.length, true); localView.setUint32(22, file.data.length, true);
        localView.setUint16(26, file.name.length, true); local.set(file.name, 30); local.set(file.data, 30 + file.name.length);
        localParts.push(local);

        const central = new Uint8Array(46 + file.name.length);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0x0800, true); centralView.setUint32(16, crc, true);
        centralView.setUint32(20, file.data.length, true); centralView.setUint32(24, file.data.length, true);
        centralView.setUint16(28, file.name.length, true); centralView.setUint32(42, offset, true); central.set(file.name, 46);
        centralParts.push(central); offset += local.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22), endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function previewGlobalCssImport(previous, incoming) {
    return new Promise(resolve => {
        const opener = document.activeElement, overlay = document.createElement('div');
        overlay.id = 'global-css-import-preview'; overlay.className = 'feature-dialog'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '全局 CSS 导入预览');
        overlay.innerHTML = '<div class="feature-dialog-card"><header><strong>全局 CSS 导入预览</strong><button type="button" data-cancel>取消</button></header><p class="feature-help"></p><label>当前编辑草稿<textarea data-before readonly rows="5" style="width:100%;box-sizing:border-box"></textarea></label><label>即将导入的 CSS<textarea data-after readonly rows="7" style="width:100%;box-sizing:border-box"></textarea></label><p>仅显示文字差异；点击后应用并保存。导入后可撤销一次。</p><button type="button" data-confirm>应用并保存导入 CSS</button></div>';
        overlay.querySelector('[data-before]').value = previous; overlay.querySelector('[data-after]').value = incoming;
        const external = (incoming.match(/@import\b|url\s*\(/gi) || []).length;
        overlay.querySelector('.feature-help').textContent = '原文 ' + previous.length + ' 字符 → 导入 ' + incoming.length + ' 字符；' + (previous === incoming ? '内容相同。' : '内容将完整替换。') +
            (external ? ' 检测到 ' + external + ' 处资源引用；应用后可能向外部地址请求字体或图片。' : '') + ' CSS 可改变界面与控件可见性。';
        const finish = accepted => { overlay.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); resolve(accepted); };
        overlay.querySelector('[data-cancel]').onclick = () => finish(false);
        overlay.querySelector('[data-confirm]').onclick = () => finish(true);
        overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); } });
        document.body.appendChild(overlay); overlay.querySelector('[data-cancel]').focus();
    });
}

function setupGlobalCssDocumentTools() {
    const modal = document.getElementById('global-css-modal');
    if (!modal || modal.dataset.documentToolsBound) return;
    const textarea = modal.querySelector('#global-beautification-css');
    const input = modal.querySelector('#global-css-document-input');
    if (!textarea || !input) return;
    modal.dataset.documentToolsBound = 'true';

    modal.querySelector('#global-css-document-import').addEventListener('click', () => input.click());
    const exportButton = modal.querySelector('#global-css-document-export');
    const exportMenu = modal.querySelector('#global-css-export-menu');
    exportButton.addEventListener('click', () => {
        exportMenu.hidden = !exportMenu.hidden;
        exportButton.setAttribute('aria-expanded', String(!exportMenu.hidden));
    });
    modal.querySelector('#global-css-document-export-txt').addEventListener('click', () => {
        downloadGlobalCssDocument(new Blob([textarea.value], { type: 'text/plain;charset=utf-8' }), 'global-css.txt');
        exportMenu.hidden = true;
        exportButton.setAttribute('aria-expanded', 'false');
    });
    modal.querySelector('#global-css-document-export-docx').addEventListener('click', () => {
        downloadGlobalCssDocument(globalCssCreateDocx(textarea.value), 'global-css.docx');
        exportMenu.hidden = true;
        exportButton.setAttribute('aria-expanded', 'false');
    });
    let importing = false, undo = null, undoButton;
    if (textarea.insertAdjacentElement) {
        undoButton = document.createElement('button'); undoButton.id = 'global-css-import-undo'; undoButton.type = 'button'; undoButton.hidden = true; undoButton.textContent = '撤销上次 CSS 导入';
        textarea.insertAdjacentElement('afterend', undoButton);
        undoButton.onclick = async () => {
            if (!undo || importing) return;
            if ((db.globalCss || '') !== undo.imported || textarea.value !== undo.imported) return showToast('CSS 已有后续修改，请先导出当前草稿后再恢复');
            importing = true; undoButton.disabled = true;
            const snapshot = undo;
            db.globalCss = snapshot.css; textarea.value = snapshot.draft; applyGlobalCss(snapshot.css);
            try { await saveData(); undo = null; undoButton.hidden = true; showToast('已撤销上次 CSS 导入'); }
            catch (error) { db.globalCss = snapshot.imported; textarea.value = snapshot.imported; applyGlobalCss(snapshot.imported); showToast(error.message || '撤销保存失败，请重试'); }
            finally { importing = false; undoButton.disabled = false; }
        };
    }
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file || importing) return;
        importing = true;
        const previous = db.globalCss || '', previousDraft = textarea.value;
        try {
            const result = await readImportDocument(file, { preview: false });
            if (!await previewGlobalCssImport(previousDraft, result.text)) return;
            if ((db.globalCss || '') !== previous || textarea.value !== previousDraft) throw new Error('CSS 或编辑草稿已变化，请重新导入预览后再应用');
            textarea.value = result.text;
            db.globalCss = result.text;
            applyGlobalCss(result.text);
            try { await saveData(); }
            catch (error) {
                if (db.globalCss === result.text) { db.globalCss = previous; applyGlobalCss(previous); }
                if (textarea.value === result.text) textarea.value = previousDraft;
                throw error;
            }
            undo = { css: previous, draft: previousDraft, imported: result.text };
            if (undoButton) undoButton.hidden = false;
            showToast('全局 CSS 已导入并保存');
        } catch (error) {
            console.error(error);
            showToast(error.message || '全局 CSS 导入失败');
        } finally { importing = false; }
    });
}

function downloadGlobalCssDocument(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.GlobalCssIO = { createDocx: globalCssCreateDocx, setup: setupGlobalCssDocumentTools };
new MutationObserver(() => setupGlobalCssDocumentTools()).observe(document.body, { childList: true, subtree: true });
