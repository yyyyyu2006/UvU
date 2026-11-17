# 2026-11-17 日常续审：日记来源、API 设置与剩余小模块

## 本批范围

- 起点 test/e8bcb4bff4ccd2af7f6d32e21786cc5d949265cd，Git 2.55.0.windows.5；重新 ls-remote 核实 test 同起点、main 仍为 15c7bc4be30c9bb51632cd79d5f5f4cb9b15d809。接手时两份本批未提交改动及原 outputs/ 保留，没有 reset/stash 或强推。
- 完整阅读 chat_features.js 1–1063、settings_api.js 1–608、journal.js 原1–920/修改后1–926；补齐前段阅读截断，再完整阅读 community.js 1–70、storage_html.js 1–112、status_regex_worker.js 1–12。其余入口、持久化、来源校验及调用关系仅作局部阅读，不扩大完整覆盖。
- 对206条 Git 跟踪自研 js/css/html/mjs/cjs（排除tests和js/vendor）重新计算精确字节哈希：168条有当前阅读证据，38条需重核。38是证据待核路径数，不是bug数，不代表从未读过。清单及行段在 outputs/daily-audit-20261117-journal-api/coverage.json。
- 使用 uvu-development、Agent Skills 审查/调试/Git规范；按需检索 Modern Web Guidance 的 js 指南并核对JSON持久化与异步边界。没有新依赖、Web API或机械现代化，没有新全仓legacy-scan或原生Codex Security扫描，封存安全报告保持原状。

## JR-20261117-01 · P2 · 日记页合并丢失二改来源权限，等待期间更改来源仍保存旧结果

- **状态/归属：** 已确认并最小修复。真实1900已有 journal.js 的旧合并入口；后续新增的酒馆/备忘录来源限制已接入记忆管理页，但旧日记页未接入，因此归为二改放大旧入口问题，不声称1900没有日记模块。
- **触发与影响：** 从回忆日记“管理→多选→合并”生成新日记，再收藏。原新日记没有 manualMergeSources，未批准/已撤回的来源可能成为普通可引用日记；删除原件后来源更不可追溯。另在合并API等待时修改正文、审核字段或删除来源，旧结果仍保存。影响范围是该合并结果后续的记忆引用，不是已证明的跨用户远程漏洞。
- **位置：** js/modules/journal.js 136–230，setupMemoryJournalScreen 内 mergeJournals；js/modules/auto_memory.js 194–211 已有递归来源校验；memory_library.js 的另一个保存入口已存来源，但不替换旧管理按钮。
- **处理：** 147行捕获所选来源的JSON快照；205–207行在API返回后拒绝已被删除/变更的来源；225–226行保存 manualMergeSources 和原角色/存档目标。复用现有递归权限检查，保留批准、通道和收藏约束。来源快照随数据保存，嵌套合并和删除原件也不抹掉来源限制。
- **保留：** 不改合并提示词、1900历史/回复顺序、模型选择、原件及收藏交互；不迁移旧数据，不修改美化/音乐/ID卡/已发送卡片。JSON快照与现有持久化/来源字段格式一致，不机械换成 structuredClone。
- **边界：** 用户主动选择内容进行合并仍会按原流程发送至其配置API；本补丁约束保存及后续记忆引用，不声称阻断这次主动合并的外发。历史已生成且没有来源字段的合并项不能可靠重建来源，本批未自动推断或清理。
- **已实施示例：** `manualMergeSources: JSON.parse(sourceSnapshot).map(source => ({ ...source, memorySourceTarget: source.memorySourceTarget || capturedTarget }))`，其中capturedTarget在真实代码中为启动时的chatId/archiveId。完整实现见journal.js 225–226行。

## API-20261117-01 · P2 · 原版拉取模型的晚到响应覆盖新接口选择（保留）

