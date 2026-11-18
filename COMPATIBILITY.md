# 兼容性：承诺什么、怎么验、坏了怎么退化

这个插件比一般「只加一行菜单」的插件更贴宿主：它挂一个 HTTP 前缀路由，还要在侧栏 DOM 上做悬停几何识别。
所以这里把「哪些版本会装」「装上了靠什么活着」「宿主变了会退化成什么样」分开写清楚。

## 声明

```json
"engines": { "dsh": ">=0.2.1-rc.5", "node": ">=22" }
```

宿主在 `@deepseek-ai/dsh-app-boot` 的 `unmetRequirements` 里**先看 `engines.dsh`**，没有再退到
`@deepseek-ai/dsh*` 的 peer 区间。被拦是安装器直接拒绝，不是运行时降级。

**所以这里刻意不写上界。** 早期草稿写的是 `>=0.2.1-rc.5 <0.3.0`，用宿主自己的求值器实测：0.3.0 直接
`blocked`（`requirements: {"engines.dsh": ">=0.2.1-rc.5 <0.3.0"}`）。一个上界就等于「DSH 一升级，用户
装不上、已装的不让启动」，而我们并没有能力预见 0.3 的接口变化。正确做法是放开声明，让插件在新宿主上
按下面的降级表活着，坏在哪就报在哪。

## 宿主自己的求值器（可复现）

```sh
node scripts/compat-gate.mjs ~/.local/lib/node_modules/@deepseek-ai/dsh
```

`dsh-project-gallery@0.1.0`，2026-11-18 在本机 CLI（0.2.2-rc.1）的 `dsh-app-boot` 求值器上：

| host | verdict | 未满足的要求 |
| --- | --- | --- |
| 0.2.1-rc.5 | accepted | — |
| 0.2.2-rc.1 | accepted | — |
| 0.2.2-rc.2 | accepted | — |
| 0.2.2-rc.3 | accepted | — |
| 0.2.3 | accepted | — |
| 0.3.0 | accepted | — |

这张表只证明**安装闸门**放行，不证明界面能用——界面那层看下一节。

## 用到的宿主接口与失效后果

| 用到的东西 | 提供方 | 宿主没有 / 挪走之后 |
| --- | --- | --- |
| `ctx.webServer.register({ kind: 'prefix', path: '/session-gallery' })` | `dsh-webserver` | 这一行插件起不来（宿主日志报错），DSH 其余部分不受影响 |
| `ctx.get('connection').requestRejection()` | `dsh-connection`（可选） | 跳过鉴权判定，仍保留同源检查；接口照常可用 |
| `ctx.inject(['workspaceRegistry']).list()` | `dsh-workspace`（可选） | 拿不到「DOM 行 → 真实路径」映射，悬停预览失效；`📷` 全局相册不受影响 |
| 宿主 DOM：`[data-row-key^="workspace:"]`、行右侧操作区几何 | Web 客户端 | 悬停/固定卡失效；全局相册与 `⌘⇧G` 仍可用 |

前端还有一层自保：取不到行、取不到几何、鼠标离开，都只是不弹卡；不会往页面里塞常驻节点，也不会改宿主行。

## 实测过的范围（别把这条读成「兼容所有版本」）

| 环境 | 版本 | 验过什么 |
| --- | --- | --- |
| macOS，DSH CLI | 0.2.2-rc.1 | `npm run check` 21/21；`compat-gate` 全部 accepted |
| macOS，DSH 桌面版 | 0.2.2-rc.3 | 日常使用：悬停预览、侧栏相册、全局相册、灯箱、静音 |

**没验过的**：Windows 桌面版；0.2.1-rc.5 只过了安装闸门求值器，没在真机上跑过界面；0.3.x 及以上没测。
声明放开上界不等于承诺这些环境能用，只承诺「装得上、坏了按上表降级」。

## 宿主大版本升级后怎么复查

1. 跑 `node scripts/compat-gate.mjs <新宿主安装目录>`，先确认闸门放行；
2. 打开 DSH，确认左侧出现 `📷` 入口，`⌘⇧G` 能开全局相册；
3. 悬停项目行，确认能出小卡；出不来就是 `data-row-key` 或几何变了，改 `client.js` 里的选择器；
4. 有变化就更新本文件的表，并补一条 `CHANGELOG.md`。
