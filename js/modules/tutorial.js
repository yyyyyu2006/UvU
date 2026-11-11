// --- 教程与备份功能 (js/modules/tutorial.js) ---

function setupTutorialApp() {
    const tutorialContentArea = document.getElementById('tutorial-content-area');
    tutorialContentArea.addEventListener('click', (e) => {
        const header = e.target.closest('.tutorial-header');
        if (header) {
            header.parentElement.classList.toggle('open');
        }
    });
}

function renderUpdateLog() {
    const tutorialContent = document.getElementById('tutorial-content-area');
    if (!tutorialContent) return;

    const updateSection = document.createElement('div');
    updateSection.className = 'tutorial-item'; 

    let notesHtml = '';
    updateLog.forEach((log, index) => {
        notesHtml += `
            <div style="margin-bottom: 15px; ${index < updateLog.length - 1 ? 'padding-bottom: 10px; border-bottom: 1px solid #f0f0f0;' : ''}">
                <h4 style="font-size: 15px; color: #333; margin: 0 0 5px 0;">版本 ${log.version} (${log.date})</h4>
                <ul style="padding-left: 20px; margin: 0; list-style-type: '› ';">
                    ${log.notes.map(note => `<li style="margin-bottom: 5px; color: #666;">${note}</li>`).join('')}
                </ul>
            </div>
        `;
    });

    updateSection.innerHTML = `
        <div class="tutorial-header">更新日志</div>
        <div class="tutorial-content" style="padding-top: 15px;">
            ${notesHtml}
        </div>
    `;
    
    tutorialContent.appendChild(updateSection);
}

function showUpdateModal() {
    const modal = document.getElementById('update-log-modal');
    const contentEl = document.getElementById('update-log-modal-content');
    const closeBtn = document.getElementById('close-update-log-modal');

    const latestLog = updateLog[0];
    if (!latestLog) return;

    // 优化内容渲染
    let notesHtml = '<div style="text-align: left; max-height: 60vh; overflow-y: auto; padding-right: 5px;">';
    latestLog.notes.forEach(note => {
        // 处理加粗标记 **text** -> <b>text</b>
        let formattedNote = note.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

        if (note.includes('————')) {
            // 分割线
            notesHtml += '<hr style="margin: 15px 0; border: 0; border-top: 1px dashed #ccc;">';
        } else if (/^\d+\./.test(note)) {
            // 标题行 (例如 "1.日记功能升级！")
            notesHtml += `<h4 style="margin: 15px 0 8px; color: #333; font-size: 15px; font-weight: 600;">${formattedNote}</h4>`;
        } else {
            // 普通内容行
            notesHtml += `<div style="margin-bottom: 6px; color: #555; font-size: 13px; line-height: 1.5; padding-left: 12px; position: relative;">
                <span style="position: absolute; left: 0; top: 0; color: #999;">•</span>${formattedNote}
            </div>`;
        }
    });
    notesHtml += '</div>';

    contentEl.innerHTML = `
        <h3 style="margin-top: 0; margin-bottom: 15px; text-align: center;">版本 ${latestLog.version} (${latestLog.date})</h3>
        ${notesHtml}
        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">过往更新说明可在“教程”应用内查看。</p>
    `;

    modal.classList.add('visible');

    // 强制阅读倒计时
    const originalText = "我知道了";
    let timeLeft = 10;
    closeBtn.disabled = true;
    closeBtn.textContent = `请阅读 (${timeLeft}s)`;
    closeBtn.style.opacity = '0.6';
    closeBtn.style.cursor = 'not-allowed';

    const timer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            closeBtn.textContent = `请阅读 (${timeLeft}s)`;
        } else {
            clearInterval(timer);
            closeBtn.disabled = false;
            closeBtn.textContent = originalText;
            closeBtn.style.opacity = '1';
            closeBtn.style.cursor = 'pointer';
        }
    }, 1000);

    closeBtn.onclick = () => {
        modal.classList.remove('visible');
        localStorage.setItem('lastSeenVersion', appVersion);
    };
}

function checkForUpdates() {
    const lastSeenVersion = localStorage.getItem('lastSeenVersion');
    if (lastSeenVersion !== appVersion) {
        // 仅当当前版本为 1.8.0 时，才执行引导重置
        if (appVersion === '1.8.0') {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('guide_')) {
                    localStorage.removeItem(key);
                }
            });
        }

        setTimeout(showUpdateModal, 500);
    }
}

