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
    const reviewDrafts = new Map();
    let generation = 0;
    let inboxBusy = false;
    let connection = {phase:'idle',failures:0,nextAttempt:0};
    let reconnecting = false;
    let pairingBusy = false;
    let automaticBusy = false;

    function settings() {
        db.uvuStoryBridgeSettings = db.uvuStoryBridgeSettings || {};
        const value = db.uvuStoryBridgeSettings;
        value.cursorByCharacter = value.cursorByCharacter || {};
        value.relayByCharacter = value.relayByCharacter || {};
        value.recoveryByCharacter = value.recoveryByCharacter || {};
        value.pendingScenes = value.pendingScenes || {};
        value.sentMessages = value.sentMessages || {};
        value.sentRevisions = value.sentRevisions || {};
        value.outbox = value.outbox || [];
        value.receipts = value.receipts || {};
        value.handoffReceipts = value.handoffReceipts || {};
        value.injectionByCharacter = value.injectionByCharacter || {};
        return value;
    }

    function isEnabled() { return settings().bridgeEnabled !== false; }

    function readToken() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').token || ''; }
        catch { return ''; }
    }

    function saveToken(token, device) {
        if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, baseUrl:baseUrl(), device }));
        else localStorage.removeItem(STORAGE_KEY);
        connection = {phase:token ? 'idle' : 'unpaired',failures:0,nextAttempt:0};
    }

    function bindTokenAddress(address) {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (stored.baseUrl && stored.baseUrl !== address) throw Object.assign(new Error('桥接地址已改变，原绑定只用于原地址。请恢复地址，或在新地址重新配对。'),{code:'ADDRESS_CHANGED'});
        if (!stored.baseUrl && stored.token) localStorage.setItem(STORAGE_KEY,JSON.stringify({...stored,baseUrl:address}));
    }

    function connectionSnapshot() { return {...connection}; }
    function connectionStatus(message) {
        const output=document.getElementById('uvu-bridge-connection');
        if (output) {output.textContent=message;output.dataset.phase=connection.phase;}
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
        const address = baseUrl();
        if (auth) bindTokenAddress(address);
        if (auth) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let response;
        const signal = AbortSignal.timeout(15000);
        const addressSpace = targetAddressSpace();
        try {
            response = await fetch(`${address}/v1${path}`, {
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
        if (!response.ok) {
            const help = { 401: '配对码无效或令牌失效，请重新配对', 403: '来源白名单、回环地址或接口权限不通过', 404: '接口不存在，请更新服务端并重启酒馆', 413: '剧情数据超过限制' };
            if (auth && response.status === 401 && token === readToken() && address === baseUrl()) {
                connection.phase='revoked';connection.nextAttempt=Infinity;
                connectionStatus('绑定凭证已失效或被解除，请重新配对；本机凭证尚未清除。');
            }
            throw Object.assign(new Error(`HTTP ${response.status} · ${help[response.status] || '桥接请求失败'}：${data.error || '未提供详细原因'}`),{status:response.status});
        }
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
    function selectedBridgeChat() {
        const id = document.getElementById('uvu-bridge-handoff-character')?.value;
        return db.characters.find(chat => String(chat.id) === id) || currentBridgeChat();
    }

    function allowedMemory(chat, journal) {
        return journal.source !== 'sillytavern' || (isEnabled() && journal.isFavorited === true &&
            journal.bridgeReview?.status === 'approved' && journal.bridgeReview.items?.some(item => item.selected && item.text) &&
            settings().injectionByCharacter[String(chat.id)] !== false);
    }

    function turnStart(chat) {
        const index = (chat.history || []).findLastIndex(message => message?.role === 'user');
        return Math.max(0, index);
    }

    function messageRecords(chat, start = turnStart(chat), end = (chat.history || []).length) {
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

    function latestHandoffRange(chat) {
        const history = chat.history || [];
        let start = 0, end = 0, count = 0;
        for (let i = history.length - 1; i >= 0 && count < 50; i--) {
            if (!messageRecords(chat, i, i + 1).length) continue;
            if (!end) end = i + 1;
            start = i + 1; count++;
        }
        return { start, end, count };
    }

    function updateHandoffRange(force = false) {
        const start = document.getElementById('uvu-bridge-handoff-start');
        const end = document.getElementById('uvu-bridge-handoff-end');
        const chat = selectedBridgeChat();
        if (!start || !end || !chat) return;
        const identity = String(chat.id) + ':' + String(chat.activeArchiveId || 'default');
        if (force || start.dataset.identity !== identity) start.dataset.manual = '';
        start.dataset.identity = identity;
        if (!start.dataset.manual) { const range = latestHandoffRange(chat); start.value = range.start || ''; end.value = range.end || ''; }
        const output = document.getElementById('uvu-bridge-handoff-source');
        if (output) {
            const archive = chat.archives?.find(item => item.id === chat.activeArchiveId);
            const latest = messageRecords(chat, Math.max(0, Number(end.value) - 1), Number(end.value))[0];
            output.textContent = `${chat.realName || chat.name || chat.id} · 当前存档：${archive?.name || '默认存档'}（${chat.activeArchiveId || 'default'}） · 共 ${(chat.history || []).length} 条消息 · 交接 ${start.value || 0}–${end.value || 0}；范围末条：${latest?.text.slice(-120) || '无有效正文'}`;
        }
    }

    function refreshHandoffContext() { renderHandoffCharacters(true); renderReview(true); }

    async function handoffCurrent() {
        const chat = selectedBridgeChat();
        if (!chat) throw new Error('请选择要交接的角色。');
        updateHandoffRange();
        const start = Number(document.getElementById('uvu-bridge-handoff-start')?.value), end = Number(document.getElementById('uvu-bridge-handoff-end')?.value);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > (chat.history || []).length) throw new Error('请输入有效楼层范围（1 到当前存档消息总数）。');
        const records = messageRecords(chat, start - 1, end);
        const transfer = { id: eventId(), at: Date.now(), start, end, count: records.length, totalMessages: (chat.history || []).length, latestMessageAt: records.at(-1)?.createdAt || 0 };
        return publishTurn(chat, null, records, transfer);
    }

    async function pair() {
        if (pairingBusy || reconnecting) throw new Error('连接操作正在进行，请稍候。');
        pairingBusy=true;
        try {
        const urlInput = document.getElementById('uvu-bridge-url');
        const codeInput = document.getElementById('uvu-bridge-pair-code');
        settings().baseUrl = (urlInput?.value || DEFAULT_URL).trim().replace(/\/+$/, '');
        const address=baseUrl(),epoch=++generation;
        let result;
        try {
            result = await request('/client/pair', { method: 'POST', body: { code: String(codeInput?.value || '').trim(), device:{name:String(document.getElementById('uvu-bridge-device-name')?.value || 'UvU 浏览器').trim().slice(0,80)} }, auth: false });
        } catch (error) {
            await saveData().catch(() => {});
            throw error;
        }
        if (!result.token) throw new Error('酒馆未返回配对令牌。');
        if (epoch!==generation || address!==baseUrl()) throw new Error('连接目标已改变，请核对地址后重新配对。');
        saveToken(result.token,result.device);
        if (codeInput) codeInput.value = '';
        await saveData();
        connectionStatus('已保存长期绑定；以后可自动重连。');
        status('配对成功，绑定已保存在当前浏览器。');
        try { await publishCharacterDirectory(true); await reconnect({force:true}); }
        catch(error) {status('绑定已保存，后续同步待重试：'+error.message,true);}
        } finally {pairingBusy=false;}
    }

    async function reconnect({force=false} = {}) {
        if (!isEnabled() || !isConnected() || document.visibilityState!=='visible' || reconnecting) return false;
        if (!force && (connection.phase==='revoked' || Date.now()<connection.nextAttempt)) return false;
        reconnecting=true;
        const token=readToken(),address=baseUrl(),epoch=generation;
        const current=()=>token===readToken() && address===baseUrl() && epoch===generation && isEnabled();
        try {
            connection.phase='connecting';connectionStatus('已绑定，正在连接酒馆…');
            let session;
            try {session=await request('/client/session');}
            catch(error) {if(error.status!==404)throw error;await request('/client/service');session={paired:true};}
            if (!current()) return false;
            if(session.paired!==true) throw new Error('服务端未确认绑定，请检查插件版本。');
            connection={phase:'connected',failures:0,nextAttempt:Date.now()+30000};
            connectionStatus('已绑定 · 已连接'+(session.device?.name ? ' · '+session.device.name : ''));
            return true;
        } catch(error) {
            if (!current()) return false;
            const failures=connection.failures+1;
            connection={phase:error.status===401?'revoked':error.code==='ADDRESS_CHANGED'?'address-changed':'waiting',failures,
                nextAttempt:error.status===401?Infinity:Date.now()+Math.min(120000,5000*2**Math.min(failures-1,5))};
            connectionStatus(connection.phase==='revoked'?'绑定已失效，请重新配对。':connection.phase==='address-changed'?error.message:'已绑定，等待酒馆连接；绑定已保留，将自动重试。');
            return false;
        } finally {reconnecting=false;}
    }

    async function automaticSync() {
        if (automaticBusy || pairingBusy || !isEnabled() || !isConnected() || document.visibilityState!=='visible') return;
        automaticBusy=true;
        const token=readToken(),address=baseUrl(),epoch=generation;
        const current=()=>token===readToken() && address===baseUrl() && epoch===generation && isEnabled();
        try {
            if (connection.phase!=='connected' || Date.now()>=connection.nextAttempt) {if(!await reconnect())return;}
            if (!current()) return;
            await publishCharacterDirectory();
            if (!current()) return;
            await flushOutbox();
            if (!current()) return;
            await syncInbox();
        } catch(error) {
            if (!current()) return;
            if (connection.phase!=='revoked') {connection.phase='waiting';connection.failures++;connection.nextAttempt=Date.now()+Math.min(120000,5000*2**Math.min(connection.failures-1,5));connectionStatus('已绑定，连接中断；绑定已保留，将自动重试。');}
            console.warn('UvU Bridge automatic sync:',error.message);
        } finally {automaticBusy=false;}
    }

    async function publishCharacterDirectory(force = false) {
        if (!isEnabled() || !isConnected()) return;
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
        let remoteError;
        try { if (isConnected()) await request('/client/revoke', { method: 'POST', body: {} }); } catch (error) { if(error.status!==401)remoteError = error; }
        if (remoteError && !confirm('无法确认服务端解绑。是否仅断开本机？服务端旧设备仍需在酒馆“已绑定设备”中解除。')) throw remoteError;
        saveToken(''); generation++;
        connectionStatus('本机已解除绑定。');
        status(remoteError ? '本机已断开；请在酒馆设备列表解除对应旧设备。' : '已解除当前设备绑定；其他设备继续有效。');
    }

    async function getMode(characterKey) {
        if (!isEnabled() || !isConnected()) return { mode: 'online' };
        const epoch = generation;
        const chat = db.characters.find(item => String(item.id) === String(characterKey));
        const archiveId = String(chat?.activeArchiveId || 'default');
        const mode = await request(`/client/state?characterKey=${encodeURIComponent(String(characterKey || ''))}`);
        if (!isEnabled() || generation !== epoch || mode.enabled === false || (mode.archiveId && mode.archiveId !== archiveId) || String(chat?.activeArchiveId || 'default') !== archiveId) return { mode: 'online' };
        return mode;
    }

    async function flushOutbox() {
        if (!isEnabled() || sendBusy || !isConnected()) return;
        sendBusy = true;
        try {
            while (isEnabled() && settings().outbox.length) {
                const batch = settings().outbox.slice(0, 10), acknowledged = [];
                let networkError;
                for (const event of batch) {
                    if (!isEnabled()) break;
                    try { await request('/client/events', { method: 'POST', body: event }); acknowledged.push(event); }
                    catch(error) { networkError = error; break; }
                }
                if (acknowledged.length) {
                    const oldSent = structuredClone(settings().sentMessages), oldRevisions = structuredClone(settings().sentRevisions);
                    const ids = new Set(acknowledged.map(event => event.eventId));
                    for (const event of acknowledged) {
                        const key = event.characterKey + ':' + event.payload.archiveId;
                        const sent = settings().sentMessages[key] || [], revisions = settings().sentRevisions[key] || {};
                        settings().sentMessages[key] = [...new Set([...sent, ...(event.payload.messages || []).map(item => item.sourceMessageId || item.id)])].slice(-1000);
                        for (const item of event.payload.messages || []) if (item.revision) revisions[item.sourceMessageId || item.id] = item.revision;
                        settings().sentRevisions[key] = Object.fromEntries(settings().sentMessages[key].filter(id => revisions[id]).map(id => [id, revisions[id]]));
                    }
                    settings().outbox = settings().outbox.filter(event => !ids.has(event.eventId));
                    try { await saveData(); }
                    catch(error) {
                        settings().sentMessages = oldSent; settings().sentRevisions = oldRevisions;
                        settings().outbox.unshift(...acknowledged);
                        throw error;
                    }
                }
                if (networkError) throw networkError;
            }
        } finally { sendBusy = false; }
    }

    async function publishTurn(chat, mode, explicitRecords, handoff) {
        if (!isEnabled()) throw new Error('酒馆互通插件已停用，请先开启后再交接剧情。');
        const archiveId = String(chat.activeArchiveId || 'default');
        const archiveName = String(chat.archives?.find(item => item.id === chat.activeArchiveId)?.name || '默认存档').slice(0, 160);
        const key = String(chat.id) + ':' + archiveId;
        const sent = new Set([...(settings().sentMessages[key] || []), ...settings().outbox.filter(event => event.characterKey === String(chat.id) && event.payload.archiveId === archiveId).flatMap(event => event.payload.messages.map(item => item.sourceMessageId || item.id))]);
        const queuedRecords = settings().outbox.filter(event => event.characterKey === String(chat.id) && event.payload.archiveId === archiveId).flatMap(event => event.payload.messages || []);
        const records = (explicitRecords || messageRecords(chat)).map(item => ({ ...item, revision: globalThis.UvUBridgeText.fingerprint(item.text) })).filter(item => {
            if (queuedRecords.some(record => (record.sourceMessageId || record.id) === item.id && record.revision === item.revision)) return false;
            // An explicit handoff is also recovery: a local sent ledger is not a receiver receipt.
            return explicitRecords ? true : settings().sentRevisions[key]?.[item.id] !== item.revision;
        });
        if (!records.length) { await flushOutbox(); return { queued: 0, pending: settings().outbox.length }; }
        const events = [];
        // Bound each payload before transmission; IDs are stable within the durable outbox.
        for (const record of records) {
            const points = [...record.text], parts = [];
            for (let i = 0; i < points.length; i += 5000) parts.push(points.slice(i, i + 5000).join(''));
            parts.forEach((text, index) => events.push({ source: 'uvu', eventId: eventId(),
                kind: mode?.mode === 'phone' ? 'phone_exchange' : 'memory_packet', characterKey: String(chat.id), createdAt: Date.now(),
                payload: { title: explicitRecords ? '手动交接线上剧情' : 'UvU 线上聊天', archiveId, archiveName, ...(handoff ? { handoff } : {}),
                    messages: [{ ...record, sourceMessageId: record.id, id: record.id + (parts.length > 1 ? ':part-' + (index + 1) : ''),
                        ...(parts.length > 1 ? { messagePart: index + 1, messagePartCount: parts.length } : {}), text }], text }
            }));
        }
        if (settings().outbox.length + events.length > 500) throw new Error('待发送剧情超过 500 条，请先恢复连接重试。');
        settings().outbox.push(...events);
        try { await saveData(); } catch(error) { const ids = new Set(events.map(event => event.eventId)); settings().outbox = settings().outbox.filter(event => !ids.has(event.eventId)); throw error; }
        await flushOutbox();
        return { queued: records.length, pending: settings().outbox.length, archiveId, archiveName, handoff };
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
        const items = scene.sceneFormat === 'floors-v1'
            ? globalThis.UvUBridgeText.floorItems(scene.parts, scene.floorParts)
            : globalThis.UvUBridgeText.legacyFloorItems(Array.from({ length: scene.partCount }, (_, index) => scene.parts[index + 1]).join('\n\n'));
        const content = globalThis.UvUBridgeText.memoryText(items.map(item => ({...item, selected: true})));
        if (!content) throw new Error('剧情过滤后为空，请回酒馆核对正文和排除标签。');
        journals.push({ id: 'st_scene_' + sceneId, externalSceneId: sceneId, source: 'sillytavern',
            title: (chat.realName || chat.remarkName || chat.name || '当前角色') + ' · ' + scene.title,
            content, range: { start: 0, end: 0 }, createdAt: scene.createdAt,
            chatId: chat.id, chatType: 'private', isFavorited: false,
            bridgeReview: { version: 2, sceneFormat: scene.sceneFormat || 'legacy', status: 'pending', archiveId: String(chat.activeArchiveId || 'default'),
                sourceText: content, stCharacterKey: scene.stCharacterKey || '', items }
        });
        scene.imported = true;
        return true;
    }

    async function syncIncoming(characterKey = '', pageBudget = 20, recover = false) {
        if (!isEnabled() || !isConnected() || syncBusy || !characterKey || document.visibilityState !== 'visible') return 0;
        const chat = db.characters.find(item => String(item.id) === String(characterKey));
        if (!chat) return 0;
        syncBusy = true;
        const epoch = generation;
        const archiveId = chat.activeArchiveId, history = chat.history;
        const assertCurrent = () => {
            if (!isEnabled() || epoch !== generation) throw new Error('互通已暂停，未应用旧请求的结果。');
            if (!db.characters.includes(chat) || chat.activeArchiveId !== archiveId || chat.history !== history) throw new Error('接收期间角色或存档已切换；未写入剧情，请返回原存档重试。');
        };
        const state = settings(), cursor = Number(state.cursorByCharacter[characterKey] || 0);
        let imported = 0, committed = false, addedIds = [];
        const previousScenes = state.pendingScenes, previousReceipts = state.receipts, previousHandoffs = state.handoffReceipts;
        const handoffs = {...previousHandoffs};
        let removedJournals = [];
        const staged = structuredClone(previousScenes), receipts = { ...previousReceipts };
        try {
            const result = { events: [], gapDetected: false };
            let pageCursor = recover ? 0 : cursor;
            for (let page = 0; page < pageBudget; page++) {
                const batch = await request('/client/events?after=' + pageCursor + '&characterKey=' + encodeURIComponent(characterKey) + '&limit=100');
                assertCurrent();
                result.relayId = batch.relayId || result.relayId;
                result.latestSeq = batch.latestSeq;
                const relayChanged = batch.relayId && state.relayByCharacter[characterKey] && batch.relayId !== state.relayByCharacter[characterKey];
                if (!recover && (relayChanged || (Number.isFinite(batch.latestSeq) && batch.latestSeq < cursor))) {
                    state.recoveryByCharacter[characterKey] = '桥接服务已重建，旧游标不适用';
                    status('桥接服务已重建，请点击“恢复收取”核对并恢复完整剧情。', true); return 0;
                }
                result.gapDetected = result.gapDetected || batch.gapDetected;
                const events = batch.events || []; result.events.push(...events);
                if (events.length < 100 || (batch.gapDetected && !recover)) break;
                const next = Math.max(...events.map(item => Number(item.seq) || 0));
                if (next <= pageCursor) throw new Error('桥接分页游标没有前进，请检查服务端版本。');
                pageCursor = next;
            }
            assertCurrent();
            if (result.gapDetected && !recover) { state.recoveryByCharacter[characterKey] = '队列有过期片段'; status('桥接队列已有过期记录，不能确认剧情完整；请重新导出后点击“恢复收取”，只恢复完整剧情。', true); return 0; }
            if (recover) for (const [key, scene] of Object.entries(staged)) if (scene.characterKey === String(characterKey) && !Array.from({length: scene.partCount || 0}, (_, index) => index + 1).every(part => Object.hasOwn(scene.parts || {}, part))) delete staged[key];
            if ((result.events || []).some(item => String(item.characterKey) !== String(characterKey))) { status('收到角色 ID 不匹配的剧情，已停止导入。', true); return 0; }
            let nextCursor = recover ? 0 : cursor;
            for (const event of result.events || []) {
                nextCursor = Math.max(nextCursor, Number(event.seq) || 0);
                if (event.kind === 'handoff_receipt') {
                    const payload = event.payload || {};
                    if (typeof payload.handoffId === 'string' && typeof payload.archiveId === 'string') handoffs[String(characterKey) + ':' + payload.handoffId] = {...payload, characterKey: String(characterKey)};
                    continue;
                }
                if (event.kind === 'scene_cancelled') {
                    const key = String(characterKey) + ':' + String(event.sceneId || '');
                    delete staged[key]; receipts[key] = { cancelled: true, at: Date.now() };
                    continue;
                }
                if (event.kind !== 'scene_transcript') continue;
                const payload = event.payload || {}, id = String(event.sceneId || ''), part = Number(payload.part), count = Number(payload.partCount);
                if (!id || !Number.isInteger(part) || !Number.isInteger(count) || count < 1 || count > 2000 || part < 1 || part > count || typeof payload.text !== 'string') throw new Error('酒馆剧情分段格式无效；未导入。');
                if (payload.sceneFormat && payload.sceneFormat !== 'floors-v1') throw new Error('不支持的剧情楼层格式，请更新 UvU。');
                if (payload.sceneFormat === 'floors-v1') globalThis.UvUBridgeText.validateFloor(payload.floor);
                await verifyPart(payload.text, payload.partHash); assertCurrent();
                const key = String(characterKey) + ':' + id;
                if (receipts[key]) continue;
                const scene = staged[key] || (staged[key] = { characterKey: String(characterKey), title: String(payload.title || '酒馆线下剧情'), createdAt: Number(event.createdAt) || Date.now(), partCount: count, parts: {},
                    archiveId: String(payload.uvuArchiveId || ''), stCharacterKey: String(payload.stCharacterKey || ''),
                    sceneFormat: payload.sceneFormat || '', floorParts: {} });
                if (scene.partCount !== count || (scene.archiveId || '') !== String(payload.uvuArchiveId || '') || (scene.stCharacterKey || '') !== String(payload.stCharacterKey || '')) throw new Error('同一剧情的分段身份或总数不一致；未导入。');
                if ((scene.sceneFormat || '') !== (payload.sceneFormat || '')) throw new Error('同一剧情的楼层格式不一致；未导入。');
                if (Object.hasOwn(scene.parts, part) && scene.parts[part] !== payload.text) throw new Error('同一剧情片段内容冲突；请回酒馆检查。');
                if (payload.sceneFormat === 'floors-v1') {
                    if (scene.floorParts[part] && JSON.stringify(scene.floorParts[part]) !== JSON.stringify(payload.floor)) throw new Error('同一剧情的楼层信息冲突；未导入。');
                    scene.floorParts[part] = structuredClone(payload.floor);
                }
                scene.parts[part] = payload.text;
            }
            assertCurrent();
            // Build once against a mutable draft so only complete, correctly targeted scenes enter journals.
            const draft = (chat.memoryJournals || []).filter(item => !(item.source === 'sillytavern' && receipts[String(characterKey) + ':' + item.externalSceneId]?.cancelled && item.bridgeReview?.status !== 'approved'));
            for (const [key, scene] of Object.entries(staged)) {
                if (!key.startsWith(String(characterKey) + ':') || receipts[key]) continue;
                scene.imported = false;
                const id = key.slice(String(characterKey).length + 1);
                if (finishSceneIfReady(chat, id, scene, draft)) imported++;
                if (scene.imported) { receipts[key] = { archiveId: String(archiveId || 'default'), at: Date.now() }; delete staged[key]; }
            }
            assertCurrent();
            const before = chat.memoryJournals || [], beforeIds = new Set(before.map(item => item.id));
            removedJournals = before.filter(item => !draft.includes(item));
            addedIds = draft.filter(item => !beforeIds.has(item.id)).map(item => item.id);
            if (!(result.events || []).length && !imported && !removedJournals.length) return 0;
            chat.memoryJournals = draft; state.handoffReceipts = Object.fromEntries(Object.entries(handoffs).slice(-60)); state.pendingScenes = staged; state.receipts = receipts; state.cursorByCharacter[characterKey] = nextCursor;
            const oldRelay = state.relayByCharacter[characterKey];
            if (result.relayId) state.relayByCharacter[characterKey] = result.relayId;
            try { await saveData(); committed = true; delete state.recoveryByCharacter[characterKey]; }
            catch (error) {
                if (chat.activeArchiveId === archiveId) chat.memoryJournals = (chat.memoryJournals || []).filter(item => !addedIds.includes(item.id));
                if (chat.activeArchiveId === archiveId) for (const item of removedJournals) if (!chat.memoryJournals.some(entry => entry.id === item.id)) chat.memoryJournals.push(item);
                const archive = chat.archives?.find(item => item.id === archiveId);
                if (archive?.data?.memoryJournals) archive.data.memoryJournals = archive.data.memoryJournals.filter(item => !addedIds.includes(item.id));
                if (archive?.data?.memoryJournals) for (const item of removedJournals) if (!archive.data.memoryJournals.some(entry => entry.id === item.id)) archive.data.memoryJournals.push(structuredClone(item));
                state.handoffReceipts = previousHandoffs; state.pendingScenes = previousScenes; state.receipts = previousReceipts; state.cursorByCharacter[characterKey] = cursor;
                if (oldRelay === undefined) delete state.relayByCharacter[characterKey]; else state.relayByCharacter[characterKey] = oldRelay;
                throw error;
            }
            if (nextCursor > cursor) await request('/client/ack', { method: 'POST', body: { seq: nextCursor, characterKey } }).catch(error => console.warn('Bridge acknowledgement:', error.message));
            if (imported) status('已接收 ' + imported + ' 场剧情，请在下方审核；未勾选的内容不会进入上下文。');
            else status((result.events || []).some(event => event.kind === 'handoff_receipt') ? '已更新酒馆接收回执，请核对交接状态。' : '已保存剧情分段；若目标是其他存档，请切回对应存档收取。');
            renderReview(); return imported;
        } finally { syncBusy = false; }
    }

    async function persistReview(chat, journal, items) {
        if (settings().receipts[String(chat.id) + ':' + journal.externalSceneId]?.cancelled && journal.bridgeReview?.status !== 'approved') throw new Error('本场导出已在酒馆取消，未加入日记。');
        if (!(chat.memoryJournals || []).includes(journal) || String(chat.activeArchiveId || 'default') !== String(journal.bridgeReview?.archiveId || chat.activeArchiveId || 'default')) throw new Error('审核目标存档已切换，请打开原存档后重试。');
        const archiveId = chat.activeArchiveId;
        const before = structuredClone(journal);
        const review = journal.bridgeReview || { version: 1, sourceText: journal.content, archiveId: String(archiveId || 'default') };
        const legacyItems = review.version !== 2 ? globalThis.UvUBridgeText.legacyFloorItems(review.sourceText || journal.content) : [];
        const next = items.map(item => {
            const original = review.items?.find(entry => String(entry.id) === String(item.id)) || legacyItems.find(entry => entry.id === String(item.id));
            return {id: String(item.id), text: review.version === 2 || original?.floor
                ? String(item.text || '').replace(/\r\n/g, '\n').trim() : cleanText(item.text), selected: item.selected === true,
                ...(original?.floor ? {floor: structuredClone(original.floor)} : {})};
        });
        const content = globalThis.UvUBridgeText.memoryText(next);
        journal.bridgeReview = { ...review, version: 2, items: next, status: content ? 'approved' : 'pending' };
        journal.content = content || review.sourceText; journal.isFavorited = Boolean(content);
        if (content) { journal.category ||= '酒馆线下剧情'; journal.timeline ||= new Date(journal.createdAt || Date.now()).toISOString().slice(0, 10); }
        try { await saveData(); }
        catch (error) {
            if (chat.activeArchiveId === archiveId && (chat.memoryJournals || []).includes(journal)) { for (const key of Object.keys(journal)) if (!Object.hasOwn(before, key)) delete journal[key]; Object.assign(journal, before); }
            const archived = chat.archives?.find(item => item.id === archiveId)?.data?.memoryJournals?.find(item => item.id === journal.id);
            if (archived) { for (const key of Object.keys(archived)) if (!Object.hasOwn(before, key)) delete archived[key]; Object.assign(archived, before); }
            throw error;
        }
    }

    function renderReview(force = false) {
        const host = document.getElementById('uvu-bridge-review-list');
        if (!host?.replaceChildren) return;
        const current = selectedBridgeChat();
        const receiptOutput = document.getElementById('uvu-bridge-handoff-receipt');
        const receipt = Object.values(settings().handoffReceipts).filter(item => item.characterKey === String(current?.id)).sort((a,b) => (Number(b.at)||0)-(Number(a.at)||0))[0];
        if (receiptOutput && current) receiptOutput.textContent = receipt
            ? `酒馆回执 · ${receipt.archiveId} · 交接 ${receipt.handoffId}：预期 ${receipt.expected} 条 / 已保留 ${receipt.retained} 条 / 已审核 ${receipt.reviewed} 条 / 删除跳过 ${receipt.deleted} 条；${receipt.incomplete ? '尚不完整，请回酒馆核对或重新交接' : '接收已核对'}。${new Date(receipt.at).toLocaleString()}`
            : '暂无酒馆接收回执；“服务已接收”只表示进入桥接队列，请到酒馆刷新、审核并保存。';
        const entries = [];
        for (const chat of (db.characters || [])) {
            for (const journal of (chat.memoryJournals || []).filter(item => item.source === 'sillytavern')) entries.push({ chat, journal });
            for (const archive of chat.archives || []) {
                if (archive.id === chat.activeArchiveId) continue;
                for (const journal of (archive.data?.memoryJournals || []).filter(item => item.source === 'sillytavern')) entries.push({ chat, journal, archived: archive.id });
            }
        }
        const pending = Object.values(settings().pendingScenes).filter(item => item?.characterKey);
        const draftKey = (chat, journal, archived) => JSON.stringify([String(chat.id), String(archived || chat.activeArchiveId || 'default'), String(journal.id)]);
        const liveDrafts = new Set(entries.map(({chat, journal, archived}) => draftKey(chat, journal, archived)));
        for (const key of reviewDrafts.keys()) if (!liveDrafts.has(key)) reviewDrafts.delete(key);
        const signature = JSON.stringify([
            current?.id, current?.activeArchiveId,
            entries.map(({ chat, journal, archived }) => [chat.id, chat.activeArchiveId, archived, journal.id, journal.isFavorited, journal.bridgeReview?.status, journal.bridgeReview?.items?.length, journal.content]),
            pending.map(scene => [scene.characterKey, scene.title, scene.partCount, Object.keys(scene.parts || {}).length])
        ]);
        if (!force && signature === reviewSignature) return;
        if (!force && host.contains(document.activeElement)) return;
        reviewSignature = signature; host.replaceChildren();
        const gate = document.getElementById('uvu-bridge-inject-scenes'); if (gate && current) gate.checked = settings().injectionByCharacter[String(current.id)] !== false;
        const count = document.getElementById('uvu-bridge-review-count'); if (count) count.textContent = `${entries.length + pending.length} 项`;
        if (!entries.length && !pending.length) { host.textContent = '还没有收到酒馆线下剧情。结束并导出后点击“收取酒馆记忆”。'; return; }
        for (const { chat, journal, archived } of entries) {
            const detail = document.createElement('details'), title = document.createElement('summary');
            const archiveName = chat.archives?.find(item => item.id === journal.bridgeReview?.archiveId)?.name || journal.bridgeReview?.archiveId || '默认存档';
            title.textContent = `${chat.realName || chat.name || chat.id} · ${archiveName} · ${journal.title} · ` + (journal.isFavorited && journal.bridgeReview?.status === 'approved' ? '已应用' : '待审核 / 已停用');
            const source = document.createElement('details'), sourceTitle = document.createElement('summary'), pre = document.createElement('pre');
            sourceTitle.textContent = '查看过滤后的完整原文（酒馆保留原始消息）'; pre.textContent = journal.bridgeReview?.sourceText || journal.content;
            source.append(sourceTitle, pre); detail.append(title, source);
            if (archived) {
                const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-secondary'; open.textContent = '打开此角色的原存档审核';
                open.addEventListener('click', async () => {
                    open.disabled = true;
                    try { openChatRoom(chat.id, 'private'); await switchChatArchive(archived); switchScreen('uvu-story-bridge-screen'); renderReview(true); }
                    catch (error) { status('打开原存档失败：' + error.message, true); }
                    finally { open.disabled = false; }
                });
                detail.append(open); host.append(detail); continue;
            }
            const originalItems = journal.bridgeReview?.items || globalThis.UvUBridgeText.segments(journal.content);
            const key = draftKey(chat, journal), sourceSignature = JSON.stringify(originalItems);
            let draft = reviewDrafts.get(key);
            if (!draft || draft.sourceSignature !== sourceSignature) {
                draft = {sourceSignature, items: structuredClone(originalItems)};
                reviewDrafts.set(key, draft);
            }
            const items = draft.items;
            detail.open = draft.expanded === true;
            detail.addEventListener('toggle', () => {draft.expanded = detail.open;});
            const toolbar = document.createElement('div'); toolbar.className = 'uvu-bridge-review-toolbar';
            const selectLabel = document.createElement('label'), selectAll = document.createElement('input'), selectedCount = document.createElement('span');
            selectAll.type = 'checkbox'; selectAll.setAttribute('aria-label', '全选本场剧情');
            const selectText = document.createElement('span'); selectText.textContent = '全选';
            selectLabel.append(selectAll, selectText);
            toolbar.append(selectLabel, selectedCount);
            const list = document.createElement('div'); list.className = 'uvu-bridge-review-items';
            const fields = [];
            const updateSelection = () => {
                const selected = items.filter(item => item.selected).length;
                selectAll.checked = items.length > 0 && selected === items.length;
                selectAll.indeterminate = selected > 0 && selected < items.length;
                selectedCount.textContent = '已选 ' + selected + ' / ' + items.length + ' 层';
            };
            selectAll.addEventListener('change', () => {
                for (const {item, check} of fields) {item.selected = selectAll.checked; check.checked = item.selected;}
                updateSelection();
            });
            items.forEach(item => {
                const row = document.createElement('div'), check = document.createElement('input'), text = document.createElement('textarea');
                row.className = 'uvu-bridge-review-row';
                const floorDetail = document.createElement('details'), floorTitle = document.createElement('summary');
                floorDetail.className = 'uvu-bridge-review-floor';
                floorDetail.open = item.expanded === true;
                floorDetail.addEventListener('toggle', () => {item.expanded = floorDetail.open;});
                const floor = item.floor;
                floorTitle.textContent = (floor?.number ? '第 ' + floor.number + ' 层' : '原文记录') +
                    (floor?.speaker ? ' · ' + floor.speaker : '') + ' · ' + item.text.replace(/\s+/g, ' ').slice(0, 56);
                check.type = 'checkbox'; check.checked = item.selected; text.value = item.text;
                text.setAttribute('aria-label', '编辑整层剧情');
                check.addEventListener('change', () => { item.selected = check.checked; updateSelection(); });
                text.addEventListener('input', () => { item.text = text.value; });
                const note = document.createElement('p'); note.className = 'uvu-bridge-review-help';
                note.textContent = floor?.extraction === 'tagged' ? '正文标签：' + floor.bodyTag + '；可编辑本层文字。'
                    : '未匹配正文标签或来自旧版导出，请核对是否残留状态栏、小剧场等内容。';
                floorDetail.append(floorTitle, note, text);
                check.setAttribute('aria-label', '允许这条剧情加入上下文'); row.append(check, floorDetail); list.append(row); fields.push({ item, check, text });
            });
            updateSelection();
            const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-secondary'; save.textContent = '保存审核并加入记忆';
            save.addEventListener('click', async () => {
                if (!(chat.memoryJournals || []).includes(journal) || String(chat.activeArchiveId || 'default') !== String(journal.bridgeReview?.archiveId || chat.activeArchiveId || 'default')) return status('目标存档已切换，请打开原存档后审核。', true);
                if (JSON.stringify(journal.bridgeReview?.items || globalThis.UvUBridgeText.segments(journal.content)) !== sourceSignature) return status('原文已更新，请刷新后重新审核。', true);
                if (reviewBusy) return; reviewBusy = true; save.disabled = true;
                try { await persistReview(chat, journal, fields.map(({item,check,text}) => ({ id:item.id,text:text.value,selected:check.checked }))); reviewDrafts.delete(key); renderReview(true); status('已审核并保存到当前角色日记 / 记忆管理；只有勾选内容通过原有记忆开关参与后续上下文和向量候选。'); }
                catch (error) { status(error.message, true); }
                finally { reviewBusy = false; save.disabled = false; }
            });
            if (journal.bridgeReview?.version !== 2 && journal.bridgeReview?.status !== 'approved') {
                const regroup = document.createElement('button'); regroup.type = 'button'; regroup.className = 'btn btn-secondary'; regroup.textContent = '按旧原文重新整理楼层';
                regroup.addEventListener('click', () => {
                    if (!confirm('重新整理会替换本场未保存的编辑与勾选，保存前不影响已有记忆。旧版已删除的正文标签无法恢复。继续？')) return;
                    draft.items = globalThis.UvUBridgeText.legacyFloorItems(journal.bridgeReview?.sourceText || journal.content);
                    renderReview(true);
                });
                toolbar.append(regroup);
            }
            detail.append(toolbar, list, save); host.append(detail);
        }
        for (const scene of pending) {
            const chat = db.characters.find(item => String(item.id) === String(scene.characterKey));
            const detail = document.createElement('details'), title = document.createElement('summary'), note = document.createElement('p');
            const complete = scene.partCount > 0 && Array.from({ length: scene.partCount }, (_, index) => index + 1).every(part => Object.hasOwn(scene.parts || {}, part));
            title.textContent = `${chat?.realName || chat?.name || scene.characterKey} · ${scene.title || '酒馆线下剧情'} · 待收取${complete ? '' : `（${Object.keys(scene.parts || {}).length}/${scene.partCount} 段）`}`;
            note.textContent = complete ? '剧情已完整接收，但目标存档与当前打开的存档不同；切换到对应角色和存档后点击“收取酒馆记忆”。' : '剧情尚未完整接收，暂不能加入日记；请回酒馆完成导出后再重试。';
            detail.append(title, note); host.append(detail);
            if (complete && chat) {
                const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-secondary'; open.textContent = '打开目标存档并收取';
                open.addEventListener('click', async () => {
                    open.disabled = true;
                    try {
                        if (scene.archiveId && scene.archiveId !== String(chat.activeArchiveId || 'default') && !chat.archives?.some(item => item.id === scene.archiveId)) throw new Error('目标存档不存在，请保留草稿并核对备份。');
                        openChatRoom(chat.id, 'private');
                        if (scene.archiveId && scene.archiveId !== String(chat.activeArchiveId || 'default')) await switchChatArchive(scene.archiveId);
                        await syncIncoming(chat.id); switchScreen('uvu-story-bridge-screen'); renderReview(true);
                    } catch (error) { status(error.message, true); } finally { open.disabled = false; }
                });
                detail.append(open);
            }
        }
    }

    function renderHandoffCharacters(followCurrent = false) {
        const select = document.getElementById('uvu-bridge-handoff-character');
        if (!select?.replaceChildren) return;
        const selected=(followCurrent ? String(currentBridgeChat()?.id || '') : '') || select.value || String(currentBridgeChat()?.id || ''); select.replaceChildren();
        for (const chat of db.characters) { const option=document.createElement('option');option.value=String(chat.id);option.textContent=chat.realName||chat.name||chat.id;select.append(option); }
        select.value=db.characters.some(chat=>String(chat.id)===selected) ? selected : String(db.characters[0]?.id || '');
        updateHandoffRange();
    }

    async function syncInbox(recover = false) {
        if (!isEnabled() || !isConnected() || inboxBusy || document.visibilityState !== 'visible') return 0;
        inboxBusy = true;
        try {
            let imported = 0;
            // Receive from the global queue without coupling delivery to the open chat.
            const snapshot = await request('/client/inbox');
            const keys = new Set((snapshot.characters || []).filter(item => (recover || (snapshot.relayId && snapshot.relayId !== settings().relayByCharacter[item.characterKey]) || Number(item.latestSeq) > Number(settings().cursorByCharacter[item.characterKey] || 0))).map(item => String(item.characterKey)));
            for (const scene of Object.values(settings().pendingScenes)) if (scene?.characterKey) keys.add(String(scene.characterKey));
            const selected = document.getElementById('uvu-bridge-handoff-character')?.value;
            if (selected) keys.add(selected);
            for (const key of keys) { if (!isEnabled()) break; try { imported += await syncIncoming(key, 20, recover); } catch (error) { status(key + '：' + error.message, true); } }
            renderReview();
            return imported;
        } finally { inboxBusy = false; }
    }

    async function setSceneInjection(enabled) {
        const chat=selectedBridgeChat(); if (!chat) throw new Error('请先在交接角色列表选择角色。');
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
                const previous = settings().bridgeEnabled; settings().bridgeEnabled = enabledCheckbox.checked;
                generation++; enabledCheckbox.disabled = true;
                try { await saveData(); } catch(error) { settings().bridgeEnabled = previous; enabledCheckbox.checked = previous !== false; status('互通开关保存失败：' + error.message, true); return; } finally { enabledCheckbox.disabled = false; }
                status(enabledCheckbox.checked ? '酒馆互通已启用。' : '酒馆互通已停用；原聊天、提示词和日记数据不受修改。');
                renderReview(true);
            });
        }
        injectCheckbox.checked = settings().injectionByCharacter[String(selectedBridgeChat()?.id)] !== false;
        renderHandoffCharacters(); renderReview();
        const screen = document.getElementById('uvu-story-bridge-screen');
        if (screen && typeof MutationObserver === 'function') {
            let wasActive = screen.classList.contains('active');
            new MutationObserver(() => {
                const active = screen.classList.contains('active');
                if (active && !wasActive) refreshHandoffContext();
                wasActive = active;
            }).observe(screen, { attributes: true, attributeFilter: ['class'] });
        }
        document.getElementById('uvu-bridge-use-current')?.addEventListener('click', refreshHandoffContext);
        document.getElementById('uvu-bridge-handoff-character')?.addEventListener('change', () => { updateHandoffRange(true); renderReview(true); });
        for (const id of ['uvu-bridge-handoff-start', 'uvu-bridge-handoff-end']) document.getElementById(id)?.addEventListener('input', () => { document.getElementById('uvu-bridge-handoff-start').dataset.manual = 'true'; });
        document.getElementById('uvu-bridge-latest')?.addEventListener('click', () => updateHandoffRange(true));
        status(isConnected() ? '已配对；正在连接本机酒馆。' : '未连接');
        if (isConnected()) automaticSync();
        pairButton.dataset.bound = 'true';
        pairButton.addEventListener('click', async () => {
            pairButton.disabled = true;
            try { await pair(); }
            catch (error) { status(error.message, true); }
            finally { pairButton.disabled = false; }
        });
        syncButton.addEventListener('click', async () => {
            syncButton.disabled = true;
            try {
                const imported = await syncInbox();
                if (!imported) { renderReview(); status('收件箱已检查。暂无可加入当前存档的新完整剧情；其他存档和未完成分段见下方清单。'); }
            }
            catch (error) { status(error.message, true); }
            finally { syncButton.disabled = false; }
        });
        document.getElementById('uvu-bridge-recover')?.addEventListener('click', async event => {
            if (!confirm('从服务端保留的队列重新核对，只收取完整剧情；缺失片段无法恢复，请先在酒馆完成导出。已有日记保留。继续？')) return;
            event.target.disabled = true;
            try { await syncInbox(true); renderReview(true); } catch (error) { status(error.message, true); }
            finally { event.target.disabled = false; }
        });
        disconnectButton.addEventListener('click', async () => {
            if (pairingBusy) return status('配对尚未完成，请稍候。',true);
            disconnectButton.disabled = true;
            try { await disconnect(); }
            catch (error) { status(error.message, true); }
            finally { disconnectButton.disabled = false; }
        });
        document.getElementById('uvu-bridge-reconnect')?.addEventListener('click', async event => {
            if (pairingBusy) return status('配对尚未完成，请稍候。',true);
            if (!isConnected()) return status('请先输入配对码完成首次绑定。',true);
            event.target.disabled=true;
            try {if(await reconnect({force:true}))await automaticSync();}
            finally {event.target.disabled=false;}
        });
        injectCheckbox.addEventListener('change', async () => {
            try {
                await setSceneInjection(injectCheckbox.checked);
                status(injectCheckbox.checked ? '当前角色允许使用已审核且已勾选的剧情。' : '当前角色酒馆记忆已暂停；原文和逐条选择保留。');
            } catch (error) { injectCheckbox.checked = settings().injectionByCharacter[String(selectedBridgeChat()?.id)] !== false; status(error.message, true); }
        });
        document.getElementById('uvu-bridge-handoff')?.addEventListener('click', async event => {
            event.target.disabled=true;
            try {
                const result = await handoffCurrent();
                status(result.pending ? `本次重新交接 ${result.queued} 条，仍有 ${result.pending} 个分段待发送，请保持页面打开并恢复连接。` : result.queued ? `已向桥接服务重新交接 ${result.queued} 条正文（包含此前发送过的内容）；请回酒馆点“刷新线上存档”，审核后保存，相同正文不会重复添加。` : '本次没有新入队正文；可能已有相同内容正在发送。若所选范围只有隐藏、状态或思考记录，请选择包含可用聊天正文的范围。');
                if (result.archiveId) status(`${result.archiveName}（${result.archiveId}）· 范围 ${result.handoff.start}–${result.handoff.end} · ${result.queued} 条正文；${result.pending ? `尚有 ${result.pending} 个分段待发送` : '服务已接收，请回酒馆刷新并核对当前交接存档'}。`);
            }
            catch(error){status(error.message,true);}finally{event.target.disabled=false;}
        });
        document.getElementById('uvu-bridge-refresh-review')?.addEventListener('click',()=>{renderHandoffCharacters();renderReview(true);});
        clearInterval(pollTimer);
        pollTimer = setInterval(() => {
            if (!isEnabled()) return;
            updateHandoffRange();
            renderReview();
            automaticSync();
        }, 8000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                automaticSync();
            }
        });
    }

    window.UvUStoryBridge = { reconnect, connectionSnapshot, isEnabled, isConnected, getMode, publishTurn, messageRecords, turnStart, latestHandoffRange, refreshHandoffContext, handoffCurrent, publishCharacterDirectory, syncIncoming, syncInbox, allowedMemory, persistReview, renderReview, flushOutbox };
    window.setupUvUStoryBridge = setupUvUStoryBridge;
})();
