const test = require('node:test'), assert = require('node:assert/strict');
const helper = require('../js/modules/bridge_text.js');

test('incoming story extraction ignores nested status content and preserves paragraphs', () => {
    const result = helper.extractStory('<status><content>not story</content></status><content>第一段。\n\n第二段。</content><small_theater>extra</small_theater>');
    assert.equal(result.text, '第一段。\n\n第二段。');
    assert.equal(result.mode, 'tagged');
    assert.equal(helper.extractStory('<正文>正文</正文>').text, '正文');
    assert.equal(helper.extractStory('<custom>正文</custom>', {bodyTags: 'custom'}).text, '正文');
    assert.equal(helper.extractStory('<content>broken').mode, 'malformed');
    assert.equal(helper.extractStory('<content>[UIBOARD|003|状态栏]\n真实正文。</content>').text, '真实正文。');
});

test('extracted floor text stays literal and invalid dates are rejected', () => {
    const floor = {id: 'f', number: 1, speaker: 'A', role: 'assistant', createdAt: 1,
        extraction: 'tagged', bodyTag: 'content', part: 1, partCount: 1};
    const text = helper.extractStory('<content>她说 &lt;content&gt; 是标签名，&lt;status&gt;只是例子&lt;/status&gt;。</content>').text;
    assert.equal(helper.floorItems({1: text}, {1: floor})[0].text, text);
    assert.throws(() => helper.validateFloor({...floor, createdAt: 8640000000000001}), /楼层/);
});

test('extraction provenance reports filtered unknown and broken markup without changing story text',()=>{
 const result=helper.inspectStory('<status>hidden</status><mystery>剧情</mystery>');
 assert.equal(result.text,'剧情');assert.equal(result.requiresConfirmation,true);assert.ok(result.unknownTags.includes('mystery'));assert.ok(result.filteredTags.includes('status'));
 const tagged=helper.inspectStory('<content>正文</content>');assert.equal(tagged.tag,'content');assert.equal(tagged.requiresConfirmation,false);
 const broken=helper.inspectStory('<content>broken');assert.equal(broken.mode,'malformed');assert.equal(broken.requiresConfirmation,true);
});

test('validated floors retain bounded extraction provenance for manual review',()=>{
 const floor={id:'f',number:1,speaker:'A',role:'assistant',createdAt:0,extraction:'plain',bodyTag:'',part:1,partCount:1,provenance:{filteredTags:['status'],unknownTags:['custom'],sourceChars:99,extractedChars:2}};
 const validated=helper.validateFloor(floor);assert.deepEqual(validated.provenance.unknownTags,['custom']);assert.equal(validated.provenance.sourceChars,99);
 assert.throws(()=>helper.validateFloor({...floor,provenance:{...floor.provenance,unknownTags:['x'.repeat(50)]}}),/提取|楼层/);
});
