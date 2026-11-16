// --- 工具函数库 (js/utils.js) ---
// Plain display fields only; authored HTML templates keep their own rendering path.
function escapeDisplayHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function safeDisplayImageUrl(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    try {
        const parsed = new URL(text, typeof document !== 'undefined' ? document.baseURI : undefined);
        if (['https:', 'http:', 'blob:'].includes(parsed.protocol) ||
            (parsed.protocol === 'data:' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(text))) return text;
    } catch (_) {}
    return '';
}

// A blank key may inherit only from the same configured destination/provider.
// Compare the full API base, including tenant paths, rather than a host prefix.
function resolveDestinationKey(url, key, fallbackUrl, fallbackKey, provider, fallbackProvider, vectorEndpoints = false) {
    if (typeof key === 'string' && key.trim()) return key;
    if ((provider || 'newapi') !== (fallbackProvider || 'newapi')) return '';
    if (!url) return fallbackKey || '';
    const normalize = value => {
        const parsed = new URL(String(value).trim());
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
        parsed.hash = '';
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
        if (vectorEndpoints) parsed.pathname = parsed.pathname.replace(/\/(?:embeddings|rerank|chat\/completions)$/i, '');
        return parsed.href;
    };
    try {
        const destination = normalize(url);
        return destination && destination === normalize(fallbackUrl) ? fallbackKey || '' : '';
    } catch (_) { return ''; }
}

const statusRegexCache = new Map();
let statusRegexCacheBytes = 0;
let statusRegexWarningShown = false;
function statusRegexKey(source, flags, text) { return JSON.stringify([source, flags, text]); }
function statusRegexWarn() {
    if (!statusRegexWarningShown && typeof showToast === 'function') showToast('状态正则超时或暂不可用，已保留原文；请检查状态栏设置');
    statusRegexWarningShown = true;
}
function statusRegexIsLiteral(source, flags) {
    if (source.length > 512 || /[^dgimsuy]/.test(flags)) return false;
    let inClass = false;
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (char === '\\') {
            const next = source[++i];
            if (!next || /[1-9kpP]/.test(next)) return false;
        } else if (inClass) { if (char === ']') inClass = false; }
        else if (char === '[') inClass = true;
        else if ('+*?{}()|'.includes(char)) return false;
    }
    return !inClass;
}
function createStatusRegex(source, flags = '') {
    // Construction validates syntax only. Unbounded matching stays in a worker.
    if (source.length > 8192) throw new Error('状态正则过长');
    const syntax = new RegExp(source, flags);
    if (statusRegexIsLiteral(source, flags)) return syntax;
    const result = text => {
        const cached = statusRegexCache.get(statusRegexKey(source, flags, String(text)));
        if (cached?.error) statusRegexWarn();
        return cached;
    };
    return {
        exec(text) { return result(text)?.match || null; },
        [Symbol.replace](text) { return result(text)?.stripped ?? String(text); }
    };
}
async function prepareStatusRegexJobs(jobs, signal) {
    const pending = [...new Map(jobs.map(job => [statusRegexKey(job.source, job.flags, job.text), job])).values()]
        .filter(job => !statusRegexIsLiteral(job.source, job.flags) && !statusRegexCache.has(statusRegexKey(job.source, job.flags, job.text)));
    if (!pending.length) return;
    const aborted = () => Object.assign(new Error('状态匹配已取消'), {name: 'AbortError'});
    if (signal?.aborted) throw aborted();
    const remember = (job, value) => {
        const key = statusRegexKey(job.source, job.flags, job.text);
        const bytes = (key.length + JSON.stringify(value).length) * 2;
        if (bytes > 8 * 1024 * 1024) return;
        if (statusRegexCache.has(key)) return;
        while (statusRegexCache.size >= 1000 || statusRegexCacheBytes + bytes > 8 * 1024 * 1024) {
            const first = statusRegexCache.keys().next().value;
            statusRegexCacheBytes -= statusRegexCache.get(first).bytes;
            statusRegexCache.delete(first);
        }
        statusRegexCache.set(key, {...value, bytes});
        statusRegexCacheBytes += bytes;
    };
    // One total budget includes worker startup and every text/flag variant.
    await new Promise((resolve, reject) => {
        let worker, timer, settled = false;
        const finish = error => {
            if (settled) return;
            settled = true; clearTimeout(timer); worker?.terminate();
            signal?.removeEventListener('abort', cancel);
            if (error?.name === 'AbortError') { reject(error); return; }
            for (const job of pending) if (!statusRegexCache.has(statusRegexKey(job.source, job.flags, job.text))) remember(job, {error: '状态匹配未完成'});
            if (error) statusRegexWarn();
            resolve();
        };
        const cancel = () => finish(aborted());
        signal?.addEventListener('abort', cancel, {once: true});
        try {
            if (typeof Worker === 'undefined' || pending.length > 1000 || pending.some(job => job.source.length > 8192) || pending.reduce((sum, job) => sum + job.text.length, 0) > 4 * 1024 * 1024) throw new Error('状态匹配暂不可用');
            worker = new Worker('js/workers/status_regex_worker.js?v=20261116-status-budget');
            worker.onmessage = event => {
                if (settled) return;
                const value = event.data;
                if (value?.done) finish();
                else if (Number.isInteger(value?.index) && pending[value.index]) remember(pending[value.index], value);
            };
            worker.onerror = () => finish(new Error('状态匹配失败'));
            timer = setTimeout(() => finish(new Error('状态匹配超时')), 250);
            worker.postMessage({jobs: pending});
        } catch (error) { finish(error); }
    });
}
async function prepareStatusRegexHistory(chat, history, signal) {
    if (!chat?.statusPanel?.enabled || !chat.statusPanel.regexPattern) return;
    const raw = chat.statusPanel.regexPattern, parts = raw.match(/^\/(.*?)\/([a-z]*)$/);
    const source = parts ? parts[1] : raw, flags = [...new Set((parts?.[2] || 'gs') + 'gs')].join('');
    const texts = normalizeHistoryForAI(chat, history, true).filter(message => message.role === 'assistant')
        .flatMap(message => [message.content || '', ...(message.parts || []).filter(part => part.type === 'text').map(part => part.text || '')]);
    await prepareStatusRegexJobs([...new Set(texts)].map(text => ({source, flags, text})), signal);
}
let statusRenderJobs = [], statusRenderPreparation;
function prepareStatusRegexRender(job) {
    statusRenderJobs.push(job);
    if (!statusRenderPreparation) statusRenderPreparation = Promise.resolve().then(async () => {
        const jobs = statusRenderJobs;
        statusRenderJobs = []; statusRenderPreparation = null;
        await prepareStatusRegexJobs(jobs);
    });
    return statusRenderPreparation;
}

