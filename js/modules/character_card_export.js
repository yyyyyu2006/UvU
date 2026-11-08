// Portable character projection only; no prompt construction or live-data writes.
(function (root) {
    'use strict';
    const MAX = 8 * 1024 * 1024;
    const clone = value => JSON.parse(JSON.stringify(value));
    const strings = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version'];
    const hidden = /^(?:proto|constructor|prototype|history|chathistory|memoryjournals|mypersona|userpersona|userprofile|userinfo|apisettings|memoryapisettings|vectormemoryapisettings|minimaxttssettings|mcpsettings|credentials|password|secret|token|authorization|cookie|pairing|pairingcode|paircode|pairtoken|pairingtoken)$/;
    const privateKey = key => { const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase(); return hidden.test(normalized) || /(?:apikey|apisecret|accesstoken|refreshtoken|bridgetoken|authtoken|bearertoken|sessiontoken)$/.test(normalized); };
    function safe(value, depth = 0, budget = { count: 0 }) {
        if (++budget.count > 100000 || depth > 24) throw new Error('角色卡数据结构过深或过大');
        if (value === null || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(item => safe(item, depth + 1, budget));
        return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKey(key)).map(([key, item]) => [key, safe(item, depth + 1, budget)]));
    }
    function retain(input) {
        const raw = JSON.stringify(input);
        if (!raw || raw.length > MAX || new TextEncoder().encode(raw).length > MAX) throw new Error('角色卡数据过大，超过 8 MiB 上限');
        if (!input || typeof input !== 'object' || Array.isArray(input) || input.spec && !['chara_card_v2', 'chara_card_v3'].includes(input.spec)) throw new Error('不支持的角色卡格式或版本');
        const source = input.data || input;
        if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 2000) throw new Error('角色卡缺少有效名称');
        const data = {};
        for (const key of strings) {
            const value = key === 'description' ? source.description ?? source.persona : source[key];
            if (value !== undefined && typeof value !== 'string') throw new Error('角色卡字段 ' + key + ' 必须为文字');
            data[key] = value || '';
        }
        // V1 cards may carry their world book as plain text rather than character_book.
        for (const key of ['world_info', 'wi']) {
            if (source[key] !== undefined && typeof source[key] !== 'string') throw new Error('角色卡世界书字段必须为文字：' + key);
            if (source[key]) data[key] = source[key];
        }
        for (const key of ['tags', 'alternate_greetings', 'group_only_greetings']) {
            if (source[key] !== undefined && (!Array.isArray(source[key]) || source[key].length > 3000 || source[key].some(item => typeof item !== 'string'))) throw new Error('角色卡列表字段无效：' + key);
            if (key !== 'group_only_greetings' || source[key]) data[key] = source[key]?.slice() || [];
        }
        if (source.extensions != null && (typeof source.extensions !== 'object' || Array.isArray(source.extensions))) throw new Error('角色卡扩展字段无效');
        data.extensions = safe(source.extensions || {});
        if (source.character_book !== undefined) {
            const book = source.character_book;
            if (!book || !Array.isArray(book.entries) || book.entries.length > 3000 || book.entries.some(entry => !entry || typeof entry.content !== 'string')) throw new Error('角色卡世界书条目无效');
            data.character_book = safe(book);
        }
        return { spec: input.spec || 'chara_card_v2', spec_version: input.spec === 'chara_card_v3' ? '3.0' : '2.0', data };
    }
    function bound(chat, books) {
        const ids = [...new Set((chat.worldBookIds || []).filter(id => typeof id === 'string'))];
        return { entries: ids.map(id => books.find(book => book.id === id && book.type !== 'folder')).filter(Boolean), missingIds: ids.filter(id => !books.some(book => book.id === id && book.type !== 'folder')) };
    }
    function groupPath(book, books) {
        const path = [], visited = new Set([book.id]); let parentId = book.parentId;
        while (parentId && !visited.has(parentId)) {
            visited.add(parentId); const parent = books.find(item => item.id === parentId && item.type === 'folder');
            if (!parent) break;
            if (!parent.cardImportRoot) path.unshift({ id: parent.id, name: parent.name || '未命名分组' });
            parentId = parent.parentId;
        }
        return path;
    }
    function source(chat, books) {
        const linked = bound(chat, books);
        return { name: chat.realName || chat.name || '', persona: chat.persona || '', avatar: chat.avatar || '', original: chat.characterCardSource || null,
            entries: linked.entries.map(book => ({ ...clone(book), exportGroupPath: groupPath(book, books) })), missingIds: linked.missingIds };
    }
    function capture(chat, books = db.worldBooks) {
        const data = source(chat, books), groups = [];
        for (const entry of data.entries) {
            const path = entry.exportGroupPath, key = path[0]?.id || entry.id;
            let group = groups.find(item => item.id === key);
            if (!group) { group = { id: key, name: path[0]?.name || entry.name || '未命名世界书', entries: [] }; groups.push(group); }
            group.entries.push(entry);
        }
        return { chat, archiveId: chat.activeArchiveId, history: chat.history, data, groups, missingIds: data.missingIds, stamp: JSON.stringify(data) };
    }
    function isCurrent(scope) {
        return db.characters.includes(scope.chat) && scope.chat.activeArchiveId === scope.archiveId && scope.chat.history === scope.history && scope.stamp === JSON.stringify(source(scope.chat, db.worldBooks));
    }
    const number = (value, fallback, min = 0, max = 9999) => Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.min(max, Math.max(min, Number(value))) : fallback;
    const keys = value => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\n]/) : []).map(String).map(item => item.trim()).filter(Boolean);
    function bookEntry(book, index) {
        const rules = book.rules || {}, advanced = rules.advancedEnabled === true;
        const original = { position: book.position || 'before', depth: book.depth ?? 100 };
        if (book.rules) original.rules = safe(book.rules);
        const inherited = safe(book.importSource?.extensions || {}); delete inherited.uvu;
        const position = book.position || 'before';
        return { id: index, name: book.name || '', comment: book.name || '', content: book.content || '',
            keys: advanced ? keys(rules.keys) : [], secondary_keys: advanced ? keys(rules.secondaryKeys) : [],
            enabled: !rules.unsupportedPosition && (!advanced || rules.enabled !== false), constant: !advanced || rules.constant === true,
            selective: advanced && rules.selective !== false, insertion_order: advanced ? number(rules.order, book.depth ?? 100) : number(book.depth, 100),
            position: position === 'after' ? 'after_char' : 'before_char',
            extensions: { ...inherited, position: position === 'chat' ? 4 : position === 'after' ? 1 : position === 'before' ? 0 : position,
                probability: advanced ? number(rules.probability, 100, 0, 100) : 100, useProbability: advanced,
                selectiveLogic: number(rules.selectiveLogic, 0, 0, 3), depth: number(rules.chatDepth, 4), scanDepth: number(rules.scanDepth, 20),
                role: ['system', 'user', 'assistant'].includes(rules.role) ? rules.role : 'system',
                caseSensitive: rules.caseSensitive === true, matchWholeWords: rules.wholeWords === true,
                uvu: { version: 1, groupPath: book.exportGroupPath.map(group => group.name), original } } };
    }
    function build(scope, selectedIds, metadata = {}) {
        if (!Array.isArray(selectedIds) || selectedIds.length > 3000) throw new Error('世界书选择无效或超过上限');
        const selected = new Set(selectedIds), available = new Set(scope.data.entries.map(book => book.id));
        if ([...selected].some(id => !available.has(id))) throw new Error('选择包含未绑定或不存在的世界书');
        const previous = scope.data.original ? retain(scope.data.original).data : {}, data = {};
        for (const key of strings) data[key] = previous[key] || '';
        data.name = scope.data.name; data.description = scope.data.persona;
        if (metadata.creator !== undefined) data.creator = String(metadata.creator).slice(0, 2000);
        if (metadata.version !== undefined) data.character_version = String(metadata.version).slice(0, 200);
        data.tags = previous.tags || []; data.alternate_greetings = previous.alternate_greetings || [];
        data.extensions = safe(previous.extensions || {}); delete data.extensions.uvu;
        data.extensions.uvu = { version: 1 };
        if (root.UvUCardCover && (metadata.cover || previous.extensions?.uvu?.cover)) data.extensions.uvu.cover = root.UvUCardCover.profile({ ...data, extensions: previous.extensions }, metadata.cover || {});
        const books = scope.data.entries.filter(book => selected.has(book.id)).sort((a, b) => {
            const order = book => book.rules?.advancedEnabled ? number(book.rules.order, book.depth ?? 100) : number(book.depth, 100);
            return order(a) - order(b);
        });
        if (books.length) {
            const originalBook = previous.character_book || {}, settings = {};
            if (typeof originalBook.description === 'string') settings.description = originalBook.description;
            for (const key of ['scan_depth', 'token_budget']) if (Number.isFinite(originalBook[key]) && originalBook[key] >= 0) settings[key] = originalBook[key];
            if (typeof originalBook.recursive_scanning === 'boolean') settings.recursive_scanning = originalBook.recursive_scanning;
            const extensions = safe(originalBook.extensions || {}); delete extensions.uvu;
            data.character_book = { ...settings, name: data.name + ' · 配套世界书', extensions: { ...extensions, uvu: { version: 1 } }, entries: books.map(bookEntry) };
        }
        return retain({ spec: 'chara_card_v2', spec_version: '2.0', data });
    }
    root.UvUCharacterCard = { capture, isCurrent, build, retain };
})(typeof window !== 'undefined' ? window : globalThis);
