// 建索引：把 ~/.dsh/sessions 下所有会话里的图片与进展文字，按工作区聚合。
//
// 增量策略：每个会话文件记 size+mtimeMs，未变则复用上次结果；索引落在
// ~/.dsh/session-gallery/index.json（DSH 插件的本地数据惯例：~/.dsh/<plugin>/）。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { scanSessionFile } from './scan-session.mjs'

export const INDEX_VERSION = 2

/** 默认会话根。`DSH_SESSIONS_ROOT` 可覆盖（测试/自检时指到假目录）。 */
export function defaultSessionsRoot() {
  const override = process.env.DSH_SESSIONS_ROOT
  if (override) return path.resolve(override)
  return path.join(os.homedir(), '.dsh', 'sessions')
}

/** 默认附件根。`DSH_ATTACHMENTS_ROOT` 可覆盖。 */
export function defaultAttachmentsRoot() {
  const override = process.env.DSH_ATTACHMENTS_ROOT
  if (override) return path.resolve(override)
  return path.join(os.homedir(), '.dsh', 'attachments', 'v1', 'objects')
}

/** 默认索引/缓存目录：走宿主惯例的缓存位 ~/.dsh/cache/<plugin>/。
 * `DSH_SESSION_GALLERY_DIR` 可覆盖（开发/自检时指到仓库内）。 */
export function defaultStoreDir() {
  const override = process.env.DSH_SESSION_GALLERY_DIR
  if (override) return path.resolve(override)
  return path.join(os.homedir(), '.dsh', 'cache', 'dsh-session-gallery')
}

/** 附件实体路径：objects/<前2位>/<sha256>。 */
export function attachmentPath(attachmentsRoot, sha) {
  if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/i.test(sha)) return ''
  return path.join(attachmentsRoot, sha.slice(0, 2), sha)
}

