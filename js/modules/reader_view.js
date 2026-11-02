// --- 阅读器视图逻辑 (js/modules/reader_view.js) ---

document.addEventListener('DOMContentLoaded', () => {
    const readerScreen = document.getElementById('reader-view-screen');
    const header = document.getElementById('reader-header');
    const footer = document.getElementById('reader-footer');
    const contentArea = document.getElementById('reader-content-area');
    const textContainer = document.getElementById('reader-text-container');
    const chapterTitleEl = document.getElementById('reader-chapter-title');
    const bookTitleEl = document.getElementById('reader-book-title');
    const progressInfo = document.getElementById('reader-progress-info');
    
    const tocBtn = document.getElementById('reader-toc-btn');
    const tocOverlay = document.getElementById('reader-toc-overlay');
    const tocList = document.getElementById('reader-toc-list');
    const tocCount = document.getElementById('reader-toc-count');
    
    const settingsBtn = document.getElementById('reader-settings-btn');
    const settingsOverlay = document.getElementById('reader-settings-overlay');
    const settingsCloseBtn = document.getElementById('reader-settings-close');
    const fontIncreaseBtn = document.getElementById('reader-font-increase');
    const fontDecreaseBtn = document.getElementById('reader-font-decrease');
    const fontSizeDisplay = document.getElementById('reader-font-size-display');
    const fontColorPicker = document.getElementById('reader-font-color-picker');
    const fontColorResetBtn = document.getElementById('reader-font-color-reset');
    const themeCircles = document.querySelectorAll('.reader-theme-circle');
    const bgUploadBtn = document.getElementById('reader-bg-upload-btn');
    const bgUploadInput = document.getElementById('reader-bg-upload');
    const bgClearBtn = document.getElementById('reader-bg-clear-btn');
    
    const marginInputs = {
        top: document.getElementById('reader-margin-top'),
        bottom: document.getElementById('reader-margin-bottom'),
        left: document.getElementById('reader-margin-left'),
        right: document.getElementById('reader-margin-right')
    };

    let currentBook = null;
    let currentChapters = [];
    let currentChapterIndex = 0;
    let fontSize = 18;
    let isMenuVisible = false;
    let scrollSaveTimer = null;
    let currentPage = 0;
    let totalPages = 0;

    // 绑定返回键
    const backBtn = document.getElementById('reader-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (typeof switchScreen === 'function') {
                switchScreen('reader-bookshelf-screen');
            }
        });
    }

    // 加载书籍
    async function loadBook(bookId) {
        try {
            currentBook = await dexieDB.reader_books.get(bookId);
            if (!currentBook) throw new Error("书籍不存在");

            bookTitleEl.textContent = currentBook.title;
            
            // 获取所有章节（仅获取标题用于目录，正文按需加载）
            currentChapters = await dexieDB.reader_chapters
                .where('bookId').equals(bookId)
                .sortBy('index');

            tocCount.textContent = `共${currentChapters.length}章`;
            
            // 渲染目录
            renderToc();

            // 加载上次阅读的章节
            currentChapterIndex = currentBook.currentChapterIndex || 0;
            await loadChapter(currentChapterIndex, currentBook.scrollProgress || 0);

            // 更新最后阅读时间
            await dexieDB.reader_books.update(bookId, { lastReadTime: Date.now() });

        } catch (error) {
            console.error("加载书籍失败:", error);
            if (typeof showToast === 'function') showToast("加载书籍失败");
        }
    }

    // 计算总页数
    function calculatePages() {
        const containerWidth = contentArea.clientWidth;
        const scrollWidth = textContainer.scrollWidth;
        totalPages = Math.ceil(scrollWidth / containerWidth);
        if (totalPages === 0) totalPages = 1;
    }

    // 跳转到指定页
    function goToPage(pageIndex, instant = false) {
        if (pageIndex < 0) {
            // 上一章
            if (currentChapterIndex > 0) {
                loadChapter(currentChapterIndex - 1, 0.999); // 0.999 表示跳到最后一页
            } else {
                if (typeof showToast === 'function') showToast("已经是第一章了");
            }
            return;
        }
        
        if (pageIndex >= totalPages) {
            // 下一章
            if (currentChapterIndex < currentChapters.length - 1) {
                loadChapter(currentChapterIndex + 1, 0);
            } else {
                if (typeof showToast === 'function') showToast("已经是最后一章了");
            }
            return;
        }

        currentPage = pageIndex;
        const containerWidth = contentArea.clientWidth;
        
        if (instant) {
            textContainer.style.transition = 'none';
            textContainer.style.transform = `translateX(-${currentPage * containerWidth}px)`;
            // 强制重绘
            textContainer.offsetHeight;
            // 恢复过渡动画
            textContainer.style.transition = '';
        } else {
            textContainer.style.transform = `translateX(-${currentPage * containerWidth}px)`;
        }
        
        updateProgress();
        saveProgress();
    }

    // 加载指定章节
    async function loadChapter(index, scrollProgress = 0) {
        if (index < 0 || index >= currentChapters.length) return;

        try {
            const chapter = currentChapters[index];
            chapterTitleEl.textContent = chapter.title;
            
            // 获取该章节的所有段评
            const comments = await dexieDB.reader_comments
                .where('bookId').equals(currentBook.id)
                .toArray();
            
            // 按段落索引分组统计评论数
            const commentCounts = {};
            comments.forEach(c => {
                if (c.chapterIndex === index) {
                    commentCounts[c.paragraphIndex] = (commentCounts[c.paragraphIndex] || 0) + 1;
                }
            });

            // 将文本按换行符分割成段落，保留原文的空格，只过滤掉纯空行
            const paragraphs = chapter.content.split('\n').filter(p => p !== '');
            const htmlContent = paragraphs.map((p, pIndex) => {
                let iconHtml = '';
                if (commentCounts[pIndex]) {
                    // 移除换行和多余空格，确保图标紧跟在文字后面
                    iconHtml = `<span class="reader-inline-comment-icon" contenteditable="false"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chat-square-quote" viewBox="0 0 16 16"><path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2.5a2 2 0 0 0-1.6.8L8 14.333 6.1 11.8a2 2 0 0 0-1.6-.8H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2.5a1 1 0 0 1 .8.4l1.9 2.533a1 1 0 0 0 1.6 0l1.9-2.533a1 1 0 0 1 .8-.4H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M7.066 4.76A1.665 1.665 0 0 0 4 5.668a1.667 1.667 0 0 0 2.561 1.406c-.131.389-.375.804-.777 1.22a.417.417 0 1 0 .6.58c1.486-1.54 1.293-3.214.682-4.112zm4 0A1.665 1.665 0 0 0 8 5.668a1.667 1.667 0 0 0 2.561 1.406c-.131.389-.375.804-.777 1.22a.417.417 0 1 0 .6.58c1.486-1.54 1.293-3.214.682-4.112z"/></svg><span class="reader-inline-comment-count">${commentCounts[pIndex]}</span></span>`;
                }
                return `<p data-index="${pIndex}">${p}${iconHtml}</p>`;
            }).join('');
            
            // 使用 DocumentFragment 优化插入
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            
            // 为已有的图标绑定点击事件
            tempDiv.querySelectorAll('.reader-inline-comment-icon').forEach(icon => {
                icon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openCommentPanel(icon.closest('p'));
                });
            });

            const textContentEl = document.getElementById('reader-text-content');
            if (textContentEl) {
                textContentEl.innerHTML = '';
                textContentEl.appendChild(tempDiv);
            }

            currentChapterIndex = index;
            updateTocHighlight();

            // 等待 DOM 渲染完成计算页数
            requestAnimationFrame(() => {
                setTimeout(() => {
                    calculatePages();
                    
                    // 根据 scrollProgress 恢复页码
                    let targetPage = 0;
                    if (scrollProgress > 0) {
                        targetPage = Math.floor(scrollProgress * totalPages);
                        if (targetPage >= totalPages) targetPage = totalPages - 1;
                    }
                    
                    goToPage(targetPage, true);
                }, 50);
            });

        } catch (error) {
            console.error("加载章节失败:", error);
        }
    }

    // 保存进度
    async function saveProgress() {
        if (!currentBook) return;
        
        if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(async () => {
            const scrollProgress = totalPages > 1 ? currentPage / totalPages : 0;
            await dexieDB.reader_books.update(currentBook.id, { 
                currentChapterIndex: currentChapterIndex,
                scrollProgress: scrollProgress
            });
        }, 500);
    }

    // 渲染目录
    function renderToc() {
        tocList.innerHTML = '';
        currentChapters.forEach((ch, index) => {
            const li = document.createElement('li');
            li.className = 'reader-toc-item';
            li.textContent = ch.title;
            li.dataset.index = index;
            
            li.addEventListener('click', () => {
                loadChapter(index);
                toggleToc(false);
                toggleMenu(false);
            });
            
            tocList.appendChild(li);
        });
    }

    // 更新目录高亮
    function updateTocHighlight() {
        const items = tocList.querySelectorAll('.reader-toc-item');
        items.forEach(item => item.classList.remove('active'));
        if (items[currentChapterIndex]) {
            items[currentChapterIndex].classList.add('active');
            // 滚动目录到可视区域
            items[currentChapterIndex].scrollIntoView({ block: 'center' });
        }
    }

    // 更新进度显示
    function updateProgress() {
        if (!currentBook || currentChapters.length === 0) return;
        
        const chapterProgress = totalPages > 1 ? currentPage / totalPages : 0;
        const totalProgress = ((currentChapterIndex + chapterProgress) / currentChapters.length) * 100;
        
        progressInfo.textContent = `${totalProgress.toFixed(1)}%`;
    }

    // 监听窗口大小变化，重新计算页数
    window.addEventListener('resize', () => {
        if (readerScreen.classList.contains('active') && currentBook) {
            // 记录当前进度比例
            const currentRatio = totalPages > 0 ? currentPage / totalPages : 0;
            
            calculatePages();
            
            // 恢复到大致相同的进度
            let newPage = Math.floor(currentRatio * totalPages);
            if (newPage >= totalPages) newPage = totalPages - 1;
            
            goToPage(newPage, true);
        }
    });

    // 菜单切换
    function toggleMenu(show) {
        isMenuVisible = show !== undefined ? show : !isMenuVisible;
        if (isMenuVisible) {
            header.classList.remove('hidden');
            footer.classList.remove('hidden');
        } else {
            header.classList.add('hidden');
            footer.classList.add('hidden');
            settingsOverlay.classList.remove('active');
        }
    }

    // --- 翻页与菜单呼出逻辑重构 ---
    // 移除原有的触控区域事件，改为在整个内容区域监听点击，
    // 这样可以避免触控区域遮挡文字导致长按/右键失效。
    contentArea.addEventListener('click', (e) => {
        // 如果点击的是段评图标或悬浮菜单，不处理翻页
        if (e.target.closest('.reader-inline-comment-icon') || 
            e.target.closest('.reader-paragraph-menu') ||
            e.target.closest('.reader-comment-overlay')) {
            return;
        }

        // 如果菜单正在显示，点击任何地方都先隐藏菜单
        if (isMenuVisible) {
            toggleMenu(false);
            return;
        }

        // 获取点击的 X 坐标
        const x = e.clientX;
        const width = window.innerWidth;

        if (x < width * 0.3) {
            // 左侧 30%：上一页
            goToPage(currentPage - 1);
        } else if (x > width * 0.7) {
            // 右侧 30%：下一页
            goToPage(currentPage + 1);
        } else {
            // 中间 40%：呼出菜单
            toggleMenu();
        }
    });

    // --- 段评功能逻辑 ---
    const paragraphMenu = document.getElementById('reader-paragraph-menu');
    const menuCommentBtn = document.getElementById('reader-menu-comment');
    const menuCopyBtn = document.getElementById('reader-menu-copy');
    
    const commentOverlay = document.getElementById('reader-comment-overlay');
    const commentCloseBtn = document.getElementById('reader-comment-close');
    const commentQuoteEl = document.getElementById('reader-comment-quote');
    const commentListEl = document.getElementById('reader-comment-list');
    const commentInput = document.getElementById('reader-comment-input');
    const commentSendBtn = document.getElementById('reader-comment-send');

    let selectedParagraph = null;
    let currentCommentParagraph = null; // 专门用于段评面板的段落引用
    let longPressTimer = null;
    let isLongPressing = false;

    // 隐藏悬浮菜单
    function hideParagraphMenu() {
        paragraphMenu.style.display = 'none';
        if (selectedParagraph) {
            selectedParagraph.classList.remove('selected');
            selectedParagraph = null;
        }
    }

    // 显示悬浮菜单
    function showParagraphMenu(pElement, x, y) {
        hideParagraphMenu(); // 先隐藏之前的
        selectedParagraph = pElement;
        selectedParagraph.classList.add('selected');
        
        paragraphMenu.style.display = 'flex';
        
        // 简单定位，确保不超出屏幕
        const menuRect = paragraphMenu.getBoundingClientRect();
        let left = x;
        let top = y - menuRect.height - 10; // 默认在手指上方
        
        if (top < 0) top = y + 20; // 如果上方空间不足，放下方
        if (left < menuRect.width / 2) left = menuRect.width / 2;
        if (left > window.innerWidth - menuRect.width / 2) left = window.innerWidth - menuRect.width / 2;

        paragraphMenu.style.left = `${left}px`;
        paragraphMenu.style.top = `${top}px`;
    }

    // 绑定长按事件到文本容器
    const textContentEl = document.getElementById('reader-text-content');
    if (textContentEl) {
        textContentEl.addEventListener('touchstart', (e) => {
            if (e.target.tagName === 'P') {
                isLongPressing = false;
                longPressTimer = setTimeout(() => {
                    isLongPressing = true;
                    const touch = e.touches[0];
                    showParagraphMenu(e.target, touch.clientX, touch.clientY);
                }, 500); // 500ms 触发长按
            }
        }, { passive: true });

        textContentEl.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
        }, { passive: true });

        textContentEl.addEventListener('touchend', (e) => {
            clearTimeout(longPressTimer);
            // 如果不是长按，且点击的不是段评图标，则隐藏菜单
            if (!isLongPressing && !e.target.closest('.reader-inline-comment-icon')) {
                hideParagraphMenu();
            }
        });
        
        // 鼠标事件支持 (用于测试)
        textContentEl.addEventListener('mousedown', (e) => {
            // 忽略右键点击，右键由 contextmenu 事件处理
            if (e.button === 2) return;
            
            if (e.target.tagName === 'P') {
                isLongPressing = false;
                longPressTimer = setTimeout(() => {
                    isLongPressing = true;
                    showParagraphMenu(e.target, e.clientX, e.clientY);
                }, 500);
            }
        });
        textContentEl.addEventListener('mousemove', () => clearTimeout(longPressTimer));
        textContentEl.addEventListener('mouseup', (e) => {
            if (e.button === 2) return;
            clearTimeout(longPressTimer);
            if (!isLongPressing && !e.target.closest('.reader-inline-comment-icon')) {
                hideParagraphMenu();
            }
        });

        // PC 端右键支持
        textContentEl.addEventListener('contextmenu', (e) => {
            if (e.target.tagName === 'P') {
                e.preventDefault(); // 阻止浏览器默认右键菜单
                showParagraphMenu(e.target, e.clientX, e.clientY);
            }
        });
    }

    // 复制功能
    menuCopyBtn.addEventListener('click', () => {
        if (selectedParagraph) {
            // 移除可能包含的段评图标文本
            const clone = selectedParagraph.cloneNode(true);
            const icons = clone.querySelectorAll('.reader-inline-comment-icon');
            icons.forEach(icon => icon.remove());
            
            navigator.clipboard.writeText(clone.textContent).then(() => {
                if (typeof showToast === 'function') showToast("已复制");
                hideParagraphMenu();
            }).catch(err => {
                console.error('复制失败:', err);
                if (typeof showToast === 'function') showToast("复制失败");
            });
        }
    });

    // 写段评功能
    menuCommentBtn.addEventListener('click', () => {
        if (selectedParagraph) {
            openCommentPanel(selectedParagraph);
            hideParagraphMenu();
        }
    });

    // 打开段评面板
    async function openCommentPanel(pElement) {
        currentCommentParagraph = pElement; // 使用专门的变量记录
        const pIndex = parseInt(pElement.dataset.index);
        
        // 提取纯文本引文
        const clone = pElement.cloneNode(true);
        const icons = clone.querySelectorAll('.reader-inline-comment-icon');
        icons.forEach(icon => icon.remove());
        commentQuoteEl.textContent = clone.textContent;
        
        // 从数据库加载该段落的评论列表
        try {
            const comments = await dexieDB.reader_comments
                .where('[bookId+chapterIndex+paragraphIndex]')
                .equals([currentBook.id, currentChapterIndex, pIndex])
                .toArray();
            
            if (comments.length === 0) {
                commentListEl.innerHTML = '<div style="text-align:center; color:#888; padding: 20px;">暂无评论，快来抢沙发吧！</div>';
            } else {
                // 按时间倒序排列
                comments.sort((a, b) => b.timestamp - a.timestamp);
                
                const listHtml = comments.map(c => {
                    const date = new Date(c.timestamp);
                    const timeStr = `${date.getMonth()+1}-${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                    
                    let contentHtml = '';
                    if (c.content.startsWith('[ILLUSTRATION]')) {
                        const base64Data = c.content.replace('[ILLUSTRATION]', '');
                        contentHtml = `<img src="data:image/png;base64,${base64Data}" class="reader-illustration-img" onclick="window.readerView.openFullscreenImage(this.src)">`;
                    } else {
                        contentHtml = `<div class="reader-comment-content">${c.content}</div>`;
                    }

                    return `
                        <div class="reader-comment-item">
                            <div class="reader-comment-user">${c.content.startsWith('[ILLUSTRATION]') ? 'AI 插画师' : '我'}</div>
                            ${contentHtml}
                            <div class="reader-comment-time">${timeStr}</div>
                        </div>
                    `;
                }).join('');
                commentListEl.innerHTML = listHtml;
            }
        } catch (error) {
            console.error("加载评论失败:", error);
            commentListEl.innerHTML = '<div style="text-align:center; color:red; padding: 20px;">加载评论失败</div>';
        }
        
        commentOverlay.classList.add('active');
        
    }

    // 全屏图片查看器逻辑
    const fullscreenViewer = document.getElementById('reader-fullscreen-viewer');
    const fullscreenImg = document.getElementById('reader-fullscreen-img');
    let saveImageTimer = null;

    window.readerView = window.readerView || {};
    window.readerView.openFullscreenImage = function(src) {
        fullscreenImg.src = src;
        fullscreenViewer.classList.add('active');
    };

    if (fullscreenViewer) {
        fullscreenViewer.addEventListener('click', () => {
            fullscreenViewer.classList.remove('active');
        });

        // 长按保存图片
        fullscreenImg.addEventListener('touchstart', (e) => {
            saveImageTimer = setTimeout(() => {
                const a = document.createElement('a');
                a.href = fullscreenImg.src;
                a.download = `illustration_${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                if (typeof showToast === 'function') showToast("图片已保存");
            }, 800); // 800ms 长按
        });

        fullscreenImg.addEventListener('touchend', () => {
            clearTimeout(saveImageTimer);
        });
        fullscreenImg.addEventListener('touchmove', () => {
            clearTimeout(saveImageTimer);
        });
    }

    // 关闭段评面板
    commentCloseBtn.addEventListener('click', () => {
        commentOverlay.classList.remove('active');
    });
    commentOverlay.addEventListener('click', (e) => {
        if (e.target === commentOverlay) {
            commentOverlay.classList.remove('active');
        }
    });

    // 发送段评
    commentSendBtn.addEventListener('click', async () => {
        const text = commentInput.value.trim();
        
        if (!text) {
            if (typeof showToast === 'function') showToast("请输入评论内容");
            return;
        }
        if (!currentCommentParagraph) {
            console.error("发送段评失败：未选中段落");
            return;
        }
        if (!currentBook) {
            console.error("发送段评失败：未找到当前书籍信息");
            return;
        }
        
        const pIndex = parseInt(currentCommentParagraph.dataset.index);
        
        try {
            // 保存到数据库
            await dexieDB.reader_comments.add({
                bookId: currentBook.id,
                chapterIndex: currentChapterIndex,
                paragraphIndex: pIndex,
                content: text,
                timestamp: Date.now()
            });
            
            commentInput.value = '';
            if (typeof showToast === 'function') showToast("发送成功");
            
            // 更新 UI：添加或更新图标数字
            let iconEl = currentCommentParagraph.querySelector('.reader-inline-comment-icon');
            if (iconEl) {
                const countEl = iconEl.querySelector('.reader-inline-comment-count');
                countEl.textContent = parseInt(countEl.textContent) + 1;
            } else {
                // 移除换行和多余空格
                const iconHtml = `<span class="reader-inline-comment-icon" contenteditable="false"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chat-square-quote" viewBox="0 0 16 16"><path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2.5a2 2 0 0 0-1.6.8L8 14.333 6.1 11.8a2 2 0 0 0-1.6-.8H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2.5a1 1 0 0 1 .8.4l1.9 2.533a1 1 0 0 0 1.6 0l1.9-2.533a1 1 0 0 1 .8-.4H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M7.066 4.76A1.665 1.665 0 0 0 4 5.668a1.667 1.667 0 0 0 2.561 1.406c-.131.389-.375.804-.777 1.22a.417.417 0 1 0 .6.58c1.486-1.54 1.293-3.214.682-4.112zm4 0A1.665 1.665 0 0 0 8 5.668a1.667 1.667 0 0 0 2.561 1.406c-.131.389-.375.804-.777 1.22a.417.417 0 1 0 .6.58c1.486-1.54 1.293-3.214.682-4.112z"/></svg><span class="reader-inline-comment-count">1</span></span>`;
                currentCommentParagraph.insertAdjacentHTML('beforeend', iconHtml);
                
                // 绑定点击事件
                const newIcon = currentCommentParagraph.querySelector('.reader-inline-comment-icon');
                newIcon.addEventListener('click', (e) => {
                    e.stopPropagation(); // 阻止冒泡，防止触发段落点击
                    openCommentPanel(currentCommentParagraph);
                });
            }
            
            // 刷新当前面板的评论列表
            openCommentPanel(currentCommentParagraph);
            
        } catch (error) {
            console.error("保存评论失败:", error);
            if (typeof showToast === 'function') showToast("发送失败");
        }
    });

    // 目录切换
    function toggleToc(show) {
        if (show) {
            tocOverlay.classList.add('active');
            updateTocHighlight();
        } else {
            tocOverlay.classList.remove('active');
        }
    }

    tocBtn.addEventListener('click', () => toggleToc(true));
    tocOverlay.addEventListener('click', (e) => {
        if (e.target === tocOverlay) toggleToc(false);
    });

    // 设置面板切换
    settingsBtn.addEventListener('click', () => {
        settingsOverlay.classList.add('active');
    });
    
    settingsCloseBtn.addEventListener('click', () => {
        settingsOverlay.classList.remove('active');
    });
    
    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.classList.remove('active');
        }
    });

    // 字体大小调节
    function updateFontSize(size) {
        fontSize = Math.max(12, Math.min(36, size));
        
        // 记录当前进度比例
        const currentRatio = totalPages > 0 ? currentPage / totalPages : 0;
        
        // 使用 CSS 变量更新字号
        readerScreen.style.setProperty('--reader-font-size', `${fontSize}px`);
        if (fontSizeDisplay) fontSizeDisplay.textContent = fontSize;
        
        // 重新计算页数并恢复进度
        setTimeout(() => {
            calculatePages();
            let newPage = Math.floor(currentRatio * totalPages);
            if (newPage >= totalPages) newPage = totalPages - 1;
            goToPage(newPage, true);
        }, 50);

        // 保存到 localStorage
        localStorage.setItem('reader_font_size', fontSize);
    }

    if (fontIncreaseBtn) fontIncreaseBtn.addEventListener('click', () => updateFontSize(fontSize + 2));
    if (fontDecreaseBtn) fontDecreaseBtn.addEventListener('click', () => updateFontSize(fontSize - 2));

    // 字体颜色调节
    function updateFontColor(color) {
        readerScreen.style.setProperty('--reader-text-color', color);
        if (fontColorPicker) fontColorPicker.value = color;
        localStorage.setItem('reader_font_color', color);
    }

    if (fontColorPicker) {
        fontColorPicker.addEventListener('input', (e) => {
            updateFontColor(e.target.value);
        });
    }

    if (fontColorResetBtn) {
        fontColorResetBtn.addEventListener('click', () => {
            readerScreen.style.removeProperty('--reader-text-color');
            localStorage.removeItem('reader_font_color');
            // 恢复当前主题的默认颜色
            const activeTheme = document.querySelector('.reader-theme-circle.active');
            if (activeTheme) {
                activeTheme.click();
            }
        });
    }

    // 辅助函数：计算颜色的亮度 (0-255)
    function getBrightness(r, g, b) {
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    // 辅助函数：解析 hex 颜色
    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    // 动态计算面板背景色
    function updatePanelBgColor(baseColorHex) {
        const rgb = hexToRgb(baseColorHex);
        if (rgb) {
            // 使用半透明的背景色
            readerScreen.style.setProperty('--reader-panel-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.85)`);
        }
    }

    // 主题切换
    if (themeCircles) {
        themeCircles.forEach(circle => {
            circle.addEventListener('click', () => {
                const theme = circle.dataset.theme;
                
                // 移除旧主题
                readerScreen.classList.remove('reader-theme-default', 'reader-theme-white', 'reader-theme-green', 'reader-theme-dark');
                // 添加新主题
                readerScreen.classList.add(theme);
                
                // 更新选中状态
                themeCircles.forEach(c => c.classList.remove('active'));
                circle.classList.add('active');
                
                // 如果没有自定义字体颜色，则更新颜色选择器的值以匹配主题
                if (!localStorage.getItem('reader_font_color')) {
                    const computedStyle = getComputedStyle(readerScreen);
                    const themeTextColor = computedStyle.getPropertyValue('--reader-text-color').trim();
                    if (themeTextColor.startsWith('#') && fontColorPicker) {
                        fontColorPicker.value = themeTextColor;
                    }
                }

                // 如果没有自定义背景，更新面板背景色
                if (!localStorage.getItem('reader_bg_image')) {
                    const bgColor = getComputedStyle(circle).backgroundColor;
                    // 将 rgb(r, g, b) 转换为 rgba(r, g, b, 0.85)
                    const rgbaColor = bgColor.replace('rgb', 'rgba').replace(')', ', 0.85)');
                    readerScreen.style.setProperty('--reader-panel-bg', rgbaColor);
                }
                
                // 保存到 localStorage
                localStorage.setItem('reader_theme', theme);
            });
        });
    }

    // 自定义背景
    if (bgUploadBtn && bgUploadInput) {
        bgUploadBtn.addEventListener('click', () => {
            bgUploadInput.click();
        });
    }

    // 压缩图片函数
    function compressImage(file, maxWidth, maxHeight, quality, callback) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height *= maxWidth / width));
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width *= maxHeight / height));
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // 转换为 base64，使用 jpeg 格式以减小体积
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                callback(dataUrl);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    if (bgUploadInput) {
        bgUploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                // 压缩图片：最大宽高 1920，质量 0.8
                compressImage(file, 1920, 1920, 0.8, (base64Image) => {
                    try {
                        localStorage.setItem('reader_bg_image', base64Image);
                        applyCustomBg(base64Image);
                    } catch (error) {
                        console.error("保存背景图片失败:", error);
                        if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                            if (typeof showToast === 'function') {
                                showToast("图片仍然过大，请选择更小的图片");
                            } else {
                                alert("图片仍然过大，请选择更小的图片");
                            }
                        }
                    }
                });
            }
            // 清空 input 的值，以便重复上传同一张图片时也能触发 change 事件
            e.target.value = '';
        });
    }

    if (bgClearBtn) {
        bgClearBtn.addEventListener('click', () => {
            readerScreen.style.removeProperty('--reader-bg-image');
            readerScreen.style.removeProperty('--reader-bg-color');
            bgClearBtn.style.display = 'none';
            localStorage.removeItem('reader_bg_image');
            
            // 恢复当前主题的面板背景色
            const activeTheme = document.querySelector('.reader-theme-circle.active');
            if (activeTheme) {
                activeTheme.click();
            }
        });
    }

    function applyCustomBg(base64Image) {
        // 使用双引号包裹 base64 字符串，防止解析错误
        readerScreen.style.setProperty('--reader-bg-image', `url("${base64Image}")`);
        // 将背景颜色设置为透明，防止某些情况下遮挡背景图片
        readerScreen.style.setProperty('--reader-bg-color', 'transparent');
        if (bgClearBtn) bgClearBtn.style.display = 'inline-block';
        
        // 当有自定义背景时，设置一个默认的半透明白色或黑色面板背景
        // 这里简单处理为半透明白色，您可以根据需要使用更复杂的图片主色提取算法
        readerScreen.style.setProperty('--reader-panel-bg', 'rgba(255, 255, 255, 0.85)');
    }

    // 页边距调节
    function updateMargins() {
        const margins = {
            top: marginInputs.top.value + 'px',
            bottom: marginInputs.bottom.value + 'px',
            left: marginInputs.left.value + 'px',
            right: marginInputs.right.value + 'px'
        };

        readerScreen.style.setProperty('--reader-margin-top', margins.top);
        readerScreen.style.setProperty('--reader-margin-bottom', margins.bottom);
        readerScreen.style.setProperty('--reader-margin-left', margins.left);
        readerScreen.style.setProperty('--reader-margin-right', margins.right);

        localStorage.setItem('reader_margins', JSON.stringify({
            top: marginInputs.top.value,
            bottom: marginInputs.bottom.value,
            left: marginInputs.left.value,
            right: marginInputs.right.value
        }));

        // 重新计算页数
        if (currentBook) {
            const currentRatio = totalPages > 0 ? currentPage / totalPages : 0;
            setTimeout(() => {
                calculatePages();
                let newPage = Math.floor(currentRatio * totalPages);
                if (newPage >= totalPages) newPage = totalPages - 1;
                goToPage(newPage, true);
            }, 50);
        }
    }

    Object.values(marginInputs).forEach(input => {
        if (input) input.addEventListener('change', updateMargins);
    });

    // 初始化设置
    const savedFontSize = localStorage.getItem('reader_font_size');
    if (savedFontSize) updateFontSize(parseInt(savedFontSize));
    
    const savedTheme = localStorage.getItem('reader_theme');
    if (savedTheme) {
        const targetCircle = document.querySelector(`.reader-theme-circle[data-theme="${savedTheme}"]`);
        if (targetCircle) targetCircle.click();
    } else {
        // 触发默认主题的点击以设置初始面板背景色
        const defaultCircle = document.querySelector('.reader-theme-circle[data-theme="reader-theme-default"]');
        if (defaultCircle) defaultCircle.click();
    }

    const savedFontColor = localStorage.getItem('reader_font_color');
    if (savedFontColor) {
        updateFontColor(savedFontColor);
    }

    const savedBgImage = localStorage.getItem('reader_bg_image');
    if (savedBgImage) {
        applyCustomBg(savedBgImage);
    }

    const savedMargins = localStorage.getItem('reader_margins');
    if (savedMargins) {
        try {
            const margins = JSON.parse(savedMargins);
            if (marginInputs.top) marginInputs.top.value = margins.top;
            if (marginInputs.bottom) marginInputs.bottom.value = margins.bottom;
            if (marginInputs.left) marginInputs.left.value = margins.left;
            if (marginInputs.right) marginInputs.right.value = margins.right;
            updateMargins();
        } catch (e) {
            console.error("解析页边距设置失败", e);
        }
    }

    // --- 智能插图生成逻辑 ---
    const generateIllustrationBtn = document.getElementById('reader-generate-illustration-btn');
    const illustrationCountSelect = document.getElementById('reader-illustration-count');
    const illustrationProgress = document.getElementById('reader-illustration-progress');

    // 创建悬浮进度提示框
    const floatingProgress = document.createElement('div');
    floatingProgress.style.cssText = `
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 12px;
        z-index: 1000;
        display: none;
        pointer-events: none;
        backdrop-filter: blur(4px);
        transition: opacity 0.3s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    readerScreen.appendChild(floatingProgress);

    function showFloatingProgress(text) {
        floatingProgress.textContent = text;
        floatingProgress.style.display = 'block';
        floatingProgress.style.opacity = '1';
    }

    function hideFloatingProgress() {
        floatingProgress.style.opacity = '0';
        setTimeout(() => {
            floatingProgress.style.display = 'none';
        }, 300);
    }

    if (generateIllustrationBtn) {
        generateIllustrationBtn.addEventListener('click', async () => {
            if (!currentBook || currentChapters.length === 0) {
                if (typeof showToast === 'function') showToast("请先加载书籍");
                return;
            }

            const count = parseInt(illustrationCountSelect.value);
            const chapter = currentChapters[currentChapterIndex];
            if (!chapter || !chapter.content) return;

            // 检查 API 配置
            const settings = db.workshopSettings;
            const provider = settings.provider || 'novelai';
            let apiUrl = '';
            let apiKey = '';
            if (settings.apiPresets && settings.apiPresets[provider] && settings.activeApiPresetId && settings.activeApiPresetId[provider]) {
                const activePreset = settings.apiPresets[provider].find(p => p.id === settings.activeApiPresetId[provider]);
                if (activePreset) {
                    apiUrl = activePreset.url;
                    apiKey = activePreset.key;
                }
            }
            if (!apiUrl) apiUrl = settings[provider + 'ApiUrl'];
            if (!apiKey) apiKey = settings[provider + 'ApiKey'];

            if (!apiUrl || !apiKey) {
                if (typeof showToast === 'function') showToast("请先在工坊配置生图 API");
                return;
            }

            // 工坊独立 LLM 优先；未配置或预设失效时回退主 API。
            const illustrationLlmConfig = resolveWorkshopLlmApiConfig();
            if (!illustrationLlmConfig.url || !illustrationLlmConfig.key || !illustrationLlmConfig.model) {
                if (typeof showToast === 'function') showToast("请先配置工坊独立 LLM API 或主 API");
                return;
            }

            generateIllustrationBtn.disabled = true;
            generateIllustrationBtn.style.opacity = '0.5';
            
            // 关闭设置面板，进入后台运行
            settingsOverlay.classList.remove('active');
            toggleMenu(false);
            
            showFloatingProgress('正在构思分镜...');

            try {
                // 1. 组装 LLM Prompt
                let messages = [];
                let systemPromptAcc = '';
                const activeLlmGroupId = db.workshopSettings.activeLlmPresetGroupId;
                const activeGroup = (db.workshopSettings.llmPresetGroups || []).find(g => g.id === activeLlmGroupId);
                
                const userPrompt = `请为提供的<章节内容>提取 ${count} 个最具画面感的瞬间，并严格按照要求的 XML 格式输出。`;
                const formatInstruction = `\n\n[小说插图专属格式]\n请严格按照以下 XML 格式输出（不要返回任何多余的解释）：\n<image001>\n<原文段落>这里原封不动地摘录原文中的一段话或一句话，作为插入图片定位的锚点。</原文段落>\n<image>纯英文提示词tag，逗号分隔...</image>\n</image001>\n<image002>\n...\n</image002>`;

                let userPromptInserted = false;

                if (activeGroup && activeGroup.prompts) {
                    activeGroup.prompts.forEach((p) => {
                        if (!p.enabled) return;
                        
                        // 过滤掉聊天专属设定
                        if (p.title && (p.title.includes('角色设定') || p.title.includes('当前主要角色') || p.title.includes('角色专属tag'))) {
                            return;
                        }
                        
                        let contentToAdd = p.content;
                        
                        // 替换聊天上下文为章节内容
                        if (p.title && p.title.includes('聊天上下文')) {
                            contentToAdd = `<章节内容>\n${chapter.content}\n</章节内容>`;
                        }

                        // 在 cot开始 之前插入 userPrompt
                        if (p.title && p.title.includes('cot开始') && !userPromptInserted) {
                            if (systemPromptAcc) {
                                messages.push({ role: "system", content: systemPromptAcc.trim() });
                                systemPromptAcc = '';
                            }
                            messages.push({ role: "user", content: userPrompt });
                            userPromptInserted = true;
                        }

                        // 替换 cot尾部 的格式示范
                        if (p.title && p.title.includes('cot尾部')) {
                            contentToAdd = contentToAdd.replace(/<回复>[\s\S]*?<\/回复>/g, '');
                            contentToAdd += formatInstruction;
                        }
                        
                        systemPromptAcc += contentToAdd + '\n\n';
                    });
                    
                    if (systemPromptAcc) {
                        messages.push({ role: "system", content: systemPromptAcc.trim() });
                    }

                    // 如果没找到 cot开始，把 userPrompt 加在最后
                    if (!userPromptInserted) {
                        messages.push({ role: "user", content: userPrompt });
                    }
                } else {
                    throw new Error("未找到工坊 LLM 预设");
                }

                // 兼容性处理：确保最后一条是 user 消息（如果需要的话，或者直接加 prefill）
                if (messages[messages.length - 1].role === 'system') {
                    messages.push({ role: "user", content: "请开始生成插图指令：" });
                }
                
                // 预填 thinking
                messages.push({ role: "assistant", content: "<thinking>" });

                console.log("=== 发送给 AI 的 Messages ===\n", JSON.stringify(messages, null, 2));

                // 2. 请求 LLM
                const {
                    requestBody: llmPayload,
                    endpoint: llmEndpoint,
                    headers: llmHeaders
                } = buildChatApiRequest(illustrationLlmConfig, messages, { temperature: 0.7 });

                const llmResponse = await fetch(llmEndpoint, {
                    method: 'POST',
                    headers: llmHeaders,
                    body: JSON.stringify(llmPayload)
                });

                if (!llmResponse.ok) {
                    const errText = await llmResponse.text();
                    throw new Error(`LLM 请求失败 (${llmResponse.status}): ${errText}`);
                }
                
                const llmData = await llmResponse.json();
                let llmText = "";
                
                if (illustrationLlmConfig.provider === 'gemini') {
                    llmText = llmData.candidates?.[0]?.content?.parts?.[0]?.text || "";
                } else {
                    llmText = llmData.choices?.[0]?.message?.content || "";
                }

                console.log("=== AI 返回的原始文本 ===\n" + llmText);

                // 3. 解析 XML
                const imageBlocks = [];
                const regex = /<image\d{3}>([\s\S]*?)<\/image\d{3}>/g;
                let match;
                while ((match = regex.exec(llmText)) !== null) {
                    const blockContent = match[1];
                    const quoteMatch = blockContent.match(/<原文段落>([\s\S]*?)<\/原文段落>/);
                    const promptMatch = blockContent.match(/<image>([\s\S]*?)<\/image>/);
                    
                    if (quoteMatch && promptMatch) {
                        imageBlocks.push({
                            quote: quoteMatch[1].trim(),
                            prompt: promptMatch[1].trim()
                        });
                    }
                }

                if (imageBlocks.length === 0) {
                    throw new Error("未能解析出有效的插图指令");
                }

                // 4. 匹配段落并生图
                const paragraphs = chapter.content.split('\n').filter(p => p !== '');
                
                for (let i = 0; i < imageBlocks.length; i++) {
                    const block = imageBlocks[i];
                    showFloatingProgress(`正在绘制第 ${i + 1}/${imageBlocks.length} 张插图...`);

                    // 模糊匹配寻找最佳段落
                    let bestMatchIndex = -1;
                    let maxSimilarity = 0;

                    for (let j = 0; j < paragraphs.length; j++) {
                        const pText = paragraphs[j];
                        if (pText.includes(block.quote)) {
                            bestMatchIndex = j;
                            break;
                        }
                        // 简单的相似度计算：重合字符数
                        let matchCount = 0;
                        for (let char of block.quote) {
                            if (pText.includes(char)) matchCount++;
                        }
                        const similarity = matchCount / block.quote.length;
                        if (similarity > maxSimilarity && similarity > 0.5) { // 至少 50% 相似
                            maxSimilarity = similarity;
                            bestMatchIndex = j;
                        }
                    }

                    if (bestMatchIndex === -1) {
                        console.warn("未找到匹配的段落:", block.quote);
                        continue; // 跳过这张图
                    }

                    // 构建生图 Payload (复用 workshop 逻辑)
                    const tempSettings = JSON.parse(JSON.stringify(settings));
                    // 将 LLM 生成的 prompt 追加到工坊原有的 positivePrompt 后面
                    tempSettings.positivePrompt = (tempSettings.positivePrompt ? tempSettings.positivePrompt + ', ' : '') + block.prompt;
                    // 清空角色专属 tag，因为小说插图不需要特定角色的固定 tag
                    tempSettings.characterPrompt = '';
                    
                    if (typeof window.executeImageGeneration !== 'function') {
                        throw new Error("未找到统一生图函数 window.executeImageGeneration");
                    }

                    let base64Image = '';
                    try {
                        const result = await window.executeImageGeneration(tempSettings, block.prompt);
                        base64Image = result.imageData;
                    } catch (genErr) {
                        console.error(`第 ${i+1} 张图生成或解析失败:`, genErr);
                        continue;
                    }

                    if (base64Image) {
                        // 存入数据库
                        await dexieDB.reader_comments.add({
                            bookId: currentBook.id,
                            chapterIndex: currentChapterIndex,
                            paragraphIndex: bestMatchIndex,
                            content: `[ILLUSTRATION]${base64Image}`,
                            timestamp: Date.now()
                        });

                        // 找到对应的段落元素并更新 UI
                        const pElement = document.querySelector(`#reader-text-content p[data-index="${bestMatchIndex}"]`);
                        if (pElement) {
                            let iconEl = pElement.querySelector('.reader-inline-comment-icon');
                            if (iconEl) {
                                const countEl = iconEl.querySelector('.reader-inline-comment-count');
                                countEl.textContent = parseInt(countEl.textContent) + 1;
                            } else {
                                const iconHtml = `<span class="reader-inline-comment-icon" contenteditable="false"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chat-square-quote" viewBox="0 0 16 16"><path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2.5a2 2 0 0 0-1.6.8L8 14.333 6.1 11.8a2 2 0 0 0-1.6-.8H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2.5a1 1 0 0 1 .8.4l1.9 2.533a1 1 0 0 0 1.6 0l1.9-2.533a1 1 0 0 1 .8-.4H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M7.066 4.76A1.665 1.665 0 0 0 4 5.668a1.667 1.667 0 0 0 2.561 1.406c-.131.389-.375.804-.777 1.22a.417.417 0 1 0 .6.58c1.486-1.54 1.293-3.214.682-4.112zm4 0A1.665 1.665 0 0 0 8 5.668a1.667 1.667 0 0 0 2.561 1.406c-.131.389-.375.804-.777 1.22a.417.417 0 1 0 .6.58c1.486-1.54 1.293-3.214.682-4.112z"/></svg><span class="reader-inline-comment-count">1</span></span>`;
                                pElement.insertAdjacentHTML('beforeend', iconHtml);
                                
                                const newIcon = pElement.querySelector('.reader-inline-comment-icon');
                                newIcon.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    openCommentPanel(pElement);
                                });
                            }
                        }
                    }
                }

                showFloatingProgress('插图生成完毕！');
                setTimeout(() => {
                    hideFloatingProgress();
                }, 2000);

            } catch (error) {
                console.error("智能插图生成失败:", error);
                showFloatingProgress('生成失败: ' + error.message);
                setTimeout(() => { hideFloatingProgress(); }, 3000);
            } finally {
                generateIllustrationBtn.disabled = false;
                generateIllustrationBtn.style.opacity = '1';
            }
        });
    }

    // 暴露给全局
    window.readerView.loadBook = loadBook;
});
