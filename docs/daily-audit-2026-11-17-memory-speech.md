# 2026-11-17 日常续审：自动记忆与 MiniMax 语音

## 范围与版本

- 起点 test/dd5f8b19b0a2e5fa9f81adecbdfef1a83b7d59a5；远端 test 已通过 ls-remote 重核。main 为 15c7bc4be30c9bb51632cd79d5f5f4cb9b15d809，本批不更新。Git 2.55.0.windows.5、Node v24.15.0。开工仅原有未跟踪 outputs/，保留且不提交。remote.origin.fetch 只跟踪 main，因此旧 origin/test 不作为远端现状依据。
- 完整连续阅读 auto_memory.js 原 1–1604，修改后 1–1610；minimax_speech.js 1–456，并回读补丁及调用锚点。局部读取 chat_features.js 1–520、chat_ai.js 194–275/630–710、voice_director.js 79–215、settings_api.js 211–245、memory_library.js 475–535、db.js 750–785、chat_archives.js 1–110；局部不计完整文件。
- 有限口径 206 条 Git 跟踪自研 .js/.css/.html/.mjs/.cjs，排除 tests/、js/vendor/；精确字节 hash 对照后 162 条有可保留源码阅读证据、44 条需重核。44 不是 bug 数，也不表示全部从未读过；第三方内部、生成文件及全仓其他文件不纳入这个分母。逐文件和剩余路径见 outputs/daily-audit-20261117-memory-speech/coverage.json。
- 使用 uvu-development、Agent Skills 代码审查/调试/验证规则。Modern Web Guidance 按需检索 cancel asynchronous requests，读取 js 指南 2026_11_10-47b4c80e 全文，核对异步取消、克隆和编码回退。无新增依赖、Web API 或机械现代化。没有新 Codex Security 或全仓 legacy-scan；原生安全产物保持封存。

## AM-20261117-01 · P2 · 检索后来源变化，旧记忆仍可能进入请求

- 已确认、二改问题。真实 1900 目录无对应自动/向量记忆模块，本问题不归因为原版。
- 触发：向量检索已经完成，后续环境或工具步骤还在等待；期间用户更正记忆/原话、隐藏消息、关闭向量或切存档。原最终注入只复核部分权限，历史派生条目还可能直接视为有效，导致已经撤回的正文进入本次 provider 请求。
- 位置：auto_memory.js buildPromptWithVectorMemory() 51 起、retrieveVectorMemoryContext() 820 起。影响为本轮回复使用失效参考及 Token 诊断仍计入旧内容，不是已证明的跨用户远程漏洞。
- 最小修复：检索结果绑定本轮已有 assertCurrent(true) 检查，组装前再核对来源、角色/存档、数组身份、配置与取消状态。失效则本轮不引用旧检索结果，继续原基础回复，不额外请求；同步清空注入诊断。缓存命中重新绑定本轮检查并重置上次 injectedContext，避免上次 signal 中断污染新请求。
- 已实施片段：`if (hasResult && !result.isCurrent()) { result.injectedContext = ''; /* 清空诊断 */ return build(); }`。不改 1900 提示词、最近历史截取或供应商回复流程。

## SP-20261117-01 · P2 · 完整语音终包后的半截尾标记被误报为失败

- 已确认、二改 MiniMax 功能问题。真实 1900 目录无对应模块/功能。
- 触发：SSE（服务器分段返回内容）中 status=2 的完整音频已到，同一个网络块末尾还带半截 `data: [DO`、代理注释或下一段 JSON。原代码因完整终包提前结束读取，随后 flush 将剩余尾巴判作不完整响应，完整音频被丢弃。
- 位置：minimax_speech.js readResponse() 内 events() 90–98。
- 最小修复：`while (!final && (boundary = ...))`，以及 `if (flush && !final && text.trim()) ...`。收到已验证的完整终包后不再解析传输尾巴，仍在 finally 取消 reader 并释放锁；缺终包、错误 hex、大小限制等检查保留。没有删除波形、改变主题或放宽未完成响应校验。

## 验证与反证

- 新增两个问题回归在修复前均失败；修复后相关四测试文件当时 115 项通过，随后补充缓存跨请求回归 1 项通过。最终 npm test 1539 通过、0 失败/跳过；真实 UVU_1900_ROOT 下 test:1900 38 通过、0 失败/跳过。38 与全量重叠，不相加。日志在 outputs/daily-audit-20261117-memory-speech/。
- 新 tests/memory_speech_lifecycle_browser.cjs 使用实际完整 App：getAiReply → 向量检索 → 等待环境步骤 → 更正来源 → 放行，检查实际 provider 请求不含旧事实、原最近消息仍保留。
- 同一脚本点击真实语音气泡，模拟完整 MP3 终包加半截尾标记，原生 Audio 进入 playing 后 stopped；一次合成、reader 已取消、无 busy/playing 残留、无 toast/pageerror，320px 无横向溢出。没有启用 MediaSource 渐进播放，因此不泛化为所有流式播放器验证。
- 变异验证分别临时撤掉两项补丁，使用同一个完整 App 脚本：旧记忆断言失败、语音不能进入播放而失败；finally 恢复精确字节后最终浏览器通过。这证明测试可以拦住原缺陷，不只验证补丁文案。
- voice_text_only_browser 在原生 Chrome 157.0.8103.51 通过：无配置/只 key/只 voice 查看文字无请求、音频或提示；两种自定义 CSS 波形样例在只看文字时暂停，配置后播放/暂停/结束正确，缓存续播不重合成，历史不变。
- 最终 ended-320.png 已实际查看；语音结束图标、文字和窄屏正常。隔离夹具阻断外部图片，输入区外部图标占位不是本轮线上 UI 结论。
- 初版浏览器脚本重赋 const showToast 失败，属于测试构造问题；改为观察真实 toast DOM 后通过，初始失败日志保留。node --check 与 git diff --check 通过。
- 浏览器实际使用已有 Playwright；本轮 Chrome DevTools MCP 仅 list_pages 返回 about:blank，不称已完成 MCP 浏览器测试。全部合成数据/模拟接口，无个人存档、真实账号或付费调用；官方网页访问未得到可用内容，不声称已核验官方服务协议。

## 交付与剩余

保护 1900 提示词、历史范围、上下文/回复顺序、原版及第三方美化、音乐主界面、ID 卡和已发卡片；生产仅两文件局部变更。自检后按既有授权只提交推送 test，远端提交、部署标记、实际资源字节分别核验，实际结果另存本批 release.json 和 Vault CURRENT。main 等本批用户确认。无数据迁移，必要时正常撤销本批代码提交并重验，不覆盖个人数据库。

下一步从 chat_features.js 521–1063、settings_api.js、journal.js 生命周期继续，按精确字节重核其余 44 路径。真实手机、用户完整主题、真实服务、后台/SW、第三方内部仍未验证；既有日历 AI 候选未确认。消息脚本与 DOMPurify 升级继续暂缓。没有新增定时任务，原每天 10:00 heartbeat 的首次自动执行仍未观察。
