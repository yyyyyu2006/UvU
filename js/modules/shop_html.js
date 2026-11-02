document.addEventListener('DOMContentLoaded', () => {
    const shopHtml = `
    <header class="app-header">
        <button class="back-btn" data-target="chat-room-screen">‹</button>
        <div class="title-container">
            <h1 class="title">商城</h1>
        </div>
        <div class="action-btn-group">
            <button class="action-btn" id="shop-refresh-btn" title="重新进货">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 22px; height: 22px;">
                    <path d="M23 4v6h-6"></path>
                    <path d="M1 20v-6h6"></path>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
            </button>
            <button class="action-btn" id="shop-more-btn" title="更多">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px;">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </button>
        </div>
    </header>
    <div class="shop-tabs"></div>
    <main class="content" id="shop-content-container"></main>
    <div id="shop-delivery-modal" class="modal-overlay">
        <div class="modal-window">
            <h3 id="shop-delivery-item-name">确认订单</h3>
            <p style="color: #666; font-size: 14px; margin-bottom: 15px;">请选择配送方式：</p>
            <div class="delivery-options">
                <div class="delivery-option-card active" data-type="timed" onclick="selectDeliveryOption('timed')">
                    <div class="delivery-icon">🛵</div>
                    <div class="delivery-info">
                        <div class="delivery-title">定时送达</div>
                        <div class="delivery-desc">预计 30 分钟内送达</div>
                    </div>
                    <div class="delivery-check"></div>
                </div>
                <div class="delivery-option-card" data-type="instant" onclick="selectDeliveryOption('instant')">
                    <div class="delivery-icon">⚡</div>
                    <div class="delivery-info">
                        <div class="delivery-title">即时送达</div>
                        <div class="delivery-desc">加急配送，立即送出</div>
                    </div>
                    <div class="delivery-check"></div>
                </div>
                <div class="delivery-option-card" data-type="pickup" onclick="selectDeliveryOption('pickup')">
                    <div class="delivery-icon">🏪</div>
                    <div class="delivery-info">
                        <div class="delivery-title">门店自提</div>
                        <div class="delivery-desc">凭口令到店领取</div>
                    </div>
                    <div class="delivery-check"></div>
                </div>
                <div class="delivery-option-card" data-type="pay-for-me" onclick="selectDeliveryOption('pay-for-me')">
                    <div class="delivery-icon">🥺</div>
                    <div class="delivery-info">
                        <div class="delivery-title">让Ta买单</div>
                        <div class="delivery-desc">发送代付请求</div>
                    </div>
                    <div class="delivery-check"></div>
                </div>
            </div>
            
            <div id="pickup-code-input-container" style="display: none; margin-top: 15px;">
                <label style="font-size: 12px; color: #666; display: block; margin-bottom: 5px;">自提口令</label>
                <input type="text" id="shop-pickup-code" placeholder="输入取货码/口令" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; outline: none;">
            </div>

            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button id="shop-delivery-confirm" class="btn btn-primary" style="flex: 1;">确认下单</button>
                <button id="shop-delivery-cancel" class="btn btn-neutral" style="flex: 1;">取消</button>
            </div>
        </div>
    </div>

    <!-- Shop More ActionSheet -->
    <div id="shop-more-actionsheet" class="action-sheet-overlay">
        <div class="action-sheet">
            <button class="action-sheet-button" id="shop-pickup-btn">🎁 提取商品 (输入口令)</button>
            <button class="action-sheet-button" id="shop-category-manage-btn">🏷️ 自定义分类</button>
            <button class="action-sheet-button danger" id="shop-more-cancel-btn">取消</button>
        </div>
    </div>

    <!-- Shop Category Manage Modal -->
    <div id="shop-category-manage-modal" class="modal-overlay">
        <div class="modal-window" style="max-height: 85vh; overflow-y: auto;">
            <h3>商城分类管理</h3>
            <div style="font-size: 12px; color: #666; margin-bottom: 10px; background: #f9f9f9; padding: 8px; border-radius: 6px;">
                添加自定义分类后，下次进货时 AI 将会根据你的提示词生成对应商品。
            </div>

            <div class="form-group" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
                <label for="shop-item-count" style="margin: 0;">每个分类生成数量</label>
                <input type="number" id="shop-item-count" value="8" min="1" max="20" style="width: 60px; text-align: center;">
            </div>
            
            <div id="shop-category-list" style="margin-bottom: 15px; border: 1px solid #eee; border-radius: 8px; padding: 10px; min-height: 100px;">
                <!-- JS populated list -->
            </div>

            <div class="form-group" style="border-top: 1px solid #eee; padding-top: 15px;">
                <label style="font-weight: bold; margin-bottom: 10px; display: block;">添加新分类</label>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <input type="text" id="shop-cat-id" placeholder="英文id (如: flower)" style="flex: 1; min-width: 0;" required>
                    <input type="text" id="shop-cat-name" placeholder="显示名称 (如: 🌸 花)" style="flex: 1; min-width: 0;" required>
                </div>
                <textarea id="shop-cat-prompt" rows="2" placeholder="简短的提示词：描述这个分类下应该卖什么商品..." style="width: 100%; margin-bottom: 10px;" required></textarea>
                <button id="shop-add-category-btn" class="btn btn-secondary" style="width: 100%;">+ 添加分类</button>
            </div>
            
            <div style="margin-top: 10px; text-align: right;">
                <button id="shop-category-close-btn" class="btn btn-primary" style="width: 100%;">完成</button>
            </div>
        </div>
    </div>

    <!-- Shop Pickup Modal -->
    <div id="shop-pickup-modal" class="modal-overlay">
        <div class="modal-window">
            <h3>提取商品</h3>
            <p style="color: #666; font-size: 14px; margin-bottom: 15px;">请输入订单中的自提口令或暗号：</p>
            <div class="form-group">
                <input type="text" id="shop-pickup-input" placeholder="例如：888888 或 汪汪汪" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; outline: none; font-size: 16px; text-align: center;">
            </div>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button id="shop-pickup-confirm" class="btn btn-primary" style="flex: 1;">确认提取</button>
                <button id="shop-pickup-cancel" class="btn btn-neutral" style="flex: 1;">取消</button>
            </div>
        </div>
    </div>
    `;
    const container = document.getElementById('shop-screen');
    if (container) {
        container.innerHTML = shopHtml;
    }
});
