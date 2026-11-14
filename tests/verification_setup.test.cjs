const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {requiredFiles,inspectBaseline,baseline1900}=require('./helpers/baseline_1900.cjs');
test('1900 preflight rejects missing or incomplete baselines and accepts complete files',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'uvu-baseline-'));
    try {
        assert.equal(inspectBaseline(root).available,false);
        assert.throws(()=>baseline1900({UVU_1900_ROOT:root}),/1900未验证/);
        assert.throws(()=>baseline1900({UVU_1900_ROOT:root,UVU_ALLOW_MISSING_1900:'1',UVU_1900_STRICT:'1'}),/1900未验证/);
        for(const file of requiredFiles){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'// fixture');}
        assert.equal(baseline1900({UVU_1900_ROOT:root}).available,true);
        fs.unlinkSync(path.join(root,requiredFiles.at(-1)));
        assert.deepEqual(inspectBaseline(root).missing,[requiredFiles.at(-1)]);
        const strict=spawnSync(process.execPath,[path.join(__dirname,'run_1900_checks.cjs')],{env:{...process.env,UVU_1900_ROOT:root,UVU_ALLOW_MISSING_1900:'1'},encoding:'utf8',windowsHide:true});
        assert.equal(strict.status,1);assert.match(strict.stderr,/1900未验证/);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('browser setup reports missing dependency, browser and assets without personal paths',()=>{
    const helper=path.join(__dirname,'helpers/browser_runtime.cjs');
    for(const [code,env,expected] of [
        ["runtime.playwright()",{PLAYWRIGHT_MODULE:path.join(os.tmpdir(),'uvu-no-playwright')},/npm ci/],
        ["runtime.browserPath()",{UVU_CHROME_PATH:path.join(os.tmpdir(),'uvu-no-chrome')},/playwright install chromium/],
        ["runtime.assetMap('<script src=\"https://unknown.invalid/a.js\"></script>')",{},/test:browser:prepare/]
    ]){
        const run=spawnSync(process.execPath,['-e',`const runtime=require(${JSON.stringify(helper)});${code}`],{env:{...process.env,...env},encoding:'utf8',windowsHide:true});
        assert.notEqual(run.status,0);assert.match(run.stderr,expected);
    }
});
