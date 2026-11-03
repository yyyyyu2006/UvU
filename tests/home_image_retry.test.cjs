const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/home_image_retry.js'), 'utf8');

function fixture(initial = []) {
    const nodes = [], observers = [], timers = new Map();
    let timerId = 0;
    function node(tag, attributes = {}) {
        const attrs = { ...attributes }, handlers = {};
        const result = { nodeType: 1, tagName: tag.toUpperCase(), children: [], writes: [], complete: false,
            naturalWidth: 0, currentSrc: '', hidden: false,
            getAttribute: name => attrs[name] ?? null,
            setAttribute(name, value) { attrs[name] = value; this.writes.push([name, value]); },
            get src() { return attrs.src ? new URL(attrs.src, 'https://site.test/').href : ''; },
            append(...children) { children.forEach(child => this.appendChild(child)); },
            appendChild(child) { this.children.push(child); child.parentElement = this; },
            contains(child) { return this === child || this.children.some(item => item.contains(child)); },
            querySelectorAll() { return this.children.flatMap(child => [...(child.tagName === 'IMG' ? [child] : []), ...child.querySelectorAll('img')]); },
            addEventListener(name, handler) { handlers[name] = handler; },
            emit(name, target = this) { handlers[name]?.({ target, stopPropagation() {} }); }
        };
        nodes.push(result);
        return result;
    }
    const phone = node('div'), home = node('div'); home.id = 'home-screen';
    let active = true;
    home.classList = { contains: () => active };
    phone.appendChild(home);
    for (const image of initial) {
        const img = node('img', { src: image }); img.complete = true; home.appendChild(img);
    }
    const context = vm.createContext({ URL,
        document: { baseURI: 'https://site.test/', getElementById: id => nodes.find(item => item.id === id), createElement: node },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target, options) { this.target = target; this.options = options; }
        },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); }
    });
    vm.runInContext(source, context);
    function flush(delay = 0) {
        for (const [id, task] of [...timers]) if (task.delay === delay) { timers.delete(id); task.callback(); }
    }
    flush();
    const notice = nodes.find(item => item.id === 'home-image-retry');
    const [status, retry, close] = notice.children;
    function image(url = 'https://images.test/pic.png?token=a%2Bb&v=1', parent = home) {
        const img = node('img', { src: url }); img.complete = true; parent.appendChild(img); return img;
    }
    function fail(img) { img.complete = true; img.naturalWidth = 0; home.emit('error', img); flush(); }
    function load(img) { img.complete = true; img.naturalWidth = 10; home.emit('load', img); flush(); }
    return { context, node, home, phone, notice, status, retry, close, image, fail, load, flush, timers, observers,
        mutate(records = []) { observers[0].callback(records); flush(); },
        navigate(value) { active = value; observers[1].callback([]); flush(); }
    };
}

test('home image errors are reported once and retries preserve the exact URL and unrelated images', () => {
    const f = fixture(), broken = f.image(), healthy = f.image('https://images.test/healthy.png');
    healthy.naturalWidth = 10;
    f.fail(broken); f.fail(broken);
    assert.equal(f.notice.hidden, false); assert.match(f.status.textContent, /1/);
    const original = broken.getAttribute('src');
    f.retry.emit('click'); f.retry.emit('click');
    assert.deepEqual(broken.writes, [['src', original]]); assert.equal(healthy.writes.length, 0);
    assert.equal(f.retry.disabled, true);
    f.fail(broken); assert.equal(f.retry.disabled, false);
    f.retry.emit('click'); f.load(broken);
    assert.equal(f.notice.hidden, true); assert.equal(f.timers.size, 0);
});

test('already failed images and dynamically inserted widget images are detected without rewriting templates', () => {
    const f = fixture(['https://images.test/initial.png']);
    assert.equal(f.notice.hidden, false);
    const wrapper = f.node('div'); f.home.appendChild(wrapper);
    const img = f.image('https://images.test/widget.png', wrapper);
    f.mutate([{ type: 'childList', addedNodes: [wrapper] }]);
    assert.match(f.status.textContent, /2/); assert.equal(img.writes.length, 0);
    assert.equal(wrapper.children.length, 1);
});

test('other screens, empty URLs, data images and non-image failures do not create a home notice', () => {
    const f = fixture();
    for (const img of [f.image(''), f.image('data:image/png;base64,bad'), f.image('blob:https://site.test/bad'), f.image('https://images.test/outside.png', f.phone), f.node('script')]) f.fail(img);
    assert.equal(f.notice.hidden, true);
});

test('source changes and removed widgets discard stale retries and clear their timers', () => {
    const f = fixture(), img = f.image(); f.fail(img); f.retry.emit('click');
    img.setAttribute('src', 'https://images.test/replacement.png');
    f.mutate(); assert.equal(f.notice.hidden, true); assert.equal(f.timers.size, 0);
    f.fail(img); f.retry.emit('click'); f.home.children = [];
    f.mutate(); assert.equal(f.notice.hidden, true); assert.equal(f.timers.size, 0);
    assert.equal(img.writes.filter(([name, url]) => url.includes('replacement')).length, 2);
});

test('retry timeout releases the button without issuing automatic retries', () => {
    const f = fixture(), img = f.image(); f.fail(img); f.retry.emit('click');
    f.flush(12000); f.flush();
    assert.equal(f.retry.disabled, false); assert.equal(f.notice.hidden, false);
    assert.equal(img.writes.length, 1); assert.equal(f.timers.size, 0);
});

test('dismissal lasts until returning home and the notice stays hidden on other screens', () => {
    const f = fixture(), img = f.image(); f.fail(img);
    f.close.emit('click'); f.fail(img); assert.equal(f.notice.hidden, true);
    f.navigate(false); assert.equal(f.notice.hidden, true);
    f.navigate(true); assert.equal(f.notice.hidden, false);
    f.load(img); assert.equal(f.notice.hidden, true);
});

test('responsive srcset-only images retain source attributes and repeated setup adds no listeners or notice', () => {
    const f = fixture(), img = f.node('img', { srcset: 'https://images.test/large.png 2x', sizes: '100vw' });
    img.currentSrc = 'https://images.test/large.png'; f.home.appendChild(img); f.fail(img);
    f.retry.emit('click');
    assert.deepEqual(img.writes, [['srcset', 'https://images.test/large.png 2x']]);
    assert.equal(img.getAttribute('src'), null); assert.equal(img.getAttribute('sizes'), '100vw');
    const observerCount = f.observers.length;
    vm.runInContext(source, f.context); assert.equal(f.observers.length, observerCount);
    assert.equal(f.phone.children.filter(item => item.id === 'home-image-retry').length, 1);
});
