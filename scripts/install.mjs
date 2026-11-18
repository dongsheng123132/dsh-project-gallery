#!/usr/bin/env node
// 一条命令把「项目相册」装进某个 DSH profile —— 和 dsh-gallery 用的同一套机制
// （复制/软链到 profile 的 node_modules + 注册到 package.json 的 dsh.profile.bundles），
// 但多做了三件事：备份 package.json、--dry-run 预演、--rollback 一条命令还原。
//
//   node scripts/install.mjs                        # 自动选 profile（只有一个时用它，多个时选 desktop）
//   node scripts/install.mjs --profile desktop       # 指定 profile
//   node scripts/install.mjs --dry-run               # 只看会做什么
//   node scripts/install.mjs --rollback              # 还原上一次安装
//   node scripts/install.mjs --copy                  # 复制文件而不是软链（换机器/避免路径依赖时用）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const PKG = 'dsh-project-gallery'
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

function parseArgs(argv) {
  const out = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[index + 1]
      if (next && !next.startsWith('--')) {
        out[key] = next
        index += 1
      } else out[key] = true
    } else out._.push(token)
  }
  return out
}

/** package.json 原子写：写完再 rename，避免进程被杀留半截让 DSH 起不来。 */
function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(temporary, file)
}

const args = parseArgs(process.argv.slice(2))
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const profilesDir = path.join(dshHome, 'profiles')

function log(message) {
  console.log(message)
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!fs.existsSync(profilesDir)) fail(`找不到 DSH profile 目录：${profilesDir}（先装 DSH 或设 DSH_HOME）`)

const profiles = fs
  .readdirSync(profilesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
  .map(entry => entry.name)
  .filter(name => fs.existsSync(path.join(profilesDir, name, 'package.json')))
if (!profiles.length) fail(`没有可用的 profile（${profilesDir}）`)

if (args.profile === true) fail('--profile 后面要跟 profile 名字，例如 --profile desktop')
const profile = typeof args.profile === 'string' ? args.profile : profiles.includes('desktop') ? 'desktop' : profiles[0]
const profileDir = path.join(profilesDir, profile)
const manifestPath = path.join(profileDir, 'package.json')
const targetDir = path.join(profileDir, 'node_modules', PKG)

if (args.rollback) {
  // 只摘掉本插件：整份覆盖备份会把「装完之后才装的别的插件」一起抹掉
  const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  let touched = false
  if (current.dependencies && PKG in current.dependencies) {
    delete current.dependencies[PKG]
    touched = true
  }
  const list = current?.dsh?.profile?.bundles
  if (Array.isArray(list) && list.includes(PKG)) {
    current.dsh.profile.bundles = list.filter(name => name !== PKG)
    touched = true
  }
  if (touched) writeJsonAtomic(manifestPath, current)
  if (fs.lstatSync(targetDir, { throwIfNoEntry: false })) fs.rmSync(targetDir, { recursive: true, force: true })
  log(touched ? `✓ 已从 ${profile} 摘掉 ${PKG}（其余插件注册保持不变）` : `${profile} 里本来就没有 ${PKG}`)
  log('  重启 DSH 生效。')
  process.exit(0)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []

// Windows 上建目录软链需要管理员/开发者模式，默认改为复制
const useCopy = Boolean(args.copy) || process.platform === 'win32'
const alreadyBundle = bundles.includes(PKG)
const alreadyDep = Boolean(manifest.dependencies[PKG])
const alreadyLinked = Boolean(fs.lstatSync(targetDir, { throwIfNoEntry: false }))

log(`DSH home      ${dshHome}`)
log(`profile       ${profile}  (${profiles.join(', ')})`)
log(`安装方式      ${useCopy ? '复制文件' : '软链到源码目录 ' + repoRoot}`)
log(`目标位置      ${targetDir}`)
log(`package.json  ${alreadyDep ? '已有依赖' : '将新增依赖'} · ${alreadyBundle ? '已在 bundles' : '将加入 bundles'}`)

if (args['dry-run']) {
  log('\n（--dry-run）什么都没写。')
  process.exit(0)
}

// 1) 备份 package.json，名字带插件名，便于回滚与人工核对
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(profileDir, `package.json.bak-${PKG}-${stamp}`)
fs.copyFileSync(manifestPath, backup)
log(`✓ 已备份 package.json → ${path.basename(backup)}`)

// 2) 放进 node_modules（软链便于改代码即时生效；复制适合换机器）
fs.mkdirSync(path.dirname(targetDir), { recursive: true })
if (fs.lstatSync(targetDir, { throwIfNoEntry: false })) fs.rmSync(targetDir, { recursive: true, force: true })
if (useCopy) {
  fs.cpSync(repoRoot, targetDir, {
    recursive: true,
    filter: source => !/\/(\.git|\.data|node_modules)(\/|$)/.test(source.replace(/\\/g, '/')),
  })
} else {
  fs.symlinkSync(repoRoot, targetDir, 'dir')
}

// 3) 注册依赖 + bundle
for (const required of ['package.json', 'adapters/dsh-plugin/plugin.mjs', 'adapters/dsh-plugin/client.js', 'adapters/dsh-plugin/cordis.patch.yml']) {
  if (!fs.existsSync(path.join(targetDir, required))) fail(`安装包不完整：缺 ${required}`)
}
// 复制模式：指向源码目录（不指向 profile 的 node_modules，避免自引用/循环来源）
manifest.dependencies[PKG] = useCopy ? `file:${repoRoot.replace(/\\/g, '/')}` : `link:${repoRoot}`
if (!bundles.includes(PKG)) bundles.push(PKG)
manifest.dsh.profile.bundles = bundles
writeJsonAtomic(manifestPath, manifest)

log('✓ 已写入 package.json（dependencies + dsh.profile.bundles）')
log('')
log('下一步：**重启 DSH**，左侧栏会出现「项目相册」。')
log(`出问题一条命令还原： node ${path.relative(process.cwd(), here)}/install.mjs --profile ${profile} --rollback`)
