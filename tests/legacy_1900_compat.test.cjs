const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const baseline = process.env.UVU_1900_ROOT || 'C:/Users/15271130817/Desktop/1900版uwu';
const available = fs.existsSync(path.join(baseline, 'js/modules/chat_ai_prompt.js'));
const current = path.join(__dirname, '..');
function fixture(root, provider, version, type) {
    const requests = [], errors = [];
    const chat = { id: 'c', activeArchiveId: 'a', realName: '晴', remarkName: '晴', myName: '我', name: '测试群', status: '在线',
        persona: '人物设定', myPersona: '用户设定', maxMemory: 20, me: { nickname: '我', persona: '用户设定' }, members: [{ id: 'm', realName: '晴', groupNickname: '晴', persona: '人物设定' }],
        worldBookIds: ['before2', 'before1', 'after', 'limit', 'guidelines'], memoryJournals: [{ id: 'j', title: '约定', content: '周六见', isFavorited: true }],
        history: [{ id: 'm1', role: 'assistant', content: '历史消息', timestamp: 1700000000000 }, { id: 'm2', role: 'user', content: '最新消息', timestamp: 1700000001000 }] };
    class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [1793808000000])); } static now() { return 1793808000000; } }
    const c = vm.createContext({ window: {}, Date: FixedDate, console: { log(){}, warn(){}, error(){} }, AbortController, setTimeout, clearTimeout,
        document: { addEventListener(){}, getElementById(){ return null; } },
        db: { characters: [chat], groups: [chat], worldBooks: [
            { id:'before1', position:'before', depth:2, content:'BEFORE_2' }, { id:'before2', position:'before', depth:1, content:'BEFORE_1' },
            { id:'after', position:'after', content:'AFTER' }, { id:'limit', position:'limit_break', content:'LIMIT' }, { id:'guidelines', position:'guidelines', content:'GUIDELINES' }
        ], myStickers: [], cotSettings: { promptVersion: version }, apiSettings: { provider, url:'https://test.invalid', key:'test', model:'model', streamEnabled:false } },
        currentChatId:'c', currentChatType:type, isGenerating:false, AudioManager:{ unlock(){} }, getReplyBtn:{}, regenerateBtn:{}, typingIndicator:{style:{}}, messageArea:{},
        filterHistoryForAI:(_chat, history)=>structuredClone(history), pad:n=>String(n).padStart(2,'0'), getRandomValue:v=>v,
        fetch:async (_url, init)=> { requests.push(JSON.parse(init.body)); return { ok:true, json:async()=>provider==='gemini'?{ candidates:[{content:{parts:[{text:'回复'}]}}] }:{choices:[{message:{content:'回复'}}]} }; },
        showApiError:error=>errors.push(error.message) });
    if (root === current) for (const file of ['modules/chat_documents.js', 'modules/vector_index_store.js', 'modules/vector_memory_tools.js', 'modules/auto_memory.js', 'modules/character_memos.js', 'modules/worldbook_rules.js', 'modules/minimax_speech.js', 'modules/voice_director.js', 'modules/mcp_transport.js', 'modules/mcp_oauth.js', 'modules/mcp_forms.js', 'modules/mcp_services.js', 'modules/mcp_chat.js']) vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),c);
    if (root === current) vm.runInContext(fs.readFileSync(path.join(root,'js/modules/music_chat.js'),'utf8'),c);
    for (const file of ['modules/chat_ai_prompt.js','group_chat.js','modules/chat_ai.js']) vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),c);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/utils.js'), 'utf8'), c);
    c.showApiError = error => errors.push(error.message);
    c.console.error = (label, error) => { if (label === 'Background Auto-Reply Error:') errors.push(error.message); };
    if (root === current) for (const file of ['sticker_assist.js', 'environment.js', 'calendar_core.js'])
        vm.runInContext(fs.readFileSync(path.join(root, 'js/modules', file), 'utf8'), c);
    c.handleAiReplyContent=async()=>{};
    return { c,chat,requests,errors };
}

