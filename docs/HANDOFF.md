# 交接文档（2026-10-25）

这份文档给接手的下一个开发会话看，无论是本地 Claude Code 会话还是人。读完就能接着做，不用翻聊天记录。

## 1. 当前状态一览

| 项目 | 状态 |
| --- | --- |
| `main` | 围棋、五子棋（自由/连珠）、黑白棋，三种拓扑（圆柱/环面/莫比乌斯），本地对弈、联机、大厅、复盘、三种棋的 AI 和 SGF 棋谱；房间可以不公开、移出成员、判对方弃局、访客执白对 AI；对 AI 时有提示，AI 至少停 1 秒，黑白棋按距离逐圈翻子；大厅有我的房间、快速加入、搜索、排序、在线状态；游客身份和“我的棋谱”（每盘下完自动保存，`/records` 列表，`/game/编号` 回放，只有对局双方能看）；注册登录（用户名 + 密码注册，或 Google 登录，或邮箱验证码登录；邮箱只在账号设置里用验证码绑定；游客注册或登录后棋谱和房间席位跟到账号；登录后在别的设备打开房间链接回到原来的席位）；顶栏账号菜单和账号设置页 `/settings`（改用户名、登录方式里绑定和解绑 Google、邮箱、密码、删除账号） |
| 测试 | `npm test` 全过（约 1,065 项，含真实 workerd/SQLite 运行时测试和规则跑量快速档）；`npm run test:soak` 全量档约 6,000 盘随机对局；`npm run test:coverage` 规则代码覆盖率门槛；PR 检查（`.github/workflows/ci.yml`）全绿 |
| 线上 | <https://game.topology-go.catseye.today/>（负责人绑定的自定义域名）和 <https://topology-go.pystashell.workers.dev/> 是同一个 Worker，`/version.json` 给出当前版本。`0.3.0-rc.1` 于 2026-10-24 上线（多棋种首次上线），`0.3.0-rc.2`（PR #5）于 2026-10-25 上线；点目超时自动确认在 `0.3.0-rc.3`；提示、AI 停顿、翻子动画、规则跑量测试、大厅补全和连接心跳在 `0.3.0-rc.4`（PR #7、#8、#9，2026-10-25）；棋盘的读屏标签按棋种命名在 `0.3.0-rc.5`（PR #10）；棋盘尺寸 3–30 和任意大小的连珠禁手在 `0.3.0-rc.6`（PR #11，2026-10-26）；掉线检查只在对局中每分钟一次、冒烟测试建不公开房间在 `0.3.0-rc.7`（PR #12，2026-10-26）；大厅只列等待和进行中的对局在 `0.3.0-rc.8`（PR #13，2026-10-26）；游客身份和“我的棋谱”在 `0.3.0-rc.9`（PR #14，2026-10-26；D1 库 `topology-go` 已建表，Worker 密钥 `BETTER_AUTH_SECRET` 已设置）；一人一身份、悔棋申请不挡棋局、默认最小棋盘在 `0.3.0-rc.10`（PR #15），围棋默认 9×9 的修复在 `0.3.0-rc.11`（PR #16，2026-10-26）；注册登录、游客继承、换设备回到房间席位在 `0.3.0-rc.12`（PR #17，2026-10-27；D1 已加 `user_alias` 表，Worker 密钥 `PASSWORD_PEPPER` 已设置；Google 登录等负责人按 `docs/google-sign-in.md` 设置密钥后开启）；房间在棋手都离开后自动关闭（等人 2 分钟、两局之间 5 分钟、对局中 30 分钟并存“中断”）在 `0.3.0-rc.13`（PR #18，2026-10-27）；邮箱验证码登录、登录后改密码、添加和验证邮箱在 `0.3.0-rc.14`（PR #19，2026-10-28；D1 已加 `email_send` 表；`RESEND_API_KEY`、`EMAIL_FROM`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 已设置，邮箱验证码和 Google 登录已开启）；账号菜单、设置页 `/settings`、登录框 Google 在最上面在 `0.3.0-rc.15`（PR #20，2026-10-28）；注册不再收邮箱（邮箱只认验证过的，迁移 0004 解除了以前没验证的邮箱）、改用户名、“登录方式”（解绑和手动绑定 Google）在 `0.3.0-rc.16`（PR #21，2026-10-28）|
| 发布方式 | GitHub `production` 环境仍缺 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，所以在负责人的电脑上执行发布脚本。那台机器的 Wrangler 已登录负责人的 Cloudflare 账户，见 §3 |

已合并的 PR（说明和验证记录都在 PR 正文里）：

