const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/utils.js'), 'utf8').split('function escapeMessageRegex')[0];

function settingsRuntime(saveData) {
    const toasts = [];
    const context = vm.createContext({saveData, showToast: value => toasts.push(value), console:{error(){}}});
    vm.runInContext(source, context);
    return {save:context.saveLocalSettingsFields, toasts};
}

test('failed local settings save restores only affected fields', async () => {
    const runtime = settingsRuntime(async () => { throw Error('disk unavailable'); });
    const target = {enabled:false, untouched:'original'};
    assert.equal(await runtime.save([{target,values:{enabled:true,newField:'draft'}}]), false);
    assert.deepEqual(target,{enabled:false,untouched:'original'});
    assert.equal(runtime.toasts.length,1);
});

test('local settings rollback preserves a newer edit while saving', async () => {
    let reject;
    const runtime = settingsRuntime(() => new Promise((_, fail) => { reject = fail; }));
    const target = {name:'original',enabled:false};
    const saving = runtime.save([{target,values:{name:'draft',enabled:true}}]);
    target.name='newer edit';target.other='unrelated';reject(Error('disk unavailable'));
    assert.equal(await saving,false);
    assert.deepEqual(target,{name:'newer edit',enabled:false,other:'unrelated'});
});

test('local settings success waits for persistence before reporting success', async () => {
    let resolve, settled=false;
    const runtime=settingsRuntime(()=>new Promise(done=>{resolve=done;}));
    const target={enabled:false};
    const saving=runtime.save([{target,values:{enabled:true}}]).then(value=>{settled=true;return value;});
    await Promise.resolve();assert.equal(settled,false);resolve();
    assert.equal(await saving,true);assert.equal(target.enabled,true);assert.equal(runtime.toasts.length,0);
});
