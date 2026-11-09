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

## 浏览器

- 优先可用浏览器工具，否则复用已有 Playwright 并说明原因。先核对依赖与测试资源，不盲目安装或改写 package.json。
- 隔离数据和模拟 API，检查实际截图、控制台和网络错误，不仅审查 CSS。
- 检查正常／窄屏、长文本、空数据、失败、键盘／短屏、焦点与滚动；播放器另查切歌、结束、关闭、重进与一起听。
- 异步保存检查等待时切角色／存档后结果仍归原目标。桌面模拟不是 Android Chrome、Edge 或 iOS Safari 实机，注明媒体与本地网络授权等边界。

## 发布

1. 阅读 diff、工作区和暂存范围，执行 git diff --check。
2. 依用户授权与项目约定发布；技能不是新增授权。最新不推送／分支要求优先。
3. 显式暂存本次路径，排除 outputs/、凭据和个人数据，保留他人未提交修改。
4. 获取远端并检查分歧，不强推、不重置他人工作；合并后重验受影响行为。
5. 推送后核对本地 HEAD 与远端分支，此时只能确认代码推送。
6. 查看部署结果或核对线上资源版本后，才报告 Pages／Render 生效；分别排查缓存、Service Worker、旧入口和自定义图标。

Pages 静态前端与 Render 音乐网关是独立服务，前端更新不证明后端更新或登录可用。

交付先说用户可见变化，再给检查范围与必要限制，附实际提交链接。草稿、模拟、真实服务、推送与部署不互相替代。
