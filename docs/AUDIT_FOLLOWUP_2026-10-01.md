# 审计改进与合并检查 · 2026-10-01

记录日期：2026-10-01，Asia/Shanghai。输入为用户提供的 `AUDIT(1).md`，审计基线是 `main@ac9e82d`。本轮在现有工作区上修改，保留开始前的 19 个已修改文件。用户随后同意继续处理合并前事项，原有大厅工作与依赖升级已分别整理成本地提交；本记录末尾跟踪最终验收与 main 整合。未推送、创建 tag 或部署。

## 开始处理时的 Git 与版本

修改前已执行 `git fetch origin`，并核对 `git rev-list --left-right --count origin/main...HEAD`：

| 项目 | 结果 |
| --- | --- |
| 当前分支 | `codex/大厅版` |
| 开始时 HEAD | `a8e8a09` |
| 最新远端 main | `ac9e82d` |
| 当前分支独有提交 | 11 |
| main 独有提交 | 1，`docs: replace README for Topology Go` |
| 工作区版本清单 | `0.2.0-rc.9` |
| `v0.2.0-rc.9` 远端 tag | 本轮查询未发现 |

以上是开始时的提交差异，不包括当时未提交工作，也不代表发布次数或线上部署版本。本地 `main` 停在 `ab9a6d1`，比较时采用刷新后的 `origin/main`。最初只读预演显示 README 冲突；复核工作区发现原有改动已经完整采用远端 main 的新版介绍，本轮补充简化计分、实际大厅流程和验证入口。

## 报告问题处理

| 报告项 | 已落实的行为 | 验证 |
| --- | --- | --- |
| F1 点目确认 | 持久化独立 `scoringRevision`，生成包含房间身份、轮次、规则、贴目、棋盘、提子和死子集合的 `scoringToken`。确认必须携带 `expectedScoringToken`。确认本身不改变 token；改死子、继续行棋、换局使旧确认失效。旧存档的无版本确认被清空，棋局保留。 | 单元时序回归、恢复/重复确认、跨局旧确认、两个真实 WebSocket 客户端迟到确认、两个浏览器客户端从建房到点目。 |
| F2 HTTP 异常 | 建房、加入、大厅、WebSocket 转发和静态资源异步分支均在统一 catch 内 await，返回对应 Response。 | 无效 JSON 正常返回 400；异步上游异常正常返回 500。 |
| F3 请求体上限 | 按原始字节逐块读取，越过 4 KiB 即取消剩余流，不再全文读取后重编码。Content-Length 仅用于提前拒绝。 | 2 MiB 生成流只读到第 5 个 1 KiB 块；伪造长度、UTF-8 拆块、4096/4097 字节边界。 |
| F4 规则口径 | 中英文界面和 README 改为“简化领地计分”，说明未排除双活中的眼。内部 `japanese` 标识保留，以兼容现有数据。 | 现有计分回归通过，浏览器显示说明。没有宣称实现完整日本规则或自动判断双活。 |
| F5 恢复失败 | 恢复失败保留原始快照，房间返回可识别的 `ROOM_RESTORE_FAILED` / 503；记录房间 id、schema 和错误类型，拒绝重新初始化覆盖原数据。过期清理仍是独立流程。 | 未知 schema、损坏棋盘、恢复代码异常；真实 SQLite DO 重启后未知 schema 快照原样保留。 |
| F6 提交异常 | 业务拒绝、提交、提交后的通知分开处理。序列化或 put 异常后丢弃当前内存引擎并停止服务，重试不会重放未确认成功；新实例从存储恢复。成功后的 alarm/广播异常不会改写为错误回执。 | 普通存储替身的提交前/后拒绝；真实 workerd 的 `SQLITE_TOOBIG`、SQLite 事务回滚、alarm 异常、对象重启恢复。 |

F6 使用保守的停止服务策略：即使异常发生在序列化阶段，也不继续使用可能已变更的内存棋局。没有关闭 Cloudflare 默认 output gates，也没有为单键快照额外增加生产数据库事务。

