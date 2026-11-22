// Small native readers with explicit byte/iteration budgets; malformed tags preserve filename fallback.
(function(root){
    'use strict';
    const LIMIT=8*1024*1024,PICTURE=2*1024*1024,MAXTEXT=100000;
    const workerURL=typeof document!=='undefined'&&document.currentScript?.src?new URL('music_metadata_worker.js',document.currentScript.src).href:'';
    const ascii=(b,a=0,n=b.length-a)=>String.fromCharCode(...b.subarray(a,Math.min(b.length,a+Math.min(n,128))));
    const u32=(b,p,le=false)=>p+4<=b.length?new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,le):0;
    const sync=(b,p)=>((b[p]&127)*2097152+(b[p+1]&127)*16384+(b[p+2]&127)*128+(b[p+3]&127));
    function abort(signal){if(signal?.aborted){const e=Error('音频标签读取已取消');e.name='AbortError';throw e;}}
    function decode(b,encoding='utf-8',limit=MAXTEXT){try{return new TextDecoder(encoding).decode(b).replace(/\u0000/g,'\n').replace(/[\u0001-\u0008\u000b-\u001f]/g,'').trim().slice(0,limit);}catch(_){return'';}}
    function terminator(b,start,wide){for(let p=start;p<b.length-(wide?1:0);p+=wide?2:1)if(b[p]===0&&(!wide||b[p+1]===0))return p;return b.length;}
    function encoded(b,start=0){const encoding=['iso-8859-1','utf-16','utf-16be','utf-8'][b[0]];return encoding?decode(b.subarray(start||1),encoding):'';}
    function artists(value){return value.split(/\n|\s*;\s*|\s*\/\s*/).map(v=>v.trim().slice(0,300)).filter(Boolean).slice(0,30);}
    function field(out,key,value){if(!value)return;if(key==='artists'){out.artists=[...new Set([...(out.artists||[]),...artists(value)])].slice(0,30);}else if(key==='trackNumber'||key==='discNumber'){const n=parseInt(value,10);if(n>0&&n<10000)out[key]=n;}else out[key]=value.slice(0,key==='embeddedLyrics'?MAXTEXT:300);}
    function image(out,b,mime){
        if(!b?.length||b.length>PICTURE)return;
        if(b[0]===255&&b[1]===216&&b[2]===255)mime='image/jpeg';else if(ascii(b,0,8)===String.fromCharCode(137,80,78,71,13,10,26,10))mime='image/png';else if(ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WEBP')mime='image/webp';else return;
        if(mime==='image/png'&&(b.length<24||u32(b,16)*u32(b,20)>16777216||!u32(b,16)||!u32(b,20)))return;
        if(mime==='image/jpeg'){for(let p=2,steps=0;p+9<b.length&&steps++<2048;){if(b[p]!==255)break;const marker=b[p+1],size=(b[p+2]<<8)|b[p+3];if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(((b[p+5]<<8)|b[p+6])*((b[p+7]<<8)|b[p+8])>16777216)return;break;}if(size<2)break;p+=size+2;}}
        if(mime==='image/webp'&&ascii(b,12,4)==='VP8X'&&b.length>=30){const width=1+b[24]+b[25]*256+b[26]*65536,height=1+b[27]+b[28]*256+b[29]*65536;if(width*height>16777216)return;}
        if(mime==='image/webp'&&ascii(b,12,4)==='VP8L'&&b.length>=25){const width=1+b[21]+((b[22]&63)<<8),height=1+(b[22]>>6)+(b[23]<<2)+((b[24]&15)<<10);if(width*height>16777216)return;}
        if(mime==='image/webp'&&ascii(b,12,4)==='VP8 '&&b.length>=30){const width=(b[26]|b[27]<<8)&16383,height=(b[28]|b[29]<<8)&16383;if(width*height>16777216)return;}
        if(typeof root.btoa!=='function')return;let binary='';for(let p=0;p<b.length;p+=8192)binary+=String.fromCharCode(...b.subarray(p,p+8192));out.coverData='data:'+mime+';base64,'+root.btoa(binary);
    }
    const unsync=b=>{const a=[];for(let p=0;p<b.length;p++){a.push(b[p]);if(b[p]===255&&b[p+1]===0)p++;}return new Uint8Array(a);};
    function id3(bytes,out){
        if(ascii(bytes,0,3)!=='ID3'||![3,4].includes(bytes[3]))return 0;const version=bytes[3],declared=10+sync(bytes,6);let b=bytes.subarray(10,Math.min(bytes.length,declared));if(bytes[5]&128)b=unsync(b);let p=0;
        if(bytes[5]&64){if(b.length<4)return declared;p=version===4?sync(b,0):u32(b,0)+4;}
        for(let count=0;p+10<=b.length&&count++<2000;){const id=ascii(b,p,4),size=version===4?sync(b,p+4):u32(b,p+4),flags=b[p+9];p+=10;if(!/^[A-Z0-9]{4}$/.test(id)||!size||p+size>b.length)break;let frame=b.subarray(p,p+size);p+=size;if(flags&(version===4?0x4d:0xe0))continue;if(version===4&&(flags&2))frame=unsync(frame);
            const key={TIT2:'title',TPE1:'artists',TALB:'album',TRCK:'trackNumber',TPOS:'discNumber'}[id];
            if(key&&size<=MAXTEXT)field(out,key,encoded(frame));
            else if(id==='TLEN'&&size<100){const n=Number(encoded(frame))/1000;if(n>0&&n<=86400)out.duration=n;}
            else if(id==='USLT'&&size<=MAXTEXT+2000){const wide=frame[0]===1||frame[0]===2,end=terminator(frame,4,wide);field(out,'embeddedLyrics',encoded(new Uint8Array([frame[0],...frame.subarray(Math.min(frame.length,end+(wide?2:1)))])));}
            else if(id==='APIC'&&size<=PICTURE+2048){const m=terminator(frame,1,false),wide=frame[0]===1||frame[0]===2,end=terminator(frame,m+2,wide);image(out,frame.subarray(Math.min(frame.length,end+(wide?2:1))),ascii(frame,1,m-1));}
        }return declared;
    }
    function flacPicture(b,out){if(b.length<32||b.length>PICTURE+2048)return;let p=4,n=u32(b,p);p+=4;if(n>100||p+n+4>b.length)return;const mime=decode(b.subarray(p,p+n));p+=n;n=u32(b,p);p+=4;if(n>4096||p+n+20>b.length)return;p+=n;const width=u32(b,p),height=u32(b,p+4);if(width*height>16777216)return;p+=16;n=u32(b,p);p+=4;if(p+n<=b.length)image(out,b.subarray(p,p+n),mime);}
    function comments(b,out){let p=0,n=u32(b,p,true);p+=4;if(n>MAXTEXT||p+n+4>b.length)return;p+=n;const count=Math.min(2000,u32(b,p,true));p+=4;for(let i=0;i<count&&p+4<=b.length;i++){n=u32(b,p,true);p+=4;if(p+n>b.length)break;if(n<=PICTURE*1.4+100){const isPicture=ascii(b,p,23).startsWith('METADATA_BLOCK_PICTURE='),s=decode(b.subarray(p,p+n),'utf-8',isPicture?Math.ceil(PICTURE*1.4):MAXTEXT),equal=s.indexOf('='),k=s.slice(0,equal).toUpperCase(),v=s.slice(equal+1);const key={TITLE:'title',ARTIST:'artists',ALBUM:'album',TRACKNUMBER:'trackNumber',DISCNUMBER:'discNumber',LYRICS:'embeddedLyrics',UNSYNCEDLYRICS:'embeddedLyrics'}[k];if(equal>0&&key)field(out,key,v);else if(k==='METADATA_BLOCK_PICTURE'&&v.length<PICTURE*1.4&&typeof root.atob==='function'){try{const raw=root.atob(v),pic=Uint8Array.from(raw,c=>c.charCodeAt(0));flacPicture(pic,out);}catch(_){}}}p+=n;}}
    function flac(b,out){let p=4;for(let i=0;i<512&&p+4<=b.length;i++){const type=b[p]&127,last=!!(b[p]&128),size=b[p+1]*65536+b[p+2]*256+b[p+3];p+=4;if(p+size>b.length)break;const block=b.subarray(p,p+size);if(type===0&&size>=34){const rate=block[10]*4096+block[11]*16+(block[12]>>4),samples=(block[13]&15)*4294967296+u32(block,14);if(rate&&samples)out.duration=samples/rate;}else if(type===4)comments(block,out);else if(type===6)flacPicture(block,out);p+=size;if(last)break;}}
    function ogg(b,tail,out){let p=0,pieces=[],length=0,sampleRate=0,preSkip=0,serial;
        for(let pages=0;p+27<=b.length&&pages++<2048;){if(ascii(b,p,4)!=='OggS')break;const segments=b[p+26],head=p+27+segments;if(head>b.length)break;if(serial===undefined)serial=u32(b,p+14,true);let q=head;for(let i=0;i<segments;i++){const n=b[p+27+i];if(q+n>b.length)return;if(length+n<=LIMIT-131072){pieces.push(b.subarray(q,q+n));length+=n;}else{pieces=[];length=LIMIT-131072+1;}q+=n;if(n<255){if(length<=LIMIT-131072){const packet=new Uint8Array(length);let offset=0;for(const piece of pieces){packet.set(piece,offset);offset+=piece.length;}if(ascii(packet,0,8)==='OpusHead'){sampleRate=48000;preSkip=(packet[11]<<8)|packet[10];}else if(packet[0]===1&&ascii(packet,1,6)==='vorbis')sampleRate=u32(packet,12,true);else if(ascii(packet,0,8)==='OpusTags')comments(packet.subarray(8),out);else if(packet[0]===3&&ascii(packet,1,6)==='vorbis')comments(packet.subarray(7),out);}pieces=[];length=0;}}p=q;}
        if(sampleRate){let granule=0;for(let p=0;p+27<tail.length;p++){if(ascii(tail,p,4)==='OggS'&&u32(tail,p+14,true)===serial){const hi=u32(tail,p+10,true),lo=u32(tail,p+6,true);if(hi<0x100000)granule=Math.max(granule,hi*4294967296+lo);}}if(granule>preSkip)out.duration=(granule-preSkip)/sampleRate;}
    }
    function atoms(b,start,end,visit,depth=0){if(depth>8)return;for(let p=start,count=0;p+8<=end&&count++<4096;){let size=u32(b,p),head=8;const name=ascii(b,p+4,4);if(size===1){if(p+16>end||u32(b,p+8)>0x1fffff)return;size=u32(b,p+8)*4294967296+u32(b,p+12);head=16;}if(size===0)size=end-p;if(size<head||p+size>end)return;visit(name,p+head,p+size);p+=size;}}
    function mp4(b,out){function walk(start,end,depth){atoms(b,start,end,(name,a,z)=>{if(['moov','trak','mdia','udta','ilst'].includes(name))walk(a,z,depth+1);else if(name==='meta')walk(a+4,z,depth+1);else if(name==='mvhd'){const v=b[a],p=a+(v===1?20:12),scale=u32(b,p),duration=v===1?u32(b,p+4)*4294967296+u32(b,p+8):u32(b,p+4);if(scale&&duration/scale<=86400)out.duration=duration/scale;}else{const key={'©nam':'title','©ART':'artists','aART':'artists','©alb':'album','trkn':'trackNumber','disk':'discNumber','©lyr':'embeddedLyrics'}[name];if(key||name==='covr')atoms(b,a,z,(tag,c,d)=>{if(tag!=='data'||c+8>d)return;const payload=b.subarray(c+8,d);if(name==='covr')image(out,payload);else if(key==='trackNumber'||key==='discNumber'){if(payload.length>=4)field(out,key,String((payload[2]<<8)|payload[3]));}else if(payload.length<=MAXTEXT){const type=u32(b,c)&0xffffff;field(out,key,decode(payload,type===2?'utf-16be':'utf-8'));}},depth+1);}},depth);}walk(0,b.length,0);}
    function mp3Duration(b,start,fileSize,out){if(out.duration)return;for(let p=start;p+4<b.length&&p<start+65536;p++){if(b[p]!==255||(b[p+1]&0xe0)!==0xe0)continue;const version=(b[p+1]>>3)&3,layer=(b[p+1]>>1)&3,rateIndex=(b[p+2]>>2)&3,index=b[p+2]>>4;if(version===1||layer!==1||rateIndex===3||index===0||index===15)continue;const rate=[44100,48000,32000][rateIndex]/(version===3?1:version===2?2:4),bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index]*1000;const mono=(b[p+3]>>6)===3,x=p+4+((b[p+1]&1)?0:2)+(version===3?(mono?17:32):(mono?9:17));if(['Xing','Info'].includes(ascii(b,x,4))&&(u32(b,x+4)&1))out.duration=u32(b,x+8)*(version===3?1152:576)/rate;else{out.duration=Math.max(0,(fileSize-start)*8/bitrate);out.durationApproximate=true;}break;}}
    async function parseFile(file,options={}){
        abort(options.signal);if(!file?.slice)return{};const out={};let budget=LIMIT;
        const range=async(start,size)=>{abort(options.signal);size=Math.min(size,budget,Math.max(0,file.size-start));if(size<=0)return new Uint8Array();budget-=size;const bytes=new Uint8Array(await file.slice(start,start+size).arrayBuffer());abort(options.signal);return bytes;};
        try{const first=await range(0,65536),magic=ascii(first,0,4);
            if(magic==='fLaC'){const b=file.size>first.length?await range(0,Math.min(file.size,LIMIT-65536)):first;flac(b,out);}
            else if(magic==='OggS'){const b=file.size>first.length?await range(0,Math.min(file.size,LIMIT-131072)):first,tail=await range(Math.max(0,file.size-65536),65536);ogg(b,tail,out);}
            else if(ascii(first,4,4)==='ftyp'){let p=0;for(let i=0;i<2048&&p+8<=file.size;i++){const h=p===0?first:await range(p,16);if(h.length<8)break;let size=u32(h,0),head=8;if(size===1){size=u32(h,8)*4294967296+u32(h,12);head=16;}if(!size)size=file.size-p;if(size<head||p+size>file.size)break;if(ascii(h,4,4)==='moov'){if(size>budget)break;const atom=await range(p,size);mp4(atom,out);break;}p+=size;}}
            else{const tag=ascii(first,0,3)==='ID3'?10+sync(first,6):0,b=tag>first.length&&tag<LIMIT?await range(0,tag+65536):first;id3(b,out);mp3Duration(b,tag,file.size,out);}
        }catch(e){if(e.name==='AbortError')throw e;}
        if(!Number.isFinite(out.duration)||out.duration<=0||out.duration>86400){delete out.duration;delete out.durationApproximate;}
        return out;
    }
    async function read(file,options={}){
        abort(options.signal);
        if(options.worker!==false&&workerURL&&typeof root.Worker==='function'){
            let worker;try{worker=new root.Worker(workerURL);}catch(_){return parseFile(file,options);}
            try{return await new Promise((resolve,reject)=>{let timer;const finish=(error,result)=>{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(result||{});};const cancel=()=>{const e=Error('音频标签读取已取消');e.name='AbortError';finish(e);};options.signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>finish(null,{}),5000);worker.onmessage=e=>finish(null,e.data?.result);worker.onerror=()=>finish(null,{});try{worker.postMessage({file});}catch(_){finish(null,{});}});}catch(e){if(e.name==='AbortError')throw e;worker.terminate();return parseFile(file,options);}
        }return parseFile(file,options);
    }
    root.UvUMusicMetadata={read,parseFile,limits:{bytes:LIMIT,coverBytes:PICTURE,text:MAXTEXT}};
})(typeof window!=='undefined'?window:globalThis);
