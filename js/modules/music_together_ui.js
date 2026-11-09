// Accepted sessions only; presentation never changes chat history or reply rules.
(function (root) {
    'use strict';
    const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
    function mount() {
        const room = document.getElementById('chat-room-screen'), header = document.getElementById('chat-room-header-select');
        const phone = document.querySelector('.phone-screen');
        if (!room || !header || !phone || !root.UvUMusic || phone.querySelector('.um-together-float')) return false;
        const bar = node('div', 'um-together-float'), open = node('button', 'um-together-open'), image = node('img', 'um-together-cover'), info = node('span', 'um-together-info');
        const status = node('strong', '', '一起听'), song = node('span', ''), toggle = node('button', 'um-together-control'), end = node('button', 'um-together-control');
        bar.hidden = true; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '一起听状态');
        open.type = toggle.type = end.type = 'button'; open.setAttribute('aria-label', '打开一起听播放器'); end.setAttribute('aria-label', '结束一起听');
        image.alt = ''; image.referrerPolicy = 'no-referrer';
        image.onerror = () => { if (image.getAttribute('src') !== 'assets/music/cover-placeholder.svg') image.src = 'assets/music/cover-placeholder.svg'; };
        const toggleIcon = node('img', ''), endIcon = node('img', ''); toggleIcon.alt = endIcon.alt = ''; endIcon.src = 'assets/music/icons/x.svg';
        info.append(status, song); open.append(image, info); toggle.append(toggleIcon); end.append(endIcon); bar.append(open, toggle, end); phone.append(bar);
        let sessionId = '';
        const bound = () => { const s = root.UvUMusicChat?.session(); return s?.id === sessionId ? s : null; };
        open.onclick = () => { if (bound()) root.UvUMusicUI?.nowPlaying(); };
        toggle.onclick = async () => { if (!bound() || toggle.disabled) return; toggle.disabled = true; try { await root.UvUMusicChat.togglePlayback(); } catch (e) { if (typeof showToast === 'function') showToast(e.message); } finally { toggle.disabled = false; update(); } };
        end.onclick = async () => {
            if (!bound() || end.disabled) return; end.disabled = true;
            try { await root.UvUMusicChat.end(); } catch (error) { if (typeof showToast === 'function') showToast(error.message); }
            finally { end.disabled = false; update(); }
        };
        function update() {
            const s = root.UvUMusicChat?.session();
            const visible = Boolean(s);
            // Music sheets live outside the phone's stacking context. Keep the same
            // controls above their scrolling body, then return them when the sheet closes.
            const card = visible ? document.querySelector('.uvu-music-sheet .um-sheet-card') : null;
            const host = card || phone;
            if (bar.parentElement !== host) host.insertBefore(bar, card?.querySelector('.um-sheet-body') || null);
            bar.classList.toggle('um-together-on-sheet', Boolean(card));
            if (card) bar.style.removeProperty('top');
            else {
                const screen = phone.querySelector('.screen.active');
                const top = screen?.querySelector('header:not([hidden])');
                const y = top?.getBoundingClientRect().bottom - phone.getBoundingClientRect().top;
                bar.style.top = Math.max(8, Number.isFinite(y) && y > 0 ? y + 8 : 8) + 'px';
            }
            bar.hidden = !visible; sessionId = visible ? s.id : ''; if (!visible) return;
            const chat = typeof db !== 'undefined' ? db.characters.find(c => c.id === s.chatId) : null;
            const label = '与' + (chat?.remarkName || chat?.realName || '角色') + '一起听' + (s.localPlayback ? '' : ' · 已暂停');
            if (status.textContent !== label) status.textContent = label;
            if (song.textContent !== s.track.title) song.textContent = s.track.title;
            const cover = s.track.cover || 'assets/music/cover-placeholder.svg'; if (image.getAttribute('src') !== cover && image.dataset.cover !== cover) { image.dataset.cover = cover; image.src = cover; }
            toggle.setAttribute('aria-label', s.localPlayback ? '暂停一起听' : '继续一起听');
            const src = 'assets/music/icons/' + (s.localPlayback ? 'pause' : 'play') + '.svg'; if (toggleIcon.getAttribute('src') !== src) toggleIcon.src = src;
        }
        root.UvUMusic.player.subscribe(update); root.addEventListener('music-chat-state', update);
        root.addEventListener('music-sheet-state', update);
        new MutationObserver(update).observe(phone, { attributes: true, subtree: true, attributeFilter: ['class'] });
        new MutationObserver(update).observe(document.body, { childList: true });
        root.addEventListener('resize', update);
        if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(phone);
        const title = document.getElementById('chat-room-title'); if (title) new MutationObserver(update).observe(title, { childList: true, characterData: true, subtree: true });
        document.addEventListener('click', () => queueMicrotask(update)); document.addEventListener('visibilitychange', update);
        update(); return true;
    }
    function start() { if (mount()) return; const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); }); observer.observe(document.body, { childList: true, subtree: true }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
