# 针对性验证与交付

## 选择检查

先查看 package.json 与测试脚本，核对依赖、目标和副作用。不在个人存档跑破坏性测试，不为验收自动调用收费接口。

| 改动 | 已有检查起点 |
|---|---|
| JavaScript | node --check 加变更文件 |
| 回复／世界书 | tests/legacy_1900_compat.test.cjs、tests/worldbook_request.test.cjs |
| 记忆／酒馆 | tests/story_bridge.test.cjs、tests/bridge_summary.test.cjs、对应 browser_bridge 脚本 |
| 音乐 | node tests/music_browser.cjs |
| 语音／导演 | tests/minimax_playback.test.cjs、tests/minimax_refinement.test.cjs、tests/minimax_speech_browser.cjs |
| MCP | tests/mcp_services.test.cjs、tests/mcp_transport.test.cjs、tests/browser/mcp_browser.cjs |
| 文件／日历／角色卡 | 对应 documents_calendar、calendar_life、character_card_export browser 脚本 |
| 跨模块 | npm test，再补受影响的浏览器验收 |

执行前确认文件仍存在且覆盖本次行为。npm test 当前运行 tests/*.test.cjs，不自动运行全部 browser 脚本。纯文档／技能只校验内容、格式与链接，无需跑业务全套。通过后不反复运行同一套；新增改动、失败或疑点才扩大验证。分别记录跳过、缺失依赖和真实环境未测。

涉及 1900 路径的变动以及应用发布前，用真实原版目录执行 `npm run test:1900`，并按范围运行 `npm test`。显式允许缺基线只用于开发诊断，不能当作兼容或发布通过。测试数量以本次日志为准，不沿用旧报告。测试应通过环境配置找到浏览器和基线，不能依赖作者个人电脑路径。

纯技能改动运行 skill-creator 的 `quick_validate.py`，检查引用、UI 元数据和关联目录。若修改了小脚本，实际执行其正常与失败场景；不要仅通过匹配文案的测试自证规则有效。

## 浏览器

- 优先可用浏览器工具，否则复用已有 Playwright 并说明原因。先核对依赖与测试资源，不盲目安装或改写 package.json。
- 隔离数据和模拟 API，检查实际截图、控制台和网络错误，不仅审查 CSS。
- 检查正常／窄屏、长文本、空数据、失败、键盘／短屏、焦点与滚动；播放器另查切歌、结束、关闭、重进与一起听。
- 异步保存检查等待时切角色／存档后结果仍归原目标。桌面模拟不是 Android Chrome、Edge 或 iOS Safari 实机，注明媒体与本地网络授权等边界。
- 避免用简化测试页面证明真实布局；旧夹具仍可验证独立逻辑，截图验收应启动实际完整 App。用户自定义美化至少选一个相关样本，核对按钮尺寸、状态文字与遮挡。

## 发布

当前默认发布顺序为：针对性验证 → 检查远端差异 → 推送 main → 核对正式站部署。用户明确要求先看测试版时，才走 test → 测试站验收 → 用户确认 → main；明确要求暂不推送时停留在本地。每次发布按本次用户指令和本规范执行，不从旧任务推定额外授权。两个站的部署方式和数据隔离见 [test 发布规则](../../../../docs/test-release.md)。

正式站：`https://yyyyyu2006.github.io/UvU/`；测试站：`https://yyyyyu2006.github.io/UvU/test/`。两站应用存储分开，但仍同域；浏览器清除整个站点数据会影响两者，不能宣传为安全域隔离。

1. 阅读 diff、工作区和暂存范围，执行 git diff --check。
2. 按本次用户要求与项目默认流程发布：默认 main；本次明确要求 test 或不推送时遵从该要求。
3. 显式暂存本次路径，排除 outputs/、凭据和个人数据，保留他人未提交修改。
4. 获取远端并检查分歧，不强推、不重置他人工作；合并后重验受影响行为。
5. 推送后核对本地 HEAD 与远端分支，此时只能确认代码推送。
6. 对应 Actions 部署完成后，请求目标站 `deployment.json`，核对 branch／commit，再检查实际页面和资源。未核对线上版本只能说已推送，不能说 Pages 生效；分别排查缓存、Service Worker、旧入口和自定义图标。

推送 main 前核对提交范围、检查结果、远端差异和仍未验证条件；发布成功后再核对部署。若本次明确要求先交 test，则先报告测试版范围与验收结果，收到用户确认后再推 main。项目默认规则已授权通常修复自检后直推 main，但不覆盖用户本次明确的分支或暂缓要求。

Pages 静态前端与 Render 音乐网关是独立服务，前端更新不证明后端更新或登录可用。

交付先说用户可见变化，再给检查范围与必要限制，附实际提交链接。草稿、模拟、真实服务、推送与部署不互相替代。
