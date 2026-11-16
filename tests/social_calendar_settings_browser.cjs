const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fullApp, stableUI, root } = require('./helpers/full_app_browser.cjs');
(async () => {
 const app=await fullApp(),out=path.join(root,'outputs/social-calendar-settings');fs.mkdirSync(out,{recursive:true});
 try {
  const {page,context,errors}=await app.page();page.setDefaultTimeout(8000);
  await page.evaluate(async()=>{
   document.addEventListener('pointerdown',()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;},true);
   db.characters=['a','b'].map(id=>({id,realName:id==='a'?'角色甲':'角色乙',myName:'我',persona:'',myPersona:'',history:[],memoryJournals:[],maxMemory:20,worldBookIds:[],activeArchiveId:'one',archives:[{id:'one',name:'存档一'}],moments:[]}));
   await saveData();UvUMomentsUI.settings(db.characters[0]);
  });
  const social=page.locator('.ms-dialog');await stableUI(page,'.ms-dialog');
  assert.equal(await social.locator('.ms-dialog-body .ms-settings-help').count(),0);
  const help=social.getByRole('button',{name:'帮助',exact:true});await help.click();
  const explanation=page.locator('#panel-explanation-dialog');await stableUI(page,'#panel-explanation-dialog');
  assert.match(await explanation.innerText(),/副 API/);assert.match(await explanation.innerText(),/不会回退主 API/);
  await explanation.getByRole('button',{name:'关闭',exact:true}).click();await explanation.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='帮助');
  await social.getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>UvUCalendarUI.editImportant('user',{start:'2026-11-12',end:'2026-11-12'}));
  const form=page.locator('#calendar-important-editor');await stableUI(page,'#calendar-important-editor');
  const group=form.getByRole('group',{name:'同步给谁看'}),share=form.getByLabel('允许聊天引用此条重要日',{exact:true});
  assert.equal(await group.isVisible(),false);await form.getByLabel('名称',{exact:true}).fill('仅给甲的纪念日');
  await share.check();assert.equal(await group.getByRole('checkbox').count(),2);
  await form.getByRole('button',{name:'保存',exact:true}).click();await form.getByText('请勾选至少一个同步角色；不分享时请关闭聊天引用。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>UvUCalendar.state().events.length),0);
  const firstRecipient=group.getByRole('checkbox',{name:'角色甲 · 存档一',exact:true});await firstRecipient.focus();await page.keyboard.press('Space');assert.equal(await firstRecipient.isChecked(),true);
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:844});await stableUI(page,'#calendar-important-editor');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'recipients-390.png')});
  await form.getByRole('button',{name:'保存',exact:true}).click();await form.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>db.calendarData.events[0].shareTargets),['char:["a","one"]']);
  await page.evaluate(async()=>{for(const chat of db.characters)await UvUCalendar.saveProfile(UvUCalendar.owner(chat),{shareUserImportantDays:true});});
  assert.match(await page.evaluate(()=>UvUCalendar.context(db.characters[0],'2026-11-12')),/仅给甲/);assert.equal(await page.evaluate(()=>UvUCalendar.context(db.characters[1],'2026-11-12')),'');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof UvUCalendarUI!=='undefined'&&db.characters.length===2);
  assert.deepEqual(await page.evaluate(()=>db.calendarData.events[0].shareTargets),['char:["a","one"]']);
  await page.evaluate(()=>{GuideSystem.cleanup();UvUCalendarUI.editImportant('user',null,UvUCalendar.state().events[0]);});
  await stableUI(page,'#calendar-important-editor');await form.getByLabel('修改范围').selectOption('series');
  assert.equal(await group.getByRole('checkbox',{name:'角色甲 · 存档一',exact:true}).isChecked(),true);
  await share.uncheck();await form.getByRole('button',{name:'保存',exact:true}).click();await form.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>db.calendarData.events[0].shareTargets),[]);assert.equal(await page.evaluate(()=>UvUCalendar.context(db.characters[0],'2026-11-12')),'');
  await page.evaluate(()=>UvUCalendarUI.editImportant('user',null,UvUCalendar.state().events[0]));await stableUI(page,'#calendar-important-editor');
  await form.getByLabel('修改范围').selectOption('series');await share.check();await group.getByRole('checkbox',{name:'角色甲 · 存档一',exact:true}).check();
  await page.evaluate(()=>{db.characters[0].activeArchiveId='two';});
  await form.getByRole('button',{name:'保存',exact:true}).click();await form.getByText('同步对象的角色或存档已变化，请重新打开后选择',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>db.calendarData.events[0].shareTargets),[]);
  await form.getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(async()=>{
   const C=UvUCalendar,e=C.state().events[0];await C.saveEvent({...e,shareWithChat:true,shareTargets:['char:["a","one"]']},e.rev);
   UvUCalendarUI.editImportant('user',null,C.state().events[0]);
  });
  await stableUI(page,'#calendar-important-editor');await form.getByLabel('修改范围').selectOption('series');
  const inactive=group.getByRole('checkbox',{name:'角色甲 · 存档一（非当前，可取消）',exact:true});assert.equal(await inactive.isChecked(),true);
  await inactive.uncheck();await group.getByRole('checkbox',{name:'角色乙 · 存档一',exact:true}).check();
  await form.getByRole('button',{name:'保存',exact:true}).click();await form.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>db.calendarData.events[0].shareTargets),['char:["b","one"]']);
  assert.match(await page.evaluate(()=>UvUCalendar.context(db.characters[1],'2026-11-12')),/仅给甲/);
  assert.deepEqual(errors,[]);await context.close();console.log('PASS social help and focus; calendar explicit recipients, empty validation, five widths, persistence, revocation, archive change guard.');
 } finally { await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
