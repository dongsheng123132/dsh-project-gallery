// 本地使用埋点：只记「发生了什么」，不记图、不记内容、不联网。
//
// 为什么需要它：会审给的去留门槛是「每周主动打开图库 ≥3 次」——没有这个数字，
// 后面所有「要不要继续做」的判断都是猜的。所以先量起来，而且量得尽量少：
//   { t: 毫秒时间戳, e: 事件名, s: 工作区短哈希 }
// 事件白名单写死，其它一律丢弃；不记路径原文（避免泄漏项目名）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

export const USAGE_EVENTS = new Set(['open-full', 'hover-strip', 'open-dock', 'open-lightbox', 'open-session', 'rebuild-index', 'focus-workspace'])

function usageFile(storeDir) {
  return path.join(storeDir || path.join(os.homedir(), '.dsh', 'cache', 'dsh-session-gallery'), 'usage.jsonl')
}

/** 工作区路径 → 8 位短哈希（同一项目稳定，但不能反推路径）。 */
export function scopeHash(workspacePath) {
  if (!workspacePath) return ''
  return createHash('sha256').update(String(workspacePath)).digest('hex').slice(0, 8)
}

/** 追加一条使用记录；失败一律吞掉——埋点绝不能影响看图。 */
export function recordUsage(storeDir, event, scope) {
  if (!USAGE_EVENTS.has(event)) return false
  try {
    const file = usageFile(storeDir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ t: Date.now(), e: event, s: scopeHash(scope) }) + '\n')
    return true
  } catch (error) {
    return false
  }
}

/** 读全部记录（坏行跳过）。 */
export function readUsage(storeDir) {
  const file = usageFile(storeDir)
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    return []
  }
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (row && typeof row.t === 'number' && USAGE_EVENTS.has(row.e)) rows.push(row)
    } catch (error) {
      /* 坏行跳过 */
    }
  }
  return rows
}

/** 汇总：按周看「有几天真的打开过图库」。 */
export function summarizeUsage(storeDir, days = 28) {
  const now = Date.now()
  const since = now - days * 86400000
  const rows = readUsage(storeDir).filter(row => row.t >= since)
  const byDay = new Map()
  const byEvent = new Map()
  const byScope = new Map()
  for (const row of rows) {
    const day = new Date(row.t).toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) || 0) + 1)
    byEvent.set(row.e, (byEvent.get(row.e) || 0) + 1)
    if (row.s) byScope.set(row.s, (byScope.get(row.s) || 0) + 1)
  }
  // 最近 7 天里「主动打开」的天数（不含悬停这种被动行为）
  const activeDays = new Set()
  for (const row of rows) {
    if (row.t < now - 7 * 86400000) continue
    if (row.e === 'hover-strip') continue
    activeDays.add(new Date(row.t).toISOString().slice(0, 10))
  }
  return {
    windowDays: days,
    totalEvents: rows.length,
    activeDaysLast7: activeDays.size,
    byDay: [...byDay.entries()].sort(),
    byEvent: [...byEvent.entries()].sort((a, b) => b[1] - a[1]),
    topScopes: [...byScope.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    verdict:
      activeDays.size >= 3
        ? '达到会审门槛：一周内主动打开 ≥3 天，值得继续投入'
        : activeDays.size > 0
          ? `未达门槛（${activeDays.size}/3 天）——再观察，别急着加功能`
          : '这几周没有主动打开记录：要么没用起来，要么入口不够显眼',
  }
}
