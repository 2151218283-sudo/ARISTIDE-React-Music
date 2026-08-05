# ECHOFORM 开发 TODO

> 状态：执行基线 v1
> 更新日期：2026-08-05
> 当前任务：`T017`（未开始）
> 执行方式：严格串行；不得同时开发、验收或勾选两个任务

## 1. 依据与优先级

开发前必须按以下顺序读取控制文档：

1. `AGENTS.md`：工作区、目录、验证和安全规则。
2. `docs/research/ECHOFORM_PRD_DRAFT.md`：产品范围、P0/P1/P2 和页面验收。
3. `docs/research/ECHOFORM_VISUAL_DESIGN.md`：视觉、组件、状态和动效。
4. `docs/research/TECHNICAL_ARCHITECTURE.md`：运行时、BFF、Provider、Session 和持久化边界。
5. `docs/research/NETEASE_API_CONTRACT.md`：固定上游版本、字段映射、验证等级和禁止能力。
6. `docs/research/PLAYER_STATE_MACHINE.md`：唯一 Audio、队列、播放状态、恢复和歌词时间源。
7. `D:\AAA vibe coding-项目制作\音乐播放器-毕业设计\毕设要求.md`：最终必须覆盖的毕业设计功能。
8. `docs/research/BEHAVIORS.md` 与旧组件规格：只作为有限画廊、波浪、共享元素和退出行为的证据。

控制文档冲突时不得在代码中自行选择。先执行文档对齐任务，再继续受影响功能。

## 2. 严格串行执行规则

### 2.1 单任务规则

- 始终只允许一个任务处于 `进行中`。
- 必须按 `T001 -> T002 -> ...` 顺序执行，不得跳号。
- 每轮开始前，在本文件“当前执行卡”写明当前任务、目标、允许范围、保护项和验收标准。
- 每轮结束只允许把本轮完成的一个顶层任务从 `[ ]` 改为 `[x]`，不得批量勾选。
- 当前任务未通过全部验收时，不得启动下一任务，也不得用“后续再补”关闭当前任务。
- 不启用子代理、多任务编排或并行开发。测试命令内部由工具自身使用 worker 不视为并行开发任务。

### 2.2 每轮固定流程

1. 读取当前任务及其控制文档，检查 `git status --short`。
2. 明确报告本轮的修改目标、允许修改范围、不允许破坏的逻辑和验收标准。
3. 若当前任务首次创建组件或 feature，先在 `docs/research/components/` 写对应规格。
4. 只修改当前任务列出的路径；发现范围外问题先记录，不顺手重构。
5. 先完成单元/契约/组件测试，再完成页面状态和三视口测试。
6. 执行当前任务列出的专项测试，并执行 `npm run check`。
7. 检查敏感信息、外部 URL、上游字段泄漏和 `git diff --check`。
8. 更新本文件：只勾选当前任务，并把“当前任务”移动到下一个未完成项。
9. 生成一个职责单一的 Git commit。
10. `AGENTS.md` 要求每次 `git push` 前再次询问。得到明确确认后立即推送 `origin/main`，并核对本地 `HEAD` 与 `origin/main` 一致。

### 2.3 模块完成定义

一个模块只有同时满足以下条件才可勾选：

- 功能主流程完成，内部导航不跳转到 Aristide 原站。
- `loading`、`empty`、接口错误和可恢复动作均被实际测试；不适用的状态必须说明原因。
- 保留旧有效数据，不用全屏 Spinner，不把 Toast 作为持续错误的唯一反馈。
- 1440x900、768x1024、390x844 三个视口无重叠、遮挡和非预期横向滚动。
- 键盘、焦点、Reduced Motion 和至少该模块的关键 `aria-*` 语义通过检查。
- WebGL 模块额外通过 Canvas 非空像素、稳定尺寸、首尾边界和 DOM 降级检查。
- `npm run check` 通过；已经建立的 unit、component、contract、E2E 命令也全部通过。
- 没有 Cookie、Token、QR key、音源 URL、用户隐私字段、`.env` 或私有账号数据进入源码、日志和 commit。
- 当前任务已提交；推送动作按 2.2 节再次确认后完成。

### 2.4 页面状态测试标准

所有读取远程数据的页面或面板必须覆盖：

- 主流程：有效数据、主要交互、返回与状态保持。
- 加载中：0-300ms 不闪烁；超过 300ms 局部进度；可预测布局使用同尺寸 Skeleton。
- 空数据：一句真实原因、一个恢复动作，不伪造内容。
- 接口错误：明确错误类型、内联原因、重试；旧数据仍有效时不得清空。
- 部分成功：适用时保留成功部分并标出失败分区。
- 登录失效：账号写操作停止，提供重新扫码，不泄漏上游信息。
- 响应式：1440、768、390 三视口截图和交互。

状态使用 Playwright 网络拦截、脱敏 Contract fixture 或显式 Demo Provider 注入。不得在生产页面暴露 `?error=true` 一类测试后门，也不得让 Demo 成功掩盖 Real Provider 失败。

### 2.5 需求变更控制

小需求可进入当前任务，必须同时满足：

- 不新增页面、路由、数据实体、外部写操作或项目依赖。
- 不改变 PRD 优先级、API 契约、播放器状态机、Session、安全或持久化。
- 修改仍在当前任务允许路径内，且能由当前验收覆盖。

大需求必须先停止编码并新增一个“文档与计划变更”任务，满足任一项即视为大需求：

- 新增或删除页面、一级导航、外部数据源、数据库、部署目标或登录方式。
- 修改 P0/P1/P2 范围、API 请求/响应、播放模式、队列、歌词时间源或写操作语义。
- 引入新的运行时依赖、跨设备同步、站内社交、音频代理、解灰或版权规避能力。
- 影响两个及以上已完成模块，或需要数据迁移、删除文件、修改 `.env`/CI/CD。

大需求处理顺序：更新 PRD/Design/Architecture/API/State Machine 中的控制文档，新增或调整 TODO，获得确认，再编码。

## 3. 当前代码审查结论

### 3.1 可保留并演进

