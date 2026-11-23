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
        const distance = distanceKm(userLocation, characterLocation);
        const valid = () => !target || (root.db.characters.includes(target) && (target.activeArchiveId || '') === archiveId);

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
        const loadButton = element('button', '加载地图', 'location-map-load'); loadButton.type = 'button'; loadButton.disabled = !userLocation && !characterLocation;
        const mapFrame = element('section', undefined, 'location-map-frame'); mapFrame.append(mapStatus, loadButton, map); body.append(mapFrame);

        const summary = element('section', undefined, 'location-map-distance');
        summary.append(element('span', '两地直线距离', 'location-map-caption'), element('strong', distance === null ? '需要双方都设置城市' : formatDistance(distance), 'location-map-km'));
        if (userLocation && characterLocation) summary.append(element('span', '按已保存的城市位置估算；角色地点是手动设置，不是实时 GPS。', 'location-map-note'));
        body.append(summary);

        const sharing = element('section', undefined, 'location-map-sharing');
        sharing.append(element('h2', '位置共享', 'location-map-section-title'));
        sharing.append(element('p', '地图仅在本机显示。开启聊天引用后，才会把城市名称和估算公里数加入对话；不会发送坐标，也不会后台定位。', 'location-map-note'));
        if (!target) {
            sharing.append(element('p', '从日历选择一个角色后，可为该角色和当前存档设置分享期限。', 'location-map-note'));
        } else {
            const currentShareKey = root.environmentLocationShareKey?.(userLocation) || '';
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
            sharing.append(shareLabel, expiryRow, referenceLabel, actions, status);
            if (!userLocation) sharing.append(element('p', '先在环境设置中保存我的城市，才能开启共享。', 'location-map-note'));
            else if (!characterLocation) sharing.append(element('p', '先为角色设置城市，才能允许聊天引用两地距离。', 'location-map-note'));
            share.onchange = () => { reference.disabled = !share.checked || !userLocation || !characterLocation; if (reference.disabled) reference.checked = false; };
            const persist = async (enabled, includeInChat) => {
                if (!valid()) throw new Error('当前角色或存档已切换，请重新打开地图');
                const until = enabled ? Date.now() + Number(expiry.value) * 86400000 : 0;
                const next = { ...(target.environmentProfile || {}), mapShareEnabled: enabled, mapShareUntil: until, mapShareInChat: enabled && includeInChat,
                    mapShareLocationKey: enabled ? currentShareKey : '' };
                await root.saveDerivedChatFields(target, { environmentProfile: next });
                if (!valid()) throw new Error('设置已保存到原存档；当前已切换到其他存档');
                status.textContent = enabled ? `已保存，将在 ${expiry.options[expiry.selectedIndex].text} 后自动失效。` : '已撤销共享。';
                revoke.disabled = !enabled;
            };
            save.onclick = () => persist(share.checked, reference.checked).catch(error => { status.textContent = error.message; });
            revoke.onclick = () => { share.checked = false; reference.checked = false; persist(false, false).catch(error => { status.textContent = error.message; }); };
        }
        body.append(sharing);

        loadButton.onclick = async () => {
            if (!valid()) { mapStatus.textContent = '角色或存档已切换，请重新打开地图。'; return; }
            loadButton.disabled = true; mapStatus.textContent = '正在加载地图底图…';
            try {
                const L = await loadLeaflet();
                if (!valid() || !map.isConnected) return;
                const places = [[userLocation, '#557cae'], [characterLocation, '#86aee0']].filter(([place]) => place);
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
                places.forEach(([, color], index) => L.circleMarker(points[index], { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(leafletMap));
                tiles.on('tileerror', () => { mapStatus.textContent = '底图暂不可用；仍可查看上方地点和公里距离。'; });
                if (points.length > 1) leafletMap.fitBounds(points, { padding: [36, 36], maxZoom: 5 });
                else leafletMap.setView(points[0], 5);
                mapStatus.textContent = '地图仅展示你已保存的城市位置；拖动或缩放不会改变分享设置。';
                loadButton.hidden = true;
            } catch (error) { mapStatus.textContent = error.message || '地图暂不可用；地点和公里距离仍可查看。'; loadButton.disabled = false; }
        };
        return dialog;
    }

    root.UvULocationMap = { open, distanceKm, formatDistance };
})(globalThis);
