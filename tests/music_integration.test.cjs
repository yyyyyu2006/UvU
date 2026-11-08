const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
test('music is an independent home entry and loads before app initialization', () => {
    const ui = read('js/ui.js'), page = read('index.html');
    assert.match(ui, /'app-uvu-music':/);
    assert.match(ui, /data-target="uvu-story-bridge-screen"/);
    assert.match(page, /music_core\.js/); assert.match(page, /music_ui\.js/);
    assert.ok(page.indexOf('music_core.js') < page.indexOf('music_chat.js'));
    assert.ok(page.indexOf('music_ui.js') < page.indexOf('js/main.js'));
});
test('music metadata export strips source URLs and unrecognized credentials regardless of export mode', () => {
    const sandbox = {URL,window:{UvUMusic:{normalizeLibrary:raw => ({favorites:raw.favorites.map(({token,url,...t})=>t),playlists:[],recent:[],queue:[]})}}, console};
    vm.createContext(sandbox); vm.runInContext(read('js/modules/storage_features.js'), sandbox);
    const value = sandbox.storageApplyExportOptions({musicLibrary:{favorites:[{id:'a',token:'secret',url:'https://media.invalid/signed'}]},musicSettings:{endpoint:'https://music.invalid',cookie:'secret'}},{});
    assert.equal(value.musicLibrary.favorites[0].token, undefined);
    assert.equal(value.musicLibrary.favorites[0].url, undefined);
    assert.equal(value.musicSettings.cookie, undefined);
});

test('portable music settings retain only explicitly enabled known public sources', () => {
    const sandbox={URL,window:{},console};vm.createContext(sandbox);vm.runInContext(read('js/modules/storage_features.js'),sandbox);
    const result=sandbox.storagePortableMusicSettings({endpoint:'',publicSources:['gd-netease','unknown'],remember:true,token:'secret'});
    assert.deepEqual(JSON.parse(JSON.stringify(result.publicSources)),['gd-netease']);assert.equal(result.token,undefined);assert.equal(result.remember,false);
    assert.match(read('index.html'), /music_public\.js/);
    const preferred=sandbox.storagePortableMusicSettings({...result,playbackSource:'public',remember:true});
    assert.equal(preferred.playbackSource,'public');assert.equal(preferred.remember,false);
    assert.equal(sandbox.storagePortableMusicSettings({...preferred,publicSources:[]}).playbackSource,undefined);
    assert.equal(sandbox.storagePortableMusicSettings({...preferred,playbackSource:'unknown'}).playbackSource,undefined);
});
