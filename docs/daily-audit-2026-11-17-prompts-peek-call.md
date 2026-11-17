# 工坊草稿与通话状态修复、偷看/通话续审

日期：2026-11-17（Asia/Shanghai）。基于test 4ff21bb32dafac08ce38ad2f37333833b25fddb3的补丁。本报告创建时尚未提交/推送，实际发布结果另见本批outputs/release.json和Vault CURRENT。Git 2.55.0.windows.5。

## 范围与保护

用户授权修复二改问题并继续审查，1900已有问题先记录。只改prompts.js两个保存回调和video_call.js取消清理。不改提示词模板、历史窗口、上下文/回复顺序、原版/第三方美化、音乐、ID卡、已发送卡片，不迁移存档。先test，用户本批确认后才main。

## 已修二改问题

### PW-20261117-01 · P2 · 工坊保存失败丢草稿

- 归属：二改引入。daa8821f加入保存回滚，但编辑回调未检查失败返回值；真实1900对应模块失败时保留编辑器。
- 条件与后果：两套LLM提示词编辑器保存遇到IndexedDB失败；已保存数据正确回滚，但回调重建列表，未保存标题/正文丢失、编辑框关闭。
- 位置：js/modules/image-workshop/prompts.js 583–600、1354–1371，调用saveLocalSettingsFields。
- 修复：固定本次输入并禁用保存按钮，返回false时保留编辑器；成功后仅原组/原节点/输入未继续变化时重绘；finally恢复按钮。保留原trim和数据回滚，不覆盖后来输入或重新打开的草稿。核心逻辑为const saved = await saveLocalSettingsFields(...); if (!saved) return;。
- 反证：旧模块草稿保留断言失败；新模块两套各5场景，共10通过：失败重试、等待中继续编辑成功/失败、切组返回重新编辑、正常保存。UVU_DRAFT_TEST_REF显式指定旧提交，提交后不错误引用HEAD。
- 可见界面：完整App320×568两套原按钮实际点击，失败保留/重试成功，pageerror=0。draft-failure-gpt-320.png、draft-failure-normal-320.png截图已查看。

### VC-20261117-01 · P2 · 挂断后头像仍处理中

- 归属：二改引入。63773bda取消/身份保护先清空controller，旧请求finally因身份不同不再清理processing。
- 条件与后果：请求未完成时挂断，复用头像继续动画，下一次通话仍像处理中。
- 位置：js/modules/video_call.js 46–54、triggerAiReply 982–1045。
- 最小修复：取消时立即document.getElementById("vc-call-avatar")?.classList.remove("processing");。保留旧请求不能清理新请求动画的身份保护。
- 新单元断言补丁前失败；补丁后挂断清理、旧结果不清新动画、新结果正常清理通过。完整App旧/新/1900模块回放after分别true/false/false，during均true，pageerror=0。
- 这是通话头像状态；没有删除语音气泡波浪或改MiniMax外观。

## 原版已有：确认后只记录

| 编号/归类 | 优先级 | 证据与影响 | 建议/状态 |
| --- | --- | --- | --- |
| VC-20261117-02 输入法候选回车误发 | P2 | video_call.js156–168只查Enter；合成isComposing=true回车仍清输入并加入通话上下文 | 排除组词回车；当前/1900模块一致未修，真手机键盘未测 |
| PK-20261117-01 生成数量越界 | P2 | peek.js139–150，min1/max20输入100，checkValidity=false仍存100并进入生成提示 | 保存前校验整数与范围；当前/1900一致未修，未请求100条 |
| ISSUE-20261115-02轮播候选细化 | P3 | peek.js1460–1464，隐藏时宽0，展开后390，首屏LAST克隆而指示第一项 | 显示后按实际宽定位；当前/1900一致，去重续记未修 |
| ISSUE-20261115-02共享生成锁细化 | P3 | peek.js2117/2193/2323按appType共享锁，A相册生成时B相册也被挡 | 按角色/存档/应用锁定；当前/1900一致，去重续记未修 |

对照为当前完整App替换真实1900对应模块及源码，不等同完整旧站/真机。旧置顶、touchcancel、API/电量和脚本/DOMPurify暂缓项保持原状态。

## 续审覆盖

连续读完peek.js 1–2453、video_call.js修复后1–1574；继续读完chat_ai_call.js 1–576并核对外层通话身份与总结保存归属，后者没有新增确认二改问题。prompts.js沿用完整阅读并复核两处补丁。

有限口径为Git跟踪js/css/html/mjs/cjs，排除tests/、js/vendor/，不是全仓所有文件或第三方内部。按当前SHA-256重算：193/206有源码证据，13条待重核，非Bug数。精确路径/哈希/行段在outputs/daily-fix-20261117-prompts-peek/coverage.json。

剩余：css/chat.css、css/modules/lenso_panels.css、index.html、js/chat.js、js/contacts.js、js/group_chat.js、js/modules/chat_ai.js、js/modules/chat_ai_airdrop.js、js/modules/chat_ai_prompt.js、js/modules/chat_ops.js、js/modules/chat_render.js、js/ui.js、js/utils.js。

下一起点chat_ai_airdrop.js 221–674（本轮只读1–220），再续聊天主链/UI/HTML/CSS。320px工坊标题纵向挤排在截图可见，来源/主题叠加待核；仅作UI候选，不计确认二改Bug或已修。

## 实际验证

证据目录outputs/daily-fix-20261117-prompts-peek/：

- full-tests.log：npm test 1556通过，0失败、0跳过。
- strict-1900.log：真实UVU_1900_ROOT严格38通过，0失败、0跳过；与全量重叠不相加。
- targeted.log：18针对性单元通过，call-before.log是通话修复前失败反证。
- drafts-final.log：10新增完整App场景通过；drafts-before-final.log旧模块失败；visible-drafts-final.log两套320px真实点击通过。
- settings-browser.log：工坊恢复10项；call-summary-browser.log通话总结7项；workshop-peek-browser.log工坊/偷看/主页18项通过。
- audit-browser.json可解析，共11记录：动画三组对照及4类原版问题当前/1900样本。
- 两业务JS语法通过；git -c core.whitespace=cr-at-eol diff --check通过，保留原CRLF。
- Modern Web Guidance按需检索/完整读取forms，用于保存期间禁用按钮、防重复提交和失败恢复。不改布局和平台依赖。无新legacy-scan或原生Codex Security扫描，封存产物未改。
- Playwright完整App隔离数据/模拟接口；Chrome DevTools MCP仅列页，不算DevTools功能验收。可见测试编写时固定时钟使点击计时失真并触发救援面板；使用流动系统时间/正常间隔后原断言通过，不算产品修复。

## 未验与回退

真实Android/iOS、全部自定义主题、真实API/账号、后台/锁屏、Service Worker更新和用户验收未完成。本批未操作个人存档，不宣称全仓零Bug。无迁移；需要回退时在test正常revert对应提交并重验，不强推、不覆盖个人数据库；main需本批新确认。
