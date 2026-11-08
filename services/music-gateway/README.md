# UvU 音乐网关

**Render 免费部署：**仓库根目录已提供 `render.yaml`。在 Render 选择 New → Blueprint 并连接本仓库，确认只有 Free Web Service。自动使用 Node 22、安装固定版本引擎并启动；无需自己配置证书。具体点击步骤和手动备用字段见 [Render 部署教程](../../docs/music-render.md)。实际 Render 服务尚需在部署者账号内创建，不能把配置文件视为已上线服务。

免费入口是 `render-start.mjs`，由 Render 提供 `PORT`，绑定 `0.0.0.0`。每次进程启动生成临时加密 vault 和密钥；休眠/重启/重新部署后需要重新扫码，不承诺跨重启保留登录。客户端连接先等待健康检查再读取账号，关闭面板可以取消；普通歌曲请求保持原有超时。平台托管 HTTPS，不使用本机 `.env` 或 Caddy 证书。

独立运行的 Node.js 服务，为小手机提供网易云和 QQ 音乐二维码登录、搜索、歌单、歌词及平台授权播放链接。GitHub Pages 只能托管网页，不能运行这个服务；部署者可内置自己部署的 **HTTPS 网关地址**，玩家直接扫码。本目录不包含云端部署，也没有公共账号演示服务。

## 安装与本地启动

需要 Node.js **22 或以上**、Git 和可访问平台的网络。以下命令从 UvU 仓库根目录执行；Windows 可以把 `node` 换成已安装的 `D:/node.exe`。

```sh
node services/music-gateway/launch.mjs
```

这条命令会检查引擎，缺少时运行安装脚本；首次生成 `.env`、32字节随机加密密钥和本机 vault 路径，然后启动原网关。已有 `.env` 和部署环境变量保留，不覆盖。默认仅监听本机；新配置允许本项目 Pages 来源，并支持勾选“记住此设备”。没有域名、证书或服务器访问权限时，该命令不会自动完成线上部署。

部署者执行脚本并配置 HTTPS 后，可以将验证通过的公开地址写入 `js/modules/music_config.js` 的 `endpoint`，更新网页及该脚本的缓存版本。玩家直接点网易云 / QQ 的“扫码登录” → 官方 App 授权 → 歌单 → 导入到资料库，无需填写服务地址。当前尚无已部署地址，配置留空；不填示例地址。该文件是公开前端配置，只能放服务地址，不能放 cookie、Token、vault 密钥等凭据。

用户已有自定义服务时优先使用自己的地址；在「更换音乐服务」中留空并保存恢复内置地址。内置地址不会被普通偏好保存或备份固定为自定义地址。静态 Pages 不能执行 Node 脚本，也不能自动使用部署者电脑的 localhost。已有其他服务配置可继续使用原 setup/start 命令。

默认监听 `http://127.0.0.1:8787/v1`。首次由 `launch.mjs` 创建的配置允许 `http://localhost:3000`、`http://127.0.0.1:3000` 和 `https://yyyyyu2006.github.io`；直接启动且未配置环境变量时只允许两个本机来源。自建 Pages 域名需添加到 `MUSIC_ORIGINS`。本机测试在「配置音乐服务」填写 `http://127.0.0.1:8787`，客户端自己请求 `/v1`。手机里的 `127.0.0.1` 指手机本身，跨设备测试需要配置电脑局域网地址、监听地址和 HTTPS。

安装脚本只克隆固定上游版本，不执行上游 npm 脚本、不安装 npm 依赖。上游源码和许可证保留在被忽略的 `.runtime/engine/`，固定提交为 `4d83862b063b31af3eab1d823cfc7ff584609234`，来源 `https://github.com/jimmyshuixin/Music-api.git`（MIT）。重复运行安装脚本会核对版本；已经初始化且有本地修改时拒绝覆盖。

没有安装引擎时 `/v1/health` 仍可访问，但返回 `ok:false, ready:false, error:'engine_not_installed'`，平台请求不会伪装成功。`ready:true` 只表示引擎已安装，不保证当前网络、真实账号登录或 VIP 播放正常。

## 配置

复制 `services/music-gateway/.env.example` 到同目录 `.env`，修改允许的**网页来源**，然后运行：

```sh
node --env-file=services/music-gateway/.env services/music-gateway/start.mjs
```

环境变量：

|变量|默认值 / 用途|
|---|---|
|`MUSIC_HOST`|`127.0.0.1`；反向代理同机运行时保持此值|
|`MUSIC_PORT`|`8787`|
|`MUSIC_ORIGINS`|以逗号分隔的完整 origin，如 `https://yyyyyu2006.github.io`；无路径、无结尾 `/`，不支持 `*`|
|`MUSIC_VAULT_PATH`|可选的服务端加密凭据文件绝对路径|
|`MUSIC_VAULT_KEY`|可选；32 字节随机密钥的 base64；启用凭据文件时必填|
|`MUSIC_TLS_CERT` / `MUSIC_TLS_KEY`|可选；同时设置以直接启用 HTTPS，TLS 最低版本 1.2|

默认会话只在内存保留，固定有效期 24 小时；重启服务需重新登录。需要跨重启保留时配置 vault，并以 `POST /v1/session` JSON `{ "remember": true }` 创建会话，有效期 7 天。没有启用 vault 时请求 remember 会返回 `400 persistence_disabled`。可用以下命令生成密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

