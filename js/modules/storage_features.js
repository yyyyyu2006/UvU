// Additive backup UX. The existing transaction owns all persistent changes.
function storagePortableMusicSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('音乐设置格式无效');
    const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint : '';
    if (endpoint) { const value = new URL(endpoint); if ((value.protocol !== 'https:' && !(value.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname))) || value.username || value.password || value.search || value.hash) throw new Error('音乐服务地址无效'); }
    return { endpoint, providers: ['netease', 'qq'].filter(p => !Array.isArray(raw.providers) || raw.providers.includes(p)), publicSources: Array.isArray(raw.publicSources) && raw.publicSources.includes('gd-netease') ? ['gd-netease'] : [], remember: false };
}
function storageApplyExportOptions(modules, options = {}) {
    const result = { ...modules };
    if (result.musicSettings !== undefined) result.musicSettings = storagePortableMusicSettings(result.musicSettings);
    if (result.musicLibrary !== undefined) result.musicLibrary = window.UvUMusic.normalizeLibrary(result.musicLibrary);
    if (window.UvUMusicChat) {
        const cleanMessages = history => {
            if (!Array.isArray(history)) return history;
            let changed = false;
            const clean = history.map(message => {
                if (message.type === 'music') { changed = true; return { ...message, music: window.UvUMusicChat.portablePayload(message.music) }; }
                if (message.forwardedChat) { const records = cleanMessages(message.forwardedChat.records); if (records !== message.forwardedChat.records) { changed = true; return { ...message, forwardedChat: { ...message.forwardedChat, records } }; } }
                return message;
            });
            return changed ? clean : history;
        };
        for (const key of ['characters', 'groups']) if (Array.isArray(result[key])) result[key] = result[key].map(chat => {
            const history = cleanMessages(chat.history);
            const archives = chat.archives?.map(archive => { const history = cleanMessages(archive.data?.history); return history !== archive.data?.history ? { ...archive, data: { ...archive.data, history } } : archive; });
            if (history === chat.history && (!archives || archives.every((item, i) => item === chat.archives[i]))) return chat;
            return { ...chat, history, ...(archives ? { archives } : {}) };
        });
    }
    if (options.includeCredentials === false) {
        result._uvuBackup = { version: 1, credentialsOmitted: true };
        const redact = value => {
            if (!value || typeof value !== 'object') return value;
            if (Array.isArray(value)) return value.map(redact);
            return Object.fromEntries(Object.entries(value).map(([key, field]) =>
                [key, /^(key|apiKey|api_key|token|accessToken|refreshToken|password|authorization|gptApiKey|novelaiApiKey|rerankKey|rewriteKey)$/i.test(key) ? '' : redact(field)]));
        };
        for (const key of ['apiSettings', 'memoryApiSettings', 'vectorMemoryApiSettings', 'apiPresets', 'minimaxTtsSettings', 'environmentSettings', 'workshopSettings', 'workshopLlmPresets']) {
            if (result[key] !== undefined) result[key] = redact(result[key]);
        }
    }
    if (options.includeVectorIndex === false) {
        const omit = item => { const { memoryVectorIndex, ...rest } = item; return rest; };
        for (const key of ['characters', 'groups']) if (Array.isArray(result[key])) result[key] = result[key].map(chat => ({
            ...omit(chat), ...(chat.archives ? { archives: chat.archives.map(archive => ({ ...archive, data: omit(archive.data || {}) })) } : {})
        }));
    }
    return result;
}

function storageResolveImportOptions(modules, options = {}) {
    if (!modules?._uvuBackup?.credentialsOmitted || options.credentialMode === 'clear') return modules;
    const sensitive = /^(key|apiKey|api_key|token|accessToken|refreshToken|password|authorization|gptApiKey|novelaiApiKey|rerankKey|rewriteKey)$/i;
    const merge = (value, local) => {
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(item => {
            // Credentials in presets may only follow a stable identity, never an array position.
            const match = item?.id ? (Array.isArray(local) ? local.find(old => old?.id === item.id) : null) : null;
            return merge(item, match);
        });
        const endpointKeys = ['url', 'apiUrl', 'baseUrl', 'endpoint', 'provider'];
        const same = local && endpointKeys.every(key => value[key] === local[key]);
        const credentialDestinationMatches = key => {
            if (!same) return false;
            if (/^(gpt|novelai)ApiKey$/.test(key)) {
                const endpoint = key.replace('Key', 'Url');
                return typeof value[endpoint] === 'string' && Boolean(value[endpoint]) && value[endpoint] === local[endpoint];
            }
            if (key === 'rerankKey' || key === 'rewriteKey') {
                const field = key === 'rewriteKey' ? 'rewriteUrl' : 'rerankUrl';
                const endpoint = value[field] || (key === 'rerankKey' ? value.url : ''), previous = local[field] || (key === 'rerankKey' ? local.url : '');
                return typeof endpoint === 'string' && Boolean(endpoint) && endpoint === previous;
            }
            return true;
        };
        return Object.fromEntries(Object.entries(value).map(([key, field]) => [key,
            sensitive.test(key) && field === '' ? (credentialDestinationMatches(key) && typeof local[key] === 'string' ? local[key] : '')
                : merge(field, same ? local[key] : undefined)]));
    };
    const result = { ...modules };
    for (const key of ['apiSettings', 'memoryApiSettings', 'vectorMemoryApiSettings', 'apiPresets', 'minimaxTtsSettings', 'environmentSettings', 'workshopSettings', 'workshopLlmPresets']) {
        if (result[key] !== undefined) result[key] = merge(result[key], db[key]);
    }
    return result;
}

