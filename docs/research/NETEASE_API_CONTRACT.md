# ECHOFORM 网易云 API 契约

> 状态：Primary Baseline + T008 Installed Legacy Adapter + Candidate Provider
> 核验日期：2026-07-29
> 当前主 Provider：`NeteaseCloudMusicApi@4.32.0`
> 候选替代 Provider：`@neteasecloudmusicapienhanced/api@4.38.0`
> 登录态写操作：待专用账号验收，不得标记完成

## 1. 结论

`NeteaseCloudMusicApi@4.32.0` 继续作为 ECHOFORM 本地毕设版本的已运行基线；
`@neteasecloudmusicapienhanced/api@4.38.0` 作为原包失效时的候选替代 Provider。
两者都不能被视为稳定、有 SLA 的正式服务。原包的二维码、搜索、歌曲详情、歌词、评论
读取和音源 Response 已通过固定版本源码核验，其中匿名只读路径已实际运行。增强版已完成
发布包、哈希与核心模块源码核验，但尚未完成相同运行测试。完整扫码成功、个性化日推和
所有写操作仍需专用测试账号做第二阶段验收。

ECHOFORM 必须通过 `MusicProvider` 隔离该包。组件不得引用本文件列出的任何上游字段，
也不得因为根 `code === 200` 就判定音源可播。

## 2. 固定版本与证据

### 2.1 当前主发布物

| 项目 | 固定值 |
| --- | --- |
| npm package | `NeteaseCloudMusicApi` |
| version | `4.32.0`，必须精确锁定，不使用 `^` 或 `~` |
| npm `gitHead` | `4d63e5562199115915f2ee855460ef8999873b53` |
| tarball shasum | `7ab2ad102a0b7d2318695be13ae87737c3452ad9` |
| integrity | `sha512-yRDwpMcLZnOSkmR/flEpGEJpufNxOQVILb2+2mnSrKPZp/3PbIo2uIOuTa3SjGaAtK3dUKJdQBTkOn0POKDa+A==` |
| license | MIT，来自发布包 `package.json` 与 `LICENSE` |
| Node requirement | 上游声明 `>=12`；ECHOFORM 当前声明 `>=24` |

当前 GitHub 默认分支 HEAD 为
`b976e68cc3a068342a87f921f9bf086a611aaea0`，内容已被替换为停止维护说明，不包含用于
实现的完整模块源码，因此不能把该 HEAD 写入实现基线。README 指向 GitLab 上游，但本次
网络探测 GitLab 超时。可复现证据以 npm 发布包 `4.32.0` 为准。

### 2.2 候选增强发布物

仓库：[NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)

| 项目 | 固定值 |
| --- | --- |
| npm package | `@neteasecloudmusicapienhanced/api` |
| 当前可安装 version | `4.38.0`，候选验证时必须精确锁定 |
| Git tag | `v4.38.0` |
| tag commit | `7822ab08d3dcc9d53f5441e52c55419f738344e5` |
| tarball shasum | `03ccca36fd140d6135d19d7271332ca32ba2c9ca` |
| integrity | `sha512-kemzVNN1HAottXu5p3kcRd44kSuw3bzSCzbd/4T+71Bj5KG+BoNvOZTeKznSC++omh5DrNT8Y75lDS1vFZOuTQ==` |
| license | MIT，来自发布包 `package.json` 与 `LICENSE` |
| Node requirement | 发布包声明 `>=12`；仓库开发规则要求 Node 18+ |
| 当前验证等级 | `SOURCE_VERIFIED`，尚非 `RUNTIME_ANON` |

2026-07-29 查询时，GitHub 最新标签为 `v4.39.0`，commit
`63d89aa906f78c286a7f838258fa29220d7f41dd`，但 npm 尚无 `4.39.0`，当前
`latest` 仍为 `4.38.0`。不得把未发布标签写入项目依赖，也不得用 GitHub `main`
替代固定发布包。

增强包发布物包含 483 个文件和 431 个 API module；QR、登录状态、日推、搜索、
`song_url_v1`、普通/逐字歌词、评论和歌单模块均存在。下载后的 tarball SHA-1 与
SHA-512 已重新计算并与 npm 元数据一致。

### 2.3 集成形态

本地单实例版本优先把选定的固定 npm 包作为 server-only CommonJS 库嵌入对应
Provider，直接调用 `main.js` 导出的模块函数：

