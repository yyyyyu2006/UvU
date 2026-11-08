(function (root) {
    'use strict';
    const C = () => root.UvUCharacterCard, P = () => root.UvUCardPng, MAX_IMAGE = 16 * 1024 * 1024;
    const el = (tag, cls = '', text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };
    function icon(name) {
        const chevron = name === 'chevron-down', node = el('span', 'cc-icon' + (chevron ? ' cc-chevron' : ''));
        node.innerHTML = root.UvULucide?.[chevron ? 'chevron-right' : name] || ''; node.setAttribute('aria-hidden', 'true'); return node;
    }
    function button(text, action, cls = '') { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', action); return node; }
    function check(label, checked = false) { const node = el('input'); node.type = 'checkbox'; node.checked = checked; node.setAttribute('aria-label', label); return node; }
    const abort = () => new DOMException('导出已取消', 'AbortError');
    function alive(signal) { if (signal.aborted) throw abort(); }
    function wait(promise, signal) {
        alive(signal);
        return new Promise((resolve, reject) => {
            const stop = () => { cleanup(); reject(abort()); }, cleanup = () => signal.removeEventListener('abort', stop);
            signal.addEventListener('abort', stop, { once: true });
            promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
        });
    }
    async function imageBlob(source, signal) {
        if (source instanceof Blob) {
            if (source.size > MAX_IMAGE) throw new Error('封面图片不能超过 16 MiB');
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(source.type)) throw new Error('封面支持 PNG、JPEG 或 WebP');
            return source;
        }
        const url = new URL(source, location.href);
        if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) || url.username || url.password || url.protocol === 'data:' && !/^data:image\/(png|jpeg|webp);base64,/i.test(source)) throw new Error('封面地址无效，请上传本地图片');
        if (url.protocol === 'data:' && source.length > MAX_IMAGE * 1.4) throw new Error('封面图片不能超过 16 MiB');
        let response;
        try { response = await fetch(url.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
        catch (error) { if (signal.aborted) throw abort(); throw new Error('无法读取远程封面，请上传本地图片'); }
        if (!response.ok) throw new Error('读取封面失败 HTTP ' + response.status + '，请上传本地图片');
        if (Number(response.headers.get('content-length')) > MAX_IMAGE) { await response.body?.cancel(); throw new Error('封面图片不能超过 16 MiB'); }
        if (!response.body?.getReader) {
            const blob = await wait(response.blob(), signal); if (blob.size > MAX_IMAGE) throw new Error('封面图片不能超过 16 MiB'); return blob;
        }
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
            for (;;) {
                const part = await wait(reader.read(), signal); if (part.done) break;
                size += part.value.byteLength; if (size > MAX_IMAGE) throw new Error('封面图片不能超过 16 MiB'); chunks.push(part.value);
            }
        } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
        return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
    }
    async function normalizeCover(source, name, signal) {
        alive(signal); const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器无法生成 PNG 图片');
        if (!source) {
            canvas.width = 600; canvas.height = 800; context.fillStyle = '#f5f7fa'; context.fillRect(0, 0, 600, 800);
            context.fillStyle = '#394653'; context.font = '48px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(name.slice(0, 8), 300, 400, 520);
        } else {
            const blob = await imageBlob(source, signal), url = URL.createObjectURL(blob), image = new Image();
            try {
                const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('封面图片无法解码，请换一张 PNG、JPEG 或 WebP')); image.src = url; });
                await wait(loaded, signal); alive(signal);
                const width = image.naturalWidth, height = image.naturalHeight;
                if (!width || !height || width > 16384 || height > 16384 || width * height > 64 * 1024 * 1024) throw new Error('封面像素过大，请缩小图片后重试');
                const scale = Math.min(1, 2048 / Math.max(width, height)); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
            } finally { image.src = ''; URL.revokeObjectURL(url); }
        }
        const blob = await wait(new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('封面 PNG 编码失败')), 'image/png')), signal);
        alive(signal); const bytes = new Uint8Array(await wait(blob.arrayBuffer(), signal)); canvas.width = canvas.height = 1; return bytes;
    }
    function open(chat) {
        if (!chat || !db.characters.includes(chat)) return;
        document.querySelector('.cc-export-overlay')?.remove();
        const scope = C().capture(chat), selected = new Set(scope.data.entries.map(entry => entry.id));
        const overlay = el('div', 'feature-dialog cc-export-overlay'), panel = el('section', 'feature-dialog-card cc-export-dialog');
        panel.setAttribute('aria-label', '导出角色卡');
        const head = el('header', 'cc-head'), title = el('h2', '', '导出角色卡'), close = button('', () => overlay.remove(), 'cc-close'); close.append(icon('x')); close.setAttribute('aria-label', '关闭角色卡导出'); close.dataset.action = 'close';
        head.append(title, el('span', 'cc-format', 'PNG'), close);
        const body = el('div', 'cc-body'), person = el('div', 'cc-person'), portrait = el('div', 'cc-portrait', scope.data.name.slice(0, 1)), info = el('div', 'cc-person-info');
        let cover = scope.data.avatar, localUrl, job = null;
        const preview = source => {
            portrait.replaceChildren(); if (!source) { portrait.textContent = scope.data.name.slice(0, 1); return; }
            const image = el('img'); image.alt = '角色卡封面'; image.referrerPolicy = 'no-referrer';
            if (/^(https?:|data:image\/(png|jpeg|webp);base64,|blob:|assets\/|\/)/i.test(source)) { image.src = source; image.onerror = () => { image.remove(); portrait.textContent = scope.data.name.slice(0, 1); }; portrait.append(image); }
            else portrait.textContent = scope.data.name.slice(0, 1);
        };
        preview(cover); info.append(el('h3', '', scope.data.name), el('p', 'cc-muted', '角色卡 V2'));
        const upload = el('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.hidden = true; upload.setAttribute('aria-label', '更换角色卡封面');
        const choose = button('封面', () => upload.click(), 'cc-cover-button'); info.append(choose, upload); person.append(portrait, info); body.append(person);
        const persona = el('details', 'cc-persona'), ps = el('summary', '', '角色人设'); ps.append(icon('chevron-down')); persona.append(ps);
        const personaText = el('p', '', scope.data.persona || '未填写人设'); persona.append(personaText); body.append(persona);
        const bookSection = el('section', 'cc-books'), bookHead = el('div', 'cc-section-head'), allLabel = el('label', 'cc-all', '全选'), all = check('全选世界书', selected.size > 0);
        allLabel.append(all); all.disabled = !selected.size; bookHead.append(el('h3', '', '配套世界书'), allLabel); bookSection.append(bookHead); const groups = [];
        for (const group of scope.groups) {
            const row = el('div', 'cc-book'), label = el('label', 'cc-book-select'), toggle = check('选择 ' + group.name, true), details = el('details', 'cc-book-details'), summary = el('summary', '', '查看内容');
            label.append(toggle, el('span', 'cc-book-name', group.name), el('span', 'cc-quantity', group.entries.length + ' 条')); summary.append(icon('chevron-down')); details.append(summary);
            const entries = el('div', 'cc-entries');
            for (const entry of group.entries) {
                const item = el('div', 'cc-entry'), itemLabel = el('label', 'cc-entry-select'), box = check('包含 ' + entry.name, true); box.dataset.entry = entry.id;
                itemLabel.append(box, el('span', '', entry.name || '未命名条目'));
                const text = el('details', 'cc-entry-content'), textSummary = el('summary', '', '正文'); textSummary.append(icon('chevron-down')); text.append(textSummary);
                text.addEventListener('toggle', () => { if (text.open && !text.querySelector('p')) text.append(el('p', '', entry.content || '')); });
                box.addEventListener('change', () => { if (box.checked) selected.add(entry.id); else selected.delete(entry.id); update(); });
                item.append(itemLabel, text); entries.append(item);
            }
            toggle.addEventListener('change', () => { for (const entry of group.entries) { if (toggle.checked) selected.add(entry.id); else selected.delete(entry.id); } update(); });
            details.append(entries); row.append(label, details); bookSection.append(row); groups.push({ group, toggle });
        }
        if (!scope.groups.length) bookSection.append(el('p', 'cc-empty', '未绑定世界书'));
        if (scope.missingIds.length) bookSection.append(el('p', 'cc-note', scope.missingIds.length + ' 条绑定内容已不存在，未纳入导出'));
        body.append(bookSection);
        const more = el('details', 'cc-more'), moreSummary = el('summary', '', '更多设置'); moreSummary.append(icon('chevron-down')); more.append(moreSummary);
        const original = scope.data.original ? C().retain(scope.data.original).data : {}, fields = {};
        for (const [key, text, value] of [['creator', '作者', original.creator || ''], ['version', '版本', original.character_version || '1.0']]) {
            const label = el('label', 'cc-field', text), input = el('input'); input.type = 'text'; input.value = value; input.maxLength = key === 'creator' ? 2000 : 200; label.append(input); fields[key] = input; more.append(label);
        }
        const help = el('details', 'cc-help'), hs = el('summary', '', '分享说明'); hs.append(icon('chevron-down')); help.append(hs, el('p', '', '仅包含角色人设、卡片资料和勾选的世界书，不包含私聊、用户人设或日记。请分享原图或文件，压缩图片可能丢失角色数据。酒馆的特殊插入规则需导入后确认。')); more.append(help); body.append(more);
        const foot = el('footer', 'cc-foot'), count = el('p', 'cc-count'), cancel = button('取消生成', () => job?.abort(), 'cc-cancel'), run = button('导出 PNG', generate, 'cc-export-button'); run.prepend(icon('download')); cancel.hidden = true;
        foot.append(count, cancel, run); const message = el('p', 'cc-message'); message.setAttribute('aria-live', 'polite');
        panel.append(head, body, foot, message); overlay.append(panel); (document.querySelector('.phone-screen') || document.body).append(overlay);
        const observer = new MutationObserver(() => { if (!overlay.isConnected) { job?.abort(); if (localUrl) URL.revokeObjectURL(localUrl); observer.disconnect(); } }); observer.observe(overlay.parentElement, { childList: true });
        overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
        upload.addEventListener('change', () => {
            const file = upload.files[0]; if (!file) return;
            if (file.size > MAX_IMAGE || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { message.textContent = '请选择 16 MiB 以内的 PNG、JPEG 或 WebP'; return; }
            if (localUrl) URL.revokeObjectURL(localUrl); localUrl = URL.createObjectURL(file); cover = file; preview(localUrl); message.textContent = ''; upload.value = '';
        });
        all.addEventListener('change', () => { selected.clear(); if (all.checked) scope.data.entries.forEach(entry => selected.add(entry.id)); update(); });
        function update() {
            const used = groups.filter(({ group }) => group.entries.some(entry => selected.has(entry.id))).length;
            count.textContent = '人设 + ' + used + ' 本世界书';
            all.checked = selected.size > 0 && selected.size === scope.data.entries.length; all.indeterminate = selected.size > 0 && !all.checked;
            for (const { group, toggle } of groups) { const n = group.entries.filter(entry => selected.has(entry.id)).length; toggle.checked = n === group.entries.length; toggle.indeterminate = n > 0 && !toggle.checked; }
            overlay.querySelectorAll('[data-entry]').forEach(box => { box.checked = selected.has(box.dataset.entry); });
        }
        function guard() {
            if (!overlay.isConnected || currentChatType !== 'private' || currentChatId !== chat.id || !C().isCurrent(scope)) throw new Error('角色、存档或设定已变化，请重新打开导出面板');
        }
        async function generate() {
            if (job) return;
            job = new AbortController(); const controller = job, timeout = setTimeout(() => controller.abort(), 30000);
            const controls = [...panel.querySelectorAll('input,button')].filter(node => node !== close && node !== cancel), previous = controls.map(node => node.disabled);
            controls.forEach(node => { node.disabled = true; }); cancel.hidden = false; message.textContent = '正在生成…'; message.removeAttribute('role');
            try {
                guard(); const card = C().build(scope, [...selected], { creator: fields.creator.value, version: fields.version.value });
                const coverBytes = await normalizeCover(cover, scope.data.name, controller.signal); alive(controller.signal); guard();
                const bytes = P().write(coverBytes, card);
                if (JSON.stringify(P().read(bytes)) !== JSON.stringify(card)) throw new Error('导出文件读回校验失败');
                alive(controller.signal); guard(); const blob = new Blob([bytes], { type: 'image/png' }), url = URL.createObjectURL(blob), link = el('a');
                link.href = url; link.download = (scope.data.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || '角色卡') + '.png'; link.hidden = true; panel.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
                const special = scope.data.entries.some(entry => selected.has(entry.id) && (entry.rules?.unsupportedPosition || !['before', 'after', undefined].includes(entry.position)));
                message.textContent = special ? '已生成 PNG；特殊插入位置请在酒馆确认' : 'PNG 已生成';
            } catch (error) { if (overlay.isConnected) { message.textContent = error.name === 'AbortError' ? '生成已取消或超时，可重试' : error.message; message.setAttribute('role', 'alert'); } }
            finally { clearTimeout(timeout); job = null; controls.forEach((node, i) => { node.disabled = previous[i]; }); cancel.hidden = true; }
        }
        update(); return overlay;
    }
    document.addEventListener('click', event => {
        if (!event.target.closest('#export-character-card-btn')) return;
        const chat = currentChatType === 'private' && db.characters.find(item => item.id === currentChatId); if (!chat) return;
        const name = document.getElementById('setting-char-realname'), persona = document.getElementById('setting-char-persona');
        if (name?.value !== (chat.realName || '') || persona?.value !== (chat.persona || '')) { showToast('请先保存角色设定，再导出角色卡'); return; }
        try { open(chat); } catch (error) { showToast(error.message); }
    });
    root.UvUCharacterCardUI = { open };
})(window);
