// Accepted sessions only; presentation never changes chat history or reply rules.
(function (root) {
    'use strict';
    const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
    function mount() {
        const room = document.getElementById('chat-room-screen'), header = document.getElementById('chat-room-header-select');
        if (!room || !header || !root.UvUMusic || room.querySelector('.um-together-float')) return false;
        const bar = node('div', 'um-together-float'), open = node('button', 'um-together-open'), image = node('img', 'um-together-cover'), info = node('span', 'um-together-info');
        const status = node('strong', '', '一起听'), song = node('span', ''), toggle = node('button', 'um-together-control'), end = node('button', 'um-together-control');
        bar.hidden = true; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '一起听状态');
        open.type = toggle.type = end.type = 'button'; open.setAttribute('aria-label', '打开一起听播放器'); end.setAttribute('aria-label', '结束一起听');
        image.alt = ''; image.referrerPolicy = 'no-referrer';
        image.onerror = () => { if (image.getAttribute('src') !== 'assets/music/icons/music-2.svg') image.src = 'assets/music/icons/music-2.svg'; };
        const toggleIcon = node('img', ''), endIcon = node('img', ''); toggleIcon.alt = endIcon.alt = ''; endIcon.src = 'assets/music/icons/x.svg';
        info.append(status, song); open.append(image, info); toggle.append(toggleIcon); end.append(endIcon); bar.append(open, toggle, end); header.after(bar);
        let sessionId = '';
        const bound = () => { const s = root.UvUMusicChat?.session(); return s?.id === sessionId ? s : null; };
        open.onclick = () => { if (bound()) root.UvUMusicUI?.nowPlaying(); };
        toggle.onclick = () => { if (bound()) root.UvUMusic.player.toggle(); };
        end.onclick = async () => {
            if (!bound() || end.disabled) return; end.disabled = true;
            try { await root.UvUMusicChat.end(); } catch (error) { if (typeof showToast === 'function') showToast(error.message); }
            finally { end.disabled = false; update(); }
        };
        function update() {
            const s = root.UvUMusicChat?.session();
            const visible = s && room.classList.contains('active') && !room.classList.contains('multi-select-active') &&
                typeof currentChatType !== 'undefined' && currentChatType === 'private' && typeof currentChatId !== 'undefined' && currentChatId === s.chatId;
            bar.hidden = !visible; sessionId = visible ? s.id : ''; if (!visible) return;
            const label = s.localPlayback ? '一起听' : '一起听 · 已暂停';
            if (status.textContent !== label) status.textContent = label;
            if (song.textContent !== s.track.title) song.textContent = s.track.title;
            const cover = s.track.cover || 'assets/music/icons/music-2.svg'; if (image.getAttribute('src') !== cover && image.dataset.cover !== cover) { image.dataset.cover = cover; image.src = cover; }
            toggle.setAttribute('aria-label', s.localPlayback ? '暂停一起听' : '继续一起听');
            const src = 'assets/music/icons/' + (s.localPlayback ? 'pause' : 'play') + '.svg'; if (toggleIcon.getAttribute('src') !== src) toggleIcon.src = src;
        }
        root.UvUMusic.player.subscribe(update); root.addEventListener('music-chat-state', update);
        new MutationObserver(update).observe(room, { attributes: true, attributeFilter: ['class'] });
        const title = document.getElementById('chat-room-title'); if (title) new MutationObserver(update).observe(title, { childList: true, characterData: true, subtree: true });
        document.addEventListener('click', () => queueMicrotask(update)); document.addEventListener('visibilitychange', update);
        update(); return true;
    }
    function start() { if (mount()) return; const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); }); observer.observe(document.body, { childList: true, subtree: true }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