- **状态/归属：** 当前完整App已复现；真实1900的主/副API拉模型实现也缺少请求结束时的配置复核，归为1900已有，依保护约定记录待明确授权，不顺手修改。
- **触发：** 对旧接口拉模型，等待时将地址改为新接口并选择新模型，随后放行旧响应。主/副API的地址都仍为 new.invalid，但模型都被改回 old-model。没有实际连接外部API，使用隔离模拟返回。
- **位置：** settings_api.js 54–137（主）、376–418（副）；写入模型列表在104/402行附近。真实1900对应69–152、264–306行已有同类逻辑。
- **后果与建议：** 用户可能保存接口/模型不匹配配置，之后请求失败或用错模型。建议请求开始固定provider、完整地址、密钥和请求编号，返回/异常时复核，再更新下拉框；过期结果不清空新选择。建议未实施，也不记录为已修复。
- **证据：** outputs/daily-audit-20261117-journal-api/api-baseline-race.log，两条主/副路径均实际重现，pageerror为0。

## 其它检查与保留候选

- chat_features.js：本批完整读完播放/预览、转账等剩余代码，没有新增已确认二改问题；已有MiniMax/波形回归为前批证据，不作为本批新成果。转账归属边界需结合当前存档和重复消息ID继续验证。
- community.js：当前加载有请求版本/离开页面检查；未发现本批新增已确认问题，未对所有导航组合运行完整浏览器。
- storage_html.js：静态模板入口与现有备份控件相符，无新确认问题；全备份导入导出及所有屏宽不因读模板即算验收。
- status_regex_worker.js：局部追至utils.js的250毫秒总预算、1000任务/4MB/表达式长度上限与terminate。不能仅凭worker内RegExp就重复报告无界主线程卡死；已有对应测试本次随全量通过。
- API预设HTML拼接/导入严格结构/保存失败提示与journal旧生成、删除保存失败候选，须继续按旧安全finding和真实1900逐个核对；不重复登记已有“预设/组件导入执行”安全问题，也不把未复现猜测当新漏洞。消息脚本能力与DOMPurify升级继续暂缓。

## 本次验证

- 新增最初两个日记回归在修复前均失败（before.log）。补充真正二层合并、序列化/删除原件、活来源撤回、关闭通道、普通收藏/跨存档，针对性17项通过；不是把测试名称当嵌套验证。
- npm test：1543通过、0失败/跳过；真实UVU_1900_ROOT下 test:1900：38通过、0失败/跳过，两者重叠不相加。node --check和git diff --check通过。新增行初有CRLF被Git当空白错误，只调整新增行后复核通过，未全文件换行。
- tests/journal_provenance_browser.cjs 使用真实完整App和实际管理/多选/合并/收藏控件。批准来源可用；原审核撤回即禁注入；删除原件并停用通道、IndexedDB保存和重载后仍禁注入；等待API期间更正来源正文不保存过期结果。320×568无横向溢出、pageerror为0。
- 逐项临时撤去来源字段或来源变化检查，同一个完整App测试分别在引用权限断言、应有错误弹窗断言失败，finally恢复精确原字节；恢复后的完整App测试通过。浏览器与接口全为隔离合成数据，无真实账号/个人存档/付费调用。
- 截图已读取；错误弹窗DOM/文字、全屏遮罩、中心命中与视口内尺寸另检查。截图里的低对比显示不据此宣称用户全部主题通过；原版/完整第三方主题、手机实机、真实模型/酒馆服务、后台/SW及第三方内部仍未验。本批浏览器行为为已有Playwright运行，不冒称新的DevTools MCP完整测试。

## 交付与恢复

本批按既有授权提交并仅推test；准确提交、线上deployment.json及资源字节结果写在同目录release.json和Vault CURRENT的本批追加记录。main等待用户确认，不以本报告表示已发布main。回退使用正常git revert本批提交并重新测试，不重置个人数据库。

下一起点 battery_interaction.js、chat_relationship.js及38条待核路径；原版API候选待明确修复授权，其他候选仍要复现。源码覆盖不等于整站无bug，首次定时自动执行仍未观察。
