// Derived bridge text only; source messages and prompt templates stay untouched.
(function(root) {
    'use strict';
    function fingerprint(value) {
        let hash = 2166136261;
        for (const point of String(value)) { hash ^= point.codePointAt(0); hash = Math.imul(hash, 16777619); }
        return (hash >>> 0).toString(16);
    }
    function clean(value, rules = '') {
        let text = String(value || '').replace(/\r\n/g, '\n');
        text = text.replace(/<(thinking|think|analysis|reasoning|cot|status|statusbar|status_panel|script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
            .replace(/<(thinking|think|analysis|reasoning|cot|status|statusbar|status_panel|script|style)\b[^>]*>[\s\S]*$/gi, '')
            .replace(/<details\b[^>]*>\s*<summary[^>]*>[^<]*(?:状态|思考|思维链|status|reasoning)[\s\S]*?<\/details>/gi, '')
            .replace(/\x60{3}([^\n\x60]*)\n([\s\S]*?)\x60{3}/g, (_, lang, body) => /^(?:js|javascript|ts|typescript|css|json|python|bash|sh|sql|thinking|analysis|reasoning|status)\b/i.test(lang.trim()) ? '' : body)
            .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[图片略]')
            .replace(/<img\b[^>]*>/gi, '[图片略]')
            .replace(/\[图片数据:[\s\S]*?\]/gi, '[图片略]');
        text = text.replace(/^\s*\[[^\]\r\n]{1,80}更新状态为[：:][^\]\r\n]*\]\s*$/gm, '');
        const tags = String(rules).split(/[,，\s]+/).filter(x => /^[a-z][a-z0-9_-]{0,40}$/i.test(x)).slice(0, 20);
        for (const tag of tags) text = text.replace(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi'), '');
        text = text.replace(/<(?:br|\/p|\/div|\/li|\/section|\/article|\/tr|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
        text = text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (all, n) => {
            const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
        }).replace(/&(lt|gt|amp|quot|apos|nbsp);/gi, (_, n) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase()]);
        return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    const BODY_TAGS = ['content', 'maintext', 'main_text', 'main-text', '正文', '正文内容', '正文部分', 'story', 'storytext', 'story_text', 'story-content', 'story_content', 'narrative', 'narration'];
    function extractStory(value, {bodyTags = '', excludeTags = ''} = {}) {
        let source = String(value || '').replace(/\r\n/g, '\n')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\[\s*UIBOARD(?:\||\s)[^\]]*\]/gi, '')
            .replace(/\x60{3}[^\n]*\n[\s\S]*?\x60{3}/g, '');
        const names = text => String(text).split(/[,，\s]+/u)
            .filter(tag => /^[a-z\u3400-\u9fff][a-z0-9_\-\u3400-\u9fff]{0,40}$/iu.test(tag))
            .map(tag => tag.toLowerCase()).slice(0, 20);
        const blocked = new Set(['think', 'thinking', 'analysis', 'reasoning', 'cot', 'status', 'statusbar', 'status_bar', 'status_panel', 'statusbox', 'status_box', 'uiboard', 'small_theater', 'smalltheater', 'mini_theater', 'theater', '小剧场', '状态栏', '状态', '思考', '思维链', 'script', 'style', 'iframe', 'object', 'svg', ...names(excludeTags)]);
        const tokens = text => [...text.matchAll(/<\s*(\/?)\s*([a-z\u3400-\u9fff][a-z0-9_\-\u3400-\u9fff]*)(?:\s[^<>]*?)?\s*(\/?)>/giu)];
        // Remove known side panels before looking for body wrappers inside them.
        let cut = -1, depth = 0, container = '';
        const ranges = [];
        for (const token of tokens(source)) {
            const name = token[2].toLowerCase(), closing = Boolean(token[1]);
            if (cut < 0 && !closing) {
                const sidePanel = name === 'details' && /^\s*<summary[^>]*>[^<]*(?:状态|思考|思维链|小剧场|番外|status|reasoning)/iu.test(source.slice(token.index + token[0].length));
                const styledPanel = /(?:class|id)\s*=\s*["'][^"']*(?:status[_-]?(?:bar|panel|box)?|small[_-]?theater|状态栏|小剧场)/iu.test(token[0]);
                if (blocked.has(name) || sidePanel || styledPanel) {
                    cut = token.index; container = name; depth = 1;
                    if (token[3]) { ranges.push([cut, token.index + token[0].length]); cut = -1; }
                }
            } else if (cut >= 0 && name === container) {
                if (!closing && !token[3]) depth++;
                else if (closing && --depth === 0) { ranges.push([cut, token.index + token[0].length]); cut = -1; }
            }
        }
        if (cut >= 0) ranges.push([cut, source.length]);
        for (let index = ranges.length - 1; index >= 0; index--) source = source.slice(0, ranges[index][0]) + source.slice(ranges[index][1]);
        const custom = names(bodyTags), candidates = custom.length ? custom : BODY_TAGS;
        for (const name of candidates) {
            let nesting = 0, start = 0, seen = false, malformed = false;
            const bodies = [];
            for (const token of tokens(source)) {
                if (token[2].toLowerCase() !== name) continue;
                seen = true;
                if (!token[1]) {
                    if (token[3]) { malformed = true; continue; }
                    if (nesting++ === 0) start = token.index + token[0].length;
                } else if (nesting > 0) {
                    if (--nesting === 0) bodies.push(source.slice(start, token.index));
                } else malformed = true;
            }
            if (seen) {
                if (nesting || malformed || !bodies.length) return {text: '', mode: 'malformed', tag: name};
                return {text: clean(bodies.join('\n\n')), mode: 'tagged', tag: name};
            }
        }
        source = source.replace(/^\s*\[UIBOARD[^\r\n]*$/gmi, '')
            .replace(/^\s*(?:小剧场|番外剧场|状态栏)\s*[：:][\s\S]*$/mu, '');
        return {text: clean(source), mode: 'plain', tag: ''};
    }
    function inspectStory(value, options = {}) {
        const result = extractStory(value, options), source = String(value || '');
        const tags = [...new Set([...source.matchAll(/<\s*\/?\s*([a-z\u3400-\u9fff][a-z0-9_\-\u3400-\u9fff]*)\b[^>]*>/giu)].map(match => match[1].toLowerCase()))];
        const blocked = new Set(['think','thinking','analysis','reasoning','cot','status','statusbar','status_bar','status_panel','statusbox','status_box','uiboard','small_theater','smalltheater','mini_theater','theater','小剧场','状态栏','状态','思考','思维链','script','style','iframe','object','svg', ...String(options.excludeTags || '').split(/[,，\s]+/u)]);
        const known = new Set([...BODY_TAGS, ...String(options.bodyTags || '').split(/[,，\s]+/u), 'p','div','span','b','strong','i','em','br','a','img','section','article','ul','ol','li','details','summary']);
        const filteredTags = tags.filter(tag => blocked.has(tag));
        const unknownTags = tags.filter(tag => !blocked.has(tag) && !known.has(tag));
        return {...result, filteredTags, unknownTags, sourceChars: source.length, extractedChars: result.text.length,
            requiresConfirmation: result.mode !== 'tagged' || unknownTags.length > 0};
    }
    function validateFloor(floor) {
        if (!floor || typeof floor !== 'object' || typeof floor.id !== 'string' || !floor.id || floor.id.length > 160 ||
            !Number.isInteger(floor.number) || floor.number < 1 || !['user', 'assistant'].includes(floor.role) ||
            typeof floor.speaker !== 'string' || floor.speaker.length > 120 ||
            !Number.isFinite(floor.createdAt) || floor.createdAt < 0 || floor.createdAt > 8640000000000000 ||
            !['plain', 'tagged'].includes(floor.extraction) || typeof floor.bodyTag !== 'string' || floor.bodyTag.length > 41 ||
            !Number.isInteger(floor.part) || !Number.isInteger(floor.partCount) || floor.partCount < 1 || floor.partCount > 2000 ||
            floor.part < 1 || floor.part > floor.partCount) throw new Error('酒馆剧情楼层信息无效；未导入。');
        let provenance;
        if(floor.provenance!==undefined){const report=floor.provenance;
            if(!report || !['filteredTags','unknownTags'].every(key=>Array.isArray(report[key]) && report[key].length<=40 && report[key].every(tag=>typeof tag==='string' && /^[a-z\u3400-\u9fff][a-z0-9_\-\u3400-\u9fff]{0,40}$/iu.test(tag))) ||
                !['sourceChars','extractedChars'].every(key=>Number.isSafeInteger(report[key]) && report[key]>=0)) throw new Error('剧情提取来源信息无效。');
            provenance={filteredTags:[...report.filteredTags],unknownTags:[...report.unknownTags],sourceChars:report.sourceChars,extractedChars:report.extractedChars};
        }
        return {id: floor.id, number: floor.number, speaker: floor.speaker, role: floor.role, createdAt: floor.createdAt,
            extraction: floor.extraction, bodyTag: floor.bodyTag, part: floor.part, partCount: floor.partCount, ...(provenance?{provenance}:{})};
    }
    function floorItems(parts, floorParts) {
        const items = [];
        let previousNumber = 0;
        const seen = new Set();
        for (let index = 1; index <= Object.keys(parts).length;) {
            const first = validateFloor(floorParts?.[index]);
            if (first.part !== 1 || seen.has(first.id) || first.number <= previousNumber) throw new Error('酒馆剧情楼层顺序不一致；未导入。');
            const {part, ...identity} = first, chunks = [];
            for (let offset = 0; offset < first.partCount; offset++) {
                const current = validateFloor(floorParts[index + offset]), {part: currentPart, ...other} = current;
                if (currentPart !== offset + 1 || JSON.stringify(other) !== JSON.stringify(identity) || typeof parts[index + offset] !== 'string') throw new Error('酒馆剧情楼层分段不完整或身份冲突；未导入。');
                chunks.push(parts[index + offset]);
            }
            // floors-v1 already contains extracted plain text; decoded literal tags are story too.
            const text = chunks.join('').replace(/\r\n/g, '\n').trim();
            if (!text) throw new Error('酒馆剧情楼层正文无效；未导入。');
            items.push({id: first.id, text, selected: false, floor: identity});
            seen.add(first.id); previousNumber = first.number; index += first.partCount;
        }
        return items;
    }
    function legacyFloorItems(value) {
        const text = String(value || ''), headers = [...text.matchAll(/^\[(\d{4}-\d\d-\d\dT[^\]\n]+|时间未知) \| ([^\]\n]+)\]\n/gm)];
        if (!headers.length || text.slice(0, headers[0].index).trim()) return [{id: 'legacy-1', text: clean(text), selected: false}].filter(item => item.text);
        return headers.map((header, index) => ({id: 'legacy-' + (index + 1),
            text: clean(text.slice(header.index + header[0].length, headers[index + 1]?.index ?? text.length)),
            selected: false, floor: {speaker: header[2], createdAt: Date.parse(header[1]) || 0, legacy: true}
        })).filter(item => item.text);
    }
    function memoryText(items) {
        return items.filter(item => item.selected && item.text).map(item => {
            const floor = item.floor;
            if (!floor) return item.text;
            const stamp = floor.createdAt ? new Date(floor.createdAt).toISOString() : '时间未知';
            return '[' + stamp + ' | ' + floor.speaker + ']\n' + item.text;
        }).join('\n\n');
    }
    function segments(value) {
        return clean(value).split(/\n\s*\n/).map(text => text.trim()).filter(Boolean).map((text, index) => ({ id: String(index + 1), text, selected: false }));
    }
    const api = { clean, fingerprint, extractStory, inspectStory, BODY_TAGS, validateFloor, floorItems, legacyFloorItems, memoryText, segments };
    root.UvUBridgeText = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
