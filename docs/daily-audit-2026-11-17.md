# 2026-11-17 日常开发审查：日历

本批从 test/main `15c7bc4be30c9bb51632cd79d5f5f4cb9b15d809` 开始。开工重新 fetch，Git 2.55.0.windows.5；已跟踪工作区干净，仅已有 outputs/ 未跟踪。本批是用户要求立即执行的人工扫描，不是定时任务已经自动运行的证据。

## 实际范围

完整重读 calendar_ai.js 1–169、calendar_chat.js 1–38、calendar_core.js 修改后1–330、calendar_ui.js 1–453；另查 chat_ai.js 718–736 的回复后入口、panel_layout.js 的日历编辑器折叠/底栏位置及现有测试。局部调用链检查不计这些大文件的完整阅读。

使用 uvu-development、Agent Skills 审查/故障定位/浏览器验证规范；Modern Web Guidance 1.0.1入口、指南版本2026_11_10-47b4c80e，搜索 cancel asynchronous requests，完整读取 js 指南。检查取消/超时、JSON复制和事件清理；没有把手工45秒超时、JSON持久化复制或1900流程机械替换。本批是功能和UI审查，没有运行新的 Codex Security 扫描或全仓 legacy-scan。

## 确认问题与处理

### CAL-20261117-01 · P2 · 等待保存时切换存档仍写入旧操作

- 归属：二改日历，已复现。原来重复日程“仅本次/此后所有”只在点击时检查归属；排队等待真正写入时不复核。删除日程、删除角色心情和saveProfile同样缺失写入前检查。不会把数据搬到新存档，但会在用户已离开原存档后继续修改或删除旧记录。
- 位置：calendar_ui.js 61–75；calendar_core.js 151–154、178–184；共用mutate→write→runDataPersistence。
- 复现：隔离完整App创建每周日程，暂停保存队列，提交“仅本次”修改，切到另一存档后放行。修复前原日程之外增加旧编辑，弹窗关闭；三个核心队列回归在修复前均报告Missing expected rejection。
- 最小修复：重复日程mutate传`{ guard: valid }`；删除操作从实际被删记录固定owner，写入前检查`owner === 'user' || !!resolve(owner)`；saveProfile增加同一归属复核。用户日历、经期/观测正常删除保留。失败不提交事务、不更新内存，保留编辑内容并可回原存档重试。
- 已验证：三项新增核心队列回归、六个完整App编辑/删除场景；涵盖one/future/series删除和心情删除、回原档重试、重复例外日期保留。

### CAL-20261117-02 · P3 · 保存失败说明在表单视口之外

- 归属：二改日历，已通过真实截图和边界断言确认。长表单将feedback放在字段后，320×568时失败说明在可见区域之外，用户只看到按钮没有完成操作。
- 位置：calendar_ui.js 32–40 的共用编辑器run错误路径。
- 最小修复：写入失败文字后调用`status.scrollIntoView({ block: 'nearest' })`，沿用现有内部滚动、样式和aria-live，不改外观和成功路径。
- 已验证：修复前可见区域断言失败；修复后320×568和844×390截图中说明可见、底部操作可点，页面无横向溢出。自定义CSS样本保留。

## 本轮检查证据

- `npm test`：1532通过，0失败、0跳过。本轮新增3项；不是沿用上一轮1529。
- 真实`UVU_1900_ROOT`下`npm run test:1900`：38通过，0失败、0跳过；与全量范围重叠，不相加。
- `node tests/calendar_queue_browser.cjs`：六个排队编辑/删除场景通过，320窄屏和844短横屏错误可见，自定义CSS保留，pageerror为0。
- `node tests/calendar_important_browser.cjs`：重要日创建/重复/撤销、角色与存档权限、导入导出/实际IndexedDB、午夜与可见性恢复通过。
- 变更JS语法、git diff --check通过。日志位于outputs/daily-audit-20261117；截图位于outputs/calendar-queue，均不提交。
- Chrome DevTools MCP在独立localhost上下文打开完整App，390×844检查首页入口、资源和控制台；未用此段证明日历操作已验，日历操作由上面完整App Playwright验证。控制台error/warn为空；观察到杀毒软件注入的网络轮询，不能算应用请求。未测真实手机、完整个人主题、收费API、后台/SW升级和全部性能指标。

## 覆盖与下一起点

重新按Git枚举206条自研运行/工具代码路径（js/css/html/mjs/cjs，排除tests与js/vendor），对11月15质量manifest和原生reviewed-paths所指Git blob逐一核验哈希，再加本批4文件重读。保守口径154条可保留阅读证据、52条需要重新核对版本/证据；52不是52个bug，也不表示从未读过。未把后续只有补丁结论的资料自动扩为完整文件证据。完整路径与哈希在本批coverage.json，不覆盖原生封存报告。

后续先完整复审panel_layout.js及日历编辑生命周期，再推进52条中的相邻路径。AI尝试去重在空历史/无id/跨午夜下的候选需结合真实回复后调用核实，尚未确认，不更改自动请求规则。旧编辑关闭后的异步UI和删除入口等待继续核实。第三方内部、测试源码完整覆盖与真实服务边界独立保留。

## 交付与回退

本补丁只交付test，main需本批用户确认。Git提交、远端推送、Pages部署和线上资源核验是独立关口，实际结果保存到outputs/daily-audit-20261117/release.json并同步Vault CURRENT；本报告中的测试通过不等于已完成这些关口。没有数据格式迁移；需要回退时只撤销本批代码提交并重新验证，不还原或覆盖用户日历数据库。
