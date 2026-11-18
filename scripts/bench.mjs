#!/usr/bin/env node
/**
 * 资源基准：这份插件到底给宿主增加多少 CPU / 内存 / 磁盘。
 *
 *   node scripts/bench.mjs                     # 默认 800 会话 × 6 图
 *   node scripts/bench.mjs --sessions 4000 --images 4
 *   node scripts/bench.mjs --keep              # 保留语料目录（默认跑完删）
 *
 * 测的是插件自己的 core（建索引 / 增量刷新 / 接口进程内缓存），不依赖 DSH 宿主，
 * 所以 macOS / Windows / Linux 上可以跑同一份脚本对比。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { readOrBuildIndex } from '../core/lib/build-index.mjs'
import { createGalleryApi } from '../core/lib/api.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index > -1 ? Number(argv[index + 1]) : fallback
}
const SESSIONS = arg('sessions', 800)
const IMAGES = arg('images', 6)
const KEEP = argv.includes('--keep')

const mb = value => Math.round((value / 1024 / 1024) * 10) / 10
const ms = value => Math.round(value)

function makePng(size = 96) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = crypto.randomBytes((size * 3 + 1) * size)
  for (let row = 0; row < size; row += 1) raw[row * (size * 3 + 1)] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 造一套语料：SESSIONS 个会话、每个 IMAGES 张图。返回目录与「每个工作区」列表。 */
async function makeCorpus(root) {
  const sessionsRoot = path.join(root, 'sessions')
  const attachmentsRoot = path.join(root, 'attachments')
  const storeDir = path.join(root, 'store')
  const workspaces = []
  for (let i = 0; i < Math.min(24, SESSIONS); i += 1) {
    const dir = path.join(root, 'projects', `proj-${i}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'local-note.png'), makePng())
    workspaces.push(dir)
  }

  // 4 张共享附件，模拟同一张图被多个会话引用
  const shas = []
  for (let i = 0; i < 4; i += 1) {
    const png = makePng()
    const sha = crypto.createHash('sha256').update(png).digest('hex')
    const dir = path.join(attachmentsRoot, sha.slice(0, 2))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, sha), png)
    shas.push({ sha, bytes: png.length })
  }

  const base = Date.parse('2026-11-01T09:00:00Z')
  for (let s = 0; s < SESSIONS; s += 1) {
    const projectDir = path.join(sessionsRoot, `--tmp-proj-${s % workspaces.length}--`)
    const sessionId = `session-${s}`
    const dir = path.join(projectDir, sessionId)
    fs.mkdirSync(dir, { recursive: true })
    const started = base + s * 60_000
    const events = [
      { type: 'session', version: 4, id: sessionId, createdAt: started, cwd: workspaces[s % workspaces.length] },
      { type: 'session/title', time: started + 1000, data: { title: `基准会话 ${s}` } },
      { type: 'user/message', time: started + 2000, data: { turn: 1, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '看下这几张图，顺便说一下进展。' }] } },
    ]
    for (let k = 0; k < IMAGES; k += 1) {
      const shared = shas[k % shas.length]
      events.push({
        type: 'tool/result',
        time: started + 3000 + k * 1000,
        data: {
          turn: k + 1,
          step: 1,
          toolCallId: `call-${sessionId}-${k}`,
          message: {
            role: 'tool',
            content: [{
              type: 'image',
              attachment: { attachmentId: `sha256:${shared.sha}`, mediaType: 'image/png', bytes: shared.bytes, width: 96, height: 96, name: `shot-${s}-${k}.png` },
            }],
          },
          meta: { path: path.join(workspaces[s % workspaces.length], `shot-${s}-${k}.png`) },
        },
      })
    }
    events.push({ type: 'turn/end', time: started + 30_000, data: { turn: IMAGES } })
    const frames = zlib.zstdCompressSync(Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n'))
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), frames)
  }

  return { sessionsRoot, attachmentsRoot, storeDir, workspaces }
}

/** 在后台采样 RSS 峰值。 */
function startPeakSampler() {
  let peak = process.memoryUsage().rss
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss
    if (rss > peak) peak = rss
  }, 10)
  return {
    stop() {
      clearInterval(timer)
      return mb(peak)
    },
  }
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sg-bench-'))
  const started = Date.now()
  const corpus = await makeCorpus(root)
  const corpusMs = Date.now() - started

  const rssBefore = process.memoryUsage().rss
  const sampler = startPeakSampler()

  const coldStarted = Date.now()
  const cold = await readOrBuildIndex({ ...corpus, ttlMs: 0 })
  const coldMs = Date.now() - coldStarted
  const coldPeak = sampler.stop()

  const indexBytes = (await fsp.stat(path.join(corpus.storeDir, 'index.json'))).size
  const cacheBytes = (await fsp.stat(path.join(corpus.storeDir, 'scan-cache.json'))).size

  // TTL 内复用：只读盘解析，不扫描
  const ttlStarted = Date.now()
  const reused = await readOrBuildIndex({ ...corpus, ttlMs: 60_000 })
  const ttlMs = Date.now() - ttlStarted

  // 无变化时的一次「过期刷新」：只该有 stat 成本，不该重扫/重写
  const quietStarted = Date.now()
  const quiet = await readOrBuildIndex({ ...corpus, ttlMs: 0, previous: cold, force: true })
  const quietRefreshMs = Date.now() - quietStarted

  // 增量刷新：改一个会话后再刷新
  const one = path.join(corpus.sessionsRoot, '--tmp-proj-0--', 'session-0', 'session.v4.jsonl.zstd')
  const original = await fsp.readFile(one)
  await fsp.appendFile(one, zlib.zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session/title', time: Date.now(), data: { title: '改过标题' } }) + '\n')))
  const refreshStarted = Date.now()
  const refreshed = await readOrBuildIndex({ ...corpus, ttlMs: 0 })
  const refreshMs = Date.now() - refreshStarted

  // 接口层：进程内缓存的 summary 连续 20 次
  const api = createGalleryApi({ ...corpus, getWorkspaces: () => [] })
  const latency = []
  for (let i = 0; i < 20; i += 1) {
    const t = Date.now()
    const response = await api.handle(new Request('http://127.0.0.1/session-gallery/api/summary'))
    await response.arrayBuffer()
    latency.push(Date.now() - t)
  }
  latency.sort((a, b) => a - b)

  const heapAfter = process.memoryUsage()
  const report = {
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    sessions: cold.stats.sessions,
    images: cold.stats.images,
    workspaces: cold.stats.workspaces,
    corpusMs,
    coldMs,
    coldPeakRssMB: coldPeak,
    ttlReuseMs: ttlMs,
    quietRefreshMs,
    incrementalRefreshMs: refreshMs,
    incrementalFresh: refreshed.stats.fresh,
    incrementalReused: refreshed.stats.reused,
    indexJSONMB: mb(indexBytes),
    scanCacheMB: mb(cacheBytes),
    summaryWarmP50Ms: latency[Math.floor(latency.length / 2)],
    summaryWarmMaxMs: latency[latency.length - 1],
    heapUsedMB: mb(heapAfter.heapUsed),
    rssMB: mb(heapAfter.rss),
    rssBeforeMB: mb(rssBefore),
  }
  console.log(JSON.stringify(report, null, 2))

  if (!KEEP) await fsp.rm(root, { recursive: true, force: true })
  else console.log(`corpus kept: ${root}`)
}

await main()
