# 隐藏头像入口修复与角色表情包排查

日期：2026-11-18（Asia/Shanghai）。起点：test/main 9e4b314c37b795bde604c6123e9f6c0759dd44b9，Git 2.55.0.windows.5。

## 1. 已实施：隐藏所有头像后查看已保存的思考

- 原因已复现：chat_thinking.js 只给未隐藏头像添加入口；chat.css 的 avatar-hidden 使用 display:none，设置隐藏后不存在可点击区域。
- 修复限定在思考查看模块：私聊角色消息在原头像槽补透明原生 button，头像仍隐藏；桌面36px、触屏44px。不把整条消息或气泡变成入口，不修改用户头像、撤回、系统通知或连续头像合并规则。
- 使用既有查看逻辑和关联字段；只显示真实保存内容，没有记录继续提示，无新增API请求、数据迁移或提示词改写。原生button使用自身Enter/Space点击，避免与旧模拟按钮键盘处理重复。
- 初次实现错误地为透明入口保留了侧边位置，改变气泡横向位置与部分行高。用户未授权这一布局变化；该实现已由下方“透明层纠正”取代，不能视为保留美化的验收证据。
- 仍保留原头像显示时的入口、关闭后的焦点返回和多选模式保护。

## 2. 排查结果：角色表情包显示为图片/图片卡片

用户已确认异常表现为图片或图片卡片；具体异常消息原文和私聊/群聊类型尚未取得，不声称已定位或修好该条问题。已请求只提供单条编辑内容，不索取完整存档或密钥。

当前源码与真实1900都让表情包和普通图片共用 image-bubble 样式；这能解释它们共用外观，但不足以证明用户那条消息的原因。

完整App隔离数据实测：

- 私聊 `[测试角色的表情包：开心]` 与群聊 `[测试角色发送的表情包：开心]` 均命中表情库，img.alt为“表情包”，不存在照片卡。
- 两者保存的parts均为text，filterHistoryForAI后仍保留表情指令，无图片parts，也没有改写原消息。
- 对照输入 `[测试角色发来的照片/视频：开心]` 才生成照片卡；即使“开心”也在表情库，仍遵循照片指令，不擅自转表情。
- 保存与重载后分类不变。

因此没有依据改提示词、自动将同名照片改成表情、重写历史或覆盖第三方主题。本批表情部分只增加可重复的排查回归，待异常消息后继续。标准路径通过不能替代用户异常样本复现。

## 首次提交0e92fee的历史验证

- 修复前 hidden_avatar_thinking_browser.cjs 因隐藏入口为0而失败，修复后通过。
- hidden_avatar_thinking_browser.cjs：完整App、隔离存储，320/390/768宽、普通/双语、触摸/Enter/Space、焦点返回、无记录、消息气泡不触发、多选保护、代表CSS、模式切换、重载、无API请求/无数据变化。
- chat_thinking_forward_browser.cjs：既有思考查看/复制及失败回退、调试/多选、切角色、转发、模型搜索回归通过。
- sticker_message_classification_browser.cjs：私聊/群聊表情和照片对照、库图片匹配、历史类型/归一化、保存重载通过。
- 本轮 npm test：1587通过，0失败/跳过；真实 UVU_1900_ROOT 的 npm run test:1900：38通过，0失败/跳过。
- node --check js/modules/chat_thinking.js 与 git diff --check 通过。CRLF提示是Git行尾转换提醒，不是测试失败。
- Chrome DevTools MCP list_pages调用成功；功能回归实际使用现有Playwright完整App，未把工具连通称为DevTools完成交互测试。
- 人工查看完整App截图；样式为代表样本，不是用户原主题。真实手机、全部第三方美化和用户异常表情样本未验。未新跑全仓安全/现代化扫描。

## 使用的指南与兼容

已读取UvU开发规范、故障排查、Git与交付规范；Modern Web Guidance本轮search并retrieve accessibility、form-factor-adaptation全文。遵循“Don't attach keyboard handlers to native interactive elements”和“To keep small icons visually compact, extend their hit area with a pseudo-element”所述的原生键盘行为与外观/触达分离原则：本次用独立透明button保留头像位置，未引入新Web API或依赖，保留既有dialog与原头像行为。触屏44px限定在新入口，不全局修改button。

交付仅test；main没有本批授权。提交、远端、Actions和测试站实际状态以本批发布日志及Vault CURRENT后续补记为准，不由本文预先宣称。回退使用正常git revert并重验，不清个人存档。

## 2026-11-18 透明层纠正（用户反馈后）

- 已证实：旧透明按钮参加flex布局，触屏宽44px；移除一个按钮后，测试气泡x从62回到18，行高从44回到37，后续消息也被推移。首次回归只检查“不覆盖气泡”，遗漏了“不改变布局”，用户反馈成立。
- 最小修复：入口在既有position:relative的message-info内使用position:absolute、top/left为0，移除flex占位；不添加容器、边距或头像栏。头像继续隐藏，透明层允许覆盖原头像起点附近的小块气泡区域，其余气泡继续原有操作。只展示实际保存的思考。
- 本轮完整App浏览器回归：默认、紧凑和邮件代表样式×320/390/768共9组，有/无全部透明层时，消息、气泡、头像容器坐标完全一致，消息区截图字节一致。截图仅屏蔽独立toast的淡出动画；没有屏蔽消息、气泡或入口。代表样式不是用户原CSS。
- 原有可见头像、普通/双语、触摸/Enter/Space、关闭后焦点、多选保护、无记录、模式切换、保存重载、无新增API及无数据变化通过。透明层区域点击会打开保存内容，区域外双语点击仍可展开。既有chat_thinking_forward_browser和sticker_message_classification_browser通过。
- 本轮新跑npm test 1587/1587、真实1900比较38/38，均0失败/跳过；node --check和git diff --check通过。新增截图比较在修复前因坐标变化失败；修复后通过。未在用户手机或原美化CSS上验收。
- Modern Web Guidance本轮搜索absolute overlay hit target并完整读取accessibility，沿用原生button键盘行为，遵循“Don't attach keyboard handlers to native interactive elements”，无新API或依赖；没有全仓现代化/安全扫描。
- 表情问题仍未修：用户已给出猫猫头描述并确认没有照片/视频长按接收字样。隔离对照普通消息只显示描述，照片指令带接收提示，合法库名表情正常，错误库名被过滤。普通编辑会剥外层，尚未确认真正存储外层及说明注入开关，不能仅凭文本断言根因。
- 本节只确认本地实施与验证；test提交、推送和部署须另核；main无本次授权。
