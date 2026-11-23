'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../js/modules/', name), 'utf8');

function environmentContext() {
    const c = vm.createContext({ console, AbortController, DOMException, setTimeout, clearTimeout, db: { characters: [], groups: [], environmentSettings: {} } });
    c.window = c;
    vm.runInContext(source('environment.js'), c);
    return c;
}

const shanghai = { name: '上海', countryCode: 'CN', timezone: 'Asia/Shanghai', latitude: 31.23, longitude: 121.47 };
const tokyo = { name: '东京', countryCode: 'JP', timezone: 'Asia/Tokyo', latitude: 35.68, longitude: 139.69 };

test('map distance for optional shared context is estimated in coarse whole-kilometer units', () => {
    const c = vm.createContext({});
    vm.runInContext(source('location_map.js'), c);
    const map = c.UvULocationMap;
    const distance = map.distanceKm(shanghai, tokyo);
    assert.ok(distance > 1700 && distance < 1800);
    assert.equal(map.formatDistance(distance), '约 1,800 公里');
    assert.equal(map.formatDistance(2), '不足 5 公里');
    assert.equal(map.formatDistance(0), '约 0 公里');
    assert.match(map.formatDistance(distance), /公里/);
    assert.doesNotMatch(map.formatDistance(distance), /米|\d+\.\d/);
    assert.equal(map.distanceKm({ latitude: 91, longitude: 0 }, shanghai), null);
});

test('shared city context is opt-in, expires, and never includes coordinates', async () => {
    const c = environmentContext();
    const chat = { id: 'map-test', activeArchiveId: 'archive-a', history: [], environmentProfile: { charLocation: tokyo,
        mapShareEnabled: true, mapShareUntil: Date.now() + 86400000, mapShareInChat: true } };
    c.db.characters.push(chat);
    c.db.environmentSettings = { enabled: false, userLocation: shanghai };
    chat.environmentProfile.mapShareLocationKey = c.environmentLocationShareKey(shanghai);

    const context = await c.getEnvironmentContext(chat);
    assert.match(context, /上海/); assert.match(context, /东京/); assert.match(context, /约 1,800 公里/);
    assert.doesNotMatch(context, /31\.23|121\.47|35\.68|139\.69/);

    chat.environmentProfile = { ...chat.environmentProfile, mapShareUntil: Date.now() - 1 };
    assert.equal(await c.getEnvironmentContext(chat), '');
    chat.environmentProfile = { ...chat.environmentProfile, mapShareUntil: Date.now() + 86400000, mapShareLocationKey: 'old-city' };
    assert.equal(await c.getEnvironmentContext(chat), '');
    chat.environmentProfile = { ...chat.environmentProfile, mapShareLocationKey: c.environmentLocationShareKey(shanghai), mapShareInChat: false };
    assert.equal(await c.getEnvironmentContext(chat), '');
});