- #1 `codex/大厅版`：在线大厅、计时、SGF、英文界面、矩形棋盘，以及一轮审查修复
- #2 `feat/multi-game`：通用拓扑模块、规则注册表、五子棋（含连珠禁手）、黑白棋，联机/大厅/视图/UI 全部多棋种化
- #3 `feat/game-ai`：五子棋 AI 用 Rapfi，黑白棋 AI 是自研引擎
- #4 `docs/handoff`：上一版交接文档、设计笔记、浏览器检查脚本
- #5 `feat/handoff-backlog`：处理上一版交接文档的全部待办，见 §6
- #6 点目超时自动确认；#7 手机上下拖动棋盘、五子棋 11×11；#8 黑白棋规则参考测试
- #9 `feat/hints-pacing-flip-wave`：对 AI 的提示、AI 至少停 1 秒、黑白棋逐圈翻子；三种棋的规则跑量测试和覆盖率门槛；大厅补全（我的房间、快速加入、搜索、排序、在线状态）和连接心跳

## 2. 负责人（owner）已做的决定

- 交流用中文。节奏优先：dev 验证通过就上线，负责人看完再给反馈。
- **产品名统一为 Topology Go**（2026-10-24）。页面标题是“Topology Go · 拓扑棋盘上的围棋、五子棋、黑白棋”，品牌副标题是“围棋 · 五子棋 · 黑白棋”，package 名为 `topology-go`。线上 Worker 名 `topology-go` 不变。协议名、存储键、Durable Object 类名仍保留 `bamboo-baduk` / `Baduk`，因为它们已经持久化或在线上协议里使用，不能改。
- **不加 multimcts**（2026-10-24）：它是 Python 写的通用 MCTS，浏览器里跑不了，棋力也不会超过现有引擎。
- 五子棋同时支持**自由五子**（五连及以上胜）和**连珠**（黑方三三、四四、长连禁手），开局时选。禁手点直接拒绝落子，不判负；不做开局规则（如 Swap2）。
- **棋盘尺寸**（2026-10-26）：可设置范围 3–30。围棋 3–30；五子棋 5–30（至少要能连成五）；黑白棋 4–30 的偶数（开局 4 子要居中）。快捷尺寸：围棋 9、13、19；五子棋 7、11、15；黑白棋 6、8、10。禁手是同一套通用规则：不足 11 格的首尾相接线按环判断（`src/game/renju.js`），负责人明确要求禁手不能和棋盘大小挂钩。
- 五子棋 AI 用 **Rapfi**，负责人接受 GPL-3：代码是 GPL-3，权重是 CC0。黑白棋 AI 是**自研纯 JS 引擎**，原因是没有开源引擎能正确处理环面、圆柱和莫比乌斯。
- 围棋行为必须保持**一手不差**，由黄金样本测试守护（§5）。
- **默认最小棋盘**（2026-10-26）：新玩家默认用各棋种快捷尺寸里最小的那个（围棋 9、五子棋 7、黑白棋 6），因为棋盘越小越能体现边连起来的感觉。只是页面的默认（`defaultBoardSide`，`src/ui/gameUi.js`），浏览器记住的尺寸照旧优先；引擎和房间对不带尺寸的旧请求仍用原来的默认值。
- **悔棋申请**（2026-10-26）：申请不挡棋局。计时照走（谁该下谁的钟在走，读秒照样会超时）；任何一方落子或停一手都结束申请：申请者自己落子等于撤回，对方落子等于拒绝；申请者也可以点“取消申请”。因为计时本身就限制了等待，悔棋次数不限（一次只能有一份申请）。
- **一人一身份**（2026-10-26）：一个人在一个房间里只有一个身份。对局者不能再以旁观者或新身份进入同一房间：旁观聊天对局者看不到，对局者混进旁观席就能看到。不只是页面上不出现选项，服务器也要拒绝，绕过页面直接调接口也不行。对局者打开房间（包括普通的观战链接）直接回到自己的席位。
- **账号与棋谱**（2026-10-26，详见 `docs/design/accounts-and-game-records.md` 第 9 节）：参考 OGS 把邀约、对局、棋谱分开。登录用开源库 Better Auth（账号存我们自己的 D1），支持用户名或邮箱 + 密码（用户名必填，2–20 字；邮箱选填）和 Google 一键登录；不登录就以浏览器为临时身份（游客），功能齐全，同一浏览器注册后数据自动继承。棋谱只有对局双方能看；本机对局（人机、同机双人、AI 自对弈）下完也自动存，只在下完时上传一次；双方都掉线 30 分钟的联机对局存成“中断”。免费计划下密码用两万次 PBKDF2 + 服务器密钥。会话记录保留 Better Auth 默认存的 IP 和浏览器型号（负责人 2026-10-26 决定：被攻击时有据可查；身份识别只靠会话 Cookie，不靠它们）。

## 3. 发布

