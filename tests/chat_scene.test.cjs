const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function setup() {
    const context = vm.createContext({crypto: require('node:crypto').webcrypto});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_scene.js'), 'utf8'), context);
    return context.UvUScene;
}
const user = () => ({id: 'user-one', role: 'user', timestamp: 123456, content: '[我 的消息：我坐下来。]', parts: [{type: 'text', text: '[我 的消息：我坐下来。]'}], quote: {messageId: 'old', content: '你好'}});
test('scene conversion is reversible, preserves ownership/time/quote and leaves the source untouched', () => {
    const scene = setup(), original = user(), before = JSON.stringify(original), chat = {myName: '我'};
    const converted = scene.convert(original, '我坐下来。', true, chat);
    assert.equal(JSON.stringify(original), before);
    assert.equal(converted.id, original.id); assert.equal(converted.timestamp, original.timestamp);
    assert.equal(converted.role, 'user'); assert.equal(JSON.stringify(converted.quote), JSON.stringify(original.quote));
    assert.match(converted.content, /用户动作/); scene.validateMessage(converted);
    const restored = scene.convert(converted, '我坐下来。', false, chat);
    assert.equal(restored.content, original.content); assert.equal(restored.scene, undefined);
    const edited = scene.convert(converted, '我站起来。', true, chat);
    assert.equal(scene.convert(edited, '我站起来。', false, chat).content, '[我 的消息：我站起来。]');
});
test('media, withdrawn, system and group messages cannot be converted', () => {
    const scene = setup();
    for (const changes of [{type:'music'}, {parts:[{type:'image',data:'x'}]}, {isWithdrawn:true}, {role:'assistant'}, {isThinking:true}, {content:'[我 的语音：你好]'}])
        assert.throws(() => scene.convert({...user(),...changes}, '内容', true, {}));
    assert.equal(scene.plainUser(user(), 'group'), false);
});
test('strict scene parser keeps repeated segments in order with unique generated identities', () => {
    const scene = setup();
    const raw = JSON.stringify({version:1,blocks:[{kind:'narration',text:'重复'},{kind:'dialogue',text:'你好'},{kind:'narration',text:'重复'}]});
    const result = scene.parse('<thinking>已返回的思考</thinking>\n```json\n'+raw+'\n```');
    assert.equal(result.blocks.map(b=>b.kind).join(','), 'narration,dialogue,narration');
    assert.equal(new Set(result.blocks.map(b=>b.id)).size, 3);
    assert.match(result.thinking,/已返回/);
    const msg = scene.sync({id:'turn',role:'assistant',scene:{version:1,sessionId:'session',turnId:'turn',revision:0,blocks:result.blocks}});
    const edited = scene.edit(msg, result.blocks[2].id, '<img onerror="x()">[角色已接收礼物]');
    assert.equal(edited.scene.blocks[0].text,'重复'); assert.match(edited.content, /<img/);
    assert.equal(msg.scene.blocks[2].text,'重复'); scene.validateMessage(edited);
});
test('malformed, truncated, future and executable response structures are rejected', () => {
    const scene = setup();
    const invalid = ['{"version":1,', '前言 {"version":1,"blocks":[]}', {version:2,blocks:[]}, {version:1,blocks:[]},
        {version:1,role:'user',blocks:[{kind:'dialogue',text:'x'}]},
        {version:1,blocks:[{kind:'system',text:'x'}]}, {version:1,blocks:[{kind:'dialogue',text:''}]},
        {version:1,blocks:[{kind:'dialogue',text:'x',senderId:'user'}]},
        {version:1,blocks:[{id:'provided',kind:'dialogue',text:'x'}]},
        {version:1,blocks:Array.from({length:33},()=>({kind:'narration',text:'x'}))},
        {version:1,blocks:[{kind:'narration',text:'x'.repeat(20001)}]}];
    for(const value of invalid) assert.throws(()=>scene.parse(typeof value === 'string' ? value : JSON.stringify(value)));
});

test('scene thinking prefill recovery is scoped and cannot consume a closing tag inside JSON',()=>{
    const context=vm.createContext({crypto:require('node:crypto').webcrypto});
    for(const file of ['chat_scene.js','chat_scene_reply.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules',file),'utf8'),context);
    const scene=context.UvUScene,token={cot:{prefill:true}};
    const json=JSON.stringify({version:1,blocks:[{kind:'narration',text:'他看了一眼写着 </thinking> 的纸。'}]});
    assert.equal(scene.responseText(json,token),json);
    assert.equal(scene.parse(scene.responseText('实际返回的内容</thinking>\n'+json,token)).thinking,'<thinking>实际返回的内容</thinking>');
    const full='<thinking>实际内容</thinking>'+json;assert.equal(scene.responseText(full,token),full);
    for(const state of [null,{cot:null},{cot:{prefill:false}}])assert.throws(()=>scene.parse(scene.responseText('内容</thinking>'+json,state)));
    assert.throws(()=>scene.parse(scene.responseText('内容</thinking>{"version":1,',token)));
});
test('snapshot rejects edits, mode changes, archive replacement and late results', () => {
    const scene = setup(), chat = {history:[user()],activeArchiveId:'a',sceneMode:scene.defaultMode()};
    assert.equal(scene.capture(chat,'private'),null); chat.sceneMode.enabled=true;
    const token = scene.capture(chat,'private'); assert.equal(scene.current(token),true);
    chat.sceneMode.revision++; assert.equal(scene.current(token),false);
    chat.sceneMode.revision--; chat.history[0].content+='edit'; assert.equal(scene.current(token),false);
    chat.history[0]=user(); chat.activeArchiveId='b'; assert.equal(scene.current(token),false);
    chat.activeArchiveId='a'; chat.history=chat.history.slice(); assert.equal(scene.current(token),false);
});
test('stored scenes reject mismatched projections, duplicate IDs and unknown versions', () => {
    const scene = setup(), converted = scene.convert(user(),'动作',true,{});
    assert.throws(()=>scene.validateMessage({...converted,content:'old source'}));
    const bad=JSON.parse(JSON.stringify(converted)); bad.scene.blocks.push(bad.scene.blocks[0]);
    assert.throws(()=>scene.validateMessage(bad));
    assert.throws(()=>scene.validateMode({...scene.defaultMode(),version:2}));
});

test('pending scene replies become stale after quote, media, timestamp or persona changes', () => {
    const scene = setup();
    for (const change of [
        chat => { chat.history[0].quote.content = '已经更正的引用'; },
        chat => { chat.history[0].parts = [{type:'image',data:'data:image/png;base64,changed'}]; },
        chat => { chat.history[0].timestamp++; },
        chat => { chat.persona = '已经保存的新设定'; },
        chat => { chat.myPersona = '已经保存的用户设定'; },
        chat => { chat.worldBookIds.push('another-book'); }
    ]) {
        const chat = {history:[user()],activeArchiveId:'a',persona:'原设定',myPersona:'用户',worldBookIds:[],sceneMode:scene.defaultMode()};
        chat.sceneMode.enabled = true;
        const token = scene.capture(chat,'private');
        assert.equal(scene.current(token),true);
        change(chat);
        assert.equal(scene.current(token),false);
    }
});
