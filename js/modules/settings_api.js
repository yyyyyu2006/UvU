// --- API 设置与预设管理逻辑 ---

function setupApiSettingsApp() {
    const e = document.getElementById('api-form'), t = document.getElementById('fetch-models-btn'),
        a = document.getElementById('api-model'), n = document.getElementById('api-provider'),
        r = document.getElementById('api-url'), s = document.getElementById('api-key'), c = {
            newapi: '',
            deepseek: 'https://api.deepseek.com',
            claude: 'https://api.anthropic.com',
            gemini: 'https://generativelanguage.googleapis.com'
        };
    db.apiSettings && (n.value = db.apiSettings.provider || 'newapi', r.value = db.apiSettings.url || '', s.value = db.apiSettings.key || '', db.apiSettings.model && (a.innerHTML = `<option value="${db.apiSettings.model}">${db.apiSettings.model}</option>`));
    if (db.apiSettings && typeof db.apiSettings.timePerceptionEnabled !== 'undefined') { document.getElementById('time-perception-switch').checked = db.apiSettings.timePerceptionEnabled; }
    if (db.apiSettings && typeof db.apiSettings.streamEnabled !== 'undefined') { document.getElementById('stream-switch').checked = db.apiSettings.streamEnabled; } else { document.getElementById('stream-switch').checked = true; } 
    
    const keepAliveSwitch = document.getElementById('keep-alive-switch');
    if (keepAliveSwitch) {
        if (db.apiSettings && typeof db.apiSettings.keepAliveEnabled !== 'undefined') {
            keepAliveSwitch.checked = db.apiSettings.keepAliveEnabled;
        } else {
            keepAliveSwitch.checked = false;
        }
        keepAliveSwitch.addEventListener('change', async (e) => {
            const desiredState = e.target.checked;
            if (window.KeepAliveManager) {
                await window.KeepAliveManager.setEnabled(desiredState, { userInitiated: true });
            }
            db.apiSettings = db.apiSettings || {};
            db.apiSettings.keepAliveEnabled = desiredState;
            await saveData();
            showToast(desiredState ? '持续运行增强已开启' : '持续运行增强已关闭');
        });
    }

    const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
    const tempSlider = document.getElementById('temperature-slider');
    const tempValue = document.getElementById('temperature-value');
    
    if (tempEnabledSwitch) {
        if (db.apiSettings && typeof db.apiSettings.temperatureEnabled !== 'undefined') {
            tempEnabledSwitch.checked = db.apiSettings.temperatureEnabled;
        } else {
            tempEnabledSwitch.checked = true; // 默认开启
        }
        if (tempSlider) tempSlider.disabled = !tempEnabledSwitch.checked;
        
        tempEnabledSwitch.addEventListener('change', (e) => {
            if (tempSlider) tempSlider.disabled = !e.target.checked;
        });
    }

    if (tempSlider && tempValue) {
        const savedTemp = (db.apiSettings && db.apiSettings.temperature !== undefined) ? db.apiSettings.temperature : 1.0;
        tempSlider.value = savedTemp;
        tempValue.textContent = savedTemp;

        tempSlider.addEventListener('input', (e) => {
            tempValue.textContent = e.target.value;
        });
    }

    populateApiSelect();
    setupSecondaryApiSettings();
    n.addEventListener('change', () => {
        r.value = c[n.value] || ''
    });

    // 提取为全局函数以便复用
    window.fetchAndPopulateModels = async (showToastFlag = true) => {
        const provider = n.value;
        let apiUrl = r.value.trim();
        const apiKey = s.value.trim();
        const modelSelect = a;
        const fetchBtn = t;

        if (!apiUrl || !apiKey) {
            if (showToastFlag) showToast('请先填写API地址和密钥！');
            return;
        }

        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            if (showToastFlag) showToast('该 API 站点已被屏蔽，无法使用！');
            return;
        }

        if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
        
        const endpoint = provider === 'gemini' 
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}` 
            : `${apiUrl}/v1/models`;

        if (fetchBtn) {
            fetchBtn.classList.add('loading');
            fetchBtn.disabled = true;
        }

        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            
            if (!response.ok) {
                const error = new Error(`网络响应错误: ${response.status}`);
                error.response = response;
                throw error;
            }

            const data = await response.json();
            let models = [];
            
            if (provider !== 'gemini' && data.data) {
                models = data.data.map(e => e.id);
            } else if (provider === 'gemini' && data.models) {
                models = data.models.map(e => e.name.replace('models/', ''));
            }

            // 保留当前选中的值（如果仍在列表中）
            const currentVal = modelSelect.value;
            
            modelSelect.innerHTML = '';
            if (models.length > 0) {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    modelSelect.appendChild(opt);
                });
                
                // 尝试恢复之前的选择，或者使用设置中的值
                if (models.includes(currentVal)) {
                    modelSelect.value = currentVal;
                } else if (db.apiSettings && db.apiSettings.model && models.includes(db.apiSettings.model)) {
                    modelSelect.value = db.apiSettings.model;
                }
                
                if (showToastFlag) showToast('模型列表拉取成功！');
            } else {
                modelSelect.innerHTML = '<option value="">未找到任何模型</option>';
                if (showToastFlag) showToast('未找到任何模型');
            }
        } catch (err) {
            console.error(err);
            if (showToastFlag) {
                showApiError(err);
                modelSelect.innerHTML = '<option value="">拉取失败</option>';
            }
        } finally {
            if (fetchBtn) {
                fetchBtn.classList.remove('loading');
                fetchBtn.disabled = false;
            }
        }
    };

    t.addEventListener('click', () => window.fetchAndPopulateModels(true));
    e.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!a.value) return showToast('请选择模型后保存！');
        if (BLOCKED_API_DOMAINS.some(domain => r.value.includes(domain))) {
            return showToast('该 API 站点已被屏蔽，无法保存！');
        }
        const secondary = readSecondaryApiSettings();
        if (secondary.enabled && (!secondary.url || !secondary.key || !secondary.model)) {
            return showToast('请完整填写副 API 地址、密钥和模型！');
        }
        if (secondary.enabled && BLOCKED_API_DOMAINS.some(domain => secondary.url.includes(domain))) {
            return showToast('副 API 站点已被屏蔽，无法保存！');
        }
        db.apiSettings = {
            provider: n.value,
            url: r.value,
            key: s.value,
            model: a.value,
            timePerceptionEnabled: document.getElementById('time-perception-switch').checked,
            streamEnabled: document.getElementById('stream-switch').checked, 
            keepAliveEnabled: document.getElementById('keep-alive-switch') ? document.getElementById('keep-alive-switch').checked : false,
            temperatureEnabled: document.getElementById('temperature-enabled-switch').checked,
            temperature: parseFloat(document.getElementById('temperature-slider').value),
            secondary
        };
        await saveData();
        showToast('API设置已保存！')
    })
}

function getDefaultSecondaryApiRoutes() {
    return {
        callReply: false,
        callSummary: false,
        journal: false,
        peek: false,
        shop: false,
        batteryReminder: false
    };
}

function readSecondaryApiSettings() {
    const enabledEl = document.getElementById('secondary-api-enabled');
    const providerEl = document.getElementById('secondary-api-provider');
    const urlEl = document.getElementById('secondary-api-url');
    const keyEl = document.getElementById('secondary-api-key');
    const modelEl = document.getElementById('secondary-api-model');
    const routes = getDefaultSecondaryApiRoutes();

    document.querySelectorAll('[data-secondary-route]').forEach(input => {
        routes[input.dataset.secondaryRoute] = input.checked;
    });

    return {
        enabled: Boolean(enabledEl && enabledEl.checked),
        provider: providerEl ? providerEl.value : 'newapi',
        url: urlEl ? urlEl.value.trim().replace(/\/$/, '') : '',
        key: keyEl ? keyEl.value.trim() : '',
        model: modelEl ? modelEl.value : '',
        routes
    };
}

function setupSecondaryApiSettings() {
    const enabledEl = document.getElementById('secondary-api-enabled');
    const panel = document.getElementById('secondary-api-panel');
    const providerEl = document.getElementById('secondary-api-provider');
    const urlEl = document.getElementById('secondary-api-url');
    const keyEl = document.getElementById('secondary-api-key');
    const modelEl = document.getElementById('secondary-api-model');
    const fetchBtn = document.getElementById('secondary-fetch-models-btn');
    if (!enabledEl || !panel || !providerEl || !urlEl || !keyEl || !modelEl || !fetchBtn) return;

    const secondary = (db.apiSettings && db.apiSettings.secondary) || {};
    const providerUrls = {
        newapi: '',
        deepseek: 'https://api.deepseek.com',
        claude: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com'
    };

    enabledEl.checked = Boolean(secondary.enabled);
    providerEl.value = secondary.provider || 'newapi';
    urlEl.value = secondary.url || '';
    keyEl.value = secondary.key || '';
    if (secondary.model) {
        modelEl.innerHTML = '';
        const savedModelOption = document.createElement('option');
        savedModelOption.value = secondary.model;
        savedModelOption.textContent = secondary.model;
        modelEl.appendChild(savedModelOption);
    }
    const savedRoutes = { ...getDefaultSecondaryApiRoutes(), ...(secondary.routes || {}) };
    document.querySelectorAll('[data-secondary-route]').forEach(input => {
        input.checked = Boolean(savedRoutes[input.dataset.secondaryRoute]);
    });

    const updatePanelState = () => {
        panel.style.display = enabledEl.checked ? 'block' : 'none';
    };
    updatePanelState();

    if (enabledEl.dataset.listenerBound === 'true') return;
    enabledEl.dataset.listenerBound = 'true';
    enabledEl.addEventListener('change', updatePanelState);
    providerEl.addEventListener('change', () => {
        urlEl.value = providerUrls[providerEl.value] || '';
        modelEl.innerHTML = '<option value="">请重新拉取模型</option>';
    });
    fetchBtn.addEventListener('click', async () => {
        let apiUrl = urlEl.value.trim().replace(/\/$/, '');
        const apiKey = keyEl.value.trim();
        const provider = providerEl.value;
        if (!apiUrl || !apiKey) return showToast('请先填写副 API 地址和密钥！');
        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            return showToast('副 API 站点已被屏蔽，无法使用！');
        }

        const endpoint = provider === 'gemini'
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}`
            : `${apiUrl}/v1/models`;
        fetchBtn.disabled = true;
        fetchBtn.classList.add('loading');
        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            if (!response.ok) {
                const error = new Error(`网络响应错误: ${response.status}`);
                error.response = response;
                throw error;
            }
            const data = await response.json();
            const models = provider === 'gemini'
                ? (data.models || []).map(item => item.name.replace('models/', ''))
                : (data.data || []).map(item => item.id);
            modelEl.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelEl.appendChild(option);
            });
            if (!models.length) modelEl.innerHTML = '<option value="">未找到任何模型</option>';
            showToast(models.length ? '副 API 模型列表拉取成功！' : '未找到任何模型');
        } catch (error) {
            showApiError(error);
            modelEl.innerHTML = '<option value="">拉取失败</option>';
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.classList.remove('loading');
        }
    });
}

