# 演示图来源与重生成

这三张图**全部是虚构数据**，不含任何真实项目、真实路径、真实会话：

- 数据源：`demo/mock-server.mjs`（项目名 `示例项目 · 海岸插画册`，图片名 `示例_海岸_0N.png`）
- 图片素材：`demo/fixtures/illustration-1..4.png`，程序绘制的原创插画（无第三方版权）
- 生成命令：`npm run shots`（Playwright + 本机 Chrome，1200×760 @2x）
- 页脚水印：`dsh-project-gallery <版本> · 界面示意（虚构数据）`，版本号由 `package.json` 注入
- 校验：`node --test` 的 15 项 + 图内不得出现真实路径/项目名（发布前用 grep 复查）

| 文件 | 截的是什么 |
|---|---|
| `01-global-album.png` | 全局相册：左侧按项目、右侧按天分组网格 |
| `02-project-dock.png` | 项目级右侧面板：项目名 + 统计 chips + 搜索 + 网格 |
| `03-lightbox.png` | 灯箱：图左 / 上下文右（当时在做什么、元信息、动作）/ 胶片条在下 |

## 促销图（`docs/promo-zh.png` / `docs/promo-en.png`）

同样只用虚构数据：

- 界面部分：`03-lightbox.png`（上面那张，虚构项目与虚构插画）缩放进右侧窗口；
- 文字、标签、安装命令、背景由 `promotion/make-promo.mjs` 现场排版渲染（Playwright + 本机 Chrome，1600×900 @2x）；
- 不含任何真实项目名、路径、会话或截图。
