#!/usr/bin/env node
// 零依赖 CLI：先在终端把数据跑通，再让 UI 当它的另一个前端。
//
//   node core/bin/cli.mjs index            重建索引（增量）
//   node core/bin/cli.mjs report [--top N] 人读摘要：多少工作区/会话/图
//   node core/bin/cli.mjs json [--pretty]  输出索引 JSON
//   node core/bin/cli.mjs ws <关键词>       某个工作区的图片清单
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, readOrBuildIndex, defaultStoreDir } from '../lib/build-index.mjs'
import { summarizeUsage } from '../lib/usage.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[index + 1]
      if (next && !next.startsWith('--')) {
        args[key] = next
        index += 1
      } else {
        args[key] = true
      }
    } else {
      args._.push(token)
    }
  }
  return args
}

function kb(bytes) {
  return bytes > 1024 * 1024 ? (bytes / 1048576).toFixed(1) + 'MB' : Math.round(bytes / 1024) + 'KB'
}

function ago(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const day = 86400000
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前'
  if (diff < day) return Math.round(diff / 3600000) + ' 小时前'
  return Math.round(diff / day) + ' 天前'
}

const command = process.argv[2]
const args = parseArgs(process.argv.slice(3))

if (command === 'usage') {
  const summary = summarizeUsage(defaultStoreDir(), Number(args.days || 28))
  console.log(`近 ${summary.windowDays} 天：${summary.totalEvents} 条事件 · 最近 7 天主动打开 ${summary.activeDaysLast7} 天`)
  console.log(`结论：${summary.verdict}`)
  console.log('')
  console.log('按事件：')
  for (const [event, count] of summary.byEvent) console.log(`  ${event.padEnd(16)} ${count}`)
  console.log('')
  console.log('按天（最近 14 天有记录的）：')
  for (const [day, count] of summary.byDay.slice(-14)) console.log(`  ${day}  ${count}`)
  console.log('')
  console.log('最常看的项目（短哈希）：')
  for (const [scope, count] of summary.topScopes.slice(0, 5)) console.log(`  ${scope}  ${count}`)
} else if (command === 'index') {
  const index = await buildIndex({ log: message => console.log(message) })
  console.log(JSON.stringify(index.stats))
} else if (command === 'json') {
  const index = await readOrBuildIndex({})
  console.log(args.pretty ? JSON.stringify(index, null, 2) : JSON.stringify(index))
} else if (command === 'ws') {
  const keyword = (args._[0] || '').toLowerCase()
  const index = await readOrBuildIndex({})
  const hits = index.workspaces.filter(workspace => workspace.path.toLowerCase().includes(keyword))
  for (const workspace of hits.slice(0, 8)) {
    console.log(`\n${workspace.name}  [${workspace.images.length} 图 / ${workspace.sessions.length} 会话]  ${workspace.path}`)
    for (const image of workspace.images.slice(0, 6)) {
      console.log(`  ${new Date(image.ts).toISOString().slice(0, 16)}  ${image.width}x${image.height} ${kb(image.bytes)}  ${image.tool || '-'}  ${image.name}`)
      if (image.prompt) console.log(`      诉求：${image.prompt}`)
    }
  }
  if (!hits.length) console.log('没有匹配的工作区')
} else {
  const index = await readOrBuildIndex({})
  const top = Number(args.top || 12)
  console.log(`索引：${path.join(defaultStoreDir(), 'index.json')}  建于 ${new Date(index.builtAt).toLocaleString('zh-CN')}  ${index.ms}ms`)
  console.log(`统计：${index.stats.workspaces} 工作区 / ${index.stats.sessions} 会话 / ${index.stats.images} 图（去重后）`)
  const withImages = index.workspaces.filter(workspace => workspace.images.length > 0)
  console.log(`有图的工作区：${withImages.length} 个`)
  const totalBytes = index.workspaces.reduce((sum, workspace) => sum + workspace.images.reduce((inner, image) => inner + image.bytes, 0), 0)
  console.log(`图片总体积：${kb(totalBytes)}`)
  console.log('')
  for (const workspace of withImages.slice(0, top)) {
    const latest = workspace.images[0]
    const todos = workspace.todos ? `待办 ${workspace.todos.done}/${workspace.todos.total}` : '无待办'
    console.log(
      `${String(workspace.images.length).padStart(4)} 图  ${String(workspace.sessions.length).padStart(3)} 会话  ${ago(workspace.lastActivity).padStart(8)}  ${todos.padEnd(12)} ${workspace.name}`,
    )
    console.log(`      ${latest.name}  ${latest.width}x${latest.height}  ${latest.tool || '-'}  诉求：${latest.prompt || '（未记到）'}`)
  }
}
