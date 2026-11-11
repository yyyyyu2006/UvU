const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture(provider, placeholder, type, injectedRole) {
    const requests = [], errors = [];
    const chat = { id: 'world-test', realName: '晴', myName: '我', name: '群', maxMemory: 20, worldBookIds: ['head', 'middle', 'tail', 'off'], history: [
        { role: 'assistant', content: 'FLOOR_A', timestamp: 1700000000000 },
        { role: 'user', content: 'FLOOR_B', timestamp: 1700000001000 },
        { role: 'assistant', content: 'FLOOR_C', timestamp: 1700000002000 },
        { role: 'user', content: 'FLOOR_D', timestamp: 1700000003000 },
    ] };
    let rolls = 0;
    const c = vm.createContext({ db: { characters: type === 'private' ? [chat] : [], groups: type === 'group' ? [chat] : [], worldBooks: [
        { id:'head', position:'before', content:'WORLD_HEAD', rules:{advancedEnabled:true,constant:true,probability:50} },
        { id:'middle', position:'chat', content:'WORLD_MIDDLE', rules:{advancedEnabled:true,constant:true,chatDepth:2,role:'system'} },
        { id:'tail', position:'chat', content:'WORLD_TAIL', rules:{advancedEnabled:true,constant:true,chatDepth:0,role:injectedRole} },
        { id:'off', position:'before', content:'SHOULD_NOT_APPEAR', rules:{advancedEnabled:true,enabled:false} }
    ], apiSettings:{provider,url:'https://test.invalid',key:'fake',model:'test',streamEnabled:false} },
        Math: Object.assign(Object.create(Math), { random: () => { rolls++; return 0.1; } }),
        console:{log(){},error(){}}, currentChatId:chat.id,currentChatType:type,isGenerating:false,
        AudioManager:{unlock(){}},getReplyBtn:{},regenerateBtn:{},typingIndicator:{style:{}},messageArea:{},
        filterHistoryForAI:(chat,history)=>history.map(m=>({...m})),pad:n=>String(n).padStart(2,'0'),getRandomValue:v=>v,
        fetch:async (url,init)=>{requests.push(JSON.parse(init.body)); return {ok:true,json:async()=>provider==='gemini'?{candidates:[{content:{parts:[{text:'reply'}]}}]}:{choices:[{message:{content:'reply'}}]}};},
        showApiError:error=>errors.push(error.message),
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/worldbook_rules.js'),'utf8'),c);
    c.generatePrivateSystemPrompt = c.generateGroupSystemPrompt = (chat, plan) => 'ORIGINAL_RULES\n' + c.worldBookSection(plan,'before') + (placeholder ? '\n【动态插入: 聊天记录】\nORIGINAL_END' : '');
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/chat_ai.js'),'utf8'),c);c.handleAiReplyContent=async()=>{};
    return {c,chat,requests,errors,rolls:()=>rolls};
}
for(const provider of ['newapi','gemini'])for(const placeholder of [false,true])test(`actual diagnostic preserves ${provider}/${placeholder} body and single activation`,async()=>{
 const plain=fixture(provider,placeholder,'private','system'),observed=fixture(provider,placeholder,'private','system');
 observed.c.localStorage={getItem:()=>null,setItem(){}};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/request_memory_diagnostics.js'),'utf8'),observed.c);
 observed.c.UvURequestDiagnostics.setEnabled(true);
 await plain.c.getAiReply(plain.chat.id,'private');await observed.c.getAiReply(observed.chat.id,'private');
 assert.deepEqual(observed.errors,[]);assert.deepEqual(observed.requests,plain.requests);assert.equal(observed.rolls(),plain.rolls());
 const report=observed.c.UvURequestDiagnostics.get(observed.chat,'private');assert.equal(report.status,'completed');assert.ok(report.worldBooks.some(b=>b.id==='middle'&&b.matched));assert.ok(report.worldBooks.every(b=>b.id!=='off'));assert.ok(report.fieldCount>0);
});
test('broken optional request observer does not suppress ordinary replies',async()=>{
 const f=fixture('newapi',false,'private','system');f.c.UvURequestDiagnostics={isEnabled:()=>true,begin:()=>{throw Error('observer failed');},finish:()=>{throw Error('observer failed');}};
 await f.c.getAiReply(f.chat.id,'private');assert.equal(f.requests.length,1);assert.deepEqual(f.errors,[]);
});
test('broken optional diagnostic toggle does not suppress ordinary replies',async()=>{
 const f=fixture('newapi',false,'private','system');f.c.UvURequestDiagnostics={isEnabled:()=>{throw Error('toggle failed');}};await f.c.getAiReply(f.chat.id,'private');assert.equal(f.requests.length,1);assert.deepEqual(f.errors,[]);
});
test('unselected advanced rules preserve bound worldbooks and legacy depth order', async () => {
    const f = fixture('newapi', false, 'private', 'system');
    f.c.db.worldBooks.forEach(book => { book.rules.advancedEnabled = false; });
    f.c.db.worldBooks.find(book => book.id === 'head').depth = 3;
    f.c.db.worldBooks.find(book => book.id === 'middle').depth = 1;
    f.c.db.worldBooks.find(book => book.id === 'tail').depth = 2;
    await f.c.getAiReply(f.chat.id, 'private');
    const text = JSON.stringify(f.requests[0]);
    for (const word of ['WORLD_HEAD', 'WORLD_MIDDLE', 'WORLD_TAIL', 'SHOULD_NOT_APPEAR']) assert.ok(text.includes(word), text);
    assert.equal(f.rolls(), 0);
    const system = f.requests[0].messages.find(message => message.role === 'system').content;
    assert.ok(system.indexOf('WORLD_MIDDLE') < system.indexOf('WORLD_TAIL'));
    assert.ok(system.indexOf('WORLD_TAIL') < system.indexOf('WORLD_HEAD'));
});
for (const provider of ['newapi','gemini']) for (const placeholder of [false,true]) for (const type of ['private','group']) for (const role of ['system','user','assistant']) {
    test('final worldbook insertion ' + [provider,placeholder,type,role].join('/'), async () => {
        const f=fixture(provider,placeholder,type,role), original=JSON.stringify(f.chat.history);
        await f.c.getAiReply(f.chat.id,type);
        assert.deepEqual(f.errors,[]);assert.equal(f.requests.length,1);assert.equal(f.rolls(),1);
        const body=f.requests[0], text=JSON.stringify(body), sequence=provider==='gemini'?body.contents:body.messages;
        const systemText=provider==='gemini'?body.system_instruction.parts.map(part=>part.text).join('\n'):
            body.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
        for(const word of ['WORLD_HEAD','WORLD_MIDDLE','WORLD_TAIL'])assert.equal(text.split(word).length-1,1,text);
        assert.ok(!text.includes('SHOULD_NOT_APPEAR'));assert.ok(!text.includes('worldBookInjection'));
        assert.equal(JSON.stringify(f.chat.history),original);
        assert.ok(systemText.includes('WORLD_HEAD')&&systemText.includes('WORLD_MIDDLE')&&systemText.includes('WORLD_TAIL'),text);
        assert.ok(!sequence.some(m=>m.worldBookInjection));
        const latest=sequence.find(m=>JSON.stringify(m).includes('FLOOR_D'));
        assert.ok(JSON.stringify(latest).includes('<user_input>'),text);
        assert.ok(!JSON.stringify(sequence.filter(message=>message.role!=='system')).includes('WORLD_MIDDLE'));
        assert.ok(systemText.indexOf('WORLD_MIDDLE')<systemText.indexOf('ORIGINAL_END')||!placeholder,text);
        if(provider==='newapi')assert.equal(sequence.at(-1).role,'user');
    });
}
for (const provider of ['newapi','gemini']) test('call summary applies activation and excludes disabled books: ' + provider, async () => {
    const f=fixture(provider,false,'private','system');
    f.c.resolveAuxiliaryApiConfig=(route,config)=>config;
    f.c.getContextMemoryJournals=()=>[];
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/chat_ai_call.js'),'utf8'),f.c);
    assert.equal(await f.c.generateCallSummary(f.chat,[{role:'user',type:'audio',content:'通话内容'}]),'reply');
    assert.equal(f.requests.length,1);const text=JSON.stringify(f.requests[0]);
    assert.ok(text.includes('WORLD_HEAD'));assert.ok(!text.includes('SHOULD_NOT_APPEAR'));
});