```ts
// Pseudocode: the adapter owns CommonJS interop and the untyped upstream result.
const api = loadSelectedServerOnlyNcmModule();
const upstream = await api.search({ keywords, type, limit, offset, cookie });
return mapSearchResponse(upstream);
```

约束：

- 相关 Route Handler 必须使用 Node.js runtime，不能使用 Edge runtime。
- 该包只能从 `src/lib/music/netease/` 的 server-only 模块导入。
- 不启动发布包的 Express `server.js` 作为浏览器可访问服务。
- 不运行 `app.js` 的自动版本检查或匿名 Token 初始化作为应用启动前置条件。
- 上游 Cookie 只通过函数参数传递，绝不进入 URL。
- `main.js` 导入时会在系统临时目录确保 `anonymous_token` 文件存在；该文件不是
  ECHOFORM Session，不得复制到仓库或用于判断用户已登录。
- Legacy 与 Enhanced 必须使用独立 Adapter 标识和独立 Contract fixtures，不能依据包名
  相似而复用未验证的原始字段判断。

嵌入库避免了额外端口、CORS 和 `server.js` 输出完整请求 URL 的日志风险。若包在 Next.js
Standalone 构建中无法正确打包，再评估受限 sidecar；该变更必须先更新架构文档。

增强包即使不启用解灰，也会把
`@neteasecloudmusicapienhanced/unblockmusic-utils` 作为依赖安装。ECHOFORM 只允许使用其
官方网易云请求路径，不得调用该依赖或任何解灰路由。

### 2.4 T008 落地记录（2026-07-30）

- 项目依赖已精确写入 `NeteaseCloudMusicApi: "4.32.0"`，无 `^`/`~`；lockfile 的
  version 与本节固定值一致，integrity 为
  `sha512-yRDwpMcLZnOSkmR/flEpGEJpufNxOQVILb2+2mnSrKPZp/3PbIo2uIOuTa3SjGaAtK3dUKJdQBTkOn0POKDa+A==`。
- 当前 npm 配置把 tarball resolved 地址写为 `registry.npmmirror.com`；内容 integrity 与
  固定 npm 发布物一致。本轮没有改 npm 全局配置。
- 真实 CommonJS 包只由 `src/lib/music/netease/legacyApi.server.ts` 延迟加载；loader 只
  提取白名单函数，不启动 `app.js` 或 Express `server.js`。纯 Adapter 通过依赖注入接受
  同一函数契约，因此默认 contract tests 不导入发布包、不创建网络请求。
- T008 已完成匿名搜索、歌曲详情、可用性预检、音源、歌词、评论与 QR code 状态的字段
  映射。`type=all` 由歌曲/歌手/专辑三类调用组合；音源默认 `corsMode: unavailable`，不把
  单次历史 CORS 样本推广成所有 CDN 节点的保证。
- 新增 13 项完全合成的离线 Legacy contract tests；连同既有用例当前 contract 为 19 项。
  覆盖精确版本/integrity、包引用边界、搜索/详情、部分成功、根业务码非 200、
  `check_music.success=false`、音源行 404/null URL、短期音源映射、`yrc` 缺失、评论、
  QR 801 与未知异常脱敏。
- 安装命令成功退出，但 npm 报告现有可选 WASM 依赖树中 `@emnapi/*` 的 peer override
  警告；未使用 bypass flag。该警告不来自 Legacy 包的运行调用，后续仍由全量测试和构建
  验证是否产生实际影响。
- 本轮没有运行 Live 匿名 probe，没有扫码，没有产生或保存 QR key/Cookie/音源 URL，
  没有调用登录态或外部写操作。因此 802/803、个人日推与写操作的验证等级保持不变。
- T008 Adapter 是 T009/T010 的 server-only 基础，不提前实现 BFF、Session 或完整登录
  生命周期；这些任务不能因离线字段契约通过而标记完成。

## 3. 核验等级

| 等级 | 含义 | 能否据此实现 |
| --- | --- | :---: |
| `RUNTIME_ANON` | 固定包实际启动并完成匿名只读请求 | 是，但仅限同类匿名路径 |
| `SOURCE_VERIFIED` | 模块源码、参数和路由存在 | 可以适配，不代表账号或写入成功 |
| `PENDING_AUTH` | 需要真实登录态，尚未用专用账号实测 | 只能实现保护与模拟，不能完成验收 |
| `MUTATION_NOT_RUN` | 会改变网易云外部状态，刻意未执行 | 不得宣称真实写入可用 |
| `BLOCKED` | 已知上游缺陷或无法稳定归一化 | 不得用于 P0 |

