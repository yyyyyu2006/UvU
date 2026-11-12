const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = path.join(__dirname, '../js/modules/music_public.js');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
    let now = 1000000;
    class Clock extends Date { static now() { return now; } }
    const calls = [], values = new Map(), h = { status: 200, body: [], set now(v) { now = v; } };
    const context = vm.createContext({ URL, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, Date: Clock,
        sessionStorage: { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v) },
        fetch: async (url, options) => { calls.push({url, options}); if (h.reply) return h.reply(url,options); return { ok: h.status === 200, status: h.status, headers:{get:()=>null}, text: async () => JSON.stringify(h.body) }; } });
    context.window = context;
    if (fs.existsSync(source)) vm.runInContext(fs.readFileSync(source,'utf8'),context);
    return Object.assign(h,{api:context.UvUPublicMusic,calls,context});
}
const row = {id:'1857979755',name:'LOFi',artist:['WhoYouth'],album:'LOFi',pic_id:'109951166139384942',source:'netease'};
test('recommendation artwork uses a validated image endpoint and caches covers without audio calls',async()=>{
 const h=fixture(),track={provider:'gd-netease',id:'123',artworkId:'456'};h.body={url:'https://p3.music.126.net/cover.jpg'};
 assert.equal(await h.api.artwork(track),'https://p3.music.126.net/cover.jpg');await h.api.artwork(track);assert.equal(h.calls.length,1);
 const params=new URL(h.calls[0].url).searchParams;assert.equal(params.get('types'),'pic');assert.equal(params.get('size'),'500');
 assert.equal(await h.api.artwork({...track,artworkId:'bad'}),'');h.body={url:'http://foreign.invalid/image.jpg'};assert.equal(await h.api.artwork({...track,artworkId:'789'}),'');
 const controller=new AbortController();controller.abort();await assert.rejects(h.api.artwork(track,controller.signal),{name:'AbortError'});
});

test('explicit public version selection keeps the original identity and can be revoked', async()=>{
    const h=fixture(),track={provider:'qq',id:'qq-original',title:'LOFi',artists:['WhoYouth'],album:''};
    h.body=[row,{...row,id:'456',album:'Compilation'}];
    const choices=await h.api.candidates(track);assert.equal(choices.length,2);
    assert.throws(()=>h.api.chooseMatch(track,{...choices[0],id:'999'}),/候选|过期/);
    h.api.chooseMatch(track,choices[1]);assert.equal((await h.api.match(track)).id,'456');assert.equal(track.id,'qq-original');
    h.api.clearMatch(track);await assert.rejects(h.api.match(track),/版本|匹配/);
});

test('platform matching keeps NetEase identity and QQ requires title and artist agreement', async () => {
    const h=fixture(), original={provider:'netease',id:'123',title:'Track',artists:['Singer'],album:'Record',cover:'https://p3.music.126.net/cover.jpg'};
    const direct=await h.api.match(original);
    assert.equal(direct.id,'123');assert.equal(direct.provider,'gd-netease');assert.equal(h.calls.length,0);
    const qq={provider:'qq',id:'QQMID',title:'LOFi',artists:['WhoYouth'],album:'LOFi'};
    h.body=[{...row,id:'111',artist:['Someone Else']},{...row,id:'222',name:'LOFi (Live)'},row];
    const found=await h.api.match(qq);assert.equal(found.id,row.id);assert.equal(qq.id,'QQMID');
    await h.api.match(qq);assert.equal(h.calls.length,1,'matching is cached without storing audio');
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(h.api.match(qq,cancelled.signal),{name:'AbortError'});
    await assert.rejects(h.api.match({...qq,title:'Different'}),/匹配|一致/);
});

test('matching rejects ambiguous recordings, missing singers and unsupported identities', async () => {
    const h=fixture(),qq={provider:'qq',id:'abc',title:'LOFi',artists:['WhoYouth'],album:''};
    h.body=[row,{...row,id:'456',album:'Compilation'}];
    await assert.rejects(h.api.match(qq),/版本|匹配/);
    await assert.rejects(h.api.match({...qq,artists:[]}),/歌手/);
    h.api.clearCache();h.body=[{...row,artist:['WhoYouth','Guest']}];
    await assert.rejects(h.api.match(qq),/匹配/,'a duet is not interchangeable with the original solo recording');
    await assert.rejects(h.api.match({provider:'netease',id:'bad'}),/标识/);
    await assert.rejects(h.api.match({provider:'local',id:'123'}),/来源/);
});

