# Changelog

## 0.1.4 — 2026-11-18

修「卡片和面板一直显示旧图」——索引原来建一次就不再自动重建。

- `readOrBuildIndex` 增加 60 秒 TTL：期内直接复用磁盘索引（不扫盘、不写盘），过期走**增量** `buildIndex`
  （按会话文件 `size/mtime` 复用，只重扫变过的会话），新图 1 分钟内出现。
- 面板底部显示索引年龄（「刚刚更新 / N 分钟前更新」）；「重建索引」仍是强制全量重建。
- 进程内索引缓存 5s → 20s：一次悬停会打好几个接口，别每个都去读 3.7MB 的 index.json。
- 新增 `test/index-refresh.test.mjs`（5 项）：TTL 复用 / 过期增量 / TTL 内旧快照 / 时间倒序（卡片取前 4 张必须是最新）。
- 测试数 21 → 26。

## 0.1.3 — 2026-11-18

演示素材换成公共领域作品；补上「悬停卡片」的对外图。

- `demo/fixtures/` 由程序绘制的 4 张插画换成 **8 张 Met Open Access 公共领域作品（CC0）**，逐张来源见
  `demo/fixtures/LICENSE-IMAGES.md`；演示项目名与对话文案同步改成画册语境。
- 新增 `demo/card.html`：悬停卡片的独立演示页，**卡片样式直接读 `client.js` 的 CSS 块**，不另写一套；
  新增截图 `docs/screenshots-demo/04-hover-card.png` 与透明底 `card-transparent.png`。
- 促销图重做：右侧灯箱 + 左下浮出悬停卡片（1600×900，`promotion/make-promo.mjs`）。
- npm 包不再包含 `demo/` 与 `docs/screenshots-demo/`（README 用 raw URL 引用），安装体积回到 340 KB 量级。

## 0.1.2 — 2026-11-18

回归测试与门面版本；行为不变（只有一处可选配置透传）。

- 新增 `test/plugin.test.mjs`：宿主半片 6 项降级测试——没有 `workspaceRegistry`、没有 `connection`、
  `connection` 拒绝请求（403）、跨源 Origin 被挡、静态页 200、未知接口 404。全部用假 ctx 起真 http 路由。
- `apply()` 支持可选 `config.sessionsRoot`：测试与自定义 DSH home 不用再碰真实的 `~/.dsh/sessions`。
- 新增促销图 `docs/promo-zh.png` / `docs/promo-en.png`（1600×900，左文右界面；界面部分仍是虚构数据），
  生成脚本 `promotion/make-promo.mjs`；README 首图换成它，细节图收进正文。
- 测试数 15 → 21。

## 0.1.1 — 2026-11-18

首个对外可用版本（0.1.0 只走到 npm 暂存占位、未批准，内容被本版取代）。

- 兼容性声明改为只写下界：`engines.dsh: ">=0.2.1-rc.5"`。原草稿带 `<0.3.0` 上界，用宿主自己的
  `evaluatePluginCompatibility` 实测：0.3.0 会直接 `blocked`（装不上），而不是降级。
  现在 0.2.1-rc.5 → 0.3.0 全部 accepted，见 [COMPATIBILITY.md](COMPATIBILITY.md)。
- 新增 `scripts/compat-gate.mjs`：用宿主自带求值器复现安装闸门表，可随宿主升级重跑。
- 新增 `COMPATIBILITY.md`：声明、宿主接口与失效后果表、实测范围（macOS CLI 0.2.2-rc.1 / 桌面 0.2.2-rc.3）。
- 新增英文 README（`README.en.md`）、README 徽章（npm 版本/下载、DSH 实测范围、License）。
- 新增 `promotion/市场推广资料.md`：对外介绍口径与各收录渠道的真实状态。

功能与 0.1.0 相同：

- 三个入口：项目/对话行悬停小卡（可固定、可按项目静音）、侧栏相册面板（按天分组 + 搜索 + 会话图/磁盘图切换）、
  全局相册浮层（📷 / ⌘⇧G）。
- 灯箱：图左、上下文右（时间/尺寸/体积/工具/来源/会话/第几轮/路径），同会话图片排成胶片条，`←/→` 翻页、`Esc` 逐层退回。
- 数据只读本机：会话附件（`~/.dsh/sessions` + `~/.dsh/attachments`）、交付图、项目目录图片（限深 3、近 240 天、单张 ≤30MB）。
- 零运行时依赖；15 项单测；演示图为虚构数据（`docs/screenshots-demo/`，含来源说明）。
