// Search UI only: the original select remains the source used by API saving.
function setupSearchableModelPickers() {
    for (const id of ['api-model', 'secondary-api-model']) {
        const select = document.getElementById(id);
        if (!select || document.getElementById(id + '-picker')) continue;
        const trigger = document.createElement('button');
        trigger.type = 'button'; trigger.id = id + '-picker'; trigger.className = 'model-picker-trigger';
        trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', id === 'api-model' ? '选择对话模型' : '选择副 API 模型');
        select.hidden = true; select.classList.add('model-picker-source'); select.parentElement.classList.add('model-picker-control'); select.after(trigger);
        let overlay = null, render = null;
        const sync = () => {
            trigger.textContent = select.selectedOptions[0]?.textContent || '请先拉取模型';
            trigger.title = trigger.textContent; trigger.disabled = select.disabled;
            if (overlay) render();
        };
        select.addEventListener('change', sync);
        new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'value'] });
        trigger.addEventListener('click', () => {
            if (overlay) return;
            overlay = document.createElement('div'); overlay.className = 'feature-dialog model-picker-overlay';
            overlay.innerHTML = '<section class="feature-dialog-card model-picker-card" role="dialog" aria-modal="true" aria-label="选择模型"><header><strong>选择模型</strong><button type="button" data-action="close" aria-label="关闭模型选择">关闭</button></header><input type="search" class="model-picker-search" placeholder="搜索模型名称" aria-label="搜索模型名称" autocomplete="off"><p class="model-picker-count" aria-live="polite"></p><div class="model-picker-list" role="listbox" aria-label="模型列表"></div></section>';
            const search = overlay.querySelector('input'), list = overlay.querySelector('.model-picker-list'), count = overlay.querySelector('.model-picker-count');
            let activeValue = null, previousQuery = '';
            const close = () => { overlay?.remove(); overlay = null; render = null; trigger.setAttribute('aria-expanded', 'false'); trigger.focus({ preventScroll: true }); };
            render = () => {
                const query = search.value.trim().toLocaleLowerCase();
                const scroll = query === previousQuery ? list.scrollTop : 0;
                previousQuery = query;
                const available = [...select.options].filter(option => option.value && !option.disabled);
                const filtered = available.filter(option => (option.textContent + ' ' + option.value).toLocaleLowerCase().includes(query));
                count.textContent = filtered.length + ' / ' + available.length + ' 个模型';
                const fragment = document.createDocumentFragment();
                for (const option of filtered) {
                    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option');
                    button.setAttribute('aria-selected', String(option.selected)); button.textContent = option.textContent;
                    button.dataset.value = option.value; button.tabIndex = -1;
                    button.addEventListener('focus', () => {
                        activeValue = option.value;
                        for (const sibling of list.querySelectorAll('[role=option]')) sibling.tabIndex = sibling === button ? 0 : -1;
                    });
                    button.addEventListener('click', () => {
                        if (!option.isConnected || option.parentElement !== select || option.disabled || select.disabled) return;
                        const changed = select.value !== option.value; select.value = option.value;
                        if (changed) { select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }
                        sync(); close();
                    }); fragment.append(button);
                }
                if (!filtered.length) { const empty = document.createElement('p'); empty.textContent = available.length ? '没有匹配的模型' : '请先拉取模型列表'; fragment.append(empty); }
                const focused = list.contains(document.activeElement);
                list.replaceChildren(fragment); list.scrollTop = scroll;
                const buttons = [...list.querySelectorAll('[role=option]')];
                const current = buttons.find(button => button.dataset.value === activeValue) || buttons.find(button => button.getAttribute('aria-selected') === 'true') || buttons[0];
                if (current) { current.tabIndex = 0; if (focused) current.focus({ preventScroll: true }); }
            };
            overlay.querySelector('[data-action=close]').addEventListener('click', close);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
            overlay.addEventListener('keydown', event => {
                if (event.isComposing) return;
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
                const buttons = [...list.querySelectorAll('[role=option]')];
                if (!buttons.length || !(event.target === search || list.contains(event.target))) return;
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) return;
                // Home/End retain their normal text-editing behavior inside search.
                if (event.target === search && ['Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = buttons.indexOf(document.activeElement);
                if (event.key === 'Enter') { (index >= 0 ? buttons[index] : buttons[0]).click(); return; }
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
                    index < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0) : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
                buttons[next].focus({ preventScroll: true }); buttons[next].scrollIntoView({ block: 'nearest' });
            });
            search.addEventListener('input', () => render());
            document.body.append(overlay); trigger.setAttribute('aria-expanded', 'true'); render(); search.focus({ preventScroll: true });
        }); sync();
    }
}
