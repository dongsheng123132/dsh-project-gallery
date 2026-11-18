// dsh-session-gallery · 浏览器半片
//
// 三块 UI：
//   1) 左侧栏「项目相册」入口 → 主区整页（自己的同源页面，iframe）
//   2) 悬停左侧工作区行 / 会话行 → 浮出最近几张图（不挪动布局）
//   3) 点图或点「相册 ›」→ 右侧浮出窄面板（dock，同一份页面的 dock 形态）
//
// 铁律：__ModuleLoader__.load 的 id 必须 === npm 包名（宿主 boot graph 按包名建行）。
window.__ModuleLoader__.load({
  id: 'dsh-project-gallery',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    const PANEL = 'project-gallery'
    const BASE = '/session-gallery'
    const PAGE = `${BASE}/`
    const API = `${BASE}/api`
    const LABEL = { zh: '项目相册', en: 'Project Album' }
    // 右侧栏 tab：宿主官方扩展点（sidebarRightTabs + slots）。kind 是我们自己的页类型。
    const TAB_KIND = 'dsh-project-gallery'
    const TAB_ID = 'dsh-project-gallery:album'
    const TITLE = { zh: '项目相册：会话图片与工作进展', en: 'Project album: session images and progress' }

    let lang = /^en\b/i.test(navigator.language) ? 'en' : 'zh'
    let scheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    /* ---------------- 图标 ---------------- */

    function AlbumIcon({ size }) {
      const s = size || 18
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 2.6 }),
        h('circle', { cx: 8.6, cy: 9.6, r: 1.5 }),
        h('path', { d: 'M4.2 16.4l4.3-4.1a1.7 1.7 0 0 1 2.3 0l3 2.9' }),
        h('path', { d: 'M13.2 13.6l1.9-1.8a1.7 1.7 0 0 1 2.3 0l2.4 2.3' }),
      )
    }

    /** 把主题推给我们的 iframe（dock / 全局浮层共用）。 */
    function pushTheme(frame) {
      try {
        frame.contentWindow.postMessage({ type: 'dsh-gallery:theme', scheme }, location.origin)
      } catch (error) {
        /* iframe 还没就绪：load 事件里会再推一次 */
      }
    }

    /* ---------------- 悬停浮条 + 右侧 dock ---------------- */

    const STYLE_ID = 'dsh-session-gallery-style'
    const CSS = `
      .sg-peek {
        position: fixed;
        z-index: 5200;
        width: 220px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 9px;
        border-radius: 8px;
        background: #26262a;
        border: 1px solid #3a3a40;
        /* 不要模糊、不要外发光、不要位移动画：避免在浅色界面上出现"呼吸灯"光晕 */
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
      }
      .sg-peek-head { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .sg-peek-head b {
        font-size: 12px; font-weight: 600; color: #ececee;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .sg-peek-head span { font-size: 11px; color: #9a9aa1; }
      .sg-peek-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
      }
      .sg-peek-thumb {
        aspect-ratio: 4 / 3; border-radius: 6px; overflow: hidden;
        background: #ffffff10; border: 0; padding: 0; cursor: zoom-in; display: block;
      }
      .sg-peek-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .sg-peek-thumb:hover { outline: 2px solid #3b82f6; outline-offset: -2px; }
      .sg-peek-bar {
        display: flex; align-items: center; gap: 4px;
      }
      .sg-peek-bar b { color: #ececee; }
      .sg-peek-bar .sg-spacer { flex: 1; }
      .sg-icon-btn {
        width: 20px; height: 20px; display: grid; place-items: center;
        border-radius: 6px; border: 0; background: none; cursor: pointer;
        color: #9a9aa1; font-size: 12px; line-height: 1;
      }
      .sg-icon-btn:hover { background: #ffffff18; color: #ececee; }

      .sg-peek.is-pinned {
        border-color: #3b82f680;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
      }
      .sg-peek-foot {
        display: flex; gap: 6px; align-items: center;
      }
      .sg-peek-open {
        flex: 1; border: 0; cursor: pointer;
        padding: 6px 9px; border-radius: 7px;
        background: #ffffff14; color: #e6e6ea; font-size: 12px; font-family: inherit;
      }
      .sg-peek-open:hover { background: #ffffff24; }

      .sg-dock {
        position: fixed;
        z-index: 5199;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: 12px;
        background: #1c1c1e;
        border: 1px solid #ffffff1a;
        box-shadow: 0 24px 60px #00000073, 0 0 0 1px #00000040;
        animation: sg-fade 140ms ease-out;
      }
      html[data-sg-theme="light"] .sg-dock { background: #f6f6f7; border-color: #0000001a; }
      .sg-dock iframe { flex: 1; border: 0; display: block; background: transparent; }
      .sg-global {
        position: fixed; inset: 12px; z-index: 5198;
        border-radius: 14px; overflow: hidden;
        background: #17171a; border: 1px solid #ffffff1a;
        box-shadow: 0 30px 80px #00000073;
        animation: sg-fade 140ms ease-out;
      }
      html[data-sg-theme="light"] .sg-global { background: #f6f6f7; border-color: #0000001a; }
      .sg-global iframe { width: 100%; height: 100%; border: 0; display: block; background: transparent; }
    `

    function ensureStyle() {
      let node = document.getElementById(STYLE_ID)
      if (node) return
      node = document.createElement('style')
      node.id = STYLE_ID
      node.textContent = CSS
      document.head.appendChild(node)
    }

    const MUTED_KEY = 'dsh-project-gallery:muted'
    const normPath = value => String(value || '').replace(/\/+$/, '')

    /**
     * 静音用 v2 结构：{v:2, projects:{[path]:{title,at}}, sessions:{[sessionId]:{at}}}。
     * 用 path 而不是 workspace uuid —— uuid 在删除重建/导入后会变，path 才是稳定身份。
     * v1（裸 id 数组）在拿到 summary 后迁移一次。
     */
    function loadMuted() {
      const empty = { v: 2, projects: {}, sessions: {}, legacy: null }
      let raw = null
      try {
        raw = JSON.parse(localStorage.getItem(MUTED_KEY) || 'null')
      } catch (error) {
        return empty
      }
      if (Array.isArray(raw)) return { ...empty, legacy: raw }
      if (raw && raw.v === 2) {
        return { v: 2, projects: raw.projects || {}, sessions: raw.sessions || {}, legacy: null }
      }
      return empty
    }

    function saveMuted(model) {
      try {
        localStorage.setItem(MUTED_KEY, JSON.stringify({ v: 2, projects: model.projects || {}, sessions: model.sessions || {} }))
      } catch (error) {
        /* 存不了就只在本次会话生效 */
      }
    }

    /** 首次拿到 summary 时把 v1 的 id 迁成 path/sessionId；认不出的丢弃。 */
    function migrateMuted(summary) {
      const model = loadMuted()
      if (!model.legacy) return model
      const legacy = new Set(model.legacy)
      for (const workspace of (summary && summary.workspaces) || []) {
        if (workspace.id && legacy.has(workspace.id)) {
          model.projects[normPath(workspace.path)] = { title: workspace.name, at: Date.now() }
        }
        for (const session of workspace.sessions || []) {
          if (session.id && legacy.has(session.id)) model.sessions[session.id] = { at: Date.now() }
        }
      }
      model.legacy = null
      saveMuted(model)
      return model
    }

    function isProjectMuted(path) {
      return Boolean(path) && Boolean(loadMuted().projects[normPath(path)])
    }

    function isSessionMuted(sessionId, workspacePath) {
      if (!sessionId) return false
      const model = loadMuted()
      return Boolean(model.sessions[sessionId]) || isProjectMuted(workspacePath)
    }

    function toggleProjectMute(path, title) {
      const model = loadMuted()
      const key = normPath(path)
      if (model.projects[key]) {
        delete model.projects[key]
        saveMuted(model)
        toast(`已恢复「${title || key}」的相册预览`)
        return false
      }
      model.projects[key] = { title, at: Date.now() }
      saveMuted(model)
      toast(`已静音「${title || key}」：不再自动弹预览（⌥ 悬停仍可看，右键可恢复）`)
      return true
    }

    function toggleSessionMute(sessionId, title) {
      const model = loadMuted()
      if (model.sessions[sessionId]) {
        delete model.sessions[sessionId]
        saveMuted(model)
        toast(`已恢复这次对话的预览`)
        return false
      }
      model.sessions[sessionId] = { at: Date.now() }
      saveMuted(model)
      toast(`已静音「${title || '这次对话'}」（⌥ 悬停仍可看）`)
      return true
    }

    const hoverState = {
      summary: null,
      summaryAt: 0,
      row: null,
      strip: null,
      dock: null,
      dockFrame: null,
      dockPath: '',
      hoverTimer: null,
      hideTimer: null,
      pinned: false,
      lastData: null,
      lastRow: null,
      placeTimers: [],
      global: null,
      globalFrame: null,
      stopHeaderWatch: null,
    }

    async function loadSummary() {
      if (hoverState.summary && Date.now() - hoverState.summaryAt < 30000) return hoverState.summary
      const response = await fetch(`${API}/summary`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('图库索引还没准备好')
      const data = await response.json()
      hoverState.summary = data
      hoverState.summaryAt = Date.now()
      migrateMuted(data) // v1（裸 id 数组）迁移成 v2（path / sessionId）
      return data
    }

    function workspaceFromRow(row) {
      const key = row.getAttribute('data-row-key') || ''
      if (!key.startsWith('workspace:')) return null
      return { kind: 'workspace', id: key.slice('workspace:'.length) }
    }

    function sessionFromRow(row) {
      const key = row.getAttribute('data-row-key') || ''
      if (!key.startsWith('session:')) return null
      return { kind: 'session', id: key.slice('session:'.length) }
    }

    async function stripDataFor(target) {
      if (target.kind === 'workspace') {
        const data = await loadSummary()
        const workspace = (data.workspaces || []).find(entry => entry.id === target.id)
        if (!workspace) return null
        if (workspace.thumbs && workspace.thumbs.length) {
          return {
            path: workspace.path,
            projectPath: workspace.path,
            sessionId: '',
            title: workspace.name,
            thumbs: workspace.thumbs.slice(0, 4),
            caption: statusLine(workspace),
          }
        }
        // 这个项目没有「AI 看过的图」，但目录里可能有一堆设计稿：现场扫一次（60 秒缓存）
        const response = await fetch(`${API}/workspace?path=${encodeURIComponent(workspace.path)}&limit=4`, { credentials: 'same-origin' })
        if (!response.ok) return null
        const detail = await response.json()
        const images = (detail.images || []).slice(0, 4)
        if (!images.length) return null
        return {
          path: workspace.path,
          projectPath: workspace.path,
          sessionId: '',
          title: workspace.name,
          thumbs: images,
          caption: `${images.length} 张磁盘图 · ${workspace.sessionCount || 0} 次会话`,
        }
      }
      const response = await fetch(`${API}/session?id=${encodeURIComponent(target.id)}`, { credentials: 'same-origin' })
      if (!response.ok) return null
      const data = await response.json()
      if (!data.ok || !data.session || !data.workspace) return null
      return {
        path: data.workspace.path,
        projectPath: data.workspace.path,
        sessionId: data.session.id,
        title: data.session.title || data.workspace.name,
        thumbs: (data.images || []).slice(0, 4),
        caption: `${(data.images || []).length} 张会话图 · ${data.session.turns || 0} 轮会话`,
      }
    }

    function statusLine(workspace) {
      const parts = [`${workspace.imageCount} 张图`]
      if (workspace.todos && workspace.todos.total) parts.push(`待办 ${workspace.todos.done}/${workspace.todos.total}`)
      if (workspace.sessionCount) parts.push(`${workspace.sessionCount} 次会话`)
      return parts.join(' · ')
    }

    function thumbSrc(image) {
      if (image.source === 'file' || image.filePath) return `${API}/thumb?path=${encodeURIComponent(image.filePath)}&w=160`
      return `${API}/thumb?sha=${encodeURIComponent(image.sha || image.key)}&w=160`
    }

    function hideStrip(force) {
      // 固定住的卡片不会被「鼠标移开/滚一下」赶走，只有 force（关它/开 dock）才收
      if (hoverState.pinned && !force) return
      for (const timer of hoverState.placeTimers || []) clearTimeout(timer)
      hoverState.placeTimers = []
      if (hoverState.strip) hoverState.strip.remove()
      hoverState.strip = null
      hoverState.row = null
      if (force) hoverState.pinned = false
    }

    /** 侧栏右边界（用来判断指针是不是正在往右挪向预览卡）。 */
    function sidebarRightEdge() {
      const row = document.querySelector('[data-row-key^="workspace:"], [data-row-key^="session:"]')
      return row ? row.getBoundingClientRect().right + 10 : 300
    }

    /**
     * 找宿主自己那张「工作区悬停卡」（就是显示路径 + 创建于 的那张）。
     * 我们没有它的公开句柄，只能按特征识别：fixed/absolute 定位、出现在侧栏右侧、
     * 宽 180–620、文本里有「创建于」。找不到就退回侧栏右边 —— 两种情况都不会压侧栏。
     */
    function findHostCard(rowRect) {
      // 宿主卡是 portal 到 body 的 fixed 卡：left ≈ 行右 + 8、与行纵向重叠过半。
      // 不 grep 文案（zh「创建于」/ en「Created」/ ja「作成日時」都会变，会话卡本来就没有这行）。
      const probeY = Math.min(window.innerHeight - 1, rowRect.top + rowRect.height / 2)
      for (const x of [rowRect.right + 12, rowRect.right + 40]) {
        if (x > window.innerWidth - 1) continue
        let node = document.elementFromPoint(x, probeY)
        for (let depth = 0; node && node !== document.body && depth < 8; depth += 1, node = node.parentElement) {
          if (node.classList && (node.classList.contains('sg-peek') || node.classList.contains('sg-dock') || node.classList.contains('sg-global'))) break
          const style = getComputedStyle(node)
          if (style.position !== 'fixed') continue
          const box = node.getBoundingClientRect()
          if (box.width < 150 || box.width > 700 || box.height < 40 || box.height > 420) continue
          if (box.left < rowRect.right - 2 || box.left > rowRect.right + 64) continue
          const overlap = Math.min(box.bottom, rowRect.bottom) - Math.max(box.top, rowRect.top)
          if (overlap < Math.min(rowRect.height, box.height) * 0.5) continue
          return { node, box }
        }
      }
      return null
    }

    /**
     * 悬停预览卡。
     *
     * 位置优先级：
     *   1) 贴宿主自己的悬停卡（显示路径/创建于的那张）**右侧**；
     *   2) 宿主卡还没出现/认不出来 → 贴侧栏右边缘，纵向对齐这一行。
     * 两种都不覆盖左侧工作区列表。
     *
     * 不消失：卡片上有个「固定」按钮；固定后鼠标移开、滚列表都不会收，
     * 只有点 ✕ / Esc / 打开相册才收。没固定时，指针往右挪（朝卡片方向）也不会收。
     */
    /** 当前是否按住 ⌥（用来"临时强制查看"被静音的项目）。实时读取，不缓存到 pointermove。 */
    let altHeld = false

    function workspacePathFor(id) {
      const data = hoverState.summary
      if (!data || !id) return ''
      const hit = (data.workspaces || []).find(entry => entry.id === id)
      return hit ? hit.path : ''
    }

    function mutedKeyOf(descriptor) {
      if (descriptor.kind === 'session') return { kind: 'session', sessionId: descriptor.id }
      return { kind: 'project', path: workspacePathFor(descriptor.id) }
    }

    function isMutedTarget(descriptor) {
      const key = mutedKeyOf(descriptor)
      return key.kind === 'session' ? isSessionMuted(key.sessionId) : isProjectMuted(key.path)
    }

    /** 静音行：只给一行小提示 + 恢复按钮，不是静默无反应。 */
    function showMutedHint(row, descriptor) {
      hideStrip()
      const rect = row.getBoundingClientRect()
      const card = document.createElement('div')
      card.className = 'sg-peek'
      card.style.width = '236px'
      const line = document.createElement('div')
      line.style.cssText = 'font-size:12px;color:#d6d6db;line-height:1.5;'
      line.textContent = '🔕 这个项目已静音'
      const note = document.createElement('div')
      note.style.cssText = 'font-size:11px;color:#9a9aa1;'
      note.textContent = '按住 ⌥ 可临时查看'
      const restore = document.createElement('button')
      restore.className = 'sg-peek-open'
      restore.textContent = '恢复自动预览'
      restore.addEventListener('click', event => {
        event.stopPropagation()
        const key = mutedKeyOf(descriptor)
        if (key.kind === 'session') toggleSessionMute(key.sessionId, '')
        else toggleProjectMute(key.path, '')
        hideStrip(true)
      })
      card.append(line, note, restore)
      card.style.visibility = 'hidden'
      document.body.appendChild(card)
      hoverState.strip = card
      const width = card.offsetWidth || 236
      const height = card.offsetHeight || 90
      card.style.left = `${Math.min(Math.max(12, Math.round(rect.right + 14)), Math.max(12, window.innerWidth - width - 12))}px`
      card.style.top = `${Math.min(Math.max(12, Math.round(rect.top)), Math.max(12, window.innerHeight - height - 12))}px`
      card.style.visibility = 'visible'
      card.addEventListener('mouseenter', () => clearTimeout(hoverState.hideTimer))
      card.addEventListener('mouseleave', scheduleHide)
    }

    function showPeek(row, data) {
      if (!row.isConnected) return
      hideStrip()
      hoverState.row = row
      hoverState.rowTop = row.getBoundingClientRect().top
      const rect = row.getBoundingClientRect()
      const card = document.createElement('div')
      card.className = 'sg-peek'

      const bar = document.createElement('div')
      bar.className = 'sg-peek-bar'
      const title = document.createElement('b')
      title.textContent = data.title
      title.style.overflow = 'hidden'
      title.style.textOverflow = 'ellipsis'
      title.style.whiteSpace = 'nowrap'
      title.style.flex = '1'
      title.style.minWidth = '0'
      const pin = document.createElement('button')
      pin.className = 'sg-icon-btn'
      pin.title = '固定住（鼠标移开也不消失）'
      pin.textContent = '📌'
      const close = document.createElement('button')
      close.className = 'sg-icon-btn'
      close.title = '关闭 (Esc)'
      close.textContent = '✕'
      bar.append(title, pin, close)

      const caption = document.createElement('span')
      caption.className = 'sg-peek-caption'
      caption.textContent = data.caption
      caption.style.fontSize = '11px'
      caption.style.color = '#9a9aa1'

      const grid = document.createElement('div')
      grid.className = 'sg-peek-grid'
      for (const image of data.thumbs.slice(0, 4)) {
        const button = document.createElement('button')
        button.className = 'sg-peek-thumb'
        button.title = image.name || ''
        const img = document.createElement('img')
        img.src = thumbSrc(image)
        img.alt = image.name || ''
        img.loading = 'lazy'
        button.append(img)
        button.addEventListener('click', event => {
          event.stopPropagation()
          openDock(data.path, image, data.sessionId)
        })
        grid.append(button)
      }

      const foot = document.createElement('div')
      foot.className = 'sg-peek-foot'
      const open = document.createElement('button')
      open.className = 'sg-peek-open'
      open.textContent = lang === 'en' ? 'Open album' : '打开相册'
      open.addEventListener('click', event => {
        event.stopPropagation()
        openDock(data.path, null, data.sessionId)
      })
      const all = document.createElement('button')
      all.className = 'sg-icon-btn'
      all.title = lang === 'en' ? 'All projects (⌘⇧G)' : '全部项目（⌘⇧G）'
      all.textContent = '▦'
      all.style.width = '26px'
      all.addEventListener('click', event => {
        event.stopPropagation()
        hideStrip(true)
        openGlobal()
      })
      foot.append(open, all)
      {
        const muted = data.sessionId
          ? isSessionMuted(data.sessionId, data.projectPath)
          : isProjectMuted(data.projectPath)
        const mute = document.createElement('button')
        mute.className = 'sg-icon-btn'
        mute.style.width = '26px'
        mute.textContent = muted ? '🔔' : '⊘'
        mute.title = muted
          ? (lang === 'en' ? 'Resume previews' : '恢复自动预览')
          : (lang === 'en' ? 'Stop previews' : '不再自动预览')
        mute.addEventListener('click', event => {
          event.stopPropagation()
          if (data.sessionId) toggleSessionMute(data.sessionId, data.title)
          else toggleProjectMute(data.projectPath, data.title)
          hideStrip(true)
        })
        foot.append(mute)
      }

      card.append(bar, caption, grid, foot)

      pin.addEventListener('click', event => {
        event.stopPropagation()
        hoverState.pinned = !hoverState.pinned
        card.classList.toggle('is-pinned', hoverState.pinned)
        pin.title = hoverState.pinned ? '已固定：点一下取消' : '固定住（鼠标移开也不消失）'
        pin.textContent = hoverState.pinned ? '📌' : '📌'
        toast(hoverState.pinned ? '已固定，按 Esc 或 ✕ 关闭' : '已取消固定')
      })
      close.addEventListener('click', event => {
        event.stopPropagation()
        hideStrip(true)
      })

      // 先量尺寸，再决定落点（宿主卡可能比我们晚出现，所以两段测量）
      card.style.visibility = 'hidden'
      card.style.left = '0px'
      card.style.top = '0px'
      document.body.appendChild(card)
      hoverState.strip = card
      hoverState.lastData = data
      hoverState.lastRow = row

      let hostFound = false
      const place = () => {
        const width = card.offsetWidth || 240
        const height = card.offsetHeight || 220
        // 探测前先把自己藏起来：否则我们自己的卡会盖住宿主卡，elementFromPoint 只能点到我们
        const previous = card.style.visibility
        card.style.visibility = 'hidden'
        const host = findHostCard(rect)
        card.style.visibility = previous
        if (host) hostFound = true
        const desiredLeft = host ? host.box.right + 14 : rect.right + 14
        const left = Math.min(Math.max(12, Math.round(desiredLeft)), Math.max(12, window.innerWidth - width - 12))
        const desiredTop = host ? host.box.top : rect.top - 8
        const top = Math.min(Math.max(12, Math.round(desiredTop)), Math.max(12, window.innerHeight - height - 12))
        card.style.left = `${left}px`
        card.style.top = `${top}px`
        card.style.visibility = 'visible'
      }
      place()
      // 宿主卡出现得比我们晚：多次对位，第一次认出宿主卡就停
      const retries = [120, 420, 900].map(delay => setTimeout(() => { if (!hostFound) place() }, delay))
      card.addEventListener('mouseenter', () => clearTimeout(hoverState.hideTimer))
      card.addEventListener('mouseleave', scheduleHide)
      hoverState.placeTimers = retries
      trackUsage('hover-strip', data.path)
    }

    let toastTimer = null
    /** 极简提示：固定/取消固定时给一句反馈，2 秒自走。 */
    function toast(message) {
      let node = document.getElementById('dsh-project-gallery-toast')
      if (!node) {
        node = document.createElement('div')
        node.id = 'dsh-project-gallery-toast'
        node.style.cssText = [
          'position:fixed', 'left:50%', 'bottom:32px', 'transform:translateX(-50%)',
          'padding:7px 14px', 'border-radius:9px', 'font-size:12px', 'z-index:5300',
          'background:#2a2a2ef2', 'color:#ececee', 'border:1px solid #ffffff1f',
          'box-shadow:0 10px 26px #00000059', 'pointer-events:none', 'font-family:inherit',
        ].join(';')
        document.body.appendChild(node)
      }
      node.textContent = message
      node.style.display = 'block'
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        node.style.display = 'none'
      }, 2000)
    }

    function trackUsage(event, workspacePath) {
      try {
        fetch(`${API}/usage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event, workspacePath: workspacePath || '' }),
          keepalive: true,
        }).catch(() => {})
      } catch (error) {
        /* 埋点失败不影响悬停 */
      }
    }

    function scheduleHide() {
      clearTimeout(hoverState.hideTimer)
      hoverState.hideTimer = setTimeout(() => hideStrip(), 200)
    }

    function openDock(path, image, sessionId) {
      if (!path) return
      hideStrip(true)
      ensureStyle()
      if (hoverState.dock && hoverState.dockPath === path && hoverState.dockSession === (sessionId || '') && hoverState.dockFrame) {
        if (image) {
          try {
            hoverState.dockFrame.contentWindow.postMessage({ type: 'dsh-gallery:focus', key: image.sha || image.filePath || image.key }, location.origin)
          } catch (error) {
            /* 跨帧消息失败时退回重开，保证能看到图 */
          }
        }
        return
      }
      closeDock()
      const dock = document.createElement('div')
      dock.className = 'sg-dock'
      placeDock(dock, false)
      const frame = document.createElement('iframe')
      const query = new URLSearchParams({ mode: 'dock', path, theme: scheme, lang })
      if (sessionId) query.set('session', sessionId)
      if (image) query.set('focusKey', image.sha || image.filePath || image.key || '')
      frame.src = `${PAGE}?${query.toString()}`
      frame.title = TITLE[lang]
      frame.addEventListener('load', () => pushTheme(frame))
      dock.append(frame)
      document.body.appendChild(dock)
      hoverState.dock = dock
      hoverState.dockFrame = frame
      hoverState.dockPath = path
      hoverState.dockSession = sessionId || ''
      trackUsage('open-dock', path)
    }

    function placeDock(dock, expanded) {
      const width = Math.min(420, Math.round(window.innerWidth * 0.34))
      if (expanded) {
        // 看大图时也不要铺满整块屏幕：给一个"播放器"尺寸（最大 1180×820），居中
        const w = Math.min(1180, Math.round(window.innerWidth * 0.86))
        const h = Math.min(760, Math.round(window.innerHeight * 0.82))
        dock.style.right = 'auto'
        dock.style.bottom = 'auto'
        dock.style.width = `${w}px`
        dock.style.height = `${h}px`
        dock.style.left = `${Math.round((window.innerWidth - w) / 2)}px`
        dock.style.top = `${Math.round((window.innerHeight - h) / 2)}px`
        return
      }
      dock.style.left = 'auto'
      dock.style.bottom = 'auto'
      dock.style.top = `${Math.round(Math.max(48, window.innerHeight * 0.14))}px`
      dock.style.right = '14px'
      dock.style.width = `${Math.max(320, width)}px`
      dock.style.height = `${Math.round(Math.min(640, window.innerHeight * 0.68))}px`
    }

    /**
     * 右侧栏 tab 的正文：一个同源 iframe，指向我们自己的图库页。
     * 没带 path 时落成「全部项目 / 最新图片」，带了就落成那个项目（或那个会话）的相册。
     */
    function GalleryPaneBody({ useTabInfo }) {
      let params = {}
      try {
        const info = typeof useTabInfo === 'function' ? useTabInfo() : null
        params = (info && info.tab && info.tab.navigation && info.tab.navigation.params) || {}
      } catch (error) {
        params = {}
      }
      const path = typeof params.path === 'string' ? params.path : ''
      const session = typeof params.session === 'string' ? params.session : ''
      const query = new URLSearchParams({ mode: 'dock', theme: scheme, lang })
      if (path) query.set('path', path)
      if (session) query.set('session', session)
      return h('iframe', {
        className: 'sg-pane-frame',
        src: `${PAGE}?${query.toString()}`,
        title: TITLE[lang],
        style: { display: 'block', width: '100%', height: '100%', border: '0', background: 'transparent' },
      })
    }

    /** 在右侧栏打开相册 tab；宿主没有这个席位时退回原来的右侧浮层。 */
    function openRightPane(params) {
      if (typeof hoverState.openAlbumTab === 'function') {
        try {
          hoverState.openAlbumTab(params || {})
          return true
        } catch (error) {
          /* 席位在但打不开（比如没有会话）：退回浮层 */
        }
      }
      const target = params || {}
      if (target.path || target.session) {
        openDock(target.path || '', null, target.session || '')
        return false
      }
      openGlobal()
      return false
    }

    /** 全局相册：覆盖主区的浮层（不占常驻位置），Esc/✕ 关闭。 */
    function openGlobal() {
      if (hoverState.global) return
      const overlay = document.createElement('div')
      overlay.className = 'sg-global'
      const frame = document.createElement('iframe')
      const query = new URLSearchParams({ mode: 'full', theme: scheme, lang })
      frame.src = `${PAGE}?${query.toString()}`
      frame.title = TITLE[lang]
      frame.addEventListener('load', () => pushTheme(frame))
      overlay.append(frame)
      overlay.addEventListener('click', event => {
        if (event.target === overlay) closeGlobal()
      })
      document.body.appendChild(overlay)
      hoverState.global = overlay
      hoverState.globalFrame = frame
      trackUsage('open-full', '')
    }

    function closeGlobal() {
      if (hoverState.globalFrame) hoverState.globalFrame.remove()
      if (hoverState.global) hoverState.global.remove()
      hoverState.global = null
      hoverState.globalFrame = null
    }

    /** 把「项目相册」做成工作区头部图标区里的一个小按钮：不新增行高、不占常驻位置。 */
    function ensureHeaderButton() {
      const anchor = document.querySelector('[aria-label="添加工作区"]')
      if (!anchor) return
      const host = anchor.parentElement
      if (!host || host.querySelector('[data-sg-header]')) return
      const button = anchor.cloneNode(false)
      button.setAttribute('data-sg-header', '1')
      button.removeAttribute('aria-haspopup')
      button.setAttribute('aria-label', '项目相册')
      button.title = lang === 'en' ? 'Project album' : '项目相册'
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.6"/><circle cx="8.6" cy="9.6" r="1.5"/><path d="M4.2 16.4l4.3-4.1a1.7 1.7 0 0 1 2.3 0l3 2.9"/><path d="M13.2 13.6l1.9-1.8a1.7 1.7 0 0 1 2.3 0l2.4 2.3"/></svg>'
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        openGlobal()
      })
      host.insertBefore(button, anchor.nextSibling)
    }

    function closeDock() {
      if (hoverState.dock) hoverState.dock.remove()
      hoverState.dock = null
      hoverState.dockFrame = null
      hoverState.dockPath = ''
    }

    /** 悬停 700ms 后弹预览；⌥ 时强制（含被静音的项目）。pointermove 与 Alt 键共用。 */
    function armPeek(row, force) {
      if (!row || !row.isConnected) return
      if (hoverState.pinned) return
      hoverState.row = row
      clearTimeout(hoverState.hoverTimer)
      hoverState.hoverTimer = setTimeout(async () => {
        if (hoverState.row !== row || !row.isConnected) return
        const workspace = workspaceFromRow(row)
        const session = sessionFromRow(row)
        const descriptor = workspace || session
        if (!descriptor) return
        const muted = isMutedTarget(descriptor)
        if (!force && !altHeld && muted) {
          showMutedHint(row, descriptor)
          return
        }
        try {
          const data = await stripDataFor(descriptor)
          if (!data || hoverState.row !== row) return
          showPeek(row, data)
        } catch (error) {
          console.warn('[project-gallery] 悬停预览失败：', error && error.message ? error.message : error)
        }
      }, 700)
    }

    function bindHostInteractions() {
      const teardown = []
      const on = (target, type, handler, options) => {
        target.addEventListener(type, handler, options)
        teardown.push(() => target.removeEventListener(type, handler, options))
      }
      document.documentElement.dataset.sgTheme = scheme
      ensureStyle()

      let pending = null
      on(document,
        'pointermove',
        event => {
          const target = event.target
          if (!(target instanceof Element)) return
          if (target.closest('.sg-peek, .sg-dock, .sg-global')) {
            clearTimeout(hoverState.hideTimer)
            return
          }
          const row = target.closest('[data-row-key^="workspace:"], [data-row-key^="session:"]')
          if (!row) {
            if (!hoverState.strip) {
              clearTimeout(hoverState.hoverTimer)
              hoverState.row = null
              return
            }
            // 指针已经在侧栏右边（正在朝卡片移动）→ 保持不动，别在这儿把它收掉
            if (event.clientX > sidebarRightEdge() - 6) return
            scheduleHide()
            return
          }
          if (hoverState.pinned) return // 固定住的那张不被别的行顶掉
          // 只在行的右侧「⋯」操作区响应：其余位置交给宿主自己的文字预览（视觉更干净）
          const rowRect = row.getBoundingClientRect()
          const zoneStart = rowRect.right - 40
          if (event.clientX < zoneStart) {
            clearTimeout(hoverState.hoverTimer)
            if (hoverState.strip) scheduleHide()
            else hoverState.row = null
            return
          }
          if (hoverState.row === row && !event.altKey) return
          armPeek(row, event.altKey)
        },
        true,
      )

      const onScroll = event => {
        if (!hoverState.strip) return
        const target = event.target
        if (target instanceof Element && target.closest('.sg-peek, .sg-dock, .sg-global')) return
        const row = hoverState.row
        if (!row || !row.isConnected) {
          hideStrip()
          return
        }
        const top = row.getBoundingClientRect().top
        // 宿主对截断的会话标题做逐帧 marquee（scrollTo），行本身没动 → 不算滚动
        if (hoverState.rowTop !== undefined && Math.abs(top - hoverState.rowTop) <= 2) return
        hideStrip()
      }
      on(document, 'scroll', onScroll, true)

      ensureHeaderButton()
      // 宿主头部按钮可能比插件晚挂载：用 MutationObserver 等它出现，最多等 12 秒。
      // 不用常驻 setInterval(1200)：那会让主线程每秒都醒一次，纯属白耗。
      let headerObserver = null
      let headerGiveUp = 0
      const stopHeaderWatch = () => {
        if (headerObserver) {
          headerObserver.disconnect()
          headerObserver = null
        }
        if (headerGiveUp) {
          clearTimeout(headerGiveUp)
          headerGiveUp = 0
        }
      }
      if (!document.querySelector('[data-sg-header]')) {
        headerObserver = new MutationObserver(() => {
          ensureHeaderButton()
          if (document.querySelector('[data-sg-header]')) stopHeaderWatch()
        })
        headerObserver.observe(document.body, { childList: true, subtree: true })
        headerGiveUp = setTimeout(stopHeaderWatch, 12_000)
      }
      hoverState.stopHeaderWatch = stopHeaderWatch
      teardown.push(stopHeaderWatch)

      // 右侧栏 tab：宿主官方席位（sidebarRightTabs + slots）。
      // 写法对齐宿主自己的 provider（scope.effect 托管清理）；注册失败就整段跳过，
      // 悬停卡片与浮层照常工作。
      try {
        ctx.inject(['sidebarRightTabs', 'slots', 'sidebarRight'], scope => {
          try {
            scope.effect(() => scope.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              priority: 'extension',
              keepMounted: true,
              title: () => (lang === 'en' ? 'Project album' : '项目相册'),
              guide: [{
                id: 'album',
                order: 60,
                title: () => (lang === 'en' ? 'Project album' : '项目相册'),
                description: () => (lang === 'en' ? 'Latest images from this session and its project' : '这次会话与它所在项目里最新的图'),
              }],
            }), 'dsh-project-gallery: right-pane type')
          } catch (error) {
            /* 重复注册或宿主不支持这个席位 */
          }
          try {
            scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () =>
              scope.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, GalleryPaneBody)),
            'dsh-project-gallery: right-pane body')
          } catch (error) {
            /* slots.inject 不可用 */
          }
          hoverState.openAlbumTab = params => scope.sidebarRight.openTab(TAB_KIND, { params: params || {} })
          teardown.push(() => {
            hoverState.openAlbumTab = null
          })
        })
      } catch (error) {
        /* 没有右栏席位的宿主 */
      }

      // 索引可能还没建：后台预热一次（静音判定也要用 id→path 映射，所以尽早拉）
      loadSummary().catch(() => {})
      setTimeout(() => {
        loadSummary().catch(() => {})
      }, 4000)

      return () => {
        for (const off of teardown.reverse()) {
          try { off() } catch (error) { /* 卸载失败不该拦住宿主 */ }
        }
      }
    }

    /* ---------------- 插件装配 ---------------- */

    function apply(ctx) {
      try {
        ctx.inject(['theme'], scope => {
          const push = snapshot => {
            const next = snapshot?.active?.colorScheme
            if (next === 'dark' || next === 'light') {
              scheme = next
              document.documentElement.dataset.sgTheme = next
              if (hoverState.dockFrame) pushTheme(hoverState.dockFrame)
              if (hoverState.globalFrame) pushTheme(hoverState.globalFrame)
            }
          }
          push(scope.theme.getTheme())
          scope.on('theme/change', push)
        })
      } catch (error) {
        /* 老宿主没有 theme 服务：跟随系统 */
      }

      try {
        ctx.inject(['locale'], scope => {
          const push = snapshot => {
            const active = snapshot?.active
            const value = typeof active === 'string' ? active : active?.lang ?? active?.id
            if (typeof value === 'string') lang = value.toLowerCase().startsWith('en') ? 'en' : 'zh'
          }
          push(scope.locale.getSnapshot())
          scope.on('locale/change', push)
        })
      } catch (error) {
        /* 没有 locale 服务就用浏览器语言 */
      }

      ctx.effect(() => {
        const dispose = bindHostInteractions()
        return () => {
          if (typeof dispose === 'function') dispose()
          hideStrip(true)
          closeDock()
          closeGlobal()
          if (hoverState.stopHeaderWatch) hoverState.stopHeaderWatch()
        }
      })
    }

    exports.isPlugin = true
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
