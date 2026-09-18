/**
 * 把 `lib/client/*.js` 分片拼成单文件客户端 bundle（`lib/client.js`）。
 *
 * **为什么必须拼成单文件**：DSH 只按 `package.json` 的 `exports["./client"]` 提供一个 URL
 * （`/plugins/<包名>/client.js`），浏览器侧拿不到第二个文件；而把整个视图塞进一个文件又没法维护。
 * 分片 + 零依赖拼接是这两者之间唯一可行的折中：没有转译、没有依赖解析、没有 sourcemap，
 * 产物就是分片正文按文件名顺序的直接相接，因此每一片都能单独读、单独审查。
 *
 * 约定：
 * - 分片放在 `lib/client/`，按文件名**字典序**拼接，所以数字前缀就是顺序（`00-head` 开头、`99-` 收尾）；
 * - 首片 `00-*` 打开 `window.__ModuleLoader__.load({...factory})`，尾片 `99-*` 收工厂并导出；
 * - 产物写入 `lib/client.js`，`--check` 只比对不写入（安装脚本与 CI 用它防「改了源码没重建」）。
 *
 * 用法：
 * ```text
 * node scripts/build-client.mjs            # 写出 lib/client.js
 * node scripts/build-client.mjs --check    # 只校验产物与分片是否同步
 * ```
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(HERE, '..', 'lib')
const PARTS_DIR = join(LIB, 'client')
const OUTPUT = join(LIB, 'client.js')

/**
 * 产物头部横幅。
 *
 * @param parts - 参与拼接的分片文件名（按顺序）。
 * @returns 横幅文本。
 */
function banner(parts) {
  return `/**
 * 本文件由 scripts/build-client.mjs 自动生成，请勿直接编辑。
 * 源码分片（按拼接顺序）：
${parts.map((name) => ` *   - lib/client/${name}`).join('\n')}
 *
 * 修改流程：改 lib/client/*.js → node scripts/build-client.mjs
 */

`
}

/**
 * 读取分片并拼接。
 *
 * @returns `{text, names}`。
 */
async function build() {
  const names = (await readdir(PARTS_DIR))
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))
  if (names.length === 0) throw new Error(`没有找到任何客户端分片：${PARTS_DIR}`)
  if (!names[0].startsWith('00-')) throw new Error(`第一个分片必须是 00-*.js，实际是 ${names[0]}`)
  if (!names[names.length - 1].startsWith('99-')) {
    throw new Error(`最后一个分片必须是 99-*.js，实际是 ${names[names.length - 1]}`)
  }
  const bodies = []
  for (const name of names) bodies.push(await readFile(join(PARTS_DIR, name), 'utf8'))
  return { text: banner(names) + bodies.join(''), names }
}

/**
 * 语法自检：把产物当 ES 模块喂给 `node --check`。
 *
 * 拼接式构建最大的风险是「少一个大括号」这类错误，而它只会在浏览器里以整块视图消失的形式暴露；
 * 在这里拦住比运行时排查便宜得多。
 *
 * @param text - 产物文本。
 * @returns 无。
 */
function checkSyntax(text) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: text, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`产物语法检查失败：\n${result.stderr ?? ''}`)
}

const checkOnly = process.argv.includes('--check')

const { text, names } = await build()
checkSyntax(text)

if (checkOnly) {
  let existing = null
  try {
    existing = await readFile(OUTPUT, 'utf8')
  } catch {
    existing = null
  }
  if (existing !== text) throw new Error(`lib/client.js 与分片不同步，请运行 node scripts/build-client.mjs`)
  console.log(`✅ lib/client.js 与 ${names.length} 个分片同步`)
} else {
  await writeFile(OUTPUT, text, 'utf8')
  const kilobytes = (text.length / 1024).toFixed(1)
  console.log(`✅ 已生成 lib/client.js（${names.length} 个分片，${kilobytes} KB）`)
}
