# 隐藏头像入口修复与角色表情包排查

日期：2026-11-18（Asia/Shanghai）。起点：test/main 9e4b314c37b795bde604c6123e9f6c0759dd44b9，Git 2.55.0.windows.5。

## 1. 已实施：隐藏所有头像后查看已保存的思考

- 原因已复现：chat_thinking.js 只给未隐藏头像添加入口；chat.css 的 avatar-hidden 使用 display:none，设置隐藏后不存在可点击区域。
- 修复限定在思考查看模块：私聊角色消息在原头像槽补透明原生 button，头像仍隐藏；桌面36px、触屏44px。不把整条消息或气泡变成入口，不修改用户头像、撤回、系统通知或连续头像合并规则。
- 使用既有查看逻辑和关联字段；只显示真实保存内容，没有记录继续提示，无新增API请求、数据迁移或提示词改写。原生button使用自身Enter/Space点击，避免与旧模拟按钮键盘处理重复。
- 隐藏头像时会保留透明入口所需的侧边位置；不是将点击区域覆盖在文字或卡片上。
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

## 本轮验证

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
