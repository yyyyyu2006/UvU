const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const plain=v=>JSON.parse(JSON.stringify(v));
const song=(id='new',title='Song',extra={})=>({provider:'netease',id,title,artists:['Artist'],album:'',cover:'',duration:120,...extra});
function fixture(){
    const chat={id:'a',realName:'角色A',persona:'温和的音乐人',activeArchiveId:'one',history:[],musicProfile:{version:1,autonomous:false,updatedAt:1,tracks:[song('old','Old')]}};
    const sessions=new Map(),h={chat,requests:[],searches:[],failSave:false};
    const c=vm.createContext({console,URL,AbortController,DOMException,setTimeout,clearTimeout,currentChatId:'a',currentChatType:'private',db:{characters:[chat],apiSettings:{url:'https://main.test',key:'MAIN_SECRET',model:'main-model',secondary:{enabled:true,url:'https://second.test',key:'SECOND_SECRET',model:'second-model'}}},sessionStorage:{getItem:k=>sessions.get(k)||null,setItem:(k,v)=>sessions.set(k,v)},
        document:{getElementById:id=>id==='chat-room-screen'?{classList:{contains:name=>name==='active'}}:null},relationshipCanChat:()=>true,resolveAutoMemoryApi:({apiSource})=>apiSource==='secondary'?{...c.db.apiSettings.secondary}:{...c.db.apiSettings},
        buildChatApiRequest:(config,messages)=>{h.requests.push({config:plain(config),messages:plain(messages)});return{requestBody:{},headers:{},endpoint:config.url};},fetchAiResponse:async()=>JSON.stringify({songs:[{title:'Song',artists:['Artist']}]}),
        beginChatMutation:chat=>({chat,before:structuredClone(chat.musicProfile)}),saveChatMutation:async state=>{if(h.failSave){state.chat.musicProfile=state.before;return false;}return true;},
        UvUMusic:{normalizeTrack:t=>({...t}),key:t=>t.provider+':'+(t.serverId?t.serverId+':':'')+t.id,settings:()=>({endpoint:'https://music.test',publicSources:[],providers:['netease']}),search:async query=>{h.searches.push(query);return{tracks:[song()]};}}});c.window=c;vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/music_character.js'),'utf8'),c);return{...h,c,api:c.UvUMusicCharacter,get failSave(){return h.failSave;},set failSave(v){h.failSave=v;}};
}

