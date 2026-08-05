# ECHOFORM 技术架构

> 状态：Architecture Baseline v1.0
> 冻结日期：2026-07-29
> 适用范围：本地开发、单实例毕设演示
> 关联文档：`ECHOFORM_PRD_DRAFT.md`、`ECHOFORM_VISUAL_DESIGN.md`、`NETEASE_API_CONTRACT.md`、`PLAYER_STATE_MACHINE.md`

## 1. 结论

ECHOFORM 当前交付目标是本地单实例毕业设计版本，采用 Next.js 单仓应用：App Router 负责页面，Route
Handlers 组成同源 BFF，浏览器只访问 ECHOFORM 的 `/api/*`，BFF 通过 server-only
Provider 调用固定版本的网易云 API 包。音频元素与播放器控制器挂在根布局下，路由切换
不能重建。

本地答辩版使用进程内 Session Store。页面刷新可保持登录，开发服务器重启后要求重新
扫码。这是刻意限制，不是假装具备生产级账号系统。公开部署需要持久 Session Store、
部署拓扑和密钥管理，属于后续需单独批准的架构变更。

## 2. 架构目标与非目标

### 2.1 目标

- 隔离不稳定且可能变化的上游字段，页面只消费 ECHOFORM 内部模型。
- 上游 Cookie、QR key 和账号凭证不进入浏览器存储、日志、源码或 Git。
- 保证播放不随路由切换中断，并能处理 URL 过期、版权、VIP、地区和网络错误。
- Real Provider 与 Demo Provider 可替换，但两种模式必须在 UI 和应用状态中可辨认。
- 在不引入数据库的前提下，完成本地单实例、单用户的毕设演示。
- 为以后增加自动测试、持久 Session Store 和其他音乐源保留边界。

### 2.2 非目标

- 本阶段不提供多实例部署、跨设备同步或生产级高可用。
- 不绕过网易云版权、VIP、地区或风控限制。
- 不代理、缓存或永久保存完整音频文件。
- 不把 NeteaseCloudMusicApi 的原始 Response 直接暴露给 React 组件。
- 不在本阶段引入数据库、Redis、消息队列或微服务。

## 3. 系统上下文

```mermaid
flowchart LR
  U["用户"] --> UI["Next.js 页面与 Client Components"]
  UI --> BFF["同源 Route Handlers /api/*"]
  UI --> AUDIO["根布局 AudioController"]
  BFF --> PROVIDER["MusicProvider"]
  PROVIDER --> REAL["Netease Provider Adapter"]
  PROVIDER --> DEMO["Demo Provider"]
  REAL --> NCM["固定版本 server-only NeteaseCloudMusicApi 包"]
  NCM --> UPSTREAM["music.163.com 上游"]
  BFF --> SESSION["进程内 Session Store"]
  UI --> LOCAL["localStorage 设置"]
  UI --> HISTORY["IndexedDB 播放历史"]
  AUDIO --> CDN["临时音频 CDN URL"]
```

依赖方向只能从 UI 到 feature service，再到内部契约；上游适配器不能反向依赖页面或
播放器。`src/lib/session/` 只能被 Server Components、Route Handlers 和 server-only
模块导入。

## 4. 运行时边界

### 4.1 浏览器层

负责：

- 页面、可访问性交互和动效。
- 根布局中的 `PlayerProvider`、`AudioController` 与队列状态。
- 调用同源 `/api/*`，消费归一化模型和错误码。
- 使用 `localStorage` 保存非敏感设置。
- 使用 `IndexedDB` 保存本地播放历史。
- 直接播放 BFF 返回的短期音源 URL，但不持久化 URL。

禁止：

- 直连 NeteaseCloudMusicApi。
- 读取或保存上游 Cookie、QR key、`MUSIC_U` 或原始登录 Response。
- 把音源 URL写入 localStorage、IndexedDB、埋点或错误日志。
- 在页面组件内自行创建多个 `HTMLAudioElement`。

### 4.2 同源 BFF

Next.js Route Handlers 负责：