- `src/lib/webgl/filmstripScene.ts` 已具备有限轨道、Clamp、真实速度波浪、命中测试、首尾不循环和详情展开几何。
- `HomeExperience` 已具备“进入、可见、退出”分相，以及首个滚轮只退出不移动画廊的基础。
- WebGL Texture、Material、Geometry、Renderer 在销毁时有释放逻辑。
- 现有 Reduced Motion、键盘 Escape 和局部焦点样式可作为迁移起点。
- 当前 `npm run check` 通过，旧 34 个静态页面可构建；486 个复刻资产通过完整性检查。

### 3.2 必须替换或补建

- 根布局仍是 Aristide Metadata、`lang="en"`、禁止页面缩放，且没有 AppProviders 或持久 Audio。
- 路由只有 `/`、`/about` 和作品集 `/[slug]`，尚无 ECHOFORM 信息架构。
- `Project`、`ProjectWork`、旧 JSON、About、社交链接和作品详情仍是原作品集数据。
- CSS 直接使用旧 Raw Color、负字距和旧固定布局，尚无 ECHOFORM 三层 Token 与三主题。
- 当前已有内部音乐模型、`MusicProvider` 契约与 Demo Provider，但尚无 BFF、Session、真实 Provider、播放器、页面级歌词、搜索、评论、用户主页或音乐库。
- 当前已有 unit、component、contract 与 E2E 测试框架及基础 smoke/domain 覆盖；后续模块仍须按各自状态矩阵扩充测试。
- 画廊 Canvas 初始化失败会静默返回，没有可操作 DOM 降级。
- `sync-work-assets.mjs` 仍面向原站，仅可作为旧资产维护脚本，不能进入 ECHOFORM 运行时。

### 3.3 必须先冻结的文档冲突

| 主题 | 当前冲突 | T001 推荐统一值 |
| --- | --- | --- |
| 搜索防抖 | PRD 250ms；Design 300ms | 300ms |
| 用户主页转场 | PRD 全屏圆形遮罩；Design 头像共享元素且不全屏遮罩 | 头像共享元素，不覆盖全屏 |
| Demo 进入方式 | PRD 页面失败时直接切换；Architecture 要求显式选择 | 错误页保留“使用演示数据”按钮，由用户显式进入 |
| 预览入场 | PRD 1200-1600ms；Design 900-1600ms | 目标约 1100ms，上限 1600ms，可中断 |
| 歌词浏览锁 | PRD 5s；Design/State 4s | 统一 5s |
| Sleep Timer | PRD 渐弱并跨刷新恢复；State 不渐弱且刷新清除 | 最后 3s 渐弱；刷新后清除，不修改系统音量 |

## 4. 当前执行卡

- 当前任务：`T017A 匿名访客播放与可播性策略`（已完成）
- 状态：T017A 已完成验收；下一任务为 T017，尚未开始。
- 修改目标：验证固定 Legacy 包的匿名访客注册能力；建立 server-only 匿名凭据隔离、公开候选可播探测与缓存策略，并让首页只展示已验证可播的公开精选。搜索保留所有结果并呈现可播放状态，不能把全曲库可播放作为承诺。
- 允许修改：匿名访客/可播性规格；`docs/research/**` 的实际验证记录；`src/lib/music/netease/**`、`src/lib/session/**`、每日推荐与音源 BFF、`src/features/discovery/**`、`src/features/search/**`、必要的可播放状态组件和对应测试。仅在本任务文档与实测证据允许后增加固定包函数白名单。
- 不允许修改：`.env*`、CI/CD、生产部署配置、数据库、Git 历史、当前 Real Provider 版本、播放器核心状态机、音频代理、第三方音源、解灰或外部写操作。上游 Cookie、匿名凭据和未脱敏用户数据不得写入日志、fixture、浏览器持久化或 Git；短期音源 URL 只能通过既有归一化 BFF 响应交给 Audio，且不得持久化。
- 不允许破坏：用户扫码 Cookie 始终优先于匿名凭据；Demo 只能显式进入；搜索旧结果、URL 状态和本地播放不中断；首页 WebGL 仍只承载日推或明确标识的公开精选；不可播放歌曲在搜索/详情可查看且不伪造可播。
- 验收标准：匿名注册函数与响应形状先通过固定包与脱敏探测验证；裸匿名与匿名访客可播率只以聚合数据比较；首页 normal/loading/候选不足/上游错误、搜索 checking/unknown/unavailable/filter、音源到期刷新、登录切换、敏感信息扫描和 1440/768/390 页面测试通过；专项 tests、`npm run test`、`npm run check` 与 `git diff --check` 通过。

## 5. 开发清单

### Phase 0：冻结规则与质量基础

- [x] **T001 文档冲突与产品基线冻结**

  目标：执行第 3.3 节的统一决策；确认 ECHOFORM / 声形为开发阶段品牌；把本地单实例毕设演示定为当前交付目标，公开部署继续保持审批门槛。

  允许修改：第 4 节列出的控制文档。

  不允许破坏：API 固定版本、写操作验证等级、禁止解灰、Session 安全、Demo 显式选择。

  验收：控制文档无已知冲突；P0/P1/P2、Real/Demo、登录态/匿名态边界可被直接实现；文档链接有效；`npm run check` 通过。

- [x] **T002 自动化测试与页面状态验收基础**

  目标：引入本地项目级 Vitest、Testing Library 和 Playwright；建立 unit/component/contract/e2e 命令、脱敏 fixtures 约定和三视口截图目录；先用最小 smoke test 证明工具链可运行。

  允许修改：`package.json`、`package-lock.json`、测试配置、`tests/**`、`scripts/**`、`AGENTS.md`、测试说明文档。允许安装项目依赖，禁止全局安装。

  不允许破坏：现有 `npm run check`、生产构建、旧页面运行；不得加入真实账号数据、QR、Cookie 或音源 URL；不得修改 `.env` 或 CI/CD。

  验收：新增 `test:unit`、`test:component`、`test:contract`、`test:e2e` 或等价清晰命令；默认测试完全离线且确定；Playwright 可启动本地站点并在 1440/768/390 截图；所有命令和 `npm run check` 通过。

