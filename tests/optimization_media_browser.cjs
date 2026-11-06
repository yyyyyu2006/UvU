const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('C:/Users/15271130817/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.join(__dirname, '..');
(async () => {
 const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
 try {
  const page = await browser.newPage({ viewport: {width:390,height:844} });
  await page.route('https://editor.test/**', r => r.fulfill({contentType:'text/html',body:'<textarea id="setting-char-persona"></textarea>'}));
  await page.goto('https://editor.test/');
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'css/modules/document_features.css'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/modules/text_editor.js'),'utf8')});
  await page.evaluate(() => { window.showToast=()=>{}; window.confirm=()=>true; window.currentChatId='a'; window.currentChatType='private'; window.db={characters:[{id:'a',activeArchiveId:'one'}],groups:[]}; const t=document.querySelector('textarea'); t.value='中文自动换行'.repeat(600)+'目标'+'后续'.repeat(20); openExpandedEditor(t); });
  await page.locator('.editor-find').fill('目标');
  await page.locator('[data-action="next"]').click();
  const selected=await page.locator('.editor-draft').evaluate(t=>({top:t.scrollTop,text:t.value.slice(t.selectionStart,t.selectionEnd)}));
  assert.equal(selected.text,'目标'); assert.ok(selected.top>1000,'wrapped paragraph search scrolled into view');
  await page.locator('.editor-draft').fill('未应用草稿');
  await page.locator('[data-action="keepDraft"]').click();
  assert.equal(await page.locator('#setting-char-persona').inputValue(),'中文自动换行'.repeat(600)+'目标'+'后续'.repeat(20));
  await page.evaluate(()=>openExpandedEditor(document.getElementById('setting-char-persona')));
  assert.equal(await page.locator('.editor-draft').inputValue(),'未应用草稿');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#expanded-text-editor').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'setting-char-persona');
  await page.evaluate(()=>openExpandedEditor(document.getElementById('setting-char-persona')));
  await page.locator('.editor-draft').fill('已应用'); await page.locator('[data-action="apply"]').click();
  await page.evaluate(()=>openExpandedEditor(document.getElementById('setting-char-persona')));
  assert.equal(await page.locator('.editor-draft-notice').isVisible(),false,'applied text is not reported as a conflicting draft');
  await page.evaluate(()=>{window.currentChatId='b';document.getElementById('setting-char-persona').value='另一角色';});
  await page.locator('[data-action="apply"]').click();
  assert.equal(await page.locator('#setting-char-persona').inputValue(),'另一角色','source owner change blocks applying into another character');
  console.log('PASS: wrapped CJK find at 390px; explicit session draft; Escape and focus restoration');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
