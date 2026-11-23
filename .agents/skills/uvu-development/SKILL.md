---
name: uvu-development
description: Develop, debug, review, and verify UvU derivative features while preserving the 1900 baseline and approved UI. Route web work through Modern Web Guidance, engineering work through Agent Skills, and requested security audits through Codex Security. Use for UvU code, UI, audits, tests, and test-branch delivery.
---

# UvU 开发与审查规范

在现有框架内局部开发、修复和验证。最新的用户指令优先于旧草稿、历史清单和本技能；技能不能替用户批准新功能、改版或发布。

## 开工先核对

1. 读取仓库 AGENTS.md，确认实际仓库、分支、未提交修改和当前任务。全局技能可能通过目录链接指向本仓库，不向其他项目套用这些约定。
2. 沿用已经确认的要求和授权；只问会改变范围、兼容或验收结果的缺项。中文大白话说明结果、影响与必要依据，不要求用户先学插件名称。
3. 先读本次入口、直接调用、保存位置与已有测试，再改代码。旧审查记录是线索，需要核对当前文件与版本，不能沿用过期的问题数或通过数。
4. 说清本次实际使用的技能。检查工具当前是否可用，区分“已安装／配置启用／本轮已调用／结果已验证”。按 [插件与资料](references/tooling.md) 选用 Modern Web Guidance、Agent Skills 与 Codex Security。

## 必须保留的边界

- 保护 1900 原有提示词、历史范围、世界书和上下文顺序、回复顺序与流程，以及原版／用户自定义美化。新增能力关闭时不注入、不发额外请求、不改变基础回复路径。
- 保留现有框架、事件入口、数据结构与迁移兼容。局部修复不顺手迁移框架、全局重排 UI 或重写共享流程。
- 已确认草稿是实施依据；音乐 Apple Music 风格、导出 PNG 的 ID card 风格、发送后的文件卡和一起听邀请卡均属保护项，除非本次明确要求修改。
- 原版已有问题默认记录；只有用户已授权的具体修复范围才修改。既有清单的修复授权继续有效，不能以这条规则撤回。消息执行脚本等明确暂缓项保持暂缓，不因审查自动全局净化内容。
- 修复和功能改动默认自检后直接推送 main；普通“推送”默认指 main。仅当用户要求先看测试版时，才先推 test，并等用户确认后再发布 main；用户明确说暂不推送时不发布。每次发布前核对远端分支与差异，绝不强推或覆盖他人工作。

## 按任务加载

| 任务 | 必读参考 | 使用方式 |
|---|---|---|
| 网页布局、样式、前端交互 | [UI 规范](references/ui-guidelines.md)、[插件与资料](references/tooling.md) | 先查 Modern Web Guidance；草稿和真实页面分别验收 |
| 提示词、记忆、世界书、桥接、异步保存 | [兼容边界](references/compatibility.md) | 固定角色／存档／请求身份，核对开关关闭的原版路径 |
| 逐行检查、全仓问题清单、安全审查 | [审查要求](references/audit.md)、[插件与资料](references/tooling.md) | 区分功能检查与安全扫描，记录实际覆盖和未审部分 |
| 测试、提交、Pages 或 Render | [验证与交付](references/verification.md) | 按变更验证；默认核对 main 线上版本，只有本次指定 test 时核对测试站 |

只加载本次需要的参考，不为小改动启动所有插件或全仓扫描。Modern Web Guidance 的“按需查知识库”和“扫描已有代码”是两条独立流程，按 [插件与资料](references/tooling.md) 中的条件选择；不一次性加载全部知识库。

## 修复与交付

故障先复现，追踪具体原因，给最小补丁，再验证原触发条件和正常行为。模块分阶段修复，测试使用隔离数据；不在个人存档上试破坏性操作。

UI 改动检查真实 DOM、样式叠加、点击命中和截图，不能用草稿替代。安全审查调用真正的 Codex Security 流程；关键词搜索、静态扫描与自动测试都不能冒充逐行审阅。

交付说明具体改了什么、为什么、验证结果和未验证边界，分别标明已实现／已验证／已推送／已部署。不要把配置写入、离线模拟、Git 推送或插件生成报告说成用户已经验收。
