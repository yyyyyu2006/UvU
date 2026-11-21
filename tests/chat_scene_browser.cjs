// Full shipped app, temporary profile/IndexedDB, local assets and synthetic API only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {fullApp, root, stableUI} = require('./helpers/full_app_browser.cjs');
const runtime = require('./helpers/browser_runtime.cjs');
const out = path.join(root, 'outputs/scene-implementation-20261121'); fs.mkdirSync(out,{recursive:true});
(async () => {
    const app = await fullApp(), checks = [], errors = [], requests = [];
    const context = await app.browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
    try {
        const libs = runtime.assetMap(fs.readFileSync(path.join(root,'index.html'),'utf8'));
        await context.addInitScript(() => {
            localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');
            for(const key of ['guide_search_entry','guide_char_gallery','guide_group_summary','guide_group_notice','guide_group_gossip'])localStorage.setItem(key,'true');
        });
        await context.route('**/*', route => {
            const url=route.request().url();
            if(libs.has(url))return route.fulfill({path:libs.get(url),contentType:'application/javascript'});
            if(url.startsWith(app.origin)) {
                const name=new URL(url).pathname, file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
                if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
                return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});
            }
            return route.abort();
        });
        const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
        let acceptImport=false;
        page.on('dialog',dialog=>dialog.type()==='confirm'&&!acceptImport?dialog.dismiss():dialog.accept());
        let raw=JSON.stringify({version:1,blocks:[{kind:'narration',text:'他放下杯子。'},{kind:'dialogue',text:'等很久了吗？'},{kind:'narration',text:'他又放下杯子。'}]}), held=null, delay=false;
        await page.route('https://scene-api.invalid/**', async route=>{
            const body=route.request().postDataJSON();
            if (!body) return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{id:'mock'}],models:[{name:'models/mock',supportedGenerationMethods:['generateContent']}]})});
            requests.push(body);
            if(delay)await new Promise(resolve=>held=resolve);
            const gemini=route.request().url().includes('v1beta');
            const payload=gemini?{candidates:[{content:{parts:[{text:raw}]}}]}:{choices:[{message:{content:raw}}]};
            if(body.stream) await route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:raw}}]})+'\n\ndata: [DONE]\n\n'});
            else await route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
        });
        const ready=()=>page.waitForFunction(()=>document.getElementById('scene-mode-btn')?.dataset.bound==='true');
        await page.goto(app.origin,{waitUntil:'domcontentloaded'}); await ready();
        await page.evaluate(async()=>{
            GuideSystem.cleanup(); db.characters=[{id:'scene-char',realName:'许见青',remarkName:'许见青',myName:'我',persona:'安静耐心',myPersona:'用户',maxMemory:20,worldBookIds:[],memoryJournals:[],history:[
                {id:'user-source',role:'user',timestamp:Date.now(),content:'[我的消息：我坐下来。]',parts:[{type:'text',text:'[我的消息：我坐下来。]'}]}
            ]},{id:'other-char',realName:'其他角色',remarkName:'其他角色',myName:'我',maxMemory:20,history:[],worldBookIds:[],memoryJournals:[]}];
            const portrait='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="20" fill="#d4e5ef"/><circle cx="40" cy="32" r="13" fill="#fff"/><path d="M15 75a25 25 0 0 1 50 0" fill="#fff"/></svg>');
            db.characters.forEach(c=>{c.avatar=portrait;c.myAvatar=portrait;});
            db.groups=[];db.worldBooks=[];db.backupReminderSettings={enabled:false};
            db.apiSettings={provider:'newapi',url:'https://scene-api.invalid',key:'synthetic',model:'mock',streamEnabled:false};
            db.cotSettings={enabled:false};ensureAllChatArchives();await saveData();openChatRoom('scene-char','private');GuideSystem.cleanup();
        });
        const edit=async(id,segment)=>{
            const locator=page.locator('.message-wrapper[data-id="'+id+'"]'+(segment?'[data-segment-id="'+segment+'"]':'')).first();
            await locator.click({button:'right'});await page.locator('.context-menu-item').filter({hasText:/^编辑$/}).click();
            await page.locator('#message-edit-modal').waitFor({state:'visible'});
        };
        const saveEdit=async()=>{await page.locator('#message-edit-form button[type=submit]').click();await page.locator('#message-edit-modal').waitFor({state:'hidden'});};
        await edit('user-source');assert.equal(await page.locator('#message-edit-narration').isVisible(),true);
        assert.equal(await page.locator('#message-edit-timestamp').isVisible(),true);
        await page.locator('#message-edit-narration').check();await page.locator('#cancel-edit-modal-btn').click();
        assert.equal(await page.evaluate(()=>db.characters[0].history[0].scene===undefined),true);checks.push('原编辑器保留时间字段，取消不修改消息');
        await edit('user-source');await page.locator('#message-edit-narration').check();await saveEdit();
        const stamp=await page.evaluate(()=>db.characters[0].history[0].timestamp);
        assert.equal(await page.locator('.scene-narration').count(),1);
        assert.equal(await page.evaluate(()=>db.characters[0].history[0].role),'user');
        await edit('user-source');await page.locator('#message-edit-textarea').fill('我站起来。');await saveEdit();
        await edit('user-source');await page.locator('#message-edit-narration').uncheck();await saveEdit();
        assert.equal(await page.locator('.scene-narration').count(),0);assert.equal(await page.evaluate(()=>db.characters[0].history[0].content),'[我的消息：我站起来。]');
        assert.equal(await page.evaluate(()=>db.characters[0].history[0].timestamp),stamp);checks.push('旁白编辑与还原保留ID、作者、时间及最新正文');
        await edit('user-source');await page.locator('#message-edit-narration').check();
        await page.evaluate(async()=>{window.sceneDiskFailure=()=>{throw new Error('synthetic disk failure');};dexieDB.characters.hook('updating',window.sceneDiskFailure);await saveMessageEdit();});
        assert.equal(await page.evaluate(()=>!db.characters[0].history[0].scene),true);
        assert.equal(await page.locator('#message-edit-modal').isVisible(),true);assert.equal(await page.locator('#message-edit-narration').isChecked(),true);
        await page.evaluate(()=>{dexieDB.characters.hook('updating').unsubscribe(window.sceneDiskFailure);});await page.locator('#cancel-edit-modal-btn').click();checks.push('编辑保存失败回滚原消息并保留待重试内容');
        await page.locator('#toggle-expansion-btn').click();await page.locator('#scene-mode-btn').click();
        await page.locator('#scene-enabled').check();await page.locator('#scene-name').fill('雨后的咖啡店');
        await page.locator('#scene-place').fill('靠窗座位');await page.locator('#scene-mode-form button[type=submit]').click();
        await page.locator('#scene-mode-modal').waitFor({state:'hidden'});assert.equal(await page.locator('#scene-mode-bar').isVisible(),true);
        const reply=()=>page.evaluate(()=>getAiReply('scene-char','private'));
        await reply(); assert.equal(requests.length,1);assert.match(requests[0].messages[0].content,/只输出一份完整JSON/);assert.doesNotMatch(requests[0].messages[0].content,/严禁提出任何关于线下见面/);
        assert.equal(await page.evaluate(()=>db.characters[0].history.length),2);assert.equal(await page.locator('.scene-narration').count(),2);
        assert.equal(await page.locator('[data-segment-id] .message-bubble .bubble-content').textContent(),'等很久了吗？');
        const roleTurn=await page.evaluate(()=>db.characters[0].history[1]);assert.equal(roleTurn.scene.blocks.length,3);checks.push('主API单次请求，有序三段只保存一轮history');
        await stableUI(page,'#message-area');await page.screenshot({path:path.join(out,'chat-clean.png')});
        await edit(roleTurn.id,roleTurn.scene.blocks[2].id);await page.locator('#message-edit-textarea').fill('他望向窗外。');await saveEdit();
        assert.deepEqual(await page.evaluate(()=>db.characters[0].history[1].scene.blocks.map(b=>b.text)),['他放下杯子。','等很久了吗？','他望向窗外。']);
        await page.locator('[data-segment-id="'+roleTurn.scene.blocks[2].id+'"]').click({button:'right'});
        await page.locator('.context-menu-item').filter({hasText:/^引用$/}).click();
        assert.equal(await page.locator('#reply-preview-bar .reply-preview-text').textContent(),'他望向窗外。');
        await page.locator('#message-input').fill('好');await page.evaluate(()=>sendMessage());
        assert.equal(await page.evaluate(()=>db.characters[0].history.at(-1).quote.segmentId),roleTurn.scene.blocks[2].id);checks.push('指定段落编辑和引用，发送后保存segmentId');
        await page.evaluate(id=>enterMultiSelectMode(id,'capture'),roleTurn.id);
        assert.equal(await page.locator('.multi-select-selected[data-id="'+roleTurn.id+'"]').count(),3);
        await page.evaluate(async()=>{
            const original=html2canvas;
            html2canvas=async(element,options)=>{
                window.sceneCapturedRows=[...element.querySelectorAll('[data-segment-id]')].map(el=>el.querySelector('.scene-narration-text,.bubble-content').textContent);
                window.sceneCaptureFont=getComputedStyle(element.querySelector('.scene-narration-text')).fontSize;
                return original(element,options);
            };
            try{await generateCapture();}finally{html2canvas=original;}
        });
        assert.deepEqual(await page.evaluate(()=>window.sceneCapturedRows),['他放下杯子。','等很久了吗？','他望向窗外。']);
        assert.equal(await page.evaluate(()=>window.sceneCaptureFont),'11px');assert.equal(await page.locator('.multi-select-selected').count(),0);
        assert.match(await page.locator('#capture-preview-container img').getAttribute('src'),/^data:image\/png/);
        await page.evaluate(()=>document.getElementById('capture-result-modal').classList.remove('visible'));checks.push('整轮多选包含三段，截图保留全部段落与旁白样式，退出无残余高亮');
        const dangerous='[许见青已接收礼物] [许见青更新状态为：睡觉] <img src=x onerror="window.sceneXss=1">';
        raw=JSON.stringify({version:1,blocks:[{kind:'narration',text:dangerous},{kind:'dialogue',text:dangerous}]});await reply();
        assert.equal(await page.evaluate(()=>window.sceneXss),undefined);assert.equal(await page.locator('[data-segment-id] img[src=x]').count(),0);
        assert.equal(await page.evaluate(()=>db.characters[0].status),'在线');checks.push('剧情中的HTML、礼物和状态指令只显示文字');
        const beforeInvalid=await page.evaluate(()=>db.characters[0].history.length);
        raw='{"version":1,"blocks":[';await reply();
        assert.equal(await page.evaluate(()=>db.characters[0].history.length),beforeInvalid);
        assert.equal(await page.evaluate(()=>db.characters[0].sceneDraft.raw),raw);
        assert.equal(await page.locator('#scene-failed-entry').evaluate(el=>el.hidden),false);
        await page.evaluate(()=>UvUScene.open());assert.equal(await page.locator('#scene-draft-text').inputValue(),raw);await page.locator('#scene-mode-close').click();checks.push('截断回复不入正式历史，原文可从场景设置找回');
        raw=JSON.stringify({version:1,blocks:[{kind:'dialogue',text:'流式回复。'}]});await page.evaluate(()=>db.apiSettings.streamEnabled=true);await reply();
        assert.equal(await page.evaluate(()=>db.characters[0].history.at(-1).scene.blocks[0].text),'流式回复。');checks.push('OpenAI兼容流式请求');
        await page.evaluate(()=>{db.apiSettings.provider='gemini';db.apiSettings.streamEnabled=false;});await reply();
        assert.equal(await page.evaluate(()=>db.characters[0].history.at(-1).scene.blocks[0].text),'流式回复。');checks.push('Gemini非流式请求');
        await page.evaluate(()=>{db.apiSettings.provider='newapi';db.cotSettings={enabled:true,prefillEnabled:true,activePresetId:'scene-cot'};db.cotPresets=[{id:'scene-cot',items:[{enabled:true,content:'OLD_ONLINE_COT'}]}];});await reply();
        assert.doesNotMatch(JSON.stringify(requests.at(-1)),/OLD_ONLINE_COT|incipere|<thinking>/);checks.push('旁白请求不叠加冲突的线上CoT预填');
        assert.equal(await page.evaluate(()=>calculateTokenBreakdown('scene-char','private',[]).cot),0);
        raw='<thinking>实际返回并保存的思考</thinking>'+JSON.stringify({version:1,blocks:[{kind:'dialogue',text:'有已返回思考的回复'}]});await reply();
        assert.equal(await page.evaluate(()=>getSavedMessageThinking(db.characters[0],db.characters[0].history.at(-1).id).text),'实际返回并保存的思考');
        raw=JSON.stringify({version:1,blocks:[{kind:'dialogue',text:'这只是文字 </thinking>。'}]});await reply();
        assert.equal(await page.evaluate(()=>db.characters[0].history.at(-1).scene.blocks[0].text),'这只是文字 </thinking>。');checks.push('Token预览不含旧CoT，正文中的结束标签不触发旧预填修补');
        assert.equal(await page.evaluate(()=>getSavedMessageThinking(db.characters[0],db.characters[0].history.at(-1).id)),null);checks.push('思考查看仅关联本轮真正返回的内容，不借用上一轮');
        const failure=await page.evaluate(async()=>{
            const chat=db.characters[0],count=chat.history.length,fail=()=>{throw new Error('synthetic disk failure');};
            dexieDB.characters.hook('updating',fail);
            try{await UvUScene.deliver('{"version":1,"blocks":[{"kind":"dialogue","text":"未落盘回复"}]}',UvUScene.capture(chat,'private'));}
            finally{dexieDB.characters.hook('updating').unsubscribe(fail);}
            return {same:chat.history.length===count,raw:chat.sceneDraft.raw};
        });assert.equal(failure.same,true);assert.match(failure.raw,/未落盘回复/);checks.push('回复保存失败回滚整个回合，原文仍可复制');
        const stopped=await page.evaluate(async()=>{
            const chat=db.characters[0],count=chat.history.length,controller=new AbortController();
            const partial='{"version":1,"blocks":[{"kind":"narration","text":"尚未说完';
            const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:partial}}]})+'\n\n'));setTimeout(()=>{controller.abort();c.error(new DOMException('stopped','AbortError'));},50);}});
            try{await processStream(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),chat,'newapi',chat.id,'private',false,()=>!controller.signal.aborted,controller.signal,null,[],null,UvUScene.capture(chat,'private'));}catch(_){}
            return {same:chat.history.length===count,raw:chat.sceneDraft.raw,partial};
        });assert.equal(stopped.same,true);assert.equal(stopped.raw,stopped.partial);checks.push('停止流式生成保留已经收到的正文，history无半截');
        const memory=await page.evaluate(()=>{
            const message=db.characters[0].history[0],chat={history:[message],memoryJournals:[{id:'synthetic-summary',title:'测试摘要',content:'用户原先说了话',range:{start:0,end:1},autoMemory:{version:1,committed:true,kind:'summary',sources:[{id:message.id,hash:autoMemoryMessageHash(message)}]}}]};
            const before=getAutoMemoryState(chat).validIds.has('synthetic-summary');
            chat.history=[UvUScene.convert(message,'我站起来。',true,db.characters[0])];
            return {before,after:getAutoMemoryState(chat).validIds.has('synthetic-summary')};
        });assert.deepEqual(memory,{before:true,after:false});checks.push('用户文字改为动作后，旧来源摘要立即失效');
        raw=JSON.stringify({version:1,blocks:[{kind:'dialogue',text:'流式回复。'}]});
        const beforeLate=await page.evaluate(()=>db.characters[0].history.length);delay=true;
        await page.evaluate(()=>{window.pendingSceneReply=getAiReply('scene-char','private');});
        await page.waitForFunction(()=>getChatGeneration()?.controller);
        while(!held)await new Promise(resolve=>setTimeout(resolve,10));
        await page.evaluate(()=>{db.characters[0].sceneMode.revision++;});held();held=null;delay=false;await page.evaluate(()=>window.pendingSceneReply);
        assert.equal(await page.evaluate(()=>db.characters[0].history.length),beforeLate);checks.push('模式修订后迟到回复不写入');
        const backup=await page.evaluate(()=>{
            const chat=db.characters[0],exported=storageExportChat(chat,true,true),modules={characters:[exported]};
            storageValidateModules(modules);
            const invalid=JSON.parse(JSON.stringify(modules));invalid.characters[0].history.find(m=>m.scene).scene.version=99;
            let rejected=false;try{storageValidateModules(invalid);}catch(_){rejected=true;}
            return {exported,rejected};
        });assert.equal(backup.rejected,true);assert.equal(backup.exported.sceneMode.enabled,true);checks.push('聊天分类备份保留模式/分段/引用，未知版本导入前拒绝');
        const guardsBefore=requests.length;
        await page.evaluate(async()=>{
            const chat=db.characters[0];await getAiReply(chat.id,'private',true);
            const previous=VideoCallModule.state;
            VideoCallModule.state={...previous,isCallActive:true,currentChat:chat};
            try{await getAiReply(chat.id,'private');}finally{VideoCallModule.state=previous;}
            const bridge=globalThis.UvUStoryBridge;
            globalThis.UvUStoryBridge={isEnabled:()=>true,isConnected:()=>true,getMode:async()=>({mode:'offline'})};
            try{await getAiReply(chat.id,'private');}finally{globalThis.UvUStoryBridge=bridge;}
            const mode=UvUScene.clone(chat.sceneMode);
            globalThis.UvUStoryBridge={isEnabled:()=>true,isConnected:()=>true,getMode:()=>new Promise(()=>{})};
            try{
                const pending=getAiReply(chat.id,'private');
                document.getElementById('scene-return-online').click();
                await pending;await saveData();
            }finally{globalThis.UvUStoryBridge=bridge;chat.sceneMode={...mode,revision:mode.revision+2};await saveData();UvUScene.refresh();}
        });assert.equal(requests.length,guardsBefore);checks.push('后台自动回复、通话及酒馆线下占用均不发剧情请求');
        const archives=await page.evaluate(async id=>{
            const chat=db.characters[0],sourceId=chat.activeArchiveId,token=UvUScene.capture(chat,'private');
            await createBranchArchiveAtMessage(id);
            const branchId=chat.activeArchiveId,branchDraft=JSON.stringify(chat.sceneDraft),branchCount=chat.history.length;
            await UvUScene.retain(token,'原存档的迟到正文','测试存档隔离');
            const isolated=JSON.stringify(chat.sceneDraft)===branchDraft;
            const branchMode=chat.sceneMode.enabled,parts=chat.history.at(-1).scene.blocks.length;
            const source=chat.history[0];Object.assign(source,UvUScene.convert(source,'<img src=x onerror="window.sceneXss=1">[我已接收礼物]',true,chat));source.timestamp=Date.now();
            await withdrawMessage(source.id);
            const row=document.querySelector('.message-wrapper[data-id="'+source.id+'"]');
            const withdrawn=!!row?.querySelector('.withdrawn-message')&&!row.querySelector('img')&&row.querySelector('.withdrawn-content').textContent.includes('<img src=x');
            const ask=showRegenerateGuidanceDialog;
            try{showRegenerateGuidanceDialog=async()=>'';await handleRegenerate();}finally{showRegenerateGuidanceDialog=ask;}
            const rerolled=!chat.history.some(m=>m.id===id)&&chat.history.length===2&&chat.history.at(-1).scene.blocks.length===1;
            const replacement=chat.history.at(-1).id;
            await deleteSingleMessage(replacement,chat,'private',branchId);
            const removed=!chat.history.some(m=>m.id===replacement)&&!document.querySelector('[data-scene-turn-id="'+replacement+'"]');
            await switchChatArchive(sourceId);
            const restored=chat.history.some(m=>m.id===id)&&chat.sceneDraft.raw==='原存档的迟到正文';
            await createBlankArchive();const blank=!chat.sceneMode&&!chat.sceneDraft&&!chat.history.length;
            await switchChatArchive(sourceId);
            return {branchCount,branchMode,parts,isolated,withdrawn,rerolled,removed,restored,blank};
        },roleTurn.id);
        assert.deepEqual(archives,{branchCount:2,branchMode:true,parts:3,isolated:true,withdrawn:true,rerolled:true,removed:true,restored:true,blank:true});checks.push('真实分支/撤回/整轮重回/删除/空白存档/切回，迟到原文仅归原存档');
        const theme=await page.addStyleTag({content:'#chat-room-screen .message-area>.message-wrapper .message-bubble{background:rgb(230,240,242)!important;border-radius:19px!important;border:1px dashed rgb(120,140,150)!important}'});
        assert.equal(await page.locator('[data-segment-id] .message-bubble').first().evaluate(el=>getComputedStyle(el).borderTopStyle),'dashed');
        assert.equal(await page.locator('.scene-narration-text').first().evaluate(el=>getComputedStyle(el).fontSize),'11px');
        await page.screenshot({path:path.join(out,'scene-theme.png')});await theme.evaluate(el=>el.remove());checks.push('自定义主题样本继续控制原对白气泡，旁白保持独立样式');
        const touchTarget=page.locator('[data-segment-id="'+roleTurn.scene.blocks[2].id+'"]');await touchTarget.scrollIntoViewIfNeeded();
        const box=await touchTarget.boundingBox(),cdp=await context.newCDPSession(page),point={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
        await page.locator('.context-menu-item').filter({hasText:/^编辑$/}).waitFor({state:'visible'});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.locator('.context-menu-item').filter({hasText:/^编辑$/}).click();
        assert.equal(await page.locator('#message-edit-textarea').inputValue(),'他望向窗外。');await page.locator('#cancel-edit-modal-btn').click();await cdp.detach();checks.push('完整应用触摸长按旁白，原菜单编辑命中正确段落');
        await page.evaluate(()=>{
            Object.keys(selectedModules).forEach(key=>selectedModules[key]=['contacts','chats'].includes(key));
            Object.keys(selectedImportModules).forEach(key=>selectedImportModules[key]=['contacts','chats'].includes(key));
            switchScreen('storage-analysis-screen');
        });
        const downloadJob=page.waitForEvent('download');await page.locator('#storage-export-btn').click();
        const download=await downloadJob,bytes=fs.readFileSync(await download.path());
        assert.match(download.suggestedFilename(),/\.ee$/);
        await page.evaluate(async()=>{const chat=db.characters[0];chat.history=[];delete chat.sceneMode;delete chat.sceneDraft;await saveData();});
        acceptImport=true;
        await page.locator('#storage-import-file').setInputFiles({name:'旁白测试.ee.txt',mimeType:'text/plain',buffer:bytes});
        await page.waitForFunction(()=>document.getElementById('storage-backup-progress')?.textContent.includes('导入已成功提交'));
        checks.push('真实EE下载、Worker导入及同字节改名TXT往返恢复');
        await page.reload({waitUntil:'domcontentloaded'});await ready();await page.evaluate(()=>{GuideSystem.cleanup();openChatRoom('scene-char','private');GuideSystem.cleanup();});
        assert.equal(await page.evaluate(()=>db.characters.find(c=>c.id==='scene-char').history.at(-1).scene.blocks[0].text),'这只是文字 </thinking>。');checks.push('IndexedDB落盘后刷新保留原文与段落');
        for(const size of [{width:320,height:568},{width:390,height:844},{width:768,height:1024},{width:844,height:390}]){
            await page.setViewportSize(size);await stableUI(page,'#message-area');
            const style=await page.locator('.scene-narration-text').first().evaluate(el=>{const s=getComputedStyle(el);return {font:s.fontSize,italic:s.fontStyle,align:s.textAlign,color:s.color};});
            assert.deepEqual(style,{font:'11px',italic:'italic',align:'center',color:'rgb(123, 130, 136)'});
            await page.evaluate(()=>UvUScene.open());await stableUI(page,'#scene-mode-modal .modal-window');
            assert.equal(await page.locator('#scene-mode-modal .modal-window').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1),true);
            await page.screenshot({path:path.join(out,'settings-'+size.width+'x'+size.height+'.png')});await page.locator('#scene-mode-close').click();
        }checks.push('320/390/768及横屏实际UI，旁白字号/颜色/居中和面板内部滚动');
        await page.setViewportSize({width:390,height:844});await page.locator('#scene-return-online').click();
        await page.locator('#scene-mode-bar').waitFor({state:'hidden'});
        assert.equal(await page.locator('#scene-mode-bar').isVisible(),false);assert.equal(await page.evaluate(()=>db.characters.find(c=>c.id==='scene-char').sceneMode.enabled),false);
        raw='[许见青的消息：回到线上。]';await reply();assert.equal(await page.evaluate(()=>db.characters.find(c=>c.id==='scene-char').history.at(-1).scene),undefined);
        assert.match(requests.at(-1).messages[0].content,/线上聊天/);checks.push('关闭保留旧旁白，未来请求恢复原线上提示词及解析');
        assert.deepEqual(errors,[]);
        await page.screenshot({path:path.join(out,'chat-390.png')});
        fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,requests:requests.length,errors},null,2));
        console.log('PASS '+checks.length+' full-app scene checks; '+requests.length+' synthetic API requests; output '+out);
    } finally {await context.close();await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
