#!/usr/bin/env node
// 用宿主自己的兼容性求值器证明「哪些 DSH 版本会装、哪些会被拦」。
//
// 宿主规则（@deepseek-ai/dsh-app-boot → unmetRequirements）：
//   有 engines.dsh 就只看它，否则看 @deepseek-ai/dsh* 的 peer 区间。
//   被拦 = 安装器直接拒绝，不是运行时降级，所以这里必须可重复复现。
//
// 用法：
//   node scripts/compat-gate.mjs /Applications/"DeepSeek Harness.app"/Contents/Resources/app.asar.unpacked
//   DSH_INSTALL=~/.local/lib/node_modules/@deepseek-ai/dsh node scripts/compat-gate.mjs
//
// 传的是 DSH 安装目录（`@deepseek-ai/dsh` 的根，或桌面版 app.asar.unpacked）。
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const VERSIONS = ['0.2.1-rc.5', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3', '0.2.3', '0.3.0']

const target = process.argv[2] || process.env.DSH_INSTALL
if (!target) {
  console.error('用法: node scripts/compat-gate.mjs <dsh 安装目录>（或设 DSH_INSTALL）')
  process.exit(2)
}

const root = target.replace(/^~(?=$|\/)/, os.homedir())
const evaluator = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')

let mod
try {
  mod = await import(pathToFileURL(evaluator).href)
} catch (error) {
  console.error(`读不到宿主求值器：${evaluator}`)
  console.error(String(error?.message || error))
  process.exit(2)
}
if (typeof mod.evaluatePluginCompatibility !== 'function') {
  console.error('这个宿主版本没有导出 evaluatePluginCompatibility，换一个安装目录再试')
  process.exit(2)
}

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const declared = manifest.engines?.dsh ?? '(未声明)'

console.log(`${manifest.name}@${manifest.version}  engines.dsh=${declared}\n`)
console.log('| host | verdict | 未满足的要求 |')
console.log('| --- | --- | --- |')

let blocked = 0
for (const version of VERSIONS) {
  const issue = mod.evaluatePluginCompatibility(manifest, {}, version)
  const requirements = issue?.requirements ? JSON.stringify(issue.requirements) : ''
  if (issue) blocked += 1
  console.log(`| ${version} | ${issue ? '**blocked**' : 'accepted'} | ${requirements || '—'} |`)
}

console.log(`\n${blocked === 0 ? '全部 accepted' : `${blocked} 个宿主会拦安装`}`)
process.exit(blocked === 0 ? 0 : 1)