// --- 预设管理 ---
function _getApiPresets() {
    return db.apiPresets || [];
}

function _createApiPresetId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'api_preset_' + window.crypto.randomUUID();
    }
    return 'api_preset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function _normalizeApiPresets(arr) {
    const usedIds = new Set();
    return (Array.isArray(arr) ? arr : []).map(preset => {
        const normalized = preset && typeof preset === 'object' ? preset : {};
        if (!normalized.id || usedIds.has(normalized.id)) {
            normalized.id = _createApiPresetId();
        }
        usedIds.add(normalized.id);
        return normalized;
    });
}

function _saveApiPresets(arr) {
    db.apiPresets = _normalizeApiPresets(arr);
    saveData();
    window.dispatchEvent(new CustomEvent('api-presets-updated'));
}

function populateApiSelect() {
    const sel = document.getElementById('api-preset-select');
    if (!sel) return;
    const needsMigration = _getApiPresets().some(p => !p || !p.id);
    const presets = _normalizeApiPresets(_getApiPresets());
    db.apiPresets = presets;
    if (needsMigration) saveData();
    sel.innerHTML = '<option value="">— 选择 API 预设 —</option>';
    presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
    });
}

function saveCurrentApiAsPreset() {
    const apiKeyEl = document.querySelector('#api-key');
    const apiUrlEl = document.querySelector('#api-url');
    const providerEl = document.querySelector('#api-provider');
    const modelEl = document.querySelector('#api-model');
    const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
    const tempSlider = document.getElementById('temperature-slider');

    const data = {
        apiKey: apiKeyEl ? apiKeyEl.value : '',
        apiUrl: apiUrlEl ? apiUrlEl.value : '',
        provider: providerEl ? providerEl.value : '',
        model: modelEl ? modelEl.value : '',
        temperatureEnabled: tempEnabledSwitch ? tempEnabledSwitch.checked : false,
        temperature: tempSlider ? parseFloat(tempSlider.value) : 1.0
    };
    
    let name = prompt('为该 API 预设填写名称（会覆盖同名预设）：');
    if (!name) return;
    const presets = _getApiPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = {id: idx >= 0 ? presets[idx].id : _createApiPresetId(), name: name, data: data};
    if (idx >= 0) presets[idx] = preset; else presets.push(preset);
    _saveApiPresets(presets);
    populateApiSelect();
    showToast('API 预设已保存');
}

