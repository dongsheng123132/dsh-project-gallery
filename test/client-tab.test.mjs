// 右侧栏 tab 的宿主端冒烟测试：不启动 DSH，只把 client.js 在假 window/document 里装一遍，
// 断言「注册了正确的席位 + 从 iframe 发来的消息能打开右栏」。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CLIENT = path.resolve(import.meta.dirname, '..', 'adapters', 'dsh-plugin', 'client.js')

function makeEnv() {
  const listeners = new Map()
  const add = (target, type, handler) => {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push({ target, handler })
  }
  const remove = (target, type, handler) => {
    const list = listeners.get(type) || []
    listeners.set(type, list.filter(entry => entry.handler !== handler))
  }
  const emit = (type, event) => {
    for (const entry of listeners.get(type) || []) entry.handler(event)
  }

  const element = () => ({
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    append() {},
    appendChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null },
    querySelector() { return null },
    querySelectorAll() { return [] },
    getBoundingClientRect() { return { top: 0, right: 0, width: 0, height: 0 } },
    insertBefore() {},
    cloneNode() { return element() },
  })

  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true })
  globalThis.localStorage = { getItem() { return null }, setItem() {}, removeItem() {} }
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 0)
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, workspaces: [] }) })
  globalThis.document = {
    documentElement: { dataset: {}, style: {} },
    body: element(),
    head: element(),
    createElement: () => element(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, handler) => add('document', type, handler),
    removeEventListener: (type, handler) => remove('document', type, handler),
    getElementById: () => null,
  }
  globalThis.location = { origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' }
  globalThis.Element = class {}
  globalThis.window = {
    location: { origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (type, handler) => add('window', type, handler),
    removeEventListener: (type, handler) => remove('window', type, handler),
    innerWidth: 1440,
    innerHeight: 900,
  }
  return { emit, listeners }
}

function fakeReact() {
  const createElement = (type, props, ...children) => ({ type, props: { ...(props || {}), children } })
  return { createElement, memo: fn => fn, useEffect() {}, useState: value => [value, () => {}] }
}

test('client.js 在宿主里装起来时，会注册右侧栏 tab 与正文席位', async () => {
  const env = makeEnv()
  const registrations = { tabs: [], slots: [], opens: [] }
  let factory = null
  globalThis.window.__ModuleLoader__ = {
    load(definition) {
      assert.equal(definition.id, 'dsh-project-gallery', 'host 半片与 client 半片必须同一个模块 id')
      factory = definition.factory
    },
  }

  await import(`${pathToFileURL(CLIENT).href}?t=${Date.now()}`)
  assert.ok(factory, 'client.js 必须通过 __ModuleLoader__.load 注册工厂')

  const exports = factory(name => {
    if (name === 'react') return fakeReact()
    throw new Error(`unexpected require: ${name}`)
  })
  assert.equal(exports.isPlugin, true)
  assert.equal(typeof exports.apply, 'function')

  const cleanups = []
  const ctx = {
    inject(deps, callback) {
      if (deps.includes('sidebarRightTabs')) {
        callback({
          sidebarRightTabs: { register: definition => { registrations.tabs.push(definition); return () => {} } },
          slots: {
            inject: (seat, factoryFn) => { const dispose = factoryFn && factoryFn(); return typeof dispose === 'function' ? dispose : () => {} },
            register: (definition, body) => { registrations.slots.push({ definition, body }); return () => {} },
          },
          sidebarRight: { openTab: (kind, options) => { registrations.opens.push({ kind, options }) } },
          effect: fn => { const dispose = fn(); cleanups.push(dispose) },
        })
      } else if (deps.includes('theme')) {
        callback({ theme: { getTheme: () => ({ active: { colorScheme: 'light' } }) , on() {} }, on() {} })
      } else if (deps.includes('locale')) {
        callback({ locale: { getSnapshot: () => ({ active: 'zh' }), on() {} }, on() {} })
      }
    },
    effect(fn) {
      const dispose = fn()
      cleanups.push(dispose)
    },
    get: () => null,
    logger: { info() {} },
  }

  exports.apply(ctx)

  const tab = registrations.tabs.find(entry => entry.kind === 'dsh-project-gallery')
  assert.ok(tab, '必须注册 kind 为 dsh-project-gallery 的右栏类型')
  assert.equal(tab.id, 'dsh-project-gallery:album')
  assert.equal(tab.priority, 'extension')
  assert.equal(tab.keepMounted, true)
  assert.ok(Array.isArray(tab.guide) && tab.guide.length > 0, '要有引导页入口，否则用户找不到')

  const body = registrations.slots.find(entry => entry && entry.definition && entry.definition.name === 'sidebar.right.pane.tab')
  assert.ok(body, '必须注册 sidebar.right.pane.tab 正文')
  assert.equal(body.definition.key, 'dsh-project-gallery:album')
  assert.equal(typeof body.body, 'function')

  if (process.env.SG_DEBUG) console.log('listeners:', [...env.listeners.keys()])
  // 宿主没有会话也能打开：发一条来自 iframe 的消息，应落到 openTab
  env.emit('message', { origin: 'http://127.0.0.1', data: { type: 'dsh-gallery:open-right', path: '/demo/x' } })
  assert.equal(registrations.opens.length, 1, '消息应触发右栏打开')
  assert.equal(registrations.opens[0].kind, 'dsh-project-gallery')
  assert.equal(registrations.opens[0].options.params.path, '/demo/x')

  // 正文组件在没有 useTabInfo 时也不能崩
  const tree = body.body({})
  assert.equal(tree.type, 'iframe')
  assert.match(tree.props.src, /mode=dock/)

  // 收拾定时器（宿主头部最多等 12 秒），否则测试进程要陪着等
  for (const dispose of cleanups.reverse()) {
    try { if (typeof dispose === 'function') dispose() } catch (error) { /* 同上 */ }
  }
})
