// Optional browser verification with fixed, trusted text fixtures (no external API).
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.resolve(__dirname,'../../uvu-verification-deps/node_modules/playwright'));
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><main id="chat-room-screen" class="screen active"><div class="message-area"></div><div id="reply-preview-bar"><span class="reply-preview-name"></span><span class="reply-preview-text"></span></div><textarea id="message-input"></textarea><button id="send-test-sticker">发送表情</button></main>`);
  for(const css of ['base.css','layout.css','chat.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,'css',css),'utf8')});
  await page.addStyleTag({content:'#chat-room-screen{display:block;height:auto;padding:16px}.message-area{min-height:220px}#reply-preview-bar{position:static}#message-input{display:block}'});
  await page.evaluate(()=>{
   window.currentChatId='c';window.currentChatType='private';window.currentQuoteInfo=null;window.isInMultiSelectMode=false;window.isDebugMode=false;
   window.messageInput=document.getElementById('message-input');window.messageArea=document.querySelector('.message-area');
   const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><rect width="84" height="84" rx="12" fill="#f7df85"/><text x="22" y="58" font-size="44">☺</text></svg>');
   window.db={characters:[{id:'c',activeArchiveId:'a',myName:'我',realName:'阿晴',remarkName:'阿晴',myAvatar:image,avatar:image,history:[{id:'source',role:'assistant',content:'[阿晴的消息：选哪个好？]',timestamp:1}]}],groups:[],myStickers:[{id:'s',name:'开心',data:image,description:'开心的笑脸'}]};
   window.colorThemes={white_pink:{sent:{bg:'#fff',text:'#333'},received:{bg:'#fff',text:'#333'}}};window.pad=n=>String(n).padStart(2,'0');
   window.escapeMessageRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   // Trusted fixture strings only; sanitization itself is not under test here.
   window.DOMPurify={sanitize:s=>s};window.saveData=async()=>{};window.showPanel=()=>{};window.showToast=()=>{};window.renderChatList=()=>{};
  });
  for(const file of ['chat_ops.js','sticker.js','chat_render.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/modules',file),'utf8')});
  await page.evaluate(()=>{
   window.addMessageBubble=message=>messageArea.appendChild(createMessageBubbleElement(message));
   document.getElementById('send-test-sticker').onclick=()=>sendSticker(db.myStickers[0]);
   messageInput.value='保留这段草稿';startQuoteReply('source');
  });
  await page.locator('#send-test-sticker').click();
  await page.waitForFunction(()=>db.characters[0].history.at(-1).quote?.messageId==='source');
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   // Re-render from the persisted message, as reopening the chat does.
   await page.evaluate(()=>{messageArea.replaceChildren(createMessageBubbleElement(db.characters[0].history.at(-1)));});
   const bubble=page.locator('.image-bubble');assert.equal(await bubble.locator('img').count(),1);
   assert.equal(await bubble.locator('.quoted-text').textContent(),'选哪个好？');
   const img=await bubble.locator('img').boundingBox(),quote=await bubble.locator('.quoted-message').boundingBox();
   await page.screenshot({path:path.join(root,'../uvu-verification-deps/artifacts',`quote-sticker-${width}.png`)});
   assert.ok(quote.y>=img.y+img.height&&quote.x>=0&&quote.x+quote.width<=width,JSON.stringify({img,quote,width}));
   assert.equal(await page.locator('#reply-preview-bar').evaluate(e=>e.classList.contains('visible')),false);
   assert.equal(await page.locator('#message-input').inputValue(),'保留这段草稿');
   await page.screenshot({path:path.join(root,'../uvu-verification-deps/artifacts',`quote-sticker-${width}.png`)});
  }
  assert.deepEqual(errors,[]);console.log('PASS quoted sticker: private send, persisted re-render, image and quote below, draft preserved, 320/390px.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
