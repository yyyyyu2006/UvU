(() => {
    'use strict';
    const ledger = globalThis.UvUWalletLedger;
    const store = globalThis.UvUWalletStorage;
    const byId = id => document.getElementById(id);
    const backdrop = byId('wallet-entry-prompt'), pinSheet = byId('wallet-pin-prompt');
    let staged = null, pinResolve = null, busy = false, selectedCard = 0, flipped = new Set();
    let homeFocus = null;
    const activeWalletChat = () => {
        if (!currentChatId || !['private','group'].includes(currentChatType)) return null;
        const target = captureChatSendTarget();
        return target && { ...target, target };
    };
    const currentState = () => store.state();
    const pageFor = id => document.querySelector(id);
    function money(n) { return ledger.money(n); }
    function safe(text) { const node = document.createElement('span'); node.textContent = String(text ?? ''); return node.innerHTML; }
    function closeScreen() {
        document.querySelectorAll('.wallet-screen').forEach(node => node.classList.remove('active'));
        const focus = homeFocus; homeFocus = null; focus?.focus?.();
    }
    function openScreen(id) {
        closeScreen();
        homeFocus = document.activeElement;
        const page = pageFor(id);
        page?.classList.add('active');
        page?.querySelector('h1')?.focus?.({ preventScroll:true });
        if (id === '#wallet-screen') renderHome();
        if (id === '#wallet-cards-screen') renderCards();
        if (id === '#wallet-family-screen') renderFamily();
        if (id === '#wallet-bills-screen') renderBills();
    }
    function setSheet(element, open) { element.hidden = !open; if (open) element.querySelector('[data-wallet-close]')?.focus(); }
    function entry(title, fields, onConfirm) {
        staged = { title, onConfirm };
        byId('wallet-entry-title').textContent = title;
        const body = byId('wallet-entry-body'); body.replaceChildren();
        for (const field of fields) {
            const label = document.createElement('label'); label.htmlFor = 'wallet-input-' + field.id; label.textContent = field.label;
            const control = field.options ? document.createElement('select') : document.createElement('input');
            control.id = 'wallet-input-' + field.id; control.name = field.id;
            if (field.options) {
                for (const option of field.options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; control.append(node); }
            } else {
                control.type = field.type || 'text'; control.autocomplete = 'off'; control.inputMode = field.type === 'number' ? 'decimal' : 'text';
                control.maxLength = field.maxLength || 60;
                if (field.type === 'number') { control.min = '0.01'; control.step = '0.01'; }
                if (field.placeholder) control.placeholder = field.placeholder;
            }
            body.append(label, control);
        }
        setSheet(backdrop,true);
        byId('wallet-input-' + fields[0].id)?.focus();
    }
    function promptPin(purpose) {
        if (pinResolve) return Promise.resolve(false);
        return new Promise(resolve => {
            pinResolve = resolve;
            delete pinSheet.dataset.firstPin;
            byId('wallet-pin-purpose').textContent = purpose;
            byId('wallet-pin-error').textContent = '';
            byId('wallet-pin-dots').replaceChildren(...Array.from({length:6},()=>{const d=document.createElement('span');return d;}));
            const keypad=byId('wallet-pin-keypad');keypad.replaceChildren();
            const keys=['1','2','3','4','5','6','7','8','9','','0','⌫'];
            keys.forEach(key=>{const button=document.createElement('button');button.type='button';button.textContent=key;button.disabled=!key;button.dataset.key=key;keypad.append(button);});
            setSheet(pinSheet,true);
        });
    }
    function finishPin(ok) {
        if (!pinResolve) return;
        const resolve=pinResolve;pinResolve=null;setSheet(pinSheet,false);resolve(ok);
    }
    async function getPin() {
        if (!currentState().pin) {
            const chosen=await promptPin('先设置 6 位支付密码');
            if (!chosen) return null;
            try {
                const record=await ledger.createPin(chosen);
                await store.commit({kind:'pin',pin:record});
                return chosen;
            } catch(error) { byId('wallet-pin-error').textContent=error.message; return null; }
        }
        for(let attempts=0;attempts<3;attempts++){
            const typed=await promptPin('用于确认这笔 UvU 虚拟账务');
            if (!typed) return null;
            try { if(await ledger.verifyPin(typed,currentState().pin))return typed; }
            catch(error) { showToast(error.message); return null; }
            if(attempts<2)showToast('密码不正确，请重试');
        }
        showToast('密码连续错误，请稍后重试');return null;
    }
    function amountField(value='') { return {id:'amount',label:'金额（元）',type:'number',placeholder:value || '0.00'}; }
    function sourceOptions(state, purpose) {
        const options=[];
        if (purpose !== 'recharge') options.push({value:'balance',label:'零钱 · ¥ '+money(state.balance)});
        state.cards.forEach(card=>options.push({value:card.id,label:card.name+' ···· '+card.tail+' · ¥ '+money(card.balance)}));
        return options;
    }
    async function pay(op, proof, prepare) {
        if (busy) return false;
        busy=true;
        try { await store.commit(op,proof,prepare);renderAll();return true; }
        catch(error){showToast(error.message || '钱包操作未完成，请重试');return false;}
        finally{busy=false;}
    }
    function renderRows(target, rows, limit=Infinity) {
        target.replaceChildren();
        const visible=rows.slice().sort((a,b)=>b.time-a.time).slice(0,limit);
        if (!visible.length) { const empty=document.createElement('div');empty.className='wallet-muted';empty.textContent='暂无账单';target.append(empty);return; }
        visible.forEach(row=>{
            const item=document.createElement('article');item.className='wallet-row';
            const icon=document.createElement('span');icon.className='wallet-row-icon';icon.textContent=row.amount<0?'↗':'↙';
            const main=document.createElement('div');main.className='wallet-row-main';
            const title=document.createElement('div');title.className='wallet-row-title';title.textContent=row.title;
            const time=document.createElement('div');time.className='wallet-row-time';time.textContent=new Date(row.time).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
            main.append(title,time);
            const value=document.createElement('div');value.className='wallet-row-amount'+(row.amount>0?' is-credit':'');
            value.textContent=(row.amount>0?'+ ':'− ')+'¥ '+money(Math.abs(row.amount));
            item.append(icon,main,value);target.append(item);
        });
    }
    function syncCardFace(article,card,active) {
        const isBack=active&&flipped.has(card.id);
        article.classList.toggle('is-flipped',isBack);
        article.setAttribute('aria-pressed',String(isBack));
        article.querySelector('.wallet-metal-front').setAttribute('aria-hidden',String(isBack));
        article.querySelector('.wallet-metal-back').setAttribute('aria-hidden',String(!isBack));
    }
    function flipCard(article,card,direction=1) {
        if(flipped.has(card.id)) flipped.delete(card.id);
        else {
            article.style.setProperty('--wallet-flip-turn',direction<0?'-180deg':'180deg');
            flipped.add(card.id);
        }
        syncCardFace(article,card,true);
    }
    function cardNode(card,index,layer) {
        const article=document.createElement('article');article.className='wallet-metal-card';article.setAttribute('role','button');
        article.tabIndex=0;
        article.setAttribute('aria-label',card.name+'，虚拟银行卡末四位 '+card.tail+(layer===0?'，翻面':'，选中此卡'));
        article.dataset.layer=String(layer);article.classList.toggle('is-active',layer===0);
        const front=document.createElement('div');front.className='wallet-metal-face wallet-metal-front';
        const name=document.createElement('div');name.className='wallet-card-name';name.textContent=card.name;
        const tail=document.createElement('div');tail.className='wallet-card-tail';tail.textContent='••••  ••••  ••••  '+card.tail;
        const brand=document.createElement('div');brand.className='wallet-card-brand';brand.textContent='UVU WALLET';
        const logo=document.createElement('div');logo.className='wallet-card-logo';logo.textContent='UvU';const signature=document.createElement('small');signature.textContent='Signature';logo.append(signature);
        front.append(name,tail,brand,logo);
        const back=document.createElement('div');back.className='wallet-metal-face wallet-metal-back';
        const stripe=document.createElement('div');stripe.className='wallet-magstripe';
        const backLabel=document.createElement('div');backLabel.className='wallet-card-name';backLabel.textContent='UvU 虚拟银行卡';
        const balance=document.createElement('div');balance.className='wallet-card-tail';balance.textContent='可用零钱  ¥ '+money(card.balance);
        const sign=document.createElement('div');sign.className='wallet-signature';
        const number=document.createElement('div');number.className='wallet-card-back-number';number.textContent='••••  ••••  ••••  '+card.tail;
        const expiry=document.createElement('div');expiry.className='wallet-card-back-expiry';expiry.textContent='VALID  **/**';
        const cvc=document.createElement('div');cvc.className='wallet-card-back-cvc';cvc.textContent='CVV  •••';
        back.append(stripe,backLabel,balance,sign,number,expiry,cvc);article.append(front,back);
        syncCardFace(article,card,layer===0);
        const activate=()=>{
            if(article.classList.contains('is-active')) return flipCard(article,card);
            const target=article.parentElement;
            selectedCard=index;
            deck(target,currentState());
            target.querySelector('.is-active')?.focus({preventScroll:true});
        };
        article.addEventListener('click',activate);
        article.addEventListener('keydown',event=>{
            if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!event.repeat)activate();}
        });
        return article;
    }
    function deck(target,state,direction=0) {
        const restoreFocus=target.contains(document.activeElement);
        target.replaceChildren();
        const count=state.cards.length;
        target.toggleAttribute('data-stacked',count>1);
        if(!count){selectedCard=0;const empty=document.createElement('p');empty.className='wallet-muted';empty.textContent='还没有虚拟银行卡';target.append(empty);return;}
        selectedCard=Math.min(selectedCard,count-1);
        for(let layer=0;layer<Math.min(count,3);layer++){
            const index=(selectedCard+layer)%count;
            const article=cardNode(state.cards[index],index,layer);
            if(!layer&&direction)article.dataset.slide=direction>0?'next':'previous';
            target.append(article);
        }
        if(restoreFocus)target.firstElementChild.focus({preventScroll:true});
    }
    function setupHomeDeck(target) {
        let gesture=null, suppressClick=false;
        const turn=direction=>{
            const state=currentState(),active=target.querySelector('.is-active');
            if(!state.cards.length||!active)return;
            if(state.cards.length===1)return flipCard(active,state.cards[0],direction);
            selectedCard=(selectedCard+direction+state.cards.length)%state.cards.length;
            deck(target,state,direction);
        };
        target.addEventListener('pointerdown',event=>{
            if(!event.isPrimary||event.button!==0)return;
            suppressClick=false;
            const card=event.target.closest('.wallet-metal-card');
            if(card)gesture={id:event.pointerId,x:event.clientX,y:event.clientY,card};
        });
        target.addEventListener('pointermove',event=>{
            if(gesture?.id!==event.pointerId)return;
            const x=Math.abs(event.clientX-gesture.x),y=Math.abs(event.clientY-gesture.y);
            if(x>10&&x>y*1.25&&!gesture.card.hasPointerCapture(event.pointerId)){
                gesture.card.setPointerCapture(event.pointerId);
            }
        });
        target.addEventListener('pointerup',event=>{
            if(gesture?.id!==event.pointerId)return;
            const x=event.clientX-gesture.x,y=event.clientY-gesture.y;
            gesture=null;
            suppressClick=Math.max(Math.abs(x),Math.abs(y))>10;
            if(Math.abs(x)>36&&Math.abs(x)>Math.abs(y)*1.25)turn(x<0?1:-1);
        });
        const cancel=event=>{if(gesture?.id===event.pointerId)gesture=null;};
        target.addEventListener('pointercancel',cancel);
        target.addEventListener('lostpointercapture',cancel);
        target.addEventListener('click',event=>{
            if(suppressClick&&event.detail>0){suppressClick=false;event.stopPropagation();}
        },true);
        target.addEventListener('keydown',event=>{
            if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
            event.preventDefault();
            if(!event.repeat)turn(event.key==='ArrowRight'?1:-1);
        });
    }
    function renderHome(){
        try{const state=currentState();byId('wallet-balance').textContent='¥ '+money(state.balance);
            deck(byId('wallet-home-deck'),state);renderRows(byId('wallet-home-rows'),state.rows,3);
        }catch(error){showToast(error.message);}
    }
    function renderCards(){
        try{const state=currentState();deck(byId('wallet-card-deck'),state);const list=byId('wallet-card-list');list.replaceChildren();
            state.cards.forEach(card=>{const row=document.createElement('div');row.className='wallet-list-item';const icon=document.createElement('span');icon.className='wallet-card-mini';icon.textContent='UvU';const meta=document.createElement('div');meta.className='wallet-list-meta';const name=document.createElement('div');name.className='wallet-list-title';name.textContent=card.name;const tail=document.createElement('div');tail.className='wallet-list-sub';tail.textContent='UvU 虚拟卡  ···· '+card.tail+' · ¥ '+money(card.balance);meta.append(name,tail);const controls=document.createElement('div');controls.className='wallet-card-controls';for(const [label,kind] of [['存入','withdraw'],['转回','recharge']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>cardOperation(kind,card.id));controls.append(button);}row.append(icon,meta,controls);list.append(row);});
        }catch(error){showToast(error.message);}
    }
    function renderFamily(){
        const state=currentState(),list=byId('wallet-family-list');list.replaceChildren();
        state.family.forEach(card=>{const row=document.createElement('div');row.className='wallet-list-item';const icon=document.createElement('span');icon.className='wallet-row-icon';icon.textContent='♡';const meta=document.createElement('div');meta.className='wallet-list-meta';const name=document.createElement('div');name.className='wallet-list-title';name.textContent=card.name;const sub=document.createElement('div');sub.className='wallet-list-sub';sub.textContent=(card.active?'可用额度 ¥ '+money(card.limit-card.used):'已停用');meta.append(name,sub);row.append(icon,meta);if(card.active){const controls=document.createElement('div');controls.className='wallet-card-controls';const spend=document.createElement('button');spend.type='button';spend.textContent='记消费';spend.addEventListener('click',()=>entry('记录亲属卡消费',[amountField()],async values=>{const amount=ledger.cents(values.amount);if(!amount)return showToast('请输入有效金额，最多两位小数');const pin=await getPin();if(pin&&await pay({kind:'family-spend',cardId:card.id,amount,id:ledger.id()},currentState().pin))setSheet(backdrop,false);}));const stop=document.createElement('button');stop.type='button';stop.textContent='停用';stop.addEventListener('click',async()=>{const pin=await getPin();if(pin)await pay({kind:'close-family',cardId:card.id,id:ledger.id()},currentState().pin);});controls.append(spend,stop);row.append(controls);}list.append(row);});
        if(!state.family.length){const empty=document.createElement('p');empty.className='wallet-muted';empty.textContent='还没有亲属卡';list.append(empty);}
    }
    function renderBills(){renderRows(byId('wallet-bills-list'),currentState().rows);}
    function renderAll(){if(pageFor('#wallet-screen')?.classList.contains('active'))renderHome();if(pageFor('#wallet-cards-screen')?.classList.contains('active'))renderCards();if(pageFor('#wallet-family-screen')?.classList.contains('active'))renderFamily();if(pageFor('#wallet-bills-screen')?.classList.contains('active'))renderBills();}
    async function action(type){
        const target=activeWalletChat();
        if(type==='transfer'&&!target)return showToast('请先打开要转账的聊天');
        if(type==='transfer'&&target.type==='private'){
            if(typeof relationshipCanSend==='function'&& !relationshipCanSend(target.chat))return;
            const form=byId('send-transfer-form'),modal=byId('send-transfer-modal');
            form.reset();modal.classList.add('visible');closeScreen();switchScreen('chat-room-screen');showPanel('none');return;
        }
        const state=currentState();
        if(type==='transfer'&&target.type==='group'){
            if(typeof currentGroupAction!=='undefined')currentGroupAction.type='transfer';closeScreen();switchScreen('chat-room-screen');renderGroupRecipientSelectionList('转账给');byId('group-recipient-selection-modal').classList.add('visible');return;
        }
        if(type==='receive')return entry('收款', [amountField()], async values=>{
            const amount=ledger.cents(values.amount);if(!amount)return showToast('请输入有效金额，最多两位小数');
            const pin=await getPin();if(!pin)return;
            if(await pay({kind:'receive',amount,id:ledger.id(),title:'模拟收款'},currentState().pin))setSheet(backdrop,false);
        });
        if(type==='recharge'||type==='withdraw')return entry(type==='withdraw'?'存入虚拟银行卡':'转回零钱',[amountField(),{id:'source',label:'选择虚拟卡',options:type==='withdraw'?sourceOptions(state,type).filter(item=>item.value!=='balance'):sourceOptions(state,type)}],async values=>{
            const amount=ledger.cents(values.amount);if(!amount)return showToast('请输入有效金额，最多两位小数');
            const pin=await getPin();if(!pin)return;
            if(await pay({kind:type,amount,id:ledger.id(),source:values.source},currentState().pin))setSheet(backdrop,false);
        });
    }
    async function cardOperation(kind, cardId){
        const state=currentState();if(!state.cards.some(card=>card.id===cardId))return showToast('这张虚拟卡已不存在');
        const name=kind==='withdraw'?'存入虚拟银行卡':'转回零钱';
        entry(name,[amountField(),{id:'source',label:'账户',options:[{value:kind==='withdraw'?'balance':cardId,label:kind==='withdraw'?'零钱 · ¥ '+money(state.balance):'银行卡 ···· '+state.cards.find(card=>card.id===cardId).tail+' · ¥ '+money(state.cards.find(card=>card.id===cardId).balance)}]}],async values=>{
            const amount=ledger.cents(values.amount);if(!amount)return showToast('请输入有效金额，最多两位小数');
            const pin=await getPin();if(!pin)return;
            if(await pay({kind,amount,id:ledger.id(),source:cardId},currentState().pin))setSheet(backdrop,false);
        });
    }
    function setupActions(){
        const root=byId('wallet-screen');root.addEventListener('click',event=>{const view=event.target.closest('[data-wallet-view]');if(view){openScreen('#wallet-'+view.dataset.walletView+'-screen');return;}const button=event.target.closest('[data-wallet-action]');if(button)action(button.dataset.walletAction);});
        document.querySelectorAll('.wallet-screen [data-wallet-back]').forEach(button=>button.addEventListener('click',()=>openScreen('#wallet-screen')));
        document.querySelectorAll('.wallet-screen [data-target="more-screen"]').forEach(button=>button.addEventListener('click',()=>{closeScreen();switchScreen('more-screen');}));
        byId('wallet-ledger-all').addEventListener('click',()=>openScreen('#wallet-bills-screen'));
        byId('wallet-add-card').addEventListener('click',()=>entry('添加虚拟银行卡',[{id:'name',label:'卡片名称',placeholder:'日常储蓄卡'}],async values=>{
            if(!values.name.trim())return showToast('请输入卡片名称');const pin=await getPin();if(!pin)return;
            if(await pay({kind:'add-card',id:ledger.id(),name:values.name},currentState().pin))setSheet(backdrop,false);
        }));
        byId('wallet-card-list').addEventListener('click',event=>{const button=event.target.closest('[data-wallet-card-action]');if(button)cardOperation(button.dataset.walletCardAction,button.dataset.walletCardId);});
        byId('wallet-add-family').addEventListener('click',()=>{
            const choices=db.characters.filter(chat=>chat?.id&&chat.realName).map(chat=>({value:chat.id,label:chat.remarkName||chat.realName}));
            if(!choices.length)return showToast('请先添加角色');
            entry('开通亲属卡',[{id:'recipient',label:'使用人',options:choices},{id:'limit',label:'总额度（元）',type:'number',placeholder:'0.00'}],async values=>{
                const amount=ledger.cents(values.limit);if(!amount)return showToast('请输入有效金额，最多两位小数');
                const character=db.characters.find(chat=>chat.id===values.recipient);const pin=await getPin();if(!pin||!character)return;
                if(await pay({kind:'open-family',id:ledger.id(),recipientId:character.id,name:character.remarkName||character.realName,amount},currentState().pin))setSheet(backdrop,false);
            });
        });
        backdrop.addEventListener('click',event=>{if(event.target===backdrop||event.target.closest('[data-wallet-close],[data-wallet-cancel]'))setSheet(backdrop,false);if(event.target.closest('[data-wallet-continue]')&&staged){const body=byId('wallet-entry-body');const values=Object.fromEntries(Array.from(body.querySelectorAll('input,select')).map(input=>[input.name,input.value]));void staged.onConfirm(values);}});
        pinSheet.addEventListener('click',async event=>{
            if(event.target===pinSheet||event.target.closest('[data-wallet-close]')){finishPin(null);return;}
            const key=event.target.closest('[data-key]')?.dataset.key;if(!key||busy)return;
            const dots=byId('wallet-pin-dots');
            if(key==='⌫'){dots.lastElementChild.textContent='';return;}
            const next=Array.from(dots.children).find(node=>!node.textContent);
            if(next)next.textContent=key;
            if(Array.from(dots.children).every(node=>node.textContent)){
                const value=Array.from(dots.children).map(node=>node.textContent).join('');
                if(!/^\d{6}$/.test(value)){byId('wallet-pin-error').textContent='请输入 6 位数字';return;}
                // Setup is confirmed with the same entry twice; neither value is retained after this event.
                if(!currentState().pin && !pinSheet.dataset.firstPin){
                    const first=value;dots.replaceChildren(...Array.from({length:6},()=>{const d=document.createElement('span');return d;}));
                    byId('wallet-pin-purpose').textContent='请再次输入支付密码';
                    pinSheet.dataset.firstPin=first;return;
                }
                if(pinSheet.dataset.firstPin){
                    const first=pinSheet.dataset.firstPin;delete pinSheet.dataset.firstPin;
                    if(first!==value){dots.replaceChildren(...Array.from({length:6},()=>{const d=document.createElement('span');return d;}));byId('wallet-pin-error').textContent='两次输入不一致，请重试';return;}
                    finishPin(value);return;
                }
                finishPin(value);
            }
        });
        document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!pinSheet.hidden)finishPin(null);if(!backdrop.hidden)setSheet(backdrop,false);}});
    }
    function openWallet(){
        if(!document.body.contains(byId('wallet-screen')))return showToast('钱包页面尚未加载');
        switchScreen('wallet-screen');closeScreen();openScreen('#wallet-screen');showPanel('none');
    }
    function installMenu(){
        const grid=document.querySelector('.menu-grid');
        if(!grid)return;
        grid.addEventListener('click',event=>{if(event.target.closest('[data-action="wallet"]'))openWallet();});
        grid.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.closest('[data-action="wallet"]'))openWallet();});
        const entryNode=document.createElement('div');entryNode.className='menu-item';entryNode.dataset.action='wallet';entryNode.setAttribute('role','button');entryNode.tabIndex=0;
        entryNode.innerHTML='<div class="menu-icon-wrapper"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18"/><circle cx="17" cy="14" r="1"/></svg></div><span class="menu-item-label">钱包</span>';
        const drawing=grid.querySelector('[data-action="drawing-workshop"]');if(drawing)grid.insertBefore(entryNode,drawing);else grid.append(entryNode);
    }
    async function settleIncomingTransfer(actionName) {
        const target=activeWalletChat();
        const message=target?.chat?.history?.find(item=>item.id===globalThis.currentTransferMessageId);
        if(!target||target.type!=='private'||!message||message.role!=='assistant'||message.transferStatus!=='pending')return showToast('这笔转账已变化，请重新打开');
        if(typeof relationshipCanChat==='function'&&!relationshipCanChat(target.chat))return showToast('请先恢复好友关系，再处理转账');
        const match=message.content.match(/的转账[：:]\s*(\d{1,9}(?:\.\d{1,2})?)元；备注：/);
        const amount=match?ledger.cents(match[1]):0;
        if(!amount)return showToast('这笔转账金额无效，无法记入钱包');
        const state=currentState(),pin=await getPin();if(!pin)return;
        const chat=target.chat, contextText=actionName==='received'?'['+chat.myName+'接收'+chat.realName+'的转账]':'['+chat.myName+'退回'+chat.realName+'的转账]';
        const context={id:'msg_'+ledger.id(),role:'user',content:contextText,parts:[{type:'text',text:contextText}],timestamp:Date.now()};
        const source=message.content,op=actionName==='received'?{kind:'receive',amount,id:'incoming:'+message.id,title:'收到 '+(chat.remarkName||chat.realName)+' 的转账'}:null;
        const ok=await store.commit(op,state.pin,()=>{
            if(!target.history.includes(message)||message.transferStatus!=='pending'||message.content!==source||message.isWithdrawn)throw new Error('这笔转账已变化，请重试');
            message.transferStatus=actionName;chat.history.push(context);
            if(typeof prepareRelationshipMessage==='function')prepareRelationshipMessage(chat,context,'private');
            return ()=>{if(message.transferStatus===actionName)message.transferStatus='pending';const index=chat.history.indexOf(context);if(index>=0)chat.history.splice(index,1);if(chat.history===target.history)syncChatActiveArchive(chat);};
        });
        if(!ok)return;
        document.getElementById('receive-transfer-actionsheet')?.classList.remove('visible');globalThis.currentTransferMessageId=null;renderChatList();renderAll();
    }
    function setup(){
        installMenu();setupActions();
        const chatWallet=byId('wallet-btn');if(chatWallet)chatWallet.addEventListener('click',()=>{
            if(currentChatType==='private'){byId('send-transfer-form').reset();byId('send-transfer-modal').classList.add('visible');}
            else if(currentChatType==='group'){if(typeof currentGroupAction!=='undefined')currentGroupAction.type='transfer';renderGroupRecipientSelectionList('转账给');byId('group-recipient-selection-modal').classList.add('visible');}
        });
        for(const [buttonId,actionName] of [['accept-transfer-btn','received'],['return-transfer-btn','returned']])byId(buttonId)?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();void settleIncomingTransfer(actionName);},true);
        if(byId('send-transfer-form'))byId('send-transfer-form').addEventListener('submit',async event=>{
            if(currentChatType==='group'){
                event.preventDefault();event.stopImmediatePropagation();
                const target=activeWalletChat(),ids=[...(globalThis.currentGroupAction?.recipients||[])];
                const recipients=ids.map(id=>target?.chat.members?.find(member=>member.id===id)).filter(Boolean);
                if(!target||target.type!=='group'||!recipients.length)return showToast('请先选择转账对象');
                const amount=ledger.cents(byId('transfer-amount-input').value);if(!amount)return showToast('请输入有效金额，最多两位小数');
                const remark=byId('transfer-remark-input').value.trim().slice(0,120),state=currentState();
                const sources=[{value:'balance',label:'零钱 · ¥ '+money(state.balance)},...state.cards.map(card=>({value:card.id,label:card.name+' ···· '+card.tail+' · ¥ '+money(card.balance)}))];
                byId('send-transfer-modal').classList.remove('visible');
                entry('确认群转账',[{id:'source',label:'付款方式',options:sources}],async values=>{
                    const pin=await getPin();if(!pin)return;
                    const messages=recipients.map(recipient=>{const paymentId=ledger.id(),content='['+target.chat.me.nickname+' 向 '+recipient.realName+' 转账：'+money(amount)+'元；备注：'+remark+']';return {message:{id:'msg_'+paymentId,role:'user',content,parts:[{type:'text',text:content}],timestamp:Date.now(),senderId:'user_me',walletPaymentId:paymentId},link:{id:paymentId,chatId:target.chatId,archiveId:target.archiveId||null,messageId:'msg_'+paymentId,kind:'transfer'}};});
                    const ok=await pay({kind:'pay-batch',amount,source:values.source,title:'群转账',links:messages.map(item=>item.link)},currentState().pin,()=>store.stageChat(target,messages.map(item=>item.message)));
                    if(ok){setSheet(backdrop,false);renderChatList();}
                });
                return;
            }
            event.preventDefault();event.stopImmediatePropagation();
            const target=activeWalletChat();if(!target||target.type!=='private')return showToast('当前聊天不可转账');
            const amount=ledger.cents(byId('transfer-amount-input').value);if(!amount)return showToast('请输入有效金额，最多两位小数');
            const remark=byId('transfer-remark-input').value.trim().slice(0,120);
            const state=currentState();const sources=[{value:'balance',label:'零钱 · ¥ '+money(state.balance)},...state.cards.map(card=>({value:card.id,label:card.name+' ···· '+card.tail+' · ¥ '+money(card.balance)}))];
            byId('send-transfer-modal').classList.remove('visible');closeScreen();
            entry('确认转账',[{id:'source',label:'付款方式',options:sources}],async values=>{
                const source=values.source;const pin=await getPin();if(!pin)return;
                const id=ledger.id(), content='['+target.chat.myName+'给你转账：'+money(amount)+'元；备注：'+remark+']';
                const message={id:'msg_'+id,role:'user',content,parts:[{type:'text',text:content}],timestamp:Date.now(),transferStatus:'pending',walletPaymentId:id};
                const ok=await pay({kind:'pay',id,amount,source,title:'转账给 '+target.chat.remarkName,links:[{chatId:target.chatId,archiveId:target.archiveId||null,messageId:message.id,kind:'transfer'}]},currentState().pin,()=>store.stageChat(target,[message]));
                if(ok)setSheet(backdrop,false);
            });
        },true);
        if(byId('send-red-packet-form'))byId('send-red-packet-form').addEventListener('submit',async event=>{
            event.preventDefault();event.stopImmediatePropagation();
            if(currentChatType!=='group')return showToast('红包功能仅限群聊使用');
            const target=activeWalletChat();if(!target)return;
            const amount=ledger.cents(byId('red-packet-amount-input').value),count=Number(byId('red-packet-count-input').value);
            if(!amount)return showToast('请输入有效金额，最多两位小数');
            if(!Number.isSafeInteger(count)||count<1||count>10000||amount<count)return showToast('红包数量须为正整数，且每份至少 0.01 元');
            const remark=byId('red-packet-remark-input').value.trim().slice(0,120)||'恭喜发财，大吉大利';
            const state=currentState();const sources=[{value:'balance',label:'零钱 · ¥ '+money(state.balance)},...state.cards.map(card=>({value:card.id,label:card.name+' ···· '+card.tail+' · ¥ '+money(card.balance)}))];
            byId('send-red-packet-modal').classList.remove('visible');
            entry('发出群红包',[{id:'source',label:'付款方式',options:sources}],async values=>{
                const pin=await getPin();if(!pin)return;
                const amountNumber=amount/100,pool=distributeRedPacket(amountNumber,count);const id=ledger.id();
                const content='['+target.chat.me.nickname+'发出了一个拼手气红包：'+money(amount)+'元；个数：'+count+'个；留言：'+remark+']';
                const message={id:'msg_'+id,role:'user',type:'red-packet',content,totalAmount:amountNumber,count,remark,pool,distributions:{},isRevealed:false,timestamp:Date.now(),senderId:'user_me',walletPaymentId:id};
                const ok=await pay({kind:'pay',id,amount,source:values.source,title:'发出群红包',links:[{chatId:target.chatId,archiveId:target.archiveId||null,messageId:message.id,kind:'packet'}]},currentState().pin,()=>{
                    if(!isChatSendTargetValid(target))throw new Error('群聊已切换，请重试');
                    target.history.push(message);
                    if(isChatTargetVisible(target))addMessageBubble(message,target.chatId,'group');
                    return ()=>{const index=target.history.indexOf(message);if(index>=0)target.history.splice(index,1);if(target.chat.history===target.history)syncChatActiveArchive(target.chat);};
                });
                if(ok){setSheet(backdrop,false);byId('send-red-packet-form').reset();if(isChatTargetVisible(target))renderChatList();}
            });
        },true);
        setupHomeDeck(byId('wallet-home-deck'));
        if(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')store.reconcile().catch(error=>console.warn('Wallet pending settlement:',error));
    }
    globalThis.setupWalletSystem=setup;
})();
