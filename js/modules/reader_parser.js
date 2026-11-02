// --- TXT 解析与处理模块 (js/modules/reader_parser.js) ---
// 预设的章节正则 Tag 列表
const CHAPTER_PATTERNS = [
    {
        key: 'AUTO',
        label: '智能综合（推荐）',
        regex: /^\s*(?:={1,10}\s*|[-]{3,}\s*)?(?:第?[0-9零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟两]+[章回部集节卷番]|Chapter\s*[0-9]+|(?:[0-9]+|[\u2460-\u2473])[\.、\s]+|（[^）]+）|\([^)]+\)|楔子|引子|序言|前言|简介|文案|尾声|番外)(?:\s+.*)?(?:={1,10}\s*|[-]{3,}\s*)?$/gm
    },
    {
        key: 'CHINESE_NUM',
        label: '第X章/回/节/卷',
        regex: /^\s*第[0-9零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟两]+[章回部集节卷番].*$/gm
    },
    {
        key: 'ENGLISH_CHAPTER',
        label: 'Chapter X',
        regex: /^\s*Chapter\s*[0-9]+.*$/gi
    },
    {
        key: 'PURE_DIGIT',
        label: '数字序号 (1. / 1、)',
        regex: /^\s*[0-9]+[\.、\s]+.*$/gm
    },
    {
        key: 'BRACKETS',
        label: '括号序号 (（一）/ (1))',
        regex: /^\s*(?:（[^）]+）|\([^)]+\)).*$/gm
    },
    {
        key: 'SPECIAL',
        label: '特殊标识 (序言/楔子/番外)',
        regex: /^\s*(?:楔子|引子|序言|前言|简介|文案|尾声|番外).*/gm
    }
];

/**
 * 解析文件名，提取书名和作者
 * @param {string} filename 文件名（包含或不包含 .txt 后缀）
 * @returns {{title: string, author: string}}
 */
function parseBookInfo(filename) {
    // 1. 去除后缀
    let name = filename.replace(/\.txt$/i, '').trim();
    let title = name, author = '未知作者';
    
    // 2. 优先匹配带书名号的格式： 《书名》作者 / 《书名》by作者 / 《书名》
    let match = name.match(/^《(.*?)》(?:(?:\s*by\s*|by|作者：|-|\s+)(.*))?$/i);
    if (match) {
        return { 
            title: match[1].trim(), 
            author: (match[2] || '').trim() || '未知作者' 
        };
    }
    
    // 3. 匹配无书名号，但有明确分隔符的格式： 书名by作者 / 书名-作者 / 书名 作者
    // 使用 \s+by\s+|by|-|作者： 作为分隔符
    match = name.match(/^(.*?)(?:\s+by\s+|by|-|作者：)(.*)$/i);
    if (match) {
        return { 
            title: match[1].trim(), 
            author: match[2].trim() || '未知作者' 
        };
    }
    
    // 4. 兜底：全当书名
    return { title: name, author };
}

/**
 * 解析文本内容，划分章节
 * @param {string} text 纯文本内容
 * @returns {Array<{title: string, content: string}>} 章节数组
 */
function parseChapters(text, patternKey = 'AUTO') {
    const targetPattern = CHAPTER_PATTERNS.find(p => p.key === patternKey);
    const chapterRegex = targetPattern 
        ? new RegExp(targetPattern.regex.source, targetPattern.regex.flags) 
        : new RegExp(CHAPTER_PATTERNS[0].regex.source, CHAPTER_PATTERNS[0].regex.flags);
    
    const chapters = [];
    let match;
    let lastIndex = 0;
    let currentTitle = "前言/简介";

    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    while ((match = chapterRegex.exec(text)) !== null) {
        const content = text.substring(lastIndex, match.index).trim();
        if (content || chapters.length === 0) {
            chapters.push({
                title: currentTitle,
                content: content
            });
        }
        
        currentTitle = match[0].trim();
        lastIndex = chapterRegex.lastIndex;
    }

    const lastContent = text.substring(lastIndex).trim();
    if (lastContent || currentTitle !== "前言/简介") {
        chapters.push({
            title: currentTitle,
            content: lastContent
        });
    }

    if (chapters.length === 0) {
        chapters.push({
            title: "正文",
            content: text.trim()
        });
    }

    return chapters;
}

