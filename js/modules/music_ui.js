(function (root) {
    'use strict';
    const M = root.UvUMusic, names = { netease: '网易云', qq: 'QQ 音乐', local: '本地', 'gd-netease': 'GD · 网易云' };
    let screen, main, mini, tab = 'home', sheet, sheetClose, searchController, searchSequence = 0, query = '', provider = '', results = [], searchPage = 1, hasMore = false, searchError = '', debounce, shareTarget, renderedLibrary, searchLoading = false, favoriteLimit = 50, playbackSignature = '';
    const librarySource = () => typeof db !== 'undefined' ? db.musicLibrary : root.db?.musicLibrary;
    const el = (tag, text, cls = '') => { const node = document.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node; };
    const toast = error => { if (typeof showToast === 'function') showToast(String(error?.message || error).slice(0, 250)); };
    function icon(name) { const image = el('img'); image.src = 'assets/music/icons/' + name + '.svg'; image.alt = ''; image.setAttribute('aria-hidden', 'true'); return image; }
    function button(label, action, name, cls = '') {
        const b = el('button', name ? undefined : label, 'um-button ' + (name ? 'um-icon ' : '') + cls); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
        if (name) b.append(icon(name));
        b.onclick = async event => { event.stopPropagation(); if (b.disabled) return; b.disabled = true; try { await action(event); } catch (e) { toast(e); } finally { b.disabled = false; } }; return b;
    }
    function cover(track, cls = '') {
        const image = el('img', undefined, 'um-cover ' + cls); image.src = track?.cover || 'assets/music/icons/music-2.svg'; image.alt = track?.title || ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
        image.onerror = () => { image.onerror = null; image.src = 'assets/music/icons/music-2.svg'; }; return image;
    }
    const clock = seconds => { const n = Math.floor(Math.max(0, Number(seconds) || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
    function section(title, action) { const box = el('section', undefined, 'um-section'), head = el('div', undefined, 'um-section-head'); head.append(el('h2', title)); if (action) head.append(action); box.append(head); return box; }
    function empty(parent, title, action) { const box = el('div', undefined, 'um-empty'); box.append(icon('music-2'), el('p', title)); if (action) box.append(action); parent.append(box); }
    function trackRows(parent, tracks, options = {}) {
        tracks.forEach(track => {
            const row = el('div', undefined, 'um-track'), play = el('button', undefined, 'um-track-main'); play.type = 'button'; play.setAttribute('aria-label', '播放 ' + track.title);
            const info = el('span', undefined, 'um-track-info'); info.append(el('strong', track.title), el('small', (track.artists.join(' / ') || '未知歌手') + ' · ' + names[track.provider]));
            play.append(cover(track), info); play.onclick = () => { void M.player.play(track, tracks).catch(toast); };
            row.append(play, button('更多 · ' + track.title, () => trackMenu(track, options), 'ellipsis')); parent.append(row);
        });
    }
    function modal(title, render, onClose) {
        closeSheet();
        const previousFocus = document.activeElement, overlay = el('div', undefined, 'uvu-music-sheet'), card = el('div', undefined, 'um-sheet-card'), head = el('header', undefined, 'um-sheet-head');
        overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', title); card.tabIndex = -1;
        const body = el('div', undefined, 'um-sheet-body'); head.append(el('h2', title), button('关闭', closeSheet, 'x')); card.append(head, body); overlay.append(card); sheet = overlay;
        const keyHandler = event => {
            if (event.key === 'Escape') { event.preventDefault(); closeSheet(); }
            if (event.key === 'Tab') {
                const controls = [...card.querySelectorAll('button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter(n => n.getClientRects().length);
                const first = controls[0], last = controls.at(-1);
                if (!controls.length) { event.preventDefault(); card.focus(); }
                else if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        };
        overlay.addEventListener('keydown', keyHandler); overlay.onclick = event => { if (event.target === overlay) closeSheet(); };
        sheetClose = () => { onClose?.(); previousFocus?.isConnected && previousFocus.focus(); }; document.body.append(overlay); render(body, overlay); card.focus(); return body;
    }
    function closeSheet() { if (!sheet) return; const done = sheetClose; sheet.remove(); sheet = sheetClose = null; done?.(); }
    function share(track, invite = false) {
        const capturedTarget = shareTarget, controller = new AbortController(); let alive = true;
        modal(invite ? '邀请一起听' : '分享音乐', body => {
            const preview = el('div', undefined, 'um-track'), info = el('div', undefined, 'um-track-info'); info.append(el('strong', track.title), el('small', track.artists.join(' / '))); preview.append(cover(track), info); body.append(preview);
            const lyrics = el('textarea'); lyrics.rows = 4; lyrics.maxLength = 2000; lyrics.placeholder = '附上歌词片段（可选）'; lyrics.setAttribute('aria-label', '分享歌词片段');
            const status = el('p', '', 'um-muted'); status.setAttribute('aria-live', 'polite');
            if (track.provider !== 'local') body.append(button('读取歌词', async () => { status.textContent = '正在读取…'; try { const data = await M.lyrics(track, controller.signal); if (alive) { lyrics.value = (data.lyric || '').replace(/\[[\d:.]+\]/g, '').slice(0, 2000); status.textContent = lyrics.value ? '可删改后发送' : '暂无歌词'; } } catch (e) { if (alive) status.textContent = e.message; } }));
            body.append(lyrics, status, button(invite ? '发送邀请' : '发送', async () => {
                const sent = await root.UvUMusicChat.share(track, { invite, lyrics: lyrics.value.trim(), ...(capturedTarget ? { target: capturedTarget } : {}) });
                if (sent && alive) { closeSheet(); toast(invite ? '已发送一起听邀请' : '已分享音乐'); if (capturedTarget && typeof isChatSendTargetValid === 'function' && isChatSendTargetValid(capturedTarget) && typeof openChatRoom === 'function') openChatRoom(capturedTarget.chatId, 'private'); }
            }, undefined, 'um-primary'));
        }, () => { alive = false; controller.abort(); });
    }
    function trackMenu(track, options) {
        modal(track.title, body => {
            body.append(button('播放下一首', () => { M.player.enqueue(track, true); closeSheet(); }, undefined, 'um-wide'),
                button(M.library().favorites.some(t => M.key(t) === M.key(track)) ? '取消喜欢' : '加入喜欢', async () => { await M.toggleFavorite(track); closeSheet(); render(); }, undefined, 'um-wide'),
                button('加入歌单', () => choosePlaylist(track), undefined, 'um-wide'),
                button('分享给角色', async () => { closeSheet(); await share(track); }, undefined, 'um-wide'),
                button('邀请一起听', async () => { closeSheet(); await share(track, true); }, undefined, 'um-wide'));
            if (options.playlistId) body.append(button('从歌单移除', async () => { await M.removeFromPlaylist(options.playlistId, M.key(track)); closeSheet(); render(); }, undefined, 'um-wide'));
            if (track.provider === 'local') body.append(button('删除本地音乐', async () => {
                const confirmed = typeof showConfirm === 'function' ? await showConfirm('删除本地音乐', '同时移出本机资料库、歌单和队列。聊天中已分享的歌曲卡片仍会保留。') : root.confirm('删除这首本地音乐？');
                if (!confirmed) return; await M.deleteLocal(track); closeSheet(); render();
            }, undefined, 'um-wide'));
            if (track.pageUrl) { const a = el('a', '在来源平台查看', 'um-link'); a.href = track.pageUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a); }
        });
    }
    function choosePlaylist(track) {
        modal('加入歌单', body => {
            const list = M.library().playlists;
            for (const item of list) body.append(button(item.name, async () => { await M.addToPlaylist(item.id, track); closeSheet(); render(); }, undefined, 'um-wide'));
            body.append(button('新建歌单', () => createPlaylist(track), undefined, 'um-wide'));
        });
    }
    function createPlaylist(track) {
        modal('新建歌单', body => {
            const input = el('input'); input.placeholder = '歌单名称'; input.maxLength = 160; input.setAttribute('aria-label', '歌单名称');
            body.append(input, button('创建', async () => { const item = await M.addPlaylist(input.value); if (track) await M.addToPlaylist(item.id, track); closeSheet(); render(); }, undefined, 'um-primary'));
        });
    }
    function openPlaylist(item, cloudProvider) {
        let page = 1, tracks = [], pending = false, alive = true; const controller = new AbortController();
        modal(item.name, body => {
            const list = el('div'), footer = el('div', undefined, 'um-actions'); body.append(list, footer);
            const load = async () => {
                if (pending) return; pending = true;
                try {
                    const data = cloudProvider ? await M.playlist(cloudProvider, item.id, page, controller.signal) : { tracks: item.tracks, hasMore: false };
                    if (!alive) return; tracks.push(...data.tracks); list.replaceChildren(); trackRows(list, tracks, cloudProvider ? {} : { playlistId: item.id }); footer.replaceChildren();
                    if (!tracks.length) empty(list, '歌单里还没有歌曲');
                    if (data.hasMore) footer.append(button('加载更多', async () => { page++; await load(); }));
                    if (!cloudProvider) footer.append(button('删除歌单', async () => { if (!root.confirm('删除这个歌单？音乐文件会保留。')) return; await M.deletePlaylist(item.id); closeSheet(); render(); }));
                } catch (e) { if (alive) toast(e); } finally { pending = false; }
            }; void load();
        }, () => { alive = false; controller.abort(); });
    }
    async function importFiles(files) {
        let count = 0;
        for (const file of files) { try { await M.importLocal(file); count++; } catch (e) { toast(file.name + '：' + e.message); } }
        if (count) toast('已导入 ' + count + ' 首'); render();
    }
    function importButton() { return button('导入音乐', () => document.getElementById('um-local-files').click(), 'plus'); }
    function render() {
        if (!screen) return;
        renderedLibrary = librarySource();
        const previousScroll = main.scrollTop; main.replaceChildren();
        document.querySelectorAll('#uvu-music-screen [data-um-tab]').forEach(b => { const selected = b.dataset.umTab === tab; b.classList.toggle('active', selected); b.setAttribute('aria-selected', String(selected)); });
        if (tab === 'search') return renderSearch();
        const lib = M.library();
        const hero = el('div', undefined, 'um-hero'); hero.append(el('h1', tab === 'library' ? '资料库' : '今天，听点什么'), el('div', undefined, 'um-hero-tools'));
        hero.lastChild.append(button('音乐源', accountsPanel), button('导入音乐', () => document.getElementById('um-local-files').click())); main.append(hero);
        if (tab === 'home') {
            const recent = section('最近播放'); main.append(recent); trackRows(recent, lib.recent.slice(0, 12)); if (!lib.recent.length) empty(recent, '从一首喜欢的歌开始');
            const together = section('一起听'); const invite = root.UvUMusicChat?.session?.();
            if (invite) { const character = typeof db !== 'undefined' ? db.characters.find(c => c.id === invite.chatId) : null; together.append(el('p', '与' + (character?.remarkName || character?.realName || '角色') + '一起听 · ' + invite.track.title + (invite.localPlayback ? '' : ' · 已暂停')), button('结束一起听', async () => { await root.UvUMusicChat.end(); render(); })); }
            else together.append(el('p', '在歌曲菜单中邀请角色一起听', 'um-muted')); main.append(together);
        }
        const liked = section('喜欢的歌', importButton()); trackRows(liked, lib.favorites.slice(0, favoriteLimit)); if (!lib.favorites.length) empty(liked, '收藏或导入你的第一首歌');
        if (lib.favorites.length > favoriteLimit) liked.append(button('显示更多', () => { favoriteLimit += 50; render(); })); main.append(liked);
        if (tab === 'library') {
            const playlists = section('我的歌单', button('新建歌单', () => createPlaylist(), 'plus'));
            lib.playlists.forEach(item => { const row = button(item.name, () => openPlaylist(item), undefined, 'um-playlist'); row.prepend(cover(item.tracks[0])); row.append(el('small', item.tracks.length + ' 首')); playlists.append(row); });
            if (!lib.playlists.length) playlists.append(el('p', '把喜欢的歌放在一起', 'um-muted')); main.append(playlists);
            if (lib.recent.length) main.append(button('清空播放记录', async () => { await M.clearRecent(); render(); }));
        }
        main.scrollTop = previousScroll;
    }
    function renderSearch() {
        if (!provider) provider = M.settings().endpoint ? 'all' : 'gd-netease';
        const form = el('form', undefined, 'um-search'), input = el('input'); input.type = 'search'; input.placeholder = '歌曲、歌手或专辑'; input.setAttribute('aria-label', '搜索音乐'); input.value = query;
        const submit = button('搜索', () => runSearch(true), 'search'); form.append(input, submit); form.onsubmit = e => { e.preventDefault(); query = input.value.trim(); void runSearch(true); };
        input.oninput = () => { query = input.value.trim(); clearTimeout(debounce); searchController?.abort(); ++searchSequence; searchLoading = false; searchError = ''; results = []; hasMore = false; renderSearchResults(); debounce = setTimeout(() => void runSearch(true), provider === 'gd-netease' ? 900 : 450); };
        const sources = el('div', undefined, 'um-sources');
        const credit = publicCredit(); credit.hidden = provider !== 'gd-netease';
        for (const [id, label] of [['gd-netease', '公共源'], ['all', '账号全部'], ['netease', '网易云'], ['qq', 'QQ 音乐']]) { const b = button(label, () => { query = input.value.trim(); provider = id; credit.hidden = id !== 'gd-netease'; for (const child of sources.children) { const active = child === b; child.classList.toggle('active', active); child.setAttribute('aria-pressed', String(active)); } void runSearch(true); }); b.classList.toggle('active', id === provider); b.setAttribute('aria-pressed', String(id === provider)); sources.append(b); }
        main.append(form, sources, credit, el('p', searchError, 'um-muted um-search-status'));
        main.append(el('div', undefined, 'um-search-results'), el('div', undefined, 'um-search-more')); renderSearchResults();
    }
    function renderSearchResults() {
        if (tab !== 'search') return;
        const list = main.querySelector('.um-search-results'); if (!list) return;
        main.querySelector('.um-search-status').textContent = searchError; list.replaceChildren(); trackRows(list, results);
        if (provider === 'gd-netease' && !M.settings().publicSources.includes('gd-netease')) empty(list, '开启公共源后即可搜索', button('开启公共源', accountsPanel));
        else if (!results.length && !searchError) empty(list, query ? '没有找到歌曲' : provider === 'gd-netease' ? '搜索公共网易云曲库' : '搜索网易云与 QQ 音乐');
        const more = main.querySelector('.um-search-more'); more.replaceChildren(); if (hasMore) { const b = button('加载更多', () => runSearch(false), undefined, 'um-load-more'); b.disabled = searchLoading; more.append(b); }
    }
    async function runSearch(reset) {
        clearTimeout(debounce); if (!reset && searchLoading) return;
        if (reset) { results = []; searchPage = 1; hasMore = false; }
        if (!query) { searchError = ''; renderSearchResults(); return; }
        searchController?.abort(); const controller = new AbortController(), seq = ++searchSequence; searchController = controller;
        searchLoading = true; searchError = '正在搜索…'; renderSearchResults();
        try {
            const data = await M.search(query, provider === 'all' ? ['netease', 'qq'] : [provider], searchPage, controller.signal);
            if (seq !== searchSequence) return;
            const seen = new Set(results.map(M.key)); for (const track of data.tracks) if (!seen.has(M.key(track))) { results.push(track); seen.add(M.key(track)); }
            results = results.slice(0, 500); hasMore = data.hasMore && results.length < 500; searchPage++; const errors = data.errors || {};
            searchError = (Array.isArray(errors) ? errors : Object.entries(errors).map(([provider, message]) => ({ provider, message }))).map(e => (names[e.provider] || e.provider) + '：' + String(e.message)).join('；');
        } catch (e) { if (seq !== searchSequence || e.name === 'AbortError') return; searchError = e.message; }
        if (seq !== searchSequence) return; searchLoading = false;
        renderSearchResults();
    }
    function updateMini(state) {
        if (!mini) return;
        mini.hidden = !state.track;
        if (!state.track) { mini.replaceChildren(); delete mini.dataset.key; return; }
        const track = state.track;
        if (mini.dataset.key !== M.key(track)) {
            mini.dataset.key = M.key(track); mini.replaceChildren(); const open = el('button', undefined, 'um-mini-open'); open.type = 'button'; open.setAttribute('aria-label', '展开播放器');
            const info = el('span', undefined, 'um-track-info'); info.append(el('strong', track.title), el('small', track.artists.join(' / ') || names[track.provider])); open.append(cover(track), info); open.onclick = nowPlaying;
            mini.append(open, button('播放或暂停', () => M.player.toggle(), 'play'), button('下一首', () => M.player.next(), 'skip-forward'), el('span', undefined, 'um-mini-progress'));
        }
        const toggle = mini.querySelector('[aria-label="播放或暂停"] img'); toggle.src = 'assets/music/icons/' + (state.playing ? 'pause' : 'play') + '.svg';
        mini.querySelector('.um-mini-progress').style.width = Math.max(0, Math.min(100, state.duration ? state.position / state.duration * 100 : 0)) + '%';
    }
    function nowPlaying() {
        let unsubscribe;
        modal('正在播放', body => {
            const artwork = cover(null, 'um-artwork'), title = el('h2'), artist = el('p', undefined, 'um-muted'), status = el('p', undefined, 'um-player-status'), slider = el('input'), timing = el('div', undefined, 'um-timing');
            slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = .1; slider.setAttribute('aria-label', '播放进度'); slider.onchange = () => M.player.seek(Number(slider.value));
            const controls = el('div', undefined, 'um-player-controls'), previous = button('上一首', () => M.player.previous(), 'skip-back'), toggle = button('播放或暂停', () => M.player.toggle(), 'play', 'um-primary'), next = button('下一首', () => M.player.next(), 'skip-forward'); controls.append(previous, toggle, next);
            const tools = el('div', undefined, 'um-player-tools'), mode = button('播放顺序', () => { const modes = ['order', 'shuffle', 'one']; M.player.setMode(modes[(modes.indexOf(M.player.snapshot().mode) + 1) % 3]); }, 'repeat');
            tools.append(mode, button('喜欢', async () => { const t = M.player.snapshot().track; if (t) { await M.toggleFavorite(t); toast('已更新喜欢的歌'); } }, 'heart'), button('播放队列', queuePanel, 'list-music'), button('定时关闭', sleepPanel, 'moon'));
            const actions = el('div', undefined, 'um-actions'); actions.append(button('歌词', lyricsPanel), button('分享', async () => { const t = M.player.snapshot().track; if (t) { closeSheet(); await share(t); } }), button('一起听', async () => { const t = M.player.snapshot().track; if (t) { closeSheet(); await share(t, true); } }));
            body.append(artwork, title, artist, status, slider, timing, controls, tools, actions);
            unsubscribe = M.player.subscribe(state => {
                const t = state.track; if (t) { artwork.src = t.cover || 'assets/music/icons/music-2.svg'; title.textContent = t.title; artist.textContent = t.artists.join(' / '); }
                slider.max = state.duration || 1; if (document.activeElement !== slider) slider.value = state.position; timing.textContent = clock(state.position) + ' / ' + clock(state.duration);
                toggle.firstChild.src = 'assets/music/icons/' + (state.playing ? 'pause' : 'play') + '.svg'; mode.title = { order: '顺序播放', shuffle: '随机播放', one: '单曲循环' }[state.mode]; mode.setAttribute('aria-label', mode.title);
                mode.classList.toggle('active', state.mode !== 'order'); status.textContent = state.error || (state.phase === 'loading' ? '正在加载…' : t?.availability === 'preview' ? '平台试听' : state.sleepAt ? '定时关闭 · ' + new Date(state.sleepAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
            });
        }, () => unsubscribe?.());
    }
    function queuePanel() {
        modal('播放队列', body => { const state = M.player.snapshot(); state.queue.forEach((track, index) => { const row = el('div', undefined, 'um-track'); row.append(button(track.title, () => M.player.play(track), undefined, 'um-queue-title'), button('移出队列', () => { M.player.remove(index); queuePanel(); }, 'x')); body.append(row); }); if (!state.queue.length) empty(body, '队列为空'); });
    }
    function sleepPanel() { modal('定时关闭', body => { for (const n of [0, 15, 30, 60]) body.append(button(n ? n + ' 分钟后' : '关闭定时', () => { M.player.setSleep(n); closeSheet(); }, undefined, 'um-wide')); }); }
    function lyricsPanel() {
        const track = M.player.snapshot().track; if (!track) return; const controller = new AbortController(); let alive = true;
        modal('歌词', body => { const words = el('pre', '正在读取…', 'um-lyrics'); body.append(words); void M.lyrics(track, controller.signal).then(data => { if (alive) words.textContent = (data.lyric || '暂无歌词') + (data.translation ? '\n\n' + data.translation : ''); }).catch(e => { if (alive) words.textContent = e.message; }); }, () => { alive = false; controller.abort(); });
    }
    function tutorial() {
        const details = el('details', undefined, 'um-tutorial'); details.append(el('summary', '连接教程'));
        details.append(el('p', '公共源：在上方开启 GD 音乐台后，到搜索页选择“公共源”。个人学习使用，无需部署、登录或填写服务地址；当前接入网易云。搜索结果不保证可播放，遇到限流请稍后再试。'));
        details.append(el('p', '本地音乐可以直接使用。账号源的网易云和 QQ 音乐需要你自己的音乐服务；GitHub Pages 只运行界面。以下步骤仅用于账号源。'));
        details.append(el('p', '1. 在支持 Node.js 22 的电脑或服务器中，进入 UvU 仓库目录，执行：'));
        const code = el('pre'); code.append(el('code', 'node services/music-gateway/setup.mjs\nnode services/music-gateway/start.mjs')); details.append(code);
        details.append(el('p', '2. 复制 services/music-gateway/.env.example 为同目录的 .env，填好允许访问的 UvU 网页来源。用下面命令启动；线上使用还需要配置 HTTPS。'));
        const envCode = el('pre'); envCode.append(el('code', 'node --env-file=services/music-gateway/.env services/music-gateway/start.mjs')); details.append(envCode);
        details.append(el('p', '网页和服务在同一台电脑时，可用 http://127.0.0.1:8787 测试。手机上的 127.0.0.1 指手机自身；连接电脑服务请使用配置好的 HTTPS 地址。'));
        details.append(el('p', '3. 把服务地址填入上方，保存并连接。选择网易云或 QQ 音乐，用对应官方 App 扫码确认；同一手机可保存二维码后使用官方 App 的相册识别（是否支持以平台为准）。'));
        details.append(el('p', '4. 在搜索中选择来源，或打开账号歌单。一次搜索最多显示 500 首，可细化关键词。歌曲菜单可收藏、分享、邀请一起听；分享前可读取和删改歌词片段。char 根据歌名、歌手与所附歌词回应。'));
        details.append(el('p', '登录状态保留在音乐服务中。默认会话有效期 24 小时，重启服务后需重新登录。“记住此设备”需要服务配置加密存储，新会话可保留 7 天；已有会话改选项只影响浏览器保存，服务有效期不延长。平台会员、地区、试听与版权限制仍然适用。备份包含歌单资料，不包含账号凭据或本地音频。一起听是与 char 的聊天互动，不代表另一台设备同步播放；后台播放与锁屏控制取决于系统和浏览器。'));
        return details;
    }
    function publicCredit() {
        const line = el('p', undefined, 'um-muted um-public-credit'), link = el('a', 'GD 音乐台');
        link.href = 'https://music.gdstudio.xyz/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
        line.append(document.createTextNode('来源：'), link); return line;
    }
    function accountsPanel() {
        const controller = new AbortController(); let alive = true;
        modal('音乐账号', body => {
            const publicBox = section('公共音乐'), publicLabel = el('label', undefined, 'um-check um-public-toggle'), publicCheck = el('input');
            publicCheck.type = 'checkbox'; publicCheck.checked = M.settings().publicSources.includes('gd-netease'); publicCheck.setAttribute('aria-label', '启用 GD 音乐台公共源');
            publicLabel.append(publicCheck, document.createTextNode('GD 音乐台 · 网易云'));
            const publicStatus = el('p', '个人学习、非商业使用；每 5 分钟最多 50 次请求。', 'um-muted'); publicStatus.setAttribute('aria-live','polite');
            publicBox.append(publicLabel, publicStatus, publicCredit()); body.append(publicBox);
            publicCheck.onchange = async () => {
                const wanted = publicCheck.checked; publicCheck.disabled = true;
                try {
                    await M.saveSettings({ publicSources: wanted ? ['gd-netease'] : [] });
                    clearTimeout(debounce); searchController?.abort(); ++searchSequence; searchLoading = false; results = []; hasMore = false; searchError = '';
                    if (wanted) provider = 'gd-netease'; else if (provider === 'gd-netease') provider = 'all';
                    if (tab === 'search') render();
                    if (alive) publicStatus.textContent = wanted ? '已开启。到搜索页选择“公共源”即可使用。' : '已关闭';
                } catch (error) { if (alive) { publicCheck.checked = !wanted; publicStatus.textContent = error.message; } }
                finally { publicCheck.disabled = false; }
            };
            const form = el('form', undefined, 'um-account-form'), label = el('label', '音乐服务地址'), input = el('input'); input.type = 'url'; input.placeholder = 'https://music.example.com'; input.value = M.settings().endpoint; label.append(input);
            const remember = el('label', undefined, 'um-check'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = M.settings().remember; remember.append(checkbox, document.createTextNode('记住此设备'));
            const output = el('p', '', 'um-muted'); output.setAttribute('aria-live', 'polite'); const accounts = el('div', undefined, 'um-accounts');
            form.append(el('h2','账号音乐'), label, remember, button('保存并连接', () => connect()), output); form.onsubmit = e => { e.preventDefault(); void connect(); }; body.append(form, accounts, tutorial());
            async function refresh() {
                const data = await M.accounts(controller.signal); if (!alive) return; accounts.replaceChildren();
                for (const p of ['netease', 'qq']) {
                    const account = data.accounts.find(a => a.provider === p), row = el('div', undefined, 'um-account'), copy = el('div'); copy.append(el('strong', names[p]), el('small', account?.loggedIn ? account.user?.name || '已登录' : '未登录')); row.append(copy);
                    if (account?.loggedIn) row.append(button('歌单', () => cloudPlaylists(p)), button('退出', async () => { await M.logout(p); if (alive) await refresh(); }, 'log-out'));
                    else row.append(button('扫码登录', () => qrPanel(p))); accounts.append(row);
                }
            }
            async function connect() {
                output.textContent = '正在连接…';
                try { await M.saveSettings({ endpoint: input.value.trim(), remember: checkbox.checked }); const health = await M.connect(controller.signal); if (!alive) return; if (!health.ok || health.ready === false) throw new Error('服务已连接，平台引擎尚未安装，请执行教程中的 setup 命令'); await refresh(); output.textContent = '已连接'; }
                catch (e) { if (alive) output.textContent = e.message; }
            }
            if (input.value) void refresh().catch(e => { if (alive) output.textContent = e.message; });
        }, () => { alive = false; controller.abort(); });
    }
    function qrPanel(p) {
        let alive = true, timer; const controller = new AbortController();
        modal(names[p] + ' · 扫码登录', body => {
            const area = el('div', undefined, 'um-qr'), status = el('p', '正在获取二维码…'); status.setAttribute('aria-live', 'polite'); body.append(area, status);
            void (async () => {
                try {
                    const qr = await M.createQR(p, controller.signal); if (!alive) return;
                    if (/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(qr.image || '') && qr.image.length < 600000) { const image = el('img'); image.src = qr.image; image.alt = names[p] + ' 登录二维码'; area.append(image); }
                    else if (qr.url && root.qrcode) { const value = new URL(qr.url); const allowed = p === 'netease' ? ['music.163.com'] : ['y.qq.com', 'ssl.ptlogin2.qq.com', 'xui.ptlogin2.qq.com']; if (value.protocol !== 'https:' || !allowed.includes(value.hostname) || qr.url.length > 2000) throw new Error('登录二维码地址无效'); const code = root.qrcode(0, 'M'); code.addData(qr.url); code.make(); area.innerHTML = code.createSvgTag({ cellSize: 4, margin: 4, scalable: true }); }
                    else throw new Error('服务没有返回有效二维码');
                    status.textContent = '请用' + names[p] + '官方 App 扫码确认';
                    const poll = async () => {
                        if (!alive) return;
                        if (Date.now() >= qr.expiresAt) { status.textContent = '二维码已过期，请重新获取'; body.append(button('重新获取', () => qrPanel(p))); return; }
                        try {
                            const data = await M.pollQR(p, qr.id, controller.signal); if (!alive) return;
                            if (data.status === 'authorized') { toast('登录成功'); accountsPanel(); return; }
                            if (data.status === 'expired') { status.textContent = '二维码已过期'; body.append(button('重新获取', () => qrPanel(p))); return; }
                            status.textContent = data.status === 'scanned' ? '已扫码，请在官方 App 确认' : '等待扫码确认'; timer = setTimeout(poll, 2500);
                        } catch (e) { if (alive) status.textContent = e.message; }
                    }; timer = setTimeout(poll, 2000);
                } catch (e) { if (alive) status.textContent = e.message; }
            })();
        }, () => { alive = false; clearTimeout(timer); controller.abort(); });
    }
    function cloudPlaylists(p) {
        const controller = new AbortController(); let alive = true;
        modal(names[p] + ' · 我的歌单', body => { const status = el('p', '正在读取…', 'um-muted'); body.append(status); void M.playlists(p, controller.signal).then(data => { if (!alive) return; status.textContent = data.playlists.length ? '' : '暂无歌单'; data.playlists.forEach(item => body.append(button(item.name, () => openPlaylist(item, p), undefined, 'um-wide'))); }).catch(e => { if (alive) status.textContent = e.message; }); }, () => { alive = false; controller.abort(); });
    }
    function open(target) { shareTarget = target || null; if (typeof switchScreen === 'function') switchScreen('uvu-music-screen'); else { document.querySelectorAll('.screen.active').forEach(n => n.classList.remove('active')); screen.classList.add('active'); } render(); }
    function mount() {
        if (screen) return; screen = el('div', undefined, 'screen'); screen.id = 'uvu-music-screen';
        const header = el('header', undefined, 'um-header'); header.append(button('返回', () => { if (shareTarget && typeof isChatSendTargetValid === 'function' && isChatSendTargetValid(shareTarget) && typeof openChatRoom === 'function') openChatRoom(shareTarget.chatId, 'private'); else if (typeof switchScreen === 'function') switchScreen('home-screen'); }, 'chevron-left'), el('strong', '音乐'), button('音乐账号与设置', accountsPanel, 'user-round'));
        main = el('main', undefined, 'um-main'); mini = el('div', undefined, 'um-mini'); mini.hidden = true;
        const nav = el('nav', undefined, 'um-nav'); nav.setAttribute('aria-label', '音乐导航');
        for (const [id, title, image] of [['home', '首页', 'house'], ['search', '搜索', 'search'], ['library', '资料库', 'library']]) { const b = button(title, () => { clearTimeout(debounce); tab = id; main.scrollTop = 0; render(); if (id === 'search' && query && !results.length && !searchLoading) void runSearch(true); }, image); b.dataset.umTab = id; b.append(el('span', title)); nav.append(b); }
        const file = el('input'); file.id = 'um-local-files'; file.type = 'file'; file.accept = 'audio/*'; file.multiple = true; file.hidden = true; file.onchange = async () => { const files = [...file.files]; file.value = ''; await importFiles(files); };
        screen.append(header, main, mini, nav, file); (document.querySelector('.phone-screen') || document.body).append(screen);
        M.player.subscribe(updateMini); root.addEventListener('music-state', event => {
            const state = event.detail, signature = (state?.track ? M.key(state.track) : '') + ':' + Boolean(state?.playing), changed = signature !== playbackSignature; playbackSignature = signature;
            if (screen.classList.contains('active') && tab !== 'search' && (renderedLibrary !== librarySource() || tab === 'home' && changed)) render();
        });
        root.addEventListener('music-chat-state', () => { if (screen.classList.contains('active') && tab === 'home') render(); });
        document.addEventListener('click', event => { if (event.target.closest?.('#share-music-btn')) { event.preventDefault(); const target = typeof captureChatSendTarget === 'function' ? captureChatSendTarget() : null; open(target?.type === 'private' ? target : null); } if (event.target.closest?.('[data-target="uvu-music-screen"]')) { shareTarget = null; render(); } });
        render();
    }
    root.UvUMusicUI = { open, nowPlaying, accounts: accountsPanel, close: closeSheet, mount };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(window);
