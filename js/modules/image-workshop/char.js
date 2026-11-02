// --- 角色管理逻辑 ---
function initWorkshopCharManagement() {
    const addCharBtn = document.getElementById('workshop-add-char-btn');
    const charListContainer = document.getElementById('workshop-char-list');
    const addCharModal = document.getElementById('workshop-add-char-modal');
    const charSelectionList = document.getElementById('workshop-char-selection-list');
    const confirmAddBtn = document.getElementById('workshop-confirm-add-char-btn');
    const cancelAddBtn = document.getElementById('workshop-cancel-add-char-btn');

    if (!addCharBtn || !charListContainer || !addCharModal) return;

    // 初始化数据结构
    if (!db.workshopSettings) db.workshopSettings = {};
    if (!db.workshopSettings.boundCharacters) db.workshopSettings.boundCharacters = [];

    // 渲染已绑定的角色列表
    const renderBoundChars = () => {
        charListContainer.innerHTML = '';
        const boundChars = db.workshopSettings.boundCharacters;

        if (boundChars.length === 0) {
            charListContainer.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">暂无角色，点击右上角添加</div>';
            return;
        }

        boundChars.forEach((boundChar, index) => {
            const char = db.characters.find(c => c.id === boundChar.charId);
            if (!char) return; // 角色可能已被删除

            const itemDiv = document.createElement('div');
            itemDiv.style.border = '1px solid #eee';
            itemDiv.style.borderRadius = '8px';
            itemDiv.style.padding = '12px';
            itemDiv.style.background = '#fff';
            itemDiv.style.position = 'relative';

            itemDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <img src="${char.avatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                    <div style="flex: 1;">
                        <div style="font-weight: bold; font-size: 14px;">${char.remarkName || char.name || '未知角色'}</div>
                        <div style="font-size: 12px; color: #666;">变量: <code>{{${char.realName}}}</code></div>
                    </div>
                    <button class="icon-btn-simple danger remove-char-btn" title="移除" style="padding: 4px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                </div>
                <textarea class="char-prompt-input" rows="3" style="width: 100%; border: 1px solid #ddd; border-radius: 6px; padding: 8px; font-size: 12px;" placeholder="输入该角色的专属跑图词...">${boundChar.prompt || ''}</textarea>
            `;

            // 绑定事件
            const removeBtn = itemDiv.querySelector('.remove-char-btn');
            const promptInput = itemDiv.querySelector('.char-prompt-input');

            removeBtn.addEventListener('click', async () => {
                if (confirm(`确定要从工坊移除角色 ${char.remarkName || char.name || '未知角色'} 吗？`)) {
                    db.workshopSettings.boundCharacters.splice(index, 1);
                    await saveData();
                    renderBoundChars();
                }
            });

            promptInput.addEventListener('change', async (e) => {
                boundChar.prompt = e.target.value.trim();
                await saveData();
            });

            charListContainer.appendChild(itemDiv);
        });
    };

    renderBoundChars();

    // 打开添加角色模态框
    addCharBtn.addEventListener('click', () => {
        charSelectionList.innerHTML = '';
        const boundCharIds = db.workshopSettings.boundCharacters.map(bc => bc.charId);
        
        // 过滤出尚未绑定的角色
        const availableChars = db.characters.filter(c => !boundCharIds.includes(c.id));

        if (availableChars.length === 0) {
            charSelectionList.innerHTML = '<li style="text-align: center; color: #999; padding: 20px;">没有可添加的角色了</li>';
        } else {
            availableChars.forEach(char => {
                const li = document.createElement('li');
                li.className = 'list-item';
                li.innerHTML = `
                    <label style="display: flex; align-items: center; width: 100%; cursor: pointer; gap: 10px;">
                        <input type="checkbox" value="${char.id}" class="char-select-checkbox">
                        <img src="${char.avatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold;">${char.remarkName || char.name || '未知角色'}</div>
                            <div style="font-size: 12px; color: #666;">${char.realName}</div>
                        </div>
                    </label>
                `;
                charSelectionList.appendChild(li);
            });
        }

        addCharModal.classList.add('visible');
    });

    // 确认添加角色
    confirmAddBtn.addEventListener('click', async () => {
        const checkboxes = charSelectionList.querySelectorAll('.char-select-checkbox:checked');
        let added = false;

        checkboxes.forEach(cb => {
            db.workshopSettings.boundCharacters.push({
                charId: cb.value,
                prompt: ''
            });
            added = true;
        });

        if (added) {
            await saveData();
            renderBoundChars();
        }
        addCharModal.classList.remove('visible');
    });

    // 取消添加
    cancelAddBtn.addEventListener('click', () => {
        addCharModal.classList.remove('visible');
    });
}
