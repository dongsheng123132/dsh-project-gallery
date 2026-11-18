// 索引刷新语义：60 秒内复用、过期后增量重建、新会话/新图能出现。
// 这些都是「卡片显示旧图」那个 bug 的回归测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { INDEX_TTL_MS, buildIndex, readOrBuildIndex } from '../core/lib/build-index.mjs'

function makePng(width = 90, height = 90) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = crypto.randomBytes((width * 3 + 1) * height)
  for (let row = 0; row < height; row += 1) raw[row * (width * 3 + 1)] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-refresh-'))
  const sessionsRoot = path.join(root, 'sessions')
  const attachmentsRoot = path.join(root, 'attachments')
  const storeDir = path.join(root, 'store')
  const workspace = path.join(root, 'project')
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(storeDir, { recursive: true })
  return { root, sessionsRoot, attachmentsRoot, storeDir, workspace }
}

let counter = 0

/** 往 fixture 里加一个会话：一个用户消息 + 一次 read_image 产生的图。 */
function addSession(fixture, { title, timestamp }) {
  counter += 1
  const png = makePng()
  const sha = crypto.createHash('sha256').update(png).digest('hex')
  const attachDir = path.join(fixture.attachmentsRoot, sha.slice(0, 2))
  fs.mkdirSync(attachDir, { recursive: true })
  fs.writeFileSync(path.join(attachDir, sha), png)

  const sessionId = `session-${counter}`
  const dir = path.join(fixture.sessionsRoot, '--tmp-project--', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const events = [
    { type: 'session', version: 4, id: sessionId, createdAt: timestamp, cwd: fixture.workspace },
    { type: 'session/title', time: timestamp + 1, data: { title } },
    {
      type: 'tool/result',
      time: timestamp + 2,
      data: {
        turn: 1,
        step: 1,
        toolCallId: 'call_' + sessionId,
        message: {
          role: 'tool',
          content: [{ type: 'image', attachment: { attachmentId: `sha256:${sha}`, mediaType: 'image/png', bytes: png.length, width: 90, height: 90, name: `${sessionId}.png` } }],
        },
        meta: { path: `/tmp/${sessionId}.png` },
      },
    },
  ]
  const frames = zlib.zstdCompressSync(Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n'))
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), frames)
  return sha
}

function countImages(index) {
  return index.stats.images
}

test('TTL 内复用磁盘索引，不重复扫盘', async () => {
  const fixture = setup()
  addSession(fixture, { title: '第一次', timestamp: 1700000000000 })
  const first = await buildIndex(fixture)
  const second = await readOrBuildIndex(fixture)
  assert.equal(second.builtAt, first.builtAt, 'TTL 内应直接返回同一份索引')
  assert.equal(countImages(second), 1)
})

test('默认 TTL 是 60 秒', () => {
  assert.equal(INDEX_TTL_MS, 60_000)
})

test('过期后增量重建：新会话的图能出现，旧会话不重扫', async () => {
  const fixture = setup()
  addSession(fixture, { title: '旧会话', timestamp: 1700000000000 })
  await buildIndex(fixture)

  addSession(fixture, { title: '新会话', timestamp: 1700000100000 })
  const fresh = await readOrBuildIndex({ ...fixture, ttlMs: 0 })
  assert.equal(countImages(fresh), 2, '新加会话的图必须出现')
  assert.ok(fresh.stats.fresh >= 1, '变过的会话要被重扫')
  assert.ok(fresh.stats.reused >= 1, '没变过的会话要复用，不能全量重扫')
})

test('TTL 内仍看到旧快照（说明为什么要有 60s 刷新）', async () => {
  const fixture = setup()
  addSession(fixture, { title: '旧会话', timestamp: 1700000000000 })
  await buildIndex(fixture)
  addSession(fixture, { title: '刚加的会话', timestamp: 1700000100000 })

  const stale = await readOrBuildIndex({ ...fixture, ttlMs: 60_000 })
  assert.equal(countImages(stale), 1, 'TTL 内复用旧索引是预期行为')

  const after = await readOrBuildIndex({ ...fixture, ttlMs: 0 })
  assert.equal(countImages(after), 2, '强制刷新后必须看到新图')
})

test('索引按时间倒序：最新一张排在最前', async () => {
  const fixture = setup()
  addSession(fixture, { title: '更早', timestamp: 1700000000000 })
  addSession(fixture, { title: '更晚', timestamp: 1700000100000 })
  const index = await buildIndex(fixture)
  const workspace = index.workspaces[0]
  const timestamps = workspace.images.map(image => image.ts)
  const sorted = [...timestamps].sort((a, b) => b - a)
  assert.deepEqual(timestamps, sorted, 'images 必须按时间倒序，卡片取前 4 张才是最新')
})
