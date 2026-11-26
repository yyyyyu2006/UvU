/* UvU's fictional ledger; no bank details or real payment credentials. */
(function (root, factory) {
    const ledger = factory();
    if (typeof module === 'object' && module.exports) module.exports = ledger;
    else root.UvUWalletLedger = ledger;
})(globalThis, () => {
    'use strict';
    const MAX = 99999999999;
    const ITERATIONS = 310000;
    const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
    const initial = () => ({ version: 1, balance: 0, cards: [], family: [], rows: [], pending: [], pin: null });
    const error = text => { throw new Error(text); };
    function cents(value) {
        const matched = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
        if (!matched) return 0;
        const result = Number(matched[1]) * 100 + Number((matched[2] || '').padEnd(2, '0'));
        return result <= MAX ? result : 0;
    }
    const validMoney = (n, allowZero = false) => Number.isSafeInteger(n) && n >= (allowZero ? 0 : 1) && n <= MAX;
    const money = n => (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const id = () => globalThis.crypto.randomUUID();
    const label = value => String(value ?? '').trim().slice(0, 60);
    const validKey = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
    const validPin = p => p && /^[\da-f]{32}$/.test(p.salt) && /^[\da-f]{64}$/.test(p.hash);
    function validate(s) {
        if (!s || s.version !== 1 || !validMoney(s.balance, true) || !Array.isArray(s.cards) ||
            !Array.isArray(s.family) || !Array.isArray(s.rows) || !Array.isArray(s.pending) ||
            s.cards.length > 12 || s.family.length > 24 || s.pending.length > 1000 ||
            (s.pin !== null && !validPin(s.pin))) return false;
        const cards = s.cards.every(c => c && validKey(c.id) && typeof c.name === 'string' && /^\d{4}$/.test(c.tail) && validMoney(c.balance, true));
        const family = s.family.every(c => c && validKey(c.id) && validKey(c.recipientId) && typeof c.name === 'string' &&
            validMoney(c.limit) && validMoney(c.used, true) && c.used <= c.limit && typeof c.active === 'boolean');
        const rows = s.rows.every(r => r && validKey(r.id) && typeof r.title === 'string' && Number.isFinite(r.time)
            && Number.isSafeInteger(r.amount) && Math.abs(r.amount) <= MAX &&
            (r.source === 'balance' || validKey(r.source)));
        const distinct = items => new Set(items.map(item => item.id)).size === items.length;
        const rowIds = new Set(s.rows.map(r => r.id));
        return cards && family && rows && distinct(s.cards) && distinct(s.family) && distinct(s.rows) && distinct(s.pending.filter(Boolean)) &&
            s.pending.every(p => p && rowIds.has(p.id) && validKey(p.chatId) && validKey(p.messageId) &&
                (p.archiveId == null || validKey(p.archiveId)) && ['transfer', 'packet'].includes(p.kind)
                && validMoney(p.amount) && (p.source === 'balance' || s.cards.some(c => c.id === p.source)));
    }
    function checked(raw) {
        if (raw === undefined) return initial();
        if (!validate(raw)) error('钱包记录无法读取，请先备份数据再重试');
        return raw;
    }
    function apply(raw, op) {
        const state = structuredClone(checked(raw));
        const card = key => state.cards.find(c => c.id === key) || error('这张虚拟卡已不存在');
        const family = key => state.family.find(c => c.id === key) || error('亲属卡已不存在');
        const account = key => key === 'balance' ? [state, 'balance'] : [card(key), 'balance'];
        const move = (key, amount) => {
            const [obj, field] = account(key);
            const next = obj[field] + amount;
            if (next < 0) error(key === 'balance' ? '零钱余额不足' : '虚拟银行卡余额不足');
            if (!validMoney(next, true)) error('余额已达到钱包上限');
            obj[field] = next;
        };
        const row = (key, title, amount, source = 'balance') => {
            if (!validKey(key) || state.rows.some(item => item.id === key)) error('这笔交易已经处理');
            state.rows.push({ id: key, title: label(title), amount, source, time: Number.isFinite(op.time) ? op.time : Date.now() });
        };
        const amount = op.amount;
        const amountRequired = () => { if (!validMoney(amount)) error('请输入有效金额，最多两位小数'); };
        switch (op.kind) {
            case 'pin':
                if (state.pin || !validPin(op.pin)) error('支付密码状态已变化，请重试');
                state.pin = op.pin;
                break;
            case 'add-card': {
                if (!label(op.name)) error('请输入虚拟卡名称');
                if (state.cards.length >= 12 || !validKey(op.id) || state.cards.some(c => c.id === op.id)) error('无法添加更多虚拟卡');
                const start = Number.parseInt(op.id.slice(0, 8), 16) || 0;
                let tail;
                for (let offset = 0; offset <= 12; offset++) {
                    tail = String((start + offset) % 10000).padStart(4, '0');
                    if (!state.cards.some(c => c.tail === tail)) break;
                }
                state.cards.push({ id: op.id, name: label(op.name), tail, balance: 0 });
                break;
            }
            case 'fund':
                amountRequired();
                move(op.source, amount);
                row(op.id, '模拟入金', amount, op.source);
                break;
            case 'withdraw':
            case 'recharge': {
                amountRequired();
                card(op.source);
                const fromBalance = op.kind === 'withdraw';
                move(fromBalance ? 'balance' : op.source, -amount);
                move(fromBalance ? op.source : 'balance', amount);
                row(op.id, fromBalance ? '存入虚拟银行卡' : '转回零钱', fromBalance ? -amount : amount);
                break;
            }
            case 'open-family':
                amountRequired();
                if (!validKey(op.recipientId) || !label(op.name)) error('请选择亲属卡使用人');
                if (state.family.length >= 24 || state.family.some(c => c.active && c.recipientId === op.recipientId)) error('该角色已有亲属卡，或数量达到上限');
                move('balance', -amount);
                row(op.id, '开通亲属卡 · ' + op.name, -amount);
                state.family.push({ id: op.id, recipientId: op.recipientId, name: label(op.name), limit: amount, used: 0, active: true });
                break;
            case 'family-spend': {
                amountRequired();
                const target = family(op.cardId);
                if (!target.active || amount > target.limit - target.used) error('亲属卡额度不足或已停用');
                target.used += amount;
                row(op.id, '亲属卡消费 · ' + target.name, -amount, 'family');
                break;
            }
            case 'close-family': {
                const target = family(op.cardId);
                if (!target.active) error('亲属卡已停用');
                const rest = target.limit - target.used;
                move('balance', rest);
                target.active = false;
                row(op.id, '亲属卡停用 · ' + target.name, rest);
                break;
            }
            case 'pay': {
                amountRequired();
                if (!Array.isArray(op.links) || op.links.length > 1) error('付款记录无效');
                if (op.links.some(link => !link || !validKey(link.chatId) || !validKey(link.messageId) ||
                    !['transfer', 'packet'].includes(link.kind) ||
                    (link.archiveId != null && !validKey(link.archiveId)))) error('付款记录无效');
                move(op.source, -amount);
                row(op.id, op.title, -amount, op.source);
                for (const link of op.links) {if(state.pending.length>=1000)error('待处理账单过多，请先处理旧账单');state.pending.push({ ...link, id: op.id, source: op.source, amount });}
                break;
            }
            case 'pay-batch': {
                amountRequired();
                if(!Array.isArray(op.links)||op.links.length<1||op.links.length>24)error('收款对象数量无效');
                if(!['balance',...state.cards.map(item=>item.id)].includes(op.source))error('付款方式无效');
                if(state.pending.length+op.links.length>1000)error('待处理账单过多，请先处理旧账单');
                for(const link of op.links){
                    if(!link||!validKey(link.id)||!validKey(link.chatId)||!validKey(link.messageId)||
                        link.kind!=='transfer'||(link.archiveId!=null&&!validKey(link.archiveId))||state.rows.some(item=>item.id===link.id)||state.pending.some(item=>item.id===link.id))error('付款记录无效');
                    move(op.source,-amount);
                    row(link.id,op.title, -amount,op.source);
                    state.pending.push({...link,source:op.source,amount});
                }
                break;
            }
            case 'receive':
                amountRequired();
                move('balance', amount);
                row(op.id, op.title, amount);
                break;
            case 'settle': {
                const payment = state.pending.find(item => item.id === op.id);
                if (!payment) return raw;
                if (!validMoney(amount, true) || amount > payment.amount) error('退款金额不正确');
                if (amount) {
                    if(op.creditToBalance){move('balance',amount);row('share:'+payment.id,op.title,amount);}
                    else {move(payment.source, amount);row('refund:' + payment.id, op.title, amount, payment.source);}
                }
                if(op.keepPending&&payment.amount>amount)payment.amount-=amount;
                else state.pending = state.pending.filter(item => item !== payment);
                break;
            }
            default: error('未知钱包操作');
        }
        return state;
    }
    async function derive(pin, salt) {
        if (!globalThis.crypto?.subtle) error('请在 HTTPS 页面或本机地址使用支付密码');
        if (!/^\d{6}$/.test(pin)) error('请输入 6 位数字');
        const password = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
        const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, password, 256);
        return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
    }
    async function createPin(pin) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        return { salt: Array.from(salt, n => n.toString(16).padStart(2, '0')).join(''), hash: await derive(pin, salt) };
    }
    async function verifyPin(pin, record) {
        if (!validPin(record)) return false;
        const hash = await derive(pin, Uint8Array.from(record.salt.match(/../g), x => parseInt(x, 16)));
        let mismatch = 0;
        for (let i = 0; i < hash.length; i++) mismatch |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
        return mismatch === 0;
    }
    return Object.freeze({ initial, checked, validate, cents, money, id, apply, createPin, verifyPin, own });
});
