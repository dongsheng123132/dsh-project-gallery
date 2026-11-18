// 扫一个会话日志 → 这个会话产出的图片 + 能读懂进展的文字骨架。
//
// 设计取舍：不 JSON.parse 每一行。会话日志里 assistant 文本与 tool 参数可能上千行、
// 单行几百 KB，全量 parse 只为取一个工具名是浪费。做法是先用 substring 预筛，
// 命中的行才 parse；tool/call 只需要 callId 与 name，直接正则取头部 400 字符。
import { readSessionText, eachLine } from './frames.mjs'

const IMAGE_MARK = '"attachment":{'
const TOOL_RESULT_MARK = '"type":"tool/result"'
const TOOL_CALL_MARK = '"type":"tool/call"'
const TITLE_MARK = '"type":"session/title"'
const TODO_MARK = '"type":"todo/write"'
const TURN_END_MARK = '"type":"turn/end"'
const USER_MARK = '"type":"user/message"'
const INBOX_MARK = '"type":"agent/inbox/spliced"'
const PRESENT_MARK = '"type":"deliverables/presented"'

const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|svg|avif|heic)$/i

const MAX_PROMPT = 120

function shortText(input) {
  if (typeof input !== 'string') return ''
  const flat = input.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_PROMPT ? flat.slice(0, MAX_PROMPT) + '…' : flat
}

/** 从一条消息的 content 数组里摘出文字与图片。 */
function readMessageParts(message) {
  const parts = message && message.content
  if (typeof parts === 'string') return { text: shortText(parts), images: [] }
  if (!Array.isArray(parts)) return { text: '', images: [] }
  let text = ''
  const images = []
  for (const part of parts) {
    if (!part) continue
    if (part.type === 'text' && typeof part.text === 'string' && !text) text = shortText(part.text)
    if (part.type === 'image' && part.attachment) images.push(part.attachment)
  }
  return { text, images }
}

/** 从 todo/write 事件里取待办进度。 */
function readTodos(event) {
  const list = event?.data?.todos ?? event?.data?.items ?? event?.data?.message?.todos
  if (!Array.isArray(list)) return null
  const total = list.length
  const done = list.filter(item => item && (item.status === 'completed' || item.status === 'done')).length
  const running = list
    .filter(item => item && (item.status === 'in_progress' || item.status === 'in-progress'))
    .map(item => shortText(item.content ?? item.text ?? ''))
    .filter(Boolean)
  const next = list
    .filter(item => item && item.status === 'pending')
    .map(item => shortText(item.content ?? item.text ?? ''))
    .filter(Boolean)
  return { total, done, running, next: next.slice(0, 3) }
}

/** 工具名归一成 UI 上能读的「做了什么」。 */
function toolBucket(name) {
  if (!name) return 'other'
  if (/^(edit|write|str_replace|apply_patch|multiedit)$/i.test(name)) return 'edit'
  if (/^(bash|shell|terminal|run_command|exec)$/i.test(name)) return 'shell'
  if (/screenshot|screen|view_image|read_image|uking_vision|vision/i.test(name)) return 'view'
  if (/bake|generate_image|image|draw|figma/i.test(name)) return 'draw'
  if (/^(read|glob|grep|list_dir|search)$/i.test(name)) return 'read'
  return 'other'
}

/**
 * 扫一个会话文件。
 * @param {string} file 会话日志路径
 * @param {{sessionId?: string}} meta 由目录名带来的兜底标识
 */
