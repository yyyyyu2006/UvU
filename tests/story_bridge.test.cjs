'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(fetchImpl, permissionState = 'granted') {
    const values = new Map([['uvu-story-bridge.v1', JSON.stringify({ token: 'paired-token' })]]);
    const output = { textContent: '', dataset: {} };
    const chat = { id: 'char-1', memoryJournals: [] };
    const db = { characters: [chat], uvuStoryBridgeSettings: { baseUrl: 'http://127.0.0.1:8765/api/plugins/uvu-story-bridge' } };
    const context = vm.createContext({
        window: {},
        URL,
        db,
        document: { visibilityState: 'visible', getElementById: () => output, addEventListener() {} },
        localStorage: {
            getItem: key => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
            removeItem: key => values.delete(key)
        },
        navigator: { permissions: { query: async () => ({ state: permissionState }) } },
        fetch: fetchImpl,
        structuredClone,
        crypto,
        TextEncoder,
        AbortSignal,
        saveData: async () => {},
        setInterval: () => 1,
        clearInterval() {},
        console
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/bridge_text.js'), 'utf8'), context);
    const source = fs.readFileSync(path.join(__dirname, '../js/modules/story_bridge.js'), 'utf8');
    vm.runInContext(source.replace('window.setupUvUStoryBridge =', 'window.__bridgeTest = {automaticSync, disconnect}; window.setupUvUStoryBridge ='), context);
    return { bridge: context.window.UvUStoryBridge, db, chat, output, context };
}

test('latest handoff range counts 50 eligible messages rather than hidden history slots', () => {
    const f = harness(async () => ({ok:true,json:async()=>({})}));
    f.chat.history = Array.from({length:120}, (_,i) => ({id:'m'+i,role:i%2?'assistant':'user',content:'正文'+i,isThinking:i%2===0}));
    assert.deepEqual(JSON.parse(JSON.stringify(f.bridge.latestHandoffRange(f.chat))), {start:22,end:120,count:50});
    f.chat.history=[];
    assert.deepEqual(JSON.parse(JSON.stringify(f.bridge.latestHandoffRange(f.chat))), {start:0,end:0,count:0});
});

test('explicit handoff resends selected source messages even when the local sent ledger is already current', async () => {
    const calls=[]; const f=harness(async(url,options)=>{calls.push(JSON.parse(options.body||'{}'));return {ok:true,json:async()=>({})};});
    let result=await f.bridge.publishTurn(f.chat,null,[{id:'m',text:'原文',createdAt:1}]);
    assert.equal(result.queued,1);
    result=await f.bridge.publishTurn(f.chat,null,[{id:'m',text:'修改后',createdAt:1}]);
    assert.equal(result.queued,1); assert.equal(calls.length,2);
    assert.notEqual(calls[0].payload.messages[0].revision,calls[1].payload.messages[0].revision);
    result=await f.bridge.publishTurn(f.chat,null,[{id:'m',text:'修改后',createdAt:1}]);
    assert.equal(result.queued,1); assert.equal(result.pending,0); assert.equal(calls.length,3);
    assert.notEqual(calls[1].eventId,calls[2].eventId);
    assert.equal(calls[1].payload.messages[0].sourceMessageId,calls[2].payload.messages[0].sourceMessageId);
});

test('disabled service and a different archive cannot pause ordinary UvU replies', async () => {
    let state = { mode: 'offline', enabled: false, archiveId: 'a' };
    const f = harness(async () => ({ ok:true, json:async()=>state }));
    f.chat.activeArchiveId='a';
    assert.equal((await f.bridge.getMode('char-1')).mode, 'online');
    state={ mode:'offline', enabled:true, archiveId:'b' };
    assert.equal((await f.bridge.getMode('char-1')).mode, 'online');
});

test('disabled during receive never saves or acknowledges the late scene', async () => {
    let finish; const pending = new Promise(resolve => finish=resolve);
    const f=harness(async()=>pending); const running=f.bridge.syncIncoming('char-1');
    f.db.uvuStoryBridgeSettings.bridgeEnabled=false;
    finish({ok:true,json:async()=>({events:[{seq:1,characterKey:'char-1',kind:'scene_transcript',sceneId:'s',payload:{part:1,partCount:1,text:'late'}}]})});
    await assert.rejects(running,/互通已暂停/);
    assert.equal(f.chat.memoryJournals.length,0); assert.equal(f.db.uvuStoryBridgeSettings.cursorByCharacter['char-1'],undefined);
});

test('receive drains more than one page and only commits complete scenes', async () => {
    const events=Array.from({length:101},(_,i)=>({seq:i+1,characterKey:'char-1',kind:'scene_transcript',sceneId:'s',payload:{part:i+1,partCount:101,text:'段'+i}}));
    const cursors=[]; const f=harness(async url=>{
        const after=Number(new URL(url).searchParams.get('after'));
        if(url.includes('/client/events')) { cursors.push(after); return {ok:true,json:async()=>({events:events.filter(e=>e.seq>after).slice(0,100)})}; }
        return {ok:true,json:async()=>({})};
    });
    assert.equal(await f.bridge.syncIncoming('char-1'),1);
    assert.deepEqual(cursors,[0,100]); assert.equal(f.chat.memoryJournals.length,1);
    assert.equal(f.chat.memoryJournals[0].bridgeReview.status,'pending');
});

test('global inbox receives a different character while another chat is open', async () => {
    const f=harness(async url=>({ok:true,json:async()=>url.endsWith('/client/inbox')?{characters:[{characterKey:'char-2',latestSeq:1}]}:url.includes('/client/events')?{events:[{seq:1,characterKey:'char-2',kind:'scene_transcript',sceneId:'s',payload:{part:1,partCount:1,text:'角色二剧情'}}]}:{}}));
    f.db.characters.push({id:'char-2',memoryJournals:[]}); f.context.currentChatId='char-1'; f.context.currentChatType='private';
    await f.bridge.syncInbox();
    assert.equal(f.chat.memoryJournals.length,0); assert.equal(f.db.characters[1].memoryJournals.length,1);
});

test('cancelling an export retracts unreviewed drafts while preserving approved memories', async () => {
    const f=harness(async url=>({ok:true,json:async()=>url.includes('/client/events')?{events:[{seq:1,characterKey:'char-1',kind:'scene_cancelled',sceneId:'s',payload:{}}]}:{}}));
    f.chat.memoryJournals=[{id:'draft',source:'sillytavern',externalSceneId:'s',bridgeReview:{status:'pending'}},{id:'approved',source:'sillytavern',externalSceneId:'s',bridgeReview:{status:'approved'}}];
    await f.bridge.syncIncoming('char-1');
    assert.deepEqual(f.chat.memoryJournals.map(j=>j.id),['approved']);
});

test('bridge mode lookup uses the paired bearer token and requested character key', async () => {
    const calls = [];
    const { bridge } = harness(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ mode: 'offline' }) };
    });

    const mode = await bridge.getMode('char-1');
    assert.equal(mode.mode, 'offline');
    assert.match(calls[0].url, /\/client\/state\?characterKey=char-1$/);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer paired-token');
    assert.equal(calls[0].options.targetAddressSpace, 'loopback');
});

