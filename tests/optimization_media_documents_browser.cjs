const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/15271130817/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
const page=await browser.newPage({viewport:{width:390,height:844}});await page.setContent('<button id="opener">导入</button>');
await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../css/modules/document_features.css'),'utf8')});
await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../js/modules/document_import.js'),'utf8')});
await page.locator('#opener').click();await page.evaluate(()=>{window.readResult=null;window.file={name:'gb.txt',size:2,arrayBuffer:async()=>new Uint8Array([0xc4,0xe3]).buffer};readImportDocument(file).then(r=>window.readResult=r);});
await page.waitForSelector('#document-import-preview');assert.equal(await page.locator('#document-import-preview textarea').inputValue(),'你');assert.equal(await page.evaluate(()=>window.readResult),null);
await page.locator('#document-import-preview select').selectOption('utf-8');await page.waitForFunction(()=>document.querySelector('#document-import-preview textarea').value.includes('�'));
await page.locator('#document-import-preview select').selectOption('gb18030');await page.waitForFunction(()=>document.querySelector('#document-import-preview textarea').value==='你');
await page.locator('#document-import-preview [data-confirm]').click();await page.waitForFunction(()=>window.readResult);assert.equal(await page.evaluate(()=>readResult.encoding),'gb18030');assert.equal(await page.evaluate(()=>document.activeElement.id),'opener');
await page.evaluate(()=>{window.cancelError=null;window.slow={name:'slow.txt',size:2,arrayBuffer:()=>new Promise(r=>window.releaseFile=r)};readImportDocument(slow).catch(e=>window.cancelError=e.name);});
await page.locator('.document-import-progress button').click();await page.evaluate(()=>window.releaseFile(new Uint8Array([97]).buffer));await page.waitForFunction(()=>window.cancelError==='AbortError');assert.equal(await page.locator('#document-import-preview').count(),0);
console.log('PASS: TXT encoding preview/redecode, explicit import acceptance and cancelled parse discard');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