- 参数校验、Session 查找、权限判断和请求超时。
- 调用 `MusicProvider` 并将上游字段转换为内部模型。
- 映射上游业务码、HTTP 状态和网络异常。
- 设置或清除不透明 `sid` Cookie。
- 对私有数据使用 `Cache-Control: no-store`。
- 对音源 URL 设置短生命周期并在到期前刷新。
- 对写操作提供幂等保护和明确结果，不静默重试。

真实 Provider 所在 Route Handler 必须声明 Node.js runtime。固定包依赖文件系统、Node
Crypto 和 CommonJS，不能打入 Edge runtime 或 Client Bundle。

### 4.2.1 受限的本地上游传输代理

`NETEASE_UPSTREAM_PROXY` 是仅为开发机网络接入设置的可选 server-only 环境变量。它只允许
`http://127.0.0.1:<port>` 或 `http://[::1]:<port>` 形式的 loopback HTTP 代理，且拒绝
用户名、密码、路径、query、fragment、非 loopback 地址及非 HTTP 协议。适配器把该值仅作为
固定网易云包的出站 HTTP transport `proxy` 参数；它不是音频代理、公开接口、上游 `proxyUrl`
响应字段或解锁/版权绕过能力。

- 环境变量为空时保持直连，不做自动故障转移，也不猜测本机代理端口。
- 它仅在服务启动时读取；修改后必须重启本地服务。`.env.local` 不提交，值不得携带凭据。
- 代理地址、上游 Cookie、QR key、二维码 Data URL 和原始上游响应均不得进入浏览器、日志、
  夹具、API response 或 Git。
- 部署环境必须显式决定是否提供受控的 loopback transport；不能把开发机代理假定为生产能力。

BFF 不负责转发完整音频正文。若未来因 CDN CORS 或部署网络需要音频代理，必须重新
评估带宽、版权和部署成本，并更新本文件后再实现。

### 4.2.2 匿名访客上游凭据（T017A）

匿名访客凭据可用于改善未登录状态下被网易云正常授权的公开读取和音源请求；它不是用户登录、
不是会员身份，也不能改变版权、VIP、地区或风控结果。T017A 的固定包运行探测已确认
`register_anonimous()` 无参数调用可返回 Cookie，但在固定公开样本上没有提高可播数量，故本地
版本不创建 `AnonymousCredentialStore`，也不持有匿名凭据。未登录读取继续使用正常的裸匿名
上游路径。

- 若未来的脱敏实测证明匿名凭据有可量化收益，必须先恢复本节的 server-only Store 设计，再实现。
  凭据不得挂在浏览器 `sid`、写入 `localStorage`、IndexedDB、URL、日志、fixture、源码或 Git。
- 一旦用户扫码成功，用户 Cookie 始终优先于任何未来匿名凭据；二者不得合并、互相覆盖或用于
  写操作。
- 当前实现只能对已批准的只读上游调用进行裸匿名读取；失败保持 Real Mode，不得自动切换
  Demo、Enhanced Provider、第三方音源或代理 URL。
- 首页可播筛选只能使用正常的 `check_music` 与 `song_url_v1` 结果。BFF 不下载、转码、缓存或
  转发音频正文，不调用解灰、匹配音源或版权绕过能力。
- 公开候选与已验证可播列表按进程、日期和实际身份范围缓存；只有非空公开精选可进入缓存，
  空结果必须允许当前用户的重新加载动作再次探测。公开预检仅在服务端短暂取得并丢弃音源 URL，
  URL 不进入该缓存。再次播放时必须遵守现有到期刷新状态机。

### 4.3 MusicProvider

页面和 BFF 不知道网易云参数名。精确字段与不变量见 `MUSIC_DOMAIN_MODEL.md`，核心接口以
内部模型表达：

