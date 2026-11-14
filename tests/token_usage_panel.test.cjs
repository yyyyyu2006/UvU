const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderUsageRows(usage) {
    const createElement = () => ({
        children: [],
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.children.push(node); },
        replaceChildren(...nodes) { this.children = nodes; },
        setAttribute() {}, addEventListener() {},
    });
    const context = vm.createContext({ window: {}, document: { createElement }, getChatTokenUsageSnapshot: () => usage });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/chat.js'), 'utf8'), context);
    const container = createElement();
    context.renderTokenUsagePanel(container, { id: 'display-only', history: [] });
    return container.children.find(node => node.className === 'status-token-list').children;
}

for (const [name, environment, mcp] of [['environment', 30, 0], ['MCP', 0, 20], ['environment and MCP', 30, 20]]) {
    test(`token reconciliation includes ${name} in the displayed input estimate`, () => {
        const rows = renderUsageRows({ baseSystem: 100, cot: 0, worldBook: 0, charPersona: 0, userPersona: 0,
            memory: 0, vectorMemory: 0, history: 0, environment, mcp,
            promptActual: true, promptTokens: 100 + environment + mcp });
        assert.equal(rows.some(row => row.className.includes('status-token-difference')), false);
        assert.equal(rows.filter(row => /真实环境|MCP 外部资料/.test(row.children[0].textContent)).length, Number(environment > 0) + Number(mcp > 0));
    });
}

test('token reconciliation retains genuine positive and negative differences', () => {
    for (const [promptTokens, label] of [[160, 'API 返回输入高于分类估算'], [140, '分类估算高于 API 返回输入']]) {
        const rows = renderUsageRows({ baseSystem: 100, environment: 30, mcp: 20, promptActual: true, promptTokens });
        const difference = rows.find(row => row.className.includes('status-token-difference'));
        assert.equal(difference.children[0].textContent, label);
        assert.equal(difference.children[1].textContent, '10 token');
    }
});

test('token estimate keeps only worldbooks activated for the current request', () => {
    const chat = {
        id: 'token-chat',
        history: [{ role: 'user', content: '当前消息' }],
        worldBookIds: ['active', 'inactive'],
        realName: '角色',
        myName: '我',
        persona: '角色设定',
        status: '',
    };
    const activePlan = [{ id: 'active', name: '已触发世界书', position: 'before', content: '猫和雨天的设定' }];
    const context = vm.createContext({
        db: { characters: [chat], groups: [], worldBooks: [
            { id: 'active', name: '已触发世界书', position: 'before', content: '猫和雨天的设定' },
            { id: 'inactive', name: '未触发世界书', position: 'before', content: '不应出现在本轮统计' },
        ], cotSettings: { callEnabled: false } },
        buildWorldBookPlan: () => activePlan,
        worldBookSection: (plan, position) => plan.filter(item => item.position === position).map(item => item.content).join('\\n'),
        generatePrivateSystemPrompt: (_chat, plan) => `系统\\n${plan.map(item => item.content).join('\\n')}`,
        getContextMemoryJournals: () => [],
        getAutoMemoryContextHistory: value => value.history,
        filterHistoryForAI: (_chat, history) => history,
        console: { error() {} },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/chat_ai_prompt.js'), 'utf8'), context);
    const result = context.getWorldBookTokenDetails(chat, activePlan);
    assert.deepEqual(result.map(item => item.name), ['已触发世界书']);
    assert.deepEqual(result.map(item => item.triggered), [true]);
    assert.ok(result[0].tokenEstimate > 0);
    assert.equal(result.some(item => item.name === '未触发世界书'), false);
});

test('global CSS document tools are compact and anchored to the editor corner', () => {
    const css = fs.readFileSync(path.join(__dirname, '../css/settings.css'), 'utf8');
    assert.match(css, /global-css-editor-group \{ position: relative;/);
    assert.match(css, /global-css-document-tools \{ position: absolute; left: 10px; bottom: 8px;/);
    assert.match(css, /global-css-document-tools \.btn \{[^}]*flex: 0 0 auto;/s);
    assert.doesNotMatch(css, /global-css-document-tools \.btn,[\s\S]*?flex: 1 1 0/);
});

test('worldbook token section exposes an explicit expand and collapse control', () => {
    const source = fs.readFileSync(path.join(__dirname, '../js/chat.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../css/chat.css'), 'utf8');
    assert.match(source, /status-token-worldbook-toggle/);
    assert.match(source, /aria-expanded/);
    assert.match(source, /details\.hidden = !details\.hidden/);
    assert.match(source, /展开/);
    assert.match(source, /收起/);
    assert.match(css, /status-token-worldbook-details\[hidden\][^}]*display:\s*none\s*!important/);
});

test('status panel action buttons stay below the status content instead of covering its header', () => {
    const css = fs.readFileSync(path.join(__dirname, '../css/chat.css'), 'utf8');
    assert.match(css, /\.status-panel-actions \{[^}]*left: calc\(50% - 78px\)/);
    assert.match(css, /\.status-panel-actions \{[^}]*bottom: max\(80px, calc\(env\(safe-area-inset-bottom\) \+ 60px\)\)/);
    assert.match(css, /\.status-panel-actions \{[^}]*pointer-events: none/);
    assert.match(css, /\.status-token-toggle \{ position: static;/);
});