// Local settings only. Chat/archive changes use beginChatMutation instead.
const pendingLocalSettingsFields = new WeakMap();
async function saveLocalSettingsFields(changes) {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const fields = changes.flatMap(({ target, values }) => Object.entries(values).map(([key, value]) => {
        let keys = pendingLocalSettingsFields.get(target);
        if (!keys) pendingLocalSettingsFields.set(target, keys = new Map());
        let chain = keys.get(key);
        if (!chain) keys.set(key, chain = []);
        const field = { target, key, before: clone(target[key]), value, chain, pending: true };
        chain.push(field);
        return field;
    }));
    for (const field of fields) field.target[field.key] = field.value;
    for (const field of fields) field.applied = clone(field.target[field.key]);
    try {
        await saveData();
        return true;
    } catch (error) {
        for (const field of [...fields].reverse()) {
            const index = field.chain.indexOf(field);
            const later = field.chain.slice(index + 1);
            // A later edit may have taken its previous value from this failed save.
            const next = later[0];
            if (next && JSON.stringify(next.before) === JSON.stringify(field.applied)) next.before = clone(field.before);
            field.chain.splice(index, 1);
            if (later.length || JSON.stringify(field.target[field.key]) !== JSON.stringify(field.applied)) continue;
            if (field.before === undefined) delete field.target[field.key];
            else field.target[field.key] = clone(field.before);
        }
        console.error('保存本地设置失败:', error);
        showToast('设置未保存，已恢复本次修改，请重试');
        return false;
    } finally {
        for (const field of fields) {
            field.pending = false;
            if (!field.chain.some(entry => entry.pending)) pendingLocalSettingsFields.get(field.target).delete(field.key);
        }
    }
}

function escapeMessageRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 只扩展送给记忆整理的事实资料，不改变原有提示词模板。
function memoryMessageContent(message) {
    const content = String(message.content || '');
    if (!message.quote || message.isWithdrawn) return content;
    return `引用 ${message.quote.senderName || ''}：${message.quote.content || ''}\n${content}`;
}

// 电池状态更新
async function updateBatteryStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            const batteryLevelText = document.getElementById('battery-level');
            const batteryFillRect = document.getElementById('battery-fill-rect');

            const updateDisplay = () => {
                if (!batteryLevelText || !batteryFillRect) return;
                const level = Math.floor(battery.level * 100);
                batteryLevelText.textContent = `${level}%`;
                batteryFillRect.setAttribute('width', 18 * battery.level);
                let fillColor = "#666"; 
                if (battery.charging) {
                    fillColor = "#4CAF50"; 
                } else if (level <= 20) {
                    fillColor = "#f44336"; 
                }
                batteryFillRect.setAttribute('fill', fillColor);
            };

            updateDisplay();
            battery.addEventListener('levelchange', updateDisplay);
            battery.addEventListener('chargingchange', updateDisplay);

        } catch (error) {
            console.error('无法获取电池信息:', error);
            const batteryWidget = document.querySelector('.widget-battery');
            if (batteryWidget) batteryWidget.style.display = 'none';
        }
    } else {
        const batteryWidget = document.querySelector('.widget-battery');
        if (batteryWidget) batteryWidget.style.display = 'none';
    }
}

// 随机获取 API Key
function getRandomValue(str) {
    if (str && str.includes(',')) {
        const arr = str.split(',').map(item => item.trim());
        const randomIndex = Math.floor(Math.random() * arr.length);
        return arr[randomIndex];
    }
    return str;
}

