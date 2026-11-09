const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/15271130817/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.join(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.setContent('<div id="global-css-modal"><textarea id="global-beautification-css">.draft {color:purple}</textarea><input type="file" id="global-css-document-input"><button id="global-css-document-import">导入</button><button id="global-css-document-export">导出</button><div id="global-css-export-menu"><button id="global-css-document-export-txt">TXT</button><button id="global-css-document-export-docx">DOCX</button></div></div>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'css/modules/document_features.css'),'utf8')});
 await page.evaluate(()=>{window.db={globalCss:'.old {color:red}'};window.toasts=[];window.showToast=x=>toasts.push(x);window.saveData=async()=>{if(window.failSave)throw Error('disk full');};window.applyGlobalCss=x=>window.activeCss=x;window.readImportDocument=async()=>({text:'.incoming {color:blue}'});});
 await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/modules/global_css_io.js'),'utf8')});await page.evaluate(()=>GlobalCssIO.setup());
 const load=()=>page.locator('#global-css-document-input').setInputFiles({name:'style.txt',mimeType:'text/plain',buffer:Buffer.from('test')});
 await load();assert.equal(await page.locator('#global-css-import-preview').count(),1,'import first opens a reviewable CSS preview');assert.equal(await page.evaluate(()=>db.globalCss),'.old {color:red}');assert.match(await page.locator('[data-diff-summary]').textContent(),/新增 1 行.*删除 1 行/);assert.match(await page.locator('[data-diff]').textContent(),/\+ \.incoming/);
 await page.locator('#global-css-import-preview [data-cancel]').click();assert.equal(await page.locator('#global-beautification-css').inputValue(),'.draft {color:purple}');
 await load();await page.locator('#global-css-import-preview [data-confirm]').click();await page.waitForFunction(()=>db.globalCss==='.incoming {color:blue}');
 await page.locator('#global-css-import-undo').click();await page.waitForFunction(()=>db.globalCss==='.old {color:red}');assert.equal(await page.locator('#global-beautification-css').inputValue(),'.draft {color:purple}');
 await page.evaluate(()=>window.failSave=true);await load();await page.locator('#global-css-import-preview [data-confirm]').click();await page.waitForFunction(()=>toasts.includes('disk full'));assert.equal(await page.evaluate(()=>db.globalCss),'.old {color:red}');assert.equal(await page.locator('#global-beautification-css').inputValue(),'.draft {color:purple}');
 console.log('PASS: CSS preview/cancel, explicit save, one-step undo and failed-save draft rollback');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
