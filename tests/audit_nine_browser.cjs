const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fullApp,root}=require('./helpers/full_app_browser.cjs');
(async()=>{const app=await fullApp(),failures=[],checks=[];
try{
 async function check(name,run){const f=await app.page();f.page.setDefaultTimeout(6000);try{await run(f.page);assert.deepEqual(f.errors,[]);checks.push(name);console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);console.error('FAIL '+name+': '+e.message);}finally{await f.context.close();}}
 await check('encoding failure cannot confirm stale document text',async page=>{
  await page.evaluate(()=>{window.parseImportDocument=async()=>{throw Error('new encoding failed');};window.auditDocumentResult=null;window.auditDocumentPromise=previewImportDocument(new File(['x'],'a.txt'),{text:'old text',encoding:'utf-8',warnings:[]},{}).then(r=>auditDocumentResult=r,()=>{});});
  await page.getByLabel('TXT 编码',{exact:true}).selectOption('gb18030');await page.getByText('new encoding failed',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'使用此解析结果',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>auditDocumentResult),null);
 });
 await check('new failed MCP call removes previous successful output',async page=>{
  await page.evaluate(()=>{window.auditMcpCalls=0;window.MCPServices={service:()=>({name:'fixture',url:'https://fixture.invalid/mcp',tools:{weather:{readOnly:true}}}),call:async()=>{if(++auditMcpCalls>1)throw Error('new call failed');return{text:'OLD RESULT'};}};});
  const source=fs.readFileSync(path.join(root,'js/modules/mcp_ui.js'),'utf8').replace('window.MCPUI = Object.freeze({ open });','window.MCPUI = Object.freeze({ open, toolCaller });');await page.addScriptTag({content:source});
  await page.evaluate(()=>MCPUI.toolCaller('fixture',{name:'weather',inputSchema:{type:'object'},validate:()=>true},null));
  await page.getByRole('button',{name:'调用',exact:true}).click();await page.getByText('OLD RESULT',{exact:true}).waitFor();
  await page.getByRole('button',{name:'调用',exact:true}).click();await page.getByText('new call failed',{exact:true}).waitFor();assert.equal(await page.locator('.mcp-result').textContent(),'');
 });
 await check('notification modal traps focus and restores its opener',async page=>{
  await page.evaluate(()=>switchScreen('api-settings-screen'));const opener=page.locator('#uvu-notification-preferences > summary');await opener.click();
  const panel=page.locator('#uvu-notification-preferences .draft-inline-workspace');await panel.waitFor();await page.waitForTimeout(50);
  assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),true);
  for(let i=0;i<3;i++){await page.keyboard.press('Shift+Tab');assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),true);}
  assert.equal(await page.locator('#system-notification-test').evaluate(el=>!!el.closest('[inert]')),true);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('uvu-notification-preferences').open);
  assert.equal(await opener.evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('#system-notification-test').evaluate(el=>!!el.closest('[inert]')),false);
 });
 await check('theme-following MCP controls preserve readable foreground/background',async page=>{
  await page.evaluate(()=>{document.documentElement.dataset.uvuDerivedColor='theme';for(const[k,v]of Object.entries({'--secondary-bg':'#202124','--primary-bg':'#282a2d','--text-color':'#eeeeee'}))document.documentElement.style.setProperty(k,v);openMcpSettings();});
  await page.getByRole('button',{name:'添加',exact:true}).click();
  const value=await page.getByLabel('名称',{exact:true}).evaluate(el=>{const s=getComputedStyle(el);return{fg:s.color,bg:s.backgroundColor};});
  const brightness=color=>{const a=color.match(/[\d.]+/g).map(Number);return a.slice(0,3).reduce((x,y)=>x+y,0)/3;};assert.ok(Math.abs(brightness(value.fg)-brightness(value.bg))>100,JSON.stringify(value));
 });
 await check('notification parent regains focus after a nested document dialog closes',async page=>{
  await page.evaluate(()=>switchScreen('api-settings-screen'));await page.locator('#uvu-notification-preferences > summary').click();
  const panel=page.locator('#uvu-notification-preferences .draft-inline-workspace');await panel.waitFor();
  const opener=panel.locator('button').first();await opener.focus();
  await page.evaluate(()=>{window.auditNestedPromise=previewImportDocument(new File(['x'],'a.txt'),{text:'x',warnings:[]},{}).catch(()=>{});});
  await page.locator('#document-import-preview').waitFor();await page.waitForTimeout(50);
  assert.equal(await panel.evaluate(el=>!!el.closest('[inert]')),true,'notification background must be inert while child is open: '+JSON.stringify(await page.evaluate(()=>({active:document.activeElement.outerHTML.slice(0,200),layers:[...document.querySelectorAll('.feature-dialog,.draft-inline-workspace')].map(el=>({id:el.id,visible:!!el.getClientRects().length,inert:!!el.closest('[inert]')}))}))));
  await page.keyboard.press('Escape');await page.locator('#document-import-preview').waitFor({state:'detached'});await page.waitForTimeout(50);
  assert.equal(await opener.evaluate(el=>el===document.activeElement),true,'child close must restore notification opener');assert.equal(await panel.evaluate(el=>!!el.closest('[inert]')),false,'notification must reactivate after child close');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('uvu-notification-preferences').open);
 });
 await check('worldbook inline modal owns keyboard focus and restores its summary',async page=>{
  await page.evaluate(()=>{switchScreen(document.getElementById('edit-world-book-form').closest('.screen').id);document.querySelector('.worldbook-advanced > summary').focus();document.querySelector('.worldbook-advanced').open=true;});
  const panel=page.locator('.worldbook-advanced .draft-inline-workspace');await panel.waitFor();await page.waitForTimeout(50);
  assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),true);
  for(let i=0;i<3;i++){await page.keyboard.press('Shift+Tab');assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),true);}
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.worldbook-advanced').open);
  assert.equal(await page.locator('.worldbook-advanced > summary').evaluate(el=>el===document.activeElement),true);
 });
 await check('failed bridge master setting rolls back captured channel and releases its lock',async page=>{
  await page.evaluate(async()=>{db.uvuStoryBridgeSettings={channel:'st',bridgeEnabled:true,ttSettings:{bridgeEnabled:true}};switchScreen('uvu-story-bridge-screen');await saveData();window.auditOriginalTransaction=dexieDB.transaction;window.auditSaveReject=null;const failure=new Promise((_,reject)=>{auditSaveReject=reject;});dexieDB.transaction=()=>failure;const input=document.getElementById('uvu-bridge-enabled');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});
  try{await page.waitForFunction(()=>typeof auditSaveReject==='function');}catch(error){throw Error(error.message+' '+await page.locator('#uvu-story-bridge-screen').innerText());}
  assert.equal(await page.locator('#uvu-bridge-enabled').isDisabled(),true);
  assert.equal(await page.evaluate(async()=>{try{await UvUStoryBridge.changeChannel('tt');return false;}catch(error){return /请等待/.test(error.message);}}),true);
  await page.evaluate(()=>{db.uvuStoryBridgeSettings.channel='tt';auditSaveReject(Error('fixture quota'));});
  try{await page.waitForFunction(()=>!document.getElementById('uvu-bridge-enabled').disabled);}catch(error){throw Error('bridge failure cleanup: '+error.message+' '+JSON.stringify(await page.evaluate(()=>({enabled:document.getElementById('uvu-bridge-enabled').outerHTML,status:document.getElementById('uvu-bridge-status')?.textContent,settings:db.uvuStoryBridgeSettings}))));}
  assert.deepEqual(await page.evaluate(()=>[db.uvuStoryBridgeSettings.bridgeEnabled,db.uvuStoryBridgeSettings.ttSettings.bridgeEnabled]),[true,true]);
  await page.evaluate(async()=>{dexieDB.transaction=auditOriginalTransaction;await UvUStoryBridge.changeChannel('st');});
  assert.equal(await page.evaluate(()=>db.uvuStoryBridgeSettings.channel),'st');
 });
 const out=path.join(root,'outputs/audit-nine-fixes');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({checks,failures},null,2));assert.deepEqual(failures,[]);
}finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
