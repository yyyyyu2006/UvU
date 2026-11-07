(function () {
    'use strict';
    const query = new URL(location.href).searchParams;
    const payload = { type: 'uvu-mcp-oauth', state: query.get('state'), code: query.get('code'), error: query.get('error'), iss: query.get('iss') };
    history.replaceState(null, '', location.pathname);
    if (!window.opener || !payload.state || (!payload.code && !payload.error)) { document.getElementById('status').textContent = '授权窗口已失效，请返回 UvU 后重新连接。'; return; }
    window.opener.postMessage(payload, location.origin);
    document.getElementById('status').textContent = '已返回 UvU，正在完成授权。可返回原窗口查看结果。';
}());
