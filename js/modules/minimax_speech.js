// Derived speech capabilities and playback preferences. Never changes chat prompts.
(function () {
    'use strict';
    const MAX_RESPONSE = 32 * 1024 * 1024, MAX_HEX = 24 * 1024 * 1024;
    const commonEmotions = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'];
    const styles = { natural: '表达自然，情绪适中，避免表演腔。', restrained: '表达克制，语速接近正常，仅在确有需要时设置短停顿。', expressive: '在台词含义支持时适当表达情绪，避免夸张；不添加声音。' };
    const abort = () => Object.assign(new Error('语音任务已取消'), { name: 'AbortError' });
    const check = signal => { if (signal?.aborted) throw abort(); };
    const bounded = (n, fallback, min, max) => Number.isFinite(Number(n)) && n !== '' && n != null ? Math.min(max, Math.max(min, Number(n))) : fallback;
    function options(value = {}) {
        return { stream: value.stream === true, segmented: value.segmented === true, persistentCache: value.persistentCache === true,
            cacheMiB: bounded(value.cacheMiB, 32, 8, 128), cacheDays: bounded(value.cacheDays, 7, 1, 30),
            segmentChars: Math.round(bounded(value.segmentChars, 1200, 300, 2500)),
            volume: bounded(value.volume, 1, 0, 10), language: typeof value.language === 'string' ? value.language.slice(0, 80) : 'auto' };
    }
    function capabilities(model = '') {
        const known = /^speech-(?:2\.8|2\.6|02|01)-(?:hd|turbo)$/.test(model);
        return { known, emotions: known ? [...commonEmotions, ...(/^speech-2\.6-/.test(model) ? ['fluent', 'whisper'] : [])] : [], stream: known };
    }
    function dictionary(value = []) {
        const entries = typeof value === 'string' ? value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : value;
        if (!Array.isArray(entries) || entries.length > 100 || entries.some(s => typeof s !== 'string' || s.length > 160 || !/^[^<>\r\n/]{1,60}\/[^<>\r\n]{1,100}$/.test(s))) {
            throw new Error('发音词典最多 100 行，每行使用“词语/读法”，不含标签');
        }
        return [...new Set(entries)];
    }
    function resolveSettings(saved, role) {
        const profile = role && saved.profiles && Object.hasOwn(saved.profiles, role.id) ? saved.profiles[role.id] : {};
        const director = { ...(saved.director || {}) };
        if (profile.directorMode === 'off') director.enabled = false;
        const style = styles[profile.style];
        if (style) director.prompt = [director.prompt || '', style].filter(Boolean).join('\n').slice(0, 4000);
        return { ...saved, voiceId: String(role?.minimaxTtsVoiceId || profile.voiceId || saved.voiceId || '').trim(),
            director, speech: options(saved.speech), pronunciation: dictionary(profile.dictionary || saved.pronunciation || []) };
    }
    function requestOptions(settings) {
        const speech = options(settings.speech), caps = capabilities(settings.model), emotion = caps.emotions.includes(settings.emotion) ? settings.emotion : '';
        const tone = dictionary(settings.pronunciation || []);
        return { voice_setting: { vol: speech.volume, ...(emotion ? { emotion } : {}) },
            ...(speech.language && speech.language !== 'auto' ? { language_boost: speech.language } : {}),
            ...(tone.length ? { pronunciation_dict: { tone } } : {}) };
    }
    function endpoint(value) {
        const url = new URL(value || 'https://api.minimaxi.com/v1/t2a_v2');
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || /(?:key|token|secret)/i.test(url.search)) throw new Error('语音 API 地址需使用 HTTPS，不在地址中填写密钥');
        return url;
    }
    function region(value) {
        const host = endpoint(value).hostname;
        return /(?:^|\.)minimaxi\.(?:com|chat)$/.test(host) ? '国内接口' : /(?:^|\.)minimax\.io$/.test(host) ? '国际接口' : '自定义接口';
    }
    async function wait(promise, signal) {
        check(signal);
        if (!signal) return promise;
        return new Promise((resolve, reject) => {
            const cancel = () => reject(abort()); signal.addEventListener('abort', cancel, { once: true });
            Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
        });
    }
    function validHex(hex) {
        if (typeof hex !== 'string' || hex.length > MAX_HEX || hex.length % 2 !== 0 || !/^[\da-f]+$/i.test(hex)) throw new Error('语音音频数据无效或过大');
        return hex;
    }
    async function readResponse(response, signal, onChunk, maxBytes = MAX_RESPONSE) {
        check(signal);
        const length = Number(response.headers?.get('content-length'));
        if (length > maxBytes) { await response.body?.cancel?.(); throw new Error('语音响应过大，已停止读取'); }
        const sse = /^text\/event-stream(?:;|$)/i.test(response.headers?.get('content-type') || '');
        if (!response.body?.getReader) return wait(response.json(), signal); // Compatibility with existing adapters.
        const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, text = '', final = null, pieces = [], hexBytes = 0;
        const packet = value => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('语音流响应格式无效');
            if (value.base_resp?.status_code) throw new Error('语音服务错误：' + String(value.base_resp.status_msg || value.base_resp.status_code).slice(0, 240));
            const audio = value.data?.audio;
            if (audio) validHex(audio);
            const status = Number(value.data?.status);
            if (status === 1 && audio) {
                if (final) throw new Error('语音流完成后出现额外音频');
                hexBytes += audio.length;
                if (hexBytes > MAX_HEX) throw new Error('语音音频过大，已停止读取');
                pieces.push(audio); onChunk?.(audio);
            } else if (status === 2) {
                if (final) throw new Error('语音流包含重复完成结果');
                // The final packet may contain the full aggregate; do not append it again.
                final = { ...value, data: { ...value.data, audio: audio || pieces.join('') } };
                if (!pieces.length && audio) onChunk?.(audio);
            }
        };
        const events = flush => {
            let boundary;
            while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(text))) {
                const event = text.slice(0, boundary.index); text = text.slice(boundary.index + boundary[0].length);
                const data = event.split(/\r\n|\r|\n/).filter(s => s.startsWith('data:')).map(s => s.slice(5).replace(/^ /, '')).join('\n');
                if (data && data !== '[DONE]') packet(JSON.parse(data));
            }
            if (flush && text.trim()) throw new Error('语音流响应不完整');
        };
        try {
            while (true) {
                const item = await wait(reader.read(), signal); check(signal);
                if (item.done) { text += decoder.decode(); break; }
                bytes += item.value.byteLength;
                if (bytes > maxBytes) throw new Error('语音响应过大，已停止读取');
                text += decoder.decode(item.value, { stream: true });
                if (sse) events(false);
            }
            if (!sse) return JSON.parse(text);
            events(true);
            if (!final?.data?.audio) throw new Error('语音流未返回完成音频');
            return final;
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    function usage(result = {}) {
        const info = result.extra_info || {};
        const safe = key => Number.isFinite(info[key]) && info[key] >= 0 ? info[key] : null;
        return { usageCharacters: safe('usage_characters'), audioMs: safe('audio_length'),
            traceId: /^[\w-]{1,100}$/.test(result.trace_id || '') ? result.trace_id : '', format: String(info.audio_format || 'mp3').slice(0, 12) };
    }
    function segments(text, maxChars = 1200) {
        const source = String(text), result = []; let start = 0;
        const limit = Math.max(8, Math.floor(maxChars));
        while (start < source.length) {
            let end = Math.min(source.length, start + limit);
            if (end < source.length) {
                const min = start + Math.floor(limit * .5);
                for (let i = end - 1; i >= min; i--) if (/[。！？.!?\n]/.test(source[i])) { end = i + 1; break; }
                if (/[\uD800-\uDBFF]/.test(source[end - 1])) end--;
            }
            result.push(source.slice(start, end)); start = end;
            if (result.length > 8) throw new Error('长语音最多分成 8 段，请增加每段长度或缩短台词');
        }
        return result;
    }
    async function hash(value) {
        if (!globalThis.crypto?.subtle) throw new Error('浏览器不支持安全缓存标识');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    }
    function idbStore() {
        let opened;
        const open = () => opened || (opened = new Promise((resolve, reject) => {
            if (!globalThis.indexedDB) return reject(new Error('持久缓存不可用'));
            let settled = false;
            const fail = error => { if (settled) return; settled = true; clearTimeout(timer); opened = null; reject(error); };
            const timer = setTimeout(() => fail(new Error('本机音频缓存暂不可用')), 2000);
            const request = indexedDB.open('uvu-minimax-audio-v1', 2);
            request.onblocked = () => fail(new Error('本机音频缓存被其他页面占用'));
            request.onupgradeneeded = () => {
                const database = request.result, transaction = request.transaction;
                if (!database.objectStoreNames.contains('audio')) database.createObjectStore('audio', { keyPath: 'key' });
                const metadata = database.createObjectStore('metadata', { keyPath: 'key' });
                metadata.createIndex('at', 'at');
                // The one-time v1 migration is the only scan that reads legacy audio records.
                const cursor = transaction.objectStore('audio').openCursor();
                cursor.onsuccess = () => { const item = cursor.result; if (!item) return; const row = item.value; metadata.put({ key: row.key, size: row.blob?.size || 0, at: row.at, expires: row.expires }); item.continue(); };
            };
            request.onsuccess = () => { if (settled) { request.result.close(); return; } settled = true; clearTimeout(timer); request.result.onversionchange = () => { request.result.close(); opened = null; }; resolve(request.result); };
            request.onerror = () => fail(request.error);
        }));
        const run = async (mode, operation) => {
            const database = await open(); return new Promise((resolve, reject) => {
                const tx = database.transaction('audio', mode), request = operation(tx.objectStore('audio'));
                tx.oncomplete = () => resolve(request?.result); tx.onabort = tx.onerror = () => reject(tx.error || new Error('音频缓存写入失败'));
            });
        };
        const mutate = async action => {
            const database = await open(); return new Promise((resolve, reject) => {
                const transaction = database.transaction(['audio', 'metadata'], 'readwrite');
                action(transaction.objectStore('audio'), transaction.objectStore('metadata'));
                transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('音频缓存写入失败'));
            });
        };
        return { metadata: async () => {
            const database = await open(); return new Promise((resolve, reject) => {
                const rows = [], transaction = database.transaction('metadata', 'readonly'), request = transaction.objectStore('metadata').index('at').openCursor();
                request.onsuccess = () => { const cursor = request.result; if (!cursor) return; rows.push(cursor.value); cursor.continue(); };
                transaction.oncomplete = () => resolve(rows); transaction.onabort = transaction.onerror = () => reject(transaction.error);
            });
        }, get: key => run('readonly', s => s.get(key)),
            put: row => mutate((audio, metadata) => { audio.put(row); metadata.put({ key: row.key, size: row.blob.size, at: row.at, expires: row.expires }); }),
            delete: key => mutate((audio, metadata) => { audio.delete(key); metadata.delete(key); }), clear: () => mutate((audio, metadata) => { audio.clear(); metadata.clear(); }) };
    }
    function createCache(store) {
        let tail = Promise.resolve(), generation = 0;
        return {
            async get(key, config) {
                if (!config.persistentCache) return null;
                try { const id = await hash(key), row = await store.get(id);
                    if (!row || !(row.blob instanceof Blob) || row.expires <= Date.now() || row.blob.size > options(config).cacheMiB * 1048576) { if (row) await store.delete(id); return null; }
                    return { blob: row.blob, detail: row.detail || {} };
                } catch (_) { return null; }
            },
            put(key, blob, detail, config) {
                if (!config.persistentCache || !(blob instanceof Blob)) return Promise.resolve(false);
                const epoch = generation;
                const task = tail.catch(() => {}).then(async () => {
                    try {
                        const id = await hash(key), limit = options(config).cacheMiB * 1048576;
                        if (blob.size > limit || epoch !== generation) return false;
                        const rows = (await (store.metadata ? store.metadata() : store.list())).sort((a, b) => a.at - b.at), size = row => row.size ?? row.blob?.size ?? 0; let bytes = rows.reduce((n, r) => n + (r.key === id ? 0 : size(r)), 0);
                        for (const row of rows) if (row.key === id || row.expires <= Date.now() || bytes + blob.size > limit) {
                            await store.delete(row.key); if (row.key !== id) bytes -= size(row);
                        }
                        if (epoch !== generation) return false;
                        await store.put({ key: id, blob, size: blob.size, detail, at: Date.now(), expires: Date.now() + options(config).cacheDays * 86400000 }); return true;
                    } catch (_) { return false; }
                }); tail = task; return task;
            },
            remove(key) {
                const task = tail.catch(() => {}).then(async () => { try { await store.delete(await hash(key)); return true; } catch (_) { return false; } });
                tail = task; return task;
            },
            async clear() { generation++; await tail.catch(() => {}); try { await store.clear(); return true; } catch (_) { return false; } }
        };
    }
    const persistent = createCache(idbStore());
    function streamPlayer(audio, signal, onStarted, onFailure) {
        if (signal?.aborted || !globalThis.MediaSource || !MediaSource.isTypeSupported?.('audio/mpeg')) return null;
        const media = new MediaSource(), url = URL.createObjectURL(media), queue = []; let buffer, done = false, disposed = false, failed = false;
        const fail = () => { if (failed || disposed) return; failed = true; queue.length = 0; onFailure?.(); };
        const pump = () => {
            if (disposed || failed || !buffer || buffer.updating || media.readyState !== 'open') return;
            try { if (queue.length) buffer.appendBuffer(queue.shift()); else if (done) media.endOfStream(); }
            catch (_) { fail(); }
        };
        media.addEventListener('sourceopen', () => {
            try { buffer = media.addSourceBuffer('audio/mpeg'); buffer.addEventListener('updateend', pump); buffer.addEventListener('error', fail); pump(); }
            catch (_) { fail(); }
        }, { once: true });
        audio.src = url;
        let started = false;
        const api = { url, get failed() { return failed; }, markFailed() { failed = true; queue.length = 0; },
            push(hex) {
                if (disposed || failed) return;
                const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
                queue.push(bytes); pump(); if (!started) { started = true; onStarted?.(); }
            },
            end() { done = true; pump(); },
            dispose() { if (disposed) return; disposed = true; queue.length = 0; signal?.removeEventListener('abort', api.dispose); URL.revokeObjectURL(url); }
        };
        signal?.addEventListener('abort', api.dispose, { once: true }); return api;
    }
    async function listVoices(config, signal) {
        const url = endpoint(config.endpoint); url.pathname = url.pathname.replace(/\/t2a_v2\/?$/, '/get_voice');
        if (!/\/get_voice$/.test(url.pathname)) throw new Error('自定义接口未提供音色列表路径，请手动填写 Voice ID');
        if (!config.apiKey) throw new Error('请先填写语音密钥');
        if (config.groupId) url.searchParams.set('GroupId', config.groupId);
        const controller = new AbortController(), cancel = () => controller.abort(), timer = setTimeout(cancel, 20000);
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            const response = await fetch(url.href, { method: 'POST', headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice_type: 'all' }), signal: controller.signal, credentials: 'omit', redirect: 'error' });
            const result = await readResponse(response, controller.signal, null, 2 * 1048576);
            if (!response.ok || result.base_resp?.status_code) throw new Error('音色列表读取失败，请检查接口区域、密钥权限或跨域设置');
            const voices = []; const seen = new Set();
            for (const group of ['system_voice', 'voice_cloning', 'voice_generation']) for (const voice of Array.isArray(result[group]) ? result[group].slice(0, 2000) : []) {
                if (typeof voice.voice_id !== 'string' || voice.voice_id.length > 200 || seen.has(voice.voice_id)) continue;
                seen.add(voice.voice_id); voices.push({ id: voice.voice_id, name: String(voice.voice_name || voice.voice_id).slice(0, 200), type: group });
            }
            return voices;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    window.MiniMaxSpeech = { options, capabilities, dictionary, resolveSettings, requestOptions, endpoint, region, readResponse,
        usage, segments, createCache, persistent, streamPlayer, listVoices, setupSettings, refreshRoles, fromForm, inspect };

    let formState = null;
    function refreshRoles() { formState?.refreshRoles(); }
    function fromForm() {
        if (!formState) return {};
        formState.flush(); return { speech: formState.read(), profiles: JSON.parse(JSON.stringify(formState.profiles)), pronunciation: dictionary(formState.dictionary.value) };
    }
    function setupSettings(saved = {}) {
        if (typeof document === 'undefined' || !document.createElement) return;
        const root = document.getElementById('minimax-tts-settings'); if (!root || root.querySelector('#minimax-speech-advanced')) return;
        const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };
        const button = (label, action) => { const el = node('button', label); el.type = 'button'; el.className = 'btn btn-secondary'; el.onclick = action; return el; };
        const field = (parent, label, type = 'text', value = '') => {
            const wrap = node('label', label); wrap.className = 'minimax-tts-field';
            const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
            if (input.tagName === 'INPUT') input.type = type; input.value = value; input.setAttribute('aria-label', label);
            if (type === 'checkbox') wrap.classList.add('minimax-speech-check');
            if (input.tagName === 'TEXTAREA') input.rows = 3; wrap.append(input); parent.append(wrap); return input;
        };
        const select = (parent, label, entries, value) => { const el = field(parent, label, 'select'); for (const [name, id] of entries) el.append(new Option(name, id)); el.value = value; return el; };
        const details = (parent, label) => { const el = node('details'), title = node('summary', label); el.append(title); parent.append(el); return el; };
        const advanced = node('section'); advanced.id = 'minimax-speech-advanced'; advanced.className = 'minimax-speech-advanced';
        const target = root.querySelector('.minimax-tts-actions'); if (target) target.before(advanced); else root.append(advanced);
        const profiles = JSON.parse(JSON.stringify(saved.profiles || {}));
        let roles = (typeof db !== 'undefined' ? db.characters || [] : []).filter(c => c && typeof c.id === 'string');
        const roleSelect = select(advanced, '音色与表达', [['默认设置', ''], ...roles.map(c => [c.realName || c.remarkName || c.name || c.id, c.id])], '');
        const profile = node('div'); profile.className = 'minimax-speech-profile'; advanced.append(profile); profile.hidden = true;
        const voice = field(profile, '音色 ID'), mode = select(profile, '导演', [['跟随默认', 'inherit'], ['普通语音', 'off']], 'inherit');
        const style = select(profile, '表达风格', [['跟随默认', ''], ['自然', 'natural'], ['克制', 'restrained'], ['适度表达', 'expressive']], '');
        const pronunciation = field(profile, '角色读音词典', 'textarea'); pronunciation.placeholder = '晴/(qing2)';
        const hint = node('p'); hint.className = 'minimax-speech-note'; profile.append(hint);
        let selected = '';
        const flush = () => { if (selected) profiles[selected] = { voiceId: voice.value.trim().slice(0, 200), directorMode: mode.value, style: style.value, dictionary: dictionary(pronunciation.value) }; };
        roleSelect.onchange = () => {
            try { flush(); } catch (error) { roleSelect.value = selected; return typeof showToast === 'function' && showToast(error.message); }
            selected = roleSelect.value; profile.hidden = !selected; const p = profiles[selected] || {}, role = roles.find(c => c.id === selected);
            voice.value = p.voiceId || ''; mode.value = p.directorMode || 'inherit'; style.value = p.style || ''; pronunciation.value = (p.dictionary || []).join('\n');
            hint.textContent = role?.minimaxTtsVoiceId ? '聊天设置已指定音色，优先使用该音色。' : '';
        };
        const catalog = details(advanced, '选择音色'), search = field(catalog, '搜索', 'search'); search.placeholder = '音色名称或 ID';
        const favorites = new Set(Array.isArray(saved.speech?.favoriteVoices) ? saved.speech.favoriteVoices : []);
        const favoritesOnly = field(catalog, '仅收藏', 'checkbox');
        const list = node('div'); list.className = 'minimax-voice-list'; let voices = [], controller;
        const status = node('p'); status.className = 'minimax-speech-note'; status.setAttribute('aria-live', 'polite');
        const readConnection = () => ({ endpoint: document.getElementById('minimax-tts-endpoint').value,
            apiKey: document.getElementById('minimax-tts-key').value.trim(), groupId: document.getElementById('minimax-tts-group-id').value.trim() });
        const render = () => {
            list.replaceChildren(); const q = search.value.trim().toLowerCase();
            const items = voices.filter(v => (!favoritesOnly.checked || favorites.has(v.id)) && (v.name + ' ' + v.id).toLowerCase().includes(q));
            for (const v of items.slice(0, 80)) {
                const row = node('div'); row.className = 'minimax-voice-row';
                const use = button(v.name, () => { if (selected) voice.value = v.id; else document.getElementById('minimax-tts-voice').value = v.id; status.textContent = '已选择，保存后生效'; });
                use.title = v.id; const favorite = button(favorites.has(v.id) ? '★' : '☆', () => { favorites.has(v.id) ? favorites.delete(v.id) : favorites.add(v.id); render(); }); favorite.setAttribute('aria-label', '收藏 ' + v.name);
                const preview = button('试听', async () => {
                    const cfg = { ...db.minimaxTtsSettings, ...readConnection(), voiceId: v.id, director: { enabled: false } };
                    await MiniMaxTTS.play(preview, '你好，这是音色试听。', cfg);
                }); row.append(use, favorite, preview); list.append(row);
            }
            if (!items.length) list.append(node('p', voices.length ? '没有匹配音色' : '点击读取音色，或直接填写 ID'));
            if (items.length > 80) list.append(node('p', '结果较多，请输入名称缩小范围'));
        };
        const refresh = button('读取音色', async () => {
            controller?.abort(); controller = new AbortController(); refresh.disabled = true; status.textContent = '正在读取…';
            try { voices = await listVoices(readConnection(), controller.signal); render(); status.textContent = '已读取 ' + voices.length + ' 个音色'; }
            catch (error) { status.textContent = error.message; } finally { refresh.disabled = false; }
        }); catalog.append(refresh, list, status); search.oninput = favoritesOnly.onchange = render; render();
        const playback = details(advanced, '播放与缓存'), config = options(saved.speech);
        const stream = field(playback, '流式语音', 'checkbox'); stream.checked = config.stream;
        const segmented = field(playback, '长语音分段', 'checkbox'); segmented.checked = config.segmented;
        const segmentChars = field(playback, '每段字数', 'number', config.segmentChars); segmentChars.min = 300; segmentChars.max = 2500;
        const persistentCache = field(playback, '在此设备保存音频', 'checkbox'); persistentCache.checked = config.persistentCache;
        const cacheMiB = field(playback, '缓存上限 MiB', 'number', config.cacheMiB); cacheMiB.min = 8; cacheMiB.max = 128;
        const cacheDays = field(playback, '保留天数', 'number', config.cacheDays); cacheDays.min = 1; cacheDays.max = 30;
        const volume = field(playback, '音量', 'number', config.volume); volume.min = 0; volume.max = 10; volume.step = .1;
        const language = field(playback, '语言增强', 'text', config.language); language.placeholder = 'auto / Chinese / Chinese,Yue';
        const clear = button('清理本机音频', async () => { MiniMaxTTS.clearCache(); status.textContent = await persistent.clear() ? '本机音频已清理' : '本机缓存不可用'; }); playback.append(clear);
        const dictionaryField = field(details(advanced, '默认读音词典'), '一行一个词语/读法', 'textarea', (saved.pronunciation || []).join('\n'));
        const help = details(advanced, '使用说明'); help.append(node('p', '音色优先级：聊天设置、角色配置、默认音色。导演只控制声音，不修改台词。分段最多 8 段，可能增加请求；缓存仅在此设备保存音频，备份不包含音频文件。流式播放取决于浏览器支持，不支持时等待完整 MP3。国内与国际接口密钥应与账户区域一致。展开聊天语音的“语音详情”可查看计费字符和导演 Token、切回普通语音、重试导演或手动选择本条语音的情绪与语速。合成后展开“分段参数”，可核对各段台词、实际情绪、语速、停顿位置及缓存状态；这不是合成前试听。接口未提供的用量不估作实际费用。'));
        formState = { profiles, flush, dictionary: dictionaryField, refreshRoles: () => {
            // Refresh the menu after data loading/import, without reloading a profile's unsaved fields.
            const value = roleSelect.value;
            roles = (typeof db !== 'undefined' ? db.characters || [] : []).filter(c => c && typeof c.id === 'string');
            roleSelect.replaceChildren(new Option('默认设置', ''), ...roles.map(c => new Option(c.realName || c.remarkName || c.name || c.id, c.id)));
            if (roles.some(c => c.id === value)) roleSelect.value = value;
            else if (selected) { selected = ''; roleSelect.value = ''; profile.hidden = true; }
        }, read: () => ({ ...options({ stream: stream.checked, segmented: segmented.checked,
            persistentCache: persistentCache.checked, cacheMiB: cacheMiB.value, cacheDays: cacheDays.value, segmentChars: segmentChars.value,
            volume: volume.value, language: language.value }), favoriteVoices: [...favorites].slice(0, 200) }) };
    }
    function inspect(bubble, diagnostic, onPlain, onRetry, onManual, model) {
        if (typeof document === 'undefined' || !document.createElement || !bubble?.insertAdjacentElement || bubble.id === 'minimax-tts-preview') return;
        let detail = bubble.nextElementSibling;
        if (!detail?.classList?.contains('minimax-message-diagnostic')) {
            detail = document.createElement('details'); detail.className = 'minimax-message-diagnostic'; bubble.insertAdjacentElement('afterend', detail);
        }
        detail.replaceChildren(); const title = document.createElement('summary'); title.textContent = '语音详情'; detail.append(title);
        const line = document.createElement('p'); line.textContent = '情绪 ' + (diagnostic.emotion || 'auto') + ' · 语速 ' + diagnostic.speed + ' · 停顿 ' + diagnostic.pauseCount + ' 处' +
            (diagnostic.currentUsageCharacters != null ? ' · 本次合成计费字符 ' + diagnostic.currentUsageCharacters : '') + (diagnostic.cacheHit ? ' · 缓存' : '') +
            (diagnostic.audioMs != null ? ' · ' + (diagnostic.audioMs / 1000).toFixed(1) + ' 秒' : '') +
            (diagnostic.directorUsage?.some(u => u.inputTokens != null || u.outputTokens != null) ? ' · 导演输入/输出 Token ' +
                ['inputTokens', 'outputTokens'].map(key => diagnostic.directorUsage.every(u => u.cacheHit || u[key] != null)
                    ? diagnostic.directorUsage.reduce((n, u) => n + (u.cacheHit ? 0 : u[key]), 0) : '未提供').join('/') : '') + (diagnostic.warning ? ' · ' + diagnostic.warning : ''); detail.append(line);
        if (diagnostic.segmentDetails?.length) {
            const segments = document.createElement('details'), heading = document.createElement('summary'); heading.textContent = '分段参数'; segments.append(heading);
            diagnostic.segmentDetails.forEach((segment,index) => {
                const row = document.createElement('section'), title = document.createElement('p'), text = document.createElement('p');
                title.textContent = '第 '+(index+1)+' 段 · '+segment.emotion+' · 语速 '+segment.speed+' · '+(segment.cacheHit?'音频缓存':segment.usageCharacters==null?'合成用量未返回':'本次合成 '+segment.usageCharacters+' 字符');
                text.textContent = segment.text; row.append(title,text);
                for (const pause of segment.pauses || []) { const p=document.createElement('p');p.textContent='“'+pause.after+'”后停顿 '+pause.seconds+' 秒';row.append(p); }
                segments.append(row);
            }); detail.append(segments);
        }
        const actions = document.createElement('div'); actions.className = 'minimax-tts-actions';
        for (const [text, callback] of [['普通语音', onPlain], ['重试导演', onRetry]]) { if (!callback) continue; const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = callback; actions.append(button); }
        detail.append(actions);
        if (onManual) {
            const manual = document.createElement('div'); manual.className = 'minimax-manual-controls';
            const emotion = document.createElement('select'); emotion.setAttribute('aria-label', '本条语音情绪');
            const names = { auto: '自动情绪', happy: '开心', sad: '悲伤', angry: '生气', fearful: '害怕', disgusted: '厌恶', surprised: '惊讶', calm: '平静', fluent: '生动', whisper: '低语' };
            for (const id of ['auto', ...capabilities(model).emotions]) emotion.add(new Option(names[id] || id, id));
            emotion.value = capabilities(model).emotions.includes(diagnostic.emotion) ? diagnostic.emotion : 'auto';
            const speed = document.createElement('input'); speed.type = 'number'; speed.min = .5; speed.max = 2; speed.step = .1; speed.value = diagnostic.speed || 1; speed.setAttribute('aria-label', '本条语音语速');
            const play = document.createElement('button'); play.type = 'button'; play.textContent = '按此播放';
            play.onclick = () => onManual({ emotion: emotion.value === 'auto' ? '' : emotion.value, speed: speed.value });
            manual.append(emotion, speed, play); detail.append(manual);
        }
    }
}());
