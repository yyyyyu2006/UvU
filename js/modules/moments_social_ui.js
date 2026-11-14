(function (root) {
    'use strict';
    const M = () => root.UvUMoments, AI = () => root.UvUMomentsAI;
    const drafts = new Map(), positions = new Map(), controllers = new Set();
    let renderedKey = '';
    const node = (tag, cls = '', value = '') => { const element = document.createElement(tag); element.className = cls; element.textContent = value; return element; };
    const current = () => typeof currentChatId !== 'undefined' && db.characters.find(chat => chat.id === currentChatId);
    const scopeKey = chat => chat.id + ':' + (chat.activeArchiveId || '');
    const target = chat => ({ chat, archive: chat.activeArchiveId, history: chat.history });
    function valid(t) { return db.characters.includes(t.chat) && t.chat.activeArchiveId === t.archive && t.chat.history === t.history; }
    const visible = chat => current() === chat && document.getElementById('moments-screen')?.classList.contains('active');
    function guard(t) { if (!valid(t)) throw new Error('角色或存档已变化，请重新打开'); }
    function toast(message) { if (typeof showToast === 'function') showToast(message); }
    const icon = name => root.UvULucide?.[name] || root.UvUMomentsIcons?.[name] || '';
    function button(name, label, fn, cls = 'ms-icon') {
        const b = node('button', cls); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
        if (icon(name)) b.innerHTML = icon(name); else b.textContent = label;
        if (fn) b.onclick = fn; return b;
    }
    const command = (label, fn, cls = 'ms-button') => { const b = node('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };
    async function work(b, fn) { if (b?.disabled) return; if (b) b.disabled = true; try { return await fn(); } catch (e) { toast(e.message); } finally { if (b) b.disabled = false; } }
    async function fillGeneratedDraft(d, input, request, owners = []) {
        const before = input.value, ownerValues = owners.map(control => control.value);
        let changed = false;
        const markChanged = () => { changed = true; };
        input.addEventListener('input', markChanged);
        owners.forEach(control => control.addEventListener('change', markChanged));
        try {
            const value = await request();
            // Editing and then undoing, or switching away and back, still owns the draft.
            if (changed || input.value !== before || owners.some((control, i) => control.value !== ownerValues[i]) ||
                d.signal.aborted || !d.overlay.isConnected || !valid(d.t)) return false;
            input.value = value; return true;
        } finally {
            input.removeEventListener('input', markChanged);
            owners.forEach(control => control.removeEventListener('change', markChanged));
        }
    }
    const safeImage = url => typeof url === 'string' && /^(https?:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,|assets\/)/i.test(url) ? url : '';
    function avatar(person, cls = 'ms-avatar') {
        const a = node('span', cls, (person?.name || '?').slice(0, 1)), src = safeImage(person?.avatar);
        if (src) { const image = node('img'); image.src = src; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.onerror = () => image.remove(); a.append(image); }
        return a;
    }
    function dialog(title, chat) {
        const t = target(chat), overlay = node('div', 'feature-dialog ms-overlay'), card = node('section', 'feature-dialog-card ms-dialog'), head = node('header', 'ms-dialog-head');
        const close = button('x', '关闭', () => overlay.remove()); close.dataset.action = 'close';
        head.append(node('strong', '', title), close); const body = node('div', 'ms-dialog-body'), foot = node('footer', 'ms-dialog-foot');
        card.append(head, body, foot); overlay.append(card); (document.querySelector('.phone-screen') || document.body).append(overlay);
        const stop = new AbortController(); controllers.add(stop);
        const observer = new MutationObserver(() => { if (!overlay.isConnected) { observer.disconnect(); stop.abort(); controllers.delete(stop); } });
        observer.observe(overlay.parentElement, { childList: true });
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        return { overlay, body, foot, t, signal: stop.signal, close: () => overlay.remove() };
    }
    function field(label, value = '', multiline = false) {
        const row = node('label', 'ms-field'), caption = node('span', '', label), input = node(multiline ? 'textarea' : 'input');
        if (!multiline) input.type = 'text'; input.value = value; row.append(caption, input); return { row, input };
    }
    function check(label, value) {
        const row = node('label', 'ms-check'), input = node('input'), caption = node('span', '', label); input.type = 'checkbox'; input.checked = !!value; row.append(caption, input); return { row, input };
    }
    function draft(chat) {
        const key = scopeKey(chat);
        if (!drafts.has(key)) {
            let saved; try { saved = JSON.parse(sessionStorage.getItem('uvu-moments-draft:' + key) || 'null'); } catch (_) {}
            drafts.set(key, { text: typeof saved?.text === 'string' ? saved.text.slice(0, 2000) : '', postId: typeof saved?.postId === 'string' ? saved.postId : null, parentId: typeof saved?.parentId === 'string' ? saved.parentId : null });
        }
        if (drafts.size > 64) drafts.delete(drafts.keys().next().value); return drafts.get(key);
    }
    function saveDraft(chat) { try { sessionStorage.setItem('uvu-moments-draft:' + scopeKey(chat), JSON.stringify(draft(chat))); } catch (_) {} }
    function profile(chat, ref, fallback) {
        const person = M().actor(chat, ref), d = dialog(person?.name || fallback || '人物', chat);
        d.body.append(avatar(person, 'ms-profile-avatar'));
        d.body.append(node('p', '', ref?.kind === 'user' ? '你' : ref?.kind === 'character' ? '当前角色' : person?.relationship || '旧记录，身份未绑定'));
        if (person?.ref.kind === 'npc') { if (person.persona) d.body.append(node('p', '', person.persona)); if (person.knowledge) d.body.append(node('p', '', person.knowledge)); }
    }
    function actorLabel(chat, ref, fallback) {
        const a = node('button', 'ms-name', M().actor(chat, ref)?.name || fallback || '未知人物'); a.type = 'button'; a.onclick = e => { e.stopPropagation(); profile(chat, ref, fallback); }; return a;
    }
    function openNpc(chat, original = null, onSaved) {
        const d = dialog(original?.id ? '编辑人物' : '添加人物', chat), name = field('姓名', original?.name || ''), persona = field('人设与口吻', original?.persona || '', true),
            relation = field('与角色的关系', original?.relationship || ''), knowledge = field('知道的事情', original?.knowledge || '', true),
            portrait = field('头像地址', original?.avatar || ''), enabled = check('参与互动', original?.enabled !== false), knows = check('认识我', original?.knowsUser === true);
        name.input.maxLength = 80; persona.input.maxLength = 12000; knowledge.input.maxLength = 8000;
        const peers = node('details', 'ms-details'), peerTitle = node('summary', '', '熟人范围'), peerInputs = [];
        peers.append(peerTitle); const unrestricted = check('所有 NPC', original?.peers == null); peers.append(unrestricted.row);
        for (const npc of M().settings(chat).npcs.filter(item => item.id !== original?.id)) { const item = check(npc.name, original?.peers?.includes(npc.id)); peers.append(item.row); peerInputs.push({ id: npc.id, input: item.input }); }
        d.body.append(name.row, persona.row, relation.row, knowledge.row, portrait.row, knows.row, enabled.row, peers);
        if (original?.id) d.foot.append(button('trash-2', '删除人物', e => work(e.currentTarget, async () => { guard(d.t); if (!confirm('删除这个人物？已有评论会保留。')) return; await M().removeNpc(chat, original.id); d.close(); onSaved?.(); })));
        d.foot.append(command('保存', e => work(e.currentTarget, async () => { guard(d.t); await M().saveNpc(chat, { id: original?.id, name: name.input.value, persona: persona.input.value, relationship: relation.input.value, knowledge: knowledge.input.value,
            avatar: portrait.input.value, enabled: enabled.input.checked, knowsUser: knows.input.checked, peers: unrestricted.input.checked ? null : peerInputs.filter(item => item.input.checked).map(item => item.id) }); d.close(); onSaved?.(); }), 'ms-button ms-primary'));
    }
    function settings(chat) {
        const d = dialog('动态互动', chat), config = M().settings(chat), inputs = {};
        for (const [key, label] of [['enabled', '开启动态互动'], ['charReplies', '角色自动回复'], ['npcsEnabled', 'NPC 参与'], ['npcThreads', 'NPC 相互回复']]) {
            const item = check(label, config[key]); inputs[key] = item.input; d.body.append(item.row);
        }
        const limits = node('div', 'ms-pair'), count = field('每次最多', String(config.maxReplies)), cooldown = field('间隔 / 秒', String(config.cooldown));
        for (const [input, min, max] of [[count.input, 1, 8], [cooldown.input, 5, 3600]]) { input.type = 'number'; input.min = min; input.max = max; input.step = 1; }
        limits.append(count.row, cooldown.row); d.body.append(limits);
        const facts = field('共同知道的事情', config.publicFacts, true); facts.input.maxLength = 12000; d.body.append(facts.row);
        const task=node('details','ms-details'),taskText=node('p'),stopTask=command('停止互动',()=>AI().cancel(chat));task.append(node('summary','','本次互动'),taskText,stopTask);d.body.append(task);
        const refreshTask=()=>{if(!valid(d.t))return;const r=AI().inspect(chat);taskText.textContent=r?`${({running:'进行中',completed:'已完成',cancelled:'已取消',failed:'未完成'})[r.phase]} · ${r.speakers.map(s=>s.name).join('、')}\n请求 ${r.requests}/${r.speakers.length} 次 · 返回 ${r.completed} 次 · ${(r.elapsedMs/1000).toFixed(1)} 秒\n接口未提供 Token 用量，请以服务方记录为准。`:'尚无本次互动记录';stopTask.hidden=!AI().isBusy(chat);};refreshTask();
        document.addEventListener('uvu-moments-status',event=>{if(event.detail.chatId===chat.id&&event.detail.archiveId===d.t.archive){refreshTask();stopTask.hidden=!event.detail.busy;}},{signal:d.signal});
        const list = node('section', 'ms-npcs'), listHead = node('div', 'ms-section-head');
        const redrawList = () => {
            list.querySelectorAll('.ms-npc-row,.ms-empty').forEach(el => el.remove());
            const npcs = M().settings(chat).npcs;
            if (!npcs.length) list.append(node('p', 'ms-empty', '还没有人物'));
            for (const npc of npcs) {
                const row = node('div', 'ms-npc-row'), info = node('span', 'ms-npc-info'); info.append(node('strong', '', npc.name), node('span', '', npc.relationship || (npc.enabled ? '' : '已停用')));
                row.append(avatar(npc), info, button('pencil', '编辑 ' + npc.name, () => openNpc(chat, npc, redrawList))); list.append(row);
            }
        };
        listHead.append(node('strong', '', '人物'), button('plus', '添加人物', () => openNpc(chat, null, redrawList)));
        listHead.append(button('wand-sparkles', '从人设提取人物', e => work(e.currentTarget, async () => {
            guard(d.t); if (!M().settings(chat).enabled) throw new Error('先保存并开启动态互动，再提取人物');
            const proposed = await AI().suggestNpcs(chat, d.signal); guard(d.t);
            if (!proposed.length) { toast('没有提取到明确的人物'); return; }
            const review = dialog('人物草稿', chat), rows = [];
            for (const npc of proposed) { const item = check(npc.name + (npc.relationship ? ' · ' + npc.relationship : ''), true); rows.push({ npc, input: item.input }); review.body.append(item.row, node('p', 'ms-note', npc.persona)); }
            review.foot.append(command('添加所选', event => work(event.currentTarget, async () => { for (const item of rows.filter(row => row.input.checked)) { guard(review.t); await M().saveNpc(chat, item.npc); } review.close(); if (valid(d.t)) redrawList(); }), 'ms-button ms-primary'));
        })));
        list.append(listHead); d.body.append(list); redrawList();
        const help = node('details', 'ms-details'); help.append(node('summary', '', '使用说明'), node('p', '', '开启后，在评论区发送消息会触发独立互动。刷新只更新显示。NPC 只读取自己的资料、公开动态和共同信息。每条动态每天最多生成 20 次；可随时停止。记忆需单独审核保存。')); d.body.append(help);
        d.foot.append(command('保存', e => work(e.currentTarget, async () => {
            guard(d.t); const patch = { publicFacts: facts.input.value, maxReplies: Number(count.input.value), cooldown: Number(cooldown.input.value) };
            for (const key of Object.keys(inputs)) patch[key] = inputs[key].checked;
            await M().configure(chat, patch); if (!patch.enabled) AI().cancel(chat); d.close(); if (current() === chat) renderMomentsScreen();
        }), 'ms-button ms-primary'));
    }
    function composer(chat, postId, parentId = null) {
        const state = draft(chat); state.postId = postId; state.parentId = parentId;
        saveDraft(chat);
        renderComposer(chat); document.querySelector('.ms-composer textarea')?.focus();
    }
    function renderComposer(chat, container = null, onSent = null) {
        const screen = container || document.getElementById('moments-screen'); screen.querySelector('.ms-composer')?.remove();
        const state = draft(chat); if (!state.postId) return;
        const t = target(chat), post = M().view(chat).find(item => item.id === state.postId), parent = post?.comments.find(item => item.id === state.parentId && !item.deleted);
        if (!post || !M().canSee(chat, post, { kind: 'user', id: chat.id }) || state.parentId && !parent) { state.postId = state.parentId = null; return; }
        const box = node('div', 'ms-composer'), head = node('div', 'ms-composer-target');
        head.append(node('span', '', parent ? '回复 ' + (M().actor(chat, parent.authorRef)?.name || parent.author) : '评论'), button('x', '取消回复', () => { state.postId = state.parentId = null; saveDraft(chat); renderComposer(chat,container,onSent); }));
        const row = node('div', 'ms-composer-row'), input = node('textarea'); input.rows = 1; input.maxLength = 2000; input.placeholder = '写下你的评论'; input.value = state.text;
        input.oninput = () => { state.text = input.value; saveDraft(chat); };
        const send = button('send', '发送评论', e => work(e.currentTarget, async () => {
            guard(t); const content = input.value, comment = await M().addComment(chat, state.postId, content, state.parentId);
            guard(t);
            if (state.text === content) state.text = ''; state.postId = state.parentId = null;
            saveDraft(chat);
            if (valid(t) && current() === chat) { render(chat); renderComposer(chat); if (typeof renderMessages === 'function') renderMessages(false, false); }
            onSent?.();
            AI().generate(chat, post.id, { triggerId: comment.id, automatic: true }).catch(error => { if (visible(chat)) toast(error.message); });
        }), 'ms-icon ms-send');
        if(container)send.append(node('span','','发送'));
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send.click(); } });
        row.append(input, send); box.append(head, row); screen.append(box);
    }
    function commentRow(chat, post, comment, inDetail = false, closeDetail, onReply) {
        const row = node('div', 'ms-comment'); row.dataset.commentId = comment.id;
        row.append(actorLabel(chat, comment.authorRef, comment.author));
        const parent = comment.replyToCommentId && post.comments.find(item => item.id === comment.replyToCommentId);
        if (parent || comment.replyTo) {
            row.append(document.createTextNode(' 回复 '));
            if (parent?.deleted) row.append(node('span', 'ms-muted', '原评论已删除'));
            else row.append(actorLabel(chat, parent?.authorRef, parent?.author || comment.replyTo));
        }
        row.append(document.createTextNode('：'), node('span', comment.deleted ? 'ms-muted' : 'ms-comment-content', comment.deleted ? '原评论已删除' : comment.content));
        if (comment.read === false) { const dot = node('span', 'ms-unread-dot'); dot.setAttribute('aria-label', '未读'); row.append(dot); }
        let longPressed = false;
        if (!comment.deleted) row.onclick = event => { if (longPressed) { longPressed = false; event.preventDefault(); return; } if(onReply)onReply(comment.id);else {closeDetail?.(); composer(chat, post.id, comment.id);} };
        const options = () => commentActions(chat, post, comment, closeDetail);
        row.oncontextmenu = event => { event.preventDefault(); options(); };
        let timer, point;
        row.addEventListener('pointerdown', event => { if (event.target.closest('button')) return; longPressed = false; point = [event.clientX, event.clientY]; timer = setTimeout(() => { timer = null; longPressed = true; options(); }, 550); });
        row.addEventListener('pointermove', event => { if (point && Math.hypot(event.clientX - point[0], event.clientY - point[1]) > 8) { clearTimeout(timer); timer = null; } });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave']) row.addEventListener(type, () => { clearTimeout(timer); timer = null; });
        if (inDetail) {
            const person=M().actor(chat,comment.authorRef),copy=node('div','ms-comment-copy'),head=node('div','ms-comment-head'),name=row.firstElementChild;
            head.append(name,node('span','ms-comment-role',comment.authorRef?.kind==='user'?'User':comment.authorRef?.kind==='character'?'角色':comment.authorRef?.kind==='npc'?'NPC':'未绑定'));
            const content=row.querySelector('.ms-comment-content,.ms-muted');
            const unread=row.querySelector('.ms-unread-dot');if(unread)head.append(unread);
            const reply=node('div','ms-comment-reply');reply.append(...[...row.childNodes].filter(n=>n!==content));
            copy.append(head);if(comment.replyToCommentId||comment.replyTo)copy.append(reply);if(content)copy.append(content);
            copy.append(button('ellipsis', '评论操作', event => { event.stopPropagation(); options(); }));row.replaceChildren(avatar(person),copy);
            if(!comment.deleted){const replyAction=command('回复',event=>{event.stopPropagation();onReply?.(comment.id);},'ms-comment-reply-action');copy.append(replyAction);}
        }
        return row;
    }
    function commentActions(chat, post, comment, closeDetail) {
        const d = dialog('评论', chat);
        d.body.append(node('p', '', comment.content));
        d.body.append(command('回复', () => { d.close(); closeDetail?.(); composer(chat, post.id, comment.id); }));
        if (comment.authorRef?.kind === 'user') d.body.append(command('编辑', () => {
            const text = field('评论', comment.content, true); d.body.replaceChildren(text.row);
            d.foot.append(command('保存', e => work(e.currentTarget, async () => { guard(d.t); await M().editComment(chat, post.id, comment.id, text.input.value); d.close(); closeDetail?.(); }), 'ms-button ms-primary'));
        }));
        d.body.append(command('删除', e => work(e.currentTarget, async () => { guard(d.t); if (!confirm('删除这条评论？')) return; await M().removeComment(chat, post.id, comment.id); d.close(); closeDetail?.(); }), 'ms-button ms-danger'));
    }
    function memory(chat, post) {
        const d = dialog('动态记忆', chat), content = field('摘要', '', true), pending = node('p', 'ms-note', '生成摘要后，可编辑并审核保存。'); content.input.rows = 7; content.input.maxLength = 12000;
        let reviewScope = M().capture(chat, post.id);
        d.body.append(content.row, pending);
        d.foot.append(command('生成摘要', e => work(e.currentTarget, async () => {
            guard(d.t);
            const applied = await fillGeneratedDraft(d, content.input, () => AI().summarize(chat, post.id, d.signal));
            if (!applied) { if (d.overlay.isConnected && valid(d.t)) pending.textContent = '已保留你修改的摘要'; return; }
            reviewScope = M().capture(chat, post.id); pending.textContent = '';
        })));
        d.foot.append(command('审核并保存', e => work(e.currentTarget, async () => { guard(d.t); if (!M().isCurrent(reviewScope)) throw new Error('动态已变化，请重新生成或打开审核'); await M().approveMemory(chat, post.id, content.input.value); d.close(); toast('已加入记忆日记'); }), 'ms-button ms-primary'));
    }
    function postOptions(chat, post) {
        const d = dialog('动态', chat);
        d.body.append(command('生成互动', e => work(e.currentTarget, async () => { guard(d.t); d.close(); await AI().generate(chat, post.id); })));
        d.body.append(command('整理为记忆', () => { d.close(); memory(chat, post); }));
        d.body.append(command('编辑动态', () => { d.close(); publishDialog(chat, post); }));
        d.body.append(command('删除动态', e => work(e.currentTarget, async () => { guard(d.t); if (!confirm('删除这条动态及其评论？')) return; await M().removePost(chat, post.id); d.close(); }), 'ms-button ms-danger'));
    }
    function detail(chat, post, focusCommentId = null) {
        post = M().view(chat).find(item => item.id === post.id);
        if (!post || !M().canSee(chat, post, { kind: 'user', id: chat.id })) { toast('动态已不存在或不在可见范围'); return; }
        const d = dialog('评论', chat); d.overlay.classList.add('ms-comment-detail');d.body.append(node('p', 'ms-detail-post', post.content));
        const comments = node('div', 'ms-thread-page'), more = command('加载更多评论', () => appendPage(), 'ms-more'); d.body.append(comments, more);
        let shown = 0;
        function appendPage() {
            const end = Math.min(post.comments.length, shown + 50);
            for (; shown < end; shown++) comments.append(commentRow(chat, post, post.comments[shown], true, d.close,reply));
            more.hidden = shown >= post.comments.length; more.textContent = '加载更多评论（' + shown + '/' + post.comments.length + '）';
        }
        appendPage();
        if (focusCommentId) {
            const index = post.comments.findIndex(item => item.id === focusCommentId);
            while (shown <= index) appendPage();
            [...comments.children].find(row => row.dataset.commentId === focusCommentId)?.scrollIntoView({ block: 'nearest' });
        }
        function reply(parentId=null,focus=true){const state=draft(chat);state.postId=post.id;state.parentId=parentId;saveDraft(chat);renderComposer(chat,d.foot,()=>{d.close();detail(chat,post);});if(focus)d.foot.querySelector('.ms-composer textarea')?.focus();}
        reply(null,false);
        document.addEventListener('uvu-moments-change', event => {
            if(event.detail.chatId!==chat.id||event.detail.archiveId!==d.t.archive||!valid(d.t))return;
            const latest=M().view(chat).find(item=>item.id===post.id);
            if(!latest||!M().canSee(chat,latest,{kind:'user',id:chat.id})){d.close();return;}
            const limit=Math.max(shown,50),scroll=d.body.scrollTop;post=latest;comments.replaceChildren();shown=0;
            do{appendPage();}while(shown<Math.min(limit,post.comments.length));d.body.scrollTop=scroll;
        },{signal:d.signal});
        if (post.comments.some(comment => comment.read === false)) M().markRead(chat, post.id).catch(error => toast(error.message));
    }
    function notifications(chat) {
        const d = dialog('新互动', chat); let count = 0;
        for (const post of M().view(chat).filter(post => M().canSee(chat, post, { kind: 'user', id: chat.id }))) {
            const unread = post.comments.filter(comment => comment.read === false && !comment.deleted); if (!unread.length) continue;
            count += unread.length;
            const row = command((M().actor(chat, unread[0].authorRef)?.name || unread[0].author) + '：' + unread[0].content, () => { d.close(); detail(chat, post, unread[0].id); }, 'ms-notification');
            row.append(node('span', '', post.content.slice(0, 50) + (unread.length > 1 ? ' · ' + unread.length + ' 条' : ''))); d.body.append(row);
        }
        if (!count) d.body.append(node('p', 'ms-empty', '暂无新互动'));
    }
    function publishDialog(chat, original = null) {
        const d = dialog(original ? '编辑动态' : '发动态', chat), content = field('正文', original?.content || '', true), by = field('发布者'), select = node('select'), people = M().actors(chat).filter(item => item.ref.kind !== 'npc' || item.enabled);
        content.input.maxLength = 10000; content.input.rows = 5;
        people.forEach((person, index) => { const option = node('option', '', person.name + (person.ref.kind === 'user' ? ' · 我' : person.ref.kind === 'character' ? ' · 角色' : ' · NPC')); option.value = String(index); select.append(option); });
        if (original) select.value = String(Math.max(0, people.findIndex(person => M().same(person.ref, original.authorRef))));
        select.disabled = !!original; by.input.replaceWith(select);
        const audience = node('details', 'ms-details'), audienceInputs = []; audience.append(node('summary', '', '可见范围'));
        for (const person of people) { const item = check(person.name, original?.audience === undefined || original.audience.some(ref => M().same(ref, person.ref))); audience.append(item.row); audienceInputs.push({ ref: person.ref, input: item.input }); }
        const pictures = node('div', 'ms-picture-list'), images = (original?.images || []).slice(), upload = node('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.multiple = true; upload.hidden = true;
        const redraw = () => { pictures.replaceChildren(); images.forEach((url, i) => { const wrap = node('div'), img = node('img'); img.src = safeImage(url); img.alt = '配图'; wrap.append(img, button('x', '移除配图', () => { images.splice(i, 1); redraw(); })); pictures.append(wrap); }); };
        const imageButton = button('plus', '添加图片', () => upload.click()); if (original) imageButton.disabled = true;
        upload.onchange = () => work(imageButton, async () => {
            guard(d.t); const files = [...upload.files]; if (files.length + images.length > 9) throw new Error('最多添加 9 张图片');
            for (const file of files) { if (file.size > 10 * 1024 * 1024) throw new Error('单张图片不能超过 10 MB'); const url = await compressImage(file, { quality: 0.8, maxWidth: 1200 }); guard(d.t); images.push(url); } redraw(); upload.value = '';
        });
        const generate = command('生成草稿', e => work(e.currentTarget, async () => {
            guard(d.t); const person = people[Number(select.value)];
            if (person.ref.kind === 'user') throw new Error('选择角色或 NPC 后生成草稿');
            const applied = await fillGeneratedDraft(d, content.input, () => AI().draftPost(chat, person.ref, d.signal), [select]);
            if (!applied && d.overlay.isConnected && valid(d.t)) toast('正文或发布人物已修改，已保留当前草稿');
        }));
        d.body.append(by.row, content.row, pictures, upload, audience); redraw(); d.foot.append(imageButton); if (!original) d.foot.append(generate);
        d.foot.append(command(original ? '保存' : '发布', e => work(e.currentTarget, async () => {
            guard(d.t); const selected = audienceInputs.filter(item => item.input.checked).map(item => item.ref);
            if (original) await M().updatePost(chat, original.id, { content: content.input.value, images, audience: selected });
            else { const post = await M().publish(chat, { content: content.input.value, images, authorRef: people[Number(select.value)].ref, audience: selected }); guard(d.t); AI().generate(chat, post.id, { automatic: true, triggerId: post.id }).catch(error => { if (visible(chat)) toast(error.message); }); }
            d.close();
        }), 'ms-button ms-primary'));
    }
    function render(chat) {
        const screen = document.getElementById('moments-screen'), enabled = M().settings(chat).enabled;
        screen?.classList.toggle('moments-social-enabled', enabled);
        if (!enabled) { screen?.querySelector('.ms-composer')?.remove(); return false; }
        const feed = document.getElementById('moments-feed-container'), scroll = document.getElementById('moments-content-area'), position = scroll.scrollTop;
        if (renderedKey) positions.set(renderedKey, position);
        const key = scopeKey(chat), restoredPosition = key === renderedKey ? position : positions.get(key) || 0; renderedKey = key;
        if (positions.size > 64) positions.delete(positions.keys().next().value);
        document.getElementById('moments-comment-input-area').style.display = 'none';
        feed.replaceChildren();
        const tools = node('div', 'ms-feed-tools'), unread = M().view(chat).filter(post => M().canSee(chat, post, { kind: 'user', id: chat.id })).reduce((total, post) => total + post.comments.filter(comment => comment.read === false && !comment.deleted).length, 0);
        tools.append(button('plus', '发动态', () => publishDialog(chat)), command(unread ? '新互动 ' + unread : '新互动', () => notifications(chat), 'ms-link'));
        const message = node('span', 'ms-status'); message.setAttribute('aria-live', 'polite'); tools.append(message);
        tools.append(button('square', '停止互动', () => AI().cancel(chat))); tools.lastChild.hidden = !AI().isBusy(chat); feed.append(tools);
        const posts = M().view(chat).filter(post => M().canSee(chat, post, { kind: 'user', id: chat.id })).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        if (!posts.length) feed.append(node('p', 'ms-empty', '暂无动态'));
        for (const post of posts) {
            const author = M().actor(chat, post.authorRef) || { name: post.author || '未知作者' }, item = node('article', 'ms-post'), main = node('div', 'ms-post-main'); item.dataset.postId = post.id;
            item.append(avatar(author)); main.append(actorLabel(chat, post.authorRef, post.author), node('p', 'ms-post-content', post.content));
            if (post.imageDescription) { const description = node('details', 'ms-image-description'); description.append(node('summary', '', '查看配图'), node('p', '', post.imageDescription)); main.append(description); }
            if (post.images?.length) { const images = node('div', 'ms-post-images'); for (const url of post.images) { if (!safeImage(url)) continue; const image = node('img'); image.src = safeImage(url); image.alt = '动态配图'; image.loading = 'lazy'; image.onclick = () => { const d = dialog('配图', chat), full = node('img', 'ms-full-image'); full.src = safeImage(url); full.alt = '动态配图'; d.body.append(full); }; images.append(image); } main.append(images); }
            const footer = node('div', 'ms-post-footer'), when = typeof formatMomentTime === 'function' ? formatMomentTime(post.timestamp) : '';
            footer.append(node('time', '', when)); const actions = node('div', 'ms-post-actions');
            const like = button('heart', '点赞', event => work(event.currentTarget, () => M().toggleLike(chat, post.id))); like.setAttribute('aria-pressed', String(post.likeActors.some(item => item.ref.kind === 'user')));
            actions.append(like, button('message-circle', '评论动态', () => composer(chat, post.id)), button('ellipsis', '动态操作', () => postOptions(chat, post))); footer.append(actions); main.append(footer);
            if (post.comments.length || post.likes.length || post.likeActors.length) {
                const interaction = node('div', 'ms-interaction');
                const legacyLikes = post.likes.filter(name => !post.likeActors.some(item => item.name === name));
                if (legacyLikes.length || post.likeActors.length) interaction.append(node('div', 'ms-likes', [...legacyLikes, ...post.likeActors.map(item => M().actor(chat, item.ref)?.name || item.name)].join('，')));
                const shown = post.comments.slice(-4); for (const comment of shown) interaction.append(commentRow(chat, post, comment));
                if (post.comments.length > shown.length) interaction.append(command('查看全部 ' + post.comments.length + ' 条评论', () => detail(chat, post), 'ms-more'));
                main.append(interaction);
            }
            item.append(main); feed.append(item);
        }
        scroll.scrollTop = restoredPosition; renderComposer(chat); return true;
    }
    function mount() {
        const group = document.querySelector('#moments-header .action-btn-group'); if (!group || document.getElementById('moments-social-settings')) return;
        const manage = button('users', '动态互动设置', () => { const chat = current(); if (chat) settings(chat); }, 'action-btn'); manage.id = 'moments-social-settings'; group.prepend(manage);
        document.getElementById('moments-screen').addEventListener('click', event => {
            const refresh = event.target.closest('#moments-refresh-btn'); if (!refresh) return;
            const chat = current(); if (chat && M().settings(chat).enabled) { event.stopImmediatePropagation(); renderMomentsScreen(); toast('动态已刷新'); }
        }, true);
    }
    document.addEventListener('uvu-moments-change', event => { const chat = current(); if (chat?.id === event.detail.chatId && chat.activeArchiveId === event.detail.archiveId && visible(chat)) renderMomentsScreen(); });
    document.addEventListener('uvu-moments-status', event => { const chat = current(); if (chat?.id !== event.detail.chatId || chat.activeArchiveId !== event.detail.archiveId) return;
        const el = document.querySelector('#moments-screen .ms-status'); if (el) el.textContent = event.detail.message;
        const stop = document.querySelector('#moments-screen .ms-feed-tools button[aria-label="停止互动"]'); if (stop) stop.hidden = !event.detail.busy;
    });
    root.UvUMomentsUI = { render, settings, publish: publishDialog, notifications, detail };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})(window);
