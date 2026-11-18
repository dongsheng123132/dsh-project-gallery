// 读取 DSH 会话日志：session.v4.jsonl.zstd 是「多帧 zstd 追加写」的文件。
//
// 两种读法（按可用性自动降级，结果一致）：
//   1) zlib.createZstdDecompress() 流式解压 —— 像 gzip 一样自动跨帧；Node >= 23.8 / 24 有。
//   2) 按 zstd magic(28 B5 2F FD) 切帧后逐帧 zstdDecompressSync —— 老 Node 兜底。
//      切片失败时向后吞并在下一个 magic 处重试，避免把压缩数据里偶合的 magic 当成帧边界。
import fs from 'node:fs'
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 某个 Node 运行时是否支持流式 zstd（会自动跨帧）。 */
export function hasStreamingZstd() {
  return typeof zlib.createZstdDecompress === 'function'
}

/** 流式解压整个文件（多帧拼接）。 */
async function decompressStreaming(file) {
  const source = fs.createReadStream(file)
  const decoder = zlib.createZstdDecompress()
  const chunks = []
  for await (const chunk of source.pipe(decoder)) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** 逐帧解压：按 magic 切帧，失败则吞并后续帧重试。 */
function decompressByFrames(buffer) {
  const out = []
  let cursor = buffer.indexOf(MAGIC)
  if (cursor === -1) return Buffer.alloc(0)
  while (cursor !== -1 && cursor < buffer.length) {
    let next = buffer.indexOf(MAGIC, cursor + 4)
    let done = false
    while (!done) {
      const end = next === -1 ? buffer.length : next
      if (end <= cursor) break
      try {
        out.push(zlib.zstdDecompressSync(buffer.subarray(cursor, end)))
        done = true
      } catch (error) {
        if (next === -1) {
          // 尾部残帧（写入中断）：丢掉，不制造假数据
          done = true
          next = -1
        } else {
          next = buffer.indexOf(MAGIC, next + 4)
        }
      }
    }
    cursor = next
  }
  return Buffer.concat(out)
}

/** 读取会话日志为 UTF-8 文本。
 *
 * 顺序很关键：**先逐帧切**，再退回流式。
 * 实测（Node 23.11 / 24.21）：zlib.createZstdDecompress 遇到多帧文件只解第一帧就结束，
 * 不报错、也不继续——一个 5MB 的会话只吐出 1 行（2026-11-17 本机实测 frames=3701 / lines=1）。
 * 用流式当主路径会静默丢 99% 的日志内容，所以逐帧切是主路径。
 */
export async function readSessionText(file) {
  const buffer = fs.readFileSync(file)
  const byFrames = decompressByFrames(buffer)
  if (byFrames.length > 0) return byFrames.toString('utf8')
  if (hasStreamingZstd()) {
    try {
      return (await decompressStreaming(file)).toString('utf8')
    } catch (error) {
      // 两种读法都失败：当成空日志，不让一个坏文件拖垮整轮索引
    }
  }
  return ''
}

/** 逐行迭代文本，不构造大数组。 */
export function* eachLine(text) {
  let start = 0
  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const line = text.slice(start, end)
    start = end + 1
    if (line.length > 0) yield line
  }
}
