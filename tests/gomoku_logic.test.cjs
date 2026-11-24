'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const gomoku = require('../js/modules/gomoku_logic.js');

test('creates a 15 by 15 casual game with black to move', () => {
    const state = gomoku.createGame();
    assert.equal(state.size, 15);
    assert.equal(state.board.length, 225);
    assert.equal(state.turn, 'black');
    assert.equal(state.status, 'playing');
});

test('rejects occupied and out-of-range moves without mutating the game', () => {
    const state = gomoku.createGame();
    assert.equal(gomoku.playMove(state, 'black', 7, 7).ok, true);
    const before = state.moves.length;
    assert.equal(gomoku.playMove(state, 'white', 7, 7).reason, 'occupied');
    assert.equal(gomoku.playMove(state, 'white', -1, 0).reason, 'out-of-range');
    assert.equal(state.moves.length, before);
    assert.equal(state.turn, 'white');
});

test('detects five in each direction and records the winning line', () => {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const state = gomoku.createGame();
        const stones = [];
        for (let i = 0; i < 4; i++) {
            const row = 7 + dr * i, col = 7 + dc * i;
            stones.push([row, col]);
            assert.equal(gomoku.playMove(state, 'black', row, col).ok, true);
            assert.equal(gomoku.playMove(state, 'white', 0, i).ok, true);
        }
        const [row, col] = [7 + dr * 4, 7 + dc * 4];
        const result = gomoku.playMove(state, 'black', row, col);
        assert.equal(result.status, 'won');
        assert.equal(result.winner, 'black');
        assert.equal(result.winningLine.length, 5);
    }
});

test('casual rules treat six or more contiguous stones as a win', () => {
    const state = gomoku.createGame();
    for (let col = 2; col < 7; col++) state.board[7 * 15 + col] = 'black';
    state.turn = 'black';
    state.moves = Array.from({ length: 10 }, (_, index) => ({ color: index % 2 ? 'white' : 'black', row: index < 5 ? 7 : 0, col: index % 5 }));
    const result = gomoku.playMove(state, 'black', 7, 7);
    assert.equal(result.status, 'won');
    assert.equal(result.winningLine.length, 6);
});

test('detects a full-board draw and rejects moves after the game ends', () => {
    const state = { size: 1, board: [null], turn: 'black', moves: [], status: 'playing', winner: null, winningLine: [], lastMove: null };
    const result = gomoku.playMove(state, 'black', 0, 0);
    assert.equal(result.status, 'draw');
    assert.equal(gomoku.playMove(state, state.turn, 0, 0).reason, 'finished');
});

test('undo restores the prior turn, board, status and move history', () => {
    const state = gomoku.createGame();
    gomoku.playMove(state, 'black', 7, 7);
    gomoku.playMove(state, 'white', 7, 8);
    assert.equal(gomoku.undoMoves(state, 2), 2);
    assert.equal(state.moves.length, 0);
    assert.equal(state.turn, 'black');
    assert.equal(state.board[7 * 15 + 7], null);
    assert.equal(state.status, 'playing');
});

test('candidate generation is legal, deterministic and prefers center on an empty board', () => {
    const state = gomoku.createGame();
    assert.deepEqual(gomoku.getCandidateMoves(state), [{ row: 7, col: 7, score: 0 }]);
    gomoku.playMove(state, 'black', 7, 7);
    const candidates = gomoku.getCandidateMoves(state);
    assert.ok(candidates.length > 0);
    assert.ok(candidates.every(move => state.board[move.row * state.size + move.col] === null));
    assert.deepEqual(candidates, gomoku.getCandidateMoves(state));
});

test('AI takes a direct win before other candidates', () => {
    const state = gomoku.createGame();
    for (let col = 5; col < 9; col++) state.board[7 * 15 + col] = 'black';
    state.turn = 'black';
    const move = gomoku.chooseAiMove(state, 'black', 'normal');
    assert.ok(move);
    assert.equal(gomoku.playMove(state, 'black', move.row, move.col).status, 'won');
});

test('AI blocks the opponent immediate win', () => {
    const state = gomoku.createGame();
    for (let col = 5; col < 9; col++) state.board[7 * 15 + col] = 'black';
    state.turn = 'white';
    const move = gomoku.chooseAiMove(state, 'white', 'normal');
    assert.ok(move.blocksWin);
    assert.equal(move.row, 7);
    assert.ok([4, 9].includes(move.col));
});
