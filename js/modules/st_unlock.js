// --- SillyTavern 玩家认证模块 (js/modules/st_unlock.js) ---

function setupStUnlock() {
    const modal = document.getElementById('st-unlock-modal');
    const imageInput = document.getElementById('st-unlock-image-input');
    const keyInput = document.getElementById('st-unlock-key-input');
    const verifyBtn = document.getElementById('st-unlock-verify-btn');
    const cancelBtn = document.getElementById('st-unlock-cancel-btn');

    if (!modal) return;

    // 第一步：选择图片并生成认证卡
    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            showToast('正在制作认证卡...');
            await generateUnlockCard(file);
            showToast('认证卡已生成并下载，请导入酒馆获取密钥');
        } catch (error) {
            console.error('生成认证卡失败:', error);
            showToast('生成失败: ' + error.message);
        }
        e.target.value = null;
    });

    // 第二步：验证密钥
    verifyBtn.addEventListener('click', async () => {
        const key = keyInput.value.trim();
        if (!key) return showToast('请输入密钥');

        const result = verifyUnlockKey(key);
        if (result === true) {
            db.stUnlocked = true;
            await saveData();
            showToast('🎉 认证成功！已永久解锁导入功能');
            modal.classList.remove('visible');
            // 自动触发真正的导入
            document.getElementById('character-card-input').click();
        } else if (result === 'expired') {
            showToast('⏰ 认证卡已过期（超过3分钟），请重新生成');
        } else {
            showToast('❌ 密钥无效或环境检测失败，请确保在酒馆中运行');
        }
    });

    cancelBtn.addEventListener('click', () => {
        modal.classList.remove('visible');
    });
}

/**
 * 生成认证角色卡 PNG
 */
