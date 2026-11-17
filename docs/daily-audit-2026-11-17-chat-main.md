# 聊天主链与提示词续审：重回确认过期保护

日期：2026-11-17（Asia/Shanghai）。本批起点 test 41037d0be75e47a786d8b1a880320b285b8b9c15；Git 2.55.0.windows.5。本报告记录本地实施与验证，提交、推送、部署分别以本批 outputs/release.json 和最终状态.md 为准。

## 范围与结论

沿用用户授权：确认二改引入的问题做最小修复，先交 test；1900 已有问题只记录，main 必须等待本批用户确认。

连续读完 js/modules/chat_ai.js 原 1–1559 行，补丁后复核 1503–1540 行；chat_ai_prompt.js 1–614 行。核对发送目标、保存回滚、图片异步发送和相关测试入口，未把局部阅读的 chat_ops/chat_features 等记为完整重审。

本批确认并修复一项二改问题。提示词模块未新增确认问题；不代表所有运行条件都无问题。1900 提示词、历史窗口、上下文及回复顺序、原版和第三方美化、音乐、ID 卡、已发送卡片均未修改。

## ISSUE-RG-20261117-01 · P2 · 重回面板等待期间，新消息可能被旧确认删除

- 最危险的问题：二改新增的修改方向面板引入等待；等待结束仅验证目标、最后用户消息 ID 和生成状态，没有验证待替换内容是否已变化。已确认，不是新原生 Security 定级。
- 可能导致的后果：先选择图片，压缩尚未完成时打开重回面板；图片发送完成后再确认重回，旧逻辑会删除旧回复以及新图片，并把删除结果写入 IndexedDB。编辑回复、撤回、晚到的助手消息也可能被旧确认覆盖。
- 具体位置：chat_ai.js 1510–1520，handleRegenerate → showRegenerateGuidanceDialog → history.splice；图片入口 chat_features.js 610–621、636–659。git blame 显示 1047033f 引入异步面板，efa5fd4d 添加目标/ID 检查。真实 1900 chat_ai.js 1204 起的 handleRegenerate 在删除前没有面板等待，因此不存在这条面板竞态。原版保存后其他等待路径不在本条结论内。
- 推荐与已实施修改：打开面板前固定最后一条用户消息至结尾的内容；确认后若有新增、删除、编辑或撤回，则保留当前聊天，提示重新打开重回；没有变化时继续原流程。不禁用正常图片发送，不改面板、不新增平台 API、依赖或数据迁移。
- 修改后的代码（已写入）：

```js
const sourceTurn = JSON.stringify(chat.history.slice(lastUserMessageIndex));
const guidance = await showRegenerateGuidanceDialog();
// 原有取消、目标、生成状态和消息 ID 检查继续保留。
if (JSON.stringify(chat.history.slice(lastUserMessageIndex)) !== sourceTurn) {
    showToast('聊天内容已有变化，请重新打开“重回”后再试');
    return;
}
```

## 本轮证据

证据目录：outputs/daily-audit-20261117-chat-main/。

- chat_regenerate_safety.test.cjs：新增 20 项；补丁前 14 失败、6 通过，补丁后全部通过。私聊与群聊分别覆盖新 user/assistant、编辑源问题和回复、撤回、移除、图片 parts 变化，以及正常确认、取消、切存档。
- targeted-after.log：67 项相关测试通过，0 失败/跳过；包含上述新增 20 项，不相加。
- full-tests.log：配置真实 UVU_1900_ROOT 后 npm test 1576 通过，0 失败/跳过。首次忘记为全量进程设置基线路径导致检查失败，补齐环境后重跑，未弱化断言或跳过基线。
- strict-1900.log：严格真实 1900 对照 38 通过，0 失败/跳过；与全量有重叠。
- chat_regenerate_guard_browser.cjs：完整应用、真实图片输入/压缩/原重回按钮及 IndexedDB；320×740 和 390×740 均通过，保留图片和旧回复、无额外回复请求、提示可见、pageerror 为 0。接口执行入口使用隔离计数替代，不访问真实收费 API。
- browser-before/ 与 browser-explicit-before/：旧代码在两个宽度均实际删除新图片，内存和数据库只剩原用户消息，调用生成 1 次；断言失败。后者显式使用旧提交 41037d0 的原 handleRegenerate 并重新绑定真实按钮，不使用易漂移的 HEAD。
- browser-final/checks.json、after-320.png、after-390.png：修复后两宽度结果及截图；已查看 320px 截图。测试曾因扩展菜单未打开、新手引导遮挡而中断，修正测试步骤后才取得有效前后反证，没有将环境问题算作产品 bug。外部头像被隔离环境拦截，不把测试截图缺图误报为新增缺陷。
- node --check 和 git diff --check 通过。补丁仅 5 行业务代码；两份测试随补丁提交，outputs 不提交。

## 覆盖与剩余

按 Git 跟踪 js/css/html/mjs/cjs，排除 tests/ 与 js/vendor/，重新枚举 206 路径并逐个比较 SHA-256。194 份旧证据在本批开始时哈希未变化；本批新增两份完整源码复核后为 196/206，10 路径待重审。是有限源码证据计数，不是问题数、全仓覆盖率或运行验收。

待重审：css/chat.css、css/modules/lenso_panels.css、index.html、js/chat.js、js/contacts.js、js/group_chat.js、js/modules/chat_ops.js、js/modules/chat_render.js、js/ui.js、js/utils.js。下一起点 chat_ops.js；本批只完整阅读其 1–158 行，其他位置仅搜索。

Modern Web Guidance 检索并完整读取 dialog 指南，核对确认与取消语义；本补丁是数据过期保护，没有采用新弹窗 API，因此未迁移现有面板或强加 polyfill。没有新 legacy-scan 或 Codex Security 扫描，不改封存原生产物。浏览器证据来自 Playwright，不能冒称 Chrome DevTools MCP 检查。

## 未验证、回退与下一步

真实手机键盘、全部第三方主题、真实 API/账号、后台和 Service Worker、用户试用未验证。本批没有改变 CSS，既有美化兼容仅能据差异确认未改，不能称全主题实测。

无数据迁移；若需要回退，正常 revert 本批提交并重跑相关和严格 1900 检查，不覆盖个人存档。自检后正常推送 test 并核验线上标记与资源；main 仍等待用户针对本批结果明确确认。
