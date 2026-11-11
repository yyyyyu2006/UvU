// Read-only observation of the final provider body. No payload or credentials are retained.
(function(root){
    'use strict';
    const records=new Map(),SETTING='uvu-request-diagnostics.v1',MAX_FIELDS=256,MAX_CHARS=2*1024*1024,TTL=60*60*1000;
    let enabled=false,sequence=0;
    try{enabled=root.localStorage?.getItem(SETTING)==='true';}catch(_){}
    const compact=(value,max=100)=>String(value??'').slice(0,max);
    function hash(text){let a=2166136261,b=5381;for(const c of String(text)){const n=c.codePointAt(0);a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n;}return (a>>>0).toString(16)+(b>>>0).toString(16);}
    function key(chat,type){return JSON.stringify([String(chat.id),type,String(chat.activeArchiveId??''),hash(JSON.stringify([chat.myName,chat.myPersona,chat.me?.persona]))]);}
    function prune(){for(const [id,r]of records)if(Date.now()-r.timestamp>TTL)records.delete(id);while(records.size>16)records.delete(records.keys().next().value);}
    function setEnabled(value){const next=value===true;root.localStorage.setItem(SETTING,String(next));enabled=next;if(!enabled)records.clear();return enabled;}
    function begin(chat,type,body,options={}){
        if(!enabled||!chat||!body)return null;
        const fields=[],texts=[];let textChars=0,fieldCount=0,opaqueParts=0,scanned=0,truncated=false;
        const add=(text,path,role)=>{if(typeof text!=='string')return;textChars+=text.length;fieldCount++;
            if(fields.length<MAX_FIELDS)fields.push({path,role:['system','user','assistant','model','tool'].includes(role)?role:'other',chars:text.length});else truncated=true;
            const size=texts.length<MAX_FIELDS?Math.min(text.length,Math.max(0,MAX_CHARS-scanned)):0;if(size)texts.push({text:text.slice(0,size),path,system:role==='system'});scanned+=size;if(size<text.length)truncated=true;};
        if(Array.isArray(body.messages))body.messages.forEach((m,i)=>{const path='messages['+i+'].content';if(typeof m.content==='string')add(m.content,path,m.role);else if(Array.isArray(m.content))m.content.forEach((p,j)=>{if(typeof p?.text==='string')add(p.text,path+'['+j+'].text',m.role);else opaqueParts++;});});
        else if(Array.isArray(body.contents)){
            (body.system_instruction?.parts||[]).forEach((p,j)=>{if(typeof p?.text==='string')add(p.text,'system_instruction.parts['+j+'].text','system');else opaqueParts++;});
            body.contents.forEach((m,i)=>(m.parts||[]).forEach((p,j)=>{if(typeof p?.text==='string')add(p.text,'contents['+i+'].parts['+j+'].text',m.role);else opaqueParts++;}));
        }
        const match=(fragment,systemOnly=false)=>{if(typeof fragment!=='string'||!fragment)return {chars:0,matched:false,paths:[]};const paths=texts.filter(f=>(!systemOnly||f.system)&&f.text.includes(fragment)).map(f=>f.path);return {chars:fragment.length,matched:paths.length?true:truncated?null:false,paths:paths.slice(0,8)};};
        const blocks=[];
        for(const kind of ['memo','vector','environment','mcp','documents','music','calendar','sticker'])blocks.push({kind,...match(options.blocks?.[kind],true)});
        const sources=(values,systemOnly)=>Array.isArray(values)?values.slice(0,100).map(v=>({id:compact(v.id),label:compact(v.title||v.name||v.id,80),...match(v.fragment,systemOnly)})):[];
        const report={id:++sequence,timestamp:Date.now(),status:'dispatched',textChars,fieldCount,opaqueParts,fields,truncated,
            blocks,journals:sources(options.journals,true),worldBooks:sources(options.worldBooks,false),sourcesTruncated:(options.journals?.length>100||options.worldBooks?.length>100)===true};
        const id=key(chat,type);records.delete(id);records.set(id,report);prune();return {key:id,id:report.id};
    }
    function finish(ticket,status){if(!enabled||!ticket)return;prune();const report=records.get(ticket.key);if(report?.id===ticket.id&&['completed','failed','cancelled','stale'].includes(status))report.status=status;}
    function get(chat,type='private'){if(!enabled||!chat)return null;prune();const value=records.get(key(chat,type));return value?JSON.parse(JSON.stringify(value)):null;}
    function clear(chat,type='private'){if(chat)records.delete(key(chat,type));else records.clear();}
    root.UvURequestDiagnostics={isEnabled:()=>enabled,setEnabled,begin,finish,get,clear};
})(typeof globalThis!=='undefined'?globalThis:window);
