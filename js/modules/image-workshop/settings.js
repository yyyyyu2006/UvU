// --- 设置绑定与持久化 ---
async function initWorkshopSettings() {
    if (!db.workshopSettings) return;

    const settings = db.workshopSettings;
    
    const planned = {...settings,
        apiPresets:settings.apiPresets ? JSON.parse(JSON.stringify(settings.apiPresets)) : undefined,
        activeApiPresetId:settings.activeApiPresetId ? {...settings.activeApiPresetId} : undefined};
    // 初始化 API 预设数据结构
    if (!planned.apiPresets) {
        planned.apiPresets = {
            novelai: [
                { id: 'official', name: '官方默认', url: 'https://image.novelai.net/ai/generate-image-stream', key: '', protocol: 'novelai', responseFormat: 'auto' }
            ],
            gpt: [
                { id: 'official', name: '官方默认', url: 'https://api.openai.com/v1/images/generations', key: '', protocol: 'openai', responseFormat: 'auto' }
            ]
        };
    }
    if (!planned.activeApiPresetId) {
        planned.activeApiPresetId = {
            novelai: 'official',
            gpt: 'official'
        };
    }

    // 旧预设没有协议字段：NovelAI 保持原生逻辑，GPT 保持 OpenAI 逻辑。
    Object.entries(planned.apiPresets).forEach(([provider, presets]) => {
        (presets || []).forEach(preset => {
            if (!preset.protocol) preset.protocol = provider === 'novelai' ? 'novelai' : 'openai';
            if (!preset.responseFormat) preset.responseFormat = 'auto';
        });
    });
    
    // 迁移旧数据到预设
    if (planned.novelaiApiUrl && planned.novelaiApiUrl !== 'https://image.novelai.net/ai/generate-image-stream') {
        const existing = planned.apiPresets.novelai.find(p => p.url === planned.novelaiApiUrl);
        if (!existing) {
            const newId = 'preset_' + Date.now();
            planned.apiPresets.novelai.push({
                id: newId,
                name: '自定义节点',
                url: planned.novelaiApiUrl,
                key: planned.novelaiApiKey || '',
                protocol: 'novelai',
                responseFormat: 'auto'
            });
            planned.activeApiPresetId.novelai = newId;
        }
    } else if (planned.novelaiApiKey) {
        const official = planned.apiPresets.novelai.find(p => p.id === 'official');
        if (official) official.key = planned.novelaiApiKey;
    }

    if (planned.gptApiUrl && planned.gptApiUrl !== 'https://api.openai.com/v1/images/generations') {
        const existing = planned.apiPresets.gpt.find(p => p.url === planned.gptApiUrl);
        if (!existing) {
            const newId = 'preset_' + Date.now();
            planned.apiPresets.gpt.push({
                id: newId,
                name: '自定义节点',
                url: planned.gptApiUrl,
                key: planned.gptApiKey || '',
                protocol: 'openai',
                responseFormat: 'auto'
            });
            planned.activeApiPresetId.gpt = newId;
        }
    } else if (planned.gptApiKey) {
        const official = planned.apiPresets.gpt.find(p => p.id === 'official');
        if (official) official.key = planned.gptApiKey;
    }
    
    const migration = Object.fromEntries(['apiPresets','activeApiPresetId']
        .filter(key => JSON.stringify(settings[key]) !== JSON.stringify(planned[key])).map(key => [key,planned[key]]));
    if (Object.keys(migration).length && !await saveLocalSettingsFields([{target:settings,values:migration}])) return;
    if (db.workshopSettings !== settings) return;

    // 辅助函数：绑定输入框
    const bindInput = (id, key, isNumber = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (settings[key] !== undefined) {
            el.value = settings[key];
        }
        // 使用 input 事件实现实时保存，避免失去焦点才保存的问题
        el.addEventListener('input', async (e) => {
            if (!e.isTrusted) return; // 防止程序触发的事件导致死循环
            if (db.workshopSettings !== settings) return;
            if (!await saveLocalSettingsFields([{target:settings, values:{[key]:isNumber ? Number(e.target.value) : e.target.value}}])) el.value = settings[key] ?? '';
        });
        // 保留 change 事件以兼容某些特殊情况或程序触发的更新
        el.addEventListener('change', async (e) => {
            if (db.workshopSettings !== settings) return;
            if (!await saveLocalSettingsFields([{target:settings, values:{[key]:isNumber ? Number(e.target.value) : e.target.value}}])) el.value = settings[key] ?? '';
        });
    };

    // 辅助函数：绑定开关
    const bindSwitch = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (settings[key] !== undefined) {
            el.checked = settings[key];
        }
        el.addEventListener('change', async (e) => {
            if (!e.isTrusted) return; // 防止程序触发的 change 事件导致死循环
            if (db.workshopSettings !== settings) return;
            if (!await saveLocalSettingsFields([{target:settings, values:{[key]:e.target.checked}}])) el.checked = !!settings[key];
        });
    };

    // 辅助函数：绑定单选框组
    const bindRadioGroup = (name, key, onChangeCallback = null) => {
        const radios = document.querySelectorAll(`input[name="${name}"]`);
        radios.forEach(radio => {
            if (radio.value === settings[key]) {
                radio.checked = true;
            }
            radio.addEventListener('change', async (e) => {
                if (!e.isTrusted) return; // 防止程序触发的 change 事件导致死循环
                if (e.target.checked) {
                    if (db.workshopSettings !== settings) return;
                    if (!await saveLocalSettingsFields([{target:settings, values:{[key]:e.target.value}}])) {
                        radios.forEach(item => item.checked = item.value === settings[key]);
                        return;
                    }
                    if (onChangeCallback) {
                        onChangeCallback(e.target.value);
                    }
                }
            });
        });
    };

    // 绑定基础设置
    // Provider persistence is owned by workshop.js, alongside its dependent UI.
    
    // 初始化 API 预设逻辑
    initApiPresets();
    
    // 绑定尺寸与基础
    bindRadioGroup('workshop-aspect-ratio', 'aspectRatio');
    bindInput('workshop-rate-limit', 'rateLimit', true);
    
    // GPT 专属绑定
    bindRadioGroup('workshop-gpt-aspect-ratio', 'gptAspectRatio');
    bindInput('workshop-gpt-quality', 'gptQuality');
    bindInput('workshop-gpt-style', 'gptStyle');
    bindInput('workshop-gpt-test-prompt', 'gptTestPrompt');
    
    // 初始化 GPT 标签系统
    initGPTTagsSystem();
    
    // 绑定提示词
    bindInput('workshop-positive-prompt', 'positivePrompt');
    bindInput('workshop-character-prompt', 'characterPrompt');
    bindInput('workshop-negative-prompt', 'negativePrompt');
    
    // 绑定提示词预设逻辑
    initPromptPresets();
    
    // 绑定 LLM 设置 (NovelAI)
    bindSwitch('workshop-llm-independent-api', 'llmIndependentApi');
    bindInput('workshop-llm-api-preset', 'llmApiPresetId');
    
    // 绑定 LLM 设置 (GPT)
    bindSwitch('workshop-gpt-llm-independent-api', 'gptLlmIndependentApi');
    bindInput('workshop-gpt-llm-api-preset', 'gptLlmApiPresetId');

    // 两套 LLM 可以分别选择聊天 API 预设。
    populateWorkshopLlmApiPresets();
    if (!window.__workshopLlmApiPresetListenerBound) {
        window.addEventListener('api-presets-updated', populateWorkshopLlmApiPresets);
        window.__workshopLlmApiPresetListenerBound = true;
    }
    
    // 初始化 LLM 预设条目
    initWorkshopLLMPrompts();
    initWorkshopGPTLLMPrompts();
    
    // 触发一次 provider 的 change 事件以更新 UI
    const activeProviderRadio = document.querySelector('input[name="workshop-provider"]:checked');
    if (activeProviderRadio) {
        activeProviderRadio.dispatchEvent(new Event('change'));
    } else {
        const firstRadio = document.querySelector('input[name="workshop-provider"]');
        if (firstRadio) {
            firstRadio.checked = true;
            firstRadio.dispatchEvent(new Event('change'));
        }
    }
    
    // 触发一次 LLM 开关的 change 事件以更新 UI
    const llmToggle = document.getElementById('workshop-llm-independent-api');
    if (llmToggle) {
        llmToggle.dispatchEvent(new Event('change'));
    }
    const gptLlmToggle = document.getElementById('workshop-gpt-llm-independent-api');
    if (gptLlmToggle) {
        gptLlmToggle.dispatchEvent(new Event('change'));
    }
}