```ts
export interface MusicProvider {
  startQrLogin(sessionId: string): Promise<QrChallenge>;
  pollQrLogin(sessionId: string): Promise<QrLoginState>;
  getSessionUser(sessionId: string): Promise<UserProfile | null>;
  logout(sessionId: string): Promise<void>;

  getDailyRecommendations(sessionId: string): Promise<Track[]>;
  search(query: SearchQuery, sessionId?: string): Promise<SearchResponse>;
  getTrack(trackId: string, sessionId?: string): Promise<Track>;
  getPlaybackSource(
    trackId: string,
    quality: AudioQuality,
    sessionId?: string,
  ): Promise<PlaybackSource>;
  getLyrics(trackId: string, sessionId?: string): Promise<LyricDocument>;
  getComments(trackId: string, page: PageQuery): Promise<CommentPage>;

  setTrackLiked(trackId: string, liked: boolean, sessionId: string): Promise<void>;
  createPlaylist(input: CreatePlaylistInput, sessionId: string): Promise<Playlist>;
  changePlaylistTracks(input: ChangePlaylistTracksInput, sessionId: string): Promise<void>;
  createComment(input: CreateCommentInput, sessionId: string): Promise<Comment>;
}
```

实现包括：

- `NeteaseMusicProvider`：真实上游适配器，server-only 嵌入精确锁定的
  `NeteaseCloudMusicApi@4.32.0`。
- `DemoMusicProvider`：确定性本地夹具，只使用获准的本地演示音频。

Legacy 或 Enhanced 中哪一个充当 Real Provider，只能在服务启动时根据显式配置选择；切换
Real Provider 必须重启服务并销毁旧 Session。`DemoMusicProvider` 是独立的答辩数据源，
不参与 Real Provider 的自动故障转移。ECHOFORM Session 默认处于 `real` 数据模式，只有
用户明确执行模式切换操作后才可进入 `demo`；一次 Real 请求失败不能改变 Session 模式。

## 5. 目录与所有权

```text
src/app/
  layout.tsx                    根布局与持久 PlayerProvider
  api/                          BFF Route Handlers

src/features/
  auth/                         QR 登录 UI 与客户端会话状态
  player/                       播放器 UI、队列 UI、歌词视图
  discovery/                    日推画廊与歌曲预览
  search/                       搜索输入、结果与分页
  library/                      喜欢、歌单和历史 UI
  profile/                      用户主页 UI

src/lib/music/
  models.ts                     内部 Track/Album/Artist 等模型
  provider.ts                   MusicProvider 接口
  errors.ts                     归一化错误
  netease/                      唯一可接触上游字段的适配器
  demo/                         Demo Provider 实现

src/lib/player/                 AudioController、队列、状态机、歌词同步
src/lib/session/                server-only Session Store
src/lib/theme/                  封面取色与对比度
src/data/demo/                  脱敏夹具和授权音频引用
tests/contract/                 Provider 契约测试
tests/e2e/                      关键路径 E2E
```

创建 feature 目录前，先补对应组件或行为规格。共享 UI 不因“可能复用”提前抽象；至少有
两个真实使用方或属于设计系统基础组件时再移入 `src/components/`。

## 6. BFF HTTP 契约

### 6.1 统一结果

成功：

```ts
type ApiSuccess<T> = {
  ok: true;
  data: T;
  meta?: {
    requestId: string;
    mode: "real" | "demo";
    fetchedAt: string;
  };
};
```

失败：

```ts
type ApiFailure = {
  ok: false;
  error: {
    code: AppErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: Record<string, string | number | boolean>;
  };
};
```

`details` 不包含 Cookie、QR key、音源 URL、用户输入的评论正文或原始上游 Response。

### 6.2 路由表

