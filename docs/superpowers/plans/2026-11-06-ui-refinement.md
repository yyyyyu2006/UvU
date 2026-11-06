# UvU 二改 UI 和谐化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一二改新增功能的视觉层级，减少重复说明和次级标签，让布局表达关系，同时不修改 1900 原版美化、提示词或聊天回复流程。

**Architecture:** 只调整新增模块的作用域 CSS、派生弹窗的结构和可见文案。原始聊天气泡、原版全局按钮和用户自定义 CSS 选择器不改；新增功能继续使用既有数据、事件和 API 接口。

**Tech Stack:** 原生 HTML/CSS/JavaScript、现有 Playwright 浏览器检查、Node 测试。

**Spec:** 本轮用户 UI 美化修改清单；用户要求“避免不必要的次级标签和描述，让布局表达关系”。

## Global Constraints

- 不改变 1900 版提示词正文、上下文组装、回复顺序或原始美化选择器。
- 新增样式必须使用模块作用域选择器。
- 不改变数据字段、API 协议和聊天消息格式。
- 保持 320、390、768 像素不横向溢出。
- 原有功能关闭或无新增数据时视觉和行为保持兼容。

## Review Focus

- 长说明是否把主要操作推离首屏：自动总结、记忆管理、MCP、酒馆审核。
- 手机窄屏下按钮、表单和文件卡片是否溢出。
- 原始美化 CSS 是否被新增选择器覆盖。
- 高级设置隐藏后是否仍能访问，错误和状态反馈是否仍可见。
- 视觉精简是否误删必要的安全、来源或限制说明。

### Task 1: 派生功能基础视觉规范

**Files:** Modify `css/modules/feature_refinements.css`; Test `tests/ui_refinement_browser.cjs`.

- [x] Add scoped design tokens, compact button hierarchy, modal spacing, focus and dark-mode rules.
- [x] Verify new selectors do not target original chat/avatar/bubble selectors.

### Task 2: 自动总结与记忆库

**Files:** Modify `css/modules/journal.css`, `js/modules/memory_library.js`, `index.html` only for additive labels/sections; Test existing memory browser coverage plus UI refinement.

- [x] Make summary/vector modes visually separate; move advanced filters and diagnostics behind compact controls.
- [x] Move memory filters and index operations behind disclosure controls; compact controls and cards.
- [x] Keep all existing IDs and event handlers.

### Task 3: 文件分享

**Files:** Modify `css/modules/chat_documents.css`, `js/modules/chat_documents_ui.js`; Test `tests/documents_calendar_browser.cjs`.

- [x] Hide recipient field for viewing an existing file; keep it for a new share.
- [x] Establish primary edit/send action and secondary export styling.
- [x] Keep original file download and editing behavior.

### Task 4: 酒馆互通审核面板

**Files:** Modify `css/settings.css`, bridge UI files only if required; Test `tests/browser_bridge_layout.cjs`.

- [x] Refine connection/review/diagnostics spacing with screen-scoped styles.
- [x] Preserve errors, source, floor, selection, editing controls, and tutorial access.

### Task 5: MCP 面板

**Files:** Modify `css/modules/mcp.css`, `js/modules/mcp_ui.js`; Test existing MCP/browser checks.

- [x] Refine service list, tool call, stop, result, schema and logs hierarchy with scoped styles.
- [x] Keep JSON editing/validation visible and verbose schema/log disclosure intact.

### Task 6: MiniMax 语音和导演 API

**Files:** Modify `css/modules/derived_features.css`, `index.html`; Test existing media/browser checks.

- [x] Compact basic voice and director fields while preserving the existing opt-in director disclosure.
- [x] Keep save/preview visible and preserve voice ID inheritance behavior.

### Task 7: 状态栏与 Token 面板

**Files:** Modify `css/chat.css`; Test existing status/token browser checks.

- [x] Preserve the existing 44×44 circular close/token/delete controls, internal scrolling and expandable worldbook rows.
- [x] Refine only the Token add-on panel layout; no token data or toggle behavior changed.

### Task 8: 展开编辑器与全局 CSS

**Files:** Modify `css/modules/document_features.css`, `css/settings.css`, `js/modules/text_editor.js` only if needed; Test editor/model layout checks.

- [x] Keep expand/import/export compact and arrange search/navigation/replacement into clear rows.
- [x] Preserve saved scroll position and CSS contents.

### Task 9: 表情包、相册、头像

**Files:** Modify scoped CSS in `css/chat.css`, `css/settings.css`, `css/modules/derived_features.css`; Test existing media/browser checks.

- [x] Compact sticker/avatar candidate layouts and preserve existing collapsible details.
- [x] Preserve recognition, candidate selection and avatar autonomy behavior.

### Task 10: 备份、通知、模型选择

**Files:** Modify scoped backup/notification/model-picker CSS; Test optimization and notification/model browser checks.

- [x] Compact backup modes/options while preserving classification and warnings.
- [x] Keep the single-toast behavior and compact searchable model list.

### Task 11: Final integration and regression

**Files:** Modify only affected scoped files; Test full Node suite and UI/browser suites.

- [x] Run the 636-test suite and 320/390/768 light/dark layout checks.
- [x] Inspect line-ending counts and verify original `css/chat.css` remains byte-identical.
- [x] Run module-focused browser regressions for memory, documents, Tavern, notifications, media and model selection.

## Ruling

Because the user explicitly requested all eleven UI areas in this turn, execution proceeds in the current authorized feature branch. The implementation will favor scoped CSS and existing DOM IDs over broad markup rewrites; this minimizes risk to the 1900 baseline.