vault 使用 AES-256-GCM，包含哈希后的网关会话标识及平台凭据；文件中没有原始网关令牌。密钥通过服务管理器的私密环境配置，不放进网页或仓库。vault、密钥、`.env`、TLS 私钥均不属于小手机备份。不要把它们放到静态站点目录。网关不记录平台响应、cookie、二维码状态或 Authorization；反向代理也应关闭包含 URL 参数及请求头的敏感日志。

## HTTPS 部署

在自己的服务器按上面步骤安装，以服务管理器运行 `start.mjs`，推荐通过已有 HTTPS 反向代理转发到 `127.0.0.1:8787`。例如 Caddy：

```caddyfile
music.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

DNS 指向服务器并开放 443，配置 `MUSIC_ORIGINS=https://你的网页域名`，小手机填写 `https://music.example.com`。直接 TLS 方式则配置 `MUSIC_TLS_CERT` 和 `MUSIC_TLS_KEY`，以及合适的监听端口与防火墙。HTTPS 页面不能请求 HTTP 网关，否则浏览器会阻止混合内容；网关正常返回也不代表音频 CDN 允许所有浏览器跨域播放。

此服务用于自己的小手机实例。生产环境在反向代理或私有网络中设置访问限制，避免公开给任意用户创建会话；CORS 是浏览器来源限制，不是服务器用户身份认证。默认最多 100 个会话，每 IP 每分钟最多 10 个新会话，每会话每分钟 180 请求、最多 8 个同时请求。

## HTTP 合约

所有接口前缀为 `/v1`。除 health、session 创建和预检外，需要 `Authorization: Bearer <token>`。所有响应 `Cache-Control: no-store`；错误为 `{ "error": { "code": "...", "message": "..." } }`，不会回传平台错误原文。

|方法与路径|响应|
|---|---|
|`GET /health`|`{ok,ready,providers:['netease','qq'],engine:{installed,revision},error?}`|
|`POST /session`|201 `{token}`，可选请求 `{remember:true}`|
|`DELETE /session`|`{ok:true}`，使令牌失效并清除持久化凭据|
|`GET /accounts`|`{accounts:[{provider,loggedIn,user?:{id,name,avatar}}]}`|
|`POST /accounts/:provider/qr`|`{id,image,url,expiresAt}`|
|`GET /accounts/:provider/qr/:id`|`{status:'waiting'|'scanned'|'authorized'|'expired',user?}`|
|`DELETE /accounts/:provider`|`{ok:true}`，注销并使待授权二维码失效|
|`GET /search?providers=netease,qq&q=关键词&page=1`|`{tracks,errors,hasMore}`；一个平台失败仍保留另一平台结果|
|`GET /track/:provider/:id/stream`|`{url,availability,expiresAt?,message?}`|
|`GET /track/:provider/:id/lyrics`|`{lyric,translation?}`，LRC 文本|
|`GET /accounts/:provider/playlists`|`{playlists:[{id,name,cover,count}]}`，需要该平台账号|
|`GET /playlist/:provider/:id?page=1`|`{tracks,hasMore}`|

每个平台每页最多 30 首，搜索关键词最多 300 字符，页码 1–100。我的歌单最多 200 项；歌单内容受上游本身最多约 1000 首返回的限制。平台未提供总数时 `hasMore` 根据当前返回数量推算，可能出现最后一个空页。上游标准化结果丢失时长时返回 `duration:0`，播放器载入音频后再更新实际时长。

网易云上游只返回登录 URL，网关的 `image` 是空字符串，前端需在本地把 `url` 绘制成二维码；QQ 返回 PNG data URI。二维码只能由创建它的会话轮询，有效期最多 3 分钟；新二维码会作废同平台旧二维码。响应里的 `id` 由网关随机生成，不是上游可解码的 state，不会暴露 QQ qrsig、ptqrtoken、cookie 等轮询凭据。授权后 QQ 显示名称可能是通用的 `QQ Music`。

`availability` 可为 `unknown/full/preview/unavailable`。网易云读取平台原始 `freeTrialInfo` 保留试听标记；QQ 普通 vkey 返回的链接无法可靠区分试听，使用 `unknown`。网关升级已知平台 HTTP CDN 链接到 HTTPS，并按平台域名白名单过滤；不向任意 URL 发起代理请求，不下载歌曲，不尝试解锁会员或 DRM。QQ 引擎的匿名、移动端、多策略回退和伪造 IP 请求未启用；网易云引擎的 `uf` 替代音源回退也未启用。平台拒绝、未登录、地区限制或版权限制会导致不可播放或平台错误。

## 验证与局限

```sh
node --test tests/music_gateway.test.cjs
```

本地夹具测试覆盖 HTTP 合约、账号隔离、外来及过期二维码、注销/替换/并发授权竞争、平台部分失败、URL/参数限制、CORS、超时、加密持久化和适配器格式。`createGateway({adapterFactory,now,...})` 与 `createEngineAdapter(Meting,provider,credential)` 可注入本地测试依赖，测试不使用真实账号。

固定上游的源码已检查，实际安装会保留该版本。**夹具验证不等于真实账号登录成功，也不保证任何 VIP 曲目可播放。** 平台可随时变更接口；真实二维码授权、实际权益、移动浏览器音频策略、设备网络及 CDN 访问仍需要用户在自己的账号和设备上验证。不要把本服务可运行误认为已经提供了可供 Pages 使用的线上 HTTPS 后端。
