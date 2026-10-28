# Topology Go 发布与回滚

本项目把一次发布绑定为四个可核对的标识：

1. `public/version.json` 中的 SemVer，例如 `0.2.0-rc.4`；
2. 指向唯一 Git commit 的 Git tag，例如 `v0.2.0-rc.4`；
3. Cloudflare Worker Version ID（不可变，是回滚目标）；
4. Cloudflare Deployment ID（记录某次生产流量切换）。

GitHub Release 正文会记录 commit、来源分支和两个 Cloudflare ID。预发布 SemVer（包含 `-rc.1`、`-beta.1` 等）会自动创建为 GitHub prerelease。

## 安全约束

- `release:version`、`release:plan`、`release:check`、`release:publish` 均拒绝 `main`、`master` 和 detached HEAD。
- `release:publish` 要求工作区完全干净，且 `public/version.json` 必须与命令参数一致。
- 已存在但指向其他 commit 的本地或远程 tag 会导致失败；脚本从不强推或改写 tag。
- 发布前固定运行 `npm test`、`npm run build` 和 `npm run deploy -- --dry-run --strict`。
- 生产发布复用现有 `npm run deploy`，同时写入 Wrangler `--tag` 和 `--message`。
- Wrangler message 包含完整 Git commit；重试只复用 tag 与 commit message 同时匹配的 Worker Version。
- 回滚是应急操作，可以在任意分支运行，但必须显式提供 `--yes`。
- 脚本使用参数数组启动进程，不把版本号拼进 shell；版本号必须通过严格 SemVer 校验。
- GitHub 的 `production` Environment 必须启用 Required reviewers，并把可部署分支限制为受信任的发布分支；否则不要把 Cloudflare production secret 交给功能分支工作流。

要求 Node.js 22 或更高版本。Windows 下使用 PowerShell 与 `npm.cmd`；脚本会自动选择 `.cmd` 可执行文件，并为 Node/Cloudflare 子进程启用系统 CA。

## 本轮候选版本

`public/version.json` 是候选版本清单（版本号随发布分支更新）；正式发布后，tag、Worker Version、Deployment 与 GitHub prerelease 会共同组成可审计记录。已发布：`0.3.0-rc.1`（2026-10-24，多棋种首次上线）。

### 0.3.0-rc.18 的兼容边界

- **用 Google 新建的账号自动得到不重名的用户名**（负责人 2026-10-28 决定）：从 Google 名字生成（去掉空格等不允许的字符，被占了加数字），以后可以在账号设置里改；新账号从 Google 回来时提示一次用户名。以前用 Google 建的、没有用户名的账号，下次打开网站时（`GET /api/account`）自动补上。没有数据迁移；回滚后新建的 Google 账号又没有用户名，已经补上的保留。

### 0.3.0-rc.17 的兼容边界

- **删除账号**（负责人 2026-10-28 要求）：账号设置“账号”栏最下面可以删除自己的账号，输入用户名确认；登录超过 10 分钟要输当前密码，没有密码的账号要先退出再重新登录。删掉账号的密码和绑定的 Google、邮箱、所有登录、游客别名和只属于它的棋谱；和别人下的棋，对方那份保留。别的设备上登录着的同一账号最多 5 分钟后退出（会话缓存）。没有数据迁移；回滚只是看不到删除按钮，已删的账号不会回来。
- **登录方式**栏去掉了“下面每一种方式都能登录这个账号，至少要保留一种”这句说明（负责人决定），只列密码、邮箱验证码和 Google 账号。

### 0.3.0-rc.16 的兼容边界

