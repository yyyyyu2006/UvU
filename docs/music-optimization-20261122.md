# 音乐46项实施与验证报告

日期：2026-11-22（Asia/Shanghai）。实施基线：`a0f9debe62172182a115dd5aad7442867be9901f`。用户明确授权全部46项、自检后直接推送main。

46项均已按下面限定范围实现或完成现有能力的专项补验。这个结论不表示所有外部平台、私人服务器、手机硬件或公网同步服务都已验收。新增可选项默认关闭，既有推荐最近6条默认行为保留。

未修改1900线上两套提示词、思考预设、聊天历史窗口、世界书静态位置、主请求组装或回复顺序。音乐发送卡片外观、兔子图标、默认14px居中歌词保留。源码仅音乐模块/局部样式/后端/测试/文档。

## 操作入口

音乐首页右上角“…” → 音乐工具，包含资料库、导入与存储、离线/声音/自建库/跨设备、播放与故障设置、角色歌单。歌词页“歌词设置”可调偏移/双语/逐字/点句跳转及本地绑定。说明集中在新增工具弹层右上角问号。

| 编号 | 项目 | 实际交付 | 检查与限制 |
| --- | --- | --- | --- |
| M01 | 统一播放状态与迟到事件处理 | 统一旧音频、迟到请求和操作意愿校验；快切、暂停、淡出中拖动/语音抢占不被旧操作覆盖。 | `music_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M02 | 区分缓冲、断网与真正失败 | 新增buffering状态及可选一次网络恢复；暂停和取消后不再自动恢复。 | `music_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M03 | 临时播放地址失效时有限续播 | 仅网络错误且可验证URL时间戳已过期时可选重取一次；格式/登录/限流不猜成过期。 | `music_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M04 | 同一站点多标签页只保留一个播放主页面 | 可选Web Locks独占播放，BroadcastChannel通知；正式/测试站隔离，无锁时如实提示降级。 | `music_optimization.test.cjs`；BroadcastChannel降级只能尽力通知；系统冻结/真实无支持环境待验。 |
| M05 | 锁屏、耳机、页面上的播放状态一致 | Media Session按歌名/歌手/专辑/封面修订刷新，停止清进度，跳转0秒有效。 | `music_optimization.test.cjs`；真实手机锁屏、蓝牙/耳机硬件待验。 |
| M06 | 可选跨重启的播放断点 | 可选持久歌曲/队列/模式/进度断点；仅手动继续，坏模式回退、超出实际时长校正，保存失败不先清记录。 | `music_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M07 | 定时停止扩充并校正后台延迟 | 自定义1–1440分钟、播完本首/本专辑停止；按绝对截止时间在返回前台重新检查；淡出另设可选开关。 | `music_optimization.test.cjs`；系统冻结时不能保证准时执行；同专辑按当前队列结束条件。 |
| M08 | 语音、通话和音乐的播放权统一 | 交叠语音计数，最后释放才恢复；手动操作、切歌、定时停止和淡出中的语音均使旧恢复失效。 | `music_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M09 | 音源能力分开声明 | 单独声明搜索/登录/歌单/歌词/分页/音质能力；不支持音质选择的来源保持quality:false。 | `music_core.test.cjs`；当前来源均不声明quality选择；没有伪造平台功能。 |
| M10 | 按来源显示健康、冷却与故障类别 | 分开连接、登录、失败次数和冷却；429等待遵守响应，有限恢复及手动解除。 | `music_core.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M11 | 扫码生命周期和会话过期说明 | 扫码待扫/待授权/成功/过期区分；隐藏停止轮询，前台仅当前二维码、并发防重入，关闭中止。 | `music_core.test.cjs`；真实账号相册扫码、平台风控、Render重启后的真实会话待验。 |
| M12 | 跨平台匹配识别原版、现场和翻唱 | 严格歌名/全歌手匹配加现场/翻唱/伴奏/重制标记、已知时长容差；歧义由用户选。 | `music_core.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M13 | 持久保存用户手选的音源映射 | 用户手选映射保存原曲身份/目标资料/服务/确认时间，不存临时URL；刷新重验，保存失败不污染内存映射。 | `music_core.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M14 | 音质、格式与试听信息如实展示 | 仅透传已知码率/编码/试听资料，未知不猜；固定公共音质与账号能力分开，无解锁权益功能。 | `music_core.test.cjs`；平台未返回的音质/试听长度保持未知；公共固定128kbps接口不伪装可选无损。 |
| M15 | 网关可维护性和部署选择 | 网关健康信息暴露脱敏能力/运行时/存储；共享SQLite限流、Retry-After、实例限制与旧加密vault回退说明。 | `music_core.test.cjs`；会话仍要求单实例；共享限流不等于分布式会话，公网Render升级另核。 |
| M16 | 已导入歌单可以预览增量同步 | 绑定来源歌单，先预览新增/移除/资料变化；部分结果禁删，本地手工修改及并发修订受保护。 | `music_library_tools.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M17 | 歌单导入草稿和部分结果明确保存 | 跨刷新草稿、已读/总数未知/部分读取提示、续读与子集选择，确认后事务保存。 | `music_library_tools.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M18 | 歌单批量整理、拖动与撤销 | 歌单复制/合并去重预览、桌面拖动/指定位置、撤销；触控可滚动并用位置输入替代拖动。 | `music_library_tools.test.cjs`；触屏拖动采用滚动+位置输入替代，不宣称跨所有触屏原生拖放。 |
| M19 | 资料库筛选和规则歌单 | 歌手/来源/收藏/日期/未听/关键字筛选与规则歌单；历史未知不伪称已知，记录播放时间需规则明确启用。 | `music_library_tools.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M20 | 更完整的本地音频资料解析 | 按需Worker读取MP3/M4A/FLAC/Ogg常用标签、曲号/碟号/封面/歌词；预算受限、失败保留文件名导入。 | `music_library_tools.test.cjs`；轻量原生解析实现，不是完整music-metadata包；不保证全部畸形/古老标签、所有编码与容器。 |
| M21 | 批量导入与本地重复文件核对 | 批量预检/逐项结果/取消，大小+分块摘要仅提示疑似重复，由用户选择，不删除磁盘原文件。 | `music_library_tools.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M22 | 备份区分歌曲资料与真实本地音频 | 可选.uvuma分包包含实际本地音频与校验清单；缺文件/缺直链分别列出，跨设备新身份和重关联，不导出凭据。 | `music_library_tools.test.cjs`；普通.ee仍主要为资料备份；音频包须另存全部分包。直链凭据不迁移，换页需重填。 |
| M23 | 存储用量、孤立文件和低空间处理 | 本地实际大小与站点估算、持久保存申请；清理先预览，再核对库/持久聊天卡片/队列/文件哈希，只删确认孤立音频。 | `music_library_tools.test.cjs`；跨不同IndexedDB无法保证跨库原子事务；通过Web Locks/持久引用/哈希复核保守拒绝删除，缺锁拒绝风险写入。 |
| M24 | 每首歌独立的歌词时间校准 | 歌词用户偏移按原曲+实际录音版本保存，与文件offset分别记录且只应用一次。 | `music_lyrics_enhancements.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M25 | 原文翻译按时间配对 | 统一时间轴配对译文、多标签/同秒/缺行处理；双语可选，默认14px居中不显示时间。 | `music_lyrics_enhancements.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M26 | 手选歌词与本地LRC导入 | 本地LRC/文本、预览、手选/绑定/解除绑定，恶意标签仅作文字，原歌词不覆盖。 | `music_lyrics_enhancements.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M27 | 可选LRCLIB歌词补源 | 默认关闭LRCLIB，原源无结果后才补；核对标题/歌手/专辑/时长、缓存和取消，歧义手选。 | `music_lyrics_enhancements.test.cjs`；LRCLIB公网真实匹配质量未验证，不承诺每首都有正确歌词。 |
| M28 | 可选逐字歌词与多格式解析 | 可选增强LRC/YRC/常用TTML逐字时间，解析和渲染分离；不支持语义安全退回逐行，无大型动画依赖。 | `music_lyrics_enhancements.test.cjs`；不覆盖全部TTML帧率/tick/seq/ruby等扩展语义；不支持时退回逐行。 |
| M29 | 歌词跟随与拖动定位稳定 | 二分定位、换句更新、手滚暂停跟随、点句防拖动误触；隐藏暂停绘制，前台用实际时间恢复。 | `music_lyrics_enhancements.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M30 | 角色歌单可选择主API、副API或独立配置 | 角色歌单推荐显式选主/副/独立API，刷新时显示来源；独立凭据仅当前标签页，不改普通聊天API。 | `music_character_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M31 | 推荐依据由用户控制 | 最近6条有效正文/已确认偏好开关；过滤隐藏、撤回、停用、状态、思考，关闭的资料不进请求。 | `music_character_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M32 | 推荐预览、排除与保留手选歌曲 | 推荐候选预览、锁曲/排除/排序/删除，替换也保留锁曲；预览新增/保留数量按实际保存集合计算。 | `music_character_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M33 | 继续强化角色、存档和邀请来源的一致性 | 异步预览/歌词/分享/邀请固定角色、存档、来源修订；改人设/关系/实际使用消息使旧结果失效。 | `music_character_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M34 | 一起听队列范围与恢复入口更清楚 | 可查看本次队列，只本首或连续队列；外部切曲暂停，可明确采用当前队列，历史邀请事实不改。 | `music_character_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M35 | 主动邀请条件与冷却可设置 | 只当前私聊、允许曲目与30分钟至7天冷却可设；无额外后台模型请求，关闭时不产生邀请。 | `music_character_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M36 | 音乐分享内容明确选择并可回看 | 分享从当前句选行、手写片段、可选进度并预览；异步返回不覆盖草稿，不注入长期听歌史。 | `music_character_optimization.test.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M37 | 无障碍和小屏操作补齐 | 新增面板键盘/Escape/焦点返回/内滚动、小屏和大字核验；保留原Apple布局、兔子图标和账号/公共设置。 | `music_browser.cjs`；320/390/768与键盘实测；实体手机读屏和全部个人主题仍待验。 |
| M38 | 长歌单按需渲染 | 普通列表/管理/工具预览/规则/顺序每批60首；选择集合覆盖未显示歌曲，完整队列与原始位置不被裁剪。 | `music_browser.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M39 | 按变化范围更新播放器和卡片 | 进度通知复用不可变元数据，卡片/一起听按变化更新；隐藏歌词停绘，音频/BlobURL/监听卸载清理。 | `music_browser.cjs`；已验监听/URL清理与有界列表；未做长达数小时手机内存实测。 |
| M40 | 逐步分离播放、存储和接口职责 | 增量拆出runtime、lyrics、metadata Worker、library tools与可选extensions；沿用原IIFE公开入口，无框架重构。 | `music_browser.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M41 | 音乐专属脱敏故障报告 | 白名单脱敏诊断复制，包含来源/阶段/类别/状态/等待信息；不收密钥、临时URL和聊天正文。 | `music_browser.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M42 | 固定音乐回归矩阵与升级验收 | 追加固定行为夹具、完整App与独立扩展浏览器矩阵、实际1900目录严格对照，区分自动/真实服务/用户验收。 | `music_browser.cjs`；自动行为与对应页面检查通过；用户实际环境待验。 |
| M43 | 可选离线音频包与弱网预取 | 默认关授权完整音频缓存、容量/单删/清空/Range206/取消保护；正式test独立缓存，仅明确手动预取，不自动整歌单下载。 | `music_extensions.test.cjs`；平台授权和CORS需实际来源支持；没有自动全歌单预下载。缓存可被浏览器回收。 |
| M44 | 可选淡入淡出、均衡器与音量补偿 | 默认关五段EQ、已有ReplayGain补偿、淡出后切曲及淡入；Blob可用，无CORS/上下文不可用退回原audio。 | `music_extensions.test.cjs`；串行淡出/淡入，不是双音轨无缝交叠；开启网络音效可能先读完整文件，最大200MB。 |
| M45 | 连接自己的Navidrome音乐库 | 独立Navidrome/OpenSubsonic认证、能力协商、搜索/歌单分页/结构歌词/自有音频；serverId隔离，不在Pages启动服务器。 | `music_extensions.test.cjs`；真实私人服务器账号/CORS/实现差异待验；不支持formPost的服务器明确拒绝，不降级URL传密码。 |
| M46 | 可选歌单跨设备同步与真实双人一起听 | 独立真实HTTP双人房间/权限/时钟进度/重连，歌单修订与三方冲突预览；各设备自行解析有权音源，提供服务源码未自动部署公网。 | `music_extensions.test.cjs`；独立服务本机HTTP双客户端验证，未部署公网或测试两台手机；跨会话无共同基线时不能推断完整删除历史。 |

