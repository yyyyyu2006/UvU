# 2026-11-17 日常审查续批：动态、音乐与面板

用户追问“其他板块没有问题吗”后继续本次人工审查。上批日历结论不能扩为其他板块无问题；本报告也不代表全仓已审完或定时任务已自动执行。

## 版本与实际覆盖

- 起点本地test `f1b961c501daf2dd146d499265fc0450d5e25577`，Git 2.55.0.windows.5。开工已跟踪工作区干净，只有原有outputs/。重新直接查询远端：test同起点，main `15c7bc4be30c9bb51632cd79d5f5f4cb9b15d809`；本地origin/test曾为旧值，未以该缓存代替远端现状。
- 完整连续阅读（长输出截断处已补读）：panel_layout.js 1–1626、moments_social.js 1–317、moments_social_ai.js 修改后1–161、moments_social_ui.js 1–339、music_ui.js 1–774。仅修改动态AI模块，不改其他四文件。
- 在前批206路径有限口径内重新计算当前字节hash，保留明确旧证据并补本批完整阅读：158条有可沿用或本批源码证据，48条仍需核对当前版本/覆盖证据。48不是bug数量；5个本批文件中moments_social.js原已有可沿用证据，因此总覆盖增加4。详见outputs/daily-audit-20261117-other/coverage.json。第三方、测试源码全量及非代码路径不在该计数中。
- 使用仓库uvu-development及Agent Skills代码审查规范；Modern Web Guidance 1.0.1，检索cancel asynchronous requests，完整读取js指南2026_11_10-47b4c80e。核对JSON复制、手工取消/超时及事件能力的兼容与回退，未增加新平台API、依赖或进行机械现代化；没有新跑Codex Security或全仓legacy-scan。

## MS-20261117-01 · P2功能问题 · 未配置副API也消耗互动额度

- 状态：已复现并局部修复。二改引入，真实1900目录无此模块；不属于1900普通聊天路径。
- 出现条件：开启动态互动，但副API未启用、地址/密钥/模型为空，或配置解析模块未加载。点击生成互动，也可由开启后的自动互动入口触发。
- 原表现：在检查API配置前就保存socialAttempts和lastSocialAttemptAt；本次请求记录也提前增加。实际网络调用0次，却占每日20次中的一次并进入冷却，立刻补好配置仍提示稍候；任务记录显示请求1次。隔离复现同时确认以上三项。
- 位置：js/modules/moments_social_ai.js原request/generate，现在requestConfig 19–31、generate 68–78及92–94；上游真实入口为moments_social_ui.js 215及评论/发帖后的generate调用。
- 最小修复：复用副API配置检查，在保存尝试次数之前校验；请求记录只在请求体成功构造、进入传输函数前增加。请求阶段仍再次核对配置，严格不回退主API。
- 正常行为：真实传输失败仍占次数并冷却，防止取消/故障绕过限制。请求体构造失败显示0次请求；该类失败及配置在等待保存期间变化后的额度策略没有扩为本次新需求。已扣的历史次数不自动重写。提示词、历史窗口、回复顺序、动态内容样式和音乐/ID卡/已发送卡片未改。
- 修复前新增两项核心回归均失败；修复后20项动态AI专项通过。新增完整App脚本验证未配置0次/0额度、设置内0/1记录、配置后立即成功、刷新后实际IndexedDB保存结果、320×568无横向溢出及pageerror 0；截图已实际查看。全部使用合成数据及模拟传输，没有真实账号或收费调用。

## 本轮新验证

- npm test：1534通过，0失败、0跳过；真实UVU_1900_ROOT下test:1900：38通过，0失败、0跳过（范围重叠，不相加）。首次全量因漏传基线路径失败，补正确环境后重跑成功，不能把该次环境失败藏成一次全绿。
- tests/moments_quota_browser.cjs：本次问题完整App验证通过。编写时修正过正则转义及等待持久化结束的测试错误，未删断言或更改业务完成条件以掩盖失败。
- tests/moments_social_browser.cjs：设置、NPC、纯文本显示、精确回复、独立请求、记忆审核、IndexedDB刷新及320/390/768布局通过。
- tests/music_sheet_ownership_browser.cjs：15个正常保存/旧保存不得关闭新弹窗/失败重试场景通过。
- tests/panel_help_tabs_browser.cjs：七组面板帮助入口、保留控件、检测入口及音乐分页通过。上述通过仅限这些场景，不保证音乐账号服务、所有面板生命周期或全部主题无问题。
- JS语法及git diff --check通过。日志/截图位于outputs/daily-audit-20261117-other、outputs/moments-quota；临时产物不提交。

## 未完成与下一起点

本批确认1组新问题，不给全仓剩余bug编造数量。其余本批阅读范围尚未确认新缺陷，不等于所有运行场景无问题。继续从bridge_file.js、story_bridge.js的文件接收/审核/异步归属开始，随后核对auto_memory.js、minimax_speech.js等当前版本及直接调用链。上批日历AI去重候选、第三方内部、设备/完整主题、真实服务、后台与SW升级仍待核验。消息脚本与DOMPurify升级等暂缓项不动。

## 交付与回退

只交付test；main需本批用户明确确认。提交/推送/线上部署分别核验，结果见outputs/daily-audit-20261117-other/release.json和Vault CURRENT最新节。本补丁无数据迁移；必要时撤销本次代码提交并重验，不回写个人数据库。