```powershell
git fetch origin
git checkout -B release/x.y.z origin/main
npm.cmd run release:version -- x.y.z      # 只改 public/version.json
git commit -am "release: prepare x.y.z"
git push -u origin release/x.y.z
npm.cmd ci
npm.cmd run release:publish -- x.y.z      # 跑测试、构建、部署、打 tag、建 GitHub Release
```

- 发布前先问负责人。负责人同意后，开发会话可以在那台机器上直接执行（`npx wrangler whoami` 能看到账户）。
- 验证：`/version.json` 显示新版本；再运行 `node scripts/live-room-smoke.mjs https://topology-go.pystashell.workers.dev/`（会在线上建两个临时房间，下完一局围棋和一局五子棋）。
- 发布脚本拒绝在 `main`/`master` 上运行，要求工作区干净，且版本号与 `public/version.json` 一致。
- 部署前发布脚本会检查 Worker 密钥 `BETTER_AUTH_SECRET` 和 `PASSWORD_PEPPER` 已设置（没有就停下；Google 登录的两个密钥可选，没有就不显示那个按钮），再用 `npm run db:migrate:remote` 把 `migrations/` 里新的 D1 表结构应用到线上库 `topology-go`（只加不改，Wrangler 会跳过已应用的）。密钥只需负责人设置一次，命令见 `docs/RELEASES.md` 的 0.3.0-rc.9 一节。
- A 方案（在 GitHub 配好两个 secret 之后）：用 GitHub Actions 的 “Release candidate” 工作流 `workflow_dispatch`，参数为 `ref=release/x.y.z`、`version=x.y.z`、`confirm=RELEASE`。细节和回滚见 `docs/RELEASES.md`。每版的回滚边界也写在那里，本轮的见“0.3.0-rc.2 的兼容边界”。
- `release/0.2.0-rc.9` 已作废，可以删除。

## 4. 架构速览

```text
src/topology/            唯一的邻接/直线来源：getTopology(kind,w,h) → step/neighbors4/neighbors8/ray/line/fromCover
src/game/gameTypes.js    棋种常量、尺寸限制（五子棋 ≥11；黑白棋 6–30 偶数）、错误码
src/game/rules/          rulesFor(gameType)：go.js / gomoku.js / othello.js（能力表 capabilities 决定 UI 显示哪些控件）
src/game/goEngine.js     围棋；gomokuEngine.js + lineRuns.js + renju.js 五子棋与连珠禁手；othelloEngine.js 黑白棋
src/game/replay.js       按 gameTypeOf(base) 分派复盘
src/game/sgf.js          SGF：围棋 GM[1]，五子棋 GM[4]（RU[Freestyle|Renju]），黑白棋 GM[2]（起始四子写 AB/AW）；拓扑写在 XTOP
src/multiplayer/roomEngine.js  房间状态机：schema 2（全围棋）/3（含其他棋）双写；不公开房间、移出成员、判弃局、访客对 AI
src/multiplayer/lobby*.js 大厅摘要/筛选/预览
worker/                  Cloudflare Worker + Durable Objects（BadukRoom, BadukLobby）；roomStorage.js 负责大房间分块存储
  auth.js                身份：Better Auth（MIT）跑在 Worker 里，账号在 D1；游客（匿名插件）、用户名插件、密码、Google；
                         adoptGuest（游客并入账号）、formerUserIds（账号以前的游客编号）
  accounts.js            账号接口 /api/account*：检查输入、调用 Better Auth、换成我们自己的错误码和中文
  passwords.js           密码：HMAC(PASSWORD_PEPPER) + PBKDF2-SHA256 两万次
  http.js                JSON 进出（jsonResponse、readJsonBody），index.js 和 accounts.js 共用
  records.js             棋谱：建行、校验、保存（按 client_key 幂等，游客编号按 user_alias 认到账号）、分页列表、只给对局双方读、移除
migrations/              D1 表结构（Better Auth 的 user/session/account/verification，加 game_record、game_record_owner；0002 加 user_alias）
src/multiplayer/accountRules.js  用户名、邮箱、密码的规则，页面和 Worker 共用
src/view/                5 种视图；pointerGestures.js 管触摸策略（能上下动的棋盘接管竖向拖动，“竖滑滚动页面”可选）
src/ui/gameUi.js         各棋种的文案、结果、控件可见性（纯函数，有测试）
src/main.js              页面主文件（约 7300 行），拥有页面状态
src/app/                 从 main.js 拆出的页面部分：lobbyScreen（大厅）、chatPanel（聊天）、recordFiles（SGF 文件）、
                         roomManagement（公开开关、成员列表、判弃局）、myGames（我的棋谱：本机对局上传、列表页、打开棋谱）、
                         account（顶栏：没登录是“登录”按钮，打开登录框（Google 在最上面，然后是用户名密码、邮箱验证码）；
                         登录后是“名字 ▾”下拉菜单（我的棋谱、账号设置、退出登录，参考 OGS）；账号设置页 /settings
                         左侧分类、右侧内容：账号、邮箱（添加/验证/更换）、密码；我的棋谱上的游客提示）。
                         各自持有自己的状态，通过 main.js 末尾的导出列表读页面状态
src/ai/                  围棋：KataGo；其他棋：gameAiRegistry.js + gameAiClient.js
  gomoku/                Rapfi：flatView.js（拓扑 → ≤22 路平面视窗）、tactics.js（跨接缝必胜/必挡/VCF）、worker
  othello/               自研：射线表、PVS + 置换表、按拓扑拟合的评估、终局精确求解、worker
public/engines/rapfi/    Rapfi wasm + 权重 + COPYING + 源码包 + SOURCE.md（GPL 合规材料，勿删）
public/_headers          CSP 等安全头；只有 katagoWorker-* 和 gomokuAiWorker-* 允许 'wasm-unsafe-eval'
```

