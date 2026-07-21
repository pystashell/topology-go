# 3D Baduk 发布与回滚

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

仓库已经准备好以下候选版本清单；正式发布后，tag、Worker Version、Deployment 与 GitHub prerelease 会共同组成可审计记录：

```json
{
  "version": "0.2.0-rc.4",
  "tag": "v0.2.0-rc.4",
  "channel": "prerelease"
}
```

只读查看计划（允许工作区尚未提交）：

```powershell
npm.cmd run release:plan -- 0.2.0-rc.4
```

## 准备另一个版本

必须在功能或发布分支上执行：

```powershell
git branch --show-current
npm.cmd run release:version -- 0.2.0-rc.4
git diff -- public/version.json
```

`release:version` 只更新 `public/version.json`。版本清单会被 Vite 原样复制到构建产物，因此部署后可通过 `/version.json` 核对应用版本。请先评审并提交这次版本变更；发布脚本不会替你提交代码或合并 `main`。

## 本地预检

提交所有经过评审的变更后，在干净工作区运行：

```powershell
npm.cmd run release:check -- 0.2.0-rc.4
```

该命令只执行测试、构建和 Wrangler dry-run，不会创建 tag、push 或部署。任何测试失败、构建失败、Worker dry-run 失败、版本不一致、受保护分支或脏工作区都会阻止后续发布。

## 从当前发布分支正式发布

先确认 Cloudflare Wrangler 与 GitHub CLI 已登录，并且当前 commit 就是要发布的 commit：

```powershell
npx.cmd wrangler whoami
gh auth status
git status --short
git rev-parse HEAD
npm.cmd run release:publish -- 0.2.0-rc.4
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
