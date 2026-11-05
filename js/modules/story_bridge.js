// Optional local relay for SillyTavern continuity memories.
(function () {
    const STORAGE_KEY = 'uvu-story-bridge.v1';
    const DEFAULT_URL = 'http://127.0.0.1:8765/api/plugins/uvu-story-bridge';
    const PREVIOUS_DEFAULT_URL = 'http://127.0.0.1:8000/api/plugins/uvu-story-bridge';
    let syncBusy = false;
    let pollTimer = null;
    let sendBusy = false;
    let reviewBusy = false;
    let reviewSignature = '';

    function settings() {
        db.uvuStoryBridgeSettings = db.uvuStoryBridgeSettings || {};
        const value = db.uvuStoryBridgeSettings;
        value.cursorByCharacter = value.cursorByCharacter || {};
        value.pendingScenes = value.pendingScenes || {};
        value.sentMessages = value.sentMessages || {};
        value.outbox = value.outbox || [];
        value.receipts = value.receipts || {};
        value.injectionByCharacter = value.injectionByCharacter || {};
        return value;
    }

    function isEnabled() { return settings().bridgeEnabled !== false; }

    function readToken() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').token || ''; }
        catch { return ''; }
    }

    function saveToken(token) {
        if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token }));
        else localStorage.removeItem(STORAGE_KEY);
    }

    function baseUrl() {
        const saved = String(settings().baseUrl || '').trim().replace(/\/+$/, '');
        if (!saved || saved === PREVIOUS_DEFAULT_URL) {
            settings().baseUrl = DEFAULT_URL;
            return DEFAULT_URL;
        }
        return saved;
    }

    function targetAddressSpace() {
        try {
            const hostname = new URL(baseUrl()).hostname.toLowerCase();
            if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || /^127\./.test(hostname)) return 'loopback';
            if (hostname.endsWith('.local') || /^(10\.|192\.168\.|169\.254\.)/.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return 'local';
        } catch {}
        return undefined;
    }

    async function loopbackPermissionState() {
        if (!globalThis.navigator?.permissions?.query) return 'unavailable';
        try {
            return (await navigator.permissions.query({ name: 'loopback-network' })).state || 'unknown';
        } catch { return 'unavailable'; }
    }

    async function request(path, { method = 'GET', body, auth = true } = {}) {
        const headers = { Accept: 'application/json' };
        const token = readToken();
        if (auth && !token) throw new Error('尚未配对酒馆桥接服务。');
        if (auth) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let response;
        const signal = AbortSignal.timeout(15000);
        const addressSpace = targetAddressSpace();
        try {
            response = await fetch(`${baseUrl()}/v1${path}`, {
                signal, method, headers, body: body === undefined ? undefined : JSON.stringify(body),
                ...(addressSpace ? { targetAddressSpace: addressSpace } : {})
            });
        } catch (error) {
            const permission = addressSpace === 'loopback' ? await loopbackPermissionState() : 'not-loopback';
            const diagnosis = permission === 'denied'
                ? 'Chrome 已拒绝此网站的 loopback-network 权限，请在该网站权限中解除阻止。'
                : permission === 'prompt'
                    ? 'loopback-network 尚未授权；若没有弹窗，请确认使用 HTTPS 页面并在页面内点击连接。'
                    : permission === 'granted'
                        ? 'loopback-network 已授权；请检查酒馆桥接插件是否已启动、server/config.json 是否包含当前 UvU 来源，以及客户端端口是否与桥接地址一致。'
                        : permission === 'unavailable'
                            ? '浏览器未提供 loopback-network 权限状态；请确认已安装并启动酒馆桥接插件、server/config.json 来源白名单与客户端端口配置正确。'
                            : '请确认酒馆桥接地址和服务状态。';
            throw new Error(`浏览器未能连接酒馆（loopback-network: ${permission}）：${diagnosis}`, { cause: error });
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `桥接请求失败（HTTP ${response.status}）`);
        return data;
    }

    function status(message, error = false) {
        const output = document.getElementById('uvu-bridge-status');
        if (output) {
            output.textContent = message;
            output.dataset.error = String(error);
        }
    }

    function eventId() {
        return globalThis.crypto?.randomUUID?.() || `uvu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function cleanText(value) { return globalThis.UvUBridgeText.clean(value, settings().excludeTags || ''); }

    function currentBridgeChat() {
        return typeof currentChatType !== 'undefined' && currentChatType === 'private'
            ? db.characters.find(item => item.id === currentChatId) : null;
    }

    function allowedMemory(chat, journal) {
        return journal.source !== 'sillytavern' || (isEnabled() && journal.isFavorited === true &&
            journal.bridgeReview?.status === 'approved' && journal.bridgeReview.items?.some(item => item.selected && item.text) &&
            settings().injectionByCharacter[String(chat.id)] !== false);
    }

    function messageRecords(chat, start = Math.max(0, (chat.history || []).length - 8), end = (chat.history || []).length) {
        return (chat.history || []).slice(start, end).map((message, index) => {
            if (!message || !['user', 'assistant'].includes(message.role) || message.isThinking || message.isHidden || message.isWithdrawn || message.isContextDisabled || message.isStatusUpdate || message.relationshipDelivery) return null;
            const text = cleanText(message.content || (message.parts || []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
            if (!text) return null;
            const stamp = Number(message.timestamp), known = Number.isFinite(stamp) && stamp > 0;
            const speaker = message.role === 'user' ? chat.myName || 'User' : chat.realName || chat.name || 'Character';
            return { id: String(message.id || ('legacy-' + (start + index) + '-' + globalThis.UvUBridgeText.fingerprint(text))),
                text: '[' + (known ? new Date(stamp).toISOString() : '时间未知') + ' | ' + speaker + ']\n' + text,
                createdAt: known ? stamp : 0 };
        }).filter(Boolean);
    }

    function isConnected() { return Boolean(readToken()); }

    async function pair() {
        const urlInput = document.getElementById('uvu-bridge-url');
        const codeInput = document.getElementById('uvu-bridge-pair-code');
        settings().baseUrl = (urlInput?.value || DEFAULT_URL).trim().replace(/\/+$/, '');
        let result;
        try {
            result = await request('/client/pair', { method: 'POST', body: { code: String(codeInput?.value || '').trim() }, auth: false });
        } catch (error) {
            await saveData().catch(() => {});
            throw error;
        }
        if (!result.token) throw new Error('酒馆未返回配对令牌。');
        saveToken(result.token);
        if (codeInput) codeInput.value = '';
        await publishCharacterDirectory(true);
        await saveData();
        status('已配对；默认记忆上下文不变。');
        const imported = await syncIncoming(currentChatType === 'private' ? currentChatId : '');
        if (!imported) status('已配对；酒馆收件箱目前没有新剧情。');
    }

    async function publishCharacterDirectory(force = false) {
        if (!isConnected()) return;
        const characters = (db.characters || []).filter(character => character?.id != null).map(character => ({
            id: String(character.id),
            name: String(character.realName || character.name || character.remarkName || '未命名角色').trim().slice(0, 120)
        }));
        const fingerprint = JSON.stringify(characters);
        if (!force && settings().characterDirectoryFingerprint === fingerprint) return;
        await request('/client/characters', { method: 'PUT', body: { characters } });
        settings().characterDirectoryFingerprint = fingerprint;
    }

    async function disconnect() {
        if (isConnected()) await request('/client/revoke', { method: 'POST', body: {} });
        saveToken('');
        status('已断开连接。');
    }

    async function getMode(characterKey) {
        return request(`/client/state?characterKey=${encodeURIComponent(String(characterKey || ''))}`);
    }

    async function flushOutbox() {
        if (!isEnabled() || sendBusy || !isConnected()) return;
        sendBusy = true;
        try {
            while (settings().outbox.length) {
                const event = settings().outbox[0];
                await request('/client/events', { method: 'POST', body: event });
                const key = event.characterKey + ':' + event.payload.archiveId;
                const sent = settings().sentMessages[key] || [];
                settings().sentMessages[key] = [...new Set([...sent, ...(event.payload.messages || []).map(item => item.sourceMessageId || item.id)])].slice(-1000);
                settings().outbox.shift();
                await saveData();
            }
        } finally { sendBusy = false; }
    }

    async function publishTurn(chat, mode, explicitRecords) {
        if (!isEnabled()) throw new Error('酒馆互通插件已停用，请先开启后再交接剧情。');
        const archiveId = String(chat.activeArchiveId || 'default');
        const key = String(chat.id) + ':' + archiveId;
        const sent = new Set([...(settings().sentMessages[key] || []), ...settings().outbox.filter(event => event.characterKey === String(chat.id) && event.payload.archiveId === archiveId).flatMap(event => event.payload.messages.map(item => item.sourceMessageId || item.id))]);
        const records = (explicitRecords || messageRecords(chat)).filter(item => !sent.has(item.id));
        if (!records.length) return flushOutbox();
        const events = [];
        // Bound each payload before transmission; IDs are stable within the durable outbox.
        for (const record of records) {
            const points = [...record.text], parts = [];
            for (let i = 0; i < points.length; i += 5000) parts.push(points.slice(i, i + 5000).join(''));
            parts.forEach((text, index) => events.push({ source: 'uvu', eventId: eventId(),
                kind: mode?.mode === 'phone' ? 'phone_exchange' : 'memory_packet', characterKey: String(chat.id), createdAt: Date.now(),
                payload: { title: explicitRecords ? '手动交接线上剧情' : 'UvU 线上聊天', archiveId,
                    messages: [{ ...record, sourceMessageId: record.id, id: record.id + (parts.length > 1 ? ':part-' + (index + 1) : ''),
                        ...(parts.length > 1 ? { messagePart: index + 1, messagePartCount: parts.length } : {}), text }], text }
            }));
        }
        if (settings().outbox.length + events.length > 500) throw new Error('待发送剧情超过 500 条，请先恢复连接重试。');
        settings().outbox.push(...events);
        await saveData();
        return flushOutbox();
    }

    async function verifyPart(text, hash) {
        if (!hash) return;
        if (!/^[a-f0-9]{64}$/i.test(hash) || !globalThis.crypto?.subtle) throw new Error('无法验证剧情校验值，请更新浏览器后重试。');
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        const actual = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== hash.toLowerCase()) throw new Error('剧情分段校验失败；未导入。');
    }

    function finishSceneIfReady(chat, sceneId, scene, journals) {
        if (scene.imported || !Array.from({ length: scene.partCount }, (_, index) => index + 1).every(part => Object.hasOwn(scene.parts, part))) return false;
        if (journals.some(item => item.externalSceneId === sceneId)) { scene.imported = true; return false; }
        if (scene.archiveId && scene.archiveId !== String(chat.activeArchiveId || 'default')) return false;
        const content = cleanText(Array.from({ length: scene.partCount }, (_, index) => scene.parts[index + 1]).join('\n\n'));
        if (!content) throw new Error('剧情过滤后为空，请回酒馆核对正文和排除标签。');
        const items = globalThis.UvUBridgeText.segments(content);
        journals.push({ id: 'st_scene_' + sceneId, externalSceneId: sceneId, source: 'sillytavern',
            title: (chat.realName || chat.remarkName || chat.name || '当前角色') + ' · ' + scene.title,
            content, range: { start: 0, end: 0 }, createdAt: scene.createdAt,
            chatId: chat.id, chatType: 'private', isFavorited: false,
            bridgeReview: { version: 1, status: 'pending', archiveId: String(chat.activeArchiveId || 'default'),
                sourceText: content, stCharacterKey: scene.stCharacterKey || '', items }
        });
        scene.imported = true;
        return true;
    }

    async function syncIncoming(characterKey = '') {
        if (!isEnabled() || !isConnected() || syncBusy || !characterKey || document.visibilityState !== 'visible') return 0;
        const chat = db.characters.find(item => String(item.id) === String(characterKey));
        if (!chat) return 0;
        syncBusy = true;
        const archiveId = chat.activeArchiveId, history = chat.history;
        const assertCurrent = () => {
            if (!db.characters.includes(chat) || chat.activeArchiveId !== archiveId || chat.history !== history) throw new Error('接收期间角色或存档已切换；未写入剧情，请返回原存档重试。');
        };
        const state = settings(), cursor = Number(state.cursorByCharacter[characterKey] || 0);
        let imported = 0, committed = false, addedIds = [];
        const previousScenes = state.pendingScenes, previousReceipts = state.receipts;
        const staged = structuredClone(previousScenes), receipts = { ...previousReceipts };
        try {
            const result = await request('/client/events?after=' + cursor + '&characterKey=' + encodeURIComponent(characterKey) + '&limit=100');
            assertCurrent();
            if (result.gapDetected) { status('桥接队列已有过期记录，不能确认剧情完整；请在酒馆重新导出。', true); return 0; }
            if ((result.events || []).some(item => String(item.characterKey) !== String(characterKey))) { status('收到角色 ID 不匹配的剧情，已停止导入。', true); return 0; }
            let nextCursor = cursor;
            for (const event of result.events || []) {
                nextCursor = Math.max(nextCursor, Number(event.seq) || 0);
                if (event.kind !== 'scene_transcript') continue;
                const payload = event.payload || {}, id = String(event.sceneId || ''), part = Number(payload.part), count = Number(payload.partCount);
                if (!id || !Number.isInteger(part) || !Number.isInteger(count) || count < 1 || count > 2000 || part < 1 || part > count || typeof payload.text !== 'string') throw new Error('酒馆剧情分段格式无效；未导入。');
                await verifyPart(payload.text, payload.partHash); assertCurrent();
                const key = String(characterKey) + ':' + id;
                if (receipts[key]) continue;
                const scene = staged[key] || (staged[key] = { characterKey: String(characterKey), title: String(payload.title || '酒馆线下剧情'), createdAt: Number(event.createdAt) || Date.now(), partCount: count, parts: {},
                    archiveId: String(payload.uvuArchiveId || ''), stCharacterKey: String(payload.stCharacterKey || '') });
                if (scene.partCount !== count || (scene.archiveId || '') !== String(payload.uvuArchiveId || '') || (scene.stCharacterKey || '') !== String(payload.stCharacterKey || '')) throw new Error('同一剧情的分段身份或总数不一致；未导入。');
                if (Object.hasOwn(scene.parts, part) && scene.parts[part] !== payload.text) throw new Error('同一剧情片段内容冲突；请回酒馆检查。');
                scene.parts[part] = payload.text;
            }
            assertCurrent();
            // Build once against a mutable draft so only complete, correctly targeted scenes enter journals.
            const draft = [...(chat.memoryJournals || [])];
            for (const [key, scene] of Object.entries(staged)) {
                if (!key.startsWith(String(characterKey) + ':') || receipts[key]) continue;
                scene.imported = false;
                const id = key.slice(String(characterKey).length + 1);
                if (finishSceneIfReady(chat, id, scene, draft)) imported++;
                if (scene.imported) { receipts[key] = { archiveId: String(archiveId || 'default'), at: Date.now() }; delete staged[key]; }
            }
            assertCurrent();
            const before = chat.memoryJournals || [], beforeIds = new Set(before.map(item => item.id));
            addedIds = draft.filter(item => !beforeIds.has(item.id)).map(item => item.id);
            if (!(result.events || []).length && !imported) return 0;
            chat.memoryJournals = draft; state.pendingScenes = staged; state.receipts = receipts; state.cursorByCharacter[characterKey] = nextCursor;
            try { await saveData(); committed = true; }
            catch (error) {
                if (chat.activeArchiveId === archiveId) chat.memoryJournals = (chat.memoryJournals || []).filter(item => !addedIds.includes(item.id));
                const archive = chat.archives?.find(item => item.id === archiveId);
                if (archive?.data?.memoryJournals) archive.data.memoryJournals = archive.data.memoryJournals.filter(item => !addedIds.includes(item.id));
                state.pendingScenes = previousScenes; state.receipts = previousReceipts; state.cursorByCharacter[characterKey] = cursor;
                throw error;
            }
            if (nextCursor > cursor) await request('/client/ack', { method: 'POST', body: { seq: nextCursor, characterKey } }).catch(error => console.warn('Bridge acknowledgement:', error.message));
            if (imported) status('已接收 ' + imported + ' 场剧情，请在下方审核；未勾选的内容不会进入上下文。');
            else status('已保存剧情分段；若目标是其他存档，请切回对应存档收取。');
            renderReview(); return imported;
        } finally { syncBusy = false; }
    }

    async function persistReview(chat, journal, items) {
        const archiveId = chat.activeArchiveId;
        const before = structuredClone(journal);
        const review = journal.bridgeReview || { version: 1, sourceText: journal.content, archiveId: String(archiveId || 'default') };
        const next = items.map(item => ({ id: String(item.id), text: cleanText(item.text), selected: item.selected === true }));
        const content = next.filter(item => item.selected && item.text).map(item => item.text).join('\n\n');
        journal.bridgeReview = { ...review, items: next, status: content ? 'approved' : 'pending' };
        journal.content = content || review.sourceText; journal.isFavorited = Boolean(content);
        try { await saveData(); }
        catch (error) {
            if (chat.activeArchiveId === archiveId && (chat.memoryJournals || []).includes(journal)) Object.assign(journal, before);
            const archived = chat.archives?.find(item => item.id === archiveId)?.data?.memoryJournals?.find(item => item.id === journal.id);
            if (archived) Object.assign(archived, before);
            throw error;
        }
    }

    function renderReview(force = false) {
        const host = document.getElementById('uvu-bridge-review-list');
        if (!host?.replaceChildren) return;
        const current = currentBridgeChat();
        const entries = [];
        for (const chat of (db.characters || [])) {
            for (const journal of (chat.memoryJournals || []).filter(item => item.source === 'sillytavern')) entries.push({ chat, journal });
        }
        const pending = Object.values(settings().pendingScenes).filter(item => item?.characterKey);
        const signature = JSON.stringify([
            current?.id, current?.activeArchiveId,
            entries.map(({ chat, journal }) => [chat.id, journal.id, journal.isFavorited, journal.bridgeReview?.status, journal.bridgeReview?.items?.length, journal.content]),
            pending.map(scene => [scene.characterKey, scene.title, scene.partCount, Object.keys(scene.parts || {}).length])
        ]);
        if (!force && signature === reviewSignature) return;
        if (!force && host.contains(document.activeElement)) return;
        reviewSignature = signature; host.replaceChildren();
        const gate = document.getElementById('uvu-bridge-inject-scenes'); if (gate && current) gate.checked = settings().injectionByCharacter[String(current.id)] !== false;
        const count = document.getElementById('uvu-bridge-review-count'); if (count) count.textContent = `${entries.length + pending.length} 项`;
        if (!entries.length && !pending.length) { host.textContent = '还没有收到酒馆线下剧情。结束并导出后点击“收取酒馆记忆”。'; return; }
        for (const { chat, journal } of entries) {
            const detail = document.createElement('details'), title = document.createElement('summary');
            const archiveName = chat.archives?.find(item => item.id === journal.bridgeReview?.archiveId)?.name || journal.bridgeReview?.archiveId || '默认存档';
            title.textContent = `${chat.realName || chat.name || chat.id} · ${archiveName} · ${journal.title} · ` + (journal.isFavorited && journal.bridgeReview?.status === 'approved' ? '已应用' : '待审核 / 已停用');
            const source = document.createElement('details'), sourceTitle = document.createElement('summary'), pre = document.createElement('pre');
            sourceTitle.textContent = '查看过滤后的完整原文（酒馆保留原始消息）'; pre.textContent = journal.bridgeReview?.sourceText || journal.content;
            source.append(sourceTitle, pre); detail.append(title, source);
            const items = structuredClone(journal.bridgeReview?.items || globalThis.UvUBridgeText.segments(journal.content));
            const list = document.createElement('div'); list.className = 'uvu-bridge-review-items';
            const fields = [];
            items.forEach(item => {
                const row = document.createElement('label'), check = document.createElement('input'), text = document.createElement('textarea');
                check.type = 'checkbox'; check.checked = item.selected; text.value = item.text;
                check.setAttribute('aria-label', '允许这条剧情加入上下文'); row.append(check, text); list.append(row); fields.push({ item, check, text });
            });
            const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-secondary'; save.textContent = '保存审核并加入日记';
            save.addEventListener('click', async () => {
                if (currentBridgeChat() !== chat || String(chat.activeArchiveId || 'default') !== String(journal.bridgeReview?.archiveId || chat.activeArchiveId || 'default')) return status('角色或存档已切换，请刷新审核列表。', true);
                if (reviewBusy) return; reviewBusy = true; save.disabled = true;
                try { await persistReview(chat, journal, fields.map(({item,check,text}) => ({ id:item.id,text:text.value,selected:check.checked }))); renderReview(true); status('已审核并保存到当前角色日记；只有勾选内容会进入后续上下文和向量候选。'); }
                catch (error) { status(error.message, true); }
                finally { reviewBusy = false; save.disabled = false; }
            });
            detail.append(list, save); host.append(detail);
        }
        for (const scene of pending) {
            const chat = db.characters.find(item => String(item.id) === String(scene.characterKey));
            const detail = document.createElement('details'), title = document.createElement('summary'), note = document.createElement('p');
            const complete = scene.partCount > 0 && Array.from({ length: scene.partCount }, (_, index) => index + 1).every(part => Object.hasOwn(scene.parts || {}, part));
            title.textContent = `${chat?.realName || chat?.name || scene.characterKey} · ${scene.title || '酒馆线下剧情'} · 待收取${complete ? '' : `（${Object.keys(scene.parts || {}).length}/${scene.partCount} 段）`}`;
            note.textContent = complete ? '剧情已完整接收，但目标存档与当前打开的存档不同；切换到对应角色和存档后点击“收取酒馆记忆”。' : '剧情尚未完整接收，暂不能加入日记；请回酒馆完成导出后再重试。';
            detail.append(title, note); host.append(detail);
        }
    }

    function renderHandoffCharacters() {
        const select = document.getElementById('uvu-bridge-handoff-character');
        if (!select?.replaceChildren) return;
        const selected=select.value || String(currentBridgeChat()?.id || ''); select.replaceChildren();
        for (const chat of db.characters) { const option=document.createElement('option');option.value=String(chat.id);option.textContent=chat.realName||chat.name||chat.id;select.append(option); }
        select.value=selected;
    }

    async function setSceneInjection(enabled) {
        const chat=currentBridgeChat(); if (!chat) throw new Error('请先打开对应角色私聊。');
        const key=String(chat.id), previous=settings().injectionByCharacter[key];
        settings().injectionByCharacter[key]=Boolean(enabled);
        try { await saveData(); } catch(error) { if(previous===undefined)delete settings().injectionByCharacter[key];else settings().injectionByCharacter[key]=previous;throw error; }
    }

    function setupUvUStoryBridge() {
        const urlInput = document.getElementById('uvu-bridge-url');
        const codeInput = document.getElementById('uvu-bridge-pair-code');
        const pairButton = document.getElementById('uvu-bridge-pair');
        const syncButton = document.getElementById('uvu-bridge-sync');
        const disconnectButton = document.getElementById('uvu-bridge-disconnect');
        const injectCheckbox = document.getElementById('uvu-bridge-inject-scenes');
        const enabledCheckbox = document.getElementById('uvu-bridge-enabled');
        if (!urlInput || !pairButton || pairButton.dataset.bound === 'true') return;
        urlInput.value = baseUrl();
        if (enabledCheckbox) {
            enabledCheckbox.checked = isEnabled();
            enabledCheckbox.addEventListener('change', async () => {
                settings().bridgeEnabled = enabledCheckbox.checked;
                await saveData();
                status(enabledCheckbox.checked ? '酒馆互通已启用。' : '酒馆互通已停用；原聊天、提示词和日记数据不受修改。');
                renderReview(true);
            });
        }
        injectCheckbox.checked = settings().injectionByCharacter[String(currentBridgeChat()?.id)] !== false;
        renderHandoffCharacters(); renderReview();
        status(isConnected() ? '已配对；正在连接本机酒馆。' : '未连接');
        if (isConnected()) publishCharacterDirectory().catch(error => status(`角色列表同步失败：${error.message}`, true));
        pairButton.dataset.bound = 'true';
        pairButton.addEventListener('click', async () => {
            pairButton.disabled = true;
            try { await pair(); }
            catch (error) { status(error.message, true); }
            finally { pairButton.disabled = false; }
        });
        syncButton.addEventListener('click', async () => {
            if (currentChatType !== 'private' || !currentChatId) return status('请先打开要同步的角色私聊。', true);
            syncButton.disabled = true;
            try {
                const imported = await syncIncoming(currentChatId);
                if (!imported) renderReview();
            }
            catch (error) { status(error.message, true); }
            finally { syncButton.disabled = false; }
        });
        disconnectButton.addEventListener('click', async () => {
            disconnectButton.disabled = true;
            try { await disconnect(); }
            catch (error) { status(error.message, true); }
            finally { disconnectButton.disabled = false; }
        });
        injectCheckbox.addEventListener('change', async () => {
            try {
                await setSceneInjection(injectCheckbox.checked);
                status(injectCheckbox.checked ? '当前角色允许使用已审核且已勾选的剧情。' : '当前角色酒馆记忆已暂停；原文和逐条选择保留。');
            } catch (error) { status(error.message, true); }
        });
        document.getElementById('uvu-bridge-handoff')?.addEventListener('click', async event => {
            const chat=db.characters.find(item=>String(item.id)===document.getElementById('uvu-bridge-handoff-character')?.value);
            if (!chat) return status('请选择要交接的角色。',true);
            const start=Number(document.getElementById('uvu-bridge-handoff-start').value), end=Number(document.getElementById('uvu-bridge-handoff-end').value);
            if (!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>(chat.history||[]).length) return status('请输入有效楼层范围（1 到当前存档消息总数）。',true);
            event.target.disabled=true;
            try { await publishTurn(chat,null,messageRecords(chat,start-1,end)); status('线上剧情已交接，请回酒馆刷新并审核勾选。'); }
            catch(error){status(error.message,true);}finally{event.target.disabled=false;}
        });
        document.getElementById('uvu-bridge-refresh-review')?.addEventListener('click',()=>{renderHandoffCharacters();renderReview(true);});
        clearInterval(pollTimer);
        pollTimer = setInterval(() => {
            if (!isEnabled()) return;
            renderReview();
            flushOutbox().catch(error=>console.warn('Bridge outbox:',error.message));
            publishCharacterDirectory().catch(error => console.warn('UvU Story Bridge character directory sync failed:', error.message));
            if (currentChatType === 'private' && currentChatId) syncIncoming(currentChatId).catch(error => status(error.message, true));
        }, 8000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && currentChatType === 'private' && currentChatId) {
                syncIncoming(currentChatId).catch(error => status(error.message, true));
            }
        });
    }

    window.UvUStoryBridge = { isEnabled, isConnected, getMode, publishTurn, publishCharacterDirectory, syncIncoming, allowedMemory, persistReview, renderReview, flushOutbox };
    window.setupUvUStoryBridge = setupUvUStoryBridge;
})();
