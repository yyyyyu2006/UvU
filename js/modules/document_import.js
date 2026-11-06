// Documents are converted to plain text; imported HTML is never inserted into the app.
async function readImportDocument(file, options = {}) {
    const progress = typeof document !== 'undefined' && typeof document.createElement === 'function' ? createDocumentImportProgress(options.signal) : null;
    try {
        const result = await parseImportDocument(file, { ...options, signal: progress?.signal || options.signal,
            onProgress: (stage) => { progress?.update(stage); options.onProgress?.(stage); } });
        progress?.close();
        return progress && !options.images && options.preview !== false ? await previewImportDocument(file, result, options) : result;
    } finally { progress?.close(); }
}
function previewImportDocument(file, initial, options) {
    return new Promise((resolve, reject) => {
        let result = initial, finished = false, revision = 0;
        const opener = document.activeElement, overlay = document.createElement('div');
        overlay.id = 'document-import-preview'; overlay.className = 'feature-dialog'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '文档文字预览');
        overlay.innerHTML = '<div class="feature-dialog-card"><header><strong>文档文字预览</strong><button type="button" data-cancel>取消</button></header><label class="document-encoding">TXT 编码<select aria-label="TXT 编码"><option value="auto">自动识别</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label><p aria-live="polite"></p><textarea readonly rows="12" aria-label="解析后的文档文字" style="width:100%;box-sizing:border-box"></textarea><p>确认后继续原界面的导入或草稿编辑；此处尚未写入任何资料。</p><button type="button" data-confirm>使用此解析结果</button></div>';
        const select = overlay.querySelector('select'), confirmButton = overlay.querySelector('[data-confirm]');
        overlay.querySelector('.document-encoding').hidden = initial.encoding === undefined;
        select.value = options.encoding || 'auto';
        const render = () => { overlay.querySelector('textarea').value = result.text.slice(0, 50000); overlay.querySelector('[aria-live]').textContent =
            (result.encoding ? '识别编码：' + result.encoding + '；' : '') + '共 ' + result.text.length + ' 字符' + (result.text.length > 50000 ? '（仅预览前50000字符，导入保留全部）' : '') + '。' + (result.warnings || []).join('；'); };
        const finish = accepted => {
            if (finished) return; finished = true; options.signal?.removeEventListener('abort', cancel);
            overlay.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true });
            if (accepted) resolve(result); else reject(Object.assign(new Error('文档导入已取消'), { name: 'AbortError' }));
        };
        const cancel = () => finish(false);
        overlay.querySelector('[data-cancel]').onclick = cancel; confirmButton.onclick = () => finish(true);
        select.onchange = async () => {
            const current = ++revision; confirmButton.disabled = true;
            try { const next = await parseImportDocument(file, { ...options, encoding: select.value }); if (!finished && current === revision) { result = next; render(); } }
            catch (error) { if (!finished) overlay.querySelector('[aria-live]').textContent = error.message; }
            finally { if (!finished && current === revision) confirmButton.disabled = false; }
        };
        overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } });
        options.signal?.addEventListener('abort', cancel, { once: true });
        document.body.appendChild(overlay); render(); overlay.querySelector('[data-cancel]').focus();
        if (options.signal?.aborted) cancel();
    });
}
function createDocumentImportProgress(externalSignal) {
    const opener = document.activeElement; let closed = false;
    const controller = new AbortController(), cancel = () => controller.abort();
    externalSignal?.addEventListener('abort', cancel, { once: true }); if (externalSignal?.aborted) cancel();
    const overlay = document.createElement('div'); overlay.className = 'feature-dialog document-import-progress'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '读取导入文档');
    overlay.innerHTML = '<div class="feature-dialog-card"><p aria-live="polite">正在读取文档…</p><button type="button">取消导入</button></div>';
    overlay.querySelector('button').onclick = () => { cancel(); overlay.querySelector('p').textContent = '已取消；正在丢弃解析结果…'; };
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } });
    document.body.appendChild(overlay); overlay.querySelector('button').focus();
    return { signal: controller.signal, update: text => { overlay.querySelector('p').textContent = text; }, close() { if (closed) return; closed = true; externalSignal?.removeEventListener('abort', cancel); overlay.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); } };
}
async function parseImportDocument(file, { images = false, signal, onProgress, encoding: requestedEncoding = 'auto' } = {}) {
    const checkpoint = async stage => {
        if (signal?.aborted) throw Object.assign(new Error('文档导入已取消'), { name: 'AbortError' });
        onProgress?.(stage);
        if (typeof setTimeout === 'function') await new Promise(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) throw Object.assign(new Error('文档导入已取消'), { name: 'AbortError' });
    };
    await checkpoint('正在检查文件…');
    if (!file || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20MB 的文档');
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'txt') {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        await checkpoint('正在识别文字编码…');
        let encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
        if (['utf-8', 'utf-16le', 'utf-16be', 'gb18030'].includes(requestedEncoding)) encoding = requestedEncoding;
        let text = new TextDecoder(encoding).decode(buffer);
        if (requestedEncoding === 'auto' && encoding === 'utf-8' && text.includes('�')) { encoding = 'gb18030'; text = new TextDecoder('gb18030').decode(buffer); }
        if (text.length > 2000000) throw new Error('文档文字过多，请拆分后导入');
        await checkpoint('文字解析完成（' + encoding + '）');
        return { text: text.replace(/^\uFEFF/, ''), stickers: [], encoding, warnings: text.includes('�') ? ['检测到无法解码的字符，请尝试其他编码后导入'] : [] };
    }
    if (extension !== 'docx') throw new Error('请选择 DOCX 或 TXT 文档（旧版 DOC 请另存为 DOCX）');
    if (typeof mammoth === 'undefined') throw new Error('DOCX 解析库未加载，请检查网络后刷新');
    const arrayBuffer = await file.arrayBuffer();
    await checkpoint('正在检查 DOCX 压缩目录…');
    validateDocxArchive(arrayBuffer);
    await checkpoint('正在解析 DOCX；复杂格式将转为纯文字…');
    if (!images) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        if (result.value.length > 2000000) throw new Error('文档文字过多，请拆分后导入');
        await checkpoint('DOCX 文字已解析；图片、表格样式与脚注布局不保留');
        return { text: result.value, stickers: [], warnings: ['DOCX 已转为纯文字，图片、表格样式和脚注布局不保留'] };
    }
    let imageBytes = 0, imageCount = 0;
    const result = await mammoth.convertToHtml({ arrayBuffer }, {
        convertImage: mammoth.images.imgElement(async image => {
            await checkpoint('正在读取文档图片 ' + (imageCount + 1) + '…');
            if (++imageCount > 300) throw new Error('单个文档最多包含 300 张表情图片');
            if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(image.contentType)) return { src: '' };
            const base64 = await image.read('base64');
            imageBytes += base64.length;
            if (imageBytes > 30 * 1024 * 1024) throw new Error('文档图片总量过大，请拆分后导入');
            return { src: `data:${image.contentType};base64,${base64}` };
        })
    });
    await checkpoint('正在整理表情与文字…');
    const documentTree = new DOMParser().parseFromString(result.value, 'text/html');
    const stickers = [];
    documentTree.querySelectorAll('img').forEach((image, i) => {
        if (!validStickerImage(image.getAttribute('src'))) return;
        const row = image.closest('tr') || image.closest('p');
        const caption = (row?.textContent || image.getAttribute('alt') || '').trim();
        const metadata = parseStickerCaption(caption, `表情 ${i + 1}`);
        stickers.push({ ...metadata, data: image.getAttribute('src') });
    });
    const text = Array.from(documentTree.querySelectorAll('p')).map(p => p.textContent).join('\n');
    return { text, stickers };
}
function validateDocxArchive(buffer) {
    const view = new DataView(buffer);
    let end = view.byteLength - 22;
    for (; end >= Math.max(0, view.byteLength - 65557); end--) {
        if (view.getUint32(end, true) === 0x06054b50) break;
    }
    if (end < 0 || end < view.byteLength - 65557 || view.getUint32(end, true) !== 0x06054b50) throw new Error('DOCX 文件损坏或格式不支持');
    const count = view.getUint16(end + 10, true), directory = view.getUint32(end + 16, true);
    if (count > 3000 || directory >= end) throw new Error('DOCX 结构过大或格式不支持');
    let cursor = directory, total = 0;
    for (let i = 0; i < count; i++) {
        if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('DOCX 压缩目录损坏');
        total += view.getUint32(cursor + 24, true);
        if (total > 80 * 1024 * 1024) throw new Error('DOCX 解压内容超过 80MB，请拆分后导入');
        cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    }
}
function validStickerImage(value) {
    return typeof value === 'string' && (/^https?:\/\/[^\s]+$/i.test(value) || /^data:image\/(png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(value));
}
function parseStickerCaption(value, fallback) {
    const [name, keys = '', ...description] = String(value).split('|').map(s => s.trim());
    return { name: name || fallback, keywords: worldBookKeys(keys), description: description.join('|') };
}
function parseStickerDocumentLines(text) {
    const stickers = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const match = line.match(/^(.*?)[:：\t]\s*(https?:\/\/\S+)\s*$/i);
        if (!match || !validStickerImage(match[2])) continue;
        stickers.push({ ...parseStickerCaption(match[1], `表情 ${stickers.length + 1}`), data: match[2] });
    }
    return stickers;
}
function chooseImportFile(accept, action) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        try { await action(input.files[0]); } catch (error) { console.error(error); showToast(error.message || '导入失败'); }
    });
    input.click();
}
