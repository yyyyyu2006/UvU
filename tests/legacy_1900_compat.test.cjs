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
    if (root === current) for (const file of ['modules/chat_documents.js', 'modules/auto_memory.js', 'modules/worldbook_rules.js', 'modules/mcp_transport.js', 'modules/mcp_services.js', 'modules/mcp_chat.js']) vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),c);
    for (const file of ['modules/chat_ai_prompt.js','group_chat.js','modules/chat_ai.js']) vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),c);
    c.handleAiReplyContent=async()=>{};
    return { c,chat,requests,errors };
}
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
