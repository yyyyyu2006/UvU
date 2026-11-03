const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/modules/chat_ai.js'), 'utf8');

function dialogFixture() {
    const handlers = {};
    const textarea = { value: '', focus() {} };
    const overlay = {
        setAttribute() {},
        addEventListener(name, handler) { handlers[name] = handler; },
        querySelector() { return textarea; },
        remove() { this.removed = true; }
    };
    const context = vm.createContext({ document: {
        body: { appendChild() {} },
        createElement() { return overlay; }
    } });
    vm.runInContext(source, context);
    return { context, handlers, overlay, textarea };
}

test('regenerate dialog contains only an instruction field and aligned cancel/reroll actions', async () => {
    const f = dialogFixture();
    const pending = f.context.showRegenerateGuidanceDialog();
    assert.equal((f.overlay.innerHTML.match(/data-action=/g) || []).length, 2);
    assert.match(f.overlay.innerHTML, /data-action="cancel"/);
    assert.match(f.overlay.innerHTML, /data-action="reroll"/);
    assert.doesNotMatch(f.overlay.innerHTML, /preset|reason|直接重 Roll|附说明/);
    f.textarea.value = '  \n ';
    f.handlers.click({ target: { closest: () => ({ dataset: { action: 'reroll' } }) } });
    assert.equal(await pending, '');
    assert.equal(f.overlay.removed, true);
});

test('regenerate dialog trims guidance and cancel returns null', async () => {
    const f = dialogFixture();
    const pending = f.context.showRegenerateGuidanceDialog();
    f.textarea.value = '  保留刚才提到的地点  ';
    f.handlers.click({ target: { closest: () => ({ dataset: { action: 'reroll' } }) } });
    assert.equal(await pending, '保留刚才提到的地点');

    const next = f.context.showRegenerateGuidanceDialog();
    f.handlers.click({ target: { closest: () => ({ dataset: { action: 'cancel' } }) } });
    assert.equal(await next, null);
});

function element(tag) {
    const node = { tag, children: [], style: {}, classList: { contains() { return false; } },
        append(...items) { for (const item of items) { item.parentNode = this; this.children.push(item); } },
        appendChild(item) { this.append(item); },
        replaceChildren(...items) { this.children.forEach(item => { item.parentNode = null; }); this.children = []; this.append(...items); },
        setAttribute() {}, addEventListener() {}, remove() { this.parentNode?.replaceChildren(...this.parentNode.children.filter(item => item !== this)); } };
    return node;
}

test('incoming notifications replace the previous card and omit internal IDs', () => {
    const elements = new Map();
    const body = { appendChild(node) { if (node.id) elements.set(node.id, node); } };
    const context = vm.createContext({ document: {
        body, visibilityState: 'hidden',
        getElementById(id) { return elements.get(id) || null; },
        createElement: element
    }, currentChatId: 'elsewhere', currentChatType: 'private', setTimeout() { return 1; }, clearTimeout() {} });
    vm.runInContext(source, context);
    const chat = { id: 'internal-chat-id', realName: '谢澄', avatar: 'avatar.png' };
    context.showIncomingMessageNotifications(chat, [
        { role: 'assistant', content: '[谢澄的消息：旧消息]', senderId: 'internal-sender-id' }
    ], chat.id, 'private');
    context.showIncomingMessageNotifications(chat, [
        { role: 'assistant', content: '[谢澄的消息：新消息]', senderId: 'internal-sender-id' }
    ], chat.id, 'private');

    const host = elements.get('incoming-message-notifications');
    assert.equal(host.children.length, 1);
    const [card] = host.children;
    assert.equal(card.children[0].src, 'avatar.png');
    assert.equal(card.children[1].children.length, 2);
    assert.equal(card.children[1].children[0].textContent, '谢澄');
    assert.equal(card.children[1].children[1].textContent, '新消息');
    assert.equal(card.children.some(child => child.tag === 'small'), false);
    assert.equal(card.children[1].children[1].textContent.includes('旧消息'), false);
});
