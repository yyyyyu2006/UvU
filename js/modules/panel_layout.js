/* Presentation only for second-edition panels. Existing controls own their data and actions. */
(function () {
    'use strict';
    const roots = '.shared-document-dialog,.memory-library > .feature-dialog-card,.mcp-settings,.derived-settings,.relationship-dialog,.text-editor-card,.model-picker-card,.sticker-description-card,.regenerate-guidance-card,.resource-health,.status-token-panel,#auto-memory-modal,#uvu-story-bridge-screen,#minimax-tts-settings,#uvu-notification-preferences';
    const monochromeRoots = '.cc-export-dialog,.ms-dialog,.uvu-calendar,.calendar-editor,.worldbook-advanced,.relationship-settings,.storage-backup-extras,.storage-backup-modes,.storage-export-format,.pv-send-modes,#pv-generated-preview,#home-preset-preview > .feature-dialog-card,.kkt-item:has(> .kkt-item-control > #setting-char-tts-voice-id)';
    const allRoots = roots + ',' + monochromeRoots;
    const initialized = new WeakSet();
    const appearanceKey = 'uvu-derived-appearance.v1';
    const appearanceDefaults = Object.freeze({ color: 'white', motion: true, reduce: false, size: 14 });
    function readAppearance() {
        let value;try{value=JSON.parse(localStorage.getItem(appearanceKey)||'{}');}catch{value={};}
        return { color:value?.color==='theme'?'theme':'white', motion:value?.motion!==false, reduce:value?.reduce===true, size:[12,14,16].includes(value?.size)?value.size:14 };
    }
    function applyAppearance(value) {
        const root=document.documentElement;
        root.dataset.uvuDerivedColor=value.color;root.dataset.uvuDerivedMotion=String(value.motion&&!value.reduce);
        root.style.setProperty('--uvu-derived-body-size',value.size+'px');
    }
    const q = (root, selector) => root?.querySelector(selector) || null;
    const make = (tag, className, text) => {
        const el = document.createElement(tag); if (className) el.className = className;
        if (text !== undefined) el.textContent = text; return el;
    };
    function label(control, text) {
        if (!control || control.dataset.panelShortLabel === text) return;
        if(control.tagName==='LABEL'){
            const input=q(control,'input,select,textarea'),copy=control.cloneNode(true);copy.querySelectorAll('input,select,textarea,button').forEach(el=>el.remove());
            const original=copy.textContent.trim();if(input&&original&&original!==text&&!input.hasAttribute('aria-label'))input.setAttribute('aria-label',original);
            control.removeAttribute('aria-label');
            const caption=[...control.children].find(el=>el.tagName==='SPAN'&&el.textContent.trim()&&!el.querySelector('input,select,textarea'));
            [...control.childNodes].filter(n=>n.nodeType===3).forEach(n=>n.remove());
            if(caption)caption.textContent=text;else control.prepend(document.createTextNode(text));
            control.dataset.panelShortLabel=text;return;
        }
        const original = control.textContent.trim();
        if (original && original !== text) control.setAttribute('aria-label', original);
        [...control.childNodes].filter(n => n.nodeType === 3).forEach(n => n.remove());
        control.append(document.createTextNode(text)); control.dataset.panelShortLabel = text;
    }
    function group(nodes, name, className = '') {
        const available = nodes.filter(Boolean); if (!available.length) return null;
        const box = make('section', 'panel-card ' + className);
        available[0].before(box); if (name) box.append(make('h3', 'panel-section-title', name));
        box.append(...available); return box;
    }
    function disclose(nodes, title, className = '', open = false) {
        const available = nodes.filter(Boolean); if (!available.length) return null;
        const details = make('details', 'panel-disclosure ' + className);
        details.append(make('summary', '', title)); details.open = open;
        available[0].before(details); details.append(...available); return details;
    }
    function asSwitch(input) {
        if (!input || input.type !== 'checkbox') return;
        input.classList.add('panel-switch'); input.setAttribute('role', 'switch');
        input.closest('label')?.classList.add('panel-switch-row');
    }
    function segment(select, labels, onChange = () => {}) {
        if (!select || select.dataset.panelSegment) return;
        select.dataset.panelSegment = 'true';
        const parent = select.closest('label'), choices = make('div', 'panel-segment');
        choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', select.getAttribute('aria-label') || select.closest('label')?.textContent.split('\n')[0].trim() || '选项');
        let previous;
        const sync = () => {
            [...choices.children].forEach((button, index) => {
                const active = select.value === button.dataset.value;
                button.setAttribute('aria-pressed', String(active)); button.disabled = select.disabled;
                if (active) choices.style.setProperty('--panel-selected-index', index);
            });
            if (previous !== select.value) { previous = select.value; onChange(previous); }
        };
        for (const option of select.options) {
            const button = make('button', '', labels[option.value] || option.textContent);
            button.type = 'button'; button.dataset.value = option.value;
            button.addEventListener('click', () => {
                if (select.disabled || button.dataset.value === select.value) return;
                select.value = button.dataset.value;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true })); sync();
            }); choices.append(button);
        }
        parent.after(choices); parent.hidden = true; select.addEventListener('change', sync);
        // Existing async handlers can restore select.value after a failed save and report
        // it through the screen status. Reflect that rollback without owning persistence.
        const screen = select.closest('.screen'); if (screen) new MutationObserver(sync).observe(screen, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true }); sync();
    }
    function summary(root) {
        const form = q(root, '#auto-memory-form'); if (!form) return;
        const field = name => form.elements.namedItem(name)?.closest('label');
        const switches = group([field('enabled'), field('useMemory'), field('hideSummarized')], '', 'panel-summary-switches');
        ['enabled', 'useMemory', 'hideSummarized', 'mergeEnabled', 'vectorSearchEnabled', 'vectorRerankEnabled'].forEach(name => asSwitch(form.elements.namedItem(name)));
        const short = { enabled: '自动总结', useMemory: '使用自动记忆', hideSummarized: '折叠并替代已总结楼层', vectorSearchEnabled: '向量记忆', vectorRerankEnabled: '重排', mergeEnabled: '合并已有记忆' };
        for (const [name, text] of Object.entries(short)) {
            const wrap = field(name); if (!wrap) continue;
            const input = form.elements.namedItem(name), old = wrap.textContent.trim();
            [...wrap.childNodes].filter(n => n.nodeType === 3).forEach(n => n.remove());
            const span = make('span', '', text); wrap.insertBefore(span, input); input.setAttribute('aria-label', old);
        }
        const status = q(root, '#auto-memory-status');
        const coverage = make('section', 'panel-card panel-coverage');
        const stats = make('div', 'panel-stats');
        for (const name of ['有效楼层', '已总结', '未总结']) { const item = make('div'); item.append(make('strong', '', '—'), make('span', '', name)); stats.append(item); }
        switches.after(coverage); coverage.append(stats);
        const details = disclose([status], '楼层详情', 'panel-coverage-details'); coverage.append(details);
        const feedback = make('p', 'panel-operation-status'); feedback.setAttribute('aria-live', 'polite'); coverage.append(feedback);
        const refresh = () => {
            const text = status.textContent, data = status.uvuMemoryStats;
            [...stats.children].forEach((item, i) => { const number = data?.[['total', 'covered', 'uncovered'][i]], value = Number.isFinite(number) ? String(number) : '—'; if (item.firstElementChild.textContent !== value) item.firstElementChild.textContent = value; });
            const lines = text.split('\n'), last = lines.at(-1) || '';
            const value = /^(排除原因|下一条未覆盖|当前没有未覆盖|保留最近|自动整理)/.test(last) ? '' : last;
            if (feedback.textContent !== value) feedback.textContent = value;
            if (status.classList.contains('memory-error')) { details.open = true; feedback.classList.add('panel-error'); }
            else feedback.classList.remove('panel-error');
        };
        new MutationObserver(refresh).observe(status, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] }); refresh();
        const apiLabel = field('apiSource'), api = q(root, '#memory-api-panel');
        group([apiLabel, api], '总结 API', 'panel-summary-api');
        const floors = [...form.children].find(el => el.matches('fieldset') && el.querySelector('[name=keepRecent]'));
        if (floors) coverage.after(floors);
        const sizeFields=['useTargetLength','targetLength'].map(field).filter(Boolean);
        if(sizeFields.length)disclose(sizeFields,'摘要长度','draft-summary-length');
        const floorNotes=floors?[...floors.querySelectorAll(':scope > .auto-memory-help')]:[];if(floorNotes.length)disclose(floorNotes,'整理规则','draft-notice');
        const apiVisible = () => { api.hidden = form.elements.namedItem('apiSource').value !== 'memory'; };
        form.elements.namedItem('apiSource').addEventListener('change', apiVisible);
        const summaryAdvanced = [...form.children].filter(el => el.matches('fieldset:not(.vector-memory-fieldset)') && el.querySelector('[name=mergeEnabled]'));
        const compression = disclose(summaryAdvanced, '合并与压缩', 'panel-summary-advanced');
        const requirements = field('requirements');
        const extra = disclose([requirements], '补充要求', 'panel-summary-extra');
        const custom = form.elements.namedItem('summaryPrompt')?.closest('details');
        if (custom) { custom.classList.add('panel-disclosure'); q(custom, 'summary').textContent = '自定义总结提示词'; }
        group([compression, extra, custom], '', 'panel-summary-options');
        label(q(root, '#auto-memory-run'), '保存并总结一批'); label(q(form, 'button[type=submit]'), '保存');
        const guidance = [...form.querySelectorAll(':scope > .auto-memory-guide')];
        guidance.forEach(guide => guide.classList.add('panel-disclosure'));
        const guides = group(guidance, '', 'panel-summary-guides');
        if (guides) form.insertBefore(guides, q(form, '.auto-memory-actions'));
        const vector = q(root, '.vector-memory-fieldset'), vectorApi = q(root, '#vector-api-panel');
        if (vector && vectorApi) {
            const rerankFlag = field('vectorRerankEnabled');
            vectorApi.after(rerankFlag);
            const rerankNodes = ['rerank-mode', 'rerank-model', 'rerank-url', 'rerank-key'].map(id => q(root, '#vector-api-' + id)?.closest('label'));
            const rerank = disclose(rerankNodes, '重排模型', 'panel-rerank-api', true); if (rerank) rerankFlag.after(rerank);
            const advancedNodes = ['batch-size', 'query-prefix', 'document-prefix', 'task-mode', 'timeout'].map(id => q(root, '#vector-api-' + id)?.closest('label'));
            disclose(advancedNodes, '嵌入高级设置', 'panel-embedding-advanced');
            q(vectorApi, 'summary').textContent = '嵌入模型';
            const grid = q(vector, '.auto-memory-grid');
            const enable = group([field('vectorSearchEnabled')], '', 'panel-vector-enable');
            const embedding = group([vectorApi], '', 'panel-vector-embedding');
            const retrieval = group([grid, q(vector, ':scope > .auto-memory-guide')], '检索设置', 'panel-vector-retrieval');
            const ranking = group([rerankFlag, rerank], '', 'panel-vector-rerank');
            [enable, embedding, retrieval, ranking].forEach((section, index) => {
                if (section) { section.dataset.vectorSection = ['enable', 'embedding', 'retrieval', 'rerank'][index]; vector.append(section); }
            });
            const refinements = q(vector, '.vector-refinements'); if (refinements) vector.append(refinements);
            // Keep the API controls in their existing details/form and retain callbacks.
            vectorApi.classList.add('panel-disclosure');
            const apiActions = make('div', 'panel-vector-api-actions');
            const fetchModels = q(root, '#vector-api-fetch-models'), testApi = q(root, '#vector-api-test');
            fetchModels.before(apiActions); apiActions.append(fetchModels, testApi);
            label(fetchModels, '获取模型'); label(testApi, '测试接口');
            const rerankVisible = () => { if (rerank) rerank.hidden = !form.elements.namedItem('vectorRerankEnabled').checked; };
            form.elements.namedItem('vectorRerankEnabled').addEventListener('change', rerankVisible);
            let wasVisible = false;
            const sync = () => {
                apiVisible(); rerankVisible();
                const visible = root.classList.contains('visible');
                if (visible && !wasVisible) vectorApi.open = false;
                wasVisible = visible;
            };
            new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] }); sync();
        }
    }
    function configurationWorkspace(details,title,id) {
        if(!details?.isConnected||document.getElementById(id))return;
        const form=details.closest('form'),host=details.closest('#auto-memory-modal'),anchor=document.createComment('configuration-fields'),previousHidden=details.hidden,previousOpen=details.open,summary=q(details,':scope > summary'),previousSummaryHidden=summary?.hidden;
        details.before(anchor);
        const fields=[...details.querySelectorAll('input,textarea,select,button')].map(el=>[el,el.getAttribute('form')]);
        if(form){form.id||='draft-configuration-form';for(const [el]of fields)el.setAttribute('form',form.id);}
        let observer;
        const d=createMessageForwardDialog(title,id,()=>{
            observer?.disconnect();details.hidden=previousHidden;details.open=previousOpen;if(summary)summary.hidden=previousSummaryHidden;
            if(anchor.isConnected)anchor.replaceWith(details);
            for(const [el,value]of fields){if(value===null)el.removeAttribute('form');else el.setAttribute('form',value);}
        });d.panel.classList.add('derived-settings','draft-configuration-workspace');
        const body=make('div','derived-body'),footer=make('footer');details.hidden=false;details.open=true;if(summary)summary.hidden=true;body.append(details);
        if(form){const save=make('button','panel-primary','保存设置');save.type='submit';save.setAttribute('form',form.id);footer.append(save);}
        d.panel.append(body,footer);
        if(host){observer=new MutationObserver(()=>{if(!host.classList.contains('visible'))d.dismiss();});observer.observe(host,{attributes:true,attributeFilter:['class']});}
    }
    function library(root) {
        const toolbar = q(root, '.memory-library-toolbar'), header = q(root, 'header');
        if (!toolbar || !header) return;
        const add = q(toolbar, '[data-action=add]'); if (add) { add.classList.add('panel-primary'); header.insertBefore(add, header.lastElementChild); }
        const filter = q(root, '.memory-library-filters input[type=search]')?.closest('label');
        if (filter) { filter.classList.add('panel-library-search'); toolbar.before(filter); [...filter.childNodes].filter(n => n.nodeType === 3).forEach(n => n.remove()); q(filter, 'input').setAttribute('aria-label', '搜索记忆'); q(filter, 'input').placeholder = '搜索记忆'; }
        const status=q(root,'.memory-library-status');
        if(status){const compact=()=>status.classList.toggle('draft-memory-count-only',/^共 \d+ 篇记忆；历史剧情索引 \d+ 组。$/.test(status.textContent));new MutationObserver(compact).observe(status,{childList:true,characterData:true,subtree:true});compact();}
        const integrate = q(toolbar, '[data-action=integrate]'), index = q(toolbar, '.memory-library-index-actions');
        const more = disclose([integrate, index], '索引与管理', 'panel-library-more');
        const category = q(toolbar, 'label'), filters = q(root, '.memory-library-filters');
        if (category && filters) filters.prepend(category);
        if (more) root.append(more);
        if (!toolbar.children.length) toolbar.hidden = true;
        const tuning = q(root, '.memory-library-tuning > summary'); if (tuning) tuning.textContent = '限额与审阅';
        const diagnostics = q(root, '.memory-library-diagnostics > summary'); if (diagnostics) diagnostics.textContent = '检索诊断';
    }
    function libraryRows(root) {
        root.querySelectorAll('.memory-library-list > .memory-library-card').forEach(card => {
            if (card.dataset.panelPreview) return; card.dataset.panelPreview = 'true';
            const text = q(card, ':scope > pre'); if (!text) return;
            text.classList.add('panel-memory-preview');
            const expand = make('button', 'panel-text-action', '展开正文'); expand.type = 'button'; expand.setAttribute('aria-expanded', 'false');
            expand.onclick = () => { const open = card.classList.toggle('panel-memory-expanded'); expand.textContent = open ? '收起正文' : '展开正文'; expand.setAttribute('aria-expanded', String(open)); };
            text.after(expand);
            expand.hidden = text.textContent.length <= 180;
            const read=make('button','panel-text-action','阅读记忆');read.type='button';
            read.onclick=()=>{
                const edit=[...card.querySelectorAll(':scope > button')].find(button=>/编辑内容|编辑/.test(button.getAttribute('aria-label')||button.textContent));
                const d=createMessageForwardDialog('记忆详情','draft-memory-reader');d.panel.classList.add('derived-settings');
                const body=make('div','derived-body'),footer=make('footer'),title=q(card,'.memory-library-pick strong');
                const stamp=Number(card.dataset.memoryCreatedAt),date=stamp?new Date(stamp):null;
                if(date)body.append(make('small','',date.toLocaleString([],{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})));
                body.append(make('h2','draft-memory-reader-title',title?.textContent||'记忆'));
                const sourceLabels={manual:'手动记录',summary:'自动总结',sillytavern:'酒馆',moments:'动态'},source=card.dataset.memorySource;
                body.append(make('span','draft-tag',sourceLabels[source]||'记忆'),make('p','draft-memory-reader-content',text.textContent));
                const sources=make('section','draft-card draft-memory-provenance');const owner=root.querySelector('.draft-identity');if(owner){const row=make('div','draft-setting-row');row.append(make('span','','所属角色'),make('small','',q(owner,'strong')?.textContent||''));sources.append(row);}
                const provenance=card.memoryPresentation;
                if(provenance?.canFavorite){
                    const row=make('label','draft-memory-use'),toggle=make('input');toggle.type='checkbox';toggle.checked=provenance.favorite;toggle.setAttribute('aria-label','用于后续记忆');row.append(make('span','','用于后续记忆'),toggle);sources.prepend(row);asSwitch(toggle);
                    toggle.onchange=async()=>{const before=!toggle.checked;toggle.disabled=true;try{await provenance.setFavorite(toggle.checked);}catch(error){toggle.checked=before;feedback.textContent=error.message;}finally{toggle.disabled=false;}};
                }
                if(provenance)for(const [name,value]of [['来源存档',provenance.archive],['原文楼层',provenance.floors]]){if(!value)continue;const row=make('div','draft-setting-row');row.append(make('span','',name),make('small','',value));sources.append(row);}
                const diagnostics=make('details','draft-memory-diagnostics');diagnostics.append(make('summary','','来源与引用详情'));sources.append(diagnostics);
                for(const node of card.querySelectorAll(':scope > .feature-help,.draft-memory-metadata')) {
                    const copy=node.cloneNode(true);copy.querySelectorAll('button,input').forEach(el=>el.remove());
                    for(const detail of [...copy.querySelectorAll('details')].reverse()){
                        const caption=q(detail,':scope > summary'),children=[...detail.childNodes].filter(el=>el!==caption);
                        if(!children.some(el=>el.textContent.trim())){detail.remove();continue;}
                        const section=make('section','draft-memory-source-section');if(caption)section.append(make('strong','',caption.textContent));section.append(...children);detail.replaceWith(section);
                    }
                    if(copy.matches('details')){q(copy,':scope > summary')?.remove();diagnostics.append(...copy.childNodes);}else diagnostics.append(copy);
                }body.append(sources);
                const feedback=make('p','panel-operation-status');feedback.setAttribute('role','status');
                const actions=make('div','draft-columns draft-memory-reader-actions');
                if(edit){const action=make('button','','编辑');action.type='button';action.dataset.icon='pencil';action.onclick=()=>{d.dismiss();if(provenance?.edit)provenance.edit();else if(edit.isConnected)edit.click();};actions.append(action);}
                if(provenance?.source){const source=make('button','','查看原文');source.type='button';source.dataset.icon='book-open';source.onclick=()=>{source.disabled=true;try{const group=make('section','draft-memory-original');body.append(group);provenance.source(group);const details=q(group,'details');if(details)details.open=true;group.scrollIntoView({block:'nearest'});}catch(error){feedback.textContent=error.message;source.disabled=false;}};actions.append(source);}
                body.append(actions);
                if(provenance?.remove){const remove=make('button','draft-memory-remove','删除记忆');remove.type='button';remove.dataset.icon='trash-2';remove.onclick=async()=>{remove.disabled=true;try{if(await provenance.remove())d.dismiss();}catch(error){feedback.textContent=error.message;}finally{remove.disabled=false;}};body.append(remove);}
                body.append(feedback);
                d.panel.append(body);
            };text.after(read);
            const heading=q(card,'.memory-library-pick strong');if(heading){read.classList.add('draft-memory-title');heading.after(read);read.textContent=heading.textContent;read.setAttribute('aria-label','阅读记忆');heading.hidden=true;}
            const dateValue=Number(card.dataset.memoryCreatedAt);if(dateValue){const date=new Date(dateValue),day=make('time','draft-memory-date',date.toLocaleDateString([],{month:'long',day:'numeric'})),clock=make('time','draft-memory-clock',date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}));day.dateTime=clock.dateTime=date.toISOString();card.prepend(day,clock);}
            card.append(make('span','draft-tag draft-memory-source',({manual:'手动记录',summary:'自动总结',sillytavern:'酒馆',moments:'动态'})[card.dataset.memorySource]||'记忆'));
            const metadata = [...card.children].filter(el => el.matches('.feature-help,details'));
            if (metadata.length) { const details = make('details', 'draft-memory-metadata'); details.append(make('summary', '', '来源与引用'), ...metadata); card.append(details); }
            for (const button of card.querySelectorAll(':scope > button')) if (/编辑内容/.test(button.textContent)) label(button, '编辑');
        });
    }
    function tavern(root) {
        const connection = q(root, '#uvu-story-bridge-settings > .kkt-item'); if (!connection) return;
        ['uvu-bridge-enabled', 'uvu-bridge-inject-scenes'].forEach(id => asSwitch(q(root, '#' + id)));
        const config = disclose([q(root, '#uvu-bridge-tt-transport'), q(root, '#uvu-bridge-online-controls')], '连接设置', 'panel-bridge-config', true);
        segment(q(root, '#uvu-bridge-channel'), { st: 'SillyTavern', tt: 'TT / iOS' }, value => { if (config) config.open = value !== 'tt'; });
        const intro = q(root, '#uvu-bridge-intro'); disclose([intro], '互通说明', 'panel-bridge-intro');
        const heading = q(connection, '.kkt-item-content'); heading.append(q(root, '#uvu-bridge-enabled').closest('label'));
        const review = q(root, '.uvu-bridge-review'), reviewHeading = q(root, '.uvu-bridge-review-heading');
        reviewHeading.append(q(root, '#uvu-bridge-sync'), q(root, '#uvu-bridge-refresh-review'));
        label(q(root, '#uvu-bridge-sync'), '收取'); label(q(root, '#uvu-bridge-refresh-review'), '刷新');
        q(root, '#uvu-bridge-review-title').textContent = '待审核剧情';
        const help = q(review, '.uvu-bridge-review-help'); disclose([help], '审核说明', 'panel-review-help');
        const onlineActions = q(root, '#uvu-bridge-online-actions');
        if (config) {
            config.append(onlineActions);
            onlineActions.append(q(root, '#uvu-bridge-recover'));
        }
        const syncButton = q(root, '#uvu-bridge-sync');
        const syncTransport = () => { syncButton.hidden = onlineActions.hidden || onlineActions.style.display === 'none'; };
        new MutationObserver(syncTransport).observe(onlineActions, { attributes: true, attributeFilter: ['hidden', 'style'] }); syncTransport();
        const handoff = q(root, '.uvu-bridge-handoff');
        const header = make('div', 'panel-section-heading'); q(handoff, 'h3').before(header);
        header.append(q(handoff, 'h3'), q(root, '#uvu-bridge-use-current')); label(q(root, '#uvu-bridge-use-current'), '刷新存档');
        const char = q(root, '#uvu-bridge-handoff-character').closest('label'), save = q(root, '#uvu-bridge-save-character');
        const roleRow = make('div', 'panel-bridge-role'); char.before(roleRow); roleRow.append(char, save); label(save, '保存角色');
        const range = q(root, '.uvu-bridge-range');
        const rangeDetails = disclose([range, q(root, '#uvu-bridge-latest')], '消息范围', 'panel-bridge-range');
        const updateRange = () => {
            const start = q(root, '#uvu-bridge-handoff-start').value, end = q(root, '#uvu-bridge-handoff-end').value;
            const text = `消息范围 · ${start || '—'}—${end || '—'}`;
            if (rangeDetails.firstElementChild.textContent !== text) rangeDetails.firstElementChild.textContent = text;
        };
        for (const id of ['uvu-bridge-handoff-start', 'uvu-bridge-handoff-end']) q(root, '#' + id).addEventListener('input', updateRange);
        new MutationObserver(updateRange).observe(q(root, '#uvu-bridge-handoff-source'), { childList: true, subtree: true, characterData: true }); updateRange();
        group([q(root, '#uvu-bridge-handoff-receipt'), q(root, '#uvu-bridge-handoff-source'), rangeDetails], '', 'panel-bridge-metadata');
        const handoffButton = q(root, '#uvu-bridge-handoff'); handoffButton.classList.add('panel-primary'); label(handoffButton, '交接所选消息');
        label(q(root, '#uvu-bridge-export-file'), '导出线上文件'); label(q(root, '#uvu-bridge-import-file'), '导入剧情文件');
        const note = q(handoff, ':scope > p.uvu-bridge-note'); disclose([note], '交接说明', 'panel-handoff-help');
        const options = q(root, '#uvu-bridge-inject-scenes').closest('label'); review.prepend(options);
        tavernPage(root);
    }
    function voice(root) {
        const connection = q(root, '.minimax-settings-section'), playback = q(root, '.minimax-settings-section:nth-of-type(2)');
        const director = q(root, '.minimax-director-settings'); if (!connection || !playback || !director) return;
        const connectionDetails = disclose([connection], '语音连接', 'panel-voice-connection');
        playback.before(connectionDetails); connectionDetails.open = !q(root, '#minimax-tts-key').value;
        const sync = () => { if (!q(root, '#minimax-tts-key').value.trim()) connectionDetails.open = true; };
        q(root, '#minimax-tts-preview').addEventListener('click', sync);
        asSwitch(q(root, '#minimax-director-enabled'));
        const fields = q(root, '#minimax-director-fields');
        const toggle=q(root,'label[for=minimax-director-enabled]');if(toggle){toggle.classList.add('draft-director-enable');const caption=q(toggle,'span');if(caption)caption.textContent='导演控制';}
        const api = ['provider', 'endpoint', 'key', 'model'].map(id => q(root, '#minimax-director-' + id)?.closest('label'));
        const apiDetails=disclose(api.slice(0,3), '导演 API', 'panel-director-api');
        if(apiDetails){apiDetails.open=false;label(q(apiDetails,'summary'),'独立文本 API');apiDetails.before(make('small','draft-api-caption','导演 API'));}
        if(api[3]&&apiDetails)apiDetails.after(api[3]);
        const rules = [q(root, '#minimax-director-context')?.closest('.minimax-tts-field-row'), q(root, '#minimax-director-prompt')?.closest('label')];
        const rulesDetails = group(rules, '', 'panel-director-rules');
        const prompt=q(root,'#minimax-director-prompt')?.closest('label');
        if(prompt){prompt.classList.add('draft-director-instruction');q(prompt,'textarea').setAttribute('aria-label','导演要求');for(const node of [...prompt.childNodes])if(node.nodeType===3)node.remove();}
        if(api[3])label(api[3],'模型');
        label(q(root,'#minimax-director-context')?.closest('label'),'上下文');
        label(q(root,'#minimax-director-timeout')?.closest('label'),'超时');
        const preset = q(fields, '#minimax-director-preset');
        if(preset){segment(preset,{});const choices=preset.closest('label').nextElementSibling;if(choices)fields.prepend(choices);}
        const tags = make('div', 'panel-director-tags draft-card'); ['情绪', '语速', '停顿'].forEach(text => { const row=make('span'), icon=make('span','draft-included-icon');icon.innerHTML=window.UvULucide?.['square-check']||window.UvULucide?.check||'';row.append(icon,document.createTextNode(text));tags.append(row); });
        if(preset?.closest('label').nextElementSibling)preset.closest('label').nextElementSibling.after(tags);else fields.prepend(tags);
        const notes = [...fields.querySelectorAll(':scope > .kkt-item-subtitle')]; const help=disclose(notes, '用量与回退', 'panel-director-help');if(help)fields.append(help);
        const notice=make('p','draft-notice','标签仅供语音合成参考，不展示、不朗读。');fields.append(notice);
    }
    function editor(root) {
        const header = q(root, ':scope > header'), search = q(root, '.editor-search'), footer = q(root, ':scope > footer'); if (!header || !search || !footer) return;
        footer.textContent = '应用后请在原页面保存。';
        const actions = make('div', 'panel-editor-actions');
        [...header.querySelectorAll('button')].forEach(button => actions.append(button)); footer.after(actions);
        const find = disclose([search], '查找与替换', 'panel-editor-search', Boolean(q(search, '.editor-find')?.value));
        const replace = [q(search, '.editor-replace'), q(search, '[data-action=replace]'), q(search, '[data-action=replaceAll]'), q(search, '[data-action=undo]')];
        const replacements = disclose(replace, '替换', 'panel-editor-replace');
        const replacementRow = make('div', 'panel-editor-replace-content');
        replacementRow.append(...replace.filter(Boolean)); replacements.append(replacementRow);
        const toolbar = make('div', 'draft-editor-toolbar'), undo = q(search, '[data-action=undo]');
        if (undo) { label(undo, '撤销替换'); toolbar.append(undo); }
        const findButton = make('button', '', '查找'); findButton.type = 'button';
        findButton.onclick = () => { find.open = !find.open; findButton.setAttribute('aria-expanded', String(find.open)); if (find.open) q(search, '.editor-find')?.focus(); };
        findButton.setAttribute('aria-expanded', String(find.open)); toolbar.append(findButton);find.before(toolbar);
        const draft = q(root, '.editor-draft'), count = make('small', 'draft-editor-count');
        if (draft) { const update = () => count.textContent = draft.value.length + ' 字'; draft.addEventListener('input', update);root.addEventListener('click', () => queueMicrotask(update));update();footer.prepend(count); }
        root.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && ['f', 'h'].includes(e.key.toLowerCase())) {
                find.open = true; if (e.key.toLowerCase() === 'h') replacements.open = true;
            }
            if (e.key !== 'Tab') return;
            // The existing editor trap predates disclosures. Include summary controls
            // and skip closed contents so the cycle never targets a hidden field.
            const controls = [...root.querySelectorAll('button,input,select,textarea,summary,[tabindex]')].filter(el => {
                if (el.disabled || el.tabIndex < 0 || el.closest('[hidden],[inert]') || !el.getClientRects().length) return false;
                let parent = el.parentElement;
                while (parent && parent !== root) {
                    if (parent.tagName === 'DETAILS' && !parent.open && !parent.firstElementChild?.contains(el)) return false;
                    parent = parent.parentElement;
                }
                return true;
            });
            e.stopPropagation();
            const first = controls[0], last = controls.at(-1);
            if (!first) { e.preventDefault(); return; }
            if ((e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
                e.preventDefault(); (e.shiftKey ? last : first).focus();
            }
        }, true);
        root.addEventListener('focusin', e => { if (search.contains(e.target)) find.open = true; });
    }
    function environment(root) {
        if (root.classList.contains('uvu-calendar')) return;
        const body = q(root, '.derived-body'); if (!body) return;
        if (root.classList.contains('environment-calendar')) {
            const clock = q(body, '.environment-clock'), weather = clock?.nextElementSibling;
            if (clock) group([clock, weather?.matches('.derived-help') ? weather : null], '', 'panel-environment-overview');
        } else {
            const service = q(body, '[data-service]'), mcp = q(body, '[data-mcp]');
            if (service && mcp) { const advanced = disclose([service, mcp], '数据服务', 'panel-environment-service'); const footer = q(body, ':scope > footer'); if (footer) footer.before(advanced); }
        }
        ['enabled', 'remoteEnabled', 'aiEnabled'].forEach(name => asSwitch(q(body, 'input[name="' + name + '"]')));
    }
    function mcp(root) {
        const body = q(root, '.mcp-body'); if (!body || !root.closest('#mcp-services')) return;
        const global = root.closest('#mcp-services') && q(body, ':scope > label.mcp-check input'); asSwitch(global);
        if (global) { global.setAttribute('aria-label', global.closest('label').textContent.trim()); group([global.closest('label')], '', 'panel-mcp-global'); }
        const planner = [...body.querySelectorAll(':scope > details')].find(el => /独立工具判断/.test(el.firstElementChild?.textContent));
        if (planner) q(planner, 'summary').textContent = '自动调用配置';
        const logs = [...body.querySelectorAll(':scope > details')].find(el => /最近调用与用量/.test(el.firstElementChild?.textContent));
        if (logs) q(logs, 'summary').textContent = '调用记录';
        const options = [...body.querySelectorAll(':scope > details')];
        const transfers = q(body, ':scope > .mcp-row');
        // Keep the existing disclosure nodes and callbacks together, including live permissions.
        const settings = group([...options.filter(el => !el.classList.contains('mcp-tutorial')), transfers, q(body, ':scope > .mcp-tutorial')], '', 'panel-mcp-options');
        settings?.querySelectorAll(':scope > details').forEach(el => el.classList.add('panel-disclosure'));
        if (root.closest('#mcp-services')) {
            const services = q(body, '.mcp-services-area'), tools = q(body, '.mcp-tools-area'), roles = q(body, '.mcp-roles-area');
            if (services && tools && roles) {
                const routes = make('section', 'draft-mcp-scope'); services.after(routes);
                root.monoNavigate = subviews(root, body, [
                    { id: 'main', title: 'MCP', nodes: [q(body, '.panel-mcp-global'), services, routes] },
                    { id: 'tools', title: '工具授权', nodes: [tools] },
                    { id: 'roles', title: '角色可用服务', nodes: [roles] },
                    { id: 'options', title: '服务设置', nodes: [settings] },
                    { id: 'logs', title: '调用记录', nodes: [logs] }
                ]);
                const scope=make('section','mono-route-list'),record=make('section','mono-route-list');
                for (const [id, title] of [['tools', '工具授权'], ['roles', '角色可用服务']]) scope.append(routeButton(title, () => root.monoNavigate(id)));
                record.append(routeButton('查看调用记录',()=>root.monoNavigate('logs')));
                const help=routeButton('连接帮助与设置',()=>root.monoNavigate('options'));help.classList.add('draft-mcp-help');
                routes.append(make('h3','','使用范围'),scope,make('h3','','调用记录'),record,help);
                if(logs)logs.open=true;
                const footer=q(root,'.mcp-actions'),tabs=make('nav','draft-bottom-nav');tabs.setAttribute('aria-label','MCP 导航');
                for(const [id,text]of [['main','服务'],['tools','授权'],['logs','记录']]){const b=make('button','',text);b.type='button';b.dataset.view=id;b.onclick=()=>root.monoNavigate(id);tabs.append(b);}
                footer?.append(tabs);root.addEventListener('mono-view-change',()=>{for(const b of tabs.children)b.setAttribute('aria-current',b.dataset.view===root.dataset.monoView?'page':'false');});root.monoNavigate('main',false);
            }
        }
    }
    function actions(root) {
        // Compact task actions only; keep original headers, circular controls and lists intact.
        if (root.classList.contains('status-token-panel')) return;
        for (const button of root.querySelectorAll('button')) {
            if (button.matches('#auto-memory-close,.message-forward-close,[data-action=close],.shared-document-upload,.shared-document-info') ||
                button.closest('.app-header,.panel-segment,.model-picker-list,.environment-calendar')) continue;
            button.classList.add('panel-compact-action');
        }
        if (root.classList.contains('mcp-settings') && root.closest('#mcp-services')) {
            const row = q(root, '.mcp-body > section:not(.panel-mcp-global) > .mcp-row');
            if (row && row.querySelectorAll(':scope > button').length === 4) {
                row.classList.add('panel-mcp-service-actions');
                const test = row.lastElementChild;
                label(test, '测试工具'); test.title = '测试连接并刷新工具';
            }
        }
    }
    function extra(root) {
        root.querySelectorAll('.relationship-help').forEach(p => { if (!p.closest('details')) disclose([p], '规则说明', 'panel-inline-help'); });
        if (root.classList.contains('relationship-dialog')) {
            const body = q(root, '.relationship-dialog-body');
            if (body && !q(body, '.draft-identity') && typeof db !== 'undefined') {
                const chat = db.characters.find(c => c.id === currentChatId);
                if (chat) body.prepend(identityRow(chat, '当前好友'));
            }
            root.querySelectorAll('.relationship-quick-actions:not([data-draft-actions])').forEach(section => {
                section.dataset.draftActions = 'true';
                const actions = make('div', 'draft-relationship-actions');
                actions.append(...section.querySelectorAll(':scope > button')); section.append(actions);
            });
            const sections = [...root.querySelectorAll('.relationship-section')];
            const autonomy = sections.find(el => /允许角色自主|角色自主/.test(q(el, 'strong')?.textContent));
            const recovery = sections.find(el => q(el, '#relationship-recovery-mode')); if (autonomy && recovery && autonomy.nextElementSibling !== recovery) recovery.before(autonomy);
            for (const section of [autonomy, recovery].filter(Boolean)) {
                if (section.closest('details')) continue;
                const title = q(section, ':scope > strong');
                disclose([section], title?.textContent || '关系规则', 'draft-relationship-rule');
                if (title) title.hidden = true;
            }
        }
        if (root.id === 'uvu-notification-preferences' && !root.dataset.panelPreferences) {
            root.dataset.panelPreferences = 'true'; root.classList.add('panel-preferences');
            label(q(root, ':scope > summary'), '通知偏好');
            disclose([...root.querySelectorAll(':scope > p')].slice(0, 2), '权限与能力', 'panel-notification-help');
            const toggles = [...root.querySelectorAll(':scope > label > input[type=checkbox]')];
            ['避免重复通知', '按聊天合并', '静音时段', '此聊天免打扰'].forEach((text, i) => {
                const input = toggles[i]; if (input) { label(input.closest('label'), text); asSwitch(input); }
            });
        }
        root.querySelectorAll('input[type=checkbox]').forEach(input => {
            if (input.closest('.sticker-description-toggle') || input.id === 'relationship-autonomy-enabled') asSwitch(input);
        });
        if(root.closest('#sticker-description-editor'))root.querySelectorAll('label:has(>input[type=checkbox]) input').forEach(asSwitch);
        if (root.classList.contains('derived-settings') && q(root, '.avatar-candidate-preview')) {
            const form = q(root, '.derived-body');
            const notes = [...form.querySelectorAll(':scope > .derived-help')]; disclose(notes, '判断与用量', 'panel-avatar-help');
            const candidates = q(root, '.avatar-candidate-preview'); if (!candidates.dataset.panelOpened) { candidates.dataset.panelOpened = 'true'; candidates.open = true; }
        }
    }
    function decorate(root) {
        if (!root.isConnected) return;
        // Explicit allow-list: music and original screens never receive this surface.
        if (root.closest('#uvu-music-screen,.uvu-music-sheet,[id^=music-],.music-app,.music-dialog,.together-listening-dialog')) return;
        if (!initialized.has(root)) {
            initialized.add(root); root.classList.add('uvu-panel-layout', 'uvu-mono-panel');
            if (root.id === 'auto-memory-modal') summary(root);
            else if (root.id === 'uvu-story-bridge-screen') tavern(root);
            else if (root.id === 'minimax-tts-settings') voice(root);
            else if (root.matches('.memory-library > .feature-dialog-card')) library(root);
            else if (root.classList.contains('text-editor-card')) editor(root);
            else if (root.classList.contains('mcp-settings')) mcp(root);
            else if (root.classList.contains('derived-settings')) environment(root);
            if (root.classList.contains('shared-document-dialog')) documentLayout(root);
            if (root.classList.contains('cc-export-dialog')) exportLayout(root);
            if (root.matches('#home-preset-preview > .feature-dialog-card')) {
                root.classList.add('derived-settings');
                const head=q(root,':scope > header'), body=make('div','derived-body'),footer=make('footer'),accept=q(root,'[data-confirm]');
                const nodes=[...root.children].filter(el=>el!==head&&el!==accept);root.append(body,footer);body.append(...nodes);if(accept)footer.append(accept);
                const notes=[...body.querySelectorAll(':scope > p:not(.preset-summary)')];if(notes.length)disclose(notes,'资源与脚本说明','draft-notice');
            }
            if (root.classList.contains('ms-dialog') && q(root, '.ms-dialog-head strong')?.textContent === '动态互动') {
                const toggles = [...root.querySelectorAll('.ms-dialog-body > .ms-check')];
                toggles.forEach(row => asSwitch(q(row, 'input')));
                group(toggles, '', 'mono-social-switches');
            }
            if (root.classList.contains('mcp-settings') && root.closest('#mcp-services')) {
                const toggle = q(root, '.panel-mcp-global label');
                if (toggle) { const caption = q(toggle, 'span'); if (caption) caption.textContent = '启用 MCP'; }
            }
            root.addEventListener('invalid', event => {
                let parent = event.target.parentElement;
                while (parent && parent !== root) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
            }, true);
        }
        libraryRows(root); extra(root); actions(root);
        inlineSettings(root);
        pageLayout(root);
        mcpServiceRows(root);
        mcpToolRows(root);
        draftDetails(root);
        if(root.id==='auto-memory-modal'){const more=q(root,'.draft-vector-more'),refine=q(root,'.vector-refinements');if(more&&refine&&!more.contains(refine))more.append(refine);}
        if (root.classList.contains('status-token-panel')) statusWorkspace(root);
        if (root.id === 'minimax-tts-settings') voiceEnhancements(root);
        if (root.id === 'uvu-story-bridge-screen') reviewLayout(root);
        alignAtlas(root);
        for (const input of root.querySelectorAll('input[type=search]')) {
            if (input.closest('.draft-search,.draft-document-search')) continue;
            const bar = make('div', 'draft-search'), icon = make('span', 'draft-search-icon');
            icon.innerHTML = window.UvULucide?.search || ''; icon.setAttribute('aria-hidden','true');
            input.before(bar); bar.append(icon,input);
        }
    }
    function reviewLayout(root) {
        const host = q(root, '#uvu-bridge-review-list'), review = q(root, '.uvu-bridge-review'), footer = q(root, '.mono-bridge-footer');
        if (host && review && footer) {
            let primary = q(footer, '.draft-review-primary');
            if (!primary) { primary = make('div', 'draft-review-primary'); footer.prepend(primary); }
            const injection = q(review, '#uvu-bridge-inject-scenes')?.closest('label');
            if (injection && !injection.closest('details')) { const settings = disclose([injection, q(review, '.panel-review-help')], '记忆设置与说明', 'draft-review-options'); review.append(settings); }
            const filters = [...host.querySelectorAll(':scope > .uvu-bridge-review-toolbar')].find(el=>q(el,'input[type=search]'));
            if (filters && !filters.dataset.draftFilters) {
                filters.dataset.draftFilters = 'true';
                const choices = make('div', 'draft-segment'), check = q(filters, 'input[type=checkbox]');
                if (check) for (const [text,value] of [['待审核',true],['全部',false]]) { const button = make('button', '', text); button.type='button'; button.setAttribute('aria-pressed', String(check.checked===value)); button.onclick=()=>{check.checked=value;check.dispatchEvent(new Event('change',{bubbles:true}));}; choices.append(button); }
                const filterDetails=disclose([filters], '搜索与筛选', 'draft-review-filters'); host.prepend(choices);host.append(filterDetails);
            }
            const pageBar = [...host.children].find(el => el.matches('.uvu-bridge-review-toolbar')&&!q(el,'input'));
            if (pageBar && [...pageBar.querySelectorAll('button')].every(button=>button.disabled)) pageBar.hidden = true;
            const scenes = [...host.querySelectorAll(':scope > details:not(.draft-review-filters)')];
            for (const scene of scenes) {
                if (!scene.dataset.draftScene) {
                    scene.dataset.draftScene='true';
                    const title=q(scene, ':scope > summary');
                    if (title) {
                        const original=title.textContent;title.setAttribute('aria-label',original);title.title=original;const parts=original.split(' · ');
                        const identity=make('span','draft-identity'),copy=make('span');copy.append(make('strong','',parts[0]),make('small','',parts[2]||parts[1]||''));identity.append(make('span','draft-avatar',parts[0].slice(0,1)),copy);title.replaceChildren(identity);
                    }
                    scene.addEventListener('toggle',()=>queueMicrotask(()=>reviewLayout(root)));
                }
                if (scene.dataset.loaded === 'true' && !scene.draftActions) {
                    const direct=[...scene.children].find(el=>el.tagName==='BUTTON'&&/原文直接/.test(el.textContent));
                    const generate=q(scene,'.uvu-bridge-summary-options .uvu-bridge-actions > button');
                    if (direct && generate) { label(direct,'直接加入记忆');label(generate,'审核并总结');direct.classList.add('draft-secondary');generate.classList.add('panel-primary');scene.draftActions=[direct,generate]; }
                    const source=q(scene,':scope > details'); if(source) { label(q(source,':scope > summary'),'原文与来源');scene.append(source); }
                    const all=q(scene,'input[aria-label="全选本场剧情"]')?.closest('label');if(all) {const caption=q(all,'span');if(caption)caption.textContent='全选';}
                }
            }
            const active = [...scenes].reverse().find(scene => scene.open && scene.draftActions);
            const wanted = active?.draftActions || [];
            if (primary.children.length!==wanted.length || wanted.some((button,i)=>primary.children[i]!==button)) { for(const scene of scenes) if(scene.draftActions && scene!==active) scene.append(...scene.draftActions);primary.replaceChildren(...wanted); }
        }
        root.querySelectorAll('.uvu-bridge-review-floor').forEach(floor => {
            if (floor.dataset.monoReview) return; floor.dataset.monoReview = 'true';
            const title = q(floor, ':scope > summary'); if (!title) return;
            const original = title.textContent, match = original.match(/^(第 \d+ 层|原文记录)(?: · ([^·]+))? · ([\s\S]*)$/);
            if (match) {
                title.textContent = match[1] + (match[2] ? ' · ' + match[2].trim() : '');
                title.setAttribute('aria-label', original);
                const excerpt = make('p', 'mono-story-excerpt', match[3]); floor.after(excerpt);
                floor.addEventListener('input', event => { if (event.target.matches('textarea')) excerpt.textContent = event.target.value; });
                floor.addEventListener('toggle',()=>{
                    if(!floor.open||floor.draftEditing)return;
                    queueMicrotask(()=>{
                        const text=q(floor,'textarea');if(!text||!floor.isConnected||!floor.open)return;
                        floor.draftEditing=true;
                        const editing=new AbortController();
                        const d=createMessageForwardDialog('编辑整层剧情','draft-floor-editor',()=>{
                            editing.abort();if(floor.isConnected){floor.append(text);excerpt.textContent=text.value;floor.open=false;q(floor,'summary')?.focus();}floor.draftEditing=false;
                        });d.panel.classList.add('derived-settings','draft-floor-editor');
                        const body=make('div','derived-body'),caption=make('div','draft-columns'),footer=make('footer');
                        caption.append(make('span','draft-tag',title.textContent),make('small','','审核草稿'));
                        const done=make('button','panel-primary','完成编辑');done.type='button';done.onclick=d.dismiss;
                        text.addEventListener('input',()=>{excerpt.textContent=text.value;},{signal:editing.signal});
                        body.append(caption,text,make('small','draft-notice','完成编辑后，仍需勾选并审核加入记忆。'));footer.append(done);d.panel.append(body,footer);
                    });
                });
                const note = q(floor, ':scope > .uvu-bridge-review-help');
                if (note?.textContent.startsWith('正文标签：') && !/未知标签：[^无]/.test(note.textContent)) {
                    note.classList.add('mono-known-tag');
                    const tags=note.textContent.match(/^正文标签：([^；\n]+)/)?.[1];
                    if(tags){const caption=make('small','draft-floor-caption','正文标签 '+tags+' · 编辑');excerpt.after(caption);}
                }
                const icon=make('span','draft-floor-edit-icon');icon.innerHTML=window.UvULucide?.pencil||'';icon.setAttribute('aria-hidden','true');title.append(icon);
            }
        });
        root.querySelectorAll('.uvu-bridge-summary-options').forEach(options => {
            if (options.dataset.monoSummary) return; options.dataset.monoSummary = 'true';
            const fields = [...options.children].filter(el => el.matches('label,p,small'));
            disclose(fields, '总结设置', 'mono-story-summary-settings');
            const primary = q(options, '.uvu-bridge-actions > button'); if (primary) primary.classList.add('panel-primary');
        });
        root.querySelectorAll('.uvu-bridge-summary-preview:not([hidden])').forEach(preview=>{
            if(preview.dataset.draftSummary)return;preview.dataset.draftSummary='true';
            const scene=preview.parentElement,open=make('button','','查看摘要');open.type='button';preview.before(open);
            open.onclick=()=>{
                if(!scene.isConnected)return;
                const confirm=q(preview,':scope > button'),anchor=document.createComment('summary-preview');preview.before(anchor);
                const live=new AbortController();
                const borrowed=[];
                const d=createMessageForwardDialog('剧情总结','draft-story-summary',()=>{live.abort();observer.disconnect();for(const [node,place]of borrowed)if(place.isConnected)place.replaceWith(node);preview.hidden=true;if(anchor.isConnected)anchor.replaceWith(preview);if(confirm)preview.append(confirm);open.focus();});
                d.panel.classList.add('derived-settings','draft-story-summary');preview.classList.add('draft-summary-editor');
                const body=make('div','derived-body'),footer=make('footer');preview.hidden=false;preview.open=true;
                const summaryText=q(preview,'textarea'),counts=make('div','draft-columns draft-summary-counts');
                const sourceCount=make('section','draft-card'),summaryCount=make('section','draft-card');
                const summaryLength=make('strong');sourceCount.append(make('small','','原文'),make('strong','',String([...scene.querySelectorAll('.uvu-bridge-review-row')].filter(row=>q(row,'input[type=checkbox]')?.checked).reduce((n,row)=>n+(q(row,'.uvu-bridge-review-floor textarea')?.value||q(row,'.mono-story-excerpt')?.textContent||'').length,0))+' 字'));summaryCount.append(make('small','','摘要'),summaryLength);counts.append(sourceCount,summaryCount);
                const updateCount=()=>{summaryLength.textContent=String(summaryText?.value.length||0)+' 字';};updateCount();summaryText?.addEventListener('input',updateCount,{signal:live.signal});
                const owner=q(scene,':scope > summary .draft-identity')?.cloneNode(true),stamp=make('div','draft-columns');stamp.append(make('span','draft-tag','待确认摘要'));if(owner)stamp.append(owner);
                body.append(stamp,make('h3','panel-section-title','摘要总结'),preview,counts);
                const controls=make('section','draft-card draft-summary-memory'),use=q(root,'#uvu-bridge-inject-scenes')?.closest('label');
                if(use){const place=document.createComment('summary-memory-use');use.before(place);borrowed.push([use,place]);controls.append(use);}
                const source=routeButton('标题与来源核对',()=>{const detail=q(preview,':scope > details');if(detail){detail.open=!detail.open;detail.scrollIntoView({block:'nearest'});}});controls.append(source);body.append(controls,make('p','draft-notice','核对后加入对应角色记忆；原文仍保留。'));
                const title=q(preview,':scope > input'),audit=q(preview,':scope > details');if(title&&audit){const place=document.createComment('summary-title');title.before(place);borrowed.push([title,place]);audit.insertBefore(title,q(audit,'summary')?.nextSibling||null);title.setAttribute('aria-label','记忆标题');}
                if(confirm){confirm.classList.add('panel-primary');footer.append(confirm);}d.panel.append(body,footer);
                const observer=new MutationObserver(()=>{if(!scene.isConnected)d.dismiss();});observer.observe(host,{childList:true});
            };
            preview.hidden=true;
        });
    }
    function routeButton(text, action) {
        const button = make('button', 'mono-route', text); button.type = 'button';
        const arrow = make('span', 'mono-route-arrow'); arrow.innerHTML = window.UvULucide?.['chevron-right'] || ''; arrow.setAttribute('aria-hidden', 'true'); button.append(arrow);
        button.addEventListener('click', action); return button;
    }
    function alignAtlas(root) {
        if(root.classList.contains('resource-health')) {
            const overview=q(root,'.draft-resource-overview');
            if(overview&&!root.dataset.atlasResources){root.dataset.atlasResources='true';overview.before(make('h2','draft-resource-title','本地资源'));}
        }
        if(root.id==='auto-memory-modal') {
            const form=q(root,'#auto-memory-form'),vector=root.dataset.memoryFocus==='vector';
            const heading=q(root,'.mono-page-title');
            if(heading&&/^向量记忆设置$/.test(heading.textContent))heading.textContent='向量索引';
            if(heading&&/^自动总结设置$/.test(heading.textContent))heading.textContent='自动记忆';
            if(form&&!root.dataset.atlasSummary){
                root.dataset.atlasSummary='true';
                for(const [name,text]of [['batchSize','每批楼层'],['keepRecent','保留最近']])label(form.elements.namedItem(name)?.closest('label'),text);
                const note=[...form.querySelectorAll('.auto-memory-help')].find(el=>el.textContent.includes('“立即整理”'));
                if(note){const details=q(form,'.draft-summary-more');if(details)details.append(note);}
                const submit=q(root,'.draft-fixed-actions button[type=submit]');if(submit)label(submit,'保存设置');
            }
        }
        if(root.id==='minimax-tts-settings') {
            const choices=q(root,'#minimax-director-fields > .panel-segment');
            if(choices){choices.setAttribute('aria-label','导演风格');const keep=q(choices,'.draft-current-style');if(keep)keep.hidden=true;}
        }
        if(root.classList.contains('draft-story-summary')) {
            const stamp=q(root,'.derived-body > .draft-columns'),owner=q(stamp,'.draft-identity');
            if(owner&&!stamp.dataset.atlasStamp){stamp.dataset.atlasStamp='true';const name=q(owner,'strong')?.textContent;if(name)owner.replaceWith(make('span','draft-tag',name));}
        }
    }
    function subviews(root, body, views) {
        const pages = views.map(view => {
            const page = make('section', 'mono-subview'); page.dataset.monoView = view.id;
            body.append(page); page.append(...view.nodes.filter(Boolean)); return { ...view, page };
        });
        const navigate = (id, focus = true) => {
            const selected = pages.find(view => view.id === id) || pages[0];
            for (const view of pages) view.page.hidden = view !== selected;
            root.dataset.monoView = selected.id;
            const title = q(root, '.mono-page-title');
            if (title) { title.textContent = selected.title; if (focus) { title.tabIndex = -1; title.focus({ preventScroll: true }); } }
            body.scrollTop = 0;
            root.dispatchEvent(new CustomEvent('mono-view-change', { detail: selected.id }));
        };
        root.addEventListener('click', event => {
            if (event.target.closest('.mono-nav-back') && root.dataset.monoView !== views[0].id) {
                event.preventDefault(); event.stopImmediatePropagation(); navigate(views[0].id);
            }
        }, true);
        navigate.add = view => { if (pages.some(page => page.id === view.id)) return; const page = make('section', 'mono-subview'); page.dataset.monoView = view.id; page.hidden = true; body.append(page); page.append(...view.nodes.filter(Boolean)); pages.push({ ...view, page }); };
        navigate(views[0].id, false); return navigate;
    }
    function mcpServiceRows(root) {
        if (!root.closest('#mcp-services')) return;
        const services = q(root, '.mcp-services-area'); if (!services) return;
        const row = q(services, ':scope > .mcp-service-actions');
        if (!row || row.dataset.monoServiceActions) return;
        row.dataset.monoServiceActions = 'true';
        const title = q(services, ':scope > strong'), add = q(row, 'button');
        const head = make('div', 'mono-service-heading'); title.before(head); title.textContent = '我的服务'; head.append(title, add);
        label(add, '添加服务');
        const actions = make('div', 'draft-service-actions'); row.before(actions);
        const edit = q(row, 'button'), remove = edit?.nextElementSibling, connect = remove?.nextElementSibling;
        if (connect) { label(connect, '连接'); connect.classList.add('panel-primary'); actions.append(connect); }
        if (edit) actions.append(edit);
        const management = disclose([row], '更多服务操作', 'mono-service-management');
        management.append(...[...services.children].filter(el => el !== head && el !== management && el !== actions && !el.matches('label,.mcp-service-search,.mcp-service-list')));
        const list=q(services,'.mcp-service-list'),selected=q(list,'.mcp-service-item[aria-pressed=true]');
        if(list)list.after(head);
        if(management)services.append(management);
        if(selected&&actions){const card=make('section','draft-card draft-selected-service');selected.before(card);card.append(selected,actions);}
        const search = q(services, '.mcp-service-search');
        if (search) {
            search.hidden = services.querySelectorAll('.mcp-service-item').length < 2;
            search.addEventListener('input', () => {
                const card = q(services, '.draft-selected-service');
                if (card) card.hidden = Boolean(q(card, '.mcp-service-item')?.hidden);
            });
        }
    }
    function mcpToolRows(root){
        if(!root.closest('#mcp-services'))return;
        const area=q(root,'.mcp-tools-area');if(!area)return;
        for(const card of area.querySelectorAll('.mcp-tool:not([data-draft-tool])')){
            card.dataset.draftTool='true';
            const controls=[...card.children].filter(el=>el.matches('label,.mcp-row'));
            const enable=controls.shift(),name=q(card,':scope > strong');
            if(enable&&name){const input=q(enable,'input'),caption=q(enable,'span');if(input){input.setAttribute('aria-label',input.getAttribute('aria-label')||enable.textContent.trim());input.classList.remove('panel-switch');input.removeAttribute('role');}caption?.remove();enable.classList.remove('panel-switch-row');enable.append(name);enable.classList.add('draft-tool-heading');card.prepend(enable);}
            const details=disclose(controls,'权限与调用','draft-tool-details');if(details){card.append(details);const summary=q(details,'summary');summary.setAttribute('aria-label',name.textContent+'：权限与调用');summary.title='权限与调用';const glyph=make('span','draft-tool-settings-icon');glyph.innerHTML=window.UvULucide?.['settings-2']||'';summary.append(glyph);}
        }
        if(!q(area,'.draft-tool-search')&&q(area,'.mcp-tool')){
            const search=make('input','draft-tool-search');search.type='search';search.placeholder='筛选本页工具';search.setAttribute('aria-label','筛选本页工具');
            search.oninput=()=>{for(const card of area.querySelectorAll('.mcp-tool'))card.hidden=!q(card,'strong')?.textContent.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase());};area.prepend(search);
        }
        const cards=[...area.querySelectorAll(':scope > .mcp-tool')];
        if(cards.length){let list=q(area,':scope > .draft-tools-list');if(!list){list=make('section','draft-card draft-tools-list');cards[0].before(list);}list.append(...cards);}
    }
    function tavernPage(root) {
        const head = q(root, '.app-header'), oldTitle = q(head, '.title-container'), close = q(head, '.back-btn'), body = q(root, '.uvu-bridge-page');
        root.classList.add('mono-bridge-page', 'mono-page'); head.classList.add('mono-page-nav');
        close.classList.add('mono-nav-back'); close.setAttribute('aria-label', '返回主屏幕'); navIcon(close, 'chevron-left');
        oldTitle.remove(); q(head, '.placeholder')?.remove();
        head.append(make('h2', 'mono-page-title', '酒馆'));
        const help = make('button', 'mono-nav-help'); help.type = 'button'; help.setAttribute('aria-label', '使用教程'); navIcon(help, 'circle-help'); head.append(help);
        const connection = q(body, '.kkt-settings-container'), handoff = q(body, '.uvu-bridge-handoff'), review = q(body, '.uvu-bridge-review'), guide = q(body, '.uvu-bridge-guide');
        const channel = q(connection, '.panel-segment'), config = q(connection, '.panel-bridge-config'), enabled = q(root, '#uvu-bridge-enabled').closest('label');
        const intro = q(connection, '.panel-bridge-intro'); if (intro) guide.append(intro);
        const url = q(connection, '#uvu-bridge-url').closest('label'); config.prepend(url); config.open = true;
        const diagnostics = q(connection, '#uvu-bridge-diagnostics'); if (diagnostics) config.append(diagnostics);
        const onlineControls = q(root, '#uvu-bridge-online-controls');
        const syncAddress = () => { url.hidden = onlineControls.hidden || onlineControls.style.display === 'none'; };
        new MutationObserver(syncAddress).observe(onlineControls, { attributes: true, attributeFilter: ['hidden', 'style'] }); syncAddress();
        const state = q(root, '#uvu-bridge-status'); root.append(state); state.classList.add('mono-bridge-status');
        let statusView=root.dataset.monoView;
        const idleStatus=()=>{state.hidden=!state.textContent.trim()||state.textContent.trim()==='未连接'||state.dataset.error!=='true'&&statusView!==root.dataset.monoView;};
        new MutationObserver(()=>{statusView=root.dataset.monoView;idleStatus();}).observe(state,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-error']});
        root.addEventListener('mono-view-change',idleStatus);idleStatus();
        const statusRow = make('div', 'draft-bridge-state'), channelTag = make('span', 'draft-tag'), pairTag = make('span', 'draft-tag'); statusRow.append(channelTag, pairTag);
        const identity = make('section', 'draft-card draft-bridge-identity'), person = make('div', 'draft-identity'), avatar = make('span', 'draft-avatar'), identityName = make('strong'), source = make('small'), copy = make('div'); copy.append(identityName, source); person.append(avatar, copy); identity.append(person);
        const binding = make('section', 'mono-binding-settings'), roleRow = q(handoff, '.panel-bridge-role'); binding.append(roleRow);
        const select = q(binding, '#uvu-bridge-handoff-character'), search = make('input'); search.type = 'search'; search.placeholder = '搜索角色'; search.setAttribute('aria-label', '搜索绑定角色');
        const choices = make('section', 'draft-card draft-role-choices'),bindingIdentity=make('div','draft-binding-identity'); binding.prepend(search,bindingIdentity,make('h3', 'panel-section-title', '目标角色'), choices); roleRow.hidden = true;
        const selection = () => typeof db !== 'undefined' ? db.characters?.find(c => String(c.id) === select.value) : null;
        let optionStamp = '';
        const renderChoices = () => {
            const stamp = JSON.stringify([...select.options].map(o => [o.value, o.textContent])) + select.value + search.value;
            if (stamp === optionStamp) return; optionStamp = stamp; choices.replaceChildren();
            for (const option of select.options) {
                if (!option.value || !option.textContent.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())) continue;
                const row = make('label', 'draft-choice'), radio = make('input'); radio.type = 'radio'; radio.name = 'bridge-target-role'; radio.value = option.value; radio.checked = select.value === option.value; radio.disabled = select.disabled;
                const text = make('span');text.append(make('strong', '', option.textContent));row.title='角色 ID · '+option.value;row.append(radio, text); choices.append(row);
                radio.onchange = () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); };
            }
        };
        search.addEventListener('input', renderChoices);
        const archive = make('section', 'draft-card draft-bound-archive'), archiveTitle = make('strong'), archiveId = make('small');archive.append(archiveTitle, archiveId); binding.append(make('h3', 'panel-section-title', '当前文档'), archive);
        const refreshArchive = make('button', '', '读取所选角色当前文档'); refreshArchive.type = 'button'; refreshArchive.onclick = () => q(root, '#uvu-bridge-use-current').click(); binding.append(refreshArchive);
        const protectNote = make('p', 'draft-notice', '绑定只用于所选角色；切换其他私聊不改变此绑定。'); binding.append(protectNote);
        const cards = make('div', 'draft-columns draft-bridge-tiles');
        const onlineTile = make('section', 'draft-card'), reviewTile = make('section', 'draft-card draft-dark');
        const onlineNumber = make('strong', 'draft-stat'), reviewNumber = make('strong', 'draft-stat');
        const onlineEntry = make('button', '', '查看存档'), reviewEntry = make('button', '', '去审核'); onlineEntry.type = reviewEntry.type = 'button';
        onlineTile.append(make('h3', '', '线上存档'), onlineNumber, make('small', '', '待交接'), onlineEntry);
        reviewTile.append(make('h3', '', '剧情审核'), reviewNumber, make('small', '', '待审核'), reviewEntry); cards.append(onlineTile, reviewTile);
        const settings = make('section', 'draft-card draft-bridge-controls'), connectionRoute = routeButton('连接设置', () => navigate('connection'));
        settings.append(enabled, connectionRoute);
        const version = q(root, '#uvu-bridge-check-update'); if (version) settings.append(version);
        const links = make('div', 'mono-route-list');
        const transport = make('section', 'draft-tt-files'),transportIdentity=make('div','draft-identity'),transportAvatar=make('span','draft-avatar'),transportCopy=make('div'),transportName=make('strong'),transportArchive=make('small');
        transportCopy.append(transportName,transportArchive);transportIdentity.append(transportAvatar,transportCopy);transport.append(transportIdentity);
        for(const [id,title,note,icon] of [['uvu-bridge-import-file','导入 TT 剧情','选择从 TT 导出的文件','upload'],['uvu-bridge-export-file','导出线上消息','导入 TT 后审核使用','download']]){
            const control=q(root,'#'+id),tile=make('section','draft-card draft-tt-file');label(control,title);control.classList.add('draft-tt-file-action');
            const glyph=make('span','draft-tt-file-icon');glyph.innerHTML=window.UvULucide?.[icon]||'';glyph.setAttribute('aria-hidden','true');tile.append(glyph,control,make('small','',note));transport.append(tile);
        }
        const transportNote = make('p', 'draft-notice', '文件交接无需 ST 后端。');transport.append(transportNote);
        const guideModes=make('nav','panel-segment draft-guide-modes');guideModes.setAttribute('aria-label','教程通道');
        const guideIntro=make('section','draft-guide-steps');guide.prepend(guideModes,guideIntro);
        const guideSources=[q(root,'#uvu-bridge-st-guide'),q(root,'#uvu-bridge-tt-guide')];
        function showGuide(index){
            [...guideModes.children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
            guideIntro.replaceChildren();
            const steps=index?[
                ['在 TT 中导出剧情','打开绑定角色的聊天，从 TT 插件导出当前剧情 JSON。'],
                ['回到 UvU 导入','进入 TT 文件互通，导入文件并核对角色与存档。'],
                ['逐楼审核正文','核对角色、存档和正文，勾选需要保留的楼层。'],
                ['总结并加入记忆','生成第三人称摘要，校对后确认加入该角色记忆。']
            ]:[
                ['安装插件与服务','在 SillyTavern 安装 UvU Story Bridge，按详细教程配置并重启服务。'],
                ['配对并绑定角色','在酒馆生成配对码，到 UvU 连接设置中配对，保存角色与存档。'],
                ['交接线上消息','核对消息范围并交接，到酒馆刷新、审核后保存。'],
                ['审核线下剧情','收取酒馆剧情，逐层审核或生成摘要，再确认加入记忆。']
            ];
            for(const [i,[title,text]]of steps.entries()){const row=make('div','draft-guide-step'),copy=make('div');copy.append(make('strong','',title),make('p','',text));row.append(make('span','draft-step-number',String(i+1).padStart(2,'0')),copy);guideIntro.append(row);}
            guideSources.forEach((source,i)=>{if(source){source.hidden=i!==index;source.open=false;source.classList.add('draft-guide-detail');}});
        }
        ['ST','TT'].forEach((name,index)=>{const button=make('button','',name);button.type='button';button.onclick=()=>showGuide(index);guideModes.append(button);});
        showGuide(q(root,'#uvu-bridge-channel').value==='tt'?1:0);
        const ttHelp=routeButton('TT 操作教程',()=>{showGuide(1);navigate('guide');});transport.append(ttHelp);
        const footer = make('footer', 'mono-bridge-footer'); root.append(footer);
        const navigate = subviews(root, body, [
            { id: 'main', title: '酒馆', nodes: [statusRow, identity, cards, make('h3', 'panel-section-title', '连接'), settings, links] },
            { id: 'binding', title: '角色与存档', nodes: [binding] },
            { id: 'online', title: '线上交接', nodes: [handoff] },
            { id: 'review', title: '剧情审核', nodes: [review] },
            { id: 'connection', title: '连接设置', nodes: [channel, connection] },
            { id: 'tt', title: 'TT 文件互通', nodes: [transport] },
            { id: 'guide', title: '使用教程', nodes: [guide] }
        ]); root.monoNavigate = navigate;
        identity.append(routeButton('绑定存档', () => navigate('binding')), routeButton('角色与存档', () => navigate('binding')));
        links.append(routeButton('使用教程', () => navigate('guide'))); help.onclick = () => navigate('guide');
        onlineEntry.onclick = () => navigate('online'); reviewEntry.onclick = () => navigate('review');
        const ttEntry = routeButton('TT 文件交接', () => navigate('tt')); links.prepend(ttEntry);
        const save = q(root, '#uvu-bridge-save-character'), send = q(root, '#uvu-bridge-handoff'), exportFile = q(root, '#uvu-bridge-export-file');
        label(save, '保存绑定'); label(send, '交接至酒馆'); save.classList.add('panel-primary'); send.classList.add('panel-primary'); footer.append(save, send);
        const tabs = make('nav', 'draft-bottom-nav'); tabs.setAttribute('aria-label', '酒馆导航'); footer.append(tabs);
        for (const [id, name] of [['main', '工作台'], ['review', '审核'], ['memory', '记忆']]) {
            const tab = make('button', '', name); tab.type = 'button'; tab.dataset.view = id;
            tab.onclick = () => { if (id === 'memory') { const chat = selection(); if (chat && typeof openMemoryLibrary === 'function') { openChatRoom(chat.id, 'private'); openMemoryLibrary(); } } else navigate(id); }; tabs.append(tab);
        }
        const refresh = () => {
            const chat = selection(), a = chat?.archives?.find(a => a.id === chat.activeArchiveId), name = chat?.remarkName || chat?.realName || select.selectedOptions[0]?.textContent || '尚未选择角色';
            const set = (el, text) => { if (el.textContent !== text) el.textContent = text; };
            set(identityName, name); set(source, '私聊 · ' + (a?.name || '默认存档')); set(avatar, name.slice(0, 1));
            const bindingStamp=chat?.id+':'+chat?.activeArchiveId;if(bindingIdentity.dataset.owner!==bindingStamp){bindingIdentity.dataset.owner=bindingStamp;bindingIdentity.replaceChildren();if(chat)bindingIdentity.append(identityRow(chat,'私聊 · '+(a?.name||'当前存档')));}
            set(transportName,name);set(transportArchive,'私聊 · '+(a?.name||'默认存档'));set(transportAvatar,name.slice(0,1));
            set(archiveTitle, a?.name || '默认存档'); set(archiveId, '存档 ID · ' + (chat?.activeArchiveId || 'default'));
            const range = chat && window.UvUStoryBridge?.latestHandoffRange(chat); set(onlineNumber, (range?.count || 0) + ' 条');
            set(reviewNumber, q(root, '#uvu-bridge-review-count').textContent);
            const connectionText = q(root, '#uvu-bridge-connection')?.textContent || ''; set(pairTag, connectionText || '未连接');
            const tt = q(root, '#uvu-bridge-channel').value === 'tt'; set(channelTag, tt ? 'TauriTavern' : 'SillyTavern'); ttEntry.hidden = !tt;
            renderChoices(); renderOnline();
        };
        const preview = make('section', 'draft-card draft-online-messages'); handoff.append(preview);
        const onlineIdentity=make('div','draft-online-identity');handoff.prepend(onlineIdentity);
        const metadata=q(handoff,'.panel-bridge-metadata'),receipt=q(root,'#uvu-bridge-handoff-receipt'),sourceDetails=q(root,'#uvu-bridge-handoff-source');
        const rangeDetails=q(root,'.panel-bridge-range');if(metadata){if(rangeDetails)metadata.before(rangeDetails);handoff.append(metadata);}
        const onlineHelp=q(handoff,'.panel-handoff-help');if(onlineHelp)handoff.append(onlineHelp);
        let previewStamp = '';
        function renderOnline() {
            const chat = selection(), start = Number(q(root, '#uvu-bridge-handoff-start').value), end = Number(q(root, '#uvu-bridge-handoff-end').value);
            const records = chat && window.UvUStoryBridge?.messageRecords(chat, Math.max(0, start - 1), end) || [];
            const signature = JSON.stringify([chat?.id,chat?.activeArchiveId,records]); if (signature === previewStamp) return; previewStamp = signature; preview.replaceChildren();
            onlineIdentity.replaceChildren();if(chat)onlineIdentity.append(identityRow(chat,'私聊 · '+(chat.archives?.find(a=>a.id===chat.activeArchiveId)?.name||'当前存档')));
            if (!records.length) preview.append(make('p', 'draft-notice', '当前范围没有可交接正文。'));
            for (const record of records.slice(-50)) {
                const row=make('article','draft-online-message'),match=record.text.match(/^\[([^\n]*?) \| ([^\n]*?)\]\n/),head=make('div','draft-columns');
                const date=record.createdAt?new Date(record.createdAt):null;
                head.append(make('small','',match?.[2]||''),make('small','',date?date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''));
                row.append(head,make('p','',match?record.text.slice(match[0].length):record.text));preview.append(row);
            }
        }
        const range = q(root, '.panel-bridge-range'); if (range) range.open = false;
        const latest = q(root, '#uvu-bridge-latest'); if (latest && range) { const bar = make('div', 'draft-segment draft-range-mode'); range.before(bar); bar.append(latest); const custom = make('button', '', '自选范围'); custom.type = 'button'; const sync=()=>{latest.setAttribute('aria-pressed',String(!range.open));custom.setAttribute('aria-pressed',String(range.open));};custom.onclick = () => { range.open = !range.open;sync(); };latest.addEventListener('click',()=>{range.open=false;sync();});range.addEventListener('toggle',sync);bar.append(custom);sync(); }
        q(root, '#uvu-bridge-handoff-start').addEventListener('input', renderOnline); q(root, '#uvu-bridge-handoff-end').addEventListener('input', renderOnline);
        q(root, '#uvu-bridge-latest')?.addEventListener('click', () => queueMicrotask(renderOnline));
        q(root, '#uvu-bridge-use-current').addEventListener('click', () => queueMicrotask(refresh));
        select.addEventListener('change', refresh);
        for (const node of [select, q(root, '#uvu-bridge-handoff-source'), q(root, '#uvu-bridge-review-count'), q(root, '#uvu-bridge-connection')]) new MutationObserver(refresh).observe(node, { childList: true, characterData: true, subtree: true });
        q(root, '#uvu-bridge-channel').addEventListener('change', () => queueMicrotask(refresh));
        root.addEventListener('mono-view-change', () => {
            const view = root.dataset.monoView; save.hidden = view !== 'binding'; send.classList.toggle('mono-route-hidden', view !== 'online'); tabs.hidden = !['main','review'].includes(view);
            footer.hidden = !['main','review','binding','online'].includes(view);
            [...tabs.children].forEach(tab => tab.setAttribute('aria-current', tab.dataset.view === view ? 'page' : 'false')); refresh();
        });
        navigate('main', false); refresh();
    }
    function documentLayout(root) {
        const context = q(root, '.shared-document-context');
        if (context) {
            const caption = q(context, 'small'); if (caption) caption.textContent = '发送至';
            context.classList.add('mono-recipient');
        }
        const body = q(root, '.shared-document-body');
        const editor = q(root, '.shared-document-editor');
        const status = q(root, '.shared-document-status');
        if (editor && status) editor.after(status);
        const options = q(root, '.shared-document-file-options');
        if (body && options) body.append(options);
        q(root, '[data-action=send]')?.classList.add('panel-primary');
    }
    function exportLayout(root) {
        // Only settings move. The canvas and PNG renderer retain all original inputs.
        const body = q(root, '.cc-body'), person = q(root, '.cc-person');
        if (!body || !person) return;
        const identity = q(person, '.cc-person-info'); if (identity) body.prepend(identity);
        const preview = disclose([person], '封面预览', 'mono-cover-preview');
        if (preview) body.append(preview);
        const footer = q(root, '.cc-foot');
        if (footer) [...footer.querySelectorAll('button')].at(-1)?.classList.add('panel-primary');
    }
    function navIcon(button, name) {
        button.replaceChildren();
        const iconName = name.includes('M18') ? 'x' : name.includes('m14') ? 'chevron-left' : name;
        const svg = window.UvULucide?.[iconName];
        if (svg) button.innerHTML = svg;
        else button.textContent = iconName === 'x' ? '关闭' : '返回';
    }

    function pageLayout(root) {
        if (root.dataset.monoPage || !root.matches('.shared-document-dialog,.mcp-settings,.derived-settings,.calendar-editor,.ms-dialog,.cc-export-dialog,.memory-library > .feature-dialog-card,.text-editor-card,.model-picker-card,.relationship-dialog,.sticker-description-card,.resource-health,#auto-memory-modal')) return;
        const panel = root.id === 'auto-memory-modal' ? q(root, '.auto-memory-dialog') : root;
        let head = q(panel, ':scope > .message-forward-header,:scope > .ms-dialog-head,:scope > .cc-head,:scope > .auto-memory-heading,:scope > header');
        let title = head && q(head, 'strong,h2');
        let close = head && q(head, '.message-forward-close,.cc-close,#auto-memory-close,[data-action=close],[data-cancel]');
        if (!close && root.classList.contains('text-editor-card')) close = q(root, '[data-action=keepDraft]');
        if (!head && root.matches('.memory-library > .feature-dialog-card') && q(root, ':scope > h3')) {
            head = make('header'); title = q(root, ':scope > h3');
            close = [...root.querySelectorAll('button')].find(el => el.textContent === '取消');
            if (close) { root.prepend(head); head.append(title, close); }
        }
        if (!title || !close) return;
        root.dataset.monoPage = 'true'; panel.classList.add('mono-page','uvu-mono-panel');
        (root.id === 'auto-memory-modal' ? root : root.closest('.feature-dialog,.message-forward-overlay,.modal,.ms-overlay') || root.parentElement).classList.add('mono-page-overlay');
        head.classList.add('mono-page-nav'); title.classList.add('mono-page-title');
        if (!close.hasAttribute('aria-label')) close.setAttribute('aria-label', close.textContent.trim() || '关闭');
        close.classList.add('mono-nav-back'); navIcon(close, 'chevron-left'); head.prepend(close);
        const help = q(head, '.shared-document-info');
        if (help) { help.classList.add('mono-nav-help'); head.append(help); }
        else {
            const guides = [...root.querySelectorAll('details')].filter(el => /说明|教程|帮助/.test(el.firstElementChild?.textContent || ''));
            if (guides.length) {
                const show = make('button', 'mono-nav-help'); show.type = 'button'; show.setAttribute('aria-label', '帮助'); navIcon(show, 'circle-help');
                show.addEventListener('click', () => { const guide = guides.find(el => !el.closest('[hidden]')) || guides[0]; if (!guide.closest('[hidden]')) { guide.open = true; guide.scrollIntoView({ block: 'start', behavior: 'smooth' }); } else if (root.monoNavigate) root.monoNavigate('options'); }); head.append(show);
            } else head.append(make('span', 'mono-nav-spacer'));
        }
        if (root.monoNavigate) root.monoNavigate('main', false);
        if (root.id === 'auto-memory-modal') {
            const form = q(root, '#auto-memory-form'), footer = q(form, ':scope > .auto-memory-actions');
            const run=q(footer,'#auto-memory-run'),coverage=q(form,'.panel-coverage');if(run&&coverage){run.classList.add('draft-summary-run');coverage.after(run);}
            const range=q(panel,':scope > .auto-memory-range');
            if(range){const advanced=disclose([range],'指定楼层整理','draft-range-summary');form.append(advanced);}
            if (footer) { footer.classList.add('draft-fixed-actions'); footer.querySelectorAll('button[type=submit]').forEach(button => button.setAttribute('form', form.id)); panel.append(footer); }
        }
        if (root.classList.contains('calendar-editor')) {
            const form = q(root, '.calendar-editor-body'), footer = q(form, '.calendar-editor-actions');
            if (form && footer) { form.id ||= 'draft-calendar-form-' + Date.now(); footer.querySelectorAll('button[type=submit]').forEach(button => button.setAttribute('form', form.id)); panel.append(footer); }
        }
        if (root.matches('.memory-library > .feature-dialog-card')) {
            const add = q(head, '[data-action=add]'), content = make('div', 'mono-memory-body');
            const footer = make('footer', 'mono-page-footer'); if (add) { label(add, '添加记忆'); footer.append(add); }
            const nodes = [...panel.children].filter(el => el !== head); panel.append(content, footer); content.append(...nodes);
        }
        if (root.classList.contains('shared-document-dialog')) filePage(root);
        if (root.classList.contains('cc-export-dialog')) {
            const format = q(head, '.cc-format'); if (format) format.remove();
            const body = q(root, '.cc-body'), preview = q(body, '.mono-cover-preview'), books = q(body, '.cc-books'), footer = q(root, '.cc-foot');
            const identity = q(body, '.cc-person-info'); if (identity) { identity.classList.add('draft-export-identity'); }
            const fields = q(body, '.cc-cover-fields');
            if (preview && footer) {
                const show = make('button', 'mono-preview-action', '预览原卡'); show.type = 'button'; show.setAttribute('aria-expanded', 'false');
                show.addEventListener('click', () => { preview.open = !preview.open; if (preview.open) preview.scrollIntoView({ block: 'nearest' }); });
                preview.addEventListener('toggle', () => show.setAttribute('aria-expanded', String(preview.open))); footer.prepend(show);
            }
            if (books && body) {
                const bookPage = make('section', 'draft-export-books'); const search = make('input'); search.type = 'search'; search.placeholder = '搜索世界书或条目'; search.setAttribute('aria-label', '搜索世界书或条目'); bookPage.append(search, books);
                search.addEventListener('input', () => { const term = search.value.trim().toLocaleLowerCase(); books.querySelectorAll('.cc-book').forEach(book => { book.hidden = !book.textContent.toLocaleLowerCase().includes(term); }); });
                const author = q(body, ':scope > .cc-field'), more = q(body, '.cc-more'), persona = q(body, '.cc-persona');
                const version = q(more, '.cc-field'), help = q(more, '.cc-help');
                const style = make('section', 'draft-card draft-export-style'); style.append(make('span', '', '封面样式'), make('small', '', '现有 ID Card'));
                const pair = make('div', 'draft-columns'); if (version) pair.append(version);
                const signature = make('div', 'draft-export-signature'); signature.append(make('span', '', '签名'), make('span', 'draft-readonly', '沿用当前')); pair.append(signature);
                const routes = make('section', 'draft-card');
                const includes = make('section', 'draft-card draft-export-includes'); includes.append(make('h3', '', '导出内容'));
                for (const text of ['角色人设', '所选世界书']) { const line = make('p'); const check = make('span', 'draft-included-icon'); check.innerHTML = window.UvULucide?.['square-check'] || window.UvULucide?.check || ''; line.append(check, document.createTextNode(text)); includes.append(line); }
                const note = make('small', '', 'PNG · 3:4 · 透明圆角保持原样');
                if (identity) { const avatar = make('span', 'draft-avatar', q(identity, 'h3')?.textContent.slice(0, 1) || ''); identity.prepend(avatar); }
                const main = [identity, style, author, pair, routes, includes, note, preview];
                const morePage = make('section', 'draft-export-fields'); morePage.append(...[fields, persona, help].filter(Boolean)); if (fields) fields.open = true;
                if (more) more.remove();
                const navigate = subviews(root, body, [{ id: 'main', title: '导出角色卡', nodes: main }, { id: 'books', title: '配套世界书', nodes: [bookPage] }, { id: 'fields', title: '卡面资料', nodes: [morePage] }]); root.monoNavigate = navigate;
                routes.append(routeButton('配套世界书', () => navigate('books')), routeButton('更多卡面资料', () => navigate('fields')));
                const count = q(footer, '.cc-count'); if (count) { const head = q(books, '.cc-section-head'); head?.append(count); }
                books.querySelectorAll('.cc-book-details').forEach(el => el.open = true);
                const done = make('button', 'panel-primary', '完成选择'); done.type = 'button'; done.hidden = true; done.onclick = () => navigate('main'); footer.append(done);
                const normal = [...footer.children].filter(el => el !== done);
                root.addEventListener('mono-view-change', () => { const selecting = root.dataset.monoView !== 'main'; normal.forEach(el => el.hidden = selecting); done.hidden = !selecting; });
            }
        }
        if (root.classList.contains('ms-dialog') && q(root, '.mono-social-switches')) {
            const body = q(root, '.ms-dialog-body'), npcs = q(body, '.ms-npcs'), toggles = q(body, '.mono-social-switches');
            if (npcs) { const first = q(toggles, 'label'); if (first) body.prepend(first); first?.classList.add('draft-master-switch'); first?.after(npcs); }
            if (typeof db !== 'undefined') { const chat=db.characters.find(c=>c.id===currentChatId);if(chat)body.prepend(identityRow(chat)); }
            const facts = [...body.children].find(el => el.matches('label.ms-field')), limits = q(body, '.ms-pair');
            if (facts || limits) disclose([facts, limits], '互动规则', 'draft-card');
        }
    }

    function filePage(root) {
        const body = q(root, '.shared-document-body'), context = q(root, '.shared-document-context'), editor = q(root, '.shared-document-editor'), text = q(editor, 'textarea');
        if (!body || !text) return;
        root.classList.add('draft-document-page');
        if (context) { body.prepend(context); const img = q(context, 'img'); if (img && !img.getAttribute('src')) { const fallback = make('span', 'draft-avatar', q(context, 'strong')?.textContent.slice(0,1) || ''); img.replaceWith(fallback); } const caption = q(context, 'small'); if (caption) caption.textContent = '当前私聊'; }
        const identity = q(editor, '.shared-document-file-header'), preview = q(editor, '.shared-document-preview-heading');
        if (identity) editor.before(identity);
        if (preview) editor.before(preview);
        const options = q(root, '.shared-document-file-options');
        if (options) body.append(options);
        const textarea = text; textarea.classList.add('draft-document-text');
        const title = q(root, '.mono-page-title'), send = q(root, '[data-action=send]'), edit = q(root, '.shared-document-preview-heading button'), name = q(root, '.shared-document-name');
        const reading = textarea.readOnly; let originalText = textarea.value;
        const tools = q(root, '.shared-document-tools'); if (tools) editor.after(tools);
        const sync = () => { root.dataset.documentMode = textarea.readOnly ? 'read' : reading ? 'copy' : 'send'; if (title) title.textContent = textarea.readOnly ? name.value || '查看文件' : reading ? '编辑副本' : '发送文件'; if (reading && edit && send) send.hidden = textarea.readOnly; };
        if (reading) {
            const reader=make('article','draft-document-reader');reader.setAttribute('aria-label','文件正文阅读');editor.append(reader);
            const renderReader=()=>{
                reader.hidden=!textarea.readOnly;textarea.hidden=textarea.readOnly;if(!textarea.readOnly)return;
                const signature=textarea.value;if(reader.readSignature===signature)return;reader.readSignature=signature;reader.replaceChildren();
                const paragraphs=signature.split(/\n\s*\n/);for(const [index,paragraph]of paragraphs.entries())reader.append(make(index===0&&paragraph.length<=80?'h2':'p','',paragraph));
            };
            root.addEventListener('click',()=>queueMicrotask(renderReader));renderReader();
            const origin=make('div','draft-document-origin'),source=make('span','draft-tag',root.dataset.documentSender==='user'?'来自你':'来自角色'),more=make('button','','更多');more.type='button';
            more.onclick=()=>{if(options){options.open=!options.open;if(options.open)options.scrollIntoView({block:'nearest'});}};origin.append(source,more);body.prepend(origin);
            const pages = q(editor, '.shared-document-pages'), search = q(pages, 'input[type=search]');
            if (search) {
                const searchRow = make('div', 'draft-document-search');
                const searchButton=[...pages.querySelectorAll('button')][2],copyButton=[...pages.querySelectorAll('button')][3];
                searchRow.append(search);
                if(searchButton){searchButton.title=searchButton.textContent;searchButton.setAttribute('aria-label','查找正文');navIcon(searchButton,'search');searchRow.prepend(searchButton);searchButton.addEventListener('click',()=>queueMicrotask(()=>{renderReader();reader.querySelectorAll('mark').forEach(mark=>mark.replaceWith(document.createTextNode(mark.textContent)));if(!search.value)return;for(const paragraph of reader.children){const content=paragraph.textContent,index=content.indexOf(search.value);if(index<0)continue;const mark=make('mark','',search.value);paragraph.replaceChildren(document.createTextNode(content.slice(0,index)),mark,document.createTextNode(content.slice(index+search.value.length)));mark.scrollIntoView({block:'nearest'});break;}}));}
                if(copyButton&&options)options.append(copyButton);
                search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();searchButton?.click();}});
                editor.before(searchRow);
            }
            if (pages) editor.after(pages);
            if (options) { const exports = q(options, '.shared-document-export-actions'); if (exports) options.before(exports); }
            const footer = q(root, '.shared-document-actions'); if (footer && edit) { footer.append(edit); edit.classList.add('panel-primary'); }
            const comparison = make('section', 'draft-document-comparison draft-card'), diffTitle = make('h3', '', '修改对比'), diffText = make('pre'); comparison.append(diffTitle, diffText); comparison.hidden = true;
            const reset = make('button', 'draft-document-reset', '撤销修改'); reset.type = 'button';reset.dataset.icon='refresh-cw'; reset.onclick = () => { textarea.value = originalText; textarea.dispatchEvent(new Event('input', { bubbles: true })); };
            const copyNote=make('p','draft-notice draft-document-copy-note','原件保留；修改后以副本发送。');body.append(copyNote);
            editor.after(comparison);comparison.after(reset);
            textarea.addEventListener('input', () => { if (textarea.readOnly) return; comparison.hidden = false; const diff = window.globalCssLineDiff?.(originalText, textarea.value); diffText.textContent = diff ? diff.lines.filter(line => line.type !== 'same').slice(0,60).map(line => (line.type === 'add' ? '+ ' : line.type === 'remove' ? '− ' : '  ') + line.text).join('\n') || '正文相同' : '已保留原件，修改后以副本发送。'; });
            edit?.addEventListener('click', () => { originalText = textarea.value; edit.hidden = true; if (send) send.hidden = false; sync(); textarea.dispatchEvent(new Event('input',{bubbles:true})); });
        }
        sync();
        const encoding = q(editor, 'select'); if (encoding && options) options.append(encoding);
        const cancel = q(root, '[data-action=cancel]'); if (cancel) cancel.hidden = true;
    }

    function draftDetails(root) {
        if (root.dataset.draftDetails) return;
        root.dataset.draftDetails = 'true';
        if (root.classList.contains('calendar-editor') && q(root,'input[aria-label="标题"]')) {
            const fields=q(root,'.calendar-editor-fields'), control=name=>q(fields,'[aria-label="'+name+'"]')?.closest('label');
            const advanced=['重复','重复至','颜色','状态','锁定，保留手动安排','修改范围'].map(control).filter(Boolean);
            if (advanced.length) fields.append(disclose(advanced,'日程选项','draft-calendar-advanced'));
            const title=control('标题'),date=control('开始日期'),owner=root.dataset.calendarOwner;
            const chat=owner&&owner!=='user'?window.UvUCalendar?.resolve(owner):null;
            if(title&&date){const identity=identityRow(chat||{name:'我'},q(date,'input').value);fields.prepend(identity);}
            label(q(root,'.calendar-editor-actions button[type=submit]'),'保存日程');
        }
        if (root.classList.contains('calendar-editor') && q(root, '.calendar-mood-picker')) {
            const fields = q(root, '.calendar-editor-fields'), date = q(fields, 'input[type=date]')?.closest('label');
            root.classList.add('draft-mood-editor');
            const owner=root.dataset.calendarOwner,chat=owner&&owner!=='user'?window.UvUCalendar?.resolve(owner):null;fields.prepend(identityRow(chat||{name:'我'}));
            if (date) { date.classList.add('draft-mood-date'); fields.prepend(date); }
            const heading=make('div','draft-columns draft-mood-heading'),identity=q(fields,':scope > .draft-identity');if(date&&identity){date.before(heading);heading.append(date,identity);for(const node of [...date.childNodes])if(node.nodeType===3)node.remove();}
            const notes=q(fields,'textarea')?.closest('label');if(notes){for(const node of [...notes.childNodes])if(node.nodeType===3)node.remove();q(notes,'textarea').placeholder='记下今天的心情';}
            const prompt = make('h2', 'draft-mood-prompt', '今天，感觉怎么样？');
            q(fields, '.calendar-mood-picker').before(prompt);
            q(fields, '.calendar-palette')?.before(make('h3', 'draft-mood-color', '颜色'));
        }
        if (root.id === 'minimax-tts-settings') voiceWorkspace(root);
        if (root.classList.contains('uvu-calendar')) calendarLayout(root);
        if (root.id === 'auto-memory-modal') {
            const vector = q(root, '.vector-memory-fieldset');
            const heading = q(vector, 'legend'); if (heading) heading.hidden = true;
            const api = q(vector, '#vector-api-panel');
            if (api) { api.open = false;label(q(api,'summary'),'独立嵌入接口');api.before(make('span','draft-api-caption','Embedding API')); }
            q(vector, '.vector-refinements')?.classList.add('draft-card');
            const form=q(root,'#auto-memory-form'),field=name=>form.elements.namedItem(name)?.closest('label');
            const owner=make('div','draft-memory-owner');form.prepend(owner);
            const updateOwner=()=>{const chat=typeof db!=='undefined'&&db.characters.find(c=>c.id===currentChatId);if(chat){const stamp=chat.id+':'+chat.activeArchiveId;if(owner.dataset.owner!==stamp){owner.dataset.owner=stamp;owner.replaceChildren(identityRow(chat));}}};
            new MutationObserver(updateOwner).observe(root,{attributes:true,attributeFilter:['class']});updateOwner();
            const switches=q(form,'.panel-summary-switches'),hide=field('hideSummarized'),floors=field('keepRecent')?.closest('fieldset');
            if(switches&&floors){
                const range=make('section','draft-summary-range'),columns=make('div','draft-columns');
                const advanced=disclose([field('threshold'),hide],'触发与上下文规则','draft-card');
                columns.append(field('batchSize'),field('keepRecent'));range.append(make('h3','','整理范围'),columns);switches.after(range);
                if(advanced)floors.append(advanced);
                const floorDetails=disclose([floors],'高级整理规则','draft-summary-advanced');if(floorDetails)range.after(floorDetails);
            }
            const coverage=q(form,'.panel-coverage'),run=q(form,'#auto-memory-run');
            if(coverage){const details=disclose([coverage],'已整理记录','draft-card');if(run&&details)details.after(run);}
            const summaryApi=q(form,'.panel-summary-api');
            if(summaryApi){const apiView=disclose([summaryApi],'总结 API','draft-card');q(form,'.draft-summary-range')?.after(apiView);const editApi=routeButton('独立 API 配置',()=>configurationWorkspace(q(root,'#memory-api-panel'),'独立总结 API','draft-independent-api'));editApi.id='draft-open-summary-api';summaryApi.append(editApi);}
            const options=[q(form,'.draft-summary-advanced'),q(form,'.panel-summary-options'),q(form,'.panel-summary-guides'),q(form,'.draft-range-summary')].filter(Boolean);
            if(options.length){const more=disclose(options,'高级与使用说明','draft-summary-more');form.append(more);}
            const enable=q(vector,'.panel-vector-enable');if(enable){
                const vectorOwner=make('div','draft-vector-owner');enable.append(vectorOwner);
                const syncVectorOwner=()=>{const chat=typeof db!=='undefined'&&db.characters.find(c=>c.id===currentChatId);vectorOwner.replaceChildren(make('span','','所属角色'));if(chat)vectorOwner.append(make('small','',chat.remarkName||chat.realName||'角色'));};
                new MutationObserver(syncVectorOwner).observe(root,{attributes:true,attributeFilter:['class']});syncVectorOwner();
            }
            const embedding=q(vector,'.panel-vector-embedding'),embeddingModel=q(vector,'#vector-api-embedding-model')?.closest('label');
            if(embedding&&embeddingModel){label(embeddingModel,'模型');embedding.append(embeddingModel);}
            const index=make('section','draft-card draft-vector-index'),indexCount=make('small'),indexState=make('small');
            for(const [name,value]of [['索引状态',indexState],['已保存记录',indexCount]]){const row=make('div','draft-setting-row');row.append(make('span','',name),value);index.append(row);}
            const indexLink=routeButton('建立索引',()=>{q(root,'#auto-memory-close')?.click();openMemoryLibrary();const panel=document.querySelector('.memory-library > .feature-dialog-card');if(!panel)return;decorate(panel);panel.monoNavigate?.('options');const more=q(panel,'.panel-library-more');if(more){more.open=true;const actions=q(more,'.memory-library-index-actions');if(actions)actions.open=true;more.scrollIntoView({block:'nearest'});}});indexLink.classList.add('draft-index-build');indexLink.title='打开记忆管理，建立或续建当前存档索引';indexLink.dataset.icon='refresh-cw';
            const countIndex=()=>{const chat=typeof db!=='undefined'&&db.characters.find(c=>c.id===currentChatId),count=Object.keys(chat?.memoryVectorIndex||{}).length;indexCount.textContent=String(count);indexState.textContent=count?'已有本地记录':'待建立';};
            new MutationObserver(countIndex).observe(root,{attributes:true,attributeFilter:['class']});countIndex();if(embedding)embedding.after(index,indexLink);
            const retrieval=q(vector,'.panel-vector-retrieval'),ranking=q(vector,'.panel-vector-rerank'),refine=q(vector,'.vector-refinements');
            const parameters=disclose([retrieval,ranking,refine],'更多检索参数','draft-vector-more');if(parameters)vector.append(parameters);
            const topK=field('vectorTopK');if(topK){label(topK,'召回上限');const limit=make('section','draft-card draft-vector-limit');limit.append(topK);if(parameters){parameters.before(limit);limit.append(parameters);}}
        }
        if (root.classList.contains('mcp-settings') && !root.closest('#mcp-services')) {
            const body = q(root, '.mcp-body'), footer = q(root, '.mcp-actions');
            if (body && footer) {
                if(root.closest('#mcp-tool-call')){
                    const output=q(body,'.mcp-result');
                    if(output){
                        const inputs=[...body.children].filter(el=>el!==output&&!el.matches('.mcp-status,.mcp-row,.mcp-help,.draft-notice'));
                        const parameters=disclose(inputs,'调用参数','draft-card draft-call-parameters',true);
                        const reader=make('section','draft-card draft-tool-reader');output.before(reader);reader.append(make('h3','','返回内容'),output);
                        const actions=q(body,':scope > .mcp-row');if(actions){actions.classList.add('draft-tool-result-actions');body.append(actions);const use=[...actions.querySelectorAll('button')].find(b=>b.textContent==='供下轮参考');if(use){use.classList.add('panel-primary');footer.append(use);}}
                        let previous=output.textContent;
                        new MutationObserver(()=>{if(previous===output.textContent)return;previous=output.textContent;parameters.open=false;root.classList.add('draft-has-tool-result');const heading=q(root,'.mono-page-title');if(heading)heading.textContent='工具结果';reader.scrollIntoView({block:'nearest'});}).observe(output,{childList:true,characterData:true,subtree:true});
                    }
                }
                if(root.closest('#mcp-service-editor')){
                    const auth=q(body,'select[aria-label="认证"]');if(auth)segment(auth,{none:'无',bearer:'Bearer',oauth:'OAuth'});
                    const protocol=q(body,'select[aria-label="协议"]')?.closest('label'),timeout=q(body,'input[type=number]')?.closest('label');
                    if(protocol){const select=q(protocol,'select');select.setAttribute('aria-label','MCP 协议版本');const caption=q(protocol,'span');if(caption)caption.textContent='协议版本';}
                    const connectionOptions=protocol||timeout?disclose([protocol,timeout],'连接选项','draft-card draft-mcp-connection-options'):null;
                    if(connectionOptions)body.append(connectionOptions);
                    const address=q(body,'input[type=url]')?.closest('label');
                    if(address){label(address,'服务地址');}
                    const warning=[...body.querySelectorAll(':scope > p.mcp-help')];
                    if(warning.length)disclose(warning,'地址与凭据说明','draft-notice');
                }
                [...body.querySelectorAll(':scope > button')].filter(b => /^(保存|确认执行|调用|加入)/.test(b.textContent)).forEach(b => { b.classList.add('panel-primary'); footer.append(b); });
                const explanations = [...body.querySelectorAll(':scope > p.mcp-help')];
                if (explanations.length > 1) disclose(explanations.slice(1), '数据与权限说明', 'draft-notice');
                body.querySelectorAll('label:has(input[type=checkbox])').forEach(row => asSwitch(q(row, 'input')));
            }
        }
        if (root.classList.contains('sticker-description-card')) {
            const save=q(root,'[data-action=save]'),footer=make('footer'),body=make('div','draft-scroll');
            body.append(...[...root.children].filter(el=>!el.matches('header')&&el!==save));if(save){save.classList.add('panel-primary');footer.append(save);}root.append(body,footer);
        }
        if(root.classList.contains('model-picker-card')) {
            const search=q(root,'.model-picker-search'),count=q(root,'.model-picker-count'),list=q(root,'.model-picker-list'),body=make('div','draft-scroll');
            body.append(...[search,count,list].filter(Boolean));root.append(body);
        }
        if (root.classList.contains('resource-health')) {
            const list = q(root, '.resource-health-list');
            if (list) {
                const body = make('div', 'draft-scroll'),help = q(root, ':scope > p'),refresh = q(root, ':scope > button'),overview=make('section','draft-card draft-resource-overview');root.append(body);
                body.append(overview,list);if(help){const info=disclose([help],'检查范围','draft-notice');body.append(info);}
                const groupResources=()=>{const rows=[...list.children].filter(el=>el.tagName==='P');if(!rows.length)return;const groups=new Map();for(const row of rows){const type=row.textContent.split(' · ')[0],bucket=groups.get(type)||[];bucket.push(row);groups.set(type,bucket);}overview.replaceChildren(make('h3','','当前页面资源'));for(const [type,items]of groups){const line=make('div','draft-resource-count');line.append(make('span','',type),make('strong','',String(items.length)));overview.append(line);const detail=make('details','draft-resource-group'),summary=make('summary');summary.append(make('span','',type),make('small','',items.length+' 项'));detail.append(summary,...items);list.append(detail);}};
                new MutationObserver(groupResources).observe(list,{childList:true});groupResources();
                if(refresh){const footer=make('footer');footer.append(refresh);root.append(footer);}
            }
        }
        if (root.matches('.memory-library > .feature-dialog-card')) {
            const body = q(root, '.mono-memory-body');
            if(q(body,'.memory-library-list')){
                const selection=make('button','mono-nav-help','选择');selection.type='button';selection.setAttribute('aria-label','选择记忆');selection.setAttribute('aria-pressed','false');
                selection.onclick=()=>{const active=root.classList.toggle('draft-memory-selecting');selection.textContent=active?'完成':'选择';selection.setAttribute('aria-pressed',String(active));};
                q(root,'.mono-page-nav .mono-nav-spacer')?.replaceWith(selection);
            }
            const filter = [...root.querySelectorAll('.memory-library-filters select')].find(el => [...el.options].some(o => o.value === 'sillytavern'));
            if (filter) { filter.setAttribute('aria-label', '记忆来源'); segment(filter, { '': '全部', sillytavern: '酒馆', summary: '自动总结', manual: '手动' }); const choices = filter.closest('label').nextElementSibling; const search = q(body, '.panel-library-search'); if (search && choices) search.after(choices); }
            if (body && typeof db !== 'undefined') { const chat = (currentChatType === 'private' ? db.characters : db.groups).find(c => c.id === currentChatId); if (chat) body.prepend(identityRow(chat)); }
            if (body && !q(body, '.memory-library-list')) { const footer = q(root, '.mono-page-footer'), actions = q(body, '.memory-library-toolbar'); if (footer && actions) { footer.append(actions); [...actions.querySelectorAll('button')].at(-1)?.classList.add('panel-primary'); } }
            if (q(body, '.memory-library-list')) {
                const options = [...body.children].filter(el => el.matches('.memory-library-tuning,.memory-library-cache,.memory-library-migration,.panel-library-more'));
                const diagnostics = q(body, '.memory-library-diagnostics');
                const main = [...body.children].filter(el => !options.includes(el) && el!==diagnostics);
                root.monoNavigate = subviews(root, body, [{id:'main',title:'记忆',nodes:main},{id:'retrieval',title:'检索诊断',nodes:[diagnostics]},{id:'options',title:'记忆设置',nodes:options}]);
                const footer=q(root,'.mono-page-footer'), tabs=make('nav','draft-bottom-nav draft-memory-nav');tabs.setAttribute('aria-label','记忆导航');
                for(const [id,text] of [['main','记忆'],['retrieval','检索'],['options','设置']]) {const button=make('button','',text);button.type='button';button.onclick=()=>root.monoNavigate(id);button.dataset.view=id;tabs.append(button);}
                footer?.append(tabs);root.addEventListener('mono-view-change',()=>{for(const tab of tabs.children) tab.setAttribute('aria-current',String(tab.dataset.view===root.dataset.monoView?'page':'false'));});root.monoNavigate('main',false);
            }
        }
        if (root.matches('.derived-settings:not(.uvu-calendar)')) {
            const body = q(root, '.derived-body');
            if (body) {
                if(root.closest('#environment-settings')) compactEnvironment(root,body);
                const footer = q(body, ':scope > footer');
                const candidates = q(body, '.avatar-candidate-preview');
                if (candidates) {
                    const simple = [...body.children].filter(el => el.matches('label'));
                    const master = simple.find(el => q(el, 'input[type=checkbox]'));
                    if (master) { asSwitch(q(master, 'input'));label(master,'允许角色更换头像'); body.prepend(master); }
                    const rules = simple.filter(el => el !== master);
                    if (rules.length) disclose(rules, '更换规则', 'draft-avatar-rules');
                    const head = q(candidates, ':scope > summary'); if (head) head.textContent = '可用头像';
                    candidates.classList.add('draft-avatar-candidates');
                    const notes=[...candidates.querySelectorAll(':scope > .derived-help')];if(notes.length){const sourceHelp=disclose(notes,'候选来源','draft-avatar-source');candidates.append(sourceHelp);}
                    const check=q(footer,'[data-check]');if(check){check.classList.add('draft-avatar-check');candidates.after(check);}
                    label(q(footer,'button[type=submit]'),'保存设置');q(footer,'button[type=submit]')?.classList.add('panel-primary');
                    const status=q(body,'.derived-status');if(status){const sync=()=>status.classList.toggle('draft-routine-status',status.textContent==='尚未检查；默认关闭。');new MutationObserver(sync).observe(status,{childList:true,subtree:true,characterData:true});sync();}
                    const title=q(root,'.mono-page-title');if(title)title.textContent='自主换头像';
                    candidates.open = true;
                    if (master) master.after(candidates); else body.prepend(candidates);
                    if (typeof db !== 'undefined') { const chat=db.characters.find(c=>c.id===currentChatId);if(chat)body.prepend(identityRow(chat)); }
                }
                if (!candidates) {
                    const help = [...body.querySelectorAll(':scope > .derived-help')];
                    if (help.length) { const disclosure = disclose(help, '数据与隐私', 'draft-notice'); if (footer) footer.before(disclosure); }
                }
                if (footer && body.tagName === 'FORM') {
                    const scroll = make('div', 'draft-form-scroll');
                    const nodes = [...body.children].filter(el => el !== footer); body.prepend(scroll); scroll.append(...nodes); body.classList.add('draft-fixed-form');
                } else if (footer) root.append(footer);
            }
        }
    }
    function identityRow(chat, detail = '') {
        const row = make('div', 'draft-identity'), name = chat.remarkName || chat.realName || chat.name || '角色';
        const avatar = chat.avatar ? make('img', 'draft-avatar') : make('span', 'draft-avatar', name.slice(0, 1)); if (chat.avatar) { avatar.src = chat.avatar; avatar.alt = ''; }
        const text = make('div'); text.append(make('strong', '', name), make('small', '', detail || '当前存档')); row.append(avatar, text); return row;
    }
    function compactEnvironment(root,body) {
        const enabled=q(body,'[name=enabled]')?.closest('label'),sync=q(body,'[name=aiEnabled]')?.closest('label');
        if(enabled){label(enabled,'启用环境信息');if(sync)label(sync,'向当前角色同步');group([enabled,sync],'','draft-card draft-environment-switches');}
        const mine=q(body,'[data-place=user]'),remote=q(body,'[data-chat]');
        if(mine){
            mine.classList.add('draft-environment-location');const heading=q(mine,':scope > strong'),current=q(mine,'[data-current]'),search=q(mine,'.derived-search'),locate=q(mine,'[data-locate]'),admin=q(mine,'label:has([data-subdivision])');
            if(heading)heading.textContent='地点';
            if(admin)disclose([admin],'行政区设置','draft-environment-admin');
            if(current){const state=make('section','draft-card draft-environment-current');state.append(make('span','','当前位置'),current);mine.after(state);}
            if(locate&&search)search.after(locate);
        }
        if(remote){const toggle=q(remote,'[name=remoteEnabled]')?.closest('label');if(toggle)label(toggle,'异地模式');disclose([remote],'角色地点与异地','draft-environment-remote');}
        const title=q(root,'.mono-page-title');if(title)title.textContent='环境信息';
    }
    function inlineSettings(root) {
        if (root.dataset.draftInline || !root.matches('#uvu-notification-preferences,.worldbook-advanced')) return;
        root.dataset.draftInline = 'true';
        const title = root.id === 'uvu-notification-preferences' ? '通知偏好' : '世界书规则', original = q(root, ':scope > summary');
        const nodes = [...root.children].filter(el => el!==original), panel=make('section','uvu-mono-panel mono-page draft-inline-workspace'), head=make('header','mono-page-nav');
        const back=make('button','mono-nav-back');back.type='button';back.setAttribute('aria-label','返回');navIcon(back,'chevron-left');back.onclick=()=>{root.open=false;original?.focus();};
        head.append(back,make('h2','mono-page-title',title),make('span','mono-nav-spacer'));
        const body=make('div','draft-scroll'),footer=make('footer');body.append(...nodes);panel.append(head,body,footer);root.append(panel);
        const save=[...body.children].find(el=>el.tagName==='BUTTON'&&/保存/.test(el.textContent));
        if(save) {save.classList.add('panel-primary');footer.append(save);} else {const done=make('button','panel-primary','返回条目');done.type='button';done.onclick=back.onclick;footer.append(done);}
        body.querySelectorAll('input[type=checkbox]').forEach(asSwitch);
        panel.addEventListener('keydown',event=>{
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();back.click();return;}
            if(event.key!=='Tab')return;
            const controls=[...panel.querySelectorAll('button,input,select,textarea,summary,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);
            const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
        });
        if(root.id==='uvu-notification-preferences') {
            const labels=[...body.querySelectorAll(':scope > label')], switches=labels.filter(el=>q(el,'input[type=checkbox]'));
            group(switches.slice(0,2),'通知','draft-card');
            const times=labels.filter(el=>q(el,'input[type=time]')),quiet=group([switches[2],...times],'免打扰','draft-card');if(quiet&&times.length){const range=make('div','draft-columns');range.append(...times);quiet.append(range);}
            const remaining=labels.filter(el=>!switches.slice(0,3).includes(el)&&!times.includes(el));group(remaining,'隐私与聊天','draft-card');
            const help=q(body,'.panel-notification-help');if(help)body.append(help);
        }
        if(root.classList.contains('worldbook-advanced')) {
            const labels=[...body.querySelectorAll(':scope > label')], toggles=labels.filter(el=>q(el,'input[type=checkbox]'));
            group(toggles.slice(0,2),'','draft-card');
            const fields=labels.filter(el=>!toggles.includes(el));group(fields.slice(0,2),'触发方式','draft-card');disclose(fields.slice(2).concat(toggles.slice(2)),'匹配与扫描','draft-card');
            const help=[...body.querySelectorAll(':scope > .feature-help')];if(help.length)disclose(help,'生效说明','draft-notice');
        }
    }
    function openBackupWorkspace() {
        if(document.getElementById('draft-backup-workspace'))return;
        if(typeof renderStorageUI==='function')renderStorageUI();
        const selectors=['.storage-backup-modes','#storage-backup-options','#storage-export-format-row','.storage-backup-extras','#storage-backup-progress','#storage-backup-cancel','.storage-action-group'];
        const nodes=[...new Set(selectors.flatMap(selector=>[...document.querySelectorAll('#storage-analysis-screen '+selector)]))];
        if(!nodes.length)return;
        const slots=nodes.map(node=>{const slot=document.createComment('backup-control');node.before(slot);return{node,slot};});
        let categoryObserver;
        const d=createMessageForwardDialog('备份与恢复','draft-backup-workspace',()=>{categoryObserver?.disconnect();for(const {node,slot}of slots){if(slot.isConnected)slot.replaceWith(node);}if(typeof renderStorageUI==='function')renderStorageUI();});d.panel.classList.add('derived-settings');
        const body=make('div','derived-body'),footer=make('footer');body.append(...nodes);d.panel.append(body,footer);
        const modes=q(body,'.storage-backup-modes'),options=q(body,'#storage-backup-options');if(modes&&options){const title=make('h2','draft-backup-title','保存你的数据');modes.after(title);}
        const actions=q(body,'.storage-action-group');if(actions)footer.append(actions);
        const extras=[...body.querySelectorAll(':scope > .storage-backup-extras')];if(extras.length)disclose(extras,'备份选项','draft-card');
        body.querySelectorAll('input[type=checkbox]').forEach(input=>{input.style.width='16px';input.style.height='16px';});
        for(const button of modes.querySelectorAll('button'))label(button,button.dataset.backupMode==='export'?'导出':'导入');
        const categories=()=>{
            const rows=[...options.querySelectorAll(':scope > .storage-setting-item')];if(!rows.length)return;
            const detail=make('details','draft-backup-categories'),groups=make('div','draft-backup-groups');detail.append(make('summary','','单独选择分类'));options.prepend(groups);
            for(const [name,keys]of [['角色与私聊',['chats','contacts','personas']],['世界书',['worldbooks']],['外观与设置',['wallpapers','fonts','settings']],['相册 / 工坊 / 阅读',['other']]]){
                const members=keys.map(key=>q(options,'input[data-key="'+key+'"]')).filter(Boolean),row=make('label','draft-backup-group'),input=make('input');input.type='checkbox';input.setAttribute('aria-label',name);row.append(input,make('span','',name));groups.append(row);
                const sync=()=>{input.checked=members.every(el=>el.checked);input.indeterminate=!input.checked&&members.some(el=>el.checked);};sync();members.forEach(el=>el.addEventListener('change',sync));
                input.onchange=()=>{const checked=input.checked;for(const member of members){member.checked=checked;member.dispatchEvent(new Event('change',{bubbles:true}));}sync();};
            }
            detail.append(...rows);const notes=[...options.children].filter(el=>el!==groups&&el!==detail);if(notes.length){const note=make('details','draft-backup-notes');note.append(make('summary','','恢复范围说明'),...notes);detail.append(note);}options.append(detail);
        };
        categories();categoryObserver=new MutationObserver(categories);categoryObserver.observe(options,{childList:true});
    }
    function presetWorkspace() {
        const source=document.querySelector('.home-preset-card');if(!source||source.dataset.draftPreset)return;source.dataset.draftPreset='true';source.classList.add('uvu-mono-panel');
        const nodes=[...source.children],title=q(source,'#home-preset-title'),launch=make('button','','管理主页预设');launch.type='button';
        const overlay=make('div','draft-workspace-overlay'),panel=make('section','uvu-mono-panel mono-page draft-preset-workspace'),head=make('header','mono-page-nav'),back=make('button','mono-nav-back');overlay.hidden=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','主页预设');back.type='button';back.setAttribute('aria-label','返回个性化设置');navIcon(back,'chevron-left');head.append(back,make('h2','mono-page-title','主页预设'),make('span','mono-nav-spacer'));
        const body=make('div','draft-scroll'),footer=make('footer');body.append(...nodes.filter(el=>el!==title));panel.append(head,body,footer);overlay.append(panel);source.replaceChildren(title,launch,overlay);
        const actions=q(body,'.home-preset-actions');if(actions)footer.append(actions);
        const input=q(body,'#home-preset-name'),caption=q(body,'label[for=home-preset-name]');if(input&&caption){const field=make('label','draft-preset-name');field.append(caption,input);body.prepend(field);}
        const include=q(body,'.home-preset-option');if(include){asSwitch(q(include,'input'));group([include],'分享内容','draft-card');}
        const help=[...body.querySelectorAll(':scope > p:not(#home-preset-status)')];if(help.length)disclose(help,'导入与分享说明','draft-notice');
        launch.onclick=()=>{overlay.hidden=false;back.focus();};back.onclick=()=>{overlay.hidden=true;launch.focus();};
        overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();back.click();}if(event.key==='Tab'){const list=[...panel.querySelectorAll('button,input,summary')].filter(el=>!el.disabled&&el.getClientRects().length);if(event.shiftKey&&document.activeElement===list[0]){event.preventDefault();list.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===list.at(-1)){event.preventDefault();list[0]?.focus();}}});
    }
    function voiceWorkspace(root) {
        const host = q(root, ':scope > .kkt-item'), connection = q(root, '.panel-voice-connection'), director = q(root, '.minimax-director-settings');
        const playback = [...root.querySelectorAll('.minimax-settings-section')].find(el => el.querySelector('#minimax-tts-model'));
        const actions = q(root, '.minimax-tts-actions'), status = q(root, '#minimax-tts-status'); if (!host || !playback || !connection || !director || !actions) return;
        const intro = q(host, ':scope > .kkt-item-content'); if (intro) { const note = q(intro, '.kkt-item-subtitle'); if (note) note.textContent = '音色与语音导演'; }
        const launch = make('div', 'draft-voice-launchers'), voiceButton = make('button', '', '语音设置'), directorButton = make('button', '', '语音导演'); voiceButton.type = directorButton.type = 'button'; launch.append(voiceButton, directorButton); host.append(launch);
        const overlay = make('div', 'draft-workspace-overlay'), panel = make('section', 'uvu-mono-panel mono-page draft-voice-workspace'); overlay.hidden = true; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '语音设置'); root.append(overlay); overlay.append(panel);
        const nav = make('header', 'mono-page-nav'), back = make('button', 'mono-nav-back'), title = make('h2', 'mono-page-title', '语音'); back.type = 'button'; back.setAttribute('aria-label', '返回 API 设置'); navIcon(back, 'chevron-left'); nav.append(back, title, make('span', 'mono-nav-spacer'));
        const body = make('div', 'draft-scroll'), footer = make('footer'); panel.append(nav, body, footer); footer.append(actions, status);
        const apiSummary = q(connection, ':scope > summary'); if (apiSummary) apiSummary.hidden = true; connection.open = true;
        q(playback, ':scope > strong')?.remove();
        const audition = make('section', 'draft-card draft-voice-audition'); audition.append(make('h3', '', '试听'), make('p', '', '你好，这是角色语音试听。'));
        const audioIcon = make('div', 'draft-audio-icon'); audioIcon.innerHTML = window.UvULucide?.['audio-lines'] || window.UvULucide?.['audio-waveform'] || window.UvULucide?.['volume-2'] || ''; audioIcon.setAttribute('aria-hidden','true'); audition.append(audioIcon);
        const preview = q(root, '#minimax-tts-preview'); if (preview) audition.append(preview);
        const key = q(root, '#minimax-tts-key')?.closest('label'), model = q(root, '#minimax-tts-model')?.closest('label'), groupId = q(root, '#minimax-tts-group-id')?.closest('label');
        const pair = make('div', 'draft-columns'); pair.append(...[model, groupId].filter(Boolean));
        const routes = make('section', 'draft-card draft-voice-routes');
        const stop = make('button', '', '停止'); stop.type = 'button'; stop.onclick = () => { if (typeof MiniMaxTTS !== 'undefined') MiniMaxTTS.stop(); };
        const auditionActions = make('div', 'draft-audition-actions'); if (preview) auditionActions.append(preview); auditionActions.append(stop); audition.append(auditionActions);
        const navigate = subviews(panel, body, [{ id: 'main', title: 'MiniMax 语音', nodes: [audition, key, pair, routes] }, { id: 'director', title: '语音导演', nodes: [director] }, { id: 'api', title: '语音连接', nodes: [connection] }, { id:'parameters', title:'语音参数', nodes:[playback] }]);
        panel.monoNavigate = navigate;
        const save=q(actions,'#minimax-tts-save');if(save){save.classList.add('panel-primary');const caption=()=>label(save,panel.dataset.monoView==='director'?'保存导演设置':panel.dataset.monoView==='profiles'?'保存音色':'保存');panel.addEventListener('mono-view-change',caption);caption();}
        if(status){const compact=()=>status.classList.toggle('draft-routine-status',status.textContent==='尚未设置 MiniMax 语音服务。');new MutationObserver(compact).observe(status,{childList:true,subtree:true,characterData:true});compact();}
        routes.append(routeButton('语音导演', () => navigate('director')), routeButton('语音 API', () => navigate('api')), routeButton('高级参数', () => navigate('parameters')));
        let trigger = voiceButton;
        const show = (id, button) => { trigger = button; overlay.hidden = false; navigate(id); };
        voiceButton.onclick = () => show('main', voiceButton); directorButton.onclick = () => show('director', directorButton);
        const close = () => { overlay.hidden = true; trigger.focus(); };
        back.onclick = close;
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (panel.dataset.monoView !== 'main') navigate('main'); else close(); }
            if (event.key !== 'Tab') return;
            const controls = [...panel.querySelectorAll('button,input,select,textarea,summary')].filter(el => !el.disabled && el.getClientRects().length);
            const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
    }
    function voiceEnhancements(root) {
        const preset=q(root,'#minimax-director-preset');
        if(preset&&!preset.dataset.panelSegment){
            segment(preset,{});const choices=preset.closest('label').nextElementSibling,fields=q(root,'#minimax-director-fields');
            if(choices&&fields)fields.prepend(choices);
        }
        if (preset) {
            const choices=q(root,'#minimax-director-fields > .panel-segment');
            if (choices?.classList.contains('panel-segment')) {
                const keep=q(choices,'button[data-value=""]');if(keep){keep.classList.add('draft-current-style');keep.textContent='沿用当前';}
            }
        }
        const advanced = q(root, '#minimax-speech-advanced'), panel = q(root, '.draft-voice-workspace');
        if (!advanced || !panel?.monoNavigate || advanced.dataset.draftVoice) return;
        advanced.dataset.draftVoice = 'true'; advanced.open = true;
        const catalog=[...advanced.querySelectorAll(':scope > details')].find(el=>q(el,'summary')?.textContent==='选择音色');
        if(catalog){catalog.open=true;const heading=q(catalog,'summary');if(heading)heading.hidden=true;}
        const role = q(advanced, ':scope > label select');
        if (role && typeof db !== 'undefined') {
            const owner=make('div','draft-voice-role');advanced.prepend(owner);owner.append(role.closest('label'));
            const renderOwner=()=>{const chat=db.characters.find(c=>c.id===role.value);owner.replaceChildren();if(chat)owner.append(identityRow(chat,'音色仅用于此角色'));};
            const selector=role.closest('label');
            const syncOwner=()=>{renderOwner();if(!role.value)owner.prepend(identityRow({name:'默认设置'},'作为未指定音色时的默认值'));owner.append(selector);};
            role.addEventListener('change',syncOwner);syncOwner();
        }
        const profile=q(advanced,'.minimax-speech-profile');
        if(profile) {
            const voice=q(profile,'input')?.closest('label'),rules=[...profile.children].filter(el=>el!==voice);
            if(rules.length)disclose(rules,'角色表达与读音','draft-voice-profile-rules');
            profile.classList.add('draft-card');
        }
        const defaultVoice=q(root,'#minimax-tts-voice')?.closest('label');if(defaultVoice){const defaults=disclose([defaultVoice],'默认音色','draft-voice-default');advanced.append(defaults);}
        if(catalog&&profile){
            const search=q(catalog,'input[type=search]')?.closest('label');if(search){search.classList.add('draft-voice-search');q(search,'input').placeholder='搜索音色或 voice_id';for(const node of [...search.childNodes])if(node.nodeType===3)node.remove();profile.before(search);}
            const advancedNotes=[...advanced.querySelectorAll(':scope > details')].filter(el=>el!==catalog&&el!==q(advanced,'.draft-voice-default'));
            if(advancedNotes.length)disclose(advancedNotes,'播放与更多设置','draft-voice-more');
            profile.after(catalog);catalog.classList.add('draft-voice-catalog');
        }
        panel.monoNavigate.add({ id: 'profiles', title: '角色音色', nodes: [advanced] });
        const main = q(panel, '[data-mono-view=main]'), routes = q(main, '.draft-voice-routes');
        routes?.prepend(routeButton('角色音色与播放', () => {
            window.MiniMaxSpeech?.refreshRoles();
            if (role && !role.value && typeof currentChatId !== 'undefined' && [...role.options].some(option=>option.value===currentChatId)) {role.value=currentChatId;role.dispatchEvent(new Event('change',{bubbles:true}));}
            panel.monoNavigate('profiles');
        }));
    }
    function calendarLayout(root) {
        const header = q(root, '.message-forward-header'), body = q(root, '.calendar-body'), tabs = q(root, '.calendar-tabs'); if (!header || !body || !tabs) return;
        // Keep the original date grid and gesture handlers; only their surrounding navigation moves.
        const title = q(header, 'strong'), back = q(header, '.message-forward-close');
        root.classList.add('mono-page'); root.closest('.message-forward-overlay')?.classList.add('mono-page-overlay');
        header.classList.add('mono-page-nav'); title?.classList.add('mono-page-title');
        if (back) { back.classList.add('mono-nav-back'); back.setAttribute('aria-label', '关闭日历'); navIcon(back, 'chevron-left'); header.prepend(back); }
        const prefs = q(body, '.calendar-topbar button[aria-label="日历设置"]'); if (prefs) { prefs.classList.add('mono-nav-help'); header.append(prefs); }
        const footer = make('footer', 'draft-calendar-footer'),primary=make('div','draft-calendar-primary'),dates = make('button', '', '日历'); dates.type = 'button'; dates.setAttribute('role', 'tab'); dates.dataset.mode = 'calendar';footer.append(primary);
        let calendarView='calendar';
        const schedule=q(tabs,'[data-mode=schedule]'),moodTab=q(tabs,'[data-mode=mood]'),periodTab=q(tabs,'[data-mode=period]'),recordTab=make('button','','记录'),recordModes=make('nav','panel-segment draft-calendar-record-modes');recordTab.type='button';recordTab.setAttribute('role','tab');recordTab.onclick=()=>{if(moodTab.getAttribute('aria-selected')!=='true'&&periodTab.getAttribute('aria-selected')!=='true')moodTab.click();syncCalendar();};
        tabs.append(recordTab);recordModes.append(moodTab,periodTab);body.prepend(recordModes);recordModes.addEventListener('click',()=>syncCalendar());
        dates.onclick = () => { schedule.click();calendarView='calendar';syncCalendar();body.scrollTo({ top: 0 }); };
        tabs.prepend(dates); footer.append(tabs); root.append(footer);
        const month = q(body, '.calendar-month-card'); month?.classList.add('draft-card');
        const monthNav=q(month,'.calendar-month-nav');if(monthNav)month.before(monthNav);
        const top=q(body,'.calendar-topbar'),ownerSelect=q(top,'select'),ownerHeading=make('div','draft-calendar-owner'),ownerIdentity=make('div','draft-identity draft-calendar-identity');
        if(ownerSelect){const ownerField=make('label','draft-calendar-owner-field');ownerField.append(ownerSelect);ownerHeading.append(ownerField);body.prepend(ownerHeading);}
        const location=top&&disclose([top], '日历与位置', 'draft-calendar-location');if(location)body.append(location);
        const previous = q(monthNav, '[aria-label="上月"]'), next = q(monthNav, '[aria-label="下月"]'); if (previous) navIcon(previous, 'chevron-left'); if (next) navIcon(next, 'chevron-right');
        const week=make('nav','draft-calendar-week');week.setAttribute('aria-label','本周日期');month.after(week);
        function syncCalendar(){
            const mode=moodTab.getAttribute('aria-selected')==='true'?'mood':periodTab.getAttribute('aria-selected')==='true'?'period':'schedule',agenda=mode==='schedule'&&calendarView==='agenda';
            root.dataset.calendarView=mode==='schedule'?calendarView:mode;dates.setAttribute('aria-selected',String(mode==='schedule'&&!agenda));schedule.setAttribute('aria-selected',String(agenda));
            recordTab.setAttribute('aria-selected',String(mode!=='schedule'));recordModes.hidden=mode==='schedule';
            month.hidden=agenda;monthNav.hidden=agenda;week.hidden=!agenda;
            const range=q(body,'.calendar-range-bar');if(range)range.hidden=agenda||mode==='period';
            if(agenda){
                if(ownerHeading.parentElement!==body)body.prepend(ownerHeading);
                if(!ownerHeading.contains(ownerIdentity))ownerHeading.prepend(ownerIdentity);
                const ownerText=ownerSelect?.selectedOptions[0]?.textContent.replace(/ 的日历$/,'')||'我的日历';
                const currentName=ownerText==='我的日历'?'你':ownerText;
                if(ownerIdentity.dataset.name!==currentName){ownerIdentity.dataset.name=currentName;ownerIdentity.replaceChildren(make('span','draft-avatar',currentName.slice(0,1)),make('strong','',currentName));}
            }else if(location&&ownerHeading.parentElement!==location){location.prepend(ownerHeading);}
            if(mode==='schedule'&&!agenda&&range){range.append(primary);primary.classList.add('is-inline');}else{footer.prepend(primary);primary.classList.remove('is-inline');}
            const current=q(root,'.calendar-day.is-selected'),date=current?.dataset.date;if(!date)return;
            const heading=q(root,'.mono-page-title');if(heading)heading.textContent=mode==='period'?'经期记录':mode==='mood'?'心情':agenda?'日程':'日历';
            const day=new Date(date+'T12:00:00Z'),offset=(day.getUTCDay()+6)%7;week.replaceChildren();
            for(let i=0;i<7;i++){const d=new Date(day);d.setUTCDate(day.getUTCDate()+i-offset);const value=d.toISOString().slice(0,10),b=make('button');b.type='button';b.setAttribute('aria-label',value);b.setAttribute('aria-pressed',String(value===date));b.append(make('small','',['一','二','三','四','五','六','日'][i]),make('strong','',String(d.getUTCDate())));b.onclick=()=>{if(!q(root,'.calendar-day[data-date="'+value+'"]'))(value<date?previous:next)?.click();q(root,'.calendar-day[data-date="'+value+'"]')?.click();};week.append(b);}
        }
        tabs.addEventListener('click',event=>{if(event.target.closest('button')===schedule)calendarView='agenda';syncCalendar();});
        const detail=q(body,'.calendar-detail');
        function arrangeDetail(){
            if(!detail)return;
            const actions=q(detail,'.calendar-inline-actions'),add=q(actions,'.calendar-primary');
            const refreshed=actions&&!actions.dataset.draftArranged;
            // Lifted cards are outside paintDetail's replaceChildren; clear them once per repaint.
            if(refreshed)body.querySelectorAll(':scope > .draft-period-current,:scope > .calendar-period-legend').forEach(el=>el.remove());
            if(refreshed){actions.dataset.draftArranged='true';
            if(add){primary.replaceChildren(add);add.classList.add('panel-primary');}
            const generate=actions&&[...actions.querySelectorAll('button')].find(b=>b.textContent==='生成行程');
            const oldGenerate=q(ownerHeading,'.draft-calendar-generate');if(oldGenerate&&oldGenerate!==generate)oldGenerate.remove();
            if(generate){generate.classList.add('draft-calendar-generate');ownerHeading.append(generate);}
            if(actions&&actions.children.length&&!actions.closest('details')){const more=disclose([actions],'更多操作','draft-calendar-actions');detail.append(more);}}
            const moods=q(detail,'.calendar-schedule-moods'),timeline=q(detail,'.calendar-timeline');if(moods&&timeline&&timeline.nextElementSibling!==moods)timeline.after(moods);
            const dateHeading=q(detail,'.calendar-section-heading h3');if(dateHeading&&/^\d{4}-\d{2}-\d{2}$/.test(dateHeading.textContent)){
                const date=dateHeading.textContent,day=new Date(date+'T12:00:00Z');dateHeading.textContent=Number(date.slice(5,7))+' 月 '+Number(date.slice(8))+' 日 · 周'+['日','一','二','三','四','五','六'][day.getUTCDay()];
            }
            const period=refreshed?q(detail,'.calendar-period-record'):q(body,':scope > .draft-period-current');if(root.dataset.calendarView==='period'&&period){
                period.classList.add('draft-period-current');body.insertBefore(period,monthNav);
                const start=period.dataset.start,end=period.dataset.end,title=q(period,'strong');
                if(start&&title){title.textContent=Number(start.slice(5,7))+' 月 '+Number(start.slice(8))+(end?(end.slice(0,7)===start.slice(0,7)?'—'+Number(end.slice(8)):'—'+Number(end.slice(5,7))+' 月 '+Number(end.slice(8)))+' 日':' 日起');period.title=start+'—'+(end||'进行中');
                    const days=end?Math.round((new Date(end+'T12:00:00Z')-new Date(start+'T12:00:00Z'))/86400000)+1:null;
                    if(!q(period,'.draft-period-duration'))period.append(make('small','draft-period-duration',days?'已记录 · '+days+' 天':'进行中'));
                }
                const legend=q(detail,'.calendar-period-legend');
                if(legend){body.querySelectorAll(':scope > .calendar-period-legend').forEach(old=>{if(old!==legend)old.remove();});month.after(legend);}
                const state=window.UvUCalendar?.state(),prefs=state?.prefs;
                if(prefs&&!q(detail,'.draft-period-settings')){
                    const card=make('section','draft-card draft-period-settings');
                    for(const [name,value]of [['周期',prefs.cycleDays+' 天'],['持续',prefs.periodDays+' 天']]){const row=make('div','draft-setting-row');row.append(make('span','',name),make('small','',value));card.append(row);}
                    const settings=routeButton('周期设置',()=>prefsButton?.click());card.append(settings);detail.prepend(card);
                }
                const prediction=q(detail,'.calendar-prediction');if(prediction&&!prediction.closest('details'))disclose([prediction,...[...detail.children].filter(el=>el.matches('p.calendar-muted'))],'预测范围与依据','draft-period-prediction');
            }
            for(const old of body.querySelectorAll(':scope > .draft-period-current'))if(root.dataset.calendarView!=='period'||period&&old!==period)old.remove();
            if(root.dataset.calendarView!=='period')body.querySelectorAll(':scope > .calendar-period-legend').forEach(el=>el.remove());
        }
        const prefsButton=prefs;
        if(detail)new MutationObserver(()=>{syncCalendar();arrangeDetail();}).observe(detail,{childList:true});syncCalendar();arrangeDetail();
    }

    function openImageSettings() {
        if (document.getElementById('draft-image-settings')) return;
        const restored = [], labels = [];
        const d = createMessageForwardDialog('生图设置', 'draft-image-settings', () => {
            for (const [node, anchor] of restored) if (anchor.isConnected) anchor.replaceWith(node);
            for (const [node, original] of labels) if(original===null)node.removeAttribute('aria-label');else node.setAttribute('aria-label',original);
        });
        d.panel.classList.add('derived-settings', 'draft-image-settings');
        const body = make('div', 'derived-body'), api = make('section', 'draft-image-api'), params = make('section', 'draft-image-parameters');
        const tabs = make('div', 'panel-segment'); tabs.setAttribute('aria-label', '生图设置分类');
        for (const [text, target] of [['连接', api], ['生成参数', params]]) {
            const tab = make('button', '', text); tab.type = 'button';
            tab.onclick = () => { api.hidden = target !== api; params.hidden = target !== params; for (const button of tabs.children) button.setAttribute('aria-pressed', String(button === tab)); };
            tabs.append(tab);
        }
        body.append(tabs, api, params); d.panel.append(body);
        const borrow = (node, destination) => {
            if (!node) return;
            const anchor = document.createComment('workshop-control'); node.before(anchor); restored.push([node, anchor]); destination.append(node);
        };
        const borrowField = (id, title, destination = api) => {
            const node = document.getElementById(id); if (!node) return;
            const field = make('label', 'draft-image-setting-field', title); labels.push([node,node.getAttribute('aria-label')]);node.setAttribute('aria-label', title); destination.append(field); borrow(node, field);
        };
        borrowField('workshop-api-url', 'API 地址');
        borrowField('workshop-api-key', 'API Key');
        // Borrow the original rows: their visibility and callbacks still follow the selected provider.
        for (const id of ['workshop-model-select-row', 'workshop-custom-model-row']) borrow(document.getElementById(id), api);
        const moreApi=make('details','draft-image-more'); moreApi.append(make('summary','','更多参数'));api.append(moreApi);
        borrowField('workshop-api-preset-select', 'API 预设', moreApi);
        for(const id of ['workshop-api-protocol-row','workshop-response-format-row','workshop-api-protocol-hint'])borrow(document.getElementById(id),moreApi);
        const fetch = document.getElementById('workshop-fetch-models-btn'); if (fetch) { const actions = make('div', 'draft-image-setting-actions'); api.append(actions); borrow(fetch, actions); }
        const provider = typeof db !== 'undefined' && db.workshopSettings?.provider || 'novelai';
        const ratio = document.querySelector('input[name="' + (provider === 'gpt' ? 'workshop-gpt-aspect-ratio' : 'workshop-aspect-ratio') + '"]')?.closest('.radio-group-pills');
        params.append(make('h3', '', '比例')); borrow(ratio, params);
        if (provider === 'gpt') { borrowField('workshop-gpt-quality', '质量', params); borrowField('workshop-gpt-style', '风格', params); }
        const preview = document.getElementById('pv-confirm-preview')?.closest('label'); borrow(preview, params);
        const more = routeButton('完整工坊设置', () => { d.dismiss(); ChatImageGeneration.cancel(); document.getElementById('send-pv-modal').classList.remove('visible'); switchScreen('drawing-workshop-screen'); });
        body.append(more, make('small', 'draft-notice', '与绘图工坊共用，修改自动保存。'));
        const footer = make('footer'), done = make('button', 'panel-primary', '完成设置'); done.type = 'button'; done.onclick = () => d.dismiss(); footer.append(done); d.panel.append(footer); tabs.firstElementChild.click();
    }
    async function openImageHistory() {
        if (document.getElementById('draft-image-history')) return;
        const d = createMessageForwardDialog('生图记录', 'draft-image-history'); d.panel.classList.add('derived-settings');
        const body = make('div', 'derived-body'), search = make('input'), status = make('p', 'draft-notice', '正在读取工坊记录…'), gallery = make('div', 'draft-image-gallery'), detail = make('section', 'draft-card draft-image-history-detail');
        search.type = 'search'; search.placeholder = '搜索提示词'; search.setAttribute('aria-label', '搜索生图记录'); detail.hidden = true; status.setAttribute('role', 'status'); body.append(search, status, gallery, detail); d.panel.append(body);
        let records = [], selectedId;
        const safeImage = value => { const src = String(value || ''); return /^data:image\/(png|jpeg|webp|gif);base64,/i.test(src) ? src : /^[A-Za-z0-9+/=\s]+$/.test(src) && src.length > 32 ? 'data:image/png;base64,' + src : /^https?:\/\//i.test(src) ? src : ''; };
        const select = item => {
            selectedId = item.id; detail.hidden = false; detail.replaceChildren();
            const picture = make('img'); picture.alt = '已生成图片'; picture.src = safeImage(item.image); detail.append(picture, make('p', 'draft-image-history-prompt', item.prompt || '无提示词'));
            const date = new Date(item.timestamp); if (Number.isFinite(date.getTime())) detail.append(make('small', '', date.toLocaleDateString()));
            const actions = make('div', 'draft-image-history-actions'), reuse = make('button', 'panel-primary', '使用提示词'), save = make('a', '', '保存图片'), remove = make('button', '', '删除'); reuse.type = remove.type = 'button';
            reuse.onclick = () => { const field = document.getElementById('pv-text-input'); field.value = item.prompt || ''; field.dispatchEvent(new Event('input', { bubbles: true })); d.dismiss(); };
            save.href = safeImage(item.image); save.download = 'UvU-generated-' + item.timestamp + '.png'; save.rel = 'noopener';
            remove.onclick = async () => { if (!window.confirm('删除这张工坊记录？已发送的图片会保留。')) return; remove.disabled = true; try { await dexieDB.workshopHistory.delete(item.id); records = records.filter(row => row.id !== item.id); selectedId = undefined; detail.hidden = true; render(); if (typeof loadWorkshopHistory === 'function') await loadWorkshopHistory(); } catch { status.textContent = '删除失败，请重试。'; remove.disabled = false; } };
            actions.append(reuse, save, remove); detail.append(actions);
            for (const button of gallery.children) button.setAttribute('aria-pressed', String(button.dataset.recordId === String(selectedId)));
        };
        const render = () => {
            gallery.replaceChildren(); const query = search.value.trim().toLocaleLowerCase(), shown = records.filter(item => String(item.prompt || '').toLocaleLowerCase().includes(query));
            status.textContent = shown.length ? '工坊记录 · ' + shown.length : query ? '没有匹配的记录' : '暂无工坊记录';
            for (const item of shown) { const button = make('button'), picture = make('img'); button.type = 'button'; button.dataset.recordId = String(item.id); button.setAttribute('aria-label', item.prompt || '查看生图'); button.setAttribute('aria-pressed', String(item.id === selectedId)); picture.src = safeImage(item.image); picture.alt = ''; picture.loading = 'lazy'; button.append(picture); button.onclick = () => select(item); gallery.append(button); }
            if (selectedId !== undefined && !shown.some(item => item.id === selectedId)) detail.hidden = true;
        };
        search.oninput = render;
        try { if (typeof dexieDB === 'undefined' || !dexieDB?.workshopHistory) throw new Error(); records = await dexieDB.workshopHistory.orderBy('timestamp').reverse().toArray(); if (!body.isConnected) return; render(); } catch { status.textContent = '工坊记录暂不可用，请稍后重试。'; }
    }
    function imageWorkspace() {
        const overlay = document.getElementById('send-pv-modal'), form = document.getElementById('send-pv-form'), ai = document.getElementById('pv-mode-ai');
        const panel = overlay && q(overlay, '.modal-window'); if (!panel || !form || !ai) return;
        const nav = make('header', 'mono-page-nav draft-ai-nav'), back = make('button', 'mono-nav-back'), title = make('h2', 'mono-page-title', 'AI 生图'); back.type = 'button'; back.setAttribute('aria-label', '关闭生图'); navIcon(back, 'chevron-left'); back.onclick = () => { ChatImageGeneration.cancel(); overlay.classList.remove('visible'); };
        nav.append(back, title, make('span', 'mono-nav-spacer')); panel.prepend(nav);
        const sync = () => { const active = ai.checked; panel.classList.toggle('uvu-mono-panel', active); panel.classList.toggle('mono-page', active); panel.classList.toggle('draft-image-page', active); overlay.classList.toggle('mono-page-overlay', active); nav.hidden = !active; };
        form.addEventListener('change', sync); form.addEventListener('reset', () => queueMicrotask(sync)); sync();
        const description=q(form,'#pv-text-input'),field=description?.closest('.form-group'),modes=q(form,'.pv-send-modes');
        const identity=make('div','draft-image-identity'),options=make('details','draft-image-options'),optionsTitle=make('summary','','生成选项');options.append(optionsTitle);
        const hint=q(form,'#pv-generation-hint'),previewChoice=q(form,'label:has(#pv-confirm-preview)');
        if(modes){form.prepend(identity);modes.after(field);}
        if(hint)options.append(hint);if(previewChoice)options.append(previewChoice);if(field)field.after(options);
        const caption=field&&q(field,'label');if(caption)caption.classList.add('draft-image-caption');
        const actions=make('div','draft-image-settings-actions'),ratio=make('span','draft-tag'),apiTag=make('span','draft-tag','当前绘图 API'),settings=make('button','','设置'),history=make('button','','记录');settings.type=history.type='button';settings.onclick=openImageSettings;history.onclick=openImageHistory;actions.append(ratio,apiTag,settings,history);field?.after(actions);
        const updateRatio=()=>{const config=typeof db!=='undefined'&&db.workshopSettings||{};ratio.textContent=config.provider==='gpt'?(config.gptAspectRatio||'1024×1024'):(config.aspectRatio||'3:4');};
        const refreshIdentity=()=>{identity.replaceChildren();const chat=typeof db!=='undefined'&&(currentChatType==='private'?db.characters:db.groups).find(c=>c.id===currentChatId);if(chat)identity.append(identityRow(chat,'生成后发送至当前聊天'));};
        new MutationObserver(()=>{refreshIdentity();updateRatio();}).observe(overlay,{attributes:true,attributeFilter:['class']});refreshIdentity();updateRatio();
    }
    function statusWorkspace(token){
        const overlay=token.closest('#char-status-overlay'),content=overlay&&q(overlay,'#char-status-content');if(!overlay||!content)return;
        overlay.classList.add('draft-status-workspace');
        let nav=q(overlay,':scope > .draft-status-nav');
        if(!nav){nav=make('header','draft-status-nav');const back=make('button','draft-status-back');back.type='button';back.setAttribute('aria-label','返回聊天');navIcon(back,'chevron-left');back.onclick=()=>q(overlay,'#close-status-panel-btn')?.click();nav.append(back,make('strong','','角色状态'));overlay.prepend(nav);}
        let identity=q(content,':scope > .draft-status-identity');if(!identity&&typeof db!=='undefined'){const chat=db.characters.find(c=>c.id===currentChatId);if(chat){identity=identityRow(chat);identity.classList.add('draft-status-identity');content.prepend(identity);}}
        const flip=q(content,'.status-flip-card');const update=()=>{nav.querySelector('strong').textContent=flip?.classList.contains('is-flipped')?'Token 用量':'角色状态';};
        if(flip&&!flip.dataset.draftObserved){flip.dataset.draftObserved='true';new MutationObserver(update).observe(flip,{attributes:true,attributeFilter:['class']});}update();
        if(q(token,':scope > .draft-token-breakdown'))return;
        const heading=q(token,'.status-token-heading'),summary=q(token,'.status-token-summary'),list=q(token,'.status-token-list');if(!heading||!summary||!list)return;
        // The original renderer owns all counts. This is only a reading layout for its existing rows.
        const breakdown=make('details','draft-token-breakdown');breakdown.append(make('summary','','查看本轮组成'));
        const context=q(token,'.status-token-context'),note=q(token,'.status-token-note'),floor=q(summary,':scope > span');
        for(const node of [floor,context,note])if(node)breakdown.append(node);
        const source=q(heading,'span');if(source){source.classList.add('draft-tag');token.prepend(source);}heading.hidden=true;
        const bar=make('div','draft-token-bar');bar.setAttribute('aria-label','本地分类估算占比');bar.setAttribute('role','img');
        const values=[];
        for(const row of [...list.querySelectorAll(':scope > .status-token-row')]){
            const name=q(row,'span'),amount=q(row,'b');if(!name||!amount)continue;
            const original=name.textContent,value=Number(amount.textContent.replace(/,/g,''));
            if(!original.includes('（估算）')){breakdown.append(row);continue;}
            name.textContent=original.replace('（估算）','').replace('提示词 / 系统基础','系统提示词');name.title=original;
            if(Number.isFinite(value)&&value>0)values.push([name.textContent,value]);
        }
        const sum=values.reduce((total,item)=>total+item[1],0);
        for(const [name,value]of values){const piece=make('span');piece.style.flex=String(value);piece.title=name+' · '+value.toLocaleString();bar.append(piece);}
        bar.setAttribute('aria-label','本地分类估算，共 '+sum.toLocaleString()+' token');summary.after(bar);token.append(breakdown);
    }
    function openAppearanceWorkspace() {
        const d=createMessageForwardDialog('二改界面','draft-appearance-workspace');d.panel.classList.add('derived-settings');
        const body=make('div','derived-body'),footer=make('footer'),state=readAppearance(),status=make('p','panel-operation-status');status.setAttribute('role','status');
        const colorLabel=make('label','draft-appearance-color','配色'),color=make('select');color.setAttribute('aria-label','二改面板配色');color.append(new Option('跟随主题','theme'),new Option('白色','white'));color.value=state.color;colorLabel.append(color);
        body.append(make('p','draft-notice','仅作用于二改新增面板。'),make('h3','','配色'),colorLabel);segment(color,{});
        const settings=make('section','draft-card'),preview=make('section','draft-card draft-appearance-preview');
        const toggle=(text,value)=>{const row=make('label'),input=make('input');input.type='checkbox';input.checked=value;input.setAttribute('aria-label',text);row.append(make('span','',text),input);settings.append(row);asSwitch(input);return input;};
        const motion=toggle('轻动效',state.motion),reduce=toggle('减少动态效果',state.reduce),sizeLabel=make('label','draft-appearance-size','正文大小'),size=make('select');size.setAttribute('aria-label','二改面板正文大小');for(const n of [12,14,16])size.append(new Option(n+' px',String(n)));size.value=String(state.size);sizeLabel.append(size);settings.append(sizeLabel);
        preview.append(make('strong','','示例设置'),make('p','','统一间距，保留必要信息。'));
        const previewActions=make('div','draft-columns'),cancel=make('button','','取消'),sample=make('button','panel-primary','保存');cancel.type=sample.type='button';cancel.disabled=sample.disabled=true;previewActions.append(cancel,sample);preview.append(previewActions);
        const refresh=()=>{preview.style.setProperty('--draft-body-size',size.value+'px');preview.style.fontSize=size.value+'px';motion.disabled=reduce.checked;};
        size.onchange=reduce.onchange=refresh;refresh();
        const persist=value=>{try{localStorage.setItem(appearanceKey,JSON.stringify(value));applyAppearance(value);status.textContent='已保存';return true;}catch{status.textContent='无法保存到此设备，请检查浏览器存储权限。';return false;}};
        const reset=make('button','draft-appearance-reset','恢复二改默认外观');reset.type='button';reset.onclick=()=>{if(!persist({...appearanceDefaults}))return;color.value=appearanceDefaults.color;color.dispatchEvent(new Event('change'));motion.checked=true;reduce.checked=false;size.value='14';refresh();};
        const save=make('button','panel-primary','保存外观');save.type='button';save.onclick=()=>persist({color:color.value,motion:motion.checked,reduce:reduce.checked,size:Number(size.value)});
        body.append(make('h3','','显示'),settings,make('h3','','布局预览'),preview,reset,status);footer.append(save);d.panel.append(body,footer);
    }
    function openDraftHub() {
        const d = createMessageForwardDialog('二改功能', 'uvu-feature-workspace'); d.panel.classList.add('derived-settings');
        const body = make('div', 'derived-body'), search = make('input'); search.type = 'search'; search.placeholder = '搜索功能'; search.setAttribute('aria-label', '搜索二改功能'); body.append(search); d.panel.append(body);
        const click = id => { const control = document.getElementById(id); if (control) control.click(); };
        const voice=()=>{switchScreen('api-settings-screen');q(document.getElementById('minimax-tts-settings'),'.draft-voice-launchers button')?.click();};
        const notify=()=>{const root=document.getElementById('uvu-notification-preferences');switchScreen('api-settings-screen');if(root)root.open=true;};
        const groups = [
            [['酒馆互通','link',()=>switchScreen('uvu-story-bridge-screen')],['文件分享','file-text',()=>openSharedDocumentDialog()],['AI 生图','wand-sparkles',()=>{click('photo-video-btn');click('pv-mode-ai');}]],
            [['自动记忆','book-open',()=>click('auto-memory-settings-btn')],['向量记忆','search',()=>click('vector-memory-settings-btn')],['MCP 服务','shield-check',()=>openMcpSettings()]],
            [['语音与导演','play',voice],['通知','settings-2',notify],['备份与恢复','download',openBackupWorkspace]]
        ];
        const addRoute=(section,name,icon,action)=>{const route=routeButton(name,()=>{d.dismiss();try{action();}catch(error){showToast(error.message);}});route.dataset.searchText=name;
            const svg=window.UvULucide?.[icon];if(svg){const mark=make('span','draft-hub-icon');mark.innerHTML=svg;route.prepend(mark);}section.append(route);return route;};
        for(const entries of groups){const section=make('section','draft-card draft-hub-group');for(const [name,icon,action]of entries)addRoute(section,name,icon,action);body.append(section);}
        const appearance=addRoute(body,'二改界面设置','settings-2',openAppearanceWorkspace);appearance.classList.add('draft-hub-appearance');
        const more=make('details','draft-hub-more'),other=make('section','draft-card draft-hub-group');more.append(make('summary','','更多功能'),other);body.append(more);
        for(const [name,icon,action]of [
            ['记忆','book-open',()=>openMemoryLibrary()],['自主头像','smile',()=>openCharacterAvatarSettings()],['日历','settings-2',()=>openEnvironmentCalendar()],['环境信息','map-pin',()=>openEnvironmentSettings(true)],
            ['动态互动','smile',()=>{const chat=db.characters.find(c=>c.id===currentChatId);if(chat)window.UvUMomentsUI.settings(chat);}],['关系设置','link',()=>openRelationshipDialog()],['表情包描述','smile',()=>openStickerDescriptionEditor()],
            ['导出角色卡','file-text',()=>{const chat=db.characters.find(c=>c.id===currentChatId);if(chat&&currentChatType==='private')window.UvUCharacterCardUI.open(chat);}],
            ['主页预设','settings-2',()=>{switchScreen('customize-screen');q(document.querySelector('.home-preset-card'),':scope > button')?.click();}],['资源诊断','shield-check',()=>window.UvUResourceHealth.open()]
        ])addRoute(other,name,icon,action);
        search.oninput = () => { const term=search.value.trim().toLocaleLowerCase();body.querySelectorAll('[data-search-text]').forEach(el=>el.hidden=!el.dataset.searchText.toLocaleLowerCase().includes(term));body.querySelectorAll('.draft-hub-group').forEach(group=>group.hidden=[...group.querySelectorAll('[data-search-text]')].every(el=>el.hidden));more.hidden=other.hidden;if(term&&!other.hidden)more.open=true; };
    }
    function hubEntry() {
        document.querySelectorAll('.derived-entry-group:not([data-draft-hub])').forEach(group => { group.dataset.draftHub = 'true'; const row = make('div', 'kkt-item'), title = make('div', 'kkt-item-label', '二改功能'), open = make('button', 'derived-compact', '打开'); open.type = 'button'; open.onclick = openDraftHub; row.append(title, open); group.prepend(row); });
    }
    function start() {
        applyAppearance(readAppearance());
        document.querySelectorAll(allRoots).forEach(decorate);
        imageWorkspace();
        presetWorkspace();
        hubEntry();
        const pending = new Set(); let queued = false;
        const observer = new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType !== 1 || node.closest('svg')) continue;
                const owner = node.closest(allRoots); if (owner) pending.add(owner);
                node.querySelectorAll(allRoots).forEach(el => pending.add(el));
            }
            hubEntry();
            if (!pending.size || queued) return; queued = true;
            queueMicrotask(() => { queued = false; const batch = [...pending]; pending.clear(); batch.forEach(decorate); hubEntry(); });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    window.UvUPanelLayout = Object.freeze({ decorate, open: openDraftHub, appearance: openAppearanceWorkspace });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
