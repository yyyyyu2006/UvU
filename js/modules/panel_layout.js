/* Presentation only for second-edition panels. Existing controls own their data and actions. */
(function () {
    'use strict';
    const roots = '.shared-document-dialog,.memory-library > .feature-dialog-card,.mcp-settings,.derived-settings,.relationship-dialog,.text-editor-card,.model-picker-card,.sticker-description-card,.regenerate-guidance-card,.resource-health,.status-token-panel,#auto-memory-modal,#uvu-story-bridge-screen,#minimax-tts-settings,#uvu-notification-preferences';
    const initialized = new WeakSet();
    const q = (root, selector) => root.querySelector(selector);
    const make = (tag, className, text) => {
        const el = document.createElement(tag); if (className) el.className = className;
        if (text !== undefined) el.textContent = text; return el;
    };
    function label(control, text) {
        if (!control || control.dataset.panelShortLabel) return;
        const original = control.textContent.trim();
        if (original && original !== text) control.setAttribute('aria-label', original);
        [...control.childNodes].filter(n => n.nodeType === 3).forEach(n => n.remove());
        control.append(document.createTextNode(text)); control.dataset.panelShortLabel = 'true';
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
        choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '互通通道');
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
            const sync = () => { apiVisible(); rerankVisible(); };
            new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] }); sync();
        }
    }
    function library(root) {
        const toolbar = q(root, '.memory-library-toolbar'), header = q(root, 'header');
        if (!toolbar || !header) return;
        const add = q(toolbar, '[data-action=add]'); if (add) { add.classList.add('panel-primary'); header.insertBefore(add, header.lastElementChild); }
        const filter = q(root, '.memory-library-filters input[type=search]')?.closest('label');
        if (filter) { filter.classList.add('panel-library-search'); toolbar.before(filter); [...filter.childNodes].filter(n => n.nodeType === 3).forEach(n => n.remove()); q(filter, 'input').setAttribute('aria-label', '搜索记忆'); q(filter, 'input').placeholder = '搜索记忆'; }
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
    }
    function voice(root) {
        const connection = q(root, '.minimax-settings-section'), playback = q(root, '.minimax-settings-section:nth-of-type(2)');
        const director = q(root, '.minimax-director-settings'); if (!connection || !playback || !director) return;
        const connectionDetails = disclose([connection], '语音连接', 'panel-voice-connection');
        director.after(connectionDetails); connectionDetails.open = !q(root, '#minimax-tts-key').value;
        const sync = () => { if (!q(root, '#minimax-tts-key').value.trim()) connectionDetails.open = true; };
        q(root, '#minimax-tts-preview').addEventListener('click', sync);
        asSwitch(q(root, '#minimax-director-enabled'));
        const fields = q(root, '#minimax-director-fields');
        const api = ['provider', 'endpoint', 'key', 'model'].map(id => q(root, '#minimax-director-' + id)?.closest('label'));
        disclose(api, '导演 API', 'panel-director-api');
        const rules = [q(root, '#minimax-director-context')?.closest('.minimax-tts-field-row'), q(root, '#minimax-director-prompt')?.closest('label')];
        const rulesDetails = disclose(rules, '导演要求', 'panel-director-rules');
        const preset = q(fields, 'select:not(#minimax-director-provider)'); if (preset && rulesDetails) rulesDetails.prepend(preset.closest('label'));
        const tags = make('div', 'panel-director-tags'); ['情绪', '语速', '停顿'].forEach(text => tags.append(make('span', '', text))); fields.prepend(tags);
        const notes = [...fields.querySelectorAll(':scope > .kkt-item-subtitle')]; disclose(notes, '用量与回退', 'panel-director-help');
        if (rulesDetails) { const notice = make('p', 'panel-save-note', '保存后生效'); rulesDetails.append(notice); }
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
        const body = q(root, '.mcp-body'); if (!body) return;
        const global = q(body, ':scope > label.mcp-check input'); asSwitch(global);
        if (global) group([global.closest('label')], '', 'panel-mcp-global');
        const planner = [...body.querySelectorAll(':scope > details')].find(el => /独立工具判断/.test(el.firstElementChild?.textContent));
        if (planner) q(planner, 'summary').textContent = '自动调用配置';
        const logs = [...body.querySelectorAll(':scope > details')].find(el => /最近调用与用量/.test(el.firstElementChild?.textContent));
        if (logs) q(logs, 'summary').textContent = '调用记录';
        const options = [...body.querySelectorAll(':scope > details')];
        const transfers = q(body, ':scope > .mcp-row');
        // Keep the existing disclosure nodes and callbacks together, including live permissions.
        const settings = group([...options.filter(el => !el.classList.contains('mcp-tutorial')), transfers, q(body, ':scope > .mcp-tutorial')], '', 'panel-mcp-options');
        settings?.querySelectorAll(':scope > details').forEach(el => el.classList.add('panel-disclosure'));
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
            const sections = [...root.querySelectorAll('.relationship-section')];
            const autonomy = sections.find(el => /允许角色自主|角色自主/.test(q(el, 'strong')?.textContent));
            const recovery = sections.find(el => q(el, '#relationship-recovery-mode')); if (autonomy && recovery && autonomy.nextElementSibling !== recovery) recovery.before(autonomy);
        }
        if (root.id === 'uvu-notification-preferences' && !root.dataset.panelPreferences) {
            root.dataset.panelPreferences = 'true'; root.classList.add('panel-preferences');
            label(q(root, ':scope > summary'), '通知偏好');
            disclose([...root.querySelectorAll(':scope > p')].slice(0, 2), '权限与能力', 'panel-notification-help');
            const toggles = [...root.querySelectorAll(':scope > label > input[type=checkbox]')];
            ['避免重复通知', '静音时段', '此聊天免打扰'].forEach((text, i) => {
                const input = toggles[i]; if (input) { label(input.closest('label'), text); asSwitch(input); }
            });
        }
        root.querySelectorAll('input[type=checkbox]').forEach(input => {
            if (input.closest('.sticker-description-toggle') || input.id === 'relationship-autonomy-enabled') asSwitch(input);
        });
        if (root.classList.contains('derived-settings') && q(root, '.avatar-candidate-preview')) {
            const form = q(root, '.derived-body');
            const notes = [...form.querySelectorAll(':scope > .derived-help')]; disclose(notes, '判断与用量', 'panel-avatar-help');
            const candidates = q(root, '.avatar-candidate-preview'); if (!candidates.dataset.panelOpened) { candidates.dataset.panelOpened = 'true'; candidates.open = true; }
        }
    }
    function decorate(root) {
        if (!root.isConnected) return;
        if (!initialized.has(root)) {
            initialized.add(root); root.classList.add('uvu-panel-layout');
            if (root.id === 'auto-memory-modal') summary(root);
            else if (root.id === 'uvu-story-bridge-screen') tavern(root);
            else if (root.id === 'minimax-tts-settings') voice(root);
            else if (root.matches('.memory-library > .feature-dialog-card')) library(root);
            else if (root.classList.contains('text-editor-card')) editor(root);
            else if (root.classList.contains('mcp-settings')) mcp(root);
            else if (root.classList.contains('derived-settings')) environment(root);
            root.addEventListener('invalid', event => {
                let parent = event.target.parentElement;
                while (parent && parent !== root) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
            }, true);
        }
        libraryRows(root); extra(root); actions(root);
    }
    function start() {
        document.querySelectorAll(roots).forEach(decorate);
        const pending = new Set(); let queued = false;
        const observer = new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType !== 1 || node.closest('svg')) continue;
                const owner = node.closest(roots); if (owner) pending.add(owner);
                node.querySelectorAll(roots).forEach(el => pending.add(el));
            }
            if (!pending.size || queued) return; queued = true;
            queueMicrotask(() => { queued = false; const batch = [...pending]; pending.clear(); batch.forEach(decorate); });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    window.UvUPanelLayout = Object.freeze({ decorate });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