- **邮箱只认验证过的**（负责人 2026-10-28 决定）：注册只要用户名和密码，不再收邮箱；邮箱只能在账号设置里收验证码绑定，Google 的邮箱本来就是验证过的。只有验证过的邮箱能用来登录、收验证码。
- **数据迁移** `migrations/0004_confirmed_emails_only.sql`：以前注册时填了但没验证过的邮箱被解除（换成不显示的假地址）。这些账号照常用用户名和密码登录，想用邮箱就在设置里重新绑定。迁移不可逆，但只动“没验证”的邮箱。
- **账号设置**：“账号”里可以改用户名（2–20 字，不能重名；已下完的棋保留当时的名字）；新栏目“登录方式”列出密码、邮箱验证码和每个绑定的 Google 账号（显示 Gmail 地址），Google 账号可以解绑（至少保留一种登录方式），也可以在登录状态下绑定任意 Google 账号（`allowDifferentEmails`）。
- **回滚**：回到 rc.15 后注册框又出现邮箱选填；已经解除的邮箱不会回来。

### 0.3.0-rc.15 的兼容边界

- **账号界面**（参考 OGS）：顶栏登录后是“名字 ▾”下拉菜单（我的棋谱、账号设置、退出登录）；账号设置是单独的页面 `/settings`（账号、邮箱、密码）；登录框里 Google 在最上面；用验证码登录后直接到 `/settings#password`。只改页面，没有数据变化；回滚只是界面回到旧的弹窗。

### 0.3.0-rc.14 的兼容边界

- **邮箱验证码登录**（代替找回密码）：登录框里“忘了密码？用邮箱验证码登录”，账号面板里添加、验证、更换邮箱和设置新密码（刚登录 10 分钟内不要旧密码）。新增 D1 表 `email_send`（`migrations/0003_email_sends.sql`，发布脚本在部署前应用）。
- **可选密钥**：`RESEND_API_KEY`、`EMAIL_FROM`（步骤见 `docs/email-codes.md`），设好之前验证码入口不显示；可选变量 `EMAIL_DAILY_LIMIT`（全站每天上限，默认 80）。发布脚本不要求它们。
- **账号接口**：`GET /api/account` 的账号多了 `emailVerified`、`hasPassword`、`freshUntil`，`signIn` 多了 `emailCodes`。
- **回滚**：回到 rc.13 后验证码入口消失，已验证的邮箱、已改的密码都保留；`email_send` 留在 D1 里无害。

### 0.3.0-rc.13 的兼容边界

- **房间自动关闭**（账号与棋谱第 3 阶段）：棋手都不在时，房主一人等人 2 分钟、两局之间或下完以后 5 分钟、正在下的棋 30 分钟后房间关闭；正在下的棋先按“中断”存进双方棋谱（不计胜负）。旁观者不再让房间续期。关闭时还连着的旁观者页面停在终局可以回看；之后打开房间链接，下过棋的人跳到自己在里面的最后一盘，其他人看到“房间已经关闭”。
- **部署后**：已有的房间在下一次被唤醒时（有人打开它，或它原来的闹钟到期）按新规则计算；棋手早已离开的会马上关闭（之前下完的棋早已存进棋谱）。
- **房间状态**：房间存储里多了可选的 `playersGoneSince`（棋手都不在的起点，在状态旁边）和 `closedReason`；只在房间“有人→没人”“没人→有人”时多写一次存储。部署断开所有连接后，房间从重启时刻重新计时，不会提前关闭。旧版本读取时忽略这两个字段。
- **旧页面**：rc.12 及以前的页面遇到关闭的房间会回到单人模式并显示“房间已因长时间无活动而关闭”，不会停在终局回看；刷新即可。
- **回滚**：回到 rc.12 后房间又按 24 小时规则保留；已经关闭的房间不会回来（它们的棋谱都在“我的棋谱”里）。

### 0.3.0-rc.12 的兼容边界

