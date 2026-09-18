/**
 * `dsh-chat-flow` client —— 任务主视图：把扁平对话重组成「计划 → 任务列表 → 子对话」，
 * 并把任务执行期间的一切动作折进可展开的「正在处理」统计块。
 *
 * **本文件由 `lib/client/*.js` 拼接生成**（`node scripts/build-client.mjs`），不要直接改它：
 * DSH 只按 `exports["./client"]` 提供一个 URL（`/plugins/<包名>/client.js`），物理上必须单文件；
 * 拼接式构建让源码仍按领域分片、每片都能单读。
 *
 * 浏览器侧是 `window.__ModuleLoader__.load` 手写的 CJS 风格 bundle（零第三方依赖）：
 * `react` 与 `@deepseek-ai/dsh-client-ui-primitives` 由宿主的冻结模块表提供（平台 seed word）。
 *
 * 数据来源是本插件的关键设计：整棵对话节点树经 ui-chat 的 `uiSession.provide({hooks:['chat']})`
 * 作为标准 hook 暴露给**所有** session 作用域条目，因此本视图用 `props.useChat` 就能拿到它，
 * 不需要 fork 核心渲染器、不读 DOM、也不需要 host 再算一份数据。
 */

window.__ModuleLoader__.load({
  id: 'dsh-chat-flow',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { useState, useEffect, useMemo, useCallback, useRef } = react
    const h = react.createElement

    /** 客户端插件依赖的服务：插槽表、本地化、会话绑定（拉更早的历史用）。 */
    const inject = ['slots', 'locale', 'sessions']

    /** locale namespace 与样式 tag 都必须是全局唯一的（不同插件共用同一张注册表）。 */
    const NS = 'chat-flow'
    const STYLE_ID = 'dsh-chat-flow-style'
    const COLLAPSE_KEY = 'dsh-chat-flow.collapse'

    /** 核心对话视图的 id：视图选择的 fallback 硬编码为它，因此想当默认视图只能认领这个 id。 */
    const CHAT_VIEW_ID = 'chat'
    const CHAT_VIEW_ORDER = 0

    /**
     * 遮蔽核心条目的优先级：同单元格上 **priority 最小者**渲染。
     * 核心条目是 0，因此 -1 即可接管，且两者不同 priority 时并存不冲突（冲突只判同 id 同 priority）。
     */
    const SHADOW_PRIORITY = -1

    /** JSON 安全序列化：`payload` 里可能有循环引用或 BigInt，序列化失败不能把整块视图带崩。 */
    function safeStringify(value) {
      try {
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }

    /* 以下四个是 primitives 缺失时的退路：DSH 升级若改名或移除某个原语，
       视图仍然可读，而不是整块变成 `data-slot-error`。 */
    function PlainText({ text }) {
      return h('div', { className: 'dcf-text' }, String(text ?? ''))
    }
    function PlainJson({ payload }) {
      return h('pre', { className: 'dcf-pre' }, safeStringify(payload))
    }
    function PlainTerminal({ command, output }) {
      const text = `${command ?? ''}${output ? `\n\n${output}` : ''}`
      return h('pre', { className: 'dcf-pre' }, text)
    }
    function PlainDot({ className }) {
      return h('span', { className: className ?? 'dcf-dot dcf-dot-pending' })
    }

    /** 取 primitives 里的组件，拿不到就用退路。 */
    function componentOr(candidate, fallback) {
      if (typeof candidate === 'function') return candidate
      if (candidate !== null && typeof candidate === 'object') return candidate
      return fallback
    }

    const MarkdownText = componentOr(primitives.MarkdownText, PlainText)
    const MessageText = componentOr(primitives.MessageText, PlainText)
    const JsonBlock = componentOr(primitives.JsonBlock, PlainJson)
    const TerminalBlock = componentOr(primitives.TerminalBlock, PlainTerminal)
    const StateDot = componentOr(primitives.StateDot, PlainDot)