| Method | ECHOFORM 路由 | 登录 | 用途 |
| --- | --- | :---: | --- |
| `GET` | `/api/auth/session` | 否 | 当前登录状态与归一化用户 |
| `PUT` | `/api/mode` | 否 | 用户显式切换当前 Session 的 `real` / `demo` 数据模式 |
| `POST` | `/api/auth/qr` | 否 | 创建 QR Challenge |
| `GET` | `/api/auth/qr/status` | 否 | 查询当前 Challenge 状态 |
| `POST` | `/api/auth/logout` | 是 | 清理上游与本地 Session |
| `GET` | `/api/recommendations/daily` | 是 | 当前用户每日推荐 |
| `GET` | `/api/search` | 否 | 按歌曲、专辑、歌手搜索 |
| `GET` | `/api/tracks/:id` | 否 | 歌曲详情 |
| `GET` | `/api/tracks/:id/source` | 可选 | 短期播放源 |
| `GET` | `/api/tracks/:id/lyrics` | 否 | 普通、翻译和逐字歌词 |
| `GET` | `/api/tracks/:id/comments` | 否 | 评论分页 |
| `POST` | `/api/tracks/:id/comments` | 是 | 发布或回复评论 |
| `PUT` | `/api/library/likes/:id` | 是 | 喜欢歌曲 |
| `DELETE` | `/api/library/likes/:id` | 是 | 取消喜欢 |
| `GET` | `/api/users/:id` | 否 | 用户主页数据 |
| `GET` | `/api/users/:id/playlists` | 否 | 用户歌单 |
| `POST` | `/api/playlists` | 是 | 创建歌单 |
| `POST` | `/api/playlists/:id/tracks` | 是 | 添加歌曲 |
| `DELETE` | `/api/playlists/:id/tracks/:trackId` | 是 | 移除歌曲 |

写接口在 `NETEASE_API_CONTRACT.md` 标记“登录态实测通过”之前不得进入 Real Provider 的
完成验收，可先在 Demo Provider 内实现 UI 流程。

## 7. Session 与登录

### 7.1 浏览器 Cookie

浏览器只持有 ECHOFORM 生成的随机 `sid`：

```text
HttpOnly; SameSite=Lax; Path=/
Secure 仅在 HTTPS 环境启用
```

`sid` 至少使用 128 bit CSPRNG 随机值。不得使用用户 ID、二维码 key 或上游 Cookie
作为 Session ID。

### 7.2 服务端 Session

```ts
type ServerSession = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  mode: "real" | "demo";
  userId?: string;
  upstreamCookie?: string;
  qr?: {
    key: string;
    expiresAt: number;
    status: "waiting" | "scanned";
  };
};
```

- 本地版本以 `Map<string, ServerSession>` 保存。
- 新 Session 的 `mode` 必须是 `real`；只有 `PUT /api/mode` 可因用户操作改变它。
- 进入 `demo` 不伪造或覆盖真实账号凭证；Demo 响应不得包含真实用户资料。返回 `real`
  后重新校验现有上游 Session，失效则回到游客态。
- Session 空闲 12 小时清理；QR Challenge 使用独立、较短截止时间。
- 页面刷新继续使用同一 `sid`；服务器重启后 Session 消失并回到访客态。
- 登录成功时只在服务端保存上游 Cookie，并立即清除 QR key。
- 登出先尝试上游登出，再无条件销毁本地 Session。
- 轮询 API 不返回 QR key 或上游 Cookie。

### 7.3 QR 流程

```mermaid
sequenceDiagram
  participant C as Browser
  participant B as ECHOFORM BFF
  participant S as Session Store
  participant N as Netease Provider
  C->>B: POST /api/auth/qr
  B->>N: create key + QR image
  B->>S: store key, deadline
  B-->>C: qrImageDataUrl, expiresAt, waiting
  loop visible tab and before deadline
    C->>B: GET /api/auth/qr/status
    B->>N: check with server-side key
    N-->>B: 800/801/802/803
    B-->>C: expired/waiting/scanned/authorized
  end
  B->>S: on 803 store upstream Cookie, clear key
  C->>B: GET /api/auth/session
  B-->>C: normalized UserProfile
```

前台轮询建议 2 秒一次；页面不可见时暂停。`800` 或本地截止时间到达后停止轮询并显示
刷新动作。`803` 之后必须再取账号状态，只有得到有效用户 ID 才算登录成功。

## 8. 数据持久化

