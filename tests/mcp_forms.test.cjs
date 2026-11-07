const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function api(){const file=path.join(__dirname,'../js/modules/mcp_forms.js');assert.ok(fs.existsSync(file));const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(file,'utf8'),c);return c.window.MCPForms;}
test('MCP nested field diagnostics include the exact path and meaningful type/range',()=>{
    const f=api(),schema={type:'object',properties:{location:{type:'object',properties:{lat:{type:'number',minimum:-90,maximum:90}},required:['lat']},tags:{type:'array',items:{type:'string'},maxItems:2}},required:['location']};
    assert.match(f.explain(schema,{location:{lat:200}}),/location.lat.*90/);assert.match(f.explain(schema,{location:{}}),/location.lat.*必填/);assert.match(f.explain(schema,{location:{lat:12},tags:[2]}),/tags\[0\].*文本/);assert.equal(f.explain(schema,{location:{lat:12},tags:['a']}),'');
});
test('MCP field setters reject prototype paths and keep unrelated JSON keys',()=>{
    const f=api(),value={city:'a'};assert.throws(()=>f.assign(value,['__proto__','x'],'bad'),/字段/);f.assign(value,['location','lat'],2);assert.equal(value.location.lat,2);assert.equal(value.city,'a');f.assign(value,['location','lat'],undefined);assert.equal(Object.hasOwn(value.location,'lat'),false);
});
test('MCP location fill uses explicit real coordinates and only declared schema fields',()=>{
    const f=api(),schema={type:'object',properties:{query:{type:'string'},location:{type:'object',properties:{latitude:{type:'number'},longitude:{type:'number'},timezone:{type:'string'}}},countryCode:{type:'string'}}};
    const filled=f.environmentArguments(schema,{query:'keep'},{latitude:31.2,longitude:121.5,countryCode:'CN',timezone:'Asia/Shanghai'});
    assert.equal(filled.query,'keep');assert.equal(filled.location.latitude,31.2);assert.equal(filled.countryCode,'CN');assert.equal(Object.hasOwn(filled,'timezone'),false);
    assert.throws(()=>f.environmentArguments(schema,{},null),/定位|位置/);assert.throws(()=>f.environmentArguments(schema,{}, {latitude:100,longitude:0,countryCode:'CN',timezone:'Asia/Shanghai'}),/位置/);
});
