# 2026-11-17 日常审查续批：剧情文件与审核恢复

## 版本和范围

- 用户要求继续扫描；按既有授权确认二改问题后局部修复、自检、只推test。起点test/远端test d3959c3660c7dfcb2e7458e2471de373139e678f；main 15c7bc4be30c9bb51632cd79d5f5f4cb9b15d809，Git 2.55.0.windows.5。开工已跟踪文件干净，仅原有outputs/；不清理旧产物。
- 完整阅读bridge_file.js 1–122、story_bridge.js修改后1–1394；长输出截断处已分段补读。局部追踪chat_archives.js 285–310、db.js 755–776及真实面板分页入口；局部读取不扩计完整文件。
- 有限口径仍为206条Git跟踪自研.js/.css/.html/.mjs/.cjs，排除tests/和js/vendor/。重新核对字节hash后160条有当前可保留阅读证据，46条需重新核对版本/证据。不是剩余46个bug；与全仓代码、测试、第三方内部阅读范围不同。精确记录：outputs/daily-audit-20261117-bridge/coverage.json。
- 使用uvu-development、Agent Skills代码审查规则及Modern Web Guidance 1.0.1；search validate imported JSON后retrieve js，指南2026_11_10-47b4c80e全文读取。检查现有克隆/异步/编码/取消回退，无新Web API或依赖应用，无机械现代化；没有新Codex Security或全仓legacy-scan，封存原生产物不改。

## BR-20261117-01 · P2 · TT文件模式恢复的完整剧情无法收取

- 归属：二改；真实1900目录不存在bridge_file.js/story_bridge.js，不归因为原版问题。已复现并修复。
- 条件：TT文件模式，无配对；从本通道恢复副本导入完整pendingScenes，或者资料已留在待收清单。列表显示“打开目标存档并收取”。
- 原表现：按钮切到目标角色/存档后调用syncIncoming，但该函数在非文件批次且未配对时直接返回0。完整剧情留在待收清单，不生成审核条目，也没有明确错误。普通交接文件importSceneFile自带fileBatch，不受此缺陷影响。
- 位置与根因：story_bridge.js syncIncoming原690–691的网络连接前置条件；真实按钮在当前1119–1126。恢复导入1189起只合并资料，后续仍要收取。
- 最小修复：syncIncoming入口在TT文件模式且未传文件批次时，传入空events的本地批次，复用既有完整分段、存档身份、写入/回滚、待审核与去重路径。网络模式不变，文件模式不发请求/ack、不改变游标、不自动批准记忆；未收齐片段保留。无数据迁移或样式修改。
- 修复示例（已实施）：`if (!fileBatch && isFileMode()) fileBatch = {events: []};`。没有新增第二套解析器或绕过文件/恢复副本校验。

## 本轮验证

- 两项新增核心回归修复前均失败；修复后story_bridge专项61通过。全量npm test 1536通过、0失败0跳过；真实UVU_1900_ROOT下test:1900为38通过、0失败0跳过，二者重叠不相加。
- 新增tests/bridge_file_recovery_browser.cjs，实际完整App 320×568、真实按钮与存档切换：无配对/桥接请求0、完整剧情进入待审核而非批准、缺段保留、游标不变、保存失败恢复、再点重试、IndexedDB刷新保留；pageerror为0，无横向溢出，截图实际查看。临时移除新增生产分支时，同一完整App测试失败；恢复补丁后通过。
- tests/browser_bridge_optimizations.cjs通过：分页/懒加载、全楼层选择、草稿刷新与版本冲突、恢复副本清理、持久摘要续跑、320/390/768布局。它是组件浏览器，不冒充完整App。
- tests/browser_bridge_summary.cjs首次在懒加载toggle后立即读pre时失败。补等待原断言文本出现，不删断言或改生产逻辑；随后原第三人称提示、未批准隔离、编辑确认/失败恢复、旧目标拒收、TT文件导入导出及320/390组件检查通过。
- 新浏览器脚本编写中修正了折叠/分页入口、不可重赋值saveData的注入方式、操作完成时序和截图动画等待；初期失败不算产品已通过。以最终browser-final.log和实际查看截图为准。
- node --check与git diff --check通过。全部合成数据和模拟接口，不使用个人存档、真实账号或收费服务；没有本轮新的线上浏览器行为验证。

## 后续与交付

本批确认1组新功能问题；其余源码阅读未确认新缺陷不表示全部运行场景无问题。下一起点auto_memory.js、minimax_speech.js及直接调用链，再续46条当前版本/证据待核路径。既有日历AI候选、真实手机、完整主题、真实服务、后台/SW、第三方内部仍未验；消息脚本和DOMPurify升级仍暂缓。

保护1900提示词、历史范围、上下文/回复顺序、原版与第三方美化、音乐主界面、ID卡和已发卡片。自检后提交推送test，远端/部署标记/修改资源字节分开核验，实际结果见outputs/daily-audit-20261117-bridge/release.json及Vault CURRENT。main需本批用户明确确认；本批无数据迁移，必要时撤销代码提交并重验，不覆盖个人数据库。