对局新功能的要点：

- **提示**：对 AI 的对局里（本地人机，或在线房间里自己对面是 AI 席位），轮到自己时“提示”按钮可用。五子棋、黑白棋用本棋种引擎的最强档想 2 秒；围棋走页面里的 KataGo worker。推荐点画在棋盘上（复用分析标记），消息里写坐标；局面一变（落子、悔棋、新局）提示就失效。代码在 `main.js` 的 `requestMoveHint` 一组函数，沙箱测试在 `test/hintUi.test.js`。
- **AI 停顿**：`src/ai/aiPacing.js`。AI 的棋至少在它的回合开始 1 秒后才落下，并且要等上一手的翻子动画播完（再加 150 毫秒）；本地、在线 AI 席位、AI 自对弈都一样。等待期间 AI 仍算“思考中”，悔棋或新局会取消它。
- **翻子动画**：`src/game/othelloFlipOrder.js` 算每颗被翻的子离新子的距离（沿真正夹住它的那条射线，跨接缝和莫比乌斯翻转都算；被两条射线夹住取近的），`src/view/flipWave.js` 管计时：新子落下 0.2 秒后第一圈开始翻，每圈相隔 0.26 秒，每颗翻 0.44 秒，很长的射线会压缩间隔，整波不超过约 3 秒。平面视图把子压扁再展开，3D 视图把子抬起绕切线翻转，过半时换颜色；描边圈随翻转出现。只有刚下的一手（或复盘前进一步）才播放，悔棋、跳步、切换视图直接显示结果，系统开了“减少动态效果”就不播。

联机新功能的要点：

