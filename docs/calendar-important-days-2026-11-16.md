# 日历重要日实施与验收记录

日期：2026-11-16（Asia/Shanghai）。授权：用户在公历/年度重复、默认日历私有及独立聊天开关方案后回复“开始”。基线：test e8d4b737d96f2b97acff125bea19f85cfb738d54，Git 2.55.0.windows.5。本文是本轮证据，不复用上一修复的1516/38/19数量。

## 用户可见变化

- 日历选日期后“添加重要日”：纪念日、生日、重要事项，公历全天单日、不重复/每年、颜色与备注。生日/纪念日默认每年，重要事项默认不重复。
- 月格星号和数量、当天置顶、30天近期列表（默认5条）、倒数；周年/年龄默认隐藏，可手动开启。2月29日可选仅闰年/2月28日/3月1日。
- 重复记录按仅本次/此后所有/整个系列修改、删除、撤销；原始日期和发生日期分开保存，临时改期不覆盖原周年。
- 单条允许引用和角色当前存档共享同时开启后，聊天仅取得7天内最多5条标题/类别/日期；备注、地点、原始年份和隐藏年龄不发出。旧日程共享不授权重要日。手动分享先预览，默认不勾重要日。过去已发送消息不会随关闭许可自动撤回。
- 重要日不进AI规划输入、不占用时段、不允许规划模型修改或删除；普通日程流程保留。
- 首次新写入才升级v2，不在读取时迁移。升级前备份、新版导入导出和单年兼容v1导出均提供；旧格式会失去年度/类别/周年和专用权限，操作前明确提示。

## 实际改动范围

calendar_core.js、calendar_ui.js、calendar_ai.js、calendar.css；index.html只更新这四资源的版本参数；新增两份important测试，扩展calendar_ai及backup_formats测试。复用现有storage校验和事务，无新运行时依赖。没有修改chat_ai.js、1900提示词/历史窗口/回复顺序，或音乐、ID卡、发送卡片及全局主题样式文件。

按uvu-development及incremental-implementation分步实施，沿用方案阶段取得的Modern Web Guidance日期指南capture-location-agnostic-data、calculate-event-differentials：日期保存严格YYYY-MM-DD，以现有UTC日期辅助函数比较，未全局迁移Temporal。此次不是新的全仓现代化/安全扫描，不将资料检索或测试称为Codex Security审查。

## 本轮验证

- 最终npm test：1526通过，0失败、0跳过；严格真实1900基线npm run test:1900：38通过，0失败、0跳过。日志：outputs/calendar-important/full-tests.log、1900.log。
- 受影响完整浏览器7/7通过：calendar_important、calendar_import、calendar_life、documents_calendar、character_card_export、music、optimization_media_documents。独立日志与summary在outputs/calendar-important/browser-regression；音乐包括搜索/队列/歌词/一起听/卡片/主题隔离模拟，未使用真实账号。
- 69项日历/AI/聊天/重要日/备份专项曾通过；后续新增焦点及年龄文案已由最终全量和完整App再覆盖，数字不与全量相加。
- 新完整App浏览器：创建/编辑/撤销、年度6周年、仅本次改期与系列原始日期、HTML按纯文本显示、320/390/1440无横向溢出；v2文件真实上传下载及IndexedDB刷新恢复。
- 分享预览默认关闭、显式选择、旧共享隔离、双许可、存档切换拒绝旧分享、跨午夜定时与visibility恢复；读取完整备份后真实storageCommitImport和IndexedDB值一致，未知版本拒绝且原库保留。JSON/EE备份保留闰日/例外/私有字段。
- 键盘实测发现Esc连关底层日历，修复为接入既有功能弹层生命周期；Tab/Shift+Tab在新弹层内循环，Esc只关新弹层并返回“添加重要日”。
- Chrome DevTools MCP已调用本地完整App、快照/实际点击/键盘/布局/控制台/网络：无error/warn，记录226请求均200或204；开日历/重要日无fetch或XHR。工具请求390宽时实际视口最小512宽，真实320/390宽以Playwright完整App为准。
- 自定义CSS使用隔离合成样本，验证原CSS文本保留、新入口及键盘可用；不是用户所有第三方主题验收。截图中外网图片被离线测试拦截，未当作生产资源故障。
- JavaScript语法检查通过。Git按Windows CRLF约定以core.whitespace=cr-at-eol检查无空白错误；未改全仓换行。

## 回退和用户测试

首次保存重要日前，可在表单导出升级前日历备份；完整应用备份需另到备份页导出。新版v2不能直接导入旧main。若需旧版使用，先另存完整v2，再在日历设置选年份兼容导出v1；这只转换指定年的重要日，不改当前数据库，不能代替完整新版备份。

测试路径：日历→选日期→添加重要日→保存→重开/刷新；2/29策略、仅本次改期与撤销可逐一试。聊天引用到目标角色当前存档的日历设置开启，且单条“允许聊天引用”开启后才生效。没有后台通知、农历或跨设备同步。

## 交付关口

当前本地功能和自动化已通过；受影响浏览器总结果及test提交/推送/线上部署待下方追加。main保持0385b89，用户确认test后才允许合并。Android/iOS真机、用户完整主题、浏览器关闭后的后台行为、真实收费接口/账号和超大个人存档未验；未代替用户确认。

### test发布补记

- 功能提交75e8ef8d24ae523783fe9cc9ebbff894d74e1ca1已常规推送test，远端refs核对一致；仅12个本任务文件，outputs未提交。远端main仍0385b89a1040c49c1d5f4580f7a0e75a3fc864ba。
- Actions43871669642公开页面Status为Success；API限流403保留，不将API查询说成成功。test/deployment.json为test/75e8ef8，builtAt=2026-11-16T13:00:24.615Z；正式站仍main/0385b89，双站重新打包不等于main代码更新。
- test线上calendar_core/ui/ai及calendar.css四资源SHA256与功能提交一致（统一CRLF后比较）；Chrome DevTools MCP隔离context启动完整测试App、新写入默认私有重要日、月格/近期列表、实际点击新建默认年度/共享关、Esc保留底层日历并返回按钮均通过。
- 线上只见既有根favicon.ico404，未发现新脚本异常或新增功能资源失败；本轮未顺带修改站点图标。线上验证使用合成数据，没有读取或操作用户个人存档。
- 本补记仅记录已观察到的75e8ef8部署，随后文档同步提交不修改业务资源；最新文档提交和部署最终标记另记Vault CURRENT。main仍须用户本批验收确认。
