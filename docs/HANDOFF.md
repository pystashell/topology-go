# 交接文档（2026-10-21）

这份文档给接手的下一个开发会话看，无论是本地 Claude Code 会话还是人。读完就能接着做，不用翻聊天记录。

## 1. 当前状态一览

| 项目 | 状态 |
| --- | --- |
| `main` | `aa32d9a`，包含围棋、五子棋（自由/连珠）、黑白棋，三种拓扑（圆柱/环面/莫比乌斯），本地对弈、联机、大厅、复盘，以及三种棋的 AI |
| 测试 | `npm test` 857/857 通过；PR 检查（`.github/workflows/ci.yml`）全绿 |
| 待发布分支 | `release/0.3.0-rc.1`：最新 `main` 加上 `public/version.json` 改为 `0.3.0-rc.1` 的那一次提交 |
| 线上 | **仍是旧版本**：<https://topology-go.pystashell.workers.dev/>，只有围棋，不含本轮修复 |
| 为什么没上线 | GitHub `production` 环境缺 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。`release.yml` 第一步就因此退出，`0.2.0-rc.9` 和 `0.3.0-rc.1` 都试过，都失败 |

已合并的 PR（详细说明和验证记录都在 PR 正文里）：

- #1 `codex/大厅版` → main：在线大厅、计时、SGF、英文界面、矩形棋盘；2026-10-17 一轮审查的修复，涉及依赖漏洞、AI 提速、SGF、限流、座位锁、安全头、UI 和视图
- #2 `feat/multi-game` → main：通用拓扑模块、规则注册表、五子棋（含连珠禁手）、黑白棋、联机/大厅/视图/UI 全部多棋种化
- #3 `feat/game-ai` → main：五子棋 AI 用 Rapfi，黑白棋 AI 为自研引擎，AI 接入本地、自对弈和联机

## 2. 负责人（owner）已做的决定

- 交流用中文。节奏优先：dev 验证通过就上线，负责人看完再给反馈。
- **上线方式（目前）**：B 方案，由负责人在自己电脑上执行发布（见 §3）。
  - 以后如果在 GitHub 配好两个 Cloudflare secret（A 方案），开发会话就可以自己触发 `release.yml`。
- 五子棋同时支持**自由五子**（五连及以上胜）和**连珠**（黑方三三、四四、长连禁手），开局时选。
  - 禁手点直接拒绝落子，不判负；不做开局规则（如 Swap2）。
- 五子棋 AI 用 **Rapfi**。负责人接受 GPL-3：代码是 GPL-3，权重是 CC0。
- 黑白棋 AI：负责人要求开源免费、能直接在客户端用。调研结论：没有开源引擎能正确处理环面/圆柱/莫比乌斯，详见 PR #3 和本文 §6。因此使用**自研纯 JS 引擎**。
  - 曾提出可选的 `multimcts`（MIT）作为第二个对手，负责人尚未回复。
- 围棋行为必须保持**一手不差**：有黄金样本测试守护，见 §5。
- 尚未决定：页面标题仍是“3D Baduk · 奇异棋盘围棋”，已不只围棋，要不要改名？

## 3. 发布

### B 方案：负责人本地执行（Windows PowerShell）

```powershell
git fetch origin
git checkout release/0.3.0-rc.1
git pull
npm.cmd ci
npx.cmd wrangler login
npm.cmd run release:publish -- 0.3.0-rc.1   # 跑测试、构建、部署、打 tag、建 GitHub Release
# 没有登录 gh 时可改用：npm.cmd run deploy   （只部署）
```

验证：<https://topology-go.pystashell.workers.dev/version.json> 显示 `0.3.0-rc.1` 即成功。

### 准备下一个版本

发布脚本拒绝在 `main`/`master` 上运行，要求工作区干净，且版本号与 `public/version.json` 一致。流程：

```bash
git checkout -B release/0.3.0-rc.2 origin/main
npm run release:version -- 0.3.0-rc.2   # 只改 public/version.json
git commit -am "release: prepare 0.3.0-rc.2"
git push -u origin release/0.3.0-rc.2
```

然后告诉负责人分支名和版本号，让他按 B 方案执行。

A 方案（配好 secret 之后）：用 GitHub Actions 的 “Release candidate” 工作流 `workflow_dispatch`，参数为 `ref=release/x.y.z`、`version=x.y.z`、`confirm=RELEASE`。不要开 “Required reviewers”，否则每次都要人工批准。细节见 `docs/RELEASES.md`。

`release/0.2.0-rc.9` 分支已作废，被 `0.3.0-rc.1` 取代，可以删除。

## 4. 架构速览（新代码）

