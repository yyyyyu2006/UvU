const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const c=vm.createContext({console,window:{},document:{addEventListener(){},getElementById(){return null;}},Blob,File,Response,
   CompressionStream,DecompressionStream,ReadableStream,TextEncoder,structuredClone,AbortController,setTimeout,clearTimeout});
 for(const file of ['db.js','modules/storage.js','modules/storage_features.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),c);
 return c;
}
test('backup import normalizes only missing legacy journal range without mutating source or prompts',()=>{
 const c=fixture(), incoming={characters:[{id:'x',persona:'原人设',history:[],memoryJournals:[{id:'j',content:'旧日记'}]}]};
 const before=JSON.stringify(incoming);c.db.characters=[];c.db.groups=[];
 const pending=c.storagePrepareImport({contacts:true,chats:true},incoming);
 assert.deepEqual(JSON.parse(JSON.stringify(pending.characters[0].memoryJournals[0].range)),{start:0,end:0});
 assert.equal(pending.characters[0].persona,'原人设');assert.equal(JSON.stringify(incoming),before);
});
test('backup export can omit API credentials and reproducible vector indexes without changing live data',()=>{
 const c=fixture(), modules={apiSettings:{key:'SECRET',secondary:{key:'SECOND'},model:'m'},minimaxTtsSettings:{apiKey:'VOICE',director:{apiKey:'DIR'}},
 characters:[{id:'x',persona:'原提示词',history:[{content:'原消息'}],memoryVectorIndex:{big:{chunks:[{vector:[1]}]}},archives:[{id:'a',data:{memoryVectorIndex:{x:1},history:[]}}]}]};
 const before=JSON.stringify(modules); const result=c.storageApplyExportOptions(modules,{includeCredentials:false,includeVectorIndex:false});
 assert.doesNotMatch(JSON.stringify(result),/SECRET|SECOND|VOICE|DIR|memoryVectorIndex/);
 assert.equal(result.characters[0].persona,'原提示词');assert.equal(JSON.stringify(modules),before);
});
test('import preview explains selected categories and retained unselected data without API secrets',()=>{
 const c=fixture();c.db.characters=[{id:'a'}];c.db.groups=[];c.db.worldBooks=[];
 const summary=c.storageDescribeImport({contacts:true},{characters:[{id:'a',persona:'SECRET'},{id:'b'}],apiSettings:{key:'KEY'}});
 assert.match(summary,/角色设定/);assert.match(summary,/新增.*1/);assert.match(summary,/保留/);assert.doesNotMatch(summary,/SECRET|KEY/);
});
test('cancelled backup worker terminates and never resolves a late result',async()=>{
 const c=fixture(),worker={postMessage(){},terminate(){this.ended=true;}}; c.Worker=function(){return worker;};
 const ac=new AbortController();let rejection;const pending=c.storageReadBackup(new File(['{}'],'a.json'),{}, {signal:ac.signal}).catch(e=>{rejection=e;});
 ac.abort();await new Promise(setImmediate);const cancelled=rejection;
 worker.onmessage({data:{modules:{}}});await pending;assert.match(cancelled?.message||'',/取消/);assert.equal(worker.ended,true);
});
test('backup worker progress does not prematurely finish import parsing',async()=>{
 const c=fixture(),updates=[],worker={postMessage(){},terminate(){this.ended=true;}}; c.Worker=function(){return worker;};
 let complete=false;const pending=c.storageReadBackup(new File(['{}'],'a.json'),{}, {onProgress:p=>updates.push(p)}).then(x=>{complete=true;return x;});
 worker.onmessage({data:{progress:{decodedBytes:123}}});await Promise.resolve();assert.equal(complete,false);assert.equal(worker.ended,undefined);
 worker.onmessage({data:{modules:{worldBooks:[]}}});const data=await pending;assert.equal(updates[0].decodedBytes,123);assert.ok(data.worldBooks);
});

test('backup validates nested sticker settings and journal ranges before persistence',()=>{
 const c=fixture();
 for(const setting of [{enabled:'yes'},{relevantOnly:1},{maxItems:0},{maxChars:Infinity}])
  assert.throws(()=>c.storageValidateModules({characters:[{id:'x',stickerDescriptionSettings:setting}]}),/stickerDescriptionSettings/);
 for(const range of [{},{start:-1,end:2},{start:4,end:2},{start:1.5,end:3}])
  assert.throws(()=>c.storageValidateModules({characters:[{id:'x',memoryJournals:[{id:'j',range}]}]}),/range/);
 assert.doesNotThrow(()=>c.storageValidateModules({characters:[{id:'x',memoryJournals:[{id:'j'}],stickerDescriptionSettings:{enabled:false,maxItems:10,maxChars:800}}]}));
});

test('export without vector index never clones the omitted heavy index',()=>{
 const c=fixture();let clones=0;c.structuredClone=value=>{if(value?.sentinelIndex)clones++;return structuredClone(value);};
 const chat={id:'x',persona:'人设',history:[],memoryVectorIndex:{sentinelIndex:true},activeArchiveId:'a',archives:[{id:'a',data:{history:[],memoryVectorIndex:{sentinelIndex:true}}}]};
 const result=c.storageExportChat(chat,true,true,{includeVectorIndex:false});
 assert.equal(clones,0);assert.equal(result.memoryVectorIndex,undefined);assert.equal(result.archives[0].data.memoryVectorIndex,undefined);
});

test('redacted backups preserve credentials only at the same endpoint when explicitly selected',()=>{
 const c=fixture();c.db.apiSettings={url:'https://one.test',key:'LOCAL',secondary:{url:'https://sub.test',key:'SUB'}};
 const incoming=c.storageApplyExportOptions({apiSettings:{url:'https://one.test',key:'FOREIGN',secondary:{url:'https://different.test',key:'OTHER'}}},{includeCredentials:false});
 const restored=c.storageResolveImportOptions(incoming,{credentialMode:'preserve'});
 assert.equal(restored.apiSettings.key,'LOCAL');assert.equal(restored.apiSettings.secondary.key,'');
 assert.equal(c.storageResolveImportOptions(incoming,{credentialMode:'clear'}).apiSettings.key,'');
 assert.equal(incoming.apiSettings.key,'');assert.equal(c.db.apiSettings.key,'LOCAL');
});


test('backup validates persisted summary review metadata before opening the memory UI',()=>{
 const c=fixture();
 for(const qualityReview of [{warnings:{}},{status:'pending',warnings:[42]},{status:'wrong'},{status:'pending',archiveId:3}])
  assert.throws(()=>c.storageValidateModules({characters:[{id:'x',memoryJournals:[{id:'j',qualityReview}]}]}),/qualityReview/);
 assert.doesNotThrow(()=>c.storageValidateModules({characters:[{id:'x',memoryJournals:[{id:'j',qualityReview:{status:'pending',archiveId:'a',warnings:['check'],createdAt:12}}]}]}));
});


test('share backups redact standalone memory and vector service credentials too',()=>{
 const c=fixture(); const input={memoryApiSettings:{url:'https://memory.test',key:'MEMORY'},vectorMemoryApiSettings:{url:'https://vector.test',key:'VECTOR',rerank:{apiKey:'RERANK'}}};
 const out=c.storageApplyExportOptions(input,{includeCredentials:false});
 assert.doesNotMatch(JSON.stringify(out),/MEMORY|VECTOR|RERANK/); assert.equal(input.memoryApiSettings.key,'MEMORY');
 c.db.memoryApiSettings={url:'https://memory.test',key:'LOCAL-MEMORY'};
 assert.equal(c.storageResolveImportOptions(out,{credentialMode:'preserve'}).memoryApiSettings.key,'LOCAL-MEMORY');
});

test('query rewrite credentials redact and only restore for identical rewrite endpoint',()=>{
 const c=fixture();c.db.vectorMemoryApiSettings={url:'https://embed.test',key:'LOCAL',rewriteUrl:'https://rewrite.test',rewriteKey:'PRIVATE'};
 const incoming=c.storageApplyExportOptions({vectorMemoryApiSettings:{url:'https://embed.test',key:'REMOTE',rewriteUrl:'https://other.test',rewriteKey:'REMOTE-SECRET'}},{includeCredentials:false});
 assert.equal(incoming.vectorMemoryApiSettings.rewriteKey,'');
 assert.equal(c.storageResolveImportOptions(incoming,{credentialMode:'preserve'}).vectorMemoryApiSettings.rewriteKey,'');
 incoming.vectorMemoryApiSettings.rewriteUrl='https://rewrite.test';
 assert.equal(c.storageResolveImportOptions(incoming,{credentialMode:'preserve'}).vectorMemoryApiSettings.rewriteKey,'PRIVATE');
});
test('workshop compatibility keys are redacted and preserved only at their own unchanged provider endpoints',()=>{
 const c=fixture();c.db.workshopSettings={gptApiUrl:'https://gpt.local',gptApiKey:'LOCAL-GPT',novelaiApiUrl:'https://nai.local',novelaiApiKey:'LOCAL-NAI'};
 const source={workshopSettings:{gptApiUrl:'https://gpt.local',gptApiKey:'FOREIGN-GPT',novelaiApiUrl:'https://nai.other',novelaiApiKey:'FOREIGN-NAI'}};
 const out=c.storageApplyExportOptions(source,{includeCredentials:false});
 assert.doesNotMatch(JSON.stringify(out),/FOREIGN/);
 const restored=c.storageResolveImportOptions(out,{credentialMode:'preserve'});
 assert.equal(restored.workshopSettings.gptApiKey,'LOCAL-GPT');assert.equal(restored.workshopSettings.novelaiApiKey,'');
 delete out.workshopSettings.gptApiUrl;
 assert.equal(c.storageResolveImportOptions(out,{credentialMode:'preserve'}).workshopSettings.gptApiKey,'');
 assert.equal(source.workshopSettings.gptApiKey,'FOREIGN-GPT');
});
test('a redacted configuration missing its former destination never inherits a local credential',()=>{
 const c=fixture();c.db.apiSettings={url:'https://private.local',provider:'newapi',key:'LOCAL'};
 const incoming={_uvuBackup:{version:1,credentialsOmitted:true},apiSettings:{key:''}};
 assert.equal(c.storageResolveImportOptions(incoming,{credentialMode:'preserve'}).apiSettings.key,'');
});
test('flat reranking credential follows the effective rerank endpoint and is never shared',()=>{
 const c=fixture();c.db.vectorMemoryApiSettings={url:'https://embed.test',key:'LOCAL-EMBED',rerankUrl:'https://rank.test',rerankKey:'LOCAL-RANK'};
 const incoming=c.storageApplyExportOptions({vectorMemoryApiSettings:{url:'https://embed.test',key:'FOREIGN-EMBED',rerankUrl:'https://rank.other',rerankKey:'FOREIGN-RANK'}},{includeCredentials:false});
 assert.doesNotMatch(JSON.stringify(incoming),/FOREIGN/);
 assert.equal(c.storageResolveImportOptions(incoming,{credentialMode:'preserve'}).vectorMemoryApiSettings.rerankKey,'');
 incoming.vectorMemoryApiSettings.rerankUrl='https://rank.test';
 assert.equal(c.storageResolveImportOptions(incoming,{credentialMode:'preserve'}).vectorMemoryApiSettings.rerankKey,'LOCAL-RANK');
});
