const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function format(value) {
    const c = vm.createContext({}); c.window = c;
    const file = path.join(__dirname, '../js/modules/music_lyrics.js');
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), c);
    return c.UvUMusicLyrics?.format(value);
}
test('lyrics presentation strips repeated LRC timing but preserves lyric lines', () => {
    assert.equal(format('[00:01.00][01:02.345]第一句\n[02:03]第二句'), '第一句\n第二句');
});
test('lyrics presentation omits metadata and enhanced word timing', () => {
    assert.equal(format('[ar:歌手]\n[ti:歌曲]\n[offset:-100]\n[00:10.20]<00:10.20>我<00:10.60>们'), '我们');
});
test('plain lyrics and literal bracketed text remain intact', () => {
    assert.equal(format('[Chorus]\r\n我们 [一起] 听\r\n\r\n下一段'), '[Chorus]\n我们 [一起] 听\n\n下一段');
});
test('escaped newlines and translated timing are cleaned for display only', () => {
    assert.equal(format('[00:01]Hello\\n[00:02.5]你好'), 'Hello\n你好');
});
test('lyrics formatter safely handles absent and bounded input', () => {
    assert.equal(format(null), ''); assert.equal(format({ lyric: 'x' }), '');
    assert.ok(format('字'.repeat(110000)).length <= 100000);
});
