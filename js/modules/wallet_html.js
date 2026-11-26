/* Wallet screens are injected separately so the existing chat and app flows stay untouched. */
(() => {
    if (document.getElementById('wallet-screen')) return;
    const host = document.createElement('div');
    host.innerHTML = `
    <section id="wallet-screen" class="screen wallet-screen" aria-labelledby="wallet-title">
      <header class="app-header wallet-header">
        <button class="back-btn" data-target="more-screen" aria-label="返回">‹</button>
        <h1 id="wallet-title" class="title">钱包</h1><button id="wallet-ledger-all" class="wallet-all-link">账单</button>
      </header>
      <main class="wallet-content">
        <section class="wallet-overview" aria-label="零钱余额">
          <div class="wallet-overview-label">零钱</div><div id="wallet-balance" class="wallet-balance">¥ 0.00</div>
          <div class="wallet-actions">
            <button data-wallet-action="transfer">转账</button><button data-wallet-action="recharge">转回零钱</button><button data-wallet-action="receive">收款</button>
          </div>
        </section>
        <nav class="wallet-shortcuts" aria-label="钱包服务">
          <button data-wallet-view="cards"><span aria-hidden="true">▤</span>银行卡</button>
          <button data-wallet-view="family"><span aria-hidden="true">♡</span>亲属卡</button>
          <button data-wallet-view="bills"><span aria-hidden="true">≋</span>账单</button>
        </nav>
        <section class="wallet-home-cards">
          <div class="wallet-section-heading"><h2>我的银行卡</h2><button data-wallet-view="cards">全部 <span aria-hidden="true">›</span></button></div>
          <div id="wallet-home-deck" class="wallet-deck" aria-label="虚拟银行卡"></div>
        </section>
        <section class="wallet-home-bills">
          <div class="wallet-section-heading"><h2>最近账单</h2><button data-wallet-view="bills">全部 <span aria-hidden="true">›</span></button></div>
          <div id="wallet-home-rows" class="wallet-rows"></div>
        </section>
      </main>
    </section>
    <section id="wallet-cards-screen" class="screen wallet-screen" aria-labelledby="wallet-cards-title">
      <header class="app-header wallet-header"><button class="back-btn" data-wallet-back aria-label="返回钱包">‹</button><h1 id="wallet-cards-title" class="title">银行卡</h1><span></span></header>
      <main class="wallet-content wallet-sub-content">
        <div id="wallet-card-deck" class="wallet-deck wallet-large-deck" aria-label="银行卡卡组，可左右滑动切换"></div>
        <div class="wallet-card-hint">点按翻面 · 左右滑动切卡</div>
        <div id="wallet-card-list" class="wallet-list"></div>
        <button id="wallet-add-card" class="wallet-outline-button">＋ 添加虚拟卡</button>
      </main>
    </section>
    <section id="wallet-family-screen" class="screen wallet-screen" aria-labelledby="wallet-family-title">
      <header class="app-header wallet-header"><button class="back-btn" data-wallet-back aria-label="返回钱包">‹</button><h1 id="wallet-family-title" class="title">亲属卡</h1><span></span></header>
      <main class="wallet-content wallet-sub-content"><p class="wallet-muted">只在 UvU 内模拟亲属卡额度与消费。</p><div id="wallet-family-list" class="wallet-list"></div><button id="wallet-add-family" class="wallet-outline-button">＋ 开通亲属卡</button></main>
    </section>
    <section id="wallet-bills-screen" class="screen wallet-screen" aria-labelledby="wallet-bills-title">
      <header class="app-header wallet-header"><button class="back-btn" data-wallet-back aria-label="返回钱包">‹</button><h1 id="wallet-bills-title" class="title">账单</h1><span></span></header>
      <main id="wallet-bills-content" class="wallet-content wallet-sub-content"><div id="wallet-bills-list" class="wallet-rows"></div></main>
    </section>
    <div id="wallet-entry-prompt" class="wallet-backdrop" hidden><div class="wallet-sheet wallet-entry-sheet" role="dialog" aria-modal="true" aria-labelledby="wallet-entry-title"><button class="wallet-sheet-close" data-wallet-close aria-label="关闭">×</button><h2 id="wallet-entry-title"></h2><div id="wallet-entry-body"></div><div class="wallet-entry-actions"><button data-wallet-cancel>取消</button><button class="wallet-primary" data-wallet-continue>继续</button></div></div></div>
    <div id="wallet-pin-prompt" class="wallet-backdrop wallet-pin-backdrop" hidden><section class="wallet-sheet wallet-pin-sheet" role="dialog" aria-modal="true" aria-labelledby="wallet-pin-title"><div class="wallet-sheet-grab"></div><button class="wallet-sheet-close" data-wallet-close aria-label="关闭">×</button><h2 id="wallet-pin-title">请输入支付密码</h2><div id="wallet-pin-purpose" class="wallet-pin-purpose"></div><div id="wallet-pin-dots" class="wallet-pin-dots" aria-hidden="true"></div><div id="wallet-pin-error" class="wallet-pin-error" aria-live="polite"></div><div id="wallet-pin-keypad" class="wallet-pin-keypad"></div><button class="wallet-pin-cancel" data-wallet-close>取消</button></section></div>`;
    (document.querySelector('.phone-screen') || document.body).append(host);
})();