- **注册登录**（账号与棋谱第 2 阶段）：用户名（2–20 字）+ 密码注册，邮箱选填；用用户名或邮箱登录；退出登录。游客注册或登录后，这个浏览器的棋谱和房间席位跟到账号下。登录同一账号的另一台设备打开房间链接，回到原来的席位或旁观身份。新增 D1 表 `user_alias`（`migrations/0002_guest_aliases.sql`，发布脚本在部署前应用）、限流绑定 `SIGN_IN_RATE_LIMITER`（命名空间 71007）。
- **新的必需密钥 `PASSWORD_PEPPER`**：第一次发布前设置一次（随机生成、直接交给 Wrangler，不显示也不进仓库）。**设置后永远不能更换**，否则所有密码都对不上。发布脚本会检查它：

  ```powershell
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put PASSWORD_PEPPER
  ```

- **Google 登录**：代码已就绪，没有 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 时不显示按钮。负责人的设置步骤见 `docs/google-sign-in.md`。
- **加入房间的行为变化**：同一个人再次加入（另一个浏览器，或清了房间数据）时，房间不再拒绝（rc.10 的 `ALREADY_PLAYING_HERE`、`ALREADY_WATCHING_HERE`），而是把原来的身份还给他（应答带 `rejoined: true`）。rc.11 及以前的页面收到这种应答会提示“服务器返回的加入身份与请求不一致”，刷新即可。房间成员多了可选的 `deviceTokenHashes`（最多 4 个）。
- **Better Auth 的路由**：只放行 `/api/auth/get-session` 和 `/api/auth/callback/google`，其余（包括匿名登录、注册等）返回 404；页面只用 `/api/account*`。
- **回滚**：回到 rc.11 后，注册、登录接口消失，已注册的账号暂时不能再登录（已登录的会话 Cookie 仍有效），重新部署后恢复；已转到账号的棋谱不受影响。rc.11 读含 `deviceTokenHashes` 的房间时忽略这个字段，只有每个身份最初那个浏览器还能回去。`user_alias` 留在 D1 里无害，不需要回滚表结构。

### 0.3.0-rc.11 的兼容边界

- **修复默认围棋棋盘**：rc.10 里页面启动时还有一处写死的 19×19，全新的浏览器打开围棋仍是 19×19（五子棋、黑白棋已经是 7×7、6×6）。现在三种棋都默认最小快捷尺寸。回归测试：`test/defaultBoards.test.js`，浏览器检查 `scripts/browser-checks/defaults.mjs`。
- **回滚**：回到 rc.10 只是围棋默认又变回 19×19，没有数据变化。

### 0.3.0-rc.10 的兼容边界

- **一人一身份**：同一个人（同一个浏览器会话）在一个房间里只能有一个身份。对局者再以旁观者或新身份加入会被拒绝（`ALREADY_PLAYING_HERE`），旁观者用新身份加入也会被拒绝（`ALREADY_WATCHING_HERE`，上座请在房间里申请对手席位）。WebSocket 连接时房间补记成员的账号；对局者的浏览器连旁观身份时，房间删掉那个旁观身份并以 4401 关闭（旧页面也会停止重连）。
- **旧数据**：以前同一浏览器既有席位又有旁观身份的，旁观身份在下次连接时被删除；席位不受影响。
- **旧页面**：rc.9 及以前的页面被拒绝时只显示通用错误文案；刷新即可。
- **悔棋申请不挡棋局**：申请者自己落子或停一手会自动撤回申请（以前会被拒绝，要求先取消）；对方落子照旧视为拒绝。计时一直照走，次数不限。旧页面里申请者的落子按钮在申请期间仍是灰的，刷新后正常。
- **默认最小棋盘**：页面默认的新棋盘改为围棋 9×9、五子棋 7×7、黑白棋 6×6；已记住尺寸的浏览器不变。
- **回滚**：回到 rc.9 后一人一身份的规则消失（又能同时旁观），申请者落子又会被拒绝，默认棋盘回到 19/15/8；房间数据不受影响。

### 0.3.0-rc.9 的兼容边界