test('connection errors report the browser loopback permission state', async () => {
    const { bridge } = harness(async () => { throw new TypeError('Failed to fetch'); }, 'denied');
    await assert.rejects(bridge.getMode('char-1'), /loopback-network: denied.*Chrome 已拒绝此网站/);
});

test('disabled bridge does not flush queued events or alter the saved queue', async () => {
    const calls = [];
    const { bridge, db } = harness(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({}) };
    });
    db.uvuStoryBridgeSettings.bridgeEnabled = false;
    db.uvuStoryBridgeSettings.outbox = [{ characterKey: 'char-1', payload: { archiveId: 'default', messages: [{ id: 'm1' }] } }];
    await bridge.flushOutbox();
    assert.equal(calls.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.outbox.length, 1);
});

test('paired UvU sends stable character IDs and clear names to the local directory', async () => {
    const calls = [];
    const { bridge, db } = harness(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ characters: [{ id: 'char-1', name: '角色甲' }] }) };
    });
    db.characters[0].realName = '角色甲';

    await bridge.publishCharacterDirectory(true);
    assert.match(calls[0].url, /\/client\/characters$/);
    assert.equal(calls[0].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].options.body), { characters: [{ id: 'char-1', name: '角色甲' }] });
});

test('large outgoing messages label each part so SillyTavern can reassemble them', async () => {
    const calls = [];
    const { bridge, chat } = harness(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({}) };
    });
    await bridge.publishTurn(chat, null, [{ id: 'long-1', text: '一'.repeat(5001), createdAt: 10 }]);
    const sent = calls.filter(call => call.url.endsWith('/client/events')).map(call => JSON.parse(call.options.body));
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map(event => [event.payload.messages[0].messagePart, event.payload.messages[0].messagePartCount]), [[1, 2], [2, 2]]);
    assert.equal(sent[0].payload.messages[0].sourceMessageId, sent[1].payload.messages[0].sourceMessageId);
});

