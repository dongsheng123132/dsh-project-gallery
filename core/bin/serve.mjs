#!/usr/bin/env node
// 本地开发服务器：把「图库 UI + API」当普通网站跑起来，方便改样式 / 截图 / 用 curl 验接口。
// 只监听 127.0.0.1，仅用于开发与自检；正式使用走 DSH 插件宿主路由。
//
//   DSH_SESSION_GALLERY_DIR=$PWD/.data node core/bin/serve.mjs --port 7799
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalleryApi } from '../lib/api.mjs'
import { defaultStoreDir, defaultAttachmentsRoot, defaultSessionsRoot } from '../lib/build-index.mjs'
import { scanWorkspaceImages } from '../lib/scan-workspace.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const webRoot = path.join(repoRoot, 'web')

const args = process.argv.slice(2)
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const port = Number(flag('port', process.env.PORT || 7799))
const storeDir = process.env.DSH_SESSION_GALLERY_DIR || defaultStoreDir()
const attachmentsRoot = process.env.DSH_ATTACHMENTS_ROOT || defaultAttachmentsRoot()
const sessionsRoot = process.env.DSH_SESSIONS_ROOT || defaultSessionsRoot()

// 开发态没有宿主 registry，用索引里出现的工作区当名单
const { readOrBuildIndex } = await import('../lib/build-index.mjs')
const indexValue = await readOrBuildIndex({ storeDir, attachmentsRoot, sessionsRoot })
const registry = indexValue.workspaces.map((workspace, position) => ({ id: `dev-${position}`, path: workspace.path, title: workspace.name }))

const api = createGalleryApi({
  storeDir,
  attachmentsRoot,
  getWorkspaces: () => registry,
  log: message => console.log(message),
})

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  if (url.pathname.startsWith('/session-gallery/api/')) {
    // 把 Node 请求包成 fetch Request，复用插件里的同一份处理器
    const body = request.method === 'POST' ? await readBody(request) : undefined
    const fetchRequest = new Request(`http://127.0.0.1:${port}${request.url}`, { method: request.method, body })
    const fetchResponse = await api.handle(fetchRequest)
    response.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers.entries()))
    response.end(Buffer.from(await fetchResponse.arrayBuffer()))
    return
  }

  let filePath = url.pathname === '/' || url.pathname === '/session-gallery/' ? '/index.html' : url.pathname
  filePath = filePath.replace(/^\/session-gallery/, '')
  const resolved = path.join(webRoot, path.normalize(filePath).replace(/^([.][.][/\\])+/, ''))
  if (!resolved.startsWith(webRoot)) {
    response.writeHead(403)
    response.end('forbidden')
    return
  }
  try {
    const buffer = fs.readFileSync(resolved)
    response.writeHead(200, { 'content-type': MIME[path.extname(resolved)] || 'application/octet-stream', 'cache-control': 'no-store' })
    response.end(buffer)
  } catch (error) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found: ' + url.pathname)
  }
})

function readBody(request) {
  return new Promise(resolve => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

server.listen(port, '127.0.0.1', () => {
  console.log(`图库开发服务器：http://127.0.0.1:${port}/session-gallery/  (store=${storeDir})`)
  console.log(`API 试一下：curl -s http://127.0.0.1:${port}/api/plugins/dsh-session-gallery/summary | head -c 300`)
  console.log(`工作区数：${scanWorkspaceImages ? registry.length : registry.length}`)
})