- **游客身份和“我的棋谱”**（账号与棋谱第 1 阶段）：新增 D1 数据库 `topology-go`（`migrations/0001_accounts_and_records.sql`）、Worker 密钥 `BETTER_AUTH_SECRET`、两个限流绑定、`nodejs_compat` 兼容标志。以棋手身份建房或加入、或本机对局下完时，浏览器成为游客（HttpOnly 会话 Cookie）；每盘下完的棋存进双方的“我的棋谱”（`/records`），`/game/编号` 只有对局双方能打开。
- **第一次发布前，负责人在项目目录里设置一次密钥**（生成一串随机字符直接交给 Wrangler，不会显示出来，也不进仓库）：

  ```powershell
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put BETTER_AUTH_SECRET
  ```

  之后发布脚本会先检查这个密钥，再运行 `npm run db:migrate:remote` 建表，然后部署。密钥一旦设置就不要更换：换了以后所有游客的会话失效（他们的棋谱就找不回来了）。
- **房间状态**：成员记录多了可选的 `userId`。旧房间照常读取；回滚到 rc.8 时，旧代码也能读含 `userId` 的房间（多出的字段被忽略），只是不再存棋谱。
- **回滚**：回到 rc.8 后，“我的棋谱”页面和接口消失，已存的棋谱留在 D1 里，重新部署后原样可见；游客的 Cookie 在回滚期间不会被清除。D1 表结构不需要回滚。

### 0.3.0-rc.8 的兼容边界

- **大厅只列等待和进行中的对局**（参考 OGS）：下完的对局立刻离开大厅；等人的房间只在有棋手在时列出（房主离开就不列，回来再列）。“已结束”状态按钮去掉了。房间本身不变，棋手仍可用链接或“我的房间”回去。
- **旧数据**：rc.7 及以前存在大厅里的已结束房间，在新版本第一次读取大厅时清掉（记下水位线，迟到的旧快照不会把它们放回来）。
- **回滚**：回到 rc.7 后，被清掉的已结束房间不会自己回来（房间下一次变化时才重新推送）；新结束的对局又会留在大厅直到过期。数据不受影响。

### 0.3.0-rc.7 的兼容边界

- **省免费额度**：房间的掉线检查只在对局进行中运行，间隔从 30 秒放宽到 60 秒（90 秒没心跳才判离线，不变）。等人、下完以后不再定时唤醒房间；每次唤醒都算一次请求和一次闹钟写入，免费计划按天计数。页面每 10 秒的心跳照旧由自动回复处理，不计入。
- **线上冒烟测试建不公开房间**：`scripts/live-room-smoke.mjs` 和 `scripts/live-scoring-smoke.mjs` 建房时带 `listed: false`，不再出现在大厅。
- **回滚**：回到 rc.6 后，有成员连着的房间又会每 30 秒检查一次；数据不受影响。

### 0.3.0-rc.6 的兼容边界

- **棋盘尺寸 3–30**：新开局可选范围改为围棋 3–30、五子棋 5–30（要能连成五）、黑白棋 4–30 的偶数（开局 4 子居中）。五子棋快捷尺寸改为 7、11、15。大厅尺寸筛选加了 6、7、10。
- **连珠在小棋盘上**：不足 11 格且首尾相接的线（窄圆柱的行、矮环面的列、小环面的斜线、莫比乌斯的行）按环判断禁手，定义不变；11 格以上的线照旧。
- **回滚**：旧版本只接受五子棋 11 路以上、黑白棋 6 路以上。回滚后，存有更小五子棋或黑白棋棋盘的房间会恢复失败（`ROOM_RESTORE_FAILED`，存储保留），重新部署后原样恢复；围棋房间不受影响（引擎一直接受 3 路）。

### 0.3.0-rc.5 的兼容边界

- 只改了页面里给读屏软件的棋盘标签（按当前棋种和形状命名），存档、协议和规则都没变，可以直接回滚到 0.3.0-rc.4。

### 0.3.0-rc.4 的兼容边界

