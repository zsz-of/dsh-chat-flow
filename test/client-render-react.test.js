/**
 * 用**真实 React + react-dom/server** 渲染任务视图。
 *
 * 手写渲染器（`client-bundle.test.js`）能抓「组件是 undefined」，但抓不到真实 React 的语义错误：
 * 例如把一个 React 元素当数组展开、给 DOM 元素传了非法 prop、children 类型不合法——
 * 这类问题在真机上的表现是整块界面白屏，代价很高，所以在 node 里先用 SSR 挡一道。
 *
 * React 从 profile 的 `node_modules` 取（那里才有桌面壳实际用的版本），取不到就整组跳过，
 * 而不是假装通过。
 */

import { strict as assert } from 'node:assert'
import { createRequire, register } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { before, test } from 'node:test'

import { createStorage, loadBundle } from './helpers/load-bundle.mjs'

/**
 * 让 Node 能导入 primitives 的真实 ESM 产物：它内部 `import ... from './X.module.css'`，
 * 而 Node 不认识 `.css`（`Unknown file extension ".css"`）。这里注册一个模块钩子，
 * 把所有 `.css` 换成一个「取任何键都得类名」的假模块——样式对断言无意义，
 * 但**真实组件本体**（`TerminalBlock` / `MarkdownText` / `JsonBlock`）必须是真的。
 *
 * `register` 是进程级的，而 `node --test` 每个测试文件一个进程，因此不会污染别的文件。
 */
