(function () {
    'use strict';
    const forbidden = key => ['__proto__', 'prototype', 'constructor'].includes(String(key));
    const pathName = path => path.map((key, i) => typeof key === 'number' ? '[' + key + ']' : (i ? '.' : '') + key).join('') || '$';
    function assign(root, path, value) {
        if (!path.length || path.some(forbidden)) throw new Error('参数字段路径无效');
        let target = root;
        for (let i = 0; i < path.length - 1; i++) {
            if (!target[path[i]] || typeof target[path[i]] !== 'object') target[path[i]] = typeof path[i + 1] === 'number' ? [] : {};
            target = target[path[i]];
        }
        if (value === undefined) delete target[path.at(-1)]; else target[path.at(-1)] = value;
    }
    function explain(schema, value, path = [], depth = 0) {
        if (!schema || typeof schema !== 'object' || depth > 8) return '';
        const name = pathName(path), type = schema.type;
        const labels = { string: '文本', number: '数字', integer: '整数', boolean: '布尔值', object: '对象', array: '数组', null: '空值' };
        if (typeof type === 'string' && !(type === 'array' ? Array.isArray(value) : type === 'null' ? value === null : type === 'integer' ? Number.isInteger(value) : type === 'object' ? value && typeof value === 'object' && !Array.isArray(value) : typeof value === type)) return name + ' 需要' + labels[type];
        if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return name + ' 必须选择列表中的值';
        if (typeof value === 'number') {
            if (Number.isFinite(schema.minimum) && value < schema.minimum) return name + ' 不能小于 ' + schema.minimum;
            if (Number.isFinite(schema.maximum) && value > schema.maximum) return name + ' 不能大于 ' + schema.maximum;
        }
        if (typeof value === 'string' && Number.isFinite(schema.minLength) && Array.from(value).length < schema.minLength) return name + ' 至少 ' + schema.minLength + ' 个字';
        if (Array.isArray(value)) {
            if (Number.isFinite(schema.minItems) && value.length < schema.minItems) return name + ' 至少 ' + schema.minItems + ' 项';
            if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) return name + ' 最多 ' + schema.maxItems + ' 项';
            for (let i = 0; i < Math.min(value.length, 100); i++) { const error = explain(schema.items, value[i], [...path, i], depth + 1); if (error) return error; }
        } else if (value && typeof value === 'object') {
            for (const key of schema.required || []) if (!Object.hasOwn(value, key)) return pathName([...path, key]) + ' 为必填项';
            for (const key of Object.keys(value)) {
                if (forbidden(key)) return name + ' 含不允许的字段';
                if (schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key)) return pathName([...path, key]) + ' 是多余字段';
                const error = explain(schema.properties?.[key], value[key], [...path, key], depth + 1); if (error) return error;
            }
        }
        return '';
    }
    function environmentArguments(schema, value, location) {
        if (!location || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180 || !/^[A-Z]{2}$/.test(location.countryCode || '') || typeof location.timezone !== 'string' || !location.timezone) throw new Error('请先定位或选择一个有效的真实位置');
        const result = JSON.parse(JSON.stringify(value));
        const values = { latitude: location.latitude, lat: location.latitude, longitude: location.longitude, lon: location.longitude, lng: location.longitude,
            timezone: location.timezone, timeZone: location.timezone, countryCode: location.countryCode, country_code: location.countryCode, subdivision: location.subdivision || '' };
        function walk(item, path, depth) {
            if (!item || depth > 4) return;
            for (const [key, child] of Object.entries(item.properties || {})) {
                if (forbidden(key)) continue;
                if (Object.hasOwn(values, key) && ['number', 'string'].includes(child.type) && typeof values[key] === child.type) assign(result, [...path, key], values[key]);
                else if (child.type === 'object') walk(child, [...path, key], depth + 1);
            }
        }
        walk(schema, [], 0); return result;
    }
    function render(parent, schema, raw, validate, status) {
        let fields = 0;
        const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
        const read = () => { const value = JSON.parse(raw.value); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('请先修正 JSON 对象'); return value; };
        const get = path => { let value = read(); for (const key of path) value = value?.[key]; return value; };
        const update = (path, value) => { const root = read(); assign(root, path, value); raw.value = JSON.stringify(root, null, 2); validate(); };
        function walk(container, item, path, required, depth) {
            if (++fields > 60 || depth > 4 || !item || typeof item !== 'object' || path.some(forbidden)) return;
            const name = pathName(path), title = name + (required ? ' *' : '（可选）');
            if (item.type === 'object' && item.properties) {
                const group = node('fieldset'), legend = node('legend', title); group.className = 'mcp-field-group'; group.append(legend); container.append(group);
                for (const [key, child] of Object.entries(item.properties)) walk(group, child, [...path, key], item.required?.includes(key), depth + 1);
                return;
            }
            const wrap = node('label', title), input = node(Array.isArray(item.enum) || item.type === 'boolean' ? 'select' : ['array', 'object'].includes(item.type) ? 'textarea' : 'input');
            input.setAttribute('aria-label', title);
            if (input.tagName === 'SELECT') {
                input.append(new Option('未填写', ''));
                for (const value of item.enum || [true, false]) input.append(new Option(String(value), JSON.stringify(value)));
            } else if (input.tagName === 'INPUT') {
                input.type = ['number', 'integer'].includes(item.type) ? 'number' : 'text';
                if (item.minimum !== undefined) input.min = item.minimum; if (item.maximum !== undefined) input.max = item.maximum; if (item.type === 'integer') input.step = '1';
            }
            if (item.description) input.title = String(item.description).slice(0, 500);
            wrap.append(input); container.append(wrap);
            input.oninput = () => {
                try {
                    let value = input.value;
                    if (value === '' && !required) value = undefined;
                    else if (input.tagName === 'SELECT' || ['object', 'array'].includes(item.type)) value = JSON.parse(value);
                    else if (['integer', 'number'].includes(item.type)) { if (value === '') throw new Error(name + ' 需要数字'); value = Number(value); }
                    update(path, value); input.setAttribute('aria-invalid', 'false');
                } catch (error) { input.setAttribute('aria-invalid', 'true'); status.textContent = error.message; }
            };
            raw.addEventListener('input', () => { try { const value = get(path); input.value = value === undefined ? '' : input.tagName === 'SELECT' || ['object', 'array'].includes(item.type) ? JSON.stringify(value) : String(value); } catch (_) {} });
            if (item.type === 'array') input.placeholder = '[ ]';
        }
        for (const [key, item] of Object.entries(schema.properties || {})) walk(parent, item, [key], schema.required?.includes(key), 0);
        if (fields > 60) parent.append(node('p', '其余字段请展开 JSON 填写。'));
    }
    window.MCPForms = Object.freeze({ render, explain, assign, environmentArguments });
}());