- **连接心跳**：新页面连上房间后每 10 秒发一条纯文本 `ping`，房间用 `setWebSocketAutoResponse` 自动回 `pong`，不唤醒对象、不写存储。旧页面不发心跳，行为不变。新页面连到旧服务器时也一样收到 `pong`（自动回复早已注册），所以新旧混用都安全。
- **静默连接回收**：有成员连着时，房间每 30 秒用闹钟检查一次心跳时间（`getWebSocketAutoResponseTimestamp`），90 秒没心跳的成员连接以 4000 关闭并按离线处理（后台标签页的定时器会被浏览器压到约一分钟一次，所以留了余量）。从没发过心跳的连接（旧页面）不检查。回滚后房间不再主动回收，静默断线又会等到传输层超时才显示离线，数据不受影响。
- **大厅在线状态**：棋手上线、下线等改变大厅显示内容的事件现在会写一次房间存储并推送大厅（以前只有观众和开放座位会）。存档格式没变，旧版本照常读取。
- **规则不变**：围棋、五子棋、黑白棋的引擎没有改动（黄金样本测试照旧通过）；黑白棋的翻子距离、提示和 AI 停顿都只在页面里。

### 0.3.0-rc.3 的兼容边界

- **点目超时自动确认**：围棋进入点目后，房间存 `scoringDeadline`（`scoringRevision`、`startedAt`、`at`）。每次修改死子标记都重新计 2 分钟，但从进入点目起最多 10 分钟；到时仍未双方确认，就按当前标记结束本局，结束事件写入复盘。不在点目的房间不写这个字段。旧版本会忽略它，所以回滚后点目不会再自动结束，但房间照常可以读取。

### 0.3.0-rc.2 的兼容边界

- **大房间分块存储**：房间快照不超过 1.5 MiB 时仍是 `room` 下的一个值，与旧版本逐字节一致。更大的房间（30×30 上一千多手的长局）在 `room` 存清单、在 `room:chunk:N` 存分段 JSON，一次原子写入（`worker/roomStorage.js`）。回滚到没有分块存储的版本时，这类房间按未知状态处理：停止服务（`ROOM_RESTORE_FAILED`）并保留存储，重新部署后原样恢复；其他房间不受影响。
- **不公开房间**：只有不公开的房间存 `listed: false`，公开房间不写新字段。旧版本会忽略这个字段，回滚后这些房间会重新出现在大厅里。
- **访客执白对 AI**：邀请以 `mode: "human-ai"` 存储，黑方是由房主操作的 AI，白方是访客。旧版本只接受好友邀请，因此回滚时仍在等待回应的这类邀请会让房间恢复失败（`ROOM_RESTORE_FAILED`，存储保留）；已经开始的对局能正常读取。
- **新的房间动作**：`set_listed`、`remove_member`、`claim_abandonment` 只由新页面发送。旧服务器会以 `INVALID_COMMAND` 拒绝，房间状态不变。
- **判对方弃局**：离线时间不写存储，而是记在其他仍然连着的 WebSocket attachment 上，休眠后照样能恢复；对象彻底重启后从重启时刻重新计时（只会更晚，不会更早允许判弃局）。被移出的成员收到 `REMOVED_FROM_ROOM`，连接以 4401 关闭，所有版本的页面都会停止重连。

### 0.2.0-rc.9 的联机兼容边界

- 点目确认必须携带当前 `scoringToken`。旧页面没有这个字段时会收到 `STALE_SCORING`；玩家应刷新页面、重新检查死子后再确认。
- 旧存档仍可恢复，但没有版本绑定的历史点目确认会清空，避免把旧确认计入新方案。未知 schema 或恢复异常会保留原始存储并停止该房间服务，不会自动删档。
- 对进行中的点目房间，不应直接回滚到不校验 token 的版本。应先准备包含这项保护的回滚版本，再核对恢复后的双方确认状态。
- 合并前验证可在本地运行；正式发布仍须核对 `topology-go` 的实际 Worker Version、Deployment 和 `/version.json`，并在预发布环境验证新旧页面共存及发布切换时的断线恢复。

### 多棋类房间（五子棋、黑白棋）的兼容与回滚

