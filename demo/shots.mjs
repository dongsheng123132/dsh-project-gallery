#!/usr/bin/env node
/**
 * 重新生成公开演示图：全部基于虚构数据（demo/mock-server.mjs），
 * 不接触任何真实项目、真实会话、真实截图。
 *
 *   node demo/shots.mjs            # 输出到 docs/screenshots-demo/
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.join(root, 'docs', 'screenshots-demo')
const port = 7798
const base = `http://127.0.0.1:${port}/session-gallery/`

// Playwright 不是运行时依赖（插件本身零依赖）：这里按候选路径解析，
// 也可以用 PLAYWRIGHT_PATH=/path/to/node_modules 指定。
async function loadPlaywright() {
  const require = createRequire(import.meta.url)
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    path.join(root, 'node_modules'),
    path.join(root, '..', 'node_modules'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return require(path.join(candidate, 'playwright'))
    } catch (error) {
      /* 继续找下一个 */
    }
  }
  try {
    return require('playwright')
  } catch (error) {
    console.error('没找到 playwright。装一次即可：npm i -D playwright  （或设 PLAYWRIGHT_PATH=…）')
    process.exit(2)
  }
}

const { chromium } = await loadPlaywright()
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const WATERMARK = `dsh-project-gallery ${pkg.version} · 界面示意（虚构数据）`

await fs.mkdir(out, { recursive: true })
const server = spawn(process.execPath, [path.join(here, 'mock-server.mjs'), '--port', String(port)], { stdio: 'ignore' })
await new Promise(resolve => setTimeout(resolve, 1200))

const shots = [
  { file: '01-global-album.png', url: '?mode=full&theme=light', wait: '.cell' },
  { file: '02-project-dock.png', url: '?mode=dock&path=/demo/demo-atlas&theme=light', wait: '.cell' },
  { file: '03-lightbox.png', url: '?mode=dock&path=/demo/demo-atlas&theme=light', wait: '.cell', click: '.cell' },
  { file: '04-hover-card.png', url: 'card', wait: '.sg-peek-grid img', ready: true },
  { file: '05-right-pane.png', url: 'pane', wait: 'iframe', frameWait: '.cell' },
]

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' })
const page = await context.newPage()
const failures = []
page.on('pageerror', error => failures.push(error.message))

async function mark() {
  await page.evaluate(label => {
    let node = document.getElementById('demo-watermark')
    if (!node) {
      node = document.createElement('div')
      node.id = 'demo-watermark'
      node.style.cssText = 'position:fixed;right:14px;bottom:10px;z-index:99999;font:11px/1.4 -apple-system,system-ui,sans-serif;color:#7b8794;background:#ffffffcc;border:1px solid #e3e8ef;border-radius:6px;padding:3px 8px;pointer-events:none'
      document.body.appendChild(node)
    }
    node.textContent = label
  }, WATERMARK)
  await page.waitForTimeout(250)
}

for (const shot of shots) {
  await page.goto(base + shot.url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(shot.wait, { timeout: 20000 })
  if (shot.ready) await page.waitForFunction(() => document.body.dataset.ready === '1')
  if (shot.frameWait) await page.frameLocator('iframe').locator(shot.frameWait).first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(900)
  if (shot.click) {
    await page.click(shot.click)
    await page.waitForTimeout(1400)
  }
  await mark()
  await page.screenshot({ path: path.join(out, shot.file) })
  console.log(`✓ ${shot.file}`)
}

// 透明底卡片：给促销图当浮层用
{
  const shotContext = await browser.newContext({ viewport: { width: 560, height: 460 }, deviceScaleFactor: 2, colorScheme: 'light', omitBackground: true })
  const shotPage = await shotContext.newPage()
  await shotPage.goto(base + 'card?bg=none', { waitUntil: 'domcontentloaded' })
  await shotPage.waitForFunction(() => document.body.dataset.ready === '1')
  await shotPage.waitForTimeout(300)
  const box = await shotPage.locator('.sg-peek').boundingBox()
  await shotPage.screenshot({
    path: path.join(out, 'card-transparent.png'),
    clip: { x: 0, y: 0, width: Math.ceil(box.width) + 12, height: Math.ceil(box.height) + 12 },
    omitBackground: true,
  })
  console.log('✓ card-transparent.png')
  await shotContext.close()
}

await browser.close()
server.kill()

if (failures.length) {
  console.error('页面报错：', failures.slice(0, 3))
  process.exitCode = 1
}
