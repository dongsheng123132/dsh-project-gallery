#!/usr/bin/env node
/**
 * 生成对外促销图（1600×900）：左文右界面。
 * 界面部分用 docs/screenshots-demo/ 的虚构数据截图（demo/shots.mjs 生成），
 * 不接触任何真实项目 / 会话 / 路径。
 *
 *   node promotion/make-promo.mjs            # 输出 docs/promo-zh.png 与 docs/promo-en.png
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// playwright 不是运行时依赖：按候选路径解析，也可用 PLAYWRIGHT_PATH=… 指定
function loadPlaywright() {
  const require = createRequire(import.meta.url)
  const base = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [process.env.PLAYWRIGHT_PATH, path.resolve(base, '..', 'node_modules'), path.resolve(base, '..', '..', 'node_modules')].filter(Boolean)
  for (const candidate of candidates) {
    try { return require(path.join(candidate, 'playwright')) } catch { /* 下一个 */ }
  }
  try { return require('playwright') } catch {
    console.error('没找到 playwright：npm i -D playwright，或设 PLAYWRIGHT_PATH=<node_modules 目录>')
    process.exit(2)
  }
}
const { chromium } = loadPlaywright()

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const shotPath = path.join(root, 'docs', 'screenshots-demo', '03-lightbox.png')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))

const shot = (await fs.readFile(shotPath)).toString('base64')

const copy = {
  zh: {
    file: 'docs/promo-zh.png',
    chip: 'DSH 插件 · 项目相册',
    h1: ['图都散了，', '一册收齐。'],
    body: [
      '会话里 AI 看过、生成过、交付过的图，',
      '加上项目目录里的图，按项目攒成一册；',
      '点开大图，右边就是当时你让它做什么。',
    ],
    tags: ['只读本机', '零运行时依赖', 'DSH 0.2.1+', 'MIT 开源'],
    install: 'npm i dsh-project-gallery',
    repo: 'github.com/dongsheng123132/dsh-project-gallery',
  },
  en: {
    file: 'docs/promo-en.png',
    chip: 'DSH plugin · Project Gallery',
    h1: ['Every image,', 'one album.'],
    body: [
      'Session images, deliverables and images in the',
      'project folder, gathered per project — open one',
      'and the conversation behind it is right there.',
    ],
    tags: ['Local only', 'Zero runtime deps', 'DSH 0.2.1+', 'MIT'],
    install: 'npm i dsh-project-gallery',
    repo: 'github.com/dongsheng123132/dsh-project-gallery',
  },
}

const html = c => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1600px; height: 900px; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif;
    background: #f6f4ef;
    color: #14161a;
    position: relative;
  }
  .wash { position: absolute; inset: 0; overflow: hidden; }
  .wash i { position: absolute; display: block; border-radius: 50%; filter: blur(90px); opacity: .55; }
  .wash i:nth-child(1) { width: 720px; height: 720px; left: 780px; top: -260px; background: #dfe8ff; }
  .wash i:nth-child(2) { width: 620px; height: 620px; left: 1120px; top: 420px; background: #e6efe3; }
  .wash i:nth-child(3) { width: 520px; height: 520px; left: -180px; top: 520px; background: #f2e7dc; }

  .left { position: absolute; left: 88px; top: 96px; width: 660px; }
  .chip {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 16px; border-radius: 999px; background: #fff;
    border: 1px solid #e7e2d8; font-size: 17px; color: #3d4350;
    box-shadow: 0 2px 10px rgba(20,22,26,.04);
  }
  .chip b { width: 9px; height: 9px; border-radius: 50%; background: #2f6bff; }
  h1 { margin-top: 34px; font-size: 86px; line-height: 1.08; letter-spacing: -1.5px; font-weight: 800; }
  h1 em { font-style: normal; color: #2f6bff; }
  p.body { margin-top: 30px; font-size: 25px; line-height: 1.62; color: #3f4552; }
  .tags { display: flex; gap: 12px; margin-top: 34px; flex-wrap: wrap; }
  .tags span {
    padding: 10px 16px; border-radius: 10px; background: #fff; border: 1px solid #e7e2d8;
    font-size: 18px; color: #343a46;
  }
  .install {
    position: absolute; left: 88px; bottom: 92px;
    display: inline-flex; align-items: center;
    padding: 16px 24px; border-radius: 14px; background: #14161a; color: #f7f7f5;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 21px;
    box-shadow: 0 10px 26px rgba(20,22,26,.16);
  }
  .repo { position: absolute; left: 90px; bottom: 56px; font-size: 17px; color: #6b7280; }

  .shot {
    position: absolute; right: 64px; top: 112px; width: 760px;
    border-radius: 20px; overflow: hidden; background: #fff;
    box-shadow: 0 30px 70px rgba(20,22,26,.18), 0 2px 6px rgba(20,22,26,.08);
    border: 1px solid rgba(20,22,26,.06);
  }
  .shot img { display: block; width: 100%; height: auto; }
</style></head><body>
  <div class="wash"><i></i><i></i><i></i></div>
  <div class="left">
    <div class="chip"><b></b>${c.chip}</div>
    <h1>${c.h1[0]}<br><em>${c.h1[1]}</em></h1>
    <p class="body">${c.body.join('<br>')}</p>
    <div class="tags">${c.tags.map(t => `<span>${t}</span>`).join('')}</div>
  </div>
  <div class="install">${c.install}</div>
  <div class="repo">${c.repo}</div>
  <div class="shot"><img src="data:image/png;base64,${shot}" alt=""></div>
</body></html>`

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
for (const c of Object.values(copy)) {
  await page.setContent(html(c), { waitUntil: 'load' })
  await page.locator('.shot img').evaluate(img => img.decode())
  const outPath = path.join(root, c.file)
  await page.screenshot({ path: outPath, type: 'png' })
  const size = (await fs.stat(outPath)).size
  console.log(`${c.file}  ${(size / 1024).toFixed(0)} KB`)
}
await browser.close()
