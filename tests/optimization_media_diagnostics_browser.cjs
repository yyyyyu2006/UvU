const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/15271130817/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.join(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
const page=await browser.newPage({viewport:{width:390,height:844}});await page.setContent('<button id="minimax-tts-preview">试听</button>');
await page.evaluate(()=>{window.toasts=[];window.showToast=x=>toasts.push(x);window.db={minimaxTtsSettings:{apiKey:'secret',voiceId:'voice',director:{enabled:true,endpoint:'https://director.example',apiKey:'director-secret',model:'model'}}};window.Audio=class extends EventTarget{pause(){}load(){}removeAttribute(){}play(){return Promise.resolve();}};window.fetch=async url=>({ok:true,status:200,json:async()=>url.includes('director.example')?{choices:[{message:{content:JSON.stringify({emotion:'sad',speedMultiplier:0.9,pauses:[{after:'你好，',seconds:0.4}]})}}]}:{data:{audio:'fffb9064'+'00'.repeat(413)}}});});
for(const f of ['voice_director','chat_features'])await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/modules/'+f+'.js'),'utf8')});
await page.evaluate(()=>{const host=document.createElement('div');host.id='minimax-director-fields';for(const name of ['enabled','provider','endpoint','key','model','context','timeout']){const input=document.createElement('input');input.id='minimax-director-'+name;host.appendChild(input);}const prompt=document.createElement('textarea');prompt.id='minimax-director-prompt';host.appendChild(prompt);document.body.appendChild(host);VoiceDirector.setupSettings({enabled:true,prompt:'我自己的导演风格'});});
assert.equal(await page.locator('#minimax-director-prompt').inputValue(),'我自己的导演风格');await page.locator('#minimax-director-preset').selectOption('gentle');assert.match(await page.locator('#minimax-director-prompt').inputValue(),/稍慢/);
await page.evaluate(()=>MiniMaxTTS.play(document.getElementById('minimax-tts-preview'),'你好，再见。'));
const detail=await page.locator('#minimax-tts-diagnostics').innerText();assert.match(detail,/导演.*ms.*合成.*ms/);assert.match(detail,/情绪 sad.*语速 0.9.*停顿 1/);assert.doesNotMatch(detail,/secret/);
await page.locator('#minimax-tts-diagnostics button').click();assert.equal(await page.evaluate(()=>MiniMaxTTS.getCacheInfo().entries),0);assert.match(await page.locator('#minimax-tts-diagnostics').innerText(),/清空/);
console.log('PASS: directed preview diagnostics, pause count, redacted display and cache clear');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
