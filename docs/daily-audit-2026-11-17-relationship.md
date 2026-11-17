# 2026-11-17 好友判断修复与源码续审

## 本批结果和边界

- 起点为 test `6be612b6aab384eae003735620f267460fe4fc8e`，本轮重新核实 Git 2.55.0.windows.5、远端 test 同步及 main `15c7bc4be30c9bb51632cd79d5f5f4cb9b15d809`；仅原有 outputs/ 未跟踪。
- 用户本次明确授权 REL-20261117-01/02：均为二改好友功能。真实1900目录无 chat_relationship.js，相关关系函数/字段检索无匹配。已局部修复，发布先 test，main 等用户确认。
- 业务补丁只修改 js/modules/chat_relationship.js。未修改1900主聊天提示词、历史窗口、上下文/回复顺序、样式、音乐、ID卡或已发送卡片；默认关闭、手动和定时路径保留。
- 电量两项、原版API晚到、消息脚本及DOMPurify暂缓项未改；本批没有新原生 Codex Security 或 legacy-scan。旧安全扫描的11条封存记录不重新定级计数。

## 已修复

### REL-20261117-01 / P2 / 二改

- 现象：恢复判断把已撤回原文发给辅助API，但过期检查排除了该条，正文变化后仍可能采用旧恢复结论。
- 位置：chat_relationship.js 199；原185。
- 修复：仅在这个独立恢复判断中排除 isWithdrawn，与现有历史签名一致。存储中的原文与撤回显示保持原样，普通主聊天撤回规则不变。辅助恢复仍取过滤后最后20条，自主拉黑仍30条。
- 代码：`.filter(m => !m.relationshipDelivery && !m.isThinking && !m.isStatusUpdate && !m.isContextDisabled && !m.isWithdrawn).slice(-20)`。
- 结果：完整App真实过滤下请求仅含 ACCEPTED_STORY，不含 WITHDRAWN_SECRET，存储历史未改。撤回内容不再是判断输入，随后修改这段已排除内容本身不要求取消合法判断。有效消息变化仍使旧结果失效。

### REL-20261117-02 / P2 / 二改

- 现象：等待自主拉黑或条件恢复接口时，修改人设并真实saveData，旧判断仍改变关系。
- 位置：chat_relationship.js 120–125、138–139、153/161、185–186、198/211。
- 修复：捕获实际发送的规范化资料；发请求前和采用结果前复核。拉黑复核人设、用户名、判断条件；恢复复核人设、恢复条件、朋友验证文本。资料变化本轮返回false，不自动重试；原角色/存档/历史/关系对象检查继续保留。
- 代码：`JSON.stringify(relationshipDecisionProfile(chat, true)) !== profileSignature` 时丢弃恢复结果；自主拉黑同理。这是JSON请求资料比对，未改持久化克隆规则，也未引入新浏览器API。
- 结果：两入口修改人设后均applied=false；正常结果、仅换头像或修改未发送的8000字符以外尾段不误取消。姓名或原对象内条件/验证文本变化也有回归。

## 继续审查中新确认，尚未修复

### HP-20261117-01 / P2 / 二改：主页预设导出混合前后设置

- 最危险的问题：导出开始时复制主页设置，但读取本地字体期间仍从实时db读取字号和CSS；前后状态混在一个导出文件。真实1900无 home_presets.js。
- 可能导致的后果：选择包含字体/CSS，字体读取未完成前改设置或恢复数据，导出结果可能不对应任何一个完整主页状态；在其他设备导入时外观不一致。未证明本地资料丢失或敏感信息泄露。
- 具体位置：js/modules/home_presets.js 155–176；HOME_KEYS先复制，templates/instances只存对象引用，170/173有await，176随后读取实时字号/CSS。
- 推荐修改：在第一个await前按白名单一次性捕获主页、模板/实例、字体来源和外观设置；后续仅异步读取固定字体记录。保留格式版本、字段白名单、信任预览、撤销和资源校验。
- 建议示例（未写入）：`const appearance = { fontUrl: db.fontUrl || '', fontSizeScale: db.fontSizeScale || 1, globalCss: db.globalCss || '' };` 与模板/实例一并在首次await前拍快照，之后从appearance读取。
- 复现：完整本地App插入合成customFonts记录，仅延迟该字体查询；等待时改签名、字号和CSS并真实saveData。导出home=OLD_HOME、css=NEW_CSS、scale=1.3。证据 outputs/daily-audit-20261117-relationship-fix/continuation.cjs、continuation.json。当前单列下一批，没有混入两项关系修复。