register(
  `data:text/javascript,${encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default new Proxy({}, { get: (_t, key) => "css-" + String(key) })',
    }
  }
  return nextLoad(url, context)
}
`)}`,
)
import {
  assistantNode,
  makeSnapshot,
  pwshNode,
  todoNode,
  toolNode,
  userNode,
  writeNode,
} from './helpers/flow-fixtures.mjs'

/** profile 的 `node_modules`：桌面壳实际使用的依赖版本都在这里。 */
function profileNodeModules() {
  if (process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '') {
    return join(process.env.DSH_HOME, 'profiles', 'node_modules')
  }
  if (process.platform === 'win32' && process.env.APPDATA !== undefined) {
    return join(process.env.APPDATA, 'dsh-desktop', 'harness', 'profiles', 'node_modules')
  }
  return undefined
}

let renderToString
let internals
let ready = false
/** 真实 primitives 的装载结果：只有它能验证「展开态真的能渲染」。 */
let realInternals
let realReady = false

before(async () => {
  const base = profileNodeModules()
  if (base === undefined) return
  try {
    const require = createRequire(`${base.replace(/[\\/]+$/, '')}/`)
    const React = require('react')
    renderToString = require('react-dom/server').renderToString
    /** primitives 替身用真实 React 元素：既保留 children 语义，又不依赖主题与 CSS 模块。 */
    const primitives = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (typeof key === 'symbol') return undefined
          return function Primitive(props) {
            const given = props ?? {}
            return React.createElement(
              'div',
              { 'data-primitive': String(key) },
              given.children ?? (typeof given.text === 'string' ? given.text : null),
            )
          }
        },
      },
    )
    const loaded = await loadBundle({ react: React, primitives })
    internals = loaded.exports.__internals
    ready = true

    /**
     * 第二遍装载：primitives 换成**真实模块**。
     *
     * 这一步专门验证展开态——`TerminalBlock` 之类的原子组件对入参有硬要求
     * （例如 `command` 必须是字符串，内部直接 `.endsWith`），替身挡不住这类错误，
     * 而真机上它会让整行工具明细渲染崩溃。真实模块同样从 profile 取，**单独 try** 以便
     * 只有这一条用例跳过，而不是把整组拖下水。
     */
    try {
      const primitivesUrl = pathToFileURL(
        join(base, '@deepseek-ai', 'dsh-client-ui-primitives', 'lib', 'index.js'),
      ).href
      const realPrimitives = await import(primitivesUrl)
      const realLoaded = await loadBundle({ react: React, primitives: realPrimitives })
      realInternals = realLoaded.exports.__internals
      realReady = true
    } catch {
      realReady = false
    }
  } catch {
    ready = false
  }
})

/** 渲染主视图并拿到 HTML。 */
function render(snapshot, sessionId = 'session-ssr') {
  const t = (key, params) => {
    const template = internals.ZH[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  return renderToString(
    internals.views.TaskFlowView({
      sessionId,
      t,
      useChat: (selector) => selector(snapshot),
      useSession: () => ({ hasMore: false, loadingOlder: false }),
      loadOlder: () => {},
    }),
  )
}

test('SSR：任务视图在真实 React 下渲染出计划 / 任务 / 状态', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom（先跑一次 install.mjs）')
  const html = render(
    makeSnapshot([
      userNode('u1', 1, '把 A 和 B 都做掉'),
      assistantNode('a1', 1, 1, [{ kind: 'text', text: '先规划一下。' }]),
      todoNode('p1', 1, 1, [
        { content: '任务A', status: 'in_progress' },
        { content: '任务B', status: 'pending' },
      ]),
      pwshNode('t1', 1, 2, 'node --test', '3 tests passed'),
    ]),
  )
  assert.match(html, /data-chat-flow-owner="dsh-chat-flow"/)
  assert.match(html, /dcf-root/)
  assert.match(html, /把 A 和 B 都做掉/)
  assert.match(html, /规划过程/)
  assert.match(html, /任务列表/)
  assert.match(html, /任务A/)
  assert.match(html, /进行中/)
  assert.match(html, /data-status="in_progress"/)
})

test('SSR：任务状态与「正在处理」统计随节点数据变化', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const html = render(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [
        { content: '任务A', status: 'in_progress' },
        { content: '任务B', status: 'pending' },
      ]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      writeNode('t2', 1, 3, 'a.js'),
      toolNode('t3', 1, 4, 'mcp__github__create_issue', { title: 'x' }, { content: 'ok' }),
      todoNode('p2', 1, 5, [
        { content: '任务A', status: 'completed' },
        { content: '任务B', status: 'completed' },
      ]),
    ]),
  )
  assert.match(html, /data-status="completed"/)
  assert.match(html, /2 项 · 2 已完成/)
  // 折叠态只显示统计，不泄露明细（命令名 / 文件路径都不该出现）。
  // 任务A 的明细条数 = pwsh + write + mcp + 计划更新 = 4。
  assert.match(html, /4 个操作/)
  assert.doesNotMatch(html, /echo a/)
  assert.doesNotMatch(html, /a\.js/)
})

test('SSR：内容按文本转义，不把模型输出当 HTML 注入', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const html = render(
    makeSnapshot([
      userNode('u1', 1, '<img src=x onerror=alert(1)>'),
      assistantNode('a1', 1, 1, [{ kind: 'text', text: '<script>alert(1)</script>' }]),
    ]),
  )
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.doesNotMatch(html, /<img src=x onerror/)
  assert.match(html, /&lt;script&gt;/)
})

test('SSR：空会话给出空态而不是空白', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const html = render(makeSnapshot([]))
  assert.match(html, /dcf-empty/)
})

test('SSR：展开态用真实 primitives 渲染出工具明细（不崩、看到命令与结果）', async (t) => {
  if (!realReady) return t.skip('缺少 profile 里的 @deepseek-ai/dsh-client-ui-primitives')
  const sessionId = 'ssr-expanded'
  // 预置折叠状态：把任务行、它的「正在处理」块、以及那条命令明细全部打开。
  const storage = createStorage()
  storage.setItem(
    `dsh-chat-flow.collapse.${sessionId}`,
    JSON.stringify({ 'task:1:0': true, 'proc:1:0': true, 'op:t1': true }),
  )
  const loaded = await loadBundle({
    react: createRequire(`${profileNodeModules().replace(/[\\/]+$/, '')}/`)('react'),
    primitives: await import(
      pathToFileURL(join(profileNodeModules(), '@deepseek-ai', 'dsh-client-ui-primitives', 'lib', 'index.js')).href
    ),
    storage,
  })
  const local = loaded.exports.__internals
  const snapshot = makeSnapshot([
    userNode('u1', 1, '跑测试'),
    todoNode('p1', 1, 1, [{ content: '跑测试', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'node --test', 'ok 30 - all green'),
  ])
  const translate = (key, params) => {
    const template = local.ZH[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  const html = renderToString(
    local.views.TaskFlowView({
      sessionId,
      t: translate,
      useChat: (selector) => selector(snapshot),
      useSession: () => ({ hasMore: false }),
    }),
  )
  assert.match(html, /data-terminal/, '命令明细应该由真实的 TerminalBlock 渲染')
  assert.match(html, /node --test/)
  assert.match(html, /all green/)
  assert.match(html, /正在处理/)
})