- 房间存档按内容双写版本：只下过围棋的房间（当前对局、待回应邀请和全部对局存档都是围棋）继续写 `schemaVersion: 2`，内容与旧版本逐字节一致，旧版本照常恢复；只要其中出现五子棋或黑白棋就写 `schemaVersion: 3`。新版本两种都能读取；`schemaVersion: 2` 中出现其他棋类视为损坏（`BAD_ROOM_STATE`）。
- 回滚到只支持围棋的版本时，schema 3 房间会按“未知 schema”处理：停止该房间服务（`ROOM_RESTORE_FAILED`）并保留原始存储，不会删档或误读；重新部署多棋类版本后原样恢复。围棋房间不受影响。房间切回围棋后，只要存档里还有其他棋类的对局，就仍保持 schema 3。
- 因此回滚前应确认没有进行中的五子棋/黑白棋对局，或接受这些房间在回滚期间暂停；不要为了“修复”而手工改写 `schemaVersion`。
- 旧页面不认识其他棋类，只会回传局面令牌。新页面建房和加入时发送 `multiGame: true`，在其他棋类的房间里落子、认输、申请悔棋以及接受其他棋类的邀请时携带 `gameType`；缺少时房间返回 426 `PROTOCOL_UPGRADE_REQUIRED`，旧页面加入此类房间同样收到 426，提示刷新。围棋房间对旧页面的行为不变，WebSocket 子协议和 `BADUK_PROTOCOL_VERSION` 不变。
- 五子棋和黑白棋同样支持好友、人机（`human-ai`）、AI 自对弈（`ai-ai`）和同机对局。AI 与围棋的 KataGo 一样在房主浏览器中运行，房间只校验并同步它的落子。AI 模型 ID 按棋类区分：围棋 `b10`/`b18`，五子棋 `rapfi`，黑白棋 `topo-othello`；请求中的跨棋类 ID 返回 400 `BAD_REQUEST`，存档中的跨棋类 ID 视为损坏（`BAD_ROOM_STATE`）。这些棋类的 `ai_play` 必须携带 `gameType`，否则返回 426 `PROTOCOL_UPGRADE_REQUIRED`。`pass`、`ai_pass` 和点目操作仍返回 409 `UNSUPPORTED_FOR_GAME`。
- 回滚到不认识 `rapfi`/`topo-othello` 的版本时，存有五子棋或黑白棋 AI 对局的房间会恢复失败：停止该房间服务（`ROOM_RESTORE_FAILED`）并保留原始存储，重新部署后原样恢复。围棋房间不受影响。
- 发布后可用 `npm run test:live -- <地址>` 验证；服务器支持五子棋房间时，冒烟脚本还会验证旧页面被拒绝并下完一局五连，否则在输出中标记 `"gomoku": {"status": "skipped"}`。

只读查看计划（允许工作区尚未提交）：

```powershell
npm.cmd run release:plan -- 0.2.0-rc.9
```

## 准备另一个版本

必须在功能或发布分支上执行：

```powershell
git branch --show-current
npm.cmd run release:version -- 0.2.0-rc.9
git diff -- public/version.json
```

`release:version` 只更新 `public/version.json`。版本清单会被 Vite 原样复制到构建产物，因此部署后可通过 `/version.json` 核对应用版本。请先评审并提交这次版本变更；发布脚本不会替你提交代码或合并 `main`。

## 本地预检

提交所有经过评审的变更后，在干净工作区运行：

```powershell
npm.cmd run release:check -- 0.2.0-rc.9
```

该命令只执行测试、构建和 Wrangler dry-run，不会创建 tag、push 或部署。任何测试失败、构建失败、Worker dry-run 失败、版本不一致、受保护分支或脏工作区都会阻止后续发布。

## 从当前发布分支正式发布

先确认 Cloudflare Wrangler 与 GitHub CLI 已登录，并且当前 commit 就是要发布的 commit：