async function applyApiPreset(name) {
    const presets = _getApiPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    try {
        const apiKeyEl = document.querySelector('#api-key');
        const apiUrlEl = document.querySelector('#api-url');
        const providerEl = document.querySelector('#api-provider');
        const modelEl = document.querySelector('#api-model');
        const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
        const tempSlider = document.getElementById('temperature-slider');
        const tempValue = document.getElementById('temperature-value');

        if (apiKeyEl && p.data && typeof p.data.apiKey !== 'undefined') apiKeyEl.value = p.data.apiKey;
        if (apiUrlEl && p.data && typeof p.data.apiUrl !== 'undefined') apiUrlEl.value = p.data.apiUrl;
        if (providerEl && p.data && typeof p.data.provider !== 'undefined') providerEl.value = p.data.provider;
        if (modelEl && p.data && typeof p.data.model !== 'undefined') {
            modelEl.innerHTML = `<option value="${p.data.model}">${p.data.model}</option>`;
            modelEl.value = p.data.model;
        }
        if (tempEnabledSwitch && p.data && typeof p.data.temperatureEnabled !== 'undefined') {
            tempEnabledSwitch.checked = p.data.temperatureEnabled;
            if (tempSlider) tempSlider.disabled = !tempEnabledSwitch.checked;
        }
        if (tempSlider && p.data && typeof p.data.temperature !== 'undefined') {
            tempSlider.value = p.data.temperature;
            if (tempValue) tempValue.textContent = p.data.temperature;
        }

        showToast('已应用 API 预设');
    } catch(e) {
        console.error('applyApiPreset error', e);
    }
}

