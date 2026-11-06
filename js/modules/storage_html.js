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
                        <span class="storage-total-label">数据估算</span>
                        <span class="storage-total-value" id="storage-total-size">0 B</span>
                    </div>
                    
                    <div class="storage-bar-container">
                        <div class="storage-bar" id="storage-bar-chart">
                            <!-- JS 动态注入进度条 -->
                        </div>
                    </div>

                    <p style="font-size:12px;color:#888;line-height:1.5">按 JSON 的 UTF-8 字节估算，包含保存的存档副本；图片缓存和字体另计。不等于浏览器磁盘占用或压缩备份大小。</p>
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
                    <span>分类备份</span>
                    <button class="storage-select-all-btn" id="storage-select-all-btn">全不选</button>
                </div>
                <div style="padding: 0 12px 10px; color: #777; font-size: 12px; line-height: 1.5;">
                    导出与导入分别记住各自的勾选范围。常规七类默认勾选；相册／工坊／阅读数据可另选或单独迁移，全选包含此新增分类。
                </div>
                <div class="storage-backup-modes" role="group" aria-label="备份操作">
                    <button type="button" data-backup-mode="export" aria-pressed="true">导出分类</button>
                    <button type="button" data-backup-mode="import" aria-pressed="false">导入分类</button>
                </div>
                <div id="storage-backup-options">
                    <!-- JS 动态注入选项 -->
                </div>
            </div>

            <!-- 操作按钮 -->
            <label class="storage-export-format" id="storage-export-format-row">
                导出格式
                <select id="storage-export-format">
                    <option value="ee">压缩备份 .ee（文件较小）</option>
                    <option value="json">通用备份 .json（无需解压支持）</option>
                </select>
            </label>
            <div class="storage-backup-extras">
                <label><input type="checkbox" id="storage-export-credentials" checked> 导出包含 API 密钥（分享给他人前请取消）</label>
                <label><input type="checkbox" id="storage-export-vector-index" checked> 导出包含向量索引（取消可减小备份，记忆原文保留）</label>
                <p>备份保留外链地址，不自动下载外部图片、字体和组件。导入前将显示更新范围供确认。</p>
            </div>
            <label class="storage-backup-extras">脱敏备份的空白密钥
                <select id="storage-import-credentials"><option value="preserve">保留本机相同接口的密钥</option><option value="clear">清空对应密钥</option></select>
            </label>
            <button type="button" data-resource-health>检查外链与资源加载</button>
            <p id="storage-backup-progress" role="status" aria-live="polite"></p>
            <button type="button" id="storage-backup-cancel" hidden>取消解析</button>
            <div class="storage-action-group">
                <button class="storage-action-btn storage-export-btn" id="storage-export-btn">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span id="storage-export-text">导出备份</span>
                </button>

                <div id="storage-import-control" style="width: 100%;" hidden>
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
