/**
 * 客户端 bundle 测试：模块注册、插槽接线、以及整棵视图在 node 里的冒烟渲染。
 *
 * 用的是手写渲染器（`createElement` 直接调用函数组件），它能抓到「组件是 undefined」
 * 这类会让真实界面整块白屏的错误——这正是这个文件存在的主要理由。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { collectText, createStorage, loadBundle } from './helpers/load-bundle.mjs'
import {
  assistantNode,
  makeSnapshot,
  pwshNode,
  todoNode,
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
  assert.equal(captured.locales[0].dict.zh['flow.processing'], '正在处理')
  assert.equal(captured.effects.length, 1, '语言包注册应挂在 effect 上，随插件卸载回收')

  assert.equal(appendedStyles.length, 1, '样式只注入一次（按固定 id 去重）')
  assert.match(appendedStyles[0].textContent, /\.dcf-root/)

  assert.ok(view !== undefined, '必须注册 conversation.view')
  assert.equal(view.options.id, 'chat', '认领 id=chat 才能成为默认视图（fallback 硬编码为它）')
  assert.equal(view.options.priority, -1, '同单元格上 priority 最小者渲染，-1 才能遮蔽核心条目')
  assert.equal(view.options.order, 0)
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

test('默认展开策略：进行中的任务与其「正在处理」都展开，明细可见', () => {
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
  // 三个块在「进行中」时展开：规划过程 / 任务行 / 正在处理；
  // 剩下那个收起的是**某条操作自己的明细**（一行一条之后还要再点才展开，这是刻意的）。
  assert.deepEqual(foldStates(tree), ['true', 'true', 'true', 'false'])
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
  assert.deepEqual(foldStates(before), ['true', 'true', 'true', 'false'])

  // 点「正在处理」那一行 → 收起它。
  const procRow = findElement(
    before,
    (element) => element.props?.className === 'dcf-row' && collectText(element).includes('正在处理'),
  )
  assert.ok(procRow !== undefined && typeof procRow.props.onClick === 'function', '「正在处理」行应当可点')
  procRow.props.onClick()

  const after = view.component({ ...props, t })
  assert.deepEqual(foldStates(after), ['true', 'true', 'false', 'false'], '手动收起后应保持收起（已写进折叠状态）')
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
