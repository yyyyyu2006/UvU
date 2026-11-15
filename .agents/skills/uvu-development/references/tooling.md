# 插件与资料的使用

## 状态要有证据

先检查当前会话的技能目录与可调用工具；安装记录、插件配置和实际调用是不同证据。插件已启用就复用，不重复安装、不重写无关配置。无法调用时说明具体缺项，可以继续已获授权的人工检查，但不能称为插件扫描通过。只在有关任务读取对应 SKILL.md；插件自身版本与其下载的指南版本分别核对。

2026-11-15 的本机核验：Modern Web Guidance 1.0.0、Agent Skills 0.6.16、Codex Security 均在配置中启用，技能可读，Codex Security 工具已暴露。此为带日期的核验记录，不保证未来会话已加载或扫描能完成。

## Modern Web Guidance 1.0.0

入口：`modern-web-guidance:modern-web-guidance`。凡是 HTML、CSS、浏览器端 JS 的实施或修改，先读取该技能并搜索相关指南，再决定方案。后端、Git、CI、纯文档不强制检索网页指南。

Windows 使用 `npx.cmd`；按已安装技能给出的指南版本运行，不能把插件版本 1.0.0 当成 npm 包或指南版本。当前入口示例：

```powershell
npx.cmd -y modern-web-guidance@latest search "modal focus management" --skill-version 2026_11_09-5bcc021b
npx.cmd -y modern-web-guidance@latest retrieve "<搜索实际返回的 id>"
```

- 查询用 2–5 个词描述一个平台能力；无关或为空时改写一次，不编造指南 ID。返回临时文件时完整读取，防止只看截断内容。
- 依据指南核对语义、焦点、可访问性、浏览器支持与回退。现代化建议不能授权替换 1900 原有弹窗或美化；原版保护范围不因指南推荐而扩大修改。
- 新二改功能可选合适的原生能力，修改既有实现要验证目标浏览器和自定义主题。没有证据时不能承诺所有 iOS／Android 环境支持。
- `legacy-scan` 仅用于用户要求的广泛现代化或旧模式扫描，不能用于每次小修复，也不能称为完整代码审计。
- 交付按该技能要求说明本轮确实用到的指南和取舍；没有应用到代码时明确说明，不虚构引用和收益。

## Agent Skills

先读 `agent-skills:using-agent-skills`，再选当前阶段所需技能，不机械跑完整生命周期。

| 任务 | 选择的技能 |
|---|---|
| 故障复现、追因与修复 | debugging-and-error-recovery |
| 明确功能边界、分阶段实施 | spec-driven-development、incremental-implementation |
| 官方资料和开源实现核验 | source-driven-development |
| 布局、控件和可访问性 | frontend-ui-engineering |
| 浏览器实际检查 | browser-testing-with-devtools |
| 正确性、维护性、性能、安全复核 | code-review-and-quality；需要时补 performance-optimization、security-and-hardening |
| 分支、提交和部署 | git-workflow-and-versioning、ci-cd-and-automation |

只用当前会话真实存在的能力；技能提及某个浏览器工具不代表工具已安装。已有清晰需求不重新强制访谈；不因技能模板重复请求已获授权的操作。

## Codex Security

使用官方插件技能和实际工具，不把本地 grep、普通 LLM 自查或旧报告标为 Codex Security 的新扫描。执行细节以本次读取的插件技能为准，不在本技能复制完整扫描引擎。

| 用户请求 | 对应技能 |
|---|---|
| 仓库或模块的普通安全审查 | codex-security:security-scan |
| 明确深度、多轮、穷尽式安全扫描 | codex-security:deep-security-scan |
| 分支、PR、提交或工作区差异安全审查 | codex-security:security-diff-scan |
| 明确修复已确认或有依据的安全漏洞 | codex-security:fix-finding |
| 明确要求独立核验某个安全修复 | codex-security:verify-fix，保持该技能要求的只读边界 |

- “逐行”是源码覆盖要求，不能仅以深度扫描次数代替；功能与 UI 问题还要按 [审查要求](audit.md) 检查。
- 桌面普通／差异扫描按对应 desktop 说明取得真实 scanId 和输出目录，先执行该模式规定的能力检查；续审沿用同一扫描身份。Deep 模式按其协调器流程，不套用普通扫描阶段。
- 使用原生扫描保存进度、证据与覆盖；不能另造竞争的安全台账、伪造扫描 ID、密封状态或报告。失败保留已有结果，报告原因和覆盖缺口，不能另开一个扫描掩盖失败。
- 仅在完成工具确认成功、规范产物存在时称为扫描完成。配置启用、工具可见、扫描启动和扫描完成分别说明。
- 仓库源码检查在本地进行；扫描工作单元遵守插件的离线来源规则。GitHub／官方资料检索另行进行，只带公开的通用问题，不上传密钥、个人聊天或私有代码。

## 其他插件与开源学习

用户要求设计草稿时，可在实际可用的 Figma、图像或设计技能中选择；unslop 等用于本次已授权的二改范围。先读技能，再调用工具，不能以“用了设计插件”代替草稿和实装对照。

联网研究使用官方文档和有代表性的 GitHub 项目，记录项目、版本／提交、具体文件、学到的机制、许可及本项目如何适配。不能声称搜索了所有开源项目，也不把第三方实现整段搬进原版路径。只为引用资料时不下载整个仓库，不自动安装所有参考项目。
