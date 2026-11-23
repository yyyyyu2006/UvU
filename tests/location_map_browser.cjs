'use strict';
const assert = require('node:assert/strict');
const { fullApp, stableUI } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    try {
        const { page, errors } = await app.page();
        const tileRequests = [];
        page.on('request', request => { if (/tile\.openstreetmap\.org|unpkg\.com\/leaflet/.test(request.url())) tileRequests.push(request.url()); });
        await page.route('https://unpkg.com/leaflet/**', route => route.abort());
        await page.evaluate(() => {
            const openMap = window.UvULocationMap.open;
            window.UvULocationMap.open = chat => { window.mapEntryClicked = true; openMap(chat); };
            openEnvironmentCalendar();
        });
        await stableUI(page, '#environment-calendar');
        const calendar = page.locator('#environment-calendar');
        const mapEntry = calendar.getByRole('button', { name: '位置地图' });
        assert.equal(await mapEntry.isVisible(), true, 'map entry remains visible in the calendar header');
        await mapEntry.click();
        assert.equal(await page.evaluate(() => window.mapEntryClicked), true, 'calendar header map entry opens the map');
        await stableUI(page, '#shared-location-map');
        await page.evaluate(() => document.getElementById('shared-location-map').dismissForward());
        await page.evaluate(() => document.getElementById('environment-calendar').dismissForward());

        await page.evaluate(() => {
            db.environmentSettings = { enabled: false, userLocation: { name: '上海', countryCode: 'CN', timezone: 'Asia/Shanghai', latitude: 31.23, longitude: 121.47 } };
            window.saveDerivedChatFields = async (target, changes) => Object.assign(target, changes);
            window.UvULocationMap.open(null);
        });
        await stableUI(page, '#shared-location-map');
        const panel = page.locator('#shared-location-map');
        assert.equal(await panel.locator('.location-map-distance, .location-map-km').count(), 0, 'the map panel no longer renders the distance card');
        assert.deepEqual(tileRequests, [], 'opening the panel alone must not load external map code or tiles');

        await panel.getByRole('button', { name: '加载地图' }).click();
        await page.waitForFunction(() => {
            const status = document.querySelector('#shared-location-map .location-map-status');
            return status && status.textContent !== '打开地图会向 OpenStreetMap 请求当前地图区域的底图；不会开启实时定位。';
        }, null, { timeout: 8000 });
        const statuses = await panel.locator('.location-map-status').allTextContents();
        assert.match(statuses.join(' '), /加载失败|组件未能启动/);
        assert.deepEqual(tileRequests.filter(url => url.includes('tile.openstreetmap.org')), []);
        assert.match(await panel.locator('.location-map-people').textContent(), /上海/, 'text location fallback remains available');
        await page.evaluate(() => document.getElementById('shared-location-map').dismissForward());

        await page.evaluate(() => {
            window.L = {
                map: () => ({ fitBounds() {}, setView() {}, invalidateSize() {}, remove() {} }),
                gridLayer: () => ({ on() { return this; }, addTo() { return this; } }),
                divIcon: options => options,
                marker: (_point, options) => ({ addTo() { (window.mapMarkerHtml ||= []).push(options.icon.html); return this; } })
            };
            const chat = { id: 'location-map-chat', name: '示例角色', history: [], activeArchiveId: '',
                myAvatar: 'data:image/png;base64,AAAA" onerror="alert(1)', avatar: 'https://example.test/avatar.png',
                environmentProfile: { charLocation: { name: '东京', countryCode: 'JP', timezone: 'Asia/Tokyo', latitude: 35.68, longitude: 139.69 } } };
            db.characters.push(chat); window.mapFixtureChat = chat; UvULocationMap.open(chat);
        });
        await stableUI(page, '#shared-location-map');
        const chatPanel = page.locator('#shared-location-map');
        assert.equal(await chatPanel.locator('.location-map-distance, .location-map-km').count(), 0, 'no kilometer summary remains beneath the map');
        await chatPanel.getByRole('button', { name: '加载地图' }).click();
        await chatPanel.getByRole('button', { name: '放大地图' }).waitFor({ state: 'visible' });
        const markerHtml = await page.evaluate(() => mapMarkerHtml);
        assert.equal(markerHtml.length, 2);
        const markerAttributes = await page.evaluate(html => { const node = document.createElement('div'); node.innerHTML = html; return node.querySelector('img')?.getAttribute('onerror'); }, markerHtml[0]);
        assert.equal(markerAttributes, null, 'avatar URLs are escaped before Leaflet marker HTML is built');
        await chatPanel.locator('.location-map-canvas').click({ position: { x: 120, y: 100 } });
        assert.equal(await chatPanel.locator('.uvu-location-map').evaluate(node => node.classList.contains('location-map-expanded')), true, 'clicking the loaded map enters the full-screen draft layout');
        assert.equal(await chatPanel.locator('.location-map-expanded-header').isVisible(), true);
        assert.match(await chatPanel.locator('.location-map-expanded-header').textContent(), /上海|东京/);
        assert.equal(await chatPanel.locator('.location-map-distance, .location-map-km').count(), 0);
        const viewport = page.viewportSize();
        const expandedBox = await chatPanel.locator('.location-map-canvas').boundingBox();
        assert.ok(expandedBox.width >= viewport.width - 1 && expandedBox.height >= viewport.height - 1, 'expanded map fills the viewport');
        await chatPanel.getByRole('button', { name: '返回位置地图' }).click();
        assert.equal(await chatPanel.locator('.uvu-location-map').evaluate(node => node.classList.contains('location-map-expanded')), false, 'back returns to the settings panel');
        const sharing = chatPanel.locator('.location-map-sharing');
        assert.equal(await sharing.locator('summary').textContent(), '位置共享设置');
        assert.equal(await sharing.locator('input[type="checkbox"]').first().isVisible(), false, 'sharing controls stay collapsed below the map summary');
        await sharing.locator('summary').click();
        assert.equal(await chatPanel.getByRole('checkbox', { name: /允许当前角色/ }).isChecked(), false);
        const ref = chatPanel.getByRole('checkbox', { name: /允许聊天引用/ });
        assert.equal(await ref.isDisabled(), true);

        const share = chatPanel.getByRole('checkbox', { name: /允许当前角色/ });
        await share.check();
        await ref.check();
        await chatPanel.getByRole('button', { name: '保存共享设置' }).click();
        await page.waitForFunction(() => mapFixtureChat.environmentProfile?.mapShareInChat === true);
        const saved = await page.evaluate(() => ({ ...mapFixtureChat.environmentProfile }));
        assert.equal(saved.mapShareEnabled, true);
        assert.ok(saved.mapShareUntil > await page.evaluate(() => Date.now()));
        assert.equal(saved.mapShareLocationKey, await page.evaluate(() => environmentLocationShareKey(db.environmentSettings.userLocation)));
        const promptContext = await page.evaluate(async () => getEnvironmentContext(mapFixtureChat));
        assert.match(promptContext, /上海/); assert.match(promptContext, /东京/); assert.match(promptContext, /约 1,800 公里/);
        assert.doesNotMatch(promptContext, /31\.23|121\.47|35\.68|139\.69/);

        await chatPanel.getByRole('button', { name: '立即撤销' }).click();
        await page.waitForFunction(() => mapFixtureChat.environmentProfile?.mapShareEnabled === false);
        assert.equal(await page.evaluate(async () => getEnvironmentContext(mapFixtureChat)), '');
        await page.evaluate(() => document.getElementById('shared-location-map').dismissForward());
        assert.deepEqual(errors, []);

        const narrow = await app.page({ viewport: { width: 320, height: 568 } });
        try {
            await narrow.page.evaluate(() => {
                db.environmentSettings = { enabled: false, userLocation: { name: '上海', countryCode: 'CN', timezone: 'Asia/Shanghai', latitude: 31.23, longitude: 121.47 } };
                window.L = {
                    map: () => ({ fitBounds() {}, setView() {}, invalidateSize() {}, remove() {} }),
                    gridLayer: () => ({ on() { return this; }, addTo() { return this; } }),
                    divIcon: options => options,
                    marker: () => ({ addTo() { return this; } })
                };
                UvULocationMap.open(null);
            });
            await stableUI(narrow.page, '#shared-location-map');
            const narrowPanel = narrow.page.locator('#shared-location-map');
            await narrowPanel.getByRole('button', { name: '加载地图' }).click();
            await narrowPanel.getByRole('button', { name: '放大地图' }).click();
            const narrowMapBox = await narrowPanel.locator('.location-map-canvas').boundingBox();
            assert.ok(narrowMapBox.width >= 319 && narrowMapBox.height >= 567, 'full-screen map fills the short narrow viewport');
            assert.ok(await narrow.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow layout has no horizontal page overflow');
            await narrowPanel.getByRole('button', { name: '返回位置地图' }).click();
            assert.equal(await narrowPanel.locator('.uvu-location-map').evaluate(node => node.classList.contains('location-map-expanded')), false);
            assert.deepEqual(narrow.errors, []);
        } finally { await narrow.context.close(); }
        console.log('PASS distance card removed; loaded map expands from tap to full-screen draft layout and returns; opt-in loading, sharing expiry, city-only optional chat context, revocation and no-coordinate context.');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
