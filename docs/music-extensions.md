# 可选音乐扩展 M43–M46

所有开关默认关闭。加载模块、打开面板均不自动请求外部服务。入口为音乐首页右上角“…” → 音乐工具 → 离线、声音、自建库与跨设备（`UvUMusicExtensionsUI.open()`）；帮助说明集中在扩展弹层右上角 `?`，实际状态和权限确认留在对应操作附近。

## 离线音频

`UvUMusicExtensions.offline.cache(track,{url|blob,authorized:true,signal,onProgress})` 只在开启缓存且用户明确确认有离线保存权后执行；整文件读取完成并核对长度才原子写入 CacheStorage。正式站使用 `uvu-music-authorized-v1-main`，测试站使用 `uvu-music-authorized-v1-test`；按 `UvUTestEnvironment.channel` 或路径的 `/test/` 段判断，条目地址同样带 main/test 范围。两站列表、删除和清空只操作各自缓存。未读取或迁移早期未分范围的同名缓存，避免将来源不明的旧条目归给任一站。206 半响应、opaque 跨域响应、HTML 登录页、空文件、超容量、截断下载及取消均不写入。同时保存实际匹配歌曲的纯元数据和版本身份，不保存临时音源 URL。旧缓存缺版本信息会明确返回 resolvedVersionKnown:false。已有文件替换失败保留原文件；写入后晚到的取消恢复原文件。

`resolve(track)` 返回 `{blob,availability:'full',offline:true}` 或 `null`。核心在联网解析前使用此结果，Blob URL 可由原音频元素离线播放并拖动进度。`readRange(track,'bytes=100-199')` 返回准确 206/Content-Range，支持后缀范围；越界和多段范围返回 416。没有改动现有 Service Worker，也不缓存登录响应或自动抓取全部歌单。

`list/remove/clear` 分别提供容量与时间、单独删除和命名空间清理。容量独立于元数据与本地导入文件；每次下载检查自定容量及浏览器空间估计。关缓存或取消会中止在途读取。浏览器可能自行回收站点存储，不能承诺缓存永久保存。

## 声音

`audio.attach(audio,track,{url,signal})` 必须在设置音频 `src` 前 await，返回清理函数。若返回 `cleanup.sourceURL`，核心使用此地址替代原 URL。关闭开关立即返回空操作。网络来源先通过 CORS 完整读取为 Blob；失败时不连接 Web Audio，继续原播放器，避免跨域媒体连接后无声。超过 200 MB 的音效预读取失败会回退原播放器。

五段 EQ、已有 `replayGainDb` 标签补偿和淡入淡出分别开启。缺增益标签按 0 dB，不伪称音量标准化。AudioContext 不能及时恢复时先回退；后续播放事件尝试恢复已连接的上下文。关闭全部效果时切为直接连接，卸载时断开节点、撤销 Blob URL、关闭上下文。`audio.fadeOut(audio,ms)` 供核心切曲前使用；语音抢占应立即暂停，不等待淡出。当前实现为淡出后切曲和淡入，并不承诺双音轨交叠或所有来源无缝播放。

## 自建 Navidrome / OpenSubsonic

`navidrome.configure({endpoint,username,password})` 异步生成服务器指纹，凭据单独放在当前标签页 `sessionStorage`，不进入 db/musicLibrary、歌单快照或导出。HTTPS 必需，本机 HTTP 例外。接口用 POST 表单传按协议计算的 token 或服务器 API Key，不将密码拼进请求 URL；认证请求拒绝重定向，避免凭据跟随跳转。`disconnect()` 删除凭据并取消请求；切服务器和关闭来源同样取消在途请求。

`capabilities/search/playlists/playlist/lyrics/resolve` 分别检查服务器、分页搜索、列出歌单、读取歌单、按服务器毫秒时间和 offset 转成 LRC 的结构歌词、翻译与旧歌词回退、读取有权音频。播放返回 Blob，不返回带密码的播放地址。歌曲使用 `provider:'navidrome'` 加 `serverId` 和原歌曲 `id`，不同服务器相同 ID 不混用。服务器端需允许小手机网页跨域访问；认证失败会提示，缺封面和歌词安全使用占位内容。

此版本支持 HTTPS 上每请求随机盐的 OpenSubsonic token 认证，并在服务器声明 apiKeyAuthentication 后支持 API Key。先查询 formPost 能力，再发送表单认证；不支持该能力时明确拒绝，不把凭据放进请求 URL；未实现任意服务器的外部 OAuth 登录、转码策略或后台服务器安装。没有使用真实用户账号验证服务器实现差异。

## 跨设备

`sync.snapshot/preview/merge` 提供设备身份、版本、基线比较、删除冲突和显式选择。快照仅含公开歌曲资料；不会同步平台凭据和临时 URL。同一个会话中，发送和合并后更新共同基线；跨会话导入没有共同基线时不能推断删除历史，须按预览明确选择。同步服务读写使用修订号避免覆盖晚到改动。

`sync.createClient({endpoint,onState,onParticipants,onError,onEvent})` 在明确开启同步后创建；`create/join/publish/load/save/poll/start/stop/leave` 为实际 HTTP 操作，`connect` 是 `start` 的别名。房主可发布控制；状态带服务时间和修订。客户端校准时钟和进度、断线自动重试；每台设备分别解析自己的可播放来源。根播放器按歌曲/播放状态变化和进度偏差更新，不能把每次轮询当成重新开始。

服务运行、权限、房间有效期和本地双客户端验证见 `services/music-sync/README.md`。未自动部署公网服务。真人房间与原来的角色一起听功能完全独立。

## 验证边界

```sh
node --test tests/music_extensions.test.cjs tests/music_sync.test.cjs
```

已覆盖关闭零请求、完整缓存/Range/取消/容量/失败、无 CORS 不连接音频、音效清理与标签补偿、自建库凭据隔离/认证/切换/取消、三方合并、真实双 HTTP 客户端的权限/播放进度/共享修订/断线恢复/过期。真实 Navidrome 账号、真实两台手机、低端设备 Web Audio 音质与真实平台离线授权仍需用户设备验收。
