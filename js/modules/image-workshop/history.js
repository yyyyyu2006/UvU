// --- 历史记录管理 ---
async function saveToHistory(base64Image, payload) {
    if (!dexieDB) throw new Error('图片缓存尚未就绪，请稍后重试');
    
    const historyItem = {
        timestamp: Date.now(),
        image: base64Image,
        prompt: payload.input || payload.prompt || '',
        negativePrompt: payload.parameters?.negative_prompt || payload.negative_prompt || '',
        parameters: Object.fromEntries(Object.entries({ ...payload.parameters, model: payload.model, size: payload.size,
            quality: payload.quality, style: payload.style }).filter(([key, value]) => value !== undefined &&
                ['model', 'size', 'quality', 'style', 'width', 'height', 'seed', 'steps', 'scale', 'sampler'].includes(key)))
    };
    
    try {
        await dexieDB.workshopHistory.add(historyItem);
        // 重新加载历史记录 UI
        await loadWorkshopHistory();
        return true;
    } catch (error) {
        console.error('Save history error:', error);
        throw error;
    }
}

function workshopDraftFromHistory(item, settings) {
    const p = item?.parameters || {}, provider = settings?.provider || 'novelai';
    const model = typeof p.model === 'string' && p.model.length <= 180 && /^[\w.\-:/]+$/.test(p.model) ? p.model : '';
    if (!model || typeof item.prompt !== 'string' || !item.prompt.trim()) return null;
    const native = Number.isInteger(p.width) && Number.isInteger(p.height) && [p.width, p.height].every(v => v >= 64 && v <= 4096);
    const preset = settings?.apiPresets?.[provider]?.find(row => row.id === settings?.activeApiPresetId?.[provider]);
    if (native && provider === 'novelai' && preset?.protocol !== 'openai') return { provider, model, width: p.width, height: p.height,
        seed: Number.isInteger(p.seed) && p.seed >= 0 && p.seed <= 4294967295 ? p.seed : undefined,
        negative: String(item.negativePrompt || '').slice(0, 16000) };
    if (!native && typeof p.size === 'string' && /^(?:auto|[1-4]\d{2,3}x[1-4]\d{2,3})$/.test(p.size)) {
        const isNovel = /novelai|nai[-_.]|diffusion/i.test(model);
        if (provider === 'gpt' && !isNovel || provider === 'novelai' && isNovel && preset?.protocol === 'openai') return { provider, model, size: p.size,
            quality: ['standard', 'hd', 'auto', 'low', 'medium', 'high'].includes(p.quality) ? p.quality : undefined,
            style: ['natural', 'vivid'].includes(p.style) ? p.style : undefined };
    }
    return null;
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
                renderPreviewImage(item.image, { input: item.prompt || '', parameters: { ...(item.parameters || {}), negative_prompt: item.negativePrompt || '' } });
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