- **大厅**（`/lobby`）：我的房间（本设备存过席位或观战身份的房间，含不公开的，可返回或移除本地记录，移除要点两次）、快速加入（按当前筛选挑一个等对手的房间，没有就打开建房窗口）、按房间号或棋手名搜索、四种排序、状态按钮和统计条上的计数、卡片上双方的在线点和 AI 标记、复制分享链接。纯逻辑在 `src/multiplayer/lobby.js`（`lobbyStats`、`pickQuickJoinRoom`、`myLobbyRooms`），本地会话列表是 `RoomClient.listAllStoredSessions` / `forgetStoredSessions`。
- **连接心跳**：页面连上房间后每 10 秒发 `ping`（房间用 `setWebSocketAutoResponse` 回 `pong`，不唤醒 DO）。发出的心跳 10 秒内没收到任何消息、或浏览器报告断网，页面就丢掉这条连接并按退避重连（后台标签页的定时器被推迟不算掉线），房间提示显示“网络已断开”或“连接中断，正在重新连接”。房间只在对局进行中、有成员连着时每 60 秒检查一次（每次唤醒都算免费计划的请求和写入，所以等人和下完以后不查），90 秒没心跳的成员连接按离线关闭；旧版页面不发心跳，不受影响。
- **大厅里的在线状态**：棋手上线、下线（以及观众人数、座位开放）会改变大厅显示的内容，房间这时写一次存储并推送大厅；状态没变就不写。
- **大厅只列等待和进行中**（参考 OGS）：下完的对局立刻离开大厅；等人的房间只在有棋手在（或有人能补上的空位）时列出，房主离开就离开大厅，回来再出现。进行中的对局双方都掉线也照样列出。规则在 `lobbyShowsRoom`（`src/multiplayer/lobby.js`）；大厅对象把不显示的快照和不公开房间一样当作带版本的删除（返回 `removed: "hidden"`），旧版本存下的已结束房间在第一次读取时清掉。房间本身另按下面的规则自动关闭。
- **房间自动关闭**（第 3 阶段，负责人 2026-10-26 决定，`docs/design/accounts-and-game-records.md` 第 5 节）：只看棋手，旁观者不算。棋手都不在时，从最后一位离开算起：房主一人等人 2 分钟、两局之间或下完以后 5 分钟、正在下的棋 30 分钟（先按“中断”存进双方棋谱，不计胜负）。引擎里是 `playersGone` / `close` / `interruptedRoundRecord`，常量 `HOST_GONE_CLOSE_MS`、`PLAYERS_GONE_CLOSE_MS`、`ROUND_ABANDONED_CLOSE_MS`；“棋手都不在”的起点是引擎实例上的 `playersGoneSince`（`syncPlayersGone` 在连接、断开、提交和 `advance` 时更新；棋手发命令也算在场），房间对象把它存在状态旁边（`RoomEngine.restore` 再取出来，状态本身的格式不变，金样测试照旧），只在“有人→没人”“没人→有人”时写一次存储；部署会断开所有连接，重启后的房间从重启时刻开始算，绝不提前关，没人回来时第一次闹钟再存下来。关闭时间算进 `nextDueAt`，由闹钟触发。房间对象 `retireRoom(reason)` 告诉还连着的页面原因（`ROOM_EXPIRED`，4404）后删掉存储和大厅条目；已关闭房间的 WebSocket 请求也会被接受后以 4404 关闭，页面不会一直重连。页面：4404 时停在最后看到的局面进入回看（`showClosedRoom`，`src/app/myGames.js`）；在这个房间下过棋的人打开链接直接跳到自己在里面的最后一盘（`GET /api/records?room=房间号`）。房主一人等人时房间提示里写着“离开超过 2 分钟房间会关闭”。旁观者不再延长 24 小时兜底。
- **一人一身份**：房间认人靠会话账号（游客或以后的注册用户）。HTTP 加入时 Worker 把账号传给房间；WebSocket 连接时 Worker 查会话，把账号放进内部请求头 `X-Topology-Session-User`（先删掉客户端发来的同名头，客户端冒充不了）。房间引擎：`join` 发现同一个人已有身份，就把那个身份还给他（`rejoin`，应答带 `rejoined: true`，不管请求的是棋手还是旁观），新浏览器的令牌记进 `deviceTokenHashes`（最多 4 个），不会多出第二个身份（旁观者要上座用房间里的“申请对手席位”）；`checkSessionUser` 在每次连接时给还没记账号的成员补上，对局者的浏览器连旁观身份时删掉那个旁观身份，先接受连接、发错误、再以 4401 关闭（页面删掉这个身份、不再重连，并自动回到自己的席位）。页面：有席位的浏览器打开房间直接恢复席位（`roomClient.storedSeat`），进房对话框里不再给“进入观战”“以新身份进入”，大厅卡片对自己在的房间只显示“返回房间”。“同一个人”是会话账号，加上账号以前的游客编号（Worker 查 `user_alias`，随加入请求的 `formerUserIds` 和连接的内部请求头 `X-Topology-Session-Former-Users` 传给房间，房间把这样的席位改记到账号）。限制：没登录的人换浏览器、开无痕窗口或清了 Cookie，服务器认不出来；登录同一账号就在任何设备都算一个人。
- **不公开房间**：建房时勾选，或房主在“房间管理”里切换。只有不公开的房间才存 `listed: false`。房间照常推送带版本号的快照，大厅把 `listed: false` 当作带版本的删除处理，所以迟到的旧快照不会把房间放回大厅。
- **移出成员**：房主可以随时移出观众；白方只能在两局之间移出，对局中移出等于替对方决定胜负。被移出的连接收到 `REMOVED_FROM_ROOM`，以 4401 关闭，所有版本的页面都会停止重连。
- **判对方弃局**：对方离线满 2 分钟（或已离开）后，按对方认输结束本局，点目阶段同样可用。离线时间不写存储，记在其他仍然连着的 WebSocket attachment 上，所以休眠后照样能恢复；对象彻底重启后会从重启时刻重新计时。
- **点目超时自动确认**（负责人 2026-10-25 决定）：点目阶段 2 分钟内没有双方确认，就按当前死子标记结束本局。每次修改标记都重新计 2 分钟，但从进入点目起最多 10 分钟，防止靠反复改标记拖延。截止时间存在房间状态里，由 Durable Object 闹钟触发；页面显示倒计时。
- **访客执白对 AI**：`request_game` 带 `mode: "human-ai"` 和 `aiOpponent: "guest"`，走和好友对局一样的邀请流程。AI 执黑，在房主浏览器里运行。座位锁定规则同好友对局，访客悔棋会撤回自己和 AI 各一手，谁离开谁判负。
- **大房间分块存储**：房间超过 1.5 MiB 时，`room` 下存清单，`room:chunk:N` 存分段，一次原子写入。

账号与棋谱（第 1、2 阶段，`docs/design/accounts-and-game-records.md`）：

