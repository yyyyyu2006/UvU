// Documents are converted to plain text; imported HTML is never inserted into the app.
async function readImportDocument(file, { images = false } = {}) {
    if (!file || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20MB 的文档');
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'txt') {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
        let text = new TextDecoder(encoding).decode(buffer);
        if (encoding === 'utf-8' && text.includes('�')) text = new TextDecoder('gb18030').decode(buffer);
        if (text.length > 2000000) throw new Error('文档文字过多，请拆分后导入');
        return { text: text.replace(/^\uFEFF/, ''), stickers: [] };
    }
    if (extension !== 'docx') throw new Error('请选择 DOCX 或 TXT 文档（旧版 DOC 请另存为 DOCX）');
    if (typeof mammoth === 'undefined') throw new Error('DOCX 解析库未加载，请检查网络后刷新');
    const arrayBuffer = await file.arrayBuffer();
    validateDocxArchive(arrayBuffer);
    if (!images) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        if (result.value.length > 2000000) throw new Error('文档文字过多，请拆分后导入');
        return { text: result.value, stickers: [] };
    }
    let imageBytes = 0, imageCount = 0;
    const result = await mammoth.convertToHtml({ arrayBuffer }, {
        convertImage: mammoth.images.imgElement(async image => {
            if (++imageCount > 300) throw new Error('单个文档最多包含 300 张表情图片');
            if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(image.contentType)) return { src: '' };
            const base64 = await image.read('base64');
            imageBytes += base64.length;
            if (imageBytes > 30 * 1024 * 1024) throw new Error('文档图片总量过大，请拆分后导入');
            return { src: `data:${image.contentType};base64,${base64}` };
        })
    });
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