- [x] **T003 内部音乐模型、错误模型与 Demo Provider**

  目标：建立 `Track`、`Album`、`Artist`、`UserProfile`、`Playlist`、`Comment`、`Lyrics`、`PlaybackSource`、统一 API envelope、`MusicProvider` 接口和确定性 Demo Provider。

  允许修改：新增规格；`src/lib/music/**`、`src/types/**`、`src/data/demo/**`、`tests/unit/**`、`tests/contract/**`。授权演示音频只可引用用户确认的本地资产。

  不允许破坏：React 组件不得看到上游字段；Demo 不伪造网易云登录；不保存音源 URL；不引入数据库；旧 `Project` 数据暂不删除。

  验收：模型无 `any`；Demo 场景覆盖正常、空、超时、上游错误、不可播放、无歌词、无评论；同一 seed 结果稳定；Provider 契约测试和 `npm run check` 通过。页面状态测试不适用，本任务以 unit/contract 为门槛。

- [x] **T003R T001-T003 审查问题修复**

  目标：修复 T002 Canvas 非空像素误判，以及 T003 错误详情白名单和 Demo 媒体地址扫描缺口；T001 无需代码修复。

  允许修改：当前执行卡列出的文件和测试路径。

  不允许破坏：T001 已冻结规则、现有页面/WebGL 行为、Demo Provider 数据语义和项目安全边界。

  验收：三个缺口各有可失败的反例测试；专项测试、完整 `npm run test`、`npm run check`、敏感信息检查和 `git diff --check` 通过。

### Phase 1：设计系统、应用壳与播放内核

- [x] **T004 ECHOFORM Token 与基础状态组件**

  目标：将 `globals.css` 建成 Primitive -> Semantic -> Component 三层 Token；实现 INK/PAPER/ARTWORK 映射骨架及 IconButton、TextButton、AlbumArtwork、StatusView、Skeleton。

  允许修改：组件规格、`src/app/globals.css`、`src/components/` 中本任务组件、对应 CSS Modules 和组件测试；允许安装项目级 `lucide-react`。

  不允许破坏：现有画廊 Canvas 尺寸和交互；不得在组件写 Raw Hex、卡片套卡片、Emoji 或固定紫蓝渐变；ARTWORK 本任务只建接口，不提前实现取色算法。

  验收：每个异步组件含 default/loading/empty/error/disabled/focus 状态；外框尺寸不因状态变化；对比度、44px 命中、200% 缩放和 Reduced Motion 通过；旧首页仍可用；专项组件测试与 `npm run check` 通过。

- [x] **T005 AppShell、ECHOFORM 导航与路由骨架**

  目标：建立三种 AppShell 模式、Skip Link、ECHOFORM Metadata、中文页面语言、桌面/移动一级导航，以及 `/search`、`/track/[id]`、`/album/[id]`、`/artist/[id]`、`/library`、`/playlist/[id]`、`/profile/[id]`、`/settings` 的可访问占位边界。

  允许修改：AppShell/Navigation 规格；`src/app/layout.tsx`、对应新路由、`src/components/AppShell*`、`FixedNavigation*`、基础路由测试。

  不允许破坏：首页现有画廊、首尾边界、预览退出；尚未批准前不删除 `/about`、`/[slug]` 或旧组件；不得创建第二个 AppShell；不得禁用浏览器缩放。

  验收：所有本地路由可达且不命中原站；导航 1440/768/390 无重叠；键盘焦点进入主标题并可返回；占位页使用 StatusView，不伪装功能已完成；加载/空/错误不适用的静态壳状态有记录；E2E 路由 smoke 与 `npm run check` 通过。

- [x] **T005R 导航层级、品牌字形与开发指示器修正**

  目标：删除常驻“发现 / 搜索 / 音乐库”与移动端底栏；恢复桌面只读上下文；右上统一搜索与账号；音乐库降为个人空间二级入口；修正 ECHOFORM 压缩字形并关闭本地 Next.js 开发指示器。

  允许修改：PRD、Design、AppShell Navigation 规格、`TODO.md`、`FixedNavigation*`、必要 AppShell 间距、`next.config.ts` 和对应测试。

  不允许破坏：全部本地路由、Skip Link、路由焦点、首页 Canvas/有限画廊/波浪/预览退出、旧 `/<slug>` 页面和 44px 可访问触控边界。

  验收：1440/768/390 无重复导航、无底栏、无重叠；页面上下文正确；品牌正常字宽且字距为 0；开发预览无左下 `N`；专项测试、完整测试与 `npm run check` 通过。

- [x] **T006 纯播放器状态机、队列与 LRC 解析**

  目标：按 `PLAYER_STATE_MACHINE.md` 实现无 React、无 DOM 依赖的 reducer/controller core、三种播放模式、revision 竞争保护、LRC/翻译/逐字解析和二分定位。

  允许修改：播放器行为规格；`src/lib/player/**`、对应 unit tests。

  不允许破坏：唯一时间源为 Audio currentTime；不使用 `isPlaying` 单 Boolean；顺序/随机均不隐式无限循环；写操作和页面 UI 不进入本任务。

  验收：状态机文档第 22.1 节全部有测试；快速 A/B/C 只让 C 生效；Pause 覆盖 pending play；不可播自动跳过最多一轮；歌词降级正常；`npm run check` 通过。页面状态测试不适用，以完整状态机 unit matrix 为门槛。

- [x] **T007 唯一 AudioController 与持久播放器 UI**

  目标：在根布局挂载唯一 `PlayerProvider`/`AudioController` 和持久 Player Bar，实现播放、暂停、上下曲、进度、缓冲、音量、静音、三种模式、错误恢复。

  允许修改：Player 组件规格；`src/app/layout.tsx`、`src/features/player/**`、`src/lib/player/**`、必要公共组件和测试。

  不允许破坏：路由切换不重建 Audio；页面组件不能直接操作 Audio；音源 URL 不进入日志/持久化；移动端不伪造系统音量控制；现有画廊仍可浏览。

  页面测试：idle、loading、ready、playing、paused、buffering、stalled、autoplay blocked、empty queue、unavailable/error、Retry/Next；在多个路由间切换验证同一 Audio 实例。

  验收：播放器状态与真实 media event 一致；进度线性、Seek 可键盘操作；三个视口无底栏遮挡；专项 unit/component/E2E 与 `npm run check` 通过。

