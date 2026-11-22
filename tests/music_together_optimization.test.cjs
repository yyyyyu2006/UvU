const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const song=(id='one',extra={})=>({provider:'netease',id,title:id,artists:['Artist'],album:'',cover:'',duration:120,...extra});
const key=t=>t.provider+':'+(t.serverId?t.serverId+':':'')+t.id;
function fixture(){const chat={id:'a',activeArchiveId:'one',history:[]},h={chat,plays:[],toggles:0,state:{track:song(),queue:[song(),song('two')],queueVersion:1,queueLabel:'我的队列',phase:'playing',playing:true}},c=vm.createContext({console,URL,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,db:{characters:[chat],groups:[]},currentChatType:'private',currentChatId:'a',captureChatSendTarget:()=>({chat,chatId:'a',archiveId:'one',history:chat.history,type:'private'}),isChatSendTargetValid:t=>t.archiveId===chat.activeArchiveId&&t.history===chat.history,relationshipCanSend:()=>true,relationshipCanChat:()=>true,beginChatMutation:(chat,type,messages)=>({chat,before:structuredClone(chat.history),messages}),saveChatMutation:async()=>true,isChatTargetVisible:()=>false,renderChatList(){},UvUMusic:{normalizeTrack:t=>({...t}),key,lyrics:async()=>({lyric:'[00:00]第一句'}),player:{play:async track=>{h.plays.push(track);h.state={...h.state,track,phase:'playing',playing:true};return true;},snapshot:()=>h.state,toggle:async()=>{h.toggles++;h.state.playing=!h.state.playing;},stop(){}}}});c.window=c;vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/music_chat.js'),'utf8'),c);return{...h,c,api:c.UvUMusicChat,get state(){return h.state;},set state(v){h.state=v;},get toggles(){return h.toggles;}};}
async function accepted(h,track=song()){await h.api.share(track,{invite:true});const message=h.chat.history[0];message.music.invitation.status='accepted';await h.api.listen(track,{chat:h.chat,message});return message;}
const command=(id,action='accept')=>'<uvu_music>'+JSON.stringify({invitationId:id,action})+'</uvu_music>';

test('M34 bound queue follows next song, pauses on new queue, and explicit adoption preserves historical invitation',async()=>{
    const h=fixture(),message=await accepted(h),before=JSON.stringify(message);assert.equal(h.api.setContinuous(true),true);h.state={...h.state,track:song('two')};assert.equal(h.api.session().track.id,'two');assert.equal(h.api.session().localPlayback,true);h.state={...h.state,track:song('foreign'),queue:[song('foreign')],queueVersion:2,queueLabel:'新队列'};assert.equal(h.api.session().localPlayback,false);assert.equal(h.api.session().track.id,'two');assert.equal(h.api.adoptCurrentQueue(),true);assert.equal(h.api.session().track.id,'foreign');assert.equal(h.api.session().queueLabel,'新队列');assert.equal(JSON.stringify(message),before);
});
test('M34 disabling continuous mode freezes last together track and new inserts are not silently admitted',async()=>{
    const h=fixture();await accepted(h);h.api.setContinuous(true);h.state={...h.state,track:song('two')};assert.equal(h.api.session().track.id,'two');h.api.setContinuous(false);h.state={...h.state,track:song('one')};assert.equal(h.api.session().localPlayback,false);assert.equal(h.api.session().track.id,'two');h.state={...h.state,track:song('two')};h.api.setContinuous(true);h.state={...h.state,track:song('inserted'),queue:[song('inserted'),song('two')],queueVersion:3};assert.equal(h.api.session().localPlayback,false);assert.ok(!h.api.session().queueKeys.includes('netease:inserted'));
});
test('M33 ending a room during awaited playback cannot revive it',async()=>{
    const h=fixture(),message=await accepted(h);let finish;h.c.UvUMusic.player.play=()=>new Promise(resolve=>finish=resolve);const pending=h.api.listen(song(),{chat:h.chat,message});await h.api.end();finish(true);assert.equal(await pending,false);assert.equal(h.api.session(),null);assert.equal(message.music.invitation.status,'ended');
});
test('M33 hidden pending invitations are not included in request plans',async()=>{
    const h=fixture();await h.api.share(song(),{invite:true});h.chat.history[0].isHidden=true;assert.equal(h.api.requestPlan(h.chat.history,h.chat).invitations.length,0);
});
test('M33 hiding an accepted source ends its live binding without altering the card facts',async()=>{
    const h=fixture(),message=await accepted(h);message.isHidden=true;assert.equal(h.api.session(),null);assert.equal(message.music.invitation.status,'accepted');
});
test('M33 same song ID on another Navidrome server cannot satisfy listen playback confirmation',async()=>{
    const h=fixture(),track=song('shared',{provider:'navidrome',serverId:'server_a'});await h.api.share(track,{invite:true});const message=h.chat.history[0];message.music.invitation.status='accepted';h.c.UvUMusic.player.play=async()=>{h.state={...h.state,track:{...track,serverId:'server_b'}};return true;};await assert.rejects(h.api.listen(track,{chat:h.chat,message}),/未开始|尚未开始|播放/);assert.equal(h.api.session(),null);
});
test('M33 returning to together song never toggles another server with identical track ID',async()=>{
    const h=fixture(),track=song('shared',{provider:'navidrome',serverId:'server_a'});await accepted(h,track);h.state={...h.state,track:{...track,serverId:'server_b'}};assert.equal(h.api.session().localPlayback,false);await h.api.togglePlayback();assert.equal(h.toggles,0);assert.equal(h.plays.at(-1).serverId,'server_a');
});
test('M35 disabling autonomy in flight rejects AI offer and creates no received music card',async()=>{
    const h=fixture();let enabled=true;h.c.UvUMusicCharacter={candidates:()=>enabled?[song()]:[]};const p=h.api.requestPlan([],h.chat);enabled=false;await h.api.consumeReply(command(p.invitations[0].id,'invite'),h.chat,p);assert.equal(h.chat.history.length,0);
});
test('M36 share includes only explicitly edited excerpt and no historical lyrics/audio credentials',async()=>{
    const h=fixture();await h.api.share({...song(),url:'https://audio.test?token=SECRET',cookie:'SECRET'},{lyrics:'我选的两句\n第二句'});const message=h.chat.history[0];assert.equal(message.music.lyrics,'我选的两句\n第二句');assert.ok(!JSON.stringify(message).includes('SECRET'));assert.ok(!message.content.includes('第一句'));assert.ok(message.content.includes('所选歌词'));
});
test('M36 cancelled awaited lyric sharing produces no card and archive change cannot reroute it',async()=>{
    const h=fixture(),controller=new AbortController();let finish;h.c.UvUMusic.lyrics=()=>new Promise(resolve=>finish=resolve);const pending=h.api.share(song(),{lyrics:true,signal:controller.signal});controller.abort();finish({lyric:'迟到歌词'});await assert.rejects(pending,{name:'AbortError'});assert.equal(h.chat.history.length,0);const pending2=h.api.share(song(),{lyrics:true});h.chat.activeArchiveId='two';finish({lyric:'迟到歌词'});await assert.rejects(pending2,/存档已变化/);assert.equal(h.chat.history.length,0);
});