async function generateUnlockCard(file) {
    // 1. 生成随机凭证
    const uuid = 'UwU_' + Math.random().toString(36).substr(2, 9);
    const randomName = 'UwU_Unlocker_' + Math.floor(Math.random() * 1000);
    
    // 存入临时缓存用于验证
    localStorage.setItem('st_unlock_uuid', uuid);
    localStorage.setItem('st_unlock_name', randomName);
    localStorage.setItem('st_unlock_time', Date.now().toString());

    // 2. 构造角色卡数据 (V3 格式)
    const unlockHtml = "```html\n" + `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
</head>
<body>
<div style="padding: 15px; background: #1a1a1a; border: 2px solid #007AFF; border-radius: 12px; text-align: center; color: white; font-family: sans-serif;">
    <h3 style="margin-top: 0; color: #007AFF;">🐙 章鱼喷墨机认证系统</h3>
    <p style="font-size: 14px; opacity: 0.9;">检测到您正在使用 SillyTavern 环境。</p>
    <div style="margin: 20px 0; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;">
        <p style="font-size: 12px; color: #aaa; margin-bottom: 8px;">点击下方按钮生成您的专属解锁密钥：</p>
        <button id="uwu-gen-btn" onclick="generateUwUKey()" style="background: #007AFF; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%;">生成解锁密钥</button>
        <div id="uwu-key-output" style="margin-top: 12px; padding: 8px; background: #000; color: #00ff00; font-family: monospace; font-size: 12px; word-break: break-all; border-radius: 4px; display: none; user-select: all;"></div>
    </div>
    <p style="font-size: 11px; color: #666;">验证通过后，您将永久解锁本应用的导入功能。</p>
</div>

<script>
function generateUwUKey() {
    // 核心逻辑：检测宏替换
    const stChar = "{{char}}";
    const rawMacro = "{" + "{" + "char" + "}" + "}";
    const output = document.getElementById('uwu-key-output');
    const btn = document.getElementById('uwu-gen-btn');
    
    if (stChar === rawMacro) {
        output.style.display = 'block';
        output.style.color = '#ff4d4f';
        output.innerText = "❌ 错误：未检测到酒馆环境。请在酒馆中【新建聊天】后点击此按钮！";
        return;
    }

    // 动态注入的 UUID
    const uuid = "${uuid}";
    // 生成密钥：UUID | 角色名
    const secret = btoa(uuid + "|" + stChar);
    
    output.style.display = 'block';
    output.style.color = '#00ff00';
    output.innerText = secret;

    // 一键复制
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(secret).then(() => {
            btn.innerText = "✅ 已复制到剪贴板";
            btn.style.background = "#28a745";
            setTimeout(() => {
                btn.innerText = "生成解锁密钥";
                btn.style.background = "#007AFF";
            }, 2000);
        });
    }
    
    // 自动选中作为备选
    const range = document.createRange();
    range.selectNode(output);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
}
</script>
</body>
</html>` + "\n```";

    const charData = {
        "name": randomName,
        "description": "这是一个用于认证 SillyTavern 玩家身份的特殊角色卡。",
        "first_mes": "【解锁器】",
        "data": {
            "name": randomName,
            "description": "SillyTavern Unlocker",
            "first_mes": "【解锁器】",
            "extensions": {
                "regex_scripts": [
                    {
                        "id": "uwu-unlocker-regex",
                        "scriptName": "UwU Unlocker",
                        "findRegex": "【解锁器】",
                        "replaceString": unlockHtml,
                        "placement": [1, 2],
                        "disabled": false,
                        "markdownOnly": true,
                        "runOnEdit": true
                    }
                ]
            }
        },
        "spec": "chara_card_v3",
        "spec_version": "3.0"
    };

    // 3. 图片转 PNG ArrayBuffer
    const imgBuffer = await fileToArrayBuffer(file);
    const pngBuffer = await ensurePngFormat(imgBuffer);

    // 4. 注入 tEXt 块
    const finalBuffer = injectCharaToPng(pngBuffer, charData);

    // 5. 下载文件
    const blob = new Blob([finalBuffer], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `UwU_Unlocker.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 验证密钥
 */
function verifyUnlockKey(key) {
    try {
        const decoded = atob(key);
        const [uuid, charName] = decoded.split('|');
        
        const savedUuid = localStorage.getItem('st_unlock_uuid');
        const savedName = localStorage.getItem('st_unlock_name');
        const savedTime = localStorage.getItem('st_unlock_time');

        if (!savedUuid || !savedName || !savedTime) return false;

        // 检查是否过期 (3分钟 = 180000ms)
        const now = Date.now();
        if (now - parseInt(savedTime) > 180000) {
            localStorage.removeItem('st_unlock_uuid');
            localStorage.removeItem('st_unlock_name');
            localStorage.removeItem('st_unlock_time');
            return 'expired';
        }

        // 验证 UUID 是否匹配，且角色名是否被酒馆正确替换（不等于原始宏）
        if (uuid === savedUuid && charName === savedName) {
            localStorage.removeItem('st_unlock_uuid');
            localStorage.removeItem('st_unlock_name');
            localStorage.removeItem('st_unlock_time');
            return true;
        }
    } catch (e) {
        console.error('密钥解析失败:', e);
    }
    return false;
}

/**
 * 将图片注入 chara 数据块
 */
function injectCharaToPng(pngBuffer, jsonData) {
    const view = new DataView(pngBuffer);
    
    // 验证 PNG 签名
    if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
        throw new Error('无效的 PNG 文件');
    }

    const jsonStr = JSON.stringify(jsonData);
    const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));
    const keyword = "chara\0";
    const textContent = keyword + base64Data;
    const textEncoder = new TextEncoder();
    const textBytes = textEncoder.encode(textContent);

    // 构造 tEXt chunk: Length(4) + Type(4) + Data(N) + CRC(4)
    const chunkLength = textBytes.length;
    const newChunk = new Uint8Array(12 + chunkLength);
    const chunkView = new DataView(newChunk.buffer);

    chunkView.setUint32(0, chunkLength); // Length
    newChunk.set([116, 69, 88, 116], 4); // Type: 'tEXt'
    newChunk.set(textBytes, 8); // Data

    // 计算 CRC (Type + Data)
    const crc = calculateCRC(newChunk.slice(4, 8 + chunkLength));
    chunkView.setUint32(8 + chunkLength, crc);

    // 插入位置：IHDR 块之后 (PNG Signature 8 + IHDR Chunk 12 + 13 = 33)
    // 标准 IHDR 长度是 13，加上 12 字节的 chunk 结构 = 25。8 + 25 = 33。
    const insertPos = 33;
    
    const result = new Uint8Array(pngBuffer.byteLength + newChunk.length);
    result.set(new Uint8Array(pngBuffer.slice(0, insertPos)), 0);
    result.set(newChunk, insertPos);
    result.set(new Uint8Array(pngBuffer.slice(insertPos)), insertPos + newChunk.length);

    return result.buffer;
}

/**
 * 辅助函数：确保图片是标准 PNG 格式
 */
async function ensurePngFormat(buffer) {
    return new Promise((resolve) => {
        const blob = new Blob([buffer]);
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((pngBlob) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsArrayBuffer(pngBlob);
                URL.revokeObjectURL(url);
            }, 'image/png');
        };
        img.src = url;
    });
}

function fileToArrayBuffer(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsArrayBuffer(file);
    });
}

// CRC32 实现
const crcTable = new Int32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[i] = c;
}

function calculateCRC(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}
