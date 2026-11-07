(function () {
    'use strict';
    const m = () => window.MCPServices;
    function node(tag, value, className) { const el = document.createElement(tag); if (value !== undefined) el.textContent = value; if (className) el.className = className; return el; }
    function button(label, action) { const el = node('button', label); el.type = 'button'; el.onclick = action; return el; }
    function field(parent, label, tag = 'input', type = 'text', value = '') {
        const wrap = node('label', label), input = node(tag); if (tag === 'input') input.type = type; input.setAttribute('aria-label', label); input.value = value; wrap.append(input); parent.append(wrap); return input;
    }
    function check(parent, label, value) { const wrap = node('label', undefined, 'mcp-check'), input = node('input'); input.type = 'checkbox'; input.checked = !!value; wrap.append(input, node('span', label)); parent.append(wrap); return input; }
    function select(parent, label, items, value) { const el = field(parent, label, 'select'); items.forEach(([title, id]) => el.append(new Option(title, id))); el.value = value; return el; }
    function dialog(title, id, onClose) {
        const controller = new AbortController();
        const d = createMessageForwardDialog(title, id, () => { controller.abort(); onClose?.(); }); d.panel.classList.add('mcp-settings');
        const body = node('div', undefined, 'mcp-body'), status = node('p', '', 'mcp-status'); status.setAttribute('aria-live', 'polite');
        const cancel = button('停止请求', () => active?.abort()); cancel.disabled = true;
        const footer = node('div', undefined, 'mcp-actions'); footer.append(status, cancel); d.panel.append(body, footer);
        let active;
        async function run(action) {
            if (active || controller.signal.aborted) return;
            active = new AbortController(); const current = active, stop = () => current.abort(); controller.signal.addEventListener('abort', stop, { once: true });
            const controls = [...body.querySelectorAll('button,input,select,textarea')].map(el => [el, el.disabled]); controls.forEach(([el]) => el.disabled = true); cancel.disabled = false;
            d.panel.setAttribute('aria-busy', 'true');
            try { await action(current.signal); }
            catch (error) { if (!controller.signal.aborted) status.textContent = current.signal.aborted ? '已停止等待；工具可能已执行，写入操作请先核实结果' : error.message; }
            finally { controls.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; }); cancel.disabled = true; active = null; controller.signal.removeEventListener('abort', stop); d.panel.removeAttribute('aria-busy'); }
        }
        return { ...d, body, status, controller, run };
    }
    function confirm(title, detail, signal) {
        return new Promise(resolve => {
            let accepted = false, stop;
            const d = dialog(title, 'mcp-confirm', () => { signal?.removeEventListener('abort', stop); resolve(accepted); });
            d.body.append(node('p', '请核对本次操作。写入或未知工具可能修改外部数据；取消等待不保证服务端停止执行。'), node('pre', detail));
            stop = () => d.dismiss(); signal?.addEventListener('abort', stop, { once: true });
            d.body.append(button('确认执行', () => { accepted = !signal?.aborted; signal?.removeEventListener('abort', stop); d.dismiss(); }));
            if (signal?.aborted) d.dismiss();
        });
    }
    function download(value, name) { const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob); const a = node('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    function serviceEditor(id, onSaved) {
        const previous = id ? m().service(id) : null, originalStamp = m().stamp();
        const d = dialog(id ? '编辑 MCP 服务' : '添加 MCP 服务', 'mcp-service-editor');
        const name = field(d.body, '名称', 'input', 'text', previous?.name || ''); name.maxLength = 128;
        const url = field(d.body, '服务接口地址', 'input', 'url', previous?.url || ''); url.placeholder = 'https://你的服务/mcp';
        if (!previous) {
            const template = select(d.body, '用途模板（仍需填写真实服务地址）', [['自定义服务', 'custom'], ['天气与日历', 'environment'], ['只读资料检索', 'lookup'], ['外部笔记', 'notes']], 'custom');
            template.onchange = () => {
                if (!name.value.trim()) name.value = {environment:'天气与日历',lookup:'资料检索',notes:'外部笔记'}[template.value] || '';
                d.status.textContent = '模板仅填写用途说明；不会提供虚构地址、自动授权或自动执行工具。请向服务提供者取得接口地址。';
            };
        }
        const protocol = select(d.body, '协议' , [['自动识别（推荐）', 'auto'], ['2026-07-28', '2026-07-28'], ['2025-11-25', '2025-11-25'], ['2025-06-18', '2025-06-18'], ['2025-03-26', '2025-03-26']], previous?.protocol || 'auto');
        const auth = select(d.body, '认证', [['无需令牌', 'none'], ['Bearer 令牌', 'bearer'], ['OAuth 网页授权', 'oauth']], previous?.auth || 'none');
        const token = field(d.body, '令牌（独立存储，不进入 MCP 导出或整机备份）', 'input', 'password', previous ? m().vault.get(previous) : ''); token.autocomplete = 'off';
        const remember = check(d.body, '在此浏览器记住令牌；不勾选仅当前会话保存', previous && m().vault.remembered(previous));
        const oauth = node('section', undefined, 'mcp-oauth-config');
        const clientId = field(oauth, '公开客户端 ID', 'input', 'text', previous?.oauth?.clientId || ''), oauthScope = field(oauth, '授权范围（服务提供者指定）', 'input', 'text', previous?.oauth?.scope || '');
        const callback = node('details'); callback.append(node('summary', '登记回调地址'), node('pre', window.MCPOAuth?.callbackUrl() || 'OAuth 模块尚未加载')); oauth.append(callback); d.body.append(oauth);
        const authFields = () => { oauth.hidden = auth.value !== 'oauth'; token.parentElement.hidden = remember.parentElement.hidden = auth.value !== 'bearer'; };
        let credentialEndpoint = (previous?.url || '') + '|' + auth.value;
        const changedEndpoint = () => {
            const next = url.value.trim() + '|' + auth.value;
            if (credentialEndpoint !== next) { token.value = ''; remember.checked = false; d.status.textContent = '地址或认证已变化，请重新填写凭据，避免把旧令牌发送到其他服务'; credentialEndpoint = next; }
        };
        url.oninput = changedEndpoint; auth.onchange = () => { changedEndpoint(); authFields(); }; authFields();
        const enabled = check(d.body, '启用此服务', previous?.enabled);
        const timeout = field(d.body, '每个请求超时（秒，1–60）', 'input', 'number', String((previous?.timeoutMs || 20000) / 1000)); timeout.min = 1; timeout.max = 60;
        d.body.append(node('p', '地址须由 MCP 服务提供者给出，不是聊天模型 API 地址。更改地址、认证或协议后须重新测试和授权。浏览器存储并非加密保险箱，同源脚本仍可读取凭据。', 'mcp-help'));
        d.body.append(button('保存', () => d.run(async () => {
            if (m().stamp() !== originalStamp) throw new Error('配置已在别处变化，请关闭并重新打开');
            const next = m().settings(), value = { id: previous?.id || crypto.randomUUID(), name: name.value.trim(), url: url.value.trim(), protocol: protocol.value, auth: auth.value,
                enabled: enabled.checked, timeoutMs: Math.round(Number(timeout.value) * 1000), tools: {}, oauth: { clientId: clientId.value.trim(), scope: oauthScope.value.trim() } };
            const normalized = m().normalize({ services: [value] }).services[0];
            const sameEndpoint = previous && previous.url === normalized.url && previous.auth === normalized.auth && previous.protocol === normalized.protocol && JSON.stringify(previous.oauth) === JSON.stringify(normalized.oauth);
            if (sameEndpoint) normalized.tools = previous.tools;
            next.services = next.services.filter(s => s.id !== normalized.id); next.services.push(normalized);
            const oldToken = m().vault.get(normalized), oldRemember = m().vault.remembered(normalized);
            if (normalized.auth !== 'oauth' || !sameEndpoint) m().vault.set(normalized, normalized.auth === 'bearer' ? token.value.trim() : '', remember.checked);
            try { await m().save(next); }
            catch (error) { m().vault.set(normalized, oldToken, oldRemember); throw error; }
            if (previous && !sameEndpoint) { if (previous.auth === 'oauth' && window.MCPOAuth) window.MCPOAuth.disconnect(previous); else if (previous.url !== normalized.url || previous.auth !== normalized.auth) m().vault.clear(previous); }
            onSaved(normalized.id); d.dismiss();
        })));
    }
    function toolCaller(serviceId, tool, target) {
        const svc = m().service(serviceId), scope = target ? m().scope(target.chat, target.type) : null;
        const d = dialog('调用 · ' + tool.name, 'mcp-tool-call');
        d.body.append(node('p', svc.name + ' · ' + new URL(svc.url).host, 'mcp-help'), node('p', tool.description, 'mcp-help'));
        d.body.append(node('p', target ? '结果绑定：' + target.label + ' · 当前存档 ' + String(scope.archive || '默认') : '未选择接收角色：仅查看结果', 'mcp-help'));
        const simple = node('details'); simple.open = true; simple.append(node('summary', '填写参数'));
        const raw = field(d.body, '最终 JSON 参数（可直接编辑；以此处为准）', 'textarea', 'text', '{}'); raw.rows = 5; raw.spellcheck = false;
        d.body.insertBefore(simple, raw.parentElement);
        const validation = node('p', '', 'mcp-help'); validation.setAttribute('role', 'status'); raw.parentElement.after(validation);
        const validateInput = () => {
            try {
                const value = JSON.parse(raw.value);
                if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('参数最外层必须是 JSON 对象');
                if (!tool.validate(value)) throw new Error(window.MCPForms?.explain(tool.inputSchema, value) || '与 Schema 不符：检查必填项、嵌套类型、范围和多余字段');
                raw.setAttribute('aria-invalid', 'false'); validation.textContent = 'JSON 与本工具参数 Schema 校验通过；尚未调用。';
            } catch (error) { raw.setAttribute('aria-invalid', 'true'); validation.textContent = '参数未通过：' + error.message; }
        };
        raw.addEventListener('input', validateInput); validateInput();
        const advanced = node('details'); advanced.append(node('summary', 'JSON 参数')); raw.parentElement.before(advanced); advanced.append(raw.parentElement);
        const properties = tool.inputSchema.properties || {}, required = tool.inputSchema.required || [];
        if (window.MCPForms) window.MCPForms.render(simple, tool.inputSchema, raw, validateInput, d.status);
        else for (const [key, schema] of Object.entries(properties).slice(0, 30)) {
            const title = key + (required.includes(key) ? ' *' : '（可选）'); let input;
            if (Array.isArray(schema.enum)) input = select(simple, title, [['未填写', ''], ...schema.enum.map(v => [String(v), JSON.stringify(v)])], '');
            else if (schema.type === 'boolean') input = select(simple, title, [['未填写', ''], ['是', 'true'], ['否', 'false']], '');
            else input = field(simple, title, ['object', 'array'].includes(schema.type) ? 'textarea' : 'input', ['integer', 'number'].includes(schema.type) ? 'number' : 'text');
            input.oninput = () => {
                let value; try { value = JSON.parse(raw.value); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); } catch (_) { d.status.textContent = '请先修正最终 JSON 参数'; return; }
                if (input.value === '' && !required.includes(key)) delete value[key];
                else {
                    try { value[key] = Array.isArray(schema.enum) || ['boolean', 'object', 'array'].includes(schema.type) ? JSON.parse(input.value) : ['integer', 'number'].includes(schema.type) ? Number(input.value) : input.value; }
                    catch (_) { d.status.textContent = key + ' 需要有效 JSON'; return; }
                }
                raw.value = JSON.stringify(value, null, 2); validateInput();
            };
            if (schema.description) simple.append(node('p', String(schema.description).slice(0, 500), 'mcp-help'));
        }
        if (!Object.keys(properties).length) simple.append(node('p', '无简单字段；可在 JSON 中填写嵌套参数。', 'mcp-help'));
        if (window.MCPForms && /"(latitude|longitude|lat|lon|lng|countryCode|country_code|timezone|timeZone)"/.test(JSON.stringify(tool.inputSchema.properties || {}))) {
            const fill = node('div', undefined, 'mcp-row');
            const populate = actor => {
                try {
                    if (scope && !m().valid(scope)) throw new Error('角色或存档已切换，请重新打开');
                    const location = actor === 'user' ? (typeof getEnvironmentSettings === 'function' ? getEnvironmentSettings().userLocation : null) : (typeof getChatEnvironmentProfile === 'function' ? getChatEnvironmentProfile(target?.chat).charLocation : null);
                    raw.value = JSON.stringify(window.MCPForms.environmentArguments(tool.inputSchema, JSON.parse(raw.value), location), null, 2);
                    raw.dispatchEvent(new Event('input')); validateInput(); d.status.textContent = '已填入已保存的位置；核对后再调用';
                } catch (error) { d.status.textContent = error.message; }
            };
            fill.append(button('填入我的位置', () => populate('user')));
            if (target?.type === 'private') fill.append(button('填入角色位置', () => populate('char')));
            simple.append(fill);
        }
        const schemaView = node('details'); schemaView.append(node('summary', '查看完整参数 Schema'), node('pre', JSON.stringify(tool.inputSchema, null, 2))); d.body.append(schemaView);
        const output = node('pre', '尚未调用', 'mcp-result'); d.body.append(output);
        let result;
        const supply = button('供下轮参考', () => {
            try { m().queue(result, scope); d.status.textContent = '已加入该角色当前存档的下一次回复参考；10 分钟内有效，回复成功使用一次后清除'; supply.disabled = true; }
            catch (error) { d.status.textContent = error.message; }
        }); supply.disabled = true;
        const actions = node('div', undefined, 'mcp-row');
        actions.append(button('调用', () => d.run(async signal => {
            result = null;
            let args; try { args = JSON.parse(raw.value); } catch (_) { throw new Error('请填写有效 JSON 参数'); }
            if (!tool.validate(args)) throw new Error('参数与 Schema 不符，请检查必填项、类型和范围');
            let confirmed = false;
            if (!m().service(serviceId).tools[tool.name]?.readOnly) {
                confirmed = await confirm('确认外部工具操作', svc.name + '\n' + svc.url + '\n' + tool.name + '\n' + JSON.stringify(args, null, 2), signal);
                if (!confirmed) { d.status.textContent = '未执行'; return; }
            }
            d.status.textContent = '正在调用…'; result = await m().call(serviceId, tool.name, args, { scope: scope || undefined, signal, confirmed });
            if (d.controller.signal.aborted) return;
            output.textContent = result.text; supply.disabled = !scope; d.status.textContent = '调用成功；结果仅以文本显示，最多保留 20000 字符，不会自动进入日记';
        }).then(() => { supply.disabled = !result || !scope; })), supply,
            button('复制结果', async () => { try { if (!result) throw new Error('请先调用工具'); await navigator.clipboard.writeText(result.text); d.status.textContent = '已复制'; } catch (error) { d.status.textContent = error.message; } }),
            button('导出结果', () => { if (result) download({ service: svc.name, tool: tool.name, fetchedAt: new Date(result.at).toISOString(), text: result.text }, 'uvu-mcp-result.json'); else d.status.textContent = '请先调用工具'; })); d.body.append(actions);
        d.body.append(node('p', '若要供角色使用，请先在服务中心保存该角色的工具授权，再调用并点击“供下轮参考”。切换存档、修改配置或撤销授权会使结果失效。', 'mcp-help'));
    }
    function previewBrowser(serviceId, kind) {
        const d = dialog(kind === 'resources' ? '资源预览' : '提示模板预览', 'mcp-preview');
        const list = node('section'), output = node('pre', '选择一项后预览', 'mcp-result');
        d.body.append(list, output); let page = 0, items = [], result = null;
        function render() {
            list.replaceChildren();
            if (!items.length) list.append(node('p', '此服务没有可预览的项目', 'mcp-help'));
            for (const item of items.slice(page * 6, page * 6 + 6)) {
                const article = node('article', undefined, 'mcp-tool'); article.append(node('strong', item.name || item.uri));
                const args = [];
                for (const argument of item.arguments || []) args.push([argument.name, field(article, argument.name + (argument.required ? ' *' : '（可选）'))]);
                article.append(button('预览', () => d.run(async signal => {
                    const values = Object.fromEntries(args.filter(([, input]) => input.value).map(([name, input]) => [name, input.value]));
                    result = await m().preview(serviceId, kind === 'resources' ? 'resource' : 'prompt', item.uri || item.name, values, signal);
                    output.textContent = result.text; d.status.textContent = '仅预览；不会替换人设、提示词或自动进入聊天';
                }))); list.append(article);
            }
            if (items.length > 6) { const row = node('div', undefined, 'mcp-row'), prev = button('上一页', () => { page--; render(); }), next = button('下一页', () => { page++; render(); }); prev.disabled = !page; next.disabled = (page + 1) * 6 >= items.length; row.append(prev, node('span', (page + 1) + ' / ' + Math.ceil(items.length / 6)), next); list.append(row); }
        }
        const actions = node('div', undefined, 'mcp-row'); actions.append(button('刷新列表', () => load()), button('复制', async () => { try { if (!result) throw new Error('请先预览'); await navigator.clipboard.writeText(result.text); d.status.textContent = '已复制'; } catch (error) { d.status.textContent = error.message; } }), button('导出', () => { if (result) download(result, 'uvu-mcp-preview.json'); })); d.body.append(actions);
        const load = () => d.run(async signal => { items = await m().browse(serviceId, kind, signal); page = 0; render(); }); load();
    }
    function tutorial() {
        const el = node('details', undefined, 'mcp-tutorial'); el.append(node('summary', '使用教程与支持范围'));
        for (const [title, content] of [
            ['1 · 添加服务', '打开 API 设置 → MCP 服务 → 添加。填写服务提供者给出的 HTTPS /mcp 地址。认证选择无需令牌、Bearer 或 OAuth。OAuth 先填写服务登记的公开客户端 ID，把“登记回调地址”交给服务提供者登记；保存后点“连接 OAuth”，在新窗口登录并同意授权。无需客户端密钥。服务必须允许浏览器跨域访问；没有公开客户端登记或 CORS 支持时，请改用服务提供的 Bearer 方式。'],
            ['2 · 测试并授权工具', '保存后选中服务，点击“测试 / 刷新工具”。确认工具用途后，勾选“启用工具”并保存。只有你确认不会修改外部数据的工具才可勾选“已核实为只读”；服务自行声明只读不等于已授权。工具定义变化后需重新核对。开启服务和总开关后才能调用。'],
            ['3 · 手动查询', '在角色／群聊中选择接收目标和当前存档。在工具卡片点击“参数 / 调用”，填写必填字段或 JSON，再调用。写入或未知工具会显示具体服务、工具和参数，须确认后执行。取消或超时不保证外部服务尚未执行，请先核实再重试。'],
            ['4 · 供下轮参考', '在“角色授权”内允许该角色使用外部资料，并勾选相应工具保存。之后调用工具，检查结果，再点“供下轮参考”。只用于该角色当时的存档、下一次成功回复；失败或取消会保留至10分钟失效，不自动保存为日记或向量记忆。可用“清空待用结果”撤销。'],
            ['5 · 自动工具判断（可选）', '设置“独立工具判断 API”，然后为角色开启自动判断。仅发送最近 1–4 条相关文本及授权工具，不读取完整人设、世界书或历史。每轮最多 1–3 次只读调用，整轮预算默认 30 秒、并发默认 1，可自行设为最多 3。一个服务或工具失败时保留其他成功结果；全部失败继续普通回复。工具定义或输出结构变化后原授权失效，须重新核对。'],
            ['6 · Token 和费用', '普通聊天 Token 面板会单列 MCP 外部资料的本地估算。工具判断是另一次模型调用，其输入/输出用量在本中心记录，优先使用 API 返回值；不是角色回复总用量的一部分。工具服务本身是否收费由服务提供者决定。只读缓存仅避免相同参数的重复工具请求，不保证节省模型费用。'],
            ['7 · 日历和天气复用', '点击服务下方“日历与天气”，在高级 → MCP 选择本服务，分别填写地点搜索、坐标反查、天气和节假日四类工具名及 JSON 参数模板。只使用你已核实的只读工具。坐标来自你允许的定位或明确选定的地点，时区使用 IANA 名称，国家使用两位代码；不会让模型猜位置。角色异地设置仍在原日历面板管理。'],
            ['8 · 资源与提示模板', '服务下方“资源”和“提示模板”可列出项目；选择“预览”才会读取文字。模板要求的参数逐项填写。内容只显示为文字，可复制或导出；不会替换原来的系统提示词、自动加入记忆或执行远程指令。二进制、图片和音频不自动加载。'],
            ['9 · 结果去向', '工具结果支持查看、复制、导出，或在角色授权后“供下轮参考”。外部内容保持资料身份，不能覆盖原人设或提示词。需要长期记忆时先复制到现有记忆编辑面板审核保存；不会自动把天气等短期资料写进记忆。'],
            ['10 · 导入、故障与限制', '配置和整机备份不含 OAuth 访问/刷新令牌、判断密钥、临时结果及日志。导入后所有开关和角色授权关闭。401：重新授权；403：检查 Origin/CORS；404：只读旧会话自动重建一次，写入仍需手动核实；429：等待后手动重试。取消和超时不保证外部操作未执行，写入不会自动重放。调用记录显示阶段、状态码和耗时，不保存参数或正文。'],
            ['支持范围', '远程 Streamable HTTP（2026-07-28 / 2025 系列）、JSON/SSE、列表分页、受限 JSON Schema、OAuth PKCE S256。每服务最多 200 项，单响应最多 1 MiB。嵌套表单最多 4 层 / 60 字段，复杂数组或引用结构用折叠的 JSON 参数填写；最终仍以完整 Schema 校验。暂不支持 stdio 进程、旧 GET SSE、服务端交互或原生 char tool-call。OAuth 需服务提供者登记公开客户端，不提供通用免配置账户。']
        ]) { el.append(node('strong', title), node('p', content, 'mcp-help')); }
        return el;
    }
    function open(forChat = false) {
        const d = dialog('MCP 服务中心', 'mcp-services');
        const global = check(d.body, '启用 MCP 服务（默认关闭）', m().settings().enabled);
        global.onchange = () => d.run(async () => { const next = m().settings(); next.enabled = global.checked; await m().save(next); d.status.textContent = next.enabled ? 'MCP 已开启；仅为授权角色添加工具资料' : '已关闭；不调用工具或判断 API'; }).then(() => { global.checked = m().settings().enabled; });
        const targets = [...(db.characters || []).map(chat => ({ chat, type: 'private', label: '角色 · ' + (chat.remarkName || chat.realName || chat.id) })), ...(db.groups || []).map(chat => ({ chat, type: 'group', label: '群聊 · ' + (chat.name || chat.id) }))];
        const initial = targets.findIndex(t => t.chat.id === currentChatId && t.type === currentChatType);
        const target = select(d.body, '接收角色／群聊（使用该对象当前活动存档）', [['仅查看工具结果', ''], ...targets.map((t, i) => [t.label, String(i)])], initial >= 0 ? String(initial) : '');
        const targetLabel = target.parentElement; targetLabel.firstChild.textContent = '角色 / 群聊'; targetLabel.remove();
        const selectedTarget = () => target.value === '' ? null : targets[Number(target.value)];
        const permissionArea = node('details'); permissionArea.append(node('summary', '当前权限总览与撤销'));
        const serviceArea = node('section'), toolsArea = node('section'), roleArea = node('section'), plannerArea = node('details'), logsArea = node('details');
        const roleContent = node('div', undefined, 'mcp-role-content'); roleArea.append(node('strong', '角色授权'), targetLabel, roleContent);
        d.body.append(serviceArea, toolsArea, roleArea, permissionArea, plannerArea, logsArea);
        let serviceId = m().settings().services[0]?.id || '', tools = [], page = 0;
        function renderServices() {
            serviceArea.replaceChildren(node('strong', '远程服务'));
            const picker = select(serviceArea, '当前服务', m().settings().services.length ? m().settings().services.map(s => [s.name + (s.enabled ? ' · 开启' : ' · 关闭'), s.id]) : [['暂无服务', '']], serviceId);
            picker.onchange = () => { serviceId = picker.value; tools = []; page = 0; renderTools(); };
            const row = node('div', undefined, 'mcp-row');
            row.append(button('添加', () => serviceEditor(null, id => { serviceId = id; tools = []; renderServices(); renderTools(); })), button('编辑', () => { if (serviceId) serviceEditor(serviceId, () => { tools = []; renderServices(); renderTools(); renderRoles(); }); }),
                button('删除', () => d.run(async signal => {
                    if (!serviceId) return; const svc = m().service(serviceId);
                    if (!await confirm('删除 MCP 服务配置', svc.name + '\n' + svc.url + '\n仅删除连接配置，不删除外部服务数据。', signal)) return;
                    const next = m().settings(); next.services = next.services.filter(s => s.id !== svc.id); next.policies.forEach(p => p.grants = p.grants.filter(g => g.serviceId !== svc.id)); await m().save(next); if (svc.auth === 'oauth' && window.MCPOAuth) window.MCPOAuth.disconnect(svc); else m().vault.clear(svc);
                    serviceId = next.services[0]?.id || ''; tools = []; renderServices(); renderTools(); renderRoles();
                })), button('测试 / 刷新工具', () => d.run(async signal => {
                    if (!serviceId) throw new Error('请先添加一个服务'); d.status.textContent = '正在连接并读取工具…';
                    tools = await m().discover(serviceId, signal, true); page = 0; renderServices(); renderTools(); renderRoles();
                    d.status.textContent = '连接成功：' + tools.length + ' 个工具；请检查用途后保存授权';
                })));
            serviceArea.append(row);
            if (serviceId) {
                const health = m().health(serviceId), svc = m().service(serviceId), extras = node('div', undefined, 'mcp-row');
                if (svc.auth === 'oauth') {
                    const rememberOAuth = check(serviceArea, '记住 OAuth 授权', m().vault.remembered(svc));
                    extras.append(button('连接 OAuth', () => d.run(async signal => {
                        if (!window.MCPOAuth) throw new Error('OAuth 模块未加载，请刷新页面');
                        await window.MCPOAuth.connect(svc, { signal, remember: rememberOAuth.checked }); renderServices(); d.status.textContent = '授权成功，请刷新工具并核对授权';
                    })), button('断开授权', () => { window.MCPOAuth?.disconnect(svc); tools = []; renderServices(); renderTools(); d.status.textContent = '已清除本浏览器凭据；如需撤销服务端授权，请进入授权服务的账户设置'; }));
                }
                extras.append(button('资源', () => previewBrowser(serviceId, 'resources')), button('提示模板', () => previewBrowser(serviceId, 'prompts')),
                    button('日历与天气', () => { if (typeof openEnvironmentSettings === 'function') openEnvironmentSettings(false); else d.status.textContent = '请打开日历与环境设置 → 高级 → MCP，选择本服务并填写工具映射'; }));
                serviceArea.append(node('p', `${health.enabled ? '已开启' : '已关闭'} · ${health.credentialsPresent ? '凭据就绪' : '未授权'} · ${health.tools} 个工具`, 'mcp-help'), extras);
                const detail = node('details'); detail.append(node('summary', '连接详情'), node('p', health.host + '\n协议 ' + health.protocol + '\n' + (health.checkedAt ? '上次检查 ' + new Date(health.checkedAt).toLocaleString() : '尚未检查') + '\n已授权对象 ' + health.roles + '\n列表为上次检查结果，不代表此刻在线。', 'mcp-help')); serviceArea.append(detail);
            }
            renderPermissions();
        }
        function renderPermissions() {
            permissionArea.querySelectorAll(':scope > :not(summary)').forEach(el => el.remove());
            const policies = m().settings().policies.filter(p => p.enabled || p.grants.length);
            if (!policies.length) permissionArea.append(node('p', '尚无角色授权。服务和工具启用不等于角色自动获得权限。', 'mcp-help'));
            for (const policy of policies) {
                const entry = node('div', undefined, 'mcp-row');
                const t = targets.find(t => t.chat.id === policy.chatId && t.type === policy.type);
                entry.append(node('span', `${t?.label || '已删除对象'} · ${policy.enabled ? (policy.auto ? '自动只读判断' : '仅手动参考') : '停用'} · ${policy.grants.length} 项`));
                entry.append(button('撤销此对象授权', () => d.run(async () => {
                    const next = m().settings(); next.policies = next.policies.filter(p => p.chatId !== policy.chatId || p.type !== policy.type);
                    await m().save(next); renderRoles(); d.status.textContent = '已撤销此对象全部MCP授权，待用资料同时失效。';
                })));
                permissionArea.append(entry);
            }
        }
        function renderTools() {
            toolsArea.replaceChildren(node('strong', '工具列表'));
            if (!tools.length) { toolsArea.append(node('p', '选择服务后点击“测试 / 刷新工具”。尚未读取工具。', 'mcp-help')); return; }
            const svc = m().service(serviceId), size = 6, pages = Math.ceil(tools.length / size); page = Math.max(0, Math.min(page, pages - 1));
            for (const tool of tools.slice(page * size, (page + 1) * size)) {
                const card = node('article', undefined, 'mcp-tool'); card.append(node('strong', tool.name), node('p', tool.unavailable || tool.description, 'mcp-help'));
                const p = svc.tools[tool.name], matching = p?.signature === tool.signature;
                const enable = check(card, '启用工具', matching && p?.enabled), readOnly = check(card, '我已核实为只读，允许自动调用／环境映射', matching && p?.readOnly);
                const ttl = field(card, '只读结果缓存（秒，0 为关闭，最多 300）', 'input', 'number', String(p?.cacheSeconds || 0)); ttl.min = 0; ttl.max = 300;
                const row = node('div', undefined, 'mcp-row');
                const save = button('保存授权', () => d.run(async () => {
                    const next = m().settings(), s = next.services.find(x => x.id === serviceId); if (!s) throw new Error('服务已删除');
                    s.tools[tool.name] = { enabled: enable.checked, readOnly: readOnly.checked, signature: tool.signature, cacheSeconds: Number(ttl.value) }; await m().save(next); renderRoles(); d.status.textContent = '工具授权已保存；角色使用权限在下方单独设置';
                }));
                const call = button('参数 / 调用', () => toolCaller(serviceId, tool, selectedTarget()));
                if (tool.unavailable) [enable, readOnly, ttl, save, call].forEach(el => el.disabled = true);
                row.append(save, call); card.append(row); toolsArea.append(card);
            }
            const nav = node('div', undefined, 'mcp-row'); const previous = button('上一页', () => { page--; renderTools(); }), next = button('下一页', () => { page++; renderTools(); }); previous.disabled = page === 0; next.disabled = page >= pages - 1;
            nav.append(previous, node('span', (page + 1) + ' / ' + pages), next); toolsArea.append(nav);
        }
        function renderRoles() {
            renderPermissions();
            roleContent.replaceChildren();
            const t = selectedTarget(); if (!t) { roleContent.append(node('p', '选择一个角色或群聊后设置。', 'mcp-help')); return; }
            const scope = m().scope(t.chat, t.type), p = m().policy(scope);
            const archive = t.chat.archives?.find(item => item.id === scope.archive);
            const pendingCount = m().pending(scope);
            const scopeSummary = node('p', `${t.label.replace(/^(角色|群聊) · /, '')} · 待用 ${pendingCount} 条`, 'mcp-help');
            const scopeDetails = node('details', undefined, 'mcp-scope-details');
            scopeDetails.append(node('summary', '存档信息'));
            scopeDetails.append(node('p', `${archive?.name || '当前存档'} · ID ${String(scope.archive || 'default')}`, 'mcp-help'));
            roleContent.append(scopeSummary, scopeDetails);
            const enabled = check(roleContent, '允许此角色使用 MCP 外部资料', p?.enabled), auto = check(roleContent, '允许独立 API 自动判断（会增加模型调用）', p?.auto), grants = [];
            for (const svc of m().settings().services) for (const [name, rule] of Object.entries(svc.tools)) if (rule.enabled) {
                const input = check(roleContent, svc.name + ' / ' + name + (rule.readOnly ? ' · 只读' : ' · 仅手动结果'), p?.grants.some(g => g.serviceId === svc.id && g.toolName === name)); grants.push({ input, serviceId: svc.id, toolName: name });
            }
            const row = node('div', undefined, 'mcp-row'); row.append(button('保存角色授权', () => d.run(async () => {
                if (!m().valid(scope)) throw new Error('角色或存档已切换，请重新选择');
                const next = m().settings(); next.policies = next.policies.filter(p => p.chatId !== t.chat.id || p.type !== t.type);
                next.policies.push({ chatId: t.chat.id, type: t.type, enabled: enabled.checked, auto: auto.checked, grants: grants.filter(g => g.input.checked).map(g => ({ serviceId: g.serviceId, toolName: g.toolName })) });
                await m().save(next); renderRoles(); d.status.textContent = '角色授权已保存；未开启自动判断时只使用你手动指定的结果';
            })), button('清空待用结果', () => { m().take(scope); renderRoles(); d.status.textContent = '该角色待用资料已清除'; })); roleContent.append(row);
        }
        target.onchange = renderRoles;
        plannerArea.append(node('summary', '独立工具判断 API（自动模式使用）'));
        const p = m().settings().planner;
        const route = select(plannerArea, '模型接口', [['使用主 API', 'primary'], ['使用已启用的副 API', 'secondary'], ['独立配置', 'independent']], p.source);
        const provider = select(plannerArea, '独立接口类型', [['OpenAI 兼容', 'newapi'], ['Gemini', 'gemini']], p.provider);
        const url = field(plannerArea, '独立 API 地址', 'input', 'url', p.url), model = field(plannerArea, '独立模型名', 'input', 'text', p.model);
        const token = field(plannerArea, '独立 API 密钥（不进入备份）', 'input', 'password', window.MCPChat ? m().vault.get(window.MCPChat.plannerVaultService()) : ''); token.autocomplete = 'off';
        const remember = check(plannerArea, '在此浏览器记住独立密钥', window.MCPChat && m().vault.remembered(window.MCPChat.plannerVaultService()));
        url.oninput = () => { token.value = ''; remember.checked = false; d.status.textContent = '独立 API 地址已变化，请重新填写该接口密钥'; };
        const maxCalls = field(plannerArea, '每轮最多工具调用（1–3）', 'input', 'number', p.maxCalls), recent = field(plannerArea, '判断时最近消息条数（1–4）', 'input', 'number', p.recentMessages), context = field(plannerArea, '每轮外部资料字符上限（1000–12000）', 'input', 'number', p.maxContextChars);
        const timeBudget = field(plannerArea, '整轮工具时间预算（秒）', 'input', 'number', p.timeoutMs / 1000), concurrency = field(plannerArea, '只读并发数', 'input', 'number', p.concurrency), maxTools = field(plannerArea, '判断工具数量上限', 'input', 'number', p.maxTools);
        timeBudget.min = 1; timeBudget.max = 60; concurrency.min = 1; concurrency.max = 3; maxTools.min = 1; maxTools.max = 30;
        maxCalls.min = 1; maxCalls.max = 3; recent.min = 1; recent.max = 4; context.min = 1000; context.max = 12000;
        const independent = () => [provider, url, model, token, remember].forEach(el => el.parentElement.hidden = route.value !== 'independent'); route.onchange = independent; independent();
        plannerArea.append(button('保存判断配置', () => d.run(async () => {
            const next = m().settings(), old = window.MCPChat.plannerVaultService();
            next.planner = { source: route.value, provider: provider.value, url: url.value.trim(), model: model.value.trim(), maxCalls: Number(maxCalls.value), recentMessages: Number(recent.value), maxContextChars: Number(context.value), timeoutMs: Math.round(Number(timeBudget.value) * 1000), concurrency: Number(concurrency.value), maxTools: Number(maxTools.value) };
            const normalized = m().normalize(next), key = { id: '$planner', url: normalized.planner.url, auth: 'bearer' }, previous = m().vault.get(key), remembered = m().vault.remembered(key);
            m().vault.set(key, token.value.trim(), remember.checked);
            try { await m().save(normalized); } catch (error) { m().vault.set(key, previous, remembered); throw error; }
            if (old.url !== key.url) m().vault.clear(old);
            d.status.textContent = '工具判断配置已保存；还需为角色主动开启自动模式';
        })));
        logsArea.append(node('summary', '最近调用与用量（仅当前页面，最多 40 条）'));
        const logs = node('div'); logsArea.append(button('刷新记录', () => renderLogs()), logs);
        function renderLogs() { logs.replaceChildren(); for (const item of m().logs()) logs.append(node('p', new Date(item.at).toLocaleTimeString() + ' · ' + (item.kind === 'planner' ? '独立工具判断' : (item.serviceId || '') + (item.toolName ? '/' + item.toolName : '')) + ' · ' + item.status + (item.stage ? ' · ' + ({ discovery: '发现', call: '调用', resource: '资源预览', prompt: '模板预览' }[item.stage] || item.stage) : '') + (item.code ? ' · 代码 ' + item.code : '') + (item.ms !== undefined ? ' · ' + item.ms + 'ms' : '') + (item.cached ? ' · 缓存' : '') + (item.usage ? '\n输入 ' + item.usage.promptTokens + ' / 输出 ' + item.usage.completionTokens + ' / 合计 ' + item.usage.totalTokens + ' Token（' + (item.usage.actual ? 'API 返回' : '本地估算') + '）' : ''), 'mcp-help')); if (!m().logs().length) logs.append(node('p', '暂无调用；这里不保存参数、结果或密钥。', 'mcp-help')); }
        const configRow = node('div', undefined, 'mcp-row'), file = node('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
        configRow.append(button('导出配置', () => download(m().exportConfig(), 'uvu-mcp-config.json')), button('导入配置', () => file.click()), file);
        file.onchange = () => d.run(async signal => {
            const chosen = file.files?.[0]; if (!chosen) return; if (chosen.size > 256 * 1024) throw new Error('MCP 配置文件不能超过 256 KiB');
            let raw; try { raw = JSON.parse(await chosen.text()); } catch (_) { throw new Error('配置文件不是有效 JSON'); }
            const next = m().normalize(raw, true);
            if (!await confirm('导入 MCP 配置', '将替换现有 MCP 配置（不修改人设、聊天或提示词）。\n所有服务与角色授权会关闭；请重新填写令牌并测试。\n' + next.services.map(s => s.name + ' · ' + s.url).join('\n'), signal)) return;
            const previous = m().settings(); await m().save(next); [...previous.services, ...next.services].forEach(s => { if (s.auth === 'oauth' && window.MCPOAuth) window.MCPOAuth.disconnect(s); else m().vault.clear(s); });
            if (d.controller.signal.aborted || signal.aborted) return;
            d.dismiss(); open(forChat);
        });
        d.body.append(configRow, tutorial()); renderServices(); renderTools(); renderRoles(); renderLogs();
        if (forChat) roleArea.scrollIntoView({ block: 'nearest' });
    }
    window.MCPUI = Object.freeze({ open });
}());

function openMcpSettings(forChat = false) { window.MCPUI.open(forChat); }