| 数据 | 位置 | 生命周期 | 是否敏感 |
| --- | --- | --- | :---: |
| 上游 Cookie | 服务端 Session | 空闲 12h 或登出 | 是 |
| QR key | 服务端 Session | 单次 Challenge | 是 |
| ECHOFORM `sid` | HttpOnly Cookie | Session 生命周期 | 是 |
| Real / Demo 数据模式 | 服务端 Session | Session 生命周期 | 否 |
| 主题、音量、音质、动效偏好 | localStorage | 用户清理前 | 否 |
| 播放历史 | IndexedDB | 用户清理前 | 可能敏感 |
| 当前队列和播放位置 | React 内存 | 当前标签页 | 否 |
| 音源 URL | 仅内存 | `expi` 到期前 | 是 |
| 搜索词 | React 内存 | 当前搜索会话 | 可能敏感 |

播放历史至少记录 `trackId`、`playedAt`、`playedMs` 和 `completed`，不保存音频 URL。
设置和历史都提供本地清除入口。跨设备同步不在当前范围。

## 9. 缓存与超时

- 登录状态、日推、用户私有歌单、喜欢状态：`no-store`。
- QR start/status：`no-store`，且禁止被 Next.js 或代理缓存。
- 音源：`no-store`；用上游 `expi` 计算 `expiresAt`，提前 60 秒视为过期。
- 搜索、歌曲、专辑、歌手等公开元数据：可 `revalidate: 300`，缓存键包含全部分页参数。
- 评论读取：最多缓存 30 秒；评论写入成功后使对应歌曲评论失效。
- BFF 单次上游请求默认 10 秒；音源请求可到 15 秒；超时映射为
  `UPSTREAM_TIMEOUT`。
- 对读取请求最多自动重试一次，使用短随机退避；写请求不自动重试。

## 10. 错误模型

```ts
type AppErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_EXPIRED"
  | "QR_EXPIRED"
  | "VALIDATION_ERROR"
  | "TRACK_UNAVAILABLE"
  | "VIP_REQUIRED"
  | "REGION_RESTRICTED"
  | "SOURCE_EXPIRED"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";
```

上游 HTTP 200 不代表业务成功。Provider 必须同时检查根 `code`、音源行 `code`、URL 是否
存在、权限字段和登录账号。未知上游形状一律返回 `UPSTREAM_UNAVAILABLE` 并记录脱敏的
`requestId`、端点名、HTTP 状态和业务码，不记录原始 Body。

## 11. 持久播放器

`PlayerProvider` 放在根 `layout.tsx` 的页面内容之外，内部仅创建一个 Audio 元素：

```text
RootLayout
  AppProviders
    PlayerProvider
      PersistentAudioHost
      Navigation
      RouteContent
      PersistentPlayerBar
```

- 路由只发送 `load`、`play`、`enqueue` 等命令，不拥有 Audio。
- 当前歌曲、队列、模式和错误属于 Player Provider。
- 预览页与完整播放页展示同一状态，不各自维护播放进度。
- 页面卸载只取消页面订阅，不能调用 `audio.pause()` 或清空 `src`。
- 精确状态和恢复规则见 `PLAYER_STATE_MACHINE.md`。

### 11.1 高低频状态边界

- 队列、歌曲、模式、网络、错误和命令意图属于语义快照；它们只在真实语义变化时通知通用 UI。
- `audio.currentTime`、buffered 等展示时间允许以高频时间线发布，但必须经独立外部 store、等价 selector 缓存或局部 DOM 更新隔离。通用 `PlayerPublicSnapshot`、AppShell 与非时间消费者不得因每个媒体帧获得新快照。
- ProgressRail 订阅时间/缓冲，LyricsViewport 订阅当前命中行或词；播放按钮、导航、队列和 TrackRow 只订阅自身语义字段。时间线不得绕开现有 `loadRevision`、Seek、暂停、错误或 Audio 事件校验。

## 12. Demo Mode

Demo Mode 是答辩容灾，不是 Real Provider 的自动降级：

- 新 Session 默认处于 Real Mode。Real 页面失败时可显示“使用演示数据”，但只有用户点击
  后调用 `PUT /api/mode` 才进入 Demo Mode。