test('144 real-filter request combinations retain 1900 ordering, CoT and original Gemini bug fixes', {skip:!available}, async()=>{
    let equal=0,originalFailures=0;
    for(const provider of ['newapi','gemini'])for(const version of ['uwu','tt'])for(const type of ['private','group'])
    for(const background of [false,true])for(const cot of ['off','prefill','no-prefill'])for(const history of ['normal','hidden','assistant']){
        const a=fixture(baseline,provider,version,type),b=fixture(current,provider,version,type);
        const label=[provider,version,type,background,cot,history].join('/');
        for(const f of [a,b]){
            f.c.db.cotSettings={promptVersion:version,enabled:cot!=='off',prefillEnabled:cot==='prefill',activePresetId:'default'};
            f.c.db.cotPresets=[{id:'default',items:[{enabled:true,content:'COT_TEST_RULE'},{enabled:false,content:'DISABLED_COT_RULE'}]}];
            if(history==='hidden')f.chat.history.splice(1,0,{id:'h',role:'assistant',content:'THINKING',isThinking:true},
                {id:'d',role:'user',content:'EXCLUDED',isContextDisabled:true});
            if(history==='assistant')f.chat.history.push({id:'last',role:'assistant',content:'[晴的消息：last]',timestamp:1700000002000});
            await f.c.getAiReply('c',type,background);
        }
        assert.deepEqual(b.errors,[],label);assert.equal(b.requests.length,1,label);
        if(provider==='gemini'&&version==='tt'&&type==='private'){
            assert.equal(a.requests.length,0,label);assert.deepEqual(a.errors,['Assignment to constant variable.'],label);originalFailures++;
        }else{
            assert.deepEqual(a.errors,[],label);assert.deepEqual(b.requests,a.requests,label);equal++;
        }
        assert.doesNotMatch(JSON.stringify(b.requests),/DISABLED_COT_RULE/);
    }
    assert.equal(equal,126);assert.equal(originalFailures,18);
});

for(const provider of ['newapi','gemini'])test('quote and regeneration guidance affect only their current message/request: '+provider,async()=>{
    const f=fixture(current,provider,'uwu','private');
    vm.runInContext(fs.readFileSync(path.join(current,'js/modules/chat_ops.js'),'utf8'),f.c);
    await f.c.getAiReply('c','private');const ordinary=f.requests.at(-1),before=JSON.stringify(f.chat);
    await f.c.getAiReply('c','private',false,'GUIDANCE_SENTINEL');
    assert.match(JSON.stringify(f.requests.at(-1)),/GUIDANCE_SENTINEL/);assert.equal(JSON.stringify(f.chat),before);
    await f.c.getAiReply('c','private');assert.deepEqual(f.requests.at(-1),ordinary);
    f.chat.history.at(-1).quote={content:'QUOTED_SENTINEL',senderName:'晴'};
    const quotedBefore=JSON.stringify(f.chat.history);await f.c.getAiReply('c','private');const quoted=f.requests.at(-1);
    assert.deepEqual(f.errors,[]);assert.equal(JSON.stringify(f.chat.history),quotedBefore);
    const rows=provider==='gemini'?'contents':'messages';
    assert.deepEqual(quoted[rows].slice(0,-1),ordinary[rows].slice(0,-1));
    assert.match(JSON.stringify(quoted[rows].at(-1)),/QUOTED_SENTINEL/);
});

for (const provider of ['newapi', 'gemini']) test('1900 request survives dormant sticker descriptions and stale favorite replacement: '+provider, {skip:!available}, async()=>{
    const a=fixture(baseline,provider,'uwu','private'), b=fixture(current,provider,'uwu','private');
    for(const f of [a,b]){
        f.chat.stickerGroups='猫';f.c.db.myStickers=[{id:'s',name:'开心',group:'猫',description:'STICKER_SENTINEL'}];
        f.chat.memoryJournals[0].vectorSupersededBy='missing';
        f.chat.environmentProfile={aiEnabled:true};f.c.db.environmentSettings={enabled:false};
        f.chat.characterMemos={settings:{enabled:false,useContext:true},notes:[]};
        f.chat.history.splice(1,0,{id:'thinking',role:'assistant',content:'SECRET_REASONING',isThinking:true},
            {id:'excluded',role:'user',content:'EXCLUDED_MESSAGE',isContextDisabled:true});
    }
    await a.c.getAiReply('c','private');await b.c.getAiReply('c','private');
    assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);assert.equal(b.requests.length,1);
    assert.deepEqual(b.requests,a.requests);assert.doesNotMatch(JSON.stringify(b.requests),/STICKER_SENTINEL|SECRET_REASONING|EXCLUDED_MESSAGE/);
});

