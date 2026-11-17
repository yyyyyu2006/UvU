# 主页预设修复与阅读器、聊天设置、搜索续审

日期：2026-11-17。开工基线 test `86ff9ec1dc9e8bad8f92ac8ee2958d8a5584c45a`，Git 2.55.0.windows.5；本地和真实远端 test 一致，main `15c7bc4be30c9bb51632cd79d5f5f4cb9b15d809`。只有既有未跟踪 outputs/，无他人已跟踪修改。

用户本次授权：确认 HP-20261117-01 是否二改，是则修复，并继续审查剩余代码。仅此主页预设问题进入业务补丁，按既有约定先交付 test；用户尚未验收，本次无 main 发布授权。

## 已修复 HP-20261117-01（P2，二改）

- 最危险的问题：读取本地字体期间编辑设置，导出文件混用导出前后的主页、字号、CSS、组件内容。真实 1900 目录没有 home_presets.js，亦未检索到 HomePresets/导出主页预设入口；结合现有模块归属，确认是二改功能的问题。
- 可能导致的后果：分享或恢复的外观与导出时不一致，组件文字/模板可能来自后续编辑；本次未证明原存档丢失或凭据外泄。
- 具体位置：`js/modules/home_presets.js:155–184`，原模板/实例只筛选未复制，外观在字体查询和 FileReader 等待后读取实时 db。
- 已实施：在首次 await 前深复制实际使用的模板和实例，并捕获字体来源、字号、CSS；后续只嵌入固定字体记录，再进入原白名单校验。导出始终保留点击时状态，不回写或撤销等待期间的实时修改。
- 实际代码要点：`settings.addedWidgets = clone(...filter(...)); settings.widgetTemplates = clone(...filter(...)); const appearance = { fontUrl: db.fontUrl || '', fontSizeScale: db.fontSizeScale || 1, globalCss: db.globalCss || '' };` 最后使用 `{ ...appearance, fontUrl }`。
- 保留：格式/版本、字段白名单、资源检查、50MB限制、导入信任预览、撤销和失败回滚。未改提示词、聊天历史/回复流程、原版或第三方美化、音乐、ID卡和已发送卡片；无依赖或数据迁移。

## 本轮新确认、未修复的问题

以下为普通功能审查优先级，不是新的 Codex Security 定级。真实 1900 对应模块在隔离的当前完整应用中替换执行，也出现同一结果；这证明相关旧模块路径已有缺陷，不冒称完整旧站全旅程已测试。两项均遵守原版保护，本次未自动改动。

### RV-20261117-01（P2，1900已有）

- 最危险的问题：阅读器切书后，旧段落的悬浮菜单仍在；再点写段评，引用来自旧书，评论却落到当前新书。
- 后果：A书的评论写入B书相同段落索引，内容归属错误。触发条件为A书长按/右键选中段落后切换书籍，再操作残留菜单。
- 位置：`js/modules/reader_view.js:99–135` 加载只清 currentCommentParagraph，未清 selectedParagraph/菜单；`521–546` 把旧节点与新 currentBook 组合；`644–656` 按当前书保存。
- 已确认：完整App合成A/B书，A右键菜单→加载B→残留写段评，quote为A原文、实际IndexedDB记录bookId为B。真实1900模块回放结果相同，pageErrors均为空。
- 推荐：进入换书/换章时清除段落选择、菜单和长按定时器，并校验节点归属于当前加载代次；保留已正常发起评论的目标身份。建议示例（未写入）：`hideParagraphMenu(); clearTimeout(longPressTimer);` 加在合适的加载边界，再核对当前段落节点与加载版本。补换书/换章、正常段评、关闭面板和异步返回回归。

### SC-20261117-01（P2，1900已有）

