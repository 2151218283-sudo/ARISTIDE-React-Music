# T020 登录态 Contract Probe 规范

## 目的

本规范定义对 `NeteaseCloudMusicApi@4.32.0` 进行专用测试账号人工验收的唯一流程。它验证
二维码 `802/803`、登录态、个人日推及获授权后的写操作契约；不实现任何页面或 BFF 写接口。

## 所有权与边界

- 执行文件：`scripts/netease-auth-contract-probe.mjs`。
- 该文件是独立 server-only 手动工具，不被 Next.js 打包，不加入 `npm run test` 或 CI。
- QR 图像、QR key、上游 Cookie、用户资料、评论正文、歌单名、歌曲 URL 和原始 Response
  只在进程内存中短暂存在，绝不写入文件、fixture、日志或浏览器持久化层。
- 一次运行只验证 Legacy `4.32.0`；Enhanced 必须使用独立 Probe 和独立报告，不能继承本任务
  的结果。

## 执行模式

### 只读登录态验证

```powershell
node scripts/netease-auth-contract-probe.mjs --live --qr-port <local-port>
```

脚本先创建临时 `127.0.0.1` QR 页面，`--qr-port` 可指定端口以便在二维码请求前预先打开页面；
省略时由系统分配端口。标准错误流会显示该回环页面地址及固定的非敏感阶段提示。测试人员用专用网易云账号扫描并确认后，
脚本顺序验证：`login_qr_key`、`login_qr_create`、`login_qr_check` 的
`801/802/803`、`login_status`、`user_account`、`recommend_songs` 和 `user_playlist`。任何
状态未出现或业务码不符合预期，均保留 `PENDING_AUTH`。

### 只读写入候选预检

```powershell
node scripts/netease-auth-contract-probe.mjs --live --preflight
```

预检完成正常认证读取后，额外以相同内存 Session 只读取喜欢列表、已收藏专辑和公开热门歌单。它
只报告 `like`、`comment`、`playlist`、`collection`、`album` 是否存在候选项，不输出也不持久化
歌曲、专辑、歌单或用户 ID。`--preflight` 与 `--writes` 互斥，预检结果不构成外部写入授权。

### 写操作验证

写操作属于外部变更。本轮必须先在对话中获得对精确 scope、测试曲目/专辑/歌单 ID 以及回滚
范围的明确授权，随后才可使用以下形式的命令：

```powershell
node scripts/netease-auth-contract-probe.mjs --live --writes --confirm-external-writes --write-scope <scope> <public-test-id-arguments>
```

可选 scope 为 `like`、`comment`、`playlist`、`collection`、`album`。脚本不打印任何实际 ID，
且只会对测试账号中当前不存在的关系执行“添加后立即撤销”。`comment` 和 `playlist` 的创建值
仅在内存生成；若无法定位可删除的评论或临时歌单，脚本视为回滚失败并停止。

当只读候选预检已经确认候选可用，且用户在当前对话明确授权对应 scope 时，允许以
`--auto-select-candidates` 代替公开测试 ID 参数：

```powershell
node scripts/netease-auth-contract-probe.mjs --live --writes --confirm-external-writes --auto-select-candidates --write-scope <authorized-scopes>
```

该模式重新登录后在同一进程内从个人日推、喜欢列表、已收藏专辑、已收藏歌单和公开热门歌单中
选择当前可回滚的候选；候选 ID 绝不打印、持久化或传给浏览器。该开关不能扩大授权 scope，不能
与 `--preflight` 合用。任一所需候选缺失、写入失败或回滚失败都立即停止，不继续后续 scope。

## 脱敏报告格式

标准输出最终只输出一个数组。标准错误流的阶段提示不包含 Cookie、QR key、用户资料或任何上游
Response 值。数组每项只能包含以下字段：

```json
{
  "endpoint": "recommend_songs",
  "httpStatus": 200,
  "businessCode": 200,
  "fields": {
    "data.dailySongs": { "present": true, "count": 30 }
  }
}
```

`httpStatus` 或 `businessCode` 无法取得时为 `null`；字段不存在时 `present` 为 `false`。报告不
包含字段值。人工将结果按端点写入 `NETEASE_API_CONTRACT.md`：只有实际成功且回滚完成的项才
能升级为 `MUTATION_ROLLED_BACK`；写入成功但回滚失败或无法确认时必须标注为
`MUTATION_ROLLBACK_UNCONFIRMED`，不能宣称清理完成。

## 完成条件

1. 登录 Probe 捕获并报告 `802`、`803`，且后续账号状态和个人日推字段存在性符合契约。
2. 每个已授权写入 scope 独立报告成功与回滚；任一回滚失败都不能标记该 scope 完成。
3. 进程退出前调用上游登出，关闭临时 QR 页面及其空闲连接，并丢弃内存 Cookie。
4. 不把实时结果放入 fixture、自动化测试、源码常量或 Git commit。

## 已记录的应用级证据

