/* Approved Lenso revision 03. Native DOM presentation; existing controls keep
 * their callbacks, form owners and captured identities. Lenso reference: MIT.
 * Craft guidance: Unslop by Damir Sokolovsky, CC BY 4.0. */
(function () {
    'use strict';
    const q = (root, selector) => root?.querySelector(selector);
    const make = (tag, cls, text) => {
        const el = document.createElement(tag); if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text; return el;
    };
    const icon = name => {
        const el = make('span', 'lenso-icon'); el.setAttribute('aria-hidden', 'true');
        el.innerHTML = window.UvULucide?.[name] || ''; return el;
    };
    function task(label, name, action) {
        const b = make('button', 'lenso-task'); b.type = 'button';
        b.append(icon(name), make('strong', '', label)); b.onclick = action; return b;
    }
    function reveal(details) {
        if (!details) return;
        for (let el = details; el; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true;
        details.scrollIntoView({ block: 'nearest' });
    }
    function shell(panel) {
        if (panel.dataset.lensoShell) return;
        const head = q(panel, ':scope > .mono-page-nav'), title = q(head, '.mono-page-title');
        const body = q(panel, ':scope > .shared-document-body,:scope > .derived-body,:scope > .mcp-body,:scope > .calendar-body,:scope > .calendar-editor-body,:scope > .ms-dialog-body,:scope > .cc-body,:scope > .mono-memory-body,:scope > .relationship-dialog-body,:scope > .draft-scroll,:scope > #auto-memory-form,:scope > .uvu-bridge-page');
        if (!head || !title || !body) return;
        panel.dataset.lensoShell = 'true'; panel.classList.add('uvu-lenso-panel');
        if (panel.matches('.uvu-calendar,.text-editor-card,.draft-mood-editor')) panel.classList.add('lenso-large');
        if (panel.matches('.model-picker-card,.relationship-dialog,.sticker-description-card')) panel.classList.add('lenso-compact');
        title.classList.add('lenso-title');
        (q(body,':scope > .draft-form-scroll') || body).prepend(title);
        for (const button of panel.querySelectorAll('footer button[type=submit],.draft-fixed-actions button[type=submit]')) button.classList.add('panel-primary');
        head.prepend(make('span', 'lenso-nav-space'));
        const sync = () => panel.classList.toggle('lenso-has-back', [...head.querySelectorAll('.sheet-back')].some(el => !el.hidden));
        panel.addEventListener('mono-view-change', sync); sync();
    }
    function memos(panel) {
        if (!panel.classList.contains('character-memos-panel')) return;
        const tools = q(panel, '.memo-toolbar'), tabs = q(tools, '.memo-tabs'), list = q(panel, '.memo-list');
        if (tabs && tools.firstElementChild !== tabs) tools.prepend(tabs);
        if (!list || panel.dataset.lensoMemos) return; panel.dataset.lensoMemos = 'true';
        const heading = make('div', 'lenso-list-heading'), count = make('span');
        heading.append(make('h3', '', '最近记住'), count); list.before(heading);
        const refresh = () => {
            const cards = [...list.querySelectorAll(':scope > .memo-card')]; count.textContent = cards.length + ' 条';
            cards.forEach((card, i) => card.classList.toggle('lenso-featured-memo', i === 0));
            heading.firstElementChild.textContent = q(tabs, '[data-memo-filter=pending]')?.getAttribute('aria-pressed') === 'true' ? '待审核' : '最近记住';
        };
        new MutationObserver(refresh).observe(list, { childList: true }); refresh();
        const run = q(panel, '.memo-footer > button:not(.panel-primary)');
        if (run) { const actions = make('section', 'lenso-record-actions'); actions.append(run); q(panel, '.memo-settings-page')?.prepend(actions); }
        const settings = q(panel,'.memo-settings'), advanced = q(settings,':scope > .memo-options');
        if (advanced) {
            const recording = make('section','draft-card lenso-recording-options');
            const heading = make('h3','lenso-section-title','记录方式');
            const rows = [...advanced.querySelectorAll(':scope > .memo-setting')];
            recording.append(heading,...rows); advanced.before(recording); advanced.open = false;
            const caption = q(advanced,'summary'); if (caption) caption.textContent = '使用说明';
            settings.after(recording,advanced);
        }
        const back = q(panel, '.sheet-close'); if (back) back.replaceChildren(icon('x'));
        window.UvUPanelArtwork?.attach(panel, q(panel,'.memo-identity'), 'memos', () => typeof db !== 'undefined' ? db.characters.find(c => String(c.id) === panel.dataset.panelCharacterId) : null);
    }
    function summary(root, panel) {
        if (root.id !== 'auto-memory-modal' || panel.dataset.lensoMemory) return;
        panel.dataset.lensoMemory = 'true'; const form = q(root, '#auto-memory-form'); if (!form) return;
        const preview = make('section', 'lenso-summary-preview'), title = make('h3'), text = make('p');
        preview.append(make('div', 'lenso-record-meta', '上次摘要'), title, text);
        const owner = q(form, '.draft-memory-owner'); if (owner) owner.after(preview); else form.prepend(preview);
        const refresh = () => {
            const chat = typeof db !== 'undefined' && (currentChatType === 'group' ? db.groups : db.characters).find(c => c.id === currentChatId);
            const journal = (chat?.memoryJournals || []).filter(j => j.autoMemory?.kind === 'summary' || j.source === 'summary').at(-1);
            preview.hidden = root.classList.contains('vector-settings-mode'); title.textContent = journal?.title || '还没有摘要';
            const content = String(journal?.content || '整理聊天后，最近一篇摘要会显示在这里'); text.textContent = content.length > 260 ? content.slice(0,260) + '…' : content;
        };
        new MutationObserver(refresh).observe(root, { attributes:true, attributeFilter:['class'] }); refresh();
        const switches = q(form, '.panel-summary-switches'), range = q(form, '.draft-summary-range');
        if (switches && range) preview.after(switches, range);
        const run = q(root, '#auto-memory-run'), footer = q(panel, '.draft-fixed-actions');
        if (run && footer) { run.textContent = '现在总结'; run.classList.add('panel-primary'); footer.prepend(run); }
        const vector = q(root, '.vector-memory-fieldset'), index = q(vector, '.draft-vector-index'); if (!vector || !index) return;
        index.classList.add('lenso-index-hero'); vector.prepend(index);
        const metric = q(index,'.draft-setting-row:last-child'); if (metric) metric.classList.add('lenso-index-metric');
        const build = q(vector, '.draft-index-build'), more = q(vector, '.draft-vector-more'), tasks = make('div', 'lenso-task-grid');
        tasks.append(task('检索设置', 'search', () => reveal(more)));
        if (build) { build.replaceChildren(icon('book-open'), make('strong', '', '索引管理')); build.classList.add('lenso-task'); tasks.append(build); }
        const enable = q(vector, '.panel-vector-enable'); if (enable) enable.after(tasks); else index.after(tasks);
    }
    function tavern(root) {
        if (root.id !== 'uvu-story-bridge-screen' || root.dataset.lensoTavern) return; root.dataset.lensoTavern = 'true';
        const cards = q(root, '.draft-bridge-tiles'), review = q(cards, '.draft-dark'); if (review) cards.prepend(review);
        for (const card of cards?.children || []) {
            const button = q(card, 'button'), title = q(card, 'h3'); if (!button || !title) continue;
            const isReview = card === review; button.classList.add('lenso-tavern-task');
            button.replaceChildren(icon(isReview ? 'book-open' : 'refresh-cw'), make('strong', '', isReview ? '剧情审核' : '线上交接'));
            title.hidden = true; card.classList.remove('draft-dark');
        }
        const tabs = q(root, '.draft-bottom-nav'), mainTab = q(tabs, '[data-view=main]'), memoryTab = q(tabs, '[data-view=memory]');
        if (mainTab) mainTab.textContent = '剧情';
        const openMemory = memoryTab?.onclick;
        if (memoryTab) {
            const binding = make('button', '', '绑定'); binding.type = 'button'; binding.dataset.view = 'binding';
            binding.onclick = () => root.monoNavigate('binding'); tabs.replaceChild(binding, memoryTab);
        }
        const main = q(root, '.mono-subview[data-mono-view=main]'); if (!main) return;
        const journals = make('section', 'lenso-tavern-journals'); cards?.after(make('h3', 'lenso-section-title', '已记入日记'), journals);
        const render = () => {
            const id = q(root, '#uvu-bridge-handoff-character')?.value;
            const chat = typeof db !== 'undefined' && db.characters.find(c => String(c.id) === id);
            const entries = (chat?.memoryJournals || []).filter(j => j.source === 'sillytavern').slice(-3).reverse();
            const stamp = JSON.stringify(entries.map(j => [j.id,j.title,j.content])); if (journals.dataset.stamp === stamp) return;
            journals.dataset.stamp = stamp; journals.replaceChildren();
            for (const journal of entries) { const row = make('button', 'lenso-journal'); row.type = 'button'; row.append(icon('book-open'),make('strong','',journal.title || '酒馆剧情')); row.onclick = () => openMemory?.(); journals.append(row); }
            if (!entries.length) journals.append(make('p', 'lenso-empty', '审核通过的剧情会保存在这里'));
        };
        root.addEventListener('mono-view-change',render); q(root,'#uvu-bridge-handoff-character')?.addEventListener('change',render); render();
        const identity=q(root,'.draft-bridge-identity'),bindingRoute=q(identity,'.mono-route');
        if(bindingRoute){identity.after(bindingRoute);bindingRoute.classList.add('fusion-binding-route');}
        window.UvUPanelArtwork?.attach(root, identity, 'tavern', () => typeof db !== 'undefined' ? db.characters.find(c => String(c.id) === q(root,'#uvu-bridge-handoff-character')?.value) : null);
    }
    function files(panel) {
        if (!panel.classList.contains('shared-document-dialog') || panel.dataset.lensoFile) return; panel.dataset.lensoFile = 'true';
        const body = q(panel,'.shared-document-body'), text = q(body,'.shared-document-editor textarea'); if (!body || !text || text.readOnly) return;
        const upload = q(panel,'.shared-document-upload'), editor = q(panel,'.shared-document-editor'), file = q(panel,'.shared-document-file-header'), shortcuts = q(panel,'.mono-file-shortcuts');
        const intro = make('div','lenso-file-intro'); intro.append(icon('upload'),make('h3','','带一份文件进对话'),make('p','','文档、表格与文字'));
        if (upload) { upload.prepend(intro); q(upload,'small')?.remove(); }
        const recipient=q(panel,'.shared-document-context'),caption=make('h3','lenso-section-title','当前私聊');
        if(recipient){upload?.after(caption,recipient);recipient.classList.add('fusion-file-recipient');}
        const footer=q(panel,'.shared-document-actions');
        if(footer){const cancel=make('button','fusion-file-cancel','取消');cancel.type='button';cancel.onclick=()=>q(panel,'.sheet-close')?.click();footer.append(cancel);}
        const reader = make('article','lenso-file-preview'); reader.setAttribute('aria-label','发送前正文预览');
        const paragraphs = () => {
            reader.replaceChildren(); const value = text.value;
            for (const [i,p] of value.slice(0,1800).split(/\n\s*\n/).entries()) reader.append(make(i === 0 && p.length < 60 ? 'h3' : 'p','',p));
            if (value.length > 1800) reader.append(make('small','','预览已截取，展开可核对完整正文'));
        };
        text.addEventListener('input',paragraphs); text.addEventListener('change',paragraphs); if (file) file.after(reader);
        const sync = () => {
            const ready = !editor.hidden; panel.dataset.lensoFileReady = String(ready); reader.hidden = !ready;
            if(recipient){recipient.hidden=caption.hidden=ready;}footer?.classList.toggle('fusion-file-empty',!ready);
            if (upload) upload.hidden = ready; if (ready) { paragraphs(); if (shortcuts) reader.after(shortcuts); }
            const title = q(panel,'.lenso-title'); if (title) title.textContent = ready ? '准备发送' : '分享文件';
        };
        new MutationObserver(sync).observe(editor,{attributes:true,attributeFilter:['hidden']}); sync();
        if (shortcuts) {
            const [preview, edit] = shortcuts.querySelectorAll('button');
            if (edit) { edit.textContent = '编辑副本'; edit.prepend(icon('pencil')); shortcuts.prepend(edit); }
            const more = make('details','lenso-file-more'), label = make('summary','','更多');
            more.append(label); if (preview) more.append(preview);
            const replace = make('button','','更换文件'); replace.type = 'button'; replace.onclick = () => upload?.click(); more.append(replace); shortcuts.append(more);
        }
        const encoding = q(editor,'select[aria-label="文件文字编码"]');
        if (encoding) q(panel,'.shared-document-file-options')?.append(encoding);
        editor.classList.add('lenso-file-source');
    }
    function services(panel) {
        if (!panel.matches('.mcp-settings') || !panel.closest('#mcp-services')) return;
        const area = q(panel,'.mcp-services-area'), head = q(area,'.mono-service-heading'); if (head && area.firstElementChild !== head) area.prepend(head);
        if (head) { const title = q(head,'strong'); if (title) title.textContent = '服务'; }
        for (const card of panel.querySelectorAll('.mcp-service-item:not([data-lenso-service])')) {
            card.dataset.lensoService = 'true'; card.prepend(icon('link')); const arrow = icon('chevron-right'); arrow.classList.add('lenso-service-arrow'); card.append(arrow);
        }
        const actions = q(panel,'.draft-service-actions');
        if (actions && !actions.closest('.lenso-service-controls')) {
            const details = make('details','lenso-service-controls'); details.append(make('summary','','管理所选服务')); actions.before(details); details.append(actions);
        }
        if (!panel.dataset.lensoServices) { panel.dataset.lensoServices = 'true'; q(panel,'.draft-mcp-scope')?.querySelectorAll(':scope > h3').forEach(el => el.remove()); }
    }
    function decorate(root) {
        if (!root?.isConnected || root.matches('.regenerate-guidance-card,.pv-send-modes,#pv-generated-preview') || root.closest('#uvu-music-screen,.uvu-music-sheet,[id^=music-],.music-app,.music-dialog,.together-listening-dialog,#char-status-overlay')) return;
        if (root.id === 'minimax-tts-settings') root.classList.add('uvu-fusion-inline');
        const panel = root.id === 'auto-memory-modal' ? q(root,'.auto-memory-dialog') : root; if (!panel?.matches('.mono-page')) return;
        shell(panel); if (!panel.classList.contains('uvu-lenso-panel')) return;
        const title = q(panel,'.lenso-title'), scroll = q(panel,':scope > .derived-body > .draft-form-scroll');
        if (title && scroll && title.parentElement === scroll && scroll.firstElementChild !== title) scroll.prepend(title);
        memos(panel); summary(root,panel); tavern(root); files(panel); services(panel);
        if(panel.matches('.memory-library > .feature-dialog-card')&&!panel.dataset.compositionArtwork){
            const type=currentChatType,id=currentChatId;
            window.UvUPanelArtwork?.composition(panel,'memory',()=>typeof db!=='undefined'?(type==='group'?db.groups:db.characters).find(c=>c.id===id):null);
        }
        if(panel.matches('.uvu-calendar')&&!panel.dataset.compositionArtwork){
            const mine={realName:'我的日历',derivedPanelAppearance:db.calendarData?.prefs?.panelAppearance};
            mine.panelArtworkSave=async(next,guard)=>{await window.UvUCalendar.mutate(s=>{s.prefs.panelAppearance=next;},{guard,undo:false});};
            window.UvUPanelArtwork?.composition(panel,'calendar',()=>{
                const selected=q(panel,'select[aria-label="日历所属位置"]')?.value;
                if(selected==='user'){mine.derivedPanelAppearance=db.calendarData?.prefs?.panelAppearance;return mine;}
                return db.characters.find(c=>'character:'+c.id===selected)||null;
            });
        }
    }
    function additional(root) {
        const archive = root.matches('.chat-archive-panel'), forward = root.matches('#message-forward-picker > .message-forward-dialog'), css = root.matches('#global-css-import-preview > .feature-dialog-card');
        if ((!archive && !forward && !css) || root.dataset.lensoAdditional) return;
        root.dataset.lensoAdditional = 'true'; root.classList.add('uvu-panel-layout','uvu-mono-panel','mono-page','uvu-sheet-v2');
        const head = q(root,':scope > header,:scope > .message-forward-header'), title = q(head,'h2,strong');
        if (!head || !title) return;
        const close = q(head,'#close-chat-archives,.message-forward-close,[data-cancel]'), body = make('div','draft-scroll'), footer = make('footer');
        root.closest('.feature-dialog,.message-forward-overlay,.chat-archive-overlay')?.classList.add('mono-page-overlay');
        head.classList.add('mono-page-nav'); title.classList.add('mono-page-title');
        if (close) { close.classList.add('sheet-close'); close.setAttribute('aria-label','关闭'); close.replaceChildren(icon('x')); }
        const nodes = [...root.children].filter(el => el !== head); root.append(body,footer); body.append(...nodes);
        const action = archive ? q(head,'#create-chat-archive') : q(body,css?'[data-confirm]':'.message-forward-send');
        if (action) { action.classList.add('panel-primary'); footer.append(action); }
        if (archive) { title.textContent = '聊天存档'; const help = q(body,'.archive-help'); if (help) {const details = make('details','draft-notice');details.append(make('summary','','存档说明'),help);body.append(details);} }
        if (forward) root.classList.add('lenso-compact');
        shell(root);
    }
    const extraSelector = '.chat-archive-panel,#message-forward-picker > .message-forward-dialog,#global-css-import-preview > .feature-dialog-card';
    function start() {
        document.getElementById('minimax-tts-settings')?.classList.add('uvu-fusion-inline');
        document.querySelectorAll(extraSelector).forEach(additional);
        new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                if(node.id==='minimax-tts-settings')node.classList.add('uvu-fusion-inline');
                node.querySelector('#minimax-tts-settings')?.classList.add('uvu-fusion-inline');
                if (node.matches(extraSelector)) additional(node);
                node.querySelectorAll(extraSelector).forEach(additional);
            }
        }).observe(document.body,{childList:true,subtree:true});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
    window.UvULensoPanels = Object.freeze({decorate});
}());