test('custom diary style keeps 1900 depth order until each advanced rule is explicitly enabled', {skip:!available}, ()=>{
    const a=fixture(baseline,'newapi','uwu','private'),b=fixture(current,'newapi','uwu','private');
    for(const [f,root]of [[a,baseline],[b,current]])vm.runInContext(fs.readFileSync(path.join(root,'js/modules/journal.js'),'utf8'),f.c);
    const original=fs.readFileSync(path.join(baseline,'js/modules/journal.js'),'utf8');
    const start=original.indexOf("        let worldBooksContent = ''",original.indexOf('async function generateJournal('));
    const end=original.indexOf('        const apiConfig =',start);
    assert.ok(start>=0&&end>start);
    vm.runInContext('function legacySummary(chat,messagesToSummarize,includeFavorited){'+original.slice(start,end)+'return summaryPrompt;}',a.c);
    for(const f of [a,b]){
        f.chat.journalStyleSettings={mode:'custom',customWorldBookIds:['before1','before2']};
        f.c.db.worldBooks.find(w=>w.id==='before1').rules={advancedEnabled:false,order:1};
        f.c.db.worldBooks.find(w=>w.id==='before2').rules={advancedEnabled:false,order:2};
    }
    const legacy=a.c.legacySummary(a.chat,a.chat.history,false);
    assert.equal(b.c.buildJournalSummaryPrompt(b.chat,'private',b.chat.history,false),legacy);
    b.c.db.worldBooks.forEach(w=>{if(w.rules)w.rules.advancedEnabled=true;});
    const enabled=b.c.buildJournalSummaryPrompt(b.chat,'private',b.chat.history,false);
    assert.notEqual(enabled,legacy);assert.match(enabled,/BEFORE_2\n\nBEFORE_1/);
});
for (const version of ['uwu','tt']) for (const type of ['private','group']) {
    test('1900 prompt equality with additions off: '+version+'/'+type,{skip:!available},()=>{
        const a=fixture(baseline,'newapi',version,type), b=fixture(current,'newapi',version,type);
        const fn=type==='private'?'generatePrivateSystemPrompt':'generateGroupSystemPrompt';
        assert.equal(b.c[fn](b.chat),a.c[fn](a.chat));
    });
}
for (const provider of ['newapi','gemini']) for (const type of ['private','group']) {
    test('1900 request equality with additions off: '+provider+'/'+type,{skip:!available},async()=>{
        const a=fixture(baseline,provider,'uwu',type), b=fixture(current,provider,'uwu',type);
        await a.c.getAiReply('c',type); await b.c.getAiReply('c',type);
        assert.deepEqual(a.errors,[]); assert.deepEqual(b.errors,[]); assert.equal(a.requests.length,1);
        assert.deepEqual(b.requests,a.requests);
    });
}
test('MCP appends explicit reference data without altering provider history or tools; failures keep ordinary replies', async () => {
    const a=fixture(current,'newapi','uwu','private');await a.c.getAiReply('c','private');
    const b=fixture(current,'newapi','uwu','private');b.c.prepareMcpChatContext=async()=> '\nMCP REFERENCE';await b.c.getAiReply('c','private');
    assert.match(b.requests[0].messages[0].content,/MCP REFERENCE/);
    assert.deepEqual(b.requests[0].messages.slice(1),a.requests[0].messages.slice(1));assert.equal(b.requests[0].tools,undefined);
    const f=fixture(current,'newapi','uwu','private');f.c.prepareMcpChatContext=async()=>{throw Error('service unavailable');};await f.c.getAiReply('c','private');
    assert.deepEqual(f.requests,a.requests);assert.deepEqual(f.errors,[]);
});
for(const provider of ['newapi','gemini'])test('MCP raw reference is sent but excluded from diagnostic logs: '+provider,async()=>{
    const f=fixture(current,provider,'uwu','private'), logs=[];f.c.console.log=(...args)=>logs.push(args.join(' '));
    f.c.prepareMcpChatContext=async()=> '\nMCP-PRIVATE-RESULT-SENTINEL';await f.c.getAiReply('c','private');
    assert.equal(f.requests.length,1);assert.ok(JSON.stringify(f.requests[0]).includes('MCP-PRIVATE-RESULT-SENTINEL'));
    assert.ok(!logs.join('\n').includes('MCP-PRIVATE-RESULT-SENTINEL'));assert.ok(logs.join('\n').includes('MCP'));
});
test('MCP globally enabled with no role grants still preserves the ordinary request',async()=>{
    const a=fixture(current,'newapi','uwu','private'),b=fixture(current,'newapi','uwu','private');b.c.db.mcpSettings={enabled:true,services:[],policies:[]};
    await a.c.getAiReply('c','private');await b.c.getAiReply('c','private');assert.deepEqual(b.requests,a.requests);
});

