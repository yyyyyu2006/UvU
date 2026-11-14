# 开发验证

使用 Node.js 22 或更高版本，从仓库根目录运行。测试用模拟数据和本地接口，不需要玩家密钥、账号或聊天记录。

## 首次准备

```sh
npm ci
npm run test:browser:prepare
```

准备脚本下载固定版本的浏览器及七份网页外链脚本。资源清单在 `tests/browser-assets.json`，包含完整网址、版本文件名和 SHA-256；缓存位于被忽略的 `tests/.cache/`。网址不在清单、文件缺失或校验不符时浏览器批次直接失败，并提示准备命令。修改网页外链时，应核对来源、版本、许可证和实际字节后更新清单，不能仅按脚本排列顺序分配资源。

Linux CI 还需浏览器系统依赖，可先执行 `npx playwright install --with-deps chromium`。本仓库未附带1900原版；运行严格兼容检查的CI须自行提供合法取得的只读基线。此次跨目录验证在Windows执行，Linux CI及手机真机没有执行。

默认使用项目内安装的 Playwright，依次查找系统标准位置的 Chrome/Edge，再使用配套 Chromium。Windows路径由系统环境变量计算，macOS/Linux检查标准应用位置。已有浏览器可设置 `UVU_CHROME_PATH`（兼容旧名 `CHROME_PATH`）；已有 Playwright 可用 `PLAYWRIGHT_MODULE` 指向其安装。显式设置的无效路径会报错，不会悄悄换用其他浏览器。本机新下载的Chromium曾出现 `spawn UNKNOWN`；因此本轮实测使用自动发现的系统Chrome，不能声称配套Chromium已运行通过。

`browser_bridge_layout.cjs` 还会检查配套酒馆扩展；需要相邻的 `SillyTavern-UvU-Bridge` 源码，或用 `UVU_BRIDGE_ROOT` 指定其目录。这个可选扩展检查的依赖与主网页测试分开。

## 1900兼容

PowerShell：

```powershell
$env:UVU_1900_ROOT = '你自己的1900原版目录'
npm test
npm run test:1900
```

Linux/macOS：

```sh
export UVU_1900_ROOT='/path/to/1900'
npm test
npm run test:1900
```

预检同时检查普通聊天、提示词、群聊、日记、工具与通话所需的六份文件。缺失时默认失败。普通开发明确接受未验证边界时，可设置 `UVU_ALLOW_MISSING_1900=1` 跳过对照；此时日志写明“1900未验证”，不能作为发布验收。`npm run test:1900` 强制严格检查，不接受此跳过选项，并要求实际测试零跳过。原版目录只读，不复制进提交。

## 浏览器验证

```sh
npm run test:browser -- --match "chat_thinking_forward_browser|derived_panels_browser|model_picker_layout_browser" --jobs 2 --out outputs/browser-current
```

`--list` 只列出文件；不带 `--match` 会运行全部浏览器脚本。`--out` 保存批次日志、退出状态和 `summary.json`；传给子脚本的 `UVU_BROWSER_OUTPUT_DIR` 可供截图使用。其余历史脚本截图存于仓库 `outputs/`，少数支持原有的专用输出变量。测试产物不提交。

`tests/helpers/full_app_browser.cjs` 从真实 `index.html` 加载完整样式和模块，隔离浏览器存储、拦截外网、使用固定测试数据。`stableUI` 等待字体与短动画结束；截图关闭动画。思考弹窗验收覆盖320、390、768px宽度，含短屏和横屏，检查按钮命中、对齐、溢出、正文滚动、焦点返回、复制和关闭。

`browser_derived_features.cjs` 等旧脚本自行搭建简化HTML，仅作为局部功能测试。其截图不能代表当前完整UI。视觉验收应采用真实页面脚本，例如 `derived_panels_browser.cjs`、`chat_thinking_forward_browser.cjs`。桌面触屏模拟不等于安卓或iOS真机；测试成功也不证明公网音乐扫码和实际模型可用。

## 思考内容来源

头像入口只读取当前角色、当前存档里已经保存的 `<thinking>…</thinking>` 文本。它不生成、不总结、不请求额外思考；复制的也是这份原文。旧记录没有精确回复关联时标注“该段聊天保存的思考”，避免冒充某次回复。未返回、未保存或已清理的内容无法恢复；本面板不提取接口未公开的内部推理，也未扩展原版解析器去捕获独立的 `reasoning_content` 等字段。
