// --- 历史记录管理 ---
async function saveToHistory(base64Image, payload) {
    if (!dexieDB) return;
    
    const historyItem = {
        timestamp: Date.now(),
        image: base64Image,
        prompt: payload.input,
        negativePrompt: payload.parameters.negative_prompt,
        parameters: payload.parameters
    };
    
    try {
        await dexieDB.workshopHistory.add(historyItem);
        // 重新加载历史记录 UI
        loadWorkshopHistory();
    } catch (error) {
        console.error('Save history error:', error);
    }
}

async function loadWorkshopHistory() {
    if (!dexieDB) return;
    
    const gallery = document.getElementById('workshop-history-gallery');
    if (!gallery) return;
    
    try {
        // 获取最近的 6 条记录
        const history = await dexieDB.workshopHistory.orderBy('timestamp').reverse().limit(6).toArray();
        
        gallery.innerHTML = '';
        
        if (history.length === 0) {
            gallery.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #999; padding: 20px;">暂无历史记录</div>';
            return;
        }
        
        history.forEach(item => {
            const div = document.createElement('div');
            div.style.aspectRatio = '1';
            div.style.backgroundColor = '#f0f0f0';
            div.style.borderRadius = '6px';
            div.style.overflow = 'hidden';
            div.style.cursor = 'pointer';
            
            let bgUrl = '';
            if (item.image.startsWith('http') || item.image.startsWith('data:')) {
                bgUrl = item.image;
            } else {
                bgUrl = `data:image/png;base64,${item.image}`;
            }
            
            div.style.backgroundImage = `url(${bgUrl})`;
            div.style.backgroundSize = 'cover';
            div.style.backgroundPosition = 'center';
            
            div.addEventListener('click', () => {
                // 点击查看大图或复用参数逻辑
                renderPreviewImage(item.image);
                // 可以选择是否自动填充提示词
                // document.getElementById('workshop-positive-prompt').value = item.prompt;
                // document.getElementById('workshop-negative-prompt').value = item.negativePrompt;
            });
            
            gallery.appendChild(div);
        });
    } catch (error) {
        console.error('Load history error:', error);
    }
}
