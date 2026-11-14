const assert=require('node:assert/strict');
const {fullApp}=require('./helpers/full_app_browser.cjs');
(async()=>{
 const app=await fullApp();let failed=0;
 try{
  for(const scenario of ['voice-normal','voice-selection','voice-debug','forward-normal','forward-selection','forward-debug','calendar-normal','calendar-selection','calendar-debug']){
   const {page,context,errors}=await app.page();page.setDefaultTimeout(5000);
   let time=Date.parse('2026-11-12T04:00:00Z');
   const gesture=async fn=>{time=Math.max(time,await page.evaluate(()=>Date.now()))+2000;await page.clock.setFixedTime(new Date(time));await fn();};
   try{
    await page.evaluate(async scenario=>{
     const now=Date.now(), avatar='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#d4e5ef"/></svg>');
     const base={role:'assistant',timestamp:now};
     const voice={...base,id:'voice',content:'[角色的语音：测试台词]'};
     const forward={...base,id:'forward',type:'forwarded-chat',content:'转发聊天记录',forwardedChat:{version:1,title:'测试记录',records:[{id:'record',senderName:'记录角色',content:'记录正文',timestamp:now}]}};
     const calendar={...base,id:'calendar',type:'calendar',content:'日历分享',calendar:{version:1,title:'测试日程',date:'2026-11-12',text:'日程正文'}};
     const chat={id:'render-target',activeArchiveId:'one',realName:'角色',remarkName:'角色',myName:'用户',persona:'PERSONA',myPersona:'USER',maxMemory:20,avatar,myAvatar:avatar,history:[voice,forward,calendar],memoryJournals:[],worldBookIds:[],useCustomBubbleCss:true,customBubbleCss:'.bubble-content{letter-spacing:.1px}'};
     db.characters=[chat];await saveData();openChatRoom(chat.id,'private');showPanel('none');
     window.auditRenderBefore=JSON.stringify({history:chat.history,persona:chat.persona,myPersona:chat.myPersona,maxMemory:chat.maxMemory,css:chat.customBubbleCss});
     window.auditVoiceCalls=0;MiniMaxTTS.play=()=>{window.auditVoiceCalls++;};
     if(scenario.endsWith('selection'))enterMultiSelectMode(null);
     if(scenario.endsWith('debug'))isDebugMode=true;
    },scenario);
    if(scenario.startsWith('voice')){
     const bubble=page.locator('[data-id="voice"] .voice-bubble');
     await gesture(()=>bubble.press('Enter'));await gesture(()=>bubble.press(' '));
     assert.equal(await page.evaluate(()=>window.auditVoiceCalls),scenario==='voice-normal'?2:0,'mode must gate keyboard voice playback');
    }else if(scenario.startsWith('forward')){
     const card=page.locator('[data-id="forward"] .message-forward-card');
     await gesture(()=>card.press('Enter'));
     assert.equal(await page.locator('#message-forward-detail').count(),scenario==='forward-normal'?1:0,'mode must gate keyboard forwarded details');
    }else{
     const card=page.locator('[data-id="calendar"] .calendar-chat-card');
     await gesture(()=>card.click());
     assert.equal(await page.locator('#calendar-share-preview').count(),scenario==='calendar-normal'?1:0,'mode must gate calendar preview');
     if(scenario==='calendar-selection')assert.equal(await page.evaluate(()=>selectedMessageIds.has('calendar')),true,'calendar click still selects the row');
    }
    assert.equal(await page.evaluate(()=>{const c=db.characters[0];return window.auditRenderBefore===JSON.stringify({history:c.history,persona:c.persona,myPersona:c.myPersona,maxMemory:c.maxMemory,css:c.customBubbleCss});}),true,'conversation and theme unchanged');
    assert.deepEqual(errors,[]);console.log('PASS '+scenario);
   }catch(error){failed++;console.error('FAIL '+scenario+'\n'+error.stack);}
   finally{await context.close();}
  }
 }finally{await app.close();}
 if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
