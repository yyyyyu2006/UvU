/**
 * UwU 社区模块 (js/modules/community.js)
 * 处理社区搜索跳转及动态页面加载
 */

function setupCommunityModule() {
    const communitySearchInput = document.querySelector('#phone-screen .community-search-input-container input');
    
    if (!communitySearchInput) return;

    // 监听搜索框回车事件
    communitySearchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const query = communitySearchInput.value.trim();
            
            if (query === 'UwU社区') {
                await loadCommunityDetail();
            } else if (query !== '') {
                showToast('试试搜索 "UwU社区" 吧！');
            }
        }
    });
}

/**
 * 动态加载社区详情页 HTML
 */
async function loadCommunityDetail() {
    const containerId = 'community-detail-screen';
    let container = document.getElementById(containerId);

    // 如果容器不存在，则在 index.html 中动态创建一个（或者你可以手动加在 index.html 里）
    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'screen';
        document.querySelector('.phone-screen').appendChild(container);
    }

    try {
        // 1. 获取 HTML 内容
        const response = await fetch('community_detail.html');
        if (!response.ok) throw new Error('无法加载社区页面');
        const html = await response.text();

        // 2. 注入 HTML
        container.innerHTML = html;

        // 3. 跳转页面
        if (typeof switchScreen === 'function') {
            switchScreen(containerId);
        }

        // 4. 清空搜索框
        const communitySearchInput = document.querySelector('#phone-screen .community-search-input-container input');
        if (communitySearchInput) communitySearchInput.value = '';

    } catch (error) {
        console.error('Load Community Detail Error:', error);
        showToast('页面加载失败，请稍后再试');
    }
}

// 导出初始化函数
window.setupCommunityModule = setupCommunityModule;
