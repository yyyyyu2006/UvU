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
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/bridge_summary.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/bridge_file.js'), 'utf8'), context);
    const source = fs.readFileSync(path.join(__dirname, '../js/modules/story_bridge.js'), 'utf8');
    vm.runInContext(source.replace('window.setupUvUStoryBridge =', 'window.__bridgeTest = {automaticSync, disconnect, pair}; window.setupUvUStoryBridge ='), context);
    return { bridge: context.window.UvUStoryBridge, db, chat, output, context };
}
test('review stages distinguish received, approved and injectable for the bound archive', () => {
 const f=harness(async()=>({ok:true}));f.chat.activeArchiveId='a';
 const journal={source:'sillytavern',isFavorited:false,bridgeReview:{channel:'st',archiveId:'a',status:'pending',items:[{selected:true,text:'正文'}]}};
 assert.equal(f.bridge.memoryState(f.chat,journal),'已收到 · 待审核');
 journal.bridgeReview.status='approved';assert.equal(f.bridge.memoryState(f.chat,journal),'已批准 · 未收藏');
 journal.isFavorited=true;assert.equal(f.bridge.memoryState(f.chat,journal),'已批准 · 可注入');
 f.db.uvuStoryBridgeSettings.bridgeEnabled=false;assert.equal(f.bridge.memoryState(f.chat,journal),'已批准 · 来源停用');
 f.db.uvuStoryBridgeSettings.bridgeEnabled=true;f.chat.activeArchiveId='b';assert.equal(f.bridge.allowedMemory(f.chat,journal),false);
});

test('saved handoff character survives reentry and refresh never follows a different open chat', async () => {
 const f=harness(async()=>({ok:true,json:async()=>({})}));
 const other={id:'char-2',history:[{role:'user',content:'OTHER'}],activeArchiveId:'b'};f.db.characters.push(other);
 f.chat.history=[{role:'user',content:'PINNED'}];f.chat.activeArchiveId='a';
 f.context.currentChatType='private';f.context.currentChatId=other.id;
 const select={value:f.chat.id,replaceChildren(){},append(){}};
 const start={value:'',dataset:{}},end={value:''};
 f.context.document.createElement=()=>({});
 f.context.document.getElementById=id=>({'uvu-bridge-handoff-character':select,'uvu-bridge-handoff-start':start,'uvu-bridge-handoff-end':end}[id]||null);
 await f.bridge.saveHandoffCharacter();
 select.value='';f.bridge.refreshHandoffContext();assert.equal(select.value,f.chat.id);
 assert.equal(start.dataset.identity,'char-1:a');
 select.value=other.id;f.context.saveData=async()=>{throw new Error('quota');};
 await assert.rejects(f.bridge.saveHandoffCharacter(),/quota/);
 assert.equal(f.db.uvuStoryBridgeSettings.handoffCharacterId,f.chat.id);
});

test('scene summary preview stays gated until confirmed, replaces one journal and rolls back failed saves',async()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));
 const items=[{id:'f',text:'原剧情',selected:true,floor:{speaker:'甲',createdAt:0}}];
 const journal={id:'j',source:'sillytavern',externalSceneId:'s',content:'原剧情',isFavorited:false,
  bridgeReview:{version:2,archiveId:'default',status:'pending',sourceText:'原剧情',items}};f.chat.memoryJournals=[journal];
 f.context.UvUBridgeSummary.generate=async()=>({title:'摘要标题',content:'第三人称摘要',sourceSignature:f.context.UvUBridgeSummary.signature(items),items,batchCount:1});
 await f.bridge.summarizeReview(f.chat,journal,items,{});
 assert.equal(journal.content,'原剧情');assert.equal(f.bridge.allowedMemory(f.chat,journal),false);
 assert.equal(journal.bridgeReview.summaryDraft.content,'第三人称摘要');
 await assert.rejects(f.bridge.confirmSummary(f.chat,journal,[{...items[0],text:'后来修改'}]),/变更|修改/);
 const before=JSON.stringify(journal);f.context.saveData=async()=>{throw new Error('quota');};
 await assert.rejects(f.bridge.confirmSummary(f.chat,journal,items),/quota/);assert.equal(JSON.stringify(journal),before);
 f.context.saveData=async()=>{};await f.bridge.confirmSummary(f.chat,journal,items);
 assert.equal(journal.content,'第三人称摘要');assert.equal(journal.bridgeReview.memoryMode,'summary');
 assert.equal(f.bridge.allowedMemory(f.chat,journal),true);assert.equal(f.chat.memoryJournals.length,1);
 assert.equal(journal.bridgeReview.sourceText,'原剧情');
});

