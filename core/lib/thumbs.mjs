// 缩略图：用 macOS 自带 sips 等比缩小，落盘缓存。不引入 sharp/原生依赖。
//
// 缓存键：
//   附件图  a-<sha256>-<w>.jpg
//   工作区图 f-<sha1(路径+mtime)>-<w>.jpg
// 命中直接发缓存；未命中调一次 sips（~40–120ms），失败就回源图，让浏览器自己缩。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const SIPS = '/usr/bin/sips'
const PS_BATCH = fileURLToPath(new URL('./resize-batch.ps1', import.meta.url))
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/** 允许的缩略图宽度档位（避免任意 w 造成缓存爆炸）。 */
export const THUMB_WIDTHS = [160, 320, 640, 1280]

export function normalizeWidth(input) {
  const value = Number(input)
  if (!Number.isFinite(value)) return 320
  let best = THUMB_WIDTHS[0]
  for (const width of THUMB_WIDTHS) if (value >= width) best = width
  return best
}

export function thumbsDir(storeDir) {
  return path.join(storeDir || path.join(os.homedir(), '.dsh', 'session-gallery'), 'thumbs')
}

async function fileStatOk(file) {
  try {
    const stat = await fsp.stat(file)
    return stat.isFile() && stat.size > 0
  } catch (error) {
    return false
  }
}

/** 缓存键白名单：只允许安全字符，防止 key 里带路径段把文件写到缓存目录外。 */
function safeKey(key) {
  const cleaned = String(key || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96)
  return cleaned || 'unknown'
}

/** 同一 target 的并发请求只跑一次缩图（并发的两个请求不再各起一个进程）。 */
const inFlight = new Map()
/** 缩不出来的文件记住结论，别每次都重试。 */
const negatives = new Set()

/**
 * Windows 批量缩图队列。
 *
 * 为什么必须批量：单张要起一次 powershell.exe，实测首张 1241ms；同一进程连做 9 张
 * 总耗时 1531ms（边际约 70ms/张）。一屏 20 张照片 = 20 次进程启动（约 24 秒）vs 1 次（约 2.3 秒）。
 * 队列把 80ms 内的请求攒成一批（最多 16 张），一次 PowerShell 全做完。
 */
const winQueue = []
let winTimer = null
let winRunning = false

function queueWindowsResize(job) {
  return new Promise(resolve => {
    winQueue.push({ ...job, resolve })
    if (winTimer || winRunning) return
    winTimer = setTimeout(() => {
      winTimer = null
      void drainWindowsQueue()
    }, 80)
  })
}

async function drainWindowsQueue() {
  if (winRunning || winQueue.length === 0) return
  winRunning = true
  const batch = winQueue.splice(0, 16)
  const jobsFile = path.join(path.dirname(batch[0].temporary), `batch-${process.pid}-${Date.now()}.json`)
  try {
    await fsp.writeFile(
      jobsFile,
      JSON.stringify(batch.map(item => ({ src: item.source, dst: item.temporary, max: item.width }))),
    )
    if (!(await fileStatOk(POWERSHELL))) throw new Error('找不到 powershell.exe')
    await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_BATCH, '-Jobs', jobsFile], {
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 4 * 1048576,
    })
  } catch (error) {
    // 整批失败（比如被组策略禁掉 Add-Type）：全部按失败处理，交给调用方回源图
  } finally {
    try {
      await fsp.rm(jobsFile, { force: true })
    } catch (cleanupError) {
      /* 临时清单清不掉不影响结果 */
    }
  }
  for (const item of batch) {
    item.resolve(await fileStatOk(item.temporary))
  }
  winRunning = false
  if (winQueue.length) void drainWindowsQueue()
}

/** 生成或复用一张缩略图，返回 {file, contentType} 或 null（交给调用方回源）。 */
export async function ensureThumb({ source, key, width, storeDir }) {
  const dir = thumbsDir(storeDir)
  const target = path.join(dir, `${safeKey(key)}-${width}.jpg`)
  if (await fileStatOk(target)) return { file: target, contentType: 'image/jpeg', cached: true }
  if (negatives.has(source)) return null
  if (!(await fileStatOk(source))) return null
  const running = inFlight.get(target)
  if (running) return running
  if (path.extname(source).toLowerCase() === '.svg') return null // svg 不缩，直接发原图
  await fsp.mkdir(dir, { recursive: true })
  const job = (async () => {
  const temporary = `${target}.tmp-${process.pid}`
  try {
    if (process.platform === 'darwin') {
      await run(SIPS, ['-Z', String(width), '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', source, '--out', temporary], {
        timeout: 20000,
      })
    } else if (process.platform === 'win32') {
      // Windows 没有 sips：走批量队列（System.Drawing，不装第三方库）
      const ok = await queueWindowsResize({ source, temporary, width })
      if (!ok) throw new Error('windows resize failed')
    } else {
      // Linux 等：有 ImageMagick 就用，没有就让调用方回源图
      await run('magick', [source, '-resize', `${width}x${width}>`, '-quality', '72', temporary], { timeout: 20000 })
    }
  } catch (error) {
    // 缩不出来就记住（按源文件），别让每张 webp/坏图反复付一次进程启动
    negatives.add(source)
    try {
      await fsp.rm(temporary, { force: true })
    } catch (cleanupError) {
      /* 临时文件清不掉不影响结果 */
    }
    return null
  }
  if (!(await fileStatOk(temporary))) return null
  // 原子落位：先写临时文件再 rename，杀掉进程也不会留半张图被当成有效缓存
  try {
    await fsp.rename(temporary, target)
  } catch (error) {
    return null
  }
  return { file: target, contentType: 'image/jpeg', cached: false }
  })()
  inFlight.set(target, job)
  try {
    return await job
  } finally {
    inFlight.delete(target)
  }
}

/** 附件图缓存键。 */
export function attachmentKey(sha) {
  return `a-${sha}`
}

/** 工作区图缓存键（路径 + 修改时间，图变了自动失效）。 */
export function fileKey(file, mtime) {
  const hash = createHash('sha1').update(`${file}:${mtime}`).digest('hex').slice(0, 16)
  return `f-${hash}`
}

/** 清空缩略图缓存（设置里的「重建缓存」）。 */
export async function clearThumbs(storeDir) {
  const dir = thumbsDir(storeDir)
  try {
    await fsp.rm(dir, { recursive: true, force: true })
    return true
  } catch (error) {
    return false
  }
}

/** 缓存体积统计。 */
export async function thumbsUsage(storeDir) {
  const dir = thumbsDir(storeDir)
  let bytes = 0
  let count = 0
  try {
    for (const name of await fsp.readdir(dir)) {
      try {
        const stat = await fsp.stat(path.join(dir, name))
        bytes += stat.size
        count += 1
      } catch (error) {
        /* 并发清理时文件可能已消失，忽略 */
      }
    }
  } catch (error) {
    /* 还没有缓存 */
  }
  return { count, bytes }
}

/** 当前平台用什么缩图：sips（macOS）/ System.Drawing（Windows）/ ImageMagick（Linux）。 */
export function thumbnailer() {
  if (process.platform === 'darwin') return 'sips'
  if (process.platform === 'win32') return 'system-drawing'
  return 'imagemagick'
}

/** 是否存在 sips（只是 macOS 上的探测，保留给自检用）。 */
export async function hasSips() {
  try {
    await fsp.access(SIPS, fs.constants.X_OK)
    return true
  } catch (error) {
    return false
  }
}