- Demo Mode 期间所有可演示读取和播放都由 `DemoMusicProvider` 返回，响应 `meta.mode`
  必须为 `demo`；不得按单个失败请求临时混用 Real 与 Demo 数据。
- 用户可显式返回 Real Mode；返回后必须重新获取 Session、日推和当前页面数据。
- 每次模式切换都取消旧模式的数据请求，并由浏览器先暂停、卸载当前 Audio 与队列，再请求
  新模式数据；模式切换是显式上下文重置，不适用“路由切换不断播”的规则。
- 页面固定显示 `DEMO` 状态标识。
- 使用确定性、非用户数据夹具和获准的本地音频。
- 不生成虚假扫码成功或伪造网易云用户资料。
- Demo Mode 不改变启动时固定的 Real Provider，也不能使 Legacy/Enhanced 的契约失败通过。
- Contract Test 必须分别报告 Real 与 Demo，Demo 通过不能覆盖 Real 失败。

## 13. 性能与可访问性边界

- WebGL 只存在于日推画廊和确实需要的播放背景。
- AudioController、输入、搜索和评论不能依赖 WebGL 正常运行。
- 音频事件处理不触发整页 React 重渲染；高频时间通过外部 store 或局部订阅发布。
- 歌词高亮以真实 `audio.currentTime` 为基准，不使用延迟性视觉缓动修正时间。
- 后台标签页不依赖 `requestAnimationFrame` 推进播放状态。
- 所有播放命令和错误变化通过受控 live region 提供可访问反馈。
- WebGL 场景必须实现可观察的调度状态：`entering`、`interacting`、`previewing`、`settling` 可连续渲染；`idle` 完成一次最终绘制后休眠；`hidden` 停止 rAF。输入、布局或可见性恢复只能唤醒一条待处理帧，销毁后不得残留帧或监听器。
- WebGL 的受限质量层级按顺序降低 DPR、抗锯齿和纹理各向异性/不可见工作；无法达到最低交互目标或初始化失败时进入既有 DOM fallback，不把性能模式作为静默失败。
- 纹理所有权与驻留窗口由场景管理：仅保留可见项及相邻 2-3 项，窗口外请求可取消，已脱离窗口且不被预览引用的纹理必须 `dispose`。路由卸载仍负责完整释放 geometry、material、renderer 与剩余纹理。
- raycast 由脏标记驱动，只有 Pointer、相机、封面变换或交互可用性变化后执行；命中结果变化才更新光标或悬停样式。

## 14. 测试架构

当前仓库只具备 `npm run check`。引入测试依赖前需单独在任务范围内安装项目依赖并补充
命令。目标测试栈：

- Vitest：队列、状态机、错误映射、歌词解析和 Provider 单元测试。
- Testing Library：登录、搜索、播放器和错误状态组件测试。
- Contract fixtures：固定、脱敏的上游 Response 夹具，验证归一化模型。
- Live contract probe：显式手动命令，只做匿名读取；登录态和写操作使用专用测试账号。
- Playwright：QR 状态模拟、持久播放、路由切换、滚轮退出、搜索和响应式关键路径。

性能任务额外使用可替换时钟/帧调度与计数器证明 idle/hidden 不续帧、Pointer 静止不 raycast、纹理窗口正确释放；浏览器在固定本地生产构建和固定夹具下记录帧数与 React 更新时间边界。开发服务器的 HMR 和机器瞬时负载只作诊断，不作为绝对性能门槛。

Live Probe 不能成为默认 CI 的稳定性门槛，因为上游没有 SLA 且存在风控。

## 15. 部署升级条件

公开部署前必须重新确认：

1. 获批的部署目标、域名和 HTTPS。
2. Redis/KV 等持久 Session Store 及数据保留周期。
3. 服务端加密、密钥管理和 Session 撤销策略。
4. 多实例轮询一致性与限流。
5. 上游 API 的许可、可用性、版权和风控风险。
6. 日志脱敏、监控和用户隐私说明。
7. CDN 音频 CORS 与可视化降级策略。

