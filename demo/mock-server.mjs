#!/usr/bin/env node
/**
 * 演示用假数据服务器：只服务 web/ 静态文件 + 一组虚构的 API 响应。
 * 用途：生成公开演示图（README / 市场页），保证不含任何真实项目、真实路径、真实会话。
 *
 *   node demo/mock-server.mjs --port 7798
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const fixtures = path.join(here, 'fixtures')

const PROJECTS = [
  { id: 'demo-atlas', name: '示例项目 · 馆藏画册', sessions: 3 },
  { id: 'demo-cards', name: '示例项目 · 版式实验', sessions: 2 },
  { id: 'demo-landing', name: '示例项目 · 落地页重做', sessions: 1 },
]

// 8 张公共领域作品（Met Open Access, CC0），见 fixtures/LICENSE-IMAGES.md
const NAME = Array.from({ length: 8 }, (_, index) => `示例_作品_0${index + 1}.jpg`)

function imagesFor(project, count = 12) {
  const now = Date.parse('2026-11-18T11:20:00+08:00')
  return Array.from({ length: count }, (_, index) => ({
    key: `${project.id}-${index}`,
    sha: `demo-${index % 8}`,
    name: NAME[index % 4],
    source: index % 3 === 2 ? 'file' : 'session',
    filePath: `/demo/${project.id}/${NAME[index % 4]}`,
    sessionId: `demo-session-${(index % 3) + 1}`,
    sessionTitle: `示例会话 ${(index % 3) + 1}`,
    turn: (index % 5) + 1,
    tool: 'read_image',
    kind: 'tool',
    prompt: '把这张画的色调改成清晨的暖色，并生成 4 张候选。',
    width: 960,
    height: 640,
    bytes: 4096,
    ts: now - index * 3.6e6,
  }))
}

function summary() {
  return {
    ok: true,
    stats: { images: 60, workspaces: 3, sessions: 6, bytes: 245760, ms: 412, fresh: 0, reused: 6 },
    workspaces: PROJECTS.map((project, index) => {
      const images = imagesFor(project)
      const sessionImages = images.filter(image => image.source === 'session').length
      return {
        id: project.id,
        path: `/demo/${project.id}`,
        name: project.name,
        imageCount: images.length,
        sessionImageCount: sessionImages,
        fileImageCount: images.length - sessionImages,
        toolStats: { edit: 4, shell: 3, view: 5 },
        sessionCount: project.sessions,
        lastActivity: Date.parse('2026-11-18T11:20:00+08:00') - index * 86400000,
        thumbs: images.slice(0, 4),
        todos: { total: 6, done: 4 },
        sessions: Array.from({ length: project.sessions }, (_, i) => ({
          id: `demo-session-${i + 1}`,
          title: `示例会话 ${i + 1}`,
          imageCount: 4,
          turns: 7,
          lastActivity: Date.parse('2026-11-18T11:20:00+08:00') - i * 3.6e6,
        })),
      }
    }),
  }
}

function json(response, body) {
  const text = JSON.stringify(body)
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}

async function send(response, file, type) {
  try {
    const buffer = await fs.readFile(file)
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': String(buffer.length) })
    response.end(buffer)
  } catch (error) {
    response.writeHead(404)
    response.end('not found')
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const file = url.pathname.replace(/^\/session-gallery\/?/, '')

  if (file.startsWith('api/')) {
    const route = file.slice(4)
    if (route === 'summary') return json(response, summary())
    if (route === 'workspace' || route === 'images') {
      const target = url.searchParams.get('path') || '/demo/demo-atlas'
      const project = PROJECTS.find(item => `/demo/${item.id}` === target) || PROJECTS[0]
      return json(response, { ok: true, workspace: summary().workspaces.find(w => w.id === project.id), images: imagesFor(project) })
    }
    if (route === 'session') {
      return json(response, {
        ok: true,
        session: { id: url.searchParams.get('id'), title: '示例会话 1', turns: 7 },
        workspace: summary().workspaces[0],
        images: imagesFor(PROJECTS[0], 6),
      })
    }
    if (route === 'thumb' || route === 'file' || route === 'hero') {
      const sha = url.searchParams.get('sha') || ''
      const index = Number((sha.match(/(\d+)$/) || [])[1] || 0) % 8
      return send(response, path.join(fixtures, `artwork-${index + 1}.jpg`), 'image/jpeg')
    }
    return json(response, { ok: false, message: 'demo' })
  }

  if (file === 'card') return send(response, path.join(here, 'card.html'), 'text/html; charset=utf-8')
  if (file === 'pane') return send(response, path.join(here, 'pane.html'), 'text/html; charset=utf-8')
  if (file === 'client.js') return send(response, path.join(root, 'adapters', 'dsh-plugin', 'client.js'), 'text/javascript; charset=utf-8')
  if (!file || file === '/') return send(response, path.join(root, 'web/index.html'), 'text/html; charset=utf-8')
  if (file.endsWith('.js')) return send(response, path.join(root, 'web', path.basename(file)), 'text/javascript; charset=utf-8')
  if (file.endsWith('.css')) return send(response, path.join(root, 'web', path.basename(file)), 'text/css; charset=utf-8')
  response.writeHead(404)
  response.end('not found')
})

const portArg = process.argv.indexOf('--port')
const port = Number(portArg > -1 ? process.argv[portArg + 1] : 7798)
server.listen(port, '127.0.0.1', () => {
  console.log(`demo server http://127.0.0.1:${port}/session-gallery/?mode=full&theme=light`)
})
