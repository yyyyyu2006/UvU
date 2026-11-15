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
 const char={id:'c',activeArchiveId:'a',history:[{id:'text',content:ordinary},{id:'pic',content:image}],gallery:[{url:image},{url:image},{url:'https://example.invalid/a'}],archives:[{id:'a',data:{history:[]}}]};
 const Dexie=require('dexie'),{indexedDB,IDBKeyRange}=require('fake-indexeddb');
 const dbx=new Dexie('cache-audit-'+Date.now()+'-'+Math.random(),{indexedDB,IDBKeyRange});
 dbx.version(1).stores({workshopHistory:'&id',characterPhotos:'&id',reader_comments:'&id'});
 await dbx.open();await dbx.workshopHistory.put({id:'w',image});await dbx.characterPhotos.put({id:'p',image});await dbx.reader_comments.put({id:'r',content:'[ILLUSTRATION]AAAA'});
 const c=context({document:{getElementById:id=>nodes[id]||null,addEventListener(){}},db:{characters:[char],groups:[],myStickers:[]},dexieDB:dbx,Blob,URL,
  runDataPersistence:fn=>fn(),showToast(){},saveData:async()=>{
   char.archives[0].data.history=structuredClone(char.history);
   if(fail){char.gallery.push({url:'https://example.invalid/later'});char.history[0].content=ordinary+'新编辑';throw Error('quota')}
  }});
 load(c,'js/modules/storage.js');c.window.setupCleanImageCache();
 try {await nodes['clean-image-cache-form'].onsubmit({preventDefault(){}});return{char,ordinary,image,counts:await Promise.all([dbx.workshopHistory.count(),dbx.characterPhotos.count(),dbx.reader_comments.count()])};}
 finally{dbx.close();await dbx.delete();}
}
test('image cleanup preserves long text and commits generated deletion together',async()=>{
 const h=await cacheFixture(false);assert.equal(h.char.history[0].content,h.ordinary);assert.equal(h.char.history[1].content,'[图片已清理]');assert.deepEqual(h.counts,[0,0,0]);assert.equal(h.char.gallery.length,1);
});
test('failed image cleanup restores pictures, nameless gallery and archive clones while retaining later edits',async()=>{
 const h=await cacheFixture(true);assert.equal(h.char.history[0].content,h.ordinary+'新编辑');assert.equal(h.char.history[1].content,h.image);assert.equal(h.char.archives[0].data.history[1].content,h.image);assert.equal(h.char.gallery.filter(x=>x.url===h.image).length,2);assert.equal(h.char.gallery.at(-1).url,'https://example.invalid/later');assert.deepEqual(h.counts,[1,1,1]);
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