function populateWorkshopLlmApiPresets() {
    const settings = db.workshopSettings;
    if (!settings) return;
    const presets = Array.isArray(db.apiPresets) ? db.apiPresets : [];
    const selectConfigs = [
        {id:'workshop-llm-api-preset',settingKey:'llmApiPresetId'},
        {id:'workshop-gpt-llm-api-preset',settingKey:'gptLlmApiPresetId'}
    ];
    const changes = [], values = {};
    selectConfigs.forEach(({settingKey}) => {
        const selected = settings[settingKey] || '';
        const preset = presets.find(p => p && (p.id === selected || p.name === selected));
        let id = preset?.id || '';
        if (preset && !id && typeof _createApiPresetId === 'function') {
            id = _createApiPresetId();
            changes.push({target:preset,values:{id}});
        }
        if (selected !== id) values[settingKey] = id;
    });
    if (Object.keys(values).length) changes.push({target:settings,values});
    const render = () => {
        if (db.workshopSettings !== settings) return;
        selectConfigs.forEach(({id,settingKey}) => {
            const select = document.getElementById(id);
            if (!select) return;
            select.innerHTML = '<option value="">请选择</option>';
            presets.forEach(preset => {
                if (!preset || !preset.id || !preset.name || !preset.data) return;
                const option = document.createElement('option');
                option.value = preset.id; option.textContent = preset.name;
                select.appendChild(option);
            });
            select.value = settings[settingKey] || '';
        });
    };
    if (changes.length) void saveLocalSettingsFields(changes).then(render);
    render();
}

