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

    /**
     * 本插件留在**会话级存储**里的全部键前缀（都拼成 `<前缀>.<sessionId>`）。
     *
     * 列在这里而不是散在各分片，是因为「会话删了要把本插件的东西一起带走」这件事
     * 需要一个**唯一清单**：漏掉任何一个，那个键就再也没人会读（键里带着 sessionId），
     * 只会一直躺在用户的存储里。
     */
    const SESSION_KEY_PREFIXES = [
      COLLAPSE_KEY,
      'dsh-chat-flow.scroll',
      'dsh-chat-flow.ended-away',
    ]

    /**
     * 清掉本插件给某个会话留下的全部数据（会话被删除时调用）。
     *
     * **存储不可用不能把删除动作带崩**：隐私模式、配额打满时读写都会抛，
     * 而「少清几个键」远比「删不掉会话」轻得多，所以整体静默降级。
     *
     * @param sessionId - 被删除的会话 id。
     * @param env - `{localStorage, sessionStorage}`（真机传 `window`，测试传替身）。
     * @returns 实际删掉的键个数（排查与测试用）。
     */
    function purgeSessionData(sessionId, env) {
      if (typeof sessionId !== 'string' || sessionId === '') return 0
      const suffix = `.${sessionId}`
      let removed = 0
      for (const store of [env?.localStorage, env?.sessionStorage]) {
        if (store === null || store === undefined || typeof store.removeItem !== 'function') continue
        try {
          const doomed = []
          for (let index = 0; index < store.length; index += 1) {
            const key = store.key(index)
            if (typeof key === 'string' && SESSION_KEY_PREFIXES.some((prefix) => key === `${prefix}${suffix}`)) {
              doomed.push(key)
            }
          }
          for (const key of doomed) {
            store.removeItem(key)
            removed += 1
          }
        } catch (_) {
          // 存储不可用（隐私模式 / 配额满）：放弃清理，但不影响调用方继续删会话。
        }
      }
      return removed
    }

    /**
     * 找出「本插件留了数据、但会话列表里已经没有」的 sessionId。
     *
     * 核心**没有**会话删除事件（`ctx.sessions` 只给一个列表快照），所以删除只能这样发现：
     * 会话列表变了之后，比对哪些 id 不见了。调用方再对每个 id 调 `purgeSessionData`。
     *
     * 两道保险，防止把**还活着**的会话的数据误删（顺序很重要）：
     * 1. `alive` 为空时一律不动手——重连重拉会让列表短暂变空，那时候「全都不见了」不是事实；
     * 2. 正在看的那个会话由调用方排除（`useSessions` 的列表里可能还没有它，比如刚建的空会话）。
     *
     * @param env - `{localStorage, sessionStorage}`。
     * @param alive - 会话列表里的 id 集合。
     * @returns 消失的 sessionId 数组（去重，顺序按存储里的先来后到）。
     */
    function staleSessionIds(env, alive) {
      const gone = []
      if (alive === null || alive === undefined || alive.size === 0) return gone
      for (const store of [env?.localStorage, env?.sessionStorage]) {
        if (store === null || store === undefined || typeof store.key !== 'function') continue
        try {
          for (let index = 0; index < store.length; index += 1) {
            const key = store.key(index)
            if (typeof key !== 'string') continue
            for (const prefix of SESSION_KEY_PREFIXES) {
              const head = `${prefix}.`
              if (!key.startsWith(head)) continue
              const sessionId = key.slice(head.length)
              if (sessionId !== '' && !alive.has(sessionId) && !gone.includes(sessionId)) gone.push(sessionId)
            }
          }
        } catch (_) {
          // 存储不可用：放弃这一轮清理（同上，静默降级）。
        }
      }
      return gone
    }

    /**
     * 本视图自己的条目 id 与排序位。
     *
     * **为什么不遮蔽核心「对话」视图**：视图选择的 fallback 硬编码为 `id === 'chat'`，
     * 遮蔽（同 id + 更低 priority）确实能让本视图成为默认，代价是核心那条条目仍在账本里，
     * 标签栏读的正是账本 → 出现两个标签、且两个都带激活下划线（`aria-selected` 按 id 比对）。
     * 而核心**不允许注销别人的条目**（`StoredEntry` 无 disposer），所以遮蔽必然留下重复标签。
     *
     * 现在的做法：用独立 id 作为**并列视图**（原生「对话」仍是默认），标签栏只有一个高亮；
     * 想用任务流视图点「任务」标签即可（选择会被持久化）。
     */
    const TAB_VIEW_ID = 'flow'
    const TAB_VIEW_ORDER = 5

    /**
     * 跳到某个回合时，在滚动口顶部留出的空隙（核心 `landOnRow` 硬编码 24px，这里用同一量级）。
     *
     * 放在 head 里是因为它被两个分片共用：`80-view.js` 的刻度跳转与 `85-scroll.js` 的翻页落位。
     */
    const RAIL_LAND_OFFSET_PX = 24

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