test('ordinary request and response logs expose metadata without private prompt or reply text', async () => {
    const f = fixture(current, 'newapi', 'uwu', 'private'), logs = [];
    f.chat.persona = 'PERSONA-PRIVATE-SENTINEL'; f.chat.history[0].content = 'HISTORY-PRIVATE-SENTINEL';
    f.c.console.log = (...args) => logs.push(args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '));
    f.c.fetch = async (_url, init) => {
        f.requests.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'REPLY-PRIVATE-SENTINEL' } }] }) };
    };
    await f.c.getAiReply('c', 'private');
    assert.equal(f.requests.length, 1);
    assert.match(JSON.stringify(f.requests[0]), /PERSONA-PRIVATE-SENTINEL/);
    assert.doesNotMatch(logs.join('\n'), /PERSONA-PRIVATE-SENTINEL|HISTORY-PRIVATE-SENTINEL|REPLY-PRIVATE-SENTINEL/);
    assert.ok(logs.length > 0);
});

for (const provider of ['newapi', 'gemini']) for (const type of ['private', 'group']) for (const limit of [1, 3, 100]) {
    test(`1900 richer history request equality: ${provider}/${type}/limit${limit}`, { skip: !available }, async () => {
        const a = fixture(baseline, provider, 'uwu', type), b = fixture(current, provider, 'uwu', type);
        for (const item of [a, b]) {
            item.chat.maxMemory = limit;
            item.chat.bilingualModeEnabled = true;
            item.chat.targetLanguage = 'English';
            item.chat.history = Array.from({ length: 8 }, (_, i) => ({ id: 'floor-' + i, role: i % 2 ? 'user' : 'assistant',
                content: i % 2 ? `引用与多行\n消息 ${i} ' " <普通文字>` : `[晴的消息：reply ${i}]`, timestamp: 1700000000000 + i * 1000 }));
            item.chat.memoryJournals.push({ id: 'unused', title: '未收藏', content: 'NEVER-INJECT-UNSELECTED', isFavorited: false });
        }
        await a.c.getAiReply('c', type); await b.c.getAiReply('c', type);
        assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
        assert.equal(a.requests.length, 1); assert.deepEqual(b.requests, a.requests);
        assert.doesNotMatch(JSON.stringify(b.requests), /NEVER-INJECT-UNSELECTED/);
    });
}
for (const provider of ['newapi','gemini']) test('shared file uses bounded text only and captures request source: '+provider,async()=>{
    const f=fixture(current,provider,'uwu','private');
    const file=f.c.makeSharedDocument('内容.txt','DOCUMENT_BODY_SENTINEL',{originalData:'data:application/octet-stream;base64,YQ=='});
    f.chat.history.push({id:'file-1',role:'user',type:'document',document:file,content:'file summary',parts:[{type:'text',text:'file summary'}],timestamp:1700000002000});
    let sources;f.c.handleAiReplyContent=async(...args)=>{sources=args[6];return true;};await f.c.getAiReply('c','private');
    assert.deepEqual(f.errors,[]);assert.equal(f.requests.length,1);assert.match(JSON.stringify(f.requests[0]),/DOCUMENT_BODY_SENTINEL/);assert.doesNotMatch(JSON.stringify(f.requests[0]),/base64,YQ==/);assert.equal(sources.length,1);assert.equal(sources[0].id,'file-1');assert.equal(sources[0].documentInputComplete,true);assert.ok(f.chat.history.at(-1).document.originalData);
});
test('stream path carries the same document sources to the original reply handler',async()=>{
    const f=fixture(current,'newapi','uwu','private'),sources=[{id:'file-1'}];let received;
    f.c.readStreamResponse=async()=> 'ordinary response';f.c.handleAiReplyContent=async(...args)=>{received=args[6];return true;};
    assert.equal(await f.c.processStream({},f.chat,'newapi','c','private',true,()=>true,undefined,undefined,sources),true);assert.equal(received,sources);
});

