const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('./browser_runtime.cjs').playwright();
const root=path.resolve(__dirname,'../..');
async function fullApp() {
    const executablePath=require('./browser_runtime.cjs').browserPath();
    const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const libs=require('./browser_runtime.cjs').assetMap(html);
    const server=http.createServer((req,res)=>{
        const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
        if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
        fs.readFile(file,(error,body)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');res.end(body);});
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    let browser;
    try { browser=await chromium.launch({headless:true,executablePath}); }
    catch(error) { await new Promise(resolve=>server.close(resolve)); throw error; }
    return {browser,origin,async page(options={}){
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block',...options});
        await context.addInitScript(()=>{localStorage.setItem('lastSeenVersion','1.8.9');localStorage.setItem('storage_persist_prompted','true');});
        await context.route('**/*',route=>{const url=route.request().url();if(libs.has(url))return route.fulfill({path:libs.get(url),contentType:'application/javascript'});return url.startsWith(origin)||url.startsWith('data:')||url.startsWith('blob:')?route.continue():route.abort();});
        const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.type()==='confirm'?dialog.dismiss():dialog.accept());
        await page.clock.setFixedTime(new Date('2026-11-12T04:00:00Z'));
        await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('message-area')?.dataset.replyGesturesBound==='true');
        await page.evaluate(()=>{GuideSystem.cleanup();db.characters=[];db.groups=[];db.worldBooks=[];db.backupReminderSettings={enabled:false};});
        return {page,context,errors};
    },async close(){await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
async function stableUI(page, selector) {
    await page.locator(selector).waitFor({state:'visible'});
    await page.locator(selector).evaluate(async element=>{
        await document.fonts.ready;
        await Promise.all(element.getAnimations({subtree:true}).filter(animation=>{
            const timing=animation.effect?.getComputedTiming();
            return timing && Number.isFinite(timing.endTime) && timing.endTime<=1000;
        }).map(animation=>animation.finished.catch(()=>{})));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    });
}
module.exports={fullApp,root,stableUI};
