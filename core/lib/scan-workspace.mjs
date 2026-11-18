// 扫工作区磁盘上的图片产物（截图、生成的图、设计稿、导出图）。
//
// 会话附件只覆盖「AI 看过的图」；磁盘上的图才是用户真正攒下来的那一坨。
// 内存：不做全盘递归——限深、跳过依赖目录、限体积、限数量、只看最近 N 天。
import fs from 'node:fs'
import path from 'node:path'

// 刻意不收 .svg：同源返回 image/svg+xml 的 SVG 可能带脚本，看图不需要这个攻击面
export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v'])

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'DerivedData',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  'Pods',
  '.pnpm-store',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.parcel-cache',
  'target',
  '.gradle',
])

/** 聚合根噪声：/tmp、家目录、以及把一堆项目装在一起的上层目录。 */
export function isNoisyRoot(workspacePath) {
  if (!workspacePath) return true
  const home = process.env.HOME || ''
  const clean = workspacePath.replace(/\/+$/, '')
  if (clean === '/tmp' || clean === '/private/tmp' || clean === home) return true
  if (clean === path.join(home, 'code') || clean === path.join(home, 'Desktop')) return true
  return false
}

/**
 * 扫一个目录下的图片文件。
 * @param {string} root 工作区根
 * @param {{maxDepth?: number, sinceDays?: number, maxBytes?: number, limit?: number, now?: number}} options
 */
export function scanWorkspaceImages(root, options = {}) {
  const maxDepth = options.maxDepth ?? 3
  const sinceDays = options.sinceDays ?? 240
  const maxBytes = options.maxBytes ?? 30 * 1048576
  const limit = options.limit ?? 600
  const now = options.now ?? Date.now()
  const since = now - sinceDays * 86400000
  const out = []
  if (!root) return out

  const stack = [[root, 0]]
  while (stack.length && out.length < limit) {
    const [dir, depth] = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        if (SKIP_DIRS.has(entry.name)) continue
        if (depth < maxDepth) stack.push([full, depth + 1])
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      const isVideo = VIDEO_EXTS.has(ext)
      if (!isVideo && !IMAGE_EXTS.has(ext)) continue
      let stat
      try {
        stat = fs.statSync(full)
      } catch (error) {
        continue
      }
      if (stat.size < 2000 || stat.size > maxBytes) continue
      if (stat.mtimeMs < since) continue
      out.push({
        path: full,
        name: entry.name,
        bytes: stat.size,
        mtime: Math.round(stat.mtimeMs),
        mediaType: mediaTypeFor(ext),
        video: isVideo,
      })
      if (out.length >= limit) break
    }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

/** 扩展名 → MIME。 */
export function mediaTypeFor(ext) {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.svg':
      return 'image/svg+xml'
    case '.avif':
      return 'image/avif'
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    default:
      return 'application/octet-stream'
  }
}
