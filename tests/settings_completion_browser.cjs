const assert = require('node:assert/strict');
const {fullApp} = require('./helpers/full_app_browser.cjs');

(async () => {
    const app = await fullApp();
    let failed = 0;
    async function check(name, run) {
        if (process.argv[2] && !name.includes(process.argv[2])) return;
        const fixture = await app.page();
        try {
            await fixture.page.evaluate(async () => {
                await migrateCotSettings();
                await saveData();
                window.failSettingsSave = async run => {
                    const fail = () => { throw Error('injected local storage failure'); };
                    dexieDB.globalSettings.hook('updating', fail);
                    try { await run(); await saveData().catch(() => {}); }
                    finally { dexieDB.globalSettings.hook('updating').unsubscribe(fail); }
                };
                window.confirm = () => true;
                window.prompt = () => 'Fixture preset';
            });
            await run(fixture.page);
            assert.deepEqual(fixture.errors, [], 'no uncaught browser errors');
            console.log('PASS ' + name);
        } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
        finally { await fixture.context.close(); }
    }
    try {
        await check('CoT failed item operations restore content and order', async page => {
            const results = await page.evaluate(async () => {
                db.cotPresets = [{id:'fixture',name:'Fixture',items:[
                    {id:'a',name:'A',content:'  ORIGINAL\n',enabled:true},
                    {id:'b',name:'B',content:'B',enabled:true}]}];
                db.cotSettings.activePresetId='fixture';currentCotMode='chat';
                await saveData(); renderCotSettingsControls();
                const results=[];
                const probe=async run=>{
                    const before=JSON.stringify({presets:db.cotPresets,settings:db.cotSettings});
                    await failSettingsSave(run);
                    results.push({before,after:JSON.stringify({presets:db.cotPresets,settings:db.cotSettings})});
                };
                await probe(()=>moveCotItem(0,1));
                await probe(()=>deleteCotItem(0));
                await probe(async()=>{
                    openEditCotItemModal(db.cotPresets[0].items[0]);
                    document.getElementById('cot-item-content').value='UNSAVED';
                    await saveCotItem({preventDefault(){}});
                });
                await probe(async()=>{
                    openAddCotItemModal();document.getElementById('cot-item-name').value='New';
                    await saveCotItem({preventDefault(){}});
                });
                await probe(()=>resetCotPreset());
                await probe(()=>createNewCotPreset());
                return results;
            });
            assert.equal(results.length,6);
            for (const result of results) assert.equal(result.after,result.before);
        });

        await check('CoT edit remains with its original preset after switching mode', async page => {
            const result=await page.evaluate(async()=>{
                currentCotMode='chat';
                const preset=db.cotPresets.find(p=>p.id===db.cotSettings.activePresetId),item=preset.items[0];
                const call=db.cotPresets.find(p=>p.id===db.cotSettings.activeCallPresetId),before=JSON.stringify(call);
                openEditCotItemModal(item);
                document.getElementById('cot-item-content').value='  EXACT CONTENT\n';
                currentCotMode='call';
                await saveCotItem({preventDefault(){}});
                const disk=(await dexieDB.globalSettings.get('cotPresets')).value;
                return {content:item.content,before,after:JSON.stringify(call),diskContent:disk.find(p=>p.id===preset.id).items[0].content};
            });
            assert.equal(result.content,'  EXACT CONTENT\n');assert.equal(result.after,result.before);
            assert.equal(result.diskContent,result.content);
        });

        await check('CoT version and preset selectors recover failed writes', async page => {
            const result=await page.evaluate(async()=>{
                const before=JSON.stringify(db.cotSettings);renderCotSettingsControls();
                await failSettingsSave(async()=>{
                    const select=document.getElementById('cot-prompt-version-select');select.value='tt';select.dispatchEvent(new Event('change'));
                });
                const version=JSON.stringify(db.cotSettings);
                await failSettingsSave(async()=>{
                    const select=document.getElementById('cot-preset-select');select.value='default_tt';select.dispatchEvent(new Event('change'));
                });
                return {before,version,after:JSON.stringify(db.cotSettings),selected:document.getElementById('cot-preset-select').value};
            });
            assert.equal(result.version,result.before);assert.equal(result.after,result.before);
            assert.equal(result.selected,JSON.parse(result.before).activePresetId);
        });

        await check('CoT legacy migration failure restores old IDs and locked flags', async page => {
            const result=await page.evaluate(async()=>{
                db.cotSettings={enabled:false,promptVersion:'uwu',activePresetId:'default'};
                db.cotPresets=[{id:'default',name:'Old',items:[{id:'cot_item_1',name:'Original',content:'ORIGINAL',locked:true}]}];
                await saveData();
                const before=JSON.stringify({settings:db.cotSettings,presets:db.cotPresets});
                await failSettingsSave(()=>migrateCotSettings());
                return {before,after:JSON.stringify({settings:db.cotSettings,presets:db.cotPresets})};
            });
            assert.equal(result.after,result.before);
        });

        await check('CoT duplicate form submissions create one item',async page=>{
            const count=await page.evaluate(async()=>{
                currentCotMode='chat';openAddCotItemModal();
                document.getElementById('cot-item-name').value='Double';
                await Promise.all([saveCotItem({preventDefault(){}}),saveCotItem({preventDefault(){}})]);
                return getCotPresetTarget().preset.items.filter(item=>item.name==='Double').length;
            });
            assert.equal(count,1);
        });

        await check('CoT drag cannot change the newly selected preset',async page=>{
            await page.evaluate(()=>{
                db.cotPresets=[{id:'a',name:'A',items:[{id:'a1',name:'A1',content:'A',enabled:true},{id:'a2',name:'A2',content:'A2',enabled:true}]},
                    {id:'b',name:'B',items:[{id:'b1',name:'B1',content:'B',enabled:true}]}];
                db.cotSettings.activePresetId='a';currentCotMode='chat';renderCotSettingsControls();switchScreen('cot-settings-screen');
                document.querySelector('#cot-items-list .cot-item-content').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:100,clientY:300}));
            });
            await page.waitForFunction(()=>document.querySelector('.cot-item-card.dragging'));
            const result=await page.evaluate(()=>{
                db.cotSettings.activePresetId='b';renderCotSettingsControls();
                document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
                return {ids:db.cotPresets.map(p=>p.items.map(i=>i.id)),clones:document.querySelectorAll('.cot-item-card.dragging').length};
            });
            assert.deepEqual(result.ids,[['a1','a2'],['b1']]);assert.equal(result.clones,0);
        });

        await check('workshop initialization failure restores API structures',async page=>{
            const result=await page.evaluate(async()=>{
                delete db.workshopSettings.apiPresets;delete db.workshopSettings.activeApiPresetId;await saveData();
                const before=JSON.stringify(db.workshopSettings);
                await failSettingsSave(()=>initWorkshopSettings());
                return {before,after:JSON.stringify(db.workshopSettings)};
            });
            assert.equal(result.after,result.before);
        });

        await check('workshop failed default group initialization removes its drafts',async page=>{
            const result=await page.evaluate(async()=>{
                for(const key of ['gptLlmPresetGroups','llmPresetGroups','activeGptLlmPresetGroupId','activeLlmPresetGroupId']) delete db.workshopSettings[key];
                await saveData();const before=JSON.stringify(db.workshopSettings);
                await failSettingsSave(async()=>{initWorkshopGPTLLMPrompts();initWorkshopLLMPrompts();});
                return {before,after:JSON.stringify(db.workshopSettings)};
            });
            assert.equal(result.after,result.before);
        });

        for (const mode of ['gpt','normal']) {
            await check(`${mode} workshop group operations recover failed writes`, async page => {
                const results=await page.evaluate(async mode=>{
                    const gpt=mode==='gpt', prefix=gpt?'workshop-gpt-':'workshop-';
                    const groupsKey=gpt?'gptLlmPresetGroups':'llmPresetGroups',activeKey=gpt?'activeGptLlmPresetGroupId':'activeLlmPresetGroupId';
                    const settings=db.workshopSettings;
                    settings[groupsKey]=['a','b'].map(id=>({id,name:id,prompts:[{id:id+'1',role:'user',title:'Original',content:'ORIGINAL',enabled:true}]}));
                    settings[activeKey]='a';
                    (gpt?initWorkshopGPTLLMPrompts:initWorkshopLLMPrompts)();await saveData();
                    const results=[];
                    for(const action of ['select','add','rename','delete','reset','item']) {
                        const before=JSON.stringify({groups:settings[groupsKey],active:settings[activeKey]});
                        await failSettingsSave(async()=>{
                            if(action==='select') {
                                const select=document.getElementById(prefix+'llm-preset-group-select');select.value='b';select.dispatchEvent(new Event('change'));
                            } else {
                                const suffix=action==='item'?'add-llm-prompt-btn':action+'-llm-preset-group-btn';
                                document.getElementById(prefix+suffix).click();
                            }
                        });
                        results.push({action,before,after:JSON.stringify({groups:settings[groupsKey],active:settings[activeKey]})});
                    }
                    return results;
                },mode);
                for(const result of results) assert.equal(result.after,result.before,result.action);
            });

            await check(`${mode} delayed workshop import preserves switched selection`, async page => {
                await page.evaluate(mode=>{
                    const gpt=mode==='gpt',prefix=gpt?'workshop-gpt-':'workshop-';
                    const settings=db.workshopSettings,groupsKey=gpt?'gptLlmPresetGroups':'llmPresetGroups',activeKey=gpt?'activeGptLlmPresetGroupId':'activeLlmPresetGroupId';
                    settings[groupsKey]=['a','b'].map(id=>({id,name:id,prompts:[]}));settings[activeKey]='a';
                    (gpt?initWorkshopGPTLLMPrompts:initWorkshopLLMPrompts)();
                    FileReader.prototype.readAsText=function(){window.releaseGroup=()=>this.onload({target:{result:JSON.stringify({name:'Imported',prompts:[{role:'user',title:'T',content:'EXACT',enabled:true}]})}});};
                    const input=document.getElementById(prefix+'import-llm-preset-group-input'),transfer=new DataTransfer();
                    transfer.items.add(new File(['fixture'],'fixture.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change'));
                    settings[activeKey]='b';releaseGroup();
                },mode);
                await page.waitForFunction(mode=>(mode==='gpt'?db.workshopSettings.gptLlmPresetGroups:db.workshopSettings.llmPresetGroups).length===3,mode);
                const result=await page.evaluate(async mode=>{await saveData();return mode==='gpt'?db.workshopSettings.activeGptLlmPresetGroupId:db.workshopSettings.activeLlmPresetGroupId;},mode);
                assert.equal(result,'b');
            });
        }

        await check('workshop API presets and matching legacy fields recover together', async page => {
            const results=await page.evaluate(async()=>{
                await initWorkshopSettings();await saveData();const settings=db.workshopSettings;
                const results=[];
                const probe=async run=>{
                    const before=JSON.stringify(settings);await failSettingsSave(run);results.push({before,after:JSON.stringify(settings)});
                };
                await probe(async()=>{
                    const input=document.getElementById('workshop-api-url');input.value='https://fixture.invalid/unsaved';await input.oninput();
                });
                await probe(()=>document.getElementById('workshop-new-api-preset-btn').onclick());
                await probe(()=>document.getElementById('workshop-save-api-preset-btn').onclick());
                await probe(async()=>{const input=document.getElementById('workshop-api-protocol');input.value='custom';await input.onchange({target:input});});
                await probe(async()=>{const input=document.getElementById('workshop-response-format');input.value='json';await input.onchange({target:input});});
                await probe(async()=>{const input=document.getElementById('workshop-custom-model');input.value='unsaved';await input.oninput({target:input});});
                return results;
            });
            for(const result of results) assert.equal(result.after,result.before);
        });

        await check('workshop failed API deletion and selection retain original preset', async page => {
            const result=await page.evaluate(async()=>{
                const settings=db.workshopSettings;
                settings.apiPresets.novelai.push({id:'fixture',name:'Fixture',url:'https://fixture.invalid',key:'',protocol:'novelai',responseFormat:'auto'});
                settings.activeApiPresetId.novelai='fixture';updateApiPresetList();await saveData();
                const before=JSON.stringify(settings.apiPresets);
                await failSettingsSave(()=>document.getElementById('workshop-delete-api-preset-btn').onclick());
                const activeAfterDelete=settings.activeApiPresetId.novelai;
                await failSettingsSave(async()=>{
                    const select=document.getElementById('workshop-api-preset-select');select.value='official';await select.onchange({target:select});
                });
                return {before,after:JSON.stringify(settings.apiPresets),activeAfterDelete,active:settings.activeApiPresetId.novelai,
                    selected:document.getElementById('workshop-api-preset-select').value};
            });
            assert.equal(result.before,result.after);assert.equal(result.activeAfterDelete,'fixture');
            assert.equal(result.active,'fixture');assert.equal(result.selected,'fixture');
        });

        for(const mode of ['gpt','normal']) {
            await check(`${mode} invalid and failed workshop imports leave no draft`,async page=>{
                const result=await page.evaluate(async mode=>{
                    const gpt=mode==='gpt',prefix=gpt?'workshop-gpt-':'workshop-';
                    const settings=db.workshopSettings,groupKey=gpt?'gptLlmPresetGroups':'llmPresetGroups',activeKey=gpt?'activeGptLlmPresetGroupId':'activeLlmPresetGroupId';
                    settings[groupKey]=[{id:'a',name:'A',prompts:[]}];settings[activeKey]='a';
                    (gpt?initWorkshopGPTLLMPrompts:initWorkshopLLMPrompts)();await saveData();
                    const before=JSON.stringify({groups:settings[groupKey],active:settings[activeKey]});
                    const input=document.getElementById(prefix+'import-llm-preset-group-input');
                    const upload=async data=>{
                        FileReader.prototype.readAsText=function(){window.finishImport=this.onload({target:{result:JSON.stringify(data)}});};
                        const transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'fixture.json',{type:'application/json'}));
                        input.files=transfer.files;input.dispatchEvent(new Event('change'));await finishImport;
                    };
                    await upload({name:'Invalid',prompts:[{title:'Missing content',role:'user'}]});
                    await failSettingsSave(()=>upload({name:'Valid',prompts:[{title:'Title',content:'EXACT',role:'user',enabled:true}]}));
                    return {before,after:JSON.stringify({groups:settings[groupKey],active:settings[activeKey]}),input:input.value};
                },mode);
                assert.equal(result.after,result.before);assert.equal(result.input,'');
            });
        }

        for(const scenario of ['failed save','switched archive','latest selection']) {
            await check(`moments cover upload handles ${scenario}`,async page=>{
                const result=await page.evaluate(async scenario=>{
                    const char={id:'fixture',realName:'C',myName:'U',history:[],moments:[],activeArchiveId:'a',peekScreenSettings:{momentsCover:'original'}};
                    db.characters=[char];currentChatId=char.id;currentChatType='private';await saveData();
                    const releases=[];
                    compressImage=()=>new Promise(resolve=>releases.push(resolve));
                    HTMLInputElement.prototype.click=function(){window.coverInput=this;};
                    document.getElementById('moments-cover-img').click();
                    const upload=()=>{
                        const transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'cover.png',{type:'image/png'}));
                        coverInput.files=transfer.files;coverInput.dispatchEvent(new Event('change'));
                    };
                    upload();
                    const fail=()=>{throw Error('injected character storage failure')};
                    if(scenario==='failed save') dexieDB.characters.hook('updating',fail);
                    if(scenario==='switched archive') {char.activeArchiveId='b';char.history=[];}
                    if(scenario==='latest selection') {upload();releases[1]('newest');await Promise.resolve();await saveData();}
                    releases[0]('stale');await Promise.resolve();await saveData().catch(()=>{});
                    if(scenario==='failed save') dexieDB.characters.hook('updating').unsubscribe(fail);
                    return {cover:char.peekScreenSettings.momentsCover,input:coverInput.value};
                },scenario);
                assert.equal(result.cover,scenario==='latest selection'?'newest':'original');assert.equal(result.input,'');
            });
        }

        await check('failed old moments signature restores original data and messages', async page => {
            const result=await page.evaluate(async()=>{
                const char={id:'fixture',realName:'C',myName:'U',history:[],momentsSignature:'ORIGINAL',peekData:{memos:['KEEP']}};
                db.characters=[char];currentChatId=char.id;currentChatType='private';await saveData();
                const before=JSON.stringify({history:char.history,signature:char.momentsSignature,peek:char.peekData});
                const fail=()=>{throw Error('injected character storage failure')};dexieDB.characters.hook('updating',fail);
                try {
                    await updateMomentsSignature('UNSAVED');
                } finally {dexieDB.characters.hook('updating').unsubscribe(fail);}
                return {before,after:JSON.stringify({history:char.history,signature:char.momentsSignature,peek:char.peekData})};
            });
            assert.equal(result.after,result.before);
        });
    } finally { await app.close(); }
    process.exitCode=failed?1:0;
})();