test('scene transcript parts form one draft memory before the event cursor is acknowledged', async () => {
    const calls = [];
    const { bridge, chat, db } = harness(async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/client/events?')) {
            return { ok: true, json: async () => ({
                events: [
                    { seq: 1, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'scene-a', createdAt: 1000, payload: { title: '夜晚散步', part: 1, partCount: 2, text: '两人走到河边。' } },
                    { seq: 2, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'scene-a', createdAt: 1000, payload: { title: '夜晚散步', part: 2, partCount: 2, text: '角色答应下周再见。' } }
                ]
            }) };
        }
        return { ok: true, json: async () => ({ cursor: 2 }) };
    });

    const imported = await bridge.syncIncoming('char-1');
    assert.equal(imported, 1);
    assert.equal(chat.memoryJournals.length, 1);
    assert.equal(chat.memoryJournals[0].content, '两人走到河边。\n\n角色答应下周再见。');
    assert.equal(chat.memoryJournals[0].isFavorited, false);
    assert.equal(chat.memoryJournals[0].source, 'sillytavern');
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter['char-1'], 2);
    assert.equal(calls.at(-1).url.endsWith('/client/ack'), true);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { seq: 2, characterKey: 'char-1' });
});

test('bridge refuses a scene event routed to a different character ID', async () => {
    const { bridge, db, chat, output } = harness(async () => ({
        ok: true,
        json: async () => ({ events: [{ seq: 1, characterKey: 'char-2', kind: 'scene_transcript', sceneId: 'wrong-char', payload: { part: 1, partCount: 1, text: '错配剧情' } }] })
    }));

    const imported = await bridge.syncIncoming('char-1');
    assert.equal(imported, 0);
    assert.equal(chat.memoryJournals.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter?.['char-1'], undefined);
    assert.match(output.textContent, /角色 ID 不匹配/);
});

test('a dropped queue range is reported without advancing the local cursor', async () => {
    const { bridge, db, chat, output } = harness(async () => ({
        ok: true,
        json: async () => ({ events: [], gapDetected: true, latestSeq: 5000 })
    }));

    const imported = await bridge.syncIncoming('char-1');
    assert.equal(imported, 0);
    assert.equal(chat.memoryJournals.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter?.['char-1'], undefined);
    assert.match(output.textContent, /不能确认剧情完整/);
});

test('bridge review text removes reasoning and code blocks while preserving story prose', () => {
    const helper = require('../js/modules/bridge_text.js');
    assert.equal(helper.clean('<style>.card{color:red}</style><div>两人在车站见面。</div><thinking>内部推理</thinking>'), '两人在车站见面。');
    assert.equal(helper.clean('他们约好下周见。\n```javascript\nrenderStatus();\n```'), '他们约好下周见。');
    assert.equal(helper.clean('<thinking>没有闭合的思维链'), '');
});

test('unreviewed or unchecked Tavern journals are blocked from injection', () => {
    const { bridge, chat } = harness(async () => ({ ok: true, json: async () => ({}) }));
    const journal = { source: 'sillytavern', isFavorited: true, content: '剧情', bridgeReview: { status: 'pending', items: [{ selected: true, text: '剧情' }] } };
    assert.equal(bridge.allowedMemory(chat, journal), false);
    journal.bridgeReview.status = 'approved';
    journal.bridgeReview.items[0].selected = false;
    assert.equal(bridge.allowedMemory(chat, journal), false);
    journal.bridgeReview.items[0].selected = true;
    assert.equal(bridge.allowedMemory(chat, journal), true);
});

