---
name: uvu-development
description: Use when developing, debugging, reviewing, or redesigning the UvU derivative project, including music, Tavern bridge, memory, MCP, MiniMax voice, file sharing, calendar, and character-card features. Applies to UvU work rather than unrelated projects.
---

# UvU 开发规范

在现有框架中扩展二改功能，保留 1900 基线及用户确认的设计。用代码、实际界面和测试结果判断完成情况。

## 确定范围

1. 确认仓库、分支、工作区状态和已有 AGENTS.md。技能可能从链接加载，先确认任务确实属于 UvU。
2. 阅读本次入口、依赖、保存逻辑和测试。历史记录是线索，当前代码才是现状依据，不能将旧审查缺陷当作仍然存在。
3. 用户确认的草稿、限制和最新指令作为验收依据。只澄清会改变实现且无法从上下文得知的信息，不重复询问已有授权。

## 按任务读取

| 本次任务 | 参考文件 |
|---|---|
| 页面、图标、布局、动效、草稿实现 | [UI 规范](references/ui-guidelines.md) |
| 回复、提示词、记忆、桥接、角色／存档归属 | [兼容边界](references/compatibility.md) |
| 测试、验收、提交、部署排查 | [验证与交付](references/verification.md) |

只加载本次需要的参考。调整某个模块不意味着重做全部面板或全面修改原版代码。

## 实施

- 先找可复用实现，再决定修改范围。保持原有事件、设置、迁移和用户自定义入口有效。
- UI 围绕确认草稿调整实际 DOM／CSS，选择器限定面板根节点。真实页面验收不能由草稿截图替代。
- 故障先复现，再跟踪输入、身份、保存和异步结果。切换角色或存档后，旧任务只能更新原始目标。
- 可选功能的开关同时约束注入、网络调用和后台任务；残留令牌或配置存在不等于启用。
- 对接外部项目时核对官方文档、源代码、适用版本、许可与运行条件。模拟验证和真实手机／账号验证分开报告。

## 例子

用户要求“音乐按钮小一点，歌词仍为 14px”：读取音乐页面、弹层和样式加载顺序，只调整对应音乐控件；保留歌词和原版按钮样式；检查窄屏、播放器、歌词、一起听与短屏可达性。外观缩小仍需保留触达区域。

## 交付

选择必要检查，阅读结果与 diff。说明实际变化、验证范围、必要限制及实际提交／部署状态。技能本身不授予外部操作权限；发布依据来自用户授权和项目约定。