### Phase 2：真实 Provider、BFF 与登录

- [x] **T008 Legacy Netease Adapter 与匿名契约**

  目标：精确安装 `NeteaseCloudMusicApi@4.32.0`，只在 server-only Adapter 中调用；完成匿名搜索、详情、音源、歌词、评论和 QR 801 字段归一化。

  允许修改：`package*.json`、`src/lib/music/netease/**`、必要类型声明、脱敏 fixtures、contract tests 和 API 契约文档的实测记录；为避免 Adapter 反向依赖 Player，可将通用歌词解析器迁到 `src/lib/music/lyricParser.ts`，并由 `src/lib/player/lyrics.ts` 兼容重导出。

  不允许破坏：不得安装 Enhanced 4.38.0 作为当前 Provider；不得使用 `^`/`~`；不得启动上游 Express；不得调用解灰、代理或匹配音源；不得输出上游原始 Body、URL、Cookie 或 QR key。

  验收：lockfile integrity 匹配契约；根 code 200 + 行 code 404/null URL 正确失败；`yrc` 缺失自然降级；异常形状映射统一错误；离线 fixtures 默认通过；Live 匿名 probe 仅手动运行并脱敏。页面状态测试不适用。

- [x] **T008R 播放源请求取消链路修复**

  目标：修复 T006/T007 仅丢弃旧异步结果、未实际中止旧音源请求的问题；由 Controller 创建并中止 `AbortController`，并由同源音源客户端把 signal 传给 `fetch`。

  允许修改：`TODO.md`、`src/lib/player/**`、`src/features/player/sourceClient.ts` 及对应 unit/component tests。

  不允许破坏：最新 revision 优先、用户 Pause、音源 URL 不进入日志或持久化；不实现 BFF 路由、Session、登录态或上游直连。

  验收：A/B/C 快速切歌会实际 abort A/B 请求且只接受 C；同源 source fetch 接收 signal；现有播放、错误恢复和三视口测试均通过。`npm run test:unit` 51 项、`npm run test:component` 26 项、`npm run test:contract` 19 项、`npm run test:e2e` 10 项和 `npm run check` 均通过。

- [x] **T009 BFF 公共读取路由与统一错误边界**

  目标：实现同源 `/api/search`、track、source、lyrics、comments 等公共读取 Route Handlers，统一校验、超时、Cache-Control、requestId 和错误 envelope。

  允许修改：BFF 规格；`src/app/api/**`、`src/lib/music/**`、contract/component tests。

  不允许破坏：浏览器不得直连上游；私有数据和音源 `no-store`；读取最多重试一次，写操作不进入本任务；错误 details 不含输入正文或敏感字段。

  页面/API 测试：成功、加载、空、参数错误、超时、429、502、部分数据、不可播放；验证旧有效数据不会因失败被清空。

  验收：Route Handler 契约与文档一致；客户端 bundle 不含上游包；所有错误有稳定 code/retryable/requestId；contract/E2E 与 `npm run check` 通过。

- [x] **T010 进程内 Session 与二维码登录**

  目标：实现随机 `sid`、server-only Session Store、QR Challenge、2 秒可见页轮询、801/802/803/800、登录状态恢复、头像替换和登出。

  允许修改：Auth 规格；`src/lib/session/**`、`src/features/auth/**`、`src/app/api/auth/**`、导航账号入口和测试。可修补 `src/lib/music/netease/**` 中仅用于二维码创建、账号状态和登出的服务端适配器能力。可更新 API 契约中的实际验证等级。

  不允许破坏：上游 Cookie/QR key 不得到浏览器；Session 重启后明确回游客；关闭/过期/成功必须停止轮询；不伪造 Demo 登录；未使用专用账号前不得宣称 802/803 已实测。经用户本轮明确授权，允许新增不提交的 `.env.local`，且其中的 `NETEASE_UPSTREAM_PROXY` 只能是无凭据 loopback HTTP transport，不得成为音源代理或客户端配置。

  页面测试：QR 初始化 loading、801、802、803、800、网络错误、关闭、Escape、刷新 QR、页面隐藏暂停轮询、Session 过期、头像错误占位。

  验收：QR Dialog 外框稳定；成功后 1 秒内头像替换；焦点闭环正确；刷新恢复有效本地 Session；敏感信息扫描通过；专项 tests 与 `npm run check` 通过。

### Phase 3：每日推荐、有限画廊与歌曲空间

- [x] **T011 每日推荐数据层与显式 Demo 降级**

  目标：实现 `/api/recommendations/daily`、用户+日期缓存语义、游客公共精选和错误后由用户显式选择 Demo 数据的流程。

  允许修改：Discovery 规格；`src/app/api/recommendations/**`、`src/features/discovery/**` 数据 hook/service、Demo fixtures 和测试。

  不允许破坏：匿名日推不得标为个人日推；Real 失败不得自动伪装成功；私有结果 `no-store`；同日重复进入不频繁请求；本任务不改 Three.js 几何。

  页面测试：游客、已登录、loading、个人日推有效、空数据、401/Session 失效、503、超时、重试、显式进入 Demo、退出 Demo 回 Real。

  验收：UI 明确显示 Real/Demo；空数据转公共精选但不冒充个人内容；状态切换不改变画廊预留尺寸；contract/component/E2E 与 `npm run check` 通过。

