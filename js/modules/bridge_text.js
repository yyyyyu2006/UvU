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
    function segments(value) {
        return clean(value).split(/\n\s*\n/).map(text => text.trim()).filter(Boolean).map((text, index) => ({ id: String(index + 1), text, selected: false }));
    }
    const api = { clean, fingerprint, segments };
    root.UvUBridgeText = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
