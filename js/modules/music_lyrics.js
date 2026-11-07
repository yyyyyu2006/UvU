// Display-only LRC cleanup. Keep provider responses and stored lyrics untouched.
(function (root) {
    'use strict';
    function format(value) {
        if (typeof value !== 'string') return '';
        return value.slice(0, 100000).replace(/\\r\\n|\\n/g, '\n').replace(/\r\n?/g, '\n')
            .split('\n').filter(line => !/^\s*\[(?:ar|al|ti|au|by|offset|re|ve|length|tool|id):[^\]]*\]\s*$/i.test(line))
            .map(line => line.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim())
            .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    root.UvUMusicLyrics = { format };
})(typeof window !== 'undefined' ? window : globalThis);
