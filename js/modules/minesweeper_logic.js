(function (root) {
    'use strict';

    const DIFFICULTIES = Object.freeze({
        beginner: Object.freeze({ id: 'beginner', label: '初级', rows: 9, cols: 9, mines: 10 }),
        intermediate: Object.freeze({ id: 'intermediate', label: '中级', rows: 16, cols: 16, mines: 40 }),
        expert: Object.freeze({ id: 'expert', label: '高级', rows: 16, cols: 30, mines: 99 })
    });

    function resolveDifficulty(difficulty) {
        const selected = typeof difficulty === 'string' ? DIFFICULTIES[difficulty] : difficulty;
        if (!selected || !Number.isSafeInteger(selected.rows) || !Number.isSafeInteger(selected.cols) ||
            !Number.isSafeInteger(selected.mines) || selected.rows < 1 || selected.cols < 1 ||
            selected.rows * selected.cols > 10000 || selected.mines < 0 || selected.mines >= selected.rows * selected.cols) {
            throw new RangeError('地雷数量或棋盘尺寸无效');
        }
        return selected;
    }

    function createGame(difficulty = 'beginner') {
        const selected = resolveDifficulty(difficulty);
        const rows = selected.rows;
        const cols = selected.cols;
        return {
            difficulty: selected.id || 'custom',
            rows,
            cols,
            mines: selected.mines,
            cells: Array.from({ length: rows * cols }, () => ({ mine: false, adjacent: 0, revealed: false, flagged: false })),
            hitIndex: null,
            flags: 0,
            status: 'ready',
            startedAt: null,
            endedAt: null,
            elapsed: 0
        };
    }

    function neighbors(state, index) {
        if (!Number.isInteger(index) || index < 0 || index >= state.cells.length) return [];
        const row = Math.floor(index / state.cols);
        const col = index % state.cols;
        const result = [];
        for (let r = Math.max(0, row - 1); r <= Math.min(state.rows - 1, row + 1); r++) {
            for (let c = Math.max(0, col - 1); c <= Math.min(state.cols - 1, col + 1); c++) {
                const next = r * state.cols + c;
                if (next !== index) result.push(next);
            }
        }
        return result;
    }

    function placeMines(state, safeIndex, random = Math.random) {
        const candidates = [];
        for (let index = 0; index < state.cells.length; index++) if (index !== safeIndex) candidates.push(index);
        for (let i = candidates.length - 1; i > 0; i--) {
            const sample = Number(random());
            const bounded = Number.isFinite(sample) ? Math.min(0.999999999999, Math.max(0, sample)) : 0.5;
            const j = Math.floor(bounded * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        for (let i = 0; i < state.mines; i++) state.cells[candidates[i]].mine = true;
        for (let index = 0; index < state.cells.length; index++) {
            state.cells[index].adjacent = neighbors(state, index).reduce((sum, next) => sum + Number(state.cells[next].mine), 0);
        }
    }

    function finish(state, status, now) {
        state.status = status;
        state.endedAt = now;
        state.elapsed = Math.max(0, now - state.startedAt);
    }

    function reveal(state, index, options = {}) {
        if (!Number.isInteger(index) || index < 0 || index >= state.cells.length || !['ready', 'playing'].includes(state.status)) return false;
        const cell = state.cells[index];
        if (cell.flagged || cell.revealed) return false;
        const now = Number.isFinite(options.now) ? options.now : Date.now();
        if (state.status === 'ready') {
            placeMines(state, index, options.random || Math.random);
            state.status = 'playing';
            state.startedAt = now;
        }
        if (cell.mine) {
            cell.revealed = true;
            state.hitIndex = index;
            for (const other of state.cells) if (other.mine) other.revealed = true;
            finish(state, 'lost', now);
            return true;
        }

        const queue = [index];
        const queued = new Set(queue);
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const current = queue[cursor];
            const currentCell = state.cells[current];
            if (currentCell.revealed || currentCell.flagged || currentCell.mine) continue;
            currentCell.revealed = true;
            if (currentCell.adjacent !== 0) continue;
            for (const next of neighbors(state, current)) {
                const nextCell = state.cells[next];
                if (!queued.has(next) && !nextCell.flagged && !nextCell.mine && !nextCell.revealed) {
                    queued.add(next);
                    queue.push(next);
                }
            }
        }

        if (state.cells.every(item => item.mine || item.revealed)) finish(state, 'won', now);
        return true;
    }

    function toggleFlag(state, index) {
        if (!Number.isInteger(index) || index < 0 || index >= state.cells.length || !['ready', 'playing'].includes(state.status)) return false;
        const cell = state.cells[index];
        if (cell.revealed) return false;
        cell.flagged = !cell.flagged;
        state.flags += cell.flagged ? 1 : -1;
        return true;
    }

    function remainingMines(state) { return state.mines - state.flags; }

    function elapsedMs(state, now = Date.now()) {
        if (state.startedAt === null) return 0;
        if (state.endedAt !== null) return state.elapsed;
        return Math.max(0, now - state.startedAt);
    }

    const api = Object.freeze({ DIFFICULTIES, createGame, neighbors, reveal, toggleFlag, remainingMines, elapsedMs });
    root.UVUMinesweeperLogic = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
