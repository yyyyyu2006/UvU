
function openStickerSemanticLibrary() {
    if (document.getElementById('sticker-semantic-library')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'sticker-semantic-library';
    dialog.setAttribute('aria-labelledby', 'sticker-semantic-title');
    dialog.innerHTML = '<header><h2 id="sticker-semantic-title">表情包知识库</h2><button type="button" data-close aria-label="关闭">×</button></header>' +
        '<div class="sticker-semantic-body"><section class="sticker-semantic-card" aria-label="批量识图">' +
        '<strong data-counts></strong><p data-provider></p><div class="sticker-semantic-actions">' +
        '<button type="button" data-run>开始识图</button><button type="button" data-retry>重试失败</button><button type="button" data-stop disabled>暂停</button></div>' +
        '<progress data-progress max="1" value="0" aria-label="批量识图进度" hidden></progress><p role="status" data-status></p>' +
        '<details><summary>使用说明</summary><p>点击开始后，图片会发给 API 设置中「图片识别」所用的服务，可能产生费用。只发送表情图片，动态图片只看静态预览帧。暂停或关闭会停止未完成的识别，重新开始会跳过已保存的图片。表情画面和图中文字分开保存。</p></details></section>' +
        '<section class="sticker-semantic-card" aria-label="核对表情">' +
        '<div class="sticker-semantic-filters"><label>搜索<input type="search" data-search placeholder="按名称或分组"></label>' +
        '<label>状态<select data-filter><option value="all">全部</option><option value="review">待核对</option><option value="confirmed">已确认</option><option value="failed">识图失败</option><option value="pending">未识图</option></select></label></div>' +
        '<label>表情包<select data-pick></select></label><p data-record></p><form data-editor hidden>' +
        '<img data-picture alt=""><div data-fields></div><button type="submit">确认并保存</button></form></section></div>';
    const find = selector => dialog.querySelector(selector);
    const editor = find('[data-editor]'), status = find('[data-status]'), picker = find('[data-pick]');
    const fields = [
        ['scene', '画面'], ['gestures', '动作和神态'], ['emotion', '情绪'], ['intent', '可能的表达意图'],
        ['suitable', '适用场景（每行一条）'], ['unsuitable', '不适用场景（每行一条）'], ['ambiguity', '其他可能解释'], ['ocr', '图中文字（单独记录）']
    ];
    for (const [key, title] of fields) {
        const label = document.createElement('label'), input = document.createElement('textarea');
        input.name = key;
        input.rows = 2;
        input.maxLength = STICKER_SEMANTIC_FIELDS[key] || 245;
        input.required = key === 'scene';
        label.append(title, input);
        find('[data-fields]').append(label);
    }
    const confidence = document.createElement('label');
    confidence.innerHTML = '<span>识别把握</span><select name="confidence"><option value="high">较高</option><option value="medium">一般</option><option value="low">较低</option></select>';
    find('[data-fields]').append(confidence);
    let running = null, current = null, renderedProfile = null, dirty = false, saving = false;
    let choices = [];
    const state = sticker => getStickerSemanticProfile(sticker)?.status || (getStickerSemanticFailure(sticker) ? 'failed' : 'pending');
    const stateNames = { review: '待核对', confirmed: '已确认', failed: '失败', pending: '未识图' };
    const config = () => resolveAuxiliaryApiConfig('imageRecognition');
    function load(sticker, profile = getStickerSemanticProfile(sticker)) {
        current = sticker;
        renderedProfile = profile;
        dirty = false;
        editor.hidden = !profile;
        const failure = getStickerSemanticFailure(sticker);
        find('[data-record]').textContent = !sticker ? '没有符合条件的表情包' :
            failure ? failure.issue : !profile ? '尚无识图档案' :
                stateNames[profile.status] + ' · ' + profile.model + (profile.frame === 'first-frame' ? ' · 静态预览帧' : '');
        if (!profile) {
            find('[data-picture]').removeAttribute('src');
            return;
        }
        find('[data-picture]').src = sticker.data;
        for (const [key] of fields) editor.elements[key].value = Array.isArray(profile[key]) ? profile[key].join('\n') : profile[key];
        editor.elements.confidence.value = profile.confidence;
    }
    function refresh() {
        const items = db.myStickers.filter(sticker => validStickerImage(sticker.data));
        const counts = { review: 0, confirmed: 0, failed: 0, pending: 0 };
        items.forEach(sticker => counts[state(sticker)]++);
        find('[data-counts]').textContent = items.length + ' 张 · ' + Object.keys(counts).map(key => counts[key] + ' ' + stateNames[key]).join(' · ');
        const route = config();
        let host = '';
        try { host = new URL(route.url).host; } catch (_) { /* Not configured. */ }
        find('[data-provider]').textContent = route.model && route.key && host ? '图片识别：' + route.model + ' · ' + host : '请先在 API 设置中配置图片识别模型。';
        find('[data-run]').disabled = !!running || !!activeStickerSemanticBatch || !counts.pending || !route.model || !route.key || !host;
        find('[data-retry]').disabled = !!running || !!activeStickerSemanticBatch || !counts.failed || !route.model || !route.key || !host;
        find('[data-stop]').disabled = !running || running.signal.aborted;
        const search = find('[data-search]').value.trim().toLowerCase(), filter = find('[data-filter]').value;
        choices = items.filter(sticker => (filter === 'all' || state(sticker) === filter) &&
            (String(sticker.name || '') + ' ' + String(sticker.group || '')).toLowerCase().includes(search));
        if ((dirty || saving) && current && !choices.includes(current)) choices.unshift(current);
        const selected = choices.includes(current) ? current : choices[0];
        picker.replaceChildren(...choices.map((sticker, i) => new Option((sticker.name || '未命名表情') + ' · ' + stateNames[state(sticker)], String(i))));
        picker.disabled = !choices.length;
        if (selected) picker.value = String(choices.indexOf(selected));
        if (!(dirty || saving) && (selected !== current || getStickerSemanticProfile(selected) !== renderedProfile || !renderedProfile)) load(selected);
    }
    const canLeave = () => !dirty || confirm('放弃这张表情尚未保存的修改？');
    find('[data-search]').oninput = refresh;
    find('[data-filter]').onchange = refresh;
    picker.onchange = () => {
        if (saving || !canLeave()) { picker.value = String(choices.indexOf(current)); return; }
        load(choices[Number(picker.value)]);
    };
    editor.oninput = () => { dirty = true; };
    editor.onsubmit = async event => {
        event.preventDefault();
        if (saving || !current) return;
        const values = Object.fromEntries(new FormData(editor));
        for (const key of ['suitable', 'unsuitable']) values[key] = values[key].split(/\r?\n/);
        const inputs = [...editor.elements];
        saving = true;
        inputs.forEach(input => { input.disabled = true; });
        try {
            await saveStickerSemanticCorrection(current, renderedProfile, values);
            dirty = false;
            status.textContent = '已保存人工确认的档案。';
        } catch (error) { status.textContent = '保存失败：' + error.message; }
        finally {
            saving = false;
            inputs.forEach(input => { input.disabled = false; });
            refresh();
        }
    };
    async function run(retryOnly) {
        if (running || activeStickerSemanticBatch) return;
        const route = config(), button = find(retryOnly ? '[data-retry]' : '[data-run]');
        if (button.disabled) return;
        const confirmation = (retryOnly ? '重试失败项' : '扫描所有尚未识别的表情包') + '？图片将发往当前配置的图片识别服务，可能产生费用。';
        if (!confirm(confirmation)) return;
        running = new AbortController();
        const progress = find('[data-progress]');
        progress.hidden = false;
        refresh();
        try {
            const result = await runStickerSemanticBatch({ config: route, retryOnly, signal: running.signal, onProgress: info => {
                progress.max = Math.max(1, info.total);
                progress.value = info.completed + info.failed + info.paused + info.skipped;
                status.textContent = progress.value + ' / ' + info.total + ' · 成功 ' + info.completed + ' · 失败 ' + info.failed + ' · 暂停 ' + info.paused;
            } });
            status.textContent = (result.stopped ? '已暂停。' : '扫描结束。') + '成功 ' + result.completed + '，失败 ' + result.failed + '，暂停 ' + result.paused + '，跳过 ' + result.skipped +
                (result.reused ? '，其中 ' + result.reused + ' 张复用同图结果' : '') + '。';
        } catch (error) { status.textContent = error.message; }
        finally { running = null; if (dialog.isConnected) refresh(); }
    }
    find('[data-run]').onclick = () => run(false);
    find('[data-retry]').onclick = () => run(true);
    find('[data-stop]').onclick = () => { running?.abort(); find('[data-stop]').disabled = true; status.textContent = '正在暂停…'; };
    function close(event) {
        if (saving || !canLeave()) { event?.preventDefault(); return; }
        running?.abort();
        dialog.close();
    }
    find('[data-close]').onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(event); });
    dialog.addEventListener('close', () => { running?.abort(); dialog.remove(); });
    document.body.append(dialog);
    refresh();
    dialog.showModal();
}
