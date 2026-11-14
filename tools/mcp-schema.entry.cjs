// Source for js/vendor/mcp_schema.js; see tools/MCP-SCHEMA.md.
const Ajv2020 = require('ajv/dist/2020').default;
const Ajv = require('ajv').default;
const formats = require('ajv-formats');
const options = { strict: false, allErrors: false, ownProperties: true, addUsedSchema: false, inlineRefs: false,
    coerceTypes: false, useDefaults: false, removeAdditional: false, loopRequired: 32, loopEnum: 32 };
const modern = formats(new Ajv2020(options), { mode: 'fast' });
const legacy = formats(new Ajv(options), { mode: 'fast' });
const cache = new Map();
function guard(value, depth = 0, state = { nodes: 0 }) {
    if (depth > 16 || ++state.nodes > 2500) throw Error('Schema/参数超过复杂度限制');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('Schema/参数包含不支持的属性');
        guard(child, depth + 1, state);
    }
}
// Walk actual schema positions only. enum/const/default/examples contain instance data.
function children(schema, includeDefinitions = true) {
    const list = [];
    for (const key of ['properties', 'dependentSchemas', ...(includeDefinitions ? ['$defs', 'definitions'] : [])]) {
        if (schema[key] && typeof schema[key] === 'object' && !Array.isArray(schema[key])) list.push(...Object.values(schema[key]));
    }
    if (schema.dependencies && typeof schema.dependencies === 'object') list.push(...Object.values(schema.dependencies).filter(v => !Array.isArray(v)));
    for (const key of ['additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'additionalItems', 'contentSchema']) if (schema[key] !== undefined) list.push(schema[key]);
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) if (Array.isArray(schema[key])) list.push(...schema[key]);
    if (Array.isArray(schema.items)) list.push(...schema.items); else if (schema.items !== undefined) list.push(schema.items);
    return list.filter(v => v && typeof v === 'object');
}
function inspect(schema, ajv) {
    const root = schema;
    const resolve = ref => {
        if (typeof ref !== 'string' || !ref.startsWith('#/')) throw Error('Schema 仅支持本地 #/ 引用');
        let value = root;
        try { for (const part of ref.slice(2).split('/').map(x => decodeURIComponent(x).replace(/~1/g, '/').replace(/~0/g, '~'))) {
            if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw Error();
            value = value[part];
        } } catch (_) { throw Error('Schema 本地引用无效'); }
        if (typeof value !== 'boolean' && (!value || typeof value !== 'object' || Array.isArray(value))) throw Error('Schema 引用目标无效');
        return value;
    };
    const inspectNode = (node, nested) => {
        if (['pattern', 'patternProperties', '$dynamicRef', '$recursiveRef'].some(key => Object.hasOwn(node, key))) throw Error('此版暂不支持含正则或动态引用的 Schema');
        if (nested && node.$id) throw Error('Schema 暂不支持嵌套 $id 引用作用域');
        if (Object.hasOwn(node, 'format') && (typeof node.format !== 'string' || !Object.hasOwn(ajv.formats, node.format))) throw Error('Schema format 格式暂不支持');
        if (Object.hasOwn(node, '$ref')) resolve(node.$ref);
    };
    const visit = (node, depth = 0) => {
        inspectNode(node, depth > 0);
        for (const child of children(node)) visit(child, depth + 1);
    };
    visit(schema);
    const memo = new WeakMap(), active = new Set();
    let hasUnique = false;
    function cost(node) {
        if (typeof node === 'boolean') return 1;
        if (active.has(node)) throw Error('Schema 递归引用暂不支持');
        if (memo.has(node)) return memo.get(node);
        // A local ref can turn otherwise literal example/const data into a schema.
        inspectNode(node, node !== root);
        if (node.uniqueItems === true) hasUnique = true;
        active.add(node); let total = 1;
        const targets = children(node, false);
        if (node.$ref) targets.push(resolve(node.$ref));
        for (const child of targets) { total += cost(child); if (total > 2000) throw Error('Schema 引用展开复杂度超过限制'); }
        active.delete(node); memo.set(node, total); return total;
    }
    // Check definitions too: referenced schemas must not hide a costly/recursive graph.
    const checkCost = node => { cost(node); children(node).forEach(checkCost); };
    checkCost(schema);
    return { nodes: cost(schema), hasUnique };
}
function compile(schema) {
    const key = JSON.stringify(schema);
    if (!key || new TextEncoder().encode(key).length > 65536) throw Error('Schema 大小超过 64 KiB 限制');
    guard(schema);
    if (schema.$schema && !['https://json-schema.org/draft/2020-12/schema', 'http://json-schema.org/draft-07/schema#', 'http://json-schema.org/draft-07/schema'].includes(schema.$schema)) throw Error('Schema 草案暂不支持');
    if (cache.has(key)) return cache.get(key);
    let validator;
    const ajv = schema.$schema?.includes('draft-07') ? legacy : modern;
    const work = inspect(schema, ajv);
    try { validator = ajv.compile(schema); ajv.removeSchema(schema); }
    catch (_) { throw Error('Schema 格式或本地引用无效'); }
    const validate = value => {
        try {
            const state = { nodes: 0 };
            guard(value, 0, state);
            // Pairwise object equality can multiply schema work by instance size squared.
            if (work.hasUnique && work.nodes * state.nodes * state.nodes > 1000000) return false;
            return new TextEncoder().encode(JSON.stringify(value)).length <= 32768 && validator(value);
        } catch (_) { return false; }
    };
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(key, validate); return validate;
}
window.MCPSchema = Object.freeze({ compile });
