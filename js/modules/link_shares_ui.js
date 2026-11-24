function sharedLinkNode(tag, text, className = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function sharedLinkLabel(labelText, control) {
    const label = sharedLinkNode('label', undefined, 'shared-link-field');
    label.append(sharedLinkNode('span', labelText), control);
    return label;
}

function openSharedLinkDialog(message = null, chat = null) {
    const target = chat ? captureChatSendTarget(chat.id, 'private') : currentChatType === 'private' ? captureChatSendTarget() : null;
    if (!isChatSendTargetValid(target) || target.type !== 'private') { showToast('请先打开要分享给角色的私聊'); return; }
    const dialog = createMessageForwardDialog(message ? '链接资料' : '分享链接', 'shared-link-dialog');
    dialog.panel.classList.add('shared-link-dialog');
    const body = sharedLinkNode('div', undefined, 'shared-link-body');
    const targetInfo = sharedLinkNode('p', `${target.chat.remarkName || target.chat.realName || '当前角色'} · 当前私聊`, 'shared-link-note');
    body.append(targetInfo);

    const url = sharedLinkNode('input'); url.type = 'url'; url.placeholder = 'https://…'; url.autocomplete = 'url'; url.maxLength = 2048; url.setAttribute('aria-label', '分享网址');
    const title = sharedLinkNode('input'); title.maxLength = SHARED_LINK_TITLE_LIMIT; title.placeholder = '网页或视频标题'; title.setAttribute('aria-label', '标题');
    const author = sharedLinkNode('input'); author.maxLength = SHARED_LINK_AUTHOR_LIMIT; author.placeholder = '作者（可选）'; author.setAttribute('aria-label', '作者');
    const description = sharedLinkNode('textarea'); description.rows = 3; description.maxLength = SHARED_LINK_DESCRIPTION_LIMIT; description.placeholder = '粘贴网页简介或视频文案'; description.setAttribute('aria-label', '简介');
    const readableText = sharedLinkNode('textarea'); readableText.rows = 7; readableText.maxLength = SHARED_LINK_TEXT_LIMIT; readableText.placeholder = '粘贴正文、字幕或你希望角色读到的内容'; readableText.setAttribute('aria-label', '角色可读正文或字幕');
    const meta = message?.linkShare;
    if (meta) {
        url.value = meta.url || ''; title.value = meta.title || ''; author.value = meta.author || '';
        description.value = meta.description || ''; readableText.value = meta.readableText || '';
    }
    const metadataRow = sharedLinkNode('div', undefined, 'shared-link-metadata-row');
    const analyze = sharedLinkNode('button', '读取 TikTok 预览'); analyze.type = 'button'; analyze.className = 'shared-link-analyze';
    analyze.title = '只读取平台公开的嵌入预览信息，不读取视频画面或字幕';
    const sourceStatus = sharedLinkNode('span', meta?.status === 'metadata-only' ? '仅有平台预览' : meta?.status === 'user-provided' ? '含有补充正文' : '尚未读取');
    metadataRow.append(analyze, sourceStatus);
    const thumbnail = sharedLinkNode('img', undefined, 'shared-link-thumbnail'); thumbnail.alt = ''; thumbnail.hidden = true; thumbnail.referrerPolicy = 'no-referrer';
    const status = sharedLinkNode('p', '', 'shared-link-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const note = sharedLinkNode('p', 'TikTok 可尝试读取官方嵌入预览；抖音、小红书和普通网页暂不自动读取正文。角色只会收到卡片信息和你补充的文字，不会因此自动看见视频画面。读取时会把网址发给对应平台。', 'shared-link-note');
    const fields = [sharedLinkLabel('网址', url), metadataRow, thumbnail, sharedLinkLabel('标题', title), sharedLinkLabel('作者', author),
        sharedLinkLabel('简介', description), sharedLinkLabel('正文／字幕（可选）', readableText), note, status];
    body.append(...fields);

    const actions = sharedLinkNode('footer', undefined, 'shared-link-actions');
    const cancel = sharedLinkNode('button', '取消'); cancel.type = 'button'; cancel.onclick = () => dialog.dismiss();
    const send = sharedLinkNode('button', message ? '保存资料' : '发送给角色'); send.type = 'button'; send.dataset.action = 'send';
    actions.append(cancel, send);
    dialog.panel.append(body, actions);

    let busy = false, metadataSource = meta?.metadataSource || '';
    const updateThumbnail = candidate => {
        thumbnail.removeAttribute('src'); thumbnail.hidden = true;
        if (!candidate) return;
        try {
            const safe = normalizeSharedLinkUrl(candidate);
            if (!safe.startsWith('https://')) return;
            thumbnail.onload = () => { thumbnail.hidden = false; };
            thumbnail.onerror = () => { thumbnail.hidden = true; };
            thumbnail.src = safe;
        } catch (_) { /* Invalid remote artwork remains hidden. */ }
    };
    if (meta?.thumbnailUrl) updateThumbnail(meta.thumbnailUrl);
    let thumbnailValue = meta?.thumbnailUrl || '';
    const createDraft = () => makeSharedLink({ url: url.value, title: title.value, author: author.value, description: description.value,
        readableText: readableText.value, metadataSource, thumbnailUrl: thumbnailValue });
    const setBusy = value => { busy = value; dialog.setBusy(value); analyze.disabled = value; send.disabled = value; url.disabled = value; };
    analyze.onclick = async () => {
        if (busy) return;
        setBusy(true); status.textContent = '正在尝试读取平台公开预览…';
        try {
            const result = await fetchTikTokShareMetadata(url.value);
            if (!isChatSendTargetValid(target)) throw new Error('角色或存档已变化，请重新打开链接分享');
            if (!title.value.trim()) title.value = result.title;
            if (!author.value.trim()) author.value = result.author;
            metadataSource = result.metadataSource;
            thumbnailValue = result.thumbnailUrl || '';
            updateThumbnail(thumbnailValue);
            sourceStatus.textContent = result.status === 'metadata-only' ? '仅有平台预览' : '已读取';
            status.textContent = '已取得标题、作者等嵌入预览信息；视频正文、字幕和画面尚未读取。';
        } catch (error) { if (error.name !== 'AbortError') status.textContent = error.message; }
        finally { setBusy(false); }
    };
    url.addEventListener('input', () => {
        let platform = '';
        try { platform = sharedLinkPlatform(normalizeSharedLinkUrl(url.value)); } catch (_) { /* Wait until the URL is complete. */ }
        analyze.hidden = platform !== 'tiktok';
    });
    url.dispatchEvent(new Event('input'));
    send.onclick = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const draft = createDraft();
            if (!isChatSendTargetValid(target)) throw new Error('角色或存档已变化，请重新打开链接分享');
            const saved = message ? await updateSharedLink(target, message, draft) : await sendSharedLink(target, draft);
            if (!saved) { status.textContent = '链接未保存，请检查后重试'; return; }
            setBusy(false);
            dialog.dismiss();
            if (!message) showToast('链接已发送；角色可读范围已在卡片中标明');
        } catch (error) { status.textContent = error.message || '链接资料无效，请检查网址'; }
        finally { if (dialog.panel.isConnected) setBusy(false); }
    };
    window.UvUPanelLayout?.decorate(dialog.panel);
    url.focus({ preventScroll: true });
}