function decodeSessionDir(name) {
  // 只作兜底：日志头里的 cwd 才是权威，这里仅在头坏了时给个像样路径
  let out = name.replace(/^--/, '').replace(/--$/, '')
  out = out.replace(/~([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  return out
}

/** 附件是给模型看的压缩副本，原始文件才更适合看图：能读到就用原图。 */
function existsQuiet(file) {
  try {
    return fs.statSync(file).isFile()
  } catch (error) {
    return false
  }
}

function workspaceName(cwd) {
  if (!cwd) return '未知工作区'
  const parts = cwd.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : cwd
}

async function listSessionFiles(sessionsRoot) {
  const files = []
  let projects = []
  try {
    projects = await fsp.readdir(sessionsRoot, { withFileTypes: true })
  } catch (error) {
    return files
  }
  for (const project of projects) {
    if (!project.isDirectory() || !project.name.startsWith('--')) continue
    const projectDir = path.join(sessionsRoot, project.name)
    let sessions = []
    try {
      sessions = await fsp.readdir(projectDir, { withFileTypes: true })
    } catch (error) {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const file = path.join(projectDir, session.name, 'session.v4.jsonl.zstd')
      let stat
      try {
        stat = await fsp.stat(file)
      } catch (error) {
        continue
      }
      files.push({ file, sessionId: session.name, projectDir: project.name, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  return files
}

function loadCache(cacheFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    if (parsed && parsed.version === INDEX_VERSION && parsed.sessions && typeof parsed.sessions === 'object') return parsed
  } catch (error) {
    /* 缓存缺失/损坏都按冷启动处理 */
  }
  return { version: INDEX_VERSION, sessions: {} }
}

/**
 * 建索引。
 * @param {{sessionsRoot?: string, attachmentsRoot?: string, storeDir?: string,
 *          write?: boolean, log?: (msg: string) => void}} options
 */
export async function buildIndex(options = {}) {
  const sessionsRoot = options.sessionsRoot || defaultSessionsRoot()
  const attachmentsRoot = options.attachmentsRoot || defaultAttachmentsRoot()
  const storeDir = options.storeDir || defaultStoreDir()
  const log = options.log || (() => {})
  const started = Date.now()

  await fsp.mkdir(storeDir, { recursive: true })
  const indexFile = path.join(storeDir, 'index.json')
  const cacheFile = path.join(storeDir, 'scan-cache.json')
  const cache = loadCache(cacheFile)

  const files = await listSessionFiles(sessionsRoot)
  const nextCache = { version: INDEX_VERSION, sessions: {} }
  const scanned = []
  let reused = 0
  let fresh = 0
  let failures = 0

  for (const entry of files) {
    const key = entry.file
    const previous = cache.sessions[key]
    if (previous && previous.size === entry.size && previous.mtimeMs === entry.mtimeMs && previous.summary) {
      reused += 1
      nextCache.sessions[key] = previous
      scanned.push(previous.summary)
      continue
    }
    try {
      const summary = await scanSessionFile(entry.file, { sessionId: entry.sessionId })
      if (!summary.cwd) summary.cwd = decodeSessionDir(entry.projectDir)
      nextCache.sessions[key] = { size: entry.size, mtimeMs: entry.mtimeMs, summary }
      scanned.push(summary)
      fresh += 1
    } catch (error) {
      failures += 1
      log(`扫描失败 ${entry.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 按工作区聚合
  const workspaces = new Map()
  for (const summary of scanned) {
    const cwd = summary.cwd || ''
    if (!workspaces.has(cwd)) {
      workspaces.set(cwd, {
        path: cwd,
        name: workspaceName(cwd),
        lastActivity: 0,
        images: [],
        sessions: [],
        turns: 0,
        todos: null,
        toolStats: {},
      })
    }
    const workspace = workspaces.get(cwd)
    const images = summary.images
      .filter(image => image.sha || image.path)
      .map(image => ({
        sha: image.sha,
        mediaType: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        name: image.name,
        path: image.path,
        ts: image.ts,
        turn: image.turn,
        tool: image.tool,
        kind: image.kind || 'tool',
        prompt: image.prompt,
        description: image.kind === 'present' ? image.prompt : '',
        originalPath: image.path || '',
        originalExists: Boolean(image.path) && existsQuiet(image.path),
        sessionId: summary.id || summary.file,
        sessionTitle: summary.title,
      }))
    workspace.images.push(...images)
    workspace.sessions.push({
      id: summary.id,
      title: summary.title,
      createdAt: summary.createdAt,
      lastActivity: summary.lastActivity,
      turns: summary.turns,
      imageCount: images.length,
      toolStats: summary.toolStats || {},
      todos: summary.todos,
    })
    workspace.turns += summary.turns
    for (const [bucket, count] of Object.entries(summary.toolStats || {})) {
      workspace.toolStats[bucket] = (workspace.toolStats[bucket] || 0) + count
    }
    workspace.lastActivity = Math.max(workspace.lastActivity, summary.lastActivity, summary.createdAt)
    if (summary.todos) {
      if (!workspace.todos || summary.lastActivity >= (workspace.todos.at || 0)) {
        workspace.todos = { ...summary.todos, at: summary.lastActivity }
      }
    }
  }

  const list = [...workspaces.values()].map(workspace => {
    workspace.images.sort((a, b) => b.ts - a.ts)
    workspace.sessions.sort((a, b) => b.lastActivity - a.lastActivity)
    const seen = new Set()
    workspace.images = workspace.images.filter(image => {
      const identity = image.sha || image.originalPath
      if (!identity) return false
      // 同图在不同会话中有各自的上下文，不能跨会话去重。
      const dedupeKey = JSON.stringify([image.sessionId, identity])
      if (seen.has(dedupeKey)) return false
      seen.add(dedupeKey)
      return true
    })
    return workspace
  })
  list.sort((a, b) => b.lastActivity - a.lastActivity)

  const index = {
    version: INDEX_VERSION,
    builtAt: Date.now(),
    ms: Date.now() - started,
    sessionsRoot,
    attachmentsRoot,
    stats: {
      bytes: list.reduce((total, workspace) => total + workspace.images.reduce((inner, image) => inner + image.bytes, 0), 0),
      workspaces: list.length,
      sessions: scanned.length,
      images: list.reduce((total, workspace) => total + workspace.images.length, 0),
      reused,
      fresh,
      failures,
    },
    workspaces: list,
  }

  if (options.write !== false) {
    await fsp.writeFile(indexFile, JSON.stringify(index))
    await fsp.writeFile(cacheFile, JSON.stringify(nextCache))
  }
  log(
    `索引完成：${index.stats.workspaces} 工作区 / ${index.stats.sessions} 会话 / ${index.stats.images} 图 / ` +
      `新扫 ${fresh} 复用 ${reused} 失败 ${failures} / ${index.ms}ms`,
  )
  return index
}

/** 读已有索引；没有就建一份。 */
export async function readOrBuildIndex(options = {}) {
  const storeDir = options.storeDir || defaultStoreDir()
  const indexFile = path.join(storeDir, 'index.json')
  try {
    const parsed = JSON.parse(await fsp.readFile(indexFile, 'utf8'))
    if (parsed && parsed.version === INDEX_VERSION) return parsed
  } catch (error) {
    /* 没索引就建 */
  }
  return buildIndex(options)
}