验证等级按“Provider + 固定版本 + 路径”分别记录。Legacy 的 `RUNTIME_ANON` 不能继承给
Enhanced，Enhanced 的源码修复也不能反向证明 Legacy 可用。

本次运行核验使用临时目录安装发布包，启动本机临时实例，访问上游时仅执行匿名读取。
没有输出或保存 Cookie、QR key、二维码正文、用户资料、评论正文或音源 URL。
两个候选下载后的 tarball SHA-1 与 SHA-512 均已重新计算，并与各自 npm 元数据完全一致。

## 4. 核验结果

### 4.1 运行结果摘要

以下运行结果仅适用于 `NeteaseCloudMusicApi@4.32.0`：

| 上游路由 | 结果 | 等级 | 关键观察 |
| --- | --- | --- | --- |
| `/search` | HTTP 200 / code 200 | `RUNTIME_ANON` | `result.songs` 存在，匿名歌曲搜索成功 |
| `/song/detail` | HTTP 200 / code 200 | `RUNTIME_ANON` | 单曲详情数组存在 |
| `/lyric` | HTTP 200 / code 200 | `RUNTIME_ANON` | `lrc` 存在 |
| `/lyric/new` | HTTP 200 / code 200 | `RUNTIME_ANON` | `lrc` 存在；本样本无 `yrc`，证明逐字歌词可缺失 |
| `/check/music` | HTTP 200 / code 200 | `RUNTIME_ANON` | 样本返回 `success: false`，业务失败仍是 code 200 |
| `/song/url/v1` | HTTP 200 / code 200 | `RUNTIME_ANON` | 单曲行可为 code 404 且 `url: null` |
| `/comment/music` | HTTP 200 / code 200 | `RUNTIME_ANON` | 评论数组可匿名读取 |
| `/login/qr/key` | HTTP 200 / code 200 | `RUNTIME_ANON` | key 存在但已脱敏 |
| `/login/qr/create` | HTTP 200 / code 200 | `RUNTIME_ANON` | `qrurl` 和 `qrimg` 均存在，正文未输出 |
| `/login/qr/check` | HTTP 200 / code 801 | `RUNTIME_ANON` | 未扫码时为等待状态 801 |
| `/login/status` | HTTP 200 / 内层 code 200 | `RUNTIME_ANON` | 匿名时 `account` 不存在 |
| `/recommend/songs` | HTTP 200 / code 200 | `RUNTIME_ANON` | 匿名返回 30 条，但不能视为个人日推 |

补充音源探测：从匿名日推取前 10 首请求 standard 音质，返回 10 行，其中 1 行 code 200
且有 URL，9 行 code 404 且无 URL。对唯一可播 URL 的匿名 `HEAD` 请求返回 200，
`Content-Type: audio/mpeg`，`Access-Control-Allow-Origin: *`，并存在正数 `expi`。

结论：

- 是否可播必须逐曲判断，不能由歌曲详情或推荐成功推导。
- 根 code 200 不能覆盖音源行 code 404。
- 匿名返回的 30 条日推只能用于可用性研究；ECHOFORM 的“个人日推”必须在有效登录账号
  下重新验收，且校验 Session 用户 ID。
- CDN CORS 只对本次唯一可播样本成立，不能保证所有格式和节点都相同。

### 4.2 尚未运行的路径

- QR 状态 `802` 和 `803`，以及成功返回 Cookie。
- 登录后的 `/login/status`、`/user/account` 和 `/user/detail`。
- 登录账号的真实个人 `/recommend/songs`。
- VIP、地区限制和不同音质账户的音源结果。
- 评论发布/回复、喜欢、创建歌单、添加歌曲、收藏歌单等外部写操作。

这些项目必须使用专用测试账号，不使用个人主账号，并在执行前明确写入范围与回滚方式。

### 4.3 增强版候选核验

`@neteasecloudmusicapienhanced/api@4.38.0` 当前只达到 `SOURCE_VERIFIED`：