test('incomplete or noncontiguous scene parts are never committed', async () => {
    const { bridge, chat, db } = harness(async () => ({ ok: true, json: async () => ({ events: [
        { seq: 1, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'bad-parts', createdAt: 1, payload: { part: 1, partCount: 2, text: '第一段' } },
        { seq: 2, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'bad-parts', createdAt: 1, payload: { part: 3, partCount: 2, text: '越界片段' } }
    ] }) }));
    await assert.rejects(bridge.syncIncoming('char-1'), /分段格式无效/);
    assert.equal(chat.memoryJournals.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter?.['char-1'], undefined);
});

test('archive switch during receive cannot write scene data into the new archive', async () => {
    let resolveFetch;
    const pending = new Promise(resolve => { resolveFetch = resolve; });
    const { bridge, chat, db } = harness(async () => pending);
    chat.activeArchiveId = 'archive-a';
    const running = bridge.syncIncoming('char-1');
    chat.activeArchiveId = 'archive-b';
    resolveFetch({ ok: true, json: async () => ({ events: [{ seq: 1, characterKey: 'char-1', kind: 'scene_transcript', sceneId: 'scene-a', createdAt: 1, payload: { part: 1, partCount: 1, text: '不能写入新存档' } }] }) });
    await assert.rejects(running, /存档已切换/);
    assert.equal(chat.memoryJournals.length, 0);
    assert.equal(db.uvuStoryBridgeSettings.cursorByCharacter?.['char-1'], undefined);
});

function handoffDom(f) {
    const elements = {};
    for (const id of ['uvu-bridge-handoff-character','uvu-bridge-handoff-start','uvu-bridge-handoff-end','uvu-bridge-handoff-source']) elements[id]={value:'',dataset:{},textContent:'',children:[],replaceChildren(){this.children=[];this.value='';},append(child){this.children.push(child);}};
    f.context.document.getElementById=id=>elements[id] || null;
    f.context.document.createElement=()=>({value:'',textContent:''});
    return elements;
}

test('entering bridge follows current private chat instead of the startup character selection', () => {
    const f=harness(async()=>({ok:true,json:async()=>({})})), dom=handoffDom(f);
    f.chat.activeArchiveId='main'; f.chat.history=[];
    const branch={id:'char-2',realName:'B',activeArchiveId:'branch',history:[{id:'new',role:'user',content:'CURRENT_BRANCH'}],archives:[{id:'main',name:'主存档',data:{history:[]}},{id:'branch',name:'当前分支',data:{history:[]}}]};
    f.db.characters.push(branch); dom['uvu-bridge-handoff-character'].value='char-1';
    f.context.currentChatId='char-2'; f.context.currentChatType='private';
    f.bridge.refreshHandoffContext();
    assert.equal(dom['uvu-bridge-handoff-character'].value,'char-2');
    assert.equal(Number(dom['uvu-bridge-handoff-end'].value),1);
    assert.match(dom['uvu-bridge-handoff-source'].textContent,/当前分支.*branch/);
});

test('handoff uses live active branch history, labels its range and resets stale manual range on archive switch', async () => {
    const sent=[],f=harness(async(url,options)=>{if(url.endsWith('/client/events'))sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({})};});
    const dom=handoffDom(f); Object.assign(f.chat,{activeArchiveId:'branch',realName:'A',history:[{id:'new',role:'user',content:'CURRENT_LIVE',timestamp:1000}],archives:[{id:'main',name:'主存档',data:{history:[{id:'old',role:'user',content:'OLD_MAIN'}]}},{id:'branch',name:'分支一',data:{history:[{id:'stale',role:'user',content:'STALE_SNAPSHOT'}]}}]});
    f.context.currentChatId=f.chat.id; f.context.currentChatType='private';
    Object.assign(dom['uvu-bridge-handoff-start'],{value:'50',dataset:{manual:'true',identity:'char-1:main'}});
    f.bridge.refreshHandoffContext();
    assert.equal(Number(dom['uvu-bridge-handoff-start'].value),1);
    await f.bridge.handoffCurrent();
    assert.equal(sent.length,1); assert.equal(sent[0].payload.archiveId,'branch');
    assert.equal(sent[0].payload.archiveName,'分支一');
    assert.match(sent[0].payload.messages[0].text,/CURRENT_LIVE/);
    assert.doesNotMatch(sent[0].payload.messages[0].text,/OLD_MAIN|STALE_SNAPSHOT/);
    assert.equal(sent[0].payload.handoff.start,1); assert.equal(sent[0].payload.handoff.end,1);
    assert.equal(sent[0].payload.handoff.count,1); assert.equal(sent[0].payload.handoff.totalMessages,1);
    assert.equal(sent[0].payload.handoff.latestMessageAt,1000);
});

