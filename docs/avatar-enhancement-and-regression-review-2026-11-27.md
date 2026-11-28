# 头像功能完善与 1900 回归审查（2026-11-27）

## 范围与基线

- UvU：`main`，开始时 HEAD 与 `origin/main` 均为 `01193d5e2fbd9e8f3f300bae87a0449cb9f41a0e`；既有未跟踪 `outputs/` 保留。
- 1900 原件：`C:\Users\15271130817\Desktop\1900版uwu`。
- 当前仓库有 945 个 Git 跟踪文件；其中 JS/CSS/HTML 237 个。1900 目录有 89 个对应 JS/CSS/HTML 文件，89 个在路径上对应，66 个与当前版本内容不同，148 个是当前版新增文件。路径重合与差异统计不是逐行审阅完成证明。
- 本轮源码审阅实际围绕 `js/modules/character_avatar.js` 的权限、候选、判断、确认、持久化、刷新入口，及 `sticker_assist.js` 的图片识别提示词；并抽查头像涉及的 `chat_render.js`、`settings_chat.js`、`storage.js`、`chat_archives.js`。**未完成 945 个跟踪文件或 89 个共有文件的逐行审阅。**
- 头像模块 600 行。当前文件 SHA-1：`d28c38a9dd50cb0e5965ad64ba3986e7767e13b7`。

## 本轮实现

- 新增两个独立权限，默认关闭：角色可建议用户换头像；角色可把用户实际发来的图片裁成正方形头像给自己用。
- 用户头像提议固定要求用户确认，即便旧的角色头像策略为“自动更换”也不会自动改用户头像；仅允许私聊。
- 裁剪只接受真实用户消息里的图片候选，坐标必须为 0–1 的有效范围；单独让识图模型输出裁剪区域，先生成真实裁剪预览，确认后才应用。图片画布导出失败、存档/消息/人设/头像变化时丢弃结果。
- 未改 1900 在线提示词、历史范围、世界书、上下文顺序、回复顺序或请求构造。新逻辑仍在独立头像辅助判断支路中。

## Bug 与风险清单

### 已确认 bug

- 本轮实审的头像路径中没有复现到已确认的用户可见 bug。新增的两项行为经过针对性自动测试；这不等于所有头像边界都已证明无 bug。

### 待决定的功能缺口

- 用户头像更换目前没有单独的撤销历史入口；用户仍可从原有资料设置手动改回。若希望角色换错时一键恢复，应另加受当前聊天/存档约束的撤销记录与测试。

### 自动化失败，尚不能定为产品 bug

- 初次 `npm run test:browser` 为 106/134，28 失败；续跑修正头像测试夹具后，最新结果为 107/134、27 失败，日志在 `outputs/browser-checks-2026-11-27T14-16-39-431Z/summary.json`。与 2026-11-26 的 20 个失败文件对比：19 个仍失败；`reported_ui_regressions_browser.cjs` 因缺少用户图片候选来源及未展开候选区而失败，补齐测试夹具后通过；另有 8 个此前未失败的测试文件。`theme_focus_compat_browser.cjs` 单独设置 `UVU_1900_ROOT` 后通过，整套运行时该项因未传原版目录而失败。
- 8 个本次新出现的失败文件：`approved_atlas_browser.cjs`（尝试点击隐藏的向量 API 面板）、`chat_thinking_forward_browser.cjs`、`draft_layout_browser.cjs`、`legacy_media_group_browser.cjs`、`mcp_compact_layout_browser.cjs`、`memo_modal_browser.cjs`、`memory_fact_browser.cjs`、`memory_quality_browser.cjs`。目前日志显示有旧布局/文案断言、隐藏元素点击、等待超时和一个红包存档检查；均未证明为产品 bug。红包测试夹具将 `currentChatType` 设为群聊，却让私聊浮层持续显示并拦截点击；改用真实群聊点击时仍被此浮层遮挡，因此该条目前只能归为测试夹具未建立正确场景，不能断言群聊发包功能有问题。`theme_focus` 不属于新出现项目，按配置重跑通过。
- 19 个连续失败的文件：`approved_sheets_browser.cjs`、`audit_nov12_browser.cjs`、`audit_repair_browser.cjs`、`browser_notification_environment_optimizations.cjs`、`browser_notification_holiday_followup.cjs`、`calendar_import_browser.cjs`、`calendar_important_browser.cjs`、`calendar_life_browser.cjs`、`chat_edit_session_browser.cjs`、`legacy_priority_repairs_browser.cjs`、`lenso_panels_browser.cjs`、`memo_review_priority_browser.cjs`、`message_delete_rollback_browser.cjs`、`optimization_stickers_browser.cjs`、`panel_evidence_browser.cjs`、`panel_flow_refinement_browser.cjs`、`panel_help_tabs_browser.cjs`、`remaining_optimizations_browser.cjs`、`theme_focus_compat_browser.cjs`。
其余失败仍需结合页面和对应代码核验，不能直接认定产品 bug或归因到头像补丁。
- 后续复核发现 `tests/reported_ui_regressions_browser.cjs` 的头像部分测试夹具没有启用用户图片候选来源，也没有展开“候选图片”折叠区；它等待的操作项因此处于隐藏状态。补齐夹具并展开折叠区后，该浏览器测试通过。其余 27 个失败项仍未逐项验证，不等于 27 个已确认产品 bug。

