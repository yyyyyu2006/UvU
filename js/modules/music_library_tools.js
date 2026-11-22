(function (root) {
    'use strict';
    // Optional library operations. Loading this module does not change playback or issue requests.
    const MAX_AUDIO = 30 * 1024 * 1024, MAX_MIGRATION = 512 * 1024 * 1024;
    const previews = new Map(), undos = new Map(), encoder = new TextEncoder(), decoder = new TextDecoder();
    const clone = value => JSON.parse(JSON.stringify(value));
    const str = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, max) : '';
    const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : 0;
    const M = () => { if (!root.UvUMusic) throw new Error('音乐资料库尚未加载'); return root.UvUMusic; };
    const abort = signal => { if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError'); };
    const uid = prefix => prefix + '_' + (root.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
    const key = track => M().key(track);
    const normalizedTracks = (raw, max = 2000) => {
        const seen = new Set(), result = [];
        for (const item of (Array.isArray(raw) ? raw : []).slice(0,110000)) try {
            const track = M().normalizeTrack(item), identity = key(track);
            if (!seen.has(identity)) { result.push(track); seen.add(identity); }
            if(result.length>=max)break;
        } catch (_) { /* Malformed imported items are never promoted to tracks. */ }
        return result;
    };
    function endpoint(value) {
        try { const u = new URL(value); return !u.username && !u.password && !u.search && !u.hash && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)) ? u.href.replace(/\/$/, '') : ''; } catch (_) { return ''; }
    }
    function draftValue(raw) {
        if (!raw || !['netease','qq','navidrome'].includes(raw.provider) || !str(String(raw.id || ''),160)) throw new Error('歌单草稿来源无效');
        const tracks = normalizedTracks(raw.tracks, 1000);
        if (tracks.some(t => t.provider !== raw.provider)) throw new Error('歌单歌曲来源不一致');
        const partial = raw.partial === true || raw.truncated === true || !!raw.reason;
        return { provider: raw.provider, id: str(String(raw.id),160), name: str(raw.name,160) || '导入歌单', sourceEndpoint: endpoint(raw.sourceEndpoint), tracks,
            partial, truncated: raw.truncated === true, reason: str(raw.reason,500), nextPage: Math.max(1,integer(raw.nextPage,101)),
            ...(Number.isInteger(raw.total) && raw.total >= 0 ? { total: integer(raw.total,100000) } : {}) };
    }
    function ruleValue(raw = {}) {
        if(!raw||typeof raw!=='object')raw={};
        return { artist: str(raw.artist,160), provider: str(raw.provider,40), favorite: typeof raw.favorite === 'boolean' ? raw.favorite : null,
            addedAfter: integer(raw.addedAfter), addedBefore: integer(raw.addedBefore), unheardDays: integer(raw.unheardDays,36500),
            search: str(raw.search,300), sort: ['title','artist','added','recent'].includes(raw.sort) ? raw.sort : 'title', descending: raw.descending === true };
    }
    function normalize(raw = {}) {
        if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
        const result = { version: 1, bindings: Object.create(null), drafts: Object.create(null), rules: [], fingerprints: Object.create(null),trackPlays:raw.trackPlays===true,lastPlayed:Object.create(null) };
        for (const [id,value] of Object.entries(raw.bindings || {}).slice(0,100)) try {
            if (!/^[\w-]{1,100}$/.test(id)) continue;
            const draft = draftValue(value);
            result.bindings[id] = { ...draft, localName: str(value.localName,160), savedAt: integer(value.savedAt) };
        } catch (_) {}
        for (const [id,value] of Object.entries(raw.drafts || {}).slice(0,20)) try {
            if (/^[\w-]{1,100}$/.test(id)) result.drafts[id] = { ...draftValue(value), savedAt: integer(value.savedAt) };
        } catch (_) {}
        for (const value of (Array.isArray(raw.rules) ? raw.rules : []).slice(0,100)) if (value&&/^[\w-]{1,100}$/.test(value.id || '')) result.rules.push({ id:value.id,name:str(value.name,160) || '规则歌单',rule:ruleValue(value.rule) });
        for (const [id,value] of Object.entries(raw.fingerprints || {}).slice(0,10000)) if (value&&/^[\w-]{1,160}$/.test(id) && /^[a-f0-9]{64}$/.test(value.digest || '') && integer(value.size)) result.fingerprints[id] = { size:integer(value.size),digest:value.digest };
        for (const [id,value] of Object.entries(raw.lastPlayed||{}).slice(-10000)) if (/^(?:netease|qq|gd-netease|local|navidrome):.{1,262}$/.test(id)&&integer(value)) result.lastPlayed[id]=value;
        // These fields belong to the core/lyrics normalizers; keep them across unrelated library edits.
        for (const field of ['playback','matches','lyrics']) if (raw[field] && JSON.stringify(raw[field]).length < 2 * 1024 * 1024) result[field] = clone(raw[field]);
        return result;
    }
    const tools = library => library.tools = normalize(library.tools || {});
    const playlist = (library,id) => { const p = library.playlists.find(p => p.id === id); if (!p) throw new Error('歌单已删除，请重新选择'); return p; };
    const revision = p => JSON.stringify(p);
    function remember(kind, value, output) {
        while (previews.size >= 30) previews.delete(previews.keys().next().value);
        const token = uid(kind); previews.set(token,{kind,value,until:Date.now()+30*60000});
        return { token, ...output };
    }
    function ticket(token,kind) {
        const t = previews.get(typeof token === 'object' ? token.token : token);
        if (!t || t.kind !== kind || t.until < Date.now()) throw new Error('预览已过期，请重新预览');
        return t.value;
    }
    function cancelPreview(token) { return previews.delete(typeof token === 'object' ? token.token : token); }
    async function saveDraft(raw, id = uid('draft')) {
        if (!/^[\w-]{1,100}$/.test(id)) throw new Error('草稿ID无效');
        const value = { ...draftValue(raw), savedAt:Date.now() };
        await M().mutateLibrary(lib => { const t = tools(lib); if (!t.drafts[id] && Object.keys(t.drafts).length >= 20) throw new Error('最多保存20个导入草稿'); t.drafts[id] = value; return lib; });
        return { ...clone(value),draftId:id };
    }
    const listDrafts = () => Object.entries(normalize(M().library().tools).drafts).map(([id,value]) => ({...value,draftId:id}));
    function loadDraft(id) { return listDrafts().find(d => d.draftId === id) || null; }
    async function deleteDraft(id) { return M().mutateLibrary(lib => { delete tools(lib).drafts[id]; return lib; }); }
    async function resumeDraft(id,{signal,progress} = {}) {
        const old = loadDraft(id); if (!old) throw new Error('草稿不存在');
        const host = M().settings().endpoint;
        const resume = old.savedAt > Date.now()-24*60*60000 && endpoint(host) === old.sourceEndpoint && old.partial ? old : undefined;
        try {
            const next = await M().previewPlaylist(old.id,old.provider,signal,progress,resume);
            abort(signal); return await saveDraft(next,id);
        } catch (error) { if (error.preview && error.name !== 'AbortError') await saveDraft(error.preview,id); throw error; }
    }
    async function importDraft(id,{selectedKeys,signal,bind = true} = {}) {
        const saved = loadDraft(id); if (!saved) throw new Error('草稿不存在'); abort(signal);
        if(saved.savedAt<Date.now()-24*60*60000)throw new Error('草稿快照已过期，请先继续读取并重新核对来源');
        if (saved.sourceEndpoint && saved.sourceEndpoint !== endpoint(M().settings().endpoint)) throw new Error('音乐服务已更换，请先重新读取草稿');
        const selected = selectedKeys ? new Set(selectedKeys) : null, songs = saved.tracks.filter(t => !selected || selected.has(key(t)));
        if (!songs.length) throw new Error('请至少选择一首歌曲');
        const newId=uid('music'), now=Date.now();
        await M().mutateLibrary(lib => {
            abort(signal); if(saved.sourceEndpoint&&saved.sourceEndpoint!==endpoint(M().settings().endpoint))throw new Error('音乐服务已更换，请先重新读取草稿');if (revision(tools(lib).drafts[id]) !== revision((({draftId,...rest})=>rest)(saved))) throw new Error('草稿已改变，请重新打开');
            if (lib.playlists.length >= 100) throw new Error('最多保存100个歌单');
            lib.playlists.push({id:newId,name:saved.name,tracks:songs.map(t=>({...t,addedAt:now}))});
            if (bind) lib.tools.bindings[newId]={...draftValue(saved),localName:saved.name,savedAt:now};
            delete lib.tools.drafts[id]; return lib;
        });
        return {...playlist(M().library(),newId),partial:saved.partial,imported:songs.length,sourceRead:saved.tracks.length,total:saved.total};
    }
    async function bindPlaylist(id,raw) {
        const draft=draftValue(raw);
        return M().mutateLibrary(lib=>{const p=playlist(lib,id);tools(lib).bindings[id]={...draft,localName:p.name,savedAt:Date.now()};return lib;});
    }
    function previewSync(id,raw) {
        const lib=M().library(), p=playlist(lib,id), binding=normalize(lib.tools).bindings[id];
        if (!binding) throw new Error('这个歌单尚未绑定来源');
        const draft=draftValue(raw);
        if (draft.provider!==binding.provider || draft.id!==binding.id || draft.sourceEndpoint!==binding.sourceEndpoint || draft.sourceEndpoint && draft.sourceEndpoint!==endpoint(M().settings().endpoint)) throw new Error('来源已改变，请重新绑定');
        const old=new Set(binding.tracks.map(key)), now=new Set(draft.tracks.map(key)), current=new Set(p.tracks.map(key));
        const added=draft.tracks.filter(t=>!old.has(key(t))&&!current.has(key(t))), removed=p.tracks.filter(t=>old.has(key(t))&&!now.has(key(t)));
        const metadata=t=>JSON.stringify([t.title,t.artists,t.album,t.cover,t.duration]),baseline=new Map(binding.tracks.map(t=>[key(t),t])),locals=new Map(p.tracks.map(t=>[key(t),t]));
        const changed=draft.tracks.filter(t=>baseline.has(key(t))&&locals.has(key(t))&&metadata(t)!==metadata(baseline.get(key(t)))).map(t=>({before:baseline.get(key(t)),after:t,localEdited:metadata(locals.get(key(t)))!==metadata(baseline.get(key(t)))}));
        return remember('sync',{id,draft,binding,version:revision(p),added,removed,changed},{added:clone(added),removed:clone(removed),changed:clone(changed),renamed:draft.name!==binding.name?{before:binding.name,after:draft.name}:null,partial:draft.partial,canRemove:!draft.partial,localNamePreserved:p.name!==binding.localName});
    }
    async function applySync(token,{remove = false,rename = false,updateMetadata=false,signal} = {}) {
        const preview=ticket(token,'sync'); abort(signal);
        if (remove && preview.draft.partial) throw new Error('来源尚未完整读取，不能同步删除');
        await M().mutateLibrary(lib=>{
            abort(signal);const p=playlist(lib,preview.id), t=tools(lib);
            if(preview.draft.sourceEndpoint&&preview.draft.sourceEndpoint!==endpoint(M().settings().endpoint))throw new Error('音乐服务已更换，请重新预览');
            if (revision(p)!==preview.version || revision(t.bindings[preview.id])!==revision(preview.binding)) throw new Error('歌单已被修改，请重新预览差异');
            const before=clone(p), removeKeys=new Set(remove?preview.removed.map(key):[]);
            p.tracks=p.tracks.filter(t=>!removeKeys.has(key(t))).concat(preview.added.map(t=>({...t,addedAt:Date.now()})));
            if(updateMetadata){const edits=new Map(preview.changed.filter(c=>!c.localEdited).map(c=>[key(c.after),c.after]));p.tracks=p.tracks.map(t=>edits.has(key(t))?{...edits.get(key(t)),...(t.addedAt?{addedAt:t.addedAt}:{})}:t);}
            if(p.tracks.length>1000)throw new Error('同步后超过1000首，请先整理歌单');
            if(rename && p.name===preview.binding.localName)p.name=preview.draft.name;
            t.bindings[p.id]={...preview.draft,localName:p.name===preview.binding.localName||rename&&before.name===preview.binding.localName?p.name:preview.binding.localName,savedAt:Date.now()};
            // Keep the old source membership for deletions skipped by an add-only sync.
            if(!remove) t.bindings[p.id].tracks=normalizedTracks([...preview.draft.tracks,...preview.removed],1000);
            preview.undo={before,after:revision(p),bindingBefore:preview.binding,bindingAfter:clone(t.bindings[p.id])};return lib;
        });
        cancelPreview(token);return {playlist:playlist(M().library(),preview.id),undoToken:rememberUndo(preview.undo)};
    }
    function rememberUndo(value){while(undos.size>=20)undos.delete(undos.keys().next().value);const token=uid('undo');undos.set(token,{...value,until:Date.now()+5*60000});return token;}
    async function undo(token){const u=undos.get(token);if(!u||u.until<Date.now())throw new Error('撤销已过期');await M().mutateLibrary(lib=>{const id=u.before?.id||u.createdId,p=playlist(lib,id);if(revision(p)!==u.after)throw new Error('歌单已有后续修改，不能覆盖撤销');const t=tools(lib);if(u.bindingAfter&&revision(t.bindings[id])!==revision(u.bindingAfter))throw new Error('来源绑定已修改');if(u.before)lib.playlists[lib.playlists.indexOf(p)]=clone(u.before);else lib.playlists=lib.playlists.filter(p=>p.id!==id);if(u.bindingBefore)t.bindings[id]=clone(u.bindingBefore);else if(u.createdId)delete t.bindings[id];return lib;});undos.delete(token);return true;}
    async function reorderPlaylist(id,from,to){let state;await M().mutateLibrary(lib=>{const p=playlist(lib,id);if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=p.tracks.length||to>=p.tracks.length)throw new Error('歌曲位置无效');const before=clone(p);p.tracks.splice(to,0,p.tracks.splice(from,1)[0]);state={before,after:revision(p)};return lib;});return {undoToken:rememberUndo(state)};}
    async function copyPlaylist(id,name){const newId=uid('music');let after;await M().mutateLibrary(lib=>{const p=playlist(lib,id);if(lib.playlists.length>=100)throw new Error('最多保存100个歌单');const copied={id:newId,name:str(name,160)||p.name+' 副本',tracks:clone(p.tracks)};lib.playlists.push(copied);after=revision(copied);return lib;});return {playlist:playlist(M().library(),newId),undoToken:rememberUndo({createdId:newId,after})};}
    function previewMerge(targetId,sourceIds){const lib=M().library(),target=playlist(lib,targetId),sources=[...new Set(sourceIds)].filter(id=>id!==targetId).map(id=>playlist(lib,id)),seen=new Set(target.tracks.map(key)),added=[],duplicates=[];for(const p of sources)for(const t of p.tracks){if(seen.has(key(t)))duplicates.push(t);else{seen.add(key(t));added.push(t);}}return remember('merge',{targetId,versions:[target,...sources].map(p=>[p.id,revision(p)]),added},{added:clone(added),duplicates:clone(duplicates),dedupe:'source-id'});}
    async function mergePlaylists(token){const p=ticket(token,'merge');let u;await M().mutateLibrary(lib=>{for(const[id,version]of p.versions)if(revision(playlist(lib,id))!==version)throw new Error('歌单已改变，请重新预览');const target=playlist(lib,p.targetId),before=clone(target);if(target.tracks.length+p.added.length>1000)throw new Error('合并后超过1000首');target.tracks.push(...clone(p.added));u={before,after:revision(target)};return lib;});cancelPreview(token);return{undoToken:rememberUndo(u)};}
    function allTracks(lib=M().library()){return normalizedTracks([...(lib.favorites||[]),...(lib.playlists||[]).flatMap(p=>p.tracks||[]),...(lib.recent||[]),...(lib.queue||[])],110000);}
    function filterTracks(raw={},now=Date.now()){
        const lib=M().library(),rule=ruleValue(raw),fav=new Set(lib.favorites.map(key)),played=normalize(lib.tools).lastPlayed,collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
        const result=allTracks(lib).filter(t=>(!rule.artist||t.artists.some(a=>a.toLocaleLowerCase().includes(rule.artist.toLocaleLowerCase())))&&(!rule.provider||t.provider===rule.provider)&&(rule.favorite===null||fav.has(key(t))===rule.favorite)&&(!rule.addedAfter||t.addedAt>=rule.addedAfter)&&(!rule.addedBefore||t.addedAt&&t.addedAt<=rule.addedBefore)&&(!rule.unheardDays||!played[key(t)]||played[key(t)]<=now-rule.unheardDays*86400000)&&(!rule.search||[t.title,t.album,...t.artists].join(' ').toLocaleLowerCase().includes(rule.search.toLocaleLowerCase())));
        const field=t=>rule.sort==='artist'?t.artists.join(' '):rule.sort==='added'?t.addedAt||0:rule.sort==='recent'?played[key(t)]||0:t.title;
        return result.sort((a,b)=>{const x=field(a),y=field(b),order=typeof x==='number'?x-y:collator.compare(x,y);return(rule.descending?-order:order)||collator.compare(key(a),key(b));});
    }
    async function saveRule(name,raw,id=uid('rule')){await M().mutateLibrary(lib=>{const t=tools(lib),index=t.rules.findIndex(r=>r.id===id),value={id,name:str(name,160)||'规则歌单',rule:ruleValue(raw)};if(value.rule.unheardDays)t.trackPlays=true;if(index<0){if(t.rules.length>=100)throw new Error('最多保存100个规则歌单');t.rules.push(value);}else t.rules[index]=value;return lib;});return id;}
    const listRules=()=>normalize(M().library().tools).rules;
    function runRule(id){const r=listRules().find(r=>r.id===id);if(!r)throw new Error('规则歌单不存在');return filterTracks(r.rule);}
    const removeRule=id=>M().mutateLibrary(lib=>{tools(lib).rules=tools(lib).rules.filter(r=>r.id!==id);return lib;});
    async function digest(blob,signal){abort(signal);if(!root.crypto?.subtle)throw new Error('当前环境无法校验文件，请使用HTTPS页面');const hash=await root.crypto.subtle.digest('SHA-256',await blob.arrayBuffer());abort(signal);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
    async function fingerprint(file,signal){const chunk=65536;return{size:file.size,digest:await digest(new Blob([String(file.size),file.slice(0,chunk),file.slice(Math.max(0,Math.floor(file.size/2)-chunk/2),Math.floor(file.size/2)+chunk/2),file.slice(Math.max(0,file.size-chunk))]),signal)};}
    async function capacity(bytes){let estimate={};try{estimate=await root.navigator?.storage?.estimate?.()||{};}catch(_){}const available=Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)?Math.max(0,estimate.quota-estimate.usage):null;if(available!==null&&bytes*1.1>available)throw new Error('可用空间不足，请先释放空间再导入');return{...estimate,available,required:bytes,known:available!==null};}
    async function previewBatch(files,{signal,progress}={}){
        const input=Array.from(files||[]);if(!input.length||input.length>500)throw new Error('每批请选择1至500个文件');
        const records=await M().localFiles.list(),known=[];
        for(const record of records){abort(signal);if(record.blob?.size>0){const fp=await fingerprint(record.blob,signal);known.push({id:record.id,...fp});}}
        const entries=[];
        for(let index=0;index<input.length;index++){abort(signal);const file=input[index];if(!file||!Number.isFinite(file.size)||file.size<=0||file.size>MAX_AUDIO){entries.push({index,name:str(file?.name,300),size:file?.size||0,status:'invalid',error:'单个音频须大于0且不超过30MB'});continue;}const fp=await fingerprint(file,signal),duplicate=known.filter(k=>k.size===fp.size&&k.digest===fp.digest).map(k=>k.id);for(const previous of entries)if(previous.fingerprint?.size===fp.size&&previous.fingerprint.digest===fp.digest)duplicate.push('batch:'+previous.index);entries.push({index,name:str(file.name,300),size:file.size,status:'ready',fingerprint:fp,duplicates:duplicate});progress?.({phase:'preview',index:index+1,total:input.length});}
        const space=await capacity(entries.filter(e=>e.status==='ready'&&!e.duplicates.length).reduce((n,e)=>n+e.size,0));
        return remember('batch',{files:input,entries},{entries:clone(entries),space});
    }
    async function importBatch(token,{selectedIndices,signal,progress}={}){
        const batch=ticket(token,'batch'),selected=selectedIndices?new Set(selectedIndices):new Set(batch.entries.filter(e=>e.status==='ready'&&!e.duplicates.length).map(e=>e.index)),results=[];
        await capacity(batch.entries.filter(e=>selected.has(e.index)&&e.status==='ready').reduce((n,e)=>n+e.size,0));
        for(const e of batch.entries){if(!selected.has(e.index))continue;if(signal?.aborted){results.push({index:e.index,status:'cancelled'});continue;}if(e.status!=='ready'){results.push({index:e.index,status:'failed',error:e.error});continue;}
            try{const track=await M().importLocal(batch.files[e.index],{signal});let warning='';try{await M().mutateLibrary(lib=>{tools(lib).fingerprints[track.localId]=e.fingerprint;return lib;});}catch(_){warning='音频已保存，重复检测记录未保存';}results.push({index:e.index,status:'success',track,warning});}catch(error){results.push({index:e.index,status:error.name==='AbortError'?'cancelled':'failed',error:str(error.message,500)});}progress?.({phase:'import',completed:results.length,total:selected.size,result:results.at(-1)});
        }
        cancelPreview(token);return results;
    }
    const referencedIds=lib=>new Set(allTracks(lib).map(t=>t.localId).filter(Boolean));
    function portable(lib){return {favorites:normalizedTracks(lib.favorites),playlists:lib.playlists.map(p=>({id:p.id,name:p.name,tracks:normalizedTracks(p.tracks,1000)})),recent:normalizedTracks(lib.recent,100),queue:normalizedTracks(lib.queue,500)};}
    async function exportAudioPackages({partSize=16*1024*1024,signal,progress}={}){
        partSize=Math.floor(partSize);if(partSize<1024||partSize>64*1024*1024)throw new Error('分包大小须为1KiB至64MiB');
        const lib=portable(M().library()),ids=[...referencedIds(lib)],files=[],missing=[];let total=0;
        for(const id of ids){abort(signal);const record=await M().localFiles.get(id);if(!record?.blob){missing.push(id);continue;}if(record.blob.size>MAX_AUDIO)throw new Error('单个音频超过迁移预算');total+=record.blob.size;if(total>MAX_MIGRATION)throw new Error('单次迁移最多512MiB，请分批迁移');files.push({id,size:record.blob.size,type:str(record.blob.type,100),sha256:await digest(record.blob,signal),blob:record.blob});progress?.({phase:'hash',completed:files.length,total:ids.length});}
        const chunks=[];let parts=[{chunks:[],size:0}];
        for(const file of files)for(let offset=0;offset<file.size;){let part=parts.at(-1);if(part.size>=partSize){part={chunks:[],size:0};parts.push(part);}const length=Math.min(file.size-offset,partSize-part.size),chunk={id:file.id,offset,length,position:part.size};part.chunks.push(chunk);chunks.push(chunk);part.size+=length;offset+=length;}
        const missingSources=allTracks(lib).filter(t=>t.provider==='local'&&!t.localId).map(t=>({key:key(t),title:t.title}));
        const packId=uid('pack'),manifest={format:'uvu-music-audio',version:1,packId,partCount:parts.length,library:lib,files:files.map(({blob,...rest})=>rest),missing,missingSources};
        const output=parts.map((part,index)=>{const meta=encoder.encode(JSON.stringify({...manifest,index,chunks:part.chunks}));if(meta.length>4*1024*1024)throw new Error('迁移清单过大');const header=new Uint8Array(12);header.set(encoder.encode('UVUMA001'));new DataView(header.buffer).setUint32(8,meta.length,true);return{name:`${packId}.${index+1}-of-${parts.length}.uvuma`,blob:new Blob([header,meta,...part.chunks.map(c=>files.find(f=>f.id===c.id).blob.slice(c.offset,c.offset+c.length))],{type:'application/x-uvu-music-audio'}),index};});
        return{format:manifest.format,version:1,files:output,missing,missingSources,audioCount:files.length,audioBytes:total,includesAudio:true};
    }
    async function previewAudioImport(parts,{signal}={}){
        const input=Array.from(parts||[]);if(!input.length||input.length>1024)throw new Error('请选择完整音频分包');let manifest,signature,totalBytes=0;const segments=new Map(),seenParts=new Set();
        for(const blob of input){abort(signal);if(blob.size>70*1024*1024)throw new Error('音频分包过大');const header=new Uint8Array(await blob.slice(0,12).arrayBuffer());if(header.length!==12||decoder.decode(header.slice(0,8))!=='UVUMA001')throw new Error('这不是UvU音频迁移包');const size=new DataView(header.buffer).getUint32(8,true);if(size>4*1024*1024||size+12>blob.size)throw new Error('音频清单损坏');let data;try{data=JSON.parse(decoder.decode(await blob.slice(12,12+size).arrayBuffer()));}catch(_){throw new Error('音频清单无法读取');}if(data.version!==1||data.format!=='uvu-music-audio'||!Array.isArray(data.files)||!Array.isArray(data.chunks)||data.files.length>10000||!Number.isInteger(data.index)||data.index<0||data.index>=data.partCount||data.partCount!==input.length||seenParts.has(data.index))throw new Error('音频分包缺失、重复或版本不支持');seenParts.add(data.index);const{index,chunks,...shared}=data,current=JSON.stringify(shared);if(signature&&signature!==current)throw new Error('分包来自不同备份');signature=current;manifest=shared;let position=0;
            for(const chunk of chunks){if(!chunk||!Number.isSafeInteger(chunk.length)||chunk.length<=0||!Number.isSafeInteger(chunk.offset)||chunk.offset<0||chunk.position!==position||position+chunk.length>blob.size-12-size)throw new Error('音频分片位置无效');if(!segments.has(chunk.id))segments.set(chunk.id,[]);segments.get(chunk.id).push({offset:chunk.offset,length:chunk.length,blob:blob.slice(12+size+position,12+size+position+chunk.length)});position+=chunk.length;}if(position!==blob.size-12-size)throw new Error('音频包包含多余数据');totalBytes+=position;if(totalBytes>MAX_MIGRATION)throw new Error('迁移包超过512MiB');
        }
        const files=[],ids=new Set();let expected=0;
        for(const f of manifest.files){if(!/^[\w-]{1,160}$/.test(f.id||'')||ids.has(f.id)||!Number.isSafeInteger(f.size)||f.size<=0||f.size>MAX_AUDIO||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw new Error('音频文件清单无效');ids.add(f.id);const pieces=(segments.get(f.id)||[]).sort((a,b)=>a.offset-b.offset);let offset=0;for(const piece of pieces){if(piece.offset!==offset)throw new Error('音频分片缺失或重叠');offset+=piece.length;}if(offset!==f.size)throw new Error('音频文件不完整');const blob=new Blob(pieces.map(p=>p.blob),{type:str(f.type,100)});if(await digest(blob,signal)!==f.sha256)throw new Error('音频校验失败，未改动资料库');files.push({sourceId:f.id,blob});expected+=f.size;}
        if(expected!==totalBytes||segments.size!==ids.size)throw new Error('分片与文件清单不一致');
        const lib=portable(M().normalizeLibrary(manifest.library||{})),space=await capacity(expected);
        return remember('audioImport',{files,library:lib},{audioCount:files.length,audioBytes:expected,playlists:lib.playlists.map(p=>({name:p.name,count:p.tracks.length})),missing:[...referencedIds(lib)].filter(id=>!ids.has(id)),missingSources:allTracks(lib).filter(t=>t.provider==='local'&&!t.localId).map(t=>({key:key(t),title:t.title})),space});
    }
    async function fileLock(fn){if(typeof M().withLocalFileLock!=='function'||M().canLockLocalFiles?.()===false)throw new Error('当前浏览器不能安全锁定本地文件，请更换支持Web Locks的浏览器');return M().withLocalFileLock(fn);}
    async function importAudioPackages(token,{signal}={}){
        const p=ticket(token,'audioImport');abort(signal);
        return fileLock(async()=>{await M().refreshLibrary?.();await capacity(p.files.reduce((n,f)=>n+f.blob.size,0));const written=[],mapping=new Map(),missing=new Map();
            for(const id of referencedIds(p.library))mapping.set(id,uid('audio'));
            const trackMapping=new Map();
            const replace=tracks=>tracks.map(t=>{if(t.provider!=='local')return t;const identity=key(t);if(!trackMapping.has(identity))trackMapping.set(identity,uid('music'));return {...t,id:trackMapping.get(identity),...(t.localId?{localId:mapping.get(t.localId)}:{})};});
            try{for(const file of p.files){abort(signal);const id=mapping.get(file.sourceId)||uid('audio');mapping.set(file.sourceId,id);if(await M().localFiles.get(id))throw new Error('迁移文件ID冲突，请重试');await M().localFiles.put({id,blob:file.blob});written.push(id);}
                const newIds=[];await M().mutateLibrary(lib=>{abort(signal);if(lib.playlists.length+p.library.playlists.length>100)throw new Error('导入后歌单超过100个');const mergedFavorites=[...lib.favorites,...replace(p.library.favorites)];if(new Set(mergedFavorites.map(key)).size>2000)throw new Error('导入后收藏超过2000首');lib.favorites=normalizedTracks(mergedFavorites);for(const list of p.library.playlists){const id=uid('music');lib.playlists.push({id,name:list.name,tracks:replace(list.tracks)});newIds.push(id);}lib.recent=normalizedTracks([...lib.recent,...replace(p.library.recent)],100);lib.queue=normalizedTracks([...lib.queue,...replace(p.library.queue)],500);return lib;});cancelPreview(token);return{audioCount:written.length,playlistIds:newIds,missing:[...mapping].filter(([id])=>!p.files.some(f=>f.sourceId===id)).map(([oldId,localId])=>({oldId,localId})),mapping:Object.fromEntries(mapping)};
            }catch(error){const rollback=[];for(const id of written)try{await M().localFiles.remove(id);}catch(_){rollback.push(id);}if(rollback.length){error.rollbackFailed=rollback;error.message+='；部分新文件回滚失败，可在存储维护中预览清理';}throw error;}
        });
    }
    async function relinkLocal(localId,file,{signal}={}){
        abort(signal);if(!file||file.size<=0||file.size>MAX_AUDIO)throw new Error('请选择不超过30MB的音频');
        return fileLock(async()=>{await M().refreshLibrary?.();if(!referencedIds(M().library()).has(localId))throw new Error('歌曲已不再引用此文件');if(await M().localFiles.get(localId))throw new Error('此歌曲已有音频，未覆盖');await capacity(file.size);abort(signal);await M().localFiles.put({id:localId,blob:file});return localId;});
    }
    function relinkSource(trackKey,url){const track=allTracks().find(t=>key(t)===trackKey);if(!track||track.provider!=='local'||track.localId)throw new Error('此歌曲不是需要恢复音源链接的歌曲');return M().importURL(url,track);}
    async function storageUsage(){const records=await M().localFiles.list(),lib=M().library(),refs=await protectedFileIds(lib),ids=new Set(records.map(r=>r.id));let estimate={};try{estimate=await root.navigator?.storage?.estimate?.()||{};}catch(_){}return{audioBytes:records.reduce((n,r)=>n+(r.blob?.size||0),0),audioCount:records.length,siteUsage:estimate.usage??null,siteQuota:estimate.quota??null,orphanCount:records.filter(r=>!refs.has(r.id)).length,missing:[...refs].filter(id=>!ids.has(id)),missingSources:allTracks(lib).filter(t=>t.provider==='local'&&!t.localId&&!M().hasDirectSource?.(t)).map(t=>({key:key(t),title:t.title,verified:typeof M().hasDirectSource==='function'})),persistent:await root.navigator?.storage?.persisted?.()||false};}
    async function protectedFileIds(lib){const ids=referencedIds(lib),state=M().player?.snapshot?.()||{};for(const t of [state.track,...(state.queue||[])])if(t?.localId)ids.add(t.localId);for(const id of await M().localFileReferences?.()||[])ids.add(id);return ids;}
    async function previewCleanup({signal}={}){abort(signal);await M().refreshLibrary?.();const lib=M().library(),refs=await protectedFileIds(lib),records=await M().localFiles.list(),candidates=[];for(const record of records){abort(signal);if(!refs.has(record.id))candidates.push({id:record.id,size:record.blob?.size||0,digest:record.blob?await digest(record.blob,signal):''});}return remember('cleanup',{candidates,libraryVersion:JSON.stringify(portable(lib))},{candidates:clone(candidates),bytes:candidates.reduce((n,r)=>n+r.size,0),requiresConfirmation:true});}
    async function cleanup(token,{signal,confirmed=false}={}){
        if(!confirmed)throw new Error('请先确认要删除预览中的孤立音频');if(typeof M().localFileReferences!=='function')throw new Error('无法核对聊天卡片和存档引用，本次仅提供清理预览');const p=ticket(token,'cleanup');abort(signal);
        return fileLock(async()=>{await M().refreshLibrary?.();let lib=M().library();if(JSON.stringify(portable(lib))!==p.libraryVersion)throw new Error('资料库已改变，请重新预览清理');const removed=[],retained=[],backup=[];
            try{for(const candidate of p.candidates){abort(signal);await M().refreshLibrary?.();lib=M().library();if((await protectedFileIds(lib)).has(candidate.id)){retained.push(candidate.id);continue;}const record=await M().localFiles.get(candidate.id);if(!record)continue;if((record.blob?.size||0)!==candidate.size||(record.blob?await digest(record.blob,signal):'')!==candidate.digest)throw new Error('文件已改变，请重新预览清理');if((await protectedFileIds(M().library())).has(candidate.id)){retained.push(candidate.id);continue;}backup.push(record);await M().localFiles.remove(candidate.id);removed.push(candidate.id);}cancelPreview(token);return{removed,retained};}catch(error){const failed=[];for(const record of backup)try{await M().localFiles.put(record);}catch(_){failed.push(record.id);}if(failed.length){error.rollbackFailed=failed;error.message+='；清理回滚失败';}throw error;}
        });
    }
    const requestPersistentStorage=async()=>({supported:typeof root.navigator?.storage?.persist==='function',granted:await root.navigator?.storage?.persist?.()||false,isBackup:false});
    root.UvUMusicLibraryTools={normalize,cancelPreview,saveDraft,listDrafts,loadDraft,deleteDraft,resumeDraft,importDraft,bindPlaylist,previewSync,applySync,reorderPlaylist,copyPlaylist,previewMerge,mergePlaylists,undo,filterTracks,saveRule,listRules,runRule,removeRule,previewBatch,importBatch,exportAudioPackages,previewAudioImport,importAudioPackages,relinkLocal,relinkSource,storageUsage,previewCleanup,cleanup,requestPersistentStorage};
})(typeof window!=='undefined'?window:globalThis);