这些项目涉及部署、密钥或数据库，未经用户批准不得实现。

## 16. 架构验收

- `ARCH-AC-01`：浏览器网络请求中没有直连 NeteaseCloudMusicApi 的业务接口。
- `ARCH-AC-02`：客户端代码和浏览器存储中没有上游 Cookie 或 QR key。
- `ARCH-AC-03`：页面只消费内部模型，未引用上游字段名。
- `ARCH-AC-04`：路由切换不重建 Audio，不中断正在播放的歌曲。
- `ARCH-AC-05`：服务器重启后明确回到访客态，不展示过期账号缓存。
- `ARCH-AC-06`：新 Session 默认 Real；只有用户显式操作可切换 Demo；两种模式可辨认且验收分开。
- `ARCH-AC-07`：私有响应、QR 和音源均为 `no-store`。
- `ARCH-AC-08`：日志不含 Cookie、QR、评论正文、音源 URL 和原始用户 Response。
- `ARCH-AC-09`：所有写操作在契约登录态实测通过后才标记完成。
- `ARCH-AC-10`：`npm run check` 通过；引入测试后对应测试命令同时通过。
- `ARCH-AC-11`：画廊在 idle 或 hidden 状态没有残留连续 rAF；恢复后只有一条调度链并保持有限轨道几何。
- `ARCH-AC-12`：纹理窗口、质量层级和 DOM fallback 不泄露 renderer/纹理资源，也不改变 BFF、音频、队列或路由边界。
- `ARCH-AC-13`：可见播放态的高频时间更新不会重渲染 AppShell 或非时间订阅者；ProgressRail、LyricsViewport 仍以真实 Audio 时间更新。
## T017B Change Record: Session-Bound Audio Relay

This section supersedes earlier statements that prohibited every form of audio
body forwarding. The approved scope is only a local, single-instance, real-time
relay for a short-lived source that the selected provider already authorized.
It does not cache, transcode, download, unlock, mirror, share, or make media
available outside the ordinary ECHOFORM session.

The browser plays `/api/tracks/:id/audio`, never a provider URL. `/source`
resolves the provider source server-side and registers it against the HttpOnly
`sid`, track id, chosen quality, and expiry; `/audio` requires that same session
and supports one validated Range request. The server validates every HTTP(S)
target and redirect against a fixed Netease media-host allowlist, forwards only
allowlisted media headers, and uses `Cache-Control: no-store` throughout.

The real URL, upstream Cookie, proxy address, redirect Location, and media body
remain outside browser state, response envelopes, logging, fixtures, storage,
and Git. Session expiration, source expiration, logout, user/mode change, and
server restart clear the registration. Missing or stale registrations make no
upstream request and map to `SOURCE_EXPIRED`.

`NETEASE_UPSTREAM_PROXY`, when configured, remains a validated server-only
loopback transport setting. T017B may use it for the relay's outgoing request;
it is not a client option or a production deployment decision.

For the approved local single-instance runtime, the in-memory session Store is
published once on the Node process global. This keeps session-bound relay
registrations shared when development Route Handlers are evaluated from separate
bundles, while retaining the existing restart-clears-session behavior.

## T017 Catalog And Discovery Architecture Record

T017 adds four read-only Route Handler families: album detail, artist detail,
new songs, and popular playlists. They use the existing `PublicReadRouteHandlers`
timeout, one retry for retryable reads, normalized envelopes, request IDs, and
public metadata cache policy. Browser code calls only these same-origin routes.

Artist detail is composed server-side from fixed provider methods for identity,
hot tracks, and paged albums. A partial provider result is not silently filled
with invented catalog data: an unavailable detail request fails as one
recoverable page state. Album tracks are a normalized document and the client
reveals a maximum of 50 rows at a time; artist albums use BFF pagination.

Search's empty-query discovery surface starts independent new-song and popular
playlist reads. It aborts them when a query begins and keeps a successful
subsection visible when the other subsection fails. Neither surface creates an
Audio element, owns source URLs, changes queue semantics, accesses sessions, or
introduces external navigation.