- 最危险的问题：处理A角色头像时切到B角色，A的晚到结果写入共用预览；随后保存B会保存A的头像。
- 后果：另一角色头像被覆盖。本次验证角色头像入口；“我的头像”入口存在同型代码，尚未单独运行验证，不将它算第二个已确认问题。
- 位置：`js/modules/settings_chat.js:109–119`，compressImage返回后无目标/版本复核；`121–131`为同型候选；`724–737`保存当前角色时读取共用预览。
- 已确认：完整App延迟头像处理，切换到B并加载其设置后放行A结果，再调用实际saveSettingsFromSidebar；B内存与IndexedDB均保存A结果。真实1900对应模块回放结果相同，pageErrors均为空。
- 推荐：头像选择时固定角色、存档和本次选择序号，返回时复核，过期结果不改共用预览；重复选择只接受最后一次。建议示例（未写入）：`if (currentChatId !== sourceId || db !== sourceDb || version !== latestVersion) return;` 需接入真实加载/选择代次，不能仅比较相同ID。

## 未确认候选与旧问题

- search.js已完整阅读；状态栏/消息快照的自定义正则仍直接在主线程执行，需要另做有超时边界的恶意/异常样本核验及1900来源比较。本批未实证卡死，不定级为已确认漏洞。
- BAT-20261117-01/02、API-20261117-01以及消息脚本/DOMPurify暂缓项保持原状态；不因本次扫描扩大原版修复。原生Security封存报告未修改，无新原生Security或legacy-scan结果。

## 本轮实际验证

| 检查 | 本轮结果 | 证据与限制 |
|---|---|---|
| 主页预设修复前单元回归 | 26项中22通过，新增并发4项失败 | unit-before.log；失败来自真实旧逻辑，不删断言 |
| 主页预设修复后单元 | 26通过，0失败/跳过 | 两种字体等待×原位编辑/替换db；深层组件、JSON往返、字体失败和白名单 |
| 完整本地应用修复前反证 | 4/4并发场景不满足修复要求 | 用86ff9ec替换目标脚本，断言实际替换4次，工作区未回退 |
| 完整本地应用修复后 | 5组通过，pageErrors=[] | 真实index.html/IndexedDB字体Blob/FileReader/saveData；含按钮导出并读取实际JSON下载 |
| npm test | 1555通过，0失败/跳过 | UVU_1900_ROOT指向真实目录；不包含全部独立browser脚本 |
| npm run test:1900 | 38通过，0失败/跳过 | 严格真实1900目录 |
| persistence_concurrency_browser.cjs | 通过 | 真实双页IndexedDB，包含主页导入/撤销及陈旧写入保护 |
| RV/SC继续审查复现 | 当前与真实1900模块回放共4组确认 | 合成数据；continuation.json；非完整1900站实机验收 |
| node --check / git diff --check | 通过 | 变更脚本和差异 |

日志、浏览器证据、coverage及release记录位于 `outputs/daily-audit-20261117-home-preset/`；旧证据未覆盖。浏览器夹具时间固定2026-11-12，不是当前日期。未操作个人存档，未调用个人收费API。真实手机、完整用户主题、线上交互、后台SW和真实外部服务仍未验；推送与部署另核，均不代表用户验收。

## 源码覆盖与下一步

完整分段连续阅读并核对当前字节：home_presets.js 1–400、reader_view.js 1–1323、settings_chat.js 1–881、search.js 1–495。共3099行，本批重新阅读包含已读文件；没有把局部调用链算成全文件。

重新枚举Git跟踪js/css/html/mjs/cjs并以SHA256核对，排除tests和js/vendor：181/206路径有当前源码阅读证据，25条待重新核验。25不是bug数，也不是全仓运行验收数量。精确范围、哈希、继承证据及剩余路径见coverage.json。

下一步沿剩余路径继续（例如settings_presets、widget_market、more_menu），候选需复现后再判断；RV/SC原版问题先记录具体修复边界，不混入本次二改补丁。回退可正常revert本次提交并重验，不覆盖个人数据库或清理outputs。

## Modern Web Guidance

- `js`：我保留JSON导出的既有复制方式，并把嵌套组件和外观固定在字体等待之前；指南明确“DO NOT replace … when callers depend on JSON wire normalization”，因此未机械换成structuredClone，也没有引入新的浏览器依赖。检索clone asynchronous state / javascript copy objects并完整读取396行js指南；同时应用uvu-development及Agent Skills的调试、审查与浏览器验证流程。
