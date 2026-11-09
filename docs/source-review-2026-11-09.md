# 开源参考与依赖台账 · 2026-11-09

以下固定 SHA 来自本轮前置审计的实际源码读取，不代表上游最新版。本次借鉴边界与生命周期设计，在现有原生 JS 框架中编写修复；没有复制其他项目的整段提示词或引入其完整框架。



通过 GitHub 插件进行了仓库／代码查找和文件读取；部分独立审查使用公开源码读取。下列是实际阅读的实现点，而非仅列项目名字。链接固定到本轮读取的提交，后续不能自动视为上游最新版。

| 开源项目／源码 | 具体实现学到了什么 | 如何用于 UvU |
|---|---|---|
| [mem0 main.py](https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/memory/main.py#L921-L1016) | 会话范围过滤、旧记忆检索、批量 embedding；把抽取失败与没有事实区分。 | 用于来源隔离、重复判定和失败状态。**不搬它的事实抽取提示词替换 1900 提示词。** |
| [SillyTavern vectors](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/vectors/index.js#L440-L504) | 当前聊天 hash 差分、分批插入、清理失效 hash。 | 优化已有增量建库与失效删除，不重复建设已有功能。 |
| [SillyTavern world-info](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L479) | sticky/cooldown/delay 有独立生命周期。 | 做兼容差异提示；这些语义未等价实现前不能宣称完全兼容。 |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/1e608caeb5130b2ad0fa067c84b26a038c1c6e36/packages/client/src/client/streamableHttp.ts#L488-L558) | 协议／会话头与按请求正文派生的方法头；resources/read 使用 URI；现代与 legacy 隔离。 | 校验资源预览请求、值编码和实际 SDK 互操作。 |
| [TauriTavern Host Contract](https://github.com/Darkatse/TauriTavern/blob/fff9af0333be97697be2313981699ab0ce35c236/docs/FrontendHostContract.md#L114-L133) | ABI2、iOS policy、chat 历史能力及扩展全局持久化。 | 按宿主能力适配 TT，文件模式和在线通道分别验收，不假定 TT 有 ST 后端。 |
| [Dexie export](https://github.com/dexie/Dexie.js/blob/45aade72aa19a601e6a13aa877beb7389e15b5d2/addons/dexie-export-import/src/export.ts) · [import](https://github.com/dexie/Dexie.js/blob/45aade72aa19a601e6a13aa877beb7389e15b5d2/addons/dexie-export-import/src/import.ts) | 游标分块、导出过滤／变换、进度；导入 schema 校验、事务 bulk 操作和已消费缓冲释放。 | 减少大备份峰值内存，保持现有 .ee 协议和事务保护。 |
| [Radix dialog](https://github.com/radix-ui/primitives/blob/eb3a2b7091293e27df8f9ba906632d8daa3d81a3/packages/react/dialog/src/dialog.tsx#L257-L357) | FocusScope、背景辅助技术隔离、RemoveScroll 和关闭后返回 trigger。 | 在原生 JS 新增弹层中补生命周期，无需引 React。 |
| [FullCalendar DateSelecting](https://github.com/fullcalendar/fullcalendar/blob/31a0d960920abbe0436e65c8cb0a4cc9a661438f/packages/preact/src/interaction-plugin/interactions/DateSelecting.ts#L31-L113) | 拖动最小距离、触摸延迟、滚动和 pointerup 提交分离。 | 日历拖选、取消与误触测试；不整体替换现有日历。 |
| [SillyTavern character-card-parser](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/character-card-parser.js#L15-L73) | 写前移除旧 chara/ccv3，读取优先 V3。 | UvU 已有类似块清理；重点补 V2/V3 输出策略与字段往返。 |
| [SortableJS AutoScroll](https://github.com/SortableJS/Sortable/blob/48b626bbc61afbb0f179730c1dd3cca3dcc8b788/plugins/AutoScroll/AutoScroll.js) | 限频、最近可滚动父层、触摸监听与 drop 清理。 | 针对新增图标和跨页拖拽复用思路，先复现再决定是否升级。 |
| [Howler core](https://github.com/goldfire/howler.js/blob/1d3053576a860e9854645493ad6c4a72c6cc6e45/src/howler.core.js#L301-L415) | 用户手势解锁、解锁成功后清监听；play Promise 失败与加载失败分层、暂停／恢复状态管理。 | 细化 MiniMax／音乐真机生命周期验收，不强制替换现有音频模块。 |
| [DOMPurify purify.ts](https://github.com/cure53/DOMPurify/blob/ac3c6644e377dfebf202fe37d5b79aca092fc03f/src/purify.ts) | 解析后的元素／属性处理、允许／禁止列表与模板相关处理，比原始字符串正则更完整。 | 仅在明确选择静态无脚本预览时研究引入；不能把净化器当作任意组件脚本的完整隔离方案。需要执行的组件仍依赖明确授权和隔离设计。 |
| [MiniMax-MCP server.py](https://github.com/MiniMax-AI/MiniMax-MCP/blob/0856b9aef8a9d676bb63bdd6b6426d7b640a3b7a/minimax_mcp/server.py) | text_to_audio 的 voice/audio setting、同步语音请求和成功／错误契约。 | 核验当前参数与录制响应。UvU 已有更完整的取消、流式和缓存，不能用简化示例整体替换。 |
| [Mammoth index.js](https://github.com/mwilliamson/mammoth.js/blob/5171a9072f8b7343ab1c9ed3a15d6d372cb59b67/lib/index.js) · [Security](https://github.com/mwilliamson/mammoth.js/blob/5171a9072f8b7343ab1c9ed3a15d6d372cb59b67/README.md#security) | ZIP／DOCX 解析和原始文字抽取；外部访问限制、恶意／病态文档及线程隔离注意事项。 | 当前实际加载 mammoth@1.4.21，研究 SHA 不是部署版本；Worker 改造先核对实际打包能力，不能直接套最新版接口。 |

许可证备注：SillyTavern／TauriTavern 的 AGPL 内容不应直接复制进项目而忽略义务；mem0 为 Apache-2.0。本轮 MCP SDK LICENSE 处于 MIT 向 Apache-2.0 迁移，旧贡献与新贡献需按文件／提交检查，不能把 GitHub 的 NOASSERTION 当成“无许可证”。其他依赖同样按实际使用版本核对，不在本轮自动安装或升级。


## 实际使用版本与回归

| 内容 | 版本/许可 | 本次用途 | 最小回归 |
|---|---|---|---|
| @modelcontextprotocol/sdk | 1.24.3，实际包 MIT | 仅隔离本地测试服务，固定 package-lock，生产不加载 | node --test tests/mcp_sdk_interop.cjs |
| Mammoth | 既有1.4.21，BSD-2-Clause | 同版本专用 Worker，未升级解析库 | node tests/media_repairs_nov9_browser.cjs |
| PDF.js | 既有4.10.38，Apache-2.0 | 空白/绘图页区分，保留页码与部分提取标记 | node tests/media_repairs_nov9_extra_browser.cjs |
| SheetJS CE | 既有0.20.3，Apache-2.0 | 原 Worker 增加提取范围报告，不执行公式/宏 | node tests/media_repairs_nov9_extra_browser.cjs |
| Dexie / fake-indexeddb | 既有3.2.4 / 6.2.4，Apache-2.0 | 既有存储及隔离测试，未迁移数据库框架 | npm test |

SDK夹具使用 tests/fixtures/mcp-sdk/package.json 和 lock；node_modules、outputs、账号与凭据不入提交。运行前 npm ci --prefix tests/fixtures/mcp-sdk --ignore-scripts --no-audit --no-fund。

真实模型/账号、iOS媒体/OAuth/TT宿主、Render代理地址及手机峰值内存不是以上夹具的证明范围。第三方项目后续升级应先检查许可/接口/体积变化，再重跑对应脚本。
