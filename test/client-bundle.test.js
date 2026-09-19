/**
 * 客户端 bundle 测试：模块注册、插槽接线、以及整棵视图在 node 里的冒烟渲染。
 *
 * 用的是手写渲染器（`createElement` 直接调用函数组件），它能抓到「组件是 undefined」
 * 这类会让真实界面整块白屏的错误——这正是这个文件存在的主要理由。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { collectText, createStorage, loadBundle } from './helpers/load-bundle.mjs'
import { createProbeReact } from './helpers/probe-react.mjs'
import {
  assistantNode,
  makeSnapshot,
  pwshNode,
  todoNode,
  turnTailNode,
  userNode,
  writeNode,
} from './helpers/flow-fixtures.mjs'

/**
 * 造一个只记录调用的客户端 ctx 桩。
 *
 * `t` 与真实 `ctx.locale.bind` 一样：注册后才有字典，因此这里返回闭包而不是快照，
 * 插值规则也与核心一致（`{name}` 单花括号）。
 */
function stubCtx() {
  const captured = { locales: [], registered: [], pending: [], effects: [] }
  const translate = (ns, key, params) => {
    const dict = captured.locales.find((item) => item.ns === ns)?.dict.zh ?? {}
    const template = dict[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  const ctx = {
    effect(fn, label) {
      captured.effects.push(label)
      return fn()
    },
    locale: {
      register(ns, dict) {
        captured.locales.push({ ns, dict })
        return () => {}
      },
      bind: (ns) => (key, params) => translate(ns, key, params),
    },
    sessions: { binding: () => undefined },
    slots: {
      inject(name, run) {
        captured.pending.push([name, run])
      },
      register(options, component) {
        captured.registered.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, captured, t: (key, params) => translate('chat-flow', key, params) }
}

/** 装载 bundle 并应用一次，返回注册过的视图条目与文案函数。 */
function bootView() {
  const { ctx, captured, t } = stubCtx()
  client.apply(ctx)
  for (const [, run] of captured.pending) run()
  const view = captured.registered.find((item) => item.options.name === 'conversation.view')
  return { captured, view, t }
}

const module0 = await loadBundle()
const client = module0.exports
const { registration, requested, appendedStyles, window: window0 } = module0

test('bundle 以正确的包名注册自己，且只依赖平台 seed 模块', () => {
  assert.equal(registration.id, 'dsh-chat-flow')
  assert.deepEqual([...new Set(requested)].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react'])
})

test('插件声明依赖 slots / locale / sessions', () => {
  assert.deepEqual(client.inject, ['slots', 'locale', 'sessions'])
  assert.equal(typeof client.apply, 'function')
})

test('apply() 注册语言包、样式与唯一的视图条目', () => {
  const { captured, view, t } = bootView()

  assert.deepEqual(captured.locales.map((item) => item.ns), ['chat-flow'])
  assert.equal(captured.locales[0].dict.zh['flow.thinking.live'], '思考中')
  assert.equal(captured.effects.length, 1, '语言包注册应挂在 effect 上，随插件卸载回收')

  assert.equal(appendedStyles.length, 1, '样式只注入一次（按固定 id 去重）')
  assert.match(appendedStyles[0].textContent, /\.dcf-root/)

  assert.ok(view !== undefined, '必须注册 conversation.view')
  assert.equal(view.options.id, 'flow', '用独立 id：遮蔽会让标签栏出现两个同 id 条目（核心不允许注销别人的条目）')
  assert.equal(view.options.priority, undefined, '不设 priority：各占一个单元格，互不遮蔽')
  assert.equal(view.options.order, 5, '排在「对话」(0) 与「轨迹」(10) 之间')
  assert.equal(view.options.locale, 'chat-flow')
  assert.equal(view.options.label(), '任务')
  assert.equal(t('flow.tasksSummary', { total: 2, done: 1 }), '2 项 · 1 已完成')

  const injected = view.options.inject('session-1')
  assert.equal(injected.sessionId, 'session-1')
  assert.equal(typeof injected.loadOlder, 'function')
  // 会话 binding 取不到时点「加载更早」不能抛（切走会话的竞态）。
  assert.doesNotThrow(() => injected.loadOlder())
})

test('视图渲染：计划分组 / 任务列表 / 正在处理统计都在', () => {
  const { captured, view, t } = bootView()

  const nodes = [
    userNode('u1', 1, '把 A 和 B 都做掉'),
    assistantNode('a1', 1, 1, [{ kind: 'text', text: '先规划一下。' }]),
    todoNode('p1', 1, 1, [
      { content: '任务A', status: 'in_progress' },
      { content: '任务B', status: 'pending' },
    ]),
    pwshNode('t1', 1, 2, 'node --test', '3 tests passed'),
    writeNode('t2', 1, 3, 'a.js'),
    todoNode('p2', 1, 4, [
      { content: '任务A', status: 'completed' },
      { content: '任务B', status: 'completed' },
    ]),
    assistantNode('a2', 1, 5, [{ kind: 'text', text: '两件事都做完了。' }]),
  ]
  const snapshot = makeSnapshot(nodes)
  const tree = view.component({
    sessionId: 'session-1',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    loadOlder: () => {},
  })
  const text = collectText(tree)
  assert.match(text, /把 A 和 B 都做掉/)
  assert.match(text, /规划过程/)
  assert.match(text, /任务列表/)
  assert.match(text, /2 项 · 2 已完成/)
  assert.match(text, /任务A/)
  assert.match(text, /任务B/)
  assert.match(text, /已完成/)
  assert.match(text, /两件事都做完了/)
  assert.equal(captured.registered.length, 1)
})

/** 收集树里所有折叠容器的展开态（按出现顺序），用于断言默认展开策略。 */
function foldStates(element) {
  const states = []
  const walk = (value) => {
    if (value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value.props?.className === 'dcf-fold') states.push(value.props['data-open'])
    walk(value.props?.children)
  }
  walk(element)
  return states
}

/** 在树里找第一个满足条件的元素。 */
function findElement(element, predicate) {
  let found = null
  const walk = (value) => {
    if (found !== null || value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (predicate(value)) {
      found = value
      return
    }
    walk(value.props?.children)
  }
  walk(element)
  return found
}

test('默认展开策略：正在写的块展开、任务列表与明细收起', () => {
  const { view, t } = bootView()
  const snapshot = makeSnapshot([
    userNode('u1', 1, '做点事'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'live-command', 'live-output'),
  ])
  const tree = view.component({
    sessionId: 'session-live',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, running: true }),
  })
  assert.match(collectText(tree), /任务A/)
  assert.match(collectText(tree), /进行中/)
  // 用户本轮定下的默认策略：**任务过程始终折叠**（即使在跑）；任务行展开（就是当前那一项）；
  // 思考块展开（这一块里还包含着正在写的最后一个节点）；任务列表快照面板收起；卡片明细也收起。
  assert.deepEqual(
    foldStates(tree),
    ['false', 'false', 'true', 'true', 'false'],
    '任务过程与快照面板收起；任务行 / 思考块展开；卡片明细收起',
  )
  assert.match(collectText(tree), /live-command/)
})

test('手动收起会被记住：覆盖默认展开策略', () => {
  const { view, t } = bootView()
  const sessionId = 'session-manual'
  const snapshot = makeSnapshot([
    userNode('u1', 1, '做点事'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'live-command', 'live-output'),
  ])
  const props = {
    sessionId,
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, running: true }),
  }
  const before = view.component(props)
  assert.deepEqual(foldStates(before), ['false', 'false', 'true', 'true', 'false'], '任务过程与快照面板收起；任务行 / 思考块展开')

  // 点「思考中」那一行 → 收起它。
  const procRow = findElement(
    before,
    (element) => String(element.props?.className ?? '').includes('dcf-row') && collectText(element).includes('思考'),
  )
  assert.ok(procRow !== undefined && typeof procRow.props.onClick === 'function', '「思考」标题行应当可点')
  procRow.props.onClick()

  const after = view.component({ ...props, t })
  assert.deepEqual(foldStates(after), ['false', 'false', 'true', 'false', 'false'], '手动收起「思考」块后应保持收起')
})

test('jumpToTurn：按回合锚点定位并尊重「减少动态效果」', () => {
  const { jumpToTurn } = client.__internals
  const calls = []
  const target = { scrollIntoView: (options) => calls.push(options) }
  const root = { querySelector: (selector) => (selector === '[data-turn-anchor="3"]' ? target : null) }

  window0.matchMedia = () => ({ matches: true })
  jumpToTurn(root, 3)
  assert.deepEqual(calls, [{ block: 'start', behavior: 'auto' }], '开了减少动态效果就瞬时跳')

  window0.matchMedia = () => ({ matches: false })
  jumpToTurn(root, 3)
  assert.deepEqual(calls[1], { block: 'start', behavior: 'smooth' })

  // 目标不存在时不能抛（回合可能还没渲染，或者锚点刚好不在）。
  assert.doesNotThrow(() => jumpToTurn(root, 99))
  assert.doesNotThrow(() => jumpToTurn(null, 1))
})

test('样式契约：折叠有过渡且收起时不可见，并尊重 reduced-motion', () => {
  const { FLOW_CSS } = client.__internals
  assert.match(FLOW_CSS, /\.dcf-fold\{[^}]*grid-template-rows:0fr/, '收起态用 0fr 轨道')
  assert.match(FLOW_CSS, /\.dcf-fold\{[^}]*visibility:hidden/, '收起态要摘掉可见性与焦点')
  assert.match(FLOW_CSS, /\.dcf-fold\[data-open=true\]\{[^}]*grid-template-rows:1fr/)
  assert.match(FLOW_CSS, /\.dcf-fold[^{]*\{[^}]*transition:grid-template-rows \.22s/)
  assert.match(FLOW_CSS, /prefers-reduced-motion:reduce/, '必须给减少动态效果留出口')
  // 导轨：sticky 零高槽 + 刻度用主题 token 上色。
  assert.match(FLOW_CSS, /\.dcf-rail-slot\{position:sticky;top:0/)
  assert.match(FLOW_CSS, /\.dcf-mark\[data-active=true\]::before\{background:var\(--dsw-alias-label-primary\)/)
})

test('缺少 useChat（ui-chat 不在装配里）时给空态而不是抛异常', () => {
  const { view } = bootView()
  const tree = view.component({ t: (key) => key })
  assert.equal(collectText(tree), 'flow.empty')
})

test('localStorage 不可用时仍然能装载（折叠状态退化成内存）', async () => {
  const storage = createStorage({ fail: true })
  const loaded = await loadBundle({ storage })
  const internals = loaded.exports.__internals
  assert.equal(typeof internals.deriveFlow, 'function')
  const flow = internals.deriveFlow(makeSnapshot([userNode('u1', 1, 'hi')]))
  assert.equal(flow.turns.length, 1)
})

test('导轨：未加载刻度点击后按 seq 翻页，已加载刻度直接滚动', () => {
  const { view, t } = bootView()
  const jumps = []
  const tree = view.component({
    sessionId: 'session-rail-jump',
    t,
    useChat: (selector) => selector(makeSnapshot([userNode('u3', 3, '第三件事')])),
    useSession: () => ({ hasMore: true, loadingOlder: false }),
    useProjection: () => [
      { turn: 1, seq: 10, prompt: '第一件', response: '' },
      { turn: 3, seq: 30, prompt: '第三件', response: '' },
    ],
    loadThrough: (seq) => {
      jumps.push(seq)
      return Promise.resolve()
    },
  })
  const unloaded = findElement(tree, (element) => element.props?.['data-loaded'] === 'false')
  assert.ok(unloaded !== undefined, '应渲染未加载刻度')
  assert.equal(unloaded.props['aria-label'], '加载并跳到第 1 轮')
  unloaded.props.onClick()
  assert.deepEqual(jumps, [10], '未加载刻度应按该轮的 seq 翻页')
})

test('没有 turnOutline 时导轨退化成只画已加载回合', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-rail-loaded-only',
    t,
    useChat: (selector) => selector(makeSnapshot([userNode('u1', 1, '一'), userNode('u2', 2, '二')])),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    useProjection: () => undefined,
  })
  assert.equal(findElement(tree, (element) => element.props?.['data-loaded'] === 'false'), null)
  assert.equal(findElement(tree, (element) => element.props?.['data-loaded'] === 'true') !== undefined, true, '已加载刻度照常渲染')
})

/* ──────────────────────────── 原生节点座位 ──────────────────────────── */

/** 记录每次原生座位调用，并按要求返回一个标记元素（默认是个纯标记，不含任何子节点）。 */
function seatSpy(behaviour) {
  const calls = []
  const renderSlot = (slot, owner, options) => {
    calls.push({ slot, owner, options })
    return behaviour === undefined ? { type: 'native', props: { slot } } : behaviour(slot, owner, options)
  }
  return { calls, renderSlot }
}

test('原生座位：每个节点都经 conversation.chat.node 交给核心渲染，并带上主人参数', () => {
  const { view, t } = bootView()
  const { calls, renderSlot } = seatSpy()
  const tool = pwshNode('t1', 1, 2, 'echo a', 'a')
  const snapshot = makeSnapshot([
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    tool,
  ])
  const openFile = () => Promise.resolve()
  const tree = view.component({
    sessionId: 'session-seat',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    renderSlot,
    openFile,
    openView: (id) => id,
  })

  assert.ok(calls.length >= 2, '用户发言与工具调用都应经过原生座位')
  for (const call of calls) {
    assert.equal(call.slot, client.__internals.NATIVE_NODE_SLOT)
    assert.ok(call.owner.node !== undefined, '原生座位必须拿到该节点本身')
    assert.equal(call.options.entryKey, call.owner.node.kind, 'entryKey 用节点 kind 分派原生条目')
    assert.equal(call.owner.openFile, openFile, '核心叶子要的 openFile 必须原样传下去')
    assert.equal(typeof call.owner.forkAt, 'function')
    assert.equal(typeof call.owner.fileMentions, 'function')
    assert.equal(typeof call.owner.inspectCall, 'function')
    assert.ok(Object.hasOwn(call.options, 'hookContext'), 'hookContext 这个键必须存在（槽上挂着上下文 hook 工厂）')
    assert.ok(call.options.fallback !== undefined && call.options.fallback !== null, '必须给核心一个回退叶子')
  }
  const toolCall = calls.find((call) => call.owner.node.kind === 'tool-call')
  assert.equal(toolCall.owner.node, tool)
  assert.equal(toolCall.options.entryKey, 'tool-call')
  assert.equal(toolCall.owner.turnProcess, undefined, '核心的过程折叠控制器由本插件替代，不给它主人参数')
  assert.equal(toolCall.owner.cwd, undefined, '没有 useSessions 时 cwd 留空')

  // 原生座位接手后，本插件自己的卡片不再出现在这一行（只有回退叶子才用它）。
  const nativeRows = []
  findElement(tree, (element) => {
    if (element.type === 'native') nativeRows.push(element)
    return false
  })
  assert.equal(nativeRows.length, calls.length)
  assert.equal(findElement(tree, (element) => element.props?.className === 'dcf-card'), null)
})

test('原生座位：cwd 来自 useSessions；装配里没有 renderSlot 时退回自绘叶子', () => {
  const { view, t } = bootView()
  const snapshot = makeSnapshot([userNode('u1', 1, '干活'), pwshNode('t1', 1, 1, 'echo a', 'a')])
  const { calls, renderSlot } = seatSpy()
  view.component({
    sessionId: 'session-seat-cwd',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    renderSlot,
  })
  assert.equal(calls[0].owner.cwd, undefined)

  calls.length = 0
  view.component({
    sessionId: 'session-seat-cwd-2',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    renderSlot,
    useSessions: (selector) => selector({ byId: { 'session-seat-cwd-2': { cwd: 'D:/work' } } }),
  })
  assert.equal(calls[0].owner.cwd, 'D:/work')

  // 没有 renderSlot（ui-chat 不在装配里）→ 一次座位都不调，直接画自绘卡片。
  const plain = view.component({
    sessionId: 'session-no-slot',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
  })
  assert.notEqual(findElement(plain, (element) => element.props?.className === 'dcf-card'), null)
  assert.equal(
    calls.some((call) => call.owner.node.kind === 'tool-call'),
    true,
    '有 renderSlot 时工具调用必须走座位（自绘卡片只作为回退叶子）',
  )
})

test('原生座位外面套着错误边界：失败时给出回退叶子，并且留日志', async () => {
  /*
    这一条需要「createElement 不立刻调用组件」的渲染器：手写渲染器会把类组件当场 new 出来，
    拿不到边界元素本身。所以要单独用探针 React 装载一份 bundle（探针的 createElement 只构造元素）。
  */
  const probeModule = await loadBundle({ react: createProbeReact().react })
  const { views } = probeModule.exports.__internals
  const fallback = { type: 'leaf' }
  const seated = { type: 'native' }
  const node = { key: 't1', kind: 'tool-call' }
  const boundary = views.NativeSeat({ node, owner: {}, renderSlot: () => seated, fallback })

  assert.equal(typeof boundary.type.getDerivedStateFromError, 'function', '必须是类组件错误边界（函数组件不是边界）')
  assert.equal(boundary.props.fallback, fallback, '边界拿到的回退叶子必须是本插件的自绘叶子')
  assert.equal(boundary.props.children.props.node, node, '边界包住的正是真正调用插槽的那一层')
  assert.equal(
    views.NativeSeat({ node, owner: {}, renderSlot: undefined, fallback }),
    fallback,
    '没有 renderSlot（装配里没有 ui-chat）时不用套边界，直接给回退叶子',
  )

  /**
   * React 的边界契约：崩溃时调 `getDerivedStateFromError`，随后用新状态重渲染。
   * React 18 的 legacy `renderToString` **不**接住边界（实测：错误直接抛出；流式接口会把整条流中断），
   * 所以这条契约在这里逐点断言；真机上的客户端渲染器（`createRoot`）支持它。
   */
  const Boundary = boundary.type
  assert.deepEqual(Boundary.getDerivedStateFromError(new Error('x')), { failed: true })
  const instance = new Boundary({ fallback, children: 'CHILD' })
  assert.equal(instance.render(), 'CHILD', '正常时渲染子树')
  instance.state = { failed: true }
  assert.equal(instance.render(), fallback, '失败后渲染回退叶子')

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    instance.componentDidCatch(new Error('native seat boom'))
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.length, 1, '失败必须显式留日志，不能静默')
  assert.match(String(warnings[0][0]), /原生节点座位渲染失败/)
})

test('原生座位：只接管 turn-process；turn-tail 必须交给原生（复制/点赞/点踩/分支按钮在里面）', () => {
  const { seatNodesOf } = client.__internals
  const kept = seatNodesOf([
    { key: 'a', kind: 'tool-call' },
    { key: 'b', kind: 'turn-tail' },
    { key: 'c', kind: 'turn-process' },
    null,
    undefined,
    { key: 'd', kind: 'user' },
  ])
  assert.deepEqual(kept.map((node) => node.key), ['a', 'b', 'd'], 'turn-tail 必须留给原生条目渲染')
})

test('原生座位：收尾节点真的被渲染成座位（entryKey = turn-tail）', () => {
  const { view, t } = bootView()
  const { calls, renderSlot } = seatSpy()
  view.component({
    sessionId: 'session-tail-seat',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
          assistantNode('a1', 1, 2, [{ kind: 'text', text: '做完了' }]),
          turnTailNode('tt1', 1, 3),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    renderSlot,
  })
  const tailCall = calls.find((call) => call.owner.node.kind === 'turn-tail')
  assert.ok(tailCall !== undefined, 'turn-tail 必须经过原生座位（按钮由它渲染）')
  assert.equal(tailCall.options.entryKey, 'turn-tail')
  assert.equal(typeof tailCall.owner.forkAt, 'function', '分支按钮要 forkAt')
  assert.equal(typeof tailCall.owner.inspectCall, 'function')
})

test('turnDataOfNode / turnOfChatNode：只有 turn 与 step 两种位置有回合数据', () => {
  const { turnDataOfNode, turnOfChatNode } = client.__internals
  const data = { source: () => undefined }
  const node = { location: { kind: 'step', turn: { turn: 3, data } } }
  assert.equal(turnDataOfNode(node), data, 'hookContext 必须就是 location.turn.data')
  assert.equal(turnOfChatNode(node), 3)
  assert.equal(turnDataOfNode({ location: { kind: 'unresolved' } }), undefined)
  assert.equal(turnDataOfNode({}), undefined)
  assert.equal(turnOfChatNode(undefined), undefined)
})

test('子槽声明：核心的两个子槽挂成不可枚举属性（冲突检查看不到、所有权检查读得到）', () => {
  const { nativeViewChildren, NATIVE_NODE_SLOT, NATIVE_IMAGES_SLOT, OWN_SEAT_SLOT } = client.__internals
  const children = nativeViewChildren()

  // 核心 register() 的冲突检查遍历 `Object.keys(children)`（slots:100）——
  // 核心 ui-chat 的视图条目已经声明过这两个槽，它们绝不能出现在可枚举键里。
  assert.deepEqual(Object.keys(children), [OWN_SEAT_SLOT])
  // renderSlot 的所有权检查只做属性读取（renderer:285）。
  assert.equal(children[NATIVE_NODE_SLOT].kind, 'keyed')
  assert.equal(children[NATIVE_NODE_SLOT].scope, 'session')
  assert.equal(children[NATIVE_IMAGES_SLOT].kind, 'single')
  // 渲染器用 `Object.values(children)` 判断要不要给 SessionProvider（renderer:616）：
  // 会话作用域子槽必须出现在可枚举值里，否则原生座位会因为缺作用域绑定而抛 SlotAssemblyError。
  assert.ok(Object.values(children).some((spec) => spec.scope === 'session'))
  assert.equal(
    Object.values(children).some((spec) => spec.kind === 'chain'),
    false,
    '不是 chain 槽，renderer:615 不必给 renderSlotChain',
  )
})

test('接线：视图条目声明 children 并把原生叶子要的能力放进 inject', () => {
  const { view } = bootView()
  assert.deepEqual(Object.keys(view.options.children), ['chat-flow.seat'], '可枚举子槽只有本插件自己的那个')
  assert.equal(view.options.children['conversation.chat.node'].kind, 'keyed')

  const injected = view.options.inject('session-1')
  assert.equal(typeof injected.openFile, 'function')
  assert.equal(typeof injected.fileMentions, 'function')
  assert.equal(typeof injected.forkAt, 'function')
  // 桩 ctx 里没有 uiConversation → loadImage 降级为 undefined（原生叶子会跳过附件渲染）。
  assert.equal(injected.loadImage, undefined)
})

/** 造一个带可选服务的 ctx 桩：验证原生注入面的能力与降级。 */
function seatFaceStub(services) {
  const calls = { opened: [], forked: [], openedPaths: [] }
  const ctx = {
    get: (name) => services[name],
    sessions: {
      list: { getSnapshot: () => ({ byId: { 'session-1': { cwd: 'D:/work' } } }) },
      fork: (input) => {
        calls.forked.push(input)
        return Promise.resolve('child-1')
      },
      open: (id) => calls.opened.push(id),
    },
  }
  return { ctx, calls }
}

test('原生注入面：openFile 按会话 cwd 解析相对路径，绝对路径原样使用', async () => {
  const { nativeSeatFace, resolveSeatPath } = client.__internals
  const { ctx, calls } = seatFaceStub({
    remote: {
      session: {
        openWorkspacePath: (input) => {
          calls.openedPaths.push(input.path)
          return Promise.resolve({ ok: true })
        },
      },
    },
  })
  const face = nativeSeatFace(ctx, 'session-1')
  await face.openFile('src/a.js')
  await face.openFile('/tmp/b.js')
  await face.openFile('C:\\x\\c.js')
  await face.openFile('\\\\server\\share\\d.js')
  assert.deepEqual(calls.openedPaths, ['D:/work/src/a.js', '/tmp/b.js', 'C:\\x\\c.js', '\\\\server\\share\\d.js'])

  // 路径解析与核心 `resolveWorkspacePath` 同义（util-workspace-path:16-20）。
  assert.equal(resolveSeatPath('D:/work/', '/a'), '/a')
  assert.equal(resolveSeatPath('D:/work/', 'a'), 'D:/work/a')
  assert.equal(resolveSeatPath(undefined, 'a'), 'a')
  assert.equal(resolveSeatPath('D:/work', ''), '')
})

test('原生注入面：打开失败与服务缺席都必须显式报错，不能静默', async () => {
  const { nativeSeatFace } = client.__internals
  const failing = seatFaceStub({
    remote: {
      session: { openWorkspacePath: () => Promise.resolve({ ok: false, error: { message: 'no access' } }) },
    },
  })
  await assert.rejects(() => nativeSeatFace(failing.ctx, 'session-1').openFile('a.js'), /no access/)

  const bare = seatFaceStub({})
  await assert.rejects(() => nativeSeatFace(bare.ctx, 'session-1').openFile('a.js'), /remote\.session 不可用/)
})

test('原生注入面：loadImage / fileMentions / forkAt 的可用与降级', async () => {
  const { nativeSeatFace } = client.__internals
  const owners = []
  const { ctx, calls } = seatFaceStub({
    uiConversation: {
      imageUrl: (sessionId, attachment) => `url:${sessionId}:${attachment}`,
      peekImageUrl: (sessionId, attachment) => `peek:${sessionId}:${attachment}`,
    },
    chatFileMentions: {
      forClosing: (owner) => {
        owners.push(owner)
        return ['a.js']
      },
    },
  })
  const face = nativeSeatFace(ctx, 'session-1')
  assert.equal(face.loadImage('x.png'), 'url:session-1:x.png')
  assert.equal(face.loadImage.peek('x.png'), 'peek:session-1:x.png')
  assert.deepEqual(face.fileMentions({ seq: 9 }), ['a.js'])
  assert.deepEqual(owners, [{ seq: 9 }])

  face.forkAt(42)
  assert.deepEqual(calls.forked, [{ sessionId: 'session-1', atSeq: 42, increaseTitle: true }])
  await Promise.resolve()
  assert.deepEqual(calls.opened, ['child-1'], '分叉成功后应打开子会话')

  // 服务缺席时能力降级为「没有」，而不是抛异常把视图带崩。
  const bare = nativeSeatFace(seatFaceStub({}).ctx, 'session-1')
  assert.equal(bare.loadImage, undefined)
  assert.equal(bare.fileMentions({ seq: 1 }), undefined)
  assert.doesNotThrow(() => bare.forkAt(1))
})

/* ──────────────────────────── 本轮修的行为 ──────────────────────────── */

/** 造一个最小的回合模型（只带渲染层用到的字段）。 */
function turnGroup(overrides = {}) {
  return {
    key: 'turn:1',
    turn: 1,
    input: undefined,
    closed: false,
    unfinished: false,
    durationMs: 0,
    startedAt: 1_000_000,
    liveKey: null,
    inputText: '',
    planned: false,
    planNodes: [],
    segments: [],
    looseNodes: [],
    closing: [],
    footerNodes: [],
    subagents: { notices: new Map(), consumed: new Set() },
    stats: { counts: { thinking: 0, command: 0, file: 0, mcp: 0, question: 0 }, listed: 0 },
    ...overrides,
  }
}

test('任务耗时：正在跑的回合实时计时（0 分 0 秒起），结束的回合用派生值', () => {
  const { views, formatDuration, ZH } = client.__internals
  const t = (key, params) => {
    const template = ZH[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  assert.match(formatDuration(0, t), /0分0秒/, '计时从 0 分 0 秒开始，分位始终显示')
  assert.match(formatDuration(65_000, t), /1分5秒/)

  const live = views.TurnGroup({
    group: turnGroup(),
    t,
    sessionId: 'session-duration-live',
    labels: {},
    live: true,
    seat: undefined,
    now: 1_000_000 + 5_000,
  })
  assert.match(collectText(live), /任务耗时 0分5秒/, '正在跑的回合用 now - startedAt 实时算')

  const settled = views.TurnGroup({
    group: turnGroup({ closed: true, durationMs: 62_000 }),
    t,
    sessionId: 'session-duration-settled',
    labels: {},
    live: false,
    seat: undefined,
    now: 1_000_000 + 900_000,
  })
  assert.match(collectText(settled), /任务耗时 1分2秒/, '结束的回合用派生层的固定耗时，不再跟着时钟走')
})

test('插队 / 排队的消息在列表末尾有座位，并标出各自状态', () => {
  const { view, t } = bootView()
  const session = {
    hasMore: false,
    loadingOlder: false,
    running: true,
    queue: [{ id: 'q1', placement: 'steering', content: [{ type: 'text', text: '插一句话' }] }],
    pendingSubmissions: [{ requestId: 'rpc-1', placement: 'steering', text: '刚发出去的' }],
  }
  const tree = view.component({
    sessionId: 'session-pending',
    t,
    useChat: (selector) => selector(makeSnapshot([userNode('u1', 1, '干活')])),
    useSession: (selector) => selector(session),
  })
  const text = collectText(tree)
  assert.match(text, /插一句话/)
  assert.match(text, /插队待处理/)
  assert.match(text, /刚发出去的/)
  const steeringSeat = findElement(tree, (element) => element.props?.['data-pending-steering'] === 'true')
  assert.ok(steeringSeat !== undefined, '插队座位要带核心约定的 data-pending-steering（回退插件按它找座位）')

  // 已经变成正式节点的那条不再以回显形式重复出现。
  const landed = makeSnapshot([userNode('u1', 1, '干活')])
  landed.nodes.get('u1').data.source = { kind: 'user', rpcId: 'rpc-1' }
  const deduped = view.component({
    sessionId: 'session-pending-2',
    t,
    useChat: (selector) => selector(landed),
    useSession: (selector) => selector(session),
  })
  assert.equal(collectText(deduped).includes('刚发出去的'), false)
  assert.match(collectText(deduped), /插一句话/, '插队项仍在队列里，照常显示')
})

test('取消键留下的半截过程：折叠体保持展开并标成「思考未完成」', () => {
  const { view, t } = bootView()
  const half = assistantNode('a1', 1, 2, [{ kind: 'reasoning', text: '写到一半就停了' }])
  half.data.status = 'interrupted'
  const tree = view.component({
    sessionId: 'session-cut-off',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
          half,
          turnTailNode('tt1', 1, 3),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  })
  const text = collectText(tree)
  assert.match(text, /思考未完成/, '被打断的块要明确说是未完成，不能装作「已完成」')
  assert.match(text, /写到一半就停了/, '内容必须还在（折叠体保持挂载且默认展开）')
  const head = findElement(
    tree,
    (element) =>
      String(element.props?.className ?? '').includes('dcf-thinkinghead') && collectText(element).includes('思考未完成'),
  )
  assert.equal(head.props['aria-expanded'], true, '被打断的块默认展开')
})

test('视图层错误边界：本插件自己的渲染错误降级成错误摘要，而非让整块视图让位', async () => {
  // 这一条同样需要「createElement 不立刻调用组件」的探针 React 才能拿到边界元素本身。
  const probeModule = await loadBundle({ react: createProbeReact().react })
  const { views } = probeModule.exports.__internals
  const t = (key) => key
  const element = views.TaskFlowView({
    t,
    useChat: () => ({}),
    useSession: () => ({}),
  })
  const Boundary = element.type
  assert.equal(typeof Boundary.getDerivedStateFromError, 'function', 'TaskFlowView 必须把主体包在错误边界里')

  assert.deepEqual(Boundary.getDerivedStateFromError(new Error('boom')), { failed: true, message: 'boom' })
  assert.deepEqual(Boundary.getDerivedStateFromError('not-an-error'), { failed: true, message: 'not-an-error' })

  const instance = new Boundary({ t, children: 'BODY' })
  assert.equal(instance.render(), 'BODY', '正常时渲染视图主体')
  instance.state = { failed: true, message: 'boom' }
  const strip = instance.render()
  assert.equal(strip.props['data-dcf-error'], 'boom')
  assert.match(collectText(strip), /flow\.error\.title/)

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    instance.componentDidCatch(new Error('boom'))
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.length, 1, '必须留日志线索')
  assert.match(String(warnings[0][0]), /任务视图渲染失败/)
})

/**
 * 某个元素在树里的「折叠层深」：0 = 不在任何折叠体里，1 = 在第一层折叠体里……
 * 用来断言「收尾动作行没有被折进任务过程」。
 *
 * @param element - 根元素。
 * @param predicate - 命中判定。
 * @returns 层深；没找到时返回 -1。
 */
function foldDepthOf(element, predicate) {
  let found = -1
  const walk = (value, depth) => {
    if (found >= 0 || value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth)
      return
    }
    const props = value.props ?? {}
    if (predicate(value)) {
      found = depth
      return
    }
    walk(props.children, props.className === 'dcf-fold' ? depth + 1 : depth)
  }
  walk(element, 0)
  return found
}

test('收尾动作行排在总结之后，且不在「任务过程」折叠体里', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-footer-order',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
          assistantNode('a1', 1, 2, [{ kind: 'text', text: '两件事都做完了' }]),
          turnTailNode('tt1', 1, 3),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  })

  const turn = findElement(tree, (element) => element.props?.className === 'dcf-turn')
  assert.ok(turn !== undefined, '应渲染出回合容器')
  const children = (Array.isArray(turn.props.children) ? turn.props.children : [turn.props.children]).filter(Boolean)
  const labels = children.map(
    (child) => child.props?.['data-chat-flow-kind'] ?? child.props?.className,
  )
  assert.equal(labels[labels.length - 1], 'turn-tail', '收尾动作行是回合的最后一个子节点（总结之后）')
  assert.equal(
    labels.indexOf('turn-tail') === labels.lastIndexOf('turn-tail') ? 1 : 0,
    1,
    '收尾动作行只渲染一次',
  )
  assert.equal(
    foldDepthOf(turn, (element) => element.props?.['data-chat-flow-kind'] === 'turn-tail'),
    0,
    '收尾动作行必须落在所有折叠体之外（用户报告过它跑进了「任务过程」）',
  )
  // 正文（总结）在收尾行之前，且正文本身也在折叠体之外。
  assert.equal(foldDepthOf(turn, (element) => collectText(element).includes('两件事都做完了')), 0)
})

test('「任务过程」始终默认折叠（即使在跑）', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-stage-collapsed',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })
  const stageRow = findElement(
    tree,
    (element) => String(element.props?.className ?? '').includes('dcf-row') && collectText(element).includes('任务过程'),
  )
  assert.ok(stageRow !== undefined, '应有「任务过程」折叠头')
  assert.equal(stageRow.props['aria-expanded'], false, '「任务过程」默认必须收起')
  assert.match(collectText(stageRow), /任务耗时/, '收起时也要能看到耗时（实时计时仍写在折叠头上）')
})