```text
src/topology/            唯一的邻接/直线来源：getTopology(kind,w,h) → step/neighbors4/neighbors8/ray/line/fromCover
                         莫比乌斯过接缝：行镜像 + 竖直方向翻转（"/" 变 "\"）
src/game/gameTypes.js    棋种常量、尺寸限制（五子棋 ≥11；黑白棋 6–30 偶数）、错误码
src/game/rules/          rulesFor(gameType)：go.js / gomoku.js / othello.js（create/fromState/hydratePublic/
                         normalizeSettings/capabilities/roomActions/matchModes/positionFingerprint/viewMarkers）
src/game/goEngine.js     围棋（邻接改为委托 topology；其余不变）
src/game/gomokuEngine.js + lineRuns.js + renju.js   五子棋与连珠禁手（含递归“真三”判定）
src/game/othelloEngine.js 黑白棋（射线遇边界/空点/回到起点即停；自动跳过回合，无 pass 事件）
src/game/replay.js       按 gameTypeOf(base) 分派复盘
src/multiplayer/roomEngine.js  房间状态机。经规则注册表建/恢复引擎；schema 2（全围棋）/3（含其他棋）双写；
                         按棋种限制动作与对局方式；旧页面在非围棋房间收到 426
src/multiplayer/lobby*.js 大厅摘要/筛选/预览（含棋种）
worker/                  Cloudflare Worker + Durable Objects（BadukRoom, BadukLobby）；限流绑定见 wrangler.jsonc
src/view/                5 种视图；gameMarkers.js（五连高亮、禁手 ✕、黑白棋可落点/翻转）、boardStyle.js
src/ui/gameUi.js         各棋种的文案、结果、控件可见性（纯函数，有测试）
src/main.js              UI 主文件（约 7–8k 行，仍偏大）
src/ai/                  围棋：KataGo（katagoWorker.js、mcts.js）；其他棋：gameAiRegistry.js + gameAiClient.js
  gomoku/                Rapfi：flatView.js（拓扑→≤22 平面视窗）、tactics.js（跨接缝必胜/必挡/VCF）、worker
  othello/               自研：射线表、PVS + 置换表、按拓扑拟合的评估、终局精确求解、worker
  fallback/              规则校验过的兜底 AI（引擎起不来时使用）
public/engines/rapfi/    Rapfi wasm + 权重 + COPYING + 源码包 + SOURCE.md（GPL 合规材料，勿删）
public/_headers          CSP 等安全头；只有 katagoWorker-* 和 gomokuAiWorker-* 允许 'wasm-unsafe-eval'
```

设计文档在 `docs/design/multi-game-plan.md` 和 `docs/design/game-ai-interface.md`，后者定义 AI worker 协议。其中的行号是当时的快照，以现有代码为准。产品规格见 `docs/PRODUCT_REQUIREMENTS.md`。

## 5. 开发规则与验证

提交前要跑与 CI 相同的检查：

```bash
npm ci
npm test                                  # 857 项；含真实 workerd/SQLite 运行时测试
npm run build
npx wrangler deploy --dry-run --strict
npm audit --audit-level=moderate          # CI 会因任何 moderate+ 漏洞失败
```

- **围棋不能变**：`test/goGoldenMaster.test.js` 守护。邻居顺序是持久化行为，它决定提子顺序和存档校验，不能改。需要核对时可以运行 `node scripts/generate-go-golden.mjs --check`。
- **测试按函数名定位 main.js 中的函数，这些名字不能改**：`hydratePublicGame`、`applyOnlineRoom`、`enterReplay`、`enterNextGameSetup`、`startConfiguredNextGame`、`startImmediateRematch` 等。
- **i18n**：中文原文就是查找键。`test/i18nCoverage.test.js` 和 `test/serverErrors.test.js` 会拦截未翻译的文案和未登记的服务端错误码。
- **CSP**：不要写内联脚本或内联样式。新的需要 wasm 的 worker 必须在 `public/_headers` 里单独授权。
- **测试开关**：重测试用环境变量打开：`GOMOKU_AI_HEAVY=1`、`OTHELLO_AI_FULL=1`、`OTHELLO_AI_PERF=1`。
- **本地联机**：`npm run dev`（先 build，再起 wrangler dev，端口 8787）。冒烟测试：
  - `node scripts/live-room-smoke.mjs http://127.0.0.1:8787/`（含五子棋整局）
  - `node scripts/live-scoring-smoke.mjs http://127.0.0.1:8787/`
- **浏览器验证**：`scripts/browser-checks/`，需要单独安装 Playwright，见该目录的 README。
- **重建 Rapfi**：需要 emsdk，运行 `scripts/build-rapfi.sh`。产物逐字节可复现，版本信息见 `public/engines/rapfi/SOURCE.md`。

## 6. 已知问题与待办（按优先级大致排列）

1. **上线**：等负责人按 B 方案发布 `0.3.0-rc.1`，然后收集反馈。
2. **改名**（待负责人决定）：页面标题、OG 标签、`package.json`/`wrangler.jsonc` 名称不统一（3D Baduk / Topology Go / bamboo-baduk）。注意 Worker 名 `topology-go` 决定了线上域名，不能随便改。
3. 联机 AI 对局中，人类座位固定属于房主，访客加入只能观战。要让访客和 AI 下，得改房间模型。
4. 黑白棋 AI 在 8×8 环面执黑偏弱：对随机对手约 87%（4 秒约 91%）。这是环面完全对称、通常白方最后落子造成的结构性劣势。
5. Rapfi 神经网络只覆盖平面 13–22 路（自由五子）和 15 路（连珠），其他尺寸用经典评估加我们的战术层。不支持 wasm SIMD 的浏览器（Safari 16.4 以前）只用战术层。
6. 五子棋、黑白棋没有 SGF 导入导出（GM[4]/GM[2]），按钮已隐藏；“邀请对局”副标题对所有棋种都提到 AI；棋盘尺寸记忆只在当前标签页有效。
7. 联机：没有不公开房间和踢人；点目阶段没有超时，也不能判对方弃局；单局 30×30 超过约 1500 手时单值存储会逼近 2 MiB。
8. 手机：环面平面视图和 3D 环面/莫比乌斯视图中，从棋盘上开始的竖向滑动不会滚动页面（这些视图需要竖向拖动）。
9. 尚未在真机 iOS/Safari 上测试过。
10. `src/main.js` 过大，拆分是独立的后续工作。

## 7. 本地新会话建议的第一步

1. `git checkout main && git pull && npm ci && npm test`：确认 857 项全过。
2. 读本文件和 `docs/design/*`。
3. 如果负责人已经发布 `0.3.0-rc.1`，从他的反馈开始。如果还没有，先协助他完成 §3 的 B 方案。
