const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = file => fs.readFileSync(path.join(__dirname, "../js", file), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
function fixture() {
    const chats = ["a", "b"].map(id => ({ id, realName: id, remarkName: id, myName: "me", activeArchiveId: "first", maxMemory: 20, history: [], memoryJournals: [], persona: "original" }));
    const elements = new Map(), timers = [], toasts = [], bubbles = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: "", dataset: {}, style: {}, hidden: true, textContent: "", classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener(name, fn) { this[name] = fn; }, querySelector() { return element(id + "child"); }, setAttribute() {}, removeAttribute() {}, focus() {}, cloneNode() { return element(id + "clone"); }, parentNode: { replaceChild() {} } });
        return elements.get(id);
    };
    const c = vm.createContext({ db: { characters: chats, groups: [], myStickers: [], apiSettings: { url: "https://fake.invalid", key: "fake", model: "test", provider: "newapi" } },
        window: {}, document: { getElementById: element, addEventListener() {} }, console: { log() {}, warn() {}, error() {} },
        currentChatId: "a", currentChatType: "private", currentQuoteInfo: null, currentTransferMessageId: null, isGenerating: false, isInMultiSelectMode: false,
        editingMessageId: null, currentPage: 1, longPressTimer: null, selectedMessageIds: new Set(), Event, AbortController, Blob, File, structuredClone,
        setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
        getReplyBtn: {}, regenerateBtn: {}, typingIndicator: { style: {} }, chatRoomTitle: {}, messageArea: { querySelector() { return null; } }, messageInput: { value: "", dispatchEvent() {}, focus() {} },
        AudioManager: { unlock() {} }, triggerHapticFeedback() {}, showPanel() {}, renderMessages() {}, renderChatList() {}, saveData: async () => {},
        showToast: text => toasts.push(text), addMessageBubble: (...args) => bubbles.push(args), generatePrivateSystemPrompt: () => "original prompt", filterHistoryForAI: (_, history) => history, showApiError: e => toasts.push(e.message),
    });
    for (const file of ["modules/chat_ops.js", "modules/chat_features.js", "modules/chat_ai.js", "chat.js", "modules/chat_archives.js", "modules/storage.js", "modules/sticker.js"]) vm.runInContext(source(file), c);
    vm.runInContext("AudioManager.unlock = () => {};", c);
    c.ensureAllChatArchives();
    for (const item of elements.values()) item.removeAttribute = () => {};
    c.recalculateChatStatus = () => {};
    return { c, chats, element, timers, toasts, bubbles };
}
for (const [name, args, length] of [["sendMyVoiceMessage", ["voice"], 1], ["sendMyPhotoVideo", ["photo"], 1], ["sendMyTransfer", [10, "gift"], 1], ["sendMyGift", ["gift"], 1], ["sendTimeSkipMessage", ["next day"], 2]]) {
    test(name + " fixes chat at send time and never renders into the next chat", async () => {
        const f = fixture(); const pending = f.c[name](...args); f.c.currentChatId = "b"; f.timers.shift()(); await pending;
        assert.equal(f.chats[0].history.length, length); assert.equal(f.chats[1].history.length, 0); assert.equal(f.bubbles.length, 0);
    });
    test(name + " cancels after archive switch and restores failed append", async () => {
        for (const mode of ["archive", "failure"]) {
            const f = fixture(); f.c.saveData = async () => { f.c.syncChatActiveArchive(f.chats[0]); throw Error("quota"); };
            const pending = f.c[name](...args);
            if (mode === "archive") { f.chats[0].activeArchiveId = "new"; f.chats[0].history = []; }
            f.timers.shift()(); await pending; assert.equal(f.chats[0].history.length, 0);
            assert.equal(f.chats[0].archives?.[0]?.data.history.length || 0, 0);
        }
    });
}
test("group gifts retain selected recipients during delayed send", async () => {
    const f = fixture(); const group = { id: "g", me: { nickname: "me" }, members: [{ id: "one", realName: "one" }, { id: "two", realName: "two" }], history: [] };
    f.c.db.groups = [group]; f.c.currentChatId = "g"; f.c.currentChatType = "group"; f.c.currentGroupAction = { recipients: ["one"] };
    const pending = f.c.sendMyGift("cake"); f.c.currentGroupAction.recipients = ["two"]; f.timers.shift()(); await pending;
    assert.equal(group.history.length, 1); assert.match(group.history[0].content, /one/);
});
test("image compression retains its original chat before await", async () => {
    const f = fixture(); let compressed; f.c.compressImage = () => new Promise(resolve => compressed = resolve); f.c.setupImageRecognition();
    const sending = f.element("image-upload-input").change({ target: { files: [{}] } });
    f.c.currentChatId = "b"; compressed("data:image/png;base64,AA=="); await sending;
    assert.equal(f.chats[0].history.length, 1); assert.equal(f.chats[1].history.length, 0); assert.equal(f.bubbles.length, 0);
});
test("independent generations preserve B stop control when A finishes; return restores controls", async () => {
    const f = fixture(), finishes = [], signals = [];
    f.c.fetch = (_, init) => { signals.push(init.signal); return new Promise(resolve => finishes.push(resolve)); };
    f.c.handleAiReplyContent = async () => {};
    const a = f.c.getAiReply("a", "private"); await tick(); f.c.currentChatId = "b"; f.c.refreshChatGenerationUI();
    const b = f.c.getAiReply("b", "private"); await tick();
    assert.notEqual(signals[0], signals[1]);
    await f.c.getAiReply("b", "private", true); assert.equal(signals.length, 2);
    f.c.currentChatId = "a"; f.c.refreshChatGenerationUI(); assert.equal(f.c.getReplyBtn.disabled, true);
    f.c.currentChatId = "b"; f.c.refreshChatGenerationUI();
    const response = { ok: true, json: async () => ({ choices: [{ message: { content: "reply" } }] }) };
    finishes[0](response); await a; assert.equal(f.c.isGenerating, true); assert.equal(f.element("stop-ai-btn").hidden, false);
    assert.equal(f.c.stopAiReply(), true); assert.equal(signals[1].aborted, true); assert.equal(signals[0].aborted, false);
    finishes[1](response); await b; assert.equal(f.c.isGenerating, false); assert.equal(f.element("stop-ai-btn").hidden, true);
});
test("failed text send restores quote, draft, time divider and timestamp without overwriting new draft", async () => {
    for (const newDraft of ["", "new draft"]) {
        const f = fixture(), chat = f.chats[0]; chat.history.push({ id: "quoted", role: "assistant", content: "source", timestamp: 1 });
        f.c.db.apiSettings.timePerceptionEnabled = true; chat.lastUserMessageTimestamp = 1; f.c.formatTimeGap = () => "a day";
        f.c.startQuoteReply("quoted"); f.c.messageInput.value = "old draft";
        f.c.saveData = async () => { f.c.syncChatActiveArchive(chat); f.c.messageInput.value = newDraft; chat.history.push({ id: "arrival", role: "assistant", content: "later" }); throw Error("quota"); };
        await f.c.sendMessage();
        assert.deepEqual(chat.history.map(m => m.id), ["quoted", "arrival"]); assert.equal(chat.lastUserMessageTimestamp, 1);
        assert.equal(f.c.messageInput.value, newDraft || "old draft"); assert.equal(chat.archives[0].data.history.length, 1);
        if (!newDraft) assert.equal(f.c.currentQuoteInfo.id, "quoted");
    }
});
test("failed edit restores source only and preserves newer concurrent edits and arrivals", async () => {
    for (const newer of [false, true]) {
        const f = fixture(), chat = f.chats[0]; const message = { id: "edit", role: "assistant", content: "old" }; chat.history.push(message);
        f.c.editingMessageId = "edit"; f.c.isRawEditMode = true; f.element("message-edit-textarea").value = "edited";
        f.c.saveData = async () => { f.c.syncChatActiveArchive(chat); if (newer) message.content = "newer"; chat.history.push({ id: "arrival", content: "arrival" }); throw Error("quota"); };
        await f.c.saveMessageEdit(); assert.equal(chat.history[0].content, newer ? "newer" : "old"); assert.equal(chat.history[1].id, "arrival");
        assert.equal(chat.archives[0].data.history[0].content, "old");
    }
});
test("failed save after archive switch restores original archive and leaves active archive alone", async () => {
    const f = fixture(), chat = f.chats[0]; chat.history.push({ id: "old", content: "old" }); f.c.ensureChatArchives(chat);
    const state = f.c.beginChatMutation(chat, "private", [chat.history[0]]); chat.history[0].content = "edited";
    f.c.saveData = async () => { f.c.syncChatActiveArchive(chat); chat.activeArchiveId = "other"; chat.history = [{ id: "other", content: "other" }]; throw Error("quota"); };
    assert.equal(await f.c.saveChatMutation(state), false); assert.equal(chat.history[0].content, "other"); assert.equal(chat.archives[0].data.history[0].content, "old");
});
test("failed withdrawal and sticker send restore message and synchronized archive", async () => {
    const f = fixture(), chat = f.chats[0]; chat.history.push({ id: "original", role: "user", content: "text", timestamp: Date.now() });
    const before = plain(chat.history); f.c.saveData = async () => { f.c.syncChatActiveArchive(chat); throw Error("quota"); };
    await f.c.withdrawMessage("original"); assert.deepEqual(plain(chat.history), before);
    const sticker = { id: "s", name: "happy", data: "image" }; f.c.db.myStickers = [sticker]; await f.c.sendSticker(sticker);
    assert.deepEqual(plain(chat.history), before); assert.deepEqual(plain(chat.archives[0].data.history), before); assert.equal(sticker.lastUsedTime, undefined);
});
test("UTF-8 estimates classify archived history, memories, vectors and API configuration", async () => {
    const f = fixture(); f.c.dexieDB = null;
    for (const value of ["你好", "🌸", false, 0, null]) assert.equal(f.c.stringifySize(value), Buffer.byteLength(JSON.stringify(value)));
    const before = await f.c.calculateStorageSize(), chat = f.chats[0];
    chat.archives.push({ id: "x", data: { history: [{ content: "历史" }], memoryJournals: [{ content: "记忆" }], memoryVectorIndex: { x: [1, 2, 3] } } });
    f.c.db.vectorMemoryApiSettings = { model: "嵌入" }; const after = await f.c.calculateStorageSize();
    assert.equal(after.contacts, before.contacts); assert.ok(after.chats > before.chats); assert.ok(after.settings > before.settings);
    assert.equal(after.total, Object.entries(after).filter(([key]) => key !== "total").reduce((sum, [, value]) => sum + value, 0));
});
test("thinking cleanup keeps the live request associated with stop controls", async () => {
    const f = fixture(), chat = f.chats[0];
    for (let i = 0; i < 50; i++) chat.history.push({ id: "thinking" + i, role: "assistant", content: "<thinking>old</thinking>", isThinking: true });
    const history = chat.history;
    f.c.db.cotSettings = { enabled: true };
    f.c.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "<thinking>new</thinking>[a的消息：hello]" } }] }) });
    f.c.getMixedContent = () => [{ type: "text", content: "[a的消息：hello]" }];
    const pending = f.c.getAiReply("a", "private");
    await tick();
    assert.equal(chat.history, history); assert.equal(chat.history.filter(m => m.isThinking).length, 50);
    assert.equal(f.c.stopAiReply(), true); await pending; assert.equal(f.c.isGenerating, false);
});
test("failed manually inserted message and transfer response restore source records", async () => {
    const f = fixture(), chat = f.chats[0];
    chat.history.push({ id: "anchor", role: "assistant", content: "original", transferStatus: "pending" });
    f.c.saveData = async () => { f.c.syncChatActiveArchive(chat); throw Error("quota"); };
    vm.runInContext('isAddingMessageMode = true; addingAfterMessageId = "anchor";', f.c);
    f.element("message-edit-textarea").value = "inserted"; await f.c.saveMessageEdit();
    assert.equal(chat.history.length, 1); assert.equal(chat.archives[0].data.history.length, 1);
    f.c.currentTransferMessageId = "anchor"; await f.c.respondToTransfer("received");
    assert.equal(chat.history.length, 1); assert.equal(chat.history[0].transferStatus, "pending");
    assert.equal(chat.archives[0].data.history[0].transferStatus, "pending");
});
test("reroll rejects a switched chat and restores removed replies after save failure", async () => {
    for (const switched of [false, true]) {
        const f = fixture(), chat = f.chats[0];
        chat.history.push({ id: "user", role: "user", content: "question" }, { id: "answer", role: "assistant", content: "answer" });
        f.c.showRegenerateGuidanceDialog = async () => { if (switched) f.c.currentChatId = "b"; return "change direction"; };
        let calls = 0; f.c.fetch = async () => { calls++; throw Error("should not call"); };
        f.c.saveData = async () => { f.c.syncChatActiveArchive(chat); throw Error("quota"); };
        await f.c.handleRegenerate();
        assert.deepEqual(chat.history.map(m => m.id), ["user", "answer"]); assert.equal(calls, 0);
    }
});
test("hide, restore and range-delete failures restore only selected records", async () => {
    const f = fixture(), chat = f.chats[0];
    chat.history.push({ id: "one", content: "one" }, { id: "two", content: "two" });
    f.c.setupDeleteHistoryChunk(); f.element("delete-range-start").value = "1"; f.element("delete-range-end").value = "2";
    f.c.saveData = async () => { f.c.syncChatActiveArchive(chat); throw Error("quota"); };
    await f.element("btn-block-range").click(); assert.ok(chat.history.every(m => !m.isContextDisabled));
    chat.history.forEach(m => m.isContextDisabled = true);
    await f.element("btn-restore-range").click(); assert.ok(chat.history.every(m => m.isContextDisabled));
    await f.element("btn-delete-range").click(); await f.element("confirm-delete-chunk-btn").click();
    assert.deepEqual(chat.history.map(m => m.id), ["one", "two"]); assert.equal(chat.archives[0].data.history.length, 2);
});

test("large failed deletion restores original order and keeps concurrent arrivals", async () => {
    const f = fixture(), chat = f.chats[0];
    for (let i = 0; i < 10000; i++) chat.history.push({ id: "m" + i, content: "story" });
    const state = f.c.beginChatMutation(chat, "private");
    chat.history.splice(1, 9998);
    const history = chat.history;
    f.c.saveData = async () => {
        chat.history.splice(1, 0, { id: "arrival", content: "new" });
        throw Error("quota");
    };
    assert.equal(await f.c.saveChatMutation(state), false);
    assert.equal(chat.history, history);
    assert.equal(chat.history[1].id, "arrival");
    assert.deepEqual(chat.history.filter(m => m.id !== "arrival").map(m => m.id), state.before.map(m => m.id));
});
