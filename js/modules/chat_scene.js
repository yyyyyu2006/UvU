// Opt-in private-chat scenes. Stored authors and history floors never change.
(function (root) {
    'use strict';
    const VERSION = 1, MAX_BLOCKS = 32, MAX_TEXT = 20000;
    const clone = value => JSON.parse(JSON.stringify(value));
    const id = prefix => prefix + '_' + (root.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const fail = reason => { throw new Error('旁白数据：' + reason); };
    function text(value, limit, name, nonempty = false) {
        if (typeof value !== 'string' || value.length > limit || (nonempty && !value.trim())) fail(name + '无效或超长');
    }
    function revision(value) { if (!Number.isSafeInteger(value) || value < 0) fail('修订号无效'); }
    function validateBlocks(blocks, stored = true) {
        if (!Array.isArray(blocks) || !blocks.length || blocks.length > MAX_BLOCKS) fail('需要1–32段内容');
        let length = 0;
        const seen = new Set();
        for (const block of blocks) {
            if (!object(block) || !['dialogue', 'narration'].includes(block.kind)) fail('段落类型无效');
            if (Object.keys(block).some(key => !['id', 'kind', 'text'].includes(key))) fail('段落含未知字段');
            text(block.text, MAX_TEXT, '正文', true); length += block.text.length;
            if (stored) {
                text(block.id, 128, '段落编号', true);
                if (seen.has(block.id)) fail('段落编号重复');
                seen.add(block.id);
            } else if (block.id !== undefined) fail('回复不应指定段落编号');
        }
        if (length > MAX_TEXT) fail('正文总长超过20000字');
        return blocks;
    }
    function validateScene(scene) {
        if (!object(scene) || scene.version !== VERSION) fail('不支持的消息版本');
        for (const key of ['sessionId', 'turnId']) text(scene[key], 128, key, true);
        revision(scene.revision); validateBlocks(scene.blocks);
        if (scene.restoreContent !== undefined) text(scene.restoreContent, MAX_TEXT + 512, '原气泡正文');
        return scene;
    }
    function projection(message) {
        const owner = message.role === 'user' ? '用户' : '角色';
        return message.scene.blocks.map(block => `[${owner}${block.kind === 'narration' ? '动作' : '对白'}：${block.text}]`).join('\n');
    }
    function validateMessage(message) {
        validateScene(message.scene);
        if (message.scene.turnId !== message.id) fail('回合编号与原消息不一致');
        if (!['user', 'assistant'].includes(message.role) || message.type || message.isThinking || message.isStatusUpdate) fail('该消息不能包含旁白');
        // Withdrawal keeps the original scene for undo/export; withdrawn context remains original behavior.
        if (!message.isWithdrawn && (message.content !== projection(message) ||
            !Array.isArray(message.parts) || message.parts.length !== 1 || message.parts[0].type !== 'text' || message.parts[0].text !== message.content)) fail('正文与分段内容不一致');
        return message;
    }
    function validateMode(mode) {
        if (!object(mode) || mode.version !== VERSION || typeof mode.enabled !== 'boolean') fail('不支持的模式版本');
        text(mode.sessionId, 128, '场景编号', true); revision(mode.revision);
        if (!object(mode.scene) || !object(mode.preferences)) fail('场景设置缺失');
        for (const [key, max] of Object.entries({ name: 40, place: 60, time: 60, background: 4000 })) text(mode.scene[key], max, key);
        if (!['third', 'second'].includes(mode.preferences.viewpoint) || !['short', 'medium', 'long'].includes(mode.preferences.length)) fail('描写设置无效');
        return mode;
    }
    function defaultMode() {
        return { version: VERSION, enabled: false, sessionId: id('scene'), revision: 0,
            scene: { name: '', place: '', time: '', background: '' }, preferences: { viewpoint: 'third', length: 'medium' } };
    }
    function enabled(chat, type = 'private') { return type === 'private' && chat?.sceneMode?.version === VERSION && chat.sceneMode.enabled === true; }
    function hasScene(message) { return Boolean(message?.scene?.version === VERSION); }
    function block(message, segmentId) { return message?.scene?.blocks.find(part => part.id === segmentId); }
    function sync(message) {
        validateScene(message.scene);
        message.content = projection(message); message.parts = [{ type: 'text', text: message.content }];
        return message;
    }
    function plainUser(message, type = 'private') {
        return type === 'private' && message?.role === 'user' && !message.scene && !message.type && !message.isWithdrawn &&
            !message.isThinking && !message.isStatusUpdate && !message.relationshipDelivery &&
            (!message.parts || message.parts.every(part => part.type === 'text')) &&
            /^\[[^\n]*?的消息[：:][\s\S]*\]$/.test(message.content || '');
    }
    function convert(message, body, narration, chat) {
        text(body, MAX_TEXT, '正文', true);
        const next = clone(message);
        if (!next.scene) {
            if (!narration) return null;
            if (!plainUser(message)) fail('仅普通用户文字可以转换');
            next.scene = { version: VERSION, sessionId: chat.sceneMode?.sessionId || id('manual'), turnId: next.id,
                revision: 0, restoreContent: next.content, blocks: [{ id: id('segment'), kind: 'narration', text: body }] };
        } else {
            validateMessage(next);
            if (next.role !== 'user' || next.scene.blocks.length !== 1) fail('请编辑对应段落');
            if (!narration) {
                const original = next.scene.restoreContent;
                const originalBody = original?.match(/^\[[^\n]*?的消息[：:]([\s\S]*)\]$/)?.[1];
                next.content = original && body === originalBody ? original :
                    original && /^\[[^\n]*?的消息[：:]/.test(original) ? original.replace(/^(\[[^\n]*?的消息[：:])[\s\S]*\]$/, (_, prefix) => prefix + body + ']') : `[${chat.myName || '我'}的消息：${body}]`;
                delete next.scene;
                next.parts = [{ type: 'text', text: next.content }];
                return next;
            }
            next.scene.blocks[0].text = body;
        }
        next.scene.revision++; return sync(next);
    }
    function edit(message, segmentId, body) {
        validateMessage(message); text(body, MAX_TEXT, '正文', true);
        const next = clone(message), part = block(next, segmentId);
        if (!part) fail('段落已不存在，请重新打开编辑');
        part.text = body; next.scene.revision++; return sync(next);
    }
    function parse(raw) {
        let input = raw.trim(), thinking = '';
        // Only a complete leading thinking block and a complete outer fence are wrappers.
        const thought = input.match(/^<thinking>[\s\S]*?<\/thinking>\s*/);
        if (thought) { thinking = thought[0].trim(); input = input.slice(thought[0].length).trim(); }
        const fence = input.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
        if (fence) input = fence[1].trim();
        let data;
        try { data = JSON.parse(input); } catch (_) { fail('回复不是完整JSON，原文已保留在场景设置'); }
        if (!object(data) || data.version !== VERSION || Object.keys(data).some(key => !['version', 'blocks'].includes(key))) fail('回复版本或字段无效');
        validateBlocks(data.blocks, false);
        return { thinking, blocks: data.blocks.map(part => ({ id: id('segment'), kind: part.kind, text: part.text })) };
    }
    // Snapshot source semantics, not a mutable reference to the active scene/settings.
    function signature(history) { return JSON.stringify(history.map(message => [message.id, message.role, message.content, message.parts,
        message.quote, message.timestamp, message.senderId, message.type, message.scene,
        !!message.isWithdrawn, !!message.isContextDisabled, !!message.isThinking, !!message.relationshipDelivery])); }
    function identity(chat) { return JSON.stringify([chat.realName, chat.myName, chat.persona, chat.myPersona, chat.worldBookIds]); }
    function capture(chat, type) {
        if (!enabled(chat, type)) return null;
        validateMode(chat.sceneMode);
        return { chat, archiveId: chat.activeArchiveId, history: chat.history, mode: clone(chat.sceneMode), source: signature(chat.history), identity: identity(chat) };
    }
    function current(token) {
        return Boolean(token && token.chat.activeArchiveId === token.archiveId && token.chat.history === token.history &&
            enabled(token.chat) && identity(token.chat) === token.identity && JSON.stringify(token.chat.sceneMode) === JSON.stringify(token.mode) && signature(token.history) === token.source);
    }
    function abort(chat) {
        if (typeof getChatGeneration === 'function') {
            const request = getChatGeneration(chat.id, 'private');
            if (request?.sceneToken) request.controller?.abort();
        }
    }
    root.UvUScene = { VERSION, MAX_BLOCKS, MAX_TEXT, clone, id, validateBlocks, validateScene, validateMessage, validateMode,
        defaultMode, enabled, hasScene, block, sync, projection, plainUser, convert, edit, parse, signature, capture, current, abort };
})(globalThis);
