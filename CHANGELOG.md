# Changelog

## 0.1.9 — 2026-11-18

「全部项目」多了一个**看板**视图：一行一个项目，直接当进度看板用。

- 网格 / 看板切换（只在「全部项目」下出现）。
- 看板行：项目名 + `N 张 · N 次会话 · 最后活动 X 前 · 改文件 / 跑命令` + **待办进度条** + 最新 3 张缩略图；
  点一行直接进那个项目的相册。
- 排序按最后活动时间倒序：最近动过的项目在最上面。
- 新增演示图 `docs/screenshots-demo/06-project-board.png`（虚构数据 + CC0 作品）。

## 0.1.8 — 2026-11-18

把「看什么」讲清楚：三个维度 + 来源筛选，并换掉会误导人的「磁盘图」叫法。

- 右栏/面板新增**范围按钮**：本次对话 / 当前项目 / 全部项目。默认按上下文落位（有会话 → 本次对话；有项目 → 当前项目；否则全部）。
  右栏 tab 被宿主绑在某个会话上时，正文会自动带上 `session`，默认就停在「本次对话」。
- 「磁盘图」改名 **「项目目录」** 并加说明：只扫当前项目目录（限深 3、跳过 `node_modules/.git/dist`、近 240 天、单张 ≤30MB），
  **不是全盘图片检索**。
- 「全部项目」保持按天分组的最新图，可以用作轻量进度监控板（哪个项目最近出了图，一眼看到）。
- 演示图 `05-right-pane.png` 改为深色右栏版（仍是 CC0 公共领域作品 + 虚构会话）。

## 0.1.7 — 2026-11-18

修 0.1.6 的回归：整理右侧栏代码时误删了键盘与 iframe 消息监听（⌘⇧G、Esc 分层退出、面板 expand/collapse/close 全失效）。
0.1.6 已 deprecate，请用本版。

- 恢复 `document keydown`（⌘⇧G 开合全局相册、Esc 按层退回）、`⌥` 强制预览、`window resize` 重摆面板、
  以及 `dsh-gallery:expand/collapse/close/open-session` 的 iframe 消息处理。
- 新增 `test/client-tab.test.mjs`：在假 window/document 里把 client.js 装一遍，断言右栏 tab 注册、
  正文席位、消息驱动打开右栏都成立——这次就是它先抓到的 bug。
- 右侧栏 tab 本身不变（仍走 host 的 sidebarRightTabs + slots 席位）。

## 0.1.6 — 2026-11-18

新增「右侧栏 · 项目相册 tab」——把相册变成常驻右栏，而不是每次点开浮层。

- 走宿主正式席位 `ctx.sidebarRightTabs.register({ id, kind, priority:'extension', keepMounted, guide })`
  + `ctx.slots.register({ name:'sidebar.right.pane.tab', key: id })`；宿主右栏 8 类 tab 里没有图片类，这一格原本是空的。
- 右栏正文是一个同源 iframe：带 `path` 就落成该项目的相册，带 `session` 就落成会话相册，都不带就是「最新图片」。
- 面板/右栏新增「停靠到右侧」按钮（⇥），把当前正在看的面板搬进右栏；「更多工具」引导页也能直接打开。
- 面板顶部新增**进展条**（待办完成度），配合原有 chips（会话图/磁盘图/改文件/跑命令）一起看进展。
- 老宿主没有这套席位时整段跳过，悬停卡片与浮层照常工作（不抛错、不影响其它功能）。
- 新增演示图 `docs/screenshots-demo/05-right-pane.png`（对话 + 右栏相册）。

## 0.1.5 — 2026-11-18

降负载：把「每分钟重写 7MB」和「浏览器每秒轮询」去掉，并留下可复跑的实测数据。

- 新增 `index.state.json`（几十字节）：记录索引时间与「会话文件签名」。过期后先读它；
  **签名没变就只 stat 会话文件**（不解析 2.9MB 索引、不重扫、不重写）——无变化刷新 macOS 145ms / Windows 297ms。
- 真有变化才重写 `index.json` + `scan-cache.json`；没有变化只写几十字节状态文件。
- 浏览器端去掉 `setInterval(ensureHeaderButton, 1200)` 的常驻轮询，改成 MutationObserver 等宿主头部出现（最多 12 秒）。
- 进程内索引缓存 20s → 60s，与磁盘 TTL 对齐，悬停不再每 20 秒回读磁盘。
- 新增 `scripts/bench.mjs`（`npm run bench`）与 [PERF.md](PERF.md)：macOS 与 Windows 两平台实测（冷建、刷新、内存、磁盘）。

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
