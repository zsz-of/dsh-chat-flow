    /* ──────────────────────────── 任务主视图 ──────────────────────────── */

    /** 取整份快照的选择器：引用稳定，避免每次渲染都重新订阅。 */
    function identitySelector(value) {
      return value
    }

    /** `useSessions` 缺席时的替身：同一个渲染位置永远只调一次，hook 顺序不变。 */
    function noSessions() {
      return undefined
    }

    /**
     * 原生座位的**主人参数**（owner props）。
     *
     * 这些参数是核心 `ChatNodeSeat` 在 `renderSlot('conversation.chat.node', routedOwner, …)` 时
     * 交给原生叶子的（`dsh-client-ui-chat/lib/client.js:1509-1553`，逐项来源见
     * `docs/references/core-seams.md` §13）。本视图自己画层级，就必须把同样的参数补齐，
     * 否则原生叶子在真机上会因为拿不到 `openFile` / `fileMentions` / `renderMessageImages`
     * 而在事件回调里抛错（点一下文件名、展开一条带附件的消息都会踩到）。
     *
     * 三项刻意留空：
     * - `selectedCallId`：核心用它高亮「详情」侧栏里选中的调用，本视图没有那个侧栏；
     * - `turnProcess`：核心的「过程折叠」控制器，本插件用自己的任务阶段折叠替代它；
     * - `cwd` 取不到时留空，原生叶子按原样使用路径。
     *
     * @param props - 本视图收到的插槽 props。
     * @param sessionId - 本视图所属会话。
     * @returns `{owner, renderSlot}`：`owner` 给原生叶子，`renderSlot` 给原生座位。
     */
    function useNativeSeat(props, sessionId) {
      const { renderSlot, openFile, forkAt, fileMentions, loadImage, openView, useSessions } = props
      const useSessionsSafe = typeof useSessions === 'function' ? useSessions : noSessions
      const cwd = useSessionsSafe((state) => (state?.byId === undefined ? undefined : state.byId[sessionId]?.cwd))
      return useMemo(
        () => ({
          renderSlot,
          owner: {
            cwd,
            selectedCallId: undefined,
            turnProcess: undefined,
            /**
             * 核心的实现是 `openView('trajectory', callId)`（`ui-chat:2020-2022`），
             * `openView` 由 `conversation.session` 作为 owner prop 交给视图条目。
             */
            inspectCall: (callId) => {
              if (typeof openView === 'function') openView('trajectory', callId)
            },
            openFile: typeof openFile === 'function' ? openFile : () => Promise.resolve(),
            forkAt: typeof forkAt === 'function' ? forkAt : () => {},
            fileMentions: typeof fileMentions === 'function' ? fileMentions : () => undefined,
            // 与核心同一行语义：把 owner 原样转交消息图片插槽，并补上 loadImage（`ui-chat:2059-2062`）。
            renderMessageImages:
              typeof renderSlot === 'function'
                ? (target) => renderSlot(NATIVE_IMAGES_SLOT, { ...target, loadImage })
                : undefined,
          },
        }),
        [renderSlot, cwd, openView, openFile, forkAt, fileMentions, loadImage],
      )
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
    function FlowBody(props) {
      const { sessionId, useChat, useSession, useProjection, t, loadOlder, loadThrough } = props
      const rootRef = useRef(null)
      const snapshot = useChat(identitySelector)
      const flow = useMemo(() => deriveFlow(snapshot), [snapshot])
      const labels = useMemo(() => markdownLabels(t), [t])
      const session = useSession(identitySelector)
      const seat = useNativeSeat(props, sessionId)

      const running = session?.running === true
      const turns = useMemo(() => flow.turns.map((group) => group.turn), [flow])
      /** 正在跑的回合：它的默认展开态与导轨上的呼吸刻度都用它。 */
      const liveTurn = running && turns.length > 0 ? turns[turns.length - 1] : null
      /**
       * 窗口头部的 seq 代理值（核心同款）：取第一条可见节点的 `anchorSeq`。
       * 这不是真正的窗口起点 seq（`Session.baseSeq` 是私有的、不进快照），
       * 所以它只用来判断「目标 seq 是否可能已被窗口覆盖」，落位时还有兜底分支。
       */
      const firstSeq =
        snapshot.order.length === 0 ? null : (snapshot.nodes.get(snapshot.order[0])?.anchorSeq ?? null)

      /**
       * 导轨刻度 = `turnOutline` 投影（全集，含未加载回合）∪ 本视图已加载的回合。
       *
       * `turnOutline` 由 `dsh-session-turn-outline` 注册（key `turnOutline`，wire 值是数组，
       * 每项 `{turn, seq, prompt, response}`；`seq` 是该轮 `turn/start` 的 seq，即翻页目标）。
       * 投影缺失时退化成「只显示已加载的回合」。
       */
      const outline = typeof useProjection === 'function' ? useProjection('turnOutline') : undefined
      const railItems = useMemo(() => mergeRailItems(outline, turns), [outline, turns])

      const { activeTurn, busyTurn, onJump } = useScroller(rootRef, {
        turns,
        hasMore: session?.hasMore,
        loadingOlder: session?.loadingOlder,
        loadOlder,
        loadThrough,
        firstSeq,
      })

      const main = []
      if (session?.hasMore === true || session?.loadingOlder === true) {
        // 加载中显示动画而不是按钮：用户不需要点，滚到顶部就会自动开始加载。
        main.push(
          session.loadingOlder === true
            ? h(
                'div',
                { key: 'loading-older', className: 'dcf-loading', 'data-dcf-load-anchor': 'true' },
                h('span', { className: 'dcf-spinner' }),
                h('span', null, t('flow.loadingOlder')),
              )
            : h(
                'button',
                {
                  key: 'load-older',
                  type: 'button',
                  className: 'dcf-hint',
                  'data-dcf-load-anchor': 'true',
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
            seat,
          }),
        )
      }

      return h(
        'div',
        { className: 'dcf-root', ref: rootRef, 'data-chat-flow-owner': 'dsh-chat-flow' },
        h(TurnRail, { items: railItems, activeTurn, liveTurn, busyTurn, onJump, t }),
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
