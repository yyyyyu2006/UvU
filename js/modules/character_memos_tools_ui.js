// Optional memo tools. Native chat, music, cards and simulated phone notes are untouched.
function mountCharacterMemoTools(chat,{owner,node,button,execute,guard,settingsPage,actions,list,selection,feedback,refresh,view}) {
    const section=node('details','memo-diagnostics');section.append(node('summary','','整理与隐私'));
    const privacy=node('textarea');privacy.rows=2;privacy.setAttribute('aria-label','不记录的主题');privacy.placeholder='不记录的主题，每行一个';privacy.value=characterMemoSettings(chat).excludedTopics.join('\n');
    section.append(privacy,button('保存排除主题',async()=>{const next=characterMemoState(chat);next.settings.excludedTopics=privacy.value.split('\n');await saveCharacterMemoState(owner,next);feedback.textContent='已保存；后续提取与召回跳过这些主题';}));
    const recall=node('input','panel-switch');recall.type='checkbox';recall.setAttribute('role','switch');recall.checked=characterMemoSettings(chat).semanticRecall;recall.setAttribute('aria-label','缓存语义召回');
    const label=node('label','memo-switch-row');label.append(node('span','','缓存语义召回'),recall);
    recall.onchange=()=>{const desired=recall.checked;execute(async()=>{const next=characterMemoState(chat);next.settings.semanticRecall=desired;await saveCharacterMemoState(owner,next);}).then(()=>recall.checked=characterMemoSettings(chat).semanticRecall);};
    const rank=node('select');rank.setAttribute('aria-label','备忘录排序');for(const [value,text]of [['legacy','原有排序'],['rrf','RRF 实验']]){const o=node('option','',text);o.value=value;rank.append(o);}rank.value=characterMemoSettings(chat).ranking;
    rank.onchange=()=>execute(async()=>{const next=characterMemoState(chat);next.settings.ranking=rank.value;await saveCharacterMemoState(owner,next);}).then(()=>rank.value=characterMemoSettings(chat).ranking);
    const diversity=node('input','panel-switch');diversity.type='checkbox';diversity.setAttribute('role','switch');diversity.checked=characterMemoSettings(chat).diversity;diversity.setAttribute('aria-label','相同事实只选一条');const diversityLabel=node('label','memo-switch-row');diversityLabel.append(node('span','','相同事实只选一条'),diversity);
    diversity.onchange=()=>execute(async()=>{const next=characterMemoState(chat);next.settings.diversity=diversity.checked;await saveCharacterMemoState(owner,next);}).then(()=>diversity.checked=characterMemoSettings(chat).diversity);
    section.append(label,rank,diversityLabel,node('p','','仅手动构建时调用向量API，最多50条。缓存仅在本页保留1小时；用户消息、事实或配置改变后回退文字匹配。'),button('构建召回缓存',async()=>{const report=await buildCharacterMemoRecallCache(chat);feedback.textContent=`已为当前消息缓存 ${report.count} 条记录；新消息需重新构建`;}));
    const task=node('div'),trash=node('details','memo-diagnostics'),trashList=node('div');trash.append(node('summary','','回收站'),node('p','','保留最近50条、最长30天，包含在本地备份中。彻底删除会清除备忘录正文和修订；已忽略项保留无正文的屏蔽规则，需单独允许重新记录。旧备份和独立复制不受影响。'),trashList);
    const compare=node('details','memo-diagnostics'),groups=node('div');compare.append(node('summary','','跨来源事实对照'),node('p','','最近200条备忘录、100篇日记，每篇前5个事实片段。只列候选，不自动合并。'),groups,button('刷新对照',()=>{groups.replaceChildren();const found=characterMemoFactGroups(chat);for(const g of found.slice(0,30))groups.append(node('p','',(g.needsIdentityReview?'人物待核对 · ':'')+g.ids.join(' · ')+'\n'+g.facts.join('\n')));if(!found.length)groups.append(node('p','','暂无相同人物与时段的相近事实'));}));
    const topic=node('input'),person=node('input'),time=node('input');topic.placeholder='主题或分类';person.placeholder='user、char 或关联人物';time.type='datetime-local';topic.setAttribute('aria-label','筛选主题');person.setAttribute('aria-label','筛选关联人物');time.setAttribute('aria-label','事实有效时间');
    const results=node('div'),browse=node('details','memo-diagnostics');browse.append(node('summary','','主题与时间'),topic,person,time,button('筛选',()=>{results.replaceChildren();const rows=queryCharacterMemoRecords(chat,{topic:topic.value.trim(),person:person.value.trim(),...(time.value?{at:Date.parse(time.value)}:{})});for(const n of rows.slice(0,50))results.append(button(n.fact,()=>view(n)));if(!rows.length)results.append(node('p','','没有匹配记录'));}),results);
    section.append(button('清除本地反馈统计',()=>clearCharacterMemoFeedback(chat)),task);settingsPage.append(section,trash,compare,browse);
    const batchAction=(title,action)=>button(title,()=>{
        const preview=characterMemoBatchPreview(chat,[...selection]);guard();
        const d=createMessageForwardDialog('确认批量操作','character-memo-batch-confirm'),body=node('div','derived-body'),footer=node('footer'),error=node('p','memo-feedback');d.panel.classList.add('derived-settings');
        body.append(node('p','',`${chat.remarkName||chat.realName||'当前角色'} · ${preview.items.length} 条 · 冲突 ${preview.conflicts} 条`),node('p','',action==='delete'?'移入回收站，不删除聊天原文。':action==='approve'?'含冲突的记录需单独决定，不会自动替换。':'暂停所选记录及其关联日记的使用。'),error);
        const impact=new Set(preview.items.flatMap(item=>characterMemoImpact(chat,item.id).journalIds));if(impact.size)body.append(node('p','',`影响 ${impact.size} 篇关联日记／合并记忆`));
        const commit=node('button','panel-primary',title);commit.type='button';commit.onclick=async()=>{commit.disabled=true;d.setBusy(true);try{guard();await batchCharacterMemos(chat,preview,action);selection.clear();refresh();d.setBusy(false);d.dismiss();}catch(e){error.textContent=e.message;}finally{d.setBusy(false);commit.disabled=false;}};footer.append(commit);d.panel.append(body,footer);
    });
    actions.prepend(button('选当前页',()=>{for(const input of list.querySelectorAll('input[type="checkbox"]')){input.checked=true;input.dispatchEvent(new Event('change'));}}),button('取消选择',()=>{selection.clear();refresh();}));
    actions.append(batchAction('确认所选','approve'),batchAction('暂停所选','pause'),batchAction('删除所选','delete'));
    actions.append(button('批量主题',()=>{
        const preview=characterMemoBatchPreview(chat,[...selection]),d=createMessageForwardDialog('批量主题','character-memo-batch-tags'),body=node('div','derived-body'),footer=node('footer'),input=node('input'),diff=node('div'),error=node('p','memo-feedback');d.panel.classList.add('derived-settings');input.placeholder='以逗号分隔';input.setAttribute('aria-label','批量主题');
        const topics=()=>input.value.split(/[、,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,12),render=()=>{diff.replaceChildren();for(const item of preview.items){const n=JSON.parse(item.snapshot);diff.append(node('p','',n.fact+'\n'+((n.topics||[]).join('、')||'无主题')+' → '+(topics().join('、')||'无主题')));}};input.oninput=render;render();
        const save=node('button','panel-primary','保存主题');save.type='button';save.onclick=async()=>{save.disabled=true;d.setBusy(true);try{guard();await batchCharacterMemos(chat,preview,'tag',{topics:topics()});refresh();d.setBusy(false);d.dismiss();}catch(e){error.textContent=e.message;}finally{d.setBusy(false);save.disabled=false;}};body.append(node('p','',`仅修改 ${preview.items.length} 条记录的主题`),input,diff,error);footer.append(save);d.panel.append(body,footer);
    }));
    return ()=>{
        recall.checked=characterMemoSettings(chat).semanticRecall;rank.value=characterMemoSettings(chat).ranking;diversity.checked=characterMemoSettings(chat).diversity;
        task.replaceChildren();const status=characterMemoTaskStatus(chat);
        if(status){task.append(node('p','','上次整理未完成'+(status.busy?' · 正在运行':'')),button('重试上次任务',async()=>{const r=await retryCharacterMemoTask(chat);feedback.textContent=`已整理，新增 ${r.added||0} 条`;}),button('丢弃未完成任务',()=>dismissCharacterMemoTask(chat)));task.querySelector('button').disabled=!status.retryable||status.busy;}
        trashList.replaceChildren();for(const entry of characterMemoState(chat).trash.filter(x=>x.note.owner===owner.persona).slice().reverse()){
            const row=node('section');row.append(node('p','',entry.note.fact),button('恢复',()=>restoreCharacterMemo(chat,entry.note.id)),button('彻底删除',async()=>{if(!confirm('彻底删除本条及修订？已忽略项仍保留无正文的屏蔽规则；旧备份和独立日记不会清除。'))return;await purgeCharacterMemo(chat,entry.note.id);}));trashList.append(row);
        }if(!trashList.childNodes.length)trashList.append(node('p','','回收站为空'));
    };
}
function appendCharacterMemoDetails(chat,note,{node,content,button}) {
    if(note.reviewReason)content.append(node('p','memo-status',note.reviewReason));
    const details=node('details','memo-sources');details.append(node('summary','','历史与关联'));
    const impact=characterMemoImpact(chat,note.id);details.append(node('p','',`关联 ${impact.linked} 篇日记／合并记忆；暂停或删除后停止使用。独立复制不受此关联约束。`));
    const relation=characterMemoRelations(chat,note.id);details.append(node('p','',(relation.subject==='char'?(chat.remarkName||chat.realName||'角色'):(chat.myName||'你'))+' → '+note.fact));
    if(relation.attribute||relation.value)details.append(node('p','',[relation.attribute,relation.value].filter(Boolean).join(' · ')));
    if(relation.topics.length||relation.relatedPeople.length)details.append(node('p','',[...relation.topics,...relation.relatedPeople].join(' · ')));
    for(const source of relation.sources){const index=(chat.history||[]).findIndex(m=>m.id===source.id);details.append(node('p','',index>=0?'第 '+(index+1)+' 楼'+(source.available?'':' · 来源已停用'):'原消息已移除'));}
    for(const id of relation.journals){const journal=(chat.memoryJournals||[]).find(j=>j.id===id);details.append(node('p','',journal?.title||'关联日记'));}
    if(note.external)details.append(node('p','','MCP · '+note.external.serviceId+' · '+note.external.toolName));
    for(const revision of (note.revisions||[]).slice().reverse())details.append(node('p','',new Date(revision.at).toLocaleString()+'\n'+revision.fact+' → '+note.fact));
    details.append(button('有用',()=>recordCharacterMemoFeedback(chat,note.id,'useful')),button('不相关',()=>recordCharacterMemoFeedback(chat,note.id,'irrelevant')));content.append(details);
}