test('late scene summary cannot apply after archive change or source edit',async()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));
 const items=[{id:'f',text:'剧情',selected:true}],journal={id:'j',source:'sillytavern',content:'剧情',bridgeReview:{version:2,archiveId:'default',items}};f.chat.memoryJournals=[journal];
 let release,started;const ready=new Promise(resolve=>started=resolve);f.context.UvUBridgeSummary.generate=async()=>new Promise(resolve=>{release=()=>resolve({title:'摘要',content:'旧结果',sourceSignature:f.context.UvUBridgeSummary.signature(items),items});started();});
 const pending=f.bridge.summarizeReview(f.chat,journal,items,{});await ready;f.chat.activeArchiveId='other';release();
 await assert.rejects(pending,/存档|变更/);assert.equal(journal.bridgeReview.summaryDraft,undefined);
});

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

test('reading handoff selection keeps the selected role even when another private chat is open', () => {
    const f=harness(async()=>({ok:true,json:async()=>({})})), dom=handoffDom(f);
    f.chat.activeArchiveId='main'; f.chat.history=[];
    const branch={id:'char-2',realName:'B',activeArchiveId:'branch',history:[{id:'new',role:'user',content:'CURRENT_BRANCH'}],archives:[{id:'main',name:'主存档',data:{history:[]}},{id:'branch',name:'当前分支',data:{history:[]}}]};
    f.db.characters.push(branch); dom['uvu-bridge-handoff-character'].value='char-1';
    dom['uvu-bridge-handoff-character'].value='char-2';
    f.context.currentChatId='char-1'; f.context.currentChatType='private';
    f.bridge.refreshHandoffContext();
    assert.equal(dom['uvu-bridge-handoff-character'].value,'char-2');
    assert.equal(Number(dom['uvu-bridge-handoff-end'].value),1);
    assert.match(dom['uvu-bridge-handoff-source'].textContent,/当前分支.*branch/);
});
test('switching transport blocks concurrent pairing and receive until the channel save finishes',async()=>{
 const f=harness(async()=>{throw new Error('must not request');});let release;
 f.context.saveData=()=>new Promise(resolve=>release=resolve);
 const changing=f.bridge.changeChannel('tt');
 await assert.rejects(f.bridge.changeChannel('st'),/等待|切换/);
 await assert.rejects(f.context.window.__bridgeTest.pair(),/切换|等待/);
 assert.equal(f.bridge.isEnabled(),false);
 release();await changing;assert.equal(f.bridge.isEnabled(),true);
});
test('queued handoff save pins its transport until publishing completes',async()=>{
 const calls=[],f=harness(async(url,options)=>{calls.push(url);return {ok:true,json:async()=>({})};});let release;
 f.context.saveData=()=>new Promise(resolve=>release=()=>{f.context.saveData=async()=>{};resolve();});
 const publishing=f.bridge.publishTurn(f.chat,null,[{id:'m',text:'ST_SOURCE',createdAt:1}]);
 await assert.rejects(f.bridge.changeChannel('tt'),/等待/);
 release();await publishing;assert.equal(f.db.uvuStoryBridgeSettings.channel,undefined);assert.ok(calls.every(url=>url.startsWith('http://127.0.0.1:8765/')));
});

test('TT and original channels isolate addresses credentials and scene queues',async()=>{
 const calls=[],f=harness(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({mode:'online'})};});
 f.db.uvuStoryBridgeSettings.ttSettings={baseUrl:'https://relay.example.test/bridge',outbox:[{id:'tt-only'}]};
 await f.bridge.changeChannel('tt');assert.equal(f.bridge.isConnected(),false);
 f.context.localStorage.setItem('uvu-story-bridge.v1.tt',JSON.stringify({token:'tt-device',baseUrl:'https://relay.example.test/bridge'}));
 await f.bridge.getMode('char-1');assert.match(calls[0].url,/https:\/\/relay.example.test/);assert.equal(calls[0].options.headers.Authorization,'Bearer tt-device');
 await f.bridge.changeChannel('st');await f.bridge.getMode('char-1');
 assert.equal(calls[1].options.headers.Authorization,'Bearer paired-token');assert.equal(f.db.uvuStoryBridgeSettings.ttSettings.outbox.length,1);
});

