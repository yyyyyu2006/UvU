'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture() {
    const c = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/reader_parser.js'), 'utf8'), c);
    return c;
}
for (const [pattern, first, second] of [
    ['AUTO', '第一章 开始', '第二章 继续'], ['CHINESE_NUM', '第一章', '第二章'],
    ['ENGLISH_CHAPTER', 'Chapter 1', 'cHaPtEr 2'], ['PURE_DIGIT', '1. 开始', '2、继续'],
    ['BRACKETS', '（一）开始', '(2)继续'], ['SPECIAL', '序言', '尾声']
]) test(`reader ${pattern} separates complete lines without swallowing body text`, () => {
    const c = fixture();
    const result = JSON.parse(JSON.stringify(c.parseChapters(`开场正文\r\n\r\n  ${first}\r\n第一段正文\r\n\r\n${second}\r\n第二段正文`, pattern)));
    assert.deepEqual(result, [{ title: '前言/简介', content: '开场正文' }, { title: first, content: '第一段正文' }, { title: second, content: '第二段正文' }]);
});
test('AUTO headings cannot consume the first paragraph or span multiple lines', () => {
    const c = fixture();
    const result = JSON.parse(JSON.stringify(c.parseChapters('Chapter 1\nParagraph one\n\nChapter 2\nParagraph two')));
    assert.deepEqual(result, [{ title: '前言/简介', content: '' }, { title: 'Chapter 1', content: 'Paragraph one' }, { title: 'Chapter 2', content: 'Paragraph two' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(c.parseChapters('（这不是\n跨行标题）\n正文'))), [{ title: '前言/简介', content: '（这不是\n跨行标题）\n正文' }]);
});
test('long blank-line TXT files stay within a bounded parse time for every preset', () => {
    const c = fixture();
    // Limit execution even on unfixed code: a regression must fail instead of hanging the suite.
    for (const separator of ['\n', ' \t\n', '\u2028', '\u2029']) {
      c.text = separator.repeat(64000) + '正文';
      for (const key of ['AUTO', 'CHINESE_NUM', 'ENGLISH_CHAPTER', 'PURE_DIGIT', 'BRACKETS', 'SPECIAL']) {
        c.key = key;
        const result = vm.runInContext('parseChapters(text,key)', c, { timeout: 1000 });
        assert.equal(result.length, 1); assert.equal(result[0].content, '正文');
      }
    }
});
test('unknown chapter presets fall back to AUTO and plain text remains intact', () => {
    const c = fixture();
    assert.deepEqual(JSON.parse(JSON.stringify(c.parseChapters('普通正文\n第二段', 'missing'))), [{ title: '前言/简介', content: '普通正文\n第二段' }]);
    assert.equal(c.parseChapters('', 'AUTO')[0].content, '');
});
test('numeric headings still accept horizontal Unicode spacing', () => {
    const c = fixture();
    for (const space of ['\t', '\u00a0', '\u3000']) for (const key of ['AUTO', 'PURE_DIGIT']) {
        const result = c.parseChapters(`1.${space}标题\n正文`, key);
        assert.equal(result.at(-1).title, `1.${space}标题`); assert.equal(result.at(-1).content, '正文');
    }
});