test('clearing public metadata removes QQ matching results as well as search results', async () => {
    const h=fixture();h.body=[row];const qq={provider:'qq',id:'abc',title:'LOFi',artists:['WhoYouth']};
    await h.api.match(qq);h.api.clearCache();await h.api.match(qq);assert.equal(h.calls.length,2);
});
test('QQ matching cache is bounded, expires, and cancelled pending searches never populate it', async () => {
    const h=fixture();h.body=[row];const qq={provider:'qq',id:'0',title:'LOFi',artists:['WhoYouth']};
    await h.api.match(qq);
    for(let n=1;n<=100;n++)await h.api.match({...qq,id:String(n)});
    assert.equal(h.calls.length,1,'search metadata is reused without bulk network requests');
    h.now=1061000;await h.api.match(qq);assert.equal(h.calls.length,2,'oldest matching record was evicted');
    h.now=88001000;await h.api.match(qq);assert.equal(h.calls.length,3,'matching records expire');
    let finish;h.reply=()=>new Promise(resolve=>finish=resolve);
    const controller=new AbortController(),pending=h.api.match({...qq,title:'Pending'},controller.signal);
    controller.abort();finish({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify([{...row,name:'Pending'}])});
    await assert.rejects(pending,{name:'AbortError'});
    h.reply=null;h.body=[{...row,name:'Pending'}];await h.api.match({...qq,title:'Pending'});
    assert.equal(h.calls.length,5,'cancelled metadata was not cached');
});
test('public search uses the documented source, bounds fields, and never sends login state', async () => {
    const h=fixture(); assert.ok(h.api,'public adapter exists'); h.body=[{...row,cookie:'private',url:'https://private.test'}];
    const result=await h.api.search('gd-netease','lofi',1);
    assert.equal(result.tracks[0].provider,'gd-netease'); assert.equal(result.tracks[0].artworkId,row.pic_id);
    assert.equal(result.tracks[0].cookie,undefined); assert.equal(result.tracks[0].url,undefined);
    assert.equal(new URL(h.calls[0].url).origin,'https://music-api.gdstudio.xyz');
    assert.equal(new URL(h.calls[0].url).searchParams.get('source'),'netease');
    assert.equal(h.calls[0].options.credentials,'omit'); assert.equal(h.calls[0].options.referrerPolicy,'no-referrer');
    assert.equal(h.calls[0].options.headers.Authorization,undefined);
    await assert.rejects(h.api.search('qq','x',1),/来源/);
});
test('public search caches bounded results, expires them, and rejects non-array payloads', async () => {
    const h=fixture(); h.body=[row]; await h.api.search('gd-netease','lofi',1); await h.api.search('gd-netease','lofi',1);
    assert.equal(h.calls.length,1); h.now=1061000; await h.api.search('gd-netease','lofi',1); assert.equal(h.calls.length,2);
    h.body={error:'bad'}; await assert.rejects(h.api.search('gd-netease','different',1),/格式/);
});
test('unavailable, insecure or foreign public streams cannot play; successful rights remain unknown', async () => {
    const h=fixture(), track={provider:'gd-netease',id:row.id};
    for (const url of ['', 'http://m801.music.126.net/a.mp3', 'https://evil.test/a.mp3', 'https://m801.music.126.net@evil.test/a.mp3']) {
        h.body={url}; await assert.rejects(h.api.stream(track),/播放|地址/);
    }
    h.body={url:'https://m801.music.126.net/a.mp3',br:128};
    assert.deepEqual(plain(await h.api.stream(track)),{url:h.body.url,availability:'unknown'});
    assert.equal(new URL(h.calls.at(-1).url).searchParams.get('br'),'128');
    await assert.rejects(h.api.stream({provider:'gd-netease',id:'../bad'}),/标识/);
});
test('lyrics decode the published escaped newlines and stay plain bounded text', async () => {
    const h=fixture(); h.body={lyric:'[00:00]one\\n[00:01]two',tlyric:'译文',cookie:'private'};
    const result=await h.api.lyrics({provider:'gd-netease',id:row.id});
    assert.equal(result.lyric,'[00:00]one\n[00:01]two'); assert.equal(result.translation,'译文');
    await h.api.lyrics({provider:'gd-netease',id:row.id}); assert.equal(h.calls.length,1);
});
test('rate limits are bounded locally and upstream 429 is explained without retry storms', async () => {
    const h=fixture(); h.body=[row];
    for(let n=0;n<45;n++) await h.api.search('gd-netease','query'+n,1);
    await assert.rejects(h.api.search('gd-netease','too many',1),/频繁/); assert.equal(h.calls.length,45);
    h.now=1301000; await h.api.search('gd-netease','later',1); assert.equal(h.calls.length,46);
    const limited=fixture(); limited.status=429; await assert.rejects(limited.api.search('gd-netease','x',1),/频繁/);
    await assert.rejects(limited.api.search('gd-netease','y',1),/频繁/); assert.equal(limited.calls.length,1);
});
test('cancelled and oversized responses never return successful search data', async () => {
    const h=fixture(), controller=new AbortController(); controller.abort();
    await assert.rejects(h.api.search('gd-netease','x',1,controller.signal),{name:'AbortError'}); assert.equal(h.calls.length,0);
    h.reply=async()=>({ok:true,headers:{get:()=>String(3*1024*1024)},text:async()=> '[]'});
    await assert.rejects(h.api.search('gd-netease','x',1),/过大/);
});
