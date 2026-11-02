// --- 阅读器书架逻辑 (js/modules/reader_bookshelf.js) ---

document.addEventListener('DOMContentLoaded', () => {
    const bookshelfGrid = document.getElementById('bookshelf-grid');
    const uploadBtn = document.getElementById('upload-book-btn');
    const fileUploadInput = document.getElementById('reader-file-upload');
    const manageBtn = document.getElementById('reader-manage-btn');
    const cancelManageBtn = document.getElementById('reader-cancel-manage-btn');
    
    let isEditMode = false;
    let isRendering = false;

    // 渲染书架
    async function renderBookshelf() {
        if (!bookshelfGrid || isRendering) return;
        isRendering = true;
        
        try {
            // 清空除了上传按钮之外的所有内容
            const books = Array.from(bookshelfGrid.children).filter(child => child.id !== 'upload-book-btn');
            books.forEach(book => book.remove());

            const allBooks = await dexieDB.reader_books.orderBy('lastReadTime').reverse().toArray();
            
            allBooks.forEach(book => {
                const bookEl = document.createElement('div');
                bookEl.className = `book-item ${isEditMode ? 'edit-mode' : ''}`;
                bookEl.dataset.id = book.id;
                
                // 计算进度
                const progress = book.totalChapters > 0 
                    ? Math.round((book.currentChapterIndex / book.totalChapters) * 100) 
                    : 0;

                bookEl.innerHTML = `
                    <button class="book-delete-btn" data-id="${book.id}">✕</button>
                    <div class="book-cover">${book.title.substring(0, 1)}</div>
                    <div class="book-title">${book.title}</div>
                    <div class="book-author">${book.author}</div>
                    <div class="book-progress">已读 ${progress}%</div>
                `;

                // 点击书籍事件
                bookEl.addEventListener('click', (e) => {
                    if (isEditMode) return; // 编辑模式下不跳转
                    if (e.target.classList.contains('book-delete-btn')) return; // 点击删除按钮不跳转
                    
                    // 跳转到阅读器页面
                    openReaderView(book.id);
                });

                // 删除按钮事件
                const deleteBtn = bookEl.querySelector('.book-delete-btn');
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`确定要删除《${book.title}》吗？`)) {
                        await deleteBook(book.id);
                        renderBookshelf();
                    }
                });

                // 插入到上传按钮之前
                bookshelfGrid.insertBefore(bookEl, uploadBtn);
            });
        } catch (error) {
            console.error("渲染书架失败:", error);
        } finally {
            isRendering = false;
        }
    }

    // 删除书籍
    async function deleteBook(bookId) {
        try {
            await dexieDB.transaction('rw', dexieDB.reader_books, dexieDB.reader_chapters, async () => {
                await dexieDB.reader_books.delete(bookId);
                // 删除关联的章节
                const chapters = await dexieDB.reader_chapters.where('bookId').equals(bookId).toArray();
                const chapterIds = chapters.map(ch => ch.id);
                await dexieDB.reader_chapters.bulkDelete(chapterIds);
            });
            showToast("删除成功");
        } catch (error) {
            console.error("删除书籍失败:", error);
            showToast("删除失败");
        }
    }

    // 上传文件事件
    if (uploadBtn && fileUploadInput) {
        uploadBtn.addEventListener('click', () => {
            if (isEditMode) return;
            fileUploadInput.click();
        });

        fileUploadInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showToast("正在读取文件...");

            try {
                // 1. 读取文本内容与解析基本信息
                const text = await window.readerParser.readTxtContent(file);
                const bookInfo = window.readerParser.parseBookInfo(file.name);
                
                // 2. 弹出目录识别确认弹窗
                showChapterConfirmModal(bookInfo, text, async (finalChapters) => {
                    try {
                        showToast("正在保存书籍...");
                        await window.readerParser.saveBookToDB(bookInfo, finalChapters);
                        showToast("导入成功！");
                        renderBookshelf();
                    } catch (err) {
                        console.error("保存书籍失败:", err);
                        showToast("保存失败: " + err.message);
                    }
                });
            } catch (error) {
                console.error("读取文件失败:", error);
                showToast("读取失败: " + error.message);
            } finally {
                fileUploadInput.value = ''; // 清空 input
            }
        });
    }
    /**
     * 显示目录识别确认弹窗
     */
    function showChapterConfirmModal(bookInfo, text, onConfirm) {
        let currentPatternKey = 'AUTO';
        let currentChapters = window.readerParser.parseChapters(text, currentPatternKey);

        // 创建弹窗 DOM 结构
        const modalEl = document.createElement('div');
        modalEl.className = 'chapter-confirm-modal-overlay';

        const tagsHtml = window.readerParser.CHAPTER_PATTERNS.map(pattern => `
            <button class="chapter-tag-btn ${pattern.key === currentPatternKey ? 'active' : ''}" data-key="${pattern.key}">
                ${pattern.label}
            </button>
        `).join('');

        modalEl.innerHTML = `
            <div class="chapter-confirm-modal">
                <div class="modal-header">
                    <h3>目录识别确认</h3>
                    <button class="modal-close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="book-info-summary">
                        <span><strong>书名：</strong>${bookInfo.title}</span>
                        <span><strong>作者：</strong>${bookInfo.author}</span>
                    </div>
                    
                    <div class="section-title">选择匹配规则 Tag：</div>
                    <div class="chapter-tags-container">
                        ${tagsHtml}
                    </div>

                    <div class="preview-header">
                        识别结果预览 (共 <b id="preview-chapter-count">${currentChapters.length}</b> 章)
                    </div>
                    <div class="chapter-preview-list" id="chapter-preview-list"></div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn cancel-btn">取消导入</button>
                    <button class="modal-btn confirm-btn primary">确认并导入</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalEl);

        const previewListEl = modalEl.querySelector('#chapter-preview-list');
        const countEl = modalEl.querySelector('#preview-chapter-count');

        // 渲染预览章节列表
        function renderPreview() {
            countEl.textContent = currentChapters.length;
            if (currentChapters.length === 0) {
                previewListEl.innerHTML = `<div class="preview-empty">未识别到任何有效章节</div>`;
                return;
            }
            // 仅渲染前 100 章预览，避免百万人字数大卡顿
            const displayChapters = currentChapters.slice(0, 100);
            previewListEl.innerHTML = displayChapters.map((ch, idx) => `
                <div class="preview-chapter-item">
                    <span class="index">${idx + 1}.</span>
                    <span class="title">${ch.title}</span>
                </div>
            `).join('') + (currentChapters.length > 100 ? `<div class="preview-more">... 剩余 ${currentChapters.length - 100} 章</div>` : '');
        }

        renderPreview();

        // 绑定 Tag 点击事件
        modalEl.querySelectorAll('.chapter-tag-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modalEl.querySelectorAll('.chapter-tag-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                currentPatternKey = btn.dataset.key;
                currentChapters = window.readerParser.parseChapters(text, currentPatternKey);
                renderPreview();
            });
        });

        // 关闭弹窗逻辑
        const closeModal = () => modalEl.remove();

        modalEl.querySelector('.modal-close-btn').addEventListener('click', closeModal);
        modalEl.querySelector('.cancel-btn').addEventListener('click', closeModal);

        // 点击确认并导入
        modalEl.querySelector('.confirm-btn').addEventListener('click', () => {
            closeModal();
            if (onConfirm) onConfirm(currentChapters);
        });
    }

    // 管理模式切换
    if (manageBtn && cancelManageBtn) {
        manageBtn.addEventListener('click', () => {
            isEditMode = true;
            manageBtn.style.display = 'none';
            cancelManageBtn.style.display = 'block';
            renderBookshelf();
        });

        cancelManageBtn.addEventListener('click', () => {
            isEditMode = false;
            manageBtn.style.display = 'block';
            cancelManageBtn.style.display = 'none';
            renderBookshelf();
        });
    }

    // 监听屏幕切换事件，当切换到书架时重新渲染
    let lastActiveState = false;
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.id === 'reader-bookshelf-screen') {
                const isActive = mutation.target.classList.contains('active');
                if (isActive && !lastActiveState) {
                    renderBookshelf();
                }
                lastActiveState = isActive;
            }
        });
    });

    const bookshelfScreen = document.getElementById('reader-bookshelf-screen');
    if (bookshelfScreen) {
        observer.observe(bookshelfScreen, { attributes: true, attributeFilter: ['class'] });
    }

    // 暴露给全局以便其他模块调用
    window.readerBookshelf = {
        renderBookshelf
    };
});

// 跳转到阅读器视图
function openReaderView(bookId) {
    if (window.readerView && window.readerView.loadBook) {
        window.readerView.loadBook(bookId);
        switchScreen('reader-view-screen');
    } else {
        console.error("readerView 模块未加载");
    }
}