- [x] **T012 将项目画廊迁移为 Track 画廊**

  目标：让 WebGL 接收内部 `Track[]`，将方形专辑封面裁为 film slice，保留有限轨道、真实速度波浪、悬停和当前位置恢复。

  允许修改：Filmstrip/Home 组件规格；`HomeExperience*`、`FilmstripGallery*`、`src/lib/webgl/**`、Discovery 组件和测试。

  不允许破坏：首尾不循环；边界外输入不累积且不产生波浪；第一/最后封面可居中；波浪来自实际帧速度；Canvas 资源释放；不得把上游字段传入 WebGL。

  页面测试：loading skeleton、正常 Track、空/公共精选、接口错误、纹理错误、Canvas 初始化失败 DOM 降级；首端/中间/尾端；滚轮、Pointer、键盘、触控替代；1440/768/390 Canvas 像素检查。

  验收：`HOME-AC-01..05` 和 `VIS-AC-05/06/21/28` 通过；封面只裁切不拉伸；首页视觉居中；专项 E2E/视觉回归与 `npm run check` 通过。

  完成记录：主页 WebGL 已只接收内部 `Track[]`，封面缺失或纹理失败均使用内存方形占位纹理，首尾居中且有限不循环；Canvas 初始化失败时显示可键盘和触控操作的 DOM 歌曲列表。验证通过：unit 11 文件/67 项、component 7 文件/36 项、contract 6 文件/39 项、应用 E2E 13 项、基础组件视觉 E2E 2 项、播放器视觉 E2E 2 项；`npm.cmd run check` 通过（仅保留既有 2 条 `<img>` 优化 warning）。

- [x] **T013 歌曲预览舞台与自然退出**

  目标：把 Project Details 改为歌曲预览，使用同一封面几何完成展开/收缩；提供歌名、艺人、专辑、时长、播放、喜欢占位、歌词摘要和本地 `EXPLORE`。

  允许修改：Preview 规格；`HomeExperience*`、预览组件、WebGL 详情几何、Discovery/Player 接线和测试。

  不允许破坏：首个非零滚轮只触发退出、不移动画廊；Escape/返回/计数器共用状态机；全程可中断；首尾相邻项不循环；`EXPLORE` 只能去 `/track/[id]`；播放不中断。

  页面测试：正常进入、进入中点击播放、进入中退出、滚轮退出、Escape、按钮返回、首/尾歌曲、Track 详情 loading/error/unavailable、快速连续选择。

  验收：目标入场约 1100ms、上限 1600ms，退出约 500ms；共享封面无先消失后重现；返回恢复轨道位置；`PREVIEW-AC-01..04` 与相关视觉验收通过。

  完成记录：选中 Track 复用原 Three.js mesh、geometry、material 与 texture 展开为 1:1 封面，邻项只向真实方向退场，退出保持原 gallery offset；滚轮、Escape、顶部计数器和可见返回按钮共用可中断退出状态机。预览接入归一化 Track 详情、三行歌词摘要、不可用原因、播放/暂停、禁用喜欢占位与本地 `/track/[id]`，详情失败保留日推数据并支持重试；Canvas 失败使用 DOM 封面，`EXPLORE` 后浏览器 Back 恢复原 Track 与持续播放。验证通过：unit 11 文件/67 项、component 8 文件/42 项、contract 6 文件/39 项、应用 E2E 24 项、基础组件视觉 E2E 2 项，其中 T013 专项 9 项；1440/768/390 截图与 Canvas 非空像素检查通过，Reduced Motion 路径通过。`npm.cmd run check` 通过，仅保留既有 `AvatarButton.tsx` 与 `QrLoginDialog.tsx` 两条 `<img>` 优化 warning。既有 Vite 视觉预览改用系统动态端口，避免 Windows 保留端口导致假失败。

- [x] **T014 完整播放页与同步歌词**

  目标：实现 `/track/[id]` 的封面/歌词主界面、共享封面承接、普通 LRC 高亮、逐字可选降级、翻译、点击 Seek 和 5 秒浏览锁。

  允许修改：Track/Lyrics 规格；`src/app/track/[id]/**`、`src/features/player/**`、歌词 parser/sync 的必要修正和测试。

  不允许破坏：唯一 Audio、当前时间唯一真值；页面滚轮不得退出；无 yrc/无歌词是正常状态；Buffering 不造假进度；移动端控制不能覆盖歌词。

  页面测试：track loading、正常歌词、逐字、普通 LRC、纯文本、无歌词、歌词错误/重试、音源 loading/buffering/unavailable、Seek、手动浏览锁、路由往返持续播放。

  验收：歌词误差目标 <=200ms；三视口与 200% 缩放无重叠；Reduced Motion 无强制平滑滚动；`PLAYER-AC-01..05` 和 `VIS-AC-09` 通过。

  完成记录：`/track/[id]` 已从占位路由替换为沉浸播放页，复用唯一 `PlayerProvider` 与持久 Audio。页面并发读取归一化歌曲和歌词，详情与歌词各自保留 loading/error/retry；普通 LRC、逐字、翻译、纯文本、纯音乐与无歌词均有真实显示状态。同步歌词只从 `currentTimeMs` 推导高亮，支持点击 Seek、5 秒手动浏览锁和 Reduced Motion 的即时回中；页面滚轮保持普通滚动，不复用首页退出手势。新增页面组件/E2E 验收，并更新已完成播放页对应的路由与登录测试选择器。验证通过：unit 11 文件/67 项、component 9 文件/46 项、contract 6 文件/39 项、应用 E2E 28 项、基础组件视觉 E2E 2 项，T014 专项 E2E 4 项；1440/768/390 截图和 200% 等效视口检查通过；`npm.cmd run check` 通过。默认 E2E 端口 3100 被已有进程占用时，完整浏览器回归改在隔离的 3203 当前生产构建上执行；仅保留既有 `AvatarButton.tsx` 与 `QrLoginDialog.tsx` 两条 `<img>` 优化 warning。