真实运行时测试中的事务回滚是明确的测试注入；它不等同于生产磁盘 I/O 故障。本轮没有人为制造 Cloudflare 远端物理写盘失败。平台默认写入失败行为依据 [Cloudflare 存储文档](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/#supported-options-1)。

工具链升级后，真实尺寸用例也随运行时更新：旧 workerd 的 3 MiB 数据会触发 `SQLITE_TOOBIG`；新 `workerd@1.20260930.2` 已允许它写入，其[源代码](https://github.com/cloudflare/workerd/blob/v1.20260930.2/src/workerd/util/sqlite.h#L66-L67)将行上限设为 8 MiB 加序列化余量。夹具改为 9 MiB，并显式断言真实 `SQLITE_TOOBIG`，没有跳过用例。查询时[平台文档](https://developers.cloudflare.com/durable-objects/platform/limits/)仍写 2 MB；本地运行时的变化不作为远端生产限额已经提高的证明。

## 精简与性能

- S1：新增 `GoEngine.exportSearchState()` / `fromSearchState()`，保留全部位置超级劫历史；MCTS 和 policy legality mask 不再复制真实对局的 undo/replay，搜索落子也不再积累这些记录。持久化导出仍保留完整历史。
- S2：合并 DO 的重复队列包装；删除静态 GoEngine API 的运行时 fallback。真实旧存档缺 topology、replay、undoHistory 等字段的恢复兼容继续保留。
- S3：五种视图首次使用时创建并缓存，普通棋局更新仅发给当前视图。浏览器实际 canvas 数量为 `1 → 2 → 3 → 3 → 3 → 3 → 4 → 5`；已创建的视图仍会在尺寸/拓扑改变时重建以保证切换正确。未把本次修复扩大成整个 main.js 的职责拆分。

基准命令：`node --expose-gc scripts/benchmark-search-state.mjs`。使用固定种子的环面中后盘，每组 120 次“克隆 + pass”，40 个保留克隆在 GC 后估算堆内存。原路径为 `exportState({ includeReplay: false }) + fromState()`，新路径为搜索专用 API。两者均保留完整 superko。

| 棋盘 / 已走手数 | 原路径 ms/次 | 新路径 ms/次 | 原状态字节 | 新状态字节 |
| --- | ---: | ---: | ---: | ---: |
| 19×19 / 140 | 10.804 | 0.825 | 136593 | 56442 |
| 19×19 / 240 | 6.319 | 1.320 | 184678 | 94940 |
| 25×25 / 240 | 12.684 | 4.883 | 293739 | 161344 |
| 25×25 / 400 | 10.826 | 4.593 | 413505 | 266133 |

这是单机微基准，受 CPU 调度和 GC 影响，不代表完整 AI 推理的提速或峰值内存。原始记录见 [search-benchmark.json](audits/2026-10-01-search-benchmark.json)。

## 验证记录

- 修改前：`npm test` 345 项通过。
- 修改后：`npm test` 372 项通过，0 失败、0 跳过，包含 6 项 workerd/SQLite 运行时测试计数。
- `npm run build` 通过；仍有主 bundle 大于 500 kB 的构建提示，不作为新的内存泄漏证据。
- `wrangler deploy --dry-run --strict` 通过，两个 DO 绑定和静态资源正常；没有上传或部署。
- `git diff --check` 和修改过的主要入口的 Node 语法检查通过。
- `node scripts/live-room-smoke.mjs http://127.0.0.1:8788/` 通过：邀请接受后开局、计时、聊天、旁观只读、悔棋、认输、矩形 AI 房间与 AI 撤回。
- 旧 live smoke 假设加入即开局、AI 必须是虚拟成员；已更新为当前大厅邀请流程及 `match.controllers`，没有为了让测试通过恢复旧产品行为。
- `node scripts/live-scoring-smoke.mjs http://127.0.0.1:8788/` 通过：黑方修改死子后，白方旧 token 被拒绝，双方确认同一新 token 后才结束。
- 独立 Chrome 无界面会话：五视图切换、模型 b18/b10 选择与取消、本地实际落子/点目/复盘，以及两个独立浏览器从大厅建房到双方确认均通过；未捕获到页面异常。截图已检查。
- 后续补充真实模型推理：生产 Worker bundle 在 WebGPU 上加载 b10 的 9×9/12 手柱面、19×19/140 手环面，以及 b18 的 9×9/12 手莫比乌斯棋局，均返回规则引擎接受的落子。每次只做 8 次搜索、300 ms 搜索预算，属于功能 smoke，不能作为棋力或完整性能评测。见 [AI 记录](audits/2026-10-01-ai-inference.json)。
- 390×844 Chrome 触屏模拟通过本地落子、双方 pass、确认点目和大厅建房；棋局与大厅均无横向溢出，截图已检查，页面异常为 0。这不是实体 iOS/Safari 测试。见 [移动端记录](audits/2026-10-01-mobile-smoke.json)。
- 杀掉本任务本地 Wrangler 进程树并用相同 SQLite 目录重启：两个真实客户端自动重连，原有 2 手和轮次身份恢复；新建客户端从已保存的会话恢复后继续落第 3 手成功。未重置或读取生产房间。见 [重启恢复记录](audits/2026-10-01-restart-smoke.json)。
- 应用内浏览器宿主启动失败，错误为 Windows sandbox `apply deny-read ACLs`；采用临时无登录资料的 Chrome 测试会话完成上述界面检查。

## 后续处理与发布边界

1. **依赖告警已处理。** `wrangler@4.145.0` 与其自带的 `miniflare@5.20260930.0-alpha` 对齐并锁定，更新后的 `sharp@0.35.4`、`undici@7.29.1`、`postcss@8.5.28`、`nanoid@3.3.19` 使全部依赖 `npm audit` 从 6 项降为 0 项；生产依赖扫描也是 0。没有使用 `--force` 或 overrides。Miniflare 5 的[配置变更](https://developers.cloudflare.com/changelog/post/2026-09-08-miniflare-v5/)通过原生 module manifest 适配，真实 SQLite 用例保留。
2. **按边界整理本地提交。** `47ae485` 保存原有 19 文件大厅改动，`b434cce` 保存依赖升级，`ec540fc` 保存审计修复、验证脚本、CI 与文档，`b4954c0` 整合最新 main。最终整合记录见下文。初始的 11 个领先提交不包含这些新提交。
3. **可重复验收。** 更新工具链后已通过 372 项测试、构建、dry-run、两个 live smoke、实际 b10/b18 推理、长棋谱、移动端模拟和本地进程重启恢复。新增 `.github/workflows/ci.yml`，PR 将运行锁文件安装、完整测试、构建、dry-run 与所有依赖审计，权限仅为读取代码，不使用生产凭据。本地尚未推送，不能称远端 CI 已通过；合并应以实际 PR 检查结果为准。
4. **发布前仍须完成。** `0.2.0-rc.9` 是候选号；tag/Release 和部署必须绑定最终 commit。预发布环境的新旧页面共存、发布切换以及真实移动设备/Safari 尚未验证。README 与 `wrangler.jsonc` 都指向 `topology-go`，发布时仍须核对实际 Worker Version/Deployment。点目客户端与回滚边界已写入 [RELEASES.md](RELEASES.md)。

主文件后续按联机、AI、复盘、聊天和视图职责拆分，以及玩家/HTTP 入口的进一步限速，是独立的后续改进项；本轮未宣称完成这些结构和容量工作。

## 最终代码候选验收

- 代码候选：`b4954c0ef3eb9bc27400c48ecf308c971e11eb9e`，分支 `codex/大厅版`。
- 已整合的 main：`ac9e82dece9ace9f0ea49188fbb6c0c1387e0966`。唯一 README 冲突已解决，远端新版项目介绍完整保留。整合后的文件树与 `ec540fc` 相同。
- 在该候选的干净工作区运行 `npm run release:check -- 0.2.0-rc.9`，372 项测试全部通过，构建和严格部署 dry-run 通过；随后两项 live smoke 也通过。运行环境是 Windows、Node.js 24.14.0，不能代称尚未运行的 Ubuntu/Node.js 22 CI。
- 此时 `git rev-list --left-right --count origin/main...HEAD` 为 `0 15`。之后只有本记录与验收 JSON 的文档提交，计数会增加；最新数字以该命令为准。
- 本地 main 分支、远端 main 和线上服务均未改动；没有 push、PR、tag、Release 或部署。本分支对应的远端 PR 查询为空。合并流程下一步是推送分支、创建 PR 并取得实际 CI 结果；预发布/真机验收属于随后发布前检查。
- 可移植的命令与结果摘要见 [最终预检记录](audits/2026-10-01-final-preflight.json)。原始本地日志在 `%TEMP%/topology-go-audit-20261001/`。
