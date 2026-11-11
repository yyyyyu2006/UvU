const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'../js/modules');
function fixture(){const c=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,AbortController,setTimeout});const file=path.join(base,'backup_integrity.js');if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;}
test('optional backup module checksums accept key order changes and detect corruption before import',async()=>{
 const c=fixture(),I=c.UvUBackupIntegrity;assert.ok(I);const modules={characters:[{id:'c',history:[{id:'m',content:'你好😀'}]}],worldBooks:[{id:'w',content:'世界'}]};
 const manifest=await I.create(modules);assert.equal(manifest.algorithm,'SHA-256');assert.equal((await I.verify(modules,manifest)).verified,2);
 const copy={worldBooks:modules.worldBooks,characters:modules.characters.map(x=>({history:x.history,id:x.id}))};assert.equal((await I.verify(copy,manifest)).verified,2);
 copy.worldBooks=[{id:'w',content:'changed'}];await assert.rejects(I.verify(copy,manifest),/worldBooks/);
 assert.equal((await I.verify(modules,undefined)).verified,0);await assert.rejects(I.verify(modules,{...manifest,algorithm:'unknown'}),/校验/);
});
test('backup integrity is bounded, cancellable and rejects missing module digests',async()=>{
 const c=fixture(),I=c.UvUBackupIntegrity;assert.ok(I);const manifest=await I.create({worldBooks:[]});await assert.rejects(I.verify({characters:[]},manifest),/worldBooks|characters/);
 const controller=new AbortController();controller.abort();await assert.rejects(I.create({worldBooks:[]},{signal:controller.signal}),/取消/);
 await assert.rejects(I.create({worldBooks:['x'.repeat(8*1024*1024+1)]}),/8 MB/);assert.equal((await I.verify({worldBooks:[]},manifest)).verified,1);
});
test('actual backup worker verifies selected modules and refuses a corrupted checksummed file',async()=>{
 const c=fixture(),I=c.UvUBackupIntegrity;assert.ok(I);const modules={worldBooks:[{id:'w',content:'valid'}],characters:[{id:'private'}]},integrity=await I.create(modules);
 const parse=async data=>{let result;const context=vm.createContext({self:{postMessage:v=>result=v},TextDecoder,TextEncoder,DecompressionStream,crypto:require('node:crypto').webcrypto,setTimeout});context.importScripts=()=>vm.runInContext(fs.readFileSync(path.join(base,'backup_integrity.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(base,'storage_backup_worker.js'),'utf8'),context);await context.self.onmessage({data:{file:new File([JSON.stringify(data)],'test.json'),keys:['worldBooks']}});return result;};
 const valid=await parse({modules,backupManifest:{integrity}});assert.equal(valid.modules.worldBooks[0].content,'valid');assert.equal(valid.modules.characters,undefined);
 const broken=await parse({modules:{...modules,worldBooks:[{id:'w',content:'bad'}]},backupManifest:{integrity}});assert.match(broken.error,/worldBooks/);assert.equal(broken.modules,undefined);
 const missing=await parse({modules:{characters:modules.characters},backupManifest:{integrity}});assert.match(missing.error,/worldBooks/);assert.equal(missing.modules,undefined);
 const badManifest=await parse({modules,backupManifest:{integrity:null}});assert.match(badManifest.error,/校验/);
});
test('checksum serialization matches JSON dates, Unicode and undefined values without per-token buffers',async()=>{
 const c=fixture(),I=c.UvUBackupIntegrity,modules={worldBooks:[{when:new Date('2026-11-11T00:00:00Z'),text:'中文😀',missing:undefined,values:[undefined,NaN]}]};const manifest=await I.create(modules);assert.equal((await I.verify(JSON.parse(JSON.stringify(modules)),manifest)).verified,1);
 const controller=new AbortController();c.setTimeout=fn=>{controller.abort();fn();};await assert.rejects(I.create({worldBooks:[]},{signal:controller.signal}),/取消/);
});