| 项目 | 结果 | 影响 |
| --- | --- | --- |
| npm 发布物 | 4.38.0 可安装，SHA-1/SHA-512 匹配 | 可作为可复现候选 |
| 模块导出 | `main.js` 仍按文件名导出 CommonJS 函数 | 可沿用 server-only Adapter 结构 |
| QR 三段流程 | key/create/check 模块均存在 | 仍需 801/802/803/800 运行验收 |
| QR 异常分支 | `login_qr_check` 与 Legacy 缺陷相同 | Adapter 仍必须统一捕获异常 |
| 日推 | 增加可选 `afresh` 参数 | 默认不传；缓存刷新策略单独验证 |
| 搜索 | 类型和分页映射与 Legacy 一致 | 仍需歌曲/专辑/歌手运行验收 |
| 音源 | 使用 `xeapi`，并新增 `unblock` 分支 | 必须禁用解灰并重新验证 URL 形状 |
| 歌词 | 普通与逐字模块路径保持一致 | 仍需验证 `yrc` 可选降级 |
| 评论写入 | 改用 `eapi` + `v2` | 所有写操作必须重新做专用账号验收 |
| 歌单曲目 | 保留 code 512 重试和嵌套形状风险 | Adapter fixtures 必须继续覆盖 |

增强版运行验收必须重复 Legacy 的全部匿名矩阵，不能只测试“服务能启动”。登录态验收还要
覆盖扫码成功、Session 恢复、个人日推、受限音源和账号退出。

### 4.4 Real Provider 与数据模式切换策略

Legacy / Enhanced Real Provider 是启动时选择，不是单次请求失败后的自动重试目标：

1. 默认继续使用已经达到 `RUNTIME_ANON` 的 Legacy 4.32.0。
2. Legacy 的核心链路在当前环境无法通过时，先确认不是 Session、风控、网络或单曲版权
   问题，再运行 Enhanced 4.38.0 的完整 Contract Probe。
3. Enhanced 至少通过 QR、登录状态、个人日推、搜索、音源、歌词和评论读取后，才可切换
   为当前 Real Provider。
4. 切换 Provider 时重启服务并销毁旧 ECHOFORM Session，要求用户重新扫码，禁止跨
   Provider 复用内存 Session。
5. 评论、喜欢和歌单写入绝不自动故障转移，防止首次请求实际成功但响应丢失后在另一
   Provider 重复提交。
6. 两个 Real Provider 都失败时，只能由用户显式进入带 `DEMO` 标识的 Demo Mode。

Demo Mode 不会把 Real Provider 替换为另一个上游实现。服务端始终保留启动时固定的 Real
Provider，同时提供独立 `DemoMusicProvider`。新 ECHOFORM Session 的数据模式为 `real`；
只有用户调用 `PUT /api/mode` 才能把当前 Session 切换为 `demo` 或返回 `real`。Real 请求
失败、单首歌曲无版权、VIP/地区限制、一次超时、QR 过期、用户退出或非法参数都不能自动
改变数据模式，也不能触发 Real Provider 切换。

### 4.5 增强版禁止能力

ECHOFORM 不使用增强版的解灰、第三方音源匹配或代理 URL：

- 不调用 `/song/url/match`、`song_url_match` 或 `unblockmusic-utils`。
- 调用 `song_url_v1` 时永远不传 `unblock=true`、`source` 或代理参数。
- 若未来改为 sidecar，必须显式设置 `ENABLE_GENERAL_UNBLOCK=false`。
- Adapter 收到非空 `proxyUrl`、解灰警告信息或无法证明来自正常上游分支的 Response 时，
  返回 `UPSTREAM_UNAVAILABLE`，不得播放。
- 不以增强版绕过版权、VIP、地区、付费或账号权限；现有不可播放状态机继续生效。

## 5. 上游接口映射

除非另有说明，本节列出的模块在 Legacy 4.32.0 与 Enhanced 4.38.0 中均存在。表中的
`RUNTIME_ANON` 只代表 Legacy；Enhanced 在完成 4.3 节运行验收前仍为
`SOURCE_VERIFIED`。

### 5.1 登录与用户

| ECHOFORM 能力 | 上游函数 / 路由 | 参数 | 验证等级 |
| --- | --- | --- | --- |
| 创建 QR key | `login_qr_key` / `/login/qr/key` | `timestamp` | `RUNTIME_ANON` |
| 生成 QR | `login_qr_create` / `/login/qr/create` | `key`, `qrimg=true` | `RUNTIME_ANON` |
| 查询 QR | `login_qr_check` / `/login/qr/check` | `key`, `timestamp` | 801 已实测；802/803 `PENDING_AUTH` |
| 登录状态 | `login_status` / `/login/status` | `cookie`, `timestamp` | 匿名已实测；登录态 `PENDING_AUTH` |
| 账号信息 | `user_account` / `/user/account` | `cookie` | `SOURCE_VERIFIED` |
| 用户详情 | `user_detail` / `/user/detail` | `uid`, `cookie?` | `SOURCE_VERIFIED` |

