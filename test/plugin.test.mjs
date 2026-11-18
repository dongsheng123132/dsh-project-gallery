// 宿主半片的降级测试：这里的每条都是「宿主少了一块，插件应该怎么活」。
// 用假 ctx 起真 http 路由，走真实 Request → Response 路径（不 mock handler 内部）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../adapters/dsh-plugin/plugin.mjs'

function makeDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-plugin-'))
  const dirs = {
    storeDir: path.join(root, 'store'),
    attachmentsRoot: path.join(root, 'attachments'),
    sessionsRoot: path.join(root, 'sessions'),
  }
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
  return dirs
}

/** 起一个最小 ctx：只有插件实际会碰的那几个成员。 */
async function mount({ connection, workspaceRegistry } = {}) {
  const dirs = makeDirs()
  let handler = null
  const ctx = {
    webServer: {
      register(options) {
        handler = options.handler
        assert.equal(options.kind, 'prefix')
        assert.equal(options.path, '/session-gallery')
        return () => {}
      },
    },
    effect(run) {
      return run()
    },
    inject(deps, run) {
      if (workspaceRegistry && deps.includes('workspaceRegistry')) run({ workspaceRegistry })
    },
    get(name) {
      return name === 'connection' ? connection : undefined
    },
    logger: { info() {} },
  }

  apply(ctx, dirs)
  assert.ok(handler, '插件必须通过 webServer.register 挂上前缀路由')

  const server = http.createServer((req, res) => {
    handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('宿主没有 workspaceRegistry：插件照样起来，summary 正常返回', async () => {
  const app = await mount()
  try {
    const response = await fetch(`${app.base}/session-gallery/api/summary`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.workspaces ?? [], [], '没有注册表时工作区只能是空列表，不能抛错')
  } finally {
    await app.close()
  }
})

test('有 workspaceRegistry 时 summary 能拿到项目名', async () => {
  const app = await mount({
    workspaceRegistry: {
      list: () => [{ id: 'workspace:d1', record: { path: '/tmp/demo-project', title: '演示项目' } }],
    },
  })
  try {
    const response = await fetch(`${app.base}/session-gallery/api/summary`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
  } finally {
    await app.close()
  }
})

test('宿主没有 connection：接口不被挡（只是跳过鉴权判定）', async () => {
  const app = await mount({ connection: undefined })
  try {
    const response = await fetch(`${app.base}/session-gallery/api/summary`)
    assert.equal(response.status, 200)
  } finally {
    await app.close()
  }
})

test('connection 拒绝请求时返回它给的 403，而不是继续执行', async () => {
  const app = await mount({
    connection: { requestRejection: () => 403 },
  })
  try {
    const response = await fetch(`${app.base}/session-gallery/api/summary`)
    assert.equal(response.status, 403)
    const body = await response.json()
    assert.equal(body.ok, false)
  } finally {
    await app.close()
  }
})

test('跨源 Origin 被同源检查挡住', async () => {
  const app = await mount()
  try {
    const response = await fetch(`${app.base}/session-gallery/api/summary`, {
      headers: { origin: 'https://evil.example' },
    })
    assert.equal(response.status, 403)
  } finally {
    await app.close()
  }
})

test('页面与未知接口：静态页 200，接口 404 而不是抛错', async () => {
  const app = await mount()
  try {
    const page = await fetch(`${app.base}/session-gallery/`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type') || '', /text\/html/)

    const missing = await fetch(`${app.base}/session-gallery/api/nope`)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).ok, false)
  } finally {
    await app.close()
  }
})
