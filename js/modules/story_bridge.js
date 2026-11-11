// Optional local relay for SillyTavern continuity memories.
(function () {
    const STORAGE_KEY = 'uvu-story-bridge.v1';
    const DEFAULT_URL = 'http://127.0.0.1:8765/api/plugins/uvu-story-bridge';
    const PREVIOUS_DEFAULT_URL = 'http://127.0.0.1:8000/api/plugins/uvu-story-bridge';
    const FRONTEND_BUILD = '20261111-review-notification-guards';
    let syncBusy = false;
    let pollTimer = null;
    let sendBusy = false;
    let reviewBusy = false;
    const reviewSaving = new WeakMap();
    let reviewWriteCount = 0;
    let reviewSignature = '';
    const reviewDrafts = new Map();
    let generation = 0;
    let inboxBusy = false;
    let connection = {phase:'idle',failures:0,nextAttempt:0};
    let reconnecting = false;
    let pairingBusy = false;
    let automaticBusy = false;
    let channelSwitchBusy = false;
    let publishingCount = 0;
    let maintenanceBusy = false;
    let lastRequest = {stage:'idle', code:'NONE'};
    let remoteCapacity = null;
    let remoteService = null;
    const reviewView = {page:0, search:'', pendingOnly:false};
    function reviewDraftKey(chat, journal) {
        return STORAGE_KEY + '.review.' + JSON.stringify([channelId(), String(chat.id), String(chat.activeArchiveId || 'default'), String(journal.externalSceneId || journal.id), String(journal.id)]);
    }
    function reviewSource(journal) {return JSON.stringify(journal.bridgeReview?.items || globalThis.UvUBridgeText.segments(journal.content));}
    function readReviewDraft(chat, journal) {
        if ((journal.bridgeReview?.channel || 'st') !== channelId() || String(journal.bridgeReview?.archiveId || 'default') !== String(chat.activeArchiveId || 'default')) return null;
        try {const saved=JSON.parse(localStorage.getItem(reviewDraftKey(chat,journal)) || 'null');
            return saved?.sourceSignature === reviewSource(journal) && Array.isArray(saved.items) ? saved : null;
        } catch {return null;}
    }
    function writeReviewDraft(chat, journal, items) {
        if ((journal.bridgeReview?.channel || 'st') !== channelId() || String(journal.bridgeReview?.archiveId || 'default') !== String(chat.activeArchiveId || 'default')) throw new Error('审核草稿目标已改变，未保存。');
        const key=reviewDraftKey(chat,journal), sourceSignature=reviewSource(journal);
        let previous;try{previous=JSON.parse(localStorage.getItem(key) || 'null');}catch{previous=null;}
        const versions=previous && previous.sourceSignature!==sourceSignature ? [...(previous.previousVersions || []), {sourceSignature:previous.sourceSignature,items:previous.items,updatedAt:previous.updatedAt}] : previous?.previousVersions || [];
        const draft={sourceSignature,items:structuredClone(items),updatedAt:Date.now(),previousVersions:versions.slice(-5)};
        while(draft.previousVersions.length && new TextEncoder().encode(JSON.stringify(draft)).length>2*1024*1024)draft.previousVersions.shift();
        try{localStorage.setItem(key,JSON.stringify(draft));}
        catch(error){
            // Retry only this draft without obsolete versions; never clear other pending material.
            if(!draft.previousVersions.length)throw error;
            draft.previousVersions=[];localStorage.setItem(key,JSON.stringify(draft));
        }
    }
    function clearReviewDraft(chat,journal) {localStorage.removeItem(reviewDraftKey(chat,journal));}
    function diagnosticsSnapshot() {
        const state=settings(), scenes=Object.values(state.pendingScenes), receipts=Object.values(state.receipts);
        return {format:'uvu-bridge-diagnostics',version:1,channel:channelId(),transport:isFileMode()?'file':'relay',enabled:isEnabled(),paired:Boolean(readToken()),
            frontend:{appVersion:typeof appVersion==='string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(appVersion)?appVersion:'unknown',build:FRONTEND_BUILD,protocolVersion:1},
            connection:{phase:connection.phase,failures:connection.failures},request:{...lastRequest},
            target:{selected:Boolean(selectedBridgeChat()),archiveAssigned:Boolean(selectedBridgeChat()?.activeArchiveId)},
            local:{pendingSend:state.outbox.length,sendCapacity:500,remainingSend:Math.max(0,500-state.outbox.length),pendingScenes:scenes.length,
                receivedParts:scenes.reduce((n,scene)=>n+Object.keys(scene.parts || {}).length,0),expectedParts:scenes.reduce((n,scene)=>n+(Number(scene.partCount)||0),0),
                receipts:receipts.length,completedReceipts:receipts.filter(item=>!item.cancelled).length,recoveryWarnings:Object.keys(state.recoveryByCharacter).length,
                sentScopes:Object.keys(state.sentMessages).length,handoffReceipts:Object.keys(state.handoffReceipts).length},
            remote:remoteCapacity?{...remoteCapacity}:null,service:remoteService?{...remoteService}:null,cleanupPolicy:'仅移除已完整导入且有持久回执的分段；保留未完成场景、去重回执与审核版本。'};
    }

    function channelId() {return db.uvuStoryBridgeSettings?.channel === 'tt' ? 'tt' : 'st';}
    function settings(channel = channelId()) {
        db.uvuStoryBridgeSettings = db.uvuStoryBridgeSettings || {};
        const value = channel === 'tt' ? (db.uvuStoryBridgeSettings.ttSettings ||= {}) : db.uvuStoryBridgeSettings;
        value.cursorByCharacter = value.cursorByCharacter || {};
        value.relayByCharacter = value.relayByCharacter || {};
        value.recoveryByCharacter = value.recoveryByCharacter || {};
        value.pendingScenes = value.pendingScenes || {};
        value.sentMessages = value.sentMessages || {};
        value.sentRevisions = value.sentRevisions || {};
        value.outbox = value.outbox || [];
        value.receipts = value.receipts || {};
        value.handoffReceipts = value.handoffReceipts || {};
        value.injectionByCharacter = value.injectionByCharacter || {};
        return value;
    }

    function ttMode() {
        const state = settings('tt');
        if (state.transportVersion !== 1) {
            let valid = false;
            try {
                const url = new URL(String(state.baseUrl || ''));
                valid = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.hostname !== 'github.io' && !url.hostname.endsWith('.github.io');
            } catch {}
            if (!valid) state.transport = 'file';
            state.transportVersion = 1;
        }
        return state.transport === 'file' || state.transport === 'https' ? state.transport : /^https:\/\//i.test(String(state.baseUrl || '')) ? 'https' : 'file';
    }
    function isFileMode() { return channelId() === 'tt' && ttMode() === 'file'; }
    function renderTransportUI() {
        const tt = channelId() === 'tt', file = isFileMode();
        const display = (id, visible) => { const node = document.getElementById(id); if (node) { node.hidden = !visible; if (node.style) node.style.display = visible ? '' : 'none'; } };
        display('uvu-bridge-tt-transport', tt);
        display('uvu-bridge-tt-guide', tt);
        display('uvu-bridge-st-guide', !tt);
        display('uvu-bridge-online-controls', !file);
        display('uvu-bridge-online-actions', !file);
        display('uvu-bridge-recover', !file);
        display('uvu-bridge-handoff', !file);
        const mode = document.getElementById('uvu-bridge-tt-mode'); if (mode) mode.value = ttMode();
        const url = document.getElementById('uvu-bridge-url'); if (url) { url.value = baseUrl(); url.placeholder = tt ? '独立中继 HTTPS 基址；不是 UvU 网页地址' : DEFAULT_URL; }
        const note = document.getElementById('uvu-bridge-intro'); if (note) note.textContent = tt ? 'TT 默认使用无需服务器的 JSON 文件交接。只有自行部署独立中继后才选择 HTTPS 实时连接。' : 'UvU 负责线上手机聊天，SillyTavern 负责线下剧情。本机桥接默认客户端端口为 8765。';
        if (file) connectionStatus('TT 文件交接已就绪：无需地址、配对码或后端；按下方步骤导出 / 导入。');
        renderAdaptiveGuide();renderDiagnostics();
    }
    function renderAdaptiveGuide() {
        if(channelId()!=='tt')return;
        const host=document.getElementById('uvu-bridge-tt-guide');if(!host?.replaceChildren)return;
        const title=document.createElement('summary'),steps=document.createElement('ol');
        title.textContent=isFileMode()?'TT / iOS：无需后端的手动文件交接':'TT / iOS：独立 HTTPS 中继';
        const lines=isFileMode()?[
            '前提：TT 版本须允许第三方扩展并支持 Host ABI 2。安装并刷新 UvU Story Bridge；两端选择 TT 文件模式。此分支无需地址、配对码、Node 或 Termux。',
            'UvU → TT：选择并保存角色，读取该角色当前存档，核对名称、ID、起止楼层；导出线上交接文件，通过系统文件交给 TT。',
            'TT：在对应角色私聊选择 JSON，核对自动填入的角色 / 存档 ID 后导入。到线上记忆审核勾选并保存；开启记忆注入并开始本场后手动发送开场。',
            'TT → UvU：结束并导出本场，下载待交接剧情 JSON；返回 UvU 同角色同存档导入。在审核清单逐层核对、编辑、勾选，或生成摘要后确认。',
            '结果核对：导入只产生待审资料；确认后在角色的回忆日记 / 记忆管理中核对。互通与该角色注入开关都开启时，已审核内容才可作为记忆。',
            '能力边界：文件需每次手动交接，不同步线上 / 线下状态；线下期间请手动暂停 UvU 对应角色自动回复。原聊天和交接文件保留到对方确认保存。iOS 后台不能保证实时同步。',
            '失败时：角色 / 存档不符请切回目标；缺段或校验失败请重新导出完整文件；同场重复导入会去重。无需修改网络来源白名单。'
        ]:[
            '前提：TT 本身没有 ST Node 后端。先自行准备常开服务器、域名与有效 TLS，部署仓库的独立中继；配置精确 UvU 与 TT 来源白名单。',
            'TT：在扩展选择 HTTPS，保存独立中继基址及管理员凭据。UvU：使用同一基址和 TT 生成的配对码；不要将管理员密钥填入 UvU。GitHub Pages 网页不是中继。',
            '完成配对后，绑定 UvU 角色并核对存档，交接线上范围；在 TT 刷新来源、审核保存，再开启注入并开始本场。结束后回 UvU 收取，审核确认后写入记忆。',
            '结果核对：服务接收、对方接收回执、审核保存、实际注入是不同阶段；展开连接分层查看容量和恢复提示。',
            '失败时：401 重新配对；403 核对精确来源与接口权限；404 更新并重启中继；超时无法单独证明 CORS 或服务故障。不要开放任意来源。',
            '能力边界：两端需联网，iOS 可挂起页面。回到前台续收；实时连接不等于后台常驻。未部署中继请切回文件模式。'
        ];
        for(const line of lines){const item=document.createElement('li');item.textContent=line;steps.append(item);}host.replaceChildren(title,steps);
    }
    function completedCleanupPlan() {
        const state=settings(),copies=[],caches=[];let bytes=0;
        const journals=[];
        for(const chat of db.characters || []){for(const journal of chat.memoryJournals || [])journals.push({chat,journal,archiveId:String(chat.activeArchiveId || 'default')});
            for(const archive of chat.archives || [])if(archive.id!==chat.activeArchiveId)for(const journal of archive.data?.memoryJournals || [])journals.push({chat,journal,archiveId:String(archive.id)});}
        const inChannel=journals.filter(({journal})=>journal.source==='sillytavern' && (journal.bridgeReview?.channel || 'st')===channelId());
        for(const [key,scene] of Object.entries(state.pendingScenes)){
            const receipt=state.receipts[key],complete=Number.isInteger(scene.partCount) && scene.partCount>0 && Array.from({length:scene.partCount},(_,index)=>index+1).every(part=>Object.hasOwn(scene.parts || {},part));
            if(!complete || !receipt || receipt.cancelled)continue;
            const target=inChannel.find(({chat,journal,archiveId})=>key===String(chat.id)+':'+journal.externalSceneId && archiveId===String(scene.archiveId || 'default') && archiveId===String(receipt.archiveId || 'default'));
            if(target){copies.push({key,scene});bytes+=new TextEncoder().encode(JSON.stringify(scene)).length;}
        }
        for(const entry of inChannel){const review=entry.journal.bridgeReview,resume=review?.summaryResume;
            if(review?.status==='approved' && !review.summaryDraft && resume?.completed===true){
                caches.push({...entry,resume});bytes+=new TextEncoder().encode(JSON.stringify(resume)).length;
            }}
        return {copies,caches,summary:{completedSceneCopies:copies.length,completedSummaryCaches:caches.length,protectedScenes:Object.keys(state.pendingScenes).length-copies.length,estimatedBytes:bytes,receiptCount:Object.keys(state.receipts).length}};
    }
    async function cleanupCompleted({dryRun=true,confirmed=false,exported=false} = {}) {
        const plan=completedCleanupPlan();if(dryRun)return plan.summary;
        if(!exported || !confirmed)throw new Error('请先导出恢复副本，再确认清理完成态副本。');
        if(maintenanceBusy || reviewBusy || syncBusy || inboxBusy || sendBusy || automaticBusy || publishingCount || pairingBusy || reconnecting || channelSwitchBusy)throw new Error('请等待当前桥接操作完成后清理。');
        const state=settings();maintenanceBusy=true;reviewBusy=true;
        for(const {key} of plan.copies)delete state.pendingScenes[key];
        for(const {journal} of plan.caches)delete journal.bridgeReview.summaryResume;
        try{await saveData();return plan.summary;}
        catch(error){for(const {key,scene} of plan.copies)state.pendingScenes[key]=scene;for(const {journal,resume} of plan.caches)journal.bridgeReview.summaryResume=resume;throw error;}
        finally{maintenanceBusy=false;reviewBusy=false;}
    }
    function renderDiagnostics() {
        const parent=document.getElementById('uvu-story-bridge-settings');if(!parent?.append)return;
        let panel=document.getElementById('uvu-bridge-diagnostics');
        if(!panel){panel=document.createElement('details');panel.id='uvu-bridge-diagnostics';panel.className='uvu-bridge-diagnostics';
            const title=document.createElement('summary'),output=document.createElement('pre'),actions=document.createElement('div');
            title.textContent='连接分层、容量与脱敏诊断';output.id='uvu-bridge-diagnostics-output';actions.className='uvu-bridge-actions';
            const check=document.createElement('button'),copy=document.createElement('button'),recover=document.createElement('button'),restore=document.createElement('button'),clean=document.createElement('button');
            const recoveryInput=document.createElement('input');recoveryInput.type='file';recoveryInput.accept='.json,application/json';recoveryInput.hidden=true;
            for(const button of [check,copy,recover,restore,clean]){button.type='button';button.className='btn btn-secondary';}
            check.textContent='逐步检查连接';check.title='检查当前通道、设备授权、服务版本与所选角色存档；不生成回复。';
            check.addEventListener('click',async()=>{check.disabled=true;try{if(!isEnabled())throw new Error('互通已关闭，请开启后检查。');if(isFileMode()){status('文件模式无需网络；核对角色存档、文件校验和审核保存阶段。');return;}
                if(!readToken())throw new Error('尚未配对，请填写该通道配对码。');const service=await request('/client/service');if(service.protocolVersion!==1){lastRequest={stage:'protocol',code:'INCOMPATIBLE_VERSION'};throw new Error('服务协议版本不兼容，请更新服务端并重启。');}
                const chat=selectedBridgeChat();if(chat)await getMode(chat.id,{timeoutMs:5000});status('连接与服务版本已核对；继续核对交接回执、审核保存和注入开关。');
            }catch(error){if(error.code==='ADDRESS_CHANGED')lastRequest={stage:'binding',code:'ADDRESS_CHANGED'};status(error.message,true);}finally{check.disabled=false;renderDiagnostics();}});
            copy.textContent='导出脱敏诊断';copy.title='只导出状态和计数，排除地址、凭据、角色标识和剧情正文。';copy.addEventListener('click',()=>downloadBridgeFile(diagnosticsSnapshot()));
            recover.textContent='导出本通道恢复副本';recover.title='包含待发正文、未完成场景和收取回执；仅保存本机恢复资料，不包含配对凭据。';
            recover.addEventListener('click',()=>{const state=settings();downloadBridgeFile({format:'uvu-bridge-recovery',version:1,channel:channelId(),createdAt:Date.now(),outbox:state.outbox,pendingScenes:state.pendingScenes,receipts:state.receipts,cursorByCharacter:state.cursorByCharacter});status('恢复副本已导出，包含剧情正文。请妥善保留；本操作不清除任何队列或场景。');});
            restore.textContent='导入本通道恢复副本';restore.title='先预检目标与冲突，再合并待发事件、未完成分段和去重回执；保留本机游标，后续收取仍须审核。';restore.addEventListener('click',()=>recoveryInput.click());
            recoveryInput.addEventListener('change',async()=>{restore.disabled=true;try{const file=recoveryInput.files?.[0];if(!file)return;if(file.size>globalThis.UvUBridgeFile.MAX_BYTES)throw new Error('恢复副本超过 16 MiB。');const text=await file.text(),preview=await importRecovery(text);
                if(!confirm('恢复副本已预检：待发事件 '+preview.outbox+' 条、待恢复场景 '+preview.pendingScenes+' 场、去重回执 '+preview.receipts+' 条。合并后保留当前游标，剧情仍须审核。待发队列会按当前通道在后续同步发送，请先核对角色和服务绑定。继续？'))return;
                await importRecovery(text,{confirmed:true});status('恢复资料已合并。请核对角色、存档与绑定，再手动收取完整剧情并审核；当前游标和已有日记保留。');renderReview(true);
            }catch(error){status('恢复副本未导入：'+error.message,true);}finally{restore.disabled=false;recoveryInput.value='';renderDiagnostics();}});
            clean.textContent='预览并清理已完成副本';clean.title='先显示计数并导出恢复副本；只清理已存在正式日记和持久回执的完整重复分段、已失效的完成态摘要缓存。';
            clean.addEventListener('click',async()=>{clean.disabled=true;try{const preview=await cleanupCompleted();if(!preview.completedSceneCopies && !preview.completedSummaryCaches){status('没有可安全清理的已完成副本；未完成剧情、审核草稿与去重回执均保留。');return;}
                if(!confirm('可清理完整重复场景 '+preview.completedSceneCopies+' 项、完成态旧摘要缓存 '+preview.completedSummaryCaches+' 项，约 '+preview.estimatedBytes+' 字节；保留 '+preview.protectedScenes+' 场待恢复剧情和全部去重回执。下一步先导出恢复副本，继续？'))return;
                const state=settings();downloadBridgeFile({format:'uvu-bridge-cleanup-recovery',version:1,channel:channelId(),createdAt:Date.now(),pendingScenes:state.pendingScenes,receipts:state.receipts,summaryCaches:completedCleanupPlan().caches.map(({chat,journal,archiveId,resume})=>({chatId:chat.id,journalId:journal.id,archiveId,resume}))});
                if(!confirm('恢复副本下载已发起。请确认文件已成功保存后继续清理；取消将保留全部数据。'))return;
                await cleanupCompleted({dryRun:false,confirmed:true,exported:true});status('已清理完成态重复资料；正式日记、未完成剧情和去重回执保留。');renderReview(true);
            }catch(error){status('清理失败，资料已保留：'+error.message,true);}finally{clean.disabled=false;renderDiagnostics();}});
            actions.append(check,copy,recover,restore,clean,recoveryInput);panel.append(title,output,actions);parent.append(panel);
        }
        const output=document.getElementById('uvu-bridge-diagnostics-output');if(!output)return;
        const value=diagnosticsSnapshot(),chat=selectedBridgeChat();
        output.textContent='前端：'+value.frontend.appVersion+' / '+value.frontend.build+' / 协议 '+value.frontend.protocolVersion+'\nUvU 开关：'+(value.enabled?'启用':'停用')+' · 通道：'+value.channel+' / '+value.transport+'\n设备授权：'+(value.paired?'已保存（不代表服务可达）':'未配对')+' · 连接阶段：'+value.connection.phase+'\n服务：'+(value.service?value.service.version+' / 协议 '+value.service.protocolVersion+' / '+(value.service.enabled?'启用':'停用'):'未查询')+'\n目标：'+(chat?'已选择角色':'未选角色')+' · 存档：'+(chat?'已指定':'未指定')+' · 已审核记忆注入：'+(chat && settings().injectionByCharacter[String(chat.id)]!==false && value.enabled?'允许符合审核条件的条目':'关闭或未选择')+'\n本机待发 '+value.local.pendingSend+' / '+value.local.sendCapacity+'，剩余 '+value.local.remainingSend+'；待收场景 '+value.local.pendingScenes+'，已收分段 '+value.local.receivedParts+' / '+value.local.expectedParts+'；缺口警告 '+value.local.recoveryWarnings+'\n服务队列：'+(value.remote?value.remote.used+' / '+value.remote.limit+'，剩余 '+value.remote.remaining:'旧服务或文件模式未提供容量')+'\n最近检查：'+value.request.stage+' / '+value.request.code+'\n网络不可达只能确定请求失败，不能仅凭浏览器错误区分 CORS、TLS、服务关闭或网络拦截。\n'+value.cleanupPolicy;
    }
    async function changeTTMode(value) {
        if (!['file', 'https'].includes(value)) throw new Error('不支持的 TT 交接方式。');
        if (channelSwitchBusy || publishingCount || inboxBusy || syncBusy || sendBusy || reviewBusy || reviewWriteCount || pairingBusy || reconnecting || automaticBusy) throw new Error('请等待当前收发或总结完成后切换交接方式。');
        const state = settings('tt'), previous = state.transport;
        channelSwitchBusy = true; generation++; state.transport = value;
        try { await saveData(); } catch (error) { if (previous === undefined) delete state.transport; else state.transport = previous; throw error; } finally { channelSwitchBusy = false; }
        remoteCapacity=null;remoteService=null;lastRequest={stage:'idle',code:'NONE'};
        connection = {phase: isConnected() ? 'idle' : 'unpaired', failures: 0, nextAttempt: 0};
        renderTransportUI();
        if (!isFileMode()) connectionStatus('HTTPS 实时模式：先部署独立中继，再填写基址与 TT 生成的配对码。');
    }

    function isEnabled() { return !channelSwitchBusy && settings().bridgeEnabled !== false; }
    function tokenKey() {return STORAGE_KEY + (channelId() === 'tt' ? '.tt' : '');}

    function readToken() {
        try { return JSON.parse(localStorage.getItem(tokenKey()) || '{}').token || ''; }
        catch { return ''; }
    }

    function saveToken(token, device) {
        if (token) localStorage.setItem(tokenKey(), JSON.stringify({ token, baseUrl:baseUrl(), device }));
        else localStorage.removeItem(tokenKey());
        connection = {phase:token ? 'idle' : 'unpaired',failures:0,nextAttempt:0};
    }

    function bindTokenAddress(address) {
        const stored = JSON.parse(localStorage.getItem(tokenKey()) || '{}');
        if (stored.baseUrl && stored.baseUrl !== address) throw Object.assign(new Error('桥接地址已改变，原绑定只用于原地址。请恢复地址，或在新地址重新配对。'),{code:'ADDRESS_CHANGED'});
        if (!stored.baseUrl && stored.token) localStorage.setItem(tokenKey(),JSON.stringify({...stored,baseUrl:address}));
    }

    function connectionSnapshot() { return {...connection}; }
    function connectionStatus(message) {
        const output=document.getElementById('uvu-bridge-connection');
        if (output) {output.textContent=message;output.dataset.phase=connection.phase;}
    }

    function baseUrl() {
        const saved = String(settings().baseUrl || '').trim().replace(/\/+$/, '');
        if(channelId()==='tt')return saved;
        if (!saved || saved === PREVIOUS_DEFAULT_URL) {
            settings().baseUrl = DEFAULT_URL;
            return DEFAULT_URL;
        }
        return saved;
    }

    function targetAddressSpace() {
        try {
            const hostname = new URL(baseUrl()).hostname.toLowerCase();
            if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || /^127\./.test(hostname)) return 'loopback';
            if (hostname.endsWith('.local') || /^(10\.|192\.168\.|169\.254\.)/.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return 'local';
        } catch {}
        return undefined;
    }

    async function loopbackPermissionState() {
        if (!globalThis.navigator?.permissions?.query) return 'unavailable';
        try {
            return (await navigator.permissions.query({ name: 'loopback-network' })).state || 'unknown';
        } catch { return 'unavailable'; }
    }

    function bridgeAddress(address) {
        let url;try{url=new URL(address);}catch{throw new Error('桥接地址无效。');}
        const host=url.hostname, octets=host.split('.').map(Number);
        const ipv4=octets.length===4 && octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
        const local=host==='localhost' || host==='[::1]' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa') || /^[a-z][a-z0-9-]*$/i.test(host) ||
            ipv4 && (octets[0]===127 || octets[0]===10 || octets[0]===192 && octets[1]===168 || octets[0]===172 && octets[1]>=16 && octets[1]<=31 || octets[0]===169 && octets[1]===254) || /^\[(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(host);
        if(url.username || url.password || url.search || url.hash || !(url.protocol==='https:' || url.protocol==='http:' && local))throw new Error('桥接地址需无账户、查询参数和片段；远程地址必须使用 HTTPS，本机与局域网可用 HTTP。');
        return url;
    }
    function waitBridge(promise,signal){
        if(signal.aborted)return Promise.reject(signal.reason || new Error('桥接请求已取消'));
        return new Promise((resolve,reject)=>{const cancel=()=>reject(signal.reason || new Error('桥接请求已取消'));signal.addEventListener('abort',cancel,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));});
    }
    function bridgeDeadline(caller,timeout){
        if(globalThis.AbortSignal?.timeout && (!caller || globalThis.AbortSignal?.any)){const timed=AbortSignal.timeout(timeout);return {signal:caller?AbortSignal.any([caller,timed]):timed,dispose(){}};}
        if(!globalThis.AbortController)throw new Error('浏览器不支持请求取消，请升级浏览器或使用文件交接。');
        const controller=new AbortController(),cancel=()=>controller.abort(caller?.reason);
        caller?.addEventListener('abort',cancel,{once:true});if(caller?.aborted)cancel();
        const timer=setTimeout(()=>controller.abort(new Error('桥接请求超时')),timeout);
        return {signal:controller.signal,dispose(){clearTimeout(timer);caller?.removeEventListener('abort',cancel);}};
    }
    async function readBridgeJson(response,signal){
        const max=16*1024*1024;
        // Lightweight test adapters may implement json only; browser Responses always expose headers/body.
        if(!response.headers?.get && response.body===undefined){const value=await waitBridge(response.json(),signal);if(new TextEncoder().encode(JSON.stringify(value)).length>max)throw new Error('桥接响应过大（最多 16 MiB）');return value;}
        const type=(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if(type!=='application/json' || Number(response.headers.get('content-length'))>max){void response.body?.cancel().catch(()=>{});throw new Error(type!=='application/json'?'桥接响应必须为 JSON':'桥接响应过大（最多 16 MiB）');}
        if(!response.body?.getReader)throw new Error('浏览器不支持安全读取桥接 JSON，请升级浏览器或使用文件交接。');
        const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
        try{while(true){const {value,done}=await waitBridge(reader.read(),signal);if(done)break;size+=value.byteLength;if(size>max)throw new Error('桥接响应过大（最多 16 MiB）');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
            let data;try{data=JSON.parse(text);}catch{throw new Error('桥接响应 JSON 无效');}if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('桥接响应 JSON 必须为对象');return data;
        }finally{void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
    }
    async function request(path, { method = 'GET', body, auth = true, signal: callerSignal, timeoutMs = 15000 } = {}) {
        if(channelSwitchBusy)throw new Error('请等待通道切换完成。');
        if(isFileMode())throw new Error('TT 文件模式无需连接或配对；请使用导出 / 导入文件。');
        const epoch = generation;
        const headers = { Accept: 'application/json' };
        const token = readToken();
        if (auth && !token) throw new Error('尚未配对酒馆桥接服务。');
        const address = baseUrl();
        bridgeAddress(address);
        if (channelId()==='tt') {
            let url;try{url=new URL(address);}catch{throw new Error('请先设置 TT HTTPS 桥接地址，或使用文件交接。');}
            if(url.hostname === 'github.io' || url.hostname.endsWith('.github.io')) throw new Error('GitHub Pages 是静态网页，不能接收桥接请求；请使用文件交接，或填写独立 HTTPS 中继地址。');
            if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash)throw new Error('TT 通道需要不含账户、查询参数和片段的 HTTPS 地址。');
        }
        if (auth) bindTokenAddress(address);
        if (auth) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let response;
        const deadline=bridgeDeadline(callerSignal,Math.max(1, Math.min(15000, Number(timeoutMs) || 15000))),signal=deadline.signal;
        try {
        if (signal.aborted) throw signal.reason;
        lastRequest={stage:'request',code:'PENDING'};
        const addressSpace = targetAddressSpace();
        try {
            response = await waitBridge(fetch(`${address}/v1${path}`, {
                signal, method, headers, body: body === undefined ? undefined : JSON.stringify(body),
                redirect:'error',referrerPolicy:'no-referrer',credentials:'omit',cache:'no-store',
                ...(addressSpace ? { targetAddressSpace: addressSpace } : {})
            }),signal);
        } catch (error) {
            if (signal.aborted) {lastRequest={stage:'request',code:callerSignal?.aborted?'CANCELLED':'TIMEOUT'};throw signal.reason || error;}
            lastRequest={stage:'browser-or-network',code:'NETWORK_UNREACHABLE'};
            const permission = addressSpace === 'loopback' ? await loopbackPermissionState() : 'not-loopback';
            const diagnosis = permission === 'denied'
                ? 'Chrome 已拒绝此网站的 loopback-network 权限，请在该网站权限中解除阻止。'
                : permission === 'prompt'
                    ? 'loopback-network 尚未授权；若没有弹窗，请确认使用 HTTPS 页面并在页面内点击连接。'
                    : permission === 'granted'
                        ? 'loopback-network 已授权；请检查酒馆桥接插件是否已启动、server/config.json 是否包含当前 UvU 来源，以及客户端端口是否与桥接地址一致。'
                        : permission === 'unavailable'
                            ? '浏览器未提供 loopback-network 权限状态；请确认已安装并启动酒馆桥接插件、server/config.json 来源白名单与客户端端口配置正确。'
                            : channelId() === 'tt' ? '请检查独立 HTTPS 中继是否运行、TLS 证书和 TT / UvU 精确来源白名单；UvU 网页地址不能作为中继。也可改用文件交接。' : '请确认酒馆桥接地址和服务状态。';
            throw new Error(`浏览器未能连接酒馆（loopback-network: ${permission}）：${diagnosis}`, { cause: error });
        }
        let data;try{data=await readBridgeJson(response,signal);}
        catch(error){lastRequest={stage:'response',code:signal.aborted?(callerSignal?.aborted?'CANCELLED':'TIMEOUT'):/过大/.test(error.message)?'RESPONSE_TOO_LARGE':'INVALID_JSON_RESPONSE'};throw error;}
        lastRequest={stage:'response',code:'HTTP_'+(response.status || 200)};
        if(data.protocolVersion!==undefined)remoteService={version:/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-z0-9.-]+)?$/i.test(String(data.version))?String(data.version).slice(0,30):'unknown',protocolVersion:Number(data.protocolVersion)||0,enabled:data.enabled!==false};
        if(data.capacity && Number.isFinite(data.capacity.limit)) remoteCapacity={limit:data.capacity.limit,used:Number(data.capacity.used)||0,remaining:Number(data.capacity.remaining)||0};
        if(epoch!==generation)throw new Error('互通通道或开关已变更，未应用旧请求。');
        if (!response.ok) {
            const help = { 401: '配对码无效或令牌失效，请重新配对', 403: '来源白名单、回环地址或接口权限不通过', 404: '接口不存在，请检查中继基址或更新服务端', 405: '此地址不接受桥接写入；静态网页不能作为中继，请改用文件交接或独立中继', 413: '剧情数据超过限制' };
            if (auth && response.status === 401 && token === readToken() && address === baseUrl()) {
                connection.phase='revoked';connection.nextAttempt=Infinity;
                connectionStatus('绑定凭证已失效或被解除，请重新配对；本机凭证尚未清除。');
            }
            throw Object.assign(new Error(`HTTP ${response.status} · ${help[response.status] || '桥接请求失败'}`),{status:response.status});
        }
        return data;
        } finally {deadline.dispose();}
    }

    function status(message, error = false) {
        const output = document.getElementById('uvu-bridge-status');
        if (output) {
            output.textContent = message;
            output.dataset.error = String(error);
        }
    }

    function eventId() {
        return globalThis.crypto?.randomUUID?.() || `uvu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function cleanText(value) { return globalThis.UvUBridgeText.clean(value, settings().excludeTags || ''); }

    function currentBridgeChat() {
        return typeof currentChatType !== 'undefined' && currentChatType === 'private'
            ? db.characters.find(item => item.id === currentChatId) : null;
    }
    function selectedBridgeChat() {
        const id = document.getElementById('uvu-bridge-handoff-character')?.value || settings().handoffCharacterId;
        return id ? db.characters.find(chat => String(chat.id) === String(id)) || null : currentBridgeChat();
    }

    async function saveHandoffCharacter() {
        if(channelSwitchBusy)throw new Error('请等待通道切换完成。');
        const chat = selectedBridgeChat();
        if (!chat) throw new Error('请选择有效角色；原保存角色可能已删除。');
        const state = settings(), before = state.handoffCharacterId;
        state.handoffCharacterId = String(chat.id);
        try { await saveData(); }
        catch (error) { if (before === undefined) delete state.handoffCharacterId; else state.handoffCharacterId = before; throw error; }
        status('已保存交接角色：' + (chat.realName || chat.name || chat.id) + '；再次进入不会跟随其他聊天。');
    }

    function allowedMemory(chat, journal) {
        const state=settings(journal.bridgeReview?.channel || 'st');
        const saving = reviewSaving.get(chat);
        return journal.source !== 'sillytavern' || (!(saving && saving.journalId === journal.id && saving.archiveId === chat.activeArchiveId) && state.bridgeEnabled !== false && journal.isFavorited === true &&
            String(journal.bridgeReview?.archiveId || 'default') === String(chat.activeArchiveId || 'default') &&
            journal.bridgeReview?.status === 'approved' && journal.bridgeReview.items?.some(item => item.selected && item.text) &&
            state.injectionByCharacter[String(chat.id)] !== false);
    }
    function memoryState(chat, journal) {
        if (journal.bridgeReview?.status !== 'approved') return '已收到 · 待审核';
        if (!journal.isFavorited) return '已批准 · 未收藏';
        return allowedMemory(chat, journal) ? '已批准 · 可注入' : '已批准 · 来源停用';
    }

    function turnStart(chat) {
        const index = (chat.history || []).findLastIndex(message => message?.role === 'user');
        return Math.max(0, index);
    }

    function messageRecords(chat, start = turnStart(chat), end = (chat.history || []).length) {
        return (chat.history || []).slice(start, end).map((message, index) => {
            if (!message || !['user', 'assistant'].includes(message.role) || message.isThinking || message.isHidden || message.isWithdrawn || message.isContextDisabled || message.isStatusUpdate || message.relationshipDelivery) return null;
            const text = cleanText(message.content || (message.parts || []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
            if (!text) return null;
            const stamp = Number(message.timestamp), known = Number.isFinite(stamp) && stamp > 0;
            const speaker = message.role === 'user' ? chat.myName || 'User' : chat.realName || chat.name || 'Character';
            return { id: String(message.id || ('legacy-' + (start + index) + '-' + globalThis.UvUBridgeText.fingerprint(text))),
                text: '[' + (known ? new Date(stamp).toISOString() : '时间未知') + ' | ' + speaker + ']\n' + text,
                createdAt: known ? stamp : 0 };
        }).filter(Boolean);
    }

    function isConnected() { return !isFileMode() && Boolean(readToken()); }

    function latestHandoffRange(chat) {
        const history = chat.history || [];
        let start = 0, end = 0, count = 0;
        for (let i = history.length - 1; i >= 0 && count < 50; i--) {
            if (!messageRecords(chat, i, i + 1).length) continue;
            if (!end) end = i + 1;
            start = i + 1; count++;
        }
        return { start, end, count };
    }

    function updateHandoffRange(force = false) {
        const start = document.getElementById('uvu-bridge-handoff-start');
        const end = document.getElementById('uvu-bridge-handoff-end');
        const chat = selectedBridgeChat();
        if (!start || !end || !chat) return;
        const identity = String(chat.id) + ':' + String(chat.activeArchiveId || 'default');
        if (force || start.dataset.identity !== identity) start.dataset.manual = '';
        start.dataset.identity = identity;
        if (!start.dataset.manual) { const range = latestHandoffRange(chat); start.value = range.start || ''; end.value = range.end || ''; }
        const output = document.getElementById('uvu-bridge-handoff-source');
        if (typeof output?.querySelector === 'function' && output.querySelector('summary')) {
            const archive = chat.archives?.find(item => item.id === chat.activeArchiveId);
            const latest = messageRecords(chat, Math.max(0, Number(end.value) - 1), Number(end.value))[0];
            const name = chat.realName || chat.name || '角色';
            const archiveName = archive?.name || '默认存档';
            output.querySelector('summary').textContent = `${archiveName} · ${(chat.history || []).length} 条 · ${start.value || 0}–${end.value || 0}`;
            output.querySelector('.uvu-bridge-handoff-detail-body').textContent = `${name} · 存档 ID：${chat.activeArchiveId || 'default'}\n范围末条：${latest?.text.slice(-120) || '无有效正文'}`;
        } else if (output) {
            const archive = chat.archives?.find(item => item.id === chat.activeArchiveId);
            const latest = messageRecords(chat, Math.max(0, Number(end.value) - 1), Number(end.value))[0];
            output.textContent = `${chat.realName || chat.name || chat.id} · 当前分支 ${archive?.name || '默认存档'}（${chat.activeArchiveId || 'default'}） · 共 ${(chat.history || []).length} 条消息 · 交接 ${start.value || 0}–${end.value || 0}；范围末条：${latest?.text.slice(-120) || '无有效正文'}`;
        }
    }

    function refreshHandoffContext() { renderHandoffCharacters(true); updateHandoffRange(true); renderReview(true); }
    function readSelectedHandoffContext() { renderHandoffCharacters(); updateHandoffRange(true); renderReview(true); }

    async function handoffCurrent() {
        const chat = selectedBridgeChat();
        if (!chat) throw new Error('请选择要交接的角色。');
        updateHandoffRange();
        const start = Number(document.getElementById('uvu-bridge-handoff-start')?.value), end = Number(document.getElementById('uvu-bridge-handoff-end')?.value);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > (chat.history || []).length) throw new Error('请输入有效楼层范围（1 到当前存档消息总数）。');
        const records = messageRecords(chat, start - 1, end);
        const transfer = { id: eventId(), at: Date.now(), start, end, count: records.length, totalMessages: (chat.history || []).length, latestMessageAt: records.at(-1)?.createdAt || 0 };
        return publishTurn(chat, null, records, transfer);
    }

    async function pair() {
        if(channelSwitchBusy)throw new Error('请等待通道切换完成。');
        if (pairingBusy || reconnecting) throw new Error('连接操作正在进行，请稍候。');
        pairingBusy=true;
        try {
        const urlInput = document.getElementById('uvu-bridge-url');
        const codeInput = document.getElementById('uvu-bridge-pair-code');
        settings().baseUrl = (urlInput?.value || (channelId()==='tt' ? '' : DEFAULT_URL)).trim().replace(/\/+$/, '');
        const address=baseUrl(),epoch=++generation;
        let result;
        try {
            result = await request('/client/pair', { method: 'POST', body: { code: String(codeInput?.value || '').trim(), device:{name:String(document.getElementById('uvu-bridge-device-name')?.value || 'UvU 浏览器').trim().slice(0,80)} }, auth: false });
        } catch (error) {
            await saveData().catch(() => {});
            throw error;
        }
        if (!result.token) throw new Error('酒馆未返回配对令牌。');
        if (epoch!==generation || address!==baseUrl()) throw new Error('连接目标已改变，请核对地址后重新配对。');
        saveToken(result.token,result.device);
        if (codeInput) codeInput.value = '';
        await saveData();
        connectionStatus('已保存长期绑定；以后可自动重连。');
        status('配对成功，绑定已保存在当前浏览器。');
        try { await publishCharacterDirectory(true); await reconnect({force:true}); }
        catch(error) {status('绑定已保存，后续同步待重试：'+error.message,true);}
        } finally {pairingBusy=false;}
    }

    async function reconnect({force=false} = {}) {
        if (!isEnabled() || !isConnected() || document.visibilityState!=='visible' || reconnecting) return false;
        if (!force && (connection.phase==='revoked' || Date.now()<connection.nextAttempt)) return false;
        reconnecting=true;
        const token=readToken(),address=baseUrl(),epoch=generation;
        const current=()=>token===readToken() && address===baseUrl() && epoch===generation && isEnabled();
        try {
            connection.phase='connecting';connectionStatus('已绑定，正在连接酒馆…');
            let session;
            try {session=await request('/client/session');}
            catch(error) {if(error.status!==404)throw error;await request('/client/service');session={paired:true};}
            if (!current()) return false;
            if(session.paired!==true) throw new Error('服务端未确认绑定，请检查插件版本。');
            connection={phase:'connected',failures:0,nextAttempt:Date.now()+30000};
            connectionStatus('已绑定 · 已连接'+(session.device?.name ? ' · '+session.device.name : ''));
            return true;
        } catch(error) {
            if (!current()) return false;
            const failures=connection.failures+1;
            connection={phase:error.status===401?'revoked':error.code==='ADDRESS_CHANGED'?'address-changed':'waiting',failures,
                nextAttempt:error.status===401?Infinity:Date.now()+Math.min(120000,5000*2**Math.min(failures-1,5))};
            connectionStatus(connection.phase==='revoked'?'绑定已失效，请重新配对。':connection.phase==='address-changed'?error.message:'已绑定，等待酒馆连接；绑定已保留，将自动重试。');
            return false;
        } finally {reconnecting=false;}
    }

    async function automaticSync() {
        if (maintenanceBusy || automaticBusy || pairingBusy || !isEnabled() || !isConnected() || document.visibilityState!=='visible') return;
        automaticBusy=true;
        const token=readToken(),address=baseUrl(),epoch=generation;
        const current=()=>token===readToken() && address===baseUrl() && epoch===generation && isEnabled();
        try {
            if (connection.phase!=='connected' || Date.now()>=connection.nextAttempt) {if(!await reconnect())return;}
            if (!current()) return;
            await publishCharacterDirectory();
            if (!current()) return;
            await flushOutbox();
            if (!current()) return;
            await syncInbox();
        } catch(error) {
            if (!current()) return;
            if (connection.phase!=='revoked') {connection.phase='waiting';connection.failures++;connection.nextAttempt=Date.now()+Math.min(120000,5000*2**Math.min(connection.failures-1,5));connectionStatus('已绑定，连接中断；绑定已保留，将自动重试。');}
            console.warn('UvU Bridge automatic sync:',error.message);
        } finally {automaticBusy=false;}
    }

    async function publishCharacterDirectory(force = false) {
        if (!isEnabled() || !isConnected()) return;
        const characters = (db.characters || []).filter(character => character?.id != null).map(character => ({
            id: String(character.id),
            name: String(character.realName || character.name || character.remarkName || '未命名角色').trim().slice(0, 120)
        }));
        const fingerprint = JSON.stringify(characters);
        if (!force && settings().characterDirectoryFingerprint === fingerprint) return;
        await request('/client/characters', { method: 'PUT', body: { characters } });
        settings().characterDirectoryFingerprint = fingerprint;
    }

    async function disconnect() {
        let remoteError;
        try { if (isConnected()) await request('/client/revoke', { method: 'POST', body: {} }); } catch (error) { if(error.status!==401)remoteError = error; }
        if (remoteError && !confirm('无法确认服务端解绑。是否仅断开本机？服务端旧设备仍需在酒馆“已绑定设备”中解除。')) throw remoteError;
        saveToken(''); generation++;
        connectionStatus('本机已解除绑定。');
        status(remoteError ? '本机已断开；请在酒馆设备列表解除对应旧设备。' : '已解除当前设备绑定；其他设备继续有效。');
    }

    async function getMode(characterKey, options = {}) {
        if (!isEnabled() || !isConnected()) return { mode: 'online' };
        const epoch = generation;
        const chat = db.characters.find(item => String(item.id) === String(characterKey));
        const archiveId = String(chat?.activeArchiveId || 'default');
        const mode = await request(`/client/state?characterKey=${encodeURIComponent(String(characterKey || ''))}`, options);
        if (!isEnabled() || generation !== epoch || mode.enabled === false || (mode.archiveId && mode.archiveId !== archiveId) || String(chat?.activeArchiveId || 'default') !== archiveId) return { mode: 'online' };
        return mode;
    }

    async function flushOutbox() {
        if (maintenanceBusy || !isEnabled() || sendBusy || !isConnected()) return;
        sendBusy = true;
        try {
            while (isEnabled() && settings().outbox.length) {
                const batch = settings().outbox.slice(0, 10), acknowledged = [];
                let networkError;
                for (const event of batch) {
                    if (!isEnabled()) break;
                    try { await request('/client/events', { method: 'POST', body: event }); acknowledged.push(event); }
                    catch(error) { networkError = error; break; }
                }
                if (acknowledged.length) {
                    const oldSent = structuredClone(settings().sentMessages), oldRevisions = structuredClone(settings().sentRevisions);
                    const ids = new Set(acknowledged.map(event => event.eventId));
                    for (const event of acknowledged) {
                        const key = event.characterKey + ':' + event.payload.archiveId;
                        const sent = settings().sentMessages[key] || [], revisions = settings().sentRevisions[key] || {};
                        settings().sentMessages[key] = [...new Set([...sent, ...(event.payload.messages || []).map(item => item.sourceMessageId || item.id)])].slice(-1000);
                        for (const item of event.payload.messages || []) if (item.revision) revisions[item.sourceMessageId || item.id] = item.revision;
                        settings().sentRevisions[key] = Object.fromEntries(settings().sentMessages[key].filter(id => revisions[id]).map(id => [id, revisions[id]]));
                    }
                    settings().outbox = settings().outbox.filter(event => !ids.has(event.eventId));
                    try { await saveData(); }
                    catch(error) {
                        settings().sentMessages = oldSent; settings().sentRevisions = oldRevisions;
                        settings().outbox.unshift(...acknowledged);
                        throw error;
                    }
                }
                if (networkError) throw networkError;
            }
        } finally { sendBusy = false; }
    }

    async function publishTurn(chat, mode, explicitRecords, handoff) {
        if(maintenanceBusy)throw new Error('完成态清理正在保存，请稍后交接。');
        if (!isEnabled()) throw new Error('酒馆互通插件已停用，请先开启后再交接剧情。');
        publishingCount++;
        try {
        const archiveId = String(chat.activeArchiveId || 'default');
        const archiveName = String(chat.archives?.find(item => item.id === chat.activeArchiveId)?.name || '默认存档').slice(0, 160);
        const key = String(chat.id) + ':' + archiveId;
        const sent = new Set([...(settings().sentMessages[key] || []), ...settings().outbox.filter(event => event.characterKey === String(chat.id) && event.payload.archiveId === archiveId).flatMap(event => event.payload.messages.map(item => item.sourceMessageId || item.id))]);
        const queuedRecords = settings().outbox.filter(event => event.characterKey === String(chat.id) && event.payload.archiveId === archiveId).flatMap(event => event.payload.messages || []);
        const records = (explicitRecords || messageRecords(chat)).map(item => ({ ...item, revision: globalThis.UvUBridgeText.fingerprint(item.text) })).filter(item => {
            if (queuedRecords.some(record => (record.sourceMessageId || record.id) === item.id && record.revision === item.revision)) return false;
            // An explicit handoff is also recovery: a local sent ledger is not a receiver receipt.
            return explicitRecords ? true : settings().sentRevisions[key]?.[item.id] !== item.revision;
        });
        if (!records.length) { await flushOutbox(); return { queued: 0, pending: settings().outbox.length }; }
        const events = [];
        // Bound each payload before transmission; IDs are stable within the durable outbox.
        for (const record of records) {
            const points = [...record.text], parts = [];
            for (let i = 0; i < points.length; i += 5000) parts.push(points.slice(i, i + 5000).join(''));
            parts.forEach((text, index) => events.push({ source: 'uvu', eventId: eventId(),
                kind: mode?.mode === 'phone' ? 'phone_exchange' : 'memory_packet', characterKey: String(chat.id), createdAt: Date.now(),
                payload: { title: explicitRecords ? '手动交接线上剧情' : 'UvU 线上聊天', archiveId, archiveName, ...(handoff ? { handoff } : {}),
                    messages: [{ ...record, sourceMessageId: record.id, id: record.id + (parts.length > 1 ? ':part-' + (index + 1) : ''),
                        ...(parts.length > 1 ? { messagePart: index + 1, messagePartCount: parts.length } : {}), text }], text }
            }));
        }
        if (settings().outbox.length + events.length > 500) throw new Error('待发送剧情超过 500 条，请先恢复连接重试。');
        settings().outbox.push(...events);
        try { await saveData(); } catch(error) { const ids = new Set(events.map(event => event.eventId)); settings().outbox = settings().outbox.filter(event => !ids.has(event.eventId)); throw error; }
        await flushOutbox();
        return { queued: records.length, pending: settings().outbox.length, archiveId, archiveName, handoff };
        } finally {publishingCount--;}
    }

    async function verifyPart(text, hash) {
        if (!hash) return;
        if (!/^[a-f0-9]{64}$/i.test(hash) || !globalThis.crypto?.subtle) throw new Error('无法验证剧情校验值，请更新浏览器后重试。');
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        const actual = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== hash.toLowerCase()) throw new Error('剧情分段校验失败；未导入。');
    }

    function finishSceneIfReady(chat, sceneId, scene, journals) {
        if (scene.imported || !Array.from({ length: scene.partCount }, (_, index) => index + 1).every(part => Object.hasOwn(scene.parts, part))) return false;
        if (journals.some(item => item.externalSceneId === sceneId && (item.bridgeReview?.channel || 'st') === channelId())) { scene.imported = true; return false; }
        if (scene.archiveId && scene.archiveId !== String(chat.activeArchiveId || 'default')) return false;
        const items = scene.sceneFormat === 'floors-v1'
            ? globalThis.UvUBridgeText.floorItems(scene.parts, scene.floorParts)
            : globalThis.UvUBridgeText.legacyFloorItems(Array.from({ length: scene.partCount }, (_, index) => scene.parts[index + 1]).join('\n\n'));
        const content = globalThis.UvUBridgeText.memoryText(items.map(item => ({...item, selected: true})));
        if (!content) throw new Error('剧情过滤后为空，请回酒馆核对正文和排除标签。');
        journals.push({ id: (channelId()==='tt' ? 'tt_scene_' : 'st_scene_') + sceneId, externalSceneId: sceneId, source: 'sillytavern',
            title: (chat.realName || chat.remarkName || chat.name || '当前角色') + ' · ' + scene.title,
            content, range: { start: 0, end: 0 }, createdAt: scene.createdAt,
            chatId: chat.id, chatType: 'private', isFavorited: false,
            bridgeReview: { version: 2, channel:channelId(), sceneFormat: scene.sceneFormat || 'legacy', status: 'pending', archiveId: String(chat.activeArchiveId || 'default'),
                sourceText: content, stCharacterKey: scene.stCharacterKey || '', items }
        });
        scene.imported = true;
        return true;
    }

    async function syncIncoming(characterKey = '', pageBudget = 20, recover = false, fileBatch = null) {
        if (maintenanceBusy || !isEnabled() || (!fileBatch && !isConnected()) || syncBusy || !characterKey || document.visibilityState !== 'visible') return 0;
        const chat = db.characters.find(item => String(item.id) === String(characterKey));
        if (!chat) return 0;
        syncBusy = true;
        const epoch = generation;
        const archiveId = chat.activeArchiveId, history = chat.history;
        const assertCurrent = () => {
            if (!isEnabled() || epoch !== generation) throw new Error('互通已暂停，未应用旧请求的结果。');
            if (!db.characters.includes(chat) || chat.activeArchiveId !== archiveId || chat.history !== history) throw new Error('接收期间角色或存档已切换；未写入剧情，请返回原存档重试。');
        };
        const state = settings(), cursor = Number(state.cursorByCharacter[characterKey] || 0);
        let imported = 0, committed = false, addedIds = [];
        const previousScenes = state.pendingScenes, previousReceipts = state.receipts, previousHandoffs = state.handoffReceipts;
        const handoffs = {...previousHandoffs};
        let removedJournals = [];
        const staged = structuredClone(previousScenes), receipts = { ...previousReceipts };
        try {
            const result = { events: [], gapDetected: false };
            let pageCursor = recover ? 0 : cursor;
            for (let page = 0; page < pageBudget; page++) {
                const batch = fileBatch || await request('/client/events?after=' + pageCursor + '&characterKey=' + encodeURIComponent(characterKey) + '&limit=100');
                assertCurrent();
                result.relayId = batch.relayId || result.relayId;
                result.latestSeq = batch.latestSeq;
                const relayChanged = batch.relayId && state.relayByCharacter[characterKey] && batch.relayId !== state.relayByCharacter[characterKey];
                if (!recover && (relayChanged || (Number.isFinite(batch.latestSeq) && batch.latestSeq < cursor))) {
                    state.recoveryByCharacter[characterKey] = '桥接服务已重建，旧游标不适用';
                    status('桥接服务已重建，请点击“恢复收取”核对并恢复完整剧情。', true); return 0;
                }
                result.gapDetected = result.gapDetected || batch.gapDetected;
                const events = batch.events || []; result.events.push(...events);
                if (fileBatch || events.length < 100 || (batch.gapDetected && !recover)) break;
                const next = Math.max(...events.map(item => Number(item.seq) || 0));
                if (next <= pageCursor) throw new Error('桥接分页游标没有前进，请检查服务端版本。');
                pageCursor = next;
            }
            assertCurrent();
            if (result.gapDetected && !recover) { state.recoveryByCharacter[characterKey] = '队列有过期片段'; status('桥接队列已有过期记录，不能确认剧情完整；请重新导出后点击“恢复收取”，只恢复完整剧情。', true); return 0; }
            // Recovery merges retained parts; incomplete scenes remain recoverable even if the relay lost older events.
            if ((result.events || []).some(item => String(item.characterKey) !== String(characterKey))) { status('收到角色 ID 不匹配的剧情，已停止导入。', true); return 0; }
            let nextCursor = recover ? 0 : cursor;
            for (const event of result.events || []) {
                if (!fileBatch) nextCursor = Math.max(nextCursor, Number(event.seq) || 0);
                if (event.kind === 'handoff_receipt') {
                    const payload = event.payload || {};
                    if (typeof payload.handoffId === 'string' && typeof payload.archiveId === 'string') handoffs[String(characterKey) + ':' + payload.handoffId] = {...payload, characterKey: String(characterKey)};
                    continue;
                }
                if (event.kind === 'scene_cancelled') {
                    const key = String(characterKey) + ':' + String(event.sceneId || '');
                    delete staged[key]; receipts[key] = { cancelled: true, at: Date.now() };
                    continue;
                }
                if (event.kind !== 'scene_transcript') continue;
                const payload = event.payload || {}, id = String(event.sceneId || ''), part = Number(payload.part), count = Number(payload.partCount);
                if (!id || !Number.isInteger(part) || !Number.isInteger(count) || count < 1 || count > 2000 || part < 1 || part > count || typeof payload.text !== 'string') throw new Error('酒馆剧情分段格式无效；未导入。');
                if (payload.sceneFormat && payload.sceneFormat !== 'floors-v1') throw new Error('不支持的剧情楼层格式，请更新 UvU。');
                if (payload.sceneFormat === 'floors-v1') globalThis.UvUBridgeText.validateFloor(payload.floor);
                await verifyPart(payload.text, payload.partHash); assertCurrent();
                const key = String(characterKey) + ':' + id;
                if (receipts[key]) continue;
                const scene = staged[key] || (staged[key] = { characterKey: String(characterKey), title: String(payload.title || '酒馆线下剧情'), createdAt: Number(event.createdAt) || Date.now(), partCount: count, parts: {},
                    archiveId: String(payload.uvuArchiveId || ''), stCharacterKey: String(payload.stCharacterKey || ''),
                    sceneFormat: payload.sceneFormat || '', floorParts: {} });
                if (scene.partCount !== count || (scene.archiveId || '') !== String(payload.uvuArchiveId || '') || (scene.stCharacterKey || '') !== String(payload.stCharacterKey || '')) throw new Error('同一剧情的分段身份或总数不一致；未导入。');
                if ((scene.sceneFormat || '') !== (payload.sceneFormat || '')) throw new Error('同一剧情的楼层格式不一致；未导入。');
                if (Object.hasOwn(scene.parts, part) && scene.parts[part] !== payload.text) throw new Error('同一剧情片段内容冲突；请回酒馆检查。');
                if (payload.sceneFormat === 'floors-v1') {
                    if (scene.floorParts[part] && JSON.stringify(scene.floorParts[part]) !== JSON.stringify(payload.floor)) throw new Error('同一剧情的楼层信息冲突；未导入。');
                    scene.floorParts[part] = structuredClone(payload.floor);
                }
                scene.parts[part] = payload.text;
            }
            assertCurrent();
            // Build once against a mutable draft so only complete, correctly targeted scenes enter journals.
            const draft = (chat.memoryJournals || []).filter(item => !(item.source === 'sillytavern' && (item.bridgeReview?.channel || 'st') === channelId() && receipts[String(characterKey) + ':' + item.externalSceneId]?.cancelled && item.bridgeReview?.status !== 'approved'));
            for (const [key, scene] of Object.entries(staged)) {
                if (!key.startsWith(String(characterKey) + ':') || receipts[key]) continue;
                scene.imported = false;
                const id = key.slice(String(characterKey).length + 1);
                if (finishSceneIfReady(chat, id, scene, draft)) imported++;
                if (scene.imported) { receipts[key] = { archiveId: String(archiveId || 'default'), at: Date.now() }; delete staged[key]; }
            }
            assertCurrent();
            const before = chat.memoryJournals || [], beforeIds = new Set(before.map(item => item.id));
            removedJournals = before.filter(item => !draft.includes(item));
            addedIds = draft.filter(item => !beforeIds.has(item.id)).map(item => item.id);
            if (!(result.events || []).length && !imported && !removedJournals.length) return 0;
            chat.memoryJournals = draft; state.handoffReceipts = Object.fromEntries(Object.entries(handoffs).slice(-60)); state.pendingScenes = staged; state.receipts = receipts; state.cursorByCharacter[characterKey] = nextCursor;
            const oldRelay = state.relayByCharacter[characterKey];
            if (result.relayId) state.relayByCharacter[characterKey] = result.relayId;
            try { await saveData(); committed = true; delete state.recoveryByCharacter[characterKey]; }
            catch (error) {
                if (chat.activeArchiveId === archiveId) chat.memoryJournals = (chat.memoryJournals || []).filter(item => !addedIds.includes(item.id));
                if (chat.activeArchiveId === archiveId) for (const item of removedJournals) if (!chat.memoryJournals.some(entry => entry.id === item.id)) chat.memoryJournals.push(item);
                const archive = chat.archives?.find(item => item.id === archiveId);
                if (archive?.data?.memoryJournals) archive.data.memoryJournals = archive.data.memoryJournals.filter(item => !addedIds.includes(item.id));
                if (archive?.data?.memoryJournals) for (const item of removedJournals) if (!archive.data.memoryJournals.some(entry => entry.id === item.id)) archive.data.memoryJournals.push(structuredClone(item));
                state.handoffReceipts = previousHandoffs; state.pendingScenes = previousScenes; state.receipts = previousReceipts; state.cursorByCharacter[characterKey] = cursor;
                if (oldRelay === undefined) delete state.relayByCharacter[characterKey]; else state.relayByCharacter[characterKey] = oldRelay;
                throw error;
            }
            if (!fileBatch && nextCursor > cursor) await request('/client/ack', { method: 'POST', body: { seq: nextCursor, characterKey } }).catch(error => console.warn('Bridge acknowledgement:', error.message));
            if (imported) status('已接收 ' + imported + ' 场剧情，请在下方审核；未勾选的内容不会进入上下文。');
            else status((result.events || []).some(event => event.kind === 'handoff_receipt') ? '已更新酒馆接收回执，请核对交接状态。' : '已保存剧情分段；若目标是其他存档，请切回对应存档收取。');
            renderReview(); return imported;
        } finally { syncBusy = false; }
    }

    async function persistReview(chat, journal, items) {
        assertReviewTarget(chat, journal);
        const archiveId = chat.activeArchiveId;
        const review = journal.bridgeReview || { version: 1, sourceText: journal.content, archiveId: String(archiveId || 'default') };
        const legacyItems = review.version !== 2 ? globalThis.UvUBridgeText.legacyFloorItems(review.sourceText || journal.content) : [];
        const next = items.map(item => {
            const original = review.items?.find(entry => String(entry.id) === String(item.id)) || legacyItems.find(entry => entry.id === String(item.id));
            return {id: String(item.id), text: review.version === 2 || original?.floor
                ? String(item.text || '').replace(/\r\n/g, '\n').trim() : cleanText(item.text), selected: item.selected === true,
                ...(original?.floor ? {floor: structuredClone(original.floor)} : {})};
        });
        const content = globalThis.UvUBridgeText.memoryText(next);
        await saveJournalChange(chat, journal, () => {
            journal.bridgeReview = { ...review, version: 2, items: next, status: content ? 'approved' : 'pending' };
            journal.bridgeReview.memoryMode = 'raw'; delete journal.bridgeReview.summaryDraft;
            if(content && journal.bridgeReview.summaryResume)journal.bridgeReview.summaryResume.completed=true;
            journal.content = content || review.sourceText; journal.isFavorited = Boolean(content);
            if (content) { journal.category ||= '酒馆线下剧情'; journal.timeline ||= new Date(journal.createdAt || Date.now()).toISOString().slice(0, 10); }
        });
    }

    function assertReviewTarget(chat, journal) {
        if (!db.characters.includes(chat) || !(chat.memoryJournals || []).includes(journal) ||
            (journal.bridgeReview?.channel || 'st') !== channelId() ||
            String(chat.activeArchiveId || 'default') !== String(journal.bridgeReview?.archiveId || 'default'))
            throw new Error('审核角色或存档已变更，请返回原存档重试。');
        if (settings().receipts[String(chat.id) + ':' + journal.externalSceneId]?.cancelled && journal.bridgeReview?.status !== 'approved')
            throw new Error('酒馆已取消本场导出，未保存总结。');
    }
    async function saveJournalChange(chat, journal, mutate) {
        assertReviewTarget(chat, journal);
        if (reviewSaving.has(chat)) throw new Error('该角色的剧情正在保存，请等待完成后重新审核。');
        const before = structuredClone(journal), archiveId = chat.activeArchiveId;
        reviewSaving.set(chat, {journalId:journal.id, archiveId}); reviewWriteCount++;
        let applied;
        try {mutate(); applied = JSON.stringify(journal); await saveData();}
        catch(error) {
            // A synchronous mutation error happens before any other writer can run.
            if (applied === undefined) applied = JSON.stringify(journal);
            const restore = value => {
                if (!value || JSON.stringify(value) !== applied) return;
                for(const key of Object.keys(value))if(!Object.hasOwn(before,key))delete value[key];
                Object.assign(value,structuredClone(before));
            };
            if (chat.activeArchiveId === archiveId) restore(chat.memoryJournals?.find(item=>item.id===journal.id));
            const archived=chat.archives?.find(item=>item.id===archiveId)?.data?.memoryJournals?.find(item=>item.id===journal.id);
            restore(archived);
            throw error;
        } finally {reviewSaving.delete(chat); reviewWriteCount--;}
    }
    async function summarizeReview(chat, journal, items, options = {}) {
        assertReviewTarget(chat, journal);
        const epoch = generation, archiveId = chat.activeArchiveId, history = chat.history, selected = selectedBridgeChat();
        const revision = JSON.stringify(journal.bridgeReview?.items), selection = globalThis.UvUBridgeSummary.signature(items);
        const check = () => {
            assertReviewTarget(chat, journal);
            if (generation !== epoch || selectedBridgeChat() !== selected || chat.activeArchiveId !== archiveId || chat.history !== history || JSON.stringify(journal.bridgeReview?.items) !== revision ||
                globalThis.UvUBridgeSummary.signature(options.currentItems?.() || items) !== selection)
                throw new Error('剧情选择、原文或目标已修改，未应用旧摘要，请重新生成。');
        };
        const sourceVersion=globalThis.crypto?.subtle?[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([revision,selection]))))].map(value=>value.toString(16).padStart(2,'0')).join(''):null;
        check();
        const cache=options.cache || new Map(),saved=journal.bridgeReview?.summaryResume;
        if(sourceVersion && saved?.sourceVersion===sourceVersion && !saved.completed && Array.isArray(saved.entries))for(const [key,value] of saved.entries){if(/^[a-f0-9]{64}$/.test(key) && value?.content)cache.set(key,value);}
        const persistCache=async(key,value)=>{
            check();if(!sourceVersion){await options.onCache?.(key,value);return;}const entries=[];let bytes=0;
            for(const entry of cache){if(!/^[a-f0-9]{64}$/.test(entry[0]))continue;const size=new TextEncoder().encode(JSON.stringify(entry)).length;if(bytes+size>1024*1024 || entries.length>=200)break;entries.push(entry);bytes+=size;}
            try{await saveJournalChange(chat,journal,()=>{journal.bridgeReview.summaryResume={sourceVersion,entries,updatedAt:Date.now(),bytes,completed:false};});}
            catch(error){options.onProgress?.('分组已完成，但续跑缓存未能持久化：'+error.message+'；当前会话缓存保留。');}
            await options.onCache?.(key,value);
        };
        const result = await globalThis.UvUBridgeSummary.generate(chat, structuredClone(items), {...options, cache, onCache:persistCache, assertCurrent: check});
        check();
        await saveJournalChange(chat, journal, () => {
            journal.bridgeReview.summaryDraft = {...result, reviewItems: structuredClone(items), sourceRevision: revision};
        });
        return result;
    }
    async function confirmSummary(chat, journal, items, edited = {}) {
        assertReviewTarget(chat, journal);
        const draft = journal.bridgeReview?.summaryDraft;
        if (!draft || draft.sourceRevision !== JSON.stringify(journal.bridgeReview.items) ||
            draft.sourceSignature !== globalThis.UvUBridgeSummary.signature(items)) throw new Error('总结来源或勾选已修改，请重新生成摘要。');
        const content = String(edited.content ?? draft.content).trim(), title = String(edited.title ?? draft.title).trim();
        if (!content || content.length > 200000) throw new Error('摘要内容为空或过长。');
        await saveJournalChange(chat, journal, () => {
            journal.title = title || journal.title; journal.content = content; journal.isFavorited = true;
            journal.category ||= '酒馆线下剧情';
            journal.bridgeReview = {...journal.bridgeReview, version:2, status:'approved', memoryMode:'summary',
                items:structuredClone(draft.reviewItems), summaryMeta:{createdAt:draft.createdAt,batchCount:draft.batchCount,sourceSignature:draft.sourceSignature}};
            delete journal.bridgeReview.summaryDraft;delete journal.bridgeReview.summaryResume;
        });
    }

    function renderReview(force = false) {
        renderDiagnostics();
        if (reviewBusy) return;
        const host = document.getElementById('uvu-bridge-review-list');
        if (!host?.replaceChildren) return;
        const current = selectedBridgeChat();
        const receiptOutput = document.getElementById('uvu-bridge-handoff-receipt');
        const receipt = Object.values(settings().handoffReceipts).filter(item => item.characterKey === String(current?.id)).sort((a,b) => (Number(b.at)||0)-(Number(a.at)||0))[0];
        if (current && typeof receiptOutput?.querySelector === 'function' && receiptOutput.querySelector('summary')) {
            const summary = receiptOutput.querySelector('summary'), detail = receiptOutput.querySelector('.uvu-bridge-handoff-detail-body');
            if (receipt) {
                summary.textContent = receipt.incomplete
                    ? `未完整 · ${receipt.retained}/${receipt.expected} 条`
                    : `已收 ${receipt.retained} 条 · 已审核 ${receipt.reviewed} 条`;
                detail.replaceChildren();
                const counts = document.createElement('p');
                counts.textContent = `${receipt.reviewed} 条已审核 · ${receipt.deleted} 条已删除`;
                const timestamp = document.createElement('p');
                timestamp.textContent = new Date(receipt.at).toLocaleString();
                detail.append(counts, timestamp);
                const ids = document.createElement('details');
                const idsSummary = document.createElement('summary');
                idsSummary.textContent = '存档与交接编号';
                const idsText = document.createElement('code');
                idsText.textContent = `${receipt.archiveId}\n${receipt.handoffId}`;
                ids.append(idsSummary, idsText);
                detail.append(ids);
                if (receipt.incomplete) {
                    const retry = document.createElement('p');
                    retry.textContent = '请回酒馆核对或重新交接。';
                    detail.append(retry);
                }
            } else {
                summary.textContent = '暂无回执 · 请在酒馆刷新并保存';
                detail.textContent = '剧情进入酒馆队列后，还需刷新、审核并保存。';
            }
        }
        const entries = [];
        for (const chat of (db.characters || [])) {
            for (const journal of (chat.memoryJournals || []).filter(item => item.source === 'sillytavern' && (item.bridgeReview?.channel || 'st') === channelId())) entries.push({ chat, journal });
            for (const archive of chat.archives || []) {
                if (archive.id === chat.activeArchiveId) continue;
                for (const journal of (archive.data?.memoryJournals || []).filter(item => item.source === 'sillytavern' && (item.bridgeReview?.channel || 'st') === channelId())) entries.push({ chat, journal, archived: archive.id });
            }
        }
        const pending = Object.values(settings().pendingScenes).filter(item => item?.characterKey);
        const draftKey = (chat, journal, archived) => JSON.stringify([String(chat.id), String(archived || chat.activeArchiveId || 'default'), channelId(), String(journal.id)]);
        const liveDrafts = new Set(entries.map(({chat, journal, archived}) => draftKey(chat, journal, archived)));
        for (const key of reviewDrafts.keys()) if (!liveDrafts.has(key)) reviewDrafts.delete(key);
        const signature = JSON.stringify([
            current?.id, current?.activeArchiveId,
            entries.map(({ chat, journal, archived }) => [chat.id, chat.activeArchiveId, archived, journal.id, journal.isFavorited, journal.bridgeReview?.status, journal.bridgeReview?.items?.length, journal.content]),
            pending.map(scene => [scene.characterKey, scene.title, scene.partCount, Object.keys(scene.parts || {}).length])
        ]);
        if (!force && signature === reviewSignature) return;
        if (!force && host.contains(document.activeElement)) return;
        reviewSignature = signature; host.replaceChildren();
        const gate = document.getElementById('uvu-bridge-inject-scenes'); if (gate && current) gate.checked = settings().injectionByCharacter[String(current.id)] !== false;
        const count = document.getElementById('uvu-bridge-review-count'); if (count) count.textContent = `${entries.length + pending.length} 项`;
        if (!entries.length && !pending.length) { host.textContent = '还没有收到酒馆线下剧情。结束并导出后点击“收取酒馆记忆”。'; return; }
        const filters=document.createElement('div');filters.className='uvu-bridge-review-toolbar';
        const search=document.createElement('input');search.type='search';search.placeholder='搜索角色、标题或正文';search.value=reviewView.search;search.setAttribute('aria-label','搜索酒馆审核');
        const pendingLabel=document.createElement('label'),pendingCheck=document.createElement('input');pendingCheck.type='checkbox';pendingCheck.checked=reviewView.pendingOnly;pendingLabel.append(pendingCheck,'仅待审核');
        const applySearch=document.createElement('button');applySearch.type='button';applySearch.textContent='筛选';applySearch.className='btn btn-secondary';
        const filter=()=>{reviewView.search=search.value.trim();reviewView.pendingOnly=pendingCheck.checked;reviewView.page=0;renderReview(true);};applySearch.addEventListener('click',filter);pendingCheck.addEventListener('change',filter);
        filters.append(search,pendingLabel,applySearch);host.append(filters);
        const matching=entries.filter(({chat,journal})=>(!reviewView.pendingOnly || journal.bridgeReview?.status!=='approved') && (!reviewView.search || [chat.realName,chat.name,journal.title,journal.bridgeReview?.sourceText || journal.content].join(' ').toLowerCase().includes(reviewView.search.toLowerCase())));
        reviewView.page=Math.max(0,Math.min(reviewView.page,Math.ceil(matching.length/10)-1));
        const pageBar=document.createElement('div');pageBar.className='uvu-bridge-review-toolbar';
        const previous=document.createElement('button'),next=document.createElement('button'),pageCount=document.createElement('span');
        previous.type=next.type='button';previous.className=next.className='btn btn-secondary';previous.textContent='上一页';next.textContent='下一页';previous.disabled=reviewView.page===0;next.disabled=(reviewView.page+1)*10>=matching.length;
        previous.addEventListener('click',()=>{reviewView.page--;renderReview(true);});next.addEventListener('click',()=>{reviewView.page++;renderReview(true);});pageCount.textContent='场次 '+(reviewView.page+1)+' / '+Math.max(1,Math.ceil(matching.length/10))+' · 符合 '+matching.length+' 项';pageBar.append(previous,pageCount,next);host.append(pageBar);
        for (const { chat, journal, archived } of matching.slice(reviewView.page*10,(reviewView.page+1)*10)) {
            const detail = document.createElement('details'), title = document.createElement('summary');
            const archiveName = chat.archives?.find(item => item.id === journal.bridgeReview?.archiveId)?.name || journal.bridgeReview?.archiveId || '默认存档';
            title.textContent = `${chat.realName || chat.name || chat.id} · ${archiveName} · ${journal.title} · ` + memoryState(chat, journal);
            const source = document.createElement('details'), sourceTitle = document.createElement('summary'), pre = document.createElement('pre');
            sourceTitle.textContent = '查看过滤后的完整原文（酒馆保留原始消息）'; source.addEventListener('toggle',()=>{if(source.open)pre.textContent=journal.bridgeReview?.sourceText || journal.content;});
            source.append(sourceTitle, pre); detail.append(title, source);
            if (archived) {
                const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-secondary'; open.textContent = '打开此角色的原存档审核';
                open.addEventListener('click', async () => {
                    open.disabled = true;
                    try { openChatRoom(chat.id, 'private'); await switchChatArchive(archived); switchScreen('uvu-story-bridge-screen'); renderReview(true); }
                    catch (error) { status('打开原存档失败：' + error.message, true); }
                    finally { open.disabled = false; }
                });
                detail.append(open); host.append(detail); continue;
            }
            const originalItems = journal.bridgeReview?.items || globalThis.UvUBridgeText.segments(journal.content);
            const key = draftKey(chat, journal), sourceSignature = JSON.stringify(originalItems);
            let draft = reviewDrafts.get(key);
            if (!draft || draft.sourceSignature !== sourceSignature) {
                const savedSummary=journal.bridgeReview?.summaryDraft, savedEdits=readReviewDraft(chat,journal);
                draft = {sourceSignature, items: structuredClone(savedEdits?.items || (savedSummary?.sourceRevision === sourceSignature ? savedSummary.reviewItems : originalItems)), summary: savedSummary ? structuredClone(savedSummary) : null, cache: new Map()};
                reviewDrafts.set(key, draft);
            }
            const items = draft.items;
            let storedDraft;try{storedDraft=JSON.parse(localStorage.getItem(reviewDraftKey(chat,journal)) || 'null');}catch{}
            const oldVersions=storedDraft?[...(storedDraft.previousVersions || []),...(storedDraft.sourceSignature!==sourceSignature?[storedDraft]:[])]:[];
            detail.open = draft.expanded === true;
            const persistDraft=()=>{try{writeReviewDraft(chat,journal,items);}catch(error){status('审核草稿未能保存到本机：'+error.message,true);}};
            const buildReview=()=>{
            if(detail.dataset.loaded==='true')return;detail.dataset.loaded='true';
            const toolbar = document.createElement('div'); toolbar.className = 'uvu-bridge-review-toolbar';
            if(oldVersions.length){
                const conflict=document.createElement('details'),heading=document.createElement('summary');heading.textContent='原文版本变化：有 '+oldVersions.length+' 份旧审核草稿，未自动套用';conflict.append(heading);
                conflict.addEventListener('toggle',()=>{if(!conflict.open || conflict.dataset.loaded)return;conflict.dataset.loaded='true';
                    const version=document.createElement('select'),old=document.createElement('pre'),current=document.createElement('pre'),migrate=document.createElement('button');
                    for(const [index,entry] of oldVersions.entries()){const option=document.createElement('option');option.value=String(index);option.textContent='旧版本 '+(index+1)+' · '+new Date(entry.updatedAt || 0).toLocaleString();version.append(option);}version.value=String(oldVersions.length-1);
                    const compare=()=>{const value=oldVersions[Number(version.value)];old.textContent='旧版编辑 / 选择：\n'+value.items.map(item=>(item.selected?'[已选] ':'[未选] ')+item.text).join('\n\n');current.textContent='当前原文：\n'+originalItems.map(item=>item.text).join('\n\n');};version.addEventListener('change',compare);compare();
                    migrate.type='button';migrate.className='btn btn-secondary';migrate.textContent='确认将所示旧草稿迁移到相同楼层 ID';migrate.addEventListener('click',()=>{if(!confirm('当前原文已变化。仅迁移相同楼层 ID 的旧编辑和选择；请先核对上方差异，迁移后仍需重新审核保存。继续？'))return;const previous=new Map(oldVersions[Number(version.value)].items.map(item=>[String(item.id),item]));for(const item of items){const value=previous.get(String(item.id));if(value){item.text=value.text;item.selected=value.selected===true;}}persistDraft();renderReview(true);});conflict.append(version,old,current,migrate);
                });detail.append(conflict);
            }
            const selectLabel = document.createElement('label'), selectAll = document.createElement('input'), selectedCount = document.createElement('span');
            selectAll.type = 'checkbox'; selectAll.setAttribute('aria-label', '全选本场剧情');
            const selectText = document.createElement('span'); selectText.textContent = '全选本场全部楼层（含未加载）';
            selectLabel.append(selectAll, selectText);
            toolbar.append(selectLabel, selectedCount);
            const list = document.createElement('div'); list.className = 'uvu-bridge-review-items';
            const fields = [];
            const updateSelection = () => {
                const selected = items.filter(item => item.selected).length;
                selectAll.checked = items.length > 0 && selected === items.length;
                selectAll.indeterminate = selected > 0 && selected < items.length;
                selectedCount.textContent = '已选 ' + selected + ' / ' + items.length + ' 层';
                updateEstimate();
            };
            selectAll.addEventListener('change', () => {
                for (const item of items) item.selected=selectAll.checked;
                for (const {item, check} of fields) check.checked=item.selected;
                updateSelection();persistDraft();
            });
            const renderFloors=()=>{
            const offset=fields.length;
            items.slice(offset,offset+20).forEach(item => {
                const row = document.createElement('div'), check = document.createElement('input');
                let text;
                row.className = 'uvu-bridge-review-row';
                const floorDetail = document.createElement('details'), floorTitle = document.createElement('summary');
                floorDetail.className = 'uvu-bridge-review-floor';
                floorDetail.open = item.expanded === true;
                const loadFloor=()=>{if(text)return;text=document.createElement('textarea');text.value=item.text;text.setAttribute('aria-label','编辑整层剧情');text.addEventListener('input',()=>{item.text=text.value;persistDraft();updateEstimate();});floorDetail.append(text);};
                floorDetail.addEventListener('toggle',()=>{item.expanded=floorDetail.open;if(floorDetail.open)loadFloor();});
                const floor = item.floor;
                floorTitle.textContent = (floor?.number ? '第 ' + floor.number + ' 层' : '原文记录') +
                    (floor?.speaker ? ' · ' + floor.speaker : '') + ' · ' + item.text.replace(/\s+/g, ' ').slice(0, 56);
                check.type = 'checkbox'; check.checked = item.selected;
                check.addEventListener('change', () => { item.selected = check.checked; updateSelection();persistDraft(); });
                const note = document.createElement('p'); note.className = 'uvu-bridge-review-help';
                note.textContent = floor?.extraction === 'tagged' ? '正文标签：' + floor.bodyTag + '；可编辑本层文字。'
                    : '未匹配正文标签或来自旧版导出，请核对是否残留状态栏、小剧场等内容。';
                if(floor?.provenance)note.textContent+=' 过滤块：'+(floor.provenance.filteredTags.join('、') || '无')+'；未知标签：'+(floor.provenance.unknownTags.join('、') || '无')+'；原 '+floor.provenance.sourceChars+' → 提取 '+floor.provenance.extractedChars+' 字符。未知结构请展开核对后再勾选。';
                floorDetail.append(floorTitle, note);if(floorDetail.open)loadFloor();
                check.setAttribute('aria-label', '允许这条剧情加入上下文'); row.append(check, floorDetail); list.append(row); fields.push({ item, check });
            });
            more.hidden=fields.length>=items.length;more.textContent='再加载 20 层（已加载 '+fields.length+' / '+items.length+'）';
            };
            const more=document.createElement('button');more.type='button';more.className='btn btn-secondary';more.addEventListener('click',renderFloors);
            const readFields = () => structuredClone(items);
            const summaryOptions=document.createElement('div');summaryOptions.className='uvu-bridge-summary-options';
            const apiLabel=document.createElement('label'),apiSelect=document.createElement('select');apiLabel.textContent='总结 API';
            for(const [value,label] of [['follow','日记 / 记忆路由'],['memory','独立记忆 API']]){const option=document.createElement('option');option.value=value;option.textContent=label;apiSelect.append(option);}apiLabel.append(apiSelect);
            const lengthLabel=document.createElement('label'),length=document.createElement('input');lengthLabel.textContent='目标字数';length.type='number';length.min='100';length.max='5000';length.value='600';lengthLabel.append(length);
            const budgetLabel=document.createElement('label'),budget=document.createElement('input'),estimate=document.createElement('output');budgetLabel.textContent='本轮最多调用';budget.type='number';budget.min='1';budget.max='200';budget.value='20';budgetLabel.append(budget);
            const updateEstimate=()=>{const plan=globalThis.UvUBridgeSummary.estimate(items);estimate.textContent='已选 '+plan.sourceChars+' 字符 · '+plan.batchCount+' 组 · 预计至少 '+plan.minimumCalls+' 次调用'+(plan.mergeMayRequireMore?'（整合可能追加）':'')+'；缓存分组可续跑，按实际请求计预算。';};
            summaryOptions.append(apiLabel,lengthLabel,budgetLabel,estimate);updateEstimate();renderFloors();updateSelection();
            const summaryActions=document.createElement('div');summaryActions.className='uvu-bridge-actions';
            const generate=document.createElement('button'),cancel=document.createElement('button'),summaryStatus=document.createElement('output');
            generate.type='button';generate.className='btn btn-secondary';generate.textContent='生成摘要';cancel.type='button';cancel.className='btn btn-neutral';cancel.textContent='取消总结';cancel.hidden=true;
            const preview=document.createElement('details'),previewTitle=document.createElement('summary'),summaryTitle=document.createElement('input'),summaryText=document.createElement('textarea'),confirmSummaryButton=document.createElement('button');
            preview.className='uvu-bridge-summary-preview';previewTitle.textContent='摘要预览（确认前不替换现有记忆）';summaryTitle.setAttribute('aria-label','摘要标题');summaryText.setAttribute('aria-label','编辑摘要');
            confirmSummaryButton.type='button';confirmSummaryButton.className='btn btn-secondary';confirmSummaryButton.textContent='确认摘要并加入记忆';
            const showPreview=()=>{const value=draft.summary || journal.bridgeReview?.summaryDraft;preview.hidden=!value;if(value){summaryTitle.value=value.title;summaryText.value=value.content;preview.open=true;}};
            summaryTitle.addEventListener('input',()=>{if(draft.summary)draft.summary.title=summaryTitle.value;});summaryText.addEventListener('input',()=>{if(draft.summary)draft.summary.content=summaryText.value;});
            const factComparison=document.createElement('details'),factTitle=document.createElement('summary'),factText=document.createElement('pre');
            factTitle.textContent='对照已选楼层的人物 / 日期 / 约定 / 待办';factComparison.append(factTitle,factText);
            factComparison.addEventListener('toggle',()=>{if(factComparison.open)factText.textContent=globalThis.UvUBridgeSummary.factChecklist(items).map(row=>'第 '+row.floor+' 层 · '+row.speaker+'\n剧情日期：'+row.date+'\n约定：'+(row.commitments.join(' ') || '未识别，请核对原文')+'\n待办：'+(row.todos.join(' ') || '未识别，请核对原文')+'\n'+row.text).join('\n\n') || '尚未选择来源楼层。';});
            preview.append(previewTitle,summaryTitle,summaryText,factComparison,confirmSummaryButton);showPreview();
            let summaryController;
            generate.addEventListener('click',async()=>{
                if(reviewBusy)return;reviewBusy=true;generate.disabled=true;cancel.hidden=false;summaryController=new AbortController();
                try {await summarizeReview(chat,journal,readFields(),{apiSource:apiSelect.value,targetLength:length.value,maxCalls:budget.value,cache:draft.cache,onBudgetProgress:value=>{estimate.textContent='本轮已调用 '+value.callCount+' / '+value.maxCalls+' · 已复用 '+value.cached+' 组；原文保留，摘要需确认。';},signal:summaryController.signal,currentItems:()=>draft.items,onProgress:message=>{summaryStatus.textContent=message;}});
                    draft.summary=structuredClone(journal.bridgeReview.summaryDraft);showPreview();summaryStatus.textContent='摘要已保存为待确认草稿；核对后加入记忆。';}
                catch(error){summaryStatus.textContent=error.message;status(error.message,true);}
                finally{reviewBusy=false;generate.disabled=false;cancel.hidden=true;summaryController=null;}
            });
            cancel.addEventListener('click',()=>summaryController?.abort());
            confirmSummaryButton.addEventListener('click',async()=>{
                if(reviewBusy)return;reviewBusy=true;confirmSummaryButton.disabled=true;
                try{await confirmSummary(chat,journal,readFields(),{title:summaryTitle.value,content:summaryText.value});clearReviewDraft(chat,journal);reviewDrafts.delete(key);status('摘要已加入该角色原存档的记忆；原文保留，仅摘要作为本篇记忆使用。');}
                catch(error){status(error.message,true);}finally{reviewBusy=false;confirmSummaryButton.disabled=false;renderReview(true);}
            });
            summaryActions.append(generate,cancel);summaryOptions.append(summaryActions,summaryStatus);
            const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-secondary'; save.textContent = '原文直接加入记忆';
            save.addEventListener('click', async () => {
                if (!(chat.memoryJournals || []).includes(journal) || String(chat.activeArchiveId || 'default') !== String(journal.bridgeReview?.archiveId || chat.activeArchiveId || 'default')) return status('目标存档已切换，请打开原存档后审核。', true);
                if (JSON.stringify(journal.bridgeReview?.items || globalThis.UvUBridgeText.segments(journal.content)) !== sourceSignature) return status('原文已更新，请刷新后重新审核。', true);
                if (reviewBusy) return; reviewBusy = true; save.disabled = true;
                try { await persistReview(chat, journal, readFields()); clearReviewDraft(chat,journal); reviewDrafts.delete(key); renderReview(true); status('已审核并保存到当前角色日记 / 记忆管理；只有勾选内容通过原有记忆开关参与后续上下文和向量候选。'); }
                catch (error) { status(error.message, true); }
                finally { reviewBusy = false; save.disabled = false; renderReview(true); }
            });
            if (journal.bridgeReview?.version !== 2 && journal.bridgeReview?.status !== 'approved') {
                const regroup = document.createElement('button'); regroup.type = 'button'; regroup.className = 'btn btn-secondary'; regroup.textContent = '按旧原文重新整理楼层';
                regroup.addEventListener('click', () => {
                    if (!confirm('重新整理会替换本场未保存的编辑与勾选，保存前不影响已有记忆。旧版已删除的正文标签无法恢复。继续？')) return;
                    draft.items = globalThis.UvUBridgeText.legacyFloorItems(journal.bridgeReview?.sourceText || journal.content);
                    renderReview(true);
                });
                toolbar.append(regroup);
            }
            detail.append(toolbar, list, more, summaryOptions, preview, save);
            };
            detail.addEventListener('toggle',()=>{draft.expanded=detail.open;if(detail.open)buildReview();});host.append(detail);if(detail.open)buildReview();
        }
        for (const scene of pending) {
            const chat = db.characters.find(item => String(item.id) === String(scene.characterKey));
            const detail = document.createElement('details'), title = document.createElement('summary'), note = document.createElement('p');
            const complete = scene.partCount > 0 && Array.from({ length: scene.partCount }, (_, index) => index + 1).every(part => Object.hasOwn(scene.parts || {}, part));
            title.textContent = `${chat?.realName || chat?.name || scene.characterKey} · ${scene.title || '酒馆线下剧情'} · 待收取${complete ? '' : `（${Object.keys(scene.parts || {}).length}/${scene.partCount} 段）`}`;
            note.textContent = complete ? '剧情已完整接收，但目标存档与当前打开的存档不同；切换到对应角色和存档后点击“收取酒馆记忆”。' : '剧情尚未完整接收，暂不能加入日记；请回酒馆完成导出后再重试。';
            detail.append(title, note); host.append(detail);
            if (complete && chat) {
                const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-secondary'; open.textContent = '打开目标存档并收取';
                open.addEventListener('click', async () => {
                    open.disabled = true;
                    try {
                        if (scene.archiveId && scene.archiveId !== String(chat.activeArchiveId || 'default') && !chat.archives?.some(item => item.id === scene.archiveId)) throw new Error('目标存档不存在，请保留草稿并核对备份。');
                        openChatRoom(chat.id, 'private');
                        if (scene.archiveId && scene.archiveId !== String(chat.activeArchiveId || 'default')) await switchChatArchive(scene.archiveId);
                        await syncIncoming(chat.id); switchScreen('uvu-story-bridge-screen'); renderReview(true);
                    } catch (error) { status(error.message, true); } finally { open.disabled = false; }
                });
                detail.append(open);
            }
        }
    }

    function renderHandoffCharacters(restoreSaved = false) {
        const select = document.getElementById('uvu-bridge-handoff-character');
        if (!select?.replaceChildren) return;
        const selected=(restoreSaved ? settings().handoffCharacterId : '') || select.value || settings().handoffCharacterId || String(currentBridgeChat()?.id || ''); select.replaceChildren();
        for (const chat of db.characters) { const option=document.createElement('option');option.value=String(chat.id);option.textContent=chat.realName||chat.name||chat.id;select.append(option); }
        if (selected && !db.characters.some(chat=>String(chat.id)===selected)) {
            const missing=document.createElement('option');missing.value=selected;missing.textContent='已保存角色不存在，请重新选择';select.append(missing);
        }
        select.value=selected || String(db.characters[0]?.id || '');
        updateHandoffRange();
    }

    async function syncInbox(recover = false) {
        if (!isEnabled() || !isConnected() || inboxBusy || document.visibilityState !== 'visible') return 0;
        inboxBusy = true;
        try {
            let imported = 0;
            // Receive from the global queue without coupling delivery to the open chat.
            const snapshot = await request('/client/inbox');
            const keys = new Set((snapshot.characters || []).filter(item => (recover || (snapshot.relayId && snapshot.relayId !== settings().relayByCharacter[item.characterKey]) || Number(item.latestSeq) > Number(settings().cursorByCharacter[item.characterKey] || 0))).map(item => String(item.characterKey)));
            for (const scene of Object.values(settings().pendingScenes)) if (scene?.characterKey) keys.add(String(scene.characterKey));
            const selected = document.getElementById('uvu-bridge-handoff-character')?.value;
            if (selected) keys.add(selected);
            for (const key of keys) { if (!isEnabled()) break; try { imported += await syncIncoming(key, 20, recover); } catch (error) { status(key + '：' + error.message, true); } }
            renderReview();
            return imported;
        } finally { inboxBusy = false; }
    }

    async function setSceneInjection(enabled) {
        const chat=selectedBridgeChat(); if (!chat) throw new Error('请先在交接角色列表选择角色。');
        const key=String(chat.id), previous=settings().injectionByCharacter[key];
        settings().injectionByCharacter[key]=Boolean(enabled);
        try { await saveData(); } catch(error) { if(previous===undefined)delete settings().injectionByCharacter[key];else settings().injectionByCharacter[key]=previous;throw error; }
    }

    async function importSceneFile(text) {
        if(!isEnabled())throw new Error('请先启用互通，再导入待审核剧情。');
        if(syncBusy || reviewBusy)throw new Error('请等待接收或总结完成。');
        const chat=selectedBridgeChat();if(!chat)throw new Error('请先选择文件对应的角色与存档。');
        const epoch=generation,archiveId=String(chat.activeArchiveId || 'default'),history=chat.history;
        const file=await globalThis.UvUBridgeFile.validate(text,{direction:'to-uvu',characterKey:String(chat.id),archiveId});
        if(epoch!==generation || !db.characters.includes(chat) || String(chat.activeArchiveId || 'default')!==archiveId || chat.history!==history || selectedBridgeChat()!==chat)
            throw new Error('文件校验期间目标角色或存档已变更。');
        return syncIncoming(String(chat.id),1,false,{events:file.events});
    }

    async function importRecovery(text,{confirmed=false}={}){
        if(maintenanceBusy || reviewBusy || syncBusy || inboxBusy || sendBusy || automaticBusy || publishingCount || pairingBusy || reconnecting || channelSwitchBusy)throw new Error('请等待当前桥接操作完成后恢复。');
        const channel=channelId(),targets=(db.characters || []).map(chat=>({id:String(chat.id),archives:[...new Set(['default',String(chat.activeArchiveId || 'default'),...(chat.archives || []).map(a=>String(a.id))])]}));
        const file=globalThis.UvUBridgeFile.validateRecovery(text,{channel,targets});
        const state=channel==='tt' ? db.uvuStoryBridgeSettings?.ttSettings || {} : db.uvuStoryBridgeSettings || {};
        const staged={outbox:structuredClone(state.outbox || []),pendingScenes:structuredClone(state.pendingScenes || {}),receipts:structuredClone(state.receipts || {})};
        for(const event of file.outbox){const old=staged.outbox.find(e=>e.eventId===event.eventId);if(old && JSON.stringify(old)!==JSON.stringify(event))throw new Error('恢复待发事件与本机同 ID 内容冲突。');if(!old)staged.outbox.push(structuredClone(event));}
        if(staged.outbox.length>500)throw new Error('恢复后待发队列超过 500 条，请先处理现有队列。');
        for(const [key,receipt] of Object.entries(file.receipts)){
            const old=staged.receipts[key];if(old && Boolean(old.cancelled)!==Boolean(receipt.cancelled))throw new Error('恢复回执与本机取消状态冲突，请人工核对。');
            if(old && old.archiveId && receipt.archiveId && old.archiveId!==receipt.archiveId)throw new Error('恢复回执存档与本机冲突。');if(!old)staged.receipts[key]=structuredClone(receipt);
        }
        for(const [key,scene] of Object.entries(file.pendingScenes)){
            if(staged.receipts[key])continue;
            const old=staged.pendingScenes[key];if(!old){staged.pendingScenes[key]=structuredClone({...scene,imported:false});continue;}
            for(const field of ['characterKey','archiveId','partCount','sceneFormat','stCharacterKey'])if((old[field] || '')!==(scene[field] || ''))throw new Error('恢复场景身份或分段总数与本机冲突。');
            for(const [part,value] of Object.entries(scene.parts)){if(Object.hasOwn(old.parts,part) && old.parts[part]!==value)throw new Error('恢复剧情片段与本机内容冲突。');old.parts[part]=value;
                if(scene.floorParts?.[part]){old.floorParts ||= {};if(old.floorParts[part] && JSON.stringify(old.floorParts[part])!==JSON.stringify(scene.floorParts[part]))throw new Error('恢复楼层与本机内容冲突。');old.floorParts[part]=structuredClone(scene.floorParts[part]);}}
        }
        const preview={outbox:file.outbox.length,pendingScenes:Object.keys(file.pendingScenes).length,receipts:Object.keys(file.receipts).length,cursorsPreserved:true};
        if(!confirmed)return preview;
        const hadRoot=Object.hasOwn(db,'uvuStoryBridgeSettings'),rootBefore=db.uvuStoryBridgeSettings,hadTT=Object.hasOwn(rootBefore || {},'ttSettings');
        const before=Object.fromEntries(Object.keys(staged).map(key=>[key,{exists:Object.hasOwn(state,key),value:state[key]}]));
        db.uvuStoryBridgeSettings ||= {};const target=channel==='tt' ? (db.uvuStoryBridgeSettings.ttSettings ||= {}) : db.uvuStoryBridgeSettings;
        maintenanceBusy=true;generation++;Object.assign(target,staged);
        try{await saveData();return preview;}
        catch(error){if(!hadRoot)delete db.uvuStoryBridgeSettings;else if(channel==='tt' && !hadTT)delete rootBefore.ttSettings;else for(const [key,old] of Object.entries(before)){if(old.exists)target[key]=old.value;else delete target[key];}throw error;}
        finally{maintenanceBusy=false;}
    }

    async function createHandoffFile() {
        const chat=selectedBridgeChat();if(!chat)throw new Error('请先选择角色。');
        updateHandoffRange();
        const start=Number(document.getElementById('uvu-bridge-handoff-start')?.value),end=Number(document.getElementById('uvu-bridge-handoff-end')?.value);
        if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>(chat.history||[]).length)throw new Error('请选择有效的消息范围。');
        const archiveId=String(chat.activeArchiveId || 'default'),records=messageRecords(chat,start-1,end),events=[];
        const handoff={id:eventId(),at:Date.now(),start,end,count:records.length,totalMessages:(chat.history||[]).length,latestMessageAt:records.at(-1)?.createdAt||0};
        for(const record of records){
            const points=Array.from(record.text),count=Math.ceil(points.length/5000),revision=globalThis.UvUBridgeText.fingerprint(record.text);
            for(let part=0;part<count;part++){
                const text=points.slice(part*5000,(part+1)*5000).join('');
                events.push({source:'uvu',eventId:eventId(),kind:'memory_packet',characterKey:String(chat.id),createdAt:Date.now(),payload:{archiveId,
                    archiveName:chat.archives?.find(item=>item.id===chat.activeArchiveId)?.name||'默认存档',handoff,messages:[{...record,revision,sourceMessageId:record.id,
                        id:record.id+(count>1?':part-'+(part+1):''),text,...(count>1?{messagePart:part+1,messagePartCount:count}:{})}],text}});
            }
        }
        const file={format:'uvu-bridge-file',version:1,direction:'to-tavern',characterKey:String(chat.id),archiveId,events};
        return globalThis.UvUBridgeFile.validate(JSON.stringify(file),{direction:'to-tavern',characterKey:String(chat.id),archiveId});
    }

    function downloadBridgeFile(value) {
        const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),link=document.createElement('a');
        link.href=url;link.download='uvu-handoff-'+Date.now()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }

    async function changeChannel(value) {
        if(!['st','tt'].includes(value))throw new Error('不支持的酒馆通道。');
        if(maintenanceBusy || channelSwitchBusy || publishingCount || inboxBusy || syncBusy || sendBusy || reviewBusy || reviewWriteCount || pairingBusy || reconnecting || automaticBusy)throw new Error('请等待当前收发或总结完成后切换通道。');
        const root=db.uvuStoryBridgeSettings ||= {}, before=root.channel;
        channelSwitchBusy=true;generation++;
        root.channel=value;
        try{await saveData();}catch(error){if(before===undefined)delete root.channel;else root.channel=before;throw error;}finally{channelSwitchBusy=false;}
        reviewSignature='';reviewDrafts.clear();remoteCapacity=null;remoteService=null;lastRequest={stage:'idle',code:'NONE'};reviewView.page=0;connection={phase:readToken()?'idle':'unpaired',failures:0,nextAttempt:0};
        const input=document.getElementById('uvu-bridge-url');if(input)input.value=baseUrl();
        const enabled=document.getElementById('uvu-bridge-enabled');if(enabled)enabled.checked=isEnabled();
        refreshHandoffContext();connectionStatus(value==='tt' ? 'TT HTTPS 通道：填写独立中继地址并配对。' : '原版酒馆通道');
        renderTransportUI();
    }

    function setupUvUStoryBridge() {
        const urlInput = document.getElementById('uvu-bridge-url');
        const codeInput = document.getElementById('uvu-bridge-pair-code');
        const pairButton = document.getElementById('uvu-bridge-pair');
        const syncButton = document.getElementById('uvu-bridge-sync');
        const disconnectButton = document.getElementById('uvu-bridge-disconnect');
        const injectCheckbox = document.getElementById('uvu-bridge-inject-scenes');
        const enabledCheckbox = document.getElementById('uvu-bridge-enabled');
        if (!urlInput || !pairButton || pairButton.dataset.bound === 'true') return;
        urlInput.value = baseUrl();
        const ttModeSelect=document.getElementById('uvu-bridge-tt-mode');
        ttModeSelect?.addEventListener('change',async()=>{try{await changeTTMode(ttModeSelect.value);}catch(error){ttModeSelect.value=ttMode();status(error.message,true);}});
        renderTransportUI();
        const channelSelect=document.getElementById('uvu-bridge-channel');
        if(channelSelect){channelSelect.value=channelId();channelSelect.addEventListener('change',async()=>{try{await changeChannel(channelSelect.value);}catch(error){channelSelect.value=channelId();status(error.message,true);}});}
        document.getElementById('uvu-bridge-export-file')?.addEventListener('click',async event=>{
            event.target.disabled=true;try{downloadBridgeFile(await createHandoffFile());status('交接文件已导出，去 TT 对应角色 / 聊天导入并审核；文件交接不控制另一端的线上 / 线下状态。');}catch(error){status(error.message,true);}finally{event.target.disabled=false;}
        });
        const fileInput=document.getElementById('uvu-bridge-import-file-input');
        document.getElementById('uvu-bridge-import-file')?.addEventListener('click',()=>fileInput?.click());
        fileInput?.addEventListener('change',async()=>{
            try{const file=fileInput.files?.[0];if(!file)return;if(file.size>globalThis.UvUBridgeFile.MAX_BYTES)throw new Error('交接文件超过 16 MiB。');
                const imported=await importSceneFile(await file.text());status(imported?'已导入 '+imported+' 场待审核剧情；请生成摘要并确认。':'文件已核对，没有新的完整剧情。');
            }catch(error){status(error.message,true);}finally{fileInput.value='';}
        });
        if (enabledCheckbox) {
            enabledCheckbox.checked = isEnabled();
            enabledCheckbox.addEventListener('change', async () => {
                const previous = settings().bridgeEnabled; settings().bridgeEnabled = enabledCheckbox.checked;
                generation++; enabledCheckbox.disabled = true;
                try { await saveData(); } catch(error) { settings().bridgeEnabled = previous; enabledCheckbox.checked = previous !== false; status('互通开关保存失败：' + error.message, true); return; } finally { enabledCheckbox.disabled = false; }
                status(enabledCheckbox.checked ? '酒馆互通已启用。' : '酒馆互通已停用；原聊天、提示词和日记数据不受修改。');
                renderReview(true);
            });
        }
        injectCheckbox.checked = settings().injectionByCharacter[String(selectedBridgeChat()?.id)] !== false;
        renderHandoffCharacters(); renderReview();
        const screen = document.getElementById('uvu-story-bridge-screen');
        if (screen && typeof MutationObserver === 'function') {
            let wasActive = screen.classList.contains('active');
            new MutationObserver(() => {
                const active = screen.classList.contains('active');
                if (active && !wasActive) refreshHandoffContext();
                wasActive = active;
            }).observe(screen, { attributes: true, attributeFilter: ['class'] });
        }
        document.getElementById('uvu-bridge-use-current')?.addEventListener('click', readSelectedHandoffContext);
        document.getElementById('uvu-bridge-save-character')?.addEventListener('click', async event => {
            event.target.disabled=true;
            try {await saveHandoffCharacter();} catch(error) {status('角色保存失败：' + error.message,true);} finally {event.target.disabled=false;}
        });
        document.getElementById('uvu-bridge-handoff-character')?.addEventListener('change', () => { updateHandoffRange(true); renderReview(true); });
        for (const id of ['uvu-bridge-handoff-start', 'uvu-bridge-handoff-end']) document.getElementById(id)?.addEventListener('input', () => { document.getElementById('uvu-bridge-handoff-start').dataset.manual = 'true'; });
        document.getElementById('uvu-bridge-latest')?.addEventListener('click', () => updateHandoffRange(true));
        status(isFileMode() ? 'TT 文件模式：先保存角色并导出所选范围，导入后仍须审核确认。' : isConnected() ? '已配对；正在连接桥接服务。' : '未连接');
        if (isConnected()) automaticSync();
        pairButton.dataset.bound = 'true';
        pairButton.addEventListener('click', async () => {
            pairButton.disabled = true;
            try { await pair(); }
            catch (error) { status(error.message, true); }
            finally { pairButton.disabled = false; }
        });
        syncButton.addEventListener('click', async () => {
            syncButton.disabled = true;
            try {
                const imported = await syncInbox();
                if (!imported) { renderReview(); status('收件箱已检查。暂无可加入当前存档的新完整剧情；其他存档和未完成分段见下方清单。'); }
            }
            catch (error) { status(error.message, true); }
            finally { syncButton.disabled = false; }
        });
        document.getElementById('uvu-bridge-recover')?.addEventListener('click', async event => {
            if (!confirm('从服务端保留的队列重新核对，只收取完整剧情；缺失片段无法恢复，请先在酒馆完成导出。已有日记保留。继续？')) return;
            event.target.disabled = true;
            try { await syncInbox(true); renderReview(true); } catch (error) { status(error.message, true); }
            finally { event.target.disabled = false; }
        });
        disconnectButton.addEventListener('click', async () => {
            if (pairingBusy) return status('配对尚未完成，请稍候。',true);
            disconnectButton.disabled = true;
            try { await disconnect(); }
            catch (error) { status(error.message, true); }
            finally { disconnectButton.disabled = false; }
        });
        document.getElementById('uvu-bridge-reconnect')?.addEventListener('click', async event => {
            if (pairingBusy) return status('配对尚未完成，请稍候。',true);
            if (!isConnected()) return status('请先输入配对码完成首次绑定。',true);
            event.target.disabled=true;
            try {if(await reconnect({force:true}))await automaticSync();}
            finally {event.target.disabled=false;}
        });
        injectCheckbox.addEventListener('change', async () => {
            try {
                await setSceneInjection(injectCheckbox.checked);
                status(injectCheckbox.checked ? '当前角色允许使用已审核且已勾选的剧情。' : '当前角色酒馆记忆已暂停；原文和逐条选择保留。');
            } catch (error) { injectCheckbox.checked = settings().injectionByCharacter[String(selectedBridgeChat()?.id)] !== false; status(error.message, true); }
        });
        document.getElementById('uvu-bridge-handoff')?.addEventListener('click', async event => {
            event.target.disabled=true;
            try {
                const result = await handoffCurrent();
                status(result.pending ? `本次重新交接 ${result.queued} 条，仍有 ${result.pending} 个分段待发送，请保持页面打开并恢复连接。` : result.queued ? `已向桥接服务重新交接 ${result.queued} 条正文（包含此前发送过的内容）；请回酒馆点“刷新线上存档”，审核后保存，相同正文不会重复添加。` : '本次没有新入队正文；可能已有相同内容正在发送。若所选范围只有隐藏、状态或思考记录，请选择包含可用聊天正文的范围。');
                if (result.archiveId) status(`${result.archiveName}（${result.archiveId}）· 范围 ${result.handoff.start}–${result.handoff.end} · ${result.queued} 条正文；${result.pending ? `尚有 ${result.pending} 个分段待发送` : '服务已接收，请回酒馆刷新并核对当前交接存档'}。`);
            }
            catch(error){status(error.message,true);}finally{event.target.disabled=false;}
        });
        document.getElementById('uvu-bridge-refresh-review')?.addEventListener('click',()=>{renderHandoffCharacters();renderReview(true);});
        clearInterval(pollTimer);
        pollTimer = setInterval(() => {
            if (!isEnabled()) return;
            updateHandoffRange();
            renderReview();
            automaticSync();
        }, 8000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                automaticSync();
            }
        });
    }

    window.UvUStoryBridge = { reconnect, connectionSnapshot, isEnabled, isConnected, changeChannel, getMode, cleanupCompleted, diagnosticsSnapshot, readReviewDraft, writeReviewDraft, publishTurn, messageRecords, turnStart, latestHandoffRange, refreshHandoffContext, readSelectedHandoffContext, saveHandoffCharacter, handoffCurrent, createHandoffFile, importSceneFile, importRecovery, publishCharacterDirectory, syncIncoming, syncInbox, allowedMemory, memoryState, persistReview, summarizeReview, confirmSummary, renderReview, flushOutbox };
    window.setupUvUStoryBridge = setupUvUStoryBridge;
})();
