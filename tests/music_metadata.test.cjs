const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function api(){const c=vm.createContext({TextDecoder,Uint8Array});c.window=c;const p=path.join(__dirname,'../js/modules/music_metadata.js');if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),c);return c.UvUMusicMetadata;}
test('local MP3 ID3 metadata reads bounded text and unsupported files keep filename fallback',async()=>{
    const text=Buffer.concat([Buffer.from([3]),Buffer.from('晚风')]),frame=Buffer.alloc(10);frame.write('TIT2');frame.writeUInt32BE(text.length,4);const header=Buffer.from([73,68,51,3,0,0,0,0,0,10+text.length]);const blob=new Blob([header,frame,text]);
    assert.equal((await api().read(blob)).title,'晚风');assert.deepEqual(JSON.parse(JSON.stringify(await api().read(new Blob(['not audio'])))),{});
});
test('corrupt ID3 sizes and binary frames do not become titles or block import',async()=>{
    const blob=new Blob([Buffer.from([73,68,51,4,0,0,127,127,127,127]),Buffer.from('TIT2\xff\xff\xff\xff')]);assert.deepEqual(JSON.parse(JSON.stringify(await api().read(blob))),{});
});
