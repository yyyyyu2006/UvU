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
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
            const result = await readImportDocument(file);
            if (!confirm('导入内容将替换并立即应用当前全局 CSS。继续吗？')) return;
            const previous = db.globalCss || '';
            textarea.value = result.text;
            db.globalCss = result.text;
            applyGlobalCss(result.text);
            try { await saveData(); }
            catch (error) {
                db.globalCss = previous;
                textarea.value = previous;
                applyGlobalCss(previous);
                throw error;
            }
            showToast('全局 CSS 已导入并保存');
        } catch (error) {
            console.error(error);
            showToast(error.message || '全局 CSS 导入失败');
        }
    });
}

function downloadGlobalCssDocument(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.GlobalCssIO = { createDocx: globalCssCreateDocx, setup: setupGlobalCssDocumentTools };
new MutationObserver(() => setupGlobalCssDocumentTools()).observe(document.body, { childList: true, subtree: true });
