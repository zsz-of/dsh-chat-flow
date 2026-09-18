/**
 * `dsh-chat-flow` —— host 半侧入口。
 *
 * 职责只有两件，都很小：
 * 1. 把「对用户输出」协议与「先规划后执行」纪律写进系统提示（`systemPrompt.section`）；
 * 2. 在每个回合的第一步，若该回合还没有任务计划，就注入一条提醒（`agent/pre-step`）。
 *
 * 为什么 host 侧不做数据：任务列表与「正在处理」统计都从会话节点树派生，而节点树由浏览器侧
 * 的 `useChat` 标准 hook 直接提供（见 `docs/references/core-seams.md`）。host 再算一遍就会产生
 * 两份真相，验收标准第 10 条「统计数字与实际调用次数一致」将无法保证。
 *
 * @module dsh-chat-flow
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { PLAN_REMINDER_TEXT, PROTOCOL_ORDER, PROTOCOL_PLUGIN, PROTOCOL_SECTION, PROTOCOL_TEXT } from './protocol.js'

/** cordis 插件名：loader 诊断与注入消息的来源标记都用它（== `cordis.patch.yml` 的 insert 行 id）。 */
export const name = PROTOCOL_PLUGIN

/**
 * 硬依赖：`agents` 提供 agent 平面（`agent/pre-step` 事件）。
 *
 * `systemPrompt` 刻意不在这里——它只被提示分区用到，用 `ctx.inject` 单独等，
 * 缺它时客户端视图照旧可用，而不是整个插件不加载。
 */
export const inject = ['agents']

/**
 * 每个会话的本回合状态：`turn/start` 重置，`todo/write` 置为已规划。
 *
 * 以 Session 对象为键（`session/event` 的第一个参数就是它），因此不需要会话 id 映射，
 * 也不会因为会话被回收而泄漏。
 */
const turnStates = new WeakMap()

/**
 * 组装一条插件来源的持久消息。
 *
 * `source.form: 'snapshot'` + `sections` 让渲染层把它标成上下文注入行，
 * 与规则/记忆注入保持一致的呈现，而不是伪装成用户发言。
 *
 * @param text - 注入正文。
 * @returns 一条属于本插件的用户消息。
 */
function pluginMessage(text) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: PROTOCOL_SECTION, text }] },
  })
}

/**
 * 注册协议分区、回合状态跟踪与规划提醒。
 *
 * @param ctx - 插件上下文。
 * @returns 无。
 */
export function apply(ctx) {
  // 协议分区：缺 systemPrompt 服务时静默跳过（客户端仍能完整工作），不阻断插件加载。
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(
      () =>
        promptCtx.systemPrompt.section({
          name: PROTOCOL_SECTION,
          order: PROTOCOL_ORDER,
          text: PROTOCOL_TEXT,
        }),
      'chat-flow prompt section',
    )
  })

  // 跟踪「本回合是否已写计划」。事件签名是 (subject, event)：subject 是 Session。
  ctx.on('session/event', (subject, event) => {
    if (subject === undefined || event === undefined) return
    if (event.type === 'turn/start') {
      turnStates.set(subject, { turn: event.data?.turn ?? 0, planned: false, reminded: undefined })
      return
    }
    if (event.type === 'todo/write') {
      const state = turnStates.get(subject)
      if (state !== undefined) state.planned = true
    }
  })

  ctx.on(
    'agent/pre-step',
    async ({ agent, step, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal?.aborted === true) return decision
      // 只在回合的第一步提醒：后续步里模型已经在干活，再提醒只会污染上下文。
      if (typeof step === 'number' && step > 1) return decision
      const session = agent?.session
      if (session === undefined) return decision
      const state = turnStates.get(session)
      // 已写过计划，或本回合已经提醒过，就不再重复。
      if (state !== undefined && (state.planned === true || state.reminded === state.turn)) return decision
      if (state !== undefined) state.reminded = state.turn
      return { kind: 'enter', messages: [...decision.messages, pluginMessage(PLAN_REMINDER_TEXT)] }
    },
    { prepend: true },
  )
}
