// 埋点：白名单、短哈希不泄漏路径、门槛判定。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recordUsage, scopeHash, summarizeUsage, readUsage } from '../core/lib/usage.mjs'

function tempStore() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-usage-'))
}

test('只接受白名单事件，其它丢弃', () => {
  const store = tempStore()
  assert.equal(recordUsage(store, 'open-full', '/tmp/proj'), true)
  assert.equal(recordUsage(store, 'evil-event', '/tmp/proj'), false)
  assert.equal(readUsage(store).length, 1)
})

test('路径只存 8 位短哈希，不能反推原文', () => {
  const store = tempStore()
  recordUsage(store, 'hover-strip', '/Users/someone/code/secret-project')
  const raw = fs.readFileSync(path.join(store, 'usage.jsonl'), 'utf8')
  assert.equal(raw.includes('secret-project'), false, '文件里不能出现项目名')
  assert.equal(scopeHash('/Users/someone/code/secret-project').length, 8)
})

test('门槛判定：同一周 3 天主动打开才算达标', () => {
  const store = tempStore()
  const file = path.join(store, 'usage.jsonl')
  fs.mkdirSync(store, { recursive: true })
  const now = Date.now()
  const day = 86400000
  fs.writeFileSync(
    file,
    [
      { t: now - 6 * day, e: 'open-full', s: 'aaaaaaaa' },
      { t: now - 3 * day, e: 'open-dock', s: 'aaaaaaaa' },
      { t: now - 1 * day, e: 'open-lightbox', s: 'aaaaaaaa' },
      { t: now - 1 * day, e: 'hover-strip', s: 'aaaaaaaa' },
    ]
      .map(row => JSON.stringify(row))
      .join('\n') + '\n',
  )
  const summary = summarizeUsage(store, 28)
  assert.equal(summary.activeDaysLast7, 3, '悬停不算主动打开，三次打开落在 3 个不同天')
  assert.match(summary.verdict, /达到/)
})