function createSharedLinkElement(message, chat, isContinuous) {
    let link;
    try { link = makeSharedLink(message.linkShare); } catch (_) { return null; }
    const sent = message.role === 'user';
    const wrapper = sharedLinkNode('div', undefined, 'message-wrapper ' + (sent ? 'sent' : 'received'));
    wrapper.dataset.id = message.id;
    if (message.isContextDisabled) wrapper.classList.add('context-disabled');
    const row = sharedLinkNode('div', undefined, 'message-bubble-row');
    const avatar = sharedLinkNode('img', undefined, 'message-avatar'); avatar.src = (sent ? chat.myAvatar : chat.avatar) || ''; avatar.alt = '';
    if (chat.avatarMode === 'hidden' || (chat.avatarMode === 'kkt' && sent)) { avatar.classList.add('avatar-hidden'); wrapper.classList.add('no-avatar-layout'); }
    else if (isContinuous && ['merge', 'kkt'].includes(chat.avatarMode)) { avatar.classList.add('avatar-invisible'); wrapper.classList.add('avatar-invisible-layout'); }
    const article = sharedLinkNode('article', undefined, 'message-bubble shared-link-card');
    const header = sharedLinkNode('header', undefined, 'shared-link-card-header');
    header.append(sharedLinkNode('span', link.platform === 'web' ? '网页链接' : ({ douyin: '抖音', tiktok: 'TikTok', xiaohongshu: '小红书' }[link.platform])));
    const state = link.status === 'user-provided' ? '含补充内容' : link.status === 'metadata-only' ? '仅预览信息' : '仅链接';
    header.append(sharedLinkNode('span', state, 'shared-link-badge'));
    if (link.thumbnailUrl) { const image = sharedLinkNode('img', undefined, 'shared-link-card-image'); image.src = link.thumbnailUrl; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.onerror = () => image.remove(); article.append(image); }
    const heading = sharedLinkNode('h3'); const anchor = sharedLinkNode('a', link.title || new URL(link.url).hostname);
    anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.referrerPolicy = 'no-referrer'; heading.append(anchor);
    const description = sharedLinkNode('p', link.description || ''); description.hidden = !link.description;
    const footer = sharedLinkNode('footer', undefined, 'shared-link-card-footer');
    footer.append(sharedLinkNode('span', link.readableText ? `角色可读正文 ${link.readableText.length} 字符` : '需要正文或字幕时可点开补充资料'));
    const edit = sharedLinkNode('button', '资料'); edit.type = 'button'; edit.setAttribute('aria-label', '查看或编辑链接资料');
    edit.onclick = event => { event.stopPropagation(); openSharedLinkDialog(message, chat); };
    footer.append(edit); article.append(header, heading, description, footer);
    row.append(avatar, article);
    const time = sharedLinkNode('div', new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'message-timestamp');
    if (chat.timestampStyle === 'avatar') row.append(time); else article.append(time);
    wrapper.append(row); return wrapper;
}

function setupSharedLinks() {
    const documentButton = document.getElementById('share-document-btn');
    if (!documentButton || document.getElementById('share-link-btn')) return;
    const button = document.createElement('button'); button.type = 'button'; button.id = 'share-link-btn'; button.className = 'expansion-item shared-link-action';
    button.setAttribute('aria-label', '分享链接给角色');
    const icon = sharedLinkNode('span', undefined, 'expansion-item-icon');
    icon.innerHTML = window.UvULucide?.link || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    button.append(icon, sharedLinkNode('span', '链接', 'expansion-item-name'));
    button.addEventListener('click', () => openSharedLinkDialog());
    documentButton.after(button);
}
