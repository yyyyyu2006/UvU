const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
    const context = vm.createContext({ crypto: require('node:crypto').webcrypto, Date, URL, AbortController, setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/link_shares.js'), 'utf8'), context);
    return context;
}
function backupFixture() {
    const context = vm.createContext({ console, crypto: require('node:crypto').webcrypto, Date, URL, AbortController,
        setTimeout, clearTimeout, window: {}, db: { characters: [], groups: [] }, saveData: async () => {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/link_shares.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/storage.js'), 'utf8'), context);
    return context;
}

test('shared URLs are normalized and reject unsafe schemes, credentials, local hosts and multiple links', () => {
    const c = fixture();
    assert.equal(c.normalizeSharedLinkUrl(' https://www.xiaohongshu.com/explore/abc). '), 'https://www.xiaohongshu.com/explore/abc');
    assert.throws(() => c.normalizeSharedLinkUrl('javascript:alert(1)'), /HTTPS/);
    assert.throws(() => c.normalizeSharedLinkUrl('https://user:pass@example.com/a'), /账号信息/);
    assert.throws(() => c.normalizeSharedLinkUrl('http://127.0.0.1/admin'), /公网/);
    assert.throws(() => c.normalizeSharedLinkUrl('https://example.com https://example.org'), /一个网址/);
});

test('link-share records bound metadata and text with separate source provenance', () => {
    const c = fixture();
    const item = c.makeSharedLink({ url: 'https://www.douyin.com/video/123', title: '标题', description: '简介',
        author: '作者', readableText: '字幕示例', metadataSource: 'tiktok-oembed', status: 'user-provided' });
    assert.equal(item.platform, 'douyin');
    assert.equal(item.readableText, '字幕示例');
    assert.equal(item.readableSource, 'user');
    assert.equal(item.metadataSource, 'tiktok-oembed');
    assert.throws(() => c.makeSharedLink({ url: 'https://example.com', readableText: 'x'.repeat(20001) }), /20000/);
    assert.throws(() => c.makeSharedLink({ url: 'https://example.com', thumbnailUrl: 'javascript:alert(1)' }), /缩略图/);
    assert.throws(() => c.makeSharedLink({ url: 'https://example.com', thumbnailUrl: 'https://tracking.example.net/pixel.jpg' }), /官方 HTTPS/);
    assert.throws(() => c.validateSharedLink({ version: 2, url: 'https://example.com' }), /格式/);
});

test('link context is attached only to eligible messages inside the supplied history slice and is bounded', () => {
    const c = fixture();
    const link = c.makeSharedLink({ url: 'https://www.tiktok.com/@a/video/123', title: '视频标题', description: '简介',
        readableText: '实际字幕', metadataSource: 'tiktok-oembed', status: 'user-provided' });
    const message = c.sharedLinkMessage(link, 'user', '我');
    const ordinary = { id: 'plain', role: 'user', content: '普通消息' };
    const plan = c.prepareSharedLinkContext([ordinary, message]);
    assert.notEqual(plan.history[1], message);
    assert.match(plan.history[1].content, /实际字幕/);
    assert.match(plan.history[1].content, /仅供理解和讨论/);
    assert.match(plan.history[1].content, /TikTok 官方 oEmbed/);
    assert.match(plan.history[1].content, /外部资料/);
    assert.deepEqual(JSON.parse(JSON.stringify(plan.sources.map(item => ({ source: item.source, complete: item.complete })))),
        [{ source: 'TikTok 官方 oEmbed 公开预览元数据；用户补充正文／字幕', complete: true }]);
    assert.equal(plan.history[0], ordinary);
    assert.equal(message.content, `[我分享了链接：${link.url}]`);
    assert.equal(c.prepareSharedLinkContext([ordinary]).history[0], ordinary);
    const excluded = { ...message, isContextDisabled: true };
    assert.equal(c.prepareSharedLinkContext([excluded]).history[0], excluded);
    const withdrawn = { ...message, isWithdrawn: true };
    assert.equal(c.prepareSharedLinkContext([withdrawn]).history[0], withdrawn);
    const long = c.sharedLinkMessage(c.makeSharedLink({ url: 'https://example.com', readableText: '长正文'.repeat(6200) }));
    const bounded = c.prepareSharedLinkContext([long]);
    assert.equal(bounded.sources[0].complete, false);
    assert.ok(bounded.history[0].content.length <= 18000 + long.content.length);
    assert.match(bounded.history[0].content, /【资料已截断】\n【用户分享的外部资料结束】$/);
    const userOnly = c.makeSharedLink({ url: 'https://example.com', readableText: '手动贴入的正文', metadataSource: 'tiktok-oembed' });
    assert.equal(userOnly.readableSource, 'user');
    assert.match(c.prepareSharedLinkContext([c.sharedLinkMessage(userOnly)]).history[0].content, /用户补充正文／字幕/);
});

test('TikTok preview uses a fixed credential-free endpoint and validates its returned provenance', async () => {
    const c = fixture();
    let request;
    const metadata = await c.fetchTikTokShareMetadata('https://www.tiktok.com/@person/video/123#tracking', {
        fetchImpl: async (url, options) => {
            request = { url, options };
            return { ok: true, status: 200, text: async () => JSON.stringify({ provider_name: 'TikTok', title: '公开标题', author_name: '作者', thumbnail_url: 'https://p16-sign-va.tiktokcdn.com/preview.jpg' }) };
        }
    });
    assert.equal(request.url, 'https://www.tiktok.com/oembed?url=' + encodeURIComponent('https://www.tiktok.com/@person/video/123'));
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.redirect, 'error');
    assert.equal(metadata.metadataSource, 'tiktok-oembed');
    assert.equal(metadata.title, '公开标题');
    assert.equal(metadata.thumbnailUrl, 'https://p16-sign-va.tiktokcdn.com/preview.jpg');
    const pasted = c.makeSharedLink({ url: 'https://example.com', readableText: 'pasted', readableSource: 'tiktok-oembed' });
    assert.equal(pasted.readableSource, 'user', 'external preview provenance cannot relabel pasted body text');
});

test('TikTok oEmbed player-only responses are not recorded or described as readable metadata', async () => {
    const c = fixture();
    const metadata = await c.fetchTikTokShareMetadata('https://www.tiktok.com/@person/video/6718335390845095173', {
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
            version: '1.0', type: 'video', provider_name: 'TikTok', embed_product_id: '6718335390845095173',
            html: '<iframe src="https://www.tiktok.com/player/v1/6718335390845095173"></iframe>'
        }) })
    });
    assert.equal(metadata.title, '');
    assert.equal(metadata.author, '');
    assert.equal(metadata.metadataSource, '', 'player markup alone is not readable preview metadata');
    assert.equal(metadata.status, 'link-only');
    assert.equal(metadata.previewStatus, 'player-only');
    assert.equal(Object.hasOwn(metadata, 'html'), false, 'provider iframe markup must not enter saved card data');
});

test('backup validation accepts old chats and valid link cards but rejects malformed links in live or archived history', () => {
    const c = backupFixture();
    const link = c.makeSharedLink({ url: 'https://example.com/story', title: '标题', readableText: '正文' });
    const valid = { id: 'link-1', role: 'user', type: 'link-share', linkShare: link, content: '[我分享了链接]', parts: [{ type: 'text', text: '[我分享了链接]' }] };
    assert.doesNotThrow(() => c.storageValidateModules({ characters: [{ id: 'old', history: [{ id: 'plain', content: 'ordinary URL https://example.org' }] }] }));
    assert.doesNotThrow(() => c.storageValidateModules({ characters: [{ id: 'new', history: [valid] }] }));
    for (const invalid of [{ ...valid, linkShare: { ...link, version: 2 } }, { ...valid, linkShare: { ...link, url: 'javascript:alert(1)' } }]) {
        assert.throws(() => c.storageValidateModules({ characters: [{ id: 'bad', history: [invalid] }] }), /链接|网址/);
        assert.throws(() => c.storageValidateModules({ characters: [{ id: 'bad', archives: [{ id: 'archive', data: { history: [invalid] } }] }] }), /链接|网址/);
    }
});
