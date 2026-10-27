# 开启“用 Google 登录”（负责人操作，约 10 分钟）

代码已经写好：Worker 里有了 Google 的客户端 ID 和密钥，登录对话框就会出现“用 Google 登录”按钮；没有就不显示，别的登录方式不受影响。Google 不收费。

需要负责人自己在 Google Cloud Console 建一个 OAuth 客户端，因为它属于你的 Google 账号。

## 1. 建项目和同意屏幕

1. 打开 <https://console.cloud.google.com/>，用你的 Google 账号登录。
2. 顶部的项目选择器 → **新建项目**，名称填 `Topology Go`，创建后切换到这个项目。
3. 左侧菜单 → **Google Auth Platform**（旧界面叫“API 和服务 → OAuth 同意屏幕”）→ **开始**：
   - 应用名称：`Topology Go`
   - 用户支持电子邮件：你的邮箱
   - 受众：**外部**（External）
   - 联系信息：你的邮箱
   - 同意 Google API 服务的用户数据政策 → **创建**

只需要 Google 默认的三项权限（openid、邮箱、基本资料），都不是敏感权限，不用提交审核。

## 2. 建客户端

1. **Google Auth Platform → 客户端**（Clients）→ **创建客户端**。
2. 应用类型：**Web 应用**；名称随意，例如 `Topology Go Worker`。
3. **已获授权的 JavaScript 来源**，添加：
   - `https://topology-go.pystashell.workers.dev`
4. **已获授权的重定向 URI**，添加（一字不差）：
   - `https://topology-go.pystashell.workers.dev/api/auth/callback/google`
   - 想在本机测试的话，再加 `http://localhost:8787/api/auth/callback/google`
5. **创建**。页面会显示**客户端 ID**（以 `.apps.googleusercontent.com` 结尾）和**客户端密钥**（以 `GOCSPX-` 开头）。密钥只在这里完整显示一次，可以先下载 JSON 保存好，不要发到公开的地方，也不要提交进仓库。

## 3. 发布应用

**Google Auth Platform → 受众**（Audience）→ 发布状态是“测试”时点 **发布应用**，确认改成“正式版”。不发布的话，只有加进“测试用户”名单的人能用 Google 登录。

## 4. 把两个值交给 Worker

在项目目录里运行下面两条命令，每条会提示你粘贴一个值（粘贴的内容不会显示出来）：

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

设置密钥会让线上 Worker 立即生效，不用重新发布。之后打开网站 → 右上角“登录”，对话框底部应该出现“用 Google 登录”。

## 说明

- 游客第一次用 Google 登录时，这个浏览器里的棋谱和房间席位会跟到 Google 账号下，和用户名密码注册一样。
- 一个用密码注册的账号如果填了同一个 Gmail 地址，Google 登录**不会**自动并进那个账号：我们没有验证过注册时填的邮箱，自动合并会让别人用你的邮箱先注册来占你的账号。这种情况页面会提示用原来的用户名和密码登录。
- 中国大陆的用户要能访问 Google 才能用这个按钮；用户名密码登录和游客不受影响。
- 以后要换密钥：在 Google Cloud Console 的同一个客户端里新建一个密钥，用上面的命令换掉 `GOOGLE_CLIENT_SECRET`，再删掉旧密钥。已经登录的人不受影响。
