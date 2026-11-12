const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function catalog(){const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/modules/music_catalog.js'),'utf8'),context);return context.UvUMusicCatalog;}
const t=(id,extras={})=>({id,provider:'netease',title:id,artists:['Artist'],album:'Album',...extras});
test('saved catalog deduplicates provider identities without saving recent-only songs',()=>{
 const C=catalog(),a=t('1'),b=t('1',{provider:'qq'}),c=t('recent');
 const lib={favorites:[a],playlists:[{tracks:[a,b]}],recent:[c,a]};
 assert.deepEqual(Array.from(C.saved(lib),x=>x.provider+':'+x.id),['netease:1','qq:1']);
 assert.deepEqual(Array.from(C.available(lib),x=>x.id),['recent','1','1']);
 assert.equal(lib.playlists[0].tracks.length,2);
});
test('artists include collaborations; album identity includes artist and keeps unknown albums separate',()=>{
 const C=catalog(),tracks=[t('a',{artists:['A','B'],album:'Same'}),t('b',{artists:['C'],album:'Same'}),t('c',{album:''}),t('d',{album:''})];
 assert.equal(C.artists(tracks).find(x=>x.name==='B').tracks[0].id,'a');
 assert.equal(C.albums(tracks).length,4);
 assert.equal(C.albums(tracks)[2].name,'c');
});
test('recent additions put newly appended favorites before the twelve-album limit without mutating storage order',()=>{
 const C=catalog(),tracks=Array.from({length:13},(_,i)=>t(String(i),{album:'Album '+i})),lib={favorites:tracks,playlists:[]};
 const albums=C.albums(C.recentAdded(lib)).slice(0,12);
 assert.equal(albums[0].name,'Album 12');assert.equal(albums[11].name,'Album 1');assert.equal(lib.favorites[0].id,'0');
});
test('recommendations use real deduplicated tracks and never mutate the portable library',()=>{
 const C=catalog(),a=t('a'),b=t('b'),lib={favorites:[a,b],recent:[a],playlists:[{id:'mine',name:'Mine',tracks:[b,a]}]},before=JSON.stringify(lib);
 const items=C.recommendations(lib,[{name:'Source',tracks:[a,a,b]}],()=>0);
 assert.equal(items[0].kind,'collection');assert.equal(items[0].tracks.length,2);
 assert.ok(items.some(item=>item.id==='mine'));assert.equal(JSON.stringify(lib),before);
 assert.deepEqual(Array.from(C.recommendations({favorites:[],recent:[],playlists:[]})),[]);
});
test('recommendation queries stay bounded and use known artists when available',()=>{
 const C=catalog(),plan=C.recommendationPlan({favorites:[t('a',{artists:['Artist']})],playlists:[],recent:[]},()=>0);
 assert.equal(plan.length,2);assert.equal(plan[0].query,'Artist');assert.notEqual(plan[0].query,plan[1].query);
 const noHistory=C.recommendationPlan({favorites:[],recent:[],playlists:[]},()=>0);
 assert.equal(noHistory.length,2);assert.ok(noHistory.every(item=>item.query));assert.notEqual(noHistory[0].query,noHistory[1].query);
});
