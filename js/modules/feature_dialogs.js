// Lifecycle for derived dialogs only; no history entries or original modal changes.
(function () {
    'use strict';
    const records = new Map();
    const selector = '.feature-dialog:not(#expanded-text-editor), .message-forward-overlay, #char-status-overlay.visible';
    const active = el => el.isConnected && (el.id !== 'char-status-overlay' || el.classList.contains('visible'));
    const allowed = el => el.id === 'char-status-overlay' || el.matches('.feature-dialog') || !!el.querySelector('.mcp-settings,.derived-settings,.resource-health');
    const focusable = root => [...root.querySelectorAll('button,input,select,textarea,a[href],iframe,[tabindex]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden],[inert]') && el.getClientRects().length);
    function sync() {
        for (const [root, record] of records) if (!active(root)) {
            records.delete(root);
            if (record.previous?.isConnected &&
                (!document.activeElement || document.activeElement === document.body || root.contains(document.activeElement))) record.previous.focus({ preventScroll: true });
        }
        for (const root of document.querySelectorAll(selector)) {
            if (records.has(root) || !allowed(root)) continue;
            const previous = root.id === 'char-status-overlay' ? document.getElementById('char-status-btn') : root.contains(document.activeElement) ? null : document.activeElement;
            records.set(root, { previous });
            const panel = root.querySelector('[role="dialog"],.feature-dialog-card') || root;
            panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
            if (!panel.hasAttribute('aria-label')) panel.setAttribute('aria-label', root.id === 'char-status-overlay' ? '状态栏' : panel.querySelector('header strong')?.textContent || '功能设置');
            if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
            if (!root.contains(document.activeElement)) (root.querySelector('#close-status-panel-btn') || focusable(root)[0] || panel).focus({ preventScroll: true });
            if (root.id === 'char-status-overlay') {
                // The existing visibility transition can reject focus until it finishes.
                Promise.all(root.getAnimations().map(animation => animation.finished.catch(() => {}))).then(() => {
                    if (active(root) && document.activeElement === previous) root.querySelector('#close-status-panel-btn')?.focus({ preventScroll: true });
                });
            }
        }
    }
    document.addEventListener('keydown', event => {
        if (event.isComposing || !['Tab', 'Escape'].includes(event.key)) return;
        sync(); const root = [...records.keys()].filter(active).pop();
        if (!root) return;
        // An unmanaged overlay (for example the editor) owns its own keys.
        const topOverlay = [...document.querySelectorAll('.feature-dialog,.message-forward-overlay,#char-status-overlay.visible')].filter(el => el.getClientRects().length).pop();
        if (topOverlay && topOverlay !== root) return;
        if (event.key === 'Escape') {
            const close = root.querySelector('[data-action="close"],.message-forward-close,[data-close],#close-status-panel-btn');
            if (!close || close.disabled) return;
            event.preventDefault(); event.stopImmediatePropagation(); close.click();
        } else {
            const targets = focusable(root); if (!targets.length) { event.preventDefault(); return; }
            const first = targets[0], last = targets[targets.length - 1];
            if (!root.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) ||
                (!event.shiftKey && document.activeElement === last)) {
                event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
            }
        }
    }, true);
    const start = () => { new MutationObserver(sync).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); sync(); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}());
