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
  turnTailNode,
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
let ReactRef
let internals
let ready = false
/** 真实 primitives 的装载结果：只有它能验证「展开态真的能渲染」。 */
let realInternals
let realReady = false
/** 每次渲染换一个会话 id：折叠状态按会话持久化，共用一个 id 会让用例互相污染。 */
let ssrCounter = 0

before(async () => {
  const base = profileNodeModules()
  if (base === undefined) return
  try {
    const require = createRequire(`${base.replace(/[\\/]+$/, '')}/`)
    const React = require('react')
    ReactRef = React
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

/**
 * 渲染主视图并拿到 HTML。
 *
 * `options.renderSlot` 传进来就模拟「核心装配齐全」：节点会走原生座位；
 * 不传（默认）就是本插件的**回退路径**——这也是插件在没有 ui-chat 的装配里的真实形态。
 *
 * @param snapshot - `useChat` 快照。
 * @param options - `sessionId`、`session`（`useSession` 的返回值）、`outline`、`renderSlot`、`useSessions`。
 */
function render(snapshot, options = {}) {
  const t = (key, params) => {
    const template = internals.ZH[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  return renderToString(
    internals.views.TaskFlowView({
      sessionId: options.sessionId ?? `ssr-${ssrCounter += 1}`,
      t,
      useChat: (selector) => selector(snapshot),
      useSession: () => ({ hasMore: false, loadingOlder: false, running: false, ...(options.session ?? {}) }),
      useProjection: () => options.outline,
      loadOlder: () => {},
      renderSlot: options.renderSlot,
      useSessions: options.useSessions,
      openFile: options.openFile,
      openView: options.openView,
    }),
  )
}

test('SSR：任务视图在真实 React 下渲染出任务过程 / 任务 / 状态', (t) => {
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
  assert.match(html, /任务过程/)
  assert.match(html, /任务列表/)
  assert.match(html, /任务A/)
  assert.match(html, /进行中/)
  assert.match(html, /data-status="in_progress"/)
  // 「规划过程」作为独立折叠体已移除（用户要求「移除掉规划过程，全部算任务过程里面」）。
  assert.equal(/规划过程/.test(html), false, '界面上不该再出现「规划过程」')
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
  // 第一个分段（任务A）的明细条数 = pwsh + write + mcp = 3。
  assert.match(html, /3 个操作/)
  // 任务已完成 → 行与「正在处理」都**默认自动折叠**。
  assert.match(html, /<div class="dcf-fold" data-open="false">/)
  // 明细内容仍挂在 DOM 里（这是折叠动画与嵌套展开状态得以保留的前提），
  // 但 CSS 用 `grid-template-rows:0fr` + `visibility:hidden` 让它不可见也不可聚焦
  // （真实可见性由 client-bundle.test.js 的样式契约测试保证）。
  assert.match(html, /echo a/)
})

test('SSR：任务列表默认展开；任务过程与思考块默认收起', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const running = makeSnapshot([
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [
      { content: '任务A', status: 'in_progress' },
      { content: '任务B', status: 'pending' },
    ]),
    pwshNode('t1', 1, 2, 'echo a', 'a'),
  ])
  // 会话正在跑：任务行与任务列表展开；「任务过程」与思考块收起（用户要求）。
  const live = render(running, { sessionId: 'ssr-live-open', session: { running: true } })
  assert.match(live, /data-status="in_progress"/)
  assert.match(live, /aria-expanded="true"/, '进行中的任务行应展开')
  assert.match(live, /<div class="dcf-fold" data-open="true">/, '任务列表应默认展开')
  assert.match(live, /思考中/, '还在写的那一块显示「思考中」')
  assert.match(live, /dcf-thinking"[^>]*>[\s\S]{0,400}?aria-expanded="false"/, '思考块默认收起')

  // 回合结束（有收尾节点）但任务仍未完成：那一项「进行中」的子任务保持展开；
  // 「任务过程」本身仍然是收起的，并把「未完成」标在折叠头上。
  const settledButUnfinished = render(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [
        { content: '任务A', status: 'in_progress' },
        { content: '任务B', status: 'pending' },
      ]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      turnTailNode('tt1', 1, 3),
    ]),
    { sessionId: 'ssr-live-settled', session: { running: false } },
  )
  assert.match(settledButUnfinished, /data-status="in_progress"/)
  assert.match(settledButUnfinished, /aria-expanded="true"/)
  assert.match(settledButUnfinished, /被打断/, '半途停下的回合标「被打断」，不再写「未完成」')

  // 全部完成后：任务行与「正在处理」都自动收起。
  const done = render(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [
        { content: '任务A', status: 'in_progress' },
        { content: '任务B', status: 'pending' },
      ]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      todoNode('p2', 1, 3, [
        { content: '任务A', status: 'completed' },
        { content: '任务B', status: 'completed' },
      ]),
    ]),
    { sessionId: 'ssr-live-done', session: { running: false } },
  )
  assert.match(done, /data-status="completed"/)
  // 全部完成的回合：任务行与思考块都不再展开（「完成后自动折叠」）。
  assert.equal((done.match(/class="dcf-taskrow" data-status="in_progress" aria-expanded="true"/g) ?? []).length, 0)
  assert.equal(
    (done.match(/class="dcf-row dcf-thinkinghead" aria-expanded="true"/g) ?? []).length,
    0,
    '已完成的回合里不应有展开的思考块',
  )
  // 任务列表：第一块（A 进行中 / B 未开始）默认展开；第二块**整表都已完成 → 默认收起**
  // （用户要求「当任务列表更新为『全部已完成』状态时，不需要展开」）。
  assert.equal(
    (done.match(/class="dcf-platehead" aria-expanded="true"/g) ?? []).length,
    1,
    '只有还没全部完成的那一块默认展开',
  )
  assert.equal(
    (done.match(/class="dcf-platehead" aria-expanded="false"/g) ?? []).length,
    1,
    '全部完成的那一块默认收起',
  )
})