for (const provider of ['newapi','gemini']) test('music invitation is request scoped and keeps original history and provider flow: '+provider,async()=>{
    const f=fixture(current,provider,'uwu','private'), now=f.c.Date.now(), api=f.c.window.UvUMusicChat;
    const payload=api.portablePayload({version:1,track:{provider:'netease',id:'1',title:'歌名',artists:['歌手'],album:'专辑',duration:120},invitation:{id:'invite_1',chatId:'c',archiveId:'a',createdAt:now,expiresAt:now+60000,status:'pending'}});
    f.chat.history.push({id:'music_1',role:'user',type:'music',music:payload,content:'【分享音乐】歌名',timestamp:now});
    const before=JSON.stringify(f.chat.history);let plan;
    f.c.handleAiReplyContent=async(...args)=>{plan=args[7];return true;};await f.c.getAiReply('c','private');
    assert.deepEqual(f.errors,[]);assert.equal(f.requests.length,1);assert.match(JSON.stringify(f.requests[0]),/本轮一起听邀请/);
    assert.equal(plan.invitations[0].id,'invite_1');assert.equal(JSON.stringify(f.chat.history),before);
    // A normal share carries song facts but must not install action instructions.
    delete f.chat.history.at(-1).music.invitation;f.requests.length=0;await f.c.getAiReply('c','private');
    assert.doesNotMatch(JSON.stringify(f.requests[0]),/本轮一起听邀请/);assert.equal(plan.invitations.length,0);
});

test('character memos add only an explicitly enabled reference; provider history and failures retain ordinary flow',async()=>{
 const a=fixture(current,'newapi','uwu','private');await a.c.getAiReply('c','private');
 const b=fixture(current,'newapi','uwu','private');b.chat.characterMemos={settings:{enabled:true,useContext:true},notes:[{id:'memo',owner:b.c.characterMemoIdentity(b.chat),manual:true,status:'approved',subject:'user',fact:'MEMO-PRIVATE-SENTINEL',pinned:true,useContext:true}]};let scheduled=0;b.c.scheduleCharacterMemos=()=>scheduled++;await b.c.getAiReply('c','private');
 assert.match(b.requests[0].messages[0].content,/MEMO-PRIVATE-SENTINEL/);assert.deepEqual(b.requests[0].messages.slice(1),a.requests[0].messages.slice(1));assert.equal(scheduled,1);
 const c=fixture(current,'newapi','uwu','private');c.c.getCharacterMemoContext=()=>{throw Error('bad restored memo')};await c.c.getAiReply('c','private');assert.deepEqual(c.requests,a.requests);assert.deepEqual(c.errors,[]);
});
