'use strict';
const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1UAAAAASUVORK5CYII=';
const baselineScripts = new Map();
(async () => {
    require('node:fs').mkdirSync(require('node:path').join(__dirname,'../outputs'),{recursive:true});
    const app = await fullApp(); let failed = 0, passed = 0;
    async function check(name, run) {
        if (process.argv[2] && !name.includes(process.argv[2])) return;
        const f = await app.page();
        try {
            if (process.env.UVU_REPAIR_BASELINE) {
                const cp = require('node:child_process'), path = require('node:path');
                let replacements = 0;
                await f.context.route('**/js/**', route => {
                    const relative = new URL(route.request().url()).pathname.slice(1);
                    if (!baselineScripts.has(relative)) baselineScripts.set(relative, cp.execFileSync('git', ['show', process.env.UVU_REPAIR_BASELINE + ':' + relative], {cwd: path.resolve(__dirname, '..')}));
                    const body = baselineScripts.get(relative);
                    replacements++; return route.fulfill({body, contentType:'application/javascript'});
                });
                await f.page.reload({waitUntil:'domcontentloaded'});
                await f.page.waitForFunction(() => document.getElementById('message-area')?.dataset.replyGesturesBound === 'true');
                assert.ok(replacements > 0);
            }
            await f.page.evaluate(async () => { await dataPersistenceQueue; GuideSystem.cleanup();
                db.characters = ['a','b'].map(id => ({id, realName:id, remarkName:id, myName:'User', persona:'fixture', myPersona:'fixture', avatar:'assets/music/cover-placeholder.svg', history:[], maxMemory:20, memoryJournals:[], worldBookIds:[]}));
                db.groups = []; db.worldBooks = []; currentChatId='a'; currentChatType='private'; ensureAllChatArchives(); await saveData();
            });
            await run(f.page); assert.deepEqual(f.errors, []); passed++; console.log('PASS ' + name);
        } catch(error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
        finally { await f.context.close(); }
    }
    try {
        await check('battery text and avatar are inert and normal bubbles close', async page => {
            const result = await page.evaluate(async image => {
                window.batteryMarker=0;
                BatteryInteraction.showBatteryThoughtBubble('<img src=x onerror="window.batteryMarker++">', 'x" onerror="window.batteryMarker++');
                await new Promise(resolve => setTimeout(resolve,50));
                const bubble=document.querySelector('.battery-thought-bubble-container');
                const result={marker:batteryMarker,text:bubble.querySelector('.thought-content').textContent,nodes:bubble.querySelector('.thought-content').children.length,handler:bubble.querySelector('img').getAttribute('onerror')};
                BatteryInteraction.showBatteryThoughtBubble('记得充电',image);
                const normal=document.querySelector('.battery-thought-bubble-container');
                result.avatar=normal.querySelector('img').src; result.normalText=normal.querySelector('.thought-content').textContent; normal.click(); result.closed=normal.classList.contains('hiding'); return result;
            },image);
            assert.equal(result.marker,0); assert.equal(result.nodes,0); assert.equal(result.handler,null); assert.match(result.text, /<img/); assert.equal(result.avatar,image); assert.equal(result.normalText,'记得充电'); assert.equal(result.closed,true);
        });
        await check('battery rejected context excluded with original thirty message window', async page => {
            const results=await page.evaluate(async()=>{
                const results=[]; const chat=db.characters[0];
                chat.history=Array.from({length:31},(_,i)=>({role:'user',content:'NORMAL_'+i}));
                ['blocked','deleted','self'].forEach((value,i)=>Object.assign(chat.history[i+1],{content:'REJECTED_'+value,relationshipDelivery:value,isContextDisabled:false}));
                for(const provider of ['newapi','gemini']) for(const secondary of [false,true]) {
                    db.apiSettings={url:'https://fixture.invalid',key:'fixture',model:'fixture',provider}; db.secondaryApiSettings={enabled:secondary,url:'https://secondary.invalid',key:'fixture',model:'fixture',provider}; db.secondaryApiRoutes={batteryReminder:secondary};
                    let body; window.fetch=async(url,options)=>{body=options.body;return new Response(JSON.stringify(provider==='gemini'?{candidates:[{content:{parts:[{text:'充电'}]}}]}:{choices:[{message:{content:'充电'}}]}));};
                    BatteryInteraction.batteryManager={level:0.1,charging:false}; BatteryInteraction.hasSentLowBatteryPrompt=false; await BatteryInteraction.triggerIndependentCheck(chat); results.push(body);
                } return results;
            });
            for(const body of results){assert.ok(!body.includes('REJECTED_'));assert.ok(!body.includes('NORMAL_0'));assert.ok(body.includes('NORMAL_30'));}
        });
        await check('reader old paragraph menu cannot attach quote to another book',async page=>{
            const result=await page.evaluate(async()=>{
                await dexieDB.reader_books.bulkPut([{id:'a',title:'A'},{id:'b',title:'B'}]); await dexieDB.reader_chapters.bulkPut(['a','b'].map(id=>({id:id+'0',bookId:id,index:0,title:id,content:id+' paragraph'})));
                switchScreen('reader-view-screen'); await readerView.loadBook('a');
                document.querySelector('#reader-text-content p').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:180}));
                await readerView.loadBook('b'); const menuHidden=getComputedStyle(document.getElementById('reader-paragraph-menu')).display==='none';
                document.getElementById('reader-menu-comment').click();document.getElementById('reader-comment-input').value='stale quote';document.getElementById('reader-comment-send').click();
                await new Promise(r=>setTimeout(r,30));return {menuHidden,count:await dexieDB.reader_comments.count()};
            });assert.equal(result.menuHidden,true);assert.equal(result.count,0);
        });
        await check('reader pending long press is cancelled when switching books', async page => {
            const result=await page.evaluate(async()=>{
                await dexieDB.reader_books.bulkPut([{id:'a',title:'A'},{id:'b',title:'B'}]);await dexieDB.reader_chapters.bulkPut(['a','b'].map(id=>({id:id+'0',bookId:id,index:0,title:id,content:id+' paragraph'})));switchScreen('reader-view-screen');await readerView.loadBook('a');const paragraph=document.querySelector('#reader-text-content p');
                paragraph.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch({identifier:1,target:paragraph,clientX:100,clientY:180})]}));await readerView.loadBook('b');await new Promise(r=>setTimeout(r,650));return {hidden:getComputedStyle(document.getElementById('reader-paragraph-menu')).display==='none',title:document.getElementById('reader-book-title').textContent};
            });assert.deepEqual(result,{hidden:true,title:'B'});
        });
        await check('shop result stays with original character and dotted categories parse',async page=>{
            const result=await page.evaluate(async()=>{
                db.characters[0].shopSettings={customCategories:[{id:'new.sale',name:'Sale',prompt:'fixture'}],itemCount:3};await saveData();
                resolveAuxiliaryApiConfig=()=>({url:'https://fixture.invalid',key:'fixture',model:'fixture',provider:'newapi'});let release;fetchAiResponse=()=>new Promise(r=>release=r);
                const task=fetchShopData();currentChatId='b';await openShopScreen();release('<shop><items><new.sale><item><name>A-only</name></item></new.sale></items></shop>');await task;switchShopTab('recommend');
                return {a:(await dexieDB.characters.get('a')).shopData?.items['new.sale'],b:(await dexieDB.characters.get('b')).shopData||null,text:document.getElementById('shop-content-container').textContent};
            });assert.equal(result.a[0].name,'A-only');assert.equal(result.b,null);assert.ok(!result.text.includes('A-only'));
        });
        await check('shop queued write is discarded when archive changes before transaction',async page=>{
            const result=await page.evaluate(async()=>{
                resolveAuxiliaryApiConfig=()=>({url:'https://fixture.invalid',key:'fixture',model:'fixture',provider:'newapi'});fetchAiResponse=async()=>'<shop><items><recommend><item><name>STALE</name></item></recommend></items></shop>';
                const original=runDataPersistence;let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
                runDataPersistence=task=>{entered();return gate.then(()=>original(task));};
                const pending=fetchShopData();await started;db.characters[0].activeArchiveId='replacement';db.characters[0].history=[];release();await pending;runDataPersistence=original;
                return {memory:db.characters[0].shopData||null,stored:(await dexieDB.characters.get('a')).shopData||null};
            });assert.deepEqual(result,{memory:null,stored:null});
        });
        await check('shop transaction rolls back if archive changes during update',async page=>{
            const result=await page.evaluate(async()=>{
                resolveAuxiliaryApiConfig=()=>({url:'https://fixture.invalid',key:'fixture',model:'fixture',provider:'newapi'});fetchAiResponse=async()=>'<shop><items><recommend><item><name>STALE</name></item></recommend></items></shop>';
                const update=dexieDB.characters.update.bind(dexieDB.characters);let updates=0;
                dexieDB.characters.update=async(...args)=>{const result=await update(...args);updates++;db.characters[0].activeArchiveId='replacement';db.characters[0].history=[];return result;};
                await fetchShopData();dexieDB.characters.update=update;return {updates,memory:db.characters[0].shopData||null,stored:(await dexieDB.characters.get('a')).shopData||null};
            });assert.deepEqual(result,{updates:1,memory:null,stored:null});
        });
        await check('shop late result discarded after archive switch',async page=>{
            const result=await page.evaluate(async()=>{
                resolveAuxiliaryApiConfig=()=>({url:'https://fixture.invalid',key:'fixture',model:'fixture',provider:'newapi'});let release;fetchAiResponse=()=>new Promise(r=>release=r);
                const task=fetchShopData();db.characters[0].activeArchiveId='replacement';db.characters[0].history=[];release('<shop><items><recommend><item><name>STALE</name></item></recommend></items></shop>');await task;return {memory:db.characters[0].shopData||null,stored:(await dexieDB.characters.get('a')).shopData||null};
            });assert.deepEqual(result,{memory:null,stored:null});
        });
        await check('API model responses preserve newer selection on both routes',async page=>{
            const result=await page.evaluate(async()=>{const results=[];for(const prefix of ['api','secondary-api']){
                document.getElementById(prefix+'-provider').value='newapi';document.getElementById(prefix+'-url').value='https://old.invalid';document.getElementById(prefix+'-key').value='fixture';let release;fetch=()=>new Promise(r=>release=r);
                let pending;if(prefix==='api')pending=fetchAndPopulateModels(false);else document.getElementById('secondary-fetch-models-btn').click();
                document.getElementById(prefix+'-url').value='https://new.invalid';const model=document.getElementById(prefix+'-model');model.replaceChildren(new Option('new-model','new-model'));release(new Response(JSON.stringify({data:[{id:'old-model'}]})));if(pending)await pending;else await new Promise(r=>setTimeout(r,30));results.push(model.value);
            }return results;});assert.deepEqual(result,['new-model','new-model']);
        });
        await check('character avatar completion cannot overwrite newly opened character',async page=>{
            const result=await page.evaluate(async()=>{
                loadSettingsToSidebar();let release;compressImage=()=>new Promise(r=>release=r);const input=document.getElementById('setting-char-avatar-upload'),dt=new DataTransfer();dt.items.add(new File(['fixture'],'a.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
                currentChatId='b';loadSettingsToSidebar();const before=document.getElementById('setting-char-avatar-preview').src;release('data:image/png;base64,QQ==');await new Promise(r=>setTimeout(r,20));await saveSettingsFromSidebar();return {before,after:document.getElementById('setting-char-avatar-preview').src,stored:(await dexieDB.characters.get('b')).avatar};
            });assert.equal(result.after,result.before);assert.equal(result.stored,result.before);
        });
        await check('image viewer reopening survives old close timeout',async page=>{
            const result=await page.evaluate(async image=>{openImageViewer(image);document.getElementById('close-full-image-btn').click();openImageViewer(image+'#second');await new Promise(r=>setTimeout(r,360));return {src:document.getElementById('full-image-view').src,visible:document.getElementById('full-image-modal').classList.contains('visible')};},image);assert.equal(result.visible,true);assert.equal(result.src,image+'#second');
        });
        await check('group member avatar, composition enter and invitation IDs',async page=>{
            const result=await page.evaluate(async()=>{
                db.groups=[{id:'g',name:'Group',avatar:'',me:{nickname:'User',avatar:'',persona:''},members:['A','B'].map(id=>({id,realName:id,groupNickname:id,persona:'',avatar:'assets/music/cover-placeholder.svg'})),theme:'white_pink',maxMemory:20,history:[],worldBookIds:[],stickerGroups:'',allowGossip:true,privateSessions:{}}];ensureAllChatArchives();await saveData();openChatRoom('g','group');openGroupMemberEditModal('A');
                let release;compressImage=()=>new Promise(r=>release=r);const input=document.getElementById('edit-member-avatar-upload'),dt=new DataTransfer();dt.items.add(new File(['fixture'],'a.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));openGroupMemberEditModal('B');const before=document.getElementById('edit-member-avatar-preview').src;release('data:image/png;base64,QQ==');await new Promise(r=>setTimeout(r,20));
                document.getElementById('edit-group-member-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await saveData();const stored=(await dexieDB.groups.get('g')).members.find(m=>m.id==='B').avatar;
                const group=db.groups[0];group.history=[{id:'start',role:'assistant',content:'[Private: A -> User: Hello]',timestamp:1}];activePrivateSessionId=null;document.getElementById('private-chat-overlay').classList.add('visible');renderPrivateChatMonitor();const text=document.getElementById('private-chat-input');text.value='zu';text.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',isComposing:true,bubbles:true}));const retained=text.value;
                for(let i=0;i<50;i++)sendInviteNotification(group,'Member'+i);return {before,stored,after:document.getElementById('edit-member-avatar-preview').src,retained,total:group.history.length,unique:new Set(group.history.map(m=>m.id)).size};
            });assert.equal(result.after,result.before);assert.equal(result.stored,result.before);assert.equal(result.retained,'zu');assert.equal(result.total,result.unique);
        });
        await check('widget old null data, management checkbox and stock clock migration', async page => {
            const result = await page.evaluate(async () => {
                await initBuiltInWidgets();
                const clock = db.widgetTemplates.find(t => t.id === 'builtin-top-panel-4x2');
                const fixed = clock.js.replace(/updateClock_{{id}}/g, 'updateClock');
                clock.js = fixed.replace(/updateClock/g, 'updateClock_{{id}}');
                await initBuiltInWidgets(); const migrated = clock.js === fixed;
                clock.js = fixed + '\n// user customization'; await initBuiltInWidgets();
                const preserved = clock.js.endsWith('// user customization');
                db.widgetTemplates.push({id:'old-null',name:'Old null',size:'2x2',html:'<div>Old</div>',css:'',js:'',defaultVars:null});
                switchScreen('widget-market-screen'); renderWidgetGallery(document.getElementById('widget-my-content'),db.widgetTemplates,false);
                document.getElementById('widget-multi-select-btn').click();
                const card=document.querySelector('#widget-my-content .widget-market-card:not(.widget-create-card)');card.click();
                const checkbox=getComputedStyle(card.querySelector('.widget-checkbox')).display;
                db.addedWidgets=[{id:'custom-widget-clock-test',templateId:clock.id,vars:{}}];db.homeLayoutPages=[['custom-widget-clock-test']];db.homeLayoutOrder=['custom-widget-clock-test'];
                setupHomeScreen(); switchScreen('home-screen');
                return {migrated,preserved,checkbox,time:document.getElementById('time-display-'+clock.id)?.innerText,expected:new Date().getHours().toString().padStart(2,'0')+':'+new Date().getMinutes().toString().padStart(2,'0')};
            });
            assert.equal(result.migrated,true);assert.equal(result.preserved,true);assert.notEqual(result.checkbox,'none');assert.equal(result.time,result.expected);
        });
        await check('widget cancelled image cannot enter another saved widget', async page => {
            await page.evaluate(async () => {
                db.widgetTemplates=[{id:'fixture',name:'Fixture',size:'2x2',html:'<div data-widget-var="image" data-widget-type="image">Image</div>',css:'',js:'',defaultVars:{image:''}}];
                db.addedWidgets=['a','b'].map(id=>({id:'custom-widget-'+id,templateId:'fixture',vars:{image:'https://fixture.invalid/'+id+'.png'}}));
                db.homeLayoutOrder=db.addedWidgets.map(w=>w.id);db.homeLayoutPages=[db.homeLayoutOrder.slice()];await saveData();setupHomeScreen();switchScreen('home-screen');isHomeEditMode=false;
                compressImage=()=>new Promise(resolve=>window.releaseImage=()=>resolve('data:image/png;base64,QQ=='));
                document.querySelector('[data-id="custom-widget-a"] [data-widget-var]').click();
            });
            await page.locator('#widget-var-file-upload').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('fixture')});
            await page.waitForFunction(()=>typeof releaseImage==='function');
            await page.evaluate(async()=>{document.getElementById('widget-var-cancel-btn').click();document.querySelector('[data-id="custom-widget-b"] [data-widget-var]').click();releaseImage();await new Promise(r=>setTimeout(r,20));document.querySelector('#widget-var-edit-form button[type=submit]').click();});
            await page.waitForFunction(()=>!document.getElementById('widget-var-edit-modal').classList.contains('visible'));
            assert.equal(await page.evaluate(async()=>(await dexieDB.globalSettings.get('addedWidgets')).value[1].vars.image),'https://fixture.invalid/b.png');
        });
        await check('sticker late image preserves B in storage and ordinary upload saves', async page => {
            await page.evaluate(async image=>{
                db.myStickers=[{id:'sa',name:'A',group:'',data:image},{id:'sb',name:'B',group:'',data:'https://fixture.invalid/b.png'}];await saveData();switchScreen('chat-room-screen');showPanel('sticker');currentStickerCategory='all';renderStickerCategories();renderStickerGrid();
                compressImage=()=>new Promise(resolve=>window.releaseImage=()=>resolve(image));handleStickerLongPress('sa');document.getElementById('edit-sticker-btn').click();
            },image);
            await page.locator('#sticker-file-upload').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('fixture')});
            await page.waitForFunction(()=>typeof releaseImage==='function');
            await page.evaluate(async()=>{document.getElementById('add-sticker-modal').classList.remove('visible');handleStickerLongPress('sb');document.getElementById('edit-sticker-btn').click();releaseImage();await new Promise(r=>setTimeout(r,20));document.querySelector('#add-sticker-form button[type=submit]').click();});
            await page.waitForFunction(()=>!document.getElementById('add-sticker-modal').classList.contains('visible'));
            assert.equal(await page.evaluate(async()=>(await dexieDB.myStickers.get('sb')).data),'https://fixture.invalid/b.png');
            await page.evaluate(image=>{compressImage=async()=>image;handleStickerLongPress('sb');document.getElementById('edit-sticker-btn').click();},image);
            await page.locator('#sticker-file-upload').setInputFiles({name:'normal.png',mimeType:'image/png',buffer:Buffer.from('fixture')});
            await page.waitForFunction(image=>document.querySelector('#sticker-preview img')?.src===image,image);
            await page.evaluate(()=>document.querySelector('#add-sticker-form button[type=submit]').click());
            await page.waitForFunction(()=>!document.getElementById('add-sticker-modal').classList.contains('visible'));
            assert.equal(await page.evaluate(async()=>(await dexieDB.myStickers.get('sb')).data),image);
        });
        await check('API normal success, overlap and stale failure retain newest models', async page => {
            const results=await page.evaluate(async()=>{
                const results=[];for(const prefix of ['api','secondary-api']){
                    const provider=document.getElementById(prefix+'-provider'),url=document.getElementById(prefix+'-url'),key=document.getElementById(prefix+'-key'),model=document.getElementById(prefix+'-model');
                    provider.value='newapi';url.value='https://fixture.invalid';key.value='fixture';model.replaceChildren(new Option('old','old'));
                    const start=()=>prefix==='api'?fetchAndPopulateModels(false):document.getElementById('secondary-fetch-models-btn').click();
                    let requests=[];fetch=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
                    const first=start();url.value='https://new.invalid';url.dispatchEvent(new Event('input'));const second=start();
                    requests[1].resolve(new Response(JSON.stringify({data:[{id:'new-model'}]})));if(second)await second;else await new Promise(r=>setTimeout(r,20));
                    requests[0].reject(new Error('stale failure'));if(first)await first;else await new Promise(r=>setTimeout(r,20));
                    results.push({value:model.value,disabled:document.getElementById(prefix==='api'?'fetch-models-btn':'secondary-fetch-models-btn').disabled});
                }return results;
            });assert.deepEqual(results,[{value:'new-model',disabled:false},{value:'new-model',disabled:false}]);
        });
        await check('group settings completion leaves B title and ordinary Enter sends', async page => {
            const result=await page.evaluate(async()=>{
                db.groups=['ga','gb'].map(id=>({id,name:id,avatar:'assets/music/cover-placeholder.svg',me:{nickname:'User',avatar:'',persona:''},members:[{id:'A',realName:'A',groupNickname:'A',persona:'',avatar:''}],theme:'white_pink',maxMemory:20,history:[],worldBookIds:[],privateSessions:{}}));ensureAllChatArchives();await saveData();openChatRoom('ga','group');loadGroupSettingsToSidebar();
                const transaction=dexieDB.transaction.bind(dexieDB);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);dexieDB.transaction=async(...args)=>{entered();await gate;return transaction(...args);};
                const pending=saveGroupSettingsFromSidebar(false);await started;openChatRoom('gb','group');release();await pending;dexieDB.transaction=transaction;const title=chatRoomTitle.textContent;
                openChatRoom('ga','group');loadGroupSettingsToSidebar();await saveGroupSettingsFromSidebar(false);const normalTitle=chatRoomTitle.textContent;
                db.groups[0].history=[{id:'start',role:'assistant',content:'[Private: A -> User: Hello]',timestamp:1}];activePrivateSessionId=null;document.getElementById('private-chat-overlay').classList.add('visible');renderPrivateChatMonitor();const input=document.getElementById('private-chat-input');input.value='normal';input.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',bubbles:true,cancelable:true}));await saveData();
                return {title,normalTitle,text:input.value,last:(await dexieDB.groups.get('ga')).history.at(-1).content};
            });assert.deepEqual(result,{title:'gb',normalTitle:'ga',text:'',last:'[Private: User -> A: normal]'});
        });
        await check('video call composition retains text and ordinary Enter sends once', async page => {
            const result=await page.evaluate(()=>{const sent=[];VideoCallModule.sendUserAction=text=>sent.push(text);const input=document.getElementById('vc-input-text');input.value='zu';input.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',isComposing:true,bubbles:true}));const retained=input.value;input.value='normal';input.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',bubbles:true,cancelable:true}));return {retained,sent,value:input.value};});
            assert.deepEqual(result,{retained:'zu',sent:['normal'],value:''});
        });
        await check('shop quantity is validated and retained on reopening', async page => {
            await page.evaluate(async()=>{await openShopScreen();openCategoryManager();const input=document.getElementById('shop-item-count');input.value='3';input.dispatchEvent(new Event('change'));});
            await page.waitForFunction(()=>db.characters[0].shopSettings?.itemCount===3);
            const result=await page.evaluate(async()=>{await dataPersistenceQueue;openCategoryManager();const input=document.getElementById('shop-item-count'),reopened=input.value;input.value='100';input.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,20));return {reopened,stored:(await dexieDB.characters.get('a')).shopSettings.itemCount};});
            assert.deepEqual(result,{reopened:'3',stored:3});
        });
        await check('peek quantities reject invalid input and hidden carousel positions first item', async page => {
            const result=await page.evaluate(async()=>{
                renderPeekSettings();const input=document.querySelector('.peek-settings-item-control input[data-app-id="cart"]');input.value='100';document.getElementById('save-peek-settings-btn').click();await new Promise(r=>setTimeout(r,20));const invalid=db.characters[0].peekScreenSettings?.generationCounts?.cart??null;
                input.value='3';document.getElementById('save-peek-settings-btn').click();await new Promise(r=>setTimeout(r,60));await dataPersistenceQueue;const saved=(await dexieDB.characters.get('a')).peekScreenSettings.generationCounts.cart;
                switchScreen('home-screen');renderPeekDrafts([{to:'FIRST',content:'First'},{to:'LAST',content:'Last'}]);switchScreen('peek-drafts-screen');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const screen=document.getElementById('peek-drafts-screen');
                return {invalid,saved,width:screen.offsetWidth,transform:screen.querySelector('.drafts-slider-track').style.transform};
            });assert.equal(result.invalid,null);assert.equal(result.saved,3);assert.ok(result.width>0);assert.equal(result.transform,'translateX(-'+result.width+'px)');
        });
        await check('peek carousel fallback handles delayed reveal without ResizeObserver', async page => {
            const result=await page.evaluate(async()=>{
                const observer=ResizeObserver;window.ResizeObserver=undefined;switchScreen('home-screen');renderPeekDrafts([{to:'FIRST',content:'First'},{to:'LAST',content:'Last'}]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));switchScreen('peek-drafts-screen');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                const screen=document.getElementById('peek-drafts-screen');const result={width:screen.offsetWidth,transform:screen.querySelector('.drafts-slider-track').style.transform};renderPeekDrafts([]);result.cleaned=screen._draftsSliderCleanup===null;window.ResizeObserver=observer;return result;
            });assert.ok(result.width>0);assert.equal(result.transform,'translateX(-'+result.width+'px)');assert.equal(result.cleaned,true);
        });
        await check('persona preset rename and delete recover failures and retry', async page => {
            const result=await page.evaluate(async()=>{
                db.myPersonaPresets=[{name:'original',persona:'fixture',avatar:''}];await saveData();prompt=()=> 'renamed';confirm=()=>true;const transaction=dexieDB.transaction.bind(dexieDB);let failed=[];
                for(const index of [1,2]){openManageMyPersonaModal();dexieDB.transaction=()=>Promise.reject(new Error('fixture quota'));await document.querySelectorAll('#mypersona-presets-list button')[index].onclick();dexieDB.transaction=transaction;failed.push({memory:db.myPersonaPresets[0].name,stored:(await dexieDB.globalSettings.get('myPersonaPresets')).value[0].name});}
                openManageMyPersonaModal();await document.querySelectorAll('#mypersona-presets-list button')[1].onclick();const renamed=(await dexieDB.globalSettings.get('myPersonaPresets')).value[0].name;await document.querySelectorAll('#mypersona-presets-list button')[2].onclick();return {failed,renamed,remaining:(await dexieDB.globalSettings.get('myPersonaPresets')).value.length};
            });assert.deepEqual(result,{failed:[{memory:'original',stored:'original'},{memory:'original',stored:'original'}],renamed:'renamed',remaining:0});
        });
        await check('unlock storage failure retains key and successful retry consumes it', async page => {
            const result=await page.evaluate(async()=>{
                db.stUnlocked=false;await saveData();localStorage.setItem('st_unlock_uuid','fixture-uuid');localStorage.setItem('st_unlock_name','fixture-name');localStorage.setItem('st_unlock_time',String(Date.now()));document.getElementById('st-unlock-key-input').value=btoa('fixture-uuid|fixture-name');
                const button=document.getElementById('st-unlock-verify-btn'),transaction=dexieDB.transaction.bind(dexieDB);dexieDB.transaction=()=>Promise.reject(new Error('fixture quota'));button.click();await new Promise(r=>setTimeout(r,30));dexieDB.transaction=transaction;const failed={memory:db.stUnlocked,stored:(await dexieDB.globalSettings.get('stUnlocked')).value,key:localStorage.getItem('st_unlock_uuid')};
                button.click();await new Promise(r=>setTimeout(r,60));await dataPersistenceQueue;return {failed,success:(await dexieDB.globalSettings.get('stUnlocked')).value,key:localStorage.getItem('st_unlock_uuid'),disabled:button.disabled};
            });assert.deepEqual(result,{failed:{memory:false,stored:false,key:'fixture-uuid'},success:true,key:null,disabled:false});
        });
        await check('peek old invalid counts fall back while valid counts retain original prompts', async page => {
            const result=await page.evaluate(()=>{
                const char=db.characters[0],counts=[];getAppPromptSnippet=(char,type,count)=>{counts.push({type,count});return 'fixture';};char.peekScreenSettings={generationCounts:{cart:100}};generatePeekContentPrompt(char,'cart','fixture');generateBatchPeekContentPrompt(char,['cart'],'fixture');
                char.peekScreenSettings.generationCounts.cart=3;generatePeekContentPrompt(char,'cart','fixture');generateBatchPeekContentPrompt(char,['cart'],'fixture');return counts;
            });assert.deepEqual(result,[{type:'cart',count:4},{type:'cart',count:3},{type:'cart',count:3},{type:'cart',count:3}]);
        });
        await check('old message save completion preserves reopened draft', async page => {
            const result=await page.evaluate(async()=>{
                const chat=db.characters[0];chat.history=[{id:'m',role:'user',content:'[User的消息：old]',parts:[{type:'text',text:'[User的消息：old]'}],timestamp:1}];await saveData();openChatRoom('a','private');startMessageEdit('m');document.getElementById('message-edit-textarea').value='first';
                const transaction=dexieDB.transaction.bind(dexieDB);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);dexieDB.transaction=async(...args)=>{entered();await gate;return transaction(...args);};
                const pending=saveMessageEdit();await started;cancelMessageEdit();startMessageEdit('m');document.getElementById('message-edit-textarea').value='new draft';release();await pending;dexieDB.transaction=transaction;
                return {visible:document.getElementById('message-edit-modal').classList.contains('visible'),draft:document.getElementById('message-edit-textarea').value,stored:(await dexieDB.characters.get('a')).history[0].content};
            });assert.equal(result.visible,true);assert.equal(result.draft,'new draft');assert.ok(result.stored.includes('first'));
        });
        await check('pin storage failure restores memory and permits successful retry', async page => {
            const result=await page.evaluate(async()=>{
                db.characters[0].isPinned=false;await saveData();let menu;createContextMenu=items=>menu=items;handleChatListLongPress('a','private',1,1);const transaction=dexieDB.transaction.bind(dexieDB);dexieDB.transaction=()=>Promise.reject(new Error('fixture quota'));await menu[0].action();dexieDB.transaction=transaction;const failed={memory:db.characters[0].isPinned,stored:(await dexieDB.characters.get('a')).isPinned};
                handleChatListLongPress('a','private',1,1);await menu[0].action();return {failed,success:(await dexieDB.characters.get('a')).isPinned};
            });assert.deepEqual(result,{failed:{memory:false,stored:false},success:true});
        });
        await check('home failed reorder cleans drag state and preserves edit controls', async page => {
            const result=await page.evaluate(async()=>{
                setupHomeScreen();switchScreen('home-screen');enterHomeEditMode();await saveData();const old=JSON.stringify(db.homeLayoutPages);const sortable=homeSortables[0];sortable.option('onStart')();const started=edgeFlipInterval!==null;
                const transaction=dexieDB.transaction.bind(dexieDB);dexieDB.transaction=()=>Promise.reject(new Error('fixture quota'));await sortable.option('onEnd')({});dexieDB.transaction=transaction;
                return {started,active:edgeFlipInterval!==null,snap:getComputedStyle(document.getElementById('home-screen-swiper')).scrollSnapType,restored:old===JSON.stringify(db.homeLayoutPages),edit:isHomeEditMode,controls:Array.from(document.querySelectorAll('.home-grid-layout')).every(grid=>grid.classList.contains('edit-mode'))};
            });assert.deepEqual(result,{started:true,active:false,snap:'x mandatory',restored:true,edit:true,controls:true});
        });
        for(const gpt of [true,false]) await check('prompt touchcancel restores row without saving '+(gpt?'GPT':'standard'), async page => {
            const selector=await page.evaluate(async gpt=>{
                const key=gpt?'gptLlmPresetGroups':'llmPresetGroups',active=gpt?'activeGptLlmPresetGroupId':'activeLlmPresetGroupId';db.workshopSettings[key]=[{id:'fixture',name:'Fixture',prompts:[{id:'p',title:'Fixture',role:'user',content:'Body',enabled:true}]}];db.workshopSettings[active]='fixture';(gpt?initWorkshopGPTLLMPrompts:initWorkshopLLMPrompts)();await saveData();
                window.cancelSaveCalls=0;saveLocalSettingsFields=async()=>{cancelSaveCalls++;return true;};const selector=gpt?'#workshop-gpt-llm-prompt-list':'#workshop-llm-prompt-list';const handle=document.querySelector(selector+' .drag-handle');handle.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch({identifier:1,target:handle,clientX:30,clientY:100})]}));return selector;
            },gpt);
            await page.waitForTimeout(550);
            const result=await page.evaluate(selector=>{document.dispatchEvent(new TouchEvent('touchcancel',{bubbles:true}));return {hidden:document.querySelector(selector).firstElementChild.style.display,clones:document.querySelectorAll('body > [data-id="p"]').length,rows:document.querySelector(selector).children.length,saves:cancelSaveCalls};},selector);
            assert.deepEqual(result,{hidden:'',clones:0,rows:1,saves:0});
        });
        for(const gpt of [true,false]) await check('visible prompt handle browser touch cancellation '+(gpt?'GPT':'standard'), async page => {
            const prefix=gpt?'workshop-gpt-':'workshop-',list='#'+prefix+'llm-prompt-list';
            await page.evaluate(async gpt=>{
                const key=gpt?'gptLlmPresetGroups':'llmPresetGroups',active=gpt?'activeGptLlmPresetGroupId':'activeLlmPresetGroupId';db.workshopSettings[key]=[{id:'touch-fixture',name:'Touch fixture',prompts:[{id:'touch-row',title:'触控测试',role:'user',content:'Fixture',enabled:true}]}];db.workshopSettings[active]='touch-fixture';await saveData();switchScreen('drawing-workshop-screen');
            },gpt);
            const tick=async()=>{await page.clock.setFixedTime(new Date(Date.now()+3000));if(await page.locator('#rescue-cancel-btn').count())await page.locator('#rescue-cancel-btn').click();};
            await tick();await page.locator('label[for="workshop-provider-'+(gpt?'gpt':'novelai')+'"]').click();
            await tick();await page.locator('.workshop-sub-tab[data-target="'+(gpt?'workshop-gpt-sub-llm':'workshop-sub-llm')+'"]').click();
            await page.evaluate(gpt=>{(gpt?initWorkshopGPTLLMPrompts:initWorkshopLLMPrompts)();},gpt);
            await page.evaluate(async()=>{await dataPersistenceQueue;});
            await page.locator(list+' .drag-handle').first().scrollIntoViewIfNeeded();const box=await page.locator(list+' .drag-handle').first().boundingBox();assert.ok(box?.width>0);
            const session=await page.context().newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});await page.waitForTimeout(550);
            assert.equal(await page.locator(list+' > [data-id="touch-row"]').evaluate(row=>row.style.display),'none');
            await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
            const result=await page.evaluate(selector=>({hidden:document.querySelector(selector).firstElementChild.style.display,clones:Array.from(document.body.children).filter(el=>el.style.position==='fixed'&&el.style.zIndex==='9999'&&el.style.pointerEvents==='none').length}),list);
            assert.deepEqual(result,{hidden:'',clones:0});await page.screenshot({path:require('node:path').join(__dirname,'../outputs/legacy-priority-touch-'+(gpt?'gpt':'standard')+'.png')});
        });
    } finally { await app.close(); }
    console.log(JSON.stringify({passed,failed}));if(failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
