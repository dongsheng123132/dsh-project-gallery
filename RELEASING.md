# 发版手册（维护者用）

发布是不可回滚的公开动作；每一步都有判据，不看判据就宣布成功算违规。

## 0. 环境

```sh
export npm_config_cache=/tmp/npmcache-pg   # 系统 ~/.npm 可能有 root 属主文件，会 EPERM
npm whoami --registry=https://registry.npmjs.org   # 应为 hfshfg
```

registry 一律显式写 `https://registry.npmjs.org`。

## 1. 改版本 + 跑门禁

```sh
# package.json: 修 bug → patch；改契约/行为 → minor
npm run check     # 语法 + 15 项单测，必须 0 fail
```

## 2. 打包自检

```sh
npm pack
tar tzf dsh-project-gallery-<version>.tgz | sort
```

必须满足：有 `adapters/dsh-plugin/plugin.mjs`、`client.js`、`cordis.patch.yml`、`core/`、`web/`；
没有 `node_modules/`、没有 `*.tgz` 自身；`tar xzOf ... package/package.json` 里 `engines.dsh` 为预期值。

## 3. 发布

```sh
npm publish --registry=https://registry.npmjs.org
```

判据（三条都要）：

```sh
npm view dsh-project-gallery dist-tags.latest      # 必须等于新版本
npm view dsh-project-gallery@<version> dist.tarball
```

**首发可能落 staged publish**（`0.0.0-stage`）：去 npmjs 包页面用 2FA 点 Approve，或 `npm publish --otp=<恢复码>`。
CDN 有 2–3 分钟传播延迟，别因旧版本号重复发布。

## 4. Git + Release + Discover 索引

```sh
git commit -am "release: dsh-project-gallery <version>"
git tag v<version> && git push origin main --tags
gh release create v<version> --notes-file /tmp/relnotes.md
```

`plugin-index.json` 里的 `versions` 换成新版本：

- npm 已发布 → `source: { "type": "npm" }`，`publishTimestamp` 用真实发布时刻；
- 仅 GitHub 可装 → `source: { "type": "git", "url": ..., "commit": "<40 位 sha>" }`。
- 改完用宿主自带校验器过一遍（`@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex`），拿到 VALID 再推。

## 5. 目录收录

- 1024 商店（`imsai-sh/awesome-deepseek-harness-plugins`）：`catalog/plugins/<owner>--<repo>.json`，
  只加这一个文件，bot 静态审查通过后自动合并；npm 发布后安装命令由自动检测补上。
- `awesome-dsh-plugin`（2.3 万星）：仓库创建满 1 天才收，条目 PR 走人工。
- `oh-my-dsh/dsh-plugin-registry`：每周一 03:17 UTC 爬虫按 `topic:dsh` + `topic:dsh-plugin` 抓候选；
  正式登记要单独 PR（`registry/entries/<owner>/<slug>.json`，钉 40 位 commit）。
