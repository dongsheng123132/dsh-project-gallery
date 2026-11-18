// DSH 插件 host 半片：把 core 的索引/缩略图/图库 API 挂到宿主的 HTTP 上。
//
// 契约照抄本机两个能跑的同伴插件（dsh-task-board / @exccoder/dsh-media-workbench）：
//   inject ['webServer','connection'] + ctx.effect(() => ctx.webServer.register({kind:'prefix', path, handler}))
// 前缀路由 = 一套 handler 同时服务页面（/session-gallery/…）与接口（/session-gallery/api/…），
// 不依赖宿主的 fetch 精确路径注册，装完重启即见效。
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGalleryApi } from '../../core/lib/api.mjs'
import { defaultAttachmentsRoot, defaultStoreDir } from '../../core/lib/build-index.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(ROOT, '..', '..', 'web')
export const BASE = '/session-gallery'
const API_BASE = `${BASE}/api`

/**
 * 宿主注册表的真实形状是 `{ id, host, record: { path, title, sessionIds, ... } }`
 * （0.2.2-rc.3 实测，368 条）；老版本是扁平的 `{ id, path, title }`。
 * DOM 里的 `data-row-key="workspace:<group.key>"` 用的就是这里的 id。
 */
function normalizeWorkspace(entry) {
  if (!entry) return null
  const record = entry.record || {}
  return {
    id: String(entry.id ?? record.id ?? ''),
    path: String(record.path ?? entry.path ?? ''),
    title: String(record.title ?? entry.title ?? ''),
  }
}

export const name = 'dsh-project-gallery'
export const inject = ['webServer']

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

const STATIC_FILES = new Set(['index.html', 'app.js', 'style.css'])

function jsonNode(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function sendStatic(res, fileName) {
  if (!STATIC_FILES.has(fileName)) return jsonNode(res, 404, { ok: false, message: '没有这个文件' })
  try {
    const buffer = await readFile(path.join(WEB_DIR, fileName))
    res.writeHead(200, {
      'content-type': MIME[path.extname(fileName)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': buffer.length,
    })
    res.end(buffer)
  } catch (error) {
    jsonNode(res, 500, { ok: false, message: '读不到图库页面：' + (error instanceof Error ? error.message : String(error)) })
  }
}

/** Node 请求 → fetch Request，好让 core 里的处理器在两种宿主里跑同一份。 */
async function toFetchRequest(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  return new Request(`http://127.0.0.1${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  })
}

async function sendFetchResponse(res, response) {
  const headers = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  headers['content-length'] = String(buffer.length)
  res.writeHead(response.status, headers)
  res.end(buffer)
}

function sameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch (error) {
    return false
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {{storeDir?: string, attachmentsRoot?: string}} config 用户配置
 */
export function apply(ctx, config = {}) {
  const storeDir = config.storeDir || defaultStoreDir()
  const attachmentsRoot = config.attachmentsRoot || defaultAttachmentsRoot()
  const log = message => {
    try {
      ctx.logger?.info?.(message)
    } catch (error) {
      /* 老宿主没有 logger 时静默：日志只影响排障，不影响功能 */
    }
  }

  // 工作区注册表是「DOM 里的 workspace:<uuid> → 真实路径」唯一的权威映射。
  // 不写进顶层 inject：没有这个服务的宿主里插件仍应能起来（只是悬停匹配不到）。
  let workspaceRegistry = null
  try {
    ctx.inject(['workspaceRegistry'], scope => {
      workspaceRegistry = scope.workspaceRegistry
      const entries = workspaceRegistry?.list?.() || []
      log(`工作区注册表已就绪：${entries.length} 条`)
    })
  } catch (error) {
    log('宿主没有 workspaceRegistry，悬停匹配会退化为空')
  }

  const api = createGalleryApi({
    storeDir,
    attachmentsRoot,
    getWorkspaces: () => {
      try {
        return (workspaceRegistry ? workspaceRegistry.list() : []).map(normalizeWorkspace)
      } catch (error) {
        return []
      }
    },
    log,
  })

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      handler: async (req, res) => {
        try {
          if (!sameOrigin(req)) return jsonNode(res, 403, { ok: false, message: '只接受同源请求' })
          const connection = ctx.get?.('connection')
          const denial = typeof connection?.requestRejection === 'function' ? connection.requestRejection({ headers: req.headers }) : 0
          if (denial) return jsonNode(res, denial, { ok: false, message: '未授权的请求' })

          const url = new URL(req.url, 'http://127.0.0.1')
          if (url.pathname.startsWith(API_BASE + '/')) {
            const response = await api.handle(await toFetchRequest(req))
            return await sendFetchResponse(res, response)
          }
          // 页面：/session-gallery/ 与 /session-gallery
          const rel = url.pathname.slice(BASE.length)
          const fileName = rel === '' || rel === '/' ? 'index.html' : rel.replace(/^\//, '')
          return await sendStatic(res, fileName)
        } catch (error) {
          if (res.headersSent) return res.end()
          jsonNode(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    return () => {
      try {
        dispose?.()
      } catch (error) {
        /* 卸载期释放失败不影响已停止的服务 */
      }
    }
  }, 'dsh-session-gallery: routes')

  log(`项目相册已挂载：${BASE}/（数据目录 ${storeDir}）`)
}
