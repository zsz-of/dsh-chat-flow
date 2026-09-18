/**
 * host 半侧接线测试：协议分区 + 规划提醒。
 *
 * 用桩上下文真跑一遍 `apply()`，因此断言的是「接线真的接上了」，而不是「函数存在」。
 * 需要 `Source/node_modules/@deepseek-ai` 链接（`install.mjs` 会建）；缺链接时整组跳过。
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEER_LINK = join(HERE, '..', 'node_modules', '@deepseek-ai', 'dsh-llm')

let plugin
let ready = false

before(async () => {
  if (!existsSync(PEER_LINK)) return
  plugin = await import('../lib/index.js')
  ready = true
})

/** 桩上下文：只实现本插件真正用到的那几个动词。 */
function stubCtx() {
  const captured = { handlers: new Map(), effects: [], sections: [] }
  const ctx = {
    on(event, handler) {
      captured.handlers.set(event, handler)
    },
    effect(fn, label) {
      captured.effects.push(label)
      const dispose = fn()
      if (typeof dispose === 'function') captured.disposers?.push(dispose)
      return () => {}
    },
    inject(deps, run) {
      // 与真实 cordis 一致：依赖齐全时才把补齐后的子上下文交给回调。
      if (!deps.includes('systemPrompt')) return
      run({
        ...ctx,
        systemPrompt: {
          section(section) {
            captured.sections.push(section)
            return () => {}
          },
        },
      })
    },
  }
  return { ctx, captured }
}

/** 从一条用户消息里取出正文（`createUserMessage` 的产物是内容块数组）。 */
function textOf(message) {
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/** 跑一次 `agent/pre-step`，返回注入进来的正文。 */
async function runPreStep(captured, session, step) {
  const handler = captured.handlers.get('agent/pre-step')
  const decision = await handler({ agent: { session }, step, signal: { aborted: false } }, async () => ({
    kind: 'enter',
    messages: [{ role: 'user', content: [{ type: 'text', text: '原有的上下文' }] }],
  }))
  return { decision, injected: decision.messages.slice(1).map(textOf) }
}

test('host 接线：插件名、硬依赖与两个挂钩', (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接（先跑一次 node scripts/install.mjs）')
  const { ctx, captured } = stubCtx()
  plugin.apply(ctx)
  assert.equal(plugin.name, 'chat-flow')
  assert.deepEqual(plugin.inject, ['agents'])
  assert.ok(captured.handlers.has('agent/pre-step'), '必须挂 pre-step 才能提醒先规划')
  assert.ok(captured.handlers.has('session/event'), '必须跟踪 session/event 才能知道本回合是否已写计划')
})

test('host 接线：注册一段命名唯一、顺序固定的系统提示分区', (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  plugin.apply(ctx)
  assert.equal(captured.sections.length, 1)
  const section = captured.sections[0]
  assert.equal(section.name, 'chat-flow:protocol')
  assert.equal(Number.isFinite(section.order), true)
  // 协议必须写清四个时机与「先规划」，否则模型没有依据可循。
  for (const phrase of ['任务开始时', '输出任务计划时', '需要用户审批或决定时', '任务结束时', 'todo_write', '禁止批量补记']) {
    assert.ok(section.text.includes(phrase), `协议正文缺少「${phrase}」`)
  }
})

test('回合第一步注入规划提醒，且同一回合只注入一次', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  plugin.apply(ctx)
  const session = { id: 's1' }
  captured.handlers.get('session/event')(session, { type: 'turn/start', data: { turn: 1 } })

  const first = await runPreStep(captured, session, 1)
  assert.equal(first.injected.length, 1)
  assert.match(first.injected[0], /<plan-first>/)
  assert.match(first.injected[0], /todo_write/)
  assert.equal(first.decision.messages.length, 2, '原有上下文必须原样保留')

  const second = await runPreStep(captured, session, 1)
  assert.equal(second.injected.length, 0, '同一回合不能重复提醒')

  const later = await runPreStep(captured, session, 2)
  assert.equal(later.injected.length, 0, '第二步之后不再提醒（模型已经在干活）')
})

test('模型已经写过计划就不再提醒', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  plugin.apply(ctx)
  const session = { id: 's2' }
  const sessionEvent = captured.handlers.get('session/event')
  sessionEvent(session, { type: 'turn/start', data: { turn: 1 } })
  sessionEvent(session, { type: 'todo/write', data: { todos: [{ content: 'A', status: 'in_progress' }] } })

  const decision = await runPreStep(captured, session, 1)
  assert.equal(decision.injected.length, 0)
  assert.equal(decision.decision.kind, 'enter')
})

test('新回合重置状态：上一次写过计划也要重新提醒', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  plugin.apply(ctx)
  const session = { id: 's3' }
  const sessionEvent = captured.handlers.get('session/event')
  sessionEvent(session, { type: 'turn/start', data: { turn: 1 } })
  sessionEvent(session, { type: 'todo/write', data: { todos: [{ content: 'A', status: 'completed' }] } })
  assert.equal((await runPreStep(captured, session, 1)).injected.length, 0)

  sessionEvent(session, { type: 'turn/start', data: { turn: 2 } })
  const next = await runPreStep(captured, session, 1)
  assert.equal(next.injected.length, 1, '每个回合都要重新先规划')
})

test('会话对象缺失或事件缺字段时不抛异常', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  plugin.apply(ctx)
  const sessionEvent = captured.handlers.get('session/event')
  assert.doesNotThrow(() => sessionEvent(undefined, undefined))
  assert.doesNotThrow(() => sessionEvent({ id: 's4' }, { type: 'turn/start' }))
  const handler = captured.handlers.get('agent/pre-step')
  const decision = await handler({ agent: undefined, step: 1, signal: undefined }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(decision.kind, 'enter')
})

test('上游拒绝这一步时原样返回，不追加任何消息', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  plugin.apply(ctx)
  const handler = captured.handlers.get('agent/pre-step')
  const rejected = await handler({ agent: { session: { id: 's5' } }, step: 1, signal: { aborted: false } }, async () => ({ kind: 'reject' }))
  assert.deepEqual(rejected, { kind: 'reject' })
})
