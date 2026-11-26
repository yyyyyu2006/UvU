const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const quiet={log(){},warn(){},error(){}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function context(extra={}) {return vm.createContext({console:quiet,window:{},setTimeout,clearTimeout,...extra});}
function load(c,...files){for(const file of files)vm.runInContext(source(file),c);return c;}
function chatOps(c){vm.runInContext(source('js/modules/chat_ops.js').split('function setup')[0],c);return c;}

async function cacheFixture(fail){
 const element=()=>({style:{},classList:{add(){},remove(){},contains(){return false}},disabled:false,textContent:''});
 const nodes=Object.fromEntries(['open-clean-cache-btn','clean-image-cache-modal','clean-image-cache-form','cancel-clean-btn','confirm-clean-btn','clean-cache-loading'].map(id=>[id,element()]));
 nodes['clean-image-cache-form'].querySelectorAll=()=>['chat','gallery','generated'].map(value=>({checked:true,value,addEventListener(){}}));
 const ordinary='保留中文正文'.repeat(240), image='data:image/png;base64,AAAA';
 const char={id:'c',activeArchiveId:'a',history:[{id:'text',content:ordinary},{id:'pic',content:image}],gallery:[{url:image},{url:image},{url:'https://example.invalid/a'}],archives:[{id:'a',data:{history:[],gallery:[{url:image},{url:'https://example.invalid/archive'}]}}]};
 const Dexie=require('dexie'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
 const dbx=new Dexie('cache-audit-'+Date.now()+'-'+Math.random(),{indexedDB,IDBKeyRange});
 dbx.version(1).stores({workshopHistory:'&id',characterPhotos:'&id',reader_comments:'&id'});
 await dbx.open();await dbx.workshopHistory.put({id:'w',image});await dbx.characterPhotos.put({id:'p',image});await dbx.reader_comments.put({id:'r',content:'[ILLUSTRATION]AAAA'});
 const c=context({document:{getElementById:id=>nodes[id]||null,addEventListener(){}},db:{characters:[char],groups:[],myStickers:[]},dexieDB:dbx,Blob,URL,
  runDataPersistence:fn=>fn(),showToast(){},saveData:async()=>{
   char.archives[0].data.history=structuredClone(char.history);
   if(fail){char.gallery.push({url:'https://example.invalid/later'});char.archives[0].data.gallery.push({url:'https://example.invalid/concurrent'});char.history[0].content=ordinary+'新编辑';throw Error('quota')}
  }});
 load(c,'js/modules/storage.js');c.window.setupCleanImageCache();
 try {await nodes['clean-image-cache-form'].onsubmit({preventDefault(){}});return{char,ordinary,image,counts:await Promise.all([dbx.workshopHistory.count(),dbx.characterPhotos.count(),dbx.reader_comments.count()])};}
 finally{dbx.close();await dbx.delete();}
}
test('image cleanup preserves long text and clears current and archived character galleries together',async()=>{
 const h=await cacheFixture(false);assert.equal(h.char.history[0].content,h.ordinary);assert.equal(h.char.history[1].content,'[图片已清理]');assert.deepEqual(h.counts,[0,0,0]);assert.equal(h.char.gallery.length,1);assert.deepEqual(h.char.archives[0].data.gallery,[{url:'https://example.invalid/archive'}]);
});
test('failed image cleanup restores pictures, nameless gallery and archive clones while retaining later edits',async()=>{
 const h=await cacheFixture(true);assert.equal(h.char.history[0].content,h.ordinary+'新编辑');assert.equal(h.char.history[1].content,h.image);assert.equal(h.char.archives[0].data.history[1].content,h.image);assert.equal(h.char.gallery.filter(x=>x.url===h.image).length,2);assert.equal(h.char.gallery.at(-1).url,'https://example.invalid/later');assert.equal(h.char.archives[0].data.gallery.filter(x=>x.url===h.image).length,1);assert.equal(h.char.archives[0].data.gallery.at(-1).url,'https://example.invalid/concurrent');assert.deepEqual(h.counts,[1,1,1]);
});
test('battery reminder applies the shared context filter to its bounded recent history',()=>{
 const received=[];const history=Array.from({length:35},(_,i)=>({id:i,content:String(i),isContextDisabled:i===34,relationshipDelivery:i===33}));
 const c=context({filterHistoryForAI:(chat,items)=>{received.push(...items);return items.filter(item=>!item.isContextDisabled);}});
 load(c,'js/modules/battery_interaction.js');const selected=c.batteryReminderHistory({history});
 assert.equal(received.length,29);assert.equal(selected.length,28);assert.equal(selected.some(item=>item.id===34),false);assert.equal(selected.some(item=>item.id===33),false);assert.equal(selected[0].id,5);
 const fallback=context();load(fallback,'js/modules/battery_interaction.js');assert.deepEqual(fallback.batteryReminderHistory({history:[{id:'hidden',isContextDisabled:true},{id:'withdrawn',isWithdrawn:true},{id:'visible'}]}).map(item=>item.id),['visible']);
});
test('sticker group save failure rolls back only this move and leaves concurrent edits intact',async()=>{
 const gate=deferred(),a={id:'a',group:'old'},b={id:'b'};const notices=[];
 const c=context({db:{myStickers:[a,b]},saveData:()=>gate.promise,showToast:message=>notices.push(message)});load(c,'js/modules/sticker.js');
 const pending=c.moveStickersToGroup(['a','b'],'new');b.group='concurrent';gate.reject(Error('quota'));
 assert.equal(await pending,false);assert.equal(a.group,'old');assert.equal(Object.hasOwn(b,'group'),true);assert.equal(b.group,'concurrent');assert.match(notices[0],/保存失败/);
 c.saveData=async()=>{};assert.equal(await c.moveStickersToGroup(['a','b'],'new'),true);assert.equal(a.group,'new');assert.equal(b.group,'new');
});
test('message wrapper lookup compares IDs as data, including selector metacharacters',()=>{
 const wrappers=[{dataset:{id:'msg-"[x]'},classList:{add(){},remove(){}}},{dataset:{id:'ordinary'},classList:{add(){},remove(){}}}];
 const root={querySelectorAll:selector=>{assert.equal(selector,'.message-wrapper[data-id]');return wrappers;}};const c=context();load(c,'js/modules/chat_ops.js');
 const found=c.findChatMessageWrappersById(root,'msg-"[x]');assert.equal(found.length,1);assert.equal(found[0],wrappers[0]);
});
test('starting the call timer twice replaces the old interval',()=>{
 const intervals=new Map();let next=0;const cleared=[];const node={textContent:''};
 const c=context({document:{getElementById:()=>node,addEventListener(){}},setInterval:(fn,ms)=>{intervals.set(++next,{fn,ms});return next;},clearInterval:id=>{cleared.push(id);intervals.delete(id);}});
 load(c,'js/modules/video_call.js');const module=vm.runInContext('VideoCallModule',c);module.startTimer();const first=module.state.timerInterval;module.startTimer();
 assert.deepEqual(cleared,[first]);assert.equal(intervals.size,1);assert.notEqual(module.state.timerInterval,first);
});
test('workshop locks before save and releases after save failure without generating',async()=>{
 const gate=deferred(),handlers={},btn={innerHTML:'生成',addEventListener:(name,fn)=>handlers[name]=fn};let requests=0;
 const c=context({db:{characters:[],workshopSettings:{provider:'gpt',gptApiUrl:'https://example.invalid',gptApiKey:'fixture',gptModel:'fixture',gptTestPrompt:'portrait'}},document:{getElementById:id=>id==='workshop-generate-btn'?btn:null,querySelectorAll:()=>[]},isGenerating:false,saveData:()=>gate.promise,showToast(){}});
 load(c,'js/modules/image-workshop/generation.js');c.initWorkshopGeneration();c.window.executeImageGeneration=async()=>{requests++;return{}};
 const pending=handlers.click();await handlers.click();assert.equal(btn.disabled,true);gate.reject(Error('quota'));await pending;assert.equal(requests,0);assert.equal(btn.disabled,false);assert.equal(c.isGenerating,false);
});
test('generation expands literal punctuation names for v3, v4 and GPT',async()=>{
 const c=context({db:{characters:[{id:'c',realName:'['}]},document:{getElementById(){return null},querySelectorAll:()=>[]}});load(c,'js/modules/image-workshop/generation.js');
 const settings={positivePrompt:'{{[}}, garden',characterPrompt:'',novelaiModel:'nai-diffusion-3',boundCharacters:[{charId:'c',prompt:'blue eyes'}]};
 assert.match((await c.buildNovelAIPayload(settings)).input,/^blue eyes, garden/);
 assert.match((await c.buildNovelAIPayload({...settings,novelaiModel:'nai-diffusion-4-full'})).input,/^blue eyes, garden/);
 const g=await c.buildGPTPayload({gptTags:[{enabled:true,name:'[',prompt:'style'}]},'hello [');assert.match(JSON.stringify(g),/style/);
});
test('same-name different-price products stay separate and exact removal preserves the other row',()=>{
 const c=context({document:{addEventListener(){},querySelector:()=>({classList:{add(){},remove(){}}})}});load(c,'js/modules/shop.js');vm.runInContext('updateCartUI=()=>{}',c);
 c.addToCart({name:'Same',price:1,desc:'first'});c.addToCart({name:'Same',price:99,desc:'second'});c.addToCart({name:'Same',price:1,desc:'first'});
 assert.equal(vm.runInContext('shopState.cart.length',c),2);assert.equal(vm.runInContext('shopState.cart[0].quantity',c),2);c.removeFromCart({name:'Same',price:99,desc:'second'});assert.equal(vm.runInContext('shopState.cart.length',c),1);
});
test('failed pickup restores the order and can be retried',async()=>{
 const message={id:'m',role:'assistant',content:'[甲为乙下单了：自提口令: abc|5|书]'},char={id:'c',history:[message]};
 const c=context({currentChatId:'c',currentChatType:'private',db:{characters:[char],groups:[]},document:{addEventListener(){},getElementById:()=>({value:'abc',classList:{remove(){}}})},saveData:async()=>{throw Error('quota')},showToast(){},renderMessages(){},renderChatList(){}});
 load(c,'js/modules/chat_ops.js','js/modules/shop.js');await c.handlePickupConfirm();assert.equal(message.isPickedUp,undefined);
 c.saveData=async()=>{};c.alert=()=>{};await c.handlePickupConfirm();assert.equal(message.isPickedUp,true);
});
test('folder rollback preserves subsequent additions and edits',async()=>{
 const gate=deferred(),folder={id:'old',name:'old'},char={id:'c',folderId:'old'};
 const c=context({db:{chatFolders:[folder],characters:[char],groups:[]},currentFolderId:'old',saveData:()=>gate.promise,showToast(){}});load(c,'js/modules/chat_list.js');
 const before=c.captureFolderMutation();c.db.chatFolders=[];delete char.folderId;c.currentFolderId='all';const pending=c.saveFolderMutation(before);c.db.chatFolders.push({id:'new',name:'new'});char.folderId='new';gate.reject(Error('quota'));assert.equal(await pending,false);assert.deepEqual(c.db.chatFolders.map(x=>x.id),['old','new']);assert.equal(char.folderId,'new');
});
test('turning down a transfer while acceptance is saving cannot create a second response',async()=>{
 const gate=deferred(),msg={id:'t',transferStatus:'pending',content:'[甲向我转账：10元]'},char={id:'c',realName:'甲',myName:'我',history:[msg]};
 const c=context({currentChatId:'c',currentChatType:'private',currentTransferMessageId:'t',messageArea:{querySelector(){return null}},db:{characters:[char],groups:[]},document:{getElementById:()=>({classList:{remove(){}}})},saveData:()=>gate.promise,showToast(){},renderMessages(){},renderChatList(){},addMessageBubble(){}});
 load(c,'js/modules/chat_ops.js','js/modules/chat_features.js');const p=c.respondToTransfer('received');await c.respondToTransfer('returned');assert.equal(char.history.length,2);assert.equal(msg.transferStatus,'received');gate.reject(Error('quota'));await p;assert.equal(msg.transferStatus,'pending');assert.equal(char.history.length,1);
});

function settingsFixture() {
 const elements=new Map(),notices=[];
 function node(){
  const classes=new Set();
  return {value:'',children:[],handlers:{},style:{},dataset:{},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},
   set innerHTML(_){this.children=[];this.value='';},appendChild(child){if(!this.children.length)this.value=child.value;this.children.push(child);},
   addEventListener(event,fn){(this.handlers[event]??=[]).push(fn);}};
 }
 const get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
 return {get,notices,c:context({document:{getElementById:get,createElement:node,querySelectorAll:()=>[]},showToast:msg=>notices.push(msg)})};
}

test('failed folder moves and removals leave the chooser open and can be retried',async()=>{
 const {c,get}=settingsFixture(),char={id:'c'},folder={id:'f',name:'folder'};
 Object.assign(c,{db:{chatFolders:[folder],characters:[char],groups:[]},currentFolderId:'all',saveData:async()=>{throw Error('quota');}});
 load(c,'js/modules/chat_list.js');c.renderChatList=()=>{};c.setupFolderManagement();
 const modal=get('move-to-folder-modal'),list=get('folder-selection-list');
 c.window.openMoveToFolderModal('c','private');
 await list.children[1].onclick();assert.equal(char.folderId,undefined);assert.equal(modal.classList.contains('visible'),true);
 c.saveData=async()=>{};await list.children[1].onclick();assert.equal(char.folderId,'f');assert.equal(modal.classList.contains('visible'),false);
 c.window.openMoveToFolderModal('c','private');c.saveData=async()=>{throw Error('quota');};
 await list.children[0].onclick();assert.equal(char.folderId,'f');assert.equal(modal.classList.contains('visible'),true);
});

test('a folder save finishing after another chooser opens leaves the new chooser open',async()=>{
 const {c,get}=settingsFixture(),gate=deferred(),a={id:'a'},b={id:'b'};
 Object.assign(c,{db:{chatFolders:[{id:'f',name:'folder'}],characters:[a,b],groups:[]},currentFolderId:'all',saveData:()=>gate.promise});
 load(c,'js/modules/chat_list.js');c.renderChatList=()=>{};c.setupFolderManagement();
 c.window.openMoveToFolderModal('a','private');const pending=get('folder-selection-list').children[1].onclick();
 c.window.openMoveToFolderModal('b','private');gate.resolve();await pending;
 assert.equal(a.folderId,'f');assert.equal(b.folderId,undefined);assert.equal(get('move-to-folder-modal').classList.contains('visible'),true);
});

test('refreshing secondary models keeps the selected model or asks the user to reselect',async()=>{
 const {c,get,notices}=settingsFixture();let models=['first','chosen'];
 Object.assign(c,{db:{apiSettings:{secondary:{enabled:true,url:'https://example.invalid',key:'fixture',model:'chosen'}}},
  BLOCKED_API_DOMAINS:[],fetch:async()=>({ok:true,json:async()=>({data:models.map(id=>({id}))})})});
 load(c,'js/modules/settings_api.js');c.setupSecondaryApiSettings();
 const refresh=get('secondary-fetch-models-btn').handlers.click[0];
 await refresh();assert.equal(c.readSecondaryApiSettings().model,'chosen');
 models=['first','another'];await refresh();assert.equal(c.readSecondaryApiSettings().model,'');assert.match(notices.at(-1),/重新选择/);
});
