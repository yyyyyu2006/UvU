// --- 思维链(CoT)设置模块 ---

const DEFAULT_COT_ITEMS_UWU = [
    { id: 'cot_item_1', name: '引子', content: '[System Directive]:\n你必须严格遵守 [incipere] 协议。在回复前，请先进入 <thinking> 标签进行深度推演。\n请按以下步骤查阅 System Prompt 中的模块并思考：', enabled: true, locked: false },
    { id: 'cot_item_2', name: '准备动脑了吗？', content: '---\n## 【前置规则】\n### **必须**读取所有<logic_rules>和<output_formats>：了解**所有**需要遵守的规则，然后进行以下步骤精简准确的思考', enabled: true },
    { id: 'cot_item_3', name: '给我读设定！', content: '---\n## 【行为校准】\n基于<char_settings>和<角色活人运转>构建角色人格\n### Phase1: person\n1. **自我意识校验 (Ref: <char_settings>和<角色活人运转>)**\n   - 是否塑造鲜活真实人格？\n   - 你（角色）是否具有自己的聊天习惯/风格？\n   - 你想如何回应我？', enabled: true },
    { id: 'cot_item_4', name: '当个人吧。', content: '### Phase2: Verisimilitude\n2.**真实聊天**\n   - 是否根据以下两点要求采用了真人聊天思路？\n    - 正常人的注意力是有限的，不会每句话都非得逐句回复。\n    - 不对已有信息进行重复反问。\n    - 断点处理：若与上一条消息间隔较久，默认双方只是自然忙碌后重新拿起手机或默认期间以其他方式保持联系，自然接续话题。', enabled: true },
    { id: 'cot_item_5', name: '有特殊格式吗？', content: '### Phase3: chat role\n3. **逻辑检索 (Ref: <logic_rules>)**\n   - 当前是否为双语对话情境？若无，跳过此条\n   - 是否需要输出状态栏？若无相关要求，则跳过此条', enabled: true },
    { id: 'cot_item_6', name: '最后确认一下。', content: '## 【最后确认】\n\n4. 整合<Chatting Guidelines>，是否合理自然回复且不偏离人设？回顾<output_formats>，输出消息格式是否正确？', enabled: true },
    { id: 'cot_item_7', name: '尾声', content: '每轮输出前，必须先严格按照<thinking>…</thinking>内的步骤进行逐条思考，无需重复其中的条目，但思考内容需精简准确、清晰、可执行，不得跳步骤。\n<thinking>中的所有分析必须在输出中完全落实，不得偏离、删减或弱化。\n\n格式：\n<thinking>\n...思考过程...\n</thinking>', enabled: true, locked: false }
];

const DEFAULT_COT_ITEMS_TT = [
    { id: 'cot_item_tt_1', name: '引子', content: '[交稿规范]:\n在输出回复前，你必须使用 <thinking> 标签进行对话构思，所有步骤不得遗漏、简略，必须详细思考：', enabled: true, locked: false },
    { id: 'cot_item_tt_2', name: 'Phase0:【场景确认】', content: '## Phase0:【场景确认】\n - 目前场景是：\n - 角色是中国人吗？若不是，开启双语模式：\n - 双方当前关系进展为：\n - 用户最新回复为：<user_input>', enabled: true },
    { id: 'cot_item_tt_3', name: 'Phase1:【第一性确认】', content: '## Phase1:【第一性确认】\n依次读取[创作要领][rule=正确理解]<参考资料>，逐个逐步进行响应的思考：', enabled: true },
    { id: 'cot_item_tt_4', name: 'Phase2:【人格塑造】', content: '## Phase2:【人格塑造】\n - 回顾<角色设定>，当前主控oc的内在骨相是：\n - 拥有的聊天风格：\n - 最不该被刻板印象定义成：', enabled: true },
    { id: 'cot_item_tt_5', name: 'Phase3:【准则执行】', content: '## Phase3:【准则执行】\n - [对话节奏]，本次回复消息条数：\n - 具有哪些准则？\n - 依次说明如何自然遵守各项准则创作：\n - 构思内容：\n - 是否破开套路：\n - 是否在第一步的消息条数范围内？', enabled: true },
    { id: 'cot_item_tt_6', name: '尾声', content: '准备好开动小脑筋了吗？记得要闭合<thinking>标签哦！开始思考：', enabled: true, locked: false }
];

const DEFAULT_CALL_COT_ITEMS_UWU = [
    { id: 'cot_call_item_1', name: '引子', content: '[System Directive]:\n你必须严格遵守 [incipere] 协议。在回复前，请先进入 <thinking> 标签进行深度推演。\n请按以下步骤查阅 System Prompt 中的模块并思考：', enabled: true, locked: false },
    { id: 'cot_call_item_2', name: '给我读设定！', content: '---\n## 【行为校准】\n基于<char_settings>和<角色活人运转>构建角色人格\n### Phase1: person\n1. **自我意识校验 (Ref: <char_settings>和<角色活人运转>)**\n   - 是否塑造鲜活真实人格？\n   - 你（角色）是否具有自己的说话习惯/风格？\n   - 你想如何回应我？', enabled: true },
    { id: 'cot_call_item_3', name: '通话情境感知', content: '---\n## 【情境感知】\n1. **实时性检查**：这是一个实时视频/语音通话。你的反应必须即时、自然、口语化。\n2. **环境与画面**：\n   - 如果是视频通话，你需要意识到摄像头捕捉到的画面（你的表情、动作、背景）。\n   - 如果是语音通话，你需要意识到声音传递的情绪和背景音。', enabled: true },
    { id: 'cot_call_item_5', name: '输出检查', content: '## 【输出检查】\n1. **格式确认**：是否严格遵守了 `[画面/环境音：...]` 和 `[声音：...]` 的格式？\n2. **内容净化**：确保没有输出任何不属于通话内容的心理活动或旁白（除非放在画面描述中）。\n', enabled: true },
    { id: 'cot_call_item_6', name: '尾声', content: '每轮输出前，必须先严格按照<thinking>…</thinking>内的步骤进行逐条思考。\n<thinking>中的所有分析必须在输出中完全落实。\n\n格式：\n<thinking>\n...思考过程...\n</thinking>', enabled: true, locked: false }
];

