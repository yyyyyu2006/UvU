(function (root) {
    'use strict';

    const LEAFLET_VERSION = '1.9.4';
    const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    let leafletPromise;

    function distanceKm(first, second) {
        if (!first || !second || !Number.isFinite(first.latitude) || !Number.isFinite(first.longitude) ||
            !Number.isFinite(second.latitude) || !Number.isFinite(second.longitude) || Math.abs(first.latitude) > 90 ||
            Math.abs(second.latitude) > 90 || Math.abs(first.longitude) > 180 || Math.abs(second.longitude) > 180) return null;
        const rad = value => value * Math.PI / 180;
        const lat1 = rad(first.latitude), lat2 = rad(second.latitude), dLat = lat2 - lat1, dLon = rad(second.longitude - first.longitude);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        return Math.round(6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))));
    }

    function formatDistance(km) {
        if (!Number.isFinite(km) || km < 0) return '距离暂不可用';
        if (km < 1) return '约 0 公里';
        if (km < 5) return '不足 5 公里';
        const step = km < 100 ? 5 : km < 1000 ? 10 : 100;
        return `约 ${(Math.round(km / step) * step).toLocaleString('zh-CN')} 公里`;
    }

    function element(tag, text, className) {
        const item = document.createElement(tag);
        if (text !== undefined) item.textContent = text;
        if (className) item.className = className;
        return item;
    }

    function avatarSource(value) { return typeof root.safeDisplayImageUrl === 'function' ? root.safeDisplayImageUrl(value) : ''; }
    function avatarToken(label, source, className) {
        const safeSource = avatarSource(source);
        const token = element(safeSource ? 'img' : 'b', safeSource ? undefined : label, className);
        if (safeSource) { token.src = safeSource; token.alt = ''; }
        return token;
    }

    function loadLeaflet() {
        if (root.L) return Promise.resolve(root.L);
        if (leafletPromise) return leafletPromise;
        leafletPromise = new Promise((resolve, reject) => {
            if (!document.querySelector('[data-uvu-leaflet-css]')) {
                const link = document.createElement('link'); link.rel = 'stylesheet';
                link.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`; link.dataset.uvuLeafletCss = 'true';
                document.head.append(link);
            }
            const script = document.createElement('script');
            script.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
            script.onload = () => root.L ? resolve(root.L) : reject(new Error('地图组件未能启动'));
            script.onerror = () => reject(new Error('地图组件加载失败，可继续查看地点和公里距离'));
            document.head.append(script);
        }).catch(error => { leafletPromise = null; throw error; });
        return leafletPromise;
    }

    function profileOf(chat) { return typeof root.getChatEnvironmentProfile === 'function' ? root.getChatEnvironmentProfile(chat) : chat?.environmentProfile || {}; }

    function open(chat) {
        const target = chat && root.db?.characters?.includes(chat) ? chat : null;
        const archiveId = target?.activeArchiveId || '';
        let leafletMap;
        const dialog = root.createMessageForwardDialog('位置地图', 'shared-location-map', () => leafletMap?.remove());
        dialog.panel.classList.add('derived-settings', 'uvu-location-map');
        const body = element('div', undefined, 'location-map-body'); dialog.panel.append(body);
        const userLocation = root.getEnvironmentSettings?.().userLocation || null;
        const profile = profileOf(target);
        const characterLocation = target ? profile.charLocation || null : null;
        const userAvatar = avatarSource(target?.myAvatar);
        const characterAvatar = avatarSource(target?.avatar);
        const currentShareKey = root.environmentLocationShareKey?.(userLocation) || '';
        const shareActive = !!currentShareKey && profile.mapShareEnabled === true && profile.mapShareUntil > Date.now() && profile.mapShareLocationKey === currentShareKey;
        const valid = () => !target || (root.db.characters.includes(target) && (target.activeArchiveId || '') === archiveId);
        const placesWithCoordinates = [userLocation, characterLocation].filter(place => place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude));

        const names = element('div', undefined, 'location-map-people');
        const user = element('div', undefined, 'location-map-person'); user.append(element('span', '我', 'location-map-dot location-map-dot-user'), element('strong', userLocation?.name || '尚未设置我的城市'));
        names.append(user);
        if (target) {
            const character = element('div', undefined, 'location-map-person'); character.append(element('span', 'Ta', 'location-map-dot location-map-dot-character'), element('strong', characterLocation?.name || '尚未设置角色城市'));
            names.append(character);
        }
        body.append(names);

        const map = element('div', undefined, 'location-map-canvas'); map.setAttribute('role', 'region'); map.setAttribute('aria-label', '我与角色的位置地图');
        const mapStatus = element('p', '打开地图会向 OpenStreetMap 请求当前地图区域的底图；不会开启实时定位。', 'location-map-status');
        const loadButton = element('button', '加载地图', 'location-map-load'); loadButton.type = 'button'; loadButton.disabled = !placesWithCoordinates.length;
        const expandButton = element('button', '放大地图', 'location-map-expand'); expandButton.type = 'button'; expandButton.hidden = true;
        expandButton.setAttribute('aria-expanded', 'false');
        const expandedHeader = element('div', undefined, 'location-map-expanded-header');
        const backButton = element('button', '×', 'location-map-expanded-back'); backButton.type = 'button'; backButton.setAttribute('aria-label', '返回位置地图');
        const expandedPeople = element('div', undefined, 'location-map-expanded-people');
        const expandedUser = element('span', undefined, 'location-map-expanded-person'); expandedUser.append(avatarToken('我', userAvatar, 'location-map-expanded-avatar'), element('span', userLocation?.name || '未设置城市'));
        expandedPeople.append(expandedUser);
        if (target) {
            const expandedCharacter = element('span', undefined, 'location-map-expanded-person'); expandedCharacter.append(avatarToken('Ta', characterAvatar, 'location-map-expanded-avatar'), element('span', characterLocation?.name || '未设置城市'));
            expandedPeople.append(expandedCharacter);
        }
        const expandedShareState = element('small', shareActive ? '位置共享 · 当前角色' : '仅本机查看', 'location-map-expanded-share');
        expandedHeader.append(backButton, expandedPeople, expandedShareState);
        const mapFrame = element('section', undefined, 'location-map-frame'); mapFrame.append(mapStatus, loadButton, expandButton, expandedHeader, map); body.append(mapFrame);

        const overlay = dialog.panel.closest('.message-forward-overlay');
        const originalHeader = dialog.panel.querySelector('.message-forward-header');
        const setExpanded = expanded => {
            dialog.panel.classList.toggle('location-map-expanded', expanded);
            overlay?.classList.toggle('location-map-expanded-overlay', expanded);
            expandButton.setAttribute('aria-expanded', String(expanded));
            if (expanded) originalHeader?.style.setProperty('display', 'none', 'important');
            else originalHeader?.style.removeProperty('display');
            if (expanded) requestAnimationFrame(() => leafletMap?.invalidateSize({ pan: false }));
        };
        backButton.onclick = () => setExpanded(false);
        expandButton.onclick = () => setExpanded(true);
        map.addEventListener('click', event => {
            if (leafletMap && !dialog.panel.classList.contains('location-map-expanded') &&
                !event.target.closest?.('.leaflet-control, .location-map-load, .location-map-expand')) setExpanded(true);
        }, true);

        const sharing = element('details', undefined, 'location-map-sharing');
        const sharingSummary = element('summary', shareActive ? '位置共享 · 已开启' : '位置共享设置'); sharing.append(sharingSummary);
        const sharingContent = element('div', undefined, 'location-map-sharing-content');
        sharingContent.append(element('p', '地图仅在本机显示。聊天引用需单独开启；只引用城市与约公里距离，不发送坐标。', 'location-map-note'));
        if (!target) {
            sharingContent.append(element('p', '从日历选择一个角色后，可为该角色和当前存档设置分享期限。', 'location-map-note'));
        } else {
            const share = element('input'); share.type = 'checkbox'; share.checked = profile.mapShareEnabled === true && profile.mapShareUntil > Date.now() && profile.mapShareLocationKey === currentShareKey;
            share.disabled = !userLocation;
            const expiry = element('select'); expiry.setAttribute('aria-label', '共享有效期');
            [['1', '1 天'], ['7', '7 天'], ['30', '30 天']].forEach(([value, label]) => expiry.append(new Option(label, value)));
            const remaining = profile.mapShareUntil > Date.now() ? Math.ceil((profile.mapShareUntil - Date.now()) / 86400000) : 7;
            expiry.value = remaining <= 1 ? '1' : remaining <= 7 ? '7' : '30';
            const shareLabel = element('label', undefined, 'location-map-check'); shareLabel.append(share, element('span', '允许当前角色查看我的城市位置'));
            const expiryRow = element('label', undefined, 'location-map-expiry'); expiryRow.append(element('span', '有效期'), expiry);
            const reference = element('input'); reference.type = 'checkbox'; reference.checked = profile.mapShareInChat === true && share.checked && !!characterLocation;
            reference.disabled = !share.checked || !userLocation || !characterLocation;
            const referenceLabel = element('label', undefined, 'location-map-check'); referenceLabel.append(reference, element('span', '允许聊天引用城市与公里距离'));
            const status = element('p', '', 'location-map-status'); status.setAttribute('aria-live', 'polite');
            const actions = element('div', undefined, 'location-map-actions');
            const save = element('button', '保存共享设置', 'location-map-save'); save.type = 'button';
            const revoke = element('button', '立即撤销', 'location-map-revoke'); revoke.type = 'button'; revoke.disabled = !profile.mapShareEnabled;
            actions.append(save, revoke);
            sharingContent.append(shareLabel, expiryRow, referenceLabel, actions, status);
            if (!userLocation) sharingContent.append(element('p', '先在环境设置中保存我的城市，才能开启共享。', 'location-map-note'));
            else if (!characterLocation) sharingContent.append(element('p', '先为角色设置城市，才能允许聊天引用两地距离。', 'location-map-note'));
            share.onchange = () => { reference.disabled = !share.checked || !userLocation || !characterLocation; if (reference.disabled) reference.checked = false; };
            const persist = async (enabled, includeInChat) => {
                if (!valid()) throw new Error('当前角色或存档已切换，请重新打开地图');
                const until = enabled ? Date.now() + Number(expiry.value) * 86400000 : 0;
                const next = { ...(target.environmentProfile || {}), mapShareEnabled: enabled, mapShareUntil: until, mapShareInChat: enabled && includeInChat,
                    mapShareLocationKey: enabled ? currentShareKey : '' };
                await root.saveDerivedChatFields(target, { environmentProfile: next });
                if (!valid()) throw new Error('设置已保存到原存档；当前已切换到其他存档');
                sharingSummary.textContent = enabled ? '位置共享 · 已开启' : '位置共享设置';
                status.textContent = enabled ? `已保存，将在 ${expiry.options[expiry.selectedIndex].text} 后自动失效。` : '已撤销共享。';
                revoke.disabled = !enabled;
            };
            save.onclick = () => persist(share.checked, reference.checked).catch(error => { status.textContent = error.message; });
            revoke.onclick = () => { share.checked = false; reference.checked = false; persist(false, false).catch(error => { status.textContent = error.message; }); };
        }
        sharing.append(sharingContent);
        body.append(sharing);

        loadButton.onclick = async () => {
            if (!valid()) { mapStatus.textContent = '角色或存档已切换，请重新打开地图。'; return; }
            loadButton.disabled = true; mapStatus.textContent = '正在加载地图底图…';
            try {
                const L = await loadLeaflet();
                if (!valid() || !map.isConnected) return;
                const places = [[userLocation, '我', 'location-map-marker-user'], [characterLocation, 'Ta', 'location-map-marker-character']].filter(([place]) => place);
                const points = places.map(([place]) => [place.latitude, place.longitude]);
                leafletMap = L.map(map, { zoomControl: true, scrollWheelZoom: false, tap: true, attributionControl: true });
                const tiles = L.gridLayer({ attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>', maxZoom: 19 });
                tiles.createTile = function (coords, done) {
                    const tile = document.createElement('img'); tile.alt = ''; tile.setAttribute('role', 'presentation');
                    tile.referrerPolicy = 'strict-origin-when-cross-origin';
                    tile.onload = () => done(null, tile); tile.onerror = error => done(error, tile);
                    tile.src = L.Util.template(TILE_URL, { ...coords, s: 'a' });
                    return tile;
                };
                tiles.addTo(leafletMap);
                places.forEach(([, label, markerClass], index) => {
                    const source = label === '我' ? userAvatar : characterAvatar;
                    const escapedSource = typeof root.escapeDisplayHtml === 'function' ? root.escapeDisplayHtml(source) : source.replace(/[&<>"']/g, character => ({
                        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
                    })[character]);
                    const markerContent = source ? `<img src="${escapedSource}" alt="">` : `<span>${label}</span>`;
                    L.marker(points[index], {
                        icon: L.divIcon({ className: `location-map-marker ${markerClass}`, html: markerContent, iconSize: [48, 48], iconAnchor: [24, 24] })
                    }).addTo(leafletMap);
                });
                tiles.on('tileerror', () => { mapStatus.textContent = '底图暂不可用；上方仍可查看双方城市。'; });
                if (points.length > 1) leafletMap.fitBounds(points, { padding: [36, 36], maxZoom: 5 });
                else leafletMap.setView(points[0], 5);
                mapStatus.textContent = '城市位置 · 非实时 GPS'; mapStatus.classList.add('location-map-status-loaded');
                loadButton.hidden = true; expandButton.hidden = false;
            } catch (error) { mapStatus.textContent = error.message || '地图暂不可用；仍可查看双方城市。'; loadButton.disabled = false; }
        };
        return dialog;
    }

    root.UvULocationMap = { open, distanceKm, formatDistance };
})(globalThis);
