/* Presentation only for second-edition panels. Existing controls own their data and actions. */
(function () {
    'use strict';
    const roots = '.shared-document-dialog,.memory-library > .feature-dialog-card,.mcp-settings,.derived-settings,.relationship-dialog,.text-editor-card,.model-picker-card,.sticker-description-card,.regenerate-guidance-card,.resource-health,.status-token-panel,#auto-memory-modal,#uvu-story-bridge-screen,#minimax-tts-settings,#uvu-notification-preferences';
    const monochromeRoots = '.cc-export-dialog,.ms-dialog,.uvu-calendar,.calendar-editor,.worldbook-advanced,.relationship-settings,.storage-backup-extras,.storage-backup-modes,.storage-export-format,.pv-send-modes,#pv-generated-preview,#home-preset-preview > .feature-dialog-card,.kkt-item:has(> .kkt-item-control > #setting-char-tts-voice-id)';
    const allRoots = roots + ',' + monochromeRoots;
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
                const routes = make('div', 'mono-route-list'); services.after(routes);
                root.monoNavigate = subviews(root, body, [
                    { id: 'main', title: 'MCP 服务', nodes: [q(body, '.panel-mcp-global'), services, routes] },
                    { id: 'tools', title: '工具授权', nodes: [tools] },
                    { id: 'roles', title: '角色可用服务', nodes: [roles] },
                    { id: 'options', title: '服务设置', nodes: [settings] }
                ]);
                for (const [id, title] of [['tools', '工具与权限'], ['roles', '角色可用服务'], ['options', '使用记录与设置']]) routes.append(routeButton(title, () => root.monoNavigate(id)));
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
            if (root.classList.contains('ms-dialog') && q(root, '.ms-dialog-head strong')?.textContent === '动态互动') {
                const toggles = [...root.querySelectorAll('.ms-dialog-body > .ms-check')];
                toggles.forEach(row => asSwitch(q(row, 'input')));
                group(toggles, '', 'mono-social-switches');
            }
            if (root.classList.contains('mcp-settings')) {
                const toggle = q(root, '.panel-mcp-global label');
                if (toggle) { const caption = q(toggle, 'span'); if (caption) caption.textContent = '启用 MCP'; }
            }
            root.addEventListener('invalid', event => {
                let parent = event.target.parentElement;
                while (parent && parent !== root) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
            }, true);
        }
        libraryRows(root); extra(root); actions(root);
        pageLayout(root);
        mcpServiceRows(root);
        if (root.id === 'uvu-story-bridge-screen') reviewLayout(root);
    }
    function reviewLayout(root) {
        root.querySelectorAll('.uvu-bridge-review-floor').forEach(floor => {
            if (floor.dataset.monoReview) return; floor.dataset.monoReview = 'true';
            const title = q(floor, ':scope > summary'); if (!title) return;
            const original = title.textContent, match = original.match(/^(第 \d+ 层|原文记录)(?: · ([^·]+))? · ([\s\S]*)$/);
            if (match) {
                title.textContent = match[1] + (match[2] ? ' · ' + match[2].trim() : '');
                title.setAttribute('aria-label', original);
                const excerpt = make('p', 'mono-story-excerpt', match[3]); floor.after(excerpt);
                floor.addEventListener('input', event => { if (event.target.matches('textarea')) excerpt.textContent = event.target.value; });
                const note = q(floor, ':scope > .uvu-bridge-review-help');
                if (note?.textContent.startsWith('正文标签：') && !/未知标签：[^无]/.test(note.textContent)) note.classList.add('mono-known-tag');
            }
        });
        root.querySelectorAll('.uvu-bridge-summary-options').forEach(options => {
            if (options.dataset.monoSummary) return; options.dataset.monoSummary = 'true';
            const fields = [...options.children].filter(el => el.tagName === 'LABEL');
            disclose(fields, '总结设置', 'mono-story-summary-settings');
            const primary = q(options, '.uvu-bridge-actions > button'); if (primary) primary.classList.add('panel-primary');
        });
    }
    function routeButton(text, action) {
        const button = make('button', 'mono-route', text); button.type = 'button';
        const arrow = make('span', 'mono-route-arrow', '›'); arrow.setAttribute('aria-hidden', 'true'); button.append(arrow);
        button.addEventListener('click', action); return button;
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
        const management = disclose([row], '管理当前服务', 'mono-service-management');
        management.append(...[...services.children].filter(el => el !== head && el !== management && !el.matches('label,.mcp-service-search,.mcp-service-list')));
        const search = q(services, '.mcp-service-search'); if (search && !q(services, '.mcp-service-list').querySelector('.mcp-service-item')) search.hidden = true;
    }
    function tavernPage(root) {
        const head = q(root, '.app-header'), oldTitle = q(head, '.title-container'), close = q(head, '.back-btn'), body = q(root, '.uvu-bridge-page');
        root.classList.add('mono-bridge-page'); head.classList.add('mono-page-nav');
        close.classList.add('mono-nav-close'); close.setAttribute('aria-label', '返回主屏幕'); navIcon(close, 'm6 6 12 12M18 6 6 18');
        oldTitle.remove(); q(head, '.placeholder')?.remove();
        const back = make('button', 'mono-nav-back'); back.type = 'button'; back.setAttribute('aria-label', '返回'); navIcon(back, 'm14 6-6 6 6 6');
        back.addEventListener('click', () => close.click()); head.prepend(back, make('span', 'mono-nav-brand', 'UvU'));
        const heading = make('div', 'mono-page-heading'); heading.append(make('h2', 'mono-page-title', '酒馆')); head.after(heading);
        const connection = q(body, '.kkt-settings-container'), handoff = q(body, '.uvu-bridge-handoff'), review = q(body, '.uvu-bridge-review'), guide = q(body, '.uvu-bridge-guide');
        const channel = q(connection, '.panel-segment'); connection.before(channel);
        const intro = q(connection, '.panel-bridge-intro'); if (intro) guide.append(intro);
        const connectionItem = q(connection, '#uvu-story-bridge-settings > .kkt-item'), config = q(connection, '.panel-bridge-config');
        const url = q(connection, '#uvu-bridge-url').closest('label'); config.before(url);
        const onlineControls = q(config, '#uvu-bridge-online-controls');
        const syncAddress = () => { url.hidden = onlineControls.hidden || onlineControls.style.display === 'none'; };
        new MutationObserver(syncAddress).observe(onlineControls, { attributes: true, attributeFilter: ['hidden', 'style'] }); syncAddress();
        const diagnostics = q(connection, '#uvu-bridge-diagnostics'); if (diagnostics) config.append(diagnostics);
        config.open = false; q(config, 'summary').textContent = '配对与设备';
        const connectionActions = q(config, '#uvu-bridge-online-actions'); config.append(connectionActions);
        const serviceTitle = q(connectionItem, '.kkt-item-title'); if (serviceTitle) serviceTitle.hidden = true;
        const state = q(root, '#uvu-bridge-status'); root.append(state); state.classList.add('mono-bridge-status');
        const binding = make('section', 'mono-binding-settings'), roleRow = q(handoff, '.panel-bridge-role'); binding.append(roleRow);
        const identity = make('section', 'mono-bridge-identity'), identityName = make('strong'), source = make('small'); identity.append(make('h3', '', '当前角色'), identityName, source);
        const links = make('div', 'mono-route-list'), footer = make('footer', 'mono-bridge-footer'); root.append(footer);
        const navigate = subviews(root, body, [
            { id: 'main', title: '酒馆', nodes: [channel, connection, identity, links] },
            { id: 'binding', title: '角色与存档', nodes: [binding] },
            { id: 'online', title: '线上存档', nodes: [handoff] },
            { id: 'review', title: '剧情审核', nodes: [review] },
            { id: 'guide', title: '使用教程', nodes: [guide] }
        ]);
        root.monoNavigate = navigate;
        links.append(routeButton('角色与存档', () => navigate('binding')), routeButton('剧情审核', () => navigate('review')), routeButton('使用教程', () => navigate('guide')));
        const reviewEntry = links.children[1], badge = make('span', 'mono-review-badge'); reviewEntry.insertBefore(badge, reviewEntry.lastChild);
        const refresh = () => {
            const select = q(root, '#uvu-bridge-handoff-character'); identityName.textContent = select.selectedOptions[0]?.textContent || '尚未选择角色';
            const text = q(root, '#uvu-bridge-handoff-source > summary')?.textContent || ''; if (source.textContent !== text) source.textContent = text;
            const count = q(root, '#uvu-bridge-review-count').textContent; if (badge.textContent !== count) badge.textContent = count;
        };
        q(root, '#uvu-bridge-handoff-character').addEventListener('change', refresh);
        for (const node of [q(root, '#uvu-bridge-handoff-source'), q(root, '#uvu-bridge-review-count')]) new MutationObserver(refresh).observe(node, { childList: true, characterData: true, subtree: true }); refresh();
        const openOnline = make('button', 'panel-primary panel-compact-action', '交接线上消息'); openOnline.type = 'button'; openOnline.addEventListener('click', () => navigate('online')); footer.append(openOnline);
        const save = q(root, '#uvu-bridge-save-character'), send = q(root, '#uvu-bridge-handoff'), exportFile = q(root, '#uvu-bridge-export-file');
        footer.append(save, send, exportFile); save.classList.add('panel-primary');
        const footerState = () => {
            const view = root.dataset.monoView;
            openOnline.hidden = view !== 'main'; save.hidden = view !== 'binding';
            // Transport continues to own the real send/export visibility.
            send.classList.toggle('mono-route-hidden', view !== 'online'); exportFile.classList.toggle('mono-route-hidden', view !== 'online');
            footer.hidden = !['main', 'binding', 'online'].includes(view);
        };
        root.addEventListener('mono-view-change', footerState); footerState();
        // The review entry is always visible on the dashboard; data collection and
        // review controls retain their original transport and identity checks.
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
    function navIcon(button, path) {
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
    }
    function pageLayout(root) {
        // A draft page has navigation, a separate large title, a reading area and
        // a fixed action bar. A recoloured legacy dialog is not that layout.
        if (root.dataset.monoPage || !root.matches('.shared-document-dialog,.mcp-settings,.derived-settings,.calendar-editor,.ms-dialog,.cc-export-dialog,.memory-library > .feature-dialog-card,#auto-memory-modal')) return;
        const panel = root.id === 'auto-memory-modal' ? q(root, '.auto-memory-dialog') : root;
        const head = q(panel, ':scope > .message-forward-header,:scope > .ms-dialog-head,:scope > .cc-head,:scope > .auto-memory-heading,:scope > header');
        const title = head && q(head, 'strong,h2');
        const close = head && q(head, '.message-forward-close,.cc-close,#auto-memory-close,[data-action=close]');
        if (!title || !close) return;
        root.dataset.monoPage = 'true'; panel.classList.add('mono-page');
        const overlay = root.id === 'auto-memory-modal' ? root : root.parentElement;
        overlay.classList.add('mono-page-overlay');
        head.classList.add('mono-page-nav');
        const heading = make('div', 'mono-page-heading'); head.after(heading); heading.append(title);
        title.classList.add('mono-page-title');
        if (root.monoNavigate) root.monoNavigate('main', false);
        const back = make('button', 'mono-nav-back'); back.type = 'button'; back.setAttribute('aria-label', '返回');
        navIcon(back, 'm14 6-6 6 6 6'); back.addEventListener('click', () => { if (!close.disabled) close.click(); });
        const brand = make('span', 'mono-nav-brand', 'UvU');
        if (!close.hasAttribute('aria-label')) close.setAttribute('aria-label', close.textContent.trim() || '关闭');
        close.classList.add('mono-nav-close'); navIcon(close, 'm6 6 12 12M18 6 6 18');
        head.prepend(back, brand);
        if (root.matches('.memory-library > .feature-dialog-card')) {
            const add = q(head, '[data-action=add]'); if (add) heading.append(add);
            const content = make('div', 'mono-memory-body');
            const nodes = [...panel.children].filter(el => el !== head && el !== heading);
            panel.append(content); content.append(...nodes);
        }
        const help = q(head, '.shared-document-info'); if (help) { help.classList.add('mono-nav-help'); head.append(help, close); }
        if (root.classList.contains('shared-document-dialog')) {
            const context = q(root, '.shared-document-context'); if (context) heading.append(context);
            filePage(root);
        }
        if (root.classList.contains('cc-export-dialog')) {
            const format = q(head, '.cc-format'); if (format) format.hidden = true;
            const body = q(root, '.cc-body'), author = q(body, ':scope > .cc-field');
            if (author) { const settings = make('section', 'mono-export-settings'); author.before(settings); settings.append(author, q(body, '.cc-persona'), q(body, '.cc-cover-fields')); }
            const preview = q(root, '.mono-cover-preview'), footer = q(root, '.cc-foot');
            if (preview && footer) {
                const show = make('button', 'mono-preview-action', '预览 ID Card'); show.type = 'button'; show.setAttribute('aria-expanded', 'false');
                show.addEventListener('click', () => { preview.open = !preview.open; if (preview.open) preview.scrollIntoView({ block: 'nearest' }); });
                preview.addEventListener('toggle', () => show.setAttribute('aria-expanded', String(preview.open))); footer.prepend(show);
            }
        }
        if (root.classList.contains('ms-dialog') && q(root, '.mono-social-switches')) {
            const body = q(root, '.ms-dialog-body'), npcs = q(body, '.ms-npcs');
            const facts = [...body.children].find(el => el.matches('label.ms-field'));
            const limits = q(body, '.ms-pair');
            if (npcs) q(body, '.mono-social-switches').after(npcs);
            if (facts || limits) group([facts, limits], '互动设置', 'mono-social-options');
        }
    }
    function filePage(root) {
        const editor = q(root, '.shared-document-editor'), text = q(editor, 'textarea');
        if (!editor || !text || text.readOnly) return;
        root.classList.add('mono-file-compose');
        const excerpt = make('p', 'mono-file-excerpt'), tools = make('div', 'mono-file-shortcuts');
        const show = make('button', '', '预览'), edit = make('button', '', '编辑');
        show.type = edit.type = 'button';
        show.setAttribute('aria-expanded', 'false'); edit.setAttribute('aria-expanded', 'false');
        const render = () => { if (excerpt.textContent !== text.value) excerpt.textContent = text.value; };
        const open = () => {
            root.classList.remove('mono-file-preview-open');
            show.setAttribute('aria-expanded', 'false');
            root.classList.toggle('mono-file-open');
            const expanded = root.classList.contains('mono-file-open');
            edit.setAttribute('aria-expanded', String(expanded));
            if (expanded) text.focus({ preventScroll: true });
        };
        show.addEventListener('click', () => {
            root.classList.remove('mono-file-open'); edit.setAttribute('aria-expanded', 'false');
            const expanded = root.classList.toggle('mono-file-preview-open'); show.setAttribute('aria-expanded', String(expanded));
        }); edit.addEventListener('click', open);
        tools.append(show, edit); q(editor, '.shared-document-file-header').after(excerpt, tools);
        text.addEventListener('input', render);
        new MutationObserver(render).observe(q(root, '.shared-document-status'), { childList: true, characterData: true, subtree: true }); render();
        const encoding = q(editor, 'select'); if (encoding) q(root, '.shared-document-file-options').append(encoding);
    }
    function start() {
        document.querySelectorAll(allRoots).forEach(decorate);
        const pending = new Set(); let queued = false;
        const observer = new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType !== 1 || node.closest('svg')) continue;
                const owner = node.closest(allRoots); if (owner) pending.add(owner);
                node.querySelectorAll(allRoots).forEach(el => pending.add(el));
            }
            if (!pending.size || queued) return; queued = true;
            queueMicrotask(() => { queued = false; const batch = [...pending]; pending.clear(); batch.forEach(decorate); });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    window.UvUPanelLayout = Object.freeze({ decorate });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
