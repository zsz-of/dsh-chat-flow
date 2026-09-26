/**
 * 把本插件安装进一个 DSH profile（默认 `web`，即桌面壳用的那个）。
 *
 * 安装做三件事，顺序不能换：
 * 1. **先重建客户端 bundle**——绝不出现「源码改了但线上还跑旧 bundle」；
 * 2. 建两条 junction：插件源码进 `<profile>/node_modules/<包名>`，
 *    以及开发态的 `@deepseek-ai` 依赖链接（host 半侧只用 peer，靠这条链接解析）；
 * 3. 把包名写进 profile `package.json` 的 `dependencies`（spec 用 `link:`，理由见 `dependencySpec()`）
 *    与 `dsh.profile.bundles`，
 *    然后跑 `dsh --profile <p> --dump-config` **断言插件行真的进了组合结果**——
 *    脏配置绝不留给重启后的桌面壳去踩。
 *
 * `--revert` 反向执行第 2、3 步（客户端 bundle 与依赖链接保留）。
 * 校验失败**不会**自动回滚：脚本只置退出码并提示执行 `--revert`，
 * 因为自动回滚会把「为什么失败」的证据一起抹掉。
 *
 * 用法：
 * ```text
 * node scripts/install.mjs                 # 构建 + 安装 + 组合校验
 * node scripts/install.mjs --dry-run       # 只打印将要做什么
 * node scripts/install.mjs --profile web
 * node scripts/install.mjs --revert        # 卸载
 * ```
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(HERE, '..')
/** 包名同时是浏览器模块 id，必须与 `package.json` 的 name、`cordis.patch.yml` 的 name 逐字一致。 */
const PACKAGE_NAME = 'dsh-chat-flow'
/** cordis 插件行 id，必须与 `cordis.patch.yml` 的 insert 行 id 逐字一致（校验靠它断言）。 */
const PLUGIN_ID = 'chat-flow'

/**
 * profile `dependencies` 里本插件该写的 spec。
 *
 * **必须是 `link:`，不能是 `file:`。** 桌面壳 bundled 的 pnpm（10.x）把**绝对路径**的 `file:`
 * spec 当相对路径拼接，于是 `file:D:/Code/Program/DSH-Chat-Flow/Source` 在 `profiles/web`
 * 里被解析成 `<profile>\D:\Code\Program\DSH-Chat-Flow\Source`，`pnpm install` 当场
 * `ENOENT: no such file or directory, scandir '<profile>\D:\...'`（退出码 -4058）。
 * 桌面壳每个 profile 维护周期都跑这步，失败会让它连市场基线一起放弃：
 * `market baseline could not be established` → `Profile recovery requires Safe Mode`。
 * 故障出在 spec 写法，与插件代码无关，所以修在这里而不是让用户去点安全模式。
 *
 * 实测（bundled pnpm 10.34.5，scratch profile）：`file:D:/…`、`file:///D:/…`、`file://D:/…`、
 * 反斜杠形式**全部 ENOENT**；`link:D:/…` 成功建出 junction 且可重复安装。
 * 桌面壳给 generation 插件写的 `pnpm.overrides` 用的也是 `link:`，是生态里的既有写法。
 *
 * @returns `link:<posix 绝对路径>`。
 */
function dependencySpec() {
  return `link:${SOURCE.replace(/\\/g, '/')}`
}

/**
 * 解析命令行参数。
 *
 * @param argv - `process.argv.slice(2)`。
 * @returns `{profile, revert, dryRun}`。
 */
function parseArgs(argv) {
  const options = { profile: 'web', revert: false, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--profile') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--profile 需要一个 profile 名')
      options.profile = value
      index += 1
      continue
    }
    if (token === '--revert') {
      options.revert = true
      continue
    }
    if (token === '--dry-run') {
      options.dryRun = true
      continue
    }
    throw new Error(`无法识别的参数：${token}`)
  }
  return options
}

/** harness 根目录：`DSH_HOME` 优先，其次 Windows 桌面壳的 `%APPDATA%\\dsh-desktop\\harness`。 */
function harnessRoot() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  if (process.platform === 'win32' && process.env.APPDATA !== undefined) {
    return join(process.env.APPDATA, 'dsh-desktop', 'harness')
  }
  return join(homedir(), '.dsh')
}

/**
 * 建 junction（Windows 上不需要管理员权限）。
 *
 * @param source - 链接指向的真实目录。
 * @param target - 要创建的链接路径。
 * @param dryRun - 只打印不执行。
 * @returns `'created' | 'skipped' | 'would-create'`。
 */
async function link(source, target, dryRun) {
  if (existsSync(target)) return 'skipped'
  if (dryRun) return 'would-create'
  await mkdir(dirname(target), { recursive: true })
  await symlink(source, target, 'junction')
  return 'created'
}

