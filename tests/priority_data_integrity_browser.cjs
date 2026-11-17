const assert = require('node:assert/strict');
const { fullApp } = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    let failed = 0;
    async function check(name, run) {
        if (process.argv[2] && !name.includes(process.argv[2])) return;
        const fixture = await app.page();
        try { await run(fixture.page); assert.deepEqual(fixture.errors, [], 'no uncaught browser errors'); console.log('PASS ' + name); }
        catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
        finally { await fixture.context.close(); }
    }
    try {
        for (const navigate of [false, true]) await check(navigate ? 'book navigation cancels pending illustration before generation' : 'illustration saves normally in the current book', async page => {
            await page.evaluate(async () => {
                await dexieDB.reader_books.bulkPut([{id:'a',title:'A'},{id:'b',title:'B'}]);
                await dexieDB.reader_chapters.bulkPut([
                    {id:'a0',bookId:'a',index:0,title:'A0',content:'A-only paragraph'},
                    {id:'b0',bookId:'b',index:0,title:'B0',content:'B-only paragraph'}
                ]);
                await readerView.loadBook('a');
                db.workshopSettings = {provider:'novelai',novelaiApiUrl:'https://fixture.invalid/image',novelaiApiKey:'fixture',
                    activeLlmPresetGroupId:'g',llmPresetGroups:[{id:'g',prompts:[{enabled:true,title:'context',content:'fixed'}]}]};
                resolveWorkshopLlmApiConfig = () => ({url:'https://fixture.invalid',key:'fixture',model:'fixture',provider:'newapi'});
                const originalFetch = window.fetch;
                window.fetch = (url, ...args) => String(url).startsWith('https://fixture.invalid')
                    ? new Promise(resolve => window.releaseIllustration = () => resolve(new Response(JSON.stringify({choices:[{message:{content:
                        '<image001><原文段落>A-only paragraph</原文段落><image>fixture</image></image001>'}}]}), {status:200})))
                    : originalFetch(url, ...args);
                window.illustrationGenerationCalls = 0;
                window.executeImageGeneration = async () => { illustrationGenerationCalls++; return {imageData:'aGVsbG8='}; };
                document.getElementById('reader-generate-illustration-btn').click();
            });
            await page.waitForFunction(() => typeof releaseIllustration === 'function');
            await page.evaluate(async navigate => { if (navigate) await readerView.loadBook('b'); releaseIllustration(); }, navigate);
            await page.waitForFunction(() => !document.getElementById('reader-generate-illustration-btn').disabled);
            const result = await page.evaluate(async () => ({rows:await dexieDB.reader_comments.toArray(),
                title:document.getElementById('reader-book-title').textContent,
                calls:illustrationGenerationCalls, icons:document.querySelectorAll('#reader-text-content .reader-inline-comment-icon').length}));
            assert.equal(result.rows.length, navigate ? 0 : 1);
            assert.equal(result.calls, navigate ? 0 : 1);
            if (!navigate) assert.equal(result.rows[0].bookId, 'a');
            assert.equal(result.title, navigate ? 'B' : 'A');
            assert.equal(result.icons, navigate ? 0 : 1, 'only the current book may receive its completed illustration');
        });

        await check('consecutive workshop removals use stable IDs', async page => {
            const remaining = await page.evaluate(async () => {
                db.characters = ['a','b','c'].map(id => ({id,realName:id,remarkName:id,avatar:''}));
                db.workshopSettings.boundCharacters = ['a','b','c'].map(charId => ({charId,prompt:''}));
                initWorkshopCharManagement(); window.confirm = () => true;
                const buttons = [...document.querySelectorAll('#workshop-char-list .remove-char-btn')];
                buttons[0].click(); buttons[1].click();
                await saveData();
                return db.workshopSettings.boundCharacters.map(item => item.charId);
            });
            assert.deepEqual(remaining, ['c']);
        });

        await check('invalid CoT import leaves presets and disk unchanged', async page => {
            const result = await page.evaluate(async () => {
                loadCotSettings();
                await saveData();
                const before = JSON.stringify({presets:db.cotPresets,settings:db.cotSettings});
                await importCotPreset({target:{files:[{text:async()=>JSON.stringify({name:'invalid',items:[{id:'x',name:'x',enabled:true}]})}],value:'fixture'}});
                return {before,after:JSON.stringify({presets:db.cotPresets,settings:db.cotSettings})};
            });
            assert.equal(result.after, result.before);
        });

        await check('delayed CoT import stays in captured mode', async page => {
            const result = await page.evaluate(async () => {
                loadCotSettings(); currentCotMode='chat'; const callBefore=db.cotSettings.activeCallPresetId;
                let release; const input={files:[{text:()=>new Promise(resolve=>release=resolve)}],value:'fixture'};
                const pending=importCotPreset({target:input}); currentCotMode='call';
                release(JSON.stringify({name:'valid',items:[{id:'x',name:'x',content:'UNCHANGED',enabled:true}]}));
                await pending;
                return {callBefore,callAfter:db.cotSettings.activeCallPresetId,
                    imported:db.cotPresets.find(p=>p.id===db.cotSettings.activePresetId)};
            });
            assert.equal(result.callAfter, result.callBefore);
            assert.equal(result.imported.name, 'valid (导入)');
            assert.equal(result.imported.items[0].content, 'UNCHANGED');
        });

        await check('failed CoT import removes only own draft', async page => {
            const result=await page.evaluate(async()=>{
                loadCotSettings(); await saveData();
                const oldPresets=db.cotPresets.length, active=db.cotSettings.activePresetId;
                const hook=()=>{throw Error('injected save failure')};
                dexieDB.globalSettings.hook('updating',hook);
                try { await importCotPreset({target:{files:[{text:async()=>JSON.stringify({name:'valid',items:[{id:'x',name:'x',content:'same',enabled:true}]})}],value:'fixture'}}); }
                finally { dexieDB.globalSettings.hook('updating').unsubscribe(hook); }
                return {oldPresets,count:db.cotPresets.length,active,after:db.cotSettings.activePresetId};
            });
            assert.equal(result.count,result.oldPresets);
            assert.equal(result.after,result.active);
        });

        await check('import confirmation ignores same-task double submit', async page => {
            await page.evaluate(() => {
                showImportConfirmModal({name:'Double import',description:'same'}, '');
                const form=document.getElementById('import-confirm-form');
                form.dispatchEvent(new Event('submit',{cancelable:true}));
                form.dispatchEvent(new Event('submit',{cancelable:true}));
            });
            await page.waitForFunction(() => !document.getElementById('import-confirm-modal').classList.contains('visible'));
            assert.equal(await page.evaluate(()=>db.characters.filter(c=>c.realName==='Double import').length),1);
        });

        await check('shop failure restores settings while keeping guarded disk value', async page => {
            const result=await page.evaluate(async()=>{
                db.characters=[{id:'s',history:[],shopSettings:{itemCount:8}}]; currentChatId='s';currentChatType='private';await saveData();
                const hook=()=>{throw Error('injected failure')};dexieDB.characters.hook('updating',hook);
                let error; try{const settings=getShopSettings();settings.itemCount=2;await saveShopSettings(settings);}
                catch(e){error=e.message;}finally{dexieDB.characters.hook('updating').unsubscribe(hook);}
                return {error,memory:db.characters[0].shopSettings.itemCount,disk:(await dexieDB.characters.get('s')).shopSettings.itemCount};
            });
            assert.match(result.error,/injected/);assert.equal(result.memory,8);assert.equal(result.disk,8);
        });

        await check('checkout stays with original archive and preserves draft', async page => {
            await page.evaluate(async()=>{
                db.characters=[{id:'a',realName:'A',remarkName:'A',myName:'U',history:[],peekData:{cart:{items:[{title:'item',price:'1.00'}]}}},
                    {id:'b',realName:'B',remarkName:'B',myName:'U',history:[],peekData:{}}];
                currentChatId='a';currentChatType='private';await saveData();
                document.getElementById('message-input').value='UNSENT-DRAFT';
                renderPeekCart(db.characters[0].peekData.cart.items);
                document.querySelector('#peek-cart-screen .checkout-btn').click();
                currentChatId='b';
            });
            await page.waitForFunction(()=>document.querySelector('#peek-cart-screen .checkout-btn').disabled===false);
            const result=await page.evaluate(async()=>({a:db.characters[0].history,b:db.characters[1].history,
                disk:(await dexieDB.characters.get('a')).history,draft:document.getElementById('message-input').value,current:currentChatId}));
            assert.equal(result.a.length,2);assert.equal(result.b.length,0);assert.equal(result.disk.length,2);
            assert.equal(result.a[0].content,'[system-display:U帮A清空了ta的购物车]');
            assert.equal(result.a[1].content,'[U的消息：[U为A下单了：即时送达|1.00|item x1]]');
            assert.equal(result.draft,'UNSENT-DRAFT');assert.equal(result.current,'b');
        });

        await check('failed checkout restores cart and both messages', async page => {
            await page.evaluate(async()=>{
                db.characters=[{id:'a',realName:'A',remarkName:'A',myName:'U',history:[],peekData:{cart:{items:[{title:'item',price:'1.00'}]}}}];
                currentChatId='a';currentChatType='private';await saveData();
                window.failCheckout=()=>{throw Error('injected failure')};dexieDB.characters.hook('updating',failCheckout);
                renderPeekCart(db.characters[0].peekData.cart.items);document.querySelector('#peek-cart-screen .checkout-btn').click();
            });
            await page.waitForFunction(()=>document.querySelector('#peek-cart-screen .checkout-btn').disabled===false);
            const result=await page.evaluate(()=>({cart:db.characters[0].peekData.cart.items.length,history:db.characters[0].history.length}));
            assert.deepEqual(result,{cart:1,history:0});
        });

        await check('group preset reads group controls and retains CSS bytes', async page => {
            const result=await page.evaluate(async()=>{
                db.groups=[{id:'g',history:[],theme:'white_pink',avatarMode:'group-original',bubbleBlurEnabled:false}];
                currentChatId='g';currentChatType='group';
                document.getElementById('setting-custom-bubble-css').value='.private{}';
                document.getElementById('setting-group-custom-bubble-css').value='.group{color:red}';
                document.getElementById('setting-group-theme-color').innerHTML='<option value="white_blue">blue</option>';
                document.getElementById('setting-theme-color').innerHTML='<option value="white_pink">pink</option>';
                window.prompt=()=> 'Group preset';window.confirm=()=>true;
                await saveCurrentTextareaAsPreset();
                return db.bubbleCssPresets.find(p=>p.name==='Group preset');
            });
            assert.equal(result.css,'.group{color:red}');assert.equal(result.settings.theme,'white_blue');
            assert.equal(result.settings.avatarMode,'group-original');
        });

        await check('URL image selection discards stale file data', async page => {
            const stored=await page.evaluate(async()=>{
                db.addedWidgets=[{id:'custom-widget-a',templateId:'t',vars:{image:'old'}}];
                document.getElementById('widget-var-instance-id').value='custom-widget-a';
                document.getElementById('widget-var-key').value='image';document.getElementById('widget-var-type').value='image';
                document.getElementById('widget-var-file-upload').dataset.base64='data:image/png;base64,AAAA';
                const input=document.getElementById('widget-var-input');input.value='https://fixture.invalid/new.png';input.dispatchEvent(new Event('input'));
                document.getElementById('widget-var-edit-form').dispatchEvent(new Event('submit',{cancelable:true}));
                await saveData();return db.addedWidgets[0].vars.image;
            });
            assert.equal(stored,'https://fixture.invalid/new.png');
        });

        await check('call rejection invitation and deletion recover after storage failure', async page => {
            const result=await page.evaluate(async()=>{
                const chat={id:'a',realName:'A',remarkName:'A',myName:'U',history:[],callHistory:[{id:'call-a'}]};
                db.characters=[chat];currentChatId='a';currentChatType='private';
                await saveData();
                const fail=()=>{throw Error('injected failure')};dexieDB.characters.hook('updating',fail);
                VideoCallModule.state.incomingChat=chat;
                const modal=document.getElementById('vc-incoming-modal');modal.classList.add('visible');
                await VideoCallModule.rejectCall();
                const rejected={history:chat.history.length,retry:VideoCallModule.state.incomingChat===chat,visible:modal.classList.contains('visible')};
                await VideoCallModule.startCall('voice',false,chat);
                const invited={history:chat.history.length,active:VideoCallModule.state.isCallActive};
                dexieDB.characters.hook('updating').unsubscribe(fail);
                chat.history.push({id:'record',role:'system',content:'call',timestamp:1,callRecordId:'call-a'});await saveData();
                dexieDB.characters.hook('updating',fail);
                VideoCallModule.state.currentChat=chat;
                const element=document.createElement('div');document.body.append(element);
                await VideoCallModule.deleteCallRecord('call-a',element);
                return {rejected,invited,records:chat.callHistory.map(x=>x.id),history:chat.history.map(x=>x.id),attached:element.isConnected};
            });
            assert.deepEqual(result.rejected,{history:0,retry:true,visible:true});
            assert.deepEqual(result.invited,{history:0,active:false});
            assert.deepEqual(result.records,['call-a']);assert.deepEqual(result.history,['record']);assert.equal(result.attached,true);
        });

        await check('payment response failure restores pending state and allows retry', async page => {
            const result=await page.evaluate(async()=>{
                const msg={id:'pay',role:'assistant',content:'request',payStatus:'pending',timestamp:1};
                const chat={id:'a',realName:'A',remarkName:'A',myName:'U',history:[msg]};
                db.characters=[chat];currentChatId='a';currentChatType='private';await saveData();
                const fail=()=>{throw Error('injected failure')};dexieDB.characters.hook('updating',fail);
                await sendPayResponse('pay','pay');
                const failed={status:msg.payStatus,length:chat.history.length};
                dexieDB.characters.hook('updating').unsubscribe(fail);
                await Promise.all([sendPayResponse('pay','pay'),sendPayResponse('pay','pay')]);
                return {failed,status:msg.payStatus,history:chat.history.map(x=>x.content)};
            });
            assert.deepEqual(result.failed,{status:'pending',length:1});assert.equal(result.status,'paid');
            assert.deepEqual(result.history,['request','[U同意了A的代付请求]']);
        });

        await check('red packet failed claim restores allocation and amount pool', async page => {
            await page.evaluate(async()=>{
                const msg={id:'packet',role:'assistant',content:'packet',type:'red-packet',pool:[1,2],distributions:{},timestamp:1};
                db.characters=[{id:'a',realName:'A',remarkName:'A',myName:'U',history:[msg]}];
                currentChatId='a';currentChatType='private';await saveData();
                window.failedPacketWrites=0;dexieDB.characters.hook('updating',()=>{failedPacketWrites++;throw Error('injected failure')});
                const element=createMessageBubbleElement(msg);document.body.append(element);
                element.querySelector('.red-packet-card').click();
            });
            await page.waitForFunction(()=>failedPacketWrites>0 && !db.characters[0].history[0].distributions.user_me);
            const result=await page.evaluate(()=>({pool:db.characters[0].history[0].pool,dist:db.characters[0].history[0].distributions}));
            assert.deepEqual(result,{pool:[1,2],dist:{}});
        });

        await check('private chat does not execute group rename command', async page => {
            const result=await page.evaluate(async()=>{
                const chat={id:'a',realName:'A',remarkName:'A',myName:'U',history:[]};
                db.characters=[chat];currentChatId='a';currentChatType='private';await saveData();
                document.getElementById('message-input').value='[U修改群名为“Changed”]';await sendMessage();
                return {name:chat.name,history:chat.history.map(x=>x.content)};
            });
            assert.equal(result.name,undefined);assert.deepEqual(result.history,['[U的消息：[U修改群名为“Changed”]]']);
        });

        await check('CoT toggles and workshop fields restore failed local edits', async page => {
            await page.evaluate(async()=>{
                loadCotSettings();
                db.workshopSettings.boundCharacters=[{charId:'a',prompt:'ORIGINAL'}];
                db.characters=[{id:'a',realName:'A',remarkName:'A',history:[]}];
                initWorkshopCharManagement();await saveData();
                window.failedLocalWrites=0;dexieDB.globalSettings.hook('updating',()=>{failedLocalWrites++;throw Error('injected failure')});
                const input=document.querySelector('#workshop-char-list .char-prompt-input');
                input.value='UNSAVED';input.dispatchEvent(new Event('change'));
            });
            await page.waitForFunction(()=>failedLocalWrites>0 && db.workshopSettings.boundCharacters[0].prompt==='ORIGINAL');
            const result=await page.evaluate(async()=>{
                const preset=db.cotPresets.find(x=>x.id===db.cotSettings.activePresetId);
                const item=preset.items[0],before=item.enabled;
                await saveLocalSettingsFields([{target:item,values:{enabled:!before}}]);
                return {before,after:item.enabled,input:document.querySelector('#workshop-char-list .char-prompt-input').value};
            });
            assert.equal(result.after,result.before);assert.equal(result.input,'ORIGINAL');
        });

        await check('Vibe delayed upload does not enter switched library', async page => {
            await page.evaluate(()=>{
                db.workshopSettings.vibeLibrary=[];
                db.workshopSettings.vibe={enabled:false,activeImageId:null};
                initWorkshopVibe();
                File.prototype.text=()=>new Promise(resolve=>window.releaseVibe=resolve);
                const transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'a.json',{type:'application/json'}));
                const input=document.getElementById('workshop-vibe-upload-input');input.files=transfer.files;input.dispatchEvent(new Event('change'));
                window.firstLibrary=db.workshopSettings.vibeLibrary;
                db.workshopSettings={...db.workshopSettings,vibeLibrary:[],vibe:{enabled:false,activeImageId:null}};
                releaseVibe(JSON.stringify({groups:{sample:{vibes:[{vibeDataId:'v'}]}},vibeData:{v:{encodings:{'v4-5full':{entry:{encoding:'fixture'}}}}}}));
            });
            await page.waitForFunction(()=>document.getElementById('toast-notification').textContent.includes('素材库已切换') || notificationQueue.some(x=>String(x).includes('素材库已切换')));
            const result=await page.evaluate(()=>({old:firstLibrary.length,current:db.workshopSettings.vibeLibrary.length,input:document.getElementById('workshop-vibe-upload-input').value}));
            assert.deepEqual(result,{old:0,current:0,input:''});
        });

        await check('old moments failed comment restores both comment and history', async page => {
            const result=await page.evaluate(async()=>{
                const chat={id:'a',realName:'A',remarkName:'A',myName:'U',history:[],moments:[{id:'m',content:'moment',comments:[]}]};
                db.characters=[chat];currentChatId='a';currentChatType='private';await saveData();
                dexieDB.characters.hook('updating',()=>{throw Error('injected failure')});
                await addMomentComment('m','comment');
                return {history:chat.history.length,comments:chat.moments[0].comments.length};
            });
            assert.deepEqual(result,{history:0,comments:0});
        });

        await check('reader rejects stale book and comment loads', async page => {
            const result=await page.evaluate(async()=>{
                await dexieDB.reader_books.bulkPut([{id:'a',title:'A'},{id:'b',title:'B'}]);
                await dexieDB.reader_chapters.bulkPut([{id:'a0',bookId:'a',index:0,title:'A0',content:'A paragraph'},
                    {id:'b0',bookId:'b',index:0,title:'B0',content:'B paragraph'}]);
                await dexieDB.reader_comments.add({bookId:'a',chapterIndex:0,paragraphIndex:0,content:'A comment',timestamp:1});
                const get=dexieDB.reader_books.get.bind(dexieDB.reader_books);
                let releaseBook;dexieDB.reader_books.get=id=>id==='a'?new Promise(resolve=>releaseBook=()=>resolve(get(id))):get(id);
                const oldLoad=readerView.loadBook('a');await readerView.loadBook('b');releaseBook();await oldLoad;
                const title=document.getElementById('reader-book-title').textContent;
                dexieDB.reader_books.get=get;await readerView.loadBook('a');
                const where=dexieDB.reader_comments.where.bind(dexieDB.reader_comments);
                let releaseComments;
                dexieDB.reader_comments.where=key=>{
                    const clause=where(key);if(key!=='[bookId+chapterIndex+paragraphIndex]')return clause;
                    return {equals:value=>{const collection=clause.equals(value);collection.toArray=()=>new Promise(resolve=>releaseComments=()=>resolve([{content:'STALE',timestamp:1}]));return collection;}};
                };
                document.querySelector('#reader-text-content .reader-inline-comment-icon').click();
                await readerView.loadBook('b');releaseComments();await new Promise(resolve=>setTimeout(resolve,0));
                return {title,finalTitle:document.getElementById('reader-book-title').textContent,
                    open:document.getElementById('reader-comment-overlay').classList.contains('active'),
                    stale:document.getElementById('reader-comment-list').textContent.includes('STALE')};
            });
            assert.deepEqual(result,{title:'B',finalTitle:'B',open:false,stale:false});
        });

        await check('workshop drag cannot overwrite a newly selected group', async page => {
            await page.evaluate(()=>{
                db.workshopSettings.gptLlmPresetGroups=[{id:'a',name:'A',prompts:[{id:'a1',title:'A1',role:'system',content:'A',enabled:true}]},
                    {id:'b',name:'B',prompts:[{id:'b1',title:'B1',role:'system',content:'B',enabled:true}]}];
                db.workshopSettings.activeGptLlmPresetGroupId='a';initWorkshopGPTLLMPrompts();
                document.querySelector('#workshop-gpt-llm-prompt-list .drag-handle').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientY:100}));
            });
            await page.waitForTimeout(350);
            await page.evaluate(async()=>{
                const select=document.getElementById('workshop-gpt-llm-preset-group-select');select.value='b';select.dispatchEvent(new Event('change'));
                await saveData();document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
            });
            const result=await page.evaluate(()=>db.workshopSettings.gptLlmPresetGroups.map(g=>g.prompts.map(p=>p.id)));
            assert.deepEqual(result,[['a1'],['b1']]);
        });

        await check('unread persistence failure restores count without unhandled rejection', async page => {
            await page.evaluate(async()=>{
                db.characters=[{id:'a',realName:'A',remarkName:'A',myName:'U',history:[],unreadCount:2},
                    {id:'b',realName:'B',remarkName:'B',myName:'U',history:[]}];
                currentChatId='b';currentChatType='private';await saveData();
                window.unreadFailures=0;window.unhandled=[];window.addEventListener('unhandledrejection',e=>unhandled.push(String(e.reason)));
                dexieDB.characters.hook('updating',()=>{unreadFailures++;throw Error('injected failure')});
                addMessageBubble({id:'incoming',role:'assistant',content:'[A的消息：hello]',timestamp:1},'a','private');
            });
            await page.waitForFunction(()=>unreadFailures>0 && db.characters[0].unreadCount===2);
            assert.deepEqual(await page.evaluate(()=>unhandled),[]);
        });

        await check('checkout retains enabled time perception message', async page => {
            await page.evaluate(async()=>{
                db.characters=[{id:'a',realName:'A',remarkName:'A',myName:'U',history:[],lastUserMessageTimestamp:Date.now()-3600000,
                    peekData:{cart:{items:[{title:'item',price:'1'}]}}}];
                currentChatId='a';currentChatType='private';db.apiSettings.timePerceptionEnabled=true;await saveData();
                renderPeekCart(db.characters[0].peekData.cart.items);document.querySelector('#peek-cart-screen .checkout-btn').click();
            });
            await page.waitForFunction(()=>!document.querySelector('#peek-cart-screen .checkout-btn').disabled);
            const history=await page.evaluate(()=>db.characters[0].history.map(x=>x.content));
            assert.equal(history.length,3);assert.match(history[0],/^\[system-display:距离上次聊天已经过去 /);
            assert.equal(history[1],'[system-display:U帮A清空了ta的购物车]');
        });

        await check('failed group migration restores old sessions and unread count', async page => {
            await page.evaluate(async()=>{
                const group={id:'g',name:'G',history:[],members:[],me:{nickname:'U'},unreadCount:2,
                    privateSessions:{s:{memberNames:['A','B'],history:[{id:'old',sender:'A',content:'hello',timestamp:1}]}}};
                db.groups=[group];await saveData();
                window.migrationFailures=0;dexieDB.groups.hook('updating',()=>{migrationFailures++;throw Error('injected failure')});
                openChatRoom('g','group');
            });
            await page.waitForFunction(()=>migrationFailures>0 && !!db.groups[0].privateSessions);
            const result=await page.evaluate(()=>({unread:db.groups[0].unreadCount,history:db.groups[0].history.length,content:db.groups[0].privateSessions.s.history[0].content}));
            assert.deepEqual(result,{unread:2,history:0,content:'hello'});
        });

        await check('Vibe storage failure removes only the new import', async page => {
            await page.evaluate(async()=>{
                db.workshopSettings.vibeLibrary=[{id:'existing',type:'single',name:'Existing',base64:''}];
                db.workshopSettings.vibe={enabled:false,activeImageId:null};initWorkshopVibe();await saveData();
                window.vibeFailures=0;dexieDB.globalSettings.hook('updating',()=>{vibeFailures++;throw Error('injected failure')});
                const data={groups:{sample:{vibes:[{vibeDataId:'v'}]}},vibeData:{v:{encodings:{'v4-5full':{entry:{encoding:'fixture'}}}}}};
                const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(data)],'a.json',{type:'application/json'}));
                const input=document.getElementById('workshop-vibe-upload-input');input.files=transfer.files;input.dispatchEvent(new Event('change'));
            });
            await page.waitForFunction(()=>vibeFailures>0 && db.workshopSettings.vibeLibrary.length===1);
            assert.deepEqual(await page.evaluate(()=>db.workshopSettings.vibeLibrary.map(x=>x.id)),['existing']);
        });

        await check('reading progress for each book survives rapid book switch', async page => {
            await page.evaluate(async()=>{
                await dexieDB.reader_books.bulkPut([{id:'a',title:'A',currentChapterIndex:0},{id:'b',title:'B',currentChapterIndex:0}]);
                await dexieDB.reader_chapters.bulkPut([{id:'a0',bookId:'a',index:0,title:'A0',content:'A0'},
                    {id:'a1',bookId:'a',index:1,title:'A1',content:'A1'},{id:'b0',bookId:'b',index:0,title:'B0',content:'B0'}]);
                switchScreen('reader-view-screen');await readerView.loadBook('a');
                document.querySelector('#reader-toc-list [data-index="1"]').click();
            });
            await page.waitForTimeout(100);
            await page.evaluate(()=>readerView.loadBook('b'));
            await page.waitForTimeout(650);
            const result=await page.evaluate(async()=>({a:(await dexieDB.reader_books.get('a')).currentChapterIndex,b:(await dexieDB.reader_books.get('b')).currentChapterIndex}));
            assert.deepEqual(result,{a:1,b:0});
        });

        await check('CoT main switches visibly recover from save failure', async page => {
            await page.evaluate(async()=>{
                loadCotSettings();currentCotMode='chat';db.cotSettings.enabled=false;loadCotSettings();await saveData();
                window.cotSwitchFailures=0;dexieDB.globalSettings.hook('updating',()=>{cotSwitchFailures++;throw Error('injected failure')});
                const input=document.getElementById('cot-enabled-switch');input.checked=true;input.dispatchEvent(new Event('change'));
            });
            await page.waitForFunction(()=>cotSwitchFailures>0 && !db.cotSettings.enabled);
            assert.equal(await page.evaluate(()=>document.getElementById('cot-enabled-switch').checked),false);
        });

        await check('peek counts recover after save failure', async page => {
            await page.evaluate(async()=>{
                db.characters=[{id:'a',realName:'A',remarkName:'A',myName:'U',history:[],peekScreenSettings:{generationCounts:{cart:4}}}];
                currentChatId='a';currentChatType='private';renderPeekSettings();await saveData();
                window.peekSettingsFailures=0;dexieDB.characters.hook('updating',()=>{peekSettingsFailures++;throw Error('injected failure')});
                document.querySelector('.peek-settings-item-control input[data-app-id="cart"]').value='8';
                document.getElementById('save-peek-settings-btn').click();
            });
            await page.waitForFunction(()=>peekSettingsFailures>0 && db.characters[0].peekScreenSettings.generationCounts.cart===4);
            const stored=await page.evaluate(async()=>(await dexieDB.characters.get('a')).peekScreenSettings.generationCounts.cart);
            assert.equal(stored,4);
        });

        await check('peek generation cannot write into a switched archive', async page => {
            const result=await page.evaluate(async()=>{
                const chat={id:'a',realName:'A',remarkName:'A',myName:'U',history:[],peekData:{cart:{items:[{title:'OLD',price:'1'}]}}};
                db.characters=[chat];currentChatId='a';currentChatType='private';await saveData();
                const first=chat.activeArchiveId;
                const alternate={id:'alternate',data:{myName:'U',history:[],peekData:{cart:{items:[{title:'ALTERNATE',price:'1'}]}}}};
                chat.archives.push(alternate);
                resolveAuxiliaryApiConfig=()=>({url:'https://fixture.invalid',key:'fixture',model:'fixture',provider:'newapi'});
                let release;fetchAiResponse=()=>new Promise(resolve=>release=resolve);
                const task=generateAndRenderPeekContent('cart',{forceRefresh:true});
                applyArchiveData(chat,alternate);
                release('<result><cart><item><title>GENERATED</title><price>1</price></item></cart></result>');await task;
                return {active:chat.peekData.cart.items[0].title,original:chat.archives.find(a=>a.id===first).data.peekData.cart.items[0].title};
            });
            assert.deepEqual(result,{active:'ALTERNATE',original:'OLD'});
        });
    } finally { await app.close(); }
    if (failed) process.exitCode=1;
})().catch(error => {console.error(error);process.exitCode=1;});