## 验证记录

最终完整自动回归1818项通过，0失败、0跳过；带真实桌面1900原件的严格兼容检查82项通过，0失败、0跳过。此前1780/1812等数值仅是中间轮次。最终一轮曾发现旧扫码单元夹具缺少document可见状态；补齐夹具并完整重跑通过，未为通过测试取消新轮询保护。同步服务另验多字节错误邀请返回403且不影响后续合法加入。

完整App浏览器：music_browser、music_tools_ui_browser、music_core_ui_review_browser、music_recommendations_browser、music_sheet_ownership_browser。独立模块/扩展：music_lyrics_ui_browser、browser_music_extensions；后者连接真实本机HTTP同步服务、两个浏览器，另验同源main/test缓存隔离。MiniMax既有界面回归与语音生命周期分别检查；没有付费合成。

Chrome DevTools也在新隔离本地完整App检查模块和扩展入口、默认关闭、DOM布局及控制台。首次默认公网网关从localhost被CORS拒绝，属于本地未列白名单，不能算播放成功；随后空网关配置离线检查无error/warn。防病毒软件注入请求与App请求分开看待。

完整App的music_browser、music_core_ui_review_browser、music_tools_ui_browser，独立music_lyrics_ui_browser和browser_music_extensions均在最后代码整合后再次通过。recommendations、sheet_ownership、MiniMax界面已在本轮分别通过；memory_speech_lifecycle最终检查通过，确认实际请求过滤过期来源、合成流结束与音乐/语音生命周期。42个本次新增或修改的JS/CJS/MJS语法检查通过，Git差异检查通过。浏览器检查没有使用私人存档、真实账号或收费合成。

