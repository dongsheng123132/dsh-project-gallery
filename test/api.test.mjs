// 图库 API 端到端测试：造一个假 sessions + 假 attachments，走真实 Request → Response 路径。
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createGalleryApi } from '../core/lib/api.mjs'

/** 造一张够真（体积过 2KB 噪声阈值）的 PNG，避免依赖外部图片库。 */
function makePng(width = 120, height = 120) {
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor
  // 像素用随机噪声，保证压缩后仍 >2KB（扫描器的噪声阈值）
  const raw = crypto.randomBytes((width * 3 + 1) * height)
  for (let row = 0; row < height; row += 1) raw[row * (width * 3 + 1)] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PNG_1PX = makePng()

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-api-'))
  const sessionsRoot = path.join(root, 'sessions')
  const attachmentsRoot = path.join(root, 'attachments')
  const storeDir = path.join(root, 'store')
  const workspaceDir = path.join(root, 'workspace')
  fs.mkdirSync(workspaceDir, { recursive: true })
  fs.writeFileSync(path.join(workspaceDir, 'design.png'), PNG_1PX)

  const sha = 'a'.repeat(64)
  const sha2 = 'b'.repeat(64)
  const attachDir = path.join(attachmentsRoot, sha.slice(0, 2))
  fs.mkdirSync(attachDir, { recursive: true })
  fs.writeFileSync(path.join(attachDir, sha), PNG_1PX)
  fs.mkdirSync(path.join(attachmentsRoot, sha2.slice(0, 2)), { recursive: true })
  fs.writeFileSync(path.join(attachmentsRoot, sha2.slice(0, 2), sha2), PNG_1PX)

  const projectDir = path.join(sessionsRoot, '--tmp-sg-workspace--')
  const sessionDir = path.join(projectDir, 'session-test')
  fs.mkdirSync(sessionDir, { recursive: true })
  const events = [
    { type: 'session', version: 4, id: 'session-test', createdAt: 1700000000000, cwd: workspaceDir },
    { type: 'session/title', time: 1700000001000, data: { title: '做一张首页设计稿' } },
    {
      type: 'user/message',
      time: 1700000002000,
      data: { turn: 1, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把首页做成深色，截个图' }] },
    },
    { type: 'tool/call', time: 1700000003000, data: { turn: 1, step: 1, callId: 'call_a', name: 'read_image', arguments: '{}' } },
    {
      type: 'tool/result',
      time: 1700000004000,
      data: {
        turn: 1,
        step: 1,
        toolCallId: 'call_a',
        message: {
          role: 'tool',
          content: [
            {
              type: 'image',
              attachment: { attachmentId: `sha256:${sha}`, mediaType: 'image/png', bytes: PNG_1PX.length, width: 1, height: 1, name: 'shot.png' },
            },
          ],
        },
        meta: { path: '/tmp/shot.png' },
      },
    },
    { type: 'todo/write', time: 1700000005000, data: { todos: [{ content: '做设计稿', status: 'completed' }] } },
    { type: 'turn/end', time: 1700000006000, data: { turn: 1 } },
  ]
  const frames = zlib.zstdCompressSync(Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n'))
  fs.writeFileSync(path.join(sessionDir, 'session.v4.jsonl.zstd'), frames)

  const api = createGalleryApi({
    storeDir,
    attachmentsRoot,
    sessionsRoot,
    getWorkspaces: () => [{ id: 'ws-1', path: workspaceDir, title: 'demo' }],
  })
  return { root, sessionsRoot, attachmentsRoot, storeDir, workspaceDir, sha, api }
}

function request(url, init) {
  return new Request(url, init)
}

test('summary 把宿主的 workspace id 与索引里的图片对上', async () => {
  const fixture = makeFixture()
  const response = await fixture.api.handle(request('http://127.0.0.1/session-gallery/api/summary'))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.stats.sessions, 1)
  assert.equal(body.stats.images, 1)
  const workspace = body.workspaces.find(entry => entry.path === fixture.workspaceDir)
  assert.ok(workspace, '应按 cwd 归到工作区')
  assert.equal(workspace.id, 'ws-1', '宿主 registry 的 id 要能映射进来')
  assert.equal(workspace.name, 'workspace')
  assert.equal(workspace.thumbs[0].sha, fixture.sha)
  assert.equal(workspace.todos.total, 1)
})

test('workspace 详情同时给会话图与磁盘图', async () => {
  const fixture = makeFixture()
  const url = `http://127.0.0.1/session-gallery/api/workspace?path=${encodeURIComponent(fixture.workspaceDir)}`
  const body = await (await fixture.api.handle(request(url))).json()
  assert.equal(body.ok, true)
  const sources = body.images.map(image => image.source)
  assert.ok(sources.includes('session'), '要包含会话图')
  assert.ok(sources.includes('file'), '要包含磁盘图 design.png')
  const sessionImage = body.images.find(image => image.source === 'session')
  assert.equal(sessionImage.prompt, '把首页做成深色，截个图')
  assert.equal(sessionImage.tool, 'read_image')
})

test('指定会话时不混入工作区磁盘图片', async () => {
  const fixture = makeFixture()
  const url = `http://127.0.0.1/session-gallery/api/workspace?path=${encodeURIComponent(fixture.workspaceDir)}&session=session-test`
  const body = await (await fixture.api.handle(request(url))).json()
  assert.equal(body.images.length, 1)
  assert.equal(body.images[0].sessionId, 'session-test')
  assert.equal(body.workspace.fileImageCount, 0)
})

test('同一附件出现在两个会话时两个会话均能找到', async () => {
  const fixture = makeFixture()
  const project = path.join(fixture.sessionsRoot, '--tmp-sg-workspace--')
  const first = path.join(project, 'session-test', 'session.v4.jsonl.zstd')
  const text = zlib.zstdDecompressSync(fs.readFileSync(first)).toString('utf8')
  const second = path.join(project, 'session-other')
  fs.mkdirSync(second)
  fs.writeFileSync(path.join(second, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(text.replaceAll('session-test', 'session-other'))))
  for (const id of ['session-test', 'session-other']) {
    const response = await fixture.api.handle(request(`http://127.0.0.1/session-gallery/api/session?id=${id}`))
    const body = await response.json()
    assert.equal(body.images.length, 1, id)
    assert.equal(body.images[0].sha, fixture.sha)
    assert.equal(body.images[0].sessionId, id)
  }
})

test('session 详情按会话 id 过滤', async () => {
  const fixture = makeFixture()
  const body = await (await fixture.api.handle(request('http://127.0.0.1/session-gallery/api/session?id=session-test'))).json()
  assert.equal(body.ok, true)
  assert.equal(body.session.title, '做一张首页设计稿')
  assert.equal(body.images.length, 1)
})

test('缩略图会真的被 sips 生成并缓存', async () => {
  const fixture = makeFixture()
  const url = `http://127.0.0.1/session-gallery/api/thumb?sha=${fixture.sha}&w=320`
  const first = await fixture.api.handle(request(url))
  assert.equal(first.status, 200)
  const bytes = Buffer.from(await first.arrayBuffer())
  assert.ok(bytes.length > 0, '缩略图不能是空文件')
  const cacheDir = path.join(fixture.storeDir, 'thumbs')
  const files = fs.readdirSync(cacheDir)
  assert.ok(files.some(name => name.includes(fixture.sha.slice(0, 8))), '缓存文件名要带 sha 前缀')
  const second = await fixture.api.handle(request(url))
  assert.equal(second.status, 200)
})

test('磁盘图路径不在工作区内时拒绝读取（防任意文件读取）', async () => {
  const fixture = makeFixture()
  const url = `http://127.0.0.1/session-gallery/api/file?path=${encodeURIComponent('/etc/hosts')}`
  const response = await fixture.api.handle(request(url))
  assert.equal(response.status, 403)
})

test('未知接口返回 404 而不是抛错', async () => {
  const fixture = makeFixture()
  const response = await fixture.api.handle(request('http://127.0.0.1/session-gallery/api/nope'))
  assert.equal(response.status, 404)
})

test('sha 参数不能被路径穿越（曾经的任意文件读取口）', async () => {
  const fixture = makeFixture()
  const evil = encodeURIComponent('../../../../../../../../etc/hosts')
  for (const route of ['file', 'thumb']) {
    const response = await fixture.api.handle(request(`http://127.0.0.1/session-gallery/api/${route}?sha=${evil}&w=320`))
    assert.ok([400, 403, 404].includes(response.status), `${route}?sha= 必须被拒绝，实际 ${response.status}`)
    const body = await response.text()
    assert.equal(body.includes('localhost'), false, '绝不能把 /etc/hosts 内容吐出来')
  }
})

test('非 sha256 形状的标识一律拒绝', async () => {
  const fixture = makeFixture()
  const response = await fixture.api.handle(request('http://127.0.0.1/session-gallery/api/file?sha=deadbeef'))
  assert.equal(response.status, 400)
})
