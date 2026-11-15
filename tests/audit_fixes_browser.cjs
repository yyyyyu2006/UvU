const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..');
const {fullApp,stableUI}=require(path.join(repo,'tests/helpers/full_app_browser.cjs'));
const out=process.env.UVU_AUDIT_OUTPUT || path.join(repo,'outputs/audit-fixes');fs.mkdirSync(out,{recursive:true});
(async()=>{const app=await fullApp();const result={browser:app.browser.version(),scope:'Full local app, isolated synthetic data and local MP3, external requests blocked'};
try{
 const {page,errors}=await app.page({hasTouch:false});page.setDefaultTimeout(7000);await page.clock.setSystemTime(new Date());page.on('pageerror',error=>console.error('PAGE:',error.message));
 await page.evaluate(()=>{
  window.fixToasts=[];window.showToast=m=>fixToasts.push(m);
  db.characters=[{id:'fix-char',realName:'测试角色',remarkName:'测试角色',myName:'我',theme:'white_pink',history:[],maxMemory:20,worldBookIds:[],memoryJournals:[{id:'fix-journal',title:'测试日记',content:'原文',createdAt:Date.now(),range:{start:1,end:1}}]}];db.groups=[];currentChatId='fix-char';currentChatType='private';
 });
 result.widgetSizes=await page.evaluate(()=>{
  const sizes=['1x4','4x2'];
  db.widgetTemplates=sizes.map((size,index)=>({id:'size-template-'+index,name:'尺寸测试',size,html:'<div>测试</div>',css:'',js:'',defaultVars:{}}));
  db.addedWidgets=sizes.map((size,index)=>({id:'size-instance-'+index,templateId:'size-template-'+index,variables:{}}));
  db.homeLayoutPages=[['size-instance-0','size-instance-1']];db.homeLayoutOrder=['size-instance-0','size-instance-1'];
  setupHomeScreen();
  return sizes.map((size,index)=>({size,classes:document.querySelector('[data-id="size-instance-'+index+'"]').className}));
 });
 assert.match(result.widgetSizes[0].classes,/\bgrid-item-1x4\b/);assert.match(result.widgetSizes[1].classes,/\bgrid-item-2x4\b/);
 await page.evaluate(async()=>{
  await dexieDB.reader_books.bulkPut([{id:'book-a',title:'测试书',currentChapterIndex:99},{id:'book-empty',title:'空书'}]);
  await dexieDB.reader_chapters.put({id:'chapter-a',bookId:'book-a',index:0,title:'第一章',content:'测试正文\n第二段'});
  switchScreen('reader-view-screen');await readerView.loadBook('book-a');
 });
 assert.equal(await page.locator('#reader-chapter-title').textContent(),'第一章');assert.match(await page.locator('#reader-text-content').textContent(),/测试正文/);
 await page.evaluate(()=>readerView.loadBook('book-empty'));assert.equal(await page.locator('#reader-chapter-title').count(),1);assert.equal(await page.locator('#reader-chapter-title').textContent(),'');assert.equal(await page.locator('#reader-text-content').textContent(),'这本书暂无章节');
 await page.evaluate(()=>readerView.loadBook('book-a'));assert.match(await page.locator('#reader-text-content').textContent(),/测试正文/);result.reader='normal → empty → normal, invalid saved index falls back, DOM preserved';
 await page.evaluate(()=>{switchScreen('api-settings-screen');const s=document.getElementById('api-model');s.replaceChildren(new Option('测试模型','model-a'));s.value='model-a';});
 await page.locator('#api-model-picker').click();await stableUI(page,'.model-picker-card');assert.equal(await page.locator('.model-picker-search').evaluate(el=>document.activeElement===el),true);await page.keyboard.type('model');assert.equal(await page.locator('.model-picker-search').inputValue(),'model');await page.keyboard.press('Escape');result.modelFocus='focus and immediate typing passed';
 await page.evaluate(()=>{switchScreen('memory-journal-screen');renderJournalList();});await page.locator('.journal-card-title').click();await page.locator('#edit-journal-detail-btn').click();await page.locator('#journal-detail-content').fill('测试修改');await page.locator('#edit-journal-detail-btn').click();await page.waitForFunction(()=>!document.getElementById('journal-detail-content').isContentEditable);assert.equal(await page.locator('#journal-detail-content').textContent(),'测试修改');result.journal='saved and left editing state';
 await page.evaluate(()=>{showErrorModal('<b>纯文本测试</b>','fixture');});assert.equal(await page.locator('#error-modal-overlay .error-friendly-message b').count(),0);assert.equal(await page.locator('.error-friendly-message').textContent(),'<b>纯文本测试</b>');await page.locator('#close-error-modal-btn').click();result.errorText='literal markup shown without creating tags';
 result.badImage=await page.evaluate(async()=>{try{await ensurePngFormat(new Uint8Array([1,2,3]).buffer);return 'unexpected-success'}catch(e){return e.message}});assert.match(result.badImage,/图片无法解码/);
 // Observe native media events; do not simulate Audio.play/ended or MediaSource.
 await page.evaluate(()=>{
  window.fixSounds=[];const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args),record={audio,events:[]};for(const name of ['play','pause','ended','error'])audio.addEventListener(name,()=>record.events.push(name));fixSounds.push(record);return audio};
  window.fixSpeechCalls=0;window.fixStreamCancelled=0;
  const frame='fffb9064'+'00'.repeat(413),hex=frame.repeat(70);window.fixAudioHex=hex;
  window.fixFetch=window.fetch;window.fetch=async(url,options)=>{
   if(String(url).startsWith('https://speech-fixture.invalid/')){
    fixSpeechCalls++;const request=JSON.parse(options.body);
    if(!request.stream)return new Response(JSON.stringify({base_resp:{status_code:0},data:{audio:hex,status:2},extra_info:{audio_format:'mp3'}}),{headers:{'content-type':'application/json'}});
    const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({data:{audio:hex,status:1}})+'\n\n'+'data: '+JSON.stringify({data:{status:2},extra_info:{audio_format:'mp3'}})+'\n\n'));},cancel(){fixStreamCancelled++}});
    return new Response(stream,{headers:{'content-type':'text/event-stream'}});
   }return fixFetch(url,options);
  };
  db.minimaxTtsSettings={apiKey:'fixture-only',voiceId:'fixture',endpoint:'https://speech-fixture.invalid/v1/t2a_v2',model:'speech-2.8-hd',speech:{stream:true,persistentCache:false}};
  db.characters[0].history=[{id:'voice-a',role:'assistant',content:'[测试角色的语音：这是本地合成测试。]',timestamp:Date.now()}];switchScreen('chat-room-screen');renderMessages(false,true);
 });
 assert.equal(await page.locator('.voice-bubble').count(),1);
 await page.locator('.voice-bubble').click();await page.waitForFunction(()=>fixSounds.some(s=>s.events.includes('ended')),{},{timeout:8000});
 await page.waitForFunction(()=>!document.querySelector('.voice-bubble').classList.contains('voice-playing')&&!document.querySelector('.voice-bubble').hasAttribute('aria-busy'));
 result.streaming=await page.evaluate(()=>({calls:fixSpeechCalls,cancelled:fixStreamCancelled,events:fixSounds.map(s=>s.events),phase:document.querySelector('.voice-bubble').dataset.speechPhase,toasts:fixToasts}));assert.equal(result.streaming.calls,1);assert.equal(result.streaming.cancelled,1);assert.equal(result.streaming.events.filter(x=>x.includes('error')).length,0);
 await page.locator('.voice-bubble').click();await page.waitForFunction(()=>document.querySelector('.voice-bubble').classList.contains('voice-playing'));await page.locator('.voice-bubble').click();assert.equal(await page.locator('.voice-bubble').getAttribute('data-speech-phase'),'paused');await page.locator('.voice-bubble').click();await page.waitForFunction(()=>fixSounds.filter(s=>s.events.includes('ended')).length===2);assert.equal(await page.evaluate(()=>fixSpeechCalls),1);result.cachedReplay='native audio pause/resume/end, no extra synthesis';
 await page.addStyleTag({content:'.voice-bubble{border:2px solid #566; border-radius:14px!important; padding:8px 12px!important;}.voice-bubble.voice-playing{opacity:.85}'});
 await page.locator('.voice-bubble').click();await page.waitForFunction(()=>document.querySelector('.voice-bubble').classList.contains('voice-playing'));await page.evaluate(()=>{switchScreen('chat-list-screen');});await page.waitForFunction(()=>fixSounds.every(s=>s.audio.paused),{},{timeout:500});result.leaveChat='native audio paused within 500ms when leaving chat under custom CSS sample';
 await page.evaluate(()=>{switchScreen('chat-room-screen');renderMessages(false,true);db.minimaxTtsSettings.speech.stream=false;MiniMaxTTS.clearCache();});
 await page.locator('.voice-bubble').click();await page.waitForFunction(()=>fixSounds.at(-1).events.includes('ended'));await page.waitForFunction(()=>document.querySelector('.voice-bubble').dataset.speechPhase==='stopped');result.nonstream='native JSON audio ended and UI reset';
 await page.screenshot({path:path.join(out,'minimax-complete-app.png')});result.finalMedia=await page.evaluate(()=>({calls:fixSpeechCalls,events:fixSounds.map(s=>s.events),phase:document.querySelector('.voice-bubble').dataset.speechPhase}));
 for(const type of ['private','group']){
  await page.evaluate(async type=>{
   window.fixAirDrops=[];window.receiveAirDropPhoto=async id=>fixAirDrops.push(id);
   const char=db.characters[0];char.history=[];char.autoAirDropEnabled=true;
   const chat=type==='private'?char:{id:'fix-group',name:'测试群',history:[],members:[{id:'member',realName:'测试角色',groupNickname:'测试角色'}],me:{nickname:'我'},autoAirDropEnabled:true};
   if(type==='group')db.groups=[chat];currentChatId=chat.id;currentChatType=type;
   await handleAiReplyContent('[测试角色发来的照片/视频：测试照片]\n[测试角色的消息：照片之后的普通消息]',chat,chat.id,type);
  },type);
  await page.waitForFunction(()=>fixAirDrops.length===1);
  const target=await page.evaluate(()=>{const chat=currentChatType==='private'?db.characters[0]:db.groups[0];return{delivered:fixAirDrops[0],photo:chat.history.find(m=>m.content.includes('发来的照片/视频')).id,last:chat.history.at(-1).id}});
  assert.equal(target.delivered,target.photo);assert.notEqual(target.delivered,target.last);result['autoAirDrop-'+type]=target;
 }
 result.errors=errors;assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'full-app-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(e){fs.writeFileSync(path.join(out,'full-app-verification-failure.json'),JSON.stringify({...result,error:e.stack},null,2));throw e}finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
