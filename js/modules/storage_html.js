// js/modules/storage_html.js

function injectStorageHTML() {
    const storageScreen = document.getElementById('storage-analysis-screen');
    if (!storageScreen) return;

    storageScreen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="home-screen">‹</button>
            <div class="title-container">
                <h1 class="title">数据管理</h1>
            </div>
            <div class="placeholder"></div>
        </header>

        <div class="storage-content-scroll">
            <!-- 存储空间可视化 -->
            <div class="storage-card ios6-grouped-card">
                <div class="storage-group-title">存储空间使用情况</div>
                <div class="storage-content">
                    <div class="storage-total">
                        <span class="storage-total-label">总占用</span>
                        <span class="storage-total-value" id="storage-total-size">0 B</span>
                    </div>
                    
                    <div class="storage-bar-container">
                        <div class="storage-bar" id="storage-bar-chart">
                            <!-- JS 动态注入进度条 -->
                        </div>
                    </div>

                    <div class="storage-legend" id="storage-legend-container">
                        <!-- JS 动态注入图例 -->
                    </div>
                    
                    <div style="text-align: center; margin-top: 16px;">
                        <button id="open-clean-cache-btn" class="storage-clean-cache-btn storage-action-btn" style="font-size: 0.9rem; padding: 8px;">🧹 清理图片缓存</button>
                    </div>
                </div>
            </div>

            <!-- 备份选项 -->
            <div class="ios6-grouped-card">
                <div class="storage-group-title">
                    <span>备份选项</span>
                    <button class="storage-select-all-btn" id="storage-select-all-btn">全不选</button>
                </div>
                <div id="storage-backup-options">
                    <!-- JS 动态注入选项 -->
                </div>
            </div>

            <!-- 操作按钮 -->
            <div class="storage-action-group">
                <button class="storage-action-btn storage-export-btn" id="storage-export-btn">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span id="storage-export-text">导出备份</span>
                </button>

                <div style="width: 100%;">
                    <input type="file" id="storage-import-file" accept=".json,.ee" class="storage-hidden-input">
                    <label for="storage-import-file" class="storage-action-btn storage-import-btn" id="storage-import-label">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                        <span id="storage-import-text">导入备份</span>
                    </label>
                </div>
            </div>
            
            <div id="storage-persistence-container"></div>
        </div>
    `;
}

// 在 DOM 加载完成后执行注入
document.addEventListener('DOMContentLoaded', injectStorageHTML);
