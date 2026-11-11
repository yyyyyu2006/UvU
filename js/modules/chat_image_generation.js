// On-demand photo generation, isolated from ordinary chat replies and workshop state.
const ChatImageGeneration = (() => {
    let ui, target, running, retry;
    const maxBytes = 15 * 1024 * 1024;
    const cancelled = () => Object.assign(new Error('已取消生成'), { name: 'AbortError' });
    const isSelected = () => ui?.aiMode.checked === true;

    function status(text) {
        if (!ui) return;
        ui.status.textContent = text;
        ui.status.hidden = !text;
    }

    function refresh() {
        if (!ui) return;
        const ai = isSelected(), busy = Boolean(running);
        ui.textMode.disabled = ui.aiMode.disabled = busy;
        ui.input.readOnly = busy;
        ui.submit.disabled = busy;
        ui.submit.textContent = busy ? (running.saving ? '保存中…' : '生成中…')
            : ai ? (retry && retry.prompt === ui.input.value.trim() ? '重试发送' : '生成并发送') : '发送';
        ui.cancel.hidden = !busy;
        ui.cancel.disabled = Boolean(running?.saving);
        ui.hint.hidden = !ai;
        ui.form.setAttribute('aria-busy', String(busy));
        if (ui.preview) {
            const ready = Boolean(ai && retry?.image && retry.target === target && retry.prompt === ui.input.value.trim());
            ui.preview.hidden = !ready;
            ui.previewToggle.hidden = !ai;
            ui.previewCheckbox.disabled = busy;
            ui.previewConfirm.disabled = ui.previewRegenerate.disabled = busy;
            if (ready) { ui.previewImage.src = retry.image; ui.previewSave.href = retry.image; }
            else { ui.previewImage.removeAttribute('src'); ui.previewSave.removeAttribute('href'); }
        }
    }

    function cancel() {
        if (!running || running.saving) return;
        const session = running;
        running = null;
        clearTimeout(session.timer);
        session.controller.abort();
        status('已取消生成');
        refresh();
    }

    function open() {
        // A pending database commit owns its message, but no longer owns a reopened dialog.
        if (running?.saving) running = null;
        else cancel();
        target = captureChatSendTarget();
        retry = null;
        status('');
        refresh();
    }

    function setup() {
        if (ui) return;
        const field = id => document.getElementById(id);
        if (!field('pv-mode-ai')) return;
        ui = { modal: field('send-pv-modal'), form: field('send-pv-form'), input: field('pv-text-input'),
            textMode: field('pv-mode-text'), aiMode: field('pv-mode-ai'), submit: field('pv-send-btn'),
            cancel: field('pv-cancel-generation'), status: field('pv-generation-status'), hint: field('pv-generation-hint') };
        for (const mode of [ui.textMode, ui.aiMode]) mode.addEventListener('change', () => {
            cancel(); retry = null; status(''); refresh();
        });
        ui.input.addEventListener('input', refresh);
        ui.cancel.addEventListener('click', cancel);
        ui.modal.addEventListener('click', event => { if (event.target === ui.modal) cancel(); });
        if (typeof MutationObserver !== 'undefined') new MutationObserver(() => {
            if (!ui.modal.classList.contains('visible')) cancel();
        }).observe(ui.modal, { attributes: true, attributeFilter: ['class'] });
        if (typeof document.createElement === 'function' && ui.hint?.insertAdjacentElement) {
            const toggle = document.createElement('label'); toggle.className = 'feature-help';
            toggle.innerHTML = '<input id="pv-confirm-preview" type="checkbox"> 生成后先预览，再确认发送';
            ui.hint.insertAdjacentElement('afterend', toggle);
            const preview = document.createElement('div'); preview.id = 'pv-generated-preview'; preview.hidden = true;
            preview.innerHTML = '<img alt="本次生成图片预览" style="display:block;max-width:100%;max-height:35dvh;object-fit:contain"><p class="feature-help">图片仅在本次弹窗暂存；关闭后请重新生成。保存失败可重试发送。</p><a id="pv-generated-save" download="UvU-generated-image.png">保存图片</a> <button id="pv-generated-confirm" type="button">确认发送</button> <button id="pv-generated-regenerate" type="button">重新生图</button>';
            toggle.insertAdjacentElement('afterend', preview);
            Object.assign(ui, { previewToggle: toggle, previewCheckbox: toggle.querySelector('input'), preview,
                previewImage: preview.querySelector('img'), previewSave: preview.querySelector('a'),
                previewConfirm: preview.querySelector('#pv-generated-confirm'), previewRegenerate: preview.querySelector('#pv-generated-regenerate') });
            ui.previewCheckbox.addEventListener('change', refresh);
            ui.previewConfirm.addEventListener('click', () => send(ui.input.value, true));
            ui.previewRegenerate.addEventListener('click', () => { retry = null; send(ui.input.value); });
        }
        refresh();
    }

    function assertActive(session) {
        if (running !== session || session.controller.signal.aborted) throw cancelled();
        if (!isChatSendTargetValid(session.target)) throw new Error('聊天或存档已变化，本次图片未发送，请重新打开后重试');
    }

    async function cancellable(promise, signal) {
        let onAbort;
        const cancellation = new Promise((_, reject) => {
            onAbort = () => reject(cancelled());
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) onAbort();
        });
        try { return await Promise.race([promise, cancellation]); }
        finally { signal.removeEventListener('abort', onAbort); }
    }

    async function readImageBlob(response, signal) {
        const tooLarge = () => new Error('生成图片超过 15MB，请降低工坊图片尺寸');
        if (Number(response.headers?.get('content-length')) > maxBytes) {
            if (response.body?.cancel) Promise.resolve(response.body.cancel()).catch(() => {});
            throw tooLarge();
        }
        if (!response.body?.getReader) {
            // Without streams no bounded read is possible; do not buffer unknown-size responses.
            throw new Error('图片下载需要浏览器流式读取支持，请更新浏览器后重试');
        }
        const reader = response.body.getReader(), chunks = [];
        let bytes = 0, complete = false;
        try {
            while (true) {
                const part = await cancellable(reader.read(), signal);
                if (part.done) { complete = true; break; }
                bytes += part.value.byteLength;
                if (bytes > maxBytes) throw tooLarge();
                chunks.push(part.value);
            }
            return new Blob(chunks);
        } finally {
            if (!complete) Promise.resolve(reader.cancel()).catch(() => {});
            reader.releaseLock();
        }
    }

    async function validateDecodedImage(blob, mime, signal) {
        const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
        const broken = () => new Error('生成图片损坏或不完整，请保留本次结果并重试下载');
        let width = 0, height = 0;
        if (mime === 'image/png') {
            if (bytes.length < 45 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw broken();
            width = view.getUint32(16); height = view.getUint32(20);
            let cursor = 8, ended = false, data = false;
            while (cursor + 12 <= bytes.length) {
                const size = view.getUint32(cursor), type = view.getUint32(cursor + 4);
                if (size > bytes.length - cursor - 12) throw broken();
                data ||= type === 0x49444154;
                cursor += size + 12;
                if (type === 0x49454e44) { ended = size === 0; break; }
            }
            if (!ended || !data || cursor !== bytes.length) throw broken();
        } else if (mime === 'image/jpeg') {
            if (bytes.length < 4 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw broken();
            for (let i = 2; i + 8 < bytes.length;) {
                if (bytes[i++] !== 255) break;
                while (bytes[i] === 255) i++;
                const marker = bytes[i++]; if (marker === 0xda || marker === 0xd9) break;
                if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
                const size = view.getUint16(i); if (size < 2 || size > bytes.length - i) throw broken();
                if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { height = view.getUint16(i + 3); width = view.getUint16(i + 5); break; }
                i += size;
            }
            if (!width || !height) throw broken();
        } else if (mime === 'image/webp') {
            if (bytes.length < 30 || view.getUint32(4, true) + 8 !== bytes.length) throw broken();
            const tag = String.fromCharCode(...bytes.slice(12, 16));
            if (tag === 'VP8X') { width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16); }
            else if (tag === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
            else if (tag === 'VP8L' && bytes[20] === 0x2f) { const value = view.getUint32(21, true); width = (value & 0x3fff) + 1; height = ((value >>> 14) & 0x3fff) + 1; }
            if (!width || !height) throw broken();
        }
        if (!width || !height || width > 8192 || height > 8192 || width * height > 24000000) throw new Error('生成图片尺寸或像素过大（最多2400万像素、单边8192），请降低工坊尺寸');
        if (signal.aborted) throw cancelled();
        // Browser decode validates compressed content after dimensions pass. Node fixtures validate container structure.
        if (typeof createImageBitmap === 'function') {
            let bitmap;
            const decoding = createImageBitmap(new Blob([blob], { type: mime }));
            decoding.then(result => { if (signal.aborted) result.close(); }, () => {});
            try { bitmap = await cancellable(decoding, signal); if (bitmap.width !== width || bitmap.height !== height) throw broken(); }
            catch (error) { if (signal.aborted) throw cancelled(); throw broken(); }
            finally { bitmap?.close(); }
        } else if (typeof Image === 'function' && typeof URL.createObjectURL === 'function') {
            const url = URL.createObjectURL(new Blob([blob], { type: mime })), image = new Image();
            try { image.src = url; await cancellable(image.decode(), signal); if (image.naturalWidth !== width || image.naturalHeight !== height) throw broken(); }
            catch (error) { if (signal.aborted) throw cancelled(); throw broken(); }
            finally { image.src = ''; URL.revokeObjectURL(url); }
        }
    }
    async function imageData(value, signal) {
        if (typeof value !== 'string' || !value.trim()) throw new Error('生图接口没有返回有效图片');
        value = value.trim();
        let blob;
        if (/^https?:\/\//i.test(value)) {
            const url = new URL(value);
            if (url.username || url.password) throw new Error('图片下载地址无效');
            let response;
            try { response = await fetch(url.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
            catch (error) {
                if (signal.aborted) throw cancelled();
                throw new Error('图片已生成，但下载失败；请检查图片外链和跨域访问设置');
            }
            if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}），请检查图片外链`);
            blob = await readImageBlob(response, signal);
        } else {
            const encoded = value.replace(/^data:image\/(?:png|jpe?g|webp);base64,/i, '').replace(/\s/g, '');
            if (encoded.length > Math.ceil(maxBytes * 4 / 3) + 4) throw new Error('生成图片超过 15MB，请降低工坊图片尺寸');
            let decoded;
            try { decoded = atob(encoded); }
            catch (_) { throw new Error('生图接口没有返回有效图片'); }
            blob = new Blob([Uint8Array.from(decoded, char => char.charCodeAt(0))]);
        }
        if (signal.aborted) throw cancelled();
        if (blob.size > maxBytes) throw new Error('生成图片超过 15MB，请降低工坊图片尺寸');
        const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        const mime = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? 'image/png'
            : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
            : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 ? 'image/webp' : '';
        if (!mime) throw new Error('生图接口没有返回有效的 PNG、JPEG 或 WebP 图片');
        await validateDecodedImage(blob, mime, signal);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('生成图片读取失败，请重试'));
            reader.readAsDataURL(new Blob([blob], { type: mime }));
        });
    }

    function errorText(error, session) {
        if (session.timedOut) return '生图等待超时，本次图片未发送，请稍后重试';
        if (error.name === 'AbortError') return '已取消生成';
        if (/^(?:未配置|聊天或存档|图片|生成图片|生图接口|请先在工坊)/.test(error.message)) return error.message;
        const http = error.message?.match(/生图 API 请求失败 \((\d+)\)/);
        return http ? `生图失败（HTTP ${http[1]}），请检查工坊 API 设置` : '生图失败，请检查工坊 API 配置或网络后重试';
    }

    async function send(text, confirmPreview = false) {
        text = String(text || '').trim();
        if (!text || running) return false;
        const source = target || captureChatSendTarget();
        if (!isChatSendTargetValid(source)) {
            status('聊天或存档已变化，请重新打开后重试');
            return false;
        }
        if (source.type === 'private' && typeof relationshipCanSend === 'function' && !relationshipCanSend(source.chat)) return false;
        const settings = structuredClone(db.workshopSettings || {});
        const key = JSON.stringify(settings);
        // Confirmation sends exactly the prepared preview; it cannot buy a new image.
        if (confirmPreview && !(retry?.target === source && retry.prompt === text && retry.key === key && retry.image)) {
            status('预览已失效，请重新生成并预览后发送');
            refresh(); return false;
        }
        const session = { target: source, controller: new AbortController(), saving: false, timedOut: false };
        running = session;
        session.timer = setTimeout(() => {
            if (running === session && !session.saving) { session.timedOut = true; session.controller.abort(); }
        }, 180000);
        status('正在生成图片…'); refresh();
        try {
            let image;
            if (retry?.target === source && retry.prompt === text && retry.key === key && retry.image) image = retry.image;
            else {
                if (retry && (retry.target !== source || retry.prompt !== text || retry.key !== key)) retry = null;
                if (typeof window.executeImageGeneration !== 'function') throw new Error('请先在工坊完成生图 API 配置，并刷新页面');
                const result = retry?.target === source && retry.prompt === text && retry.key === key && retry.raw
                    ? { imageData: retry.raw }
                    : await cancellable(window.executeImageGeneration(settings, text, { signal: session.controller.signal }), session.controller.signal);
                assertActive(session);
                retry = { target: source, prompt: text, key, raw: result.imageData };
                status('正在准备图片…');
                image = await cancellable(imageData(result.imageData, session.controller.signal), session.controller.signal);
                assertActive(session);
                retry = { target: source, prompt: text, key, image };
            }
            assertActive(session);
            if (ui?.previewCheckbox?.checked && !confirmPreview) {
                status('图片已生成；请预览后确认发送，也可先保存图片或重新生图');
                return false;
            }
            if (source.type === 'private' && typeof relationshipCanSend === 'function' && !relationshipCanSend(source.chat)) return false;
            session.saving = true; clearTimeout(session.timer); refresh();
            const { chat, type, chatId } = source;
            const name = type === 'private' ? chat.myName : chat.me.nickname;
            const message = { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role: 'user',
                content: image, parts: [{ type: 'text', text: `[${name}发来了一张图片：]\n图片描述：${text}` },
                    { type: 'image', data: image }], timestamp: Date.now() };
            if (type === 'group') message.senderId = 'user_me';
            const mutation = beginChatMutation(chat, type);
            if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, type);
            chat.history.push(message);
            if (isChatTargetVisible(source)) addMessageBubble(message, chatId, type);
            if (!await saveChatMutation(mutation, '图片发送未保存，请重试')) {
                if (running === session) status('图片已生成，但发送未保存；可重试发送');
                return false;
            }
            renderChatList();
            if (running === session) {
                retry = null;
                ui?.modal.classList.remove('visible');
            }
            showToast('图片已发送');
            return true;
        } catch (error) {
            if (running === session) status(errorText(error, session) + (retry?.raw ? '；生成结果已保留，可重试下载，无需重新生图' : ''));
            return false;
        } finally {
            clearTimeout(session.timer);
            if (running === session) { running = null; refresh(); }
        }
    }

    return { setup, open, isSelected, send, cancel };
})();
