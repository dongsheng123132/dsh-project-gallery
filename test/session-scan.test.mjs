// 会话日志解析的单元测试：造一份「多帧 zstd」会话日志，验证 cwd/标题/图片上下文/待办。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { scanSessionFile } from '../core/lib/scan-session.mjs'
import { readSessionText } from '../core/lib/frames.mjs'

function writeZstdFrames(file, events) {
  // 真实日志是「一帧一段」追加写，这里按每 5 条一帧模拟
  const frames = []
  for (let index = 0; index < events.length; index += 5) {
    const chunk = events
      .slice(index, index + 5)
      .map(event => JSON.stringify(event))
      .join('\n')
    frames.push(zlib.zstdCompressSync(Buffer.from(chunk + '\n')))
  }
  fs.writeFileSync(file, Buffer.concat(frames))
}

const header = { type: 'session', version: 4, id: 'session-abc', createdAt: 1700000000000, cwd: '/tmp/demo-project' }
const title = { type: 'session/title', time: 1700000001000, data: { title: '做一个天气小组件' } }
const humanMessage = {
  type: 'user/message',
  time: 1700000002000,
  data: { turn: 1, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我把首页改成深色，并截个图看看' }] },
}
const contextMessage = {
  type: 'user/message',
  time: 1700000002500,
  data: { turn: 1, role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Current runtime context. 这一条不该被当成诉求' }] },
}
const toolCall = {
  type: 'tool/call',
  time: 1700000003000,
  data: { turn: 1, step: 2, callId: 'call_1', name: 'read_image', arguments: '{"file_path":"/tmp/shot.png"}' },
}
const toolResult = {
  type: 'tool/result',
  time: 1700000004000,
  data: {
    turn: 1,
    step: 2,
    toolCallId: 'call_1',
    message: {
      role: 'tool',
      content: [
        { type: 'text', text: '<path>/tmp/shot.png</path>' },
        {
          type: 'image',
          attachment: { attachmentId: 'sha256:deadbeef', mediaType: 'image/png', bytes: 2048, width: 800, height: 600, name: 'shot.png' },
        },
      ],
    },
    meta: { path: '/tmp/shot.png' },
  },
}
const pastedImage = {
  type: 'user/message',
  time: 1700000005000,
  data: {
    turn: 2,
    role: 'user',
    source: { kind: 'user' },
    content: [
      { type: 'text', text: '参考这张图的配色' },
      { type: 'image', attachment: { attachmentId: 'sha256:cafe', mediaType: 'image/webp', bytes: 1024, width: 300, height: 300, name: 'ref.webp' } },
    ],
  },
}
const todos = {
  type: 'todo/write',
  time: 1700000006000,
  data: {
    todos: [
      { content: '改深色', status: 'completed' },
      { content: '截图验证', status: 'in_progress' },
      { content: '写文档', status: 'pending' },
    ],
  },
}
const turnEnd = { type: 'turn/end', time: 1700000007000, data: { turn: 2 } }

test('多帧 zstd 会被完整解开', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-frames-'))
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  writeZstdFrames(file, [header, title, humanMessage, contextMessage, toolCall, toolResult, turnEnd])
  const text = await readSessionText(file)
  assert.equal(text.trim().split('\n').length, 7)
  assert.match(text, /demo-project/)
})

test('扫描出 cwd / 标题 / 图片上下文 / 待办进度', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-scan-'))
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  writeZstdFrames(file, [header, title, humanMessage, contextMessage, toolCall, toolResult, pastedImage, todos, turnEnd])
  const summary = await scanSessionFile(file, { sessionId: 'session-abc' })

  assert.equal(summary.id, 'session-abc')
  assert.equal(summary.cwd, '/tmp/demo-project')
  assert.equal(summary.title, '做一个天气小组件')
  assert.equal(summary.turns, 1)
  assert.equal(summary.images.length, 2)

  const toolImage = summary.images.find(image => image.sha === 'deadbeef')
  assert.equal(toolImage.tool, 'read_image', '工具名要能从 tool/call 回填')
  assert.equal(toolImage.kind, 'tool')
  assert.equal(toolImage.path, '/tmp/shot.png')
  assert.equal(toolImage.prompt, '帮我把首页改成深色，并截个图看看', '诉求只取人类原话，不取运行时上下文')

  const pasted = summary.images.find(image => image.sha === 'cafe')
  assert.equal(pasted.kind, 'prompt', '用户贴的图单独标一类')
  assert.equal(pasted.prompt, '参考这张图的配色')

  assert.deepEqual(summary.todos, { total: 3, done: 1, running: ['截图验证'], next: ['写文档'] })
  assert.ok(summary.toolStats.view >= 1, '看图的工具应归到 view 桶')
})
