// One delegated presentation updater for all mounted music cards; never owns audio.
(function(root){
    'use strict';
    const records=new WeakMap(),M=root.UvUMusic;let librarySource,favoriteKeys=new Set();
    function favorites(){const raw=typeof db!=='undefined'?db.musicLibrary:root.db?.musicLibrary;if(raw!==librarySource){librarySource=raw;favoriteKeys=new Set(M.library().favorites.map(M.key));}return favoriteKeys;}
    const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    const clock=value=>{const n=Math.floor(Math.max(0,Number(value)||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
    const guard=()=>typeof isInMultiSelectMode!=='undefined'&&isInMultiSelectMode;
    function button(label,icon,action){const b=node('button','uvu-music-icon');b.type='button';b.setAttribute('aria-label',label);b.title=label;const img=node('img','');img.alt='';img.src='assets/music/icons/'+icon+'.svg';b.append(img);b.onclick=async e=>{e.stopPropagation();if(guard()||b.disabled)return;b.disabled=true;try{await action();}catch(error){if(typeof showToast==='function')showToast(error.message);}finally{b.disabled=false;refresh(true);}};return b;}
    function update(card,r,state){
        const current=state.track&&M.key(state.track)===M.key(r.track),playing=current&&state.playing;
        const label=current&&state.phase==='loading'?'正在加载':playing?'暂停歌曲':current&&['error','blocked'].includes(state.phase)?'重试播放':'播放歌曲';
        r.play.setAttribute('aria-label',label);r.play.title=label;r.play.firstChild.src='assets/music/icons/'+(playing?'pause':'play')+'.svg';r.play.classList.toggle('is-loading',current&&state.phase==='loading');
        const duration=current?state.duration:r.track.duration;r.elapsed.textContent=clock(current?state.position:0);r.remaining.textContent=duration?'−'+clock(Math.max(0,duration-(current?state.position:0))):'--:--';
        r.slider.disabled=!current||!duration;r.slider.max=duration||1;if(document.activeElement!==r.slider)r.slider.value=current?state.position:0;
        r.previous.disabled=r.next.disabled=!current||state.queue.length<2;r.queue.disabled=!current;
        const liked=favorites().has(M.key(r.track));r.favorite.classList.toggle('is-liked',liked);r.favorite.setAttribute('aria-pressed',String(liked));
        const active=root.UvUMusicChat?.session?.(),bound=Boolean(active&&r.message.music.invitation&&active.id===r.message.music.invitation.id);
        r.continuous.hidden=!bound;r.continuous.textContent=active?.continuous?'连续一起听 ✓':'连续一起听';r.continuous.setAttribute('aria-pressed',String(!!active?.continuous));
        r.error.hidden=!current||!state.error;r.error.textContent=current?state.error:'';
        const status=r.message.music.invitation,signature=status?[status.status,status.expiresAt>Date.now(),bound,active?.localPlayback].join(':'):'';if(r.statusFn&&signature!==r.statusSignature){r.statusSignature=signature;r.statusFn();}
        if(current&&state.track.cover&&card.querySelector('.uvu-music-cover')?.dataset.liveCover!==state.track.cover){const cover=card.querySelector('.uvu-music-cover');cover.dataset.liveCover=state.track.cover;cover.src=state.track.cover;}
    }
    let scheduled=false,pendingForce=false,last=0,lastSignature='';
    function refresh(force=false){pendingForce=pendingForce||force;if(scheduled)return;if(!force&&performance.now()-last<250)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;const force=pendingForce;pendingForce=false;last=performance.now();const state=M.player.snapshot();for(const card of document.querySelectorAll('.uvu-music-card')){const r=records.get(card);if(!r)continue;const rect=card.getBoundingClientRect();if(rect.width===0||rect.height===0||!force&&(rect.bottom<0||rect.top>innerHeight))continue;update(card,r,state);}});}
    function attach(r){
        const {card,body,track,message,start}=r;
        body.append(button('更多歌曲操作','ellipsis',()=>root.UvUMusicUI?.trackMenu(track,{},r.target)));
        const progress=node('div','uvu-music-progress'),timing=node('div','uvu-music-timing'),slider=node('input','');slider.type='range';slider.min=0;slider.step=.1;slider.setAttribute('aria-label','歌曲播放进度');slider.oninput=e=>{e.stopPropagation();if(!guard()&&M.player.snapshot().track&&M.key(M.player.snapshot().track)===M.key(track))M.player.seek(Number(slider.value));};slider.onclick=e=>e.stopPropagation();
        const elapsed=node('span',''),remaining=node('span','');timing.append(elapsed,slider,remaining);progress.append(timing);
        const tools=node('div','uvu-music-transport'),favorite=button('喜欢歌曲','heart',()=>M.toggleFavorite(track)),previous=button('上一首','skip-back',()=>M.player.previous()),play=button('播放歌曲','play',()=>{const s=M.player.snapshot(),invitation=message.music.invitation;if(invitation?.status==='accepted'&&root.UvUMusicChat?.session?.()?.id!==invitation.id)return start();if(s.track&&M.key(s.track)===M.key(track))return M.player.toggle();return start();}),next=button('下一首','skip-forward',()=>M.player.next()),queue=button('播放队列','list-music',()=>root.UvUMusicUI?.queue());
        play.classList.add('uvu-music-main-play');tools.append(favorite,previous,play,next,queue);
        const continuous=node('button','uvu-music-continuous','连续一起听');continuous.type='button';continuous.hidden=true;continuous.onclick=e=>{e.stopPropagation();if(guard())return;const active=root.UvUMusicChat.session();if(active?.id===message.music.invitation?.id)root.UvUMusicChat.setContinuous(!active.continuous);};
        const error=node('p','uvu-music-card-error');error.hidden=true;card.append(progress,tools,continuous,error);Object.assign(r,{slider,elapsed,remaining,favorite,previous,play,next,queue,continuous,error});records.set(card,r);update(card,r,M.player.snapshot());return card;
    }
    M.player.subscribe(state=>{const signature=[state.track&&M.key(state.track),state.playing,state.phase,state.queue.length].join(':');const force=signature!==lastSignature;lastSignature=signature;refresh(force);});root.addEventListener('music-chat-state',()=>refresh(true));document.addEventListener('scroll',()=>refresh(true),true);document.addEventListener('visibilitychange',()=>refresh(true));root.UvUMusicCard={attach,setStatus:(card,fn)=>{const r=records.get(card);if(r)r.statusFn=fn;}};
})(window);
