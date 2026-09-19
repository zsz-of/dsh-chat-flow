    /* ──────────────────────────── 任务主视图 ──────────────────────────── */

    /** 取整份快照的选择器：引用稳定，避免每次渲染都重新订阅。 */
    function identitySelector(value) {
      return value
    }

    /**
     * 空列表常量。
     *
     * ⚠️ 必须是**同一个引用**：选择器返回新建的 `[]` 会让 `useSyncExternalStore` 每帧都判定
     * 「快照变了」，进而在滚动/流式渲染时反复重渲染甚至自激。
     */
    const EMPTY_LIST = []

    /** `useSessions` 缺席时的替身：同一个渲染位置永远只调一次，hook 顺序不变。 */
    function noSessions() {
      return undefined
    }

    /**
     * 每秒走一格的实时时钟（只在 `active` 为真时走）。
     *
     * 用途是「任务耗时实时统计」：回合还在跑时显示 `now - startedAt`，从 0 分 0 秒开始往上加；
     * 回合结束后渲染层改用派生层算好的固定耗时，这个定时器随之停掉（effect 的清理函数）。
     *
     * @param active - 是否需要计时。
     * @returns 当前时间戳（毫秒）。
     */
    function useTick(active) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (active !== true) return undefined
        setNow(Date.now())
        if (typeof setInterval !== 'function') return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
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

      /**
       * 还没进入对话的用户消息（DSH 的「插队发送」/ 排队）。
       *
       * 选择器返回的必须是**稳定引用**（`state.queue` 本身或共享的空数组），否则 uSES 会自激。
       */
      const inbox = useSession((state) => (Array.isArray(state?.queue) ? state.queue : EMPTY_LIST))
      const submissions = useSession((state) =>
        Array.isArray(state?.pendingSubmissions) ? state.pendingSubmissions : EMPTY_LIST,
      )
      const pendingSeats = useMemo(() => pendingSeatsOf(inbox, submissions, snapshot), [inbox, submissions, snapshot])

      const running = session?.running === true
      /** 实时时钟：只有在跑的时候才每秒走一格（结束的回合用派生层算好的固定耗时）。 */
      const now = useTick(running)
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
            now,
          }),
        )
      }
      // 还没进入对话的用户消息（插队 / 排队）：它们在节点树里还不存在，必须由视图自己显示，
      // 否则「我明明发了消息」在任务视图里看不到任何反应（核心在对话流末尾渲染同样这两串）。
      for (const pending of pendingSeats) {
        main.push(h(PendingBubble, { key: `pending:${pending.key}`, seat: pending, t }))
      }

      return h(
        'div',
        { className: 'dcf-root', ref: rootRef, 'data-chat-flow-owner': 'dsh-chat-flow' },
        h(TurnRail, { items: railItems, activeTurn, liveTurn, busyTurn, onJump, t }),
        h('div', { className: 'dcf-main' }, main),
      )
    }

    /**
     * 还没进入对话的那条用户消息（插队 / 排队 / 本地回显）。
     *
     * 三种状态各有一句话说明，这是用户要求「处理好插队发送消息的状态」的落点：
     * 消息不会再「发出去就没影了」——它在列表末尾有一个座位，并被明确标成「插队待处理」或「排队中」。
     *
     * `data-pending-steering` 是核心约定（它的待发送座位带这个属性，`CHAT:1224-1237`），
     * 外部的回退插件也按它找待发送座位（`dsh-rewind-plugin/lib/client.js:1114`）。
     *
     * @param props - `seat`（`{kind, key, text}`）、`t`。
     * @returns 待发送气泡行。
     */
    function PendingBubble({ seat, t }) {
      const steering = seat.kind === 'steering'
      return h(
        'div',
        {
          className: 'dcf-leaf dcf-pending',
          'data-pending-steering': steering === true ? 'true' : undefined,
          'data-submission-echo': steering === true ? undefined : 'true',
        },
        h(UserBubble, { text: seat.text, t }),
        h(
          'div',
          { className: 'dcf-pendingstate' },
          h(StatusChip, {
            tone: steering === true ? 'live' : 'muted',
            text: t(steering === true ? 'flow.pending.steering' : 'flow.pending.queued'),
          }),
        ),
      )
    }

    /**
     * 视图层错误边界：本插件自己这一侧的渲染错误**不再让整块视图让位**。
     *
     * 为什么必须有：本条目崩溃会被插槽判定为「让位」（`RENDERER:519-533` 的 abdicate），
     * 结果是整块对话区变成 `data-slot-error` 一直到刷新——用户看到的就是「任务视图莫名变白」。
     * 有了这一层，出错时只把错误摘要画出来（并留 `console.warn` 线索），视图其余部分与标签栏都还在。
     *
     * 注意：它接不住**事件回调与副作用里**抛出的错误（React 边界的固有限制），
     * 所以派生层与渲染层的取值一律写成防御式的。
     */
    class ViewBodyBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, message: '' }
      }

      static getDerivedStateFromError(error) {
        return { failed: true, message: error instanceof Error ? error.message : String(error) }
      }

      componentDidCatch(error) {
        console.warn('[chat-flow] 任务视图渲染失败，已降级为错误摘要（不再让整块视图让位）：', error)
      }

      render() {
        if (this.state.failed !== true) return this.props.children
        const t = typeof this.props.t === 'function' ? this.props.t : (key) => key
        return h(
          'div',
          { className: 'dcf-error', 'data-dcf-error': this.state.message },
          h('div', { className: 'dcf-errortitle' }, t('flow.error.title')),
          h('pre', { className: 'dcf-pre' }, this.state.message),
          h('div', { className: 'dcf-note' }, t('flow.error.hint')),
        )
      }
    }

    /**
     * 任务视图：`conversation.view` 的条目组件。
     *
     * 这一层只做两件事：能力探测（`useChat` 是 ui-chat 提供的，缺了就给空态而不是抛异常）
     * 与**错误边界**（自己的渲染错误降级成错误摘要，别让整块视图让位）。
     *
     * @param props - 插槽 kit + owner props。
     * @returns 任务视图。
     */
    function TaskFlowView(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const ready = typeof props.useChat === 'function' && typeof props.useSession === 'function'
      if (!ready) return h('div', { className: 'dcf-empty' }, t('flow.empty'))
      return h(ViewBodyBoundary, { t }, h(FlowBody, { ...props, t }))
    }