test('archive switch during persistence cannot relabel a frozen manual handoff', async () => {
    let release; const pending=new Promise(resolve=>release=resolve),sent=[];
    const f=harness(async(url,options)=>{if(url.endsWith('/client/events'))sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({})};});
    handoffDom(f); Object.assign(f.chat,{activeArchiveId:'branch',history:[{id:'m',role:'user',content:'BRANCH'}],archives:[{id:'branch',name:'分支'}]});
    f.context.currentChatId=f.chat.id; f.context.currentChatType='private'; f.bridge.refreshHandoffContext();
    f.context.saveData=async()=>pending; const running=f.bridge.handoffCurrent();
    f.chat.activeArchiveId='other'; f.chat.history=[{id:'x',role:'user',content:'OTHER'}];
    release(); await running;
    assert.equal(sent[0].payload.archiveId,'branch'); assert.match(sent[0].payload.messages[0].text,/BRANCH/);
    assert.doesNotMatch(sent[0].payload.messages[0].text,/OTHER/);
});


test('automatic handoff retains complete multi-message turn and republishes revisions',async()=>{
 const calls=[];const f=harness(async(url,options)=>{calls.push(JSON.parse(options.body||'{}'));return {ok:true,json:async()=>({})};});
 f.chat.history=Array.from({length:12},(_,i)=>({id:'m'+i,role:i?'assistant':'user',content:'story'+i}));
 await f.bridge.publishTurn(f.chat,{mode:'phone'});
 assert.equal(calls.filter(c=>c.payload?.messages).length,12);
 f.chat.history[11].content='edited';await f.bridge.publishTurn(f.chat,{mode:'phone'});
 assert.equal(calls.filter(c=>c.payload?.messages).length,13);
 assert.match(calls.at(-1).payload.messages[0].text,/edited/);
});

test('review rollback removes properties absent before failed save',async()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));
 const journal={id:'j',source:'sillytavern',content:'source',bridgeReview:{sourceText:'source',status:'pending',items:[]}};
 f.chat.memoryJournals=[journal];f.context.saveData=async()=>{throw new Error('quota');};
 const before=JSON.stringify(journal);
 await assert.rejects(f.bridge.persistReview(f.chat,journal,[{id:'1',text:'story',selected:true}]),/quota/);
 assert.equal(JSON.stringify(journal),before);
});

test('legacy status command is excluded without filtering ordinary narrative',()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));
 f.chat.history=[{id:'s',role:'assistant',content:'[A更新状态为：在路上]'}];
 assert.equal(f.bridge.latestHandoffRange(f.chat).count,0);
 f.chat.history.push({id:'m',role:'assistant',content:'他说状态很好，便继续上路。'});
 assert.equal(f.bridge.latestHandoffRange(f.chat).count,1);
});

test('explicit recovery receives complete fresh scenes after queue gap and relay reset',async()=>{
 const f=harness(async url=>({ok:true,json:async()=>url.includes('/events?')?{relayId:'new',latestSeq:1,gapDetected:true,events:[{seq:1,kind:'scene_transcript',characterKey:'char-1',sceneId:'fresh',payload:{part:1,partCount:1,text:'fresh story'}}]}:{}}));
 f.db.uvuStoryBridgeSettings.cursorByCharacter={'char-1':99};
 f.db.uvuStoryBridgeSettings.relayByCharacter={'char-1':'old'};
 await f.bridge.syncIncoming('char-1');assert.equal(f.chat.memoryJournals.length,0);
 await f.bridge.syncIncoming('char-1',20,true);
 assert.equal(f.chat.memoryJournals.length,1);
 assert.equal(f.db.uvuStoryBridgeSettings.cursorByCharacter['char-1'],1);
 assert.equal(f.chat.memoryJournals[0].isFavorited,false);
});