QR 状态定义来自固定发布包文档：

```ts
type UpstreamQrCode = 800 | 801 | 802 | 803;

// 800 expired
// 801 waiting for scan
// 802 scanned, waiting for confirmation
// 803 authorized; upstream cookie may be returned
```

两个固定版本的 `login_qr_check.js` 都存在已知缺陷：上游请求抛错时，`catch` 分支引用了
`try` 块内的 `result.cookie`。Provider 不能依赖其异常 Body，必须捕获抛错并统一映射为
可重试的 `UPSTREAM_UNAVAILABLE`，同时保留当前 Challenge 直到截止时间。

### 5.2 日推、搜索与详情

| 能力 | 上游函数 / 路由 | 关键参数 | 验证等级 |
| --- | --- | --- | --- |
| 个人日推 | `recommend_songs` / `/recommend/songs` | `cookie` | 匿名 `RUNTIME_ANON`；个人 `PENDING_AUTH` |
| 搜索歌曲 | `search` / `/search` | `keywords`, `type=1`, `limit`, `offset` | `RUNTIME_ANON` |
| 搜索专辑 | `search` / `/search` | `type=10` | `SOURCE_VERIFIED` |
| 搜索歌手 | `search` / `/search` | `type=100` | `SOURCE_VERIFIED` |
| 歌曲详情 | `song_detail` / `/song/detail` | `ids` | `RUNTIME_ANON` |
| 用户歌单 | `user_playlist` / `/user/playlist` | `uid`, `limit`, `offset` | `SOURCE_VERIFIED` |

`keywords` 去除首尾空白后长度为 1 至 100；`limit` 最大 30；`offset` 最小 0。搜索
类型只能由 ECHOFORM 枚举映射，禁止把客户端任意数字直接传给上游。

### 5.3 音源与歌词

| 能力 | 上游函数 / 路由 | 关键参数 | 验证等级 |
| --- | --- | --- | --- |
| 可用性预检 | `check_music` / `/check/music` | `id`, `br?` | `RUNTIME_ANON` |
| 播放 URL | `song_url_v1` / `/song/url/v1` | `id`, `level`, `cookie?` | `RUNTIME_ANON` |
| 普通歌词 | `lyric` / `/lyric` | `id` | `RUNTIME_ANON` |
| 逐字歌词 | `lyric_new` / `/lyric/new` | `id` | `RUNTIME_ANON` |

允许音质：

```ts
type AudioQuality =
  | "standard"
  | "exhigh"
  | "lossless"
  | "hires";
```

`jyeffect`、`sky` 和 `jymaster` 暂不进入 P0，因为需要额外设备、会员和兼容性验收。
请求音质不可用时，Provider 可按用户许可降级为更低音质，但必须在归一化结果中返回实际
`quality`；不能把降级后的音质伪装成请求音质。

### 5.4 评论与音乐库写入

| 能力 | 上游函数 / 路由 | 参数 | 验证等级 |
| --- | --- | --- | --- |
| 读取歌曲评论 | `comment_music` / `/comment/music` | `id`, `limit`, `offset`, `before?` | `RUNTIME_ANON` |
| 发布评论 | `comment` / `/comment` | `t=1`, `type=0`, `id`, `content`, `cookie` | `MUTATION_NOT_RUN` |
| 回复评论 | `comment` / `/comment` | `t=2`, `type=0`, `id`, `commentId`, `content`, `cookie` | `MUTATION_NOT_RUN` |
| 喜欢/取消喜欢 | `like` / `/like` | `id`, `like`, `cookie` | `MUTATION_NOT_RUN` |
| 创建歌单 | `playlist_create` / `/playlist/create` | `name`, `privacy`, `type`, `cookie` | `MUTATION_NOT_RUN` |
| 添加/移除歌曲 | `playlist_tracks` / `/playlist/tracks` | `op`, `pid`, `tracks`, `cookie` | `MUTATION_NOT_RUN` |
| 收藏/取消歌单 | `playlist_subscribe` / `/playlist/subscribe` | `id`, `t`, `cookie` | `MUTATION_NOT_RUN` |

