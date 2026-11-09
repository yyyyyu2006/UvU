// Read-only resource inspection; never rewrite persisted URLs or widget contents.
(function () {
    'use strict';
    const failedScripts = new Set();
    window.addEventListener('error', event => { if (event.target?.tagName === 'SCRIPT' && event.target.src) failedScripts.add(event.target.src); }, true);
    const label = value => {
        try { const u = new URL(value, document.baseURI); return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : (u.protocol === 'data:' ? '内嵌本地资源' : u.protocol); }
        catch (_) { return '无法解析的资源地址'; }
    };
    function inspect(root = document.getElementById('home-screen')) {
        const rows = [], seen = new Set();
        const add = (type, address, state) => {
            const key = type + '|' + address; if (seen.has(key) || rows.length >= 300) return;
            seen.add(key); rows.push({ type, resource: label(address), state });
        };
        for (const image of root?.querySelectorAll('img') || []) add('图片', image.currentSrc || image.src,
            image.complete ? (image.naturalWidth > 0 ? '已解码' : '未成功加载，可在主页点击图片重试') : '加载中／尚未加载');
        for (const frame of root?.querySelectorAll('iframe') || []) add('组件', frame.src, '跨源组件无法由父页面准确检查内部资源；请打开原链接核对');
        for (const el of [root, ...(root?.querySelectorAll('*') || [])].filter(Boolean).slice(0, 500)) {
            const value = getComputedStyle(el).backgroundImage;
            for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/g)) add('CSS背景', match[1], '已引用；不能仅据跨源响应判断加载成功，未修改或重新下载');
        }
        for (const script of document.querySelectorAll('script[src]')) if (/^https?:/.test(script.src) && new URL(script.src).origin !== location.origin)
            add('依赖脚本', script.src, failedScripts.has(script.src) ? '加载失败；可恢复网络后重新加载页面' : '未捕获加载失败；不代表所有功能均通过验证');
        for (const link of document.querySelectorAll('link[rel=stylesheet]')) add('样式／字体入口', link.href,
            link.sheet ? '样式入口已加载，内部字体仍受外链和浏览器限制' : '尚未取得样式表；请核对网络');
        if (document.fonts) rows.push({ type: '字体', resource: '浏览器字体集合', state: document.fonts.status === 'loading' ? '仍有字体加载中' : '当前加载任务结束；缺字可能仍使用回退字体' });
        const nodes = root ? root.querySelectorAll('*').length + 1 : 0;
        if (nodes > 500 || rows.length >= 300) rows.push({ type: '扫描范围', resource: '当前主页', state:
            `CSS 背景检查 ${Math.min(nodes, 500)} / ${nodes} 个节点；资源结果最多300项。${nodes > 500 || rows.length >= 300 ? '结果已截断，不代表全量检查。' : ''}` });
        return rows;
    }
    function open() {
        if (typeof createMessageForwardDialog !== 'function') return;
        const d = createMessageForwardDialog('资源加载诊断', 'uvu-resource-health'); d.panel.classList.add('resource-health');
        const help = document.createElement('p'); help.textContent = '只检查当前页面引用，不修改备份、图标、图片原地址或小组件代码。跨源限制、私有链接和网络失败需要分别核对；结果不含链接查询参数。最多显示300项。';
        const body = document.createElement('div'); body.className = 'resource-health-list';
        const render = () => { body.replaceChildren(); for (const item of inspect()) { const row = document.createElement('p'); row.textContent = `${item.type} · ${item.resource}\n${item.state}`; body.append(row); } };
        const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = '重新检查'; refresh.onclick = render;
        d.panel.append(help, refresh, body); render();
    }
    document.addEventListener('click', event => { if (event.target.closest?.('[data-resource-health]')) open(); });
    window.addEventListener('load', () => {
        if (!failedScripts.size || !document.body) return;
        const notice = document.createElement('div'); notice.id = 'uvu-dependency-warning'; notice.setAttribute('role', 'alert');
        const text = document.createElement('span'); text.textContent = `${failedScripts.size}个外部依赖加载失败，部分功能可能无法启动。请检查网络后重新加载；这不表示本机聊天已丢失。`;
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.onclick = () => notice.remove();
        notice.append(text, close); document.body.append(notice);
    }, { once: true });
    window.UvUResourceHealth = Object.freeze({ inspect, open });
}());