test('explicit recovery preserves complete pending scenes for other archives',async()=>{
 const f=harness(async url=>({ok:true,json:async()=>url.includes('/events?')?{events:[{seq:1,characterKey:'char-1',kind:'scene_transcript',sceneId:'fresh',payload:{part:1,partCount:1,text:'fresh'}}]}:{}}));
 f.db.uvuStoryBridgeSettings.pendingScenes={'char-1:old':{characterKey:'char-1',partCount:1,parts:{1:'complete waiting story'},archiveId:'other'}};
 await f.bridge.syncIncoming('char-1',20,true);
 assert.equal(f.db.uvuStoryBridgeSettings.pendingScenes['char-1:old'].parts[1],'complete waiting story');
});


test('forced review refresh preserves unsaved text and selection in its own archive',()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));
 function element(tag){return {tag,children:[],listeners:{},attributes:{},value:'',checked:false,dataset:{},append(...v){this.children.push(...v);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.listeners[k]=v;},contains(){return false;}};}
 const host=element('host');f.context.document.createElement=element;
 f.context.document.getElementById=id=>id==='uvu-bridge-review-list'?host:null;
 const journal={id:'j',source:'sillytavern',content:'ORIGINAL',bridgeReview:{archiveId:'a',sourceText:'ORIGINAL',items:[{id:'i',text:'ORIGINAL',selected:false}]}};
 f.chat.activeArchiveId='a';f.chat.memoryJournals=[journal];
 const find=(root,tag)=>root.tag===tag && (tag!=='input' || root.attributes?.['aria-label']==='允许这条剧情加入上下文')?root:root.children.flatMap(c=>typeof c==='object'?[find(c,tag)]:[]).find(Boolean);
 f.bridge.renderReview(true);
 let text=find(host,'textarea'),check=find(host,'input');
 text.value='UNSAVED';text.listeners.input();check.checked=true;check.listeners.change();
 f.bridge.renderReview(true);
 assert.equal(find(host,'textarea').value,'UNSAVED');assert.equal(find(host,'input').checked,true);
 assert.equal(journal.content,'ORIGINAL');
});

test('reconnect preserves binding offline, backs off, and stops automatic retries after revocation',async()=>{
 let calls=0,mode='offline';
 const f=harness(async url=>{calls++;if(mode==='offline')throw new Error('offline');if(mode==='revoked')return {ok:false,status:401,json:async()=>({error:'revoked'})};return {ok:true,json:async()=>url.endsWith('/client/session')?{paired:true,device:{id:'a',name:'手机'}}:{characters:[]}};});
 assert.equal(typeof f.bridge.reconnect,'function');
 await f.bridge.reconnect();assert.equal(f.bridge.isConnected(),true);assert.equal(f.bridge.connectionSnapshot().phase,'waiting');
 const after=calls;await f.bridge.reconnect();assert.equal(calls,after);
 mode='online';await f.bridge.reconnect({force:true});assert.equal(f.bridge.connectionSnapshot().phase,'connected');
 mode='revoked';await f.bridge.reconnect({force:true});assert.equal(f.bridge.connectionSnapshot().phase,'revoked');
 const revokedCalls=calls;await f.bridge.reconnect();assert.equal(calls,revokedCalls);assert.equal(f.bridge.isConnected(),true);
});

test('credentials are never forwarded after changing the saved bridge endpoint',async()=>{
 const calls=[];const f=harness(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({mode:'online'})};});
 await f.bridge.getMode('char-1');
 f.db.uvuStoryBridgeSettings.baseUrl='http://127.0.0.1:9999/api/plugins/uvu-story-bridge';
 await assert.rejects(f.bridge.getMode('char-1'),/地址|绑定/);
 assert.equal(calls.length,1);assert.equal(f.bridge.isConnected(),true);
});

