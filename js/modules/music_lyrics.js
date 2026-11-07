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
    function parse(value){
        if(typeof value!=='string')return[];const raw=value.slice(0,100000).replace(/\\r\\n|\\n/g,'\n'),offset=Math.max(-60000,Math.min(60000,Number(raw.match(/\[offset:([+-]?\d+)\]/i)?.[1])||0))/1000,result=[];
        for(const line of raw.split(/\r?\n/)){const times=[...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];const words=format(line);for(const match of times)result.push({time:Math.max(0,Number(match[1])*60+Number(match[2])+Number('0.'+(match[3]||'0'))+offset),text:words});if(result.length>=4000)break;}
        return result.length?result.sort((a,b)=>a.time-b.time).slice(0,4000):format(raw).split('\n').map(text=>({time:null,text}));
    }
    root.UvUMusicLyrics = { format, parse };
})(typeof window !== 'undefined' ? window : globalThis);
