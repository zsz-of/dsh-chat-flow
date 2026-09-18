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
const { registration, requested, appendedStyles } = module0

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

test('折叠状态默认收起：任务子对话与「正在处理」都没展开', () => {
  const { view, t } = bootView()
  const snapshot = makeSnapshot([
    userNode('u1', 1, '做点事'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'secret-command', 'secret-output'),
  ])
  const tree = view.component({
    sessionId: 'session-2',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false }),
  })
  const text = collectText(tree)
  assert.match(text, /任务A/)
  assert.match(text, /进行中/)
  // 默认收起：动作标题可见（「正在处理」在任务展开体里，因此这里连统计也不该出现）。
  assert.doesNotMatch(text, /secret-command/)
  assert.doesNotMatch(text, /secret-output/)
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
