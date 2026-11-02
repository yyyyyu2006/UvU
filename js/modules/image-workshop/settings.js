// --- 设置绑定与持久化 ---
async function initWorkshopSettings() {
    if (!db.workshopSettings) return;

    const settings = db.workshopSettings;
    
    // 初始化 API 预设数据结构
    if (!settings.apiPresets) {
        settings.apiPresets = {
            novelai: [
                { id: 'official', name: '官方默认', url: 'https://image.novelai.net/ai/generate-image-stream', key: '', protocol: 'novelai', responseFormat: 'auto' }
            ],
            gpt: [
                { id: 'official', name: '官方默认', url: 'https://api.openai.com/v1/images/generations', key: '', protocol: 'openai', responseFormat: 'auto' }
            ]
        };
    }
    if (!settings.activeApiPresetId) {
        settings.activeApiPresetId = {
            novelai: 'official',
            gpt: 'official'
        };
    }

    // 旧预设没有协议字段：NovelAI 保持原生逻辑，GPT 保持 OpenAI 逻辑。
    Object.entries(settings.apiPresets).forEach(([provider, presets]) => {
        (presets || []).forEach(preset => {
            if (!preset.protocol) preset.protocol = provider === 'novelai' ? 'novelai' : 'openai';
            if (!preset.responseFormat) preset.responseFormat = 'auto';
        });
    });
    
    // 迁移旧数据到预设
    if (settings.novelaiApiUrl && settings.novelaiApiUrl !== 'https://image.novelai.net/ai/generate-image-stream') {
        const existing = settings.apiPresets.novelai.find(p => p.url === settings.novelaiApiUrl);
        if (!existing) {
            const newId = 'preset_' + Date.now();
            settings.apiPresets.novelai.push({
                id: newId,
                name: '自定义节点',
                url: settings.novelaiApiUrl,
                key: settings.novelaiApiKey || '',
                protocol: 'novelai',
                responseFormat: 'auto'
            });
            settings.activeApiPresetId.novelai = newId;
        }
    } else if (settings.novelaiApiKey) {
        const official = settings.apiPresets.novelai.find(p => p.id === 'official');
        if (official) official.key = settings.novelaiApiKey;
    }

    if (settings.gptApiUrl && settings.gptApiUrl !== 'https://api.openai.com/v1/images/generations') {
        const existing = settings.apiPresets.gpt.find(p => p.url === settings.gptApiUrl);
        if (!existing) {
            const newId = 'preset_' + Date.now();
            settings.apiPresets.gpt.push({
                id: newId,
                name: '自定义节点',
                url: settings.gptApiUrl,
                key: settings.gptApiKey || '',
                protocol: 'openai',
                responseFormat: 'auto'
            });
            settings.activeApiPresetId.gpt = newId;
        }
    } else if (settings.gptApiKey) {
        const official = settings.apiPresets.gpt.find(p => p.id === 'official');
        if (official) official.key = settings.gptApiKey;
    }
    
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
            settings[key] = isNumber ? Number(e.target.value) : e.target.value;
            await saveData();
        });
        // 保留 change 事件以兼容某些特殊情况或程序触发的更新
        el.addEventListener('change', async (e) => {
            settings[key] = isNumber ? Number(e.target.value) : e.target.value;
            await saveData();
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
            settings[key] = e.target.checked;
            await saveData();
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
                    settings[key] = e.target.value;
                    await saveData();
                    if (onChangeCallback) {
                        onChangeCallback(e.target.value);
                    }
                }
            });
        });
    };

    // 绑定基础设置
    bindRadioGroup('workshop-provider', 'provider');
    
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
    if (!db.workshopSettings) return;

    const presets = Array.isArray(db.apiPresets) ? db.apiPresets : [];
    const selectConfigs = [
        { id: 'workshop-llm-api-preset', settingKey: 'llmApiPresetId' },
        { id: 'workshop-gpt-llm-api-preset', settingKey: 'gptLlmApiPresetId' }
    ];
    let settingsChanged = false;

    selectConfigs.forEach(({ id, settingKey }) => {
        const select = document.getElementById(id);
        if (!select) return;

        let selectedId = db.workshopSettings[settingKey] || '';
        // 兼容曾经手动写入预设名称的旧数据。
        const legacyPreset = presets.find(p => p && p.name === selectedId);
        if (legacyPreset && typeof _createApiPresetId === 'function') {
            if (!legacyPreset.id) legacyPreset.id = _createApiPresetId();
            selectedId = legacyPreset.id;
            db.workshopSettings[settingKey] = selectedId;
            settingsChanged = true;
        }

        select.innerHTML = '<option value="">请选择</option>';
        presets.forEach(preset => {
            if (!preset || !preset.id || !preset.name || !preset.data) return;
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name;
            select.appendChild(option);
        });

        if (selectedId && presets.some(p => p.id === selectedId)) {
            select.value = selectedId;
        } else if (selectedId) {
            db.workshopSettings[settingKey] = '';
            select.value = '';
            settingsChanged = true;
        }
    });

    if (settingsChanged) saveData();
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
            if (preset) preset.responseFormat = 'auto';
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
    
    // 切换预设
    select.addEventListener('change', async (e) => {
        const provider = db.workshopSettings.provider || 'novelai';
        db.workshopSettings.activeApiPresetId[provider] = e.target.value;
        await saveData();
        updateApiPresetList();
    });
    
    // 实时保存 URL 和 Key 到当前预设
    const saveCurrentPreset = async () => {
        const provider = db.workshopSettings.provider || 'novelai';
        const activeId = db.workshopSettings.activeApiPresetId[provider];
        const presets = db.workshopSettings.apiPresets[provider];
        const preset = presets.find(p => p.id === activeId);
        
        if (preset) {
            preset.url = urlInput.value.trim();
            preset.key = keyInput.value.trim();
            
            // 同步更新旧的全局字段以兼容旧代码
            db.workshopSettings[provider + 'ApiUrl'] = preset.url;
            db.workshopSettings[provider + 'ApiKey'] = preset.key;
            
            await saveData();
        }
    };
    
    urlInput.addEventListener('input', saveCurrentPreset);
    keyInput.addEventListener('input', saveCurrentPreset);
    
    // 新建预设
    const newBtn = document.getElementById('workshop-new-api-preset-btn');
    if (newBtn) {
        newBtn.addEventListener('click', async () => {
            const provider = db.workshopSettings.provider || 'novelai';
            const name = prompt('请输入新预设名称：');
            if (!name) return;
            
            const newPreset = {
                id: 'preset_' + Date.now(),
                name: name,
                url: '',
                key: '',
                protocol: provider === 'novelai' ? 'novelai' : 'openai',
                responseFormat: 'auto'
            };
            
            db.workshopSettings.apiPresets[provider].push(newPreset);
            db.workshopSettings.activeApiPresetId[provider] = newPreset.id;
            await saveData();
            updateApiPresetList();
            showToast('已创建新预设');
        });
    }

    // 另存为新预设
    saveBtn.addEventListener('click', async () => {
        const provider = db.workshopSettings.provider || 'novelai';
        const name = prompt('请输入新预设名称：');
        if (!name) return;
        
        const newPreset = {
            id: 'preset_' + Date.now(),
            name: name,
            url: urlInput.value.trim(),
            key: keyInput.value.trim(),
            protocol: provider === 'novelai' ? (protocolSelect?.value || 'novelai') : 'openai',
            responseFormat: responseFormatSelect?.value || 'auto'
        };
        
        db.workshopSettings.apiPresets[provider].push(newPreset);
        db.workshopSettings.activeApiPresetId[provider] = newPreset.id;
        await saveData();
        updateApiPresetList();
        showToast('预设保存成功');
    });

    if (protocolSelect) {
        protocolSelect.addEventListener('change', async (e) => {
            const preset = getActiveWorkshopApiPreset();
            if (!preset) return;
            preset.protocol = e.target.value;
            if (!preset.responseFormat) preset.responseFormat = 'auto';
            await saveData();
            updateApiProtocolUI();
        });
    }

    if (responseFormatSelect) {
        responseFormatSelect.addEventListener('change', async (e) => {
            const preset = getActiveWorkshopApiPreset();
            if (!preset) return;
            preset.responseFormat = e.target.value;
            await saveData();
        });
    }

    if (customModelInput) {
        customModelInput.addEventListener('input', async (e) => {
            db.workshopSettings.novelaiModel = e.target.value.trim();
            await saveData();
        });
    }
    
    // 删除预设
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const provider = db.workshopSettings.provider || 'novelai';
            const activeId = db.workshopSettings.activeApiPresetId[provider];
            
            if (activeId === 'official') {
                showToast('官方预设不可删除');
                return;
            }
            
            if (confirm('确定要删除当前预设吗？')) {
                db.workshopSettings.apiPresets[provider] = db.workshopSettings.apiPresets[provider].filter(p => p.id !== activeId);
                db.workshopSettings.activeApiPresetId[provider] = 'official';
                await saveData();
                updateApiPresetList();
                showToast('预设已删除');
            }
        });
    }
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
            
            // 手动触发 input 和 change 事件以保存到 settings
            positiveInput.dispatchEvent(new Event('input'));
            if (characterInput) characterInput.dispatchEvent(new Event('input'));
            negativeInput.dispatchEvent(new Event('input'));
            positiveInput.dispatchEvent(new Event('change'));
            if (characterInput) characterInput.dispatchEvent(new Event('change'));
            negativeInput.dispatchEvent(new Event('change'));
            
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
            id: 'prompt_preset_' + Date.now(),
            name: name,
            positive: positive,
            character: character,
            negative: negative
        };

        db.workshopPromptPresets.push(newPreset);
        await saveData();
        
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
                db.workshopPromptPresets[presetIndex].positive = positiveInput.value.trim();
                db.workshopPromptPresets[presetIndex].character = characterInput ? characterInput.value.trim() : '';
                db.workshopPromptPresets[presetIndex].negative = negativeInput.value.trim();
                
                await saveData();
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
                db.workshopPromptPresets = db.workshopPromptPresets.filter(p => p.id !== presetId);
                await saveData();
                
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

