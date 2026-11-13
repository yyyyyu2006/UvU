// Real index, isolated data, simulated MCP service; no external account calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fullApp,root}=require('./helpers/full_app_browser.cjs');
(async()=>{const app=await fullApp(),out=path.join(root,'outputs/panel-evidence-20261113');fs.mkdirSync(out,{recursive:true});
try{const {page,context,errors}=await app.page();
 await page.evaluate(async()=>{
  document.addEventListener('pointerdown',()=>{globalRescueClickCount=0;globalRescueLastClickTime=0;},true);
  db.characters=[{id:'evidence',realName:'测试角色',myName:'我',persona:'',myPersona:'',maxMemory:20,history:[],worldBookIds:[],memoryJournals:[]}];await saveData();openChatRoom('evidence','private');
  const cfg=MCPServices.settings();cfg.services=[{id:'evidence',name:'测试搜索',url:'https://example.com/mcp',enabled:true,auth:'none'}];await MCPServices.save(cfg);
  window.discoveryCalls=0;window.MCPTransport={...MCPTransport,create:()=>({version:'2025-03-26',listTools:async()=>{discoveryCalls++;return[{name:'search',description:'测试工具',inputSchema:{type:'object',properties:{}}}];}})};
  openMcpSettings();
 });
 const mcp=page.locator('#mcp-services .mcp-settings');
 await mcp.getByRole('button',{name:'测试 / 刷新工具',exact:true}).click();await page.waitForFunction(()=>MCPServices.health('evidence').tools===1);
 await mcp.locator('.sheet-close').click();await page.evaluate(()=>openMcpSettings());
 assert.match(await mcp.locator('.mcp-service-list').textContent(),/1 个工具/);
 await mcp.getByRole('button',{name:'工具授权',exact:true}).click();assert.match(await mcp.locator('.mcp-tools-area').textContent(),/search/);
 await mcp.locator('.draft-tool-details > summary').click();await mcp.getByRole('button',{name:'保存授权',exact:true}).click();
 await mcp.locator('.sheet-close').click();await page.evaluate(()=>openMcpSettings());assert.match(await mcp.locator('.mcp-service-list').textContent(),/1 个工具/);
 assert.equal(await page.evaluate(()=>discoveryCalls),1,'reopening must not silently request a remote service');
 await mcp.getByRole('button',{name:'编辑',exact:true}).click();const serviceEditor=page.locator('#mcp-service-editor');await serviceEditor.getByLabel('名称',{exact:true}).fill('测试搜索改名');await serviceEditor.getByRole('button',{name:'保存',exact:true}).click();await serviceEditor.waitFor({state:'detached'});assert.match(await mcp.locator('.mcp-service-list').textContent(),/1 个工具/);
 for(const [width,height]of [[320,568],[390,844],[768,844],[390,420]]){
  await page.setViewportSize({width,height});const help=mcp.locator('.mono-page-nav .sheet-guide');assert(await help.isVisible());
  const h=await help.boundingBox(),c=await mcp.locator('.sheet-close').boundingBox();assert(h.x>c.x);assert(Math.abs(h.y-c.y)<2);
  assert.equal(await mcp.locator('.mcp-body .sheet-help').count(),0);
  await help.click();assert.equal(await mcp.getAttribute('data-mono-view'),'guide');assert(await mcp.locator('.mcp-tutorial').isVisible());
  await mcp.locator('.sheet-back').click();await mcp.getByRole('button',{name:'查看调用记录',exact:true}).click();
  const boxes=await mcp.locator('.mcp-log-actions > button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));assert(Math.abs(boxes[0].y-boxes[1].y)<2);assert(boxes.every(b=>b.h<=38));
  assert.equal(await mcp.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await mcp.locator('.sheet-back').click();
 }
 await page.setViewportSize({width:390,height:844});await mcp.screenshot({path:path.join(out,'mcp.png')});await mcp.locator('.sheet-close').click();
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof MCPServices!=='undefined' && MCPServices.settings().services.length===1);
 await page.evaluate(()=>{GuideSystem.cleanup();openMcpSettings();});assert.match(await mcp.locator('.mcp-service-list').textContent(),/1 个工具/);
 await mcp.getByRole('button',{name:'工具授权',exact:true}).click();assert.match(await mcp.locator('.mcp-tools-area').textContent(),/上次发现 1 个工具/);await mcp.locator('.sheet-close').click();
 await page.evaluate(()=>{openChatRoom('evidence','private');UvUPanelLayout.open();});
 const hub=page.locator('#uvu-feature-workspace');assert.equal(await hub.locator('.draft-hub-group .mono-route:visible').count(),9);
 const gaps=await hub.locator('.draft-hub-group:visible').evaluateAll(es=>es.map((e,i)=>i?e.getBoundingClientRect().top-es[i-1].getBoundingClientRect().bottom:0));assert(gaps.slice(1).every(g=>g<=17));await hub.screenshot({path:path.join(out,'hub.png')});await hub.locator('.sheet-close').click();
 await page.evaluate(()=>openMemoryLibrary());const memory=page.locator('.memory-library > .feature-dialog-card');await memory.getByRole('button',{name:'设置',exact:true}).click();await memory.locator('.panel-library-more > summary').click();
 const buttons=memory.locator('.panel-index-buttons > button');const sizes=await buttons.evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));assert(sizes.length===4);assert(Math.abs(sizes[0].y-sizes[1].y)<2);assert(sizes.every(b=>b.h<=38));await memory.screenshot({path:path.join(out,'memory.png')});await memory.locator('.sheet-close').click();
 await page.evaluate(()=>switchScreen('uvu-story-bridge-screen'));assert.equal(await page.locator('#uvu-story-bridge-screen .mono-route').filter({hasText:'使用教程'}).count(),0);await page.locator('#uvu-story-bridge-screen .mono-nav-help').click();assert.equal(await page.locator('#uvu-story-bridge-screen').getAttribute('data-mono-view'),'guide');await page.evaluate(()=>switchScreen('home-screen'));
 await page.evaluate(async()=>{for(const start of ['2026-08-01','2026-08-29','2026-09-27','2026-10-25'])await UvUCalendar.savePeriod({start,end:UvUCalendar.addDays(start,4)});localStorage.setItem('uvu-calendar-view.v1',JSON.stringify({mode:'period',side:'user',date:'2026-11-06',month:'2026-11'}));openEnvironmentCalendar();});
 const cal=page.locator('#environment-calendar .uvu-calendar');await cal.locator('.draft-calendar-actions > summary').click();await cal.getByRole('button',{name:'记录观测',exact:true}).click();const obs=page.locator('#calendar-observation');await obs.getByLabel('日期',{exact:true}).fill('2026-11-06');await obs.getByLabel('检测结果',{exact:true}).selectOption('positive');await obs.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>db.calendarData.observations.length===1);
 assert.match(await cal.locator('.calendar-evidence').textContent(),/实际检测.*未知.*LH · 阳性/s);assert(await cal.locator('.predicted-ovulation').count());
 await cal.locator('.draft-calendar-actions > summary').click();await cal.getByRole('button',{name:'记录观测',exact:true}).click();await obs.getByLabel('日期',{exact:true}).fill('2026-11-06');await obs.getByLabel('检测结果',{exact:true}).selectOption('negative');await obs.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>db.calendarData.observations.length===2);
 assert.match(await cal.locator('.calendar-evidence').textContent(),/未知.*矛盾/s);assert.equal(await cal.locator('.predicted-ovulation').count(),0);
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await cal.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);}
 await page.setViewportSize({width:390,height:844});await cal.locator('.calendar-evidence').scrollIntoViewIfNeeded();await cal.screenshot({path:path.join(out,'calendar-evidence.png')});
 await cal.locator('.calendar-evidence > .calendar-observation-record').filter({hasText:'阴性'}).click();await obs.getByRole('button',{name:'删除',exact:true}).click();await page.waitForFunction(()=>db.calendarData.observations.length===1);assert(await cal.locator('.predicted-ovulation').count());
 await cal.getByRole('button',{name:'日历设置',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.locator('#calendar-preferences').getByRole('button',{name:'导出记录',exact:true}).click();const download=await downloadPromise;const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.deepEqual(exported.periods,[]);assert.deepEqual(exported.observations,[]);
 assert.deepEqual(errors,[]);await context.close();console.log('PASS MCP save/reopen/reload, no implicit network, top-right guides, compact aligned actions, cycle observation CRUD, conflict/unknown and private export');
}finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
