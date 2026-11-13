// Lifecycle for derived dialogs only; no history entries or original modal changes.
(function () {
    'use strict';
    const records = new Map();
    const inlineSelector = '#uvu-notification-preferences[open] > .draft-inline-workspace, .worldbook-advanced[open] > .draft-inline-workspace';
    const selector = '.feature-dialog:not(#expanded-text-editor), .message-forward-overlay, #char-status-overlay.visible, ' + inlineSelector;
    const active = el => el.isConnected && (el.id !== 'char-status-overlay' || el.classList.contains('visible')) &&
        (!el.matches('.draft-inline-workspace') || el.parentElement.open && el.getClientRects().length > 0);
    const allowed = el => el.id === 'char-status-overlay' || el.matches('.feature-dialog,.draft-inline-workspace') || !!el.querySelector('.mcp-settings,.derived-settings,.resource-health');
    const isolated = new Map();
    let isolationRoot = null, syncing = false;
    // The native rescue window must remain interactive above a derived dialog.
    const overlaySelector = '.feature-dialog,.message-forward-overlay,#char-status-overlay.visible,#global-rescue-panel,' + inlineSelector;
    const topDialog = () => [...document.querySelectorAll(overlaySelector)]
        .filter(el => el.getClientRects().length).pop() || null;
    function restoreBackground() {
        for (const [element, before] of isolated) {
            if (before.inert === null) element.removeAttribute('inert'); else element.setAttribute('inert', before.inert);
            if (before.hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', before.hidden);
        }
        isolated.clear(); isolationRoot = null;
    }
    function isolateBackground(root) {
        if (!root) return;
        // Isolate sibling branches along the path, never an ancestor of the dialog.
        for (let branch = root; branch.parentElement && branch !== document.body; branch = branch.parentElement) {
            for (const sibling of branch.parentElement.children) {
                if (sibling === branch || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sibling.tagName) || isolated.has(sibling)) continue;
                isolated.set(sibling, { inert: sibling.getAttribute('inert'), hidden: sibling.getAttribute('aria-hidden') });
                sibling.setAttribute('inert', ''); sibling.setAttribute('aria-hidden', 'true');
            }
        }
        isolationRoot = root;
    }
    const focusable = root => [...root.querySelectorAll('button,input,select,textarea,summary,a[href],iframe,[tabindex]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden],[inert]') && el.getClientRects().length);
    function sync() {
        if (syncing) return;
        syncing = true;
        try {
        const top = topDialog();
        if (top !== isolationRoot) restoreBackground();
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
            if (root === top && !root.contains(document.activeElement)) (root.querySelector('#close-status-panel-btn') || focusable(root)[0] || panel).focus({ preventScroll: true });
            if (root.id === 'char-status-overlay') {
                // The existing visibility transition can reject focus until it finishes.
                Promise.all(root.getAnimations().map(animation => animation.finished.catch(() => {}))).then(() => {
                    if (active(root) && topDialog() === root && !root.contains(document.activeElement)) root.querySelector('#close-status-panel-btn')?.focus({ preventScroll: true });
                });
            }
        }
        isolateBackground(top);
        } finally { syncing = false; }
    }
    document.addEventListener('focusin', event => {
        if (syncing) return;
        sync(); const root = topDialog();
        if (root && !root.contains(event.target)) (focusable(root)[0] || root.querySelector('[role=dialog]') || root).focus({ preventScroll: true });
    }, true);
    document.addEventListener('keydown', event => {
        if (event.isComposing || !['Tab', 'Escape'].includes(event.key)) return;
        sync(); const root = [...records.keys()].filter(active).pop();
        if (!root) return;
        // An unmanaged overlay (for example the editor) owns its own keys.
        const topOverlay = topDialog();
        if (topOverlay && topOverlay !== root) return;
        // The calendar range owns the first Escape; a later Escape closes it.
        if (event.key === 'Escape' && event.target.closest?.('.uvu-calendar .calendar-month.is-range-mode')) return;
        if (event.key === 'Escape') {
            const close = root.querySelector('[data-action="close"],.message-forward-close,[data-close],#close-status-panel-btn,.sheet-close,.mono-nav-back');
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
    const start = () => { new MutationObserver(sync).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','open'] }); sync(); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}());
