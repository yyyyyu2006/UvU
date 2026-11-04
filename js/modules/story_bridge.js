// Optional local relay for SillyTavern continuity memories.
(function () {
    const STORAGE_KEY = 'uvu-story-bridge.v1';
    const DEFAULT_URL = 'http://127.0.0.1:8000/api/plugins/uvu-story-bridge';
    let syncBusy = false;
    let pollTimer = null;

    function settings() {
        db.uvuStoryBridgeSettings = db.uvuStoryBridgeSettings || {};
        const value = db.uvuStoryBridgeSettings;
        value.cursorByCharacter = value.cursorByCharacter || {};
        value.pendingScenes = value.pendingScenes || {};
        return value;
    }

    function readToken() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').token || ''; }
        catch { return ''; }
    }

    function saveToken(token) {
        if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token }));
        else localStorage.removeItem(STORAGE_KEY);
    }

    function baseUrl() {
        return String(settings().baseUrl || DEFAULT_URL).trim().replace(/\/+$/, '');
    }

    function targetAddressSpace() {
        try {
            const hostname = new URL(baseUrl()).hostname.toLowerCase();
            if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || /^127\./.test(hostname)) return 'loopback';
            if (hostname.endsWith('.local') || /^(10\.|192\.168\.|169\.254\.)/.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return 'local';
        } catch {}
        return undefined;
    }

    async function request(path, { method = 'GET', body, auth = true } = {}) {
        const headers = { Accept: 'application/json' };
        const token = readToken();
        if (auth && !token) throw new Error('尚未配对酒馆桥接服务。');
        if (auth) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let response;
        try {
            const addressSpace = targetAddressSpace();
            response = await fetch(`${baseUrl()}/v1${path}`, {
                method, headers, body: body === undefined ? undefined : JSON.stringify(body),
                ...(addressSpace ? { targetAddressSpace: addressSpace } : {})
            });
        } catch (error) {
            throw new Error('浏览器未能连接酒馆：请允许此网站访问本地网络，并确认酒馆桥接配置已允许当前 UvU 网站来源。', { cause: error });
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

    function cleanText(value) {
        return String(value || '')
            .replace(/<(thinking|think|analysis|reasoning|cot|status|statusbar|status_panel)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
            .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[图片略]')
            .replace(/\[图片数据:[\s\S]*?\]/gi, '[图片略]')
            .trim();
    }

    function turnText(chat) {
        const entries = (chat.history || []).filter(message =>
            message && ['user', 'assistant'].includes(message.role) &&
            !message.isThinking && !message.isWithdrawn && !message.isContextDisabled &&
            !message.isStatusUpdate && !(message.content || '').trim().startsWith('<thinking>')
        ).slice(-8).map(message => {
            const text = cleanText(message.content);
            return text ? `[${message.role === 'user' ? (chat.myName || 'User') : (chat.realName || chat.name || 'Character')} | ${new Date(message.timestamp || 0).toISOString()}]\n${text}` : '';
        }).filter(Boolean).join('\n\n');
        return entries.slice(-10000);
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

    async function publishTurn(chat, mode) {
        const text = turnText(chat);
        if (!text) return;
        const last = [...(chat.history || [])].reverse().find(message => message?.role === 'assistant' && !message.isThinking && !message.isWithdrawn);
        if (!last) return;
        await request('/client/events', {
            method: 'POST',
            body: {
                source: 'uvu', eventId: `uvu-turn-${last.id || eventId()}`,
                kind: mode?.mode === 'phone' ? 'phone_exchange' : 'memory_packet',
                characterKey: String(chat.id),
                createdAt: Number(last.timestamp) || Date.now(),
                payload: { title: mode?.mode === 'phone' ? 'UvU 手机消息' : 'UvU 线上聊天', text }
            }
        });
    }

    function finishSceneIfReady(chat, sceneId, scene) {
        const partCount = Math.max(1, Number(scene.partCount) || 1);
        const parts = scene.parts || {};
        if (Object.keys(parts).length < partCount || scene.imported) return false;
        if (!chat.memoryJournals) chat.memoryJournals = [];
        if (chat.memoryJournals.some(item => item.externalSceneId === sceneId)) {
            scene.imported = true;
            return false;
        }
        const content = Array.from({ length: partCount }, (_, index) => parts[index + 1] || '').filter(Boolean).join('\n\n');
        if (!content) return false;
        chat.memoryJournals.push({
            id: `st_scene_${sceneId}`, externalSceneId: sceneId,
            source: 'sillytavern', title: `${chat.realName || chat.remarkName || chat.name || '当前角色'} · ${scene.title || '酒馆线下剧情'}`,
            content, range: { start: 0, end: 0 }, createdAt: scene.createdAt || Date.now(),
            chatId: chat.id, chatType: 'private', isFavorited: settings().injectScenes === true
        });
        scene.imported = true;
        return true;
    }

    async function syncIncoming(characterKey = '') {
        if (!isConnected() || syncBusy || !characterKey || document.visibilityState !== 'visible') return;
        const chat = db.characters.find(character => character.id === characterKey);
        if (!chat) return;
        syncBusy = true;
        const state = settings();
        const cursor = Number(state.cursorByCharacter[characterKey] || 0);
        const previousJournals = structuredClone(chat.memoryJournals || []);
        const previousScenes = structuredClone(state.pendingScenes);
        let nextCursor = cursor;
        let imported = 0;
        let saved = false;
        try {
            const result = await request(`/client/events?after=${cursor}&characterKey=${encodeURIComponent(characterKey)}&limit=100`);
            if (result.gapDetected) {
                status('桥接队列已有过期记录，不能确认剧情完整；请在酒馆重新导出本场剧情。', true);
                return 0;
            }
            if ((result.events || []).some(item => String(item.characterKey || '') !== String(characterKey))) {
                status('收到角色 ID 不匹配的酒馆剧情，已停止导入；请检查角色绑定。', true);
                return 0;
            }
            for (const item of result.events || []) {
                nextCursor = Math.max(nextCursor, Number(item.seq) || 0);
                if (item.kind !== 'scene_transcript') continue;
                const payload = item.payload || {};
                const sceneId = String(item.sceneId || '');
                if (!sceneId) continue;
                const sceneKey = `${characterKey}:${sceneId}`;
                const legacyScene = state.pendingScenes[sceneId];
                const scene = state.pendingScenes[sceneKey] || legacyScene || (state.pendingScenes[sceneKey] = {
                    title: String(payload.title || '酒馆线下剧情'),
                    createdAt: Number(item.createdAt) || Date.now(),
                    partCount: Math.max(1, Number(payload.partCount) || 1), parts: {}
                });
                if (legacyScene && !state.pendingScenes[sceneKey]) {
                    state.pendingScenes[sceneKey] = scene;
                    delete state.pendingScenes[sceneId];
                }
                scene.partCount = Math.max(scene.partCount, Number(payload.partCount) || 1);
                const part = Math.max(1, Number(payload.part) || 1);
                scene.parts[part] = cleanText(payload.text);
                if (finishSceneIfReady(chat, sceneId, scene)) imported++;
            }
            state.cursorByCharacter[characterKey] = Math.max(cursor, nextCursor);
            await saveData();
            saved = true;
            if (nextCursor > cursor) {
                try { await request('/client/ack', { method: 'POST', body: { seq: nextCursor, characterKey } }); }
                catch (error) { console.warn('UvU Story Bridge acknowledgement failed:', error.message); }
            }
            if (imported) status(`已将 ${imported} 段酒馆剧情加入角色回忆${state.injectScenes ? '，并按设置加入上下文' : '；尚未注入上下文'}。`);
            else if ((result.events || []).length) status('同步完成；剧情分段仍在等待后续片段。');
            return imported;
        } catch (error) {
            if (!saved) {
                chat.memoryJournals = previousJournals;
                state.pendingScenes = previousScenes;
                state.cursorByCharacter[characterKey] = cursor;
            }
            throw error;
        } finally { syncBusy = false; }
    }

    function setSceneInjection(enabled) {
        settings().injectScenes = Boolean(enabled);
        db.characters.forEach(chat => {
            (chat.memoryJournals || []).filter(item => item.source === 'sillytavern').forEach(item => {
                item.isFavorited = Boolean(enabled);
            });
        });
        return saveData();
    }

    function setupUvUStoryBridge() {
        const urlInput = document.getElementById('uvu-bridge-url');
        const codeInput = document.getElementById('uvu-bridge-pair-code');
        const pairButton = document.getElementById('uvu-bridge-pair');
        const syncButton = document.getElementById('uvu-bridge-sync');
        const disconnectButton = document.getElementById('uvu-bridge-disconnect');
        const injectCheckbox = document.getElementById('uvu-bridge-inject-scenes');
        if (!urlInput || !pairButton || pairButton.dataset.bound === 'true') return;
        urlInput.value = settings().baseUrl || DEFAULT_URL;
        injectCheckbox.checked = settings().injectScenes === true;
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
                if (!imported) status('酒馆记忆已检查。');
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
                status(injectCheckbox.checked ? '已开启：酒馆剧情记忆通过现有收藏记忆机制加入上下文。' : '已关闭：酒馆剧情保留在回忆列表，不加入上下文。');
            } catch (error) { status(error.message, true); }
        });
        clearInterval(pollTimer);
        pollTimer = setInterval(() => {
            publishCharacterDirectory().catch(error => console.warn('UvU Story Bridge character directory sync failed:', error.message));
            if (currentChatType === 'private' && currentChatId) syncIncoming(currentChatId).catch(error => status(error.message, true));
        }, 8000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && currentChatType === 'private' && currentChatId) {
                syncIncoming(currentChatId).catch(error => status(error.message, true));
            }
        });
    }

    window.UvUStoryBridge = { isConnected, getMode, publishTurn, publishCharacterDirectory, syncIncoming };
    window.setupUvUStoryBridge = setupUvUStoryBridge;
})();
