// Approved V4 startup artwork. No storage, prompt or application-init changes.
(function () {
    'use strict';
    if (document.getElementById('uvu-startup-screen') || !document.body || !Element.prototype.attachShadow) return;
    const host = document.createElement('div');
    host.id = 'uvu-startup-screen';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-label', '两颗缠绕的心，开屏动画');
    host.setAttribute('aria-modal', 'true');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
:host{--paper:#fff;--ink:#25272b;--thread:#b65c62;--star:#b6c3cd}
*{box-sizing:border-box}
.splash{position:relative;isolation:isolate;width:100%;height:100svh;min-height:320px;overflow:hidden;background:#fff}
.sky{position:absolute;top:24px;right:0;width:56%;height:29%;max-width:380px;max-height:260px;overflow:hidden;pointer-events:none;mask-image:linear-gradient(to bottom,#000 84%,transparent)}
.star{position:absolute;width:1.5px;height:1.5px;border-radius:50%;background:#000;opacity:.1}
.meteor{position:absolute;opacity:0;width:1px;height:1px;will-change:transform,opacity}
.streak{display:block;position:absolute;width:104px;height:1px;transform:rotate(-45deg);transform-origin:left center;background:linear-gradient(90deg,#000a,#0006 30%,#0002 70%,transparent)}
.streak:before{content:'';position:absolute;width:2px;height:2px;left:-.5px;top:-.5px;border-radius:50%;background:#000a}
.center{position:absolute;inset:0;display:grid;place-items:center;padding-bottom:3vh}
.poem{position:relative;width:296px;height:160px}
.thread{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;transform-origin:50% 50%;transform-box:view-box}
.thread path{fill:none;stroke:var(--thread);stroke-width:.85;stroke-linecap:round;stroke-linejoin:round}
.thread.back{z-index:0;opacity:.48}.thread.front{z-index:3;opacity:.86}.thread .loose{stroke-width:.65;opacity:.7}
h1{position:absolute;left:46px;top:53px;display:flex;margin:0;font-size:31px;font-weight:400;line-height:1.4;white-space:nowrap;z-index:2}
.letter{display:block;position:relative;width:34px;height:48px;flex:none;opacity:1}
.glyph{position:absolute;inset:0;display:block;font-weight:400}
.glyph.upper{clip-path:inset(0 0 48% 0);transform:translateX(.45px)}
.glyph.lower{clip-path:inset(54% 0 0 0);transform:translateX(-.45px)}
.ghost{position:absolute;inset:0;display:block;filter:blur(2.3px);opacity:.16;transform:translate(-5px,-7px);color:#3e4145}
.letter:nth-child(2) .ghost,.letter:nth-child(5) .ghost{transform:translate(5px,7px);opacity:.19}
.letter:nth-child(3){top:-2px}.letter:nth-child(4){top:2px}
.signature{position:absolute;bottom:max(62px,env(safe-area-inset-bottom));left:0;right:0;text-align:center;font-family:Georgia,serif;font-size:12px;letter-spacing:2px;color:#aeb5bc}
@media(max-height:450px){.center{padding-bottom:0}.signature{bottom:24px}}

:host{all:initial !important;position:fixed !important;inset:0 !important;width:100% !important;height:100% !important;display:block !important;z-index:2147483646 !important;isolation:isolate !important;opacity:1;pointer-events:auto !important;color-scheme:light}
.splash{height:100%;min-height:0;font-family:STSong,'Songti SC',SimSun,serif;color:#25272b}
.skip{position:absolute;right:max(20px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));min-width:44px;min-height:44px;padding:8px 12px;border:0;border-radius:22px;background:transparent;color:#848990;font:12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer}
.skip:focus-visible{outline:2px solid #b65c62;outline-offset:2px}
@media(prefers-reduced-motion:no-preference){:host{transition:opacity 240ms ease}}
</style>
<main class="splash" aria-label="两颗缠绕的心">
 <div class="sky" aria-hidden="true"></div>
 <div class="center"><section class="poem" aria-label="两颗缠绕的心">
  <svg class="thread back" viewBox="0 0 296 160" aria-hidden="true">
   <path class="weave" pathLength="1" d="M8 111C30 123 47 99 61 76C75 52 86 49 99 61C111 73 109 111 130 104C151 97 150 54 171 53C193 52 189 100 212 97C233 94 235 67 254 66C269 64 281 77 292 72"/>
   <path class="loose" pathLength="1" d="M8 111C5 109 4 105 0 106M292 72C299 68 300 61 305 62"/>
  </svg>
  <h1 aria-label="两颗缠绕的心"></h1>
  <svg class="thread front" viewBox="0 0 296 160" aria-hidden="true">
   <path class="weave" pathLength="1" d="M61 76C67 66 73 57 80 55M103 67C110 81 111 108 128 104C137 102 142 90 146 80M171 53C184 52 188 69 191 79M202 95C217 104 230 84 236 77M254 66C268 64 281 77 292 72"/>
   <path class="loose" pathLength="1" d="M128 104C117 108 119 119 127 117C134 115 132 106 128 104C137 107 141 113 141 121"/>
  </svg>
 </section></div>
 <footer class="signature">UvU</footer>
 <button class="skip" type="button" aria-label="跳过开屏动画">跳过</button>
</main>`;
    document.body.prepend(host);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sky = shadow.querySelector('.sky');
    const animations = [];
    const skip = shadow.querySelector('.skip');
    let removed = false, closing = false, exitTimer, removalTimer;
    const previousFocus = document.activeElement;

    function remove() {
        if (removed) return;
        removed = true;
        clearTimeout(exitTimer);
        clearTimeout(removalTimer);
        animations.forEach(animation => animation.cancel());
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('DOMContentLoaded', focusSkip);
        window.removeEventListener('pagehide', remove);
        if (reduce.removeEventListener) reduce.removeEventListener('change', onMotionChange);
        const restoreFocus = Boolean(shadow.activeElement);
        host.remove();
        if (restoreFocus && previousFocus?.isConnected && previousFocus !== document.body) {
            previousFocus.focus({ preventScroll: true });
        }
    }
    function dismiss(immediate = false) {
        if (removed || closing) return;
        closing = true;
        if (immediate || reduce.matches) return remove();
        host.style.opacity = '0';
        // A timer also works when CSS transitions are disabled or interrupted.
        removalTimer = setTimeout(remove, 260);
    }
    function focusSkip() {
        if (!removed && !closing) skip.focus({ preventScroll: true });
    }
    function onKey(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
        } else if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            focusSkip();
        }
    }
    function onVisibility() {
        if (removed) return;
        animations.forEach(animation => document.hidden ? animation.pause() : animation.play());
    }
    function onMotionChange() { if (reduce.matches) remove(); }
    skip.addEventListener('click', () => dismiss());
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', remove);
    if (reduce.addEventListener) reduce.addEventListener('change', onMotionChange);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', focusSkip, { once: true });
    else focusSkip();
    // This is artwork, not a data loader: it never waits for fonts, API calls or init().
    exitTimer = setTimeout(() => dismiss(), reduce.matches ? 400 : 4600);
    try {
        for (const character of '两颗缠绕的心') {
            const letter = document.createElement('span');
            letter.className = 'letter';
            letter.setAttribute('aria-hidden', 'true');
            for (const name of ['ghost', 'glyph upper', 'glyph lower']) {
                const glyph = document.createElement('span');
                glyph.className = name;
                glyph.textContent = character;
                letter.append(glyph);
            }
            shadow.querySelector('h1').append(letter);
        }
        let seed = 520;
        const random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
        for (let i = 0; i < 6; i++) {
            const star = document.createElement('i');
            star.className = 'star';
            star.style.left = (7 + random() * 86) + '%';
            star.style.top = (7 + random() * 74) + '%';
            star.style.opacity = .05 + random() * .07;
            sky.append(star);
        }
        const moving = !reduce.matches && typeof host.animate === 'function';
        for (const meteor of [{ x: .79, y: .19, delay: 0 }, { x: .91, y: .39, delay: 3600 }]) {
            const element = document.createElement('i');
            element.className = 'meteor';
            element.innerHTML = '<span class="streak"></span>';
            element.style.left = (meteor.x * sky.clientWidth) + 'px';
            element.style.top = (meteor.y * sky.clientHeight) + 'px';
            sky.append(element);
            if (!moving) { element.style.opacity = '.25'; continue; }
            const animation = element.animate([
                { transform: 'translate(38px,-38px)', opacity: 0, offset: 0 },
                { transform: 'translate(20px,-20px)', opacity: .4, offset: .1 },
                { transform: 'translate(-65px,65px)', opacity: .3, offset: .32 },
                { transform: 'translate(-110px,110px)', opacity: 0, offset: .46 },
                { transform: 'translate(-110px,110px)', opacity: 0, offset: 1 }
            ], { duration: 7600, iterations: Infinity, easing: 'linear' });
            animation.currentTime = (7600 - meteor.delay) % 7600;
            animations.push(animation);
        }
        if (moving) {
            shadow.querySelectorAll('.letter').forEach((element, i) => {
                animations.push(element.animate([
                    { transform: `translate(${i % 2 ? -3 : 3}px,${-22 - i % 3 * 8}px)`, opacity: 0, offset: 0 },
                    { transform: `translate(0,${i % 2 ? -3 : 3}px)`, opacity: 1, offset: .7 },
                    { transform: 'translate(0,0)', opacity: 1, offset: 1 }
                ], { duration: 2300, delay: 150 + i * 100, easing: 'cubic-bezier(.2,.6,.24,1)', fill: 'both' }));
            });
            shadow.querySelectorAll('.thread path').forEach((element, i) => {
                element.style.strokeDasharray = '1';
                animations.push(element.animate([
                    { strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0, opacity: 1 }
                ], { duration: 2300, delay: 650 + (i % 2) * 180, easing: 'ease-in-out', fill: 'both' }));
            });
            const sway = [
                { transform: 'translate(0,0) scaleY(1) rotate(0deg)', offset: 0 },
                { transform: 'translate(-1px,-3px) scaleY(.96) rotate(-.8deg)', offset: .27 },
                { transform: 'translate(1px,3px) scaleY(1.04) rotate(.65deg)', offset: .68 },
                { transform: 'translate(0,0) scaleY(1) rotate(0deg)', offset: 1 }
            ];
            shadow.querySelectorAll('.thread').forEach(element => {
                animations.push(element.animate(sway, { duration: 5600, delay: 2600, iterations: Infinity, easing: 'ease-in-out', fill: 'both' }));
            });
        }
    } catch (_) {
        // An unsupported visual effect must never prevent entering the app.
        remove();
    }

})();
