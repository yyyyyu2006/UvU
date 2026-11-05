const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function fixture(save=async()=>{}) {
 const context=vm.createContext({window:{},console,saveData:save,structuredClone});
 vm.runInContext(fs.readFileSync(require.resolve('../js/chat.js'),'utf8'),context);
 const panel={enabled:true,replacePattern:'ORIGINAL_TEMPLATE',history:[{html:'new',raw:'newRaw'},{html:'old',raw:'oldRaw'}],currentStatusHtml:'new',currentStatusRaw:'newRaw'};
 const archive={id:'a',data:{statusPanel:structuredClone(panel)}};
 const chat={id:'c',activeArchiveId:'a',statusPanel:panel,archives:[archive],history:[{content:'原始消息'}]};
 return {context,chat,panel,archive,remove:context.deleteStatusPanelSnapshot};
}
test('deleting displayed newest status reveals previous snapshot without removing template or chat',async()=>{
 const f=fixture(); await f.remove(f.chat,f.panel,f.panel.history[0]);
 assert.equal(f.panel.history.length,1); assert.equal(f.panel.currentStatusHtml,'old'); assert.equal(f.panel.currentStatusRaw,'oldRaw');
 assert.equal(f.panel.replacePattern,'ORIGINAL_TEMPLATE'); assert.equal(f.chat.history[0].content,'原始消息');
 await f.remove(f.chat,f.panel,f.panel.history[0]); assert.equal(f.panel.currentStatusHtml,''); assert.equal(f.panel.history.length,0);
});
test('delete storage failure rolls back status and its archive without touching a newly switched archive',async()=>{
 let finish; const pending=new Promise((_,reject)=>finish=reject); const f=fixture(()=>pending), original=f.panel.history;
 const running=f.remove(f.chat,f.panel,original[0]);
 const other={history:[],currentStatusHtml:'OTHER'}; f.chat.activeArchiveId='b'; f.chat.statusPanel=other;
 finish(new Error('quota')); await assert.rejects(running,/quota/);
 assert.equal(f.panel.history,original); assert.equal(f.archive.data.statusPanel.currentStatusHtml,'new'); assert.equal(f.chat.statusPanel,other);
});
test('stale status panel from another archive cannot be deleted',async()=>{
 const f=fixture(); f.chat.statusPanel={history:[]};
 await assert.rejects(f.remove(f.chat,f.panel,f.panel.history[0]),/存档|状态栏/); assert.equal(f.panel.history.length,2);
});
test('failed deletion preserves a newly generated status while restoring the removed snapshot',async()=>{
 let finish; const pending=new Promise((_,reject)=>finish=reject); const f=fixture(()=>pending);
 const running=f.remove(f.chat,f.panel,f.panel.history[0]);
 f.panel.history.unshift({html:'newest',raw:'newestRaw'}); f.panel.currentStatusHtml='newest'; f.panel.currentStatusRaw='newestRaw';
 finish(new Error('quota')); await assert.rejects(running,/quota/);
 assert.deepEqual(Array.from(f.panel.history,item=>item.html),['newest','new','old']);
 assert.equal(f.panel.currentStatusHtml,'newest');
});