## 验证

- 头像逻辑：`tests/derived_features.test.cjs` 头像相关 30/30 通过（含新权限默认关闭、裁剪坐标范围、用户头像须确认、裁剪后确认）。
- 头像 UI：`tests/optimization_media_avatar_browser.cjs` 通过；390×844 Chromium 页面验证已有候选、权限控件、设置保存和撤销 UI。
- 浏览器裁剪：Chromium 生成 48×48 PNG 的独立快速验证通过；这验证裁剪生成，不覆盖真实视觉识别 API 返回质量。
- 完整 Node：设置 `UVU_1900_ROOT=C:\Users\15271130817\Desktop\1900版uwu` 和普通开发允许缺失基线跳过标记后，1,897/1,897 通过。首次未设置基线路径的运行失败是环境配置缺失，设置后复跑成功。
- 严格 1900：`npm run test:1900` 82/82 通过。
- `node --check` 涉及 JavaScript 文件通过；保留仓库原有 CRLF 行尾规则后，`git -c core.whitespace=cr-at-eol diff --check` 通过。
- 本轮续验：头像相关逻辑 58/58 通过，完整 Node 套件 1,897/1,897 通过，严格 1900 对照 82/82 通过；头像关联的 `optimization_media_avatar_browser.cjs` 与 `reported_ui_regressions_browser.cjs` 均通过。最新全浏览器整套为 107/134；剩余 27 项失败尚未逐项追到产品行为。
- 未验证：付费/真实视觉 API 的裁剪坐标准确性、手机实测、第三方美化套用、其余浏览器失败归因、全仓逐行审查。源码测试不等于真实聊天端验收。

## 2026-11-27 · 回归审查续记（当前 main：f3d8f6fba11a2db1edf08dfcc3dcd967542bfabe）

