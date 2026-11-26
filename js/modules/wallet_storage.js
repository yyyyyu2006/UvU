/* Wallet changes commit with their chat records in the same IndexedDB transaction. */
(() => {
    'use strict';
    const key = 'uvuWallet';
    const model = globalThis.UvUWalletLedger;
    const state = () => model.checked(db[key]);
    const matches = (a, b) => a === b || (!!a && !!b && a.hash === b.hash && a.salt === b.salt);
    async function record(next) {
        const write = async () => {
            const table = dexieDB.globalSettings;
            await assertPersistedRecordsCurrent(table, [{ key }], 'key');
            const row = { key, value: next };
            await table.put(row);
            stagePersistedRecords(table, [row], 'key');
            afterDataPersistenceCommit(() => { db[key] = next; });
        };
        if (typeof Dexie !== 'undefined' && Dexie.currentTransaction) return write();
        return runDataPersistence(() => dexieDB.transaction('rw', dexieDB.globalSettings, write));
    }

    async function commit(op, proof, prepareChat) {
        if (!dexieDB) throw new Error('数据尚未加载');
        let undo;
        try {
            return await runDataPersistence(() => dexieDB.transaction('rw',
                prepareChat ? dexieDB.tables : [dexieDB.globalSettings], async () => {
                    const table = dexieDB.globalSettings;
                    await assertPersistedRecordsCurrent(table, [{ key }], 'key');
                    const persisted = (await table.get(key))?.value;
                    if (proof !== undefined && !matches(model.checked(persisted).pin, proof)) {
                        throw new Error('支付密码已变化，请重新确认');
                    }
                    const next = op ? model.apply(persisted, op) : persisted;
                    if (prepareChat) {
                        undo = prepareChat();
                        await saveData({ skipWalletSettlement: true });
                    }
                    if (op) await record(next);
                    return true;
                }));
        } catch (reason) {
            undo?.();
            throw reason;
        }
    }

    async function reconcile() {
        if (!db[key]?.pending?.length) return;
        let data = (await dexieDB.globalSettings.get(key))?.value;
        if (!data?.pending?.length || !model.validate(data)) return;
        const original = data;
        const histories = new Map();
        for (const payment of data.pending) {
            const group = payment.kind === 'packet';
            const cacheKey = (group ? 'g:' : 'p:') + payment.chatId;
            if (!histories.has(cacheKey)) histories.set(cacheKey, await (group ? dexieDB.groups : dexieDB.characters).get(payment.chatId));
            const chat = histories.get(cacheKey);
            const history = payment.archiveId == null || chat?.activeArchiveId === payment.archiveId
                ? chat?.history : chat?.archives?.find(item => item.id === payment.archiveId)?.data?.history;
            const message = history?.find(item => item.id === payment.messageId);
            if (!message || message.role !== 'user') continue;
            const op = { kind: 'settle', id: payment.id, amount: 0, title: '转账退回' };
            if (group) {
                if (message.type !== 'red-packet') continue;
                const share = model.cents(message.distributions?.user_me);
                const alreadyCredited = data.rows.some(row => row.id === 'share:' + payment.id);
                if (alreadyCredited && !message.isRevealed) continue;
                if (!alreadyCredited && (share > payment.amount || (!message.isRevealed && !share))) continue;
                op.amount = alreadyCredited ? 0 : share;
                op.title = '领取群红包';
                op.creditToBalance = true;
                op.keepPending = !message.isRevealed;
            } else {
                if (!['received', 'returned'].includes(message.transferStatus)) continue;
                op.amount = message.transferStatus === 'returned' ? payment.amount : 0;
            }
            try { data = model.apply(data, op); }
            catch (error) {
                // A full destination may block refund, but must not block ordinary chat saves.
                console.warn('Wallet settlement deferred:', error.message);
            }
        }
        if (data !== original) await record(data);
    }

    function stageChat(target, added, update) {
        if (!isChatTargetVisible(target)) throw new Error('聊天已切换，请重新操作');
        const history = target.history;
        const { chat, type } = target;
        if (update && (!history.includes(update.message) || update.message.transferStatus !== 'pending' ||
            update.message.isWithdrawn || update.message.content !== update.content)) throw new Error('转账已变化，请重新打开');
        added.forEach(message => {
            if (typeof prepareRelationshipMessage === 'function') prepareRelationshipMessage(chat, message, type);
        });
        if (update) update.message.transferStatus = update.status;
        history.push(...added);
        return () => {
            for (const message of added) {
                const index = history.indexOf(message);
                if (index !== -1) history.splice(index, 1);
            }
            if (update?.message.transferStatus === update?.status && update) update.message.transferStatus = 'pending';
            if (chat.history === history) syncChatActiveArchive(chat);
        };
    }

    globalThis.UvUWalletStorage = Object.freeze({ state, commit, reconcile, stageChat });
})();
