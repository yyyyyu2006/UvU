# UvU 日历重要日任务清单

状态：2026-11-16用户“开始”后已实施T1–T8；T9已取得本轮全量1526/真实1900对照38通过，浏览器与发布证据见[验收记录](../docs/calendar-important-days-2026-11-16.md)。T10及用户实机/完整主题验收独立记录，main不自动发布。以下细目保留原验收要求，不以实现代替所有环境通过。设计与来源见[plan.md](plan.md)。

实际文件差异：重要日逻辑集中在calendar_core/ui/ai与calendar.css；新建calendar_important.test.cjs、calendar_important_browser.cjs；备份测试复用backup_formats.test.cjs，无需修改storage.js或新建重复备份夹具。index.html只更新这四个资源的缓存版本。

## T1：建立兼容的数据读写合同

依赖：用户审核实施方案。预计2文件：js/modules/calendar_core.js、tests/calendar_core.test.cjs。

- [x] v1普通记录和关闭路径保持旧行为；新v2字段与版本严格验证。
- [x] 读取不迁移；首次新功能写入才升v2；未知版本/数据库失败不覆盖原库。
- [x] 验证：运行calendar_core专项，故障注入核对数据库和内存一致。

## T2：打通重要日新建与重新打开

依赖：T1。预计3文件：calendar_core.js、calendar_ui.js、tests/calendar_important_browser.cjs（新）。

- [x] 选日期新建三类单日事项，字段可保存并在刷新后重新编辑。
- [x] 默认私有；owner/存档固定，表单校验和失败反馈可见。
- [ ] 验证：完整App隔离数据中新建、取消、刷新、切owner及写失败。

## T3：年度和闰日

依赖：T1、T2。预计2文件：calendar_core.js、tests/calendar_core.test.cjs。

- [x] yearly按月日匹配且不改变原daily/weekly/monthly；2/29三策略明确。
- [x] until/except、跨年、范围边界和下一次无结果均有界；周年不按365天推算。
- [ ] 验证：日期专项含1900/2000/2100、时区变化、2/29、12/31和结束/排除。

## 检查点A：保存与日期

- [x] T1–T3专项全部通过，完整App保存后重开正确；记录真实结果，不提前勾选。

## T4：重复记录修改、删除和撤销

依赖：T3。预计3文件：calendar_core.js、calendar_ui.js、tests/calendar_important_browser.cjs。

- [x] one/future/series明确生效范围，原始日期/权限不随临时改期丢失。
- [x] 原系列例外与派生记录同一事务；过时编辑拒绝，撤销完整恢复。
- [ ] 验证：三种范围、闰日改期、当前实例取消/删除、并发/写失败/撤销流程。

## T5：月格与近期显示

依赖：T4。预计3文件：calendar_ui.js、css/modules/calendar.css、tests/calendar_important_browser.cjs。

- [x] 月格标记和当天置顶、30天近期列表正确，其他日历图层仍可辨识。
- [x] 午夜/visibility/时区/owner变化刷新；弹层滚动与焦点、长标题和空态可用。
- [ ] 验证：完整App桌面/窄屏/短屏及原版与第三方主题，截图核对和实际点击。

## 检查点B：界面

- [ ] T4–T5专项通过，月格/心情/经期/选区和受保护样式共存，浏览器日志记录缺口。

## T6：独立聊天许可

依赖：T4。预计4文件：calendar_core.js、calendar_ui.js、tests/calendar_core.test.cjs、tests/calendar_chat.test.cjs。

- [x] 记录与角色/存档双许可默认关；旧日程共享不能自动包含重要日。
- [x] 有界摘要仅含允许字段；关闭不读取事件库/不注入/不多发请求；手动分享先预览选择。
- [ ] 验证：开关组合、旧共享开、不同存档、getter保护、实际请求捕获及分享快照。

## T7：排程隔离

依赖：T3。预计2文件：calendar_ai.js、tests/calendar_ai.test.cjs。

- [x] 重要日不进入规划输入、不作为占时冲突、不被模型修改或删除。
- [x] 普通日程冲突和锁定逻辑保持；切存档和迟到结果仍受原保护。
- [x] 验证：同日纪念日+普通日程、模型按ID尝试改重要日、普通冲突/取消回归。

## T8：备份与旧版回退

依赖：T6、T7。预计5文件：calendar_core.js、calendar_ui.js、storage.js、tests/calendar_import_browser.cjs、tests/calendar_backup.test.cjs（新）。

- [x] v1/v2独立日历和完整备份往返，身份/权限/周年/例外不丢；未知版本拒绝。
- [x] 单年兼容v1导出预览转换/排除及不能保留内容，不改本库；迁移前v1与完整v2回退流程可操作。
- [x] 验证：导出/导入真实入口、损坏数据/取消/数据库失败/并发恢复，核对未覆盖原库。

## 检查点C：数据与权限闭环

- [ ] T6–T8全部通过；新版和兼容旧版文件分别验证，实际请求无越权字段。

## T9：最终回归与浏览器检查

依赖：T1–T8。涉及现有测试及docs/验收记录，按实际缺口补必要测试。

- [x] 新跑日历专项/备份/全量/严格真实1900检查，无失败和不明跳过；结果按本次版本记录。
- [x] Chrome DevTools MCP检查完整App页面/控制台/网络；7份浏览器脚本通过含音乐/ID卡/发送卡片，样式仅calendar作用域。完整用户主题仍待验。
- [x] 实机、完整用户主题、后台/服务未验证部分明确标出，不替用户验收。

## T10：交付test并保留main关口

依赖：T9及对应发布授权。以当时Git工作区、远端和部署重新核验。

- [x] 只提交本任务文件，排除outputs和个人数据；75e8ef8已核对远端test。
- [x] test部署标记/四资源hash/完整App启动与75e8ef8一致；Actions43871669642成功。
- [ ] 用户在test确认本批结果后才更新main；没有确认不标记main已发布。

## 完成关口

- [x] 本方案获得用户审核并授权实施（用户回复“开始”，公历/年度及独立聊天开关已记录，不重复问）。
- [ ] T1–T9有对应版本证据；T10各发布步骤按授权实际完成。
- [ ] Obsidian CURRENT/DECISIONS/TODO/open-loops按真实进展收尾，历史测试不当本轮结果。