- 版本：本次复核时 `main` 与 `origin/main` 均为 `f3d8f6fba11a2db1edf08dfcc3dcd967542bfabe`；工作区仅有原有未跟踪 `outputs/`。未改产品源码。
- 新完成的整文件审阅：`js/modules/memory_fact_review.js` 共 178 行，SHA-256 `912695c906cff1aa1fa98f04d577533e1d64f606ccc7f01adeabd357347a9d27`；1900 原版无同路径文件，属于二改功能。
- 新确认问题：人工确认“新旧变化”等关系后，结果只在从当前选中那篇记忆计算的方向命中；切到配对的另一篇记忆时，行顺序反转，关系指纹随之改变，界面显示“未确认”。位置：`memory_fact_review.js:68-72`，判断关系匹配在 `70-71`。隔离数据复现确认。建议按稳定 key 顺序规范化两条事实后再生成指纹，并补充从新旧两侧打开都显示同一确认状态的测试。未修改代码。
- 失败测试核验：`message_delete_rollback_browser.cjs` 的重复 arrival 是测试钩子每次 IndexedDB 更新回调都重复注入 arrival；独立模拟确认回调4次时会生成4份，而仅注入一次时两种删除路径的回滚和重试都只保留一份，故此前该红测不能作为产品 bug。聊天编辑关闭状态、记忆关系立即显示以及旧自动总结面板选择器也存在测试场景/断言与当前行为不一致的迹象，未将其列为已确认产品问题。其余失败未审完。
- 1900 对照：本次重新执行 `UVU_1900_ROOT=C:\Users\15271130817\Desktop\1900版uwu npm run test:1900`，82/82 通过；这只覆盖该套严格对照用例，不表示全仓代码审阅完成。之前完整浏览器套件 107/134（27 失败）来自既有输出，未在本次重跑。
- 覆盖边界：启动核对了聊天请求与提示词模块入口、文件哈希和基线是否存在，但没有完成 `chat_ai.js` 等文件的连续逐行审阅，故不计为已审。全仓 945 个跟踪文件仍未逐行完成；27 个浏览器失败仍需逐项归因。
- 报告继续跟踪至 TODO-20261127-01 / LOOP-20261127-01。新增问题同步至 UvU ISSUES 索引。

## 2026-11-28 · 记忆核对修复与后续源码审查

