function documentNode(tag, text, className = '') {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text; return node;
}
function downloadSharedDocument(file, format) {
    validateSharedDocument(file);
    let blob, name = file.name;
    if (format === 'original' && file.originalData) {
        const bytes = Uint8Array.from(atob(file.originalData.split(',')[1]), c => c.charCodeAt(0));
        blob = new Blob([bytes], { type: 'application/octet-stream' });
        name = file.originalName || file.name;
    } else if (format === 'docx') { blob = globalCssCreateDocx(file.text); name = name.replace(/\.[^.]+$/, '') + '.docx'; }
    else { blob = new Blob([file.text], { type: 'text/plain;charset=utf-8' }); name = /\.(txt|md|csv|tsv)$/i.test(name) ? name : name.replace(/\.[^.]+$/, '') + '.txt'; }
    downloadGlobalCssDocument(blob, name);
}
function sharedDocumentOriginal(file, signal) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader(), abort = () => reader.abort();
        const finish = (error, result) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
        reader.onload = () => finish(null, 'data:application/octet-stream;base64,' + String(reader.result).split(',')[1]);
        reader.onerror = () => finish(new Error('原件读取失败，请重试'));
        reader.onabort = () => finish(Object.assign(new Error('已取消读取'), { name: 'AbortError' }));
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) return finish(Object.assign(new Error('已取消读取'), { name: 'AbortError' }));
        reader.readAsDataURL(file);
    });
}
function openSharedDocumentDialog(message, chat) {
    const target = chat ? captureChatSendTarget(chat.id, 'private') : currentChatType === 'private' ? captureChatSendTarget() : null;
    if (!isChatSendTargetValid(target)) { showToast('请先打开要分享文件的私聊'); return; }
    const controller = new AbortController();
    const dialog = createMessageForwardDialog(message ? '查看文件' : '分享文件', 'shared-document-dialog', () => controller.abort());
    dialog.panel.classList.add('shared-document-dialog');
    const body = documentNode('div', undefined, 'shared-document-body'); dialog.panel.appendChild(body);
    let file = message?.document, reading = false;
    const input = documentNode('input'); input.type = 'file'; input.accept = '.txt,.md,.markdown,.docx,.pdf,.csv,.tsv,.xlsx,.xls'; input.setAttribute('aria-label', '选择分享文件'); input.hidden = true;
    const upload = documentNode('button', undefined, 'shared-document-upload'); upload.type = 'button'; upload.dataset.icon = 'upload'; upload.hidden = Boolean(message);
    const uploadText = documentNode('span', undefined, 'shared-document-upload-label');
    const choose = documentNode('strong', '选择文件'); uploadText.append(choose, documentNode('small', '文档、PDF 或表格 · 最大 5 MB')); upload.append(uploadText);
    upload.onclick = () => input.click();
    const editor = documentNode('section', undefined, 'shared-document-editor');
    const name = documentNode('input', undefined, 'shared-document-name'); name.setAttribute('aria-label', '文件名'); name.placeholder = '文件名'; name.maxLength = 120;
    const previewHeading = documentNode('div', undefined, 'shared-document-preview-heading'); previewHeading.append(documentNode('strong', '正文预览'));
    const edit = documentNode('button', '编辑副本'); edit.type = 'button'; edit.dataset.icon = 'pencil'; edit.hidden = !message; previewHeading.append(edit);
    const text = documentNode('textarea'); text.setAttribute('aria-label', '文件正文'); text.rows = 8; text.maxLength = SHARED_DOCUMENT_LIMIT; text.readOnly = Boolean(message);
    editor.append(name, previewHeading, text);
    const status = documentNode('p', '', 'shared-document-help shared-document-status'); status.setAttribute('aria-live', 'polite');
    const downloads = documentNode('details', undefined, 'shared-document-downloads'); downloads.append(documentNode('summary', '下载与导出'));
    const exportActions = documentNode('div', undefined, 'shared-document-export-actions');
    const original = documentNode('button', '下载原件'), txt = documentNode('button', '导出文本'), docx = documentNode('button', '导出 DOCX');
    for (const button of [original, txt, docx]) { button.type = 'button'; button.dataset.icon = 'download'; exportActions.append(button); } downloads.append(exportActions);
    const tutorial = documentNode('details', undefined, 'shared-document-tutorial'); tutorial.append(documentNode('summary', '使用说明'));
    tutorial.append(documentNode('p', '选择文件，核对正文后发送。在聊天中告诉角色需要阅读或修改的内容，修改版会作为新文件返回。', 'shared-document-help'),
        documentNode('p', '支持 TXT、Markdown、DOCX、PDF、CSV、TSV、XLSX 和 XLS，每份最多 5 MB、100000 字符。文件在本机解析，发送后才随聊天请求交给模型。PDF 需包含可提取文字；图片、复杂排版、公式和宏不参与编辑。每轮最多提供最近 8 份文件、共 32000 字符，超长会标明截取。原件始终保留。', 'shared-document-help'));
    body.append(input, upload, editor, status, downloads, tutorial);
    const actions = documentNode('footer', undefined, 'shared-document-actions');
    const send = documentNode('button', message ? '发送修改副本' : '发送文件'); send.type = 'button'; send.dataset.icon = 'send'; send.dataset.action = 'send'; actions.append(send); dialog.panel.append(actions);
    function refresh(resetContent = true) {
        if (resetContent) { name.value = file?.name || ''; text.value = file?.text || ''; }
        editor.hidden = downloads.hidden = actions.hidden = !file;
        choose.textContent = file ? '更换文件' : '选择文件';
        status.textContent = file ? `${text.value.length} 字符${file.parentId ? ' · 修改副本' : ''}${file.warnings?.length ? ' · ' + file.warnings.join('；') : ''}` : '';
        original.hidden = !file?.originalData;
        [original, txt, docx, send].forEach(button => button.disabled = !file || reading);
        upload.disabled = input.disabled = reading;
    }
    edit.onclick = () => { text.readOnly = false; text.focus({ preventScroll: true }); status.textContent = '正在编辑副本'; };
    text.addEventListener('input', () => { if (!reading) refresh(false); });
    input.onchange = async () => {
        const picked = input.files?.[0]; if (!picked || reading) return;
        reading = true; refresh(false); status.textContent = '正在读取…';
        try {
            const parsed = await parseSharedDocument(picked, { signal: controller.signal });
            const originalData = await sharedDocumentOriginal(picked, controller.signal);
            if (controller.signal.aborted) return;
            if (!isChatSendTargetValid(target)) throw new Error('角色或存档已变化，请重新打开');
            file = validateSharedDocument({ ...parsed, originalData, originalName: parsed.name });
            refresh();
        } catch (error) { if (!controller.signal.aborted) { file = null; refresh(); status.textContent = error.message; } }
        finally { reading = false; if (!controller.signal.aborted) { upload.disabled = input.disabled = false; [original, txt, docx, send].forEach(button => button.disabled = !file); } }
    };
    const draft = () => {
        const changed = text.value !== file.text || sharedDocumentName(name.value) !== file.name;
        return makeSharedDocument(name.value, text.value, message ? { parentId: message.id } : changed ? { originalData: file.originalData, originalName: file.originalName || file.name, bytes: file.bytes, hasEdits: true, warnings: ['文字已编辑；仍保留可下载原件，角色阅读当前文字'] } : file);
    };
    const action = callback => { try { callback(); } catch (error) { status.textContent = error.message; } };
    original.onclick = () => action(() => downloadSharedDocument(file, 'original'));
    txt.onclick = () => action(() => downloadSharedDocument(draft(), 'text'));
    docx.onclick = () => action(() => downloadSharedDocument(draft(), 'docx'));
    send.onclick = async () => {
        if (reading || !file) return;
        reading = true; refresh(false); dialog.setBusy(true);
        try {
            if (message && !target?.history.includes(message)) throw new Error('原消息已删除或存档已切换');
            if (await sendSharedDocument(target, draft())) { dialog.setBusy(false); dialog.dismiss(); showToast('文件已发送'); }
            else status.textContent = '文件未发送或未保存，请检查后重试';
        } catch (error) { status.textContent = error.message; }
        finally { reading = false; dialog.setBusy(false); upload.disabled = input.disabled = false; [send, txt, docx, original].forEach(button => button.disabled = !file); }
    };
    refresh();
}
function createSharedDocumentElement(message, chat, type, isContinuous) {
    const sent = message.role === 'user';
    const wrapper = documentNode('div', undefined, 'message-wrapper ' + (sent ? 'sent' : 'received'));
    wrapper.dataset.id = message.id; wrapper.dataset.senderId = sent ? 'user_me' : chat.id;
    if (message.isContextDisabled) wrapper.classList.add('context-disabled');
    const row = documentNode('div', undefined, 'message-bubble-row'), avatar = documentNode('img', undefined, 'message-avatar');
    avatar.src = (sent ? chat.myAvatar : chat.avatar) || ''; avatar.alt = '';
    if (chat.avatarMode === 'hidden' || (chat.avatarMode === 'kkt' && sent)) { avatar.classList.add('avatar-hidden'); wrapper.classList.add('no-avatar-layout'); }
    else if (isContinuous && ['merge', 'kkt'].includes(chat.avatarMode)) { avatar.classList.add('avatar-invisible'); wrapper.classList.add('avatar-invisible-layout'); }
    const card = documentNode('div', undefined, 'message-bubble shared-document-card'); card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', '查看文件 ' + message.document.name);
    const header = documentNode('div', undefined, 'shared-document-card-header'); header.append(documentNode('span', '文件分享'), documentNode('span', message.document.parentId || message.document.hasEdits ? '修改副本' : '原文件', 'shared-document-badge'));
    const content = documentNode('div', undefined, 'shared-document-card-content');
    const icon = documentNode('div', undefined, 'shared-document-icon'); icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 15h6M9 18h4"/></svg>';
    content.append(icon, documentNode('strong', message.document.name), documentNode('small', message.document.text.length + ' 字符 · ' + (message.document.name.split('.').pop() || 'TEXT').toUpperCase()), documentNode('span', '查看文件', 'shared-document-open'));
    card.append(header, content, documentNode('div', message.document.parentId ? '保留原件 · 点击查看与编辑' : '文字可供角色阅读 · 点击预览', 'shared-document-card-footer'));
    const open = () => { if (!isInMultiSelectMode && !isDebugMode) openSharedDocumentDialog(message, chat); };
    card.onclick = open; card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
    if (message.quote && typeof createQuotedMessageElement === 'function') card.prepend(createQuotedMessageElement(message.quote, chat));
    const info = documentNode('div', undefined, 'message-info'); info.appendChild(avatar);
    const time = documentNode('span', new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), 'message-time');
    if (chat.timestampStyle === 'avatar') info.appendChild(time); else card.appendChild(time);
    row.append(info, card);
    wrapper.appendChild(row); return wrapper;
}
function setupSharedDocuments() {
    const button = document.getElementById('share-document-btn');
    if (!button || button.dataset.bound) return; button.dataset.bound = 'true';
    button.onclick = () => openSharedDocumentDialog();
}
