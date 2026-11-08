const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const song=(id='1')=>({provider:'netease',id,title:'Song',artists:['Artist'],album:'',cover:'',duration:180});
function fixture(){
    const chat={id:'a',persona:'gentle musician',activeArchiveId:'one',history:[]};
    const c=vm.createContext({console,URL,AbortController,DOMException,setTimeout,clearTimeout,db:{characters:[chat],apiSettings:{url:'https://test',key:'key',model:'model'}},
        buildChatApiRequest:()=>({requestBody:{},headers:{},endpoint:'https://test'}),fetchAiResponse:async()=>JSON.stringify({songs:[{title:'Song',artists:['Artist']}]}),
        beginChatMutation:(chat,type,messages,fields)=>({chat,before:structuredClone(chat.musicProfile)}),saveChatMutation:async()=>true,
        UvUMusic:{normalizeTrack:t=>({...t}),key:t=>t.provider+':'+t.id,settings:()=>({publicSources:[],providers:['netease']}),search:async()=>({tracks:[song()]})}});
    c.window=c;const file=path.join(__dirname,'../js/modules/music_character.js');if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),c);
    return{c,chat,api:c.UvUMusicCharacter};
}
test('character playlist refresh resolves real tracks and preserves the opt-in setting',async()=>{
    const {api,chat}=fixture();assert.ok(api,'character music module is mounted');
    const result=await api.refresh(chat);assert.equal(result.profile.tracks[0].id,'1');assert.equal(api.profile(chat).autonomous,false);
    await api.setAutonomous(chat,true);assert.equal(api.profile(chat).autonomous,true);
    await api.refresh(chat);assert.equal(api.profile(chat).autonomous,true);
});
test('playlist resolution rejects wrong artists and ambiguous versions and preserves old data',async()=>{
    const {api,c,chat}=fixture();assert.ok(api);chat.musicProfile={version:1,autonomous:true,tracks:[song('old')],updatedAt:1};
    c.UvUMusic.search=async()=>({tracks:[{...song(),artists:['Other']}]});await assert.rejects(api.refresh(chat),/匹配/);assert.equal(chat.musicProfile.tracks[0].id,'old');
    c.UvUMusic.search=async()=>({tracks:[song('1'),song('2')]});await assert.rejects(api.refresh(chat),/匹配/);assert.equal(chat.musicProfile.tracks[0].id,'old');
});
test('refresh cannot save into a changed archive or overwrite a concurrent profile edit',async()=>{
    const {api,c,chat}=fixture();assert.ok(api);let finish;c.fetchAiResponse=()=>new Promise(resolve=>finish=resolve);
    const job=api.refresh(chat);chat.activeArchiveId='two';finish(JSON.stringify({songs:[{title:'Song',artists:['Artist']}]}));await assert.rejects(job,/变化|取消/);assert.equal(chat.musicProfile,undefined);
    const job2=api.refresh(chat);await api.setAutonomous(chat,true);finish(JSON.stringify({songs:[{title:'Song',artists:['Artist']}]}));await assert.rejects(job2,/变化|取消/);assert.equal(chat.musicProfile.autonomous,true);
});
test('cancelled and failed saves preserve the previous playlist',async()=>{
    const {api,c,chat}=fixture();assert.ok(api);chat.musicProfile={version:1,autonomous:false,tracks:[song('old')],updatedAt:1};
    const controller=new AbortController();controller.abort();await assert.rejects(api.refresh(chat,controller.signal),/变化|取消/);
    c.saveChatMutation=async state=>{state.chat.musicProfile=state.before;return false;};await assert.rejects(api.refresh(chat),/保存/);assert.equal(chat.musicProfile.tracks[0].id,'old');
});
test('autonomy is opt-in, blocks duplicate rooms and cools down after an incoming invitation',()=>{
    const {api,chat}=fixture();assert.ok(api);chat.musicProfile={version:1,autonomous:false,tracks:[song()],updatedAt:1};
    assert.equal(api.candidates(chat).length,0);chat.musicProfile.autonomous=true;assert.equal(api.candidates(chat).length,1);
    const invitation={chatId:chat.id,archiveId:'one',status:'pending',expiresAt:Date.now()+10000};
    chat.history=[{type:'music',role:'user',music:{invitation}}];assert.equal(api.candidates(chat).length,0);
    invitation.status='ended';chat.history[0].role='assistant';chat.history[0].timestamp=Date.now();assert.equal(api.candidates(chat).length,0);
    chat.history[0].timestamp=Date.now()-31*60000;assert.equal(api.candidates(chat).length,1);
});
test('playlist refresh failure, persona edit and cancellation during source lookup keep old tracks',async()=>{
    const {api,c,chat}=fixture();assert.ok(api);chat.musicProfile={version:1,autonomous:false,tracks:[song('old')],updatedAt:1};
    c.UvUMusic.search=async()=>{throw new Error('network failed');};await assert.rejects(api.refresh(chat),/network/);
    let finish;c.UvUMusic.search=()=>new Promise(resolve=>finish=resolve);const job=api.refresh(chat);await new Promise(setImmediate);chat.persona='changed';finish({tracks:[song()]});await assert.rejects(job,/变化|取消/);
    const controller=new AbortController(),job2=api.refresh(chat,controller.signal);await new Promise(setImmediate);controller.abort();finish({tracks:[song()]});await assert.rejects(job2,/变化|取消/);assert.equal(chat.musicProfile.tracks[0].id,'old');
});
