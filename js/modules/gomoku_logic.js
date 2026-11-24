(function (root) {
    'use strict';

    const DIRECTIONS = Object.freeze([[0, 1], [1, 0], [1, 1], [1, -1]]);
    const COLORS = Object.freeze(['black', 'white']);
    const otherColor = color => color === 'black' ? 'white' : 'black';
    const inBounds = (size, row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < size && col < size;
    const indexOf = (size, row, col) => row * size + col;

    function createGame(size = 15) {
        if (!Number.isInteger(size) || size < 5 || size > 25) throw new RangeError('棋盘尺寸须在 5 到 25 之间');
        return {
            version: 1,
            rules: 'casual-five-or-more',
            size,
            board: Array(size * size).fill(null),
            turn: 'black',
            status: 'playing',
            winner: null,
            winningLine: [],
            moves: [],
            lastMove: null
        };
    }

    function lineThrough(state, row, col, color, dr, dc) {
        const points = [[row, col]];
        for (const direction of [-1, 1]) {
            let r = row + dr * direction, c = col + dc * direction;
            while (inBounds(state.size, r, c) && state.board[indexOf(state.size, r, c)] === color) {
                points.push([r, c]);
                r += dr * direction;
                c += dc * direction;
            }
        }
        points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        return points;
    }

    function playMove(state, color, row, col) {
        if (!state || !Array.isArray(state.board) || !Number.isInteger(state.size)) return { ok: false, reason: 'invalid-state' };
        if (state.status !== 'playing') return { ok: false, reason: 'finished' };
        if (!COLORS.includes(color) || color !== state.turn) return { ok: false, reason: 'wrong-turn' };
        if (!inBounds(state.size, row, col)) return { ok: false, reason: 'out-of-range' };
        const index = indexOf(state.size, row, col);
        if (state.board[index] !== null) return { ok: false, reason: 'occupied' };

        const move = { color, row, col, ply: state.moves.length + 1 };
        state.board[index] = color;
        state.moves.push(move);
        state.lastMove = move;
        for (const [dr, dc] of DIRECTIONS) {
            const line = lineThrough(state, row, col, color, dr, dc);
            if (line.length >= 5) {
                state.status = 'won';
                state.winner = color;
                state.winningLine = line;
                return { ok: true, status: state.status, winner: color, winningLine: line, move };
            }
        }
        if (state.moves.length === state.board.length) {
            state.status = 'draw';
            return { ok: true, status: state.status, winner: null, winningLine: [], move };
        }
        state.turn = otherColor(color);
        return { ok: true, status: state.status, winner: null, winningLine: [], move };
    }

    function undoMoves(state, count = 1) {
        if (!state || !Number.isInteger(count) || count < 1 || !state.moves.length) return 0;
        const removed = Math.min(count, state.moves.length);
        const remaining = state.moves.slice(0, -removed);
        const rebuilt = createGame(state.size);
        for (const move of remaining) playMove(rebuilt, move.color, move.row, move.col);
        Object.assign(state, rebuilt);
        return removed;
    }

    function lineScore(board, size, row, col, color, dr, dc) {
        let count = 1, open = 0;
        for (const direction of [-1, 1]) {
            let r = row + dr * direction, c = col + dc * direction;
            while (inBounds(size, r, c) && board[indexOf(size, r, c)] === color) {
                count++;
                r += dr * direction;
                c += dc * direction;
            }
            if (inBounds(size, r, c) && board[indexOf(size, r, c)] === null) open++;
        }
        if (count >= 5) return 1_000_000;
        if (count === 4) return open === 2 ? 80_000 : open === 1 ? 12_000 : 0;
        if (count === 3) return open === 2 ? 2_500 : open === 1 ? 350 : 0;
        if (count === 2) return open === 2 ? 180 : open === 1 ? 35 : 0;
        return open ? 8 : 0;
    }

    function positionScore(board, size, row, col, color) {
        return DIRECTIONS.reduce((score, [dr, dc]) => score + lineScore(board, size, row, col, color, dr, dc), 0);
    }

    function getCandidateMoves(state, color = state?.turn, limit = 225) {
        if (!state || !Array.isArray(state.board) || !COLORS.includes(color) || state.status !== 'playing') return [];
        const occupied = [];
        for (let index = 0; index < state.board.length; index++) if (state.board[index]) occupied.push([Math.floor(index / state.size), index % state.size]);
        if (!occupied.length) return [{ row: Math.floor(state.size / 2), col: Math.floor(state.size / 2), score: 0 }];

        const candidates = [];
        for (let row = 0; row < state.size; row++) for (let col = 0; col < state.size; col++) {
            if (state.board[indexOf(state.size, row, col)] !== null) continue;
            if (!occupied.some(([r, c]) => Math.abs(r - row) <= 2 && Math.abs(c - col) <= 2)) continue;
            const attack = positionScore(state.board, state.size, row, col, color);
            const defense = positionScore(state.board, state.size, row, col, otherColor(color));
            candidates.push({ row, col, score: attack + defense * 0.96 - (Math.abs(row - (state.size - 1) / 2) + Math.abs(col - (state.size - 1) / 2)) * 0.01 });
        }
        candidates.sort((a, b) => b.score - a.score || a.row - b.row || a.col - b.col);
        return candidates.slice(0, Math.max(1, Math.min(225, limit)));
    }

    function findImmediateWin(state, color) {
        for (const move of getCandidateMoves(state, color, 225)) {
            const board = state.board.slice();
            board[indexOf(state.size, move.row, move.col)] = color;
            if (DIRECTIONS.some(([dr, dc]) => lineScore(board, state.size, move.row, move.col, color, dr, dc) >= 1_000_000)) return move;
        }
        return null;
    }

    function chooseAiMove(state, color = state?.turn, difficulty = 'normal', random = Math.random) {
        if (!state || color !== state.turn || state.status !== 'playing') return null;
        const win = findImmediateWin(state, color);
        if (win) return win;
        const threat = findImmediateWin(state, otherColor(color));
        if (threat) return { row: threat.row, col: threat.col, score: Number.MAX_SAFE_INTEGER, blocksWin: true };
        const candidates = getCandidateMoves(state, color, difficulty === 'expert' ? 24 : 12);
        if (!candidates.length) return null;
        if (difficulty === 'beginner' && candidates.length > 1) {
            const sample = Number(random());
            const safe = Number.isFinite(sample) ? Math.min(0.999999999999, Math.max(0, sample)) : 0.5;
            return candidates[Math.floor(safe * Math.min(5, candidates.length))];
        }
        if (difficulty !== 'expert' || candidates.length === 1) return candidates[0];

        let best = candidates[0], bestScore = -Infinity;
        for (const candidate of candidates) {
            const board = state.board.slice();
            board[indexOf(state.size, candidate.row, candidate.col)] = color;
            const simulated = { ...state, board, turn: otherColor(color), moves: state.moves.concat({ color, ...candidate }) };
            if (findImmediateWin(simulated, otherColor(color))) continue;
            const reply = getCandidateMoves(simulated, otherColor(color), 1)[0];
            const score = candidate.score - (reply?.score || 0) * 0.75;
            if (score > bestScore) { bestScore = score; best = candidate; }
        }
        return best;
    }

    const api = Object.freeze({ createGame, playMove, undoMoves, getCandidateMoves, findImmediateWin, chooseAiMove, otherColor });
    root.UVUGomokuLogic = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
