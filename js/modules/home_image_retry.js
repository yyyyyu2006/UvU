(function () {
    'use strict';

    const home = document.getElementById('home-screen');
    const phone = home && home.parentElement;
    if (!phone || document.getElementById('home-image-retry')) return;

    const failures = new Map();
    let dismissed = false;
    let updateTimer = null;
    const notice = document.createElement('div');
    notice.id = 'home-image-retry';
    notice.hidden = true;
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '\u91cd\u8bd5';
    retry.title = '\u91cd\u65b0\u52a0\u8f7d\u5931\u8d25\u7684\u4e3b\u9875\u56fe\u7247';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'home-image-retry-close';
    close.textContent = '\u00d7';
    close.title = '\u5173\u95ed\u56fe\u7247\u52a0\u8f7d\u63d0\u793a';
    close.setAttribute('aria-label', close.title);
    notice.append(status, retry, close);
    phone.appendChild(notice);

    function source(image) {
        return JSON.stringify(['src', 'srcset', 'sizes'].map(name => image.getAttribute(name)));
    }

    function eligible(image) {
        if (!image || image.tagName !== 'IMG' || !home.contains(image)) return false;
        if (!image.getAttribute('src') && !image.getAttribute('srcset')) return false;
        try {
            return /^https?:$/.test(new URL(image.currentSrc || image.src, document.baseURI).protocol);
        } catch (_) {
            return false;
        }
    }

    function forget(image) {
        const entry = failures.get(image);
        if (entry) clearTimeout(entry.timer);
        failures.delete(image);
    }

    function update() {
        clearTimeout(updateTimer);
        updateTimer = null;
        for (const [image, entry] of failures) {
            if (!eligible(image) || source(image) !== entry.source || (image.complete && image.naturalWidth > 0)) {
                forget(image);
            }
        }
        if (!failures.size) dismissed = false;
        const pending = [...failures.values()].filter(entry => entry.pending).length;
        notice.hidden = !failures.size || dismissed || !home.classList.contains('active');
        status.textContent = pending
            ? '\u6b63\u5728\u91cd\u8bd5 ' + pending + ' \u5f20\u56fe\u7247'
            : failures.size + ' \u5f20\u56fe\u7247\u672a\u52a0\u8f7d';
        retry.disabled = pending > 0;
        retry.textContent = pending ? '\u91cd\u8bd5\u4e2d' : '\u91cd\u8bd5';
    }

    function scheduleUpdate() {
        if (updateTimer === null) updateTimer = setTimeout(update, 0);
    }

    function failed(image) {
        if (!eligible(image) || !image.complete || image.naturalWidth > 0) return;
        forget(image);
        failures.set(image, { source: source(image), pending: false, timer: null });
        scheduleUpdate();
    }

    home.addEventListener('error', event => failed(event.target), true);
    home.addEventListener('load', event => {
        if (event.target.tagName === 'IMG' && event.target.naturalWidth > 0) {
            forget(event.target);
            scheduleUpdate();
        }
    }, true);

    function inspect(node) {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'IMG') failed(node);
        node.querySelectorAll('img').forEach(failed);
    }

    // Observe only the home: widget scripts and persisted template contents stay untouched.
    new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'childList') record.addedNodes.forEach(inspect);
        }
        if (failures.size) scheduleUpdate();
    }).observe(home, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] });
    new MutationObserver(() => {
        if (home.classList.contains('active')) dismissed = false;
        scheduleUpdate();
    }).observe(home, { attributes: true, attributeFilter: ['class'] });

    retry.addEventListener('click', event => {
        event.stopPropagation();
        update();
        if (retry.disabled) return;
        for (const [image, entry] of failures) {
            entry.pending = true;
            entry.timer = setTimeout(() => {
                if (failures.get(image) !== entry) return;
                entry.pending = false;
                entry.timer = null;
                scheduleUpdate();
            }, 12000);
            // Reassign the exact existing attribute; do not change signed URLs or rerender widgets.
            const attribute = image.getAttribute('src') ? 'src' : 'srcset';
            image.setAttribute(attribute, image.getAttribute(attribute));
        }
        update();
    });
    close.addEventListener('click', event => {
        event.stopPropagation();
        dismissed = true;
        notice.hidden = true;
    });

    inspect(home);
    scheduleUpdate();
}());
