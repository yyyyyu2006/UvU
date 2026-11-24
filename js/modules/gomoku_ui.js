(function (root) {
    'use strict';

    const screen = document.getElementById('uvu-gomoku-screen');
    const logic = root.UVUGomokuLogic;
    const characterApi = root.UVUGomokuCharacter;
    if (!screen || !logic || !characterApi) return;

    const find = selector => screen.querySelector(selector);
    const board = find('[data-gm-board]');
    const setup = find('.gm-setup');
    const gamePanel = find('[data-gm-game]');
    const message = find('[data-gm-message]');
    const roleSelect = find('[data-gm-character]');
    const startButton = find('[data-gm-start]');
    const freshButton = find('[data-gm-fresh]');
    const cells = [];
    const storePrefix = 'uvu.gomoku.session.v1:';
    let state = logic.createGame();
    let mode = 'local';
    let difficulty = 'normal';
    let humanColor = 'black';
    let character = null;
    let sessionKey = null;
    let request = null;
    let requestSequence = 0;
    let focusIndex = 112;

    function notify(text) {
        if (typeof root.showToast === 'function') root.showToast(text);
        else message.textContent = text;
    }

    function currentCharacters() { return Array.isArray(root.db?.characters) ? root.db.characters : []; }

    function fillCharacters() {
        const previous = roleSelect.value;
        const fragment = document.createDocumentFragment();
        fragment.append(new Option('请选择角色', ''));
        for (const item of currentCharacters()) {
            const option = new Option(item.remarkName || item.realName || item.name || '未命名角色', String(item.id));
            fragment.append(option);
        }
        roleSelect.replaceChildren(fragment);
        if ([...roleSelect.options].some(option => option.value === previous)) roleSelect.value = previous;
    }

    function selectedMode() { return screen.querySelector('input[name="gm-mode"]:checked')?.value || 'local'; }
    function selectedCharacter() { return currentCharacters().find(item => String(item.id) === roleSelect.value) || null; }
    function updateStartButtons() {
        const selected = selectedMode();
        const id = selectedCharacter()?.id;
        const ready = selected === 'local' || id != null;
        const saved = ready && readSave(saveKey(selected, id));
        const hasSavedGame = Boolean(saved?.state?.moves?.length);
        startButton.disabled = !ready;
        startButton.textContent = hasSavedGame ? '继续上局' : '开始对局';
        freshButton.hidden = !hasSavedGame;
    }

    function updateSetup() {
        mode = selectedMode();
        const charMode = mode === 'character';
        if (charMode) fillCharacters();
        find('.gm-character-field').hidden = !charMode;
        find('[data-gm-api-note]').hidden = !charMode;
        find('[data-gm-difficulty]').closest('label').hidden = charMode;
        updateStartButtons();
    }

    function saveKey(selectedModeValue, charId) {
        return `${storePrefix}${selectedModeValue}:${selectedModeValue === 'local' ? 'local' : encodeURIComponent(String(charId))}`;
    }

    function readSave(key) {
        try {
            const raw = root.localStorage.getItem(key);
            if (!raw) return null;
            const saved = JSON.parse(raw);
            if (saved?.version !== 1 || !Array.isArray(saved.moves) || saved.moves.length > 225 || !['black', 'white'].includes(saved.humanColor)) return null;
            const restored = logic.createGame(15);
            for (const move of saved.moves) {
                if (move?.color !== restored.turn) return null;
                const result = logic.playMove(restored, move.color, move.row, move.col);
                if (!result.ok) return null;
                if (typeof move.say === 'string') restored.moves.at(-1).say = move.say.slice(0, 60);
                if (restored.status !== 'playing' && saved.moves.length !== restored.moves.length) return null;
            }
            return { state: restored, saved };
        } catch (_) { return null; }
    }

    function persist() {
        if (!sessionKey) return;
        try {
            root.localStorage.setItem(sessionKey, JSON.stringify({
                version: 1,
                mode,
                charId: character?.id || null,
                humanColor,
                difficulty,
                moves: state.moves.map(move => ({ color: move.color, row: move.row, col: move.col, ...(move.say ? { say: move.say } : {}) }))
            }));
        } catch (_) { message.textContent = '棋局已在本页运行，但设备存储不可用，刷新后可能无法继续。'; }
    }

    function makeBoard() {
        const rows = document.createDocumentFragment();
        for (let row = 0; row < 15; row++) {
            const rowNode = document.createElement('div');
            rowNode.className = 'gm-row';
            rowNode.setAttribute('role', 'row');
            for (let col = 0; col < 15; col++) {
                const index = row * 15 + col;
                const wrap = document.createElement('div');
                wrap.className = 'gm-cell-wrap';
                wrap.setAttribute('role', 'gridcell');
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'gm-cell';
                button.dataset.gmCell = String(index);
                button.tabIndex = index === focusIndex ? 0 : -1;
                wrap.append(button);
                rowNode.append(wrap);
                cells.push(button);
            }
            rows.append(rowNode);
        }
        board.replaceChildren(rows);
    }

    function turnName(color) { return color === 'black' ? '黑棋' : '白棋'; }

    function render(messageText) {
        const ended = state.status !== 'playing';
        for (let index = 0; index < cells.length; index++) {
            const button = cells[index];
            const stone = state.board[index];
            const move = state.moves.find(item => item.row * state.size + item.col === index);
            button.dataset.stone = stone || '';
            button.dataset.lastMove = String(state.lastMove?.row * state.size + state.lastMove?.col === index);
            button.dataset.winning = String(state.winningLine.some(([row, col]) => row * state.size + col === index));
            button.tabIndex = index === focusIndex ? 0 : -1;
            button.setAttribute('aria-disabled', String(ended || Boolean(request) || state.turn !== humanColor || Boolean(stone)));
            button.setAttribute('aria-label', `第${Math.floor(index / state.size) + 1}行第${index % state.size + 1}列，${stone ? turnName(stone) : '空位'}${state.lastMove?.row * state.size + state.lastMove?.col === index ? '，最近落子' : ''}`);
            if (move?.color) button.dataset.ply = String(move.ply);
            else delete button.dataset.ply;
        }
        find('[data-gm-opponent]').textContent = mode === 'character' ? (character?.remarkName || character?.realName || '角色') : `本地 AI · ${difficulty === 'beginner' ? '简单' : difficulty === 'expert' ? '困难' : '普通'}`;
        find('[data-gm-count]').textContent = `${state.moves.length} 手`;
        const turnText = state.status === 'won' ? `${turnName(state.winner)}获胜` : state.status === 'draw' ? '平局' : request ? `${turnName(state.turn)}思考中…` : `${turnName(state.turn)}落子`;
        find('[data-gm-turn]').textContent = turnText;
        if (messageText) message.textContent = messageText;
        else if (state.status === 'won') message.textContent = `${turnName(state.winner)}连成五子或更多，获胜！`;
        else if (state.status === 'draw') message.textContent = '棋盘已满，本局平局。';
        else if (!request && state.turn === humanColor) message.textContent = '选择棋盘交叉点落子';
        else if (!request && mode === 'character') message.textContent = '角色还未落子，可以重试或返回设置。';
        else if (!request) message.textContent = '本地 AI 正在落子';

        const latestSay = state.moves[state.moves.length - (state.lastMove?.color === humanColor ? 2 : 1)]?.say;
        const line = find('[data-gm-line]');
        line.hidden = !latestSay;
        line.textContent = latestSay ? `“${latestSay}”` : '';
        find('[data-gm-undo]').disabled = !state.moves.some(move => move.color === humanColor);
        find('[data-gm-retry]').hidden = mode !== 'character' || request !== null || state.status !== 'playing' || state.turn === humanColor;
        find('[data-gm-cancel]').hidden = request === null;

        const log = find('[data-gm-log]');
        const entries = state.moves.slice(-30).map(move => {
            const item = document.createElement('li');
            item.textContent = `${turnName(move.color)} ${String.fromCharCode(65 + move.col)}${15 - move.row}${move.say ? ` · ${move.say}` : ''}`;
            return item;
        });
        log.replaceChildren(...entries);
    }

    function start(fresh = false) {
        mode = selectedMode();
        difficulty = find('[data-gm-difficulty]').value;
        humanColor = find('[data-gm-color]').value;
        character = mode === 'character' ? selectedCharacter() : null;
        if (mode === 'character' && !character) return notify('先选择要对弈的角色。');
        sessionKey = saveKey(mode, character?.id);
        if (mode === 'character') {
            try { characterApi.resolveApiConfig(character, root.db); }
            catch (error) { return notify(error.message); }
        }
        const loaded = !fresh && readSave(sessionKey);
        if (loaded) {
            state = loaded.state;
            humanColor = loaded.saved.humanColor;
            if (['beginner', 'normal', 'expert'].includes(loaded.saved.difficulty)) difficulty = loaded.saved.difficulty;
            find('[data-gm-color]').value = humanColor;
            find('[data-gm-difficulty]').value = difficulty;
        } else {
            state = logic.createGame();
            persist();
        }
        focusIndex = state.lastMove ? state.lastMove.row * 15 + state.lastMove.col : 112;
        setup.hidden = true;
        gamePanel.hidden = false;
        render(loaded ? '已恢复上一局棋盘。' : '选择棋盘交叉点落子');
        cells[focusIndex].focus({ preventScroll: true });
        if (state.status === 'playing' && state.turn !== humanColor) takeOpponentTurn();
    }

    function playHuman(row, col) {
        if (request || state.status !== 'playing' || state.turn !== humanColor) return;
        const result = logic.playMove(state, humanColor, row, col);
        if (!result.ok) return;
        focusIndex = row * state.size + col;
        persist();
        render();
        if (state.status === 'playing') takeOpponentTurn();
    }

    async function takeOpponentTurn() {
        if (state.status !== 'playing' || state.turn === humanColor || request) return;
        if (mode === 'local') {
            const move = logic.chooseAiMove(state, state.turn, difficulty);
            if (!move) return;
            const result = logic.playMove(state, state.turn, move.row, move.col);
            if (result.ok) { persist(); render(); }
            return;
        }
        const owner = state;
        const charId = String(character.id);
        const sequence = ++requestSequence;
        const controller = new AbortController();
        const requestState = { sequence, controller, owner, charId };
        request = requestState;
        render('角色正在选择落点…');
        requestState.timeout = setTimeout(() => {
            if (request === requestState) cancelRequest('角色思考超时。可以重试，或改用本地 AI。');
        }, 30000);
        try {
            const candidates = logic.getCandidateMoves(owner, owner.turn, 18);
            const move = await characterApi.requestMove({ character, appDb: root.db, state: owner, candidates, signal: controller.signal });
            if (request !== requestState || sequence !== requestSequence || state !== owner || String(character?.id) !== charId) return;
            const result = logic.playMove(owner, owner.turn, move.row, move.col);
            if (!result.ok) throw new Error('角色落点未通过本地规则校验。');
            if (move.say) owner.moves.at(-1).say = move.say;
            persist();
            request = null;
            render();
        } catch (error) {
            if (request !== requestState) return;
            request = null;
            const text = controller.signal.aborted
                ? '角色请求已停止或超时。可以重试，也可以重新开始后改用本地 AI。'
                : `${error.message} 可重试，或重新开始后改用本地 AI。`;
            render(text);
        } finally { clearTimeout(requestState.timeout); }
    }

    function cancelRequest(text = '角色思考已停止；可以重新请求这一步。') {
        if (!request) return;
        const active = request;
        request = null;
        requestSequence++;
        clearTimeout(active.timeout);
        active.controller.abort();
        render(text);
    }

    function undo() {
        // Roll back to the last decision the player can actually redo.
        const lastHuman = state.moves.length - (state.lastMove?.color === humanColor ? 1 : 2);
        if (lastHuman < 0) return;
        if (request) cancelRequest('已停止角色请求。');
        const count = logic.undoMoves(state, state.moves.length - lastHuman);
        if (!count) return;
        persist();
        focusIndex = state.lastMove ? state.lastMove.row * state.size + state.lastMove.col : 112;
        render(`已悔棋 ${count} 手。`);
        cells[focusIndex]?.focus();
        if (state.status === 'playing' && state.turn !== humanColor) takeOpponentTurn();
    }

    function reset() {
        cancelRequest('已取消角色思考。');
        state = logic.createGame();
        persist();
        focusIndex = 112;
        render('新棋局开始，黑棋先行。');
        if (state.turn !== humanColor) takeOpponentTurn();
    }

    function changeSettings() {
        cancelRequest('已停止角色请求；当前棋局已保存。');
        gamePanel.hidden = true;
        setup.hidden = false;
        fillCharacters();
        updateSetup();
        find('[data-gm-start]').focus();
    }

    function setModeControls() {
        for (const radio of screen.querySelectorAll('input[name="gm-mode"]')) radio.addEventListener('change', updateSetup);
        roleSelect.addEventListener('focus', () => { fillCharacters(); updateStartButtons(); });
        roleSelect.addEventListener('change', updateStartButtons);
        startButton.addEventListener('click', () => start());
        freshButton.addEventListener('click', () => start(true));
        find('[data-gm-undo]').addEventListener('click', undo);
        find('[data-gm-reset]').addEventListener('click', reset);
        find('[data-gm-change]').addEventListener('click', changeSettings);
        find('[data-gm-retry]').addEventListener('click', takeOpponentTurn);
        find('[data-gm-cancel]').addEventListener('click', () => cancelRequest());
        find('[data-gm-help]').addEventListener('click', () => find('.gm-help').showModal());
        find('[data-gm-help-close]').addEventListener('click', () => find('.gm-help').close());
        board.addEventListener('click', event => {
            const button = event.target.closest('[data-gm-cell]');
            if (!button) return;
            const index = Number(button.dataset.gmCell);
            playHuman(Math.floor(index / state.size), index % state.size);
        });
        board.addEventListener('keydown', event => {
            const button = event.target.closest('[data-gm-cell]');
            if (!button || event.altKey || event.ctrlKey || event.metaKey) return;
            const index = Number(button.dataset.gmCell), row = Math.floor(index / state.size), col = index % state.size;
            let next = index;
            if (event.key === 'ArrowLeft' && col > 0) next--;
            else if (event.key === 'ArrowRight' && col < state.size - 1) next++;
            else if (event.key === 'ArrowUp' && row > 0) next -= state.size;
            else if (event.key === 'ArrowDown' && row < state.size - 1) next += state.size;
            if (next !== index) {
                event.preventDefault();
                cells[focusIndex].tabIndex = -1;
                focusIndex = next;
                cells[next].tabIndex = 0;
                cells[next].focus();
                cells[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        });
        board.addEventListener('focusin', event => {
            const button = event.target.closest('[data-gm-cell]');
            if (!button) return;
            cells[focusIndex].tabIndex = -1;
            focusIndex = Number(button.dataset.gmCell);
            button.tabIndex = 0;
        });
    }

    fillCharacters();
    makeBoard();
    setModeControls();
    updateSetup();
    render();
    new MutationObserver(() => {
        if (!screen.classList.contains('active') && request) cancelRequest('离开棋盘后已停止角色请求；回来后可重试。');
    }).observe(screen, { attributes: true, attributeFilter: ['class'] });
})(typeof window !== 'undefined' ? window : globalThis);