评论正文 1 至 1000 字符；歌单名 1 至 40 字符。最终限制以登录态实测为准。写操作只接收
JSON `POST`/`PUT`/`DELETE`，不得将评论或歌单名称放在 Query String。所有写操作禁止
自动重试，避免重复评论或重复建单。

`playlist_tracks.js` 的成功 Response 可能出现额外嵌套，且 code 512 时会用重复
`trackIds` 再请求。Adapter 必须用夹具覆盖这两种形状，不能把原始 Response 透传。

## 6. 内部归一化模型

### 6.1 Track

```ts
export type ArtistSummary = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type AlbumSummary = {
  id: string;
  name: string;
  artworkUrl: string | null;
};

export type TrackAvailability =
  | "playable"
  | "vip"
  | "copyright"
  | "region"
  | "unknown";

export type Track = {
  id: string;
  name: string;
  artists: ArtistSummary[];
  album: AlbumSummary;
  durationMs: number;
  artworkUrl: string | null;
  aliases: string[];
  explicit: boolean;
  availability: TrackAvailability;
  privilege: {
    fee: number | null;
    maxQuality: AudioQuality | null;
  };
};
```

上游可能同时使用 `ar`/`artists`、`al`/`album`、`dt`/`duration`。这些差异只能在
Adapter 中处理。所有数值 ID 转为十进制字符串，避免 JavaScript 大整数和路由类型混乱。

### 6.2 PlaybackSource

```ts
export type PlaybackSource = {
  url: string;
  expiresAt: number;
  quality: AudioQuality;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  sizeBytes: number | null;
  corsMode: "anonymous" | "unavailable";
};
```

映射规则：

- 只有行 `code === 200` 且 `url` 是 HTTPS URL 时创建成功结果。
- `expiresAt = receivedAt + expi * 1000`；缺少或非法 `expi` 时使用最多 5 分钟本地 TTL。
- `level` 映射实际 `quality`，`type`/`encodeType` 映射 `codec`，`br` 映射 bitrate。
- URL 不进入 JSON 日志、持久缓存或错误详情。
- `HEAD` 验证不是每次播放必做，只在契约探测中检查 CORS。

若 `check_music.success === false`，或音源行 code 非 200、URL 为空，返回失败而不是构造
空 `PlaybackSource`。

### 6.3 Lyrics

```ts
export type LyricWord = {
  startMs: number;
  durationMs: number;
  text: string;
};

export type LyricLine = {
  startMs: number;
  durationMs: number | null;
  text: string;
  translation: string | null;
  romanization: string | null;
  words: LyricWord[] | null;
};

export type LyricDocument = {
  kind: "synced" | "plain" | "instrumental" | "unavailable";
  lines: LyricLine[];
};
```

- 普通 LRC 来自 `lrc.lyric`。
- 翻译来自 `tlyric.lyric`，罗马音来自 `romalrc.lyric`，按时间戳合并。
- 逐字歌词来自可选的 `yrc.lyric`，缺失时降级为行级歌词。
- 无时间戳文本保留为 plain，不伪造逐字时间。
- 解析器跳过无法识别的元数据行，但不得让单行错误丢失整首歌词。

### 6.4 User 与 Comment

```ts
export type UserProfile = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  signature: string | null;
};

export type Comment = {
  id: string;
  author: UserProfile;
  content: string;
  createdAt: number;
  likedCount: number;
  likedByCurrentUser: boolean;
  replyTo: { id: string; nickname: string } | null;
};
```

公开用户模型不包含手机号、绑定信息、账号 Token、生日、城市等当前页面不需要的数据。

## 7. ECHOFORM BFF 具体契约

### 7.1 数据模式

`PUT /api/mode`

```ts
type SetDataModeInput = {
  mode: "real" | "demo";
};

type SetDataModeResponse = {
  mode: "real" | "demo";
  user: UserProfile | null;
};
```

- 新 Session 始终从 `real` 开始；接口只接受上述两个枚举值并使用 `no-store`。
- `demo` 只在用户点击“使用演示数据”等明确操作后设置，不能由错误处理器内部调用。
- Demo 响应由独立 `DemoMusicProvider` 产生并带 `meta.mode = "demo"`，不得混入真实用户
  资料、真实日推或上游音源。
- 返回 `real` 时重新验证现有服务端上游 Session；无有效账号时以 Real 游客态返回
  `user: null`，不得沿用 Demo 身份或伪造登录。
- 模式仅保存在 ECHOFORM 服务端 Session，不写入 URL 或 localStorage；服务器重启后随
  Session 一起回到默认 Real Mode。
