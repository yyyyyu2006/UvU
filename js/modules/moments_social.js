// Opt-in social data is archive-owned; ordinary conversation assembly is untouched.
(function (root) {
    'use strict';
    const saving = new WeakSet();
    const clone = value => JSON.parse(JSON.stringify(value));
    const id = prefix => prefix + '_' + (root.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
    const defaults = () => ({ version: 1, enabled: false, charReplies: true, npcsEnabled: true, npcThreads: true, maxReplies: 4, cooldown: 30, revision: 0, publicFacts: '', npcs: [] });
    const abort = () => new DOMException('角色、存档或动态已变化，请重新操作', 'AbortError');
    const present = chat => typeof db !== 'undefined' && db.characters?.includes(chat);
    const refKey = ref => ref && ['user', 'character', 'npc'].includes(ref.kind) && typeof ref.id === 'string' ? ref.kind + ':' + ref.id : '';
    const same = (a, b) => !!refKey(a) && refKey(a) === refKey(b);
    function text(value, max, label, empty = true) {
        if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(label + '内容无效');
        return value.trim();
    }
    function validateConfig(raw) {
        if (!raw || raw.version !== 1) throw new Error('动态设置版本无效');
        const out = { ...defaults(), ...clone(raw) };
        for (const key of ['enabled', 'charReplies', 'npcsEnabled', 'npcThreads']) if (typeof out[key] !== 'boolean') throw new Error('动态设置无效');
        if (!Number.isInteger(out.maxReplies) || out.maxReplies < 1 || out.maxReplies > 8 || !Number.isInteger(out.cooldown) || out.cooldown < 5 || out.cooldown > 3600 || !Number.isSafeInteger(out.revision) || out.revision < 0) throw new Error('动态数量或冷却设置无效');
        out.publicFacts = text(out.publicFacts, 12000, '公开信息');
        if (!Array.isArray(out.npcs) || out.npcs.length > 64) throw new Error('NPC 数量无效');
        const ids = new Set();
        out.npcs = out.npcs.map(npc => {
            if (!npc || typeof npc.id !== 'string' || !npc.id || npc.id.length > 180 || ids.has(npc.id)) throw new Error('NPC 身份无效');
            ids.add(npc.id);
            for (const key of ['enabled', 'knowsUser']) if (npc[key] !== undefined && typeof npc[key] !== 'boolean') throw new Error('NPC 参与设置无效');
            const item = { id: npc.id, name: text(npc.name, 80, 'NPC 姓名', false), persona: text(npc.persona || '', 12000, 'NPC 人设'),
                relationship: text(npc.relationship || '', 2000, '关系'), knowledge: text(npc.knowledge || '', 8000, '知情范围'), avatar: text(npc.avatar || '', 500000, '头像'), enabled: npc.enabled !== false,
                knowsUser: npc.knowsUser === true, peers: npc.peers === null || npc.peers === undefined ? null : clone(npc.peers) };
            if (item.peers !== null && (!Array.isArray(item.peers) || item.peers.length > 64 || item.peers.some(value => typeof value !== 'string' || value.length > 180))) throw new Error('NPC 关系范围无效');
            return item;
        });
        return out;
    }
    function settings(chat) { return chat?.momentsSocial ? validateConfig(chat.momentsSocial) : defaults(); }
    function actors(chat, config = settings(chat)) {
        return [
            { ref: { kind: 'user', id: chat.id }, name: chat.myName || '我', avatar: chat.myAvatar || '', enabled: true },
            { ref: { kind: 'character', id: chat.id }, name: chat.realName || chat.name || '角色', avatar: chat.avatar || '', enabled: true },
            ...config.npcs.map(npc => ({ ...npc, ref: { kind: 'npc', id: npc.id } }))
        ];
    }
    const actor = (chat, ref, config) => actors(chat, config).find(item => same(item.ref, ref)) || null;
    function resolveName(chat, name, config) {
        const found = actors(chat, config).filter(item => item.name === name);
        return found.length === 1 ? clone(found[0].ref) : null;
    }
    function view(chat, config = settings(chat)) {
        const seen = new Set();
        return (Array.isArray(chat.moments) ? clone(chat.moments) : []).map((post, index) => {
            let postId = typeof post.id === 'string' && post.id ? post.id : 'legacy_m_' + index;
            while (seen.has(postId)) postId += '_duplicate';
            seen.add(postId); post.id = postId;
            post.authorRef = post.authorRef || (post.author ? resolveName(chat, post.author, config) : { kind: 'character', id: chat.id });
            post.content = typeof post.content === 'string' ? post.content : '';
            const comments = new Set();
            post.comments = (Array.isArray(post.comments) ? post.comments : []).map((comment, i) => {
                let commentId = typeof comment.id === 'string' && comment.id ? comment.id : 'legacy_c_' + postId + '_' + i;
                while (comments.has(commentId)) commentId += '_duplicate';
                comments.add(commentId); comment.id = commentId;
                comment.authorRef = comment.authorRef || resolveName(chat, comment.author, config);
                comment.content = typeof comment.content === 'string' ? comment.content : '';
                return comment;
            });
            post.likeActors = Array.isArray(post.likeActors) ? post.likeActors : [];
            post.likes = Array.isArray(post.likes) ? post.likes : [];
            return post;
        });
    }
    function validateData(chat) {
        if (chat.momentsSocial !== undefined) validateConfig(chat.momentsSocial);
        if (chat.moments === undefined) return;
        if (!Array.isArray(chat.moments) || chat.moments.length > 100000) throw new Error('动态列表无效');
        const postIds = new Set();
        const validRef = ref => ref === null || ref === undefined || (!!refKey(ref) && ref.id.length <= 180);
        for (const post of chat.moments) {
            if (!post || typeof post !== 'object' || typeof post.content !== 'string' || post.content.length > 100000 || !validRef(post.authorRef)) throw new Error('动态内容或身份无效');
            if (post.id && (typeof post.id !== 'string' || post.id.length > 180 || postIds.has(post.id))) throw new Error('动态 ID 重复或无效');
            postIds.add(post.id);
            if (post.audience !== undefined && (!Array.isArray(post.audience) || post.audience.length > 66 || post.audience.some(ref => !refKey(ref)))) throw new Error('动态可见范围无效');
            if (post.socialAttempts !== undefined && (!Array.isArray(post.socialAttempts) || post.socialAttempts.length > 20 || post.socialAttempts.some(value => !Number.isFinite(value) || value < 0))) throw new Error('动态请求次数无效');
            if (post.socialBatches !== undefined && (!Array.isArray(post.socialBatches) || post.socialBatches.length > 200 || post.socialBatches.some(value => typeof value !== 'string' || value.length > 200))) throw new Error('动态批次记录无效');
            if (post.likeActors !== undefined && (!Array.isArray(post.likeActors) || post.likeActors.length > 10000 || post.likeActors.some(item => !item || !refKey(item.ref) || typeof item.name !== 'string' || item.name.length > 80))) throw new Error('点赞人物无效');
            if (post.comments !== undefined && (!Array.isArray(post.comments) || post.comments.length > 100000)) throw new Error('评论列表无效');
            const ids = new Set();
            for (const comment of post.comments || []) {
                if (!comment || typeof comment.content !== 'string' || comment.content.length > 20000 || !validRef(comment.authorRef) || comment.id && (typeof comment.id !== 'string' || comment.id.length > 180 || ids.has(comment.id))) throw new Error('评论内容或身份无效');
                if (comment.replyToCommentId && !ids.has(comment.replyToCommentId)) throw new Error('评论回复目标无效');
                for (const key of ['deleted', 'read']) if (comment[key] !== undefined && typeof comment[key] !== 'boolean') throw new Error('评论状态无效');
                ids.add(comment.id);
            }
        }
    }
    const snapshotText = chat => {
        const config = settings(chat); delete config.revision;
        const posts = view(chat).map(post => ({ ...post, comments: post.comments.map(comment => { const copy = { ...comment }; delete copy.read; return copy; }) }));
        return JSON.stringify([chat.persona, chat.realName, chat.myName, config, posts]);
    };
    function capture(chat, postId) { return { chat, archiveId: chat.activeArchiveId, history: chat.history, postId, stamp: snapshotText(chat) }; }
    function isCurrent(scope) { return present(scope.chat) && scope.chat.activeArchiveId === scope.archiveId && scope.chat.history === scope.history && scope.stamp === snapshotText(scope.chat) && (!scope.postId || view(scope.chat).some(post => post.id === scope.postId)); }
    // Undo only this mutation's values; concurrent posts and comments keep their IDs and order.
    function undoOwned(before, applied, current) {
        const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        if (equal(before, applied)) return current;
        if (equal(current, applied)) return before === undefined ? undefined : clone(before);
        if (Array.isArray(before) && Array.isArray(applied) && Array.isArray(current)) {
            if (![...before, ...applied, ...current].every(item => item && typeof item.id === 'string')) return current;
            const old = new Map(before.map(item => [item.id, item])), written = new Map(applied.map(item => [item.id, item]));
            const restored = current.filter(item => old.has(item.id) || !written.has(item.id) || !equal(item, written.get(item.id)))
                .map(item => old.has(item.id) && written.has(item.id) ? undoOwned(old.get(item.id), written.get(item.id), item) : item);
            const ids = new Set(restored.map(item => item.id));
            for (let i = before.length - 1; i >= 0; i--) {
                const item = before[i];
                if (written.has(item.id) || ids.has(item.id)) continue;
                const next = before.slice(i + 1).find(value => ids.has(value.id));
                const index = next ? restored.findIndex(value => value.id === next.id) : restored.length;
                restored.splice(index, 0, clone(item)); ids.add(item.id);
            }
            return restored;
        }
        if (before && applied && current && !Array.isArray(before) && !Array.isArray(applied) && !Array.isArray(current) && typeof before === 'object' && typeof applied === 'object' && typeof current === 'object') {
            const restored = clone(current);
            for (const key of new Set([...Object.keys(before), ...Object.keys(applied)])) {
                const value = undoOwned(before[key], applied[key], current[key]);
                if (value === undefined) delete restored[key]; else Object.defineProperty(restored, key, { value, writable: true, enumerable: true, configurable: true });
            }
            return restored;
        }
        return current;
    }
    async function mutate(chat, change, extra = []) {
        if (!present(chat)) throw abort();
        if (saving.has(chat)) throw new Error('动态正在保存，请稍候');
        saving.add(chat);
        try {
            const config = settings(chat), posts = view(chat, config), history = [], messageEdits = [], next = { config, posts, history, messageEdits };
            const beforePosts = clone(posts), result = change(next);
            config.revision++;
            validateData({ momentsSocial: config, moments: posts });
            const mutation = beginChatMutation(chat, 'private', messageEdits, ['moments', 'momentsSocial', ...extra]);
            chat.momentsSocial = validateConfig(config); chat.moments = posts; chat.history.push(...history);
            messageEdits.forEach(message => { message.isContextDisabled = true; message.momentSuperseded = true; });
            if (next.journals) chat.memoryJournals = next.journals;
            const appliedPosts = clone(posts);
            const ownedFields = extra.map(key => ({ key, before: mutation.fields.find(field => field.key === key)?.before, applied: chat[key] === undefined ? undefined : clone(chat[key]) }));
            if (!await saveChatMutation(mutation, '动态保存失败，已恢复本次操作')) {
                const destinations = new Set([chat.activeArchiveId === mutation.archiveId ? chat : null, chat.archives?.find(item => item.id === mutation.archiveId)?.data]);
                for (const data of destinations) if (data) {
                    if (Array.isArray(data.moments)) data.moments = undoOwned(beforePosts, appliedPosts, data.moments);
                    for (const field of ownedFields) {
                        const value = undoOwned(field.before ?? [], field.applied ?? [], data[field.key]);
                        if (value === undefined) delete data[field.key]; else data[field.key] = value;
                    }
                }
                throw new Error('动态保存失败，已恢复本次操作');
            }
            root.document?.dispatchEvent(new root.CustomEvent('uvu-moments-change', { detail: { chatId: chat.id, archiveId: mutation.archiveId } }));
            return result;
        } finally { saving.delete(chat); }
    }
    function configure(chat, patch) {
        return mutate(chat, next => {
            const allowed = ['enabled', 'charReplies', 'npcsEnabled', 'npcThreads', 'maxReplies', 'cooldown', 'publicFacts'];
            for (const key of allowed) if (Object.hasOwn(patch, key)) next.config[key] = patch[key];
            validateConfig(next.config);
        });
    }
    async function saveNpc(chat, input) {
        return mutate(chat, next => {
            const old = input.id ? next.config.npcs.find(npc => npc.id === input.id) : null;
            if (input.id && !old) throw new Error('NPC 已不存在');
            const npc = { ...old, ...input, id: old?.id || id('npc') };
            if (old) next.config.npcs[next.config.npcs.indexOf(old)] = npc; else next.config.npcs.push(npc);
            return validateConfig(next.config).npcs.find(item => item.id === npc.id);
        });
    }
    const removeNpc = (chat, npcId) => mutate(chat, next => { next.config.npcs = next.config.npcs.filter(npc => npc.id !== npcId); });
    const requirePost = (posts, postId) => { const post = posts.find(item => item.id === postId); if (!post) throw new Error('目标动态已不存在'); return post; };
    function requireVisible(chat, post, ref = { kind: 'user', id: chat.id }) {
        if (!post || !canSee(chat, post, ref)) throw new Error('人物不在动态可见范围');
        return post;
    }
    function parentOf(post, parentId) {
        if (!parentId) return null;
        const parent = post.comments.find(item => item.id === parentId && !item.deleted);
        if (!parent) throw new Error('目标评论已删除或不存在');
        return parent;
    }
    function userEvent(chat, post, content, commentId) {
        const authorName = actor(chat, post.authorRef)?.name || post.author || chat.realName;
        return { id: id('msg'), role: 'user', content: `[system: ${chat.myName || '我'}${content}在${authorName}的动态“${post.content.slice(0, 20)}...”]`,
            timestamp: Date.now(), isContextDisabled: false, momentSource: { postId: post.id, commentId: commentId || null } };
    }
    function ensureEnabled(config) { if (!config.enabled) throw new Error('请先开启动态互动'); }
    async function addComment(chat, postId, content, parentId = null) {
        content = text(content, 2000, '评论', false);
        return mutate(chat, next => {
            ensureEnabled(next.config); const post = requireVisible(chat, requirePost(next.posts, postId)), parent = parentOf(post, parentId), me = actors(chat)[0];
            const comment = { id: id('comment'), authorRef: me.ref, author: me.name, content, timestamp: Date.now(), replyToCommentId: parent?.id || null, replyTo: parent?.author || null, read: true };
            const event = userEvent(chat, post, parent ? `回复了${actor(chat, parent.authorRef)?.name || parent.author}：${content}` : `评论了：${content}`, comment.id);
            comment.sourceMessageId = event.id; post.comments.push(comment); next.history.push(event); return comment;
        });
    }
    function validateImages(images) {
        if (!Array.isArray(images) || images.length > 9 || images.some(url => typeof url !== 'string' || !/^(https?:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(url))) throw new Error('动态图片无效');
        return images.slice();
    }
    async function publish(chat, input) {
        const content = text(input.content || '', 10000, '动态');
        const images = validateImages(input.images || []);
        if (!content && !images.length) throw new Error('请输入动态内容或选择图片');
        return mutate(chat, next => {
            ensureEnabled(next.config); const ref = input.authorRef || { kind: 'user', id: chat.id }, author = actor(chat, ref);
            if (!author || ref.kind === 'npc' && !author.enabled) throw new Error('发布人物身份无效');
            const post = { id: id('moment'), authorRef: clone(ref), author: author.name, content, images: images.slice(), timestamp: Date.now(), comments: [], likes: [], likeActors: [],
                audience: input.audience === undefined ? actors(chat).map(item => item.ref) : clone(input.audience) };
            if (!Array.isArray(post.audience) || post.audience.some(item => !actor(chat, item))) throw new Error('可见人物无效');
            next.posts.unshift(post); return post;
        });
    }
    async function updatePost(chat, postId, patch) {
        return mutate(chat, next => {
            const post = requirePost(next.posts, postId);
            if (patch.content !== undefined) post.content = text(patch.content, 10000, '动态');
            if (patch.images !== undefined) post.images = validateImages(patch.images);
            if (!post.content && !post.images?.length) throw new Error('请输入动态内容或选择图片');
            if (patch.audience !== undefined) {
                if (!Array.isArray(patch.audience) || patch.audience.some(ref => !actor(chat, ref))) throw new Error('可见人物无效');
                post.audience = clone(patch.audience);
            }
        });
    }
    async function removePost(chat, postId) {
        return mutate(chat, next => { const post = requirePost(next.posts, postId); next.posts.splice(next.posts.indexOf(post), 1); next.messageEdits.push(...chat.history.filter(message => message.momentSource?.postId === postId)); });
    }
    async function editComment(chat, postId, commentId, content) {
        content = text(content, 2000, '评论', false);
        return mutate(chat, next => {
            const comment = parentOf(requireVisible(chat, requirePost(next.posts, postId)), commentId);
            if (!same(comment.authorRef, { kind: 'user', id: chat.id })) throw new Error('只能编辑自己的评论');
            comment.content = content; comment.editedAt = Date.now();
            next.messageEdits.push(...chat.history.filter(message => message.momentSource?.postId === postId && message.momentSource?.commentId === commentId));
            const event = userEvent(chat, requirePost(next.posts, postId), `修改评论为：${content}`, commentId);
            comment.sourceMessageId = event.id; next.history.push(event);
        });
    }
    const removeComment = (chat, postId, commentId) => mutate(chat, next => { const comment = parentOf(requireVisible(chat, requirePost(next.posts, postId)), commentId); comment.deleted = true; comment.content = ''; next.messageEdits.push(...chat.history.filter(message => message.momentSource?.postId === postId && message.momentSource?.commentId === commentId)); });
    const toggleLike = (chat, postId) => mutate(chat, next => {
        const post = requireVisible(chat, requirePost(next.posts, postId)), ref = { kind: 'user', id: chat.id }, index = post.likeActors.findIndex(item => same(item.ref, ref));
        if (index >= 0) post.likeActors.splice(index, 1); else post.likeActors.push({ ref, name: chat.myName || '我' });
        const event = userEvent(chat, post, index >= 0 ? '取消点赞了' : '点赞了'); event.isContextDisabled = index >= 0; next.history.push(event);
    });
    function canSee(chat, post, ref) { return same(post.authorRef, ref) || !post.audience || post.audience.some(item => same(item, ref)); }
    function canInteract(chat, speaker, target) {
        if (speaker.ref.kind !== 'npc' || !target?.ref) return true;
        // First contact is allowed; the prompt explicitly distinguishes strangers from acquaintances.
        if (target.ref.kind === 'user') return true;
        if (target.ref.kind === 'npc') return !speaker.peers || speaker.peers.includes(target.ref.id);
        return true;
    }
    async function applyActions(chat, postId, actions, batchId = id('batch'), scope = null) {
        if (scope && !isCurrent(scope)) throw abort();
        if (view(chat).some(post => post.id === postId && post.socialBatches?.includes(batchId))) return [];
        if (!Array.isArray(actions) || actions.length > settings(chat).maxReplies) throw new Error('互动数量超过设置');
        return mutate(chat, next => {
            ensureEnabled(next.config); const post = requirePost(next.posts, postId), local = new Map(), added = [];
            if (scope && !isCurrent(scope)) throw abort();
            for (const input of actions) {
                const speaker = actor(chat, input.actor, next.config);
                if (!speaker || input.actor.kind === 'user' || !speaker.enabled || input.actor.kind === 'npc' && !next.config.npcsEnabled || input.actor.kind === 'character' && !next.config.charReplies) throw new Error('互动人物身份无效或未允许参与');
                if (!canSee(chat, post, input.actor)) throw new Error('人物不在动态可见范围');
                const parentId = input.replyToLocalId ? local.get(input.replyToLocalId) : input.replyToCommentId;
                if (input.replyToLocalId && !parentId) throw new Error('回复目标评论无效');
                const parent = parentOf(post, parentId);
                const target = parent ? actor(chat, parent.authorRef, next.config) : actor(chat, post.authorRef, next.config);
                if (parent && same(parent.authorRef, speaker.ref)) throw new Error('不能连续回复自己的评论');
                if (!canInteract(chat, speaker, target) || parent?.authorRef?.kind === 'npc' && speaker.ref.kind === 'npc' && !next.config.npcThreads) throw new Error('未允许这些人物相互参与');
                const comment = { id: id('comment'), authorRef: clone(speaker.ref), author: speaker.name, content: text(input.content, 2000, '评论', false), timestamp: Date.now(),
                    replyToCommentId: parent?.id || null, replyTo: target && parent ? target.name : null, read: !(parent?.authorRef?.kind === 'user' || post.authorRef?.kind === 'user'), batchId };
                if (input.localId) { if (local.has(input.localId)) throw new Error('评论局部 ID 重复'); local.set(input.localId, comment.id); }
                post.comments.push(comment); added.push(comment);
            }
            post.socialBatches = [...(post.socialBatches || []), batchId].slice(-200);
            if (added.length) post.lastSocialAt = Date.now();
            return added;
        });
    }
    const markRead = (chat, postId) => mutate(chat, next => { requireVisible(chat, requirePost(next.posts, postId)).comments.forEach(comment => { comment.read = true; }); });
    async function approveMemory(chat, postId, content) {
        content = text(content, 12000, '记忆', false);
        return mutate(chat, next => {
            const post = requireVisible(chat, requirePost(next.posts, postId)), journals = clone(chat.memoryJournals || []);
            let journal = journals.find(item => item.source === 'moments' && item.momentId === postId && item.momentArchiveId === (chat.activeArchiveId || ''));
            if (!journal) { journal = { id: id('journal'), source: 'moments', momentId: postId, momentArchiveId: chat.activeArchiveId || '', createdAt: Date.now(), chatId: chat.id, chatType: 'private', title: '动态 · ' + post.content.slice(0, 24), range: { start: 0, end: 0 } }; journals.push(journal); }
            journal.content = content; journal.isFavorited = true; next.journals = journals; return journal;
        }, ['memoryJournals']);
    }
    root.UvUMoments = { id, settings, validateConfig, validateData, actors, actor, refKey, same, resolveName, view, capture, isCurrent, mutate, configure, saveNpc, removeNpc,
        addComment, publish, updatePost, removePost, editComment, removeComment, toggleLike, canSee, requireVisible, canInteract, applyActions, markRead, approveMemory };
})(typeof window !== 'undefined' ? window : globalThis);
