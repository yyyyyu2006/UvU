/* Panel-only artwork. Does not replace chat avatars, themes or exported cards. */
(function () {
    'use strict';
    const defaults={avatar:'assets/panels/avatar.webp',memos:'assets/panels/memos.webp',tavern:'assets/panels/tavern.webp',memory1:'assets/panels/memos.webp',memory2:'assets/panels/tavern.webp',memory3:'assets/panels/tavern.webp',calendar:'assets/panels/tavern.webp',calendarDetail:'assets/panels/memos.webp'};
    const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
    const imageValue=value=>typeof value==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(value)?value:'';
    function read(chat){const v=chat?.derivedPanelAppearance;return Object.fromEntries(Object.keys(defaults).map(key=>[key,imageValue(v?.[key])]));}
    function image(cls,alt){const img=node('img',cls);img.alt=alt;return img;}
    function attach(panel,identity,kind,getChat){
        if(!identity||panel.dataset.panelArtwork)return;panel.dataset.panelArtwork=kind;
        const hero=node('section','panel-artwork'),cover=node('button','panel-artwork-cover'),portrait=node('button','panel-artwork-avatar'),name=node('strong','panel-artwork-name'),detail=node('small','panel-artwork-detail');
        const background=image('',''),avatar=image('','');cover.type=portrait.type='button';cover.setAttribute('aria-label','更换面板背景');portrait.setAttribute('aria-label','更换面板头像');cover.append(background);portrait.append(avatar);hero.append(cover,name,detail,portrait);identity.before(hero);identity.hidden=true;
        const paint=()=>{const chat=getChat(),v=read(chat);background.src=v[kind]||defaults[kind];avatar.src=v.avatar||defaults.avatar;name.textContent=chat?.remarkName||chat?.realName||'请选择角色';detail.textContent=chat?.archives?.find(a=>a.id===chat.activeArchiveId)?.name||'';cover.disabled=portrait.disabled=!chat;};
        const edit=target=>{const chat=getChat();if(chat)open(chat,kind,target,()=>getChat()===chat);};cover.onclick=()=>edit('background');portrait.onclick=()=>edit('avatar');
        const selection=panel.querySelector('#uvu-bridge-handoff-character');selection?.addEventListener('change',paint);panel.addEventListener('mono-view-change',paint);
        hero.refreshPanelArtwork=paint;paint();
    }
    function composition(panel,layout,getOwner){
        if(panel.dataset.compositionArtwork)return;
        const title=panel.querySelector('.lenso-title');
        const identity=layout==='memory'?panel.querySelector('.mono-subview[data-mono-view="main"] .draft-identity'):title;
        if(!identity||!title)return;
        panel.dataset.compositionArtwork=layout;
        const hero=node('section','panel-composition panel-composition-'+layout),gallery=node('div','panel-composition-gallery'),name=node('span','panel-composition-name'),more=node('button','panel-composition-more');
        more.type='button';more.setAttribute('aria-label','更换头像与配图');more.innerHTML=window.UvULucide?.ellipsis||'…';
        const slots=layout==='memory'?[['avatar','头像'],['memory1','配图一'],['memory2','配图二'],['memory3','配图三']]:[['calendar','背景'],['calendarDetail','小图'],['avatar','头像']];
        const fields=slots.map(([key,label])=>[key,label]);
        for(const [key,label]of slots){const b=node('button','panel-composition-photo panel-photo-'+key),img=image('',label);b.type='button';b.dataset.photoKey=key;b.setAttribute('aria-label','更换'+label);b.append(img);b.onclick=()=>edit(key);gallery.append(b);}
        hero.append(gallery,name,more);identity.before(hero);
        if(layout==='calendar')hero.prepend(title);else identity.hidden=true;
        const paint=()=>{const owner=getOwner(),v=read(owner);name.textContent=owner?.remarkName||owner?.realName||owner?.name||'请选择角色';for(const b of gallery.children){b.firstChild.src=v[b.dataset.photoKey]||defaults[b.dataset.photoKey];b.disabled=!owner;}more.disabled=!owner;};
        function edit(key){const owner=getOwner();if(!owner)return;open(owner,layout==='memory'?'memory1':'calendar',key,()=>getOwner()===owner,{fields,valid:()=>getOwner()===owner,save:owner.panelArtworkSave});}
        more.onclick=()=>edit(layout==='memory'?'memory1':'calendar');hero.refreshPanelArtwork=paint;hero.classList.add('panel-artwork-composition-refresh');
        panel.addEventListener('mono-view-change',()=>{hero.hidden=layout==='memory'&&panel.dataset.monoView!=='main';paint();});
        panel.querySelector('select[aria-label="日历所属位置"]')?.addEventListener('change',paint);paint();
    }
    function open(chat,kind,target,isCurrent,options={}){
        let revision=0,busy=false,pending={...read(chat)},active=target;
        const d=createMessageForwardDialog('外观','uvu-panel-artwork',()=>revision++);d.panel.classList.add('derived-settings','panel-artwork-dialog');
        const body=node('div','derived-body'),preview=node('section','panel-artwork-preview'),cover=image('panel-artwork-preview-cover','背景预览'),avatar=image('panel-artwork-preview-avatar','头像预览');preview.append(cover,avatar);body.append(preview);
        const file=node('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.hidden=true;
        const fields=options.fields||[['avatar','头像'],['background','背景']];
        const buttons=[];for(const [value,label]of fields){const row=node('div','panel-artwork-row'),button=node('button','','更换');button.type='button';button.dataset.artworkPick=value;button.setAttribute('aria-label','更换'+label);button.onclick=()=>{active=value;paint();file.value='';file.click();};row.append(node('span','',label),button);body.append(row);buttons.push(button);}
        const feedback=node('p','panel-artwork-error');feedback.setAttribute('role','status');feedback.hidden=true;body.append(feedback,file);
        const footer=node('footer'),reset=node('button','','恢复默认'),save=node('button','panel-primary','保存');reset.type=save.type='button';footer.append(reset,save);d.panel.append(body,footer);
        const paint=()=>{const key=active==='background'?kind:active;cover.src=pending[key==='avatar'?kind:key]||defaults[key==='avatar'?kind:key];avatar.src=pending.avatar||defaults.avatar;};paint();
        const error=text=>{feedback.textContent=text;feedback.hidden=false;};
        const lock=value=>{busy=value;save.disabled=value;reset.disabled=value;buttons.forEach(b=>b.disabled=value);d.setBusy(value);};
        reset.onclick=()=>{revision++;for(const [key]of fields)pending[key==='background'?kind:key]='';feedback.hidden=true;paint();};
        file.onchange=async()=>{const selected=file.files?.[0];if(!selected||busy)return;const request=++revision,key=active==='background'?kind:active;feedback.hidden=true;lock(true);
            try{if(!['image/png','image/jpeg','image/webp'].includes(selected.type))throw new Error('请选择 PNG、JPG 或 WebP 图片');if(selected.size>15*1024*1024)throw new Error('请选择小于 15MB 的图片');
                const url=URL.createObjectURL(selected),img=new Image();try{img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}
                if(request!==revision||!d.panel.isConnected)return;
                const max=key==='avatar'?600:1280,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);pending[key]=canvas.toDataURL('image/webp',.88);paint();
            }catch(e){if(request===revision)error(e.message||'图片读取失败，请重新选择');}finally{if(request===revision)lock(false);}
        };
        save.onclick=async()=>{if(busy)return;if(!isCurrent()||!(options.valid?options.valid():[...db.characters,...(db.groups||[])].includes(chat))){error('角色已改变，请重新打开外观设置');return}const before=chat.derivedPanelAppearance,next={...read(chat)};for(const [key]of fields){const slot=key==='background'?kind:key;next[slot]=pending[slot];}feedback.hidden=true;lock(true);chat.derivedPanelAppearance=next;
            try{if(options.save)await options.save(next,isCurrent);else await saveData();document.querySelectorAll('.panel-artwork,.panel-artwork-composition-refresh').forEach(el=>el.refreshPanelArtwork?.());lock(false);d.dismiss();}
            catch(e){if(chat.derivedPanelAppearance===next){if(before===undefined)delete chat.derivedPanelAppearance;else chat.derivedPanelAppearance=before;}error('图片保存失败，请重试');lock(false);}
        };
        requestAnimationFrame(()=>buttons[fields.findIndex(([key])=>key===active)]?.focus());
    }
    window.UvUPanelArtwork=Object.freeze({attach,composition});
}());
