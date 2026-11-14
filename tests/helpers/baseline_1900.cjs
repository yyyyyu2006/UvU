const fs = require('node:fs');
const path = require('node:path');
const requiredFiles = ['js/modules/chat_ai_prompt.js', 'js/group_chat.js', 'js/modules/chat_ai.js',
    'js/utils.js', 'js/modules/journal.js', 'js/modules/chat_ai_call.js'];
function inspectBaseline(root) {
    const missing = requiredFiles.filter(file => !root || !fs.existsSync(path.join(root, file)) || !fs.statSync(path.join(root, file)).isFile());
    return { root, available: !missing.length, missing };
}
function baseline1900(env = process.env) {
    const result = inspectBaseline(env.UVU_1900_ROOT);
    if (!result.available) {
        const message = '1900未验证：请设置 UVU_1900_ROOT 为原版目录。缺少：' + result.missing.join(', ');
        if (env.UVU_ALLOW_MISSING_1900 === '1' && env.UVU_1900_STRICT !== '1') console.warn(message);
        else throw new Error(message + '。仅普通开发可显式设置 UVU_ALLOW_MISSING_1900=1 跳过；发布验收禁止跳过。');
    }
    return result;
}
module.exports = { requiredFiles, inspectBaseline, baseline1900 };
