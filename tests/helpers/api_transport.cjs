// Load actual shared transport functions into focused VM fixtures, without UI initialization.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
module.exports = function loadApiTransport(context) {
    const source = fs.readFileSync(path.join(__dirname, '../../js/utils.js'), 'utf8');
    const keyStart = source.indexOf('function resolveDestinationKey(');
    const keyEnd = source.indexOf('const statusRegexCache', keyStart);
    vm.runInContext(source.slice(keyStart, keyEnd), context);
    // Request fixtures also exercise the actual bounded status helpers.
    const statusEnd = source.indexOf('// Local settings only.', keyEnd);
    vm.runInContext(source.slice(keyEnd, statusEnd), context);
    const start = source.indexOf('function resolveChatCompletionsEndpoint(');
    const end = source.indexOf('// --- 图片查看器 ---', start);
    if (start < 0 || end < start) throw Error('Shared API transport functions not found');
    vm.runInContext(source.slice(start, end), context);
};
