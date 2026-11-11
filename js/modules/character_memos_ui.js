// Character-scoped memo manager; all user text is rendered as text nodes.
function openCharacterMemos(target) {
    const chat=target || (typeof currentChatType!=='undefined'&&currentChatType==='private' ? db.characters.find(c=>c.id===currentChatId) : null);
    if(!chat)return showToast('请先打开角色私聊');
    let semanticController;
    const owner=characterMemoOwner(chat), d=createMessageForwardDialog('他的备忘录','character-memos-dialog',()=>semanticController?.abort());
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
    const advanced=node('details','memo-options'),more=node('summary','','记录设置');advanced.open=true;advanced.append(more);
    const select=(name,label,options)=>{const row=node('label','memo-setting',label),s=node('select');s.setAttribute('aria-label',label);for(const [v,t]of options){const o=node('option','',t);o.value=v;s.append(o);}s.value=characterMemoSettings(chat)[name];s.onchange=()=>execute(async()=>{const next=characterMemoState(chat);next.settings={...next.settings,[name]:s.value};await saveCharacterMemoState(owner,next);});row.append(s);advanced.append(row);return s;};
    const mode=select('mode','记录方式',[['auto','自动保存明确事实'],['review','审核后使用'],['manual','手动整理']]);
    const api=select('apiSource','整理 API',[['journal','沿用日记 API'],['memory','独立记忆 API'],['primary','主 API'],['secondary','副 API']]);
    for(const [key,label,min,max]of [['threshold','新消息数量',2,60],['budget','记忆字数上限',200,2400]]){const row=node('label','memo-setting',label),input=node('input');input.type='number';input.min=min;input.max=max;input.value=characterMemoSettings(chat)[key];input.setAttribute('aria-label',label);input.onchange=()=>execute(async()=>{const next=characterMemoState(chat);next.settings={...next.settings,[key]:Math.max(min,Math.min(max,Number(input.value)||min))};await saveCharacterMemoState(owner,next);});row.append(input);advanced.append(row);}
    const ignored=node('details','memo-ignored');ignored.append(node('summary','','已忽略的事情'));advanced.append(ignored);
    const help=node('details','memo-guide');help.append(node('summary','','使用说明'),node('p','','自主记录在回复完成后后台运行；默认每10条新消息整理一次，最多读取最近60条。自动保存只接受有用户原文依据的明确事实，冲突和不确定内容留待审核。用于对话只选相关或置顶记录，并受字数上限限制。更换角色、存档或用户人设会隔离记录。'));
    help.append(node('p','','审核通过可单独加入日记。旧版模拟便签不会自动变成真实记忆；酒馆、文件和动态不自动采集。来源删除或修改后，该条暂停用于对话。临时记录可设到期时间；锁定或手改内容不会被自动替换。备份包含备忘录，PNG角色卡不包含这些私人记录。整理使用所选API，失败不阻止聊天；独立记忆API请在API设置内配置。'));
    help.append(node('p','','冲突记录可替换旧记录、保留两条或忽略；锁定记录需先解锁才能替换。来源失效时可查看原消息，核对后另存为手动记录。加入日记及合并后的记忆也会检查原备忘录是否有效。保存时若提示记录已更新，请重新读取后再操作。'));
    help.append(node('p','','设置页可查看存档容量和每条记录的入选原因。接近500条时，可先在批量管理中导出，再手动整理。“相近记录”仅按文字匹配列出最多10组，需逐条核对，不自动合并，也不额外调用API。'));
    help.append(node('p','','排查实际注入：在本设置页展开“实际请求诊断”，打开“记录实际请求诊断”，关闭面板并正常发送一轮聊天，再回来点“刷新诊断”。可核对备忘录、向量、日记、世界书及其他附加资料是否匹配最终请求。仅本页临时记录字段、来源名称和字符数，不保存正文；清除或关闭后无法恢复，刷新页面也会清空。“本轮可用记忆”仍是当前条件预览，不能代替实际请求记录。'));
    advanced.append(help);settings.append(advanced);
    const tools=node('div','memo-toolbar'),search=node('input');search.type='search';search.placeholder='搜索记录';search.setAttribute('aria-label','搜索备忘录');
    const filter=node('select');filter.setAttribute('aria-label','筛选备忘录');for(const [v,t]of [['active','全部记录'],['pending','待审核'],['approved','已确认'],['expired','已到期'],['计划','角色计划'],['偏好','偏好'],['习惯','习惯'],['沟通','沟通偏好'],['事实','重要事实'],['临时','临时状态'],['约定','约定'],['经历','共同经历'],['done','已完成'],['superseded','已更正']]){const o=node('option','',t);o.value=v;filter.append(o);}
    const list=node('div','memo-list'),selection=new Set(),actions=node('div','memo-batch-actions');
    const add=button('添加',()=>edit()),run=button('整理',async()=>{const result=await runCharacterMemos(chat,true);feedback.textContent=result?.skipped?'没有可整理的新消息，或当前未启用':`已整理，新增 ${result.added} 条`;});
    tools.append(search);
    const tabs=node('nav','memo-tabs');tabs.setAttribute('aria-label','备忘录分类');
    const pinned=node('option','','置顶');pinned.value='pinned';filter.append(pinned);
    for(const [value,text]of [['active','全部'],['pending','待审核'],['pinned','置顶']]){
        const tab=node('button','',text);tab.type='button';tab.dataset.memoFilter=value;
        tab.onclick=()=>{filter.value=value;selection.clear();render();};tabs.append(tab);
    }
    tools.append(tabs);
    const selected=()=>characterMemoState(chat).notes.filter(n=>selection.has(n.id)&&n.owner===owner.persona);
    actions.append(button('导出所选',()=>{const notes=selected();if(!notes.length)throw new Error('请先选择记录');const blob=new Blob([JSON.stringify({version:1,character:chat.remarkName||chat.realName,notes},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='备忘录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}),button('加入日记',async()=>{
        const notes=selected().filter(n=>n.status==='approved'&&(!n.expiresAt||n.expiresAt>Date.now())&&characterMemoSourceValid(chat,n));if(!notes.length)throw new Error('请先选择已确认、未到期且来源有效的记录');
        const previous=chat.memoryJournals||[],journals=notes.filter(n=>!previous.some(j=>j.characterMemoId===n.id&&characterMemoJournalAllowed(chat,j))).map(n=>characterMemoToJournal(chat,n));
        const next=[...previous,...journals];chat.memoryJournals=next;try{await saveData();}catch(error){if(chat.activeArchiveId===owner.archive&&(chat.memoryJournals===next||JSON.stringify(chat.memoryJournals)===JSON.stringify(next)))chat.memoryJournals=previous;const archive=chat.archives?.find(a=>a.id===owner.archive);if(archive?.data?.memoryJournals?.some(j=>journals.some(n=>j.id===n.id)))archive.data.memoryJournals=previous;throw error;}feedback.textContent=`已加入 ${journals.length} 条日记，是否用于对话请在记忆面板设置`;
    }));
    const undoButton=button('撤销删除',async()=>{if(!undo)return;const next=characterMemoState(chat);if(next.notes.length>=500)throw new Error('备忘录已达到500条');if(!next.notes.some(n=>n.id===undo.note.id))next.notes=[...next.notes,undo.note];if(undo.block)next.blocked=next.blocked.filter(b=>b!==undo.block);await saveCharacterMemoState(owner,next);undo=null;});undoButton.hidden=true;actions.append(undoButton);
    const diagnostic=node('details','memo-diagnostics');diagnostic.append(node('summary','','本轮可用记忆'));const diagnosticText=node('p');diagnostic.append(diagnosticText);
    const actualDiagnostic=node('details','memo-diagnostics');actualDiagnostic.append(node('summary','','实际请求诊断'));
    const requestToggle=node('input','panel-switch');requestToggle.type='checkbox';requestToggle.setAttribute('role','switch');requestToggle.setAttribute('aria-label','记录实际请求诊断');requestToggle.checked=globalThis.UvURequestDiagnostics?.isEnabled()===true;
    const requestRow=node('label','memo-switch-row');requestRow.append(node('span','','记录实际请求诊断'),requestToggle);actualDiagnostic.append(requestRow);
    const requestReport=node('div');requestReport.setAttribute('aria-live','polite');
    const requestLabels={memo:'备忘录',vector:'向量记忆',environment:'环境',mcp:'MCP',documents:'文件',music:'音乐',calendar:'日历',sticker:'表情描述'};
    const refreshRequestReport=()=>{
        requestReport.replaceChildren();const report=globalThis.UvURequestDiagnostics?.get(chat,'private');
        if(!report){requestReport.append(node('p','',requestToggle.checked?'暂无记录，开启后发送一轮聊天再刷新':'记录已关闭'));return;}
        const statuses={dispatched:'请求已发出',completed:'回复已完成',failed:'请求失败',cancelled:'已取消',stale:'会话已变化'};
        requestReport.append(node('p','',new Date(report.timestamp).toLocaleTimeString()+' · '+(statuses[report.status]||report.status)),node('p','',`${report.fieldCount}个文字字段 · ${report.textChars}字符 · ${report.opaqueParts}个非文字片段`));
        const describe=(item,label)=>node('p','',label+' · '+(item.matched===true?'已匹配':item.matched===null?'扫描上限内未匹配':item.chars?'未匹配':'未附加')+(item.paths.length?' · '+item.paths.join('、'):''));
        for(const item of report.blocks)requestReport.append(describe(item,requestLabels[item.kind]));
        for(const [title,items]of [['日记来源',report.journals],['世界书来源',report.worldBooks]])if(items.length){const section=node('details');section.append(node('summary','',title+' '+items.length));for(const item of items)section.append(describe(item,item.label||item.id));requestReport.append(section);}
        const fields=node('details');fields.append(node('summary','','请求字段'));for(const item of report.fields)fields.append(node('p','',item.path+' · '+item.role+' · '+item.chars+'字符'));requestReport.append(fields);
        if(report.truncated||report.sourcesTruncated)requestReport.append(node('p','','明细已达到扫描上限；未匹配不代表未发送'));
    };
    requestToggle.onchange=()=>{try{guard();globalThis.UvURequestDiagnostics.setEnabled(requestToggle.checked);refreshRequestReport();}catch(error){requestToggle.checked=globalThis.UvURequestDiagnostics?.isEnabled()===true;feedback.textContent='诊断设置保存失败：'+error.message;}};
    actualDiagnostic.append(button('刷新诊断',refreshRequestReport),button('清除诊断',()=>{globalThis.UvURequestDiagnostics?.clear(chat,'private');refreshRequestReport();}),requestReport,node('p','','仅核对最终请求中的文字和位置，不代表模型已采纳。不开额外API调用，不保存正文；本页临时保留1小时，最多16个会话，关闭记录即清除。'));
    actualDiagnostic.ontoggle=()=>{if(actualDiagnostic.open)refreshRequestReport();};
    const capacity=node('p','memo-feedback'),similar=node('details','memo-diagnostics'),similarList=node('div');similar.append(node('summary','','相近记录'),node('p','','仅按文字相近提示，请核对否定、时间和人物。不会自动合并。'),button('检查相近记录',()=>{const hints=findSimilarCharacterMemos(chat);similarList.replaceChildren();for(const hint of hints){const row=node('section');row.append(node('p','',hint.first.fact+'\n'+hint.second.fact),button('查看第一条',()=>view(hint.first)),button('查看第二条',()=>view(hint.second)));similarList.append(row);}if(!hints.length)similarList.append(node('p','','未找到明显相近记录'));}),similarList);
    const semantic=node('details','memo-diagnostics'),semanticStatus=node('p'),semanticList=node('div'),semanticRun=node('button','','检查语义相近'),semanticCancel=node('button','','取消检查');
    semanticRun.type=semanticCancel.type='button';semanticCancel.hidden=true;semanticStatus.setAttribute('aria-live','polite');
    semantic.append(node('summary','','语义相近检查'),node('p','','手动检查时，将所选或最近50条有效记录发送到向量API。只给建议，不改记录。'));
    const semanticToggle=toggle('semanticHints','允许语义相近检查');semantic.append(semanticToggle.parentElement,semanticRun,semanticCancel,semanticStatus,semanticList);
    semanticCancel.onclick=()=>semanticController?.abort();
    semanticRun.onclick=async()=>{
        if(semanticController||busy)return;
        const controller=new AbortController();semanticController=controller;semanticRun.disabled=true;semanticCancel.hidden=false;semanticList.replaceChildren();semanticStatus.textContent='正在检查…';
        try{
            guard();const report=await findSemanticCharacterMemos(chat,{...(selection.size?{ids:[...selection]}:{}),signal:controller.signal,onProgress:p=>{if(d.panel.isConnected)semanticStatus.textContent=`正在检查 ${p.completed}/${p.total}`;}});
            guard();if(!d.panel.isConnected)return;
            semanticStatus.textContent=`已检查${report.scanned}条${report.scope==='selected'?'所选':'最近'}有效记录 · ${report.pairs.length}组相近提示`;
            for(const hint of report.pairs){const row=node('section');row.append(node('p','',hint.first.fact+'\n'+hint.second.fact),node('p','',hint.polarityDiffers?'含肯定与否定差异，可能表达相反含义':'请核对人物、时间与原话，相近不代表同一事实'));
                for(const [label,item]of [['查看第一条',hint.first],['查看第二条',hint.second]])row.append(button(label,()=>{const live=characterMemoState(chat).notes.find(n=>n.id===item.id);if(!live||live.fact!==item.fact)throw new Error('记录已变化，请重新检查');view(live);}));semanticList.append(row);}
        }catch(error){if(d.panel.isConnected)semanticStatus.textContent=error.name==='AbortError'?'检查已取消或来源、配置已变化':error.message;}
        finally{if(semanticController===controller)semanticController=null;semanticRun.disabled=false;semanticCancel.hidden=true;}
    };
    const legacy=button('模拟便签',()=>{guard();d.dismiss();if(chat.peekData?.memos?.memos){renderMemosList(chat.peekData.memos.memos);switchScreen('peek-memos-screen');}else generateAndRenderPeekContent('memos',{forceRefresh:true});});
    const identity=node('div','memo-identity'),avatar=node('span','draft-avatar',(chat.remarkName||chat.realName||'角').slice(0,1));
    identity.append(avatar,node('span','',chat.remarkName||chat.realName),node('small','',chat.archives?.find(a=>a.id===owner.archive)?.name||'当前存档'));
    const batch=node('details','memo-batch');batch.append(node('summary','','批量管理'),filter,actions);
    const main=node('section','memo-main');main.append(identity,tools,list,batch);
    const settingsPage=node('section','memo-settings-page');settingsPage.hidden=true;settingsPage.append(settings,capacity,diagnostic,actualDiagnostic,similar,semantic,legacy);
    const footer=node('footer','memo-footer'),done=node('button','panel-primary','完成');done.type='button';done.hidden=true;
    run.textContent='整理聊天';add.classList.add('panel-primary');footer.append(run,add,done);
    const head=d.panel.querySelector('.message-forward-header,header'),heading=head?.querySelector('strong,h2'),settingsButton=node('button','sheet-aux');settingsButton.type='button';settingsButton.setAttribute('aria-label','备忘录设置');
    settingsButton.innerHTML=window.UvULucide?.['settings-2']||'';
    const showSettings=active=>{guard();settingsPage.hidden=!active;main.hidden=active;run.hidden=add.hidden=active;done.hidden=!active;settingsButton.setAttribute('aria-pressed',String(active));if(heading)heading.textContent=active?'备忘录设置':'他的备忘录';body.scrollTop=0;};
    settingsButton.onclick=()=>{try{showSettings(settingsPage.hidden);}catch(error){feedback.textContent=error.message;}};
    done.onclick=()=>{try{showSettings(false);}catch(error){feedback.textContent=error.message;}};
    head?.append(settingsButton);body.append(feedback,main,settingsPage);d.panel.append(body,footer);
    function render(){
        const s=characterMemoSettings(chat);enabled.checked=s.enabled;auto.checked=s.automatic;context.checked=s.useContext;semanticToggle.checked=s.semanticHints;mode.value=s.mode;api.value=s.apiSource;run.disabled=!s.enabled;auto.disabled=s.mode==='manual';
        const failure=characterMemoFailures.get(JSON.stringify([chat.id,owner.archive,owner.persona]));if(failure&&!feedback.textContent)feedback.textContent=failure.message;
        undoButton.hidden=!undo;
        ignored.querySelectorAll(':scope > div').forEach(el=>el.remove());
        for(const block of characterMemoState(chat).blocked.filter(b=>b.owner===owner.persona)){const row=node('div','memo-ignored-row');row.append(node('span','',block.fact),button('允许重新记录',async()=>{const next=characterMemoState(chat);next.blocked=next.blocked.filter(b=>b!==block);const processed={...(next.processed[owner.persona]||{})};for(const id of block.sourceIds||[])delete processed[id];next.processed={...next.processed,[owner.persona]:processed};await saveCharacterMemoState(owner,next);}));ignored.append(row);}
        ignored.hidden=!characterMemoState(chat).blocked.some(b=>b.owner===owner.persona);
        const notes=characterMemoState(chat).notes.filter(n=>n.owner===owner.persona),term=search.value.trim().toLowerCase(),value=filter.value;
        list.replaceChildren();
        for(const tab of tabs.children){tab.setAttribute('aria-pressed',String(value===tab.dataset.memoFilter));if(tab.dataset.memoFilter==='pending'){const count=notes.filter(n=>n.status==='pending').length;tab.textContent='待审核'+(count?' '+count:'');}}
        const visible=notes.filter(n=>(!term||(n.fact+' '+n.content).toLowerCase().includes(term))&&(value==='active'?!['done','superseded'].includes(n.status):value==='pinned'?n.pinned&&n.status==='approved':value==='expired'?n.expiresAt&&n.expiresAt<=Date.now():['pending','approved','done','superseded'].includes(value)?n.status===value:n.category===value));
        if(!visible.length)list.append(node('p','memo-empty',notes.length?'没有匹配的记录':'还没有记下的事情'));
        for(const note of visible.slice().reverse()){
            const card=node('article','memo-card'),top=node('div','memo-card-head'),pick=node('input');pick.type='checkbox';pick.checked=selection.has(note.id);pick.setAttribute('aria-label','选择 '+note.fact);pick.onchange=()=>pick.checked?selection.add(note.id):selection.delete(note.id);
            const sourceStatus=characterMemoSourceStatus(chat,note),expired=note.expiresAt&&note.expiresAt<=Date.now();
            const status=!sourceStatus.valid?sourceStatus.message:note.status==='pending'?'待审核':note.status==='done'?'已完成':note.status==='superseded'?'已更正':expired?'已到期':'已确认';
            top.append(pick,node('span','memo-category',note.subject==='char'?'角色计划':note.category));
            if(status!=='已确认')top.append(node('small','memo-status',status));card.append(top,node('h3','',note.fact));
            if(note.content&&note.content!==note.fact)card.append(node('p','memo-note',note.content));
            const recorded=new Date(note.createdAt||Date.now()),buttons=node('div','memo-card-actions'),date=node('time','',recorded.toDateString()===new Date().toDateString()?'今天':recorded.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}));buttons.append(date,button(note.status==='pending'?'审核':'查看',()=>view(note)));
            const more=node('details','memo-more'),menu=node('div'),caption=node('summary','','更多');caption.setAttribute('aria-label','更多操作');const moreIcon=node('img');moreIcon.src='assets/icons/lucide-ellipsis.svg';moreIcon.alt='';caption.replaceChildren(moreIcon);more.append(caption,menu);top.append(more);menu.append(button('编辑',()=>edit(note)));
            if(note.status==='approved')menu.append(button(note.pinned?'取消置顶':'置顶',()=>changeCharacterMemo(chat,note.id,{pinned:!note.pinned})),button(note.locked?'解锁':'锁定',()=>changeCharacterMemo(chat,note.id,{locked:!note.locked})),button(note.useContext===false?'用于对话':'暂停使用',()=>changeCharacterMemo(chat,note.id,{useContext:note.useContext===false})),button('完成',()=>changeCharacterMemo(chat,note.id,{status:'done'})));
            const remove=async(suppress)=>{const n=await deleteCharacterMemo(chat,note.id,suppress);if(n)undo={note:n,block:suppress?characterMemoState(chat).blocked.at(-1):null};selection.delete(note.id);};
            menu.append(button('删除',()=>remove(false)),button('不再记这件事',()=>remove(true)));card.append(buttons);
            const sources=node('details','memo-sources');sources.append(node('summary','','来源'));for(const source of note.sources||[]){const m=chat.history.find(m=>m.id===source.id);sources.append(node('p','',`${m?.role==='user'?'你':'角色'} · ${source.timestamp?new Date(source.timestamp).toLocaleString():'原消息'}\n${source.quote}`));}if(note.manual)sources.append(node('p','','手动记录'));menu.append(sources);list.append(card);
        }
        const report=inspectCharacterMemos(chat);capacity.textContent=`当前身份 ${report.current} 条 · 本存档 ${report.total}/${report.limit} 条`+(report.remaining<=50?' · 可导出后整理已完成或到期记录':'');
        diagnosticText.textContent=`按当前消息预览：${report.selected} 条 · 上限 ${report.budget} 字符；实际请求还会扣除其他上下文中的重复内容。\n`+report.rows.map(n=>n.fact+'：'+n.reason).join('\n');
    }
    function view(note){
        guard();const v=createMessageForwardDialog('记住的事情','character-memo-detail');v.panel.classList.add('derived-settings');
        const content=node('div','derived-body'),footer=node('footer');content.append(node('small','',note.category),node('h3','',note.fact));
        if(note.content)content.append(node('p','memo-detail-note',note.content));
        const sourceStatus=characterMemoSourceStatus(chat,note);
        if(!sourceStatus.valid)content.append(node('p','memo-status',sourceStatus.message));
        const old=note.replacesId&&characterMemoState(chat).notes.find(n=>n.id===note.replacesId&&n.owner===owner.persona);
        if(note.replacesId){const conflict=node('section','memo-detail-source memo-conflict');conflict.append(node('h3','','原记录'),node('p','',old?.fact||'原记录已移除'));if(old?.locked)conflict.append(node('small','','已锁定'));content.append(conflict);}
        const source=node('section','memo-detail-source');source.append(node('h3','','原话'));
        for(const evidence of note.sources||[]){source.append(node('p','',evidence.quote));const original=chat.history.find(m=>m.id===evidence.id);if(original){const preview=node('details');preview.append(node('summary','','查看原消息'),node('p','',original.content));source.append(preview);}}
        if(note.manual)source.append(node('p','','手动记录'));content.append(source);
        const editButton=node('button',note.status==='pending'?'':'panel-primary','编辑');editButton.type='button';editButton.onclick=()=>{v.dismiss();edit(note);};footer.append(editButton);
        if(!sourceStatus.valid){const correct=node('button','','另存为手动记录');correct.type='button';correct.onclick=()=>{v.dismiss();edit(null,note);};footer.append(correct);}
        if(note.status==='pending'){
            const error=node('p','memo-feedback'),controls=[],snapshot=JSON.stringify(note),originalSnapshot=JSON.stringify(old);error.setAttribute('aria-live','polite');content.append(error);
            const approve=(label,decision)=>{const action=node('button',decision==='keep-both'?'':'panel-primary',label);action.type='button';action.disabled=!sourceStatus.valid||Boolean(note.expiresAt&&note.expiresAt<=Date.now())||decision==='replace'&&(!old||old.locked||old.status!=='approved');const disabled=action.disabled;controls.push([action,disabled]);
                action.onclick=async()=>{controls.forEach(([b])=>b.disabled=true);v.setBusy(true);try{guard();if(JSON.stringify(characterMemoState(chat).notes.find(n=>n.id===note.id))!==snapshot)throw new Error('记录已变化，请重新打开后审核');if(decision==='replace'&&JSON.stringify(characterMemoState(chat).notes.find(n=>n.id===note.replacesId))!==originalSnapshot)throw new Error('原记录已变化，请重新打开后审核');await changeCharacterMemo(chat,note.id,{status:'approved',conflictResolution:decision});guard();render();v.setBusy(false);v.dismiss();}catch(reason){error.textContent=reason.message;}finally{v.setBusy(false);controls.forEach(([b,value])=>b.disabled=value);}};footer.append(action);};
            if(note.replacesId){footer.classList.add('memo-review-actions');approve('替换旧记录','replace');approve('两条都保留','keep-both');const ignore=node('button','','忽略');ignore.type='button';controls.push([ignore,false]);ignore.onclick=async()=>{controls.forEach(([b])=>b.disabled=true);v.setBusy(true);try{guard();if(JSON.stringify(characterMemoState(chat).notes.find(n=>n.id===note.id))!==snapshot)throw new Error('记录已变化，请重新打开后审核');await deleteCharacterMemo(chat,note.id,true);render();v.setBusy(false);v.dismiss();}catch(reason){error.textContent=reason.message;}finally{v.setBusy(false);controls.forEach(([b,value])=>b.disabled=value);}};footer.append(ignore);}
            else approve('确认记忆');
        }
        v.panel.append(content,footer);
    }
    function edit(note,seed){
        guard();const e=createMessageForwardDialog(note?'编辑备忘录':'添加备忘录','character-memo-editor');e.panel.classList.add('derived-settings');const content=node('div','derived-body'),footer=node('footer'),error=node('p','memo-feedback');error.setAttribute('aria-live','polite');
        const field=(label,value,multiline=false)=>{const row=node('label','memo-editor-field',label),input=node(multiline?'textarea':'input');input.value=value||'';input.maxLength=multiline?600:400;input.setAttribute('aria-label',label);row.append(input);content.append(row);return input;};
        const initial=note||seed;const fact=field('记住的事情',initial?.fact),text=field('角色的便签',initial?.content,true),expires=field('到期时间',initial?.expiresAt?new Date(initial.expiresAt-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):'');expires.type='datetime-local';
        const save=node('button','panel-primary','保存');save.type='button';save.onclick=async()=>{save.disabled=true;e.setBusy(true);try{guard();if(!fact.value.trim())throw new Error('请填写记住的事情');if(characterMemoSecret(fact.value+text.value))throw new Error('请勿记录密钥、密码或验证码');const expiry=expires.value?Date.parse(expires.value):null;if(expires.value&&!Number.isFinite(expiry))throw new Error('到期时间无效');
            if(note)await changeCharacterMemo(chat,note.id,{fact:fact.value.trim(),content:text.value.trim(),userEdited:true,locked:true,expiresAt:expiry});
            else await addManualCharacterMemo(chat,{fact:fact.value.trim(),content:text.value.trim(),expiresAt:expiry,subject:seed?.subject,category:seed?.category});
            e.setBusy(false);e.dismiss();if(characterMemoCurrent(owner))render();
        }catch(reason){error.textContent=reason.message;}finally{save.disabled=false;e.setBusy(false);}};content.append(error);footer.append(save);e.panel.append(content,footer);
    }
    search.oninput=filter.onchange=render;render();
}