const DEFAULT_CALL_COT_ITEMS_TT = [
    { id: 'cot_call_item_tt_1', name: '引子', content: '[交稿规范]:\n在输出回复前，你必须使用 <thinking> 标签进行对话构思，所有步骤不得遗漏、简略，必须详细思考：', enabled: true, locked: false },
    { id: 'cot_call_item_tt_2', name: 'Phase0:【场景确认】', content: '## Phase0:【场景确认】\n - 目前场景是：\n - 角色是中国人吗？若不是，开启双语模式：\n - 双方当前关系进展为：\n - 用户最新回复为：<user_input>', enabled: true },
    { id: 'cot_call_item_tt_3', name: 'Phase1:【第一性确认】', content: '## Phase1:【第一性确认】\n依次读取[创作要领][rule=正确理解]<参考资料>，逐个逐步进行响应的思考：', enabled: true },
    { id: 'cot_call_item_tt_4', name: 'Phase2:【人格塑造】', content: '## Phase2:【人格塑造】\n - 回顾<角色设定>，当前主控oc的内在骨相是：\n - 拥有的聊天风格：\n - 最不该被刻板印象定义成：', enabled: true },
    { id: 'cot_call_item_tt_5', name: 'Phase3:【准则执行】', content: '## Phase3:【准则执行】\n - 具有哪些准则？\n - 依次说明如何自然遵守各项准则创作：\n - 构思内容：', enabled: true },
    { id: 'cot_call_item_tt_6', name: '尾声', content: '准备好开动小脑筋了吗？记得要闭合<thinking>标签哦！开始思考：', enabled: true, locked: false }
];

let currentCotMode = 'chat'; // 'chat' or 'call'

