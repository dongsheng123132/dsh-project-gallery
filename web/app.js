// 项目相册 · 前端
//
// 三种形态共用这一份代码（用 body[data-mode] 切换布局）：
//   full  —— 主区整页（DSH 左侧栏「项目相册」入口 / 浏览器直开）
//   dock  —— DSH 里悬停工作区时右侧浮出的窄面板（iframe，由 client.js 摆放）
// 灯箱在同一份代码里，打开时向宿主发消息请求放大，关闭时请求恢复。
const API = '/session-gallery/api'

const params = new URLSearchParams(location.search)
const MODE = params.get('mode') === 'dock' ? 'dock' : 'full'
document.body.dataset.mode = MODE

const state = {
  mode: MODE,
  theme: params.get('theme') === 'light' ? 'light' : 'dark',
  scope: 'all', // all | recent | todo | workspace
  activePath: params.get('path') || '',
  activeSession: params.get('session') || '',
  kind: 'all',
  query: '',
  workspaces: [],
  images: [],
  flat: [],
  index: -1,
  focusKey: params.get('focusKey') || '',
  loading: false,
}

const el = id => document.getElementById(id)
const $gridWrap = el('grid-wrap')
const $railList = el('rail-list')
const $railScope = el('rail-scope')
const $toolbarTitle = el('tb-title')
const $toolbarChips = el('tb-chips')
const $railSub = el('rail-sub')
const $railFoot = el('rail-foot')

/* ---------------- 小工具 ---------------- */

