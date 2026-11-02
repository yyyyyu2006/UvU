(function() {
    const MAX_LOGS = 50;
    const logs = [];

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    function formatMessage(args) {
        return Array.from(args).map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    }

    function addLog(type, args) {
        const message = formatMessage(args);
        const now = new Date();
        const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
        
        logs.push({ type, message, timestamp });
        if (logs.length > MAX_LOGS) {
            logs.shift();
        }
        
        renderConsoleLogs();
    }

    console.log = function(...args) {
        addLog('log', args);
        originalLog.apply(console, args);
    };

    console.warn = function(...args) {
        addLog('warn', args);
        originalWarn.apply(console, args);
    };

    console.error = function(...args) {
        addLog('error', args);
        originalError.apply(console, args);
    };

    let currentFilter = 'all';

    window.renderConsoleLogs = function() {
        const container = document.getElementById('console-log-container');
        if (!container) return;

        const filteredLogs = logs.filter(log => {
            if (currentFilter === 'all') return true;
            if (currentFilter === 'log') return log.type === 'log';
            if (currentFilter === 'error') return log.type === 'error' || log.type === 'warn';
            return true;
        });

        container.innerHTML = filteredLogs.map((log, index) => `
            <div class="console-log-item ${log.type}" data-index="${index}">
                <div class="console-msg-wrapper">
                    <span class="console-msg">${log.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                    <span class="console-time">${log.timestamp}</span>
                </div>
                <button class="console-item-copy-btn" title="复制此条">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
            </div>
        `).join('');
        
        container.scrollTop = container.scrollHeight;
    };

    window.clearConsoleLogs = function() {
        logs.length = 0;
        renderConsoleLogs();
    };

    // 绑定事件
    document.addEventListener('DOMContentLoaded', () => {
        // 修复返回按钮逻辑
        const closeBtn = document.querySelector('#console-screen .close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof switchScreen === 'function') {
                    switchScreen('home-screen');
                }
            });
        }

        // 主题切换逻辑
        const themeBtn = document.getElementById('console-theme-btn');
        const consoleScreen = document.getElementById('console-screen');
        
        if (themeBtn && consoleScreen) {
            const iconSun = themeBtn.querySelector('.icon-sun');
            const iconMoon = themeBtn.querySelector('.icon-moon');
            
            // 初始化主题
            const savedTheme = localStorage.getItem('console_theme') || 'dark';
            if (savedTheme === 'light') {
                consoleScreen.classList.add('light-theme');
                iconSun.style.display = 'none';
                iconMoon.style.display = 'block';
            }
            
            themeBtn.addEventListener('click', () => {
                const isLight = consoleScreen.classList.toggle('light-theme');
                if (isLight) {
                    iconSun.style.display = 'none';
                    iconMoon.style.display = 'block';
                    localStorage.setItem('console_theme', 'light');
                } else {
                    iconSun.style.display = 'block';
                    iconMoon.style.display = 'none';
                    localStorage.setItem('console_theme', 'dark');
                }
            });
        }

        const clearBtn = document.getElementById('console-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                window.clearConsoleLogs();
            });
        }

        const filterBtns = document.querySelectorAll('.console-filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentFilter = e.target.dataset.filter;
                renderConsoleLogs();
            });
        });

        // 委托复制按钮点击事件
        const container = document.getElementById('console-log-container');
        if (container) {
            container.addEventListener('click', (e) => {
                const copyBtn = e.target.closest('.console-item-copy-btn');
                if (copyBtn) {
                    const logItem = copyBtn.closest('.console-log-item');
                    const index = logItem.dataset.index;
                    const log = logs[index];
                    if (log) {
                        const textToCopy = `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`;
                        
                        if (navigator.clipboard && window.isSecureContext) {
                            navigator.clipboard.writeText(textToCopy).then(() => {
                                if (typeof showToast === 'function') showToast('已复制');
                            }).catch(err => {
                                console.error('复制失败:', err);
                                if (typeof showToast === 'function') showToast('复制失败');
                            });
                        } else {
                            // 降级方案
                            const textArea = document.createElement("textarea");
                            textArea.value = textToCopy;
                            textArea.style.position = "fixed";
                            textArea.style.left = "-999999px";
                            textArea.style.top = "-999999px";
                            document.body.appendChild(textArea);
                            textArea.focus();
                            textArea.select();
                            try {
                                document.execCommand('copy');
                                if (typeof showToast === 'function') showToast('已复制');
                            } catch (err) {
                                console.error('复制失败:', err);
                                if (typeof showToast === 'function') showToast('复制失败');
                            }
                            textArea.remove();
                        }
                    }
                }
            });
        }
    });
})();
