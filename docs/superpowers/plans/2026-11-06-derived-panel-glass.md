# 二改面板简洁卡片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让二改新增面板统一为白色简洁卡片风格，并精简默认状态文案。

**Architecture:** 在 `ui_harmony.css` 中用限定在二改面板的规则统一圆角、间距、按钮与强调色；将长 UUID 与交接诊断放到可展开区域，精简酒馆面板默认说明。

**Tech Stack:** 原生 CSS/JavaScript、Node.js、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-06-derived-panel-glass-design.md`

## Global Constraints

- 不修改聊天提示词、回复流程、1900 原始美化 CSS 或用户自定义 CSS。
- 只调整二改新增面板的样式及表情设置按钮标签。
- 深色系统主题下新增面板仍显示白色。
- 聊天提示词、回复逻辑、原版美化与用户 CSS 均不在变更范围内。

## Tasks

### Task 1: Unified derived card styling and concise status copy

**Files:** Modify `css/modules/ui_harmony.css`, `js/modules/mcp_ui.js`, `js/modules/story_bridge.js`, `index.html`; Test `tests/ui_refinement_browser.cjs`.

- [x] Add failing browser assertions for white surfaces, card radii, capsule buttons, blue primary action, 8px rhythm and narrow-screen overflow.
- [x] Add scoped style rules for 24/20px card radii, capsule buttons, restrained blue accents and spacing.
- [x] Hide verbose identifiers from default MCP/Tavern summaries while retaining them in expandable diagnostic details.
- [x] Run UI/browser regressions and `npm test`; confirm original chat styling files have no diff.

**Verification:** `npm test` passed 636/636. Playwright checks passed for derived surfaces in light/dark mode at 320/390/768, card radii, buttons, colors and responsive overflow. `css/chat.css` and `style.css` remain unchanged.