async function fetchGPTModels(apiUrl, apiKey, modelSelect, selectedModel = '') {
    try {
        let baseUrl = apiUrl;
        if (baseUrl.endsWith('/images/generations')) {
            baseUrl = baseUrl.replace('/images/generations', '');
        }
        if (!baseUrl.endsWith('/')) {
            baseUrl += '/';
        }
        
        const response = await fetch(`${baseUrl}models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const models = data.data || [];
        
        modelSelect.innerHTML = '<option value="">请选择模型</option>';
        
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = m.id;
            modelSelect.appendChild(option);
        });
        
        if (selectedModel) {
            modelSelect.value = selectedModel;
        }
        
        return true;
    } catch (error) {
        console.error('Fetch GPT models error:', error);
        throw error;
    }
}

function initWorkshopModels() {
    const fetchBtn = document.getElementById('workshop-fetch-models-btn');
    const modelSelect = document.getElementById('workshop-api-model');
    if (!fetchBtn || !modelSelect) return;
    
    // 绑定模型选择事件
    modelSelect.addEventListener('change', async (e) => {
        if (!db.workshopSettings) return;
        const activeRadio = document.querySelector('input[name="workshop-provider"]:checked');
        const provider = activeRadio ? activeRadio.value : 'novelai';
        
        if (provider === 'novelai') {
            db.workshopSettings.novelaiModel = e.target.value;
        } else if (provider === 'gpt') {
            db.workshopSettings.gptModel = e.target.value;
        }
        if (typeof saveData === 'function') {
            await saveData();
        }
    });
    
    // 自动填充模型列表
    const providerRadios = document.querySelectorAll('input[name="workshop-provider"]');
    if (providerRadios.length > 0) {
        const updateModels = () => {
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
        providerRadios.forEach(radio => radio.addEventListener('change', updateModels));
        document.addEventListener('workshop-api-protocol-change', updateModels);
    }
    
    fetchBtn.addEventListener('click', async () => {
        const activeRadio = document.querySelector('input[name="workshop-provider"]:checked');
        const provider = activeRadio ? activeRadio.value : 'novelai';
        const apiUrl = document.getElementById('workshop-api-url').value;
        const apiKey = document.getElementById('workshop-api-key').value;
        
        if (provider === 'novelai') {
            if (!apiUrl || !apiKey) {
                showToast('请先填写 API 地址和密钥');
                return;
            }
            
            const originalText = fetchBtn.textContent;
            fetchBtn.textContent = '拉取中...';
            fetchBtn.disabled = true;
            
            try {
                const preset = getActiveWorkshopApiPreset();
                const protocol = preset?.protocol || 'novelai';
                if (protocol === 'openai') {
                    await fetchGPTModels(apiUrl, apiKey, modelSelect, db.workshopSettings.novelaiModel || '');
                } else {
                    populateNovelAIModels(modelSelect);
                }
                showToast('模型列表已更新');
            } catch (error) {
                console.error('Fetch models error:', error);
                showToast('拉取模型失败: ' + error.message);
            } finally {
                fetchBtn.textContent = originalText;
                fetchBtn.disabled = false;
            }
        } else if (provider === 'gpt') {
            if (!apiUrl || !apiKey) {
                showToast('请先填写 API 地址和密钥');
                return;
            }
            
            const originalText = fetchBtn.textContent;
            fetchBtn.textContent = '拉取中...';
            fetchBtn.disabled = true;
            
            try {
                await fetchGPTModels(apiUrl, apiKey, modelSelect);
                showToast('模型列表已更新');
            } catch (error) {
                console.error('Fetch models error:', error);
                showToast('拉取模型失败: ' + error.message);
                // 失败时回退到默认模型
                populateGPTModels(modelSelect);
            } finally {
                fetchBtn.textContent = originalText;
                fetchBtn.disabled = false;
            }
        } else {
            showToast('未知的服务商');
        }
    });
}
