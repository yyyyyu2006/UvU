document.addEventListener('DOMContentLoaded', () => {
    const myProfileHtml = `
        <header class="app-header">
            <button class="back-btn" data-target="contacts-screen">‹</button>
            <div class="title-container"><h1 class="title">我的档案</h1></div>
            <div class="action-btn-group">
                <!-- 保存按钮移到底部悬浮栏，顶部留空或放其他功能 -->
            </div>
        </header>
        <main class="content" style="padding: 0; display: flex; flex-direction: column;">
            <!-- 背景模糊层 -->
            <div id="mp-bg-blur" class="mp-bg-blur"></div>

            <!-- 顶部头像轮播 -->
            <div class="mp-carousel-container">
                <div class="mp-carousel" id="mp-carousel">
                    <!-- JS 动态生成头像卡片 -->
                </div>
                <div class="mp-carousel-indicators" id="mp-carousel-indicators"></div>
            </div>

            <!-- 信息编辑区 -->
            <div class="mp-info-container">
                <div class="mp-info-header">
                    <span class="mp-section-title">基础档案</span>
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <button class="icon-btn-simple" id="mp-set-active-btn" title="设为展示名片">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        </button>
                        <button class="icon-btn-simple danger" id="mp-delete-persona-btn" title="删除当前人设">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>

                <div class="mp-input-group">
                    <input type="text" id="mp-name-input" class="mp-transparent-input title-input" placeholder="输入昵称">
                </div>
                
                <div class="mp-input-group">
                    <textarea id="mp-persona-input" class="mp-transparent-input" rows="4" placeholder="在此输入通用人设/状态描述..."></textarea>
                </div>

                <div class="mp-divider"></div>

                <div class="mp-section-title" style="margin-bottom: 10px;">已绑定角色 (专属设定)</div>
                <div class="mp-tags-container" id="mp-tags-container">
                    <!-- JS 生成 Tag -->
                    <button class="mp-tag-add" id="mp-add-binding-btn">+ 添加</button>
                </div>
            </div>

            <!-- 底部保存栏 -->
            <div class="mp-bottom-bar">
                <button class="btn btn-primary mp-save-btn" id="mp-save-btn">保存并同步当前人设</button>
            </div>
        </main>

        <!-- 专属设定侧滑板 -->
        <div id="mp-exclusive-sheet" class="action-sheet-overlay" style="align-items: flex-end;">
            <div class="action-sheet-content mp-exclusive-panel">
                <div class="mp-panel-header">
                    <div class="mp-panel-char-info">
                        <img src="" id="mp-panel-char-avatar" class="mp-panel-avatar">
                        <span id="mp-panel-char-name">角色名</span>
                    </div>
                    <button class="icon-btn-simple" id="mp-panel-close-btn">×</button>
                </div>
                <div class="mp-panel-body">
                    <label class="mp-label">专属设定 (附加在通用设定之后)</label>
                    <textarea id="mp-panel-input" rows="4" placeholder="例如：是Ta的姐姐，性格要更温柔..."></textarea>
                    
                    <div class="mp-panel-option">
                        <label class="kkt-switch">
                            <input type="checkbox" id="mp-panel-override-check">
                            <span class="kkt-slider"></span>
                        </label>
                        <span>完全覆盖通用设定 (不拼接)</span>
                    </div>
                </div>
                <div class="mp-panel-footer">
                    <button class="btn btn-danger btn-small" id="mp-panel-unbind-btn">解除绑定</button>
                    <button class="btn btn-primary" id="mp-panel-confirm-btn">确认修改</button>
                </div>
            </div>
        </div>

        <!-- 角色选择模态框 -->
        <div id="mp-char-select-modal" class="modal-overlay">
            <div class="modal-window">
                <h3>选择要绑定的角色</h3>
                <div id="mp-char-select-list" class="mp-select-list">
                    <!-- JS 生成 -->
                </div>
                <div style="display: flex; gap: 10px; margin-top: 15px;">
                    <button class="btn btn-primary" id="mp-char-select-confirm" style="flex:1;">确定</button>
                    <button class="btn btn-neutral" id="mp-char-select-cancel" style="flex:1;">取消</button>
                </div>
            </div>
        </div>
        
        <!-- 头像上传 Input -->
        <input type="file" id="mp-carousel-avatar-upload" accept="image/*" style="display:none;">
    `;
    const container = document.getElementById('my-profile-screen');
    if (container) {
        container.innerHTML = myProfileHtml;
    }
});