- 模式切换前，客户端必须取消旧模式请求并发送 Player `UNLOAD`，防止真实音源、队列或
  用户资料与 Demo 数据混用；模式切换是用户主动的上下文重置。

### 7.2 QR

`POST /api/auth/qr`

```ts
type StartQrResponse = {
  challengeId: string;
  status: "waiting";
  qrImageDataUrl: string;
  expiresAt: number;
};
```

`challengeId` 是 ECHOFORM 生成的不透明随机值，不是上游 key。二维码 Data URL 只存在于
当前组件内存；关闭 Dialog 或过期后立即释放。

`GET /api/auth/qr/status?challengeId=...`

```ts
type QrStatusResponse =
  | { status: "waiting"; expiresAt: number }
  | { status: "scanned"; expiresAt: number }
  | { status: "authorized"; user: UserProfile }
  | { status: "expired" };
```

过期 Challenge、Session 不匹配和已被新 Challenge 替换都返回 `QR_EXPIRED`，防止旧轮询
覆盖新登录状态。

### 7.3 搜索

`GET /api/search?q=...&type=all|track|album|artist&limit=20&offset=0`

```ts
type SearchKind = "track" | "album" | "artist";

type SearchPage<T, K extends SearchKind> = {
  type: K;
  items: T[];
  total: number | null;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type SearchSection<T> = {
  items: T[];
  total: number | null;
  hasMore: boolean;
};

type SearchAllResult = {
  type: "all";
  tracks: SearchSection<Track>;
  artists: SearchSection<ArtistSummary>;
  albums: SearchSection<AlbumSummary>;
  partialErrors: Array<{
    type: SearchKind;
    code: AppErrorCode;
    retryable: boolean;
  }>;
};

type SearchResponse =
  | SearchPage<Track, "track">
  | SearchPage<AlbumSummary, "album">
  | SearchPage<ArtistSummary, "artist">
  | SearchAllResult;
```

类型映射为 `track -> 1`、`album -> 10`、`artist -> 100`。`all` 不直接使用尚未实测的
上游综合类型，而是由 BFF 并发请求三种已知类型：最多 5 首歌曲、4 位歌手、4 张专辑。
三类请求共享取消信号并使用 `Promise.allSettled` 语义：至少一类成功时返回成功结果和
`partialErrors`；三类全部失败时返回统一 `ApiFailure`。综合结果不分页，用户进入单类型
Tab 后再使用 `limit` 和 `offset`。持按搜索只改变 UI 展开方式，不改变 HTTP 契约。

### 7.4 音源

`GET /api/tracks/:id/source?quality=standard`

- 成功：返回 `PlaybackSource`，响应 `Cache-Control: no-store`。
- 无版权：HTTP 409 / `TRACK_UNAVAILABLE`。
- 需要 VIP：HTTP 403 / `VIP_REQUIRED`。
- 地区限制：HTTP 451 / `REGION_RESTRICTED`。
- Session 失效且该曲需要登录：HTTP 401 / `SESSION_EXPIRED`。
- 未知上游失败：HTTP 502 / `UPSTREAM_UNAVAILABLE`。

无法从固定版本字段可靠区分 VIP、地区和普通无版权时，先返回
`TRACK_UNAVAILABLE`，不得根据文案字符串臆测。只有登录态样本建立稳定映射后再细分。

### 7.5 评论写入

`POST /api/tracks/:id/comments`

```ts
type CreateCommentInput = {
  content: string;
  replyToCommentId?: string;
  clientMutationId: string;
};
```

BFF 在单个 Session 内短期记录 `clientMutationId`，重复提交返回第一次结果，不再次调用
上游。成功后刷新评论第一页；UI 不先伪造已发布成功。

## 8. Cookie 与隐私

- 接收 803 时，从函数返回的 Cookie 集合中提取上游会话 Cookie，只写入服务端 Session。
- 不把上游 Cookie设置为浏览器 Cookie；浏览器只有 ECHOFORM `sid`。
- 不接受客户端上传任意 Cookie 字符串。
- 不把 Cookie 放在 query、URL、`requestId`、错误详情或 analytics 中。
- QR key 和二维码 Data URL 不进入持久层、截图夹具或 Contract fixtures。
- 账号 Response 先白名单映射为 `UserProfile`，再交给浏览器。
- 搜索词、评论正文和用户资料不写入普通日志。

