// Character-scoped memo manager; all user text is rendered as text nodes.
function openCharacterMemos(target) {
    const chat=target || (typeof currentChatType!=='undefined'&&currentChatType==='private' ? db.characters.find(c=>c.id===currentChatId) : null);
    if(!chat)return showToast('请先打开角色私聊');
    const owner=characterMemoOwner(chat), d=createMessageForwardDialog('备忘录','character-memos-dialog');
    d.panel.classList.add('derived-settings','character-memos-panel');
    const node=(tag,cls,text)=>messageForwardNode(tag,cls,text);
    const body=node('div','derived-body'), feedback=node('p','memo-feedback');feedback.setAttribute('aria-live','polite');
    const guard=()=>{if(!characterMemoCurrent(owner))throw new Error('当前角色、存档或用户已改变，请重新打开备忘录');};
    let busy=false,undo=null;
    const execute=async(action)=>{if(busy)return;busy=true;d.setBusy(true);feedback.textContent='';try{guard();await action();if(characterMemoCurrent(owner)&&d.panel.isConnected)render();}catch(error){feedback.textContent=error.name==='AbortError'?'记录请求超时，请重试':error.message;}finally{busy=false;d.setBusy(false);}};
    const button=(text,action,cls='')=>{const b=node('button',cls,text);b.type='button';b.onclick=()=>execute(action);return b;};
    const settings=node('section','memo-settings draft-card');
    const toggle=(name,label)=>{const row=node('label','memo-switch-row'),i=node('input','panel-switch');i.type='checkbox';i.setAttribute('role','switch');i.setAttribute('aria-label',label);i.checked=characterMemoSettings(chat)[name];row.append(node('span','',label),i);settings.append(row);i.onchange=()=>{const value=i.checked;execute(async()=>{const next=characterMemoState(chat);next.settings={...next.settings,[name]:value};await saveCharacterMemoState(owner,next);if(name==='enabled'&&!value){const key=JSON.stringify([chat.id,owner.archive,owner.persona]);characterMemoJobs.get(key)?.abort();clearTimeout(characterMemoTimers.get(key));characterMemoTimers.delete(key);}}).then(()=>i.checked=characterMemoSettings(chat)[name]);};return i;};
    const enabled=toggle('enabled','启用备忘录'),auto=toggle('automatic','自主记录'),context=toggle('useContext','用于对话');
    const advanced=node('details','memo-options'),more=node('summary','','记录设置');advanced.append(more);
    const select=(name,label,options)=>{const row=node('label','memo-setting',label),s=node('select');s.setAttribute('aria-label',label);for(const [v,t]of options){const o=node('option','',t);o.value=v;s.append(o);}s.value=characterMemoSettings(chat)[name];s.onchange=()=>execute(async()=>{const next=characterMemoState(chat);next.settings={...next.settings,[name]:s.value};await saveCharacterMemoState(owner,next);});row.append(s);advanced.append(row);return s;};
    const mode=select('mode','记录方式',[['auto','自动保存明确事实'],['review','审核后使用'],['manual','手动整理']]);
    const api=select('apiSource','整理 API',[['journal','沿用日记 API'],['memory','独立记忆 API'],['primary','主 API'],['secondary','副 API']]);
    for(const [key,label,min,max]of [['threshold','新消息数量',2,60],['budget','记忆字数上限',200,2400]]){const row=node('label','memo-setting',label),input=node('input');input.type='number';input.min=min;input.max=max;input.value=characterMemoSettings(chat)[key];input.setAttribute('aria-label',label);input.onchange=()=>execute(async()=>{const next=characterMemoState(chat);next.settings={...next.settings,[key]:Math.max(min,Math.min(max,Number(input.value)||min))};await saveCharacterMemoState(owner,next);});row.append(input);advanced.append(row);}
    const ignored=node('details','memo-ignored');ignored.append(node('summary','','已忽略的事情'));advanced.append(ignored);
    const help=node('details','memo-guide');help.append(node('summary','','使用说明'),node('p','','自主记录在回复完成后后台运行；默认每10条新消息整理一次，最多读取最近60条。自动保存只接受有用户原文依据的明确事实，冲突和不确定内容留待审核。用于对话只选相关或置顶记录，并受字数上限限制。更换角色、存档或用户人设会隔离记录。'));
    help.append(node('p','','审核通过可单独加入日记。旧版模拟便签不会自动变成真实记忆；酒馆、文件和动态不自动采集。来源删除或修改后，该条暂停用于对话。临时记录可设到期时间；锁定或手改内容不会被自动替换。备份包含备忘录，PNG角色卡不包含这些私人记录。整理使用所选API，失败不阻止聊天；独立记忆API请在API设置内配置。'));
    advanced.append(help);settings.append(advanced);
    const tools=node('div','memo-toolbar'),search=node('input');search.type='search';search.placeholder='搜索备忘录';search.setAttribute('aria-label','搜索备忘录');
    const filter=node('select');filter.setAttribute('aria-label','筛选备忘录');for(const [v,t]of [['active','全部记录'],['pending','待审核'],['approved','已确认'],['expired','已到期'],['计划','角色计划'],['偏好','偏好'],['习惯','习惯'],['沟通','沟通偏好'],['事实','重要事实'],['临时','临时状态'],['约定','约定'],['经历','共同经历'],['done','已完成'],['superseded','已更正']]){const o=node('option','',t);o.value=v;filter.append(o);}
    const list=node('div','memo-list'),selection=new Set(),actions=node('div','memo-batch-actions');
    const add=button('添加',()=>edit()),run=button('整理',async()=>{const result=await runCharacterMemos(chat,true);feedback.textContent=result?.skipped?'没有可整理的新消息，或当前未启用':`已整理，新增 ${result.added} 条`;});
    tools.append(search,filter,add,run);
    const selected=()=>characterMemoState(chat).notes.filter(n=>selection.has(n.id)&&n.owner===owner.persona);
    actions.append(button('导出所选',()=>{const notes=selected();if(!notes.length)throw new Error('请先选择记录');const blob=new Blob([JSON.stringify({version:1,character:chat.remarkName||chat.realName,notes},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='备忘录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}),button('加入日记',async()=>{
        const notes=selected().filter(n=>n.status==='approved'&&characterMemoSourceValid(chat,n));if(!notes.length)throw new Error('请先选择已确认且来源有效的记录');
        const previous=chat.memoryJournals||[],journals=notes.filter(n=>!previous.some(j=>j.characterMemoId===n.id)).map(n=>({id:characterMemoId(),title:n.category+' · 备忘录',content:n.fact,source:'character-memo',characterMemoId:n.id,isFavorited:false,createdAt:Date.now()}));
        const next=[...previous,...journals];chat.memoryJournals=next;try{await saveData();}catch(error){if(chat.activeArchiveId===owner.archive&&(chat.memoryJournals===next||JSON.stringify(chat.memoryJournals)===JSON.stringify(next)))chat.memoryJournals=previous;const archive=chat.archives?.find(a=>a.id===owner.archive);if(archive?.data?.memoryJournals?.some(j=>journals.some(n=>j.id===n.id)))archive.data.memoryJournals=previous;throw error;}feedback.textContent=`已加入 ${journals.length} 条日记，是否用于对话请在记忆面板设置`;
    }));
    const undoButton=button('撤销删除',async()=>{if(!undo)return;const next=characterMemoState(chat);if(next.notes.length>=500)throw new Error('备忘录已达到500条');if(!next.notes.some(n=>n.id===undo.note.id))next.notes=[...next.notes,undo.note];if(undo.block)next.blocked=next.blocked.filter(b=>b!==undo.block);await saveCharacterMemoState(owner,next);undo=null;});undoButton.hidden=true;actions.append(undoButton);
    const diagnostic=node('details','memo-diagnostics');diagnostic.append(node('summary','','本轮可用记忆'));const diagnosticText=node('p');diagnostic.append(diagnosticText);
    const legacy=button('模拟便签',()=>{guard();d.dismiss();if(chat.peekData?.memos?.memos){renderMemosList(chat.peekData.memos.memos);switchScreen('peek-memos-screen');}else generateAndRenderPeekContent('memos',{forceRefresh:true});});
    body.append(settings,tools,feedback,list,actions,diagnostic,legacy);d.panel.append(body);
    function render(){
        const s=characterMemoSettings(chat);enabled.checked=s.enabled;auto.checked=s.automatic;context.checked=s.useContext;mode.value=s.mode;api.value=s.apiSource;run.disabled=!s.enabled;auto.disabled=s.mode==='manual';
        const failure=characterMemoFailures.get(JSON.stringify([chat.id,owner.archive,owner.persona]));if(failure&&!feedback.textContent)feedback.textContent=failure.message;
        undoButton.hidden=!undo;
        ignored.querySelectorAll(':scope > div').forEach(el=>el.remove());
        for(const block of characterMemoState(chat).blocked.filter(b=>b.owner===owner.persona)){const row=node('div','memo-ignored-row');row.append(node('span','',block.fact),button('允许重新记录',async()=>{const next=characterMemoState(chat);next.blocked=next.blocked.filter(b=>b!==block);const processed={...(next.processed[owner.persona]||{})};for(const id of block.sourceIds||[])delete processed[id];next.processed={...next.processed,[owner.persona]:processed};await saveCharacterMemoState(owner,next);}));ignored.append(row);}
        ignored.hidden=!characterMemoState(chat).blocked.some(b=>b.owner===owner.persona);
        const notes=characterMemoState(chat).notes.filter(n=>n.owner===owner.persona),term=search.value.trim().toLowerCase(),value=filter.value;
        list.replaceChildren();
        const visible=notes.filter(n=>(!term||(n.fact+' '+n.content).toLowerCase().includes(term))&&(value==='active'?!['done','superseded'].includes(n.status):value==='expired'?n.expiresAt&&n.expiresAt<=Date.now():['pending','approved','done','superseded'].includes(value)?n.status===value:n.category===value));
        if(!visible.length)list.append(node('p','memo-empty',notes.length?'没有匹配的记录':'还没有记下的事情'));
        for(const note of visible.slice().reverse()){
            const card=node('article','memo-card'),top=node('div','memo-card-head'),pick=node('input');pick.type='checkbox';pick.checked=selection.has(note.id);pick.setAttribute('aria-label','选择 '+note.fact);pick.onchange=()=>pick.checked?selection.add(note.id):selection.delete(note.id);
            const valid=characterMemoSourceValid(chat,note),expired=note.expiresAt&&note.expiresAt<=Date.now();
            const status=!valid?'来源已变化':note.status==='pending'?'待审核':note.status==='done'?'已完成':note.status==='superseded'?'已更正':expired?'已到期':!valid?'来源已变化':'已确认';
            top.append(pick,node('span','memo-category',(note.subject==='char'?'角色计划':note.category)+' · '+status));card.append(top,node('h3','',note.fact));
            if(note.content&&note.content!==note.fact)card.append(node('p','memo-note',note.content));
            const buttons=node('div','memo-card-actions');buttons.append(button('编辑',()=>edit(note)));
            if(note.status==='pending'){const approve=button('确认',()=>changeCharacterMemo(chat,note.id,{status:'approved'}));approve.disabled=!valid||Boolean(expired);buttons.append(approve);}
            const more=node('details','memo-more'),menu=node('div');more.append(node('summary','','更多'),menu);buttons.append(more);
            if(note.status==='approved')menu.append(button(note.pinned?'取消置顶':'置顶',()=>changeCharacterMemo(chat,note.id,{pinned:!note.pinned})),button(note.locked?'解锁':'锁定',()=>changeCharacterMemo(chat,note.id,{locked:!note.locked})),button(note.useContext===false?'用于对话':'暂停使用',()=>changeCharacterMemo(chat,note.id,{useContext:note.useContext===false})),button('完成',()=>changeCharacterMemo(chat,note.id,{status:'done'})));
            const remove=async(suppress)=>{const n=await deleteCharacterMemo(chat,note.id,suppress);if(n)undo={note:n,block:suppress?characterMemoState(chat).blocked.at(-1):null};selection.delete(note.id);};
            menu.append(button('删除',()=>remove(false)),button('不再记这件事',()=>remove(true)));card.append(buttons);
            const sources=node('details','memo-sources');sources.append(node('summary','','来源'));for(const source of note.sources||[]){const m=chat.history.find(m=>m.id===source.id);sources.append(node('p','',`${m?.role==='user'?'你':'角色'} · ${source.timestamp?new Date(source.timestamp).toLocaleString():'原消息'}\n${source.quote}`));}if(note.manual)sources.append(node('p','','手动记录'));card.append(sources);list.append(card);
        }
        const used=selectCharacterMemos(chat);diagnosticText.textContent=used.length?used.map(n=>n.fact).join('\n'):'当前没有相关记录';
    }
    function edit(note){
        guard();const e=createMessageForwardDialog(note?'编辑备忘录':'添加备忘录','character-memo-editor');e.panel.classList.add('derived-settings');const content=node('div','derived-body'),footer=node('footer'),error=node('p','memo-feedback');error.setAttribute('aria-live','polite');
        const field=(label,value,multiline=false)=>{const row=node('label','memo-editor-field',label),input=node(multiline?'textarea':'input');input.value=value||'';input.maxLength=multiline?600:400;input.setAttribute('aria-label',label);row.append(input);content.append(row);return input;};
        const fact=field('记住的事情',note?.fact),text=field('角色的便签',note?.content,true),expires=field('到期时间',note?.expiresAt?new Date(note.expiresAt-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):'');expires.type='datetime-local';
        const save=node('button','panel-primary','保存');save.type='button';save.onclick=async()=>{save.disabled=true;e.setBusy(true);try{guard();if(!fact.value.trim())throw new Error('请填写记住的事情');if(characterMemoSecret(fact.value+text.value))throw new Error('请勿记录密钥、密码或验证码');const expiry=expires.value?Date.parse(expires.value):null;if(expires.value&&!Number.isFinite(expiry))throw new Error('到期时间无效');
            if(note)await changeCharacterMemo(chat,note.id,{fact:fact.value.trim(),content:text.value.trim(),userEdited:true,locked:true,expiresAt:expiry});
            else{const next=characterMemoState(chat);if(next.notes.length>=500)throw new Error('备忘录已达到500条');next.notes=[...next.notes,{id:characterMemoId(),owner:owner.persona,fact:fact.value.trim(),content:text.value.trim(),subject:'user',category:'事实',status:'approved',manual:true,userEdited:true,locked:true,useContext:true,sources:[],createdAt:Date.now(),expiresAt:expiry}];await saveCharacterMemoState(owner,next);}
            e.setBusy(false);e.dismiss();if(characterMemoCurrent(owner))render();
        }catch(reason){error.textContent=reason.message;}finally{save.disabled=false;e.setBusy(false);}};content.append(error);footer.append(save);e.panel.append(content,footer);
    }
    search.oninput=filter.onchange=render;render();
}
