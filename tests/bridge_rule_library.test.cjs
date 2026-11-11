const {test}=require('node:test'),assert=require('node:assert/strict');
const rules=require('../js/modules/bridge_text.js');
function storage(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}
test('named body rules persist and transfer without story text or credentials',()=>{
 const a=storage(),b=storage();rules.saveRule(a,{name:'我的正文',preset:'custom',bodyTags:'Content 正文',excludeTags:'extra 小剧场'});
 const exported=rules.exportRules(a);rules.importRules(b,exported);
 const loaded=rules.readRuleLibrary(b);assert.equal(loaded.rules[0].bodyTags,'content 正文');
 assert.equal(loaded.selectedName,'我的正文');assert.equal(rules.previewRules('<content>正文<extra>旁白</extra></content>','custom',loaded.rules[0]).text,'正文');
 rules.removeRule(b,'我的正文');assert.equal(rules.readRuleLibrary(b).rules.length,0);assert.equal(rules.readRuleLibrary(b).selectedName,'');
 assert.equal(JSON.parse(exported).rules[0].token,undefined);
});
test('rule import validates whole batch and rejects conflicting names without partial writes',()=>{
 const s=storage();rules.saveRule(s,{name:'A',preset:'auto'});const before=rules.exportRules(s);
 assert.throws(()=>rules.importRules(s,JSON.stringify({format:'uvu-body-rules',version:1,rules:[{name:'B',preset:'content'},{name:'A',preset:'custom',bodyTags:'story'}]})),/同名/);
 assert.equal(rules.exportRules(s),before);
 for(const bad of [{name:'bad',preset:'custom',bodyTags:'<script>'},{name:'bad',preset:'auto',excludeTags:'x'.repeat(501)},{name:'bad',preset:'custom',bodyTags:'content',excludeTags:'content'}])assert.throws(()=>rules.saveRule(s,bad),/标签/);
 assert.throws(()=>rules.importRules(s,'x'.repeat(65537)),/过大/);
 assert.throws(()=>rules.importRules(s,JSON.stringify({format:'uvu-body-rules',version:2,rules:[]})),/格式/);
 assert.equal(rules.exportRules(s),before);
});
test('failed rule storage never reports a successful save and preview validates excluded tags',()=>{
 assert.throws(()=>rules.saveRule({getItem:()=>null,setItem:()=>{throw Error('quota');}},{name:'A',preset:'auto'}),/quota/);
 assert.throws(()=>rules.previewRules('<content>x</content>','auto',{excludeTags:'<extra>'}),/标签/);
});
