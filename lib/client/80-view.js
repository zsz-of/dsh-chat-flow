    /* ──────────────────────────── 任务主视图 ──────────────────────────── */

    /** 取整份快照的选择器：引用稳定，避免每次渲染都重新订阅。 */
    function identitySelector(value) {
      return value
    }

    /**
     * 跳到某个回合（一次对话）的开头。
     *
     * 用 `scrollIntoView` 而不是自己算 `scrollTop`：滚动宿主是 shell 的，它的 padding、
     * header 与 sticky 顶栏都由 shell 决定，交给浏览器算才不会偏。
     * 系统开了「减少动态效果」时用瞬时跳转，与 CSS 里的动效收敛保持一致。
     *
     * @param root - 本视图根节点。
     * @param turn - 目标回合号。
     * @returns 无。
     */
    function jumpToTurn(root, turn) {
      if (root === null || root === undefined || typeof root.querySelector !== 'function') return
      const target = root.querySelector(`[data-turn-anchor="${turn}"]`)
      if (target === null || typeof target.scrollIntoView !== 'function') return
      const reduced =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    }

    /**
     * 任务视图主体（真正调用 hook 的地方）。
     *
     * 数据来源全部是**标准 props**，不读 DOM 取业务数据、不开自有数据通道：
     * - `useChat` 由 ui-chat 通过 `uiSession.provide({hooks:['chat']})` 提供，是整棵对话节点树；
     * - `useSession` 由 ui-session 内置源提供，用来判断 `running` / `hasMore` / `loadingOlder`；
     * - `t` 来自本条目声明的 `locale`；
     * - `loadOlder` 来自本条目自己的 `inject`。
     *
     * 布局分两层：外层是满宽块（承载右侧导轨的 sticky 槽），内层 `.dcf-main` 才是限宽阅读列。
     *
     * @param props - 见上。
     * @returns 任务流 + 右侧回合导轨。
     */
    function FlowBody({ sessionId, useChat, useSession, t, loadOlder }) {
      const rootRef = useRef(null)
      const snapshot = useChat(identitySelector)
      const flow = useMemo(() => deriveFlow(snapshot), [snapshot])
      const labels = useMemo(() => markdownLabels(t), [t])
      const session = useSession(identitySelector)

      const running = session?.running === true
      const turns = useMemo(() => flow.turns.map((group) => group.turn), [flow])
      /** 正在跑的回合：它的默认展开态与导轨上的呼吸刻度都用它。 */
      const liveTurn = running && turns.length > 0 ? turns[turns.length - 1] : null
      const { activeTurn } = useScroller(rootRef, {
        turns,
        hasMore: session?.hasMore,
        loadingOlder: session?.loadingOlder,
        loadOlder,
      })
      const onJump = useCallback((turn) => jumpToTurn(rootRef.current, turn), [])

      const main = []
      if (session?.hasMore === true) {
        main.push(
          h(
            'button',
            {
              key: 'load-older',
              type: 'button',
              className: 'dcf-hint',
              disabled: session.loadingOlder === true,
              onClick: () => {
                if (typeof loadOlder === 'function') loadOlder()
              },
            },
            t('flow.loadOlder'),
          ),
        )
      }
      if (flow.turns.length === 0) {
        main.push(h('div', { key: 'empty', className: 'dcf-empty' }, t('flow.empty')))
      }
      for (const group of flow.turns) {
        main.push(
          h(TurnGroup, {
            key: group.key,
            group,
            t,
            sessionId,
            labels,
            live: group.turn === liveTurn,
          }),
        )
      }

      return h(
        'div',
        { className: 'dcf-root', ref: rootRef, 'data-chat-flow-owner': 'dsh-chat-flow' },
        h(TurnRail, { turns, activeTurn, liveTurn, onJump, t }),
        h('div', { className: 'dcf-main' }, main),
      )
    }

    /**
     * 任务视图：`conversation.view` 的 `chat` 单元格得主。
     *
     * 这一层只做能力探测——`useChat` 是 ui-chat 提供的，如果那个包不在装配里，
     * 视图给出空态而不是抛异常（插槽条目崩溃会被判定为让位，整块变 `data-slot-error`，
     * 那是比空态差得多的用户体验）。
     *
     * @param props - 插槽 kit + owner props。
     * @returns 任务视图。
     */
    function TaskFlowView(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const ready = typeof props.useChat === 'function' && typeof props.useSession === 'function'
      if (!ready) return h('div', { className: 'dcf-empty' }, t('flow.empty'))
      return h(FlowBody, { ...props, t })
    }
