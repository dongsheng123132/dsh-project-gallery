# 演示素材的来源与重生成

所有对外图片都只用**虚构数据 + 无版权素材**生成，生成脚本在仓库里，可重复。

## 1. 演示图片（demo/fixtures/）

8 张公共领域作品，取自 The Metropolitan Museum of Art Open Access（CC0 1.0），可自由复制、修改、商用。
逐张的作品名/作者/年代/来源链接见 [demo/fixtures/LICENSE-IMAGES.md](../../demo/fixtures/LICENSE-IMAGES.md)。

处理方式：只等比缩放到最长边 900px、转 JPEG（q82），未做其它修改。

## 2. 虚构数据（demo/mock-server.mjs）

- 三个虚构项目：`示例项目 · 馆藏画册` / `示例项目 · 版式实验` / `示例项目 · 落地页重做`
- 虚构会话标题与对话原文（例如「把这张画的色调改成清晨的暖色，并生成 4 张候选。」）
- 路径一律 `/demo/<项目>`，不含任何真实目录

## 3. 截图（docs/screenshots-demo/）

生成命令：`node demo/shots.mjs`（需要 playwright；`PLAYWRIGHT_PATH` 可指向任意已装目录）

| 文件 | 截的是什么 |
|---|---|
| `01-global-album.png` | 全局相册：左侧按项目、右侧按天分组网格 |
| `02-project-dock.png` | 项目级侧栏面板：项目名 + 统计 + 搜索 + 网格 |
| `03-lightbox.png` | 灯箱：图左 / 上下文右（当时在做什么、元信息、动作）/ 胶片条在下 |
| `04-hover-card.png` | 悬停工作区行弹出的卡片（可 📌 固定、可 ⊘ 静音），背景是示意侧栏 |
| `card-transparent.png` | 同一张卡片的透明底版本，给促销图当浮层用 |

界面本身走真实代码：`01`–`03` 由 `web/` 页面渲染；`04` 与透明卡片由 `demo/card.html` 渲染，
**卡片样式直接从 `adapters/dsh-plugin/client.js` 里的 CSS 块读取**（页面会 fetch `client.js` 并取 `const CSS = ...`），
所以不会出现「截图是另一套样式」的漂移。

## 4. 促销图（docs/promo-zh.png / docs/promo-en.png）

生成命令：`node promotion/make-promo.mjs`（Playwright + 本机 Chrome，1600×900）

- 右侧：`03-lightbox.png` 缩放；左下浮层：`card-transparent.png`（即 `04` 的那张卡片）
- 左侧文字、标签、安装命令、背景由脚本现场排版
- 不含任何真实项目名、路径、会话或截图

## 5. 页脚水印

截图右下角带 `dsh-project-gallery <版本> · 界面示意（虚构数据）`，版本号由 `package.json` 注入。

## 6. 发布前复查

```sh
grep -rIn --exclude-dir=.git -E '/Users/|/home/|hequbing|dosen' docs demo promotion | head
```

应只命中脚本里的注释或示例路径；有真实路径就说明素材拿错了，不要发。
