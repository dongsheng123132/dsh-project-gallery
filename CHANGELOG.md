# Changelog

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