## 开源资料与实现方式

按固定版本检视播放/歌词/备份/规则/同步的接口与行为边界；没有复制受限AnyListen代码，没有添加大型播放器或替换框架。原调研55份快照（39源码、16许可证）仅临时保存在outputs，不提交第三方源码。下面给主要核对入口。

- qier222/YesPlayMusic：`5d5fa23b7429c82a9932bbc2c9f6036403c5757b`；[src/utils/Player.js](https://github.com/qier222/YesPlayMusic/blob/5d5fa23b7429c82a9932bbc2c9f6036403c5757b/src/utils/Player.js)。
- maotoumao/MusicFree：`d118b18b3d0c904400f7eea7bf99c0ceec6c1aee`；[src/core/pluginManager/plugin.ts](https://github.com/maotoumao/MusicFree/blob/d118b18b3d0c904400f7eea7bf99c0ceec6c1aee/src/core/pluginManager/plugin.ts)。
- navidrome/navidrome：`4cd7ab1c60e0e5cf9644c4f5dfad96a10a38120a`；[core/playlists/parse_nsp.go](https://github.com/navidrome/navidrome/blob/4cd7ab1c60e0e5cf9644c4f5dfad96a10a38120a/core/playlists/parse_nsp.go)。
- jeffvli/feishin：`760b7829e3c2d9c3811ac46abc36e72f30f6d42d`；[src/renderer/features/player/hooks/use-media-session.ts](https://github.com/jeffvli/feishin/blob/760b7829e3c2d9c3811ac46abc36e72f30f6d42d/src/renderer/features/player/hooks/use-media-session.ts)。
- DIYgod/APlayer：`52e9feee9c90022e577dac76ca159e164bb980f0`；[src/js/player.js](https://github.com/DIYgod/APlayer/blob/52e9feee9c90022e577dac76ca159e164bb980f0/src/js/player.js)。
- amll-dev/applemusic-like-lyrics：`f3297962e138038c8f14ec83580bc21b1e2f9beb`；[packages/lyric/src/formats/lrc/parser.ts](https://github.com/amll-dev/applemusic-like-lyrics/blob/f3297962e138038c8f14ec83580bc21b1e2f9beb/packages/lyric/src/formats/lrc/parser.ts)。
- goldfire/howler.js：`1d3053576a860e9854645493ad6c4a72c6cc6e45`；[src/howler.core.js](https://github.com/goldfire/howler.js/blob/1d3053576a860e9854645493ad6c4a72c6cc6e45/src/howler.core.js)。
- Borewit/music-metadata：`a8ac0a4ee04b636bdf676f51a3eb22734398e399`；[lib/core.ts](https://github.com/Borewit/music-metadata/blob/a8ac0a4ee04b636bdf676f51a3eb22734398e399/lib/core.ts)。
- tranxuanthang/lrclib：`ffdfed4dd8288f9065f5562508c13705cbe0436c`；[server/src/routes/get_lyrics_by_metadata.rs](https://github.com/tranxuanthang/lrclib/blob/ffdfed4dd8288f9065f5562508c13705cbe0436c/server/src/routes/get_lyrics_by_metadata.rs)。
- koel/koel：`ff58dc8972f1a2fc55aee0db51b5a898676fff53`；[resources/assets/js/services/audioService.ts](https://github.com/koel/koel/blob/ff58dc8972f1a2fc55aee0db51b5a898676fff53/resources/assets/js/services/audioService.ts)。
- swingmx/swingmusic：`fabb5f5bcf9ebada52511be9e30537bf7328295f`；[src/swingmusic/utils/remove_duplicates.py](https://github.com/swingmx/swingmusic/blob/fabb5f5bcf9ebada52511be9e30537bf7328295f/src/swingmusic/utils/remove_duplicates.py)。
- metowolf/Meting：`e812b0e8596e6891f5615769b969693e5f92b614`；[src/providers/base.js](https://github.com/metowolf/Meting/blob/e812b0e8596e6891f5615769b969693e5f92b614/src/providers/base.js)。
- jimmyshuixin/Music-api：`4d83862b063b31af3eab1d823cfc7ff584609234`；[src/providers/base.js](https://github.com/jimmyshuixin/Music-api/blob/4d83862b063b31af3eab1d823cfc7ff584609234/src/providers/base.js)。
- lyswhut/lx-music-desktop：`323e4bac505da428adae8db6b58039fb2b36b86d`；[src/main/modules/sync/server/modules/list/sync/handler.ts](https://github.com/lyswhut/lx-music-desktop/blob/323e4bac505da428adae8db6b58039fb2b36b86d/src/main/modules/sync/server/modules/list/sync/handler.ts)。
- listen1/listen1_chrome_extension：`3f24efa045125875a609dcb0f3f3f0be4edb8b37`；[js/l1_player.js](https://github.com/listen1/listen1_chrome_extension/blob/3f24efa045125875a609dcb0f3f3f0be4edb8b37/js/l1_player.js)。
- any-listen/any-listen：`9aaa14d591b833baddab802328fb139705fd589f`；[packages/shared/app/modules/resources/search/versionChars.ts](https://github.com/any-listen/any-listen/blob/9aaa14d591b833baddab802328fb139705fd589f/packages/shared/app/modules/resources/search/versionChars.ts)。

OpenSubsonic协议核对固定`dfbfccf427c2dd33f6a9effd68a5de427c2aec83`；Navidrome结构歌词固定`4cd7ab1c60e0e5cf9644c4f5dfad96a10a38120a`。实现细节及未支持语义见 [扩展说明](music-extensions.md) 和 [同步服务说明](../services/music-sync/README.md)。

## 回退与部署边界

可以逐项关闭网络恢复、独占播放、持久断点、LRCLIB、双语/逐字、离线缓存、音效、自建库与真人同步；不删除原歌单、聊天或本地音频。撤销代码使用普通Git revert，不能reset用户存档。音频清理前保留迁移分包；浏览器持久保存不是外部备份。

Pages只部署静态前端。音乐网关由既有Render项目独立部署；后端源码已具备不等于线上实例已升级。真人同步服务源码在services/music-sync，未自动创建公网服务器，不会在Pages内后台运行。真实音乐账号、私人Navidrome、两台实体手机、锁屏/蓝牙、长期后台、全部自定义主题与真实音效听感仍待实机验收。

本批按用户明确授权发布test及main；提交、远端SHA、Pages deployment.json和实际资源的最终核验是代码检查之后的独立步骤。最终发布证据另记Obsidian的projects/UvU/CURRENT.md，不能单凭这份随代码提交的报告认定线上已更新。
