document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    // initDrawingWorkshop() 将在 main.js 的 init() 中调用，确保数据已加载
});

// --- Tab 切换逻辑 ---
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 移除所有 active
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            // 激活当前
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-target');
            if (targetId && document.getElementById(targetId)) {
                document.getElementById(targetId).classList.add('active');
            }
        });
    });
}

// --- 绘图工坊 (Drawing Workshop) 逻辑 ---
function initDrawingWorkshop() {
    // 1. Tab 切换逻辑
    const apiTabBtn = document.getElementById('workshop-api-tab-btn');
    const charTabBtn = document.getElementById('workshop-char-tab-btn');
    const apiTabContent = document.getElementById('workshop-api-tab');
    const charTabContent = document.getElementById('workshop-char-tab');

    if (apiTabBtn && charTabBtn && apiTabContent && charTabContent) {
        apiTabBtn.addEventListener('click', () => {
            apiTabBtn.classList.add('active');
            charTabBtn.classList.remove('active');
            
            // 更新内联样式
            apiTabBtn.style.color = 'var(--primary-color)';
            apiTabBtn.style.borderBottom = '2px solid var(--primary-color)';
            charTabBtn.style.color = '#999';
            charTabBtn.style.borderBottom = '2px solid transparent';

            apiTabContent.style.display = 'block';
            charTabContent.style.display = 'none';
        });

        charTabBtn.addEventListener('click', () => {
            charTabBtn.classList.add('active');
            apiTabBtn.classList.remove('active');
            
            // 更新内联样式
            charTabBtn.style.color = 'var(--primary-color)';
            charTabBtn.style.borderBottom = '2px solid var(--primary-color)';
            apiTabBtn.style.color = '#999';
            apiTabBtn.style.borderBottom = '2px solid transparent';

            charTabContent.style.display = 'block';
            apiTabContent.style.display = 'none';
        });
    }

    // 3. 服务商选择联动
    const providerRadios = document.querySelectorAll('input[name="workshop-provider"]');
    const novelaiConfig = document.getElementById('workshop-novelai-config');
    const gptConfig = document.getElementById('workshop-gpt-config');
    
    if (providerRadios.length > 0 && novelaiConfig && gptConfig && apiTabBtn) {
        providerRadios.forEach(radio => {
            radio.addEventListener('change', async (e) => {
                if (!e.target.checked) return;
                const provider = e.target.value;
                
                // Hide all provider configs first
                novelaiConfig.style.display = 'none';
                gptConfig.style.display = 'none';

                if (provider === 'novelai') {
                    apiTabBtn.textContent = 'NovelAI';
                    novelaiConfig.style.display = 'block';
                } else if (provider === 'gpt') {
                    apiTabBtn.textContent = 'GPT';
                    gptConfig.style.display = 'block';
                    
                    // 触发一次 GPT 的 sub-tab 切换，确保内容显示
                    const activeGptTab = document.querySelector('#workshop-gpt-config .workshop-sub-tab.active');
                    if (activeGptTab) {
                        activeGptTab.click();
                    } else {
                        // 如果没有激活的，默认激活第一个
                        const firstGptTab = document.querySelector('#workshop-gpt-config .workshop-sub-tab');
                        if (firstGptTab) firstGptTab.click();
                    }
                } else {
                    apiTabBtn.textContent = '未配置';
                }
                
                // 触发预设更新
                if (db.workshopSettings) {
                    db.workshopSettings.provider = provider;
                    await saveData();
                    updateApiPresetList();
                }
            });
        });
    }

    // 初始化 Vibe 逻辑
    initWorkshopVibe();

    // 3.5 Sub-tabs 切换逻辑
    const subTabs = document.querySelectorAll('.workshop-sub-tab');
    const subContents = document.querySelectorAll('.workshop-sub-content');

    subTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 找到当前 tab 所在的容器 (区分 NovelAI 和 GPT)
            const container = tab.closest('.workshop-sub-tabs');
            if (!container) return;
            
            // 仅在当前容器内移除 active 状态
            const siblingTabs = container.querySelectorAll('.workshop-sub-tab');
            siblingTabs.forEach(t => {
                t.classList.remove('active');
                t.style.color = '#999';
                const iconCircle = t.querySelector('.icon-circle');
                if (iconCircle) {
                    iconCircle.style.background = '#f5f5f5';
                }
            });
            
            // 隐藏所有关联的 content
            siblingTabs.forEach(t => {
                const targetId = t.getAttribute('data-target');
                if (targetId && document.getElementById(targetId)) {
                    document.getElementById(targetId).style.display = 'none';
                }
            });

            // 激活当前
            tab.classList.add('active');
            tab.style.color = 'var(--primary-color)';
            const iconCircle = tab.querySelector('.icon-circle');
            if (iconCircle) {
                iconCircle.style.background = 'rgba(0,123,255,0.1)';
            }
            
            const targetId = tab.getAttribute('data-target');
            if (targetId && document.getElementById(targetId)) {
                document.getElementById(targetId).style.display = 'block';
            }
        });
    });

    // 3.6 LLM 独立 API 切换 (NovelAI)
    const llmIndependentApiToggle = document.getElementById('workshop-llm-independent-api');
    const llmApiSelectContainer = document.getElementById('workshop-llm-api-select-container');
    if (llmIndependentApiToggle && llmApiSelectContainer) {
        llmIndependentApiToggle.addEventListener('change', (e) => {
            llmApiSelectContainer.style.display = e.target.checked ? 'flex' : 'none';
        });
    }

    // 3.7 LLM 独立 API 切换 (GPT)
    const gptLlmIndependentApiToggle = document.getElementById('workshop-gpt-llm-independent-api');
    const gptLlmApiSelectContainer = document.getElementById('workshop-gpt-llm-api-select-container');
    if (gptLlmIndependentApiToggle && gptLlmApiSelectContainer) {
        gptLlmIndependentApiToggle.addEventListener('change', (e) => {
            gptLlmApiSelectContainer.style.display = e.target.checked ? 'flex' : 'none';
        });
    }

    // 初始化设置绑定
    initWorkshopSettings();
    
    // 初始化模型拉取
    initWorkshopModels();
    
    // 初始化生图逻辑
    initWorkshopGeneration();
    
    // 初始化历史记录
    loadWorkshopHistory();
    
    // 初始化角色管理
    initWorkshopCharManagement();
}