- 起点：main 与 origin/main 均为 fd2a4b9a63e9112ef5cedb6ee3a29216601cdc3a；outputs/ 保留，不暂存。
- 已修复 ISSUE-MEMORY-FACT-20261127-01：memoryFactSuggestions() 在生成关系指纹前按稳定事实 key 排序，避免从配对记忆两侧查看时顺序相反而丢失决定。原文和历史不变。tests/memory_fact_review.test.cjs 增加旧/新两侧显示与撤销断言；tests/memory_fact_browser.cjs 等待页面状态后再断言，避免保存与渲染之间的测试竞态。
- 验证：Node 全量 1897/1897；严格 1900 对照 82/82；记忆关系专项 6/6；语法检查与 git -c core.whitespace=cr-at-eol diff --check 通过。修改后的浏览器专项能够越过关系显示断言，随后因旧 .draft-vector-more 定位器失败；这一处需区分旧测试流程和 UI 控件问题。
- 本批继续对照审阅 js/modules/chat_ai_prompt.js 全607行、js/modules/chat_ai_call.js 全572行，并看了 video_call.js 的通话总结存档保护调用段。当前改动差异中，聊天提示词内容没有改写；call_1900_compat.test.cjs 对48组关闭新功能的请求正文、摘要与回复回调进行严格比较。没有发现本批新的已确认回复流程回归。文件 SHA-256：prompt 10654d1ceec0e5cc6818f0e85a57584b8e28422288fb00ae0a557a1df491e10a；call 4344a69d8d4bdf5e684c07691dd4792663e8608ffd18781aa4caa50739009add。
- 新的源码/UI发现见 ISSUE-VECTOR-UI-20261128-01：当前自动总结向量页未提供 VectorMemoryTools.setupForm() 要求的 .vector-memory-fieldset，高级向量检索配置不能从界面编辑。本轮仅记录，没有更改界面或源码。
- 2026-11-28 浏览器套件最新目录：outputs/browser-checks-2026-11-28T04-36-36-485Z；原始汇总 108/134 通过、26 项失败。新记忆关系浏览器用例本轮通过；theme_focus_compat 因整套运行没有传 UVU_1900_ROOT 失败，单独补上 1900 路径后通过，因此其余 25 项仍待逐项归因。失败测试名：approved_atlas_browser、approved_sheets_browser、audit_nov12_browser、audit_repair_browser、browser_notification_environment_optimizations、browser_notification_holiday_followup、calendar_import_browser、calendar_important_browser、calendar_life_browser、chat_edit_session_browser、chat_thinking_forward_browser、draft_layout_browser、legacy_media_group_browser、legacy_priority_repairs_browser、lenso_panels_browser、mcp_compact_layout_browser、memo_modal_browser、memo_review_priority_browser、memory_quality_browser、message_delete_rollback_browser、optimization_stickers_browser、panel_evidence_browser、panel_flow_refinement_browser、panel_help_tabs_browser、remaining_optimizations_browser。
- 对已能解释的失败不按产品缺陷登记：chat_edit_session 复现的是测试明确标出的 1900 原有“保存后编辑窗仍开”行为；message_delete_rollback 重复 arrival 由测试 hook 多次注入造成，既有隔离复核证实产品回滚路径保留一次；calendar_import 的场景停在新版页面找不到旧“日历设置”定位器，导入断言并未执行；chat_thinking_forward 只因浏览器 computed CSS 值从期望的 flex-end 返回 flow-end，需结合视觉/规范再判，当前未定为缺陷。其他失败仍未逐项核验。
- 当前源码版本复核：main 与 origin/main 为 fd2a4b9a63e9112ef5cedb6ee3a29216601cdc3a；当前 946 个 Git 跟踪文件，其中 JS/CSS/HTML 237 个。与1900有89个同路径文件：23个字节相同、66个不同；148个当前文件在1900中无同路径基线。不能据这些统计声称全仓逐行完成。
- 完整逐行读完并复核 js/modules/chat_ai.js 1–1486 行，SHA-256 3304F15D9A3022E1646F286272D0F7E1A328000E8FC1539B5317D87845FB275E，并检查与1900的完整差异；通知偏移风险经控制流核实未找到可达漏掉新回复通知的路径，不新增缺陷。全量 Node 1897/1897、记忆事实专项 6/6、严格1900对照82/82；记忆事实专项浏览器通过，隐藏头像思维链浏览器通过。严格对照只说明对应自动化覆盖，不等于代码全无问题。
- 仍确认一个独立二改界面问题：ISSUE-VECTOR-UI-20261128-01，向量记忆高级设置容器缺失，暂未修改。回复提示词、1900历史范围、上下文顺序及回复流程未改；回归测试82/82通过。
- 记忆事实关系修复及审查报告已推送 main：修复代码和回归测试提交 6c841e2f08ce14cae785ea8e7acc0d5f16e3c0d1；随后 fetch 核对 main 与 origin/main 一致。继续检查剩余代码与25项浏览器失败，先核验场景/定位器和触发路径，再决定是否属于产品 bug。全仓逐行回归审查仍未完成。

## 2026-11-28 · AirDrop 逐行对照审查

- 逐行审阅当前 js/modules/chat_ai_airdrop.js 共615行，SHA-256 3C0883A76C02D3402E862F9D7E56830B35205BAA11A5E7A699CD2886DB641D84；对照用户1900同路径文件共499行，SHA-256 AB357F70AB65422C3D0DB9DA2A2FAD860B43EF399C6268D631BCFEAF6822BB8A。完整差异复核显示当前版增加聊天/存档归属检查、重复任务抑制、异步结果隔离、媒体保存校验及数据库删除竞争保护；当前版也修正1900中的 Gemini 多角色提示词组装、聊天补全地址处理、API响应解析及敏感提示词全文日志。
- 审阅 chat_ai_airdrop.js 对角色头像支路的调用：仅在生图成功保存后对仍在角色列表、原存档仍有效的私聊角色启动 checkCharacterAvatar；头像候选还要匹配当前存档、来源消息、图片字段和权限。测试套件中的 airdrop_console_browser 与头像路径专项通过。
- 本文件无新增已确认缺陷；没有改源码。整套浏览器测试其他25项仍待归因，946个跟踪文件的全仓逐行回归审查仍未完成。下一批按源码覆盖表继续，并只将有明确行为差异及复现条件的命中登记为问题。
