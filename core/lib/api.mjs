// 图库 API：一套纯函数式的 Request → Response 处理器。
// DSH 插件（ctx.connection.fetch.register）与本地开发服务器共用同一份，避免两套逻辑漂移。
import path from 'node:path'
import fsp from 'node:fs/promises'
import { buildIndex, readOrBuildIndex, attachmentPath, defaultSessionsRoot } from './build-index.mjs'
import { scanWorkspaceImages, isNoisyRoot, mediaTypeFor } from './scan-workspace.mjs'
import { ensureThumb, normalizeWidth, attachmentKey, fileKey, thumbsUsage, clearThumbs } from './thumbs.mjs'
import { recordUsage, summarizeUsage } from './usage.mjs'

export const ROUTE_BASE = '/session-gallery/api'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const IMAGE_CACHE = 'public, max-age=86400, immutable'

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS })
}

function safeInt(value, fallback, min, max) {
  // 注意：Number(null) === 0、Number('') === 0，参数缺席时必须先判空，
  // 否则「没传 limit」会被算成 limit=1（本项目踩过一次：图库每次只返回 1 张）。
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/** 工作区磁盘扫描缓存：60 秒内同一目录只扫一次。 */
function createScanCache(ttlMs = 60000) {
  const cache = new Map()
  return function scan(root, options) {
    const hit = cache.get(root)
    if (hit && Date.now() - hit.at < ttlMs) return hit.files
    const files = scanWorkspaceImages(root, options)
    cache.set(root, { at: Date.now(), files })
    return files
  }
}

/**
 * 会话图 → 前端描述符。
 *
 * 关键事实（取证结论）：会话附件不是原图，是给模型看的压缩副本（4M 像素 / 4MiB 上限，
 * 有 alpha 存 webp 否则 jpeg）。所以只要原文件还在、且落在已知工作区内，就优先发原图，
 * 附件只当兜底。原文件在 /tmp 之类的临时目录时不用它——那条路径不允许被读取。
 */
function imageDescriptorFromAttachment(image, roots) {
  const originalPath = image.originalPath && image.originalExists ? image.originalPath : ''
  const usableOriginal = originalPath && insideRoot(originalPath, roots) ? originalPath : ''
  return {
    key: image.sha || originalPath,
    sha: image.sha || '',
    filePath: usableOriginal,
    hasOriginal: Boolean(usableOriginal),
    mediaType: image.mediaType,
    width: image.width,
    height: image.height,
    name: image.name,
    ts: image.ts,
    turn: image.turn,
    tool: image.tool,
    kind: image.kind || 'tool',
    prompt: image.prompt,
    description: image.description || '',
    diskPath: image.originalPath || '',
    sessionId: image.sessionId,
    sessionTitle: image.sessionTitle,
  }
}

/** 符号链接也要校验：工作区里一个 link.png -> ~/.ssh/id_rsa 不能读出去。 */
async function insideRealRoots(target, roots) {
  if (!insideRoot(target, roots)) return false
  let real = ''
  try {
    real = await fsp.realpath(target)
  } catch (error) {
    return false
  }
  for (const root of roots) {
    let realRoot = root
    try {
      realRoot = await fsp.realpath(root)
    } catch (error) {
      continue
    }
    if (real === realRoot || real.startsWith(realRoot + path.sep)) return true
  }
  return false
}

function insideRoot(target, roots) {
  if (!target || !roots || !roots.length) return false
  const resolved = path.resolve(target)
  return roots.some(root => resolved === path.resolve(root) || resolved.startsWith(path.resolve(root) + path.sep))
}

/**
 * @param {{storeDir: string, attachmentsRoot: string, getWorkspaces?: () => Array<{id:string,path:string,title?:string}>,
 *          log?: (message: string) => void}} options
 */
export function createGalleryApi(options) {
  const storeDir = options.storeDir
  const attachmentsRoot = options.attachmentsRoot
  const log = options.log || (() => {})
  const getWorkspaces = options.getWorkspaces || (() => [])
  const sessionsRoot = options.sessionsRoot || defaultSessionsRoot()
  const scanCached = createScanCache()

  let cachedIndex = null
  let cachedAt = 0
  let building = null

  async function index(force) {
    // 进程内缓存 20s：一次悬停会打多个接口，别每个都去读 3.7MB 的 index.json。
    // 磁盘索引另有 60s TTL（build-index 的 INDEX_TTL_MS），过期才做增量扫描。
    if (!force && cachedIndex && Date.now() - cachedAt < 20_000) return cachedIndex
    if (building) return building
    building = (async () => {
      const next = force
        ? await buildIndex({ storeDir, attachmentsRoot, sessionsRoot, log })
        : await readOrBuildIndex({ storeDir, attachmentsRoot, sessionsRoot, log })
      cachedIndex = next
      cachedAt = Date.now()
      return next
    })().finally(() => {
      building = null
    })
    return building
  }

  function workspaceIndex(indexValue, targetPath) {
    if (!targetPath) return null
    const clean = targetPath.replace(/\/+$/, '')
    return indexValue.workspaces.find(workspace => workspace.path.replace(/\/+$/, '') === clean) || null
  }

  function knownRoots(indexValue) {
    return indexValue.workspaces.map(workspace => workspace.path).filter(Boolean)
  }

  function insideAny(target, roots) {
    const resolved = path.resolve(target)
    return roots.some(root => resolved === path.resolve(root) || resolved.startsWith(path.resolve(root) + path.sep))
  }

  async function summary() {
    const indexValue = await index(false)
    const registry = getWorkspaces()
    const byPath = new Map()
    for (const entry of registry) {
      if (!entry || !entry.path) continue
      byPath.set(entry.path.replace(/\/+$/, ''), entry)
    }
    const roots = knownRoots(indexValue)
    const workspaces = indexValue.workspaces.map(workspace => {
      const entry = byPath.get(workspace.path.replace(/\/+$/, '')) || null
      const top = workspace.images.slice(0, 4).map(image => imageDescriptorFromAttachment(image, roots))
      return {
        id: entry ? entry.id : null,
        title: entry && entry.title ? entry.title : '',
        path: workspace.path,
        name: workspace.name,
        noisy: isNoisyRoot(workspace.path),
        imageCount: workspace.images.length,
        sessionCount: workspace.sessions.length,
        lastActivity: workspace.lastActivity,
        todos: workspace.todos,
        toolStats: workspace.toolStats,
        thumbs: top,
        latestPrompt: workspace.images[0] ? workspace.images[0].prompt : '',
        sessions: workspace.sessions.slice(0, 8).map(session => ({
          id: session.id,
          title: session.title,
          lastActivity: session.lastActivity,
          imageCount: session.imageCount,
        })),
      }
    })
    return json({
      ok: true,
      builtAt: indexValue.builtAt,
      stats: indexValue.stats,
      workspaces,
    })
  }

  async function workspaceDetail(url) {
    const target = url.searchParams.get('path') || ''
    const sessionFilter = url.searchParams.get('session') || ''
    const wantFiles = !sessionFilter && url.searchParams.get('files') !== '0'
    const limit = safeInt(url.searchParams.get('limit'), 160, 1, 600)
    const indexValue = await index(false)
    const workspace = workspaceIndex(indexValue, target)
    if (!workspace) return json({ ok: false, message: '这个工作区还没有图片记录' }, 404)

    const roots = knownRoots(indexValue)
    let images = workspace.images
    if (sessionFilter) images = images.filter(image => image.sessionId === sessionFilter)
    const sessionImages = images.slice(0, limit).map(image => ({
      ...imageDescriptorFromAttachment(image, roots),
      source: 'session',
    }))

    let files = []
    if (wantFiles) {
      const scanned = scanCached(workspace.path, { maxDepth: 3, limit: 400 })
      files = scanned
        .filter(file => !file.video)
        .slice(0, limit)
        .map(file => ({
          key: path.basename(file.path),
          filePath: file.path,
          name: file.name,
          mediaType: file.mediaType,
          bytes: file.bytes,
          ts: file.mtime,
          source: 'file',
        }))
    }

    // 同一张图可能既是「会话里看过的」又是「磁盘上扫到的」：按路径去重，保留信息更全的那条
    const seen = new Set()
    const merged = [...sessionImages, ...files]
      .filter(image => {
        const key = image.filePath || image.sha
        if (!key) return false
        const normalized = path.resolve(key)
        if (seen.has(normalized)) return false
        seen.add(normalized)
        return true
      })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    return json({
      ok: true,
      workspace: {
        path: workspace.path,
        name: workspace.name,
        noisy: isNoisyRoot(workspace.path),
        todos: workspace.todos,
        toolStats: workspace.toolStats,
        sessions: workspace.sessions.slice(0, 40),
        sessionImageCount: sessionImages.length,
        fileImageCount: files.length,
      },
      images: merged.slice(0, limit),
    })
  }

  async function thumb(url) {
    const width = normalizeWidth(url.searchParams.get('w'))
    const sha = url.searchParams.get('sha') || ''
    const filePath = url.searchParams.get('path') || ''
    let source = ''
    let key = ''
    if (sha) {
      source = attachmentPath(attachmentsRoot, sha)
      if (!source) return json({ ok: false, message: '图片标识无效' }, 400)
      key = attachmentKey(sha)
    } else if (filePath) {
      const indexValue = await index(false)
      if (!(await insideRealRoots(filePath, knownRoots(indexValue)))) return json({ ok: false, message: '路径不在任何工作区内' }, 403)
      let stat
      try {
        stat = await fsp.stat(filePath)
      } catch (error) {
        return json({ ok: false, message: '文件不存在' }, 404)
      }
      source = filePath
      key = fileKey(filePath, Math.round(stat.mtimeMs))
    } else {
      return json({ ok: false, message: '需要 sha 或 path' }, 400)
    }
    // 动图不降级：GIF 一旦过 sips 就变静帧，直接发原文件让浏览器自己动
    if (path.extname(source).toLowerCase() === '.gif') return serveFile(source, IMAGE_CACHE)
    const result = await ensureThumb({ source, key, width, storeDir })
    if (!result) {
      // sips 失败（svg / 权限 / 非图片）→ 回源文件，让浏览器自己处理
      return serveFile(source, IMAGE_CACHE)
    }
    return serveFile(result.file, IMAGE_CACHE)
  }

  const BLOCKED_TYPES = new Set(['.svg', '.svgz', '.html', '.htm', '.xhtml', '.js', '.mjs'])

  const MAX_SERVE_BYTES = 64 * 1048576

  async function serveFile(file, cacheControl) {
    const ext = path.extname(file).toLowerCase()
    if (BLOCKED_TYPES.has(ext)) {
      return json({ ok: false, message: '这类文件不在图库里直接返回（同源脚本风险）' }, 415)
    }
    let size = 0
    try {
      size = (await fsp.stat(file)).size
    } catch (error) {
      return json({ ok: false, message: '读不到这张图' }, 404)
    }
    // 一张 300MB 的 tif 能让进程把整份读进内存：先看体积再决定
    if (size > MAX_SERVE_BYTES) {
      return json({ ok: false, message: `图超过 ${Math.round(MAX_SERVE_BYTES / 1048576)}MB，不在浏览器里直接开` }, 413)
    }
    try {
      const buffer = await fsp.readFile(file)
      return new Response(buffer, {
        headers: {
          'content-type': mediaTypeFor(path.extname(file)),
          'cache-control': cacheControl || 'no-store',
          'content-length': String(buffer.length),
        },
      })
    } catch (error) {
      return json({ ok: false, message: '读不到这张图' }, 404)
    }
  }

  async function original(url) {
    const sha = url.searchParams.get('sha') || ''
    const filePath = url.searchParams.get('path') || ''
    if (sha) {
      const file = attachmentPath(attachmentsRoot, sha)
      if (!file) return json({ ok: false, message: '图片标识无效' }, 400)
      return serveFile(file, IMAGE_CACHE)
    }
    if (!filePath) return json({ ok: false, message: '需要 sha 或 path' }, 400)
    const indexValue = await index(false)
    if (!(await insideRealRoots(filePath, knownRoots(indexValue)))) return json({ ok: false, message: '路径不在任何工作区内' }, 403)
    return serveFile(filePath, IMAGE_CACHE)
  }

  let sessionMapCache = { at: 0, map: null }

  /** 会话 id → 工作区，用于「悬停某个会话行」时直取这个会话的图。 */
  function sessionMap(indexValue) {
    if (sessionMapCache.map && Date.now() - sessionMapCache.at < 60000) return sessionMapCache.map
    const map = new Map()
    for (const workspace of indexValue.workspaces) {
      for (const session of workspace.sessions) {
        if (!session.id) continue
        map.set(session.id, { workspace, session })
      }
    }
    sessionMapCache = { at: Date.now(), map }
    return map
  }

  /** 单个会话的图片（会话行悬停用）。 */
  async function sessionDetail(url) {
    const id = url.searchParams.get('id') || ''
    if (!id) return json({ ok: false, message: '需要会话 id' }, 400)
    const indexValue = await index(false)
    const map = sessionMap(indexValue)
    const normalized = id.startsWith('session-') ? id : `session-${id}`
    const hit = map.get(id) || map.get(normalized) || map.get(id.replace(/^session-/, ''))
    if (!hit) return json({ ok: false, message: '没找到这个会话' }, 404)
    const roots = knownRoots(indexValue)
    const images = hit.workspace.images
      .filter(image => image.sessionId === hit.session.id)
      .map(image => ({ ...imageDescriptorFromAttachment(image, roots), source: 'session', workspaceName: hit.workspace.name, workspacePath: hit.workspace.path }))
    return json({
      ok: true,
      workspace: { path: hit.workspace.path, name: hit.workspace.name },
      session: {
        id: hit.session.id,
        title: hit.session.title,
        lastActivity: hit.session.lastActivity,
        turns: hit.session.turns,
        todos: hit.session.todos,
        toolStats: hit.session.toolStats,
      },
      images,
    })
  }

  let mergedCache = { at: 0, key: '', value: null }

  /** 跨项目的「全部图片」：会话图全量 + 最近 N 个工作区的磁盘图。 */
  async function imagesAcrossWorkspaces(url) {
    const limit = safeInt(url.searchParams.get('limit'), 600, 1, 2000)
    const include = url.searchParams.get('include') || 'all'
    const cacheKey = `${include}:${limit}`
    if (mergedCache.value && mergedCache.key === cacheKey && Date.now() - mergedCache.at < 60000) {
      return json({ ok: true, ...mergedCache.value })
    }
    const indexValue = await index(false)
    const ordered = indexValue.workspaces.slice().sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
    const out = []
    if (include !== 'files') {
      for (const workspace of ordered) {
        for (const image of workspace.images) {
          out.push({
            ...imageDescriptorFromAttachment(image, knownRoots(indexValue)),
            source: 'session',
            workspaceName: workspace.name,
            workspacePath: workspace.path,
          })
        }
      }
    }
    if (include !== 'session') {
      const scanTargets = ordered.filter(workspace => !isNoisyRoot(workspace.path)).slice(0, 24)
      for (const workspace of scanTargets) {
        const scanned = scanCached(workspace.path, { maxDepth: 2, limit: 80 })
        for (const file of scanned) {
          if (file.video) continue
          out.push({
            key: file.path,
            filePath: file.path,
            name: file.name,
            mediaType: file.mediaType,
            bytes: file.bytes,
            ts: file.mtime,
            source: 'file',
            workspaceName: workspace.name,
            workspacePath: workspace.path,
          })
        }
      }
    }
    out.sort((a, b) => (b.ts || 0) - (a.ts || 0))
    const images = out.slice(0, limit)
    mergedCache = { at: Date.now(), key: cacheKey, value: { images, total: out.length } }
    return json({ ok: true, images, total: out.length })
  }

  /** 排障用：宿主注册表能不能对上索引里的工作区。 */
  async function debugInfo() {
    const indexValue = await index(false)
    const registry = getWorkspaces()
    const byPath = new Set(registry.map(entry => entry && entry.path).filter(Boolean).map(item => item.replace(/\/+$/, '')))
    const matched = indexValue.workspaces.filter(workspace => byPath.has(workspace.path.replace(/\/+$/, '')))
    return json({
      ok: true,
      storeDir,
      registryCount: registry.length,
      registrySample: registry.slice(0, 3),
      indexWorkspaces: indexValue.workspaces.length,
      matchedWorkspaces: matched.length,
      matchedWithImages: matched.filter(workspace => workspace.images.length > 0).length,
      stats: indexValue.stats,
    })
  }

  /** 前端埋点：只收白名单事件 + 工作区路径（服务端只存它的短哈希）。 */
  async function usage(request, url) {
    if (request.method === 'POST') {
      let body
      try {
        body = await request.json()
      } catch (error) {
        return json({ ok: false, message: '请求不是合法 JSON' }, 400)
      }
      const event = String(body?.event || '')
      const ok = recordUsage(storeDir, event, String(body?.workspacePath || ''))
      return json({ ok }, ok ? 200 : 400)
    }
    return json({ ok: true, summary: summarizeUsage(storeDir, safeInt(url.searchParams.get('days'), 28, 1, 365)) })
  }

  async function stats() {
    const indexValue = await index(false)
    const usage = await thumbsUsage(storeDir)
    let indexBytes = 0
    try {
      const stat = await fsp.stat(path.join(storeDir, 'index.json'))
      indexBytes = stat.size
    } catch (error) {
      /* 还没写索引 */
    }
    return json({
      ok: true,
      stats: indexValue.stats,
      builtAt: indexValue.builtAt,
      disk: { indexBytes, thumbs: usage },
      storeDir,
    })
  }

  async function reindex(request) {
    if (request.method !== 'POST') return json({ ok: false, message: '用 POST' }, 405)
    const indexValue = await index(true)
    return json({ ok: true, stats: indexValue.stats, builtAt: indexValue.builtAt })
  }

  async function resetThumbs(request) {
    if (request.method !== 'POST') return json({ ok: false, message: '用 POST' }, 405)
    const ok = await clearThumbs(storeDir)
    return json({ ok })
  }

  /** 统一入口：路径分流 → 处理器。 */
  async function handle(request) {
    const url = new URL(request.url, 'http://127.0.0.1')
    const route = url.pathname
    try {
      if (route === `${ROUTE_BASE}/summary`) return await summary()
      if (route === `${ROUTE_BASE}/workspace`) return await workspaceDetail(url)
      if (route === `${ROUTE_BASE}/images`) return await imagesAcrossWorkspaces(url)
      if (route === `${ROUTE_BASE}/session`) return await sessionDetail(url)
      if (route === `${ROUTE_BASE}/thumb`) return await thumb(url)
      if (route === `${ROUTE_BASE}/file`) return await original(url)
      if (route === `${ROUTE_BASE}/stats`) return await stats()
      if (route === `${ROUTE_BASE}/debug`) return await debugInfo()
      if (route === `${ROUTE_BASE}/usage`) return await usage(request, url)
      if (route === `${ROUTE_BASE}/reindex`) return await reindex(request)
      if (route === `${ROUTE_BASE}/clear-thumbs`) return await resetThumbs(request)
      return json({ ok: false, message: '没有这个接口' }, 404)
    } catch (error) {
      log(`图库接口出错 ${route}: ${error instanceof Error ? error.stack || error.message : String(error)}`)
      return json({ ok: false, message: error instanceof Error ? error.message : String(error) }, 500)
    }
  }

  return { handle, index, ROUTE_BASE }
}
