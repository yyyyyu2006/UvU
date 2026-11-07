// Small bounded ID3 text reader; unsupported containers retain filename fallback.
(function(root){
    'use strict';
    const sync=b=>b.reduce((n,v)=>n*128+(v&127),0);
    async function read(file){
        try{
            if(!file?.slice)return{};const bytes=new Uint8Array(await file.slice(0,262144).arrayBuffer());
            if(bytes.length<10||String.fromCharCode(...bytes.slice(0,3))!=='ID3'||![3,4].includes(bytes[3])||(bytes[5]&0xc0))return{};
            const end=Math.min(bytes.length,10+sync(bytes.slice(6,10))),values={};let position=10;
            while(position+10<=end){const id=String.fromCharCode(...bytes.slice(position,position+4)),size=bytes[3]===4?sync(bytes.slice(position+4,position+8)):bytes.slice(position+4,position+8).reduce((n,v)=>n*256+v,0),flags=bytes[position+9];position+=10;
                if(!/^[A-Z0-9]{4}$/.test(id)||!size||position+size>end)break;
                const field={TIT2:'title',TPE1:'artists',TALB:'album'}[id];if(field&&!flags&&size<=8192){const frame=bytes.slice(position,position+size),encoding=['iso-8859-1','utf-16','utf-16be','utf-8'][frame[0]];if(encoding){const text=new TextDecoder(encoding).decode(frame.slice(1)).replace(/[\u0000-\u001f]/g,'').trim().slice(0,300);if(text)values[field]=field==='artists'?[text]:text;}}position+=size;
            }return values;
        }catch(_){return{};}
    }
    root.UvUMusicMetadata={read};
})(typeof window!=='undefined'?window:globalThis);