// 图片压缩工具
async function compressImage(file, options = {}) {
    const { quality = 0.8, maxWidth = 800, maxHeight = 800 } = options;

    if (file.type === 'image/gif') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    if (![maxWidth, maxHeight].every(value => Number.isFinite(value) && value >= 1)) {
        throw new RangeError('图片尺寸上限必须是至少1像素的有效数字');
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                try {
                    let width = img.width;
                    let height = img.height;
                    if (!(width > 0 && height > 0)) throw new Error('图片尺寸无效');

                    // 同时满足两个上限，小图保持原尺寸。
                    const scale = Math.min(1, Math.floor(maxWidth) / width, Math.floor(maxHeight) / height);
                    width = Math.max(1, Math.round(width * scale));
                    height = Math.max(1, Math.round(height * scale));

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) throw new Error('无法创建图片画布');

                    if (file.type === 'image/png') {
                        ctx.fillStyle = '#FFFFFF';
                        ctx.fillRect(0, 0, width, height);
                    }

                    ctx.drawImage(img, 0, 0, width, height);
                    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                    resolve(compressedDataUrl);
                } catch (error) {
                    reject(error);
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// 数字补零
const pad = (num) => num.toString().padStart(2, '0');

// UUID 生成器
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Toast 通知系统
let notificationQueue = [];
let isToastVisible = false;

function processToastQueue() {
    if (isToastVisible || notificationQueue.length === 0) {
        return;
    }

    isToastVisible = true;
    const notification = notificationQueue.shift();

    const toastElement = document.getElementById('toast-notification');
    const avatarEl = toastElement.querySelector('.toast-avatar');
    const nameEl = toastElement.querySelector('.toast-name');
    const messageEl = toastElement.querySelector('.toast-message');

    const isRichNotification = typeof notification === 'object' && notification !== null && notification.name;

    if (isRichNotification) {
        toastElement.classList.remove('simple');
        avatarEl.style.display = 'block';
        nameEl.style.display = 'block';
        messageEl.style.textAlign = 'left';
        avatarEl.src = notification.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        nameEl.textContent = notification.name;
        messageEl.textContent = notification.message;
    } else {
        toastElement.classList.add('simple');
        avatarEl.style.display = 'none';
        nameEl.style.display = 'none';
        messageEl.style.textAlign = 'center';
        messageEl.textContent = notification;
    }

    toastElement.classList.add('show');

    setTimeout(() => {
        toastElement.classList.remove('show');
        setTimeout(() => {
            isToastVisible = false;
            processToastQueue();
        }, 500);
    }, 3000);
}

const showToast = (notification) => {
    notificationQueue.push(notification);
    processToastQueue();
};

// 触感反馈工具
let hasUserInteracted = false;
['click', 'touchstart', 'mousedown'].forEach(evt => {
    document.addEventListener(evt, () => { hasUserInteracted = true; }, { once: true });
});

function triggerHapticFeedback(type = 'light') {
    if (!navigator.vibrate || !hasUserInteracted) return;

    try {
        switch (type) {
            case 'light':
                navigator.vibrate(5); // 极轻微震动
                break;
            case 'medium':
                navigator.vibrate(15); // 中等震动
                break;
            case 'heavy':
                navigator.vibrate(30); // 重度震动
                break;
            case 'success':
                navigator.vibrate([10, 30, 10]); // 成功震动模式
                break;
            case 'error':
                navigator.vibrate([50, 30, 50, 30, 50]); // 错误震动模式
                break;
            case 'selection':
                navigator.vibrate(10); // 选择震动
                break;
            default:
                navigator.vibrate(5);
        }
    } catch (e) {
        // 忽略不支持或被禁用的情况
    }
}

// 错误处理翻译
function getFriendlyErrorMessage(error) {
    if (error.name === 'AbortError') return '请求超时了，请检查您的网络或稍后再试。';
    if (error instanceof SyntaxError) return '服务器返回的数据格式不对，建议您重试一次。';
    
    if (error.response) {
        const status = error.response.status;
        switch (status) {
            case 400: return '请求参数有误 (400)，通常是模型版本不对或发送内容过长。';
            case 401: return 'API密钥无效 (401)，请检查API设置中的Key是否正确。';
            case 403: return '访问被拒绝 (403)，可能是密钥权限不足或账号被封禁。';
            case 404: return 'API地址错误 (404)，找不到请求的接口，请检查Base URL。';
            case 429: return '请求太频繁啦 (429)，触发了速率限制，请稍等一会再试。';
            case 500: return '服务器内部错误 (500)，服务商那边出问题了。';
            case 502: return '网关错误 (502)，服务商网络异常。';
            case 503: return '服务暂时不可用 (503)，服务器可能正在维护或过载。';
            case 504: return '网关超时 (504)，服务器响应太慢了，请检查网络。';
            default: return `服务器返回了一个错误 (状态码: ${status})，请稍后再试。`;
        }
    }

    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        return '无法连接到服务器，请检查您的网络连接或API地址是否正确。';
    }

    return `发生了一个未知错误：${error.message}`;
}

// 显示错误弹窗
function showErrorModal(friendlyMessage, fullError) {
    const oldModal = document.getElementById('error-modal-overlay');
    if (oldModal) oldModal.remove();

    let logContent = `Error: ${fullError.name}: ${fullError.message}\n`;
    if (fullError.stack) logContent += `\nStack:\n${fullError.stack}\n`;
    if (fullError.response) {
        logContent += `\nResponse Status: ${fullError.response.status}\n`;
    }

    const modalHtml = `
    <div id="error-modal-overlay" class="modal-overlay visible" style="z-index: 9999; align-items: center; justify-content: center; display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px);">
        <div class="modal-window" style="max-width: 85%; width: 320px; padding: 0; overflow: hidden; display: flex; flex-direction: column; border-radius: 20px; background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,0.2); position: relative;">
            <div style="padding: 30px 20px 20px; text-align: center;">
                <div style="width: 60px; height: 60px; background: #ffebee; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
                    <svg style="width: 32px; height: 32px; color: #d32f2f;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
                <h3 style="margin: 0 0 10px; color: #333; font-size: 18px; font-weight: 700;">出错了</h3>
                <p class="error-friendly-message" style="margin: 0; color: #666; font-size: 15px; line-height: 1.5;"></p>
            </div>
            <div style="padding: 0 20px 25px; display: flex; flex-direction: column; gap: 10px;">
                <button id="copy-error-btn" style="width: 100%; border-radius: 12px; font-weight: 600; font-size: 15px; padding: 12px; background: #f5f5f5; color: #555; border: none; display: flex; justify-content: center; align-items: center; cursor: pointer; transition: all 0.2s;">
                    <svg style="width: 16px; height: 16px; margin-right: 6px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    一键复制完整日志
                </button>
                <button id="close-error-modal-btn" style="width: 100%; border-radius: 12px; font-weight: 600; font-size: 16px; padding: 12px; background: #007aff; color: #fff; border: none; cursor: pointer;">
                    我知道了
                </button>
            </div>
        </div>
    </div>
    `;

    // 使用 DOMParser 或临时元素来确保我们能直接操作生成的 DOM
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = modalHtml;
    const modalOverlay = tempDiv.firstElementChild;
    modalOverlay.querySelector('.error-friendly-message').textContent = String(friendlyMessage);
    document.body.appendChild(modalOverlay);

    // 绑定关闭按钮
    const closeBtn = document.getElementById('close-error-modal-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            modalOverlay.remove();
        });
    }

    document.getElementById('copy-error-btn').addEventListener('click', function() {
        navigator.clipboard.writeText(logContent).then(() => {
            this.innerHTML = `<svg style="width: 16px; height: 16px; margin-right: 6px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg>已复制`;
            this.style.background = '#e8f5e9';
            this.style.color = '#2e7d32';
            setTimeout(() => {
                this.innerHTML = `<svg style="width: 16px; height: 16px; margin-right: 6px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>一键复制完整日志`;
                this.style.background = '#f5f5f5';
                this.style.color = '#555';
            }, 2000);
        });
    });
}