- [x] **T015 只读评论与队列 Drawer/BottomSheet**

  目标：完整播放页加入评论/队列共用容器；P0 先完成评论分页读取、排序、队列查看/切歌/移除及桌面 Drawer、移动 BottomSheet。

  允许修改：Comment/Queue/Drawer 规格；`src/features/player/**`、必要公共组件和测试。

  不允许破坏：评论滚动不得触发预览退出；同一时刻只开一个容器；队列不是永久歌单；移除当前唯一歌曲必须进入安全状态；P1 写入口只能显示登录/未开放状态，不能假成功。

  页面测试：评论 loading/results/empty/error/pagination；队列正常/空/当前项/不可播/移除撤销；Drawer/Sheet 打开关闭、Escape、焦点返回、软键盘占位。

  验收：桌面 400-480px 且不超过 42vw；移动安全区正确；错误内联；队列与全局状态一致；专项测试与 `npm run check` 通过。

  完成记录：`CommentsQueuePanel` 作为同一容器实现桌面右侧 Drawer 与移动 BottomSheet，通过 Portal 挂载到 `document.body`；仅一个面板可打开。评论按同源 `GET /api/tracks/:id/comments` 延迟读取，支持最新/最受欢迎排序、分页、初始错误重试、后续分页错误保留和只读未开放入口。队列复用 `PlayerProvider` 快照与命令，支持当前曲目、不可播说明、切歌、移除与 5 秒撤销；移除唯一歌曲进入安全空队列，撤销不伪造自动播放。实现 Escape/背景关闭、焦点归还、Tab 闭环、Reduced Motion 退化和移动安全区。公共按钮仅增加 `forwardRef` 以支持可访问性焦点管理。额外稳定了既有画廊的异步回退断言，并关闭持久播放器视觉测试的无关 HMR 连接。验证通过：unit 11 文件/67 项、component 10 文件/53 项、contract 6 文件/39 项、完整 E2E 应用 29 项与基础视觉 2 项、Canvas 非空像素 3/3；1440/768/390 及移动 Sheet 最终底边检查通过；`npm.cmd run check` 通过。仅保留既有 `AvatarButton.tsx` 与 `QrLoginDialog.tsx` 两条 `<img>` 优化 warning。

### Phase 4：搜索、专辑、歌手与发现

- [x] **T016 搜索页面与综合部分成功**

  目标：实现一级搜索入口、300ms 防抖、URL `q/type`、歌曲/歌手/专辑、综合 `allSettled` 部分成功、过期请求隔离和返回状态恢复。

  允许修改：Search 规格；`src/app/search/**`、`src/features/search/**`、TrackRow/Album/Artist 展示组件、BFF 搜索必要修正和测试。

  不允许破坏：旧结果在加载/错误时保留；综合搜索不得用未验证上游 all 类型；输入可在展开动画结束前使用；任务页不运行 WebGL；搜索结果播放不离开页面。

  页面测试：空查询、历史/热搜占位、loading、三类结果、综合部分失败、全部失败、空结果、快速输入、特殊字符、分页、播放、返回恢复；1440/768/390。

  验收：`SEARCH-AC-01..05`、`API-AC-16`、`VIS-AC-12/13/29` 通过；键盘 `/` 与可见入口均可达；专项 tests 与 `npm run check` 通过。

  完成记录：实现同源 `/api/search` 客户端解码、300ms 防抖、过期请求中止与 revision 隔离、URL `q/type` 历史恢复、综合三分区部分成功、单类型分页、结果页内播放与本地详情链接；空查询不伪造历史/热搜。搜索页迁移 AppShell 标题焦点协议，避免与输入焦点冲突。验证通过：unit 11 文件/67 项、component 11 文件/60 项、contract 6 文件/39 项、完整 E2E 32 个应用场景与 2 个基础视觉场景、`npm.cmd run check`。仅保留既有 T010 登录组件的两条 `<img>` 优化 warning。

- [x] **T017A 匿名访客播放与可播性策略**

  目标：先验证固定 Legacy 包的匿名访客注册能力与匿名音源效果，再以 server-only 凭据改善公开读取；首页仅展示已验证可播的公开精选，搜索保留全部结果并提供可播放状态与“仅看可播放”筛选。

  允许修改：当前执行卡列出的文档、Provider/Session/BFF、Discovery/Search、可播放状态组件和测试；仅在脱敏实测通过后扩展 Legacy 函数白名单。

  不允许破坏：用户 Cookie 优先、Demo 显式选择、唯一 Audio、既有播放状态机、搜索 URL/旧结果、首页有限画廊；不得扩大既有短期音源 URL 的归一化响应边界，上游 Cookie 或匿名凭据绝不进入浏览器，不能加入音频代理、解灰、第三方匹配或写操作。

  页面测试：匿名注册 loading/成功/拒绝/过期；首页候选 loading、已验证可播、候选不足、上游错误；搜索 unknown/checking/verified/unavailable/仅看可播放；登录切换后权限重新检查；音源到期刷新、不可播和网络错误。

  验收：先有固定包函数与脱敏运行证据，再实现公开精选；不记录歌曲名、Cookie 或 URL 的可播率聚合比较；首页不显示未经验证为可播的公开曲目；搜索不因预检失败丢失发现结果；三视口、键盘、Reduced Motion、专项 tests、完整测试、`npm run check`、敏感信息检查和 `git diff --check` 全部通过。

  完成记录：固定 Legacy 包匿名注册与裸匿名可播率探测通过；匿名凭据无可量化提升，因此未引入 Cookie 持有。首页公开精选仅保留服务端标准音质预检通过的曲目并按日期缓存；空结果不写入全局或会话缓存，重新加载会重新探测。新增可播性 BFF，搜索保留 unknown/checking/verified-playable/unavailable 状态与“仅看可播放”筛选。契约 6 文件/44 项、单元 11 文件/67 项、组件 11 文件/61 项、应用 E2E 32 项、基础视觉 E2E 2 项、`npm run check` 和 `git diff --check` 通过。未记录 Cookie、Token、QR key、音源 URL 或用户数据。

- [ ] **T017 专辑、歌手、新歌与热门推荐**

  目标：完成 `/album/[id]`、`/artist/[id]`，以及搜索空状态/发现次级入口所需的新歌和热门数据；支持播放全部和本地详情导航。

  允许修改：Album/Artist 规格；对应路由/features、BFF/Provider 公开读取扩展、TrackRow/PlaylistTile 使用和测试。

  不允许破坏：首页 WebGL 仍只承载每日推荐；页面使用常规纵向滚动；不可播放歌曲保留可查看并说明原因；不做外链跳转。

  页面测试：album/artist loading、正常、空曲目/空专辑、404、接口错误、部分不可播、播放全部；新歌/热门 loading/empty/error。

  验收：本地路由和队列上下文正确；长列表策略明确；三个视口、键盘和状态测试通过；`npm run check` 通过。

