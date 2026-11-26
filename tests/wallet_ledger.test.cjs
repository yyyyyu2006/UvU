const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../js/modules/wallet_ledger.js');

test('money parser accepts cent precision and rejects malformed or excessive amounts', () => {
    assert.equal(ledger.cents('0.01'), 1);
    assert.equal(ledger.cents('123.4'), 12340);
    assert.equal(ledger.cents('1.234'), 0);
    assert.equal(ledger.cents('1e5'), 0);
    assert.equal(ledger.cents('-1'), 0);
    assert.equal(ledger.cents('1000000000'), 0);
});

test('virtual card transfers and ledger rows conserve cents', () => {
    let state = ledger.initial();
    state = ledger.apply(state, {kind:'add-card',id:'card-a',name:'日常储蓄卡'});
    state = ledger.apply(state, {kind:'receive',id:'receive-a',amount:12345,title:'模拟收款'});
    state = ledger.apply(state, {kind:'withdraw',id:'withdraw-a',source:'card-a',amount:2345});
    assert.equal(state.cards[0].balance, 2345);
    assert.equal(state.balance, 10000);
    state = ledger.apply(state, {kind:'recharge',id:'recharge-a',source:'card-a',amount:1000});
    assert.equal(state.cards[0].balance, 1345);
    assert.equal(state.balance, 11000);
    assert.deepEqual(state.rows.map(row => row.amount), [12345,-2345,1000]);
    assert.equal(ledger.validate(state), true);
});

test('insufficient balance, malformed states, duplicate operations and family limits are rejected atomically', () => {
    let state = ledger.initial();
    state = ledger.apply(state, {kind:'receive',id:'receive-a',amount:2000,title:'模拟收款'});
    assert.throws(() => ledger.apply(state,{kind:'pay',id:'pay-a',amount:2001,source:'balance',title:'转账',links:[]}),/余额不足/);
    assert.equal(state.balance,2000);
    assert.throws(() => ledger.apply(state,{kind:'receive',id:'receive-a',amount:100,title:'重复'}),/已经处理/);
    state = ledger.apply(state,{kind:'open-family',id:'family-a',recipientId:'char-a',name:'青',amount:1000});
    state = ledger.apply(state,{kind:'family-spend',id:'family-spend',cardId:'family-a',amount:325});
    assert.equal(state.family[0].used,325);
    assert.equal(state.balance,1000);
    state = ledger.apply(state,{kind:'close-family',id:'family-close',cardId:'family-a'});
    assert.equal(state.balance,1675);
    assert.equal(state.family[0].active,false);
    assert.equal(ledger.validate(state),true);
    assert.throws(() => ledger.checked({...ledger.initial(),balance:-1}),/无法读取/);
});

test('outbound transfer refunds on returned status and settles once', () => {
    let state = ledger.apply(ledger.initial(),{kind:'receive',id:'seed',amount:5000,title:'模拟入账'});
    const uuid='550e8400-e29b-41d4-a716-446655440000';
    state = ledger.apply(state,{kind:'pay',id:uuid,amount:900,source:'balance',title:'转账',links:[{chatId:'char-a',archiveId:null,messageId:'msg-a',kind:'transfer'}]});
    assert.equal(state.balance,4100);
    assert.equal(state.pending.length,1);
    state = ledger.apply(state,{kind:'settle',id:uuid,amount:900,title:'转账退回'});
    assert.equal(state.balance,5000);
    assert.equal(state.pending.length,0);
    assert.equal(state.rows.filter(row=>row.id==='refund:'+uuid).length,1);
    state = ledger.apply(state,{kind:'settle',id:uuid,amount:900,title:'重复退款'});
    assert.equal(state.balance,5000);
});

test('group transfers debit every recipient atomically and never partially charge', () => {
    let state=ledger.apply(ledger.initial(),{kind:'receive',id:'batch-seed',amount:1000,title:'模拟收款'});
    const links=[{id:'pay-one',kind:'transfer',chatId:'group-a',archiveId:null,messageId:'msg-one'},{id:'pay-two',kind:'transfer',chatId:'group-a',archiveId:null,messageId:'msg-two'}];
    assert.throws(()=>ledger.apply(state,{kind:'pay-batch',source:'balance',amount:600,title:'群转账',links}),/余额不足/);
    assert.equal(state.balance,1000,'a rejected batch leaves the original state unchanged');
    state=ledger.apply(state,{kind:'pay-batch',source:'balance',amount:400,title:'群转账',links});
    assert.equal(state.balance,200);
    assert.equal(state.pending.length,2);
    assert.equal(ledger.validate(state),true);
});

test('PBKDF2 PIN records are salted, verified and never store the entered PIN', async () => {
    const record = await ledger.createPin('123456');
    assert.notEqual(record.salt, '123456');
    assert.notEqual(record.hash, '123456');
    assert.equal(await ledger.verifyPin('123456',record), true);
    assert.equal(await ledger.verifyPin('000000',record), false);
});