test('file handoff receives complete checked floors once without touching relay cursor or requiring pairing',async()=>{
 const f=harness(async()=>{throw new Error('network must not be used');});
 f.context.document.getElementById=id=>id==='uvu-bridge-handoff-character'?{value:'char-1'}:null;
 f.context.localStorage.removeItem('uvu-story-bridge.v1');
 const text='文件剧情',partHash=await f.context.UvUBridgeFile.hash(text);
 const file={format:'uvu-bridge-file',version:1,direction:'to-uvu',characterKey:'char-1',archiveId:'default',events:[{
  eventId:'file:1',source:'sillytavern',kind:'scene_transcript',characterKey:'char-1',sceneId:'file-scene',createdAt:1,
  payload:{part:1,partCount:1,text,partHash,uvuArchiveId:'default',sceneFormat:'floors-v1',floor:{id:'f',number:1,speaker:'甲',role:'assistant',createdAt:0,part:1,partCount:1,extraction:'plain',bodyTag:''}}
 }]};
 f.db.uvuStoryBridgeSettings.cursorByCharacter={'char-1':99};
 assert.equal(await f.bridge.importSceneFile(JSON.stringify(file)),1);
 assert.equal(f.chat.memoryJournals[0].isFavorited,false);assert.equal(f.db.uvuStoryBridgeSettings.cursorByCharacter['char-1'],99);
 await f.bridge.importSceneFile(JSON.stringify(file));assert.equal(f.chat.memoryJournals.length,1);
 file.archiveId='wrong';await assert.rejects(f.bridge.importSceneFile(JSON.stringify(file)),/存档|目标/);
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
 const openDetails=root=>{for(const item of root.children){if(item?.tag==='details'){item.open=true;item.listeners.toggle?.();}if(item?.children)openDetails(item);}};openDetails(host);
 let text=find(host,'textarea'),check=find(host,'input');
 text.value='UNSAVED';text.listeners.input();check.checked=true;check.listeners.change();
 f.bridge.renderReview(true);openDetails(host);
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

test('review edit drafts survive reload, isolate channels archives and never apply old source versions',()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));
 const journal={id:'j',externalSceneId:'s',bridgeReview:{channel:'st',archiveId:'default',items:[{id:'f',text:'原文',selected:false}]}};f.chat.memoryJournals=[journal];
 f.bridge.writeReviewDraft(f.chat,journal,[{id:'f',text:'编辑',selected:true}]);
 assert.equal(f.bridge.readReviewDraft(f.chat,journal).items[0].text,'编辑');
 journal.bridgeReview.items[0].text='更新原文';assert.equal(f.bridge.readReviewDraft(f.chat,journal),null);
 journal.bridgeReview.items[0].text='原文';f.chat.activeArchiveId='other';assert.equal(f.bridge.readReviewDraft(f.chat,journal),null);
 f.chat.activeArchiveId='default';f.db.uvuStoryBridgeSettings.channel='tt';assert.equal(f.bridge.readReviewDraft(f.chat,journal),null);
});
test('mode lookup propagates caller abort without network diagnostic wrapping',async()=>{
 const f=harness(async(url,opts)=>new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true});}));
 f.context.AbortController=AbortController;const control=new AbortController();const pending=f.bridge.getMode('char-1',{signal:control.signal});control.abort();
 await assert.rejects(pending,error=>error.name==='AbortError');
});
test('safe capacity diagnostics contain counts but no tokens source text addresses or role identifiers',()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));f.db.uvuStoryBridgeSettings.outbox=[{payload:{text:'SECRET STORY'}}];
 const snapshot=f.bridge.diagnosticsSnapshot();assert.equal(snapshot.local.pendingSend,1);assert.equal(snapshot.local.remainingSend,499);
 assert.equal(snapshot.frontend.build,'20261109-audit-repairs');assert.equal(snapshot.frontend.protocolVersion,1);
 assert.doesNotMatch(JSON.stringify(snapshot),/paired-token|SECRET STORY|127\.0\.0\.1|char-1/);
});