function showApiError(error) {
    console.error("API Error Detected:", error);
    const friendlyMessage = getFriendlyErrorMessage(error);
    showErrorModal(friendlyMessage, error);
}

// 格式化时间分割线
function formatTimeDivider(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    
    const isSameYear = date.getFullYear() === now.getFullYear();
    
    const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    
    if (isToday) {
        return timeStr;
    } else if (isYesterday) {
        return `昨天 ${timeStr}`;
    } else if (isSameYear) {
        return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
    } else {
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
    }
}

// 格式化时间戳 YYYY-MM-DD HH:MM:SS
function getFormattedTimestamp(date) {
    const Y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const D = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

// 格式化时间差
function formatTimeGap(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}天${hours % 24}小时`;
    if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
    if (minutes > 0) return `${minutes}分钟`;
    return `${seconds}秒`;
}

function calculateVoiceDuration(text) {
    return Math.max(1, Math.min(60, Math.ceil(text.length / 3.5)));
}

// 模板处理函数：替换头像、名字等变量
function processTemplate(html, char) {
    if (!html || !char) return html;
    let processed = html;
    
    // 获取当前上下文中的头像和名字
    // 注意：currentChatType 和 db 是全局变量，确保在此处可用
    const isPrivate = (typeof currentChatType !== 'undefined' && currentChatType === 'private');
    
    let userAvatar, charAvatar, userName, userRemark, charName, charRemark;

    if (isPrivate) {
        userAvatar = char.myAvatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        charAvatar = char.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        userName = char.myName || 'User';
        userRemark = (char.myRemarkName && char.myRemarkName.trim()) || userName;
        charName = char.realName || 'Character';
        charRemark = char.remarkName || charName;
    } else {
        // 群聊逻辑
        userAvatar = (char.me && char.me.avatar) ? char.me.avatar : 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        charAvatar = char.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg'; // 群头像
        userName = (char.me && char.me.nickname) ? char.me.nickname : 'User';
        userRemark = userName;
        charName = char.name || 'Group';
        charRemark = charName;
    }

    // 简单变量替换
    processed = processed.replace(/{{user_avatar}}/g, userAvatar);
    processed = processed.replace(/{{char_avatar}}/g, charAvatar);
    processed = processed.replace(/{{user_name}}/g, userName);
    processed = processed.replace(/{{char_name}}/g, charName);
    processed = processed.replace(/{{char_remark}}/g, charRemark);
    processed = processed.replace(/{{user_remark}}/g, userRemark);

    // 标签替换 (支持可选的 style 和 class 属性)
    // <user-avatar class="..." style="..."> -> <img src="..." class="uwu-user-avatar ..." style="...">
    processed = processed.replace(/<user-avatar([^>]*)>\s*(?:<\/user-avatar>)?/gi, (match, attrs) => {
        return `<img src="${userAvatar}" class="uwu-user-avatar" ${attrs}>`;
    });

    processed = processed.replace(/<char-avatar([^>]*)>\s*(?:<\/char-avatar>)?/gi, (match, attrs) => {
        return `<img src="${charAvatar}" class="uwu-char-avatar" ${attrs}>`;
    });

    return processed;
}

// 解析混合内容 (文本+HTML)
function getMixedContent(responseData) {
    const results = [];
    let i = 0;

    while (i < responseData.length) {
        const nextTagStart = responseData.indexOf('<', i);
        const nextBracketStart = responseData.indexOf('[', i);

        let firstSpecialIndex = -1;
        if (nextTagStart !== -1 && nextBracketStart !== -1) {
            firstSpecialIndex = Math.min(nextTagStart, nextBracketStart);
        } else {
            firstSpecialIndex = Math.max(nextTagStart, nextBracketStart);
        }

        if (firstSpecialIndex === -1) {
            const text = responseData.substring(i).trim();
            if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
            break;
        }

        if (firstSpecialIndex > i) {
            const text = responseData.substring(i, firstSpecialIndex).trim();
            if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
        }

        i = firstSpecialIndex;

        if (responseData[i] === '<') {
            const tagMatch = responseData.substring(i).match(/^<([a-zA-Z0-9\u4e00-\u9fa5_.-]+)/);
            if (tagMatch) {
                const tagName = tagMatch[1];
                let openCount = 0;
                let searchIndex = i;
                let blockEnd = -1;

                while (searchIndex < responseData.length) {
                    const openTagPos = responseData.indexOf('<' + tagName, searchIndex);
                    const closeTagPos = responseData.indexOf('</' + tagName, searchIndex);

                    if (openTagPos !== -1 && (closeTagPos === -1 || openTagPos < closeTagPos)) {
                        openCount++;
                        searchIndex = openTagPos + 1;
                    } else if (closeTagPos !== -1) {
                        openCount--;
                        searchIndex = closeTagPos + 1;
                        if (openCount === 0) {
                            blockEnd = closeTagPos + `</${tagName}>`.length;
                            break;
                        }
                    } else {
                        break; 
                    }
                }

                if (blockEnd !== -1) {
                    const htmlBlock = responseData.substring(i, blockEnd);
                    let char = null;
                    const charMatch = htmlBlock.match(/<[a-z][a-z0-9]*\s+char="([^"]*)"/i);
                    if (charMatch) {
                        char = charMatch[1];
                    } else if (tagName.endsWith('转发的聊天记录')) {
                        char = tagName.replace('转发的聊天记录', '');
                    }
                    results.push({ type: 'html', char: char, content: htmlBlock });
                    i = blockEnd;
                    continue;
                }
            }
        }
        
        if (responseData[i] === '[') {
            const endBracket = responseData.indexOf(']', i);
            if (endBracket !== -1) {
                const text = responseData.substring(i, endBracket + 1);
                results.push({ type: 'text', content: text });
                i = endBracket + 1;
                continue;
            }
        }

        const nextSpecial1 = responseData.indexOf('<', i + 1);
        const nextSpecial2 = responseData.indexOf('[', i + 1);
        let endOfText = -1;
        if (nextSpecial1 !== -1 && nextSpecial2 !== -1) {
            endOfText = Math.min(nextSpecial1, nextSpecial2);
        } else {
            endOfText = Math.max(nextSpecial1, nextSpecial2);
        }
        if (endOfText === -1) {
            endOfText = responseData.length;
        }
        const text = responseData.substring(i, endOfText).trim();
        if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
        i = endOfText;
    }
    return results;
}

// 过滤聊天记录用于 AI 上下文 (包含状态栏剔除和双语格式化)
function normalizeHistoryForAI(chat, historySlice, ignoreContextDisabled = false) {
    // 1. 基础过滤：深度克隆并过滤掉被屏蔽上下文的消息
    let filteredHistory = JSON.parse(JSON.stringify(historySlice || chat.history));
    filteredHistory = filteredHistory.filter(m => !m.relationshipDelivery);
    if (!ignoreContextDisabled) {
        filteredHistory = filteredHistory.filter(m => !m.isContextDisabled);
    }

    // 【三重保险】强制清洗所有消息内容中的 <thinking> 标签块
    // 防止思维链内容意外混入普通消息中
    filteredHistory.forEach(msg => {
        if (msg.content && typeof msg.content === 'string') {
            msg.content = msg.content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
        }
        if (msg.parts && Array.isArray(msg.parts)) {
            msg.parts.forEach(p => {
                if (p.type === 'text' && p.text) {
                    p.text = p.text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
                }
            });
        }
    });

    // 2. 双语模式格式标准化
    if (chat.bilingualModeEnabled) {
        filteredHistory.forEach(msg => {
            if (msg.role === 'assistant') {
                if (msg.content) {
                    msg.content = msg.content.replace(/[\s\n]*[\(（]([^\)）]+)[\)）]([\s\n]*\])$/, '「$1」$2');
                    msg.content = msg.content.replace(/[\s\n]*[\(（]([^\)）]+)[\)）]$/, '「$1」');
                }
                if (msg.parts && Array.isArray(msg.parts)) {
                    msg.parts.forEach(p => {
                        if (p.type === 'text' && p.text) {
                            p.text = p.text.replace(/[\s\n]*[\(（]([^\)）]+)[\)）]([\s\n]*\])$/, '「$1」$2');
                            p.text = p.text.replace(/[\s\n]*[\(（]([^\)）]+)[\)）]$/, '「$1」');
                        }
                    });
                }
            }
        });
    }

    return filteredHistory;
}

function filterHistoryForAI(chat, historySlice, ignoreContextDisabled = false) {
    let filteredHistory = normalizeHistoryForAI(chat, historySlice, ignoreContextDisabled);
    // 3. 状态栏移除逻辑
    if (chat.statusPanel && chat.statusPanel.enabled && chat.statusPanel.regexPattern) {
        const currentRegexStr = chat.statusPanel.regexPattern;
        const limit = chat.statusPanel.historyLimit !== undefined ? chat.statusPanel.historyLimit : 3;
        const validityDepth = 50;
        let statusCount = 0;
        const totalSliceLength = filteredHistory.length;

        let currentRegexParsed = currentRegexStr;
        const regexMatch = currentRegexStr.match(/^\/(.*?)\/([a-z]*)$/);
        if (regexMatch) {
            currentRegexParsed = regexMatch[1];
        }

        // 3.1 预处理
        filteredHistory = filteredHistory.filter((msg, index) => {
            if (msg.isStatusUpdate) {
                const depth = totalSliceLength - 1 - index;
                if (depth >= validityDepth) return false;
                if (!msg.statusSnapshot) return false;
                if (msg.statusSnapshot.regex !== currentRegexParsed) return false;
                return true;
            }
            return true;
        });

        // 3.2 遍历处理
        for (let i = filteredHistory.length - 1; i >= 0; i--) {
            const msg = filteredHistory[i];
            const currentDepth = filteredHistory.length - 1 - i;
            
            if (msg.isStatusUpdate) {
                if (statusCount < limit) {
                    statusCount++;
                } else {
                    msg.content = '';
                    msg.parts = [];
                }
                continue;
            }

            let pattern = chat.statusPanel.regexPattern;
            let flags = 'gs';
            const matchParts = pattern.match(/^\/(.*?)\/([a-z]*)$/);
            if (matchParts) {
                pattern = matchParts[1];
                flags = matchParts[2] || 'gs';
                if (!flags.includes('g')) flags += 'g';
                if (!flags.includes('s')) flags += 's';
            }
            let regex;
            try {
                regex = createStatusRegex(pattern, flags);
            } catch (e) {
                console.error("Invalid regex in status panel settings:", e);
                continue;
            }

            if (msg.role === 'assistant') {
                const originalContent = msg.content || '';
                const newContent = originalContent.replace(regex, '').trim();
                const contentHasMatch = (newContent !== originalContent);

                let partsHasMatch = false;
                let newParts = undefined;
                
                if (msg.parts && Array.isArray(msg.parts)) {
                    newParts = msg.parts.map(p => {
                        if (p.type === 'text') {
                            try {
                                const partRegex = createStatusRegex(pattern, flags);
                                const newText = p.text.replace(partRegex, '').trim();
                                if (newText !== p.text) partsHasMatch = true;
                                return { ...p, text: newText };
                            } catch (e) {
                                return p;
                            }
                        }
                        return p;
                    }).filter(p => {
                        if (p.type === 'text') return p.text !== '';
                        return true;
                    });
                }

                if (contentHasMatch || partsHasMatch) {
                    if (currentDepth < validityDepth && statusCount < limit) {
                        statusCount++;
                    } else {
                        if (contentHasMatch) msg.content = newContent;
                        if (partsHasMatch && newParts) msg.parts = newParts;
                        if (!msg.content && (!msg.parts || msg.parts.length === 0)) {
                            msg.content = '';
                        }
                    }
                }
            }
        }

        // 3.3 最终过滤
        filteredHistory = filteredHistory.filter(msg => {
            const hasContent = msg.content && msg.content.trim() !== '';
            const hasParts = msg.parts && msg.parts.length > 0;
            return hasContent || hasParts;
        });
    }

    return filteredHistory;
}

function resolveAuxiliaryApiConfig(featureKey, fallbackConfig = null) {
    const primaryConfig = fallbackConfig || (db.apiSettings || {});
    const secondary = db.apiSettings && db.apiSettings.secondary;
    const shouldUseSecondary = secondary
        && secondary.enabled
        && secondary.routes
        && secondary.routes[featureKey];

    if (!shouldUseSecondary) return primaryConfig;

    return {
        ...primaryConfig,
        provider: secondary.provider || 'newapi',
        url: secondary.url || '',
        key: secondary.key || '',
        model: secondary.model || ''
    };
}

function resolveWorkshopLlmApiConfig() {
    const primaryConfig = db.apiSettings || {};
    const settings = db.workshopSettings || {};
    const isGptWorkshop = settings.provider === 'gpt';
    const independentEnabled = isGptWorkshop
        ? settings.gptLlmIndependentApi
        : settings.llmIndependentApi;
    const presetId = isGptWorkshop
        ? settings.gptLlmApiPresetId
        : settings.llmApiPresetId;

    if (!independentEnabled || !presetId) return primaryConfig;

    const presets = Array.isArray(db.apiPresets) ? db.apiPresets : [];
    const preset = presets.find(item => item.id === presetId || item.name === presetId);
    if (!preset || !preset.data) return primaryConfig;

    const independentConfig = {
        ...primaryConfig,
        url: preset.data.apiUrl || '',
        key: preset.data.apiKey || '',
        model: preset.data.model || '',
        provider: preset.data.provider || 'newapi',
        temperatureEnabled: preset.data.temperatureEnabled,
        temperature: preset.data.temperature
    };

    return independentConfig.url && independentConfig.key && independentConfig.model
        ? independentConfig
        : primaryConfig;
}

function resolveChatCompletionsEndpoint(value) {
    const url = String(value || '').trim();
    const suffixAt = url.search(/[?#]/);
    const path = (suffixAt < 0 ? url : url.slice(0, suffixAt)).replace(/\/+$/, '');
    const suffix = suffixAt < 0 ? '' : url.slice(suffixAt);
    if (path.endsWith('/chat/completions')) return path + suffix;
    return path + (/\/v\d+(?:beta\d*)?$/.test(path) ? '' : '/v1') + '/chat/completions' + suffix;
}

function buildChatApiRequest(apiConfig, messages, options = {}) {
    const { provider, model } = apiConfig;
    const key = apiConfig.key || '';
    const url = (apiConfig.url || '').replace(/\/$/, '');
    const temperature = options.temperature;

    if (provider === 'gemini') {
        let systemText = '';
        const contents = [];
        messages.forEach(message => {
            if (message.role === 'system') {
                systemText += `${message.content}\n\n`;
                return;
            }
            contents.push({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }]
            });
        });

        const requestBody = { contents };
        if (systemText.trim()) {
            requestBody.system_instruction = { parts: [{ text: systemText.trim() }] };
        }
        if (temperature !== undefined || options.topP !== undefined) {
            requestBody.generationConfig = {};
            if (temperature !== undefined) requestBody.generationConfig.temperature = temperature;
            if (options.topP !== undefined) requestBody.generationConfig.topP = options.topP;
        }

        return {
            endpoint: `${url}/v1beta/models/${model}:generateContent?key=${getRandomValue(key)}`,
            headers: { 'Content-Type': 'application/json' },
            requestBody
        };
    }

    const endpoint = resolveChatCompletionsEndpoint(url);
    const requestBody = { model, messages };
    if (temperature !== undefined) requestBody.temperature = temperature;
    if (options.topP !== undefined) requestBody.top_p = options.topP;

    return {
        endpoint,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        },
        requestBody
    };
}

// Transport-only response validation. No prompt, history or CoT decisions belong here.
function checkAiResponseError(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('API返回数据格式异常，期待JSON对象。');
    }
    if (data.error) {
        const detail = typeof data.error === 'string' ? data.error : data.error.message;
        const code = typeof data.error === 'object' ? data.error.code || data.error.type : '';
        const error = new Error('API返回错误' + (code ? ' [' + String(code).slice(0, 80) + ']' : '') +
            (typeof detail === 'string' ? '：' + detail.slice(0, 300) : '，请检查接口配置。'));
        error.code = 'AI_PROVIDER_ERROR';
        throw error;
    }
}

function extractAiResponseText(data, provider, stream = false) {
    if (provider === 'gemini' && Array.isArray(data)) {
        const text = data.map(item => extractAiResponseText(item, provider, true)).join('');
        if (!stream && !text.trim()) throw new Error('API未返回有效的回复文本，请检查模型响应。');
        return text;
    }
    checkAiResponseError(data);
    let text;
    if (provider === 'gemini') {
        const candidate = data.candidates?.[0];
        const blocked = data.promptFeedback?.blockReason ||
            (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(candidate?.finishReason) ? candidate.finishReason : '');
        if (blocked) throw new Error('API未返回回复文本，模型拦截原因：' + String(blocked).slice(0, 80));
        const parts = candidate?.content?.parts;
        if (parts !== undefined && !Array.isArray(parts)) throw new Error('API返回文本格式异常，parts应为数组。');
        text = (parts || []).map(part => {
            if (part?.text === undefined) return '';
            if (typeof part.text !== 'string') throw new Error('API返回文本格式异常。');
            return part.text;
        }).join('');
    } else {
        const choice = data.choices?.[0];
        text = stream ? choice?.delta?.content ?? choice?.message?.content : choice?.message?.content;
        if (text !== undefined && text !== null && typeof text !== 'string') {
            throw new Error('API返回文本格式异常，content应为字符串。');
        }
        text = text || '';
    }
    if (!stream && !text.trim()) throw new Error('API未返回有效的回复文本，请检查模型响应。');
    return text;
}

function parseAiResponseJson(text) {
    try { return JSON.parse(text); }
    catch (_) { throw new Error('API返回了无法解析的JSON数据，请检查API地址及响应格式。'); }
}

// 通用 AI 响应获取函数 (支持流式和非流式自动切换)
async function fetchAiResponse(settings, requestBody, headers, endpoint, forceStream = false, fetchOptions = {}) {
    const { provider } = settings;
    const streamEnabled = forceStream || settings.streamEnabled;
    if (streamEnabled) {
        if (provider === 'gemini') {
            endpoint = endpoint.replace(':generateContent', ':streamGenerateContent');
        } else {
            requestBody.stream = true;
        }
    }
    const response = await fetch(endpoint, {
        method: 'POST', headers, body: JSON.stringify(requestBody), signal: fetchOptions.signal
    });
    if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`API Error: ${response.status} ${errorText}`);
        error.response = response;
        throw error;
    }
    const contentType = response.headers.get('content-type') || '';
    if (streamEnabled || contentType.includes('text/event-stream')) return await readStreamResponse(response, provider);
    const text = await response.text();
    // Some compatible gateways omit the SSE header even in nonstream mode.
    if (/^\s*(?:data:|event:|:)/.test(text)) return await readStreamResponse(new Response(text), provider);
    return extractAiResponseText(parseAiResponseJson(text), provider);
}

async function readStreamResponse(response, provider, onUsage) {
    if (!response.body?.getReader) throw new Error('API未返回可读取的回复文本。');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', fullResponse = '', mode = '', ended = false, eof = false, receivedBytes = 0;
    // A bad proxy must not grow an unbounded JSON/event buffer in the browser.
    const maxResponseBytes = 16 * 1024 * 1024;
    const collect = (json, stream) => {
        const text = extractAiResponseText(json, provider, stream);
        const items = Array.isArray(json) ? json : [json];
        if (typeof onUsage === 'function') items.forEach(item => {
            const usage = item.usage || item.usageMetadata;
            if (usage) onUsage(usage);
        });
        fullResponse += text;
    };
    const consume = event => {
        const lines = event.split(/\r\n|\r|\n/);
        const data = lines.filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) return;
        if (data.trim() === '[DONE]') { ended = true; return; }
        const json = parseAiResponseJson(data);
        if (lines.some(line => /^event: *error\s*$/.test(line))) {
            checkAiResponseError(json);
            checkAiResponseError(json.error ? json : { error: json });
        }
        collect(json, true);
    };
    try {
        while (!ended) {
            const { done, value } = await reader.read();
            eof = done;
            receivedBytes += value?.byteLength || 0;
            if (receivedBytes > maxResponseBytes) throw new Error('API回复数据过大，已停止读取，请缩短单次输出后重试。');
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (!mode && buffer.trim()) mode = /^[{[]/.test(buffer.trimStart()) ? 'json' : 'sse';
            if (mode === 'sse') {
                let separator;
                while (!ended && (separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
                    consume(buffer.slice(0, separator.index));
                    buffer = buffer.slice(separator.index + separator[0].length);
                }
            }
            if (done) break;
        }
        if (mode === 'json') collect(parseAiResponseJson(buffer), false);
        else if (!ended && buffer.trim()) consume(buffer);
        if (!fullResponse.trim()) throw new Error('API未返回有效的回复文本，请检查模型响应。');
        return fullResponse;
    } finally {
        // Do not wait for a proxy to close after its protocol end/error event.
        if (!eof) { try { reader.cancel?.().catch?.(() => {}); } catch (_) {} }
        reader.releaseLock?.();
    }
}

// --- 图片查看器 ---
function openImageViewer(src) {
    const modal = document.getElementById('full-image-modal');
    const img = document.getElementById('full-image-view');
    const closeBtn = document.getElementById('close-full-image-btn');
    
    if (!modal || !img) return;
    
    img.src = src;
    modal.classList.add('visible');
    
    // 简单的关闭逻辑
    const closeModal = () => {
        modal.classList.remove('visible');
        setTimeout(() => { img.src = ''; }, 300); // 动画结束后清空
    };
    
    if (closeBtn) closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal || e.target.closest('.modal-window')) {
            // 点击图片本身不关闭，点击背景关闭
            if (e.target !== img) {
                closeModal();
            }
        }
    };
}

// 暴露给全局
window.openImageViewer = openImageViewer;
window.getRandomValue = getRandomValue;
window.pad = pad;
window.formatTimeGap = formatTimeGap;
window.filterHistoryForAI = filterHistoryForAI;
window.showToast = showToast;
window.playSound = (typeof playSound !== 'undefined') ? playSound : null; // 防止循环依赖
