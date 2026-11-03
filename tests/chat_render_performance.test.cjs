const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/modules/chat_render.js'), 'utf8');
const start = source.indexOf('function createInvisibleMessageRegex(');
const end = source.indexOf('function renderMessages(', start);
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.createInvisibleMessageRegex = createInvisibleMessageRegex; this.findPreviousRenderableMessage = findPreviousRenderableMessage;`, context);

test('sequential render predecessor matches prior-history filtering for all status visibility modes', () => {
    const messages = [
        { id: 'a', role: 'user', content: 'visible' },
        { id: 'hidden-memory', role: 'assistant', content: 'memory hidden' },
        { id: 'system', role: 'assistant', content: '[system: transfer]' },
        { id: 'status', role: 'assistant', content: '[system-display: status]' },
        { id: 'thinking', role: 'assistant', content: '<thinking>private</thinking>' },
        { id: 'b', role: 'assistant', content: 'visible reply' }
    ];
    const hidden = new Set(['hidden-memory']);

    for (const showStatus of [false, true]) {
        const regex = context.createInvisibleMessageRegex(showStatus);
        for (let index = 0; index < messages.length; index++) {
            let expected = null;
            for (let cursor = index - 1; cursor >= 0; cursor--) {
                const candidate = messages[cursor];
                if (!hidden.has(candidate.id) && !regex.test(candidate.content)) {
                    expected = candidate;
                    break;
                }
            }
            const actual = context.findPreviousRenderableMessage(messages, index, hidden, regex);
            assert.equal(actual?.id ?? null, expected?.id ?? null, `showStatus=${showStatus}, index=${index}`);
        }
    }
});

test('full renders preserve continuous bubbles across pages, hidden memories and status records', () => {
    for (const showStatus of [false, true]) {
        const history = Array.from({ length: 110 }, (_, index) => ({ id: String(index), role: index % 3 ? 'assistant' : 'user',
            senderId: index % 4 ? 'a' : 'b', timestamp: 1700000000000 + index * 10000,
            content: index % 9 === 0 ? '[system-display: status]' : index % 7 === 0 ? '<thinking>hidden</thinking>' : 'message' }));
        const hidden = new Set(['19', '20', '28', '49', '50', '51']);
        for (const page of [1, 2, 3]) {
            for (const rebuild of [false, true]) {
                const rendered = [];
                const makeNode = () => ({ children: [], appendChild(child) { this.children.push(child); }, addEventListener() {} });
                const chat = { id: 'c', history, showStatusUpdateMsg: showStatus };
                const c = vm.createContext({ window: {}, db: { characters: [chat] }, currentChatId: 'c', currentChatType: 'private',
                    currentPage: page, MESSAGES_PER_PAGE: 50, isInMultiSelectMode: false,
                    messageArea: { scrollHeight: 10, style: {}, prepend() {} },
                    document: { createDocumentFragment: makeNode, createElement: makeNode, getElementById() { return null; } },
                    getAutoMemorySettings: () => ({ useMemory: true, hideSummarized: true }), autoMemoryShowOriginal: new Set(),
                    autoMemoryKey: () => 'c', getAutoMemoryState: () => ({ covered: hidden }), formatTimeDivider: () => 'time' });
                vm.runInContext(source, c);
                c.createMessageBubbleElement = (message, continuous) => { rendered.push({ id: message.id, continuous }); return makeNode(); };
                c.renderMessages(false, false, rebuild);
                const end = rebuild ? history.length : history.length - (page - 1) * 50;
                const first = Math.max(0, end - (rebuild ? page : 1) * 50);
                const regex = c.createInvisibleMessageRegex(showStatus);
                const expected = [];
                for (let index = first; index < end; index++) {
                    const message = history[index];
                    if (hidden.has(message.id)) continue;
                    let previous = null;
                    for (let cursor = index - 1; cursor >= 0; cursor--) {
                        if (!hidden.has(history[cursor].id) && !regex.test(history[cursor].content)) { previous = history[cursor]; break; }
                    }
                    const sender = item => item.role === 'user' ? 'user' : (item.senderId || 'assistant');
                    const system = /\[system:.*?\]|\[system-display:.*?\]/.test(message.content);
                    expected.push({ id: message.id, continuous: Boolean(!system && previous && sender(previous) === sender(message) && message.timestamp - previous.timestamp < 600000) });
                }
                assert.deepEqual(rendered, expected);
            }
        }
    }
});