function escapeHtml(input) {
  return String(input == null ? '' : input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function kb(bytes) {
  if (!bytes) return '—'
  return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + 'MB' : Math.round(bytes / 1024) + 'KB'
}

function dayKey(ts) {
  const date = new Date(ts || 0)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayLabel(ts) {
  const date = new Date(ts || 0)
  const today = new Date()
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return '今天'
  const yesterday = new Date(today.getTime() - 86400000)
  if (sameDay(date, yesterday)) return '昨天'
  const sameYear = date.getFullYear() === today.getFullYear()
  return sameYear ? `${date.getMonth() + 1}月${date.getDate()}日` : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function timeLabel(ts) {
  const date = new Date(ts || 0)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function ago(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前'
  if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前'
  return Math.round(diff / 86400000) + ' 天前'
}

function thumbUrl(image, width = 320) {
  if (image.source === 'file' || image.filePath) {
    return `${API}/thumb?path=${encodeURIComponent(image.filePath)}&w=${width}`
  }
  return `${API}/thumb?sha=${encodeURIComponent(image.sha || image.key)}&w=${width}`
}

function fullUrl(image) {
  if (image.source === 'file' || image.filePath) return `${API}/file?path=${encodeURIComponent(image.filePath)}`
  return `${API}/file?sha=${encodeURIComponent(image.sha || image.key)}`
}

let toastTimer = null
function toast(message) {
  const node = el('toast')
  node.textContent = message
  node.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    node.hidden = true
  }, 2200)
}

function postToHost(message) {
  if (window.parent === window) return
  try {
    window.parent.postMessage(message, location.origin)
  } catch (error) {
    /* 跨源宿主不支持时静默：灯箱仍在 iframe 内可用 */
  }
}

/** 本地埋点：只上报事件名 + 工作区路径（服务端只存短哈希），失败静默。 */
function track(event, workspacePath) {
  try {
    fetch(`${API}/usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, workspacePath: workspacePath || '' }),
      keepalive: true,
    }).catch(() => {})
  } catch (error) {
    /* 埋点失败不影响看图 */
  }
}

/* ---------------- 数据 ---------------- */

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function loadSummary() {
  const data = await fetchJson(`${API}/summary`)
  state.workspaces = (data.workspaces || []).slice().sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
  renderRail()
  renderRailFoot(data)
  if (MODE === 'full') {
    const first = state.workspaces.find(workspace => !workspace.noisy && workspace.imageCount > 0)
    if (!state.activePath && first) {
      // 默认停在「全部图片」，不抢占用户选择
    }
  }
}

async function loadScopeImages() {
  state.loading = true
  renderGrid()
  try {
    const query = new URLSearchParams({ limit: '600' })
    if (state.kind === 'session') query.set('include', 'session')
    if (state.kind === 'file') query.set('include', 'files')
    if (state.activeSession) query.set('session', state.activeSession)
    const data = await fetchJson(`${API}/images?${query.toString()}`)
    state.images = data.images || []
    state.flat = state.images
  } finally {
    state.loading = false
    renderGrid()
    renderToolbar()
  }
}

async function loadWorkspace(targetPath) {
  state.loading = true
  if (targetPath !== state.activePath) track('focus-workspace', targetPath)
  state.activePath = targetPath
  renderGrid()
  try {
    const query = new URLSearchParams({ path: targetPath, limit: '400' })
    if (state.activeSession) {
      query.set('session', state.activeSession)
      query.set('files', '0')
    }
    const data = await fetchJson(`${API}/workspace?${query.toString()}`)
    state.workspace = data.workspace
    state.images = (data.images || []).filter(image => (state.kind === 'all' ? true : image.source === state.kind))
    state.flat = state.images
  } catch (error) {
    state.workspace = null
    state.images = []
    toast('这个工作区还没有图片记录')
  } finally {
    state.loading = false
    renderGrid()
    renderToolbar()
  }
}

async function refreshAll(force) {
  if (force) {
    track('rebuild-index', '')
    toast('正在重建索引…')
    await fetchJson(`${API}/reindex`, { method: 'POST' }).catch(() => null)
  }
  await loadSummary()
  if (state.activePath) await loadWorkspace(state.activePath)
  else await loadScopeImages()
  if (force) toast('索引已更新')
}

/* ---------------- 渲染：侧栏 ---------------- */

function renderRail() {
  const groups = state.workspaces.filter(workspace => workspace.imageCount > 0)
  const rows = []
  for (const workspace of groups) {
    const todo = workspace.todos
    const open = todo && todo.done < todo.total
    const on = state.scope === 'workspace' && workspace.path === state.activePath
    rows.push(`
      <button class="rail-item${on ? ' is-on' : ''}" data-path="${escapeHtml(workspace.path)}" title="${escapeHtml(workspace.path)}">
        <span class="dot${open ? '' : ' off'}"></span>
        <span class="rail-name">${escapeHtml(workspace.name)}</span>
        <span class="rail-count">${workspace.imageCount}</span>
      </button>`)
  }
  $railList.innerHTML = rows.join('') || '<div class="rail-foot">还没有任何图片记录</div>'
  for (const button of $railList.querySelectorAll('.rail-item')) {
    button.addEventListener('click', () => {
      state.scope = 'workspace'
      state.activeSession = ''
      renderRail()
      loadWorkspace(button.dataset.path)
    })
  }
  const total = state.workspaces.reduce((sum, workspace) => sum + (workspace.imageCount || 0), 0)
  $railSub.textContent = `${state.workspaces.filter(workspace => workspace.imageCount > 0).length} 个项目 · ${total} 张会话图`
}

function renderRailFoot(data) {
  const stats = data && data.stats ? data.stats : {}
  const age = data && data.builtAt ? Date.now() - data.builtAt : null
  const ago = age == null
    ? ''
    : age < 60_000
      ? '刚刚更新'
      : age < 3600_000
        ? `${Math.round(age / 60_000)} 分钟前更新`
        : `${Math.round(age / 3600_000)} 小时前更新`
  $railFoot.innerHTML = `索引 ${stats.workspaces || 0} 工作区 / ${stats.sessions || 0} 会话 · 会话图 ${stats.images || 0} 张<br />
    ${ago ? `${ago} · ` : ''}<button id="link-reindex">重建索引</button>`
  const button = el('link-reindex')
  if (button) button.addEventListener('click', () => refreshAll(true))
}

/* ---------------- 渲染：工具条 ---------------- */

/** 进展条：待办完成度。没有待办就整条隐藏，不占位置。 */
function renderProgress(todos) {
  const wrap = el('tb-progress')
  if (!wrap) return
  const total = todos && Number(todos.total) || 0
  if (!total) {
    wrap.hidden = true
    return
  }
  const done = Math.max(0, Math.min(total, Number(todos.done) || 0))
  wrap.hidden = false
  el('tb-progress-bar').style.width = `${Math.round((done / total) * 100)}%`
  el('tb-progress-text').textContent = `进展 ${done}/${total}`
}

function renderToolbar() {
  if (state.activePath && state.workspace) {
    const workspace = state.workspace
    $toolbarTitle.textContent = state.activeSession ? '本次会话的图片' : workspace.name
    const chips = []
    chips.push(`<span class="chip">${workspace.sessionImageCount || 0} 张会话图</span>`)
    chips.push(`<span class="chip">${workspace.fileImageCount || 0} 张磁盘图</span>`)
    if (workspace.todos) chips.push(`<span class="chip">待办 ${workspace.todos.done}/${workspace.todos.total}</span>`)
    renderProgress(workspace.todos)
    const tools = workspace.toolStats || {}
    if (tools.edit) chips.push(`<span class="chip">改文件 ${tools.edit}</span>`)
    if (tools.shell) chips.push(`<span class="chip">跑命令 ${tools.shell}</span>`)
    if (workspace.noisy) chips.push('<span class="chip warn">聚合目录</span>')
    $toolbarChips.innerHTML = chips.join('')
    document.title = `${workspace.name} · 项目相册`
    return
  }
  renderProgress(null)
  $toolbarTitle.textContent = state.scope === 'recent' ? '最近 7 天' : state.scope === 'todo' ? '有未完成待办' : '全部图片'
  const total = state.images.length
  $toolbarChips.innerHTML = `<span class="chip">${total} 张</span>` + (state.loading ? '<span class="chip">载入中…</span>' : '')
  document.title = '项目相册 · 会话图片与进展'
}

/* ---------------- 渲染：图墙 ---------------- */

function matchesQuery(image) {
  if (!state.query) return true
  const haystack = `${image.name || ''} ${image.sessionTitle || ''} ${image.prompt || ''} ${image.filePath || ''}`.toLowerCase()
  return haystack.includes(state.query.toLowerCase())
}

function renderGrid() {
  const wrap = $gridWrap
  const empty = el('empty')
  const images = state.images.filter(matchesQuery)

  if (!images.length) {
    wrap.querySelectorAll('.day-group').forEach(node => node.remove())
    empty.hidden = false
    empty.innerHTML = state.loading
      ? '<p>正在整理图片…</p>'
      : state.scope === 'workspace'
        ? '<p><b>这个项目还没有图片</b></p><p>AI 看过或生成过的图会出现在这里；也可以换成「全部图片」看别的项目。</p>'
        : '<p><b>还没有可展示的图片</b></p><p>在 DSH 里让 AI 看一张图、截一张图，或往项目目录里放几张设计稿，这里就会长出来。</p>'
    return
  }
  empty.hidden = true

  const groups = new Map()
  for (const image of images) {
    const key = dayKey(image.ts || image.mtime)
    if (!groups.has(key)) groups.set(key, { ts: image.ts || image.mtime, items: [] })
    groups.get(key).items.push(image)
  }
  const ordered = [...groups.values()].sort((a, b) => b.ts - a.ts)

  wrap.querySelectorAll('.day-group, .empty').forEach(node => {
    if (!node.classList.contains('empty')) node.remove()
  })

  const html = ordered
    .map(group => {
      const cells = group.items
        .map(image => {
          const kindClass = image.source === 'file' ? 'file' : ''
          const badge = image.name || (image.filePath ? image.filePath.split('/').pop() : '')
          return `<div class="cell" data-key="${escapeHtml(image.sha || image.filePath || '')}">
            <img loading="lazy" src="${thumbUrl(image, 320)}" alt="${escapeHtml(badge)}" />
            <span class="cell-kind ${kindClass}"></span>
            <span class="cell-badge">${escapeHtml(badge)}</span>
          </div>`
        })
        .join('')
      return `<section class="day-group">
        <div class="day-head"><b>${dayLabel(group.ts)}</b><span>${group.items.length} 张</span></div>
        <div class="grid">${cells}</div>
      </section>`
    })
    .join('')
  wrap.insertAdjacentHTML('beforeend', html)

  wrap.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const key = cell.dataset.key
      const target = images.find(image => (image.sha || image.filePath || '') === key)
      const index = state.images.indexOf(target)
      openLightbox(index >= 0 ? index : 0)
    })
  })
}

/* ---------------- 灯箱 ---------------- */

function openLightbox(index) {
  if (!state.images.length) return
  const target = state.images[index]
  track('open-lightbox', target && target.workspacePath ? target.workspacePath : state.activePath)
  state.index = index
  const lightbox = el('lb')
  lightbox.hidden = false
  postToHost({ type: 'dsh-gallery:expand' })
  renderLightbox()
}

function closeLightbox() {
  el('lb').hidden = true
  state.index = -1
  // 只退回上一层：dock 形态关掉大图后仍停在网格，Esc 再按一次才关 dock
  postToHost({ type: 'dsh-gallery:collapse' })
}

function stepLightbox(delta) {
  if (state.index < 0) return
  const next = state.index + delta
  if (next < 0 || next >= state.images.length) return
  state.index = next
  renderLightbox()
}

function renderLightbox() {
  const image = state.images[state.index]
  if (!image) return
  const workspaceName = state.workspace?.name || image.workspaceName || ''

  el('lb-project').textContent = workspaceName || (image.source === 'file' ? '磁盘图片' : '会话图片')
  el('lb-session').textContent = image.source === 'file' ? (image.filePath || '').replace(/^.*?\/([^/]+)\/([^/]+)$/, '…/$1/$2') : image.sessionTitle || ''
  el('lb-counter').textContent = `${state.index + 1} / ${state.images.length}`
  el('lb-prev').disabled = state.index <= 0
  el('lb-next').disabled = state.index >= state.images.length - 1

  // 显示用 1600 的中图：sips 生成的 JPEG 体积只有原图零头，解码也快，
  // 这就是 voidImageViewer 的纪律——「够看的分辨率」而不是「原图」。
  // 想看原图像素时点「原图」按钮（按需再拉，不阻塞首屏）。
  const img = el('lb-img')
  const medium = thumbUrl(image, 1600)
  img.src = medium
  img.alt = image.name || ''
  state.showingOriginal = false
  const wanted = image.sha || image.filePath || image.key
  // 预取左右各一张中图，翻页不等
  for (const offset of [1, -1]) {
    const neighbour = state.images[state.index + offset]
    if (neighbour) {
      const probe = new Image()
      probe.src = thumbUrl(neighbour, 1600)
    }
  }
  state.currentKey = wanted

  const prompt = image.prompt || ''
  el('lb-prompt').textContent = prompt || (image.source === 'file' ? '这张图不是 AI 看图产生的，是项目目录里的文件。' : '这次会话没有留下人类原话（可能是子代理自己跑的任务）。')

  const meta = []
  const ts = image.ts || image.mtime || 0
  if (ts) meta.push(['时间', `${dayLabel(ts)} ${timeLabel(ts)}`])
  if (image.width && image.height) meta.push(['尺寸', `${image.width}×${image.height}`])
  if (image.bytes) meta.push(['体积', kb(image.bytes)])
  if (image.tool) meta.push(['工具', image.tool])
  if (image.kind === 'prompt') meta.push(['来源', '你贴的图'])
  if (image.kind === 'tool') meta.push(['来源', 'AI 看过的图'])
  if (image.kind === 'present') meta.push(['来源', '交付图'])
  if (image.source === 'file') meta.push(['来源', '项目目录文件'])
  if (image.sessionTitle) meta.push(['会话', image.sessionTitle])
  if (image.turn) meta.push(['位置', `第 ${image.turn} 轮对话`])
  const where = image.filePath || image.diskPath
  if (where) meta.push(['路径', where])
  el('lb-meta').innerHTML = meta.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('')

  // 底部胶片条：同一会话的图排一排，左右切换也在这里点
  const siblings = state.images
    .map((candidate, position) => ({ candidate, position }))
    .filter(item => item.candidate.sessionId && item.candidate.sessionId === image.sessionId)
  const stripItems = siblings.length > 1 ? siblings : state.images.map((candidate, position) => ({ candidate, position }))
  el('lb-strip').innerHTML = stripItems
    .slice(0, 40)
    .map(item => `<img src="${thumbUrl(item.candidate, 320)}" data-index="${item.position}" class="${item.position === state.index ? 'is-on' : ''}" alt="" title="${escapeHtml(item.candidate.name || '')}" />`)
    .join('')
  for (const node of el('lb-strip').querySelectorAll('img')) {
    node.addEventListener('click', () => {
      state.index = Number(node.dataset.index)
      renderLightbox()
      node.scrollIntoView({ inline: 'center', block: 'nearest' })
    })
  }
  const active = el('lb-strip').querySelector('img.is-on')
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' })

  const actions = []
  if (image.sessionId) actions.push('<button class="ghost-btn primary" data-action="open-session">回到这次会话</button>')
  if (where) actions.push('<button class="ghost-btn" data-action="copy-path">复制路径</button>')
  actions.push('<button class="ghost-btn" data-action="toggle-original">看原图</button>')
  el('lb-actions').innerHTML = actions.join('')
  for (const button of el('lb-actions').querySelectorAll('button')) {
    button.addEventListener('click', async () => {
      const action = button.dataset.action
      if (action === 'open-session') {
        track('open-session', state.activePath)
        postToHost({ type: 'dsh-gallery:open-session', sessionId: image.sessionId })
      }
      if (action === 'toggle-original') {
        const original = fullUrl(image)
        if (!state.showingOriginal) {
          button.textContent = '载入中…'
          const probe = new Image()
          probe.onload = () => {
            el('lb-img').src = original
            state.showingOriginal = true
            button.textContent = '看中图'
          }
          probe.onerror = () => {
            button.textContent = '原图加载失败'
          }
          probe.src = original
        } else {
          el('lb-img').src = medium
          state.showingOriginal = false
          button.textContent = '看原图'
        }
        return
      }
      if (action === 'copy-path') {
        try {
          await navigator.clipboard.writeText(where)
          toast('路径已复制')
        } catch (error) {
          toast('复制失败，宿主可能没给剪贴板权限')
        }
      }
    })
  }
}

/* ---------------- 交互 ---------------- */

function bind() {
  for (const button of $railScope.querySelectorAll('.rail-scope-item')) {
    button.addEventListener('click', () => {
      state.scope = button.dataset.scope
      state.activePath = ''
      state.activeSession = ''
      $railScope.querySelectorAll('.rail-scope-item').forEach(node => node.classList.toggle('is-on', node === button))
      renderRail()
      loadScopeImages()
    })
  }
  const scopeButton = $railScope.querySelector(`[data-scope="${state.scope === 'workspace' ? 'all' : state.scope}"]`)
  if (scopeButton) scopeButton.classList.add('is-on')

  for (const button of el('seg').querySelectorAll('.seg-item')) {
    button.addEventListener('click', () => {
      state.kind = button.dataset.kind
      el('seg').querySelectorAll('.seg-item').forEach(node => node.classList.toggle('is-on', node === button))
      if (state.scope === 'workspace' && state.activePath) loadWorkspace(state.activePath)
      else loadScopeImages()
    })
  }

  el('search').addEventListener('input', event => {
    state.query = event.target.value.trim()
    renderGrid()
  })

  el('refresh').addEventListener('click', () => refreshAll(true))
  const openRight = el('open-right')
  if (openRight) {
    openRight.addEventListener('click', () => {
      postToHost({ type: 'dsh-gallery:open-right', path: state.activePath, sessionId: state.activeSession })
    })
  }
  const dockClose = el('dock-close')
  if (dockClose) {
    dockClose.hidden = false
    dockClose.addEventListener('click', () => postToHost({ type: 'dsh-gallery:close' }))
  }
  el('lb-close').addEventListener('click', closeLightbox)
  el('lb-prev').addEventListener('click', () => stepLightbox(-1))
  el('lb-next').addEventListener('click', () => stepLightbox(1))
  el('lb-stage').addEventListener('click', event => {
    if (event.target === el('lb-stage')) closeLightbox()
  })

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && el('lb').hidden) {
      // 大图已经是关的：再按 Esc 就是「退出这一层」——dock 形态直接关掉面板回到对话
      if (MODE === 'dock') postToHost({ type: 'dsh-gallery:close' })
      return
    }
    if (el('lb').hidden) return
    if (event.key === 'Escape') closeLightbox()
    if (event.key === 'ArrowLeft') stepLightbox(-1)
    if (event.key === 'ArrowRight') stepLightbox(1)
  })

  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return
    const message = event.data || {}
    if (message.type === 'dsh-gallery:theme' && (message.scheme === 'dark' || message.scheme === 'light')) {
      state.theme = message.scheme
      document.documentElement.dataset.theme = message.scheme
    }
    if (message.type === 'dsh-gallery:close') {
      if (!el('lb').hidden) closeLightbox()
    }
    if (message.type === 'dsh-gallery:focus' && message.key) {
      const index = state.images.findIndex(image => (image.sha || image.filePath || image.key) === message.key)
      if (index >= 0) openLightbox(index)
    }
  })
}

/* ---------------- 启动 ---------------- */

async function boot() {
  document.documentElement.dataset.theme = state.theme
  if (state.activePath) state.scope = 'workspace'
  bind()
  postToHost({ type: 'dsh-gallery:ready', mode: MODE })
  await loadSummary()
  if (state.activePath) await loadWorkspace(state.activePath)
  else await loadScopeImages()
  track(MODE === 'dock' ? 'open-dock' : 'open-full', state.activePath)
  if (state.focusKey) {
    const index = state.images.findIndex(image => (image.sha || image.filePath || image.key) === state.focusKey)
    if (index >= 0) openLightbox(index)
    state.focusKey = ''
  }
}

boot().catch(error => {
  console.error(error)
  $gridWrap.innerHTML = `<div class="empty">图库加载失败：${escapeHtml(error.message)}</div>`
})