function openApiManageModal() {
    const modal = document.getElementById('api-presets-modal');
    const list = document.getElementById('api-presets-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    const presets = _getApiPresets();
    if (!presets.length) {
        list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    }
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 6px';
        row.style.borderBottom = '1px solid #f6f6f6';

        const left = document.createElement('div');
        left.style.flex = '1';
        left.style.minWidth = '0';
        left.innerHTML = '<div style="font-weight:600;">'+p.name+'</div><div style="font-size:12px;color:#666;margin-top:4px;">' + (p.data && p.data.provider ? ('提供者：'+p.data.provider) : '') + '</div>';

        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.gap = '6px';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn';
        applyBtn.textContent = '应用';
        applyBtn.onclick = function(){ applyApiPreset(p.name); modal.style.display='none'; };

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function(){
            const newName = prompt('输入新名称：', p.name);
            if (!newName) return;
            const all = _getApiPresets();
            all[idx].name = newName;
            _saveApiPresets(all);
            openApiManageModal();
            populateApiSelect();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'btn';
        delBtn.textContent = '删除';
        delBtn.onclick = function(){ if(!confirm('确定删除 "'+p.name+'" ?')) return; const all=_getApiPresets(); all.splice(idx,1); _saveApiPresets(all); openApiManageModal(); populateApiSelect(); };

        btns.appendChild(applyBtn); btns.appendChild(renameBtn); btns.appendChild(delBtn);

        row.appendChild(left); row.appendChild(btns);
        list.appendChild(row);
    });
    modal.style.display = 'flex';
}

function exportApiPresets() {
    const presets = _getApiPresets();
    const blob = new Blob([JSON.stringify(presets, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'api_presets.json'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
function importApiPresets() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = function(e){
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = function(){ try { const data = JSON.parse(r.result); if (Array.isArray(data)) { _saveApiPresets(data); populateApiSelect(); openApiManageModal(); } else alert('文件格式不正确'); } catch(e){ alert('导入失败：'+e.message); } };
        r.readAsText(f);
    };
    inp.click();
}