// --- API 预设逻辑 ---
function updateApiPresetList() {
    const provider = db.workshopSettings.provider || 'novelai';
    const select = document.getElementById('workshop-api-preset-select');
    const urlInput = document.getElementById('workshop-api-url');
    const keyInput = document.getElementById('workshop-api-key');
    const protocolRow = document.getElementById('workshop-api-protocol-row');
    const protocolSelect = document.getElementById('workshop-api-protocol');
    const responseFormatSelect = document.getElementById('workshop-response-format');
    const deleteBtn = document.getElementById('workshop-delete-api-preset-btn');
    
    if (!select || !db.workshopSettings.apiPresets) return;
    
    const presets = db.workshopSettings.apiPresets[provider] || [];
    const activeId = db.workshopSettings.activeApiPresetId[provider];
    
    select.innerHTML = '';
    presets.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name;
        if (p.id === activeId) option.selected = true;
        select.appendChild(option);
    });
    
    // 更新输入框
    const activePreset = presets.find(p => p.id === activeId);
    if (activePreset) {
        urlInput.value = activePreset.url;
        keyInput.value = activePreset.key;
        if (protocolSelect) protocolSelect.value = activePreset.protocol || (provider === 'novelai' ? 'novelai' : 'openai');
        if (responseFormatSelect) responseFormatSelect.value = activePreset.responseFormat || 'auto';
        
        // 官方预设不允许删除
        if (deleteBtn) {
            deleteBtn.style.display = activePreset.id === 'official' ? 'none' : 'flex';
        }
    }

    if (protocolRow) protocolRow.style.display = provider === 'novelai' ? 'flex' : 'none';
    updateApiProtocolUI();
}