- **游客**：浏览器第一次以棋手身份建房或加入房间、或上传一盘下完的棋时，Worker 用 Better Auth 的匿名插件建一个游客，回一个 HttpOnly 的会话 Cookie（`topology-go.session_token`，HTTPS 上带 `__Secure-` 前缀，有效 400 天，每天使用会续期；签名的会话副本 Cookie 让大多数请求不用读库）。观战不建游客。身份是可选的基础设施：没有 D1、没有密钥或数据库出错时，房间照常工作，只是不存棋谱。
- **房间记住席位是谁**：Worker 把用户编号随 `/internal/init`、`/internal/join` 传给房间，存在成员记录的 `userId` 上（不出现在任何发给页面的快照里）；同一浏览器重新加入时更新。
- **联机对局的棋谱**：房间每次持久化后看本局是否刚结束（`RoomEngine#finishedRoundRecord`），结束就在 `waitUntil` 里写 D1（`worker/records.js` 的 `onlineRoundRecord` + `saveRecord`），按 `room:<房间码>:<房间实例>:<局号>` 幂等，失败下次持久化再试。双方各得一份归属；对 AI 的只给人；AI 自对弈给运行 AI 的人。
- **本机对局的棋谱**：`updateUI` 每次调用 `maybeSaveFinishedLocalGame`，对局一结束就把复盘数据 POST 到 `/api/records`（每盘一个 `local:<UUID>` 键，离线快照里也带着）；网络或服务器错误时存进 localStorage（最多 10 盘），下次打开页面或棋谱列表再传。
- **接口**：`GET /api/records?game=&before=`（分页，游标是“结束时间.编号”，应答带 `account`：游客还是账号、名字），`POST /api/records`，`GET|DELETE /api/records/编号`（只有归属者；别人 403）。各有限流绑定（`AUTH_RATE_LIMITER`、`RECORD_RATE_LIMITER`）。
- **账号**：`GET /api/account`（当前用户、可用的登录方式、绑定的 Google 账号），`POST /api/account/register`（用户名 2–20 字、密码 8–128 字符；不收邮箱，存一个 `.invalid` 的假地址，从不显示）、`/sign-in`（用户名或验证过的邮箱）、`/sign-out`、`/google`（返回 Google 登录页地址）、`/email-code` 和 `/email-sign-in`（邮箱验证码登录）、`/password`、`/email` 和 `/email/confirm`（绑定、更换邮箱）、`/username`、`/google/link` 和 `/google/unlink`、`/delete`（删除账号，见设计文档 3.7 节）。猜密码、验证码或发邮件的路由另有 `SIGN_IN_RATE_LIMITER`（每 IP 每分钟 10 次）。Better Auth 自己的路由只放行 `/api/auth/get-session` 和 Google 的回调 `/api/auth/callback/google`，其余 404。游客注册或登录时 `adoptGuest` 把棋谱转到账号、写 `user_alias`、删游客（一次批量写入）。Google 账号只按验证过的邮箱自动并进账号，或者登录后在设置里手动绑定。
- **邮箱验证码**（`worker/email.js`，负责人 2026-10-27 决定：发邮件不花钱，只用 Resend 免费套餐）：`POST /api/account/email-code`、`/email-sign-in`（验证码登录，只限已注册的邮箱）、`/password`（登录后设新密码：刚登录 10 分钟内不要旧密码，之后要；改完退出其他设备）、`/email`、`/email/confirm`（添加、验证、更换邮箱）。用 Better Auth 的 email-OTP 插件（6 位、10 分钟、5 次、只存哈希）。Better Auth 发信时会吞掉错误，所以路由先查上限（`checkCodeAllowed`：同一邮箱每分钟 1 封、每小时 5 封，全站每天 `EMAIL_DAILY_LIMIT`，默认 80；记录在 D1 表 `email_send`），再用 `collectingCodes` 拿到 Better Auth 生成的验证码，自己发（`sendCodeEmail`，Resend API）；超限返回 429 和 `retryAfter`。没有 `RESEND_API_KEY` 和 `EMAIL_FROM` 时整个功能关闭；本地开发（`EMAIL_DEV_OUTBOX=1`）不发信，验证码留在内存里，`GET /api/dev/outbox?to=` 可读（浏览器检查用）。
- **页面**（`src/app/account.js`）：顶栏按钮显示“登录”或“账号名 ▾”（名字存在 localStorage 只为先显示，真实状态问服务器）；没登录时打开登录框（Google 按钮在最上面，下面是登录、注册两页和“用邮箱验证码登录”），登录后打开下拉菜单（我的棋谱、账号设置、退出登录）；账号设置是单独的页面 `/settings`（`#email`、`#password` 直接打开对应栏目），用验证码登录后直接跳到 `/settings#password`。退出时先把没传完的本机棋谱传掉，再清掉这个浏览器的房间身份，回到 `/single`。从 Google 回来时地址带 `?signed-in=google` 或 `?sign-in-failed=google`，页面读完就去掉。
- **本地开发**：`npm run dev` 会先 `npm run db:migrate:local`，并给 `wrangler dev` 一个仅供本地的密钥。单元测试用 `test/helpers/d1.js`（node:sqlite 上的 D1 替身，自动套用 `migrations/`）。

