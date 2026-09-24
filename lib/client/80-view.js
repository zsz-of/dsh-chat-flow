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

    /** `useSessions` 缺席时的替身：同一个渲染位置永远只调一次、返回 undefined，hook 顺序不变。 */
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
     * ⚠️ **必须只滚会话体（`[data-conversation-scroll]`），绝不能用 `scrollIntoView`**
     * （用户报告过：点最后一个刻度会让整个界面连输入框一起上移半屏）。
     *
     * 原因是 shell 的结构与 CSS（`core-seams.md §7.1`）：
     * - 真正的滚动宿主是 `div.scrollBody[data-conversation-scroll]`，它里面**既有视图区也有输入框座位**
     *   （`composerSeat`），输入框靠 `position: sticky; bottom: 0` 钉在容器底部；
     * - `scrollIntoView` 会滚动**所有**可滚动祖先——包括 `overflow: hidden` 的盒子（脚本仍可滚它），
     *   而 shell 在 composer 浮层态正是把 `.viewArea` 设成 `overflow: hidden`。
     *   于是浏览器把外层盒子一起滚了，`sticky` 的参照系随之改变，界面连同输入框整体上移。
     *
     * 核心自己也是这么做的：`landOnRow` 直接算 `el.scrollTop += flowTop(row, el) - 24`（`CHAT:2154-2165`）。
     * 系统开了「减少动态效果」时用瞬时跳转，与 CSS 里的动效收敛保持一致。
     *
     * @param root - 本视图根节点。
     * @param turn - 目标回合号。
     * @returns 无。
     */
    function jumpToTurn(root, turn) {
      if (root === null || root === undefined || typeof root.querySelector !== 'function') return
      const target = root.querySelector(`[data-turn-anchor="${turn}"]`)
      if (target === null || typeof target.getBoundingClientRect !== 'function') return
      const scroller = scrollerOfView(root)
      if (scroller === null || typeof scroller.scrollTop !== 'number') return
      const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - RAIL_LAND_OFFSET_PX
      if (delta === 0) return
      const reduced =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      const top = Math.max(0, scroller.scrollTop + delta)
      // `scrollTo` 支持平滑滚动，而且作用域就是这个元素——不会再牵扯外层盒子。
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
        return
      }
      scroller.scrollTop = top
    }

    /**
     * 本视图所在的**会话滚动宿主**：`[data-conversation-scroll]`（shell 的 scrollBody）。
     *
     * 取不到时退化成父元素/自身：这样在测试与非常规装配下也拿得到一个可滚的盒子，
     * 而不是把动作交给 `scrollIntoView` 去滚整个文档。
     *
     * @param root - 本视图根节点。
     * @returns 滚动宿主，或 `null`。
     */
    function scrollerOfView(root) {
      if (root === null || root === undefined) return null
      const found = typeof root.closest === 'function' ? root.closest('[data-conversation-scroll]') : null
      return found ?? root.parentElement ?? root
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
      /**
       * 已加载的回合号（去重）。
       *
       * 同一个回合里可能因为**插队消息**而有多个分组（见 `deriveFlow`），导轨只需要一个刻度，
       * 所以这里去重；`liveTurn` 仍然按「最后一个分组」判定，但要用分组的 key 比较
       * （同一个回合里的前几个分组已经结束了，不该跟着一起算「正在跑」）。
       */
      const turns = useMemo(() => [...new Set(flow.turns.map((group) => group.turn))], [flow])
      const liveTurn = running && turns.length > 0 ? turns[turns.length - 1] : null
      const liveGroupKey = running && flow.turns.length > 0 ? flow.turns[flow.turns.length - 1].key : null
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
        // 首次挂载时让 rail 默认激活最后一个回合——视觉上「最末位始终是最新轮次」，
        // 与 rail 上 `data-active` 高亮配合，让用户一眼看到当前在最新回合。
        initialActiveTurn: turns.length > 0 ? turns[turns.length - 1] : null,
      })

      /**
       * 滚动行为：任务进行中切换 → 保持切出时的位置；任务结束后的首次切换 → 翻到最后。
       *
       * 规则：
       * - 任务还在跑：无论何时切换进来，都恢复切出时的滚动位置；
       * - 任务在用户离开期间结束（`running` 从 true 变 false，同时视图处于隐藏态）：
       *   首次切换回来时翻到最后（看到最新输出），之后恢复切出时的位置；
       * - 任务在用户正看着时结束（视图可见时 `running` 变 false）：直接翻到最后，不额外标记。
       *
       * 判据用 `session?.running`（DSH 的会话运行态），不是 `flow.status`（本插件派生）。
       * `visibilitychange` 覆盖：切换标签页、最小化窗口、切换到别的 DSH 视图（对话/任务标签）。
       * `beforeunload` 覆盖：刷新、关闭页面。
       *
       * sessionStorage 按 sessionId 隔离（同一会话的多个标签页共享位置）。
       */
      const SS_SCROLL = `dsh-chat-flow.scroll.${sessionId}`
      const SS_ENDED_AWAY = `dsh-chat-flow.ended-away.${sessionId}`

      /** 记住上一个 `running` 值，用来判断「离开期间状态是否变了」。 */
      const prevRunningRef = useRef(running)

      /** 记住视图在「离开」前是否可见（不在可见态时不重复翻）。 */
      const wasVisibleRef = useRef(false)

      // 首次挂载：从 sessionStorage 恢复滚动位置（仅在任务已结束时才需要翻到底）。
      useEffect(() => {
        const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
        if (scroller === null) return
        const endedAway = sessionStorage.getItem(SS_ENDED_AWAY) === '1'
        if (endedAway) {
          // 首次进来时任务已结束（用户刷新了页面或跨标签页回来）→ 翻到底
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
          sessionStorage.removeItem(SS_ENDED_AWAY)
        }
        const saved = sessionStorage.getItem(SS_SCROLL)
        if (saved !== null) {
          const pos = Number(saved)
          if (Number.isFinite(pos)) scroller.scrollTop = pos
        }
      }, []) // eslint-disable-line react-hooks/exhaustive-deps

      // 监听：离开时记录位置，回来时决定是翻到底还是恢复位置。
      useEffect(() => {
        const handleLeave = () => {
          const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
          if (scroller !== null) sessionStorage.setItem(SS_SCROLL, String(scroller.scrollTop))
          // 如果在视图隐藏期间任务结束，下次回来要翻到底
          if (document.visibilityState !== 'visible' && running === true) {
            sessionStorage.setItem(SS_ENDED_AWAY, '1')
          }
          wasVisibleRef.current = false
        }

        const handleActivate = () => {
          const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
          const endedAway = sessionStorage.getItem(SS_ENDED_AWAY) === '1'

          if (endedAway) {
            // 任务在离开期间结束了 → 翻到底
            if (scroller !== null) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
          } else {
            // 任务还在跑（或在可见时已结束）→ 恢复切出时的位置
            const saved = sessionStorage.getItem(SS_SCROLL)
            if (saved !== null && scroller !== null) {
              const pos = Number(saved)
              if (Number.isFinite(pos)) scroller.scrollTop = pos
            }
          }
          wasVisibleRef.current = true
        }

        const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            handleActivate()
          } else {
            handleLeave()
          }
        }

        const handleBeforeUnload = () => {
          handleLeave()
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange)
          window.removeEventListener('beforeunload', handleBeforeUnload)
        }
      }, [running, sessionId])

      // `running` 从 true 变 false：在可见态下任务结束 → 直接翻到底
      useEffect(() => {
        if (prevRunningRef.current === true && running === false && wasVisibleRef.current === true) {
          const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
          if (scroller !== null) {
            scrollViewToBottom(scroller)
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
          }
        }
        prevRunningRef.current = running
      }, [running])

      /**
       * 快速回到底部按钮（`FloatingScrollButton`）。
       *
       * 逻辑：滚动宿主滚动超过 300px 时显示按钮；点击后滚动到最底部。
       * 只在任务进行中显示（结束后不需要快速回底，用户已能看到最新内容）。
       */
      const [showBottomBtn, setShowBottomBtn] = useState(false)

      /**
       * 会话列表快照：用来发现「已经被删掉的会话」。
       *
       * 核心没有会话删除事件，`useSessions` 是唯一可用的接缝（标准 props，官方 standardProps 清单里）。
       * 选择器返回整张快照而不是 `ids` 数组——返回新数组会让 uSES 自激。
       */
      const useSessionsSafe = typeof props.useSessions === 'function' ? props.useSessions : noSessions
      const sessionList = useSessionsSafe((state) => state)

      // 滚动监听：跟踪是否已远离底部（判据见 `isAwayFromBottom`）。
      useEffect(() => {
        const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
        if (scroller === null) return undefined
        const handleScroll = () => setShowBottomBtn(isAwayFromBottom(scroller))
        scroller.addEventListener('scroll', handleScroll, { passive: true })
        handleScroll()
        return () => scroller.removeEventListener('scroll', handleScroll)
      }, [running])

      /**
       * 会话被删除时，把本插件给那个会话留下的数据一起带走（localStorage 折叠状态 + sessionStorage 滚动记录）。
       *
       * 判据是「存储里有键、会话列表里没这个 id」（`staleSessionIds`），列表为空时不动手
       * （重连重拉会让列表短暂变空，那不是删除）；当前正在看的这个会话永远排除在外，
       * 因为刚建的空会话可能还没进列表。
       */
      useEffect(() => {
        const ids = sessionList?.ids
        if (!Array.isArray(ids)) return
        const alive = new Set(ids)
        alive.add(sessionId)
        for (const stale of staleSessionIds(window, alive)) purgeSessionData(stale, window)
      }, [sessionList, sessionId])

      /**
       * 快速回到底部按钮：固定在右下角，圆形箭头图标。
       * 视觉上在 rail 左侧，不遮挡内容。
       */
      const scrollToBottomButton = showBottomBtn && running === true
        ? h(
            'button',
            {
              key: 'scroll-to-bottom',
              type: 'button',
              className: 'dcf-scroll-bottom-btn',
              'aria-label': t('flow.scrollToBottom'),
              title: t('flow.scrollToBottom'),
              onClick: () => {
                const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
                scrollViewToBottom(scroller)
              },
            },
            h(
              'svg',
              {
                viewBox: '0 0 16 16',
                width: 16,
                height: 16,
                fill: 'currentColor',
                'aria-hidden': 'true',
              },
              h('path', { d: 'M8 12L2 6h3V2h6v4h3L8 12z' }),
            ),
          )
        : null

      const main = []
      if (session?.hasMore === true || session?.loadingOlder === true) {
        // 加载中显示动画而不是按钮：用户不需要点，滚到顶部就会自动开始加载。
        main.push(
          session.loadingOlder === true
            ? h(
                'div',
                { key: 'loading-older', className: 'dcf-loading', 'data-dcf-load-anchor': 'true' },
                h('span', { className: 'dcf-spinner' }),
                h('span', null, t('flow.loadingLocked')),
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
            live: group.key === liveGroupKey,
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
        scrollToBottomButton,
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