2026-08-06 已通过 ECHOFORM 本地登录层完成专用测试会话的扫码、个人日推展示和退出登录。该
结果可验证应用 BFF 与 Session 的端到端接线，但不含逐端点的原始业务码报告，不能替代本规范的
手动 Probe，也不能单独升级 `PENDING_AUTH` 或 `MUTATION_NOT_RUN`。

2026-08-06 的修复后手动 Probe 脱敏报告已实际记录：`login_qr_key`、`login_qr_create`、
`login_qr_check` 的 `801/802/803`、`login_status`、`user_account`、`recommend_songs`、
`user_playlist` 与 `logout` 均为 HTTP 200 / business code 200。`login_status` 的内层
`data.account/profile`、`user_account` 的根层 `account/profile`、个人日推和用户歌单所需数组
均存在且非空；报告只记录数组数量，不保存用户资料或内容。该次运行在登出成功后正常关闭临时
QR 服务。

`login_qr_check` 在 `801/802` 阶段也可能返回非空的传输 Cookie；认证结论由 `803` 和后续
登录态只读端点共同确定，而不是仅由 Cookie 字段存在性确定。

2026-08-06 在当前对话明确授权 `like`、`comment`、`playlist`、`collection`、`album`，且限定“任一
回滚失败立即停止”后，首次 Probe 完成 `like:add` 和 `like:remove`，两者均为 HTTP 200 / business
code 200，记录为 `MUTATION_ROLLED_BACK`；首次评论删除返回 404，之后停止。恢复本机出站网络并
重新授权后，第二次 Probe 的 `comment:add`、可见性轮询和 `comment:delete` 均为 HTTP 200 / business
code 200，评论记录升级为 `MUTATION_ROLLED_BACK`。临时歌单名缩短至 30 字符、曲目成功码按固定包
嵌套 Response 读取后，`playlist_create`、`playlist_tracks:add`、`playlist_tracks:remove` 与
`playlist_delete` 均为 HTTP 200 / business code 200，歌单路径升级为 `MUTATION_ROLLED_BACK`。随后
`playlist_subscribe:add` 返回 HTTP 405 / business code 405，未取得回滚目标并立即停止；`album` 没有
执行并保持 `MUTATION_NOT_RUN`。固定包在失败时会向标准输出写入原始 Response，Probe 现于每次
上游调用期间抑制该输出，只记录脱敏状态码。所有进程内认证信息随后被丢弃并调用上游登出。

随后在新的独立登录会话中仅重试 `collection`，`playlist_subscribe:add` 仍返回 HTTP 405 / business
code 405；依据无自动重试和串行停止规则，不再继续 `album`。该路径记录为 `MUTATION_WRITE_FAILED`，
不是回滚失败，也没有证据表明测试账号的收藏关系发生改变。

第二次成功删除只确认其自身创建的临时评论，不追溯确认首次删除返回 404 的历史临时评论。首次评论的
随机正文和 ID 未输出或持久化，故其是否遗留仍不可确认，且不得在没有专门清理授权的情况下定向处理。

2026-08-06 的只读候选预检确认：`like`、`comment`、`playlist`、`collection`、`album` 均存在可
回滚候选。该结果只用于缩小后续授权范围，不输出候选 ID，也不构成对任一外部写操作的授权或验收。

## 11.2 2026-10-04 renewed dedicated-account Probe

本轮重新执行 Legacy `4.32.0` Probe，所有会话均在退出前调用上游 `logout`，没有保存二维码、
Cookie、用户资料、评论正文、歌单名、实体 ID、音源 URL 或原始 Response。

- 只读登录态会话重新捕获 QR `801/802/803`，并验证 `login_status`、`user_account`、
  `recommend_songs`、`user_playlist` 和 `logout`。`data.dailySongs` 为 33 项，`playlist` 为 6 项。
- 候选预检读取喜欢列表、收藏专辑列表和公开热门歌单；喜欢数量在不同会话为 324/325，收藏专辑
  数量为 0，公开热门歌单为 50。数量只用于候选选择，不证明写入回滚后的全局列表等价。
- 独立会话中 `album_sub:add` 与 `album_sub:remove` 均为 HTTP 200 / business code 200，
  记录为 `MUTATION_ROLLED_BACK`。
- 独立会话中 `like:add`、`like:remove`、`comment:add`、评论可见性轮询、`comment:delete`、
  `playlist_create`、`playlist_tracks:add`、`playlist_tracks:remove` 和 `playlist_delete` 均为
  HTTP 200 / business code 200，并在同一进程完成回滚。
- 独立会话中 `playlist_subscribe:add` 仍为 HTTP 405 / business code 405。Probe 在失败点停止，
  不发送取消请求，随后正常登出；该路径保持 `MUTATION_WRITE_FAILED` / `BLOCKED`。

这些结果只升级固定 Legacy Provider 的契约等级，不代表 ECHOFORM 页面、BFF 或产品写接口已实现。
后续产品写入按 TODO 的 T021、T022、T023 串行执行。
