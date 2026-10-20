# UNO 派对

一个可部署到 GitHub Pages 的单人 UNO 网页游戏。打开页面即可与三位电脑玩家对战，无需服务器或账号。

## 本地运行

直接用浏览器打开 `index.html`，或在项目目录运行 `python -m http.server 8000` 后访问 `http://localhost:8000`。

## 发布到 GitHub Pages

1. 在 GitHub 新建一个公开仓库，例如 `uno-game`。
2. 将本目录的 `index.html`、`styles.css`、`script.js`、`.nojekyll` 和 `README.md` 上传到仓库根目录，提交到 `main` 分支。
3. 打开仓库 **Settings → Pages**，在 **Build and deployment** 中将 **Source** 选为 **Deploy from a branch**，选择 `main` 和 `/ (root)`，然后保存。
4. 等待页面显示发布地址。通常格式为 `https://你的用户名.github.io/uno-game/`。如果仓库名称是 `你的用户名.github.io`，地址是 `https://你的用户名.github.io/`。

后续更新这几个文件并推送到 `main`，GitHub Pages 会重新发布。

## 已实现的规则

- 108 张标准牌、四人轮流出牌、摸牌与重新洗入弃牌堆。
- 按颜色、数字或符号匹配；支持跳过、反转、+2、万能变色和 +4。
- +4 只能在手中没有当前颜色的牌时打出；+2 / +4 让下一位摸牌并跳过回合。
- 摸一张后可以选择打出新摸到的牌，或保留它并结束回合。
- 剩一张牌时需要点击“喊 UNO!”；忘记会被罚摸两张。
- 首位出完手牌的玩家获胜，可以立即开始下一局。

此版本为浏览器内单人对战，不含真人联机、账号系统或跨设备进度同步。
