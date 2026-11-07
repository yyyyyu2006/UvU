const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('../../uvu-verification-deps/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const cssFiles = [
    'css/modules/feature_refinements.css',
    'css/modules/journal.css',
    'css/modules/chat_documents.css',
    'css/modules/mcp.css',
    'css/modules/derived_features.css',
    'css/modules/model_picker.css',
    'css/modules/ui_harmony.css'
];

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const css = cssFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
        await page.setContent(`
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <div class="feature-dialog memory-library"><div class="feature-dialog-card">
                <header><strong>记忆管理</strong></header>
                <details class="memory-library-filter-disclosure"><summary>筛选</summary><div class="memory-library-filters"><input></div></details>
                <div class="memory-library-toolbar"><button data-action="save">添加</button><button>更多</button></div>
                <section class="memory-library-card"><span>内层卡片</span></section>
                <div class="memory-library-list"></div>
            </div></div>
            <div class="message-wrapper"><div class="message-bubble shared-document-card"><strong>文件</strong><button>打开</button></div></div>
            <div class="mcp-settings"><button>保存</button></div>
            <div class="mcp-settings"><section>服务</section></div>
            <div id="auto-memory-modal"><div class="auto-memory-dialog">自动总结</div></div>
            <div id="uvu-story-bridge-screen"><section class="uvu-bridge-review">审核</section></div>
            <div class="status-token-panel"><div class="status-token-list"></div></div>
            <button id="sticker-description-settings-open">表情说明</button>
        `);
        await page.addStyleTag({ content: css });

        for (const scheme of ['light', 'dark']) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [320, 390, 768]) {
                await page.setViewportSize({ width, height: 844 });
                const result = await page.evaluate(() => {
                    const card = document.querySelector('.feature-dialog-card');
                    const file = document.querySelector('.shared-document-card');
                    const statusPanel = document.querySelector('.status-token-panel');
                    const mcpSection = document.querySelector('.mcp-settings section');
                    const memoryDialog = document.querySelector('.auto-memory-dialog');
                    const bridgeReview = document.querySelector('.uvu-bridge-review');
                    const button = document.querySelector('#sticker-description-settings-open');
                    return {
                        dialogBackground: getComputedStyle(card).backgroundColor,
                        dialogBlur: getComputedStyle(card).backdropFilter,
                        fileBackground: getComputedStyle(file).backgroundColor,
                        statusBackground: getComputedStyle(statusPanel).backgroundColor,
                        mcpBackground: getComputedStyle(mcpSection).backgroundColor,
                        memoryBackground: getComputedStyle(memoryDialog).backgroundColor,
                        bridgeBackground: getComputedStyle(bridgeReview).backgroundColor,
                        mainRadius: getComputedStyle(card).borderTopLeftRadius,
                        innerRadius: getComputedStyle(document.querySelector('.memory-library-card')).borderTopLeftRadius,
                        buttonRadius: getComputedStyle(document.querySelector('.memory-library-toolbar button')).borderTopLeftRadius,
                        buttonShadow: getComputedStyle(document.querySelector('.memory-library-toolbar button')).boxShadow,
                        primaryBackground: getComputedStyle(document.querySelector('.memory-library-toolbar [data-action="save"]')).backgroundColor,
                        toolbarGap: getComputedStyle(document.querySelector('.memory-library-toolbar')).gap,
                        buttonWidth: button.getBoundingClientRect().width,
                        buttonHeight: button.getBoundingClientRect().height,
                        viewportWidth: document.documentElement.scrollWidth,
                        width: innerWidth
                    };
                });
                assert.match(result.dialogBackground, /rgba?\(255, 255, 255/);
                assert.match(result.fileBackground, /rgba?\(255, 255, 255/);
                assert.match(result.statusBackground, /rgba?\(255, 255, 255/);
                assert.match(result.mcpBackground, /rgba?\(255, 255, 255/);
                assert.equal(result.memoryBackground, 'rgb(246, 247, 249)');
                assert.match(result.bridgeBackground, /rgba?\(255, 255, 255/);
                assert.equal(result.dialogBlur, 'none', 'Content cards use solid white surfaces');
                assert.equal(result.mainRadius, width <= 420 ? '20px' : '24px', JSON.stringify(result));
                assert.equal(result.innerRadius, '20px', JSON.stringify(result));
                assert.equal(result.buttonRadius, '999px', JSON.stringify(result));
                assert.equal(result.primaryBackground, 'rgb(27, 29, 33)', JSON.stringify(result));
                assert.match(result.toolbarGap, /8px/, JSON.stringify(result));
                assert.ok(result.buttonWidth < width * 0.6, JSON.stringify(result));
                assert.ok(result.buttonHeight <= 36, JSON.stringify(result));
                assert.equal(result.viewportWidth, result.width, JSON.stringify(result));
                if (width === 320) await page.screenshot({ path: path.join(root, `../outputs/liquid-panels-${scheme}-${width}.png`) });
            }
        }
        assert.match(css, /--derived-control-height/);
        assert.match(css, /\.memory-library-filter-disclosure/);
        assert.match(css, /\.shared-document-card/);
        console.log('PASS minimal white surfaces in light/dark mode, compact sticker entry, collapsed filters, and 320/390/768 layout');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