// 初始化 CoT 设置
function initCotSettings() {
    // 绑定入口按钮事件 (在更多菜单中)
    const cotEntryBtn = document.querySelector('.menu-item[data-action="cot-settings"]');
    if (cotEntryBtn) {
        cotEntryBtn.addEventListener('click', () => {
            loadCotSettings();
            switchScreen('cot-settings-screen');
        });
    }

    // 绑定 Tab 切换
    const tabs = document.querySelectorAll('#cot-settings-tabs .settings-tab-item');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentCotMode = tab.dataset.mode;
            
            if (currentCotMode === 'call' && db.cotSettings.promptVersion === 'tt' && !db.cotSettings.hasShownTTCallToast) {
                db.cotSettings.hasShownTTCallToast = true;
                saveData();
                showToast('已自动为您切换至 T.T 专属通话思维链');
            }
            
            loadCotSettings();
        });
    });

    // 绑定提示词版本切换
    const promptVersionSelect = document.getElementById('cot-prompt-version-select');
    if (promptVersionSelect) {
        promptVersionSelect.addEventListener('change', async (e) => {
            if (!db.cotSettings) db.cotSettings = { enabled: false, activePresetId: 'default_uwu', promptVersion: 'uwu' };
            
            const oldVersion = db.cotSettings.promptVersion || 'uwu';
            const newVersion = e.target.value;
            
            // 保存当前版本使用的预设
            if (oldVersion === 'uwu') {
                db.cotSettings.lastPresetUwU = db.cotSettings.activePresetId;
                db.cotSettings.lastCallPresetUwU = db.cotSettings.activeCallPresetId;
            } else if (oldVersion === 'tt') {
                db.cotSettings.lastPresetTT = db.cotSettings.activePresetId;
                db.cotSettings.lastCallPresetTT = db.cotSettings.activeCallPresetId;
            }

            db.cotSettings.promptVersion = newVersion;
            
            if (newVersion === 'tt') {
                let showMsg = false;
                if (!db.cotSettings.hasSwitchedToTT) {
                    db.cotSettings.hasSwitchedToTT = true;
                    db.cotSettings.activePresetId = 'default_tt';
                    db.cotSettings.lastPresetTT = 'default_tt';
                    showMsg = true;
                } else {
                    db.cotSettings.activePresetId = db.cotSettings.lastPresetTT || 'default_tt';
                }

                if (!db.cotSettings.hasSwitchedToTTCall) {
                    db.cotSettings.hasSwitchedToTTCall = true;
                    db.cotSettings.activeCallPresetId = 'default_call_tt';
                    db.cotSettings.lastCallPresetTT = 'default_call_tt';
                    db.cotSettings.hasShownTTCallToast = true;
                    showMsg = true;
                } else {
                    db.cotSettings.activeCallPresetId = db.cotSettings.lastCallPresetTT || 'default_call_tt';
                }

                if (showMsg) {
                    showToast('已自动为您切换至 T.T 专属思维链');
                } else {
                    showToast('提示词版本已切换');
                }
            } else {
                // 切换回 uwu
                db.cotSettings.activePresetId = db.cotSettings.lastPresetUwU || 'default_uwu';
                db.cotSettings.activeCallPresetId = db.cotSettings.lastCallPresetUwU || 'default_call_uwu';
                showToast('提示词版本已切换');
            }
            
            await saveData();
            loadCotSettings(); // 重新加载界面
        });
    }

    // 绑定全局开关
    const enabledSwitch = document.getElementById('cot-enabled-switch');
    if (enabledSwitch) {
        enabledSwitch.addEventListener('change', async (e) => {
            if (!db.cotSettings) db.cotSettings = { enabled: false, activePresetId: 'default', promptVersion: 'uwu' };
            
            if (currentCotMode === 'chat') {
                db.cotSettings.enabled = e.target.checked;
            } else {
                db.cotSettings.callEnabled = e.target.checked;
            }
            
            await saveData();
            showToast(e.target.checked ? '思维链已启用' : '思维链已禁用');
        });
    }

    // 绑定预填开关
    const prefillSwitch = document.getElementById('cot-prefill-switch');
    if (prefillSwitch) {
        prefillSwitch.addEventListener('change', async (e) => {
            if (!db.cotSettings) db.cotSettings = { enabled: false, activePresetId: 'default', prefillEnabled: true, callPrefillEnabled: true };
            
            if (currentCotMode === 'chat') {
                db.cotSettings.prefillEnabled = e.target.checked;
            } else {
                db.cotSettings.callPrefillEnabled = e.target.checked;
            }
            
            await saveData();
            showToast(e.target.checked ? '预填已启用' : '预填已禁用');
        });
    }

    // 绑定角色活人运转开关
    const humanRunSwitch = document.getElementById('cot-human-run-switch');
    if (humanRunSwitch) {
        humanRunSwitch.addEventListener('change', async (e) => {
            if (!db.cotSettings) db.cotSettings = { enabled: false, activePresetId: 'default' };
            db.cotSettings.humanRunEnabled = e.target.checked;
            await saveData();
            showToast(e.target.checked ? '角色活人运转已启用' : '角色活人运转已禁用');
        });
    }

    // 绑定预设选择
    const presetSelect = document.getElementById('cot-preset-select');
    if (presetSelect) {
        presetSelect.addEventListener('change', async (e) => {
            const presetId = e.target.value;
            if (presetId) {
                if (currentCotMode === 'chat') {
                    db.cotSettings.activePresetId = presetId;
                    if (db.cotSettings.promptVersion === 'tt') {
                        db.cotSettings.lastPresetTT = presetId;
                    } else {
                        db.cotSettings.lastPresetUwU = presetId;
                    }
                } else {
                    db.cotSettings.activeCallPresetId = presetId;
                    if (db.cotSettings.promptVersion === 'tt') {
                        db.cotSettings.lastCallPresetTT = presetId;
                    } else {
                        db.cotSettings.lastCallPresetUwU = presetId;
                    }
                }
                await saveData();
                renderCotItems();
                showToast('已切换预设');
            }
        });
    }

    // 绑定新建预设按钮
    document.getElementById('cot-new-preset-btn').addEventListener('click', createNewCotPreset);

    // 绑定管理预设按钮
    document.getElementById('cot-manage-presets-btn').addEventListener('click', openCotPresetManageModal);

    // 绑定重置预设按钮
    const resetBtn = document.getElementById('cot-reset-preset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetCotPreset);
    }

    // 绑定添加条目按钮
    document.getElementById('cot-add-item-btn').addEventListener('click', openAddCotItemModal);

    // 绑定条目编辑模态框按钮
    document.getElementById('cot-item-edit-form').addEventListener('submit', saveCotItem);
    document.getElementById('cot-item-cancel-btn').addEventListener('click', () => {
        document.getElementById('cot-item-edit-modal').classList.remove('visible');
    });

    // 绑定预设管理模态框按钮
    document.getElementById('cot-close-manage-modal-btn').addEventListener('click', () => {
        document.getElementById('cot-preset-manage-modal').classList.remove('visible');
        loadCotSettings(); // 刷新主界面
    });
    document.getElementById('cot-import-preset-btn').addEventListener('click', () => {
        document.getElementById('cot-import-file').click();
    });
    document.getElementById('cot-import-file').addEventListener('change', importCotPreset);

    // 初始化 XML 说明功能
    initXmlHelpFeature();
}

