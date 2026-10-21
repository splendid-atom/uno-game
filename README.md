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

- 使用 [PeerJS 1.5.5](https://github.com/peers/peerjs/releases/tag/v1.5.5) 和 WebRTC 数据通道。房间信令使用默认 PeerJS Cloud；PeerJS 客户端仅在选择联机时从 jsDelivr 加载，失败后尝试 unpkg。
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

15 项测试包括规则边界、过期/越权操作、手牌隔离、60 局种子对局，以及模拟四客户端的协议同步、满房拒绝、掉线接管、重开和房主退出；另有 DOM 交互检查，验证邀请入口、单人开局、选色、结算、重开和退出。模拟传输和 DOM 测试不等同于跨设备 WebRTC 或浏览器视觉实测。

## 文件与部署

- `engine.js`：独立规则状态机及玩家私有视图。
- `network.js`：房间协议、PeerJS 传输、房主计时、电脑与掉线处理。
- `script.js`：大厅、牌桌、弹窗与交互。
- `index.html` / `styles.css`：界面与响应式样式。
- `game.test.js`：无第三方依赖的规则与协议测试。
- `ui.test.js`：轻量 DOM 交互检查。

GitHub Pages 使用 `main` 分支根目录，保留 `.nojekyll`。提交变更后，GitHub 自动运行 Pages 部署。不要将任何服务密钥写进静态 JavaScript。