设计文档在 `docs/design/`，其中的行号是当时的快照，以现有代码为准。产品规格见 `docs/PRODUCT_REQUIREMENTS.md`（正文以围棋为主）。

## 5. 开发规则与验证

提交前要跑与 CI 相同的检查：

```bash
npm ci
npm test
npm run test:soak
npm run test:coverage
npm run build
npx wrangler deploy --dry-run --strict
npm audit --audit-level=moderate
```

- **规则跑量测试**：`test/soak.*.test.js`（三种棋 × 三种拓扑）拿独立参考实现（`test/helpers/` 里的 goReference、renjuReference、othelloSoak，不共用引擎代码）逐手核对随机对局。`npm test` 跑快速档（小棋盘各 100 盘），`npm run test:soak`（SOAK=full）跑全量档：每种棋每个尺寸每种拓扑至少 10 盘，小棋盘各 100 盘，约 6,000 盘、80 万手。每个套件结束时还会断言边界情况真的出现过（禁全同长循环、打劫、跨接缝提子、死子、和棋；长连、四四、三三、下满和棋、最后一手成五；跳过、连续跳过、有空位终局、吃光）。CI 的 soak 任务和发布前检查都会跑全量档。
- **覆盖率门槛**：`npm run test:coverage` 统计规则代码（src/game、src/topology 和翻子动画、AI 停顿）的覆盖率，低于行 95% / 分支 90% / 函数 95% 就失败；CI 用它代替 `npm test`。
- **测出的 bug 要写成测试**：随机对局里找到的局面（例如 3×3 圆柱上的长循环禁全同、黑方只剩禁手点的和棋）固定在 `test/goEdgeCases.test.js`、`test/gomokuEdgeCases.test.js`、`test/othelloScenarios.test.js`。

- **围棋不能变**：`test/goGoldenMaster.test.js` 守护。邻居顺序是持久化行为，决定提子顺序和存档校验，不能改。需要核对时运行 `node scripts/generate-go-golden.mjs --check`。
- **页面函数名不能改**：UI 接线测试按函数名在 `src/main.js` 和 `src/app/*.js` 里查找（`test/helpers/appSource.js`），例如 `hydratePublicGame`、`applyOnlineRoom`、`enterReplay`、`enterNextGameSetup`、`startConfiguredNextGame`、`startImmediateRematch`。
- **继续拆 main.js 的规则**：把一个变量和所有给它赋值的函数一起搬走；`main.js` 里需要改它的地方换成调用新模块的小函数（例如 `clearChatReference()`）。新模块的顶层初始化不能读 `main.js` 的绑定，因为循环导入时 `main.js` 还没执行。
- **i18n**：中文原文就是查找键。`test/i18nCoverage.test.js`（扫描 main.js 和 src/app）和 `test/serverErrors.test.js` 会拦截未翻译的文案和未登记的服务端错误码。
- **CSP**：不要写内联脚本或内联样式。新的需要 wasm 的 worker 必须在 `public/_headers` 里单独授权。
- **Windows**：仓库按 `core.autocrlf=true` 检出为 CRLF。读源码做多行匹配的测试要先把 `\r\n` 换成 `\n`（`appSource()` 已经这样处理）。
- **测试开关**：重测试用环境变量打开：`GOMOKU_AI_HEAVY=1`、`OTHELLO_AI_FULL=1`、`OTHELLO_AI_PERF=1`。
- **本地联机**：`npm run dev`（先构建，再起 wrangler dev，端口 8787）。冒烟测试：`node scripts/live-room-smoke.mjs http://127.0.0.1:8787/`、`node scripts/live-scoring-smoke.mjs http://127.0.0.1:8787/`。
- **浏览器检查**：`scripts/browser-checks/`，需要单独装 Playwright（见该目录 README）。改 UI 或房间逻辑时跑相关脚本：`csp`、`go`、`local`、`online`、`sgf`、`rooms`、`webkit`（iPhone 13 配置的 WebKit）。本轮拆分 main.js 后，这 7 个脚本全部跑过。
- **重建 Rapfi**：需要 emsdk，运行 `scripts/build-rapfi.sh`。产物逐字节可复现，版本信息见 `public/engines/rapfi/SOURCE.md`。

## 6. 上一版待办的处理结果与剩余问题

上一版交接文档的 10 项待办处理如下：