## 本轮实际验证

| 检查 | 本轮结果 | 边界 |
|---|---|---|
| 新增核心回归修复前 | 5个测试失败，旧21通过 | 撤回正文、人设双入口、用户名、原对象内资料变化 |
| 修复后关系单元测试 | 28通过，0失败/跳过 | 含新7项及原关闭/频率/存档/失败回滚/通话等 |
| 完整本地App关系浏览器 | 10组结果通过，pageErrors=[] | 真index.html、真实filterHistoryForAI/saveData；合成数据/模拟provider |
| 完整App修复前反证 | 撤回输入和人设双入口共3组失败 | 实际替换旧提交脚本并断言替换次数；无修改工作区文件 |
| npm test | 1550通过，0失败/跳过 | UVU_1900_ROOT为真实1900；不包含全部独立browser脚本 |
| npm run test:1900 | 38通过，0失败/跳过 | 严格真实1900目录；非静默缺基线跳过 |
| 工坊完整App专项 | 3组通过 | 稳定删除ID、保存失败恢复、拖动切组 |
| node --check / git diff --check | 通过 | 本批业务脚本和浏览器脚本 |
| Chrome DevTools MCP | 独立context首页加载，新资料守卫存在；DOM快照和截图已观察 | 仅页面加载/只读检查，关系行为由上面完整App脚本验证 |

DevTools本地预览将同版本第三方JS映射到本地夹具；控制台唯一资源404为本地/favicon.ico，非关系功能错误。观察到设备杀毒软件注入流量，未作产品请求/漏洞归因，报告不保存其完整连接标识。浏览器截图保存到MCP临时路径后复制到本批outputs；显式仓库输出路径被该MCP边界拒绝，内联截图可用。

测试夹具时间固定2026-11-12，不代表会话当前日期。没有调用个人API、付费服务或操作个人存档。真实手机、完整自定义主题、真实模型、人设编辑表单全旅程及线上交互未完成；部署/资源核验另见release.json，推送不等于用户验收。

## 源码覆盖与后续

- 完整连续阅读：chat_relationship.js 1–318（修复后复核），home_presets.js 1–398，image-workshop/vibe.js 1–389，reader_bookshelf.js 1–273；截断片段已按段补读。
- 工坊和书架本批未新增确认缺陷，不等于所有运行、并发及主题情形均已验。辅助调用链的局部读取不计为完整文件。
- 重新按当前字节SHA256核对：限定Git跟踪js/css/html/mjs/cjs，排除tests及js/vendor，178/206有当前阅读证据，28需重新核证。这是有限源码覆盖，28不是bug数量。完整列表/哈希/范围在本批coverage.json；第三方、生成文件与真实服务等旧缺口仍保留。
- 下一批先处理HP导出快照的具体范围，再沿coverage.json推进 settings_chat.js、reader_view.js 等待重核路径。BAT-01/02、API旧问题继续记录，不自动扩大原版修复。

## Modern Web Guidance

本轮检索 prevent stale asynchronous results / cancel fetch requests，完整读取js指南的异步协调与克隆边界。没有适用于本次业务资料过期复核的专门替换规则；保留现有AbortController超时和JSON请求语义，没有为了现代化迁移新API或增加依赖。Agent Skills使用调试、代码审查、浏览器验证及Git交付规范。