function getActiveWorkshopApiPreset() {
    const settings = db.workshopSettings;
    if (!settings || !settings.apiPresets || !settings.activeApiPresetId) return null;
    const provider = settings.provider || 'novelai';
    return (settings.apiPresets[provider] || []).find(p => p.id === settings.activeApiPresetId[provider]) || null;
}

function updateApiProtocolUI() {
    const provider = db.workshopSettings?.provider || 'novelai';
    const preset = getActiveWorkshopApiPreset();
    const protocol = provider === 'novelai' ? (preset?.protocol || 'novelai') : 'openai';
    const hint = document.getElementById('workshop-api-protocol-hint');
    const responseRow = document.getElementById('workshop-response-format-row');
    const responseLabel = document.getElementById('workshop-response-format-label');
    const responseFormatSelect = document.getElementById('workshop-response-format');
    const modelListRow = document.getElementById('workshop-model-list-row');
    const modelSelectRow = document.getElementById('workshop-model-select-row');
    const customModelRow = document.getElementById('workshop-custom-model-row');
    const customModelInput = document.getElementById('workshop-custom-model');

    if (responseRow) responseRow.style.display = provider === 'novelai' && (protocol === 'novelai' || protocol === 'custom') ? 'flex' : 'none';
    if (responseLabel) responseLabel.textContent = protocol === 'novelai' ? '传输模式' : '响应格式';
    if (responseFormatSelect) {
        const jsonOption = responseFormatSelect.querySelector('option[value="json"]');
        if (jsonOption) jsonOption.hidden = protocol === 'novelai';
        if (protocol === 'novelai' && responseFormatSelect.value === 'json') {
            responseFormatSelect.value = 'auto';
        }
    }
    if (modelListRow) modelListRow.style.display = protocol === 'custom' ? 'none' : 'flex';
    if (modelSelectRow) modelSelectRow.style.display = protocol === 'custom' ? 'none' : 'flex';
    if (customModelRow) customModelRow.style.display = provider === 'novelai' && protocol === 'custom' ? 'flex' : 'none';
    if (customModelInput && provider === 'novelai') customModelInput.value = db.workshopSettings.novelaiModel || '';

    if (hint) {
        const messages = {
            openai: 'OpenAI 图片兼容模式只发送通用生图字段，Vibe、负面提示词等 NovelAI 专属参数不会生效。',
            custom: '自定义直连会原样请求填写的完整 URL，并发送 NovelAI 原生请求体。'
        };
        hint.textContent = messages[protocol] || '';
        hint.style.display = provider === 'novelai' && messages[protocol] ? 'block' : 'none';
    }

    document.dispatchEvent(new CustomEvent('workshop-api-protocol-change', { detail: { provider, protocol } }));
}