| # | 待办 | 结果 |
| --- | --- | --- |
| 1 | 上线 | `0.3.0-rc.1` 已上线（2026-10-24），线上冒烟全过。顺带修了一个只在 Windows 上失败的测试（CRLF） |
| 2 | 改名 | 已统一为 Topology Go，见 §2；分享预览图已重画 |
| 3 | 访客与 AI 对局 | 已完成：在线对局方式“访客执白对 AI” |
| 4 | 黑白棋 8×8 环面执黑偏弱 | **未解决，是结构性问题**，见下 |
| 5 | Rapfi 网络尺寸覆盖 | **改不了**，见下 |
| 6 | 五子棋/黑白棋 SGF、邀请副标题、尺寸记忆 | SGF 已完成（GM[4]/GM[2]）。三种棋都有 AI 了，副标题“选择 AI、好友……”已经准确，不用改。尺寸记忆改成存 localStorage |
| 7 | 不公开房间、踢人、点目超时与弃局、超长对局存储 | 全部完成，见 §4 |
| 8 | 手机竖滑 | rc.2 曾让竖滑默认滚动页面，负责人反馈上下拖棋盘不便、常滑不动，rc.4 改回：能上下动的棋盘（平面甜甜圈、所有立体视图，立体竹筒可以俯仰）默认接管所有方向的拖动，页面从棋盘外滚动；只能左右动的视图（弧面、平面竹筒和莫比乌斯）竖滑仍滚动页面。工具栏“竖滑滚动页面”可选（每台设备记住）。`scripts/browser-checks/touch.mjs` 用真实触摸输入验证 |
| 9 | iOS/Safari | 用 iPhone 13 配置的 WebKit 跑过：加载、点按落子、Rapfi wasm（SIMD）、黑白棋 AI、WebGL、触摸策略都正常。**真机仍未测** |
| 10 | 拆分 main.js | 第一阶段完成：拆出 4 个模块（约 1300 行），main.js 从 8274 行降到约 7300 行。后续见下 |

剩余问题（按优先级大致排列）：

0. **账号与棋谱的后续阶段**（`docs/design/accounts-and-game-records.md` 第 7 节）：第 2 阶段已完成（rc.12），Google 登录已开启。第 3 阶段已完成（rc.13）。邮箱验证码登录（代替找回密码）在 rc.14（Resend 免费套餐，已开启），账号菜单和设置页在 rc.15，邮箱只认验证过的、改用户名、“登录方式”（解绑和手动绑定 Google）在 rc.16，删除账号在 rc.17。以后、按账号列出“我的房间”（现在只列本浏览器存的身份）、付费计划下提高密码哈希次数（存的格式带次数，可以在登录时重算）。
1. **GitHub 发布 secret**：配好 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 后，发布就不必依赖负责人的电脑（A 方案）。这需要负责人在 Cloudflare 创建 token。
2. **iOS 真机**：WebKit 模拟不能代替真机，至少应在一台 iPhone 上试一次触摸手势、对话框和下拉框。WebKit 会把 `<select>` 内部的样式算到页面 CSP 头上（`style-src-attr`），不影响功能；检查脚本已单独忽略这一种。
3. **黑白棋 8×8 环面执黑**：困难级（每步 50 ms）对随机对手 100 局，执黑 64 胜 28 负 8 和。棋盘完全对称时通常是白方最后落子，黑方只能靠逼出奇数次停着翻盘。权重调参试过：固定深度 3、配对种子各 600 局，基线 80.2%，调奇偶、子数、稀缺度等单项都没有更好（76–78.5%）。要提升，得在中盘做更深的精确求解，或者换成结合评估的 MCTS，属于引擎层面的工作。实验脚本：`scripts/othello-weight-experiments.mjs`。
4. **Rapfi 网络覆盖**：网络只覆盖平面 13–22 路（自由五子）和 15 路（连珠）。Rapfi 不支持矩形棋盘，也没有“墙”格子；`YXBLOCK` 只是不让根节点选那些点，搜索里仍把它们当空格。所以没法把小棋盘嵌进 13 路、或者把连珠大棋盘截成 15 路视窗来套用网络。要解决只能改 Rapfi 本体并重新编译，或者训练新网络。
5. **继续拆分 main.js**：剩下的大块（AI worker、复盘/分析 worker、联机房间同步、视图管理）共享的状态较多，例如 `applyOnlineRoom` 会改很多变量。建议按 §5 的规则一次搬一块，每块都跑一遍浏览器检查。

## 7. 本地新会话建议的第一步

1. `git checkout main && git pull && npm ci && npm test`：确认全过。
2. 读本文件、`CLAUDE.md` 和 `docs/RELEASES.md`。
3. 问负责人有没有对 `0.3.0-rc.2` 的反馈，从反馈开始；没有的话，从 §6 的剩余问题里挑。
