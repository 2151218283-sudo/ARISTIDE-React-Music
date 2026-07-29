# ECHOFORM Music Domain Model

> 状态：T003 实现规格 v1
> 更新日期：2026-07-29

## 1. 目的与控制关系

本文定义 ECHOFORM 内部音乐模型、错误模型、统一 API 结果、`MusicProvider`
接口与 Demo Provider 的确定性行为。页面、组件、播放器和 BFF 只能消费这些内部模型；
网易云原始字段只能存在于后续 `src/lib/music/netease/` 适配器内。

本文细化 PRD 11.2、Architecture 4.3/6.1/10 与 API Contract 6。发生冲突时，先同步
这些控制文档，再修改代码。

## 2. 已解决的文档差异

| 主题 | 旧差异 | 统一值 |
| --- | --- | --- |
| 封面字段 | PRD `coverUrl`；API Contract `artworkUrl` | `artworkUrl: string \| null` |
| 曲目可用性 | PRD 有 `availability`；API Contract 只有 `privilege` | 两者都保留，分别表达可播放结论和上游权限摘要 |
| 会话过期 | PRD `AUTH_EXPIRED`；Architecture `SESSION_EXPIRED` | `SESSION_EXPIRED` |
| 上游故障 | PRD `UPSTREAM_ERROR`；Architecture `UPSTREAM_UNAVAILABLE` | `UPSTREAM_UNAVAILABLE` |
| 歌词命名 | Architecture `LyricDocument`；TODO 使用 `Lyrics` | `LyricDocument` 为正式类型，导出 `Lyrics` 别名 |

## 3. 模型不变量

- 所有实体 ID 均为十进制或稳定命名空间字符串，不使用 JavaScript `number` ID。
- 时间戳使用 Unix epoch 毫秒；时长使用毫秒。
- 归一化模型使用显式 `null` 表示上游缺失，不把缺失值留给页面猜测。
- `artworkUrl` 只保存公开封面地址；不得保存用户特定、带鉴权参数的媒体地址。
- `PlaybackSource.url` 只存在于运行时内存，不进入 fixture、日志、错误详情或持久层。
- 数组返回新副本，调用方不得改变 Provider 的内部夹具。
- 模型不包含手机号、生日、城市、Cookie、Token、QR key 或原始上游 Response。

## 4. 核心实体

### 4.1 Artist 与 Album

- `ArtistSummary`：`id`、`name`、`avatarUrl`。
- `Artist`：Summary 字段，加 `aliases`、`biography`、`albumCount`、`trackCount`。
- `AlbumSummary`：`id`、`name`、`artworkUrl`。
- `Album`：Summary 字段，加 `artists`、`description`、`publishedAt`、`trackCount`。

### 4.2 Track

`Track` 包含 `id`、`name`、`artists`、`album`、`durationMs`、`artworkUrl`、
`aliases`、`explicit`、`availability` 与 `privilege`。`availability` 取值：
`playable | vip | copyright | region | unknown`。`privilege` 仅保存 `fee` 与
`maxQuality`，不能代替最终可播放结论。

### 4.3 UserProfile、Playlist 与 Comment

- `UserProfile` 只包含 `id`、`nickname`、`avatarUrl`、`signature`。
- `Playlist` 包含基础描述、公开性、所有者摘要、曲目数量与时间戳，不内嵌完整曲目列表。
- `Comment` 包含作者白名单资料、正文、时间、点赞状态和可选回复摘要。

### 4.4 Lyrics 与 PlaybackSource

- `LyricDocument.kind` 为 `synced | plain | instrumental | unavailable`。
- 行级歌词可包含翻译、罗马音和逐字数组；缺失时使用 `null` 或空数组，不伪造时间。
- `PlaybackSource` 包含短期 URL、到期时间、实际音质、codec、bitrate、sampleRate、
  sizeBytes 与 `corsMode`。

## 5. 查询与写入类型

- `PageQuery` 使用非负 `offset` 与 1-100 的 `limit`。
- 搜索类型为 `track | album | artist | all`；综合搜索使用三个分区和
  `partialErrors`，不依赖上游未验证的综合类型。
- 写输入携带业务 ID 和 `clientMutationId`；Provider 方法不自动重试写操作。

## 6. MusicProvider 契约

Provider 覆盖 QR 会话、当前用户、日推、搜索、曲目、播放源、歌词、评论以及现有架构列出的
写方法。调用成功返回内部模型，失败抛出 `AppError`；Provider 不返回 HTTP Response，BFF
负责把结果包装为 `ApiSuccess<T> | ApiFailure`。

`ApiSuccess.meta` 包含 `requestId`、`mode`、`fetchedAt`。`ApiFailure` 包含稳定错误码、
可恢复文案、`retryable`、`requestId` 与经过白名单处理的基础类型 `details`。

## 7. AppErrorCode

正式错误码为：`AUTH_REQUIRED`、`SESSION_EXPIRED`、`QR_EXPIRED`、
`VALIDATION_ERROR`、`TRACK_UNAVAILABLE`、`VIP_REQUIRED`、`REGION_RESTRICTED`、
`SOURCE_EXPIRED`、`RATE_LIMITED`、`UPSTREAM_TIMEOUT`、`UPSTREAM_UNAVAILABLE`、
`NETWORK_ERROR`、`UNKNOWN_ERROR`。

未知异常必须映射为通用 `UNKNOWN_ERROR`，不能把原始异常消息直接暴露给浏览器。

## 8. Demo Provider

Demo Provider 不访问网络、不读取浏览器存储、不伪造网易云登录，并支持以下确定性场景：

| 场景 | 行为 |
| --- | --- |
| `normal` | 返回稳定的曲目、搜索、歌词和评论数据 |
| `empty` | 列表和搜索为空，歌词/评论为空态 |
| `timeout` | 读取抛出可重试 `UPSTREAM_TIMEOUT` |
| `upstream-error` | 读取抛出可重试 `UPSTREAM_UNAVAILABLE` |
| `unplayable` | 曲目标记版权不可播放，播放源抛出 `TRACK_UNAVAILABLE` |
| `no-lyrics` | 返回 `kind: unavailable` 和空行 |
| `no-comments` | 返回空评论页 |

相同 seed 必须产生相同顺序和内容。T003 不包含已授权演示音频，因此内置夹具不保存任何
音频 URL，`getPlaybackSource` 明确返回不可用错误。后续只有在用户确认本地音频资产后，
才能补充 Demo 播放源成功路径。

Demo 登录方法不得返回扫码成功或虚构账号；写方法在对应 P1 任务定义 Demo 写语义前不得
假成功。

## 9. T003 验收

- 模型、错误与 Provider 类型在 strict TypeScript 下无 `any`。
- unit tests 覆盖错误包装、seed 稳定性和全部 Demo 场景。
- contract tests 证明 Demo Provider 只返回内部字段，不含上游字段或音频 URL。
- 页面状态测试不适用；本任务不修改页面、WebGL、真实 Provider 或播放器状态机。
- `npm run test:unit`、`npm run test:contract`、`npm run test` 与 `npm run check` 通过。