### Phase 5：用户主页、音乐库与本地历史

- [ ] **T018 用户主页与只读用户歌单**

  目标：实现头像共享元素进入 `/profile/[id]`，展示资料、喜欢入口、创建/收藏歌单摘要、最近播放和真实数据不足状态。

  允许修改：Profile 规格；`src/app/profile/[id]/**`、`src/features/profile/**`、用户/歌单 BFF 读取、AvatarButton/PlaylistTile 和测试。

  不允许破坏：不使用全屏圆形遮罩；不展示手机号、生日、城市等非必要字段；不伪造品味画像；他人页面不显示编辑入口；头像错误使用中性首字母占位。

  页面测试：loading、自己的主页、公开他人主页、空资料/空歌单、私密/无权限、404、接口错误、头像失败、未登录访问。

  验收：共享元素约 600ms 且可中断；第一视口信息层级正确；三视口/焦点/错误恢复通过；专项 tests 与 `npm run check` 通过。

- [ ] **T019 音乐库与 IndexedDB 播放历史**

  目标：实现 `/library` 的喜欢、专辑、歌单、历史 Tabs；用 IndexedDB 按 30 秒或 50% 阈值记录本地有效播放，支持去重、离线读取和清空。

  允许修改：Library/History 规格；`src/app/library/**`、`src/features/library/**`、本地存储 adapter、测试 fixtures 和测试。

  不允许破坏：不把音源 URL 写入 IndexedDB；本地历史与网易云记录必须标明来源；未登录状态不能跳外站；清空历史属于删除数据，执行真实 UI 操作和实现前按 AGENTS 红线确认。

  页面测试：未登录、loading、各 Tab 正常、各 Tab 空、接口错误、离线历史、重复播放、阈值前后、清空确认/取消/失败、50+ 项。

  验收：IndexedDB schema 有版本与 adapter 测试；音频时间事件不会导致高频重复写入；列表末项不被播放器/导航遮挡；专项 tests 与 `npm run check` 通过。

### Phase 6：登录态写操作与毕设完整功能

- [ ] **T020 专用账号登录态与写操作 Contract Probe**

  目标：按 API 文档建立手动脚本，分别验证 802/803、个人日推、喜欢、评论、歌单和收藏等真实路径，并把证据等级写回契约。

  允许修改：`scripts/` 手动 probe、脱敏报告模板、API/Architecture 文档和 contract tests。

  不允许破坏：不得使用个人主账号；不得保存二维码截图、Cookie、昵称、评论正文、歌单名或音源 URL；写操作不进默认测试；Enhanced 不参与；测试评论/歌单的创建与删除必须在本任务开始前再次获得外部写入和清理授权。

  验收：每个端点独立报告业务码和字段存在性；临时评论/歌单按批准范围回滚；Session 销毁并登出；只有实测通过项升级等级；失败项保留为未验证。页面状态测试不适用。

- [ ] **T021 喜欢歌曲与收藏专辑**

  目标：实现喜欢/取消喜欢、收藏/取消收藏专辑，以及未登录时打开 QR；成功后 Profile/Library/当前歌曲状态一致。

  允许修改：Library write 规格；对应 BFF、Provider 已验证写接口、player/search/album/profile/library UI 和测试。

  不允许破坏：未通过 T020 的真实写接口不得接入 Real；写请求不自动重试；UI 不在服务确认前宣称成功；Session 失效必须回滚可见状态。

  页面测试：未登录、提交中、成功、取消、重复点击、401、验证错误、上游错误、网络超时、跨页面一致性。

  验收：写入幂等/防重复策略清楚；错误就地显示；Demo/Real 分别验收；专项 tests 与 `npm run check` 通过。

- [ ] **T022 歌单创建、编辑、曲目管理与分享**

  目标：实现歌单创建、编辑、删除、添加/移除曲目、公开状态和本站分享链接；Web Share API 失败时复制本地 URL。

  允许修改：Playlist write 规格；`src/app/playlist/[id]/**`、`src/features/library/**`、对应 BFF/Provider、Dialog/Menu 和测试。

  不允许破坏：删除歌单和移除真实外部数据前必须再次确认；写操作无自动重试；无权限用户只读；分享不建设站内好友；链接不得指向原网站。

  页面测试：loading、正常、空歌单、无权限、404、读取错误；创建/编辑校验、提交中、成功、失败；添加/移除；删除确认/取消/失败；分享成功/回退。

  验收：所有写状态可恢复；重复提交受控；本地路由可直接加载；三个视口和专项 tests 与 `npm run check` 通过。

- [ ] **T023 评论发表、回复与点赞**

  目标：在现有评论容器中实现登录态发表、回复、点赞和状态同步。

  允许修改：Comment write 规格；评论 BFF/Provider、CommentItem/Composer 和测试。

  不允许破坏：写接口无自动重试；`clientMutationId` 防重复；评论正文不入日志/URL；匿名操作先登录；失败不能只 Toast；不得构建聊天或好友系统。

  页面测试：匿名、输入校验、发送中、成功、回复、点赞/取消、重复提交、401、429、上游失败、分页刷新后状态。

  验收：服务确认前显示“发送中”而非已成功；失败可重试且不重复发帖；焦点与软键盘处理正确；专项 tests 与 `npm run check` 通过。

### Phase 7：主题、设置与推荐

- [ ] **T024 ARTWORK 取色与三主题完整实现**

  目标：实现缩小图取色、饱和度/亮度限制、对比计算、主题原子切换、失败回 INK；支持用户手动 INK/PAPER/ARTWORK。

  允许修改：Theme 规格；`src/lib/theme/**`、`globals.css` 主题映射、相关页面接线和测试。

  不允许破坏：PAPER 不得由路由强制；游客/API 故障/Demo 使用 INK；旧主题保留到新主题准备好；不使用固定渐变；运行时色是唯一允许的动态 Raw Color。

  页面测试：三主题、鲜艳/极暗/极亮封面、跨域/加载失败、快速切歌、主题切换、Reduced Motion；首页/预览/播放页 1440/768/390。

  验收：正文 >=4.5:1、图标/焦点 >=3:1；无闪白；取色不阻塞播放；`VIS-AC-02..04` 与专项 tests、`npm run check` 通过。

