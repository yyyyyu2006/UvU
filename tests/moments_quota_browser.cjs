'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fullApp,stableUI,root}=require('./helpers/full_app_browser.cjs');
(async()=>{
 const app=await fullApp(),out=path.join(root,'outputs/moments-quota');fs.mkdirSync(out,{recursive:true});
 try{
  const {page,context,errors}=await app.page({viewport:{width:320,height:568}});
  await page.evaluate(async()=>{
   document.addEventListener('pointerdown',()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;},true);
   const chat={id:'quota-check',realName:'测试角色',myName:'测试用户',persona:'',myPersona:'',history:[],memoryJournals:[],maxMemory:20,worldBookIds:[],activeArchiveId:'one',archives:[{id:'one',name:'存档一'}],moments:[{id:'post',author:'测试角色',content:'测试公开动态',timestamp:Date.now(),comments:[],likes:[]}]};
   db.characters=[chat];db.apiSettings.secondary={enabled:false};window.quotaCalls=0;
   fetchAiResponse=async()=>{quotaCalls++;return JSON.stringify({action:'comment',content:'恢复配置后成功',replyToCommentId:null});};
   await UvUMoments.configure(chat,{enabled:true,cooldown:5,npcsEnabled:false});
   currentChatId=chat.id;currentChatType='private';switchScreen('moments-screen');renderMomentsScreen();
  });
  await page.getByRole('button',{name:'动态操作',exact:true}).click();
  await page.locator('.ms-overlay').last().getByRole('button',{name:'生成互动',exact:true}).click();
  await page.waitForFunction(()=>UvUMomentsAI.inspect(db.characters[0])?.phase==='failed');
  assert.deepEqual(await page.evaluate(()=>({attempts:db.characters[0].moments[0].socialAttempts||[],calls:quotaCalls,requests:UvUMomentsAI.inspect(db.characters[0]).requests})),{attempts:[],calls:0,requests:0});
  await page.getByRole('button',{name:'动态互动设置',exact:true}).click();
  await stableUI(page,'.ms-dialog');
  const task=page.locator('.ms-dialog details').filter({has:page.locator('summary').getByText('本次互动',{exact:true})});
  await task.evaluate(el=>el.open=true);assert.ok((await task.innerText()).includes('请求 0/1 次'));
  await task.scrollIntoViewIfNeeded();
  assert.equal(await task.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,'missing-api-320.png')});
  await page.locator('.ms-overlay').last().getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>{db.apiSettings.secondary={enabled:true,provider:'newapi',url:'https://secondary.invalid',key:'fixture-only',model:'fixture'};});
  await page.getByRole('button',{name:'动态操作',exact:true}).click();
  await page.locator('.ms-overlay').last().getByRole('button',{name:'生成互动',exact:true}).click();
  await page.waitForFunction(()=>db.characters[0].moments[0].comments.length===1&&UvUMomentsAI.inspect(db.characters[0])?.phase==='completed');
  assert.deepEqual(await page.evaluate(()=>({calls:quotaCalls,attempts:db.characters[0].moments[0].socialAttempts.length,phase:UvUMomentsAI.inspect(db.characters[0]).phase})),{calls:1,attempts:1,phase:'completed'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>db.characters.some(chat=>chat.id==='quota-check'));
  assert.equal(await page.evaluate(()=>db.characters[0].moments[0].socialAttempts.length),1);
  assert.equal(await page.evaluate(()=>db.characters[0].moments[0].comments[0].content),'恢复配置后成功');
  assert.deepEqual(errors,[]);await context.close();
  console.log('PASS full App: no secondary => zero requests/quota, visible 0/1 report, immediate configured retry, persisted success, 320px no overflow, pageerror 0.');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