function storageDescribeImport(selection, modules) {
    const lines = ['仅处理本次勾选的分类；未勾选的聊天、人设、提示词和设置保留。'];
    if (modules._uvuBackup?.credentialsOmitted) lines.push('这是脱敏备份。空白凭据将按下方导入选项保留本机相同接口的密钥，或明确清空；不同地址不会沿用旧密钥。');
    if (selection.contacts || selection.chats) {
        for (const [key, name] of [['characters', '角色'], ['groups', '群聊']]) {
            const source = modules[key]; if (!Array.isArray(source)) continue;
            const ids = new Set((db[key] || []).map(item => item.id));
            const added = selection.contacts ? source.filter(item => !ids.has(item.id)).length : 0;
            const existing = source.filter(item => ids.has(item.id)).length;
            const skipped = selection.contacts ? 0 : source.length - existing;
            lines.push(`${name}：新增 ${added}，更新 ${existing}${skipped ? `，忽略未创建联系人 ${skipped}` : ''}；` +
                `${selection.contacts ? '角色设定' : '保留本地角色设定'}；${selection.chats ? '合并同ID聊天与存档' : '保留本地聊天与存档'}。`);
        }
    }
    for (const [key, name] of [['worldbooks', '世界书'], ['wallpapers', '壁纸与外观'], ['personas', '用户设定'], ['fonts', '字体'], ['settings', '基础设置'], ['other', '相册／工坊／阅读数据']]) {
        if (!selection[key]) continue;
        lines.push(name + (key === 'worldbooks' ? `：整表替换 ${modules.worldBooks?.length || 0} 项（文件缺少此表则保留）。`
            : key === 'wallpapers' ? `：恢复文件中提供的外观；表情整表替换 ${modules.myStickers?.length || 0} 项。`
            : key === 'other' ? '：恢复提供的缓存快照；未选择的类别保留。' : '：恢复文件中提供的字段；缺少的字段保留。'));
    }
    const available = new Set((selection.worldbooks && Array.isArray(modules.worldBooks) ? modules.worldBooks : db.worldBooks || []).map(book => book.id));
    let missing = 0;
    for (const key of ['characters', 'groups']) for (const chat of modules[key] || []) missing += (chat.worldBookIds || []).filter(id => !available.has(id)).length;
    if (missing) lines.push(`注意：发现 ${missing} 个世界书绑定在目标库中不存在，请核对世界书分类。不会自动删除这些绑定。`);
    lines.push('外链图片、字体及小组件内容仍依赖原地址；备份不会自动下载外部资源。API凭据是否存在由源备份决定，请勿向他人分享含密钥备份。');
    return lines.join('\n\n');
}

async function storageConfirmImport(selection, modules) {
    // Browser UI only. Tests and non-DOM consumers call storageCommitImport directly.
    if (typeof window.confirm !== 'function') return true;
    let capacity = '';
    try {
        if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
            const estimate = await navigator.storage.estimate();
            if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage))
                capacity = `\n\n浏览器报告剩余约 ${Math.max(0, Math.floor((estimate.quota - estimate.usage) / 1024 / 1024))} MB（估算，不保证本次写入成功）。`;
        }
    } catch (_) {}
    return window.confirm(storageDescribeImport(selection, modules) + capacity + '\n\n确认导入？取消不会写入数据。');
}

function storageBackupControls() {
    const status = document.getElementById('storage-backup-progress'), cancel = document.getElementById('storage-backup-cancel');
    const controller = new AbortController();
    if (cancel) { cancel.hidden = false; cancel.disabled = false; cancel.onclick = () => controller.abort(); }
    const progress = message => { if (status) status.textContent = message; };
    progress('正在解析备份；提交前可以取消。');
    return { signal: controller.signal, onProgress: value => progress(`已解析约 ${(value.decodedBytes / 1024 / 1024).toFixed(1)} MB 解压数据；正在读取所选分类…`),
        committing() { if (cancel) cancel.hidden = true; progress('校验已通过，正在事务提交；请保持页面打开。'); },
        finish(message) { if (cancel) { cancel.hidden = true; cancel.onclick = null; } progress(message); } };
}
