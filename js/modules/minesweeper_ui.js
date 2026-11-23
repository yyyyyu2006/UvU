(function () {
    'use strict';

    const screen = document.getElementById('uvu-minesweeper-screen');
    const game = window.UVUMinesweeperLogic;
    if (!screen || !game) return;
    const find = selector => screen.querySelector(selector);
    const board = find('.ms-board');
    const viewport = find('.ms-board-viewport');
    const status = find('.ms-status');
    const flag = find('[data-ms-flag]');
    const help = find('.ms-help');
    const difficultyButtons = [...screen.querySelectorAll('[data-ms-level]')];
    const copy = {
        ready: '点开任意一格开始',
        playing: '游戏进行中',
        won: '通关！已翻开所有安全格',
        lost: '踩到地雷了，可以重新开始'
    };
    let state;
    let buttons = [];
    let focusIndex = 0;
    let flagMode = false;
    let ticker = null;

    function icon(name) {
        const source = window.UvULucide?.[name];
        if (!source) return null;
        const template = document.createElement('template');
        template.innerHTML = source;
        const svg = template.content.firstElementChild;
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        return svg;
    }
    for (const holder of screen.querySelectorAll('[data-ms-icon]')) {
        const svg = icon(holder.dataset.msIcon);
        if (svg) holder.replaceChildren(svg);
    }

    function formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }

    function syncTimer() {
        find('.ms-time').textContent = formatTime(game.elapsedMs(state));
        const active = state.status === 'playing' && screen.classList.contains('active') && !document.hidden;
        if (active && ticker === null) ticker = setInterval(() => {
            find('.ms-time').textContent = formatTime(game.elapsedMs(state));
        }, 250);
        else if (!active && ticker !== null) {
            clearInterval(ticker);
            ticker = null;
        }
    }

    function renderCells() {
        const ended = state.status === 'lost' || state.status === 'won';
        state.cells.forEach((cell, index) => {
            const { button, gridCell } = buttons[index];
            const kind = index === state.hitIndex ? 'hit'
                : state.status === 'lost' && cell.flagged && !cell.mine ? 'wrong'
                : state.status === 'lost' && cell.mine ? (cell.flagged ? 'flag' : 'mine')
                : cell.flagged || (state.status === 'won' && cell.mine) ? 'flag'
                : cell.revealed ? (cell.adjacent ? 'number' : 'empty') : 'covered';
            if (button.dataset.kind !== kind) {
                button.dataset.kind = kind;
                const art = { flag: 'flag', hit: 'bomb', mine: 'bomb', wrong: 'x' }[kind];
                button.replaceChildren(art ? icon(art) || '×' : kind === 'number' ? String(cell.adjacent) : '');
                if (kind === 'number') button.dataset.number = cell.adjacent;
                const detail = { hit: '踩中的地雷', mine: '地雷', wrong: '插旗错误', flag: '已插旗', empty: '空白', covered: '未翻开' }[kind] || '周围 ' + cell.adjacent + ' 颗地雷';
                button.setAttribute('aria-label', detail);
            }
            if (ended || cell.revealed) button.setAttribute('aria-disabled', 'true');
            else button.removeAttribute('aria-disabled');
            if (ended && kind === 'flag') gridCell.classList.add('ms-finished-flag');
        });
    }

    function render(message) {
        find('.ms-mines').textContent = state.status === 'won' ? 0 : game.remainingMines(state);
        const modeChanged = flag.getAttribute('aria-pressed') !== String(flagMode);
        if (modeChanged) flag.setAttribute('aria-pressed', String(flagMode));
        const text = message || copy[state.status];
        if (status.textContent !== text) status.textContent = text;
        renderCells();
        syncTimer();
    }

    function reset(level) {
        state = game.createGame(level);
        flagMode = false;
        focusIndex = 0;
        for (const control of difficultyButtons) {
            control.setAttribute('aria-pressed', String(control.dataset.msLevel === level));
        }
        board.setAttribute('aria-rowcount', state.rows);
        board.setAttribute('aria-colcount', state.cols);
        board.style.setProperty('--ms-cols', state.cols);
        board.classList.toggle('is-wide', state.cols > 9);
        find('.ms-scroll-hint').hidden = state.cols <= 9;
        const rows = document.createDocumentFragment();
        buttons = [];
        for (let row = 0; row < state.rows; row++) {
            const line = document.createElement('div');
            line.className = 'ms-row';
            line.setAttribute('role', 'row');
            for (let col = 0; col < state.cols; col++) {
                const index = row * state.cols + col;
                const gridCell = document.createElement('div');
                gridCell.setAttribute('role', 'gridcell');
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ms-cell';
                button.dataset.msCell = index;
                button.tabIndex = index === 0 ? 0 : -1;
                gridCell.append(button);
                line.append(gridCell);
                buttons.push({ button, gridCell });
            }
            rows.append(line);
        }
        board.replaceChildren(rows);
        viewport.scrollLeft = 0;
        render();
    }

    function changeFocus(index, moveDomFocus = false) {
        buttons[focusIndex].button.tabIndex = -1;
        const button = buttons[index].button;
        focusIndex = index;
        button.tabIndex = 0;
        if (moveDomFocus) button.focus();
    }

    function play(index, mark) {
        changeFocus(index);
        if (mark && !state.cells[index].flagged && !state.cells[index].revealed &&
            ['ready', 'playing'].includes(state.status) && game.remainingMines(state) <= 0) {
            render('旗子已用完，取消一面旗子后再标记');
            return;
        }
        const previous = state.status;
        const changed = mark ? game.toggleFlag(state, index) : game.reveal(state, index);
        if (!changed) return;
        render();
    }

    board.addEventListener('click', event => {
        const cell = event.target.closest('[data-ms-cell]');
        if (cell) play(Number(cell.dataset.msCell), flagMode);
    });
    board.addEventListener('contextmenu', event => {
        const cell = event.target.closest('[data-ms-cell]');
        if (!cell) return;
        event.preventDefault();
        play(Number(cell.dataset.msCell), true);
    });
    board.addEventListener('keydown', event => {
        const cell = event.target.closest('[data-ms-cell]');
        if (!cell || event.altKey || event.metaKey || event.ctrlKey) return;
        const index = Number(cell.dataset.msCell);
        const col = index % state.cols;
        const row = Math.floor(index / state.cols);
        let next = index;
        if (event.key === 'ArrowLeft' && col > 0) next--;
        else if (event.key === 'ArrowRight' && col < state.cols - 1) next++;
        else if (event.key === 'ArrowUp' && row > 0) next -= state.cols;
        else if (event.key === 'ArrowDown' && row < state.rows - 1) next += state.cols;
        if (event.key.startsWith('Arrow')) {
            if (next === index) return;
            event.preventDefault();
            changeFocus(next, true);
            cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    });

    for (const control of difficultyButtons) control.addEventListener('click', () => {
        if (control.dataset.msLevel !== state.difficulty) reset(control.dataset.msLevel);
    });
    find('[data-ms-reset]').addEventListener('click', () => reset(state.difficulty));
    flag.addEventListener('click', () => {
        if (state.status === 'won' || state.status === 'lost') return;
        flagMode = !flagMode;
        render(flagMode ? '插旗模式：点未翻开的格子标记或取消' : undefined);
    });
    find('[data-ms-help]').addEventListener('click', () => help.showModal());
    find('[data-ms-help-close]').addEventListener('click', () => help.close());

    reset('beginner');
    new MutationObserver(() => {
        if (!screen.classList.contains('active') && help.open) help.close();
        syncTimer();
    }).observe(screen, { attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', syncTimer);
})();