export async function scanSessionFile(file, meta = {}) {
  const text = await readSessionText(file)
  const summary = {
    id: meta.sessionId || '',
    file,
    cwd: '',
    createdAt: 0,
    lastActivity: 0,
    title: '',
    turns: 0,
    todos: null,
    prompts: new Map(), // turn → 用户诉求
    toolNames: new Map(), // callId → 工具名
    toolStats: {}, // edit/shell/view/draw/read/other → 次数
    images: [],
    broken: false,
  }

  const pending = [] // 先收图，最后回填工具名与当轮诉求

  for (const line of eachLine(text)) {
    // 会话头：一定有，且在第一行
    if (summary.cwd === '' && line.startsWith('{"type":"session"')) {
      try {
        const event = JSON.parse(line)
        summary.id = event.id || summary.id
        summary.cwd = event.cwd || ''
        summary.createdAt = event.createdAt || 0
        summary.lastActivity = Math.max(summary.lastActivity, event.createdAt || 0)
      } catch (error) {
        summary.broken = true
      }
      continue
    }

    if (line.includes(TOOL_CALL_MARK)) {
      const head = line.slice(0, 400)
      const id = /"callId":"([^"]+)"/.exec(head)
      const name = /"name":"([^"]+)"/.exec(head)
      if (id && name) {
        summary.toolNames.set(id[1], name[1])
        const bucket = toolBucket(name[1])
        summary.toolStats[bucket] = (summary.toolStats[bucket] || 0) + 1
      }
      continue
    }

    // 图片可能出现在三处：工具结果（AI 看的）、用户消息（用户贴的）、子代理信箱
    if (line.includes(IMAGE_MARK) && (line.includes(TOOL_RESULT_MARK) || line.includes(USER_MARK) || line.includes(INBOX_MARK))) {
      let event
      try {
        event = JSON.parse(line)
      } catch (error) {
        continue
      }
      const time = event.time || 0
      const data = event.data || {}
      // 两代格式：新会话把 callId 放在 data 上，旧会话放在 data.message 里
      const callId = data.toolCallId || data.message?.toolCallId || data.message?.source?.callId || ''
      const messages = []
      if (data.message) messages.push(data.message)
      // 旧格式把 content 直接摊在 data 上（user/message 常见）
      else if (Array.isArray(data.content)) messages.push(data)
      if (Array.isArray(data.messages)) messages.push(...data.messages)
      // 子代理信箱：content 嵌在 inserted[] 里
      if (Array.isArray(data.inserted)) {
        for (const item of data.inserted) {
          if (item && item.message) messages.push(item.message)
          else if (item && Array.isArray(item.content)) messages.push(item)
        }
      }
      const eventSource = data.source || data.message?.source || {}
      const kind = event.type === 'tool/result' ? 'tool' : eventSource.kind === 'user' ? 'prompt' : 'context'
      let promptText = ''
      for (const message of messages) {
        const parts = readMessageParts(message)
        if (parts.text) promptText = parts.text
        for (const attachment of parts.images) {
          pending.push({
            sha: String(attachment.attachmentId || '').replace(/^sha256:/, ''),
            mediaType: attachment.mediaType || '',
            bytes: attachment.bytes || 0,
            width: attachment.width || 0,
            height: attachment.height || 0,
            name: attachment.name || '',
            path: kind === 'tool' ? data.meta?.path || '' : '',
            ts: time,
            turn: data.turn || 0,
            step: data.step || 0,
            callId,
            kind,
            inlinePrompt: kind === 'prompt' ? promptText : '',
          })
        }
      }
      summary.lastActivity = Math.max(summary.lastActivity, time)
      continue
    }

    // 交付/展示的文件：present 工具把路径 + 说明写进 deliverables/presented
    if (line.includes(PRESENT_MARK)) {
      try {
        const event = JSON.parse(line)
        const data = event.data || {}
        const files = Array.isArray(data.files) ? data.files : []
        for (const file of files) {
          const filePath = String(file?.path || '')
          if (!IMAGE_FILE_RE.test(filePath)) continue
          pending.push({
            sha: '',
            mediaType: '',
            bytes: 0,
            width: 0,
            height: 0,
            name: filePath.split(/[\\/]/).pop() || '',
            path: filePath,
            ts: event.time || 0,
            turn: data.turn || 0,
            step: 0,
            callId: data.callId || '',
            kind: 'present',
            inlinePrompt: shortText(file?.description || ''),
          })
        }
      } catch (error) {
        /* 交付事件坏了跳过，不影响其它图 */
      }
      continue
    }

    if (line.includes(TITLE_MARK)) {
      try {
        const event = JSON.parse(line)
        const title = event.data?.title ?? event.data?.message?.title ?? event.data?.text
        if (typeof title === 'string' && title.trim()) summary.title = shortText(title)
      } catch (error) {
        /* 标题坏了不影响图库，跳过 */
      }
      continue
    }

    if (line.includes(TODO_MARK)) {
      try {
        const event = JSON.parse(line)
        const todos = readTodos(event)
        if (todos) summary.todos = todos
      } catch (error) {
        /* 待办坏了跳过 */
      }
      continue
    }

    if (line.includes(TURN_END_MARK)) {
      summary.turns += 1
      const time = /"time":(\d+)/.exec(line)
      if (time) summary.lastActivity = Math.max(summary.lastActivity, Number(time[1]))
      continue
    }

    if (line.includes(USER_MARK) && line.length < 20000) {
      try {
        const event = JSON.parse(line)
        const turn = event.data?.turn || summary.turns + 1
        const eventData = event.data || {}
        const source = eventData.source || eventData.message?.source || {}
        if (source.kind !== 'user') continue
        const prompt = readMessageParts(eventData.message ?? eventData).text
        if (prompt) summary.prompts.set(turn, prompt)
      } catch (error) {
        /* 用户消息坏了跳过 */
      }
    }
  }

  summary.images = pending.map(image => ({
    ...image,
    tool: summary.toolNames.get(image.callId) || '',
    prompt: image.inlinePrompt || summary.prompts.get(image.turn) || '',
    sessionId: summary.id,
    sessionTitle: summary.title,
  }))
  delete summary.prompts
  delete summary.toolNames
  return summary
}
