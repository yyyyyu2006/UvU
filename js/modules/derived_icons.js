/* Local Lucide icons for second-edition panels. Never decorate legacy chat controls. */
(function () {
    'use strict';
    const scope = '.shared-document-dialog,.mcp-settings,.memory-library,.derived-settings,.environment-calendar,.minimax-tts-settings,.relationship-dialog,.resource-health,.text-editor-card,#auto-memory-modal,#uvu-story-bridge-screen,#sticker-description-settings';
    const ids = new Map([
        ['minimax-tts-save', 'check'], ['uvu-bridge-pair', 'link'], ['uvu-bridge-reconnect', 'refresh-cw'],
        ['uvu-bridge-sync', 'download'], ['uvu-bridge-disconnect', 'unlink'], ['uvu-bridge-recover', 'refresh-cw'],
        ['uvu-bridge-save-character', 'check'], ['uvu-bridge-use-current', 'book-open'], ['uvu-bridge-handoff', 'send'],
        ['uvu-bridge-latest', 'refresh-cw'], ['uvu-bridge-export-file', 'download'], ['uvu-bridge-import-file', 'upload'],
        ['uvu-bridge-refresh-review', 'refresh-cw'], ['vector-api-fetch-models', 'refresh-cw'], ['vector-api-test', 'play']
    ]);
    const labels = new Map([
        ['选择文件', 'upload'], ['更换文件', 'upload'], ['导入', 'upload'], ['导出', 'download'],
        ['导出文本', 'download'], ['导出 DOCX', 'download'], ['下载原件', 'download'], ['导入配置', 'upload'], ['导出配置', 'download'],
        ['发送文件', 'send'], ['发送修改副本', 'send'], ['发送朋友验证请求', 'send'],
        ['编辑', 'pencil'], ['编辑副本', 'pencil'], ['添加', 'plus'], ['添加记忆', 'plus'],
        ['保存', 'check'], ['保存设置', 'check'], ['保存授权', 'shield-check'], ['保存角色授权', 'shield-check'],
        ['保存恢复规则', 'check'], ['保存角色判断设置', 'check'], ['保存记忆选项', 'check'],
        ['整合', 'wand-sparkles'], ['续建索引', 'refresh-cw'], ['重建索引', 'refresh-cw'], ['暂停', 'square'],
        ['删除', 'trash-2'], ['删除选中', 'trash-2'], ['清空待用结果', 'trash-2'],
        ['刷新', 'refresh-cw'], ['测试 / 刷新工具', 'refresh-cw'], ['检查版本', 'refresh-cw'],
        ['搜索', 'search'], ['查找', 'search'], ['设置', 'settings-2'],
        ['上一页', 'chevron-left'], ['下一页', 'chevron-right'], ['复制', 'copy'],
        ['定位并获取天气', 'map-pin'], ['配对', 'link'], ['连接', 'link'], ['断开', 'unlink'],
        ['试听', 'play'], ['停止请求', 'square'], ['停止整理', 'square'],
        ['保存并立即整理一批', 'wand-sparkles'], ['保存并总结指定范围', 'wand-sparkles']
    ]);
    function create(name) {
        const source = window.UvULucide?.[name];
        if (!source) return null;
        const svg = new DOMParser().parseFromString(source.replace(/>\s+</g, '><'), 'image/svg+xml').documentElement;
        if (svg.localName !== 'svg') return null;
        const icon = document.importNode(svg, true);
        icon.classList.add('derived-icon'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
        return icon;
    }
    function decorateButton(button) {
        if (!button.closest(scope) || button.querySelector('svg,img') || button.closest('[contenteditable="true"]')) return;
        const name = button.dataset.icon || ids.get(button.id) || labels.get(button.textContent.trim());
        const icon = create(name); if (!icon) return;
        button.prepend(icon); button.classList.add('derived-icon-button');
    }
    function decorate(root) {
        if (root.matches?.('button')) decorateButton(root);
        root.querySelectorAll?.('button').forEach(decorateButton);
    }
    function start() {
        document.querySelectorAll(scope).forEach(decorate);
        // Only inspect added subtrees; no rescanning the document during chat rendering.
        const pending = new Set(); let queued = false;
        const observer = new MutationObserver(records => {
            for (const record of records) {
                const button = record.target.nodeType === 1 ? record.target.closest('button') : record.target.parentElement?.closest('button');
                if (button?.closest(scope) && !button.querySelector('svg')) pending.add(button);
                for (const added of record.addedNodes) if (added.nodeType === 1 && !added.closest('svg')) {
                    if (added.closest(scope)) pending.add(added);
                    else added.querySelectorAll(scope).forEach(root => pending.add(root));
                }
            }
            if (!pending.size || queued) return;
            queued = true;
            queueMicrotask(() => { queued = false; const batch = [...pending]; pending.clear(); batch.forEach(root => { if (root.isConnected) decorate(root); }); });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    window.DerivedIcons = Object.freeze({ create, decorate });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
