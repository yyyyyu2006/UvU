const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function realm() {
    const file = path.join(__dirname, '../js/vendor/mcp_schema.js');
    assert.ok(fs.existsSync(file), 'local MCP JSON Schema validator required');
    const c = vm.createContext({ window: {}, TextEncoder }); vm.runInContext(fs.readFileSync(file, 'utf8'), c); return c;
}
function api() { return realm().window.MCPSchema; }
test('MCP schema validates nested, required, enum, additional properties and composition without coercion', () => {
    const v = api().compile({ type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string', minLength: 2 }, n: { type: 'integer', minimum: 1, maximum: 10 }, mode: { enum: ['a', 'b'] }, nested: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'boolean' } }] } } });
    assert.equal(v({ query: '北京', n: 2, mode: 'a', nested: [true] }), true);
    for (const input of [{}, { query: 'x' }, { query: 'yes', n: '2' }, { query: 'yes', extra: true }, { query: 'yes', nested: [1] }]) assert.equal(v(input), false);
});
test('MCP schema supports local refs and both modern/draft7; refuses remote refs and costly schemas', () => {
    const s = api();
    assert.equal(s.compile({ type: 'object', $defs: { n: { type: 'number' } }, properties: { n: { $ref: '#/$defs/n' } } })({ n: 'x' }), false);
    assert.equal(s.compile({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', required: ['a'] })({}), false);
    for (const schema of [{ $ref: 'https://remote/schema' }, { type: 'string', pattern: '(a+)+$' }, { $schema: 'https://not-supported/schema' }, { type: 'object', properties: { big: { description: 'x'.repeat(66000) } } }]) assert.throws(() => s.compile(schema), /schema|Schema|正则|限制|格式|草案|引用/);
});
test('MCP schema allows ordinary parameter names that coincide with schema keywords', () => {
    const v=api().compile({type:'object',properties:{pattern:{type:'string'},constructorName:{type:'string'}},required:['pattern']});
    assert.equal(v({pattern:'abc',constructorName:'test'}),true);
});
test('MCP rejects exponential reference graphs before validation', () => {
    const s=api(), defs={};
    for(let i=0;i<32;i++)defs['n'+i]=i===31?{type:'object'}:{allOf:[{$ref:'#/$defs/n'+(i+1)},{$ref:'#/$defs/n'+(i+1)}]};
    assert.throws(()=>s.compile({type:'object',$defs:defs,$ref:'#/$defs/n0'}),/复杂|引用|限制/);
});
test('MCP rejects recursive schemas before validation',()=>{
    assert.throws(()=>api().compile({type:'object',$defs:{r:{type:'object',properties:{next:{$ref:'#/$defs/r'}}}},$ref:'#/$defs/r'}),/递归|引用|限制/);
});
test('MCP rejects unknown formats instead of silently skipping validation',()=>{
    const s=api();
    assert.throws(()=>s.compile({type:'object',properties:{value:{type:'string',format:'unknown-private-format'}}}),/format|格式/);
    const known=s.compile({type:'object',properties:{date:{type:'string',format:'date'}}});assert.equal(known({date:'not-a-date'}),false);
});
test('MCP validates enum and const literal data without treating pattern or $ref as schema', () => {
    // Browser schemas and form data share one realm. Ajv's object equality checks
    // constructors, so host-VM object literals would produce an artificial mismatch.
    const c=realm();
    vm.runInContext(`const literal={nested:{pattern:'literal',$ref:'https://literal.test'}};
        const v=window.MCPSchema.compile({type:'object',properties:{choice:{enum:[{pattern:'literal'}]},fixed:{const:literal},defaulted:{type:'object',default:literal}},required:['choice','fixed']});`,c);
    assert.equal(vm.runInContext("v({choice:{pattern:'literal'},fixed:literal})",c),true);
    assert.equal(vm.runInContext("v({choice:{pattern:'other'},fixed:literal})",c),false);
});
