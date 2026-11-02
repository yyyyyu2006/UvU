// --- 阅读器 HTML 结构注入 (js/modules/reader_html.js) ---

const readerHtml = `
    <!-- 阅读器书架页面 -->
    <div id="reader-bookshelf-screen" class="screen">
        <header class="app-header">
            <button class="back-btn" data-target="home-screen">‹</button>
            <div class="title-container"><h1 class="title">我的书架</h1></div>
            <div class="action-btn-group">
                <button class="action-btn" id="reader-manage-btn" title="管理">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="action-btn" id="reader-cancel-manage-btn" style="display: none; font-size: 14px; width: auto; padding: 0 8px;">取消</button>
            </div>
        </header>
        <main class="content reader-bookshelf-content">
            <div class="bookshelf-grid" id="bookshelf-grid">
                <!-- JS 动态注入书籍 -->
                <div class="book-item upload-book-btn" id="upload-book-btn">
                    <div class="book-cover">+</div>
                    <div class="book-title">导入本地书籍</div>
                    <div class="book-author">支持 .txt 格式</div>
                </div>
            </div>
            <input type="file" id="reader-file-upload" accept=".txt" style="display: none;">
        </main>
    </div>

    <!-- 阅读器阅读页面 -->
    <div id="reader-view-screen" class="screen reader-view-screen reader-theme-default">
        <header class="app-header reader-header" id="reader-header">
            <button class="back-btn" id="reader-back-btn">‹</button>
            <div class="title-container"><h1 class="title" id="reader-book-title">书名</h1></div>
            <div class="placeholder"></div>
        </header>
        
        <main class="content reader-content" id="reader-content-area">
            <div id="reader-text-container" class="reader-text-container">
                <div class="reader-chapter-title" id="reader-chapter-title">章节标题</div>
                <div id="reader-text-content">
                    <!-- JS 动态注入正文 -->
                </div>
            </div>
            <!-- 触控区域 -->
            <div class="reader-touch-zone left" id="reader-touch-left"></div>
            <div class="reader-touch-zone center" id="reader-touch-center"></div>
            <div class="reader-touch-zone right" id="reader-touch-right"></div>
        </main>

        <footer class="reader-footer" id="reader-footer">
            <button class="reader-footer-btn" id="reader-toc-btn">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                目录
            </button>
            <div class="reader-progress-info" id="reader-progress-info">0.0%</div>
            <button class="reader-footer-btn" id="reader-settings-btn">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                设置
            </button>
        </footer>

        <!-- 目录侧边栏 -->
        <div class="reader-toc-overlay" id="reader-toc-overlay">
            <div class="reader-toc-panel">
                <div class="reader-toc-header">
                    <span>目录</span>
                    <span id="reader-toc-count" style="font-size: 12px; color: #888; font-weight: normal;">共0章</span>
                </div>
                <ul class="reader-toc-list" id="reader-toc-list">
                    <!-- JS 动态注入目录 -->
                </ul>
            </div>
        </div>

        <!-- 段落长按悬浮菜单 -->
        <div class="reader-paragraph-menu" id="reader-paragraph-menu" style="display: none;">
            <button class="reader-menu-btn" id="reader-menu-comment">📝 写段评</button>
            <div class="reader-menu-divider"></div>
            <button class="reader-menu-btn" id="reader-menu-copy">📋 复制</button>
        </div>

        <!-- 段评底部面板遮罩层 -->
        <div class="reader-comment-overlay" id="reader-comment-overlay">
            <div class="reader-comment-panel" id="reader-comment-panel">
                <div class="reader-comment-header">
                    <span id="reader-comment-title">段评</span>
                    <button class="reader-comment-close" id="reader-comment-close">×</button>
                </div>
                <div class="reader-comment-quote" id="reader-comment-quote">
                    <!-- 引文内容 -->
                </div>
                <div class="reader-comment-list" id="reader-comment-list">
                    <!-- 评论列表 -->
                </div>
                <div class="reader-comment-input-area">
                    <input type="text" id="reader-comment-input" placeholder="写下你的想法...">
                    <button id="reader-comment-send">发送</button>
                </div>
            </div>
        </div>

        <!-- 设置面板遮罩层 -->
        <div class="reader-settings-overlay" id="reader-settings-overlay">
            <div class="reader-settings-panel" id="reader-settings-panel">
                <div class="reader-settings-header">
                    <span>阅读设置</span>
                    <button class="reader-settings-close" id="reader-settings-close">×</button>
                </div>
                <div class="reader-settings-content">
                    <div class="reader-setting-row">
                        <div class="reader-setting-label">字号</div>
                        <div class="reader-font-controls" style="display: flex; align-items: center; gap: 10px;">
                            <button class="reader-btn-small" id="reader-font-decrease">A-</button>
                            <span id="reader-font-size-display">18</span>
                            <button class="reader-btn-small" id="reader-font-increase">A+</button>
                        </div>
                    </div>
                    <div class="reader-setting-row">
                        <div class="reader-setting-label">字体颜色</div>
                        <div class="reader-color-controls" style="display: flex; align-items: center; gap: 10px;">
                            <input type="color" id="reader-font-color-picker" value="#333333">
                            <button class="reader-btn-small" id="reader-font-color-reset">重置</button>
                        </div>
                    </div>
                    <div class="reader-setting-row">
                        <div class="reader-setting-label">主题</div>
                        <div class="reader-theme-controls" style="display: flex; gap: 10px;">
                            <div class="reader-theme-circle active" data-theme="reader-theme-default" style="background-color: #f4f4f4; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;"></div>
                            <div class="reader-theme-circle" data-theme="reader-theme-white" style="background-color: #ffffff; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; border: 1px solid #ddd;"></div>
                            <div class="reader-theme-circle" data-theme="reader-theme-green" style="background-color: #cce8cf; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;"></div>
                            <div class="reader-theme-circle" data-theme="reader-theme-dark" style="background-color: #1a1a1a; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;"></div>
                        </div>
                    </div>
                    <div class="reader-setting-row">
                        <div class="reader-setting-label">自定义背景</div>
                        <div class="reader-bg-controls">
                            <button class="reader-btn-small" id="reader-bg-upload-btn">上传图片</button>
                            <input type="file" id="reader-bg-upload" accept="image/*" style="display: none;">
                            <button class="reader-btn-small" id="reader-bg-clear-btn" style="display: none;">清除</button>
                        </div>
                    </div>
                    <div class="reader-setting-row">
                        <div class="reader-setting-label">页边距</div>
                        <div class="reader-margin-controls">
                            <div class="margin-input-group">
                                <span>上</span><input type="number" id="reader-margin-top" value="60" min="0" max="200">
                            </div>
                            <div class="margin-input-group">
                                <span>下</span><input type="number" id="reader-margin-bottom" value="60" min="0" max="200">
                            </div>
                            <div class="margin-input-group">
                                <span>左</span><input type="number" id="reader-margin-left" value="20" min="0" max="100">
                            </div>
                            <div class="margin-input-group">
                                <span>右</span><input type="number" id="reader-margin-right" value="20" min="0" max="100">
                            </div>
                        </div>
                    </div>
                    
                    <div class="reader-setting-row" style="border-top: 1px solid rgba(0,0,0,0.1); padding-top: 15px; margin-top: 10px;">
                        <div class="reader-setting-label" style="width: auto; margin-right: 15px;">智能插图</div>
                        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                            <select id="reader-illustration-count" style="padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.1); background: rgba(255,255,255,0.5); color: var(--reader-text-color);">
                                <option value="1">1张</option>
                                <option value="3" selected>3张</option>
                                <option value="6">6张</option>
                                <option value="9">9张</option>
                            </select>
                            <button id="reader-generate-illustration-btn" class="reader-btn-small" style="background: var(--primary-color); color: white; border: none; flex: 1;">生成本章插图</button>
                        </div>
                    </div>
                    <div id="reader-illustration-progress" style="display: none; font-size: 12px; color: var(--primary-color); text-align: center; margin-top: -10px; margin-bottom: 15px;">
                        正在构思分镜...
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 全屏图片查看器 -->
    <div id="reader-fullscreen-viewer" class="reader-fullscreen-viewer">
        <img id="reader-fullscreen-img" src="" alt="Fullscreen Image">
    </div>
`;

// 将 HTML 注入到 phone-screen 中
document.addEventListener('DOMContentLoaded', () => {
    const phoneScreen = document.querySelector('.phone-screen');
    if (phoneScreen) {
        phoneScreen.insertAdjacentHTML('beforeend', readerHtml);
    }
});
