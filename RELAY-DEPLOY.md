# 为流量网络启用服务器中转

手机与服务器建立 HTTPS 连接，房主与玩家之间无需 WebRTC、UDP 或端口映射。中转协议使用长轮询，消息到达立即返回；服务器只向对应连接转发，游戏规则和私有手牌仍由房主管理。

## Render 部署

1. 在 Render 登录后，选择 New → Blueprint，连接 `splendid-atom/uno-game` 仓库的 `main` 分支。
2. Render 会识别仓库中的 `render.yaml`，创建 `uno-game-relay` 服务。核对所选方案后部署。
3. 部署成功会得到一个 HTTPS 地址。直接打开该地址即可玩中转版，手机和朋友使用这个网站创建、分享房间。服务同时提供网页和中转，自动配置连接地址。
4. 如需保留原来的 GitHub Pages 网址，将 `config.js` 中的空字符串改成该服务地址加 `/relay`，例如 `https://你的服务.onrender.com/relay`，提交后等待 Pages 部署。双方刷新后重新创建房间。

当前 `config.js` 留空，意味着 GitHub Pages 仍使用旧 WebRTC 模式；只有部署服务并填入地址后，中转才会在原网址生效。不要填示例地址或把密钥放入此文件。

## 已有云服务器

安装 Node.js 22，复制仓库，运行 `PORT=3000 node relay-server.cjs`（PowerShell 使用 `$env:PORT='3000'` 后运行）。无 npm 依赖。使用进程管理器保持运行，并通过 HTTPS 反向代理到该端口。代理读取超时至少 35 秒；不要缓存 `/relay/*` 请求。确认手机网络能够访问服务器的 HTTPS 域名。

`ALLOWED_ORIGINS` 是逗号分隔的跨域来源，默认允许 `https://splendid-atom.github.io`；同源网页自动允许。`GET /health` 是健康检查。不要暴露测试、文档或服务器源码，内置静态服务只提供指定的游戏文件。

## 限制与验证

- 单实例内存服务，重启或部署会结束当前房间；不要直接水平扩容为多实例。
- 免费托管可能休眠，首次打开时等待服务唤醒后再开房。实际方案和限制以托管平台为准。
- 心跳会话保留约 90 秒。房主仍需保持页面在前台；浏览器被系统关闭后不能维持游戏。
- `node relay.test.cjs` 测试真实 HTTP 四人联机、私有视图、权限隔离和消息补取；浏览器 CI 禁用 `RTCPeerConnection` 验证手机加入与手机开房。
- 测试不等于运营商实测。上线后请分别验证「Wi-Fi 房主 + 流量玩家」和「流量房主 + Wi-Fi 玩家」，并实际完成一次出牌同步。

官方参考：[Render 部署](https://render.com/docs/deploy-node-express-app)、[Web 服务](https://render.com/docs/web-services)。