test('scene and floor review load lazily and select all includes unloaded floors',()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));
 function element(tag){return {tag,children:[],listeners:{},attributes:{},dataset:{},value:'',append(...v){this.children.push(...v);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.listeners[k]=v;},contains(){return false;}};}
 const host=element('host');f.context.document.createElement=element;f.context.document.getElementById=id=>id==='uvu-bridge-review-list'?host:null;
 const items=Array.from({length:125},(_,i)=>({id:String(i),text:'楼层'+i,selected:false}));
 const journal={id:'j',source:'sillytavern',content:'原文',bridgeReview:{archiveId:'default',items}};f.chat.memoryJournals=[journal];
 const walk=root=>[root,...root.children.flatMap(x=>typeof x==='object'?walk(x):[])];f.bridge.renderReview(true);
 assert.equal(walk(host).filter(x=>x.tag==='textarea').length,0);
 const scene=host.children.find(x=>x.tag==='details');scene.open=true;scene.listeners.toggle();
 assert.equal(walk(host).filter(x=>x.className==='uvu-bridge-review-row').length,20);
 assert.equal(walk(host).filter(x=>x.attributes['aria-label']==='编辑整层剧情').length,0);
 const all=walk(host).find(x=>x.attributes['aria-label']==='全选本场剧情');all.checked=true;all.listeners.change();
 assert.equal(f.bridge.readReviewDraft(f.chat,journal).items.filter(x=>x.selected).length,125);
});

test('recovery never erases unrecovered scene parts just because relay has lost them',async()=>{
 const f=harness(async()=>({ok:true,json:async()=>({events:[]})}));
 f.db.uvuStoryBridgeSettings.pendingScenes={'char-1:lost':{characterKey:'char-1',archiveId:'default',partCount:2,parts:{1:'未恢复剧情'},floorParts:{}}};
 await f.bridge.syncIncoming('char-1',20,true);assert.equal(f.db.uvuStoryBridgeSettings.pendingScenes['char-1:lost'].parts[1],'未恢复剧情');
});

test('completed-only cleanup requires export and confirmation and preserves incomplete parts and dedup receipts',async()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})}));const state=f.db.uvuStoryBridgeSettings;
 f.chat.memoryJournals=[{id:'j',externalSceneId:'done',source:'sillytavern',bridgeReview:{channel:'st',archiveId:'default',status:'approved',items:[]}}];
 state.receipts={'char-1:done':{archiveId:'default',at:1}};state.pendingScenes={'char-1:done':{characterKey:'char-1',archiveId:'default',partCount:1,parts:{1:'saved'}},'char-1:lost':{characterKey:'char-1',partCount:2,parts:{1:'KEEP'}}};
 const preview=await f.bridge.cleanupCompleted();assert.equal(preview.completedSceneCopies,1);assert.equal(preview.protectedScenes,1);
 await assert.rejects(f.bridge.cleanupCompleted({dryRun:false,confirmed:true}),/导出/);assert.ok(state.pendingScenes['char-1:done']);
 f.context.saveData=async()=>{throw new Error('quota');};await assert.rejects(f.bridge.cleanupCompleted({dryRun:false,confirmed:true,exported:true}),/quota/);assert.ok(state.pendingScenes['char-1:done']);
 f.context.saveData=async()=>{};await f.bridge.cleanupCompleted({dryRun:false,confirmed:true,exported:true});assert.equal(state.pendingScenes['char-1:done'],undefined);assert.equal(state.pendingScenes['char-1:lost'].parts[1],'KEEP');assert.ok(state.receipts['char-1:done']);
});

test('summary group checkpoints persist independently from approval and resume only the exact source version',async()=>{
 const f=harness(async()=>({ok:true,json:async()=>({})})),items=[{id:'f',text:'剧情',selected:true}],key='a'.repeat(64);
 const journal={id:'j',source:'sillytavern',content:'原文',bridgeReview:{channel:'st',archiveId:'default',items,status:'pending'}};f.chat.memoryJournals=[journal];
 f.context.UvUBridgeSummary.generate=async(chat,input,options)=>{options.cache.set(key,{title:'分组',content:'分组结果'});await options.onCache(key,{title:'分组',content:'分组结果'});throw new Error('预算用完');};
 await assert.rejects(f.bridge.summarizeReview(f.chat,journal,items,{}),/预算/);assert.equal(journal.content,'原文');assert.equal(f.bridge.allowedMemory(f.chat,journal),false);assert.equal(journal.bridgeReview.summaryResume.entries.length,1);assert.match(journal.bridgeReview.summaryResume.sourceVersion,/^[a-f0-9]{64}$/);
 let reused;f.context.UvUBridgeSummary.generate=async(chat,input,options)=>{reused=options.cache.has(key);return {title:'摘要',content:'待确认摘要',items,sourceSignature:f.context.UvUBridgeSummary.signature(items)};};
 await f.bridge.summarizeReview(f.chat,journal,items,{});assert.equal(reused,true);assert.equal(journal.content,'原文');
 journal.bridgeReview.items[0].text='更新原文';await f.bridge.summarizeReview(f.chat,journal,journal.bridgeReview.items,{});assert.equal(reused,false);
});