function initApiPresets() {
    const select = document.getElementById('workshop-api-preset-select');
    const saveBtn = document.getElementById('workshop-save-api-preset-btn');
    const deleteBtn = document.getElementById('workshop-delete-api-preset-btn');
    const urlInput = document.getElementById('workshop-api-url');
    const keyInput = document.getElementById('workshop-api-key');
    const protocolSelect = document.getElementById('workshop-api-protocol');
    const responseFormatSelect = document.getElementById('workshop-response-format');
    const customModelInput = document.getElementById('workshop-custom-model');
    if (!select || !saveBtn || !urlInput || !keyInput) return;
    updateApiPresetList();

    const persist = async (changes, settings, provider, preset = null) => {
        const saved = await saveLocalSettingsFields(changes);
        if (db.workshopSettings === settings && (settings.provider || 'novelai') === provider
            && (!preset || getActiveWorkshopApiPreset() === preset)) updateApiPresetList();
        return saved;
    };
    select.onchange = async e => {
        const settings = db.workshopSettings;
        const provider = settings.provider || 'novelai';
        if (!(settings.apiPresets[provider] || []).some(p => p.id === e.target.value)) return;
        const saving = persist([{target:settings.activeApiPresetId,values:{[provider]:e.target.value}}],settings,provider);
        updateApiPresetList();
        await saving;
    };
    const saveCurrentPreset = async () => {
        const settings = db.workshopSettings;
        const provider = settings.provider || 'novelai';
        const preset = getActiveWorkshopApiPreset();
        if (!preset) return;
        const url = urlInput.value.trim(), key = keyInput.value.trim();
        await persist([
            {target:preset,values:{url,key}},
            {target:settings,values:{[provider+'ApiUrl']:url,[provider+'ApiKey']:key}}
        ],settings,provider,preset);
    };
    urlInput.oninput = saveCurrentPreset;
    keyInput.oninput = saveCurrentPreset;

    const createPreset = async copyCurrent => {
        const settings = db.workshopSettings;
        const provider = settings.provider || 'novelai';
        const name = prompt('请输入新预设名称：');
        if (!name) return;
        const preset = {
            id:'preset_' + crypto.randomUUID(),name,
            url:copyCurrent ? urlInput.value.trim() : '',
            key:copyCurrent ? keyInput.value.trim() : '',
            protocol:provider === 'novelai' ? (copyCurrent ? protocolSelect?.value || 'novelai' : 'novelai') : 'openai',
            responseFormat:copyCurrent ? responseFormatSelect?.value || 'auto' : 'auto'
        };
        const saved = await persist([
            {target:settings.apiPresets,values:{[provider]:[...settings.apiPresets[provider],preset]}},
            {target:settings.activeApiPresetId,values:{[provider]:preset.id}}
        ],settings,provider);
        if (saved) showToast(copyCurrent ? '预设保存成功' : '已创建新预设');
    };
    const newBtn = document.getElementById('workshop-new-api-preset-btn');
    if (newBtn) newBtn.onclick = () => createPreset(false);
    saveBtn.onclick = () => createPreset(true);
    if (protocolSelect) protocolSelect.onchange = async e => {
        const settings = db.workshopSettings;
        const provider = settings.provider || 'novelai';
        const preset = getActiveWorkshopApiPreset();
        if (!preset) return;
        const protocol = e.target.value;
        const responseFormat = protocol === 'novelai' && preset.responseFormat === 'json' ? 'auto' : preset.responseFormat || 'auto';
        await persist([{target:preset,values:{protocol,responseFormat}}],settings,provider,preset);
    };
    if (responseFormatSelect) responseFormatSelect.onchange = async e => {
        const settings = db.workshopSettings;
        const preset = getActiveWorkshopApiPreset();
        if (preset) await persist([{target:preset,values:{responseFormat:e.target.value}}],settings,settings.provider || 'novelai',preset);
    };
    if (customModelInput) customModelInput.oninput = async e => {
        const settings = db.workshopSettings;
        await persist([{target:settings,values:{novelaiModel:e.target.value.trim()}}],settings,settings.provider || 'novelai');
    };
    if (deleteBtn) deleteBtn.onclick = async () => {
        const settings = db.workshopSettings;
        const provider = settings.provider || 'novelai';
        const preset = getActiveWorkshopApiPreset();
        if (!preset) return;
        if (preset.id === 'official') return showToast('官方预设不可删除');
        if (!confirm('确定要删除当前预设吗？')) return;
        const saved = await persist([
            {target:settings.apiPresets,values:{[provider]:settings.apiPresets[provider].filter(p => p !== preset)}},
            {target:settings.activeApiPresetId,values:{[provider]:'official'}}
        ],settings,provider);
        if (saved) showToast('预设已删除');
    };
}

