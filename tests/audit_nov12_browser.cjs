const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fullApp,root}=require('./helpers/full_app_browser.cjs');
const out=path.resolve(root,'../../outputs/nov12-repairs');fs.mkdirSync(out,{recursive:true});
(async()=>{
    const app=await fullApp(),results=[];
    const check=async(name,fn)=>{try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}console.log(JSON.stringify(results.at(-1)));};
    try{
        const {page,errors}=await app.page({timezoneId:'Asia/Shanghai'});
        await page.evaluate(async()=>{
            const c={id:'audit',realName:'Audit',myName:'User',myPersona:'',persona:'',activeArchiveId:'main',history:[],memoryJournals:[{id:'j',title:'Travel',content:'Tea travel',category:'Travel',createdAt:Date.parse('2026-11-11T12:00Z'),isFavorited:true}],worldBookIds:[],maxMemory:20};db.characters=[c];
            c.characterMemos={settings:{enabled:true,useContext:true},notes:[]};
            const a=await addManualCharacterMemo(c,{fact:'Tea preference',category:'习惯'}),b=await addManualCharacterMemo(c,{fact:'Tea local',category:'偏好'});
            a.createdAt=a.recordedAt=Date.parse('2026-11-12T00:30:00+08:00');b.localOnly=true;
            await saveData();openChatRoom(c.id,'private');openMemoryLibrary();
        });
        await page.locator('.memory-library').waitFor();
        const select=async(key,value)=>page.evaluate(({key,value})=>{const el=key==='category'?document.querySelector('.memory-library-filter'):key==='source'?[...document.querySelectorAll('.memory-library select')].find(e=>[...e.options].some(o=>o.value==='sillytavern')):document.querySelector('.memory-library select[aria-label="索引状态"]');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},{key,value});
        const input=async(label,value)=>page.evaluate(({label,value})=>{const el=label==='search'?document.querySelector('.memory-library input[type=search]'):[...document.querySelectorAll('.memory-library-filters label')].find(e=>e.textContent.includes(label)).querySelector('input');el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},{label,value});
        await check('B05 all-source memo search respects dates, categories and status',async()=>{
            await input('search','Tea');await page.waitForTimeout(200);await input('开始日期','2027-01-01');assert.doesNotMatch(await page.locator('.memory-library-list').innerText(),/Tea preference|Tea local/);
            await input('开始日期','');await select('category','Travel');assert.doesNotMatch(await page.locator('.memory-library-list').innerText(),/Tea preference|Tea local/);
            await select('category','');await select('status','review');assert.doesNotMatch(await page.locator('.memory-library-list').innerText(),/Tea preference|Tea local/);
        });
        await check('B06 memo statuses do not confuse local-only with vector problems',async()=>{
            await select('status','');await select('source','character-memo');
            const options=await page.locator('.memory-library select[aria-label="索引状态"]').evaluate(e=>[...e.options].map(o=>o.value));
            assert.ok(!options.includes('dimension')&&!options.includes('missing'));
            await select('status','local-only');assert.match(await page.locator('.memory-library-list').innerText(),/Tea local/);assert.doesNotMatch(await page.locator('.memory-library-list').innerText(),/Tea preference/);
            await select('status','valid');assert.match(await page.locator('.memory-library-list').innerText(),/Tea preference/);assert.doesNotMatch(await page.locator('.memory-library-list').innerText(),/Tea local/);
        });
        await check('B07 source switch resets invalid category before querying',async()=>{
            await select('status','');await select('source','manual');await select('category','Travel');await select('source','character-memo');
            assert.equal(await page.locator('.memory-library-filter').inputValue(),'');assert.match(await page.locator('.memory-library-list').innerText(),/Tea preference/);
        });
        await check('B08 local midnight records agree with local date filters',async()=>{
            await select('status','');await select('category','');await input('开始日期','2026-11-12');await input('结束日期','2026-11-12');assert.match(await page.locator('.memory-library-list').innerText(),/Tea preference/);
            assert.equal(await page.evaluate(()=>queryMemoryLibrary([{id:'midnight',createdAt:Date.parse('2026-11-12T00:30:00+08:00')}],{from:'2026-11-12',to:'2026-11-12'}).total),1);
            assert.equal(await page.evaluate(()=>queryMemoryLibrary([{id:'story',timeline:'2020-01-01',createdAt:Date.parse('2026-11-12T00:30:00+08:00')}],{from:'2020-01-01',to:'2020-01-01'}).total),1,'explicit story dates remain independent');
        });
        await page.evaluate(()=>{document.querySelector('.memory-library [data-action=close]').click();openEnvironmentCalendar();});
        await page.locator('.uvu-calendar').getByRole('tab',{name:'记录',exact:true}).tap();
        await check('B04 mood date cells contain faces and labels at all tested widths',async()=>{
            for(const [width,height]of [[320,740],[390,844],[768,844],[640,420]]){
                await page.setViewportSize({width,height});
                const bad=await page.locator('.uvu-calendar .calendar-day').evaluateAll(cells=>cells.filter(el=>{const box=el.getBoundingClientRect();return [...el.children].some(c=>{const r=c.getBoundingClientRect();return getComputedStyle(c).display!=='none'&&(r.bottom>box.bottom+1||r.top<box.top-1);});}).map(e=>e.dataset.date));
                assert.deepEqual(bad,[],'overflow at '+width);assert.notEqual(await page.locator('.uvu-calendar .calendar-day.is-selected .calendar-day-number').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','selected mood date stays readable');assert.equal(await page.locator('.uvu-calendar .calendar-month').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
                await page.screenshot({path:path.join(out,'calendar-'+width+'.png')});
            }
        });
        await check('environment location shortcut survives layout reparenting and persists only global settings',async()=>{
            await page.evaluate(()=>document.getElementById('environment-calendar').dismissForward());
            await page.context().grantPermissions(['geolocation']);await page.context().setGeolocation({latitude:31.23,longitude:121.47});
            await page.route('https://api.bigdatacloud.net/**',r=>r.fulfill({json:{city:'上海',countryCode:'CN',timezone:'Asia/Shanghai'}}));
            await page.route('https://api.open-meteo.com/**',r=>r.fulfill({json:{current:{temperature_2m:21,weather_code:2}}}));
            await page.evaluate(()=>{currentChatId='audit';currentChatType='private';openEnvironmentSettings(true)});
            await page.locator('[data-locate]').tap();await page.waitForFunction(()=>db.environmentSettings?.userLocation?.name==='上海');
            await page.waitForFunction(()=>document.querySelector('#environment-settings .derived-status').textContent.includes('无需再点保存'));
            assert.match(await page.locator('#environment-settings [data-current=user]').textContent(),/上海/);
            assert.equal(await page.evaluate(()=>db.characters[0].environmentProfile?.aiEnabled===true),false);
            await page.locator('#environment-settings .sheet-close').click();await page.evaluate(()=>openEnvironmentCalendar());
        });
        await check('B01 existing corrupt memo opens read-only with isolation notice',async()=>{
            await page.evaluate(()=>{document.getElementById('environment-calendar').dismissForward();db.characters[0].characterMemos.notes.push(null);openCharacterMemos(db.characters[0]);});
            await page.locator('#character-memos-dialog').waitFor();assert.match(await page.locator('#character-memos-dialog').innerText(),/异常|隔离/);
        });
        const ny=await app.page({timezoneId:'America/New_York'});
        await check('B09 memo editor preserves target-season local time on unchanged save',async()=>{
            await ny.page.evaluate(async()=>{
                const c={id:'ny',realName:'NY',myName:'User',history:[],memoryJournals:[],activeArchiveId:'a'};db.characters=[c];
                const n=await addManualCharacterMemo(c,{fact:'Tea habit',expiresAt:Date.parse('2027-07-15T12:00:00Z'),validFrom:Date.parse('2026-07-15T12:00:00Z'),validTo:Date.parse('2027-07-15T12:00:00Z')});
                window.beforeTimes=[n.expiresAt,n.validFrom,n.validTo];openCharacterMemos(c);
            });
            const card=ny.page.locator('.memo-card').first();await card.locator('summary[aria-label="更多操作"]').click();await card.getByRole('button',{name:'编辑',exact:true}).click();
            const editor=ny.page.locator('#character-memo-editor');assert.equal(await editor.getByLabel('到期时间',{exact:true}).inputValue(),'2027-07-15T08:00');
            await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'hidden'});
            assert.deepEqual(await ny.page.evaluate(()=>{const n=db.characters[0].characterMemos.notes[0];return[n.expiresAt,n.validFrom,n.validTo]}),await ny.page.evaluate(()=>beforeTimes));
        });
        await check('full pages have no uncaught errors',async()=>assert.deepEqual([...errors,...ny.errors],[]));
    }finally{await app.close();fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));}
    assert.ok(results.every(r=>r.passed),results.filter(r=>!r.passed).map(r=>r.name+': '+r.error).join('\n'));
})().catch(error=>{console.error(error);process.exitCode=1;});