/**
 * 处理上传的 TXT 文件并存入数据库
 * @param {File} file 上传的文件对象
 * @param {Function} onProgress 进度回调函数 (progress: number, status: string)
 * @returns {Promise<string>} 返回书籍 ID
 */
async function processTxtFile(file, onProgress) {
    return new Promise((resolve, reject) => {
        if (!file.name.toLowerCase().endsWith('.txt')) {
            reject(new Error("仅支持 .txt 格式的文件"));
            return;
        }

        const reader = new FileReader();
        
        reader.onloadstart = () => {
            if (onProgress) onProgress(0, "开始读取文件...");
        };

        reader.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                const percentLoaded = Math.round((e.loaded / e.total) * 50); // 读取占 50% 进度
                onProgress(percentLoaded, "正在读取文件...");
            }
        };

        reader.onload = async (e) => {
            try {
                if (onProgress) onProgress(50, "文件读取完成，开始解析...");
                
                const text = e.target.result;
                const bookInfo = parseBookInfo(file.name);
                
                if (onProgress) onProgress(60, "正在划分章节...");
                // 使用 setTimeout 避免阻塞 UI 线程
                setTimeout(async () => {
                    try {
                        const chaptersData = parseChapters(text);
                        
                        if (onProgress) onProgress(80, "解析完成，正在保存到数据库...");
                        
                        const bookId = 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        
                        // 准备书籍元数据
                        const bookMeta = {
                            id: bookId,
                            title: bookInfo.title,
                            author: bookInfo.author,
                            totalChapters: chaptersData.length,
                            currentChapterIndex: 0,
                            scrollProgress: 0,
                            addTime: Date.now(),
                            lastReadTime: Date.now()
                        };

                        // 准备章节数据
                        const chaptersToSave = chaptersData.map((ch, index) => ({
                            id: `${bookId}_ch_${index}`,
                            bookId: bookId,
                            index: index,
                            title: ch.title,
                            content: ch.content
                        }));

                        // 存入 IndexedDB
                        await dexieDB.transaction('rw', dexieDB.reader_books, dexieDB.reader_chapters, async () => {
                            await dexieDB.reader_books.put(bookMeta);
                            await dexieDB.reader_chapters.bulkPut(chaptersToSave);
                        });

                        if (onProgress) onProgress(100, "保存成功！");
                        resolve(bookId);
                    } catch (err) {
                        reject(err);
                    }
                }, 50); // 给 UI 渲染进度的机会
                
            } catch (err) {
                reject(err);
            }
        };

        reader.onerror = () => {
            reject(new Error("文件读取失败"));
        };

        // 尝试以 UTF-8 读取，如果乱码可能需要处理 GBK，但现代浏览器通常能较好处理或需要外部库如 jschardet
        // 这里先默认 UTF-8，如果用户反馈乱码，后续可引入编码检测
        reader.readAsText(file, 'UTF-8');
    });
}
// 读取 TXT 文件文本内容
function readTxtContent(file) {
    return new Promise((resolve, reject) => {
        if (!file.name.toLowerCase().endsWith('.txt')) {
            reject(new Error("仅支持 .txt 格式的文件"));
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error("文件读取失败"));
        reader.readAsText(file, 'UTF-8');
    });
}

// 将章节和图书元数据存入 IndexedDB 数据库
async function saveBookToDB(bookInfo, chaptersData) {
    const bookId = 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const bookMeta = {
        id: bookId,
        title: bookInfo.title,
        author: bookInfo.author,
        totalChapters: chaptersData.length,
        currentChapterIndex: 0,
        scrollProgress: 0,
        addTime: Date.now(),
        lastReadTime: Date.now()
    };

    const chaptersToSave = chaptersData.map((ch, index) => ({
        id: `${bookId}_ch_${index}`,
        bookId: bookId,
        index: index,
        title: ch.title,
        content: ch.content
    }));

    await dexieDB.transaction('rw', dexieDB.reader_books, dexieDB.reader_chapters, async () => {
        await dexieDB.reader_books.put(bookMeta);
        await dexieDB.reader_chapters.bulkPut(chaptersToSave);
    });

    return bookId;
}

// 导出模块
window.readerParser = {
    CHAPTER_PATTERNS,
    parseBookInfo,
    parseChapters,
    readTxtContent,
    saveBookToDB,
    processTxtFile
};
