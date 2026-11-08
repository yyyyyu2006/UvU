# Render 免费部署音乐登录

只部署音乐网关；UvU 界面继续由 GitHub Pages 提供。无需购买另一台服务器、配置 Caddy 或先绑定自定义域名。先使用 Render 分配的 HTTPS 地址。

当前已内置 `https://uvu-music.onrender.com`。2026-11-08 已验证公网健康状态、UvU Pages 跨域预检、独立会话及网易云/QQ 二维码生成；测试会话已删除。玩家可直接进入「音乐 → 账号」扫码。真实账号授权、歌单与播放仍需在自己的设备验证。

## 自动配置方式

1. 在 Render 注册/登录，可使用 GitHub 账号。
2. Dashboard 选择 **New → Blueprint**，授权并连接 `yyyyyu2006/UvU` 仓库，分支选 `main`。
3. Render 会读取仓库根目录 `render.yaml`。如果页面要求配置路径，保持 `render.yaml`。
4. 检查资源只有一个 `uvu-music` Web Service，方案 **Free**，没有磁盘、数据库或其他付费资源，然后创建 Blueprint。
5. 构建阶段会安装固定版本的音乐引擎。部署日志应出现 `UvU music gateway listening on http://0.0.0.0:.../v1`，服务状态变为 **Live**。
6. 在服务页面复制实际分配的 `https://…onrender.com` 地址。它由 Render 分配，不能预先假定名称。
7. 用浏览器打开该地址加 `/v1/health`。应有 `ok:true`、`ready:true` 和 `deployment:{provider:"render",ephemeral:true}`。这只代表网关及引擎就绪。
8. 在 UvU「音乐 → 账号 → 配置/更换音乐服务」填该 HTTPS 地址，保存连接。选择平台扫码，用对应官方 App 确认，测试读取歌单与播放。
9. 测试通过后，将实际地址填入 `js/modules/music_config.js` 的 `endpoint` 并更新该脚本的缓存版本。之后玩家无需填写服务地址，直接扫码登录。

如果页面需要填写 Blueprint 名称，可用 `uvu-music`；Web Service 名称被占用时改为自己的唯一名称即可。不要把已有的示例 `.onrender.com` 域名当作自己的服务地址。

## 手动创建 Web Service 的备用方式

Dashboard 选 **New → Web Service**，连接同一个仓库。填写：

| 字段 | 值 |
| --- | --- |
| Branch | `main` |
| Root Directory | `services/music-gateway` |
| Runtime / Language | `Node` |
| Region | `Singapore`（或控制台可用地区） |
| Build Command | `node setup.mjs` |
| Start Command | `node render-start.mjs` |
| Instance Type | **Free** |
| Health Check Path | `/v1/health` |
| Environment: `NODE_VERSION` | `22` |
| Environment: `MUSIC_ORIGINS` | `https://yyyyyu2006.github.io` |

`MUSIC_ORIGINS` 是 UvU 页面的来源，不是 Render 服务地址。使用自己网页域名时填写它的完整 origin，无路径、无末尾斜杠；多个来源用逗号隔开。不能填 `*`。

Render 提供 `PORT`，入口会绑定 `0.0.0.0:$PORT`，无需手动填写 `MUSIC_PORT`。此免费入口不读取本机 `.env`，不使用本机证书，平台负责 HTTPS。不要上传 Windows 上的 `.env`、vault 或账号 cookie。

## 免费限制与故障定位

- 免费服务闲置 15 分钟后休眠，再访问可能需要约一分钟唤醒。音乐登录界面会先检查健康状态，遇到临时 503、加载页或网络失败会逐步重试，总计最多等待 90 秒；关闭面板会取消请求及等待。没有使用额外的保活服务。
- Free 没有持久化磁盘；服务重启/重新部署/从休眠恢复后，原来的服务进程登录状态不再保留。入口每次创建新的临时加密存储，不承诺“记住此设备”跨重启登录。玩家需重新扫码，浏览器里的歌单资料不因此删除。
- Render 免费服务受工作区免费实例时数和其他额度限制，规则以控制台为准。此配置只有 Free Web Service，不创建付费磁盘或数据库；免费实例用于试用，不保证长期稳定或大量玩家同时使用。
- `ready:false`：检查构建日志，确认执行了 `node setup.mjs`，没有运行错 Root Directory。
- 启动后未监听公网：确认 Start Command 是 `node render-start.mjs`，不是本机的 `launch.mjs` 或直接 `start.mjs`。
- `origin_denied`：检查 `MUSIC_ORIGINS`，填实际 UvU 网页的 origin。
- 首次连接慢或超时：等待唤醒完成，查看 Render 服务状态与 Logs；不要不停重建服务。
- 服务 Live、二维码可显示，不等于平台已授权或歌曲可播放。需要在真实账号与手机上验证扫码、歌单和播放；平台权益、地区与接口变化仍然可能影响结果。

## 官方资料

- https://render.com/docs/blueprint-spec
- https://render.com/docs/web-services
- https://render.com/docs/free
- https://render.com/docs/node-version

重新部署自己的服务时，Render 账号授权、创建服务和最终地址需要部署者在自己的控制台完成。
