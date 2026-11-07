(function (root) {
    'use strict';
    const M = root.UvUMusic, C = root.UvUMusicCatalog, names = { netease: '网易云', qq: 'QQ 音乐', local: '本地', 'gd-netease': 'GD · 网易云' };
    let screen, main, mini, tab = 'home', sheet, sheetClose, searchController, searchSequence = 0, query = '', provider = '', results = [], searchPage = 1, hasMore = false, searchError = '', debounce, shareTarget, renderedLibrary, searchLoading = false, favoriteLimit = 50, playbackSignature = '';
    const librarySource = () => typeof db !== 'undefined' ? db.musicLibrary : root.db?.musicLibrary;
    const tabScroll={home:0,discover:0,radio:0,library:0,search:0};
    let libraryPage = '', appearance = 'light';
    try { appearance = localStorage.getItem('uvu-music-appearance') === 'dark' ? 'dark' : 'light'; } catch (_) {}
    function selectTab(id){tabScroll[tab]=main.scrollTop;tab=id;libraryPage='';render(tabScroll[id]||0);}
    function applyAppearance(){screen?.classList.toggle('um-dark',appearance==='dark');sheet?.classList.toggle('um-dark',appearance==='dark');}
    function returnToPhone(){closeSheet();if(shareTarget&&typeof isChatSendTargetValid==='function'&&isChatSendTargetValid(shareTarget)&&typeof openChatRoom==='function')openChatRoom(shareTarget.chatId,'private');else if(typeof switchScreen==='function')switchScreen('home-screen');}
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
            const info = el('span', undefined, 'um-track-info'); info.append(el('strong', track.title), el('small', track.artists.join(' / ') || '未知歌手'));
            play.append(cover(track), info); play.onclick = () => { void M.player.play(track, tracks, {label:options.label || (options.playlistId?'歌单':tab==='search'?'搜索结果':'喜欢的歌')}).catch(toast); };
            row.append(play, button('更多 · ' + track.title, () => trackMenu(track, options), 'ellipsis')); parent.append(row);
        });
    }
    function modal(title, render, onClose) {
        closeSheet();
        const previousFocus = document.activeElement, overlay = el('div', undefined, 'uvu-music-sheet'), card = el('div', undefined, 'um-sheet-card'), head = el('header', undefined, 'um-sheet-head');
        overlay.classList.toggle('um-dark',appearance==='dark');overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', title); card.tabIndex = -1;
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
            if (track.provider !== 'local') body.append(button('读取歌词', async () => { status.textContent = '正在读取…'; try { const data = await M.lyrics(track, controller.signal); if (alive) { lyrics.value = root.UvUMusicLyrics.format(data.lyric).slice(0, 2000); status.textContent = lyrics.value ? '可删改后发送' : '暂无歌词'; } } catch (e) { if (alive) status.textContent = e.message; } }));
            body.append(lyrics, status, button(invite ? '发送邀请' : '发送', async () => {
                const sent = await root.UvUMusicChat.share(track, { invite, lyrics: lyrics.value.trim(), ...(capturedTarget ? { target: capturedTarget } : {}) });
                if (sent && alive) { closeSheet(); toast(invite ? '已发送一起听邀请' : '已分享音乐'); if (capturedTarget && typeof isChatSendTargetValid === 'function' && isChatSendTargetValid(capturedTarget) && typeof openChatRoom === 'function') openChatRoom(capturedTarget.chatId, 'private'); }
            }, undefined, 'um-primary'));
        }, () => { alive = false; controller.abort(); });
    }
    function trackMenu(track, options = {}, target) {
        if(target)shareTarget=target;
        modal(track.title, body => {
            body.append(button('播放下一首', () => { M.player.enqueue(track, true); closeSheet(); }, undefined, 'um-wide'),
                button(M.library().favorites.some(t => M.key(t) === M.key(track)) ? '取消喜欢' : '加入喜欢', async () => { await M.toggleFavorite(track); closeSheet(); render(); }, undefined, 'um-wide'),
                button('加入歌单', () => choosePlaylist(track), undefined, 'um-wide'),
                button('分享给角色', async () => { closeSheet(); await share(track); }, undefined, 'um-wide'),
                button('邀请一起听', async () => { closeSheet(); await share(track, true); }, undefined, 'um-wide'));
            if (options.playlistId) body.append(button('从歌单移除', async () => { await M.removeFromPlaylist(options.playlistId, M.key(track)); closeSheet(); render(); }, undefined, 'um-wide'));
            if (track.provider === 'local') body.append(button('编辑歌曲资料',()=>editLocal(track),undefined,'um-wide'),button('删除本地音乐', async () => {
                const confirmed = typeof showConfirm === 'function' ? await showConfirm('删除本地音乐', '同时移出本机资料库、歌单和队列。聊天中已分享的歌曲卡片仍会保留。') : root.confirm('删除这首本地音乐？');
                if (!confirmed) return; await M.deleteLocal(track); closeSheet(); render();
            }, undefined, 'um-wide'));
            if (track.pageUrl) { const a = el('a', '在来源平台查看', 'um-link'); a.href = track.pageUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a); }
        });
    }
    function editLocal(track){
        modal('歌曲资料',body=>{const fields={};for(const [name,label,value]of [['title','歌名',track.title],['artists','歌手',track.artists.join(' / ')],['album','专辑',track.album],['cover','封面链接',track.cover]]){const field=el('label',label,'um-muted'),input=el('input');input.value=value||'';input.setAttribute('aria-label',label);field.append(input);body.append(field);fields[name]=input;}
            body.append(button('保存',async()=>{await M.updateLocal(track,{title:fields.title.value,artists:fields.artists.value.split(/\s*\/\s*/).filter(Boolean),album:fields.album.value,cover:fields.cover.value});closeSheet();render();},undefined,'um-primary'));
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
    function importPlaylistPanel(reference) {
        const controller = new AbortController(); let alive = true, draft, visible = 50, reading = false;
        modal('导入歌单', (body, overlay) => {
            overlay.classList.add('um-import-sheet');
            const form = el('form', undefined, 'um-import-form'), source = el('select'), input = el('input');
            source.setAttribute('aria-label', '音乐平台');
            for (const [value, label] of [['', '自动识别'], ['netease', '网易云'], ['qq', 'QQ 音乐']]) { const option = el('option', label); option.value = value; source.append(option); }
            source.value = reference?.provider || ''; input.type = 'text'; input.maxLength = 4096; input.placeholder = '粘贴歌单链接或 ID'; input.setAttribute('aria-label', '歌单链接'); input.autocomplete = 'off'; input.spellcheck = false;
            if (reference) input.value = reference.id;
            const fields = el('div', undefined, 'um-import-source'); fields.append(source, input);
            const status = el('p', '', 'um-muted um-import-status'); status.setAttribute('role', 'status');
            const preview = el('div', undefined, 'um-import-preview'), name = el('input'); name.setAttribute('aria-label', '歌单名称'); name.placeholder = '歌单名称'; name.maxLength = 160; name.hidden = true;
            const save = button('保存歌单', async () => {
                if (!draft || reading) return;
                const saved = await M.importPlaylist({ ...draft, name: name.value }, controller.signal);
                if (!alive) return;
                closeSheet(); tab = 'library'; libraryPage = '播放列表'; render(0); toast('已导入 ' + saved.tracks.length + ' 首');
            }, undefined, 'um-primary'); save.disabled = true;
            const draw = () => {
                preview.replaceChildren();
                for (const track of draft.tracks.slice(0, visible)) {
                    const row = el('div', undefined, 'um-track'), info = el('div', undefined, 'um-track-info');
                    info.append(el('strong', track.title), el('small', track.artists.join(' / ') || '未知歌手')); row.append(cover(track), info); preview.append(row);
                }
                if (draft.tracks.length > visible) preview.append(button('查看更多', () => { visible += 50; draw(); }));
            };
            const reset = () => { draft = undefined; save.disabled = true; name.hidden = true; preview.replaceChildren(); status.textContent = ''; };
            input.oninput = source.onchange = reset;
            const read = async () => {
                if (reading) return; reset(); reading = true; input.disabled = source.disabled = true; status.textContent = '正在读取歌单…';
                try {
                    const result = await M.previewPlaylist(input.value, source.value, controller.signal, count => { if (alive) status.textContent = '已读取 ' + count + ' 首…'; });
                    if (!alive) return; draft = result; visible = 50; source.value = result.provider;
                    name.value = reference?.name || draft.name; name.hidden = false; save.disabled = false;
                    status.textContent = draft.tracks.length + ' 首' + (draft.truncated ? ' · 仅导入前 1000 首' : ''); draw();
                } catch (error) { if (alive) status.textContent = error.message; }
                finally { reading = false; input.disabled = source.disabled = false; }
            };
            const readButton = button('预览歌单', read); form.append(fields, readButton); form.onsubmit = event => { event.preventDefault(); void read(); };
            const actions = el('div', undefined, 'um-actions'); actions.append(save);
            body.append(form, status, name, preview, actions);
            if (!M.settings().endpoint) body.append(el('p', '读取平台歌单需要连接音乐网关；私密歌单可能需要登录。', 'um-muted'), button('连接音乐服务', accountsPanel));
            if (reference) void read();
        }, () => { alive = false; controller.abort(); });
    }
    function openPlaylist(item, cloudProvider) {
        let page = 1, tracks = [], pending = false, alive = true, editing=false, unsubscribe;
        const selected=new Set(), controller = new AbortController(), managed=!cloudProvider&&!item.kind;
        modal(item.name, (body, overlay) => {
            overlay.classList.add('um-collection-sheet');
            const head=overlay.querySelector('.um-sheet-head');head.querySelector('h2').textContent='';head.querySelector('button img').src='assets/music/icons/chevron-left.svg';
            const top=el('div',undefined,'um-collection-top');top.append(button('添加歌曲',()=>{closeSheet();selectTab('search');},'plus'),button('歌单选项',()=>{if(managed){editing=!editing;draw();}else queuePanel();},'ellipsis'));head.append(top);
            const hero=el('div',undefined,'um-collection-art');
            if(item.kind==='favorites')hero.append(icon('star-solid'));else hero.append(cover(item.tracks?.[0]||{cover:item.cover}));
            const heading=el('div',undefined,'um-collection-name'),count=el('small');heading.append(el('h1',item.name),count);
            const tools=el('div',undefined,'um-playlist-tools'),list = el('div',undefined,'um-playlist-songs'), footer = el('div', undefined, 'um-actions'); body.append(hero,heading,tools,list,footer);
            const dock=el('div',undefined,'um-bottom um-compact-bottom'),dockMini=el('div',undefined,'um-mini');
            dock.append(button('回到主页',()=>{closeSheet();selectTab('home');},'house'),dockMini,button('前往搜索',()=>{closeSheet();selectTab('search');},'search'));overlay.querySelector('.um-sheet-card').append(dock);
            unsubscribe=M.player.subscribe(state=>paintMini(dockMini,state));
            const draw=()=>{tools.replaceChildren();list.replaceChildren();
                count.textContent=tracks.length+' 首歌曲';footer.classList.toggle('um-editing',editing);
                const play=button('播放全部',()=>tracks.length&&M.player.play(tracks[0],tracks,{label:item.name}),undefined,'um-play-pill');play.replaceChildren(icon('play-solid'),el('span','播放'));
                const shuffle=button('随机播放',()=>{if(!tracks.length)return;M.player.setMode('shuffle');return M.player.play(tracks[Math.floor(Math.random()*tracks.length)],tracks,{label:item.name});},'shuffle');play.disabled=shuffle.disabled=!tracks.length;
                tools.append(shuffle,play,button(managed?(editing?'完成':'管理'):'播放队列',()=>{if(managed){editing=!editing;draw();}else queuePanel();},managed?'list-filter':'list-music'));
                if(managed&&editing){const manage=el('div',undefined,'um-manage-tools');manage.append(button('全选',()=>{tracks.forEach(t=>selected.add(M.key(t)));draw();}),button('移除所选',async()=>{await M.removePlaylistTracks(item.id,[...selected]);selected.clear();tracks=M.library().playlists.find(p=>p.id===item.id)?.tracks||[];draw();render();}));list.append(manage);}
                if(managed&&editing){tracks.forEach((track,index)=>{const row=el('div',undefined,'um-queue-row'),check=el('input');check.type='checkbox';check.checked=selected.has(M.key(track));check.setAttribute('aria-label','选择 '+track.title);check.onchange=()=>check.checked?selected.add(M.key(track)):selected.delete(M.key(track));const title=el('span',track.title,'um-track-info');const up=button('上移 '+track.title,async()=>{await M.reorderPlaylist(item.id,index,index-1);tracks=M.library().playlists.find(p=>p.id===item.id)?.tracks||[];draw();},'chevron-left');up.style.transform='rotate(90deg)';up.disabled=index===0;row.append(check,title,up);list.append(row);});}
                else trackRows(list,tracks,{...(managed?{playlistId:item.id}:{}),label:item.name});if(!tracks.length)empty(list,'还没有歌曲',button('搜索音乐',()=>{closeSheet();selectTab('search');}));
            };
            const load = async () => {
                if (pending) return; pending = true;
                try {
                    const data = cloudProvider ? await M.playlist(cloudProvider, item.id, page, controller.signal) : { tracks: item.kind?item.tracks||[]:M.library().playlists.find(p=>p.id===item.id)?.tracks || [], hasMore: false };
                    if (!alive) return;const keys=new Set(tracks.map(M.key));tracks.push(...data.tracks.filter(t=>!keys.has(M.key(t))));draw();footer.replaceChildren();
                    if (data.hasMore) footer.append(button('加载更多', async () => { page++; await load(); }));
                    if (cloudProvider) footer.append(button('导入到资料库', () => importPlaylistPanel({ provider: cloudProvider, id: item.id, name: item.name })));
                    if (managed) footer.append(button('重命名',()=>modal('歌单名称',box=>{const input=el('input');input.value=item.name;input.maxLength=160;input.setAttribute('aria-label','歌单名称');box.append(input,button('保存',async()=>{await M.renamePlaylist(item.id,input.value);closeSheet();render();}));})),button('删除歌单', async () => { if (!root.confirm('删除这个歌单？音乐文件会保留。')) return; await M.deletePlaylist(item.id); closeSheet(); render(); }));
                } catch (e) { if (alive) toast(e); } finally { pending = false; }
            }; void load();
        }, () => { alive = false; controller.abort();unsubscribe?.(); });
    }
    async function importFiles(files) {
        let count = 0;
        for (const file of files) { try { await M.importLocal(file); count++; } catch (e) { toast(file.name + '：' + e.message); } }
        if (count) toast('已导入 ' + count + ' 首'); render();
    }
    function importButton() { return button('导入音乐', () => document.getElementById('um-local-files').click(), 'plus'); }
    function artworkShelf(parent, tracks) {
        const shelf = el('div', undefined, 'um-artwork-shelf');
        for (const track of tracks) {
            const card = el('article', undefined, 'um-artwork-card');
            const play = button('播放 ' + track.title, () => M.player.play(track, tracks,{label:'最近播放'}), undefined, 'um-artwork-play');
            play.replaceChildren(cover(track));
            const caption = el('div', undefined, 'um-artwork-caption'), info = el('div', undefined, 'um-track-info');
            info.append(el('strong', track.title), el('small', track.artists.join(' / ') || '未知歌手'));
            caption.append(info, button('更多 · ' + track.title, () => trackMenu(track, {}), 'ellipsis'));
            card.append(play, caption); shelf.append(card);
        }
        parent.append(shelf);
    }
    function favoritesCollection() { return { name: '喜爱歌曲', kind: 'favorites', tracks: M.library().favorites }; }
    function collectionSection(title, tracks) {
        const box=section(title),head=box.querySelector('.um-section-head'),link=button(title,()=>openCollection(title,tracks),undefined,'um-section-open');
        link.replaceChildren(head.firstChild,icon('chevron-right'));head.append(link);return box;
    }
    function renderCatalogGrid(parent, items) {
        const grid = el('div', undefined, 'um-playlist-grid');
        for (const item of items) {
            const row = button(item.name, () => openPlaylist(item), undefined, 'um-playlist');
            const artwork = item.kind === 'favorites' ? el('span', undefined, 'um-fave-art') : cover(item.tracks?.[0] || { cover: item.cover });
            if (item.kind === 'favorites') artwork.append(icon('star-solid'));
            row.replaceChildren(artwork, el('strong', item.name), el('small', item.subtitle || ((item.tracks || []).length + ' 首歌曲'))); grid.append(row);
        }
        parent.append(grid);
    }
    function renderFeatureRail(parent, items) {
        const rail = el('div', undefined, 'um-feature-rail');
        for (const item of items) {
            const action = item.play || (() => openPlaylist(item));
            const row = button(item.name, action, undefined, 'um-feature');
            row.replaceChildren(el('span', item.eyebrow || '音乐精选', 'um-eyebrow'), el('strong', item.name, 'um-feature-title'), el('span', item.subtitle || item.tracks?.[0]?.artists?.join(' / ') || '你的音乐', 'um-feature-artist'), cover(item.tracks?.[0] || {})); rail.append(row);
        }
        if (!items.length) { const start = button('搜索音乐', () => selectTab('search'), undefined, 'um-start-card'); start.replaceChildren(icon('music-2'), el('strong', '从喜欢的歌开始'), el('span', '搜索音乐')); rail.append(start); }
        parent.append(rail);
    }
    function openCollection(name, tracks) { openPlaylist({ name, tracks, kind: 'collection' }); }
    function renderLibrary(lib) {
        const tracks = C.saved(lib);
        if (!libraryPage) {
            const links = el('div', undefined, 'um-library-links');
            for (const [name, image] of [['播放列表','list-music'],['艺人','mic-vocal'],['专辑','gallery-vertical-end'],['歌曲','music-2'],['本地音乐','hard-drive-download']]) {
                const b = button(name, () => { libraryPage = name; render(0); }, undefined, 'um-library-link'); b.replaceChildren(icon(image), el('span', name), icon('chevron-right')); links.append(b);
            }
            main.append(links);const added=C.recentAdded(lib); const recent = collectionSection('最近添加',added); renderCatalogGrid(recent, C.albums(added).slice(0, 12).map(x => ({ ...x, kind:'collection', subtitle:x.tracks[0]?.artists?.join(' / ') }))); main.append(recent); return;
        }
        if (libraryPage === '播放列表') { const actions = el('div', undefined, 'um-playlist-import-actions'); actions.append(button('新建歌单', () => createPlaylist()), button('导入歌单', () => importPlaylistPanel())); main.append(actions); const box = section(''); renderCatalogGrid(box, [favoritesCollection(), ...lib.playlists]); main.append(box); return; }
        if (libraryPage === '艺人' || libraryPage === '专辑') { const box = section(''); const groups = libraryPage === '艺人' ? C.artists(tracks) : C.albums(tracks); renderCatalogGrid(box, groups.map(x => ({ ...x, kind:'collection', subtitle:x.tracks.length + ' 首歌曲' }))); if (!tracks.length) empty(box, '资料库为空', importButton()); main.append(box); return; }
        const box = section(''), songs = libraryPage === '本地音乐' ? tracks.filter(t => t.provider === 'local') : tracks; trackRows(box, songs.slice(0, favoriteLimit), { label: libraryPage }); if (songs.length > favoriteLimit) box.append(button('查看全部', () => { favoriteLimit += 50; render(); })); if (!songs.length) empty(box, '还没有歌曲', button('导入音乐', () => document.getElementById('um-local-files').click())); main.append(box);
    }
    function render(scroll) {
        if (!screen) return; renderedLibrary = librarySource(); applyAppearance();
        const previousScroll = scroll === undefined ? main.scrollTop : scroll; main.replaceChildren();
        screen.querySelectorAll('[data-um-tab]').forEach(b => { const selected = b.dataset.umTab === tab; b.classList.toggle('active', selected); b.setAttribute('aria-selected', String(selected)); });
        const hero = el('header', undefined, 'um-hero'), tools = el('div', undefined, 'um-hero-tools');
        const heading = el('h1'), homeTitle = el('button', libraryPage || ({home:'主页',discover:'新发现',radio:'广播',library:'资料库',search:'搜索'}[tab]), 'um-home-title');
        homeTitle.type = 'button'; homeTitle.title = '返回小手机桌面'; homeTitle.onclick = () => { closeSheet(); if (typeof switchScreen === 'function') switchScreen('home-screen'); };
        heading.append(homeTitle); hero.append(heading, tools);
        if (libraryPage) tools.append(button('返回资料库', () => { libraryPage = ''; render(0); }, 'chevron-left'));
        if (tab === 'library' && !libraryPage) tools.append(button('新建歌单', () => createPlaylist(), 'list-plus', 'um-round-fill'));
        tools.append(button('音乐账号与设置', accountsPanel, 'user-round', 'um-avatar')); main.append(hero);
        if (tab === 'search') { renderSearch(); main.scrollTop = previousScroll; return; }
        const lib = M.library(), tracks = C.available(lib);
        if (tab === 'library') renderLibrary(lib);
        else if (tab === 'home') {
            const recent = collectionSection('继续听',lib.recent); renderFeatureRail(recent, lib.recent.slice(0, 6).map(t => ({ name:t.title, tracks:[t], eyebrow:'最近播放', play:() => M.player.play(t, lib.recent, {label:'最近播放'}) }))); main.append(recent);
            const moment = collectionSection('为这一刻',tracks); renderCatalogGrid(moment, [favoritesCollection(), ...lib.playlists.slice(0, 3)]); main.append(moment);
            const history = collectionSection('最近播放',lib.recent); if (lib.recent.length) artworkShelf(history, lib.recent.slice(0, 10)); else empty(history, '还没有播放记录'); main.append(history);
            const invite = root.UvUMusicChat?.session?.(); if (invite) { const together = section('一起听'), character = typeof db !== 'undefined' ? db.characters.find(c => c.id === invite.chatId) : null; together.classList.add('um-together-summary'); together.append(el('p', '与' + (character?.remarkName || character?.realName || '角色') + '一起听 · ' + invite.track.title + (invite.localPlayback ? '' : ' · 已暂停')), button('结束一起听', async () => { await root.UvUMusicChat.end(); render(); }, 'x')); main.append(together); }
        } else if (tab === 'discover') {
            renderFeatureRail(main, [...lib.playlists.filter(p => p.tracks.length).slice(0, 4), ...(lib.favorites.length ? [favoritesCollection()] : [])].map(x => ({...x, eyebrow:'你的精选'})));
            const picks = collectionSection('音乐精选',tracks), pages = el('div', undefined, 'um-song-pages'); for (let i = 0; i < Math.min(tracks.length, 16); i += 4) { const page = el('div', undefined, 'um-song-page'); trackRows(page, tracks.slice(i, i + 4), {label:'音乐精选'}); pages.append(page); } if (!tracks.length) empty(picks, '收藏音乐后，在这里发现更多', button('搜索音乐', () => selectTab('search'))); else picks.append(pages); main.append(picks);
            const albums = collectionSection('此刻想听',tracks); renderCatalogGrid(albums, C.albums(tracks).slice(0, 6).map(x => ({...x, kind:'collection', subtitle:x.tracks[0]?.artists?.join(' / ')}))); main.append(albums);
        } else if (tab === 'radio') {
            const channels = [...(tracks.length ? [{name:'你的音乐电台', tracks}] : []), ...C.artists(tracks).slice(0, 8).map(x => ({...x, name:x.name + '电台'}))];
            const start = item => { M.player.setMode('shuffle'); return M.player.play(item.tracks[Math.floor(Math.random() * item.tracks.length)], item.tracks, {label:item.name}); };
            renderFeatureRail(main, channels.slice(0, 3).map(x => ({...x, eyebrow:'随机音乐', subtitle:x.tracks.length + ' 首歌曲', play:() => start(x)})));
            const list = section('音乐电台'); list.classList.add('um-radio-list'); for (const channel of channels) { const row = el('div', undefined, 'um-track'), play = button(channel.name, () => start(channel), undefined, 'um-track-main'); play.replaceChildren(cover(channel.tracks[0]), el('strong', channel.name, 'um-track-info')); row.append(play, button('查看 ' + channel.name, () => openCollection(channel.name, channel.tracks), 'ellipsis')); list.append(row); } if (!channels.length) empty(list, '先导入或收藏歌曲'); main.append(list);
        }
        main.scrollTop = previousScroll;
    }
    function renderSearch() {
        if (!provider) provider = M.settings().endpoint ? 'all' : 'gd-netease';
        const form = el('form', undefined, 'um-search'), input = el('input'); input.type = 'search'; input.placeholder = '艺人、歌曲、专辑'; input.setAttribute('aria-label', '搜索音乐'); input.value = query;
        const submit = button('搜索', () => runSearch(true), 'search'); form.append(submit,input); form.onsubmit = e => { e.preventDefault(); query = input.value.trim(); void runSearch(true); };
        input.oninput = () => { query = input.value.trim(); clearTimeout(debounce); searchController?.abort(); ++searchSequence; searchLoading = false; searchError = ''; results = []; hasMore = false; renderSearchResults(); debounce = setTimeout(() => void runSearch(true), provider === 'gd-netease' ? 900 : 450); };
        const sources = el('div', undefined, 'um-sources');
        const credit = publicCredit(); credit.hidden = provider !== 'gd-netease';
        for (const [id, label] of [['gd-netease', '公共源'], ['all', '全部'], ['netease', '网易云'], ['qq', 'QQ 音乐']]) { const b = button(label, () => { query = input.value.trim(); provider = id; credit.hidden = id !== 'gd-netease'; for (const child of sources.children) { const active = child === b; child.classList.toggle('active', active); child.setAttribute('aria-pressed', String(active)); } void runSearch(true); }); b.classList.toggle('active', id === provider); b.setAttribute('aria-pressed', String(id === provider)); sources.append(b); }
        main.append(form, sources, credit, el('p', searchError, 'um-muted um-search-status'));
        if(!query&&M.library().searches?.length){const history=el('div',undefined,'um-search-recents');for(const q of M.library().searches)history.append(button(q,()=>{query=q;input.value=q;history.remove();return runSearch(true);}));history.append(button('清空搜索记录',async()=>{await M.clearSearches();history.remove();},'x'));main.append(history);}
        const browse=el('div',undefined,'um-browse');browse.append(section('浏览分类'));const grid=el('div',undefined,'um-category-grid');
        for(const label of ['华语流行','轻声慢听','独立音乐','晚间时光'])grid.append(button(label,()=>{query=label;input.value=label;return runSearch(true);},undefined,'um-category'));browse.append(grid);main.append(browse);
        main.append(el('div', undefined, 'um-search-results'), el('div', undefined, 'um-search-more')); renderSearchResults();
    }
    function renderSearchResults() {
        if (tab !== 'search') return;
        const list = main.querySelector('.um-search-results'); if (!list) return;
        main.querySelector('.um-search-status').textContent = searchError; list.replaceChildren(); trackRows(list, results);
        main.querySelector('.um-browse').hidden=!!query;
        if (provider === 'gd-netease' && !M.settings().publicSources.includes('gd-netease')) empty(list, '开启公共源后即可搜索', button('开启公共源', accountsPanel));
        else if (query && !results.length && !searchError) empty(list, '没有找到歌曲');
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
            if(reset&&data.tracks.length)void M.rememberSearch(query).catch(()=>{});
        } catch (e) { if (seq !== searchSequence || e.name === 'AbortError') return; searchError = e.message; }
        if (seq !== searchSequence) return; searchLoading = false;
        renderSearchResults();
    }
    function updateMini(state) { if(mini)paintMini(mini,state); }
    function paintMini(mini,state) {
        mini.hidden = !state.track;
        if (!state.track) { mini.replaceChildren(); delete mini.dataset.key; return; }
        const track = state.track;
        if (mini.dataset.key !== M.key(track)) {
            mini.dataset.key = M.key(track); mini.replaceChildren(); const open = el('button', undefined, 'um-mini-open'); open.type = 'button'; open.setAttribute('aria-label', '展开播放器');
            const info = el('span', undefined, 'um-track-info'); info.append(el('strong', track.title), el('small', track.artists.join(' / ') || names[track.provider])); open.append(cover(track), info); open.onclick = nowPlaying;
            mini.append(open, button('播放或暂停', () => M.player.toggle(), 'play-solid'), button('下一首', () => M.player.next(), 'fast-forward-solid'), el('span', undefined, 'um-mini-progress'));
        }
        mini.querySelector('.um-track-info strong').textContent=track.title;mini.querySelector('.um-track-info small').textContent=track.artists.join(' / ')||names[track.provider];
        const artwork=mini.querySelector('.um-cover'),coverURL=track.cover||'';if(artwork.dataset.cover!==coverURL){artwork.dataset.cover=coverURL;artwork.src=coverURL||'assets/music/icons/music-2.svg';}
        const toggle = mini.querySelector('[aria-label="播放或暂停"] img'); toggle.src = 'assets/music/icons/' + (state.playing ? 'pause-solid' : 'play-solid') + '.svg';
        mini.querySelector('.um-mini-progress').style.width = Math.max(0, Math.min(100, state.duration ? state.position / state.duration * 100 : 0)) + '%';
    }
    function nowPlaying() {
        if (document.getElementById('chat-room-screen')?.classList.contains('active') && typeof captureChatSendTarget === 'function') { const target = captureChatSendTarget(); if (target?.type === 'private') shareTarget = target; }
        let unsubscribe;
        modal('正在播放', body => {
            body.classList.add('um-now-playing'); body.closest('.uvu-music-sheet').classList.add('um-player-sheet');
            const head=body.closest('.um-sheet-card').querySelector('.um-sheet-head');head.querySelector('button img').src='assets/music/icons/chevron-down.svg';head.prepend(head.querySelector('button'));head.append(button('更多播放选项',playerOptions,'ellipsis'));
            const artwork = cover(null, 'um-artwork'), title = el('h2'), artist = el('p', undefined, 'um-muted'), status = el('p', undefined, 'um-player-status'), slider = el('input'), timing = el('div', undefined, 'um-timing');
            const elapsed = el('span'), remaining = el('span'); timing.append(elapsed, remaining);
            slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = .1; slider.setAttribute('aria-label', '播放进度'); slider.onchange = () => M.player.seek(Number(slider.value));
            const controls = el('div', undefined, 'um-player-controls'), previous = button('上一首', () => M.player.previous(), 'rewind-solid'), toggle = button('播放或暂停', () => M.player.toggle(), 'play-solid', 'um-primary'), next = button('下一首', () => M.player.next(), 'fast-forward-solid'); controls.append(previous, toggle, next);
            const tools = el('div', undefined, 'um-player-tools');
            const like=button('喜欢', async () => { const t = M.player.snapshot().track; if (t) { await M.toggleFavorite(t); like.classList.toggle('active',M.library().favorites.some(x=>M.key(x)===M.key(t)));toast('已更新喜欢的歌'); } }, 'star');
            tools.append(button('歌词', lyricsPanel, 'quote'),button('一起听', async () => { const t = M.player.snapshot().track; if (t) { closeSheet(); await share(t, true); } }, 'headphones'),button('播放队列', queuePanel, 'list-music'));
            const titleRow=el('div',undefined,'um-player-title'),info=el('div',undefined,'um-track-info');info.append(title,artist);titleRow.append(info,like);
            const volume=el('div',undefined,'um-volume'),level=el('input');level.type='range';level.min=0;level.max=1;level.step=.01;level.setAttribute('aria-label','音量');level.oninput=()=>M.player.setVolume(Number(level.value));volume.append(icon('volume-1'),level,icon('volume-2'));
            body.append(artwork,titleRow,status,slider,timing,controls,volume,tools);
            unsubscribe = M.player.subscribe(state => {
                const t = state.track; if (t) { artwork.src = t.cover || 'assets/music/icons/music-2.svg'; title.textContent = t.title; artist.textContent = t.artists.join(' / '); }
                slider.max = state.duration || 1; if (document.activeElement !== slider) slider.value = state.position; elapsed.textContent = clock(state.position); remaining.textContent = '−' + clock(Math.max(0, state.duration - state.position));
                toggle.firstChild.src = 'assets/music/icons/' + (state.playing ? 'pause-solid' : 'play-solid') + '.svg';
                status.textContent = state.error || (state.phase === 'loading' ? '正在加载…' : t?.availability === 'preview' ? '平台试听' : state.sleepAt ? '定时关闭 · ' + new Date(state.sleepAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
                if(document.activeElement!==level)level.value=state.volume;like.classList.toggle('active',!!t&&M.library().favorites.some(x=>M.key(x)===M.key(t)));like.setAttribute('aria-pressed',String(like.classList.contains('active')));
            });
        }, () => unsubscribe?.());
    }
    const modeNames={order:'顺序播放',list:'列表循环',one:'单曲循环',shuffle:'随机播放'};
    function playerOptions(){modal('播放选项',body=>{body.append(button(modeNames[M.player.snapshot().mode],modePanel,'repeat'),button('定时关闭',sleepPanel,'moon'),button('分享',()=>{const t=M.player.snapshot().track;if(t)share(t);},'share-2'));const t=M.player.snapshot().track;if(t)body.append(button('歌曲菜单',()=>trackMenu(t),'ellipsis'));if(M.player.snapshot().phase==='error'||M.player.snapshot().phase==='blocked')body.append(button('重试播放',()=>M.player.retry()));});}
    function modePanel(){modal('播放模式',body=>{for(const [value,label]of Object.entries(modeNames)){const b=button(label,()=>{M.player.setMode(value);nowPlaying();},undefined,'um-wide um-mode-choice');b.setAttribute('aria-pressed',String(M.player.snapshot().mode===value));body.append(b);}const label=el('label',undefined,'um-check um-public-toggle'),check=el('input');check.type='checkbox';check.checked=M.player.snapshot().skipUnavailable;check.onchange=()=>M.player.setSkipUnavailable(check.checked);label.append(check,document.createTextNode('跳过不可播放歌曲'));body.append(label);});}
    function queuePanel() {
        let unsubscribe,last='';modal('播放队列',body=>{
            const tools=el('div',undefined,'um-queue-tools'),list=el('div');tools.append(button('播放模式',modePanel,undefined),button('清空队列',()=>{M.player.clear();},undefined));body.append(tools,list);
            unsubscribe=M.player.subscribe(state=>{const signature=JSON.stringify([state.queue.map(M.key),state.track&&M.key(state.track),state.playing]);if(signature===last)return;last=signature;list.replaceChildren();
                if(state.queueLabel)list.append(el('p',state.queueLabel,'um-muted'));
                state.queue.forEach((track,index)=>{const row=el('div',undefined,'um-queue-row'),current=state.track&&M.key(track)===M.key(state.track);row.classList.toggle('current',!!current);
                    const play=button((current?'正在播放 · ':'')+track.title,()=>M.player.play(track),undefined,'um-queue-title');
                    const up=button('上移 '+track.title,()=>M.player.move(index,index-1),'chevron-left');up.style.transform='rotate(90deg)';up.disabled=index===0;
                    row.append(play,button('下一首播放 '+track.title,()=>M.player.enqueue(track,true),'skip-forward'),up,button('移出队列 '+track.title,()=>M.player.remove(index),'x'));list.append(row);});if(!state.queue.length)empty(list,'队列为空');
            });
        },()=>unsubscribe?.());
    }
    function sleepPanel() { modal('定时关闭', body => { for (const n of [0, 15, 30, 60]) body.append(button(n ? n + ' 分钟后' : '关闭定时', () => { M.player.setSleep(n); closeSheet(); }, undefined, 'um-wide')); }); }
    function lyricsPanel() {
        const track = M.player.snapshot().track; if (!track) return; const controller = new AbortController(); let alive = true,unsubscribe;
        modal('歌词', body => {
            body.classList.add('um-lyrics-body'); body.closest('.uvu-music-sheet').classList.add('um-lyrics-sheet');
            const heading = el('div', undefined, 'um-lyrics-heading'); heading.append(cover(track), el('strong', track.title), el('span', track.artists.join(' / ')));
            const tools=el('div',undefined,'um-lyrics-tools'),words = el('div', '正在读取…', 'um-lyrics'); body.append(heading,tools, words);let following=true,lines=[],current=-1;
            const follow=button('跟随播放',()=>{following=true;current=-1;paint(M.player.snapshot());});follow.hidden=true;tools.append(follow);
            body.addEventListener('wheel',()=>{following=false;follow.hidden=false;},{passive:true});body.addEventListener('touchmove',()=>{following=false;follow.hidden=false;},{passive:true});body.addEventListener('keydown',e=>{if(['PageDown','PageUp','ArrowDown','ArrowUp','Home','End'].includes(e.key)){following=false;follow.hidden=false;}});
            const paint=state=>{if(!alive||!state.track||M.key(state.track)!==M.key(track))return;let index=-1;for(let i=0;i<lines.length;i++)if(lines[i].time!==null&&lines[i].time<=state.position)index=i;if(index===current)return;current=index;[...words.children].forEach((n,i)=>n.classList.toggle('current',i===index));if(following&&index>=0){const n=words.children[index];body.scrollTop=Math.max(0,body.scrollTop+n.getBoundingClientRect().top-body.getBoundingClientRect().top-body.clientHeight*.45);follow.hidden=true;}};
            void M.lyrics(track, controller.signal).then(data => { if (alive) {
                let translation=false;const renderWords=()=>{lines=root.UvUMusicLyrics.parse(translation?data.translation:data.lyric);words.replaceChildren();for(const line of lines)words.append(el('span',line.text||'\u00a0','um-lyrics-line'));if(!lines.some(l=>l.text))words.textContent='暂无歌词';current=-1;paint(M.player.snapshot());};
                if(data.translation)tools.append(button('原文 / 翻译',()=>{translation=!translation;renderWords();}));renderWords();unsubscribe=M.player.subscribe(paint);
            } }).catch(e => { if (alive) words.textContent = e.message; });
        }, () => { alive = false; controller.abort();unsubscribe?.(); });
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
        details.append(el('p', '导入歌单：资料库 → 播放列表 → 导入歌单。粘贴网易云或 QQ 音乐的完整歌单链接，先预览，再修改名称并保存。只有数字 ID 时先选择平台；短链接请在官方平台打开后复制完整链接。账号歌单中也可点“导入到资料库”。最多保存 1000 首歌曲资料，不下载音频，不改变播放权限。需要已连接音乐网关；公共源当前不支持读取歌单。'));
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
        modal('音乐源', body => {
            const appearanceBox=section('外观'),choices=el('div',undefined,'um-appearance');
            for(const [value,label]of [['light','白色'],['dark','深色']]){const b=button(label,()=>{appearance=value;try{localStorage.setItem('uvu-music-appearance',value);}catch(_){}applyAppearance();for(const child of choices.children)child.setAttribute('aria-pressed',String(child===b));});b.setAttribute('aria-pressed',String(appearance===value));choices.append(b);}appearanceBox.append(choices);body.append(appearanceBox,button('导入音乐',()=>document.getElementById('um-local-files').click(),'plus'),button('返回小手机',returnToPhone,'house'));
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
            form.append(el('h2','账号音乐'), label, remember, button('保存并连接', () => connect()), output); form.onsubmit = e => { e.preventDefault(); void connect(); }; body.append(form, accounts, button('清理缓存',()=>{M.clearMetadataCache();toast('已清理歌词与公共源临时数据');},undefined,'um-text-button'),button('清空播放记录',async()=>{await M.clearRecent();render();},undefined,'um-text-button'),tutorial());
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
        main = el('main', undefined, 'um-main'); mini = el('div', undefined, 'um-mini'); mini.hidden = true;
        const nav = el('nav', undefined, 'um-nav'); nav.setAttribute('aria-label', '音乐导航');
        for (const [id, title, image] of [['home', '主页', 'house'],['discover','新发现','layout-grid'],['radio','广播','radio'], ['library', '资料库', 'library-big'], ['search', '搜索', 'search']]) { const b = button(title, () => { clearTimeout(debounce); selectTab(id); if (id === 'search' && query && !results.length && !searchLoading) void runSearch(true); }, image); b.dataset.umTab = id; b.append(el('span', title)); nav.append(b); }
        const file = el('input'); file.id = 'um-local-files'; file.type = 'file'; file.accept = 'audio/*'; file.multiple = true; file.hidden = true; file.onchange = async () => { const files = [...file.files]; file.value = ''; await importFiles(files); };
        const bottom=el('div',undefined,'um-bottom');bottom.append(mini,nav);screen.append(main,bottom,file); (document.querySelector('.phone-screen') || document.body).append(screen);
        M.player.subscribe(updateMini); root.addEventListener('music-state', event => {
            const state = event.detail, signature = (state?.track ? M.key(state.track) : '') + ':' + Boolean(state?.playing), changed = signature !== playbackSignature; playbackSignature = signature;
            if (screen.classList.contains('active') && tab !== 'search' && (renderedLibrary !== librarySource() || tab === 'home' && changed)) render();
        });
        root.addEventListener('music-chat-state', () => { if (screen.classList.contains('active') && tab === 'home') render(); });
        document.addEventListener('click', event => { if (event.target.closest?.('#share-music-btn')) { event.preventDefault(); const target = typeof captureChatSendTarget === 'function' ? captureChatSendTarget() : null; open(target?.type === 'private' ? target : null); } if (event.target.closest?.('[data-target="uvu-music-screen"]')) { shareTarget = null; render(); } });
        render();
    }
    root.UvUMusicUI = { open, nowPlaying, accounts: accountsPanel, close: closeSheet, mount, queue:queuePanel, trackMenu };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(window);