```powershell
npx.cmd wrangler whoami
gh auth status
git status --short
git rev-parse HEAD
npm.cmd run release:publish -- 0.2.0-rc.9
```

`release:publish` 将按以下顺序执行：

1. 完整预检；
2. 创建 annotated Git tag 并只 push 该 tag；
3. 使用版本 tag 部署 Worker，或在安全重试时复用相同 tag 的现有 Worker Version；
4. 用 `wrangler versions list --json` 与 `wrangler deployments list --json` 验证 100% 部署；
5. 创建带 Cloudflare Version/Deployment ID 的 GitHub Release。

命令成功时最后输出一份 JSON，其中包含 SemVer、tag、branch、commit、Worker Version ID、Deployment ID 和 GitHub Release URL。

如果网络在中途断开，可以在同一 commit 上重新运行同一命令。脚本会接受指向同一 commit 的现有 tag，并复用已经完成的 100% Cloudflare 部署；出现同 tag 多版本或任何标识冲突时会停止，避免猜测。

## GitHub Actions 发布

`.github/workflows/release.yml` 提供手动发布，要求：

- 从非 `main` / `master` 的命名分支触发；
- 输入 SemVer 与确认词 `RELEASE`；
- 仓库环境 `production` 中配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`；
- `production` 必须配置人工审批和受信任分支策略；审批者应先核对 diff、测试结果与将要运行的发布脚本，因为所选分支的代码会在取得生产凭据后运行；
- `GITHUB_TOKEN` 具有 `contents: write`（工作流已声明）。

工作流调用同一个 `release:publish` 脚本，因此本地与 CI 使用相同保护。GitHub 通常只允许调度默认分支已经识别到的 `workflow_dispatch` 文件；本轮明确不合并 `main`，所以当前应使用上面的本地发布命令，工作流随本分支一起评审，之后再启用。

## 列出发布与部署

人类可读输出：

```powershell
npm.cmd run release:list
```

机器可读输出：

```powershell
npm.cmd run release:list -- --json
```

输出并列展示最近 30 个 GitHub Releases、Wrangler 当前可列出的最近 10 个 Worker Versions，以及最近 10 个 Deployments。Cloudflare deployment 条目会显示每个 Version ID 的流量百分比。

## 回滚

第一步必须先列出并核对目标：

```powershell
npm.cmd run release:list
```

回滚到仍在最近版本列表中的 SemVer：

```powershell
npm.cmd run release:rollback -- v0.2.0-rc.3 --yes
```

回滚到较旧版本时，使用该 GitHub Release 正文中保存的不可变 Worker Version ID：

```powershell
npm.cmd run release:rollback -- 11111111-1111-4111-8111-111111111111 --yes
```

脚本调用已核实存在的 `wrangler rollback <version-id> --message ... --yes`，随后重新读取 deployments JSON，只有在目标 Version 获得 100% 流量且拿到新的 Deployment ID 后才报告成功。如果目标已经是最新的 100% 稳定部署，则安全地返回当前 Deployment ID，不制造重复回滚。

回滚不会移动 Git tag，也不会删除或改写 GitHub Release；历史标识保持可审计。

Cloudflare Worker 回滚只切换代码流量，不会回滚 Durable Object 的持久状态。每次发布若改变房间持久化结构，必须保持向后读取兼容，或在 Release notes 中明确标记“不可跨版本回滚”。本次计时字段采用可选、旧房间默认不计时的兼容读取；但回滚到完全不认识计时规则的更旧版本会让正在计时的房间失去约束，因此应先结束这些房间或只回滚到声明兼容的版本。

`v0.2.0-rc.3` 新增的在线 AI 席位可以被 `rc.2` 读取，房间和棋谱不会损坏；但 `rc.2` 不认识 AI 控制元数据，会把它视为一个无法登录的普通白方。若生产环境从 `rc.3` 回滚到 `rc.2`，请先结束或移除仍在进行的在线 AI 对局：无计时局会停在白方，计时局可能判白方超时。普通真人房间不受这项限制。