test('transport chunks reconstruct whole floors without merging speakers or paragraphs',async()=>{
 const floor={id:'f1',number:12,speaker:'角色',role:'assistant',createdAt:2,extraction:'tagged',bodyTag:'content',partCount:2};
 const events=[
  {seq:1,characterKey:'char-1',kind:'scene_transcript',sceneId:'floors',payload:{sceneFormat:'floors-v1',part:1,partCount:3,text:'第一段。\n\n第二',floor:{...floor,part:1}}},
  {seq:2,characterKey:'char-1',kind:'scene_transcript',sceneId:'floors',payload:{sceneFormat:'floors-v1',part:2,partCount:3,text:'段。',floor:{...floor,part:2}}},
  {seq:3,characterKey:'char-1',kind:'scene_transcript',sceneId:'floors',payload:{sceneFormat:'floors-v1',part:3,partCount:3,text:'我答应了。',floor:{...floor,id:'f2',number:13,speaker:'User',role:'user',part:1,partCount:1}}}
 ];
 const f=harness(async url=>({ok:true,json:async()=>url.includes('/client/events')?{events}:{}}));
 await f.bridge.syncIncoming('char-1');
 const journal=f.chat.memoryJournals[0];assert.equal(journal.bridgeReview.items.length,2);
 assert.equal(journal.bridgeReview.items[0].text,'第一段。\n\n第二段。');
 assert.equal(journal.bridgeReview.items[0].floor.number,12);
 assert.equal(journal.isFavorited,false);assert.equal(f.bridge.allowedMemory(f.chat,journal),false);
 await f.bridge.persistReview(f.chat,journal,journal.bridgeReview.items.map((item,i)=>({...item,text:i?'未选择':'编辑后的完整一层 <content>字面标签 <status>例子</status>',selected:i===0})));
 assert.match(journal.content,/角色/);assert.match(journal.content,/编辑后的完整一层/);assert.doesNotMatch(journal.content,/未选择/);
 assert.equal(journal.bridgeReview.items[0].floor.number,12);
 assert.equal(journal.category,'酒馆线下剧情');assert.equal(f.bridge.allowedMemory(f.chat,journal),true);
 assert.ok(journal.content.includes('<content>字面标签 <status>例子</status>'));
});

test('conflicting floor chunks fail without saving a journal or moving cursor',async()=>{
 const floor={id:'f',number:1,speaker:'A',role:'assistant',createdAt:1,extraction:'tagged',bodyTag:'content',partCount:2};
 const events=[1,2].map(part=>({seq:part,characterKey:'char-1',kind:'scene_transcript',sceneId:'badfloor',payload:{sceneFormat:'floors-v1',part,partCount:2,text:'正文',floor:{...floor,part,speaker:part===1?'A':'B'}}}));
 const f=harness(async()=>({ok:true,json:async()=>({events})}));
 await assert.rejects(f.bridge.syncIncoming('char-1'),/楼层/);
 assert.equal(f.chat.memoryJournals.length,0);
 assert.equal(f.db.uvuStoryBridgeSettings.cursorByCharacter['char-1'],undefined);
});

test('old timestamp exports group paragraphs into source floors',async()=>{
 const f=harness(async()=>({ok:true,json:async()=>({events:[{seq:1,characterKey:'char-1',kind:'scene_transcript',sceneId:'legacyfloor',payload:{part:1,partCount:1,text:'[2026-11-05T00:00:00.000Z | A]\n第一段。\n\n第二段。\n\n[2026-11-05T00:01:00.000Z | User]\n回答。'}}]})}));
 await f.bridge.syncIncoming('char-1');
 assert.equal(f.chat.memoryJournals[0].bridgeReview.items.length,2);
 assert.equal(f.chat.memoryJournals[0].bridgeReview.items[0].text,'第一段。\n\n第二段。');
});


test('late automatic failure cannot overwrite disconnected state',async()=>{
 let rejectDirectory,started;const ready=new Promise(resolve=>started=resolve);
 const f=harness(async url=>{
  if(url.endsWith('/client/session'))return {ok:true,json:async()=>({paired:true})};
  if(url.endsWith('/client/characters')){started();return new Promise((_,reject)=>rejectDirectory=reject);}
  return {ok:true,json:async()=>({})};
 });
 const running=f.context.window.__bridgeTest.automaticSync();await ready;
 await f.context.window.__bridgeTest.disconnect();
 rejectDirectory(new Error('late offline'));await running;
 assert.equal(f.bridge.connectionSnapshot().phase,'unpaired');
 assert.equal(f.bridge.isConnected(),false);
});
