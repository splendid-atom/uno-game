# UNO 派对

[打开游戏](https://splendid-atom.github.io/uno-game/) · [仓库](https://github.com/splendid-atom/uno-game)

无需注册的 UNO 网页游戏：单人对战三位电脑，或邀请朋友进行 2–4 人联机。采用静态 HTML、CSS、JavaScript，部署到 GitHub Pages，不需要构建。

## 好友联机

1. 输入昵称，点击「开一桌，叫上朋友」。
2. 复制邀请链接或 8 位房间码，发给朋友。
3. 朋友打开链接后点击加入，或在大厅输入房间码。
4. 至少两位真人入座后，由房主开始游戏。默认空位电脑补齐；关闭此选项即可进行两人或三人对局。
5. 结束后房主可以再开一局，或返回房间接待新玩家。

房主需要保持页面打开，建议留在前台。普通玩家断线后由电脑接管，暂不支持重新进入当前对局；房主离开、刷新或长时间断线会结束房间。

### 连接方式与边界

流量网络无法直连时，可部署新增的 HTTPS 中转模式，详见 [中转部署说明](RELAY-DEPLOY.md)。中转服务可直接托管游戏，也可通过 `config.js` 接入 GitHub Pages。服务未部署、地址未配置前，原网站仍使用 WebRTC，不会自动获得中转能力。

- 使用 [PeerJS 1.5.5](https://github.com/peers/peerjs/releases/tag/v1.5.5) 和 WebRTC 数据通道。房间信令使用默认 PeerJS Cloud；客户端优先加载网站自带的 `vendor/peerjs-1.5.5.min.js`，失败后才尝试 jsDelivr 和 unpkg，避免手机因无法访问 CDN 而卡在加入入口。
- GitHub Pages 只托管网站文件，不是游戏服务器。房主浏览器保存完整对局，每位客人只接收自己的手牌和公开信息。房主校验出牌者、回合、牌和规则；本模式面向朋友间娱乐，不提供防房主作弊保证。
- 连接依赖公共信令服务与双方网络。部分防火墙或对称 NAT 需要额外 TURN 中继，此版本未配置自有 TURN，不能保证所有网络间都能连接。连接失败会超时并提示重试；单人模式不依赖联机服务。
- 参考：[PeerJS 快速开始](https://peerjs.com/client/getting-started)、[连接限制](https://peerjs.com/client/faq)、[Peer API](https://peerjs.com/client/api/peer)。

## 玩法

108 张牌；按颜色、数字或符号出牌。支持跳过、反转、+2、变色、+4。

- +2 / +4 不叠加，下一位摸牌并跳过。没有当前颜色的牌时才能出 +4；不含质疑环节。
- 两人对局的反转等同跳过。
- 摸牌后只能出刚摸到的那张，也可以保留并结束回合。
- 出到剩一张时，在 3.5 秒内点击 UNO，否则罚摸两张。
- 最先出完手牌的玩家获胜。

界面提供手牌排序、有效牌高亮、当前颜色与方向、对局动态、可选提示音及手机布局。昵称和音效偏好保存在本机；对局不会跨刷新保存。

## 本地运行和测试

单人模式可以直接打开 `index.html`。联机建议使用 HTTPS 部署地址或 localhost，例如：

```sh
python -m http.server 8000
```

访问 `http://localhost:8000`。

```sh
node --check engine.js
node --check network.js
node --check script.js
node game.test.js
node ui.test.js
```

19 项测试包括规则边界、过期/越权操作、手牌隔离、60 局种子对局，以及模拟四客户端的协议同步、满房拒绝、掉线接管、重开和房主退出；还覆盖手机慢连接、分阶段超时、重试回调隔离、邀请链接与全角输入，以及 DOM 交互。

GitHub Actions 的 `Browser connection checks` 使用 Playwright 移动端模拟、独立浏览器会话和本地 PeerServer 检查真实 WebRTC 入座、发牌与同步。测试隔离外部 CDN；本地 ICE 设置仅用于 CI，不改变线上网络配置。这不能代替实体手机及不同运营商网络实测。

### 手机加入排查

- 房主和玩家都刷新网页，再创建新房间。支持直接粘贴邀请链接、带空格或全角字符的房间码。
- 建立通道最长等待 60 秒，通道打开后另给 15 秒确认入座；失败自动重试一次，也可点击取消。
- `[SIGNAL_TIMEOUT]` 表示未连上房间服务；`[ICE_TIMEOUT]` 表示未能与房主建立通道；`[JOIN_TIMEOUT]` 表示房主未确认入座。反馈问题时附上错误码、浏览器名称和双方网络类型。
- 双方保持游戏在前台。切回页面会刷新心跳并尝试恢复信令，但不能保证被系统关闭的连接恢复。

## 文件与部署

- `engine.js`：独立规则状态机及玩家私有视图。
- `network.js`：房间协议、PeerJS 传输、房主计时、电脑与掉线处理。
- `script.js`：大厅、牌桌、弹窗与交互。
- `index.html` / `styles.css`：界面与响应式样式。
- `game.test.js`：无第三方依赖的规则与协议测试。
- `ui.test.js`：轻量 DOM 交互检查。

GitHub Pages 使用 `main` 分支根目录，保留 `.nojekyll`。提交变更后，GitHub 自动运行 Pages 部署。不要将任何服务密钥写进静态 JavaScript。
