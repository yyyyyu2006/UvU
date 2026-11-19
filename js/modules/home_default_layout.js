// 用户确认的第五稿。独立复制内置模板，不覆盖原模板或已有桌面。
(function () {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const IDS = { top: 'uvu-home-v1-top', ins: 'uvu-home-v1-ins', photo: 'uvu-home-v1-photo', quote: 'uvu-home-v1-quote' };
    const PAGES = [
        [IDS.top, IDS.ins, 'app-chat', 'app-uvu-music', 'app-reader', 'app-placeholder'],
        [IDS.photo, 'app-worldbook', 'app-api', 'app-customize', 'app-widget-market', 'app-wallpaper', IDS.quote, 'app-tutorial', 'app-console']
    ];
    // [起始列，起始行，列数，行数]，顺序同时对应从上到下、从左到右的阅读顺序。
    const CELLS = [
        [[1,1,4,2], [1,3,2,2], [3,3,1,1], [4,3,1,1], [3,4,1,1], [4,4,1,1]],
        [[1,1,2,2], [3,1,1,1], [4,1,1,1], [3,2,1,1], [1,3,1,1], [2,3,1,1], [3,3,2,2], [1,4,1,1], [2,4,1,1]]
    ];
    const WHITE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IndoaXRlIi8+PC9zdmc+';
    const AVATAR = 'assets/home/default-avatar.jpg';
    const FRIEND = 'assets/home/default-friend.jpg';
    const PHOTO = 'assets/home/default-photo.jpg';
    const TOP_CSS = "#{{id}}.home-widget-container{transform:none;display:block}\n#{{id}} .central-circle{position:absolute;inline-size:80px;block-size:80px;inset:17px 9px auto auto;box-shadow:0 3px 12px #536b7a12}\n#{{id}} .widget-time{top:16px;bottom:auto;left:8px;transform:none;font-size:43px;line-height:1.1;font-weight:450;letter-spacing:-2px;color:#526774;text-shadow:none}\n#{{id}} .widget-date{top:70px;bottom:auto;left:10px;width:auto;font-size:12px;color:#6a808e;text-shadow:none}\n#{{id}} .widget-signature{top:97px;bottom:auto;left:5px;transform:none;width:calc(100% - 100px);font-size:11px;max-width:none;text-align:left;color:#718593;text-shadow:none}\n#{{id}} .satellite-oval{top:auto;bottom:10px;width:calc(25% - 5px);height:31px;padding:0 5px;gap:2px;font-size:10px;border-radius:12px;box-shadow:none;background:#ffffff91}\n#{{id}} .satellite-emoji{font-size:13px;width:19px;height:21px}\n#{{id}} .satellite-text{padding:0;margin:0}\n#{{id}} .oval-top-left{left:0;right:auto}#{{id}} .oval-top-right{left:calc(25% + 1px);right:auto}#{{id}} .oval-bottom-left{left:calc(50% + 2px);right:auto}#{{id}} .oval-bottom-right{left:auto;right:0}\n#{{id}} .widget-battery{display:none}";
    const INS_CSS = "#{{id}} .app-grid-widget{width:100%;height:100%}#{{id}} .ins-widget{padding:8px 3px}#{{id}} .ins-widget-avatar{width:34px;height:34px}\n#{{id}} .ins-widget-row.user .ins-widget-bubble{margin-left:8px}#{{id}} .ins-widget-row.character .ins-widget-bubble{margin-right:8px}#{{id}} .ins-widget-bubble{padding:7px 8px;font-size:12px;line-height:1.4;color:#52616b;box-shadow:0 3px 10px #536b7a0c}";
    const QUOTE_CSS = "#{{id}}.widget-skeleton-2x2{background:#ffffffb8;box-shadow:none;border-radius:20px}\n#{{id}} .image-box{background-size:contain;background-repeat:no-repeat;background-color:#e9eceb;min-height:0}\n#{{id}} .text-box{height:42px;flex:none;padding:0 6px;background:#ffffffb8;font-size:13px;font-weight:400;color:#536b78;line-height:1.5}";

    function createSettings(current) {
        const templates = [
            ['builtin-top-panel-4x2', IDS.top, '默认首页 · 时间与头像', TOP_CSS, {
                centralImage: AVATAR, tlEmoji: '♡', tlText: 'Love', trEmoji: '✦', trText: 'Peace',
                blEmoji: '☁', blText: 'Joy', brEmoji: '☆', brText: 'Hope', signature: '把日子过成喜欢的样子。'
            }],
            ['builtin-ins-2x2', IDS.ins, '默认首页 · 对话', INS_CSS, { avatar1: FRIEND, avatar2: AVATAR, bubble1: '在呢。', bubble2: '抱抱。' }],
            ['builtin-polaroid-2x2', IDS.photo, '默认首页 · 拍立得', '', { image: PHOTO }],
            ['skeleton-2x2', IDS.quote, '默认首页 · 图文', QUOTE_CSS, { image: FRIEND, title: '今天也要开心' }]
        ].map(([sourceId, id, name, css, vars]) => {
            const source = [...extractedBuiltInTemplates, ...basicWidgetTemplates].find(item => item.id === sourceId);
            if (!source) throw new Error('默认主页组件尚未加载，请刷新后重试');
            return { ...clone(source), id, name, css: source.css + '\n' + css, defaultVars: vars };
        });
        // 每次重绘只保留一个默认时钟，删除组件后下一个 tick 会自行停止。
        templates[0].js = `clearInterval(window.uvuDefaultHomeClock);
function tick() {
    const time = document.getElementById('time-display-{{id}}');
    if (!time) { clearInterval(window.uvuDefaultHomeClock); return; }
    const now = new Date();
    time.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    document.getElementById('date-display-{{id}}').textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];
}
window.uvuDefaultHomeClock = setInterval(tick, 1000); tick();`;
        return {
            wallpaper: WHITE, homeScreenMode: 'night', customIcons: clone(current.customIcons || {}),
            homeSignature: current.homeSignature || '',
            insWidgetSettings: clone(current.insWidgetSettings || {}),
            homeWidgetSettings: clone(current.homeWidgetSettings || defaultWidgetSettings),
            homeLayoutPages: clone(PAGES), homeLayoutOrder: PAGES.flat(), widgetTemplates: templates,
            addedWidgets: Object.values(IDS).map(id => ({ id, templateId: id, vars: {} }))
        };
    }

    function matchedPage(ids) {
        return PAGES.findIndex(page => JSON.stringify(page) === JSON.stringify(ids));
    }

    function decorate(home) {
        let active = false;
        home.querySelectorAll('.home-grid-layout').forEach(grid => {
            const items = Array.from(grid.children);
            const page = matchedPage(items.map(item => item.dataset.id));
            const styled = page !== -1 || items.some(item => Object.values(IDS).includes(item.dataset.id));
            grid.classList.toggle('uvu-home-default-page', styled);
            grid.parentElement.classList.toggle('uvu-home-default-wrap', styled);
            if (!styled) return;
            active = true;
            grid.style.minHeight = '';
            if (page === -1) return; // 用户重排后保留组件尺寸，位置交回原来的流式布局。
            items.forEach((item, index) => {
                const [column, row, columns, rows] = CELLS[page][index];
                item.style.gridColumn = `${column} / span ${columns}`;
                item.style.gridRow = `${row} / span ${rows}`;
            });
        });
        home.classList.toggle('uvu-default-home', active);
    }

    function releasePositions(home) {
        home.querySelectorAll('.uvu-home-default-page > [data-id]').forEach(item => {
            item.style.gridColumn = ''; item.style.gridRow = '';
        });
    }

    window.UvUDefaultHome = Object.freeze({ createSettings, decorate, releasePositions });
})();