// --- Guide System (分步引导) ---
const GuideSystem = {
    check: function(guideId, nextCallback) {
        // 检查是否已显示过
        if (localStorage.getItem(guideId) === 'true') return;

        // 根据 ID 定义引导内容
        let config = null;
        switch (guideId) {
            case 'guide_search_entry':
                config = {
                    target: '.search-bar-decoration',
                    text: '新增搜索功能！支持按角色、群聊筛选，快速查找历史记录。',
                    position: 'bottom'
                };
                break;
            case 'guide_char_gallery':
                config = {
                    target: '#char-gallery-manage-btn',
                    text: '新增 TA 相册！在这里管理角色的专属照片，在聊天设置里开启此开关后，聊天时角色可直接发送上传的图片。',
                    position: 'top'
                };
                break;
            case 'guide_group_summary':
                config = {
                    target: '#memory-journal-btn',
                    text: '群聊记录太多？点击这里一键生成智能总结，自动关联当前群聊世界书，内置提示词。',
                    position: 'top'
                };
                break;
            case 'guide_group_notice':
                config = {
                    target: '#setting-group-notice',
                    text: '新增群公告！设置剧情背景或重要通知，让所有成员知晓。',
                    position: 'bottom',
                    parent: '.kkt-item' // 高亮父容器
                };
                break;
            case 'guide_group_gossip':
                config = {
                    target: '#setting-group-allow-gossip',
                    text: '开启群内私聊！双击群聊标题可查看，群成员之间可以悄悄互动，八卦吐槽更真实。',
                    position: 'bottom',
                    parent: '.kkt-item'
                };
                break;
        }

        if (config) {
            // 稍微延迟以确保 DOM 渲染完成
            setTimeout(() => {
                const targetEl = document.querySelector(config.target);
                if (targetEl && targetEl.offsetParent !== null) { // 确保元素可见
                    this.show(targetEl, config, guideId, nextCallback);
                }
            }, 500);
        }
    },

    show: function(targetEl, config, guideId, nextCallback) {
        // 1. 先滚动到可见区域
        const highlightEl = config.parent ? targetEl.closest(config.parent) : targetEl;
        
        // 特殊处理 Swiper 容器内的元素，避免触发页面整体水平滚动
        const swiperWrapper = highlightEl.closest('.function-swiper-wrapper');
        if (swiperWrapper) {
            const slide = highlightEl.closest('.function-slide');
            if (slide) {
                // 滚动到对应的 slide，使用 inline: 'start' 确保对齐且不溢出
                slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
            } else {
                highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        } else {
            highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // 强制重置页面水平滚动，防止露出侧边栏
        const resetScroll = () => {
            document.documentElement.scrollLeft = 0;
            document.body.scrollLeft = 0;
        };
        // 在滚动开始和结束时多次尝试重置
        setTimeout(resetScroll, 50);
        setTimeout(resetScroll, 200);
        setTimeout(resetScroll, 600);

        // 2. 延迟显示引导（等待滚动完成）
        setTimeout(() => {
            // 再次重置滚动位置，确保万无一失
            resetScroll();

            // 移除现有的引导
            this.cleanup();

            // 创建遮罩
            const overlay = document.createElement('div');
            overlay.className = 'guide-overlay visible';
            document.body.appendChild(overlay);

            // 重新计算高亮位置（滚动后）
            const rect = highlightEl.getBoundingClientRect();
            
            // 创建高亮框
            const highlightBox = document.createElement('div');
            highlightBox.className = 'guide-highlight-box';
            // 强制使用 fixed 定位，避免滚动容器导致的坐标偏移问题
            highlightBox.style.position = 'fixed';
            highlightBox.style.top = `${rect.top}px`;
            highlightBox.style.left = `${rect.left}px`;
            highlightBox.style.width = `${rect.width}px`;
            highlightBox.style.height = `${rect.height}px`;
            document.body.appendChild(highlightBox);

            // 创建提示气泡
            const tooltip = document.createElement('div');
            tooltip.className = `guide-tooltip ${config.position || 'bottom'} visible`;
            // 气泡也使用 fixed 定位
            tooltip.style.position = 'fixed';
            
            tooltip.innerHTML = `
                <div class="guide-content">${config.text}</div>
                <div class="guide-footer">
                    <button class="guide-btn guide-btn-primary">我知道了</button>
                </div>
            `;
            document.body.appendChild(tooltip);

            // 计算气泡位置 (需要先添加到 DOM 获取尺寸)
            const tooltipRect = tooltip.getBoundingClientRect();
            const tooltipWidth = tooltipRect.width;
            const screenWidth = window.innerWidth;
            const margin = 10; // 屏幕边缘间距

            let tooltipTop, tooltipLeft;
            
            // 初始水平居中对齐目标
            let idealLeft = rect.left + rect.width / 2 - tooltipWidth / 2;

            // 边界检测与调整
            if (idealLeft < margin) {
                tooltipLeft = margin;
            } else if (idealLeft + tooltipWidth > screenWidth - margin) {
                tooltipLeft = screenWidth - tooltipWidth - margin;
            } else {
                tooltipLeft = idealLeft;
            }

            // 计算箭头偏移量 (相对于 tooltip 左边缘)
            const targetCenterX = rect.left + rect.width / 2;
            let arrowRelX = targetCenterX - tooltipLeft;
            
            // 限制箭头在 tooltip 内部 (留出圆角空间)
            const arrowMargin = 20;
            if (arrowRelX < arrowMargin) arrowRelX = arrowMargin;
            if (arrowRelX > tooltipWidth - arrowMargin) arrowRelX = tooltipWidth - arrowMargin;

            // 设置箭头位置变量
            tooltip.style.setProperty('--arrow-left', `${arrowRelX}px`);

            // 垂直位置
            if (config.position === 'top') {
                tooltipTop = rect.top - 10; 
                tooltip.style.transform = 'translateY(-100%) translateY(-10px)';
            } else {
                tooltipTop = rect.bottom + 10;
                tooltip.style.transform = 'translateY(10px)';
            }
            
            tooltip.style.top = `${tooltipTop}px`;
            tooltip.style.left = `${tooltipLeft}px`;

            // 绑定事件
            const closeGuide = () => {
                this.cleanup();
                localStorage.setItem(guideId, 'true');
                if (nextCallback) nextCallback();
            };

            overlay.addEventListener('click', closeGuide);
            tooltip.querySelector('.guide-btn-primary').addEventListener('click', closeGuide);
        }, 500); // 等待 500ms 确保滚动完成
    },

    cleanup: function() {
        const overlay = document.querySelector('.guide-overlay');
        const highlight = document.querySelector('.guide-highlight-box');
        const tooltip = document.querySelector('.guide-tooltip');
        if (overlay) overlay.remove();
        if (highlight) highlight.remove();
        if (tooltip) tooltip.remove();
    }
};
window.GuideSystem = GuideSystem;

let loadingBtn = false

function renderTutorialContent() {
    const tutorialContentArea = document.getElementById('tutorial-content-area');
    const tutorials = [
        {title: '写在前面', imageUrls: ['https://i.postimg.cc/3RJfvgzq/xie-zai-qian-mian(1).jpg']},
        {
            title: '软件介绍',
            imageUrls: ['https://i.postimg.cc/VvsJRh6q/IMG-20250713-162647.jpg', 'https://i.postimg.cc/8P5FfxxD/IMG-20250713-162702.jpg', 'https://i.postimg.cc/3r94R3Sn/IMG-20250713-162712.jpg']
        },
        {
            title: '404',
            imageUrls: ['https://i.postimg.cc/x8scFPJW/IMG-20250713-162756.jpg', 'https://i.postimg.cc/pX6mfqtj/IMG-20250713-162809.jpg', 'https://i.postimg.cc/YScjV00q/IMG-20250713-162819.jpg', 'https://i.postimg.cc/13VfJw9j/IMG-20250713-162828.jpg']
        },
        {title: '404-群聊', imageUrls: ['https://i.postimg.cc/X7LSmRTJ/404.jpg']}
    ];
    tutorialContentArea.innerHTML = '';
    renderUpdateLog();
    tutorials.forEach(tutorial => {
        const item = document.createElement('div');
        item.className = 'tutorial-item';
        const imagesHtml = tutorial.imageUrls.map(url => `<img src="${url}" alt="${tutorial.title}教程图片">`).join('');
        item.innerHTML = `<div class="tutorial-header">${tutorial.title}</div><div class="tutorial-content">${imagesHtml}</div>`;
        tutorialContentArea.appendChild(item);
    });

    const persistenceHelp = document.createElement('div');
    persistenceHelp.className = 'tutorial-item';
    persistenceHelp.innerHTML = `<div class="tutorial-header">多窗口保存与索引冲突</div><div class="tutorial-content">
        <p>多个窗口打开同一小手机时，请尽量只在一个窗口编辑同一个角色。旧页面没有修改的记录会跳过保存，避免覆盖另一页的新记忆；双方都修改同一记录时，本次保存会中止并提示冲突。</p>
        <p>看到“已被其他页面或操作更新”：先在本页“数据管理 → 导出分类”保存未保存内容，关闭重复页面，刷新读取最新数据，再对照备份重新编辑。不要反复点击保存，也不要直接导入旧备份覆盖新内容；导入也会检查冲突。</p>
        <p>酒馆收取失败不会推进接收游标或确认收到，刷新后可重新收取，剧情仍须审核。向量索引提示“索引已更新”时，先刷新索引清单；不会自动重发嵌入请求。索引格式损坏时仅手动清理对应缓存并重建，日记原文保留，重建可能产生接口费用。</p>
        <p>保存保护适用于已更新页面；发布后请刷新仍开着的旧页面。备份主数据按一次快照读取，图片／字体／向量等独立存储并非一个全局原子快照，导出时建议暂停其他窗口编辑。</p>
    </div>`;
    tutorialContentArea.appendChild(persistenceHelp);
    const backupDataBtn = document.createElement('button');
    backupDataBtn.className = 'btn btn-primary';
    backupDataBtn.textContent = '备份数据';
    backupDataBtn.disabled = loadingBtn

    backupDataBtn.addEventListener('click', () => triggerManualBackup());
    const importDataBtn = document.createElement('label');
    importDataBtn.className = 'btn btn-neutral';
    importDataBtn.textContent = '导入数据';
    importDataBtn.style.marginTop = '15px'
    importDataBtn.style.display = 'block'
    importDataBtn.disabled = loadingBtn;
    importDataBtn.setAttribute('for', 'import-data-input')
    document.querySelector('#import-data-input').onchange = tutorialImportFile;

    tutorialContentArea.appendChild(backupDataBtn);
    tutorialContentArea.appendChild(importDataBtn);

    // 定期备份提醒设置
    const reminderSection = document.createElement('div');
    reminderSection.innerHTML = `
        <div style="font-size:0.89rem; color:#999; margin:20px 0 8px;">定期备份提醒</div>
        <div class="btn-white" style="display:block; cursor:default; background:#fff; border:1px solid #e0e0e0; border-radius:8px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>开启提醒</span>
                <label class="switch" style="position:relative; display:inline-block; width:40px; height:24px;">
                    <input type="checkbox" id="backup-reminder-switch" style="opacity:0; width:0; height:0;">
                    <span style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; transition:.4s; border-radius:24px;" id="reminder-switch-slider"></span>
                    <style>
                        #backup-reminder-switch:checked + #reminder-switch-slider { background-color: #333; }
                        #reminder-switch-slider:before { position:absolute; content:""; height:16px; width:16px; left:4px; bottom:4px; background-color:white; transition:.4s; border-radius:50%; }
                        #backup-reminder-switch:checked + #reminder-switch-slider:before { transform: translateX(16px); }
                    </style>
                </label>
            </div>
            <div id="reminder-interval-setting" style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                <span style="font-size:0.89rem; color:#666;">提醒频率</span>
                <select id="backup-reminder-interval" style="border:1px solid #eee; padding:5px; border-radius:4px; font-size:0.89rem; background:#fff;">
                    <option value="1">每 1 天</option>
                    <option value="3">每 3 天</option>
                    <option value="7">每 7 天</option>
                    <option value="15">每 15 天</option>
                    <option value="30">每 30 天</option>
                </select>
            </div>
        </div>
    `;
    tutorialContentArea.appendChild(reminderSection);

    const reminderSwitch = document.getElementById('backup-reminder-switch');
    const reminderInterval = document.getElementById('backup-reminder-interval');
    
    if (db.backupReminderSettings) {
        reminderSwitch.checked = db.backupReminderSettings.enabled !== false;
        reminderInterval.value = db.backupReminderSettings.interval || 3;
        document.getElementById('reminder-interval-setting').style.display = reminderSwitch.checked ? 'flex' : 'none';
    }

    reminderSwitch.addEventListener('change', async () => {
        db.backupReminderSettings.enabled = reminderSwitch.checked;
        document.getElementById('reminder-interval-setting').style.display = reminderSwitch.checked ? 'flex' : 'none';
        await saveData();
    });

    reminderInterval.addEventListener('change', async () => {
        db.backupReminderSettings.interval = parseInt(reminderInterval.value);
        await saveData();
    });

    // GitHub Backup UI
    const githubSection = document.createElement('div');
    const iconEyeOpen = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const iconEyeClosed = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    githubSection.innerHTML = `
        <div style="font-size:0.89rem; color:#999; margin:20px 0 8px;">云端备份 (GitHub)</div>
        <div class="btn-white" style="display:block; cursor:default; background:#fff; border:1px solid #e0e0e0; border-radius:8px; padding:12px;">
            <div id="gh-collapse-header" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding-bottom:5px;">
                <div style="display:flex; align-items:center;">
                    <span style="color:#333; font-weight:500;">🔧 配置参数</span>
                    <div id="gh-help-btn" style="margin-left:8px; display:flex; align-items:center; padding:2px; cursor:pointer;">
                        <svg style="width:16px; height:16px; color:#1890ff;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    </div>
                </div>
                <svg class="toggle-icon" style="width:14px; height:14px; color:#999; transition:transform 0.3s;" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>
            </div>

            <div id="gh-config-area" style="display:none; margin-top:10px; padding-top:10px; border-top:1px dashed #eee;">
                <div style="margin-bottom:10px;">
                    <div style="font-size:0.81rem; color:#666; margin-bottom:5px;">GitHub Token</div>
                    <div style="position:relative;">
                        <input type="password" id="gh-token-input" placeholder="ghp_xxxx..." style="width:100%; border:1px solid #eee; padding:8px; padding-right:35px; border-radius:4px; font-size:0.89rem;">
                        <div id="gh-eye-btn" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); color:#999; cursor:pointer; display:flex;">
                            ${iconEyeClosed}
                        </div>
                    </div>
                </div>
                <div style="margin-bottom:10px;">
                    <div style="font-size:0.81rem; color:#666; margin-bottom:5px;">仓库路径 (用户名/仓库名)</div>
                    <input type="text" id="gh-repo-input" placeholder="username/repo" style="width:100%; border:1px solid #eee; padding:8px; border-radius:4px; font-size:0.89rem;">
                </div>
                <div style="margin-bottom:10px;">
                    <div style="font-size:0.81rem; color:#666; margin-bottom:5px;">备份路径前缀 (可选，每次保存独立快照)</div>
                    <input type="text" id="gh-filename-input" placeholder="例如: backups/my_backup" style="width:100%; border:1px solid #eee; padding:8px; border-radius:4px; font-size:0.89rem;">
                </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; border-top:1px solid #f5f5f5; padding-top:10px;">
                <span>自动备份开关</span>
                <label class="switch" style="position:relative; display:inline-block; width:40px; height:24px;">
                    <input type="checkbox" id="gh-auto-switch" style="opacity:0; width:0; height:0;">
                    <span style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; transition:.4s; border-radius:24px;" id="gh-switch-slider"></span>
                    <style>
                        #gh-auto-switch:checked + #gh-switch-slider { background-color: #333; }
                        #gh-switch-slider:before { position:absolute; content:""; height:16px; width:16px; left:4px; bottom:4px; background-color:white; transition:.4s; border-radius:50%; }
                        #gh-auto-switch:checked + #gh-switch-slider:before { transform: translateX(16px); }
                    </style>
                </label>
            </div>

            <div id="gh-interval-setting" style="display:none; justify-content:space-between; align-items:center; margin-top:10px;">
                <span style="font-size:0.89rem; color:#666;">备份频率</span>
                <select id="gh-interval-select" style="border:1px solid #eee; padding:5px; border-radius:4px; font-size:0.89rem; background:#fff;">
                    <option value="24">每 24 小时</option>
                    <option value="36">每 36 小时</option>
                    <option value="48">每 48 小时</option>
                </select>
            </div>

            <div style="margin-top:15px; display:flex; gap:10px;">
                <div id="gh-backup-btn" style="flex:1; background:#333; color:#fff; text-align:center; padding:8px; border-radius:4px; font-size:0.89rem; cursor:pointer;">立即备份</div>
                <div id="gh-restore-btn" style="flex:1; background:#1890ff; color:#fff; text-align:center; padding:8px; border-radius:4px; font-size:0.89rem; cursor:pointer;">恢复最新</div>
                <div id="gh-check-btn" style="flex:1; background:#f5f5f5; color:#666; text-align:center; padding:8px; border-radius:4px; font-size:0.89rem; cursor:pointer;">检查状态</div>
            </div>
            
            <div class="gh-backup-options">
                <label class="gh-backup-option" for="gh-credentials-switch"><span>包含 API 密钥</span><input type="checkbox" id="gh-credentials-switch"></label>
                <label class="gh-backup-option" for="gh-vector-switch"><span>包含向量索引</span><input type="checkbox" id="gh-vector-switch" checked></label>
                <label class="gh-backup-branch" for="gh-branch-input"><span>备份分支</span><input id="gh-branch-input" type="text" placeholder="默认分支" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
                <div class="gh-backup-option-actions"><button id="gh-cancel-btn" type="button">取消备份任务</button></div>
            </div>
            <p class="gh-backup-notice">仅限私有仓库，备份含聊天隐私。压缩不等于加密；请先检查仓库可见性，密钥默认不包含。分支留空使用仓库默认分支。</p>
            <div id="gh-status-msg" style="margin-top:10px; font-size:0.74rem; color:#999;"></div>
        </div>
    `;
    
    tutorialContentArea.appendChild(githubSection);

    const existingOverlay = document.getElementById('gh-help-overlay');
    if (existingOverlay) existingOverlay.remove();

    const helpOverlay = document.createElement('div');
    helpOverlay.id = 'gh-help-overlay';
    helpOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; display: none; align-items: center; justify-content: center;';
    
    helpOverlay.onclick = function(e) { 
        if(e.target === this) this.style.display = 'none'; 
    };
    
    helpOverlay.innerHTML = `
        <div class="modal-window" style="width: 85%; max-height: 80vh; overflow-y: auto; background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 5px 20px rgba(0,0,0,0.2);">
            <h3 style="margin-top:0; margin-bottom:15px; text-align:center; font-size:1.1rem; color: var(--primary-color);">GitHub 配置指南</h3>
            
            <h4 style="margin:10px 0 5px; color:#333;">1. 获取 Token</h4>
            <ol style="padding-left:20px; font-size:0.89rem; color:#555; line-height:1.6;">
                <li>登录 GitHub，点击头像 → <strong>Settings</strong></li>
                <li>左侧菜单到底 → <strong>Developer settings</strong></li>
                <li><strong>Personal access tokens</strong> → <strong>Tokens (classic)</strong></li>
                <li>Generate new token (classic)</li>
                <li>Expiration 选 <strong>No expiration</strong></li>
                <li><strong style="color:#d32f2f;">Scopes 必须勾选 repo (包含所有子项)</strong></li>
                <li>点击 Generate，复制 ghp_ 开头的字符。<br><strong style="color:#d32f2f;">一定要现在复制并保存好！一旦刷新页面，你就再也看不到它了。</strong></li>
            </ol>

            <h4 style="margin:15px 0 5px; color:#333;">2. 创建仓库</h4>
            <ol style="padding-left:20px; font-size:0.89rem; color:#555; line-height:1.6;">
                <li>右上角 + 号 → <strong>New repository</strong></li>
                <li>Repository name 填个名字</li>
                <li>建议选 <strong>Private</strong> (私有)</li>
                <li>点击 Create repository</li>
            </ol>

            <h4 style="margin:15px 0 5px; color:#333;">3. 填写示例</h4>
            <ul style="padding-left:20px; font-size:0.89rem; color:#555; line-height:1.6;">
                <li>Token: <code>ghp_xxxxxxxxxxxx...</code></li>
                <li>仓库路径: <code>用户名/仓库名</code></li>
            </ul>

            <div style="margin-top:20px; text-align: center;">
                <button class="btn btn-primary" onclick="document.getElementById('gh-help-overlay').style.display='none'">我学会了</button>
            </div>
        </div>
    `;
    document.body.appendChild(helpOverlay);

    document.getElementById('gh-collapse-header').addEventListener('click', function() {
        const area = document.getElementById('gh-config-area');
        const icon = this.querySelector('.toggle-icon');
        if (area.style.display === 'none') {
            area.style.display = 'block';
            icon.style.transform = 'rotate(180deg)';
        } else {
            area.style.display = 'none';
            icon.style.transform = 'rotate(0deg)';
        }
    });

    document.getElementById('gh-help-btn').addEventListener('click', function(e) {
        e.stopPropagation(); 
        document.getElementById('gh-help-overlay').style.display = 'flex';
    });

    document.getElementById('gh-eye-btn').addEventListener('click', function() {
        const input = document.getElementById('gh-token-input');
        if (input.type === 'password') {
            input.type = 'text';
            this.innerHTML = iconEyeOpen;
        } else {
            input.type = 'password';
            this.innerHTML = iconEyeClosed;
        }
    });

    const saveHandler = () => { if(window.GitHubMgr) window.GitHubMgr.saveConfig(); };
    document.getElementById('gh-token-input').addEventListener('change', saveHandler);
    document.getElementById('gh-repo-input').addEventListener('change', saveHandler);
    document.getElementById('gh-filename-input').addEventListener('change', saveHandler);
    document.getElementById('gh-auto-switch').addEventListener('change', saveHandler);
    document.getElementById('gh-interval-select').addEventListener('change', saveHandler);
    for (const id of ['gh-credentials-switch','gh-vector-switch','gh-branch-input']) document.getElementById(id).addEventListener('change',saveHandler);
    document.getElementById('gh-cancel-btn').addEventListener('click',()=>window.GitHubMgr.cancel());

    document.getElementById('gh-backup-btn').addEventListener('click', event => window.GitHubMgr.testUpload(event));
    document.getElementById('gh-restore-btn').addEventListener('click', event => window.GitHubMgr.restoreLatest(event));
    document.getElementById('gh-check-btn').addEventListener('click', () => window.GitHubMgr.checkStatus());

    if(window.GitHubMgr) {
        window.GitHubMgr.init();
    }
}

// 创建完整的备份数据
async function createFullBackupData(options = {}) {
    const exportOptions = { includeCredentials: options.includeCredentials !== false, includeVectorIndex: options.includeVectorIndex !== false };
    let modules = storageClone(db);
    delete modules.uvuStoryBridgeSettings;
    delete modules.uvuStoryBridgeState;
    const capturedAt = Date.now();
    const media = storageExportMediaCache(modules), fonts = storageExportFonts();
    const vectors = exportOptions.includeVectorIndex && typeof VectorMemoryTools !== 'undefined' ? VectorMemoryTools.portableExport(modules) : Promise.resolve();
    [modules.mediaCache, modules.customFonts] = await Promise.all([media, fonts, vectors]);
    modules = storageApplyExportOptions(modules, exportOptions);
    modules._exportVersion = '3.0';
    return { version: '3.0', timestamp: new Date(capturedAt).toISOString(), modules,
        backupManifest: { version: 1, categories: ['chats','contacts','worldbooks','personas','wallpapers','fonts','settings','other'],
            ...exportOptions, resources: 'external-links-preserved', capturedAt, snapshotScope: 'detached-app-data-with-portable-stores' } };
}

function tutorialBackupSelection() {
    return { chats:true,contacts:true,worldbooks:true,personas:true,wallpapers:true,fonts:true,settings:true,other:true,replaceAll:true };
}
function tutorialConvertBackup(data) {
    const source = data?.modules ?? data;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('备份根数据必须是对象');
    const result = storageClone(source);
    if (result.__chunks__) {
        for (const key of ['characters','groups']) if (Array.isArray(result[key])) for (const chat of result[key]) {
            if (Array.isArray(chat.history) && typeof chat.history[0] === 'string') chat.history = chat.history.flatMap(key => {
                if (typeof result.__chunks__[key] !== 'string') throw new Error('备份缺少历史分块：' + key);
                const chunk = JSON.parse(result.__chunks__[key]);
                if (!Array.isArray(chunk)) throw new Error('历史分块格式无效');
                return chunk;
            });
        }
        delete result.__chunks__;
    }
    if (!data?.modules && source._exportVersion !== '3.0' && Array.isArray(result.worldBooks)) result.worldBooks = result.worldBooks.map(item =>
        item.type === 'entry' && ['middle','center'].includes(item.position) ? { ...item,position:'before',depth:300 } : item);
    return result;
}
async function importBackupData(data) {
    const start = Date.now();
    try {
        const modules = storageResolveImportOptions(tutorialConvertBackup(data));
        await storageCommitImport(tutorialBackupSelection(), modules);
        return { success:true,message:'导入完成 (耗时' + (Date.now()-start) + 'ms)' };
    } catch (error) { return { success:false,error:error.message,duration:Date.now()-start }; }
}
async function tutorialImportFile(event) {
    const input=event.target,file=input.files?.[0];
    if (!file || loadingBtn || GitHubMgr.inFlight) return;
    loadingBtn=true;
    const controller=new AbortController();
    GitHubMgr.controller=controller;
    try {
        const modules=await storageReadBackup(file,tutorialBackupSelection(),{signal:controller.signal});
        if(controller.signal.aborted)throw new Error('备份导入已取消');
        storageValidateModules(tutorialConvertBackup(modules));
        if (!confirm('此操作将用备份替换文件中提供的聊天与设置；未提供的分类保留。写入失败会保留原数据。确定导入？')) return;
        if(controller.signal.aborted)throw new Error('备份导入已取消');
        const result=await importBackupData(modules);
        if (!result.success) throw new Error(result.error);
        showToast('数据导入成功，应用即将刷新。');
        setTimeout(()=>window.location.reload(),1500);
    } catch(error) { showToast('导入失败: '+error.message); }
    finally { input.value='';loadingBtn=false;if(GitHubMgr.controller===controller)GitHubMgr.controller=null; }
}
async function tutorialBackupBlob(data) {
    if (typeof CompressionStream === 'function') {
        try { return { blob:await new Response((storageJsonStream(data)||new Blob([JSON.stringify(data)]).stream()).pipeThrough(new CompressionStream('gzip'))).blob(),extension:'ee' }; }
        catch (_) {}
    }
    return { blob:await new Response(storageJsonStream(data)||new Blob([JSON.stringify(data)]).stream()).blob(),extension:'json' };
}

// GitHub requests are bounded, cancellable and never retried automatically after PUT.
const GitHubMgr = {
    config:{token:'',repo:'',auto:false,interval:48,lastTime:0,fileName:'',branch:'',includeCredentials:false,includeVectorIndex:true},
    inFlight:null, timer:null, controller:null, initialized:false, lastAttempt:0,
    normalize(raw) {
        raw=raw && typeof raw==='object' && !Array.isArray(raw) ? raw : {};
        const text=key=>typeof raw[key]==='string'?raw[key].trim():'';
        return {token:text('token').replace(/^(Bearer|token)\s+/i,'').replace(/\s/g,''),repo:text('repo'),fileName:text('fileName'),branch:text('branch'),
            auto:raw.auto===true,interval:Number.isFinite(Number(raw.interval))&&Number(raw.interval)>=1&&Number(raw.interval)<=8760?Number(raw.interval):48,
            lastTime:Number.isFinite(raw.lastTime)&&raw.lastTime>=0?raw.lastTime:0,includeCredentials:raw.includeCredentials===true,includeVectorIndex:raw.includeVectorIndex!==false,
            lastSnapshot:text('lastSnapshot'),lastSnapshotRepo:text('lastSnapshotRepo'),lastSnapshotBranch:text('lastSnapshotBranch')};
    },
    persist() {
        try { localStorage.setItem('gh_config',JSON.stringify(GitHubMgr.config));return true; }
        catch (_) { showToast('备份配置未保存到本机；请检查浏览器存储权限或空间。本次配置仍在当前页面有效。');return false; }
    },
    init() {
        try { GitHubMgr.config=GitHubMgr.normalize(JSON.parse(localStorage.getItem('gh_config')||'{}')); }
        catch (_) { GitHubMgr.config=GitHubMgr.normalize({});showToast('备份配置无法读取，已恢复安全默认值，请重新填写。'); }
        for(const [id,key] of [['gh-token-input','token'],['gh-repo-input','repo'],['gh-filename-input','fileName'],['gh-branch-input','branch'],['gh-interval-select','interval']]) {
            const element=document.getElementById(id);if(element)element.value=GitHubMgr.config[key];
        }
        for(const [id,key] of [['gh-auto-switch','auto'],['gh-credentials-switch','includeCredentials'],['gh-vector-switch','includeVectorIndex']]) {
            const element=document.getElementById(id);if(element)element.checked=GitHubMgr.config[key];
        }
        const area=document.getElementById('gh-interval-setting');if(area)area.style.display=GitHubMgr.config.auto?'flex':'none';
        if(!GitHubMgr.initialized) {
            document.addEventListener('visibilitychange',()=>{if(!document.hidden)GitHubMgr.checkAndBackup();});
            GitHubMgr.initialized=true;
        }
        GitHubMgr.schedule();GitHubMgr.checkAndBackup();GitHubMgr.updateStatusText();
    },
    saveConfig() {
        const previous=GitHubMgr.config;
        const read=(id,fallback)=>document.getElementById(id)?.value??fallback;
        GitHubMgr.config=GitHubMgr.normalize({...previous,token:read('gh-token-input',previous.token),repo:read('gh-repo-input',previous.repo),fileName:read('gh-filename-input',previous.fileName),branch:read('gh-branch-input',previous.branch),
            interval:read('gh-interval-select',previous.interval),auto:document.getElementById('gh-auto-switch')?.checked??previous.auto,
            includeCredentials:document.getElementById('gh-credentials-switch')?.checked??previous.includeCredentials,
            includeVectorIndex:document.getElementById('gh-vector-switch')?.checked??previous.includeVectorIndex});
        const area=document.getElementById('gh-interval-setting');if(area)area.style.display=GitHubMgr.config.auto?'flex':'none';
        GitHubMgr.persist();GitHubMgr.updateStatusText();GitHubMgr.schedule();
    },
    updateStatusText() {
        const el=document.getElementById('gh-status-msg');if(!el)return;
        el.innerText=(GitHubMgr.config.lastTime?'上次: '+new Date(GitHubMgr.config.lastTime).toLocaleString():'从未备份过')+'；仅网页前台运行时检查到期，关闭或挂起时不保证定时。';
    },
    schedule() {
        clearTimeout(GitHubMgr.timer);
        if(!GitHubMgr.config.auto)return;
        GitHubMgr.timer=setTimeout(()=>{GitHubMgr.checkAndBackup();GitHubMgr.schedule();},60000);
    },
    async checkAndBackup() {
        const c=GitHubMgr.config,now=Date.now();
        if(document.hidden||!c.auto||!c.token||!c.repo||GitHubMgr.inFlight||now-c.lastTime<c.interval*3600000||now-GitHubMgr.lastAttempt<300000)return;
        GitHubMgr.lastAttempt=now;
        try { await GitHubMgr.performUpload(message=>showToast('自动备份: '+message));showToast('自动备份成功'); }
        catch(error) { showToast('自动备份失败: '+error.message); }
    },
    cancel() { GitHubMgr.controller?.abort(); },
    async request(url,options={},timeoutMs=30000,maxBytes=2*1024*1024) {
        const controller=new AbortController();
        const external=options.signal||GitHubMgr.controller?.signal;
        let timer,reader;
        const message=options.method==='PUT'?'上传已取消或超时，远端结果尚未确认；请先在仓库核实，勿直接重复上传。':'请求已取消或超时，请重试。';
        let abort;
        const deadline=new Promise((_,reject)=>{abort=()=>{controller.abort();reader?.cancel().catch(()=>{});reject(new Error(message));};timer=setTimeout(abort,timeoutMs);});
        external?.addEventListener('abort',abort,{once:true});
        try {
            if(external?.aborted)abort();
            return await Promise.race([deadline,(async()=>{
                const response=await fetch(url,{...options,signal:controller.signal,redirect:'error',referrerPolicy:'no-referrer'});
                const length=Number(response.headers.get('Content-Length'));
                if(length>maxBytes)throw new Error('备份响应超过允许大小，请使用分类文件迁移');
                if(!response.body)return response;
                reader=response.body.getReader();const parts=[];let bytes=0;
                while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new Error('备份响应超过允许大小，请使用分类文件迁移');}parts.push(chunk.value);}
                return new Response(new Blob(parts),{status:response.status,statusText:response.statusText,headers:response.headers});
            })()]);
        } finally { clearTimeout(timer);external?.removeEventListener('abort',abort);reader?.releaseLock(); }
    },
    validateConfig(config) {
        if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repo))throw new Error('仓库路径必须为 用户名/仓库名');
        if(config.fileName && (config.fileName.startsWith('/')||config.fileName.split('/').some(part=>!part||part==='.'||part==='..')||/[?#\\]/.test(config.fileName)))throw new Error('备份路径无效');
    },
    contentsUrl(config,path='') {
        const endpoint='https://api.github.com/repos/'+config.repo+'/contents/'+path.split('/').map(encodeURIComponent).join('/');
        return endpoint+(config.branch?'?ref='+encodeURIComponent(config.branch):'');
    },
    httpError(response) {
        if(response.status===409)return new Error('仓库版本冲突 (409)，未覆盖原快照，请检查另一设备的操作');
        if(response.status===403||response.status===429)return new Error('权限不足或达到 GitHub 速率限制 ('+response.status+')，请检查权限和稍后重试');
        return new Error('GitHub 请求失败 ('+response.status+')，请检查 Token、仓库、分支和文件大小');
    },
    async testUpload(event) {
        GitHubMgr.saveConfig();
        if(!GitHubMgr.config.token||!GitHubMgr.config.repo)return showToast('请先填写 Token 和仓库路径');
        const btn=event?.currentTarget||document.getElementById('gh-backup-btn'),original=btn?.innerText;
        if(btn){btn.innerText='备份中...';btn.style.pointerEvents='none';}
        try { await GitHubMgr.performUpload(showToast);showToast('上传成功！'); }
        catch(error){showToast('上传失败: '+error.message);}
        finally {if(btn){btn.innerText=original;btn.style.pointerEvents='auto';}}
    },
    performUpload(onProgress=()=>{}) {
        if(GitHubMgr.inFlight)return GitHubMgr.inFlight;
        const config={...GitHubMgr.config};
        GitHubMgr.controller=new AbortController();
        GitHubMgr.inFlight=GitHubMgr.uploadSnapshot(config,onProgress).finally(()=>{GitHubMgr.inFlight=null;GitHubMgr.controller=null;});
        return GitHubMgr.inFlight;
    },
    async uploadSnapshot(config,onProgress) {
        GitHubMgr.validateConfig(config);onProgress('正在检查权限...');
        const headers={Authorization:'token '+config.token,Accept:'application/vnd.github+json'};
        const check=await GitHubMgr.request('https://api.github.com/repos/'+config.repo,{headers});
        if(!check.ok)throw GitHubMgr.httpError(check);
        const repo=await check.json();
        if(repo.private!==true)throw new Error('公开仓库禁止上传包含聊天和隐私的完整备份，请使用私有仓库。');
        if(repo.permissions?.push===false)throw new Error('Token 缺少写入权限 (push)');
        if(!config.branch)config.branch=repo.default_branch||'';
        onProgress('正在打包数据...');
        const data=await createFullBackupData({includeCredentials:config.includeCredentials===true,includeVectorIndex:config.includeVectorIndex!==false});
        const output=await tutorialBackupBlob(data);
        if(GitHubMgr.controller?.signal.aborted)throw new Error('备份已取消');
        if(output.blob.size>48*1024*1024)throw new Error('云端备份超过 48 MB，请使用本地分类文件迁移');
        const bytes=new Uint8Array(await output.blob.arrayBuffer());let binary='';
        for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
        const prefix=config.fileName?config.fileName.replace(/\.(ee|json)$/i,''):'AutoBackup';
        // Immutable snapshot names keep the previous successful copy even if this upload fails.
        const path=prefix+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)+'.'+output.extension;
        const body={message:'UvU backup snapshot',content:btoa(binary),...(config.branch?{branch:config.branch}:{})};
        onProgress('正在上传至私有仓库...');
        const response=await GitHubMgr.request(GitHubMgr.contentsUrl({...config,branch:''},path),{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)},120000);
        if(!response.ok)throw GitHubMgr.httpError(response);
        if(GitHubMgr.config.repo===config.repo) {
            Object.assign(GitHubMgr.config,{lastTime:Date.now(),lastSnapshot:path,lastSnapshotRepo:config.repo,lastSnapshotBranch:config.branch});
            GitHubMgr.persist();GitHubMgr.updateStatusText();
        }
    },
    async checkStatus() {
        try {
            const config={...GitHubMgr.config};GitHubMgr.validateConfig(config);
            const response=await GitHubMgr.request('https://api.github.com/repos/'+config.repo,{headers:{Authorization:'token '+config.token}});
            if(!response.ok)throw GitHubMgr.httpError(response);
            const repo=await response.json();alert('连接成功；仓库: '+repo.full_name+'；可见性: '+(repo.private?'私有':'公开（禁止完整备份）'));
        }catch(error){showToast(error.message);}
    },
    async restoreLatest(event) {
        if(GitHubMgr.inFlight||loadingBtn)return showToast('另一个备份任务正在进行，请稍候或取消。');
        GitHubMgr.saveConfig();const config={...GitHubMgr.config};
        const btn=event?.currentTarget||document.getElementById('gh-restore-btn'),original=btn?.innerText;
        if(btn){btn.innerText='恢复中...';btn.style.pointerEvents='none';}
        GitHubMgr.controller=new AbortController();
        const operation=GitHubMgr.restoreSnapshot(config);GitHubMgr.inFlight=operation;
        try{await operation;}catch(error){showToast('恢复失败: '+error.message);}
        finally{GitHubMgr.inFlight=null;GitHubMgr.controller=null;if(btn){btn.innerText=original;btn.style.pointerEvents='auto';}}
    },
    async restoreSnapshot(config) {
        GitHubMgr.validateConfig(config);
        const headers={Authorization:'token '+config.token};let path;
        if(config.lastSnapshot&&config.lastSnapshotRepo===config.repo&&(!config.branch||config.lastSnapshotBranch===config.branch))path=config.lastSnapshot;
        else {
            const prefix=config.fileName?config.fileName.replace(/\.(ee|json)$/i,''):'AutoBackup';
            const slash=prefix.lastIndexOf('/'),directory=slash>=0?prefix.slice(0,slash):'',name=prefix.slice(slash+1);
            const listing=await GitHubMgr.request(GitHubMgr.contentsUrl(config,directory),{headers});if(!listing.ok)throw GitHubMgr.httpError(listing);
            const files=await listing.json();if(!Array.isArray(files))throw new Error('备份目录无效');
            const backups=files.filter(file=>file.type==='file'&&/\.(ee|json)$/i.test(file.name)&&(file.name.startsWith(name+'_')||file.name===name+'.ee'||file.name===name+'.json'));
            backups.sort((x,y)=>{const stamp=name=>Number(name.match(/_(\d+)(?:_[a-z0-9]+)?\.(?:ee|json)$/i)?.[1]||0);return stamp(y.name)-stamp(x.name);});
            if(!backups.length)throw new Error('未找到备份；请检查目录和分支，或下载本地分类文件恢复');
            if(files.length>=1000)throw new Error('目录文件过多，无法可靠判断最新快照；请下载指定文件后本地导入');
            path=backups[0].path||[directory,backups[0].name].filter(Boolean).join('/');
        }
        showToast('正在下载: '+path);
        const response=await GitHubMgr.request(GitHubMgr.contentsUrl(config,path),{headers:{...headers,Accept:'application/vnd.github.raw+json'}},120000,64*1024*1024);
        if(!response.ok)throw GitHubMgr.httpError(response);
        const file=new File([await response.blob()],path);
        const modules=await storageReadBackup(file,tutorialBackupSelection(),{signal:GitHubMgr.controller?.signal});
        storageValidateModules(tutorialConvertBackup(modules));
        if(!confirm('已校验备份 '+path+'。确认替换文件中提供的聊天与设置？取消不会写入数据。'))return;
        const result=await importBackupData(modules);if(!result.success)throw new Error(result.error);
        showToast('恢复成功，应用即将刷新。');setTimeout(()=>window.location.reload(),1500);
    }
};
window.GitHubMgr = GitHubMgr;

// 全局手动备份触发函数
async function triggerManualBackup() {
    if (loadingBtn) return;
    loadingBtn = true;
    try {
        showToast('正在准备导出数据...');

        const fullBackupData = await createFullBackupData();

        const { blob: compressedBlob, extension } = await tutorialBackupBlob(fullBackupData);

        const url = URL.createObjectURL(compressedBlob);
        const a = document.createElement('a');
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
        a.href = url;
        a.download = `章鱼喷墨_备份数据_${date}_${time}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        loadingBtn = false;
        showToast('聊天记录导出成功');
        
        // 更新提醒时间
        if (db.backupReminderSettings) {
            db.backupReminderSettings.lastReminderTime = Date.now();
            await saveData();
        }
    } catch (e) {
        loadingBtn = false;
        showToast(`导出失败, 发生错误: ${e.message}`);
        console.error('导出错误详情:', e);
    }
}
window.triggerManualBackup = triggerManualBackup;
