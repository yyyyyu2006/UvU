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

for (const order of [[0, 1], [1, 0]]) {
    test(`consecutive failed edits restore the saved value (${order.join(',')})`, async () => {
        const failures = [];
        const runtime = settingsRuntime(() => new Promise((_, reject) => failures.push(reject)));
        const target = {name:'saved'};
        const pending = ['first', 'second'].map(name => runtime.save([{target,values:{name}}]));
        for (const index of order) { failures[index](Error('disk unavailable')); await pending[index]; }
        assert.equal(target.name, 'saved');
    });
}

test('failed older edit cannot undo a newer successful edit with the same value', async () => {
    const settles=[];
    const runtime=settingsRuntime(()=>new Promise((resolve,reject)=>settles.push({resolve,reject})));
    const target={name:'saved'};
    const first=runtime.save([{target,values:{name:'same'}}]);
    const second=runtime.save([{target,values:{name:'same'}}]);
    settles[1].resolve();assert.equal(await second,true);
    settles[0].reject(Error('disk unavailable'));assert.equal(await first,false);
    assert.equal(target.name,'same');
});

test('one failed operation restores both nested fields and their containing list', async () => {
    const runtime=settingsRuntime(async()=>{throw Error('disk unavailable');});
    const item={id:'old',locked:true},target={items:[item]};
    assert.equal(await runtime.save([
        {target:item,values:{id:'migrated',locked:false}},
        {target,values:{items:[item,{id:'new'}]}}
    ]),false);
    assert.deepEqual(JSON.parse(JSON.stringify(target)),{items:[{id:'old',locked:true}]});
});