// --- 提示词预设逻辑 ---
function initPromptPresets() {
    const presetSelect = document.getElementById('workshop-prompt-preset-select');
    const saveBtn = document.getElementById('workshop-save-prompt-preset-btn');
    const updateBtn = document.getElementById('workshop-update-prompt-preset-btn');
    const deleteBtn = document.getElementById('workshop-delete-prompt-preset-btn');
    const positiveInput = document.getElementById('workshop-positive-prompt');
    const characterInput = document.getElementById('workshop-character-prompt');
    const negativeInput = document.getElementById('workshop-negative-prompt');

    if (!presetSelect || !saveBtn || !positiveInput || !negativeInput) return;

    // 渲染预设列表
    const renderPresets = () => {
        presetSelect.innerHTML = '<option value="">选择预设</option>';
        if (db.workshopPromptPresets && db.workshopPromptPresets.length > 0) {
            db.workshopPromptPresets.forEach(preset => {
                const option = document.createElement('option');
                option.value = preset.id;
                option.textContent = preset.name;
                presetSelect.appendChild(option);
            });
        }
    };

    renderPresets();

    // 选择预设时填充
    presetSelect.addEventListener('change', async (e) => {
        const presetId = e.target.value;
        
        if (!presetId) {
            if (updateBtn) updateBtn.style.display = 'none';
            if (deleteBtn) deleteBtn.style.display = 'none';
            return;
        }

        if (updateBtn) updateBtn.style.display = 'block';
        if (deleteBtn) deleteBtn.style.display = 'block';

        const preset = db.workshopPromptPresets.find(p => p.id === presetId);
        if (preset) {
            positiveInput.value = preset.positive;
            if (characterInput) characterInput.value = preset.character || '';
            negativeInput.value = preset.negative;
            
            const settings = db.workshopSettings;
            if (!await saveLocalSettingsFields([{target:settings,values:{positivePrompt:preset.positive,
                characterPrompt:preset.character || '',negativePrompt:preset.negative}}])) {
                if (db.workshopSettings === settings) {
                    positiveInput.value = settings.positivePrompt || '';
                    if (characterInput) characterInput.value = settings.characterPrompt || '';
                    negativeInput.value = settings.negativePrompt || '';
                }
                return;
            }
            showToast('已应用预设: ' + preset.name);
        }
    });

    // 保存当前为新预设
    saveBtn.addEventListener('click', async () => {
        const positive = positiveInput.value.trim();
        const character = characterInput ? characterInput.value.trim() : '';
        const negative = negativeInput.value.trim();

        if (!positive && !negative && !character) {
            showToast('提示词为空，无法保存');
            return;
        }

        const name = prompt('请输入预设名称：');
        if (!name) return;

        if (!db.workshopPromptPresets) {
            db.workshopPromptPresets = [];
        }

        const newPreset = {
            id: 'prompt_preset_' + crypto.randomUUID(),
            name: name,
            positive: positive,
            character: character,
            negative: negative
        };

        if (!await saveLocalSettingsFields([{target:db,values:{workshopPromptPresets:[...db.workshopPromptPresets,newPreset]}}])) return;
        
        renderPresets();
        presetSelect.value = newPreset.id;
        presetSelect.dispatchEvent(new Event('change'));
        showToast('预设保存成功');
    });

    // 更新当前预设
    if (updateBtn) {
        updateBtn.addEventListener('click', async () => {
            const presetId = presetSelect.value;
            if (!presetId) return;

            const presetIndex = db.workshopPromptPresets.findIndex(p => p.id === presetId);
            if (presetIndex !== -1) {
                const preset = db.workshopPromptPresets[presetIndex];
                if (!await saveLocalSettingsFields([{target:preset,values:{positive:positiveInput.value.trim(),
                    character:characterInput ? characterInput.value.trim() : '',negative:negativeInput.value.trim()}}])) return;
                showToast('预设已更新');
            }
        });
    }

    // 删除当前预设
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const presetId = presetSelect.value;
            if (!presetId) return;

            if (confirm('确定要删除这个预设吗？')) {
                if (!await saveLocalSettingsFields([{target:db,values:{workshopPromptPresets:db.workshopPromptPresets.filter(p => p.id !== presetId)}}])) return;
                
                renderPresets();
                presetSelect.value = '';
                presetSelect.dispatchEvent(new Event('change'));
                showToast('预设已删除');
            }
        });
    }
}