/**
 * 重建客户端 bundle。
 *
 * @param dryRun - 只打印不执行。
 * @returns 无。
 */
function buildClient(dryRun) {
  const script = join(SOURCE, 'scripts', 'build-client.mjs')
  if (dryRun) {
    console.log(`· 将运行 ${process.execPath} ${script}`)
    return
  }
  const result = spawnSync(process.execPath, [script], { cwd: SOURCE, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`客户端构建失败（退出码 ${result.status}）：\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  process.stdout.write(result.stdout ?? '')
}

/**
 * 用 `--dump-config` 断言插件行真的出现在组合结果里。
 *
 * 这是「不启服务就能确认配置没写坏」的手段：profile 的 bundle 顺序、patch 层、插件行的
 * 加载路径有任何一处不对，这里就会失败，而不是等到重启桌面壳才发现界面没变。
 *
 * @param profile - profile 名。
 * @returns `{ok, detail}`。
 */
function validateComposition(profile) {
  const bin = join(harnessRoot(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(bin)) return { ok: false, detail: `找不到 dsh CLI：${bin}` }
  const result = spawnSync(process.execPath, [bin, '--profile', profile, '--dump-config'], {
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  })
  if (result.status !== 0) {
    return { ok: false, detail: `--dump-config 退出码 ${result.status}：${(result.stderr ?? '').slice(0, 600)}` }
  }
  const text = result.stdout ?? ''
  if (!new RegExp(`^\\s*- id: ${PLUGIN_ID}$`, 'm').test(text)) {
    return { ok: false, detail: `组合结果里没有 ${PLUGIN_ID} 插件行` }
  }
  return { ok: true, detail: '组合配置校验通过（插件行已进入 profile）' }
}

const options = parseArgs(process.argv.slice(2))
const root = harnessRoot()
const profileDir = join(root, 'profiles', options.profile)
const nodeModules = join(profileDir, 'node_modules')
const packageJsonPath = join(profileDir, 'package.json')
const pluginLink = join(nodeModules, PACKAGE_NAME)
const peerLink = join(SOURCE, 'node_modules', '@deepseek-ai')
const peerTarget = join(root, 'profiles', 'node_modules', '@deepseek-ai')

if (!existsSync(packageJsonPath)) {
  console.error(`❌ 找不到 profile：${packageJsonPath}`)
  process.exit(1)
}

if (options.revert) {
  const removed = existsSync(pluginLink)
  if (removed && !options.dryRun) await rm(pluginLink, { recursive: false, force: true })
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const bundles = packageJson.dsh?.profile?.bundles
  if (Array.isArray(bundles)) {
    packageJson.dsh.profile.bundles = bundles.filter((name) => name !== PACKAGE_NAME)
  }
  if (packageJson.dependencies !== undefined) delete packageJson.dependencies[PACKAGE_NAME]
  if (!options.dryRun) {
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  }
  console.log(options.dryRun ? '· 将回滚插件链接与 profile 接线' : '✅ 已回滚（客户端 bundle 与依赖链接保留）')
  process.exit(0)
}

buildClient(options.dryRun)

const pluginState = await link(SOURCE, pluginLink, options.dryRun)
const peerState = await link(peerTarget, peerLink, options.dryRun)
console.log(`· 插件链接 ${pluginLink} → ${SOURCE}（${pluginState}）`)
console.log(`· 依赖链接 ${peerLink} → ${peerTarget}（${peerState}）`)

if (!options.dryRun) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.dsh = packageJson.dsh ?? {}
  packageJson.dsh.profile = packageJson.dsh.profile ?? {}
  const bundles = Array.isArray(packageJson.dsh.profile.bundles) ? packageJson.dsh.profile.bundles : []
  if (!bundles.includes(PACKAGE_NAME)) bundles.push(PACKAGE_NAME)
  packageJson.dsh.profile.bundles = bundles
  packageJson.dependencies = packageJson.dependencies ?? {}
  packageJson.dependencies[PACKAGE_NAME] = dependencySpec()
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  console.log(`· profile 接线：${packageJsonPath}`)
}

if (options.dryRun) {
  console.log('· 将执行组合配置校验（跳过）')
  process.exit(0)
}

const validation = validateComposition(options.profile)
if (validation.ok) {
  console.log(`✅ ${validation.detail}`)
  console.log('\n下一步：重启 DSH Desktop（host 只在启动时组合 profile），再刷新页面拿新的客户端 bundle。')
} else {
  console.log(`❌ 组合配置校验失败：${validation.detail}`)
  console.log('   请执行 `node scripts/install.mjs --revert` 回滚，再排查原因。')
  process.exitCode = 1
}
