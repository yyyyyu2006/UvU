function injectWorkshopHTML() {
    const workshopHTML = `
<!-- Drawing Workshop Screen -->
<div id="drawing-workshop-screen" class="screen">
    <header class="app-header">
        <button class="back-btn" data-target="home-screen">‹</button>
        <div class="workshop-tabs" style="display: flex; gap: 10px; flex: 1; justify-content: center;">
            <button class="workshop-tab active" id="workshop-api-tab-btn" style="background: none; border: none; font-size: 16px; font-weight: bold; color: var(--primary-color); padding: 5px 10px; border-bottom: 2px solid var(--primary-color);">未配置</button>
            <button class="workshop-tab" id="workshop-char-tab-btn" style="background: none; border: none; font-size: 16px; font-weight: bold; color: #999; padding: 5px 10px; border-bottom: 2px solid transparent;">角色管理</button>
        </div>
        <div class="placeholder"></div>
    </header>
    <main class="content" id="drawing-workshop-content" style="padding: 0; background: #f5f5f5;">
        <!-- API Config Tab -->
        <div id="workshop-api-tab" class="workshop-tab-content active" style="padding: 15px; overflow-y: auto; height: 100%;">
            <!-- Global API Config -->
            <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                <div class="workshop-section-header" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #eee;">
                    <div class="workshop-section-title" style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 15px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.44,0.17-0.48,0.41L9.2,5.77C8.61,6.01,8.08,6.33,7.58,6.71L5.19,5.75C4.97,5.68,4.72,5.75,4.6,5.97L2.68,9.29 c-0.11,0.2-0.06,0.47,0.12,0.61l2.03,1.58C4.78,11.66,4.76,11.97,4.76,12.3c0,0.32,0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.04,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.48-0.41l0.36-2.54c0.59-0.24,1.12-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0.01,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
                        全局 API 配置
                    </div>
                </div>
                <div class="workshop-section-body" style="padding: 0 15px;">
                    <div class="kkt-group" style="margin: 0; border-radius: 0; box-shadow: none; background: transparent;">
                        <div class="kkt-item">
                            <div class="kkt-item-label">服务商</div>
                            <div class="kkt-item-control">
                                <div class="radio-group-pills" style="margin: 0;">
                                    <input type="radio" id="workshop-provider-novelai" name="workshop-provider" value="novelai" checked>
                                    <label for="workshop-provider-novelai" style="padding: 4px 10px; font-size: 12px;">NovelAI</label>
                                    <input type="radio" id="workshop-provider-gpt" name="workshop-provider" value="gpt">
                                    <label for="workshop-provider-gpt" style="padding: 4px 10px; font-size: 12px;">GPT</label>
                                </div>
                            </div>
                        </div>
                        <div class="kkt-item" style="flex-direction: column; align-items: stretch; padding-bottom: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <div class="kkt-item-label">API 预设</div>
                                <div style="display: flex; gap: 5px; align-items: center;">
                                    <select id="workshop-api-preset-select" style="padding: 4px 8px; border-radius: 6px; border: 1px solid #eee; background: #f9f9f9; max-width: 120px;">
                                        <option value="official">官方默认</option>
                                    </select>
                                    <button class="icon-btn-simple" id="workshop-new-api-preset-btn" title="新建预设">
                                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                                    </button>
                                    <button class="icon-btn-simple" id="workshop-save-api-preset-btn" title="另存为新预设">
                                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
                                    </button>
                                    <button class="icon-btn-simple danger" id="workshop-delete-api-preset-btn" title="删除当前预设" style="display: none; color: #ff4d4f;">
                                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                    </button>
                                </div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <input type="text" id="workshop-api-url" autocomplete="off" placeholder="API 地址 (https://...)" style="border: 1px solid #eee; border-radius: 6px; padding: 8px; font-size: 12px; width: 100%;">
                                <input type="password" id="workshop-api-key" autocomplete="new-password" placeholder="密钥 (sk-...)" style="border: 1px solid #eee; border-radius: 6px; padding: 8px; font-size: 12px; width: 100%;">
                            </div>
                        </div>
                        <div class="kkt-item" id="workshop-api-protocol-row" style="display: none;">
                            <div class="kkt-item-label">接口协议</div>
                            <div class="kkt-item-control">
                                <select id="workshop-api-protocol" style="border:none; background:transparent; text-align:right; direction: rtl; max-width: 190px; appearance: none; -webkit-appearance: none; padding-right: 15px;">
                                    <option value="novelai">NovelAI 原生兼容</option>
                                    <option value="openai">OpenAI 图片兼容</option>
                                    <option value="custom">自定义直连</option>
                                </select>
                                <span class="kkt-arrow">›</span>
                            </div>
                        </div>
                        <div id="workshop-api-protocol-hint" style="display: none; padding: 8px 15px; color: #9a6b16; background: #fff9e8; font-size: 12px; line-height: 1.5;"></div>
                        <div class="kkt-item" id="workshop-response-format-row" style="display: none;">
                            <div class="kkt-item-label" id="workshop-response-format-label">传输模式</div>
                            <div class="kkt-item-control">
                                <select id="workshop-response-format" style="border:none; background:transparent; text-align:right; direction: rtl; max-width: 170px; appearance: none; -webkit-appearance: none; padding-right: 15px;">
                                    <option value="auto">自动识别</option>
                                    <option value="sse">流式（SSE）</option>
                                    <option value="json">JSON</option>
                                    <option value="binary">非流式（ZIP / 图片）</option>
                                </select>
                                <span class="kkt-arrow">›</span>
                            </div>
                        </div>
                        <div class="kkt-item" id="workshop-model-list-row">
                            <div class="kkt-item-label">模型列表</div>
                            <div class="kkt-item-control">
                                <button type="button" class="btn btn-small btn-secondary" id="workshop-fetch-models-btn" style="margin:0; padding: 4px 8px;">拉取</button>
                            </div>
                        </div>
                        <div class="kkt-item" id="workshop-model-select-row">
                            <div class="kkt-item-label">选择模型</div>
                            <div class="kkt-item-control">
                                <select id="workshop-api-model" style="border:none; background:transparent; text-align:right; direction: rtl; max-width: 180px; appearance: none; -webkit-appearance: none; padding-right: 15px;">
                                    <option value="">请先拉取</option>
                                </select>
                                <span class="kkt-arrow">›</span>
                            </div>
                        </div>
                        <div class="kkt-item" id="workshop-custom-model-row" style="display: none;">
                            <div class="kkt-item-label">模型名称</div>
                            <div class="kkt-item-control" style="flex: 1; margin-left: 15px;">
                                <input type="text" id="workshop-custom-model" autocomplete="off" placeholder="输入第三方模型 ID" style="border: 1px solid #eee; border-radius: 6px; padding: 7px 8px; font-size: 12px; width: 100%; text-align: right;">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- NovelAI Specific Config -->
            <div id="workshop-novelai-config" style="display: none;">
                
                <!-- Sub Tabs -->
                <div class="workshop-sub-tabs" style="display: flex; justify-content: space-around; padding: 15px 10px; background: #fff; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                    <div class="workshop-sub-tab active" data-target="workshop-sub-base" style="display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; color: var(--primary-color);">
                        <div class="icon-circle" style="width: 40px; height: 40px; border-radius: 50%; background: rgba(0,123,255,0.1); display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-2-2H5V7h14v10z"/></svg>
                        </div>
                        <span style="font-size: 12px; font-weight: bold;">基础</span>
                    </div>
                    <div class="workshop-sub-tab" data-target="workshop-sub-prompt" style="display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; color: #999;">
                        <div class="icon-circle" style="width: 40px; height: 40px; border-radius: 50%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
                        </div>
                        <span style="font-size: 12px; font-weight: bold;">提示词</span>
                    </div>
                    <div class="workshop-sub-tab" data-target="workshop-sub-vibe" style="display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; color: #999;">
                        <div class="icon-circle" style="width: 40px; height: 40px; border-radius: 50%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2.02c-5.51 0-9.98 4.47-9.98 9.98s4.47 9.98 9.98 9.98 9.98-4.47 9.98-9.98S17.51 2.02 12 2.02zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3-13.5V9h-2V6.5H9v-2h4v2h2zm-6 9V15h2v2.5h4v2H9v-2H7z"/></svg>
                        </div>
                        <span style="font-size: 12px; font-weight: bold;">氛围</span>
                    </div>
                    <div class="workshop-sub-tab" data-target="workshop-sub-llm" style="display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; color: #999;">
                        <div class="icon-circle" style="width: 40px; height: 40px; border-radius: 50%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path><path d="M12 6v6l4 2"></path></svg>
                        </div>
                        <span style="font-size: 12px; font-weight: bold;">LLM</span>
                    </div>
                </div>

                <div id="workshop-sub-base" class="workshop-sub-content active">
                    <!-- 尺寸与基础 -->
                    <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                            <div class="workshop-section-title" style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 15px;">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-2-2H5V7h14v10z"/></svg>
                                尺寸与基础
                            </div>
                        </div>
                        <div class="workshop-section-body">
                            <div class="kkt-group" style="margin: 0; border-radius: 0; box-shadow: none;">
                                <div class="kkt-item" style="flex-direction: column; align-items: stretch;">
                                    <div class="kkt-item-label" style="margin-bottom: 10px;">生成比例</div>
                                    <div class="radio-group-pills" style="margin: 0;">
                                        <input type="radio" id="workshop-ratio-1-1" name="workshop-aspect-ratio" value="1:1">
                                        <label for="workshop-ratio-1-1" style="padding: 4px 10px; font-size: 12px;">1:1</label>
                                        <input type="radio" id="workshop-ratio-3-4" name="workshop-aspect-ratio" value="3:4" checked>
                                        <label for="workshop-ratio-3-4" style="padding: 4px 10px; font-size: 12px;">3:4</label>
                                    </div>
                                </div>
                                <div class="kkt-item">
                                    <div class="kkt-item-label">间隔时间 (秒/张)</div>
                                    <div class="kkt-item-control">
                                        <input type="number" id="workshop-rate-limit" value="45" min="0" style="width: 60px; text-align: right; border: none; background: transparent;">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="workshop-sub-prompt" class="workshop-sub-content" style="display: none;">
                    <!-- 画师串与提示词 -->
                    <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                            <div class="workshop-section-title" style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 15px;">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
                                画师串与提示词
                            </div>
                        </div>
                        <div class="workshop-section-body">
                            <div class="kkt-group" style="margin: 0; border-radius: 0; box-shadow: none;">
                                <div class="kkt-item" style="flex-direction: column; align-items: stretch;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                        <div class="kkt-item-label">画师串预设</div>
                                        <div style="display: flex; gap: 5px; align-items: center;">
                                            <select id="workshop-prompt-preset-select" style="padding: 4px 8px; border-radius: 6px; border: 1px solid #eee; background: #f9f9f9; max-width: 120px;">
                                                <option value="">选择预设</option>
                                            </select>
                                            <button class="icon-btn-simple" id="workshop-save-prompt-preset-btn" title="另存为新预设">
                                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
                                            </button>
                                            <button class="icon-btn-simple" id="workshop-update-prompt-preset-btn" title="更新当前预设" style="display: none;">
                                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 2.5-1.06 4.85-2.87 6.66-3.86 3.85-10.11 3.85-13.97 0-3.86-3.85-3.86-10.09 0-13.94 3.86-3.85 10.11-3.85 13.97 0L21 2.01v8.11z"/></svg>
                                            </button>
                                            <button class="icon-btn-simple danger" id="workshop-delete-prompt-preset-btn" title="删除当前预设" style="display: none; color: #ff4d4f;">
                                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="kkt-item-label" style="margin-bottom: 5px; font-size: 12px; color: #666;">正面提示词 (画师串)</div>
                                    <textarea id="workshop-positive-prompt" rows="4" style="width: 100%; border: 1px solid #eee; border-radius: 8px; padding: 8px; margin-bottom: 10px;" placeholder="masterpiece, best quality, ..."></textarea>
                                    
                                    <div class="kkt-item-label" style="margin-bottom: 5px; font-size: 12px; color: #666;">角色提示词 (测试用)</div>
                                    <textarea id="workshop-character-prompt" rows="2" style="width: 100%; border: 1px solid #eee; border-radius: 8px; padding: 8px; margin-bottom: 10px;" placeholder="1girl, black hair, ..."></textarea>

                                    <div class="kkt-item-label" style="margin-bottom: 5px; font-size: 12px; color: #666;">负面提示词</div>
                                    <textarea id="workshop-negative-prompt" rows="3" style="width: 100%; border: 1px solid #eee; border-radius: 8px; padding: 8px; margin-bottom: 10px;" placeholder="lowres, bad anatomy, ..."></textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="workshop-sub-vibe" class="workshop-sub-content" style="display: none;">
                    <!-- 氛围设置 (Vibe) -->
                    <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                            <div class="workshop-section-title" style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 15px;">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2.02c-5.51 0-9.98 4.47-9.98 9.98s4.47 9.98 9.98 9.98 9.98-4.47 9.98-9.98S17.51 2.02 12 2.02zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3-13.5V9h-2V6.5H9v-2h4v2h2zm-6 9V15h2v2.5h4v2H9v-2H7z"/></svg>
                                氛围设置 (Vibe)
                            </div>
                            <label class="kkt-switch">
                                <input type="checkbox" id="workshop-vibe-toggle">
                                <span class="kkt-slider"></span>
                            </label>
                        </div>
                        <div class="workshop-section-body" id="workshop-vibe-body" style="display: none;">
                            <div style="padding: 15px; font-size: 12px; color: #666; background: #f9f9f9; border-bottom: 1px solid #eee;">
                                💡 释义：Vibe 影响图片的质感、光感和氛围。
                            </div>
                            <div class="kkt-group" style="margin: 0; border-radius: 0; box-shadow: none;">
                                <!-- 当前生效的 Vibe -->
                                <div class="kkt-item" style="flex-direction: column; align-items: stretch; border-bottom: 1px solid #eee; padding-bottom: 15px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                        <div class="kkt-item-label" style="font-weight: bold;">当前生效</div>
                                        <button class="btn btn-small btn-secondary" id="workshop-vibe-clear-btn" style="display: none;">取消启用</button>
                                    </div>
                                    <div id="workshop-vibe-preview-container" style="display: none; flex-direction: column; gap: 10px; background: #f9f9f9; padding: 10px; border-radius: 8px; border: 1px solid #eee;">
                                        <!-- JS populated -->
                                    </div>
                                    <div id="workshop-vibe-empty-hint" style="text-align: center; color: #999; font-size: 12px; padding: 20px; background: #f9f9f9; border-radius: 8px; border: 1px dashed #ddd;">
                                        请从下方图库中选择一张图片启用
                                    </div>
                                </div>
                                
                                <!-- Vibe 图库 -->
                                <div class="kkt-item" style="flex-direction: column; align-items: stretch; padding-top: 15px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                        <div class="kkt-item-label" style="font-weight: bold;">Vibe 图库</div>
                                        <div style="display: flex; gap: 5px;">
                                            <input type="file" id="workshop-vibe-upload-input" accept="image/*,.json" multiple style="display: none;">
                                            <button class="btn btn-small btn-primary" onclick="document.getElementById('workshop-vibe-upload-input').click()">+ 上传素材</button>
                                        </div>
                                    </div>
                                    <div id="workshop-vibe-library-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 10px;">
                                        <!-- Library items will be added here -->
                                        <div style="grid-column: 1 / -1; text-align: center; color: #999; font-size: 12px; padding: 20px; background: #f9f9f9; border-radius: 8px; border: 1px dashed #ddd;">
                                            图库为空，请上传参考图
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="workshop-sub-llm" class="workshop-sub-content" style="display: none;">
                    <!-- LLM 预设 -->
                    <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                            <div class="workshop-section-title" style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 15px;">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path><path d="M12 6v6l4 2"></path></svg>
                                LLM 预设
                            </div>
                        </div>
                        <div class="workshop-section-body">
                            <div class="kkt-group" style="margin: 0; border-radius: 0; box-shadow: none;">
                                <div class="kkt-item">
                                    <div class="kkt-item-label">独立 API 配置</div>
                                    <div class="kkt-item-control">
                                        <label class="kkt-switch">
                                            <input type="checkbox" id="workshop-llm-independent-api">
                                            <span class="kkt-slider"></span>
                                        </label>
                                    </div>
                                </div>
                                <div class="kkt-item" id="workshop-llm-api-select-container" style="display: none;">
                                    <div class="kkt-item-label">选择 API 预设</div>
                                    <div class="kkt-item-control">
                                        <select id="workshop-llm-api-preset" style="border:none; background:transparent; text-align:right; direction: rtl; appearance: none; -webkit-appearance: none; padding-right: 15px;">
                                            <option value="">请选择</option>
                                        </select>
                                        <span class="kkt-arrow">›</span>
                                    </div>
                                </div>
                                
                                  <div class="kkt-item" style="flex-direction: column; align-items: stretch; border-bottom: none; padding-bottom: 0; margin-top: 10px;">
                                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                          <div class="kkt-item-label" style="font-weight: bold;">提示词预设条目</div>
                                          <div style="display: flex; gap: 5px; align-items: center;">
                                              <select id="workshop-llm-preset-group-select" style="padding: 4px; border-radius: 4px; border: 1px solid #ddd; font-size: 12px; max-width: 120px;">
                                                  <!-- JS populated -->
                                              </select>
                                              <button class="icon-btn-simple" id="workshop-reset-llm-preset-group-btn" title="重置为默认预设" style="padding: 4px;">
                                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                                              </button>
                                              <button class="icon-btn-simple" id="workshop-add-llm-preset-group-btn" title="新建预设组" style="padding: 4px;">
                                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                                              </button>
                                              <button class="icon-btn-simple" id="workshop-rename-llm-preset-group-btn" title="重命名预设组" style="padding: 4px;">
                                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                                              </button>
                                              <button class="icon-btn-simple" id="workshop-delete-llm-preset-group-btn" title="删除预设组" style="padding: 4px; color: #ff4d4f;">
                                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                              </button>
                                              <button class="icon-btn-simple" id="workshop-export-llm-preset-group-btn" title="导出预设组" style="padding: 4px;">
                                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                                              </button>
                                              <button class="icon-btn-simple" id="workshop-import-llm-preset-group-btn" title="导入预设组" style="padding: 4px;">
                                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
                                              </button>
                                              <input type="file" id="workshop-import-llm-preset-group-input" accept=".json" style="display: none;">
                                          </div>
                                      </div>
                                      <div style="display: flex; justify-content: flex-end; margin-bottom: 10px;">
                                          <button class="icon-btn-simple" id="workshop-add-llm-prompt-btn" title="添加条目" style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--primary-color);">
                                              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                                              添加条目
                                          </button>
                                      </div>
                                      <div id="workshop-llm-prompt-list" style="display: flex; flex-direction: column; gap: 10px;">
                                          <!-- JS populated -->
                                      </div>
                                  </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- GPT Specific Config -->
            <div id="workshop-gpt-config" style="display: none;">
                <!-- Sub Tabs -->
                <div class="workshop-sub-tabs" style="display: flex; justify-content: space-around; padding: 15px 10px; background: #fff; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                    <div class="workshop-sub-tab active" data-target="workshop-gpt-sub-base" style="display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; color: var(--primary-color);">
                        <div class="icon-circle" style="width: 40px; height: 40px; border-radius: 50%; background: rgba(0,123,255,0.1); display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-2-2H5V7h14v10z"/></svg>
                        </div>
                        <span style="font-size: 12px; font-weight: bold;">基础</span>
                    </div>
                    <div class="workshop-sub-tab" data-target="workshop-gpt-sub-tags" style="display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; color: #999;">
                        <div class="icon-circle" style="width: 40px; height: 40px; border-radius: 50%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>
                        </div>
                        <span style="font-size: 12px; font-weight: bold;">标签系统</span>
                    </div>
                    <div class="workshop-sub-tab" data-target="workshop-gpt-sub-llm" style="display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; color: #999;">
                        <div class="icon-circle" style="width: 40px; height: 40px; border-radius: 50%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path><path d="M12 6v6l4 2"></path></svg>
                        </div>
                        <span style="font-size: 12px; font-weight: bold;">LLM</span>
                    </div>
                </div>

                <div id="workshop-gpt-sub-base" class="workshop-sub-content active">
                    <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee;">
                            <div class="workshop-section-title" style="font-weight: bold; font-size: 15px;">尺寸与基础</div>
                        </div>
                        <div class="workshop-section-body">
                            <div class="kkt-group" style="margin: 0; border-radius: 0; box-shadow: none;">
                                <div class="kkt-item" style="flex-direction: column; align-items: stretch;">
                                    <div class="kkt-item-label" style="margin-bottom: 10px;">生成比例</div>
                                    <div class="radio-group-pills" style="margin: 0;">
                                        <input type="radio" id="workshop-gpt-ratio-1-1" name="workshop-gpt-aspect-ratio" value="1024x1024" checked>
                                        <label for="workshop-gpt-ratio-1-1" style="padding: 4px 10px; font-size: 12px;">1:1</label>
                                        <input type="radio" id="workshop-gpt-ratio-16-9" name="workshop-gpt-aspect-ratio" value="1024x1792">
                                        <label for="workshop-gpt-ratio-16-9" style="padding: 4px 10px; font-size: 12px;">9:16</label>
                                        <input type="radio" id="workshop-gpt-ratio-9-16" name="workshop-gpt-aspect-ratio" value="1792x1024">
                                        <label for="workshop-gpt-ratio-9-16" style="padding: 4px 10px; font-size: 12px;">16:9</label>
                                    </div>
                                </div>
                                <div class="kkt-item">
                                    <div class="kkt-item-label">画质 (Quality)</div>
                                    <div class="kkt-item-control">
                                        <select id="workshop-gpt-quality" style="border:none; background:transparent; text-align:right; direction: rtl; appearance: none; -webkit-appearance: none; padding-right: 15px;">
                                            <option value="standard">Standard</option>
                                            <option value="hd">HD</option>
                                        </select>
                                        <span class="kkt-arrow">›</span>
                                    </div>
                                </div>
                                <div class="kkt-item">
                                    <div class="kkt-item-label">风格 (Style)</div>
                                    <div class="kkt-item-control">
                                        <select id="workshop-gpt-style" style="border:none; background:transparent; text-align:right; direction: rtl; appearance: none; -webkit-appearance: none; padding-right: 15px;">
                                            <option value="vivid">Vivid (生动)</option>
                                            <option value="natural">Natural (自然)</option>
                                        </select>
                                        <span class="kkt-arrow">›</span>
                                    </div>
                                </div>
                                <div class="kkt-item" style="flex-direction: column; align-items: stretch;">
                                    <div class="kkt-item-label" style="margin-bottom: 5px; font-size: 12px; color: #666;">测试画面描述</div>
                                    <textarea id="workshop-gpt-test-prompt" rows="3" style="width: 100%; border: 1px solid #eee; border-radius: 8px; padding: 8px; margin-bottom: 10px;" placeholder="输入画面描述，可包含标签..."></textarea>
                                    <div id="workshop-gpt-test-tags-container" style="display: flex; flex-wrap: wrap; gap: 5px;">
                                        <!-- JS populated -->
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="workshop-gpt-sub-tags" class="workshop-sub-content" style="display: none;">
                    <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                            <div class="workshop-section-title" style="font-weight: bold; font-size: 15px;">风格标签系统</div>
                            <button class="btn btn-small btn-primary" id="workshop-gpt-add-tag-btn">+ 添加标签</button>
                        </div>
                        <div class="workshop-section-body" style="padding: 15px;">
                            <div style="font-size: 12px; color: #666; margin-bottom: 15px; background: #f9f9f9; padding: 10px; border-radius: 8px; border: 1px solid #eee;">
                                💡 提示：当 LLM 输出的画面描述中包含以下标签时，系统会自动将其替换为你设置的风格提示词。
                            </div>
                            <div id="workshop-gpt-tags-list" style="display: flex; flex-direction: column; gap: 15px;">
                                <!-- JS populated -->
                            </div>
                        </div>
                    </div>
                </div>

                <div id="workshop-gpt-sub-llm" class="workshop-sub-content" style="display: none;">
                    <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                            <div class="workshop-section-title" style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 15px;">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path><path d="M12 6v6l4 2"></path></svg>
                                GPT 专用 LLM 预设
                            </div>
                        </div>
                        <div class="workshop-section-body">
                            <div class="kkt-group" style="margin: 0; border-radius: 0; box-shadow: none;">
                                <div class="kkt-item">
                                    <div class="kkt-item-label">独立 API 配置</div>
                                    <div class="kkt-item-control">
                                        <label class="kkt-switch">
                                            <input type="checkbox" id="workshop-gpt-llm-independent-api">
                                            <span class="kkt-slider"></span>
                                        </label>
                                    </div>
                                </div>
                                <div class="kkt-item" id="workshop-gpt-llm-api-select-container" style="display: none;">
                                    <div class="kkt-item-label">选择 API 预设</div>
                                    <div class="kkt-item-control">
                                        <select id="workshop-gpt-llm-api-preset" style="border:none; background:transparent; text-align:right; direction: rtl; appearance: none; -webkit-appearance: none; padding-right: 15px;">
                                            <option value="">请选择</option>
                                        </select>
                                        <span class="kkt-arrow">›</span>
                                    </div>
                                </div>
                                
                                <div class="kkt-item" style="flex-direction: column; align-items: stretch; border-bottom: none; padding-bottom: 0; margin-top: 10px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                        <div class="kkt-item-label" style="font-weight: bold;">提示词预设条目</div>
                                        <div style="display: flex; gap: 5px; align-items: center;">
                                            <select id="workshop-gpt-llm-preset-group-select" style="padding: 4px; border-radius: 4px; border: 1px solid #ddd; font-size: 12px; max-width: 120px;">
                                                <!-- JS populated -->
                                            </select>
                                            <button class="icon-btn-simple" id="workshop-gpt-reset-llm-preset-group-btn" title="重置为默认预设" style="padding: 4px;">
                                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                                            </button>
                                            <button class="icon-btn-simple" id="workshop-gpt-add-llm-preset-group-btn" title="新建预设组" style="padding: 4px;">
                                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                                            </button>
                                            <button class="icon-btn-simple" id="workshop-gpt-rename-llm-preset-group-btn" title="重命名预设组" style="padding: 4px;">
                                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                                            </button>
                                            <button class="icon-btn-simple" id="workshop-gpt-delete-llm-preset-group-btn" title="删除预设组" style="padding: 4px; color: #ff4d4f;">
                                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                            </button>
                                            <button class="icon-btn-simple" id="workshop-gpt-export-llm-preset-group-btn" title="导出预设组" style="padding: 4px;">
                                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                                            </button>
                                            <button class="icon-btn-simple" id="workshop-gpt-import-llm-preset-group-btn" title="导入预设组" style="padding: 4px;">
                                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
                                            </button>
                                            <input type="file" id="workshop-gpt-import-llm-preset-group-input" accept=".json" style="display: none;">
                                        </div>
                                    </div>
                                    <div style="font-size: 12px; color: #666; margin-bottom: 10px; background: #f9f9f9; padding: 8px; border-radius: 6px;">
                                        💡 提示：在条目中使用 <code>{{标签列表}}</code> 变量，系统会自动将其替换为当前开启的所有风格标签。
                                    </div>
                                    <div style="display: flex; justify-content: flex-end; margin-bottom: 10px;">
                                        <button class="icon-btn-simple" id="workshop-gpt-add-llm-prompt-btn" title="添加条目" style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--primary-color);">
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                                            添加条目
                                        </button>
                                    </div>
                                    <div id="workshop-gpt-llm-prompt-list" style="display: flex; flex-direction: column; gap: 10px;">
                                        <!-- JS populated -->
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

                <!-- 测试与出图 -->
                <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                    <div class="workshop-section-body" style="padding: 15px;">
                        <button class="btn btn-primary" id="workshop-generate-btn" style="width: 100%; padding: 12px; font-size: 16px; font-weight: bold; margin-bottom: 15px;">
                            ✨ 生成测试图
                        </button>
                        <div style="position: relative;">
                            <div id="workshop-preview-area" style="width: 100%; min-height: 200px; background: #eaeaea; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 2px dashed #ccc; overflow: hidden;">
                                <span style="color: #999;">图片预览区域</span>
                            </div>
                            <div id="workshop-preview-actions" style="display: none; position: absolute; bottom: 10px; right: 10px; gap: 8px;">
                                <button id="workshop-save-cache-btn" class="btn btn-small btn-secondary" style="background: rgba(255,255,255,0.9); color: #333; border: 1px solid #ddd; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">💾 存入缓存</button>
                                <button id="workshop-download-btn" class="btn btn-small btn-primary" style="box-shadow: 0 2px 4px rgba(0,0,0,0.2);">⬇️ 下载</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 缓存管理 -->
                <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                    <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                        <div class="workshop-section-title" style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 15px;">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/></svg>
                            缓存管理
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <button class="btn btn-small btn-neutral" id="workshop-history-btn">查看全部</button>
                        </div>
                    </div>
                    <div class="workshop-section-body">
                        <div id="workshop-history-gallery" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 10px;">
                            <!-- History thumbnails will be added here -->
                            <div style="aspect-ratio: 1; background: #f0f0f0; border-radius: 6px;"></div>
                            <div style="aspect-ratio: 1; background: #f0f0f0; border-radius: 6px;"></div>
                            <div style="aspect-ratio: 1; background: #f0f0f0; border-radius: 6px;"></div>
                        </div>
                    </div>
                </div>
            </div>

        <!-- Character Management Tab -->
        <div id="workshop-char-tab" class="workshop-tab-content" style="display: none; height: 100%; padding: 15px; overflow-y: auto;">
            <div class="workshop-section" style="background: #fff; border-radius: 12px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                <div class="workshop-section-header" style="padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                    <div class="workshop-section-title" style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 15px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,14.96C21.08,10.92 17.15,8 12.5,8Z"/></svg>
                        角色跑图词管理
                    </div>
                    <button class="btn btn-small btn-primary" id="workshop-add-char-btn">+ 添加角色</button>
                </div>
                <div class="workshop-section-body" style="padding: 15px;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 15px; background: #f9f9f9; padding: 10px; border-radius: 8px; border: 1px solid #eee;">
                        💡 提示：在这里为角色设置专属跑图词。在生图提示词中使用 <code>{{角色真名}}</code> 变量，系统会自动将其替换为这里设置的内容。
                    </div>
                    <div id="workshop-char-list" style="display: flex; flex-direction: column; gap: 15px;">
                        <!-- JS populated -->
                    </div>
                </div>
            </div>
        </div>
    </main>
</div>

<!-- Workshop Add Character Modal -->
<div id="workshop-add-char-modal" class="modal-overlay">
    <div class="modal-window">
        <h3>选择要添加的角色</h3>
        <ul id="workshop-char-selection-list" class="list-container" style="max-height: 40vh; overflow-y: auto; padding: 0; margin: 15px 0;">
            <!-- JS populated -->
        </ul>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="workshop-confirm-add-char-btn" class="btn btn-primary" style="flex: 1;">确认</button>
            <button id="workshop-cancel-add-char-btn" class="btn btn-neutral" style="flex: 1;">取消</button>
        </div>
    </div>
</div>
    `;

    const phoneScreen = document.querySelector('.phone-screen');
    if (phoneScreen) {
        phoneScreen.insertAdjacentHTML('beforeend', workshopHTML);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    injectWorkshopHTML();
});
