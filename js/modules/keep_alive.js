// 持续运行增强只提供浏览器允许的能力，不保证锁屏后继续执行。
(function () {
    const HEARTBEAT_MS = 30000, RESUME_GAP_MS = 20000, MAX_CHECKPOINT_AGE_MS = 86400000;
    const CHECKPOINT_KEY = 'uwu_keep_alive_checkpoint', CLAIM_KEY = 'uvu-keepalive-tasks.v1';
    const owner = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    let enabled = false, generation = 0, audio = null, audioUrl = '', audioPending = null, audioRevision = 0;
    let wakeLock = null, wakePending = null, heartbeatTimer = null, gestureHandler = null, listenersBound = false;
    let hiddenAt = 0, lastHeartbeatAt = Date.now(), recoveryPromise = null, recoveryAgain = false;
    let options = { screenAwake: true, compatibilityAudio: true }, musicBusy = false, voiceHolds = new Set();
    let audioFailures = 0, nextAudioAt = 0, wakeFailures = 0, nextWakeAt = 0, checkpoint = null, restored = false;
    let channel = null, leaseHeld = false, storageAvailable = true, taskSequence = 0;
    const tasks = new Map(), taskClaims = new Map(), diagnostics = { lastRecoveryAt: 0, lastGapMs: 0, interrupted: false, errors: [] };
    const valid = token => enabled && token === generation;
    const visible = () => document.visibilityState === 'visible';
    const mediaBusy = () => musicBusy || voiceHolds.size > 0;
    function record(step, error) {
        // 仅保存步骤、时间和错误类型，不保存服务器响应、密钥或对话。
        diagnostics.errors.push({ step, at: Date.now(), type: String(error?.name || 'Error').slice(0, 60) });
        diagnostics.errors = diagnostics.errors.slice(-8);
        renderDiagnostics();
    }
    function setStatus(text, state) {
        const el = document.getElementById('keep-alive-status');
        if (el) { el.textContent = text; el.dataset.state = state; }
    }
    function updateRunningStatus() {
        if (!enabled) return setStatus('未开启', 'off');
        if (!visible()) return setStatus('已切到后台，系统可能暂停网页', 'background');
        if (mediaBusy() && options.compatibilityAudio) return setStatus('播放优先，兼容音频已让行', 'partial');
        const screen = wakeLock && !wakeLock.released, sound = audio && !audio.paused && !audio.error;
        if (screen && sound) return setStatus('屏幕常亮 · 兼容音频已启动', 'running');
        if (screen) return setStatus('屏幕常亮已开启', 'partial');
        if (sound) return setStatus('兼容音频已启动', 'partial');
        if (gestureHandler) return setStatus('点一下页面以启动兼容音频', 'waiting');
        setStatus('恢复检查已开启，保活能力受系统限制', 'partial');
    }
    function renderDiagnostics() {
        const el = document.getElementById('keep-alive-diagnostics');
        if (!el || !el.open) return;
        const text = document.getElementById('keep-alive-diagnostic-result');
        if (!text) return;
        const d = getDiagnostics();
        text.textContent = [
            `屏幕常亮：${d.screenAwake ? '已获取' : d.screenSupported ? '未获取' : '不支持'}`,
            `兼容音频：${d.audioPlaying ? '已启动' : d.mediaBusy ? '播放让行' : '未启动'}`,
            `网络：${d.online ? '在线' : '离线'} · 恢复检查：${d.lastRecoveryAt ? new Date(d.lastRecoveryAt).toLocaleTimeString() : '暂无'}`,
            d.interrupted ? '上次检查被中断；未重发旧请求' : '',
            d.errors.length ? `最近受限：${d.errors.map(e => e.step + '/' + e.type).join('、')}` : ''
        ].filter(Boolean).join('\n');
    }
    function getDiagnostics() {
        return { enabled, screenSupported: Boolean(navigator.wakeLock), screenAwake: Boolean(wakeLock && !wakeLock.released),
            audioPlaying: Boolean(audio && !audio.paused && !audio.error), mediaBusy: mediaBusy(), online: navigator.onLine !== false,
            ...diagnostics, errors: diagnostics.errors.map(e => ({ ...e })), tasks: [...tasks.keys()] };
    }
    function createLowImpactWavUrl() {
        const sampleRate = 8000;
        const durationSeconds = 8;
        const sampleCount = sampleRate * durationSeconds;
        const buffer = new ArrayBuffer(44 + sampleCount * 2);
        const view = new DataView(buffer);

        function writeString(offset, value) {
            for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
        }

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + sampleCount * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, sampleCount * 2, true);

        for (let i = 0; i < sampleCount; i++) {
            // 55Hz 通常低于手机扬声器的有效频段，但数据并非全静音。
            const fade = Math.min(1, i / 160, (sampleCount - i) / 160);
            const sample = Math.round(Math.sin(2 * Math.PI * 55 * i / sampleRate) * 96 * fade);
            view.setInt16(44 + i * 2, sample, true);
        }

        return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    }

    function removeGestureFallback() {
        if (!gestureHandler) return;
        document.removeEventListener('pointerdown', gestureHandler, true);
        document.removeEventListener('touchstart', gestureHandler, true);
        gestureHandler = null;
    }
    function installGestureFallback(token) {
        if (gestureHandler || !valid(token)) return;
        gestureHandler = () => {
            removeGestureFallback();
            audioFailures = 0; nextAudioAt = 0;
            void startAudio(true, token);
        };
        document.addEventListener('pointerdown', gestureHandler, { capture: true, once: true });
        document.addEventListener('touchstart', gestureHandler, { capture: true, once: true });
    }
    function pauseAudio() {
        ++audioRevision; audioPending = null;
        if (audio) audio.pause();
    }
    function disposeAudio() {
        pauseAudio();
        const old = audio; audio = null;
        if (old) { old.removeAttribute('src'); old.load(); }
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = ''; removeGestureFallback();
    }
    function startAudio(fromGesture = false, token = generation) {
        if (!valid(token) || !options.compatibilityAudio || mediaBusy()) return Promise.resolve(false);
        if (audio && !audio.paused && !audio.error) return Promise.resolve(true);
        if (audioPending) return audioPending;
        if (!fromGesture && Date.now() < nextAudioAt) return Promise.resolve(false);
        if (!audio) {
            audioUrl = createLowImpactWavUrl(); audio = new Audio(audioUrl);
            audio.loop = true; audio.preload = 'auto'; audio.volume = 1;
            audio.setAttribute('playsinline', ''); audio.setAttribute('webkit-playsinline', '');
            for (const event of ['playing', 'pause', 'stalled']) audio.addEventListener(event, updateRunningStatus);
            const source = audio;
            audio.addEventListener('error', () => {
                if (!valid(token) || audio !== source) return;
                record('audio', { name: 'MediaError' }); nextAudioAt = Date.now() + 60000;
                source.pause(); updateRunningStatus();
            });
        }
        const current = audio, revision = ++audioRevision;
        let play; try { play = current.play(); } catch (error) { play = Promise.reject(error); }
        const pending = Promise.resolve(play).then(() => {
            if (!valid(token) || current !== audio || revision !== audioRevision || mediaBusy() || !options.compatibilityAudio) {
                // A newer play on this same element owns it; do not pause that newer attempt.
                if (current !== audio || !enabled || mediaBusy() || !options.compatibilityAudio) current.pause();
                return false;
            }
            audioFailures = 0; nextAudioAt = 0; removeGestureFallback(); updateRunningStatus(); return true;
        }, error => {
            if (!valid(token) || current !== audio || revision !== audioRevision) return false;
            record('audio', error); audioFailures++;
            nextAudioAt = Date.now() + Math.min(300000, 15000 * 2 ** Math.min(audioFailures, 5));
            if (error?.name === 'NotAllowedError') { nextAudioAt = Infinity; installGestureFallback(token); }
            updateRunningStatus(); return false;
        }).finally(() => { if (audioPending === pending) audioPending = null; });
        audioPending = pending; return pending;
    }
    function releaseLock(lock) {
        if (!lock || lock.released) return Promise.resolve();
        try { return Promise.resolve(lock.release()).catch(error => record('wake-release', error)); }
        catch (error) { record('wake-release', error); return Promise.resolve(); }
    }
    function requestWakeLock(token = generation) {
        if (!valid(token) || !options.screenAwake || !visible() || !navigator.wakeLock) return Promise.resolve(false);
        if (wakeLock && !wakeLock.released) return Promise.resolve(true);
        if (wakePending) return wakePending;
        if (Date.now() < nextWakeAt) return Promise.resolve(false);
        let requested; try { requested = navigator.wakeLock.request('screen'); } catch (error) { requested = Promise.reject(error); }
        const pending = Promise.resolve(requested).then(async lock => {
            if (!valid(token) || !options.screenAwake || !visible()) { await releaseLock(lock); return false; }
            wakeLock = lock; wakeFailures = 0; nextWakeAt = 0;
            lock.addEventListener('release', () => {
                if (wakeLock !== lock) return;
                wakeLock = null; nextWakeAt = Date.now() + 30000; updateRunningStatus();
            }, { once: true });
            updateRunningStatus(); return true;
        }, error => {
            if (valid(token)) { record('wake', error); wakeFailures++; nextWakeAt = Date.now() + Math.min(300000, 30000 * 2 ** Math.min(wakeFailures, 4)); updateRunningStatus(); }
            return false;
        }).finally(() => { if (wakePending === pending) wakePending = null; });
        wakePending = pending; return pending;
    }
    function readJSON(storage, key) {
        try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
    }
    function writeCheckpoint(reason) {
        if (!enabled) return;
        const data = { version: 2, timestamp: hiddenAt || Date.now(), reason, pending: tasks.has('autoReply') };
        try { sessionStorage.setItem(CHECKPOINT_KEY, JSON.stringify(data)); } catch (error) { record('checkpoint', error); }
    }
    function restoreCheckpoint() {
        if (restored) return; restored = true;
        let data;
        try { data = readJSON(sessionStorage, CHECKPOINT_KEY); sessionStorage.removeItem(CHECKPOINT_KEY); } catch (_) {}
        // Migrate the old shared timestamp once; the new checkpoint belongs to this tab.
        if (!data) { try { data = readJSON(localStorage, CHECKPOINT_KEY); localStorage.removeItem(CHECKPOINT_KEY); } catch (_) {} }
        const age = Date.now() - Number(data?.timestamp);
        if (!Number.isFinite(age) || age < RESUME_GAP_MS || age > MAX_CHECKPOINT_AGE_MS) return;
        checkpoint = data; hiddenAt = Number(data.timestamp); diagnostics.interrupted = data.pending === true;
    }
    function clearCheckpoint() {
        checkpoint = null;
        try { sessionStorage.removeItem(CHECKPOINT_KEY); } catch (_) {}
    }
    function withClaimLock(callback) {
        if (!navigator.locks?.request) return Promise.resolve().then(callback);
        return navigator.locks.request(CLAIM_KEY, {}, lock => lock ? callback() : false);
    }
    // A short lock protects only the persistent lease; no Web Lock survives a freeze.
    function claimCoordinator(token) {
        return withClaimLock(() => {
            if (!valid(token)) return false;
            try {
                const lease = readJSON(localStorage, CLAIM_KEY), now = Date.now();
                if (lease && lease.owner !== owner && Number(lease.expires) > now && Number(lease.expires) <= now + 120000) return false;
                localStorage.setItem(CLAIM_KEY, JSON.stringify({ owner, expires: now + 75000 }));
                leaseHeld = readJSON(localStorage, CLAIM_KEY)?.owner === owner; return leaseHeld;
            } catch (error) {
                if (storageAvailable) record('coordination', error); storageAvailable = false;
                // Without shared storage do not start extra catch-up network requests.
                return false;
            }
        }).catch(error => { record('coordination', error); return false; });
    }
    function releaseCoordinator() {
        if (!leaseHeld) return; leaseHeld = false;
        try { if (readJSON(localStorage, CLAIM_KEY)?.owner === owner) localStorage.removeItem(CLAIM_KEY); } catch (_) {}
        try { channel?.postMessage({ type: 'released' }); } catch (_) {}
    }
    function claimTask(name, token) {
        const key = CLAIM_KEY + ':' + name, id = owner + ':' + name + ':' + (++taskSequence);
        return withClaimLock(() => {
            if (!valid(token)) return null;
            try {
                const old = readJSON(localStorage, key), now = Date.now();
                if (old && Number(old.expires) > now && Number(old.expires) <= now + 600000) return null;
                const claim = { key, id, owner, startedAt: now, expires: now + 300000 };
                localStorage.setItem(key, JSON.stringify(claim));
                return readJSON(localStorage, key)?.id === id ? claim : null;
            } catch (error) { record('task-claim', error); return null; }
        }).catch(error => { record('task-claim', error); return null; });
    }
    function releaseTask(claim) {
        if (!claim) return;
        taskClaims.delete(claim.id);
        try { if (readJSON(localStorage, claim.key)?.id === claim.id) localStorage.removeItem(claim.key); } catch (_) {}
    }
    function renewTasks() {
        for (const claim of taskClaims.values()) {
            try {
                if (readJSON(localStorage, claim.key)?.id !== claim.id) continue;
                claim.expires = Date.now() + 300000; localStorage.setItem(claim.key, JSON.stringify(claim));
            } catch (_) {}
        }
    }
    async function autoReplyDataIsCurrent(token) {
        if (typeof db === 'undefined' || typeof dexieDB === 'undefined' || !dexieDB?.characters?.bulkGet) return valid(token);
        const characters = db.characters.filter(char => char.autoReply?.enabled);
        if (!characters.length) return valid(token);
        const targets = characters.map(char => ({ char, history: char.history, archiveId: char.activeArchiveId,
            settings: JSON.stringify(char.autoReply), last: char.history?.at(-1)?.id }));
        const stored = await dexieDB.characters.bulkGet(characters.map(char => char.id));
        if (!valid(token)) return false;
        return targets.every((target, index) => {
            const current = target.char, saved = stored[index];
            if (!db.characters.includes(current) || current.history !== target.history || current.activeArchiveId !== target.archiveId ||
                JSON.stringify(current.autoReply) !== target.settings || current.history?.at(-1)?.id !== target.last) return false;
            // Leave stale data untouched. The user can reload this tab; never copy another archive into the open chat.
            return saved && saved.activeArchiveId === target.archiveId && JSON.stringify(saved.autoReply) === target.settings &&
                saved.history?.length === current.history?.length && saved.history?.at(-1)?.id === target.last;
        });
    }
    function invokeTask(name, fn, token) {
        if (!valid(token) || typeof fn !== 'function' || tasks.has(name)) return tasks.get(name) || Promise.resolve(false);
        let claim;
        const task = Promise.resolve().then(async () => {
            if (!valid(token) || (name === 'autoReply' && navigator.onLine === false)) return;
            // Existing requests keep their role/archive ownership; never replay or cancel them.
            if (name === 'autoReply' && typeof chatGenerationRequests !== 'undefined' && chatGenerationRequests.size) return;
            claim = await claimTask(name, token);
            if (!claim) return;
            taskClaims.set(claim.id, claim);
            if (!valid(token)) return;
            if (name === 'autoReply' && !await autoReplyDataIsCurrent(token)) {
                record('stale-tab', { name: 'ReloadRequired' }); return;
            }
            if (!valid(token) || readJSON(localStorage, claim.key)?.id !== claim.id) return;
            return fn();
        }).catch(error => record(name, error)).finally(() => {
            releaseTask(claim);
            if (tasks.get(name) === task) tasks.delete(name);
            if (enabled) writeCheckpoint('task-finished');
            renderDiagnostics();
        });
        tasks.set(name, task); writeCheckpoint('task-started'); return task;
    }
    async function scheduled(name, fn) {
        if (!enabled) return fn(); // The disabled path retains the original scheduling behavior.
        const token = generation;
        if (!await claimCoordinator(token) || !valid(token)) return;
        return invokeTask(name, fn, token);
    }
    function recover(reason = 'manual') {
        if (!enabled || !visible()) return Promise.resolve();
        openChannel();
        if (recoveryPromise) { recoveryAgain = true; return recoveryPromise; }
        const token = generation;
        const current = Promise.resolve().then(async () => {
            if (!valid(token) || !visible()) return;
            const now = Date.now(), elapsedMs = Math.max(0, now - (hiddenAt || lastHeartbeatAt));
            lastHeartbeatAt = now; hiddenAt = 0;
            // Media permissions must not hold up recovery tasks.
            void startAudio(false, token); void requestWakeLock(token);
            if (elapsedMs >= RESUME_GAP_MS) {
                const interrupted = checkpoint?.pending === true; clearCheckpoint();
                diagnostics.lastRecoveryAt = now; diagnostics.lastGapMs = elapsedMs;
                try { if (typeof updateClock === 'function') updateClock(); } catch (error) { record('clock', error); }
                if (await claimCoordinator(token) && valid(token) && visible()) {
                    if (!interrupted && typeof checkAutoReply === 'function') void invokeTask('autoReply', checkAutoReply, token);
                    if (typeof checkBackupReminder === 'function') void invokeTask('backup', checkBackupReminder, token);
                }
                if (!valid(token)) return;
                window.dispatchEvent(new CustomEvent('uwu:app-resume', { detail: { reason, elapsedMs, resumedAt: now, interrupted } }));
            }
            updateRunningStatus(); renderDiagnostics();
        }).catch(error => record('recovery', error)).finally(() => {
            if (recoveryPromise !== current) return;
            recoveryPromise = null;
            if (recoveryAgain && valid(token)) { recoveryAgain = false; void recover('coalesced'); }
        });
        recoveryPromise = current; return current;
    }
    function suspendForMedia() {
        const hold = {}; voiceHolds.add(hold);
        if (enabled) { pauseAudio(); updateRunningStatus(); }
        let released = false;
        return () => { if (released) return; released = true; voiceHolds.delete(hold); if (enabled) { void startAudio(); updateRunningStatus(); } };
    }
    function syncMusic(state) {
        musicBusy = Boolean(state?.playing || state?.phase === 'loading');
        if (!enabled) return;
        if (musicBusy) pauseAudio(); else void startAudio();
        updateRunningStatus();
    }
    function hide(reason) {
        if (!enabled) return; hiddenAt = hiddenAt || Date.now(); writeCheckpoint(reason); releaseCoordinator(); closeChannel();
        if (wakeLock) { const old = wakeLock; wakeLock = null; void releaseLock(old); }
        updateRunningStatus();
    }
    function openChannel() {
        if (channel || typeof BroadcastChannel !== 'function') return;
        try { channel = new BroadcastChannel(CLAIM_KEY); channel.onmessage = () => { if (enabled) renderDiagnostics(); }; } catch (_) {}
    }
    function closeChannel() {
        if (channel) { try { channel.close(); } catch (_) {} channel = null; }
    }
    function bindListeners() {
        if (listenersBound) return; listenersBound = true;
        document.addEventListener('visibilitychange', () => { if (visible()) void recover('visible'); else hide('hidden'); });
        document.addEventListener('freeze', () => hide('freeze'));
        document.addEventListener('resume', () => void recover('resume'));
        window.addEventListener('pagehide', () => hide('pagehide'));
        window.addEventListener('pageshow', () => void recover('pageshow'));
        window.addEventListener('online', () => { if (enabled) { void recover('online'); updateRunningStatus(); } });
        window.addEventListener('offline', () => { if (enabled) { updateRunningStatus(); renderDiagnostics(); } });
        window.addEventListener('music-state', event => syncMusic(event.detail));
        document.getElementById('keep-alive-diagnostics')?.addEventListener('toggle', renderDiagnostics);
    }
    async function setEnabled(value, settings = {}) {
        const token = ++generation; enabled = Boolean(value); recoveryAgain = false; recoveryPromise = null;
        if (settings.screenAwake !== undefined) options.screenAwake = Boolean(settings.screenAwake);
        if (settings.compatibilityAudio !== undefined) options.compatibilityAudio = Boolean(settings.compatibilityAudio);
        removeGestureFallback();
        if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null;
        const oldLock = wakeLock; wakeLock = null; wakePending = null;
        // Tear down synchronously before waiting for any old browser promise.
        disposeAudio(); void releaseLock(oldLock);
        audioFailures = 0; nextAudioAt = 0; wakeFailures = 0; nextWakeAt = 0;
        if (!enabled) { hiddenAt = 0; releaseCoordinator(); closeChannel(); clearCheckpoint(); updateRunningStatus(); renderDiagnostics(); return true; }
        bindListeners();
        openChannel();
        try { const music = window.UvUMusic?.player?.snapshot(); musicBusy = Boolean(music?.playing || music?.phase === 'loading'); } catch (_) {}
        if (!checkpoint) lastHeartbeatAt = Date.now();
        heartbeatTimer = setInterval(() => {
            if (!enabled) return;
            const gap = Date.now() - lastHeartbeatAt;
            if (visible() && gap >= RESUME_GAP_MS + HEARTBEAT_MS) void recover('timer-gap');
            else lastHeartbeatAt = Date.now();
            if (leaseHeld) void claimCoordinator(generation);
            renewTasks();
        }, HEARTBEAT_MS);
        void startAudio(Boolean(settings.userInitiated), token);
        void requestWakeLock(token);
        if (checkpoint && visible()) void recover('reload');
        if (valid(token)) { updateRunningStatus(); renderDiagnostics(); }
        return valid(token);
    }
    window.KeepAliveManager = {
        init(value, settings = {}) { if (value) restoreCheckpoint(); return setEnabled(value, settings); },
        setEnabled, recover, scheduled, suspendForMedia, getDiagnostics, isEnabled: () => enabled,
        getOptions: () => ({ ...options })
    };
    window.toggleKeepAlive = value => setEnabled(Boolean(value), { userInitiated: true });
})();