- [ ] **T025 设置、音质偏好与 Sleep Timer**

  目标：实现外观、减少动态、默认音质、播放模式、音量记忆、歌词翻译、逐字优先，以及 15/30/45/60 分钟和当前歌曲结束定时停止。

  允许修改：Settings 规格；`src/app/settings/**`、settings feature/localStorage adapter、player timer 和测试。

  不允许破坏：设置不含上游 Cookie；Sleep Timer 最后 3 秒只降低应用 Audio 音量，暂停后恢复用户音量；刷新后清除 Timer；写失败就地显示；即时设置不增加多余保存按钮。

  页面测试：设置 loading 不适用但需验证初始 hydration；空/损坏存储回默认；存储写失败；各主题/音质/模式；倒计时、后台触发、当前曲结束、取消、刷新清除。

  验收：控制类型符合 Design；刷新无 hydration 抖动；Sleep Timer 不清队列、不改系统音量；专项 tests 与 `npm run check` 通过。

- [ ] **T026 播放历史规则推荐、热搜与品味画像**

  目标：按可解释规则用喜欢和有效播放历史生成相似音乐；展示来源、排除不可播/短期重复并限制同歌手；用真实数据生成 3-5 类品味画像。

  允许修改：Recommendation/Profile 规格；discovery/profile/library 相关 feature、Provider 读取扩展、fixtures 和测试。

  不允许破坏：不得宣称 AI 推荐；不得伪造标签或比例；个人数据不足显示空状态；推荐缓存按天；不训练模型，不新增数据库。

  页面测试：loading、正常、多种种子、数据不足、无可用结果、部分接口失败、全部失败、不可播过滤、重复/同歌手限制。

  验收：规则输出可复现、可解释；数据来源/时间范围可查看；P1 热搜、新歌、热门入口闭环；专项 tests 与 `npm run check` 通过。

### Phase 8：清理、全量验收与毕设交付

- [ ] **T027 旧作品集路由、内容和资产清理**

  目标：在 ECHOFORM 所有替代路由和资产验证完成后，移除已无引用的 About、Project、`/[slug]`、旧数据和旧作品资产/下载脚本，更新 README 与资产校验。

  允许修改：删除清单经用户确认后的旧文件；README、manifest、scripts、路由和引用测试。

  不允许破坏：有限画廊、波浪、共享元素和退出代码；ECHOFORM 本地品牌/授权演示资产；任何尚有运行引用的文件。删除文件/目录属于红线，本任务开始前必须展示精确清单并再次确认。

  页面测试：所有 ECHOFORM 路由主流程；旧 slug 返回预期 404；全仓检查不存在 Aristide 外链、姓名、邮件、社交和运行时热链。

  验收：无死代码/死资产引用；构建路由只包含 ECHOFORM；资产校验通过；删除结果与可恢复性已报告；全套 tests 和 `npm run check` 通过。

- [ ] **T028 P0/P1 全量回归、性能与无障碍**

  目标：执行 PRD、Design、Architecture、API、Player 全部验收编号；修复跨模块回归，形成可复现测试报告。

  允许修改：仅修复验收发现的问题、测试和验收报告；发现架构或需求级问题时必须先走大需求变更流程。

  不允许破坏：不得为通过测试关闭规则、注释错误、降低类型/无障碍标准或让 Demo 覆盖 Real 失败；不改 CI/CD/部署。

  页面测试：登录到日推、预览、播放、歌词、评论、搜索、详情、喜欢、歌单、历史、设置、主页的完整主流程；每页 loading/empty/error；三主题、三视口、200% 缩放、Reduced Motion、键盘；WebGL Canvas 像素和 >=30fps 降级目标。

  验收：所有 P0/P1 条目有实现+自动测试，或有用户批准的延期记录；全套测试连续两次通过；无敏感信息；`npm run check` 通过。

- [ ] **T029 毕设文档、演示脚本与最终仓库状态**

  目标：更新 README、系统架构图、功能流程图、数据/无数据库决策、API 风险、测试结果、Demo/Real 区分和答辩演示脚本，使实现与论文描述一致。

  允许修改：`README.md`、`docs/**`、必要截图和脱敏测试报告。

  不允许破坏：不得把未实测功能写成完成；不得包含账号信息、二维码、Cookie、音源 URL；不得公开部署或发布；截图不包含个人隐私。

  验收：文档中的路由、模型、功能和测试与最终代码一致；答辩脚本同时覆盖正常流程和上游故障下的显式 Demo；全套 tests、资产检查和 `npm run check` 通过；完成提交并在再次确认后推送。

## 6. 提交与同步约定

- 每个 `Txxx` 对应一个主提交；同一任务必要修复可在推送前合并为一个职责清晰的提交。
- 提交信息格式：`type(scope): summary`，例如 `feat(player): add persistent audio controller`。
- 不把两个 TODO 任务混入同一提交。
- 推送前展示：当前任务、文件清单、测试结果、commit hash、待推送分支。
- 得到当次明确确认后执行 `git push origin main`，再以 `git status --short --branch` 和 `git log -1 --decorate` 核对同步结果。
- 推送失败时停留在当前任务，排查并重试；不得先勾选或开始下一任务。

## 7. 暂不执行的事项

- Enhanced Provider 4.38.0：仅在 Legacy 核心链路失败且完成独立 Contract Probe 后评估。
- 真实音频频谱驱动：保留为 P2；P0/P1 使用程序化声音呼吸或静态降级。
- 数据库、Redis/KV、跨设备同步、多标签互斥、PWA、公开部署、音频代理和生产监控：均需新的架构任务与用户批准。
- 站内好友、即时消息、自建评论系统、版权/VIP/地区绕过、第三方解灰音源：不在当前产品范围。
