'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(ttSettings={}, token='') {
 const calls=[],nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',dataset:{},style:{},textContent:'',hidden:false});return nodes.get(id);};
 const values=new Map(token?[['uvu-story-bridge.v1.tt',JSON.stringify({token,baseUrl:ttSettings.baseUrl})]]:[]);
 const db={characters:[],uvuStoryBridgeSettings:{channel:'tt',ttSettings}};
 const ctx=vm.createContext({window:{},db,URL,AbortSignal,TextEncoder,structuredClone,console,document:{visibilityState:'visible',getElementById:node,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},saveData:async()=>{},fetch:async(...args)=>{calls.push(args);return {ok:true,json:async()=>({enabled:true,characters:[]})};}});
 const source=fs.readFileSync(require.resolve('../js/modules/story_bridge.js'),'utf8');
 vm.runInContext(source.replace('window.setupUvUStoryBridge =','window.testApi={request,automaticSync,ttMode:typeof ttMode === "function"?ttMode:()=>undefined,changeTTMode:typeof changeTTMode === "function"?changeTTMode:undefined,renderTransportUI:typeof renderTransportUI === "function"?renderTransportUI:undefined}; window.setupUvUStoryBridge ='),ctx);
 return {ctx,db,api:ctx.window.testApi,bridge:ctx.window.UvUStoryBridge,calls,node};
}
test('fresh TT defaults to file and file operations never start pairing or reconnect',async()=>{
 const f=fixture();assert.equal(f.api.ttMode(),'file');await assert.rejects(f.api.request('/client/pair',{auth:false,method:'POST'}),/文件/);await f.api.automaticSync();assert.equal(f.calls.length,0);
});
test('saved TT HTTPS address remains selected after upgrade and file selection retains credentials',async()=>{
 const f=fixture({baseUrl:'https://relay.example'},'device');assert.equal(f.api.ttMode(),'https');assert.equal(f.bridge.isConnected(),true);
 await f.api.changeTTMode('file');assert.equal(f.bridge.isConnected(),false);await f.api.automaticSync();assert.equal(f.calls.length,0);
 await f.api.changeTTMode('https');assert.equal(f.bridge.isConnected(),true);assert.equal(f.db.uvuStoryBridgeSettings.ttSettings.baseUrl,'https://relay.example');
});
test('TT refuses GitHub Pages before a device or pair credential is sent',async()=>{
 const f=fixture({baseUrl:'https://yyyyyu2006.github.io/UvU',transport:'https',transportVersion:1});await assert.rejects(f.api.request('/client/pair',{auth:false,method:'POST',body:{code:'secret'}}),/GitHub Pages|静态网页/);assert.equal(f.calls.length,0);
});

test('preexisting failed Pages endpoint migrates to file while preserving address and token',async()=>{
 for(const transport of [undefined,'https']){
  const endpoint='https://yyyyyu2006.github.io/UvU',f=fixture({baseUrl:endpoint,...(transport?{transport}:{})},'retained-device');
  assert.equal(f.api.ttMode(),'file');assert.equal(f.db.uvuStoryBridgeSettings.ttSettings.baseUrl,endpoint);
  assert.equal(f.ctx.localStorage.getItem('uvu-story-bridge.v1.tt').includes('retained-device'),true);
  await f.api.automaticSync();assert.equal(f.calls.length,0);f.api.renderTransportUI();assert.equal(f.node('uvu-bridge-online-controls').hidden,true);
  await f.api.changeTTMode('https');assert.equal(f.api.ttMode(),'https');
 }
});
test('file UI hides online controls and ST tutorial while keeping review controls',()=>{
 const f=fixture();f.api.renderTransportUI();assert.equal(f.node('uvu-bridge-online-controls').hidden,true);assert.equal(f.node('uvu-bridge-st-guide').hidden,true);assert.equal(f.node('uvu-bridge-tt-transport').hidden,false);assert.match(f.node('uvu-bridge-connection').textContent,/文件/);
});