test('M30 primary/secondary/custom are explicit and credentials never enter character profile',async()=>{
    for(const source of ['primary','secondary','custom']){const h=fixture();await h.api.setOptions(h.chat,{apiSource:source});if(source==='custom')h.api.customApi({url:'https://custom.test/v1',key:'CUSTOM_SECRET',model:'custom-model'});await h.api.refresh(h.chat);assert.equal(h.requests[0].config.model,source==='primary'?'main-model':source==='secondary'?'second-model':'custom-model');assert.ok(!JSON.stringify(h.chat.musicProfile).includes('SECRET'));assert.equal(h.c.db.apiSettings.model,'main-model');}
});
test('M30 query/edit options does not request a model, missing keys preserve old playlist',async()=>{
    const h=fixture();h.api.options(h.chat);h.api.profile(h.chat);h.api.candidates(h.chat);await h.api.setOptions(h.chat,{recent:false});assert.equal(h.requests.length,0);h.c.db.apiSettings.key='';await assert.rejects(h.api.refresh(h.chat),/配置/);assert.equal(h.chat.musicProfile.tracks[0].id,'old');assert.equal(h.requests.length,0);
});
test('M30 custom API validation rejects credential URLs and custom config changes invalidate pending generation',async()=>{
    const h=fixture();for(const url of ['http://remote.test','https://name:password@test','https://test/?token=x','https://test/#secret'])assert.throws(()=>h.api.customApi({url,key:'x',model:'m'}));h.api.customApi({url:'https://custom.test',key:'one',model:'m'});await h.api.setOptions(h.chat,{apiSource:'custom'});let finish;h.c.fetchAiResponse=()=>new Promise(resolve=>finish=resolve);const job=h.api.refresh(h.chat);h.api.customApi({url:'https://custom.test',key:'two',model:'m'});finish(JSON.stringify({songs:[{title:'Song',artists:['Artist']}]}));await assert.rejects(job,{name:'AbortError'});assert.equal(h.chat.musicProfile.tracks[0].id,'old');
});
test('M31 disabled recent/preferences are absent and enabled preference is provided only as data',async()=>{
    const h=fixture();h.chat.history=[{role:'user',content:'RECENT_MARKER'}];await h.api.setOptions(h.chat,{recent:false,preferences:false,preferenceText:'PREFERENCE_MARKER'});await h.api.refresh(h.chat);let payload=JSON.parse(h.requests[0].messages[1].content);assert.equal(payload.recent,undefined);assert.equal(payload.confirmedPreferences,undefined);await h.api.setOptions(h.chat,{recent:true,preferences:true});await h.api.refresh(h.chat);payload=JSON.parse(h.requests[1].messages[1].content);assert.equal(payload.recent[0].text,'RECENT_MARKER');assert.equal(payload.confirmedPreferences,'PREFERENCE_MARKER');
});
test('M31 recommendation excludes hidden/withdrawn/revoked/disabled/relationship/status/thinking records',async()=>{
    const h=fixture();h.chat.history=[...['isHidden','isWithdrawn','isRevoked','isContextDisabled','relationshipDelivery','isStatusUpdate','isThinking'].map((flag,index)=>({id:String(index),role:'assistant',content:'PRIVATE_'+flag,[flag]:true})),{role:'user',content:'VISIBLE'}];await h.api.refresh(h.chat);const recent=JSON.parse(h.requests[0].messages[1].content).recent;assert.deepEqual(recent,[{role:'user',text:'VISIBLE'}]);
});
test('M31 unclosed thinking prefill is excluded from recommendation text',async()=>{
    const h=fixture();h.chat.history=[{role:'assistant',content:'<thinking>PRIVATE_REASONING_WITHOUT_CLOSING'},{role:'user',content:'VISIBLE'}];await h.api.refresh(h.chat);assert.ok(!h.requests[0].messages[1].content.includes('PRIVATE_REASONING_WITHOUT_CLOSING'));
});
test('M32 preview has zero profile writes and commit preserves locked tracks without keeping the rest',async()=>{
    const h=fixture();h.chat.musicProfile.tracks.push(song('locked','Lock'));await h.api.setOptions(h.chat,{locked:['netease:locked']});const before=JSON.stringify(h.chat.musicProfile),preview=await h.api.refresh(h.chat,undefined,{preview:true});assert.equal(JSON.stringify(h.chat.musicProfile),before);await preview.commit(['netease:new'],false);assert.deepEqual(plain(h.chat.musicProfile.tracks.map(t=>t.id)),['locked','new']);await assert.rejects(preview.commit(['netease:new'],false),{name:'AbortError'});
});
test('M32 excluded titles cannot be proposed again and edit controls preserve order/locks on failure',async()=>{
    const h=fixture();await h.api.setOptions(h.chat,{excluded:[h.api.excludeKey('Song')]});const p=await h.api.refresh(h.chat,undefined,{preview:true});assert.equal(p.choices.length,0);assert.equal(h.searches.length,0);h.chat.musicProfile.tracks.push(song('b','B'),song('c','C'));await h.api.editTracks(h.chat,{from:2,to:0,lock:'netease:c'});assert.deepEqual(plain(h.chat.musicProfile.tracks.map(t=>t.id)),['c','old','b']);h.failSave=true;await assert.rejects(h.api.editTracks(h.chat,{remove:'netease:c'}),/保存/);assert.equal(h.chat.musicProfile.tracks[0].id,'c');
});
test('M33 changing source options, relationship, persona, archive or deleting the role invalidates preview commit',async()=>{
    for(const change of ['options','relationship','persona','archive','deleted']){const h=fixture(),p=await h.api.refresh(h.chat,undefined,{preview:true});if(change==='options')await h.api.setOptions(h.chat,{recent:false});if(change==='relationship')h.chat.friendRelationship={revision:2};if(change==='persona')h.chat.persona='changed';if(change==='archive')h.chat.activeArchiveId='two';if(change==='deleted')h.c.db.characters=[];await assert.rejects(p.commit(['netease:new']),{name:'AbortError'},change);assert.equal(h.chat.musicProfile.tracks[0].id,'old');}
});
test('M33 editing an actually used recent source behind six hidden messages invalidates preview',async()=>{
    const h=fixture();h.chat.history=[{id:'source',role:'user',content:'有效源'},...Array.from({length:6},(_,i)=>({id:'hidden'+i,role:'assistant',content:'隐藏'+i,isHidden:true}))];const p=await h.api.refresh(h.chat,undefined,{preview:true});assert.ok(h.requests[0].messages[1].content.includes('有效源'));h.chat.history[0].content='源被修改';await assert.rejects(p.commit(['netease:new']),{name:'AbortError'});assert.equal(h.chat.musicProfile.tracks[0].id,'old');
});
test('M35 invitation whitelist/exclusion/current role/cooldown are enforced without extra model requests',async()=>{
    const h=fixture();h.chat.musicProfile.autonomous=true;h.chat.musicProfile.tracks=[song('a','A'),song('b','B')];await h.api.setOptions(h.chat,{inviteKeys:['netease:b'],currentChatOnly:true,cooldown:120});assert.deepEqual(plain(h.api.candidates(h.chat).map(t=>t.id)),['b']);h.c.currentChatId='other';assert.equal(h.api.candidates(h.chat).length,0);h.c.currentChatId='a';h.chat.history=[{type:'music',role:'user',timestamp:Date.now()-60*60000,music:{invitation:{archiveId:'one',status:'declined'}}}];assert.equal(h.api.candidates(h.chat).length,0);h.chat.history[0].timestamp=Date.now()-121*60000;assert.equal(h.api.candidates(h.chat).length,1);await h.api.setOptions(h.chat,{excluded:[h.api.excludeKey('B')]});assert.equal(h.api.candidates(h.chat).length,0);assert.equal(h.requests.length,0);
});
test('M35 current-chat-only does not invite while a group with same ID is open',async()=>{
    const h=fixture();h.chat.musicProfile.autonomous=true;await h.api.setOptions(h.chat,{currentChatOnly:true});h.c.currentChatType='group';assert.equal(h.api.candidates(h.chat).length,0);
});
