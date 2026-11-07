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
