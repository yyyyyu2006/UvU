// --- Vibe 逻辑 ---
function initWorkshopVibe() {
    const toggle = document.getElementById('workshop-vibe-toggle');
    const body = document.getElementById('workshop-vibe-body');
    const uploadInput = document.getElementById('workshop-vibe-upload-input');
    const clearBtn = document.getElementById('workshop-vibe-clear-btn');
    const previewContainer = document.getElementById('workshop-vibe-preview-container');
    const previewImg = document.getElementById('workshop-vibe-preview-img');
    const emptyHint = document.getElementById('workshop-vibe-empty-hint');
    const infoSlider = document.getElementById('workshop-vibe-info-slider');
    const infoVal = document.getElementById('workshop-vibe-info-val');
    const refSlider = document.getElementById('workshop-vibe-ref-slider');
    const refVal = document.getElementById('workshop-vibe-ref-val');
    const libraryGrid = document.getElementById('workshop-vibe-library-grid');

    if (!toggle) return;

    // 初始化数据结构
    if (!db.workshopSettings) db.workshopSettings = {};
    if (!db.workshopSettings.vibeLibrary) db.workshopSettings.vibeLibrary = [];
    if (!db.workshopSettings.vibe) {
        db.workshopSettings.vibe = {
            enabled: false,
            activeImageId: null,
            infoExtracted: 1.0,
            refStrength: 0.6
        };
    }

    const vibeData = db.workshopSettings.vibe;
    const settingsOwner = db.workshopSettings;
    const isOwner = () => db.workshopSettings === settingsOwner && settingsOwner.vibe === vibeData;
    const saveVibeField = async (target, key, value) => {
        if (!isOwner()) return false;
        return saveLocalSettingsFields([{target,values:{[key]:value}}]);
    };

    // 渲染 UI
    const renderUI = () => {
        toggle.checked = vibeData.enabled;
        body.style.display = vibeData.enabled ? 'block' : 'none';

        const activeLibItem = (db.workshopSettings.vibeLibrary || []).find(l => l.id === vibeData.activeImageId);

        if (activeLibItem) {
            previewContainer.style.display = 'flex';
            emptyHint.style.display = 'none';
            clearBtn.style.display = 'block';
            
            previewContainer.innerHTML = ''; // 清空容器
            
            if (activeLibItem.type === 'group' && activeLibItem.images) {
                // 渲染预设组 UI
                const groupTitle = document.createElement('div');
                groupTitle.style.fontWeight = 'bold';
                groupTitle.style.fontSize = '14px';
                groupTitle.style.marginBottom = '10px';
                groupTitle.textContent = `预设组: ${activeLibItem.name}`;
                previewContainer.appendChild(groupTitle);
                
                activeLibItem.images.forEach((img, index) => {
                    const imgRow = document.createElement('div');
                    imgRow.style.display = 'flex';
                    imgRow.style.gap = '15px';
                    imgRow.style.alignItems = 'center';
                    imgRow.style.marginBottom = '10px';
                    imgRow.style.paddingBottom = '10px';
                    imgRow.style.borderBottom = index < activeLibItem.images.length - 1 ? '1px dashed #ddd' : 'none';
                    
                    imgRow.innerHTML = `
                        <div style="width: 60px; height: 60px; border-radius: 6px; background-image: url(${img.thumbnail}); background-size: cover; background-position: center; flex-shrink: 0; border: 1px solid #ddd;"></div>
                        <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: #666;">
                                <span style="width: 60px;">信息提取</span>
                                <input type="range" class="group-info-slider" data-index="${index}" min="0" max="1" step="0.05" value="${img.infoExtracted !== undefined ? img.infoExtracted : 1.0}" style="flex: 1;">
                                <span class="group-info-val" style="width: 30px; text-align: right;">${img.infoExtracted !== undefined ? img.infoExtracted : 1.0}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: #666;">
                                <span style="width: 60px;">参考强度</span>
                                <input type="range" class="group-ref-slider" data-index="${index}" min="0" max="1" step="0.05" value="${img.refStrength !== undefined ? img.refStrength : 0.6}" style="flex: 1;">
                                <span class="group-ref-val" style="width: 30px; text-align: right;">${img.refStrength !== undefined ? img.refStrength : 0.6}</span>
                            </div>
                        </div>
                    `;
                    
                    // 绑定组内滑块事件
                    const infoSlider = imgRow.querySelector('.group-info-slider');
                    const infoVal = imgRow.querySelector('.group-info-val');
                    const refSlider = imgRow.querySelector('.group-ref-slider');
                    const refVal = imgRow.querySelector('.group-ref-val');
                    
                    infoSlider.addEventListener('input', (e) => { infoVal.textContent = e.target.value; });
                    infoSlider.addEventListener('change', async (e) => {
                        if (!await saveVibeField(img, 'infoExtracted', parseFloat(e.target.value))) { infoSlider.value = img.infoExtracted; infoVal.textContent = img.infoExtracted; }
                    });
                    
                    refSlider.addEventListener('input', (e) => { refVal.textContent = e.target.value; });
                    refSlider.addEventListener('change', async (e) => {
                        if (!await saveVibeField(img, 'refStrength', parseFloat(e.target.value))) { refSlider.value = img.refStrength; refVal.textContent = img.refStrength; }
                    });
                    
                    previewContainer.appendChild(imgRow);
                });
            } else {
                // 渲染单图 UI
                previewContainer.innerHTML = `
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <div id="workshop-vibe-preview-img" style="width: 80px; height: 80px; border-radius: 6px; background-image: url(${activeLibItem.base64}); background-size: cover; background-position: center; flex-shrink: 0; border: 1px solid #ddd;"></div>
                        <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: #666;">
                                <span style="width: 60px;">信息提取</span>
                                <input type="range" id="workshop-vibe-info-slider" min="0" max="1" step="0.05" value="${vibeData.infoExtracted !== undefined ? vibeData.infoExtracted : 1.0}" style="flex: 1;">
                                <span id="workshop-vibe-info-val" style="width: 30px; text-align: right;">${vibeData.infoExtracted !== undefined ? vibeData.infoExtracted : 1.0}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: #666;">
                                <span style="width: 60px;">参考强度</span>
                                <input type="range" id="workshop-vibe-ref-slider" min="0" max="1" step="0.05" value="${vibeData.refStrength !== undefined ? vibeData.refStrength : 0.6}" style="flex: 1;">
                                <span id="workshop-vibe-ref-val" style="width: 30px; text-align: right;">${vibeData.refStrength !== undefined ? vibeData.refStrength : 0.6}</span>
                            </div>
                        </div>
                    </div>
                `;
                
                // 重新绑定单图滑块事件
                const infoSlider = document.getElementById('workshop-vibe-info-slider');
                const infoVal = document.getElementById('workshop-vibe-info-val');
                const refSlider = document.getElementById('workshop-vibe-ref-slider');
                const refVal = document.getElementById('workshop-vibe-ref-val');
                
                if (infoSlider) {
                    infoSlider.addEventListener('input', (e) => { infoVal.textContent = e.target.value; });
                    infoSlider.addEventListener('change', async (e) => {
                        if (!await saveVibeField(vibeData, 'infoExtracted', parseFloat(e.target.value))) { infoSlider.value = vibeData.infoExtracted; infoVal.textContent = vibeData.infoExtracted; }
                    });
                }
                
                if (refSlider) {
                    refSlider.addEventListener('input', (e) => { refVal.textContent = e.target.value; });
                    refSlider.addEventListener('change', async (e) => {
                        if (!await saveVibeField(vibeData, 'refStrength', parseFloat(e.target.value))) { refSlider.value = vibeData.refStrength; refVal.textContent = vibeData.refStrength; }
                    });
                }
            }
        } else {
            previewContainer.style.display = 'none';
            emptyHint.style.display = 'block';
            clearBtn.style.display = 'none';
        }

        renderLibrary();
    };

    const renderLibrary = () => {
        if (!libraryGrid) return;
        const library = db.workshopSettings.vibeLibrary || [];
        
        if (library.length === 0) {
            libraryGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; color: #999; font-size: 12px; padding: 20px; background: #f9f9f9; border-radius: 8px; border: 1px dashed #ddd;">
                    图库为空，请上传参考图
                </div>
            `;
            return;
        }

        libraryGrid.innerHTML = '';
        library.forEach(item => {
            const div = document.createElement('div');
            div.style.position = 'relative';
            div.style.aspectRatio = '1';
            div.style.borderRadius = '6px';
            div.style.overflow = 'hidden';
            
            const isActive = vibeData.activeImageId === item.id;
            div.style.border = isActive ? '2px solid var(--primary-color)' : '1px solid #eee';
            
            // 封面图：如果是组，取第一张图的缩略图
            let coverUrl = item.base64;
            if (item.type === 'group' && item.images && item.images.length > 0) {
                coverUrl = item.images[0].thumbnail;
            }
            
            div.style.backgroundImage = `url(${coverUrl})`;
            div.style.backgroundSize = 'cover';
            div.style.backgroundPosition = 'center';
            div.style.cursor = 'pointer';
            
            // 如果是组，添加角标
            if (item.type === 'group') {
                const groupBadge = document.createElement('div');
                groupBadge.innerHTML = '组';
                groupBadge.style.position = 'absolute';
                groupBadge.style.top = '2px';
                groupBadge.style.left = '2px';
                groupBadge.style.background = 'rgba(0,0,0,0.6)';
                groupBadge.style.color = 'white';
                groupBadge.style.fontSize = '10px';
                groupBadge.style.padding = '2px 4px';
                groupBadge.style.borderRadius = '4px';
                div.appendChild(groupBadge);
            }
            
            // 删除按钮
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '×';
            delBtn.style.position = 'absolute';
            delBtn.style.top = '2px';
            delBtn.style.right = '2px';
            delBtn.style.background = 'rgba(255,0,0,0.7)';
            delBtn.style.color = 'white';
            delBtn.style.border = 'none';
            delBtn.style.borderRadius = '50%';
            delBtn.style.width = '20px';
            delBtn.style.height = '20px';
            delBtn.style.cursor = 'pointer';
            delBtn.style.display = 'flex';
            delBtn.style.alignItems = 'center';
            delBtn.style.justifyContent = 'center';
            delBtn.style.fontSize = '14px';
            
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('确定要删除这张素材吗？')) {
                    if (!isOwner()) return;
                    const library = settingsOwner.vibeLibrary;
                    const index = library.indexOf(item);
                    if (index < 0) return;
                    const previousActive = vibeData.activeImageId;
                    library.splice(index, 1);
                    if (vibeData.activeImageId === item.id) {
                        vibeData.activeImageId = null;
                    }
                    const appliedActive = vibeData.activeImageId;
                    try { await saveData(); }
                    catch (error) {
                        if (!library.some(entry => entry.id === item.id)) library.splice(Math.min(index, library.length), 0, item);
                        if (vibeData.activeImageId === appliedActive) vibeData.activeImageId = previousActive;
                        showToast('素材未删除，请重试');
                    }
                    if (isOwner()) renderUI();
                }
            });

            // 点击启用
            div.addEventListener('click', async () => {
                if (!isOwner() || !settingsOwner.vibeLibrary.includes(item)) return;
                await saveVibeField(vibeData, 'activeImageId', vibeData.activeImageId === item.id ? null : item.id);
                if (isOwner()) renderUI();
            });

            div.appendChild(delBtn);
            
            if (isActive) {
                const activeBadge = document.createElement('div');
                activeBadge.innerHTML = '✓';
                activeBadge.style.position = 'absolute';
                activeBadge.style.bottom = '2px';
                activeBadge.style.right = '2px';
                activeBadge.style.background = 'var(--primary-color)';
                activeBadge.style.color = 'white';
                activeBadge.style.borderRadius = '50%';
                activeBadge.style.width = '16px';
                activeBadge.style.height = '16px';
                activeBadge.style.display = 'flex';
                activeBadge.style.alignItems = 'center';
                activeBadge.style.justifyContent = 'center';
                activeBadge.style.fontSize = '10px';
                div.appendChild(activeBadge);
            }
            
            libraryGrid.appendChild(div);
        });
    };

    renderUI();

    // 事件绑定
    toggle.onchange = async (e) => {
        await saveVibeField(vibeData, 'enabled', e.target.checked);
        if (isOwner()) renderUI();
    };

    uploadInput.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files || files.length === 0) return;
        const settings = db.workshopSettings;
        const library = settings.vibeLibrary;
        if (settings.vibe !== vibeData) return showToast('素材库已切换，请重新打开');
        const isCurrent = () => db.workshopSettings === settings && settings.vibeLibrary === library && settings.vibe === vibeData;
        const additions = [];

        let addedCount = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                if (file.name.endsWith('.json')) {
                    // 处理 JSON 预设组
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (!isCurrent()) return showToast('素材库已切换，请重新上传');
                    
                    if (data.groups && data.vibeData) {
                        for (const groupName in data.groups) {
                            const group = data.groups[groupName];
                            if (group.vibes && Array.isArray(group.vibes)) {
                                const groupImages = [];
                                for (const vibe of group.vibes) {
                                    const vData = data.vibeData[vibe.vibeDataId];
                                    if (vData && vData.encodings && vData.encodings['v4-5full']) {
                                        const encodingData = Object.values(vData.encodings['v4-5full'])[0];
                                        if (encodingData && encodingData.encoding) {
                                            groupImages.push({
                                                vibeDataId: vibe.vibeDataId,
                                                encoding: encodingData.encoding,
                                                thumbnail: vData.thumbnail || '',
                                                infoExtracted: encodingData.params ? encodingData.params.information_extracted : 1.0,
                                                refStrength: vibe.strength !== undefined ? vibe.strength : 0.6
                                            });
                                        }
                                    }
                                }
                                
                                if (groupImages.length > 0) {
                                    additions.push({
                                        id: 'vibe_group_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 5),
                                        type: 'group',
                                        name: groupName,
                                        images: groupImages
                                    });
                                    addedCount++;
                                }
                            }
                        }
                    } else {
                        showToast('无效的 Vibe JSON 格式');
                    }
                } else {
                    // 处理普通图片
                    const base64 = await compressImage(file, 800, 0.8);
                    if (!isCurrent()) return showToast('素材库已切换，请重新上传');
                    additions.push({
                        id: 'vibe_lib_' + Date.now() + '_' + i,
                        type: 'single',
                        name: file.name || '未命名素材',
                        base64: base64
                    });
                    addedCount++;
                }
            } catch (err) {
                console.error('Vibe upload error:', err);
                showToast('上传失败: ' + err.message);
            }
        }
        
        if (addedCount > 0) {
            if (!isCurrent()) return showToast('素材库已切换，请重新上传');
            library.push(...additions);
            try {
                await saveData();
                if (isCurrent()) { renderUI(); showToast(`成功导入 ${addedCount} 个素材/预设组`); }
            } catch (error) {
                for (const addition of additions) {
                    const index = library.indexOf(addition);
                    if (index >= 0) library.splice(index, 1);
                }
                console.error('保存Vibe素材失败:', error);
                showToast('素材未保存，请重试');
            }
        }
        uploadInput.value = '';
    };

    clearBtn.onclick = async () => {
        await saveVibeField(vibeData, 'activeImageId', null);
        if (isOwner()) renderUI();
    };
}