## 9. 超时、重试与缓存

| 类型 | 超时 | 自动重试 | 缓存 |
| --- | ---: | :---: | --- |
| QR key/create/check | 10s | 读取最多 1 次 | `no-store` |
| 登录状态/日推 | 10s | 最多 1 次 | `no-store` |
| 搜索/详情/歌词 | 10s | 最多 1 次 | 公开元数据最多 5min |
| 音源 | 15s | 过期时刷新 1 次 | 只存内存至 `expiresAt - 60s` |
| 评论读取 | 10s | 最多 1 次 | 最多 30s |
| 评论/喜欢/歌单写入 | 15s | 否 | 成功后失效相关读取缓存 |

429、超时和网络错误只能对读取做一次带随机抖动的重试。401、403、409、451 及所有写入
不得自动重试。

## 10. 已知风险

1. Legacy GitHub 默认分支已停止维护，未来 npm 包也可能下架或接口失效。
2. 上游依赖非公开接口，Response、加密、风控和登录随时可能变化。
3. 匿名日推能返回数据不等于个人日推；必须绑定有效登录账号验收。
4. 音源可用率受版权、会员、地区、设备和账号影响，不能保证推荐列表全部可播。
5. `login_qr_check` 和 `playlist_tracks` 存在源码级异常/形状风险，必须由 Adapter 隔离。
6. CDN CORS 只验证了一个 mp3 样本；Web Audio 可视化必须准备
   `corsMode: unavailable` 降级。
7. 外部写操作没有执行验证，当前不能承诺评论、收藏和歌单管理真实可用。
8. Enhanced 虽然持续维护，但其新增 `xeapi`、解灰依赖和写接口加密方式会产生新的兼容与
   合规风险，不能把“版本更新”理解成无条件更稳定。
9. GitHub 标签可能先于 npm 发布；实现只能锁定已验证的发布物，不跟随 `main` 或未发布
   标签。

## 11. 第二阶段登录态验收脚本要求

脚本尚未创建；实现时必须满足：

- 只在手动命令中运行，不进默认 CI。
- 使用专用测试账号，并在终端交互扫码，不保存二维码截图。
- Legacy 与 Enhanced 分别运行并分别报告，禁止合并成一个“Real Provider 通过”。
- 输出只包含端点、HTTP 状态、业务码、字段存在性和数量。
- 测试评论使用唯一前缀，验收后通过同一接口删除。
- 测试歌单使用唯一名称，验收结束后删除；删除属于外部写入，执行前再次确认范围。
- 不打印 Cookie、用户昵称、头像 URL、歌曲 URL、评论正文或歌单名称。
- 结束时销毁本地 Session 并调用上游登出。

## 12. 契约验收门槛

- `API-AC-01`：当前选定 Provider 精确锁定为本文已验证版本，且 lockfile 与对应
  integrity 一致。
- `API-AC-02`：只有 `src/lib/music/netease/` 引用上游包和字段。
- `API-AC-03`：二维码 UI覆盖 800/801/802/803、网络错误和本地截止时间。
- `API-AC-04`：803 后再次验证账号，账号为空不能进入 logged-in。
- `API-AC-05`：匿名日推不能作为个人日推验收通过。
- `API-AC-06`：根 code 200、行 code 404、空 URL 被判定为不可播放。
- `API-AC-07`：`yrc` 缺失时歌词自然降级到行级，不报整页错误。
- `API-AC-08`：音源在 `expiresAt - 60s` 后不可复用。
- `API-AC-09`：写操作无自动重试且具备重复提交保护。
- `API-AC-10`：日志与客户端存储中不存在敏感上游数据。
- `API-AC-11`：登录态和写操作必须在本文件升级验证等级后才能标记完成。
- `API-AC-12`：上游未知形状返回可恢复错误，不把原始 Response 传给组件。
- `API-AC-13`：Enhanced 只有通过同一 Contract Probe 后才可成为当前 Real Provider。
- `API-AC-14`：Legacy / Enhanced Real Provider 切换发生在启动边界并清除 Session，不做逐请求自动故障转移。
- `API-AC-15`：Enhanced 的解灰、第三方匹配和代理 URL 在代码、配置与测试中均不可达。
- `API-AC-16`：`type=all` 使用三类独立查询，支持部分成功且不会被单类失败清空全部结果。
- `API-AC-17`：新 Session 默认 Real；Demo 只能由用户显式切换，响应带明确模式且不混用真实用户数据。