// --- 模型拉取 ---
function populateNovelAIModels(modelSelect) {
    const models = [
        { id: 'nai-diffusion-4-curated', name: 'NovelAI Diffusion V4 Curated' },
        { id: 'nai-diffusion-4-full', name: 'NovelAI Diffusion V4 Full' },
        { id: 'nai-diffusion-4-5-curated', name: 'NovelAI Diffusion V4.5 Curated' },
        { id: 'nai-diffusion-4-5-full', name: 'NovelAI Diffusion V4.5 Full' },
        { id: 'nai-diffusion-3', name: 'NovelAI Diffusion V3' },
        { id: 'nai-diffusion-2', name: 'NovelAI Diffusion V2' },
        { id: 'nai-diffusion-furry', name: 'NovelAI Diffusion Furry' },
        { id: 'safe-diffusion', name: 'Safe Diffusion' }
    ];
    
    modelSelect.innerHTML = '<option value="">请选择模型</option>';
    models.forEach(m => {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = m.name;
        modelSelect.appendChild(option);
    });
    
    // 恢复之前选中的模型
    if (db.workshopSettings && db.workshopSettings.novelaiModel) {
        modelSelect.value = db.workshopSettings.novelaiModel;
    }
}

function populateGPTModels(modelSelect) {
    const models = [
        { id: 'dall-e-3', name: 'DALL·E 3' },
        { id: 'dall-e-2', name: 'DALL·E 2' }
    ];
    
    modelSelect.innerHTML = '<option value="">请选择模型</option>';
    models.forEach(m => {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = m.name;
        modelSelect.appendChild(option);
    });
    
    // 恢复之前选中的模型
    if (db.workshopSettings && db.workshopSettings.gptModel) {
        modelSelect.value = db.workshopSettings.gptModel;
    }
}

