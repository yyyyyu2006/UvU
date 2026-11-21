// Isolated full app; no personal data, real API calls or remote CDN availability assumed.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {fullApp, root} = require('./helpers/full_app_browser.cjs');
const out = path.join(root, 'outputs/status-resource-20261121');
fs.mkdirSync(out, {recursive:true});
(async () => {
    const app = await fullApp(), checks = [];
    try {
        const {page, errors} = await app.page();
        const workerURL = '**/js/workers/status_regex_worker.js*';
        await page.route(workerURL, async route => {
            await new Promise(resolve => setTimeout(resolve, 600));
            await route.continue();
        });
        const slow = await page.evaluate(async () => {
            const job = {source:'<status>(.*?)</status>',flags:'s',text:'hello<status>ready</status>'};
            const started = performance.now(); await prepareStatusRegexJobs([job]);
            return {match:createStatusRegex(job.source,job.flags).exec(job.text)?.[1],elapsed:performance.now()-started};
        });
        assert.equal(slow.match, 'ready'); assert.ok(slow.elapsed >= 500);
        checks.push('后台脚本延迟600ms仍成功捕获状态，启动时间不占执行预算');
        await page.unroute(workerURL);
        await page.route(workerURL, route => route.fulfill({status:404,body:''}));
        const failed = await page.evaluate(async () => {
            const job = {source:'<status>(.*?)</status>',flags:'s',text:'hello<status>recovered</status>'};
            await prepareStatusRegexJobs([job]);
            return job.text.replace(createStatusRegex(job.source,job.flags),'');
        });
        assert.equal(failed, 'hello<status>recovered</status>');
        await page.unroute(workerURL);
        const recovered = await page.evaluate(async () => {
            const job = {source:'<status>(.*?)</status>',flags:'s',text:'hello<status>recovered</status>'};
            await prepareStatusRegexJobs([job]);
            return createStatusRegex(job.source,job.flags).exec(job.text)?.[1];
        });
        assert.equal(recovered, 'recovered');
        checks.push('真实Worker脚本404保留原文，恢复脚本后同一内容可以重试成功');
        const timeout = await page.evaluate(async () => {
            const text='a'.repeat(30000)+'!', start=performance.now(); let responsive=false;
            const tick=setTimeout(()=>responsive=true,10);
            await prepareStatusRegexJobs([{source:'(a+)+$',flags:'',text}]); clearTimeout(tick);
            return {responsive,elapsed:performance.now()-start,preserved:text.replace(createStatusRegex('(a+)+$'),'')===text};
        });
        assert.ok(timeout.responsive && timeout.preserved && timeout.elapsed < 3500);
        checks.push('灾难性回溯仍被终止，页面能响应且原文不丢失');
        const cancelled = await page.evaluate(async () => {
            const abort=new AbortController(); const task=prepareStatusRegexJobs([{source:'(b+)+$',flags:'',text:'b'.repeat(30000)+'!'}],abort.signal);
            abort.abort(); try { await task; return false; } catch(error) { return error.name==='AbortError'; }
        });
        assert.equal(cancelled,true); checks.push('取消请求仍中断后台任务');

        const echarts='https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
        await page.route(echarts, route => route.abort());
        await page.reload({waitUntil:'load'});
        const warning=page.locator('#uvu-dependency-warning');
        await warning.waitFor();
        assert.match(await warning.innerText(),/ECharts（图表）/);
        assert.doesNotMatch(await warning.innerText(),/Dexie/);
        await warning.locator('summary').click();
        assert.ok((await warning.innerText()).includes(echarts));
        const bounds=await warning.boundingBox(); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=391);
        await page.screenshot({path:path.join(out,'dependency-390.png')});
        checks.push('实际阻断ECharts时提示具体库、用途和失败地址，390px界面不越界');
        await page.evaluate(() => new Promise(resolve => {
            const script=document.createElement('script');script.src='/broken-local-dependency.js?secret=DO_NOT_SHOW';script.onerror=()=>resolve();document.head.append(script);
        }));
        assert.match(await warning.innerText(),/2个脚本加载失败/);
        assert.doesNotMatch(await warning.innerText(),/DO_NOT_SHOW|外部依赖/);
        const report=await page.evaluate(()=>UvUResourceHealth.inspect());
        assert.ok(report.some(row=>row.resource.includes('broken-local-dependency')&&row.state.includes('加载失败')));
        checks.push('本地脚本失败也被准确列出，失败地址隐藏查询参数');
        await page.unroute(echarts);
        await page.evaluate(src => new Promise((resolve,reject)=>{
            const script=document.createElement('script');script.src=src;script.onload=()=>resolve();script.onerror=reject;document.head.append(script);
        }),echarts);
        assert.match(await warning.innerText(),/1个脚本加载失败/);
        assert.doesNotMatch(await warning.innerText(),/ECharts/);
        await warning.getByRole('button',{name:'关闭',exact:true}).click();
        assert.equal(await warning.count(),0);
        checks.push('脚本成功重载后移除旧失败记录，提示可正常关闭');
        assert.deepEqual(errors,[]);
        fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,pageErrors:errors,slow,timeout},null,2));
        console.log(JSON.stringify({checks,pageErrors:errors,slow,timeout},null,2));
    } finally { await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
