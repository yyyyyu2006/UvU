# 二改面板白色液态玻璃实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让二改新增面板统一为白色液态玻璃风格，并缩小表情说明入口。

**Architecture:** 在 `ui_harmony.css` 中按新增面板选择器覆盖表面、按钮与主题色；仅在支持时启用局部 `backdrop-filter`，用纯白背景作为回退。表情入口继续使用原事件，只缩短可见名称并增加完整无障碍名称。

**Tech Stack:** 原生 CSS/JavaScript、Node.js、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-06-derived-panel-glass-design.md`

## Global Constraints

- 不修改聊天提示词、回复流程、1900 原始美化 CSS 或用户自定义 CSS。
- 只调整二改新增面板的样式及表情设置按钮标签。
- 深色系统主题下新增面板仍显示白色。
- 支持模糊的浏览器显示克制的背景模糊；其他浏览器使用纯白回退。

## Tasks

### Task 1: White glass surfaces and compact sticker entry

**Files:** Modify `css/modules/ui_harmony.css`, `js/modules/sticker_assist.js`; Test `tests/ui_refinement_browser.cjs`.

- [x] Add failing browser assertions for white surfaces, blur, button sizing and narrow-screen overflow.
- [x] Add scoped liquid-glass surface rules and white-theme override for derived panels.
- [x] Reduce `#sticker-description-settings-open` padding/height/width and show concise text while retaining its accessible full name.
- [x] Run UI/browser regressions and `npm test`; confirm original chat styling files have no diff.

**Verification:** `npm test` passed 636/636. Playwright checks passed for the liquid surfaces in light/dark mode at 320/390/768, sticker settings, full app, Tavern bridge, document sharing, editor, model picker, and MCP. `css/chat.css` and `style.css` remain unchanged.