async function fetchGPTModels(apiUrl, apiKey, modelSelect, selectedModel = '', { signal, isCurrent = () => true } = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    try {
        const baseUrl = apiUrl.trim().replace(/\/+$/, '').replace(/\/images\/generations$/, '');
        const endpoint = new URL(baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`);
        if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('请填写有效的 HTTP 或 HTTPS API 地址');
        const response = await fetch(endpoint.href, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const limit = 2 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > limit) {
            void response.body?.cancel().catch(() => {});
            throw new Error('模型列表响应过大');
        }
        const reader = response.body?.getReader();
        let text = '';
        if (reader) {
            const decoder = new TextDecoder(); let size = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > limit) throw new Error('模型列表响应过大');
                    text += decoder.decode(value, { stream: true });
                }
                text += decoder.decode();
            } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
        } else {
            text = await response.text();
            if (new TextEncoder().encode(text).byteLength > limit) throw new Error('模型列表响应过大');
        }
        let data;
        try { data = JSON.parse(text); } catch (_) { throw new Error('模型列表不是有效的 JSON'); }
        if (!data || data.error || !Array.isArray(data.data) || data.data.length > 10000 ||
            data.data.some(model => !model || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 1024)) {
            throw new Error('模型列表格式无效，未更新现有列表');
        }
        const models = [...new Set(data.data.map(model => model.id))];
        if (controller.signal.aborted || !isCurrent()) return false;
        
        modelSelect.innerHTML = '<option value="">请选择模型</option>';
        
        models.forEach(id => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = id;
            modelSelect.appendChild(option);
        });
        
        if (selectedModel) {
            modelSelect.value = selectedModel;
        }
        
        return true;
    } catch (error) {
        if (timedOut) throw new Error('拉取模型超时，请重试');
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        controller.abort();
    }
}

function initWorkshopModels() {
    const fetchBtn = document.getElementById('workshop-fetch-models-btn');
    const modelSelect = document.getElementById('workshop-api-model');
    if (!fetchBtn || !modelSelect) return;
    // Reinitialization and settings changes retire only this model-list request.
    fetchBtn._disposeModelRequest?.();
    const bindings = new AbortController();
    let activeRequest = null;
    const cancelRequest = () => {
        if (!activeRequest) return;
        const request = activeRequest; activeRequest = null;
        request.controller.abort();
        fetchBtn.textContent = request.buttonText;
        fetchBtn.disabled = false;
    };
    fetchBtn._disposeModelRequest = () => { cancelRequest(); bindings.abort(); };
    const listen = (target, type, handler) => target?.addEventListener(type, handler, { signal: bindings.signal });
    for (const id of ['workshop-api-url', 'workshop-api-key', 'workshop-api-preset-select', 'workshop-api-protocol']) {
        listen(document.getElementById(id), 'input', cancelRequest);
        listen(document.getElementById(id), 'change', cancelRequest);
    }
    
    // 绑定模型选择事件
    listen(modelSelect, 'change', async (e) => {
        cancelRequest();
        if (!db.workshopSettings) return;
        const activeRadio = document.querySelector('input[name="workshop-provider"]:checked');
        const provider = activeRadio ? activeRadio.value : 'novelai';
        
        const settings = db.workshopSettings;
        const key = provider === 'novelai' ? 'novelaiModel' : provider === 'gpt' ? 'gptModel' : null;
        if (!key) return;
        if (!await saveLocalSettingsFields([{target:settings,values:{[key]:e.target.value}}])
            && db.workshopSettings === settings) modelSelect.value = settings[key] || '';
    });
    
    // 自动填充模型列表
    const providerRadios = document.querySelectorAll('input[name="workshop-provider"]');
    if (providerRadios.length > 0) {
        const updateModels = () => {
            // Saving an unchanged API can emit this event after a new fetch has begun.
            if (activeRequest?.isCurrent()) return;
            cancelRequest();
            const activeRadio = document.querySelector('input[name="workshop-provider"]:checked');
            const provider = activeRadio ? activeRadio.value : 'novelai';
            if (provider === 'novelai') {
                populateNovelAIModels(modelSelect);
            } else if (provider === 'gpt') {
                populateGPTModels(modelSelect);
            } else {
                modelSelect.innerHTML = '<option value="">请选择模型</option>';
            }
        };
        
        updateModels();
        providerRadios.forEach(radio => listen(radio, 'change', updateModels));
        listen(document, 'workshop-api-protocol-change', updateModels);
    }
    
    listen(fetchBtn, 'click', async () => {
        if (activeRequest) return;
        const activeRadio = document.querySelector('input[name="workshop-provider"]:checked');
        const provider = activeRadio ? activeRadio.value : 'novelai';
        const apiUrl = document.getElementById('workshop-api-url').value;
        const apiKey = document.getElementById('workshop-api-key').value;
        
        if (!['novelai', 'gpt'].includes(provider)) return showToast('未知的服务商');
        if (!apiUrl || !apiKey) return showToast('请先填写 API 地址和密钥');
        const targetDb = db, settings = db.workshopSettings, preset = getActiveWorkshopApiPreset();
        const presetId = settings.activeApiPresetId?.[provider];
        const protocol = preset?.protocol;
        const request = { controller: new AbortController(), buttonText: fetchBtn.textContent };
        activeRequest = request;
        const isCurrent = () => activeRequest === request && db === targetDb && db.workshopSettings === settings &&
            (settings.provider || 'novelai') === provider && settings.activeApiPresetId?.[provider] === presetId &&
            getActiveWorkshopApiPreset() === preset && preset?.protocol === protocol && modelSelect.isConnected &&
            document.querySelector('input[name="workshop-provider"]:checked')?.value === provider &&
            document.getElementById('workshop-api-url').value === apiUrl && document.getElementById('workshop-api-key').value === apiKey;
        request.isCurrent = isCurrent;
        fetchBtn.textContent = '拉取中...'; fetchBtn.disabled = true;
        try {
            if (provider === 'novelai' && preset?.protocol !== 'openai') {
                populateNovelAIModels(modelSelect);
            } else if (!await fetchGPTModels(apiUrl, apiKey, modelSelect, settings[provider === 'gpt' ? 'gptModel' : 'novelaiModel'] || '',
                { signal: request.controller.signal, isCurrent })) return;
            if (isCurrent()) showToast('模型列表已更新');
        } catch (error) {
            if (isCurrent()) showToast('拉取模型失败: ' + error.message);
        } finally {
            if (activeRequest === request) cancelRequest();
        }
    });
}
