const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../js/modules/minesweeper_logic.js');

test('classic difficulties use their exact board and mine counts', () => {
    assert.deepEqual(game.DIFFICULTIES.beginner, { id: 'beginner', label: '初级', rows: 9, cols: 9, mines: 10 });
    assert.deepEqual(game.DIFFICULTIES.intermediate, { id: 'intermediate', label: '中级', rows: 16, cols: 16, mines: 40 });
    assert.deepEqual(game.DIFFICULTIES.expert, { id: 'expert', label: '高级', rows: 16, cols: 30, mines: 99 });
});

test('the first revealed cell is always safe and mine count remains exact', () => {
    const state = game.createGame('beginner');
    assert.equal(state.cells.some(cell => cell.mine), false, 'mines are deferred until the first reveal');
    game.reveal(state, 0, { random: () => 0, now: 1000 });
    assert.equal(state.cells[0].mine, false);
    assert.equal(state.cells.filter(cell => cell.mine).length, 10);
    assert.equal(state.status, 'playing');
    assert.equal(state.startedAt, 1000);
});

test('neighbor counts match the surrounding mine layout for every cell', () => {
    const state = game.createGame('beginner');
    game.reveal(state, 40, { random: () => 0.37, now: 500 });
    for (let index = 0; index < state.cells.length; index++) {
        const expected = game.neighbors(state, index).filter(next => state.cells[next].mine).length;
        assert.equal(state.cells[index].adjacent, expected, `cell ${index}`);
    }
});

test('revealing an empty cell safely expands through adjacent empty cells', () => {
    const state = game.createGame('beginner');
    game.reveal(state, 40, { random: () => 0.02, now: 1 });
    const empty = state.cells.findIndex(cell => !cell.mine && cell.adjacent === 0 && !cell.revealed);
    assert.notEqual(empty, -1);
    game.reveal(state, empty, { now: 2 });
    const connected = new Set([empty]);
    const queue = [empty];
    while (queue.length) {
        const current = queue.shift();
        if (state.cells[current].adjacent !== 0) continue;
        for (const next of game.neighbors(state, current)) {
            if (state.cells[next].mine || connected.has(next)) continue;
            connected.add(next);
            if (state.cells[next].adjacent === 0) queue.push(next);
        }
    }
    for (const index of connected) assert.equal(state.cells[index].revealed, true, `empty area cell ${index}`);
    assert.equal(state.cells.filter(cell => cell.mine && cell.revealed).length, 0);
});

test('flags cannot be revealed and revealed cells cannot be flagged', () => {
    const state = game.createGame('beginner');
    assert.equal(game.toggleFlag(state, 5), true);
    assert.equal(game.toggleFlag(state, 5), true);
    assert.equal(state.flags, 0);
    game.toggleFlag(state, 5);
    game.reveal(state, 5, { random: () => 0.2, now: 100 });
    assert.equal(state.cells[5].revealed, false);
    game.toggleFlag(state, 5);
    assert.equal(game.reveal(state, 5, { random: () => 0.2, now: 100 }), true);
    assert.equal(state.cells[5].revealed, true);
    assert.equal(game.toggleFlag(state, 5), false);
    assert.equal(game.remainingMines(state), 10 - state.flags);
});

test('all safe cells revealed wins and freezes the elapsed time', () => {
    const state = game.createGame({ id: 'test', label: '测试', rows: 2, cols: 2, mines: 1 });
    game.reveal(state, 0, { random: () => 0, now: 1000 });
    const mine = state.cells.findIndex(cell => cell.mine);
    for (let index = 0; index < state.cells.length; index++) {
        if (index !== mine && !state.cells[index].revealed) game.reveal(state, index, { now: 2500 });
    }
    assert.equal(state.status, 'won');
    assert.equal(state.endedAt, 2500);
    assert.equal(game.elapsedMs(state, 9000), 1500);
    assert.equal(game.reveal(state, mine, { now: 9000 }), false);
});

test('revealing a mine ends the game and exposes all mines', () => {
    const state = game.createGame({ id: 'test', label: '测试', rows: 2, cols: 2, mines: 1 });
    game.reveal(state, 0, { random: () => 0, now: 1000 });
    const mine = state.cells.findIndex(cell => cell.mine);
    assert.equal(game.reveal(state, mine, { now: 2000 }), true);
    assert.equal(state.status, 'lost');
    assert.equal(state.cells[mine].revealed, true);
    assert.equal(state.hitIndex, mine);
    assert.equal(state.endedAt, 2000);
});

test('out-of-range cells, post-game actions, and impossible boards are rejected safely', () => {
    const state = game.createGame('beginner');
    assert.equal(game.reveal(state, -1), false);
    assert.equal(game.toggleFlag(state, state.cells.length), false);
    assert.throws(() => game.createGame({ id: 'bad', label: 'bad', rows: 2, cols: 2, mines: 4 }), /地雷数量/);
    game.reveal(state, 40, { random: () => 0.5, now: 1 });
    state.status = 'won';
    assert.equal(game.toggleFlag(state, 1), false);
});