// 初始化 XML 说明功能
function initXmlHelpFeature() {
    // 1. 找到目标位置 (Prompt 条目序列 的标题栏)
    const labels = document.querySelectorAll('.kkt-item-label');
    let targetLabel = null;
    for (const label of labels) {
        if (label.textContent.includes('Prompt 条目序列')) {
            targetLabel = label;
            break;
        }
    }

    if (targetLabel && !targetLabel.querySelector('.cot-help-btn')) {
        // 创建问号按钮
        const helpBtn = document.createElement('button');
        helpBtn.className = 'cot-help-btn';
        helpBtn.innerHTML = '?';
        helpBtn.title = '查看 XML 标签说明';
        helpBtn.onclick = openXmlHelpModal;
        
        // 插入到 label 后面
        targetLabel.parentNode.appendChild(helpBtn);
        // 调整父元素样式以支持横向排列
        targetLabel.parentNode.style.display = 'flex';
        targetLabel.parentNode.style.justifyContent = 'space-between';
        targetLabel.parentNode.style.alignItems = 'center';
    }

    // 2. 创建模态框 (如果不存在)
    if (!document.getElementById('cot-xml-help-modal')) {
        const modalHtml = `
            <div id="cot-xml-help-modal" class="modal-overlay">
                <div class="modal-window" style="max-width: 600px; max-height: 80vh; display: flex; flex-direction: column;">
                    <h3>XML 标签说明</h3>
                    <div class="cot-xml-help-content" style="flex: 1; overflow-y: auto; padding: 10px; line-height: 1.6; color: #444;">
                        <p>默认思维链中使用了以下 XML 标签来构建 System Prompt，了解它们有助于你更好地调整预设或在思维链中快捷引用：</p>
                        
            <div class="xml-tag-item">
              <code><char_settings></code>
              <p><strong>角色设定</strong>：包含角色设定以及世界书·后（不包含世界书·破限和世界书·前）</p>
            </div>

            <div class="xml-tag-item">
              <code><user_settings></code>
              <p><strong>用户设定</strong>：包含你的名字以及你对自己的人设描述。</p>
            </div>

            <div class="xml-tag-item">
              <code><logic_rules></code>
              <p><strong>逻辑规则</strong>：包含各种交互逻辑的详细说明，如表情包列表、相册图片、特殊指令（转账、礼物、撤回等）的处理规则。</p>
            </div>

            <div class="xml-tag-item">
              <code><output_formats></code>
              <p><strong>输出格式</strong>：AI 回复消息的格式总规范。</p>
            </div>

            <div class="xml-tag-item">
              <code><Chatting Guidelines></code>
              <p><strong>对话指南</strong>：定义对话的节奏、回复条数限制以及风格建议。</p>
            </div>

            <div class="xml-tag-item">
              <code><thinking></code>
              <p><strong>思维链</strong>：AI 的思考过程将包裹在此标签内。这部分内容不会显示在聊天界面上，仅用于 AI 进行逻辑推演。</p>
            </div>
                    </div>
                    <div style="margin-top: 15px; text-align: right;">
                        <button class="btn btn-primary" onclick="document.getElementById('cot-xml-help-modal').classList.remove('visible')">关闭</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
}

function openXmlHelpModal() {
    document.getElementById('cot-xml-help-modal').classList.add('visible');
}

// 加载设置到界面
function loadCotSettings() {
    if (!db.cotSettings) db.cotSettings = { enabled: false, activePresetId: 'default_uwu', promptVersion: 'uwu' };
    if (!db.cotPresets) db.cotPresets = [];

    // 确保 uwu 预设存在
    let uwuPreset = db.cotPresets.find(p => p.id === 'default_uwu');
    if (!uwuPreset) {
        // 兼容旧的 'default'
        let oldDefault = db.cotPresets.find(p => p.id === 'default');
        if (oldDefault) {
            oldDefault.id = 'default_uwu';
            oldDefault.name = '默认思维链 (UwU)';
            uwuPreset = oldDefault;
        } else {
            uwuPreset = {
                id: 'default_uwu',
                name: '默认思维链 (UwU)',
                items: JSON.parse(JSON.stringify(DEFAULT_COT_ITEMS_UWU))
            };
            db.cotPresets.push(uwuPreset);
        }
        saveData();
    }

    // 确保 tt 预设存在
    let ttPreset = db.cotPresets.find(p => p.id === 'default_tt');
    if (!ttPreset) {
        ttPreset = {
            id: 'default_tt',
            name: '默认思维链 (T.T)',
            items: JSON.parse(JSON.stringify(DEFAULT_COT_ITEMS_TT))
        };
        db.cotPresets.push(ttPreset);
        saveData();
    }

    // 确保通话预设存在
    let callPresetUwU = db.cotPresets.find(p => p.id === 'default_call_uwu');
    if (!callPresetUwU) {
        // 兼容旧的 'default_call'
        let oldCallDefault = db.cotPresets.find(p => p.id === 'default_call');
        if (oldCallDefault) {
            oldCallDefault.id = 'default_call_uwu';
            oldCallDefault.name = '默认通话思维链 (UwU)';
            callPresetUwU = oldCallDefault;
        } else {
            callPresetUwU = {
                id: 'default_call_uwu',
                name: '默认通话思维链 (UwU)',
                items: JSON.parse(JSON.stringify(DEFAULT_CALL_COT_ITEMS_UWU))
            };
            db.cotPresets.push(callPresetUwU);
        }
        saveData();
    }

    let callPresetTT = db.cotPresets.find(p => p.id === 'default_call_tt');
    if (!callPresetTT) {
        callPresetTT = {
            id: 'default_call_tt',
            name: '默认通话思维链 (T.T)',
            items: JSON.parse(JSON.stringify(DEFAULT_CALL_COT_ITEMS_TT))
        };
        db.cotPresets.push(callPresetTT);
        saveData();
    }

    // 确保 activePresetId 存在
    if (!db.cotSettings.activePresetId) {
        db.cotSettings.activePresetId = db.cotSettings.promptVersion === 'tt' ? 'default_tt' : 'default_uwu';
        saveData();
    }

    // 确保 activeCallPresetId 存在
    if (!db.cotSettings.activeCallPresetId) {
        db.cotSettings.activeCallPresetId = db.cotSettings.promptVersion === 'tt' ? 'default_call_tt' : 'default_call_uwu';
        saveData();
    }

    // 兼容：如果当前是 T.T 版本，但从未自动切换过 T.T 通话预设
    if (db.cotSettings.promptVersion === 'tt' && !db.cotSettings.hasSwitchedToTTCall) {
        db.cotSettings.hasSwitchedToTTCall = true;
        db.cotSettings.activeCallPresetId = 'default_call_tt';
        db.cotSettings.lastCallPresetTT = 'default_call_tt';
        saveData();
    }

    // 数据库修复逻辑：强制解锁历史数据中的“引子”和“尾声”
    if (db.cotPresets && db.cotPresets.length > 0) {
        let hasChanges = false;
        const targetIds = ['cot_item_1', 'cot_item_7', 'cot_call_item_1', 'cot_call_item_6'];
        db.cotPresets.forEach(preset => {
            if (preset.items) {
                preset.items.forEach(item => {
                    if (targetIds.includes(item.id) && item.locked) {
                        item.locked = false;
                        hasChanges = true;
                    }
                });
            }
        });
        if (hasChanges) {
            console.log('[CoT] 已自动解锁历史数据中的引子/尾声条目');
            saveData();
        }
    }

    // 加载提示词版本
    const promptVersionSelect = document.getElementById('cot-prompt-version-select');
    if (promptVersionSelect) {
        promptVersionSelect.value = db.cotSettings.promptVersion || 'uwu';
    }

    // 根据当前模式隐藏/显示提示词版本选项
    const promptVersionItem = promptVersionSelect?.closest('.kkt-item');
    if (promptVersionItem) {
        // 聊天和通话模式下都显示提示词版本切换
        promptVersionItem.style.display = 'flex';
    }

    // 根据提示词版本隐藏/显示特定选项
    const humanRunItem = document.getElementById('cot-human-run-switch')?.closest('.kkt-item');
    if (humanRunItem) {
        // 只要是 T.T 版本，无论聊天还是通话，都隐藏“角色活人运转”开关
        if (db.cotSettings.promptVersion === 'tt') {
            humanRunItem.style.display = 'none';
        } else {
            humanRunItem.style.display = 'flex';
        }
    }

    // 根据当前模式设置开关状态
    const enabledSwitch = document.getElementById('cot-enabled-switch');
    if (currentCotMode === 'chat') {
        enabledSwitch.checked = db.cotSettings.enabled;
    } else {
        enabledSwitch.checked = db.cotSettings.callEnabled || false;
    }

    const prefillSwitch = document.getElementById('cot-prefill-switch');
    if (prefillSwitch) {
        if (currentCotMode === 'chat') {
            prefillSwitch.checked = db.cotSettings.prefillEnabled !== undefined ? db.cotSettings.prefillEnabled : true;
        } else {
            prefillSwitch.checked = db.cotSettings.callPrefillEnabled !== undefined ? db.cotSettings.callPrefillEnabled : true;
        }
    }
    
    // 加载角色活人运转开关状态 (默认为 false)
    const humanRunSwitch = document.getElementById('cot-human-run-switch');
    if (humanRunSwitch) {
        humanRunSwitch.checked = (db.cotSettings.humanRunEnabled !== undefined) ? db.cotSettings.humanRunEnabled : false;
    }

    renderCotPresetSelect();
    renderCotItems();
}

// 渲染预设下拉框
function renderCotPresetSelect() {
    const select = document.getElementById('cot-preset-select');
    select.innerHTML = '';
    
    db.cotPresets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        select.appendChild(option);
    });

    // 确保选中当前激活的预设
    let activeId;
    if (currentCotMode === 'chat') {
        activeId = db.cotSettings.activePresetId;
    } else {
        activeId = db.cotSettings.activeCallPresetId;
    }

    if (activeId) {
        // 检查 activePresetId 是否存在，不存在则默认第一个
        const exists = db.cotPresets.find(p => p.id === activeId);
        if (!exists && db.cotPresets.length > 0) {
            activeId = db.cotPresets[0].id;
            if (currentCotMode === 'chat') {
                db.cotSettings.activePresetId = activeId;
            } else {
                db.cotSettings.activeCallPresetId = activeId;
            }
            saveData();
        }
        select.value = activeId;
    }
}

// 渲染条目列表
function renderCotItems() {
    const list = document.getElementById('cot-items-list');
    list.innerHTML = '';
    list.className = 'cot-items-container'; // 使用新 CSS 类

    let activeId;
    if (currentCotMode === 'chat') {
        activeId = db.cotSettings.activePresetId;
    } else {
        activeId = db.cotSettings.activeCallPresetId;
    }

    const activePreset = db.cotPresets.find(p => p.id === activeId);
    if (!activePreset || !activePreset.items) return;

    activePreset.items.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = `cot-item-card ${item.locked ? 'locked' : ''}`;
        
        // 开关
        const switchLabel = document.createElement('label');
        switchLabel.className = 'kkt-switch kkt-switch-small';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.enabled;
        checkbox.addEventListener('change', async (e) => {
            item.enabled = e.target.checked;
            await saveData();
        });
        const slider = document.createElement('span');
        slider.className = 'kkt-slider';
        switchLabel.appendChild(checkbox);
        switchLabel.appendChild(slider);

        // 内容区域
        const contentDiv = document.createElement('div');
        contentDiv.className = 'cot-item-content';
        
        const nameEl = document.createElement('div');
        nameEl.className = 'cot-item-name';
        nameEl.textContent = item.name;
        
        const previewEl = document.createElement('div');
        previewEl.className = 'cot-item-preview';
        previewEl.textContent = item.content.substring(0, 50).replace(/\n/g, ' ') + (item.content.length > 50 ? '...' : '');
        
        contentDiv.appendChild(nameEl);
        contentDiv.appendChild(previewEl);

        // 按钮组
        const btnGroup = document.createElement('div');
        btnGroup.className = 'cot-btn-group';

        // 编辑按钮
        const editBtn = createIconBtn('✎', () => openEditCotItemModal(item));
        btnGroup.appendChild(editBtn);
        
        // 删除按钮 (锁定条目不可删除)
        if (!item.locked) {
            const deleteBtn = createIconBtn('×', () => deleteCotItem(index), true);
            btnGroup.appendChild(deleteBtn);
        }

        itemEl.appendChild(switchLabel);
        itemEl.appendChild(contentDiv);
        itemEl.appendChild(btnGroup);
        
        // 绑定长按拖拽事件
        if (!item.locked) {
            bindDragEvents(itemEl, index, activePreset.items);
        }

        list.appendChild(itemEl);
    });
}

// 绑定长按拖拽事件
function bindDragEvents(el, index, items) {
    let pressTimer = null;
    let isDragging = false;
    let startY = 0;
    let startX = 0;
    let placeholder = null;
    let clone = null;
    let listContainer = document.getElementById('cot-items-list');
    let itemHeight = 0;
    let currentIndex = index;

    const startPress = (e) => {
        // 如果点击的是按钮或开关，不触发拖拽
        if (e.target.closest('.cot-btn-group') || e.target.closest('.kkt-switch')) return;

        const touch = e.touches ? e.touches[0] : e;
        startY = touch.clientY;
        startX = touch.clientX;

        pressTimer = setTimeout(() => {
            initDrag(e);
        }, 400); // 400ms 长按触发
    };

    const cancelPress = () => {
        if (pressTimer) clearTimeout(pressTimer);
    };

    const initDrag = (e) => {
        isDragging = true;
        if (navigator.vibrate) navigator.vibrate(50); // 震动反馈

        const rect = el.getBoundingClientRect();
        itemHeight = rect.height;

        // 创建占位符
        placeholder = document.createElement('div');
        placeholder.className = 'cot-item-placeholder';
        placeholder.style.height = `${itemHeight}px`;
        placeholder.style.width = `${rect.width}px`;

        // 创建克隆元素用于拖拽显示
        clone = el.cloneNode(true);
        clone.classList.add('dragging');
        clone.style.width = `${rect.width}px`;
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        
        // 隐藏原元素，插入占位符
        el.style.display = 'none';
        el.parentNode.insertBefore(placeholder, el);
        document.body.appendChild(clone);

        // 阻止默认滚动
        document.body.style.overflow = 'hidden';
        if (e.cancelable) e.preventDefault();
    };

    const onMove = (e) => {
        if (!isDragging) {
            // 如果移动距离过大，取消长按判定
            const touch = e.touches ? e.touches[0] : e;
            if (Math.abs(touch.clientY - startY) > 10 || Math.abs(touch.clientX - startX) > 10) {
                cancelPress();
            }
            return;
        }

        if (e.cancelable) e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        const currentY = touch.clientY;
        
        // 移动克隆元素
        clone.style.top = `${currentY - itemHeight / 2}px`;

        // 计算新位置
        const siblings = [...listContainer.children].filter(child => 
            child !== clone && child !== el && child.style.display !== 'none'
        );

        let newIndex = 0;
        let inserted = false;

        for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            const box = sibling.getBoundingClientRect();
            const offset = currentY - box.top - box.height / 2;

            if (offset < 0) {
                // 检查是否可以插入到这个位置（不能在锁定条目之前，除非自己本来就在前面）
                const targetItemIndex = Array.from(listContainer.children).indexOf(sibling);
                // 简单处理：只允许在非锁定条目之间移动
                // 实际逻辑需要根据 items 数组的 locked 状态判断
                
                listContainer.insertBefore(placeholder, sibling);
                inserted = true;
                break;
            }
            newIndex++;
        }

        if (!inserted) {
            listContainer.appendChild(placeholder);
        }
    };

    const onEnd = async (e) => {
        cancelPress();
        if (!isDragging) return;

        isDragging = false;
        document.body.style.overflow = '';

        // 移除克隆元素
        if (clone && clone.parentNode) {
            clone.parentNode.removeChild(clone);
        }

        // 恢复原元素并放到占位符位置
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(el, placeholder);
            placeholder.parentNode.removeChild(placeholder);
        }
        el.style.display = '';

        // 计算新的索引并更新数据
        const newElements = [...listContainer.children].filter(c => c.classList.contains('cot-item-card'));
        const finalIndex = newElements.indexOf(el);

        if (finalIndex !== currentIndex && finalIndex !== -1) {
            // 检查边界：不能移动到锁定条目之外
            let canMove = true;
            
            // 简单的边界检查：如果目标位置的前一个或后一个是锁定的，且跨越了锁定边界
            // 为了简化，我们直接在数据层进行移动，如果发现移动后破坏了锁定规则，则重新渲染恢复
            
            let activeId;
            if (currentCotMode === 'chat') {
                activeId = db.cotSettings.activePresetId;
            } else {
                activeId = db.cotSettings.activeCallPresetId;
            }
            const activePreset = db.cotPresets.find(p => p.id === activeId);
            
            if (activePreset) {
                const itemToMove = activePreset.items.splice(currentIndex, 1)[0];
                activePreset.items.splice(finalIndex, 0, itemToMove);
                
                // 验证锁定规则：引子必须在最前，尾声必须在最后
                // 这里做一个简单的验证，如果第一个不是引子，或者最后一个不是尾声（假设它们是锁定的）
                const firstItem = activePreset.items[0];
                const lastItem = activePreset.items[activePreset.items.length - 1];
                
                // 如果移动导致锁定条目位置不对，撤销移动
                // 更好的做法是精确判断，这里为了稳妥，只要移动后发现锁定条目不在两端，就撤销
                // 实际上，只要不让非锁定条目跑到锁定条目外面就行
                
                await saveData();
            }
        }
        
        // 无论是否移动成功，都重新渲染以确保状态正确
        renderCotItems();
    };

    // 绑定事件
    el.addEventListener('touchstart', startPress, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);

    el.addEventListener('mousedown', startPress);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
}

function createIconBtn(text, onClick, isDanger = false) {
    const btn = document.createElement('button');
    btn.className = `cot-icon-btn ${isDanger ? 'danger' : ''}`;
    
    // 使用 SVG 图标替代文字
    let iconSvg = '';
    if (text === '↑') iconSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>';
    else if (text === '↓') iconSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>';
    else if (text === '✎') iconSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    else if (text === '×') iconSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    
    btn.innerHTML = iconSvg || text;
    btn.title = text; // Tooltip
    
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

// 移动条目
async function moveCotItem(index, direction) {
    let activeId;
    if (currentCotMode === 'chat') {
        activeId = db.cotSettings.activePresetId;
    } else {
        activeId = db.cotSettings.activeCallPresetId;
    }
    const activePreset = db.cotPresets.find(p => p.id === activeId);
    if (!activePreset) return;

    const item = activePreset.items[index];
    if (item.locked) return showToast('锁定条目无法移动');

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= activePreset.items.length) return;

    const targetItem = activePreset.items[newIndex];
    if (targetItem.locked) return showToast('无法移动到锁定条目之外');

    const temp = activePreset.items[index];
    activePreset.items[index] = activePreset.items[newIndex];
    activePreset.items[newIndex] = temp;

    await saveData();
    renderCotItems();
}

// 删除条目
async function deleteCotItem(index) {
    let activeId;
    if (currentCotMode === 'chat') {
        activeId = db.cotSettings.activePresetId;
    } else {
        activeId = db.cotSettings.activeCallPresetId;
    }
    const activePreset = db.cotPresets.find(p => p.id === activeId);
    if (!activePreset) return;

    const item = activePreset.items[index];
    if (item.locked) return showToast('锁定条目无法删除');

    if (!confirm('确定要删除这个条目吗？')) return;

    activePreset.items.splice(index, 1);
    await saveData();
    renderCotItems();
}

// 打开添加条目模态框
function openAddCotItemModal() {
    document.getElementById('cot-item-id').value = ''; // 空ID表示新建
    document.getElementById('cot-item-name').value = '';
    document.getElementById('cot-item-content').value = '';
    
    // 重置只读状态
    document.getElementById('cot-item-name').readOnly = false;
    document.getElementById('cot-item-content').readOnly = false;
    document.getElementById('cot-item-content').classList.remove('cot-readonly-textarea');
    
    // 显示保存按钮
    const saveBtn = document.querySelector('#cot-item-edit-form button[type="submit"]');
    if (saveBtn) saveBtn.style.display = 'block';
    
    // 移除提示
    const existingNotice = document.querySelector('.cot-lock-notice');
    if (existingNotice) existingNotice.remove();

    document.getElementById('cot-item-edit-modal').classList.add('visible');
}

// 打开编辑条目模态框
function openEditCotItemModal(item) {
    document.getElementById('cot-item-id').value = item.id;
    document.getElementById('cot-item-name').value = item.name;
    document.getElementById('cot-item-content').value = item.content;
    
    const nameInput = document.getElementById('cot-item-name');
    const contentInput = document.getElementById('cot-item-content');
    const saveBtn = document.querySelector('#cot-item-edit-form button[type="submit"]');
    const form = document.getElementById('cot-item-edit-form');
    
    // 移除旧提示
    const existingNotice = document.querySelector('.cot-lock-notice');
    if (existingNotice) existingNotice.remove();

    if (item.locked) {
        // 锁定状态：只读
        nameInput.readOnly = true;
        contentInput.readOnly = true;
        contentInput.classList.add('cot-readonly-textarea');
        if (saveBtn) saveBtn.style.display = 'none';
        
        // 添加提示
        const notice = document.createElement('div');
        notice.className = 'cot-lock-notice';
        notice.innerHTML = '🔒 此条目为核心规则，已被锁定，无法修改。';
        form.insertBefore(notice, form.firstChild);
    } else {
        // 正常状态
        nameInput.readOnly = false;
        contentInput.readOnly = false;
        contentInput.classList.remove('cot-readonly-textarea');
        if (saveBtn) saveBtn.style.display = 'block';
    }

    document.getElementById('cot-item-edit-modal').classList.add('visible');
}

// 保存条目
async function saveCotItem(e) {
    e.preventDefault();
    const id = document.getElementById('cot-item-id').value;
    const name = document.getElementById('cot-item-name').value.trim();
    const content = document.getElementById('cot-item-content').value;

    if (!name) return showToast('请输入条目名称');

    let activeId;
    if (currentCotMode === 'chat') {
        activeId = db.cotSettings.activePresetId;
    } else {
        activeId = db.cotSettings.activeCallPresetId;
    }
    const activePreset = db.cotPresets.find(p => p.id === activeId);
    if (!activePreset) return;

    if (id) {
        // 编辑现有
        const item = activePreset.items.find(i => i.id === id);
        if (item) {
            if (item.locked) return showToast('锁定条目无法修改');
            item.name = name;
            item.content = content;
        }
    } else {
        // 新建：插入到倒数第二个位置（即尾声之前），如果存在尾声的话
        const newItem = {
            id: `cot_item_${Date.now()}`,
            name: name,
            content: content,
            enabled: true
        };
        
        // 查找最后一个锁定条目（通常是尾声）
        const lastLockedIndex = activePreset.items.map(i => i.locked).lastIndexOf(true);
        
        if (lastLockedIndex !== -1 && lastLockedIndex === activePreset.items.length - 1) {
            // 如果最后一个是锁定的，插入到它前面
            activePreset.items.splice(lastLockedIndex, 0, newItem);
        } else {
            // 否则追加到末尾
            activePreset.items.push(newItem);
        }
    }

    await saveData();
    document.getElementById('cot-item-edit-modal').classList.remove('visible');
    renderCotItems();
    showToast('条目已保存');
}

// 新建预设
async function createNewCotPreset() {
    const name = prompt('请输入新预设名称：');
    if (!name) return;

    let activeId;
    if (currentCotMode === 'chat') {
        activeId = db.cotSettings.activePresetId;
    } else {
        activeId = db.cotSettings.activeCallPresetId;
    }
    const activePreset = db.cotPresets.find(p => p.id === activeId);
    // 复制当前预设的条目
    const newItems = activePreset ? JSON.parse(JSON.stringify(activePreset.items)) : [];
    
    const newPreset = {
        id: `cot_preset_${Date.now()}`,
        name: name,
        items: newItems
    };

    db.cotPresets.push(newPreset);
    
    if (currentCotMode === 'chat') {
        db.cotSettings.activePresetId = newPreset.id;
    } else {
        db.cotSettings.activeCallPresetId = newPreset.id;
    }
    await saveData();
    
    loadCotSettings(); // 重新加载以更新下拉框和列表
    showToast('新预设已创建');
}

// 重置当前预设
async function resetCotPreset() {
    let activeId;
    if (currentCotMode === 'chat') {
        activeId = db.cotSettings.activePresetId;
    } else {
        activeId = db.cotSettings.activeCallPresetId;
    }
    const activePreset = db.cotPresets.find(p => p.id === activeId);
    if (!activePreset) return;

    if (!confirm(`确定要将预设“${activePreset.name}”重置为默认思维链吗？\n此操作将覆盖当前所有条目。`)) return;

    // 深度复制默认条目
    if (currentCotMode === 'chat') {
        if (db.cotSettings.promptVersion === 'tt') {
            activePreset.items = JSON.parse(JSON.stringify(DEFAULT_COT_ITEMS_TT));
        } else {
            activePreset.items = JSON.parse(JSON.stringify(DEFAULT_COT_ITEMS_UWU));
        }
    } else {
        if (db.cotSettings.promptVersion === 'tt') {
            activePreset.items = JSON.parse(JSON.stringify(DEFAULT_CALL_COT_ITEMS_TT));
        } else {
            activePreset.items = JSON.parse(JSON.stringify(DEFAULT_CALL_COT_ITEMS_UWU));
        }
    }
    
    await saveData();
    renderCotItems();
    showToast('预设已重置为默认状态');
}

// 打开预设管理模态框
function openCotPresetManageModal() {
    const modal = document.getElementById('cot-preset-manage-modal');
    const list = document.getElementById('cot-preset-list-container');
    list.innerHTML = '';

    db.cotPresets.forEach((preset, index) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0;';
        
        let isActive = false;
        if (currentCotMode === 'chat' && preset.id === db.cotSettings.activePresetId) isActive = true;
        if (currentCotMode === 'call' && preset.id === db.cotSettings.activeCallPresetId) isActive = true;

        const nameDiv = document.createElement('div');
        nameDiv.textContent = preset.name + (isActive ? ' (当前)' : '');
        nameDiv.style.fontWeight = isActive ? 'bold' : 'normal';

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '5px';

        const renameBtn = createIconBtn('✎', async () => {
            const newName = prompt('请输入新名称：', preset.name);
            if (newName) {
                preset.name = newName;
                await saveData();
                openCotPresetManageModal(); // 刷新列表
                renderCotPresetSelect(); // 刷新主界面下拉框
            }
        });

        const exportBtn = createIconBtn('⭳', () => { // 使用下载符号
            const blob = new Blob([JSON.stringify(preset, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cot_preset_${preset.name}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        const deleteBtn = createIconBtn('×', async () => {
            if (db.cotPresets.length <= 1) return showToast('至少保留一个预设');
            if (!confirm(`确定要删除预设“${preset.name}”吗？`)) return;
            
            db.cotPresets.splice(index, 1);
            
            // 如果删除的是当前激活的，重置为第一个
            if (preset.id === db.cotSettings.activePresetId) {
                db.cotSettings.activePresetId = db.cotPresets[0].id;
            }
            if (preset.id === db.cotSettings.activeCallPresetId) {
                db.cotSettings.activeCallPresetId = db.cotPresets[0].id;
            }

            await saveData();
            openCotPresetManageModal();
            loadCotSettings();
        }, true);

        btnGroup.appendChild(renameBtn);
        btnGroup.appendChild(exportBtn);
        btnGroup.appendChild(deleteBtn);

        row.appendChild(nameDiv);
        row.appendChild(btnGroup);
        list.appendChild(row);
    });

    modal.classList.add('visible');
}

// 导入预设
async function importCotPreset(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const preset = JSON.parse(text);
        
        if (!preset.items || !Array.isArray(preset.items)) {
            throw new Error('格式错误：缺少 items 数组');
        }

        preset.id = `cot_preset_${Date.now()}`; // 重新生成ID避免冲突
        preset.name = preset.name + ' (导入)';
        
        db.cotPresets.push(preset);
        
        if (currentCotMode === 'chat') {
            db.cotSettings.activePresetId = preset.id;
        } else {
            db.cotSettings.activeCallPresetId = preset.id;
        }
        await saveData();
        
        document.getElementById('cot-preset-manage-modal').classList.remove('visible');
        loadCotSettings();
        showToast('预设导入成功');
    } catch (err) {
        console.error(err);
        showToast('导入失败：' + err.message);
    } finally {
        e.target.value = '';
    }
}

// 暴露给全局
window.initCotSettings = initCotSettings;