test('SSR：每个回合都带跳转锚点，多于一个回合时渲染右侧导轨', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const oneTurn = render(makeSnapshot([userNode('u1', 1, '第一件事')]))
  assert.match(oneTurn, /data-turn-anchor="1"/)
  // 只有一个回合时导轨没有意义，不渲染。
  assert.doesNotMatch(oneTurn, /dcf-rail/)

  const twoTurns = render(
    makeSnapshot([userNode('u1', 1, '第一件事'), pwshNode('t1', 1, 1, 'echo 1'), userNode('u2', 2, '第二件事')]),
  )
  assert.match(twoTurns, /data-turn-anchor="1"/)
  assert.match(twoTurns, /data-turn-anchor="2"/)
  assert.match(twoTurns, /class="dcf-rail"/)
  assert.equal((twoTurns.match(/class="dcf-mark"/g) ?? []).length, 2, '每个回合一个刻度')
  assert.match(twoTurns, /aria-label="跳到第 1 轮"/)
  assert.match(twoTurns, /aria-label="跳到第 2 轮"/)
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
  // 回合已结束 → 这一块不再显示「思考中」，而是「思考已完成」（用户要求）。
  assert.match(html, /思考已完成/)
  assert.equal(html.includes('思考中<'), false, '结束的块不该再显示「思考中」')
})

test('SSR：turnOutline 里的未加载回合也画刻度，并标出「加载并跳转」', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  // 已加载第 3 轮，outline 里有第 1–3 轮：第 1、2 轮是未加载刻度。
  const html = render(makeSnapshot([userNode('u3', 3, '第三件事')]), {
    outline: [
      { turn: 1, seq: 10, prompt: '第一件事', response: '' },
      { turn: 2, seq: 20, prompt: '第二件事', response: '' },
      { turn: 3, seq: 30, prompt: '第三件事', response: '' },
    ],
  })
  assert.match(html, /class="dcf-rail"/)
  assert.equal((html.match(/data-loaded="false"/g) ?? []).length, 2, '两个未加载刻度')
  assert.equal((html.match(/data-loaded="true"/g) ?? []).length, 1, '一个已加载刻度')
  assert.match(html, /aria-label="加载并跳到第 1 轮"/)
  assert.match(html, /aria-label="跳到第 3 轮"/)
})

/* ──────────────────────────── 原生座位（真实 React） ──────────────────────────── */

test('SSR：原生座位在真实 React 下渲染，展开态与锚点属性都在', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const seen = []
  const html = render(
    makeSnapshot([
      userNode('u1', 1, '跑测试'),
      todoNode('p1', 1, 1, [{ content: '跑测试', status: 'in_progress' }]),
      pwshNode('t1', 1, 2, 'node --test', 'ok'),
    ]),
    {
      session: { running: true },
      renderSlot: (slot, owner, options) => {
        seen.push({ slot, kind: owner.node.kind, entryKey: options.entryKey })
        // 替身座位：只证明「这一行交给了插槽」，并渲染出可断言的内容。
        return ReactRef.createElement(
          'div',
          { 'data-native-seat': options.entryKey },
          ReactRef.createElement('span', null, `native:${owner.node.kind}`),
        )
      },
    },
  )

  assert.equal(seen.length > 0, true, '至少有一次座位调用')
  assert.equal(seen.every((call) => call.entryKey === call.kind), true, 'entryKey 必须等于节点 kind')
  assert.match(html, /data-native-seat="user"/)
  assert.match(html, /native:tool-call/)
  // 座位接手的行不再画本插件的卡片。
  assert.equal(html.includes('dcf-card'), false)
  // 核心同款的锚点属性仍在（别人的插件靠它们挂载，例如回退按钮）。
  assert.match(html, /data-chat-flow-kind="user"[^>]*data-chat-anchor-key="u1"/)
  assert.match(html, /data-chat-flow-kind="tool-call"[^>]*data-chat-anchor-key="t1"/)
  assert.match(html, /data-chat-turn="1"/)
})