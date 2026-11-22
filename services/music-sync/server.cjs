'use strict';
// Independent room/control service. It never receives platform credentials or fetches audio.
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const token = () => randomBytes(24).toString('base64url');
const fail = (status, message) => Object.assign(new Error(message), { status });
const equal = (a,b) => {if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function song(raw) {
    if (raw === null) return null;
    if (!raw || !['netease','qq','gd-netease','navidrome','local'].includes(raw.provider) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 160) throw fail(400,'歌曲资料无效');
    const t = {provider:raw.provider,id:raw.id,title:String(raw.title || '').slice(0,300),artists:(Array.isArray(raw.artists) ? raw.artists : []).slice(0,20).map(s=>String(s).slice(0,160)),album:String(raw.album || '').slice(0,300),duration:Number.isFinite(raw.duration) ? Math.max(0,Math.min(86400,raw.duration)) : 0};
    if (raw.provider === 'navidrome') { if (!/^[a-f0-9]{64}$/.test(raw.serverId || '')) throw fail(400,'自建库标识无效'); t.serverId=raw.serverId; }
    return t;
}
function playlists(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.playlists) || raw.playlists.length > 100) throw fail(400,'同步资料版本或内容无效');
    const ids = new Set(); return {version:1,playlists:raw.playlists.map(p=>{
        if (!p || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.id) || ids.has(p.id) || !Array.isArray(p.tracks) || p.tracks.length > 1000) throw fail(400,'歌单资料无效');
        ids.add(p.id); return {id:p.id,name:String(p.name || '').slice(0,160),tracks:p.tracks.map(t=>{const value=song(t);if(!value)throw fail(400,'歌单歌曲无效');return value;})};
    })};
}
function createSyncServer(options = {}) {
    const rooms = new Map(), clients = new Map(), now = options.now || Date.now;
    const ttl = options.ttlMs || 2 * 60 * 60 * 1000, maxRooms = options.maxRooms || 100;
    const origins = new Set(options.allowedOrigins || []);
    const allowed = origin => !origin || origins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
    const cleanup = () => { const time=now(); for(const [id,r] of rooms) if(r.expiresAt <= time) rooms.delete(id); for(const [ip,v] of clients) if(time-v.since > 60000) clients.delete(ip); };
    const timer = setInterval(cleanup,30000); timer.unref();
    const server = http.createServer(async(req,res)=>{
        const respond = (status,value) => { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify({...value,serverTime:now()})); };
        try {
            const origin=req.headers.origin; if(!allowed(origin)) throw fail(403,'此网站未获准连接同步服务');
            if(origin){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');}
            if(req.method==='OPTIONS'){res.setHeader('access-control-allow-methods','GET,POST,OPTIONS');res.setHeader('access-control-allow-headers','Content-Type,Authorization');return respond(204,{});}
            cleanup(); const ip=req.socket.remoteAddress || 'unknown', rate=clients.get(ip) || {since:now(),count:0};rate.count++;clients.set(ip,rate);if(rate.count>500)throw fail(429,'请求过快，请稍后再试');
            const url=new URL(req.url,'http://localhost'); if(url.search)throw fail(400,'不允许在地址里传递密钥或查询参数');
            if(url.pathname==='/health'&&req.method==='GET')return respond(200,{ok:true,version:1});
            let body={};if(req.method==='POST'){if(!String(req.headers['content-type']).startsWith('application/json'))throw fail(415,'请发送 JSON');let bytes=0,parts=[];for await(const part of req){bytes+=part.length;if(bytes>2*1024*1024)throw fail(413,'同步资料过大');parts.push(part);}try{body=JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}catch(_){throw fail(400,'JSON 无效');}}
            if(req.method==='POST'&&url.pathname==='/v1/rooms'){
                if(body.version!==1)throw fail(409,'客户端版本不兼容');if(rooms.size>=maxRooms)throw fail(503,'房间已满');
                const id=randomBytes(8).toString('hex'),host=token(),invite=token(),r={id,host,invite,guest:null,expiresAt:now()+ttl,revision:0,playlists:{version:1,playlists:[]},state:{version:1,revision:0,track:null,playing:false,position:0,updatedAt:now()}};rooms.set(id,r);return respond(201,{id,token:host,invite,expiresAt:r.expiresAt});
            }
            const match=/^\/v1\/rooms\/([a-f0-9]{16})\/(join|state|control|leave|playlists)$/.exec(url.pathname);if(!match)throw fail(404,'接口不存在');
            const r=rooms.get(match[1]);if(!r)throw fail(410,'房间已关闭或过期');const action=match[2];
            if(action==='join'&&req.method==='POST'){
                if(body.version!==1)throw fail(409,'客户端版本不兼容');if(!equal(body.invite,r.invite))throw fail(403,'邀请口令无效');if(r.guest)throw fail(409,'此房间已有两人');r.guest=token();return respond(200,{token:r.guest,role:'guest',expiresAt:r.expiresAt});
            }
            const bearer=(req.headers.authorization || '').replace(/^Bearer /,'');const role=equal(bearer,r.host)?'host':r.guest&&equal(bearer,r.guest)?'guest':null;if(!role)throw fail(403,'没有房间权限');
            if(action==='state'&&req.method==='GET')return respond(200,{state:r.state,participants:{host:true,guest:!!r.guest},role,expiresAt:r.expiresAt});
            if(action==='control'&&req.method==='POST'){
                if(role!=='host')throw fail(403,'仅房主可以控制播放');if(body.version!==1)throw fail(409,'客户端版本不兼容');if(!Number.isFinite(body.position)||body.position<0||body.position>86400)throw fail(400,'播放进度无效');
                const time=now(),age=Number.isFinite(body.clientTime)?Math.max(0,Math.min(5,(time-body.clientTime)/1000)):0;
                r.state={version:1,revision:r.state.revision+1,track:song(body.track),playing:body.playing===true,position:Math.min(86400,body.position+(body.playing?age:0)),updatedAt:time};return respond(200,{state:r.state});
            }
            if(action==='playlists'){
                if(req.method==='GET')return respond(200,{snapshot:r.playlists,revision:r.revision});
                if(req.method==='POST'){if(body.version!==1)throw fail(409,'客户端版本不兼容');if(body.expectedRevision!==r.revision)throw fail(409,'歌单已在另一台设备修改，请重新预览差异');r.playlists=playlists(body.snapshot);r.revision++;return respond(200,{snapshot:r.playlists,revision:r.revision});}
            }
            if(action==='leave'&&req.method==='POST'){if(role==='host')rooms.delete(r.id);else r.guest=null;return respond(200,{closed:role==='host'});}
            throw fail(405,'不支持此请求方法');
        }catch(e){if(!res.headersSent)respond(e.status||500,{error:e.status?e.message:'同步服务暂时无法处理请求'});else res.end();}
    });
    server.on('close',()=>clearInterval(timer)); return {server,rooms,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
if(require.main===module){const app=createSyncServer({allowedOrigins:(process.env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean)});const port=Number(process.env.PORT)||3211;app.server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log('UvU music sync listening on '+port));}
module.exports={createSyncServer};
