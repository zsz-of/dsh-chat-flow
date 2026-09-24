    /* ──────────────────────────── 滚动行为 ──────────────────────────── */

    /** 距顶部多少像素以内算「触顶」。留一点余量，滚轮惯性到不了 0 也能触发。 */
    const TOP_LOAD_THRESHOLD_PX = 64

    /**
     * 距底部多少像素以内算「还在底部」。
     *
     * 超过它才需要「快速回到底部」按钮：几百像素的余量让「差一点点到底」不弹按钮，
     * 免得正常阅读时按钮一直闪。
     */
    const BOTTOM_THRESHOLD_PX = 300

    /**
     * 视口离开底部了吗（够不够格显示「快速回到底部」按钮）。
     *
     * 单独成函数是为了能直接测：按钮本身的显隐要靠真实的 scroll 事件，
     * 而滚动事件在 node 侧没有 DOM 就没有，判据却可以逐条断言。
     *
     * @param scroller - 滚动宿主（只看 `scrollTop` / `scrollHeight` / `clientHeight`）。
     */
    function isAwayFromBottom(scroller) {
      if (scroller === null || scroller === undefined) return false
      return scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - BOTTOM_THRESHOLD_PX
    }

    /**
     * 平滑滚到最底部。
     *
     * 「快速回到底部」按钮与「任务结束后自动跟到底」共用这一处：
     * 两处各写一遍 `scrollTo` 的话，改行为（比如换成 `auto`）必然会漏掉一处。
     *
     * @param scroller - 滚动宿主；为 `null` 时什么都不做（滚动宿主还没绑上去）。
     */
    function scrollViewToBottom(scroller) {
      if (scroller === null || scroller === undefined) return
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    }

    /** 行相对滚动宿主的位置：与页面整体滚动无关（核心 `flowTop` 同义，`CHAT:1895-1897`）。 */
    function flowTopOf(row, scroller) {
      return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    }

    /** 按节点 key 找已渲染的行（核心 `anchorElement` 同义，`CHAT:1867-1870`）。 */
    function anchorRowOf(root, key) {
      if (key === null || key === '') return null
      for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
        if (row.getAttribute('data-chat-anchor-key') === key) return row
      }
      return null
    }

    /**
     * 选一个稳定的锚点行：**视口顶部往下第一个可见节点行**（找不到就退化成第一行）。
     *
     * 为什么锚在「节点行」而不是「回合块」：加载历史时回合块会被整段重排，而节点行带
     * `data-chat-anchor-key`（核心同款属性），前插之后仍然唯一存在，才能把阅读位置钉回去。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @returns `{key, top}`，或没有任何节点行时 `null`。
     */
    function visibleAnchorOf(root, scroller) {
      const hostTop = scroller.getBoundingClientRect().top
      let first = null
      for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
        const key = row.getAttribute('data-chat-anchor-key')
        if (key === null || key === '') continue
        const top = flowTopOf(row, scroller)
        if (first === null) first = { key, top }
        if (row.getBoundingClientRect().top - hostTop >= 0) return { key, top }
      }
      return first
    }

    /**
     * 绑定真实的滚动宿主，负责两件事：**触顶自动加载更早的历史**、**跟踪当前回合**。
     *
     * 几个必须说明的取舍：
     * 1. **滚动宿主是 shell 的，不是本视图的**。核心把会话体包在 `[data-conversation-scroll]`
     *    里（`ui-conversation` 的 scrollBody），所以这里用 `closest()` 向上找它，
     *    而不是自己再套一个滚动容器——套两层会出现嵌套滚动条。
     * 2. **防重复触发用「先离开顶部」的闸门**（`armedRef`），而不是时间冷却。
     *    加载后修正滚动位置本身会引起一次 scroll 事件，没有闸门就会自己触发自己，
     *    一路把所有历史拉完。闸门语义：只有「曾经滚到阈值以下、又回到顶部」才算一次新的触顶。
     * 3. **位置锚定**：加载更早的内容会把旧内容往下推。这里记住第一个回合元素的视口位置，
     *    内容变长后把差值补回 `scrollTop`，读者眼睛停在原处。
     *    如果浏览器原生 scroll anchoring 已经处理了，差值≈0，这一步就是空操作——两者不冲突。
     * 4. 度量放在 rAF 里做（一次滚动只量一帧），因为读 `getBoundingClientRect` 会强制布局。
     *
     * @param rootRef - 本视图根节点的 ref（滚动宿主由它向上找）。
     * @param options - `turns`（回合号数组）、`hasMore`、`loadingOlder`、`loadOlder`、`firstSeq`。
     * @returns `{activeTurn, busyTurn, onJump}`：当前视口顶部所在回合、正在加载的刻度、刻度点击。
     */
    function useScroller(rootRef, options) {
      const {
        turns = [],
        hasMore,
        loadingOlder,
        loadOlder,
        loadThrough,
        firstSeq,
        /**
         * 初始激活的回合号（由外层指定，如「rail 默认滚到底部」）。
         * 有值时：初始 `activeTurn` 直接用它；首次 measure 跳过（避免把顶部回合误设为激活）。
         */
        initialActiveTurn = null,
      } = options
      const [activeTurn, setActiveTurn] = useState(initialActiveTurn)
      const [busyTurn, setBusyTurn] = useState(null)
      const [pendingJump, setPendingJump] = useState(null)
      const [settleTick, setSettleTick] = useState(0)
      /** 已用过 initialActiveTurn → 后续全走 measure。 */
      const usedInitialRef = useRef(initialActiveTurn !== null)
      /** 每次渲染刷新一次的最新值快照：事件监听只装一次，但要读到最新状态。 */
      const latest = useRef(options)
      latest.current = options
      const scrollerRef = useRef(null)
      const armedRef = useRef(true)
      const anchorRef = useRef(null)
      /** 上一个窗口头 seq：只有它变小（真的前插了）才做锚定补偿（核心同款，`CHAT:2227`）。 */
      const firstSeqRef = useRef(null)
      /** 防死循环：同一个窗口头只允许再翻一次（核心的 `jumpRepageHeadRef` 同款）。 */
      const repagedRef = useRef(null)
      /** 上一个 `loadingOlder`：用来在它落回 false 时补一次落位尝试。 */
      const wasPagingRef = useRef(options.loadingOlder === true)

      useEffect(() => {
        const root = rootRef.current
        if (root === null || root === undefined || typeof root.closest !== 'function') return undefined
        const scroller = root.closest('[data-conversation-scroll]') ?? root.parentElement ?? root
        scrollerRef.current = scroller
        let frame = 0

        const measure = () => {
          frame = 0
          const anchors = root.querySelectorAll('[data-turn-anchor]')
          if (anchors.length === 0) return
          const hostTop = scroller.getBoundingClientRect().top
          let current = Number(anchors[0].getAttribute('data-turn-anchor'))
          for (const anchor of anchors) {
            if (anchor.getBoundingClientRect().top - hostTop > TOP_LOAD_THRESHOLD_PX) break
            current = Number(anchor.getAttribute('data-turn-anchor'))
          }
          setActiveTurn((previous) => (previous === current ? previous : current))
        }

        const onScroll = () => {
          if (frame === 0 && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(measure)
          else measure()

          const state = latest.current
          // 闸门用「加载锚点（按钮或加载提示）还在不在视口里」判定：
          // 锚点滚出视口（用户在读下面的内容）→ 重新武装；锚点回到视口（用户滚到最上面）
          // → 触发一次加载。这比裸的 scrollTop 阈值更贴近用户看到的东西。
          const anchor = root.querySelector('[data-dcf-load-anchor]')
          const scrollerTop = scroller.getBoundingClientRect().top
          const visible = anchor === null ? scroller.scrollTop <= TOP_LOAD_THRESHOLD_PX : anchor.getBoundingClientRect().bottom >= scrollerTop
          if (visible !== true) {
            armedRef.current = true
            return
          }
          if (armedRef.current !== true) return
          if (state.hasMore !== true || state.loadingOlder === true) return
          if (typeof state.loadOlder !== 'function') return
          armedRef.current = false
          // 记下**前插之前**的阅读锚点（节点行 + 它在滚动口里的位置），前插落地后按它补偿。
          anchorRef.current = visibleAnchorOf(root, scroller)
          state.loadOlder()
        }

        // 有 initialActiveTurn 时首次不 measure：外层已经把激活回合定死在最后一个（导轨默认滚到底），
        // 这里再量一次会把**顶部的**回合误设成激活。之后再绑定时正常 measure。
        if (usedInitialRef.current === true) measure()
        else usedInitialRef.current = true
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
          scroller.removeEventListener('scroll', onScroll)
          scrollerRef.current = null
          if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        }
      }, [rootRef])

      /**
       * 前插之后把阅读位置钉回原处（见上文第 3 点）。
       *
       * **触发条件是「窗口头真的往前挪了」**（`firstSeq` 变小），而不是「渲染了一次」：
       * 这正是核心的做法（`CHAT:2227-2231`：`anchorRef !== null && firstSeq < firstSeqRef.current`）。
       * 早期版本一渲染就把锚点消费掉，于是「加载开始」那一刻就把锚点清了，
       * 等内容真正前插进来时已经没有锚点可用——用户看到的就是**加载完页面跳一下**。
       *
       * 一页加载可能包含多页（`loadThrough` 会循环），所以补偿之后如果还在加载中，
       * 就按当前位置重新记一次锚点，让下一批前插继续钉住同一个节点。
       */
      useEffect(() => {
        const firstSeq = options.firstSeq
        const previous = firstSeqRef.current
        const anchor = anchorRef.current
        if (anchor !== null && firstSeq !== null && previous !== null && firstSeq < previous) {
          const root = rootRef.current
          const scroller = scrollerRef.current
          if (root !== null && root !== undefined && scroller !== null) {
            const row = anchorRowOf(root, anchor.key)
            if (row !== null) {
              const delta = flowTopOf(row, scroller) - anchor.top
              if (delta !== 0) scroller.scrollTop += delta
              anchorRef.current =
                options.loadingOlder === true ? { key: anchor.key, top: flowTopOf(row, scroller) } : null
            } else {
              anchorRef.current = null
            }
          }
        }
        firstSeqRef.current = firstSeq
      }, [rootRef, options.firstSeq, options.loadingOlder])

      /**
       * 分页期间**把页面钉住**（用户要求「加载过程中不要发生跳变，可以不允许滚动操作」）。
       *
       * 做法是每帧把锚点行拉回它被记录时的视口位置：内容前插造成的位移被立刻补掉，
       * 用户在这几帧里的滚动输入也会被同一帧纠回，于是页面在加载期间看起来是**冻住**的；
       * `loadingOlder` 落回 false 时 effect 清理，一切交还用户。
       *
       * 为什么不用 `overflow: hidden` 去锁滚动条：那是 shell 的滚动容器，隐藏溢出会让经典滚动条
       * 消失、内容宽度变化十几个像素，反而制造一次横向跳动；逐帧钉住没有任何布局副作用。
       */
      useEffect(() => {
        if (options.loadingOlder !== true) return undefined
        if (typeof requestAnimationFrame !== 'function') return undefined
        let frame = 0
        const pin = () => {
          frame = requestAnimationFrame(pin)
          const root = rootRef.current
          const scroller = scrollerRef.current
          const anchor = anchorRef.current
          if (root === null || root === undefined || scroller === null || anchor === null) return
          const row = anchorRowOf(root, anchor.key)
          if (row === null) return
          const delta = flowTopOf(row, scroller) - anchor.top
          if (delta !== 0) scroller.scrollTop += delta
        }
        frame = requestAnimationFrame(pin)
        return () => cancelAnimationFrame(frame)
      }, [rootRef, options.loadingOlder])

      /**
       * 点一个刻度。
       *
       * 已加载 → 直接滚过去；未加载 → 记下目标（`pendingJump`）并把刻度置为加载态，
       * 然后 `loadThrough(seq)` 翻页。**完成判定不靠 promise**（它永不 reject，失败也 resolve），
       * 而靠「目标回合变成了已加载」这个渲染事实（见下面的落位 effect）。
       */
      const onJump = useCallback(
        (item) => {
          if (item === null || typeof item !== 'object') return
          if (item.loaded === true) {
            jumpToTurn(rootRef.current, item.turn)
            return
          }
          const loadThrough = latest.current.loadThrough
          if (typeof loadThrough !== 'function' || item.seq === null) return
          const root = rootRef.current
          const scroller = scrollerRef.current
          if (root !== null && root !== undefined && scroller !== null) {
            anchorRef.current = visibleAnchorOf(root, scroller)
          }
          repagedRef.current = null
          setBusyTurn(item.turn)
          setPendingJump({ turn: item.turn, seq: item.seq })
          Promise.resolve(loadThrough(item.seq)).then(() => setSettleTick((tick) => tick + 1))
        },
        [rootRef],
      )

      // `loadThrough` 在 `loadingOlder` 已被普通加载占用时会**立即 resolve 而不排队**，
      // 所以必须在它落回 false 时再补一次落位尝试（核心用同样的 tick 机制）。
      useEffect(() => {
        const paging = options.loadingOlder === true
        if (wasPagingRef.current === true && paging === false && pendingJump !== null) {
          setSettleTick((tick) => tick + 1)
        }
        wasPagingRef.current = paging
      }, [options.loadingOlder, pendingJump])

      /**
       * 落位：目标回合一渲染出来就滚到它。
       *
       * 三层兜底（顺序与核心一致）：① 目标回合已是已加载且能找到锚点 → 落位收尾；
       * ② 窗口还没覆盖目标 seq（`firstSeq > seq`）→ 允许**再翻一次**（同一个窗口头只翻一次，防死循环）；
       * ③ 都失败时退化成「滚到第一个 turn ≥ 目标的回合」。
       */
      useEffect(() => {
        if (pendingJump === null) return
        const root = rootRef.current
        const scroller = scrollerRef.current
        if (root === null || root === undefined || scroller === null) return
        const land = (row) => {
          const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - RAIL_LAND_OFFSET_PX
          if (delta !== 0) scroller.scrollTop += delta
        }
        const settle = () => {
          setPendingJump(null)
          setBusyTurn(null)
        }
        const row = root.querySelector(`[data-turn-anchor="${pendingJump.turn}"]`)
        if (row !== null) {
          land(row)
          settle()
          return
        }
        const state = latest.current
        const firstSeq = state.firstSeq
        if (state.hasMore === true && (firstSeq === null || firstSeq === undefined || firstSeq > pendingJump.seq)) {
          if (state.loadingOlder === true) return
          if (repagedRef.current !== firstSeq) {
            repagedRef.current = firstSeq
            const loadThrough = state.loadThrough
            if (typeof loadThrough === 'function') {
              Promise.resolve(loadThrough(pendingJump.seq)).then(() => setSettleTick((tick) => tick + 1))
              return
            }
          }
        }
        const rows = root.querySelectorAll('[data-turn-anchor]')
        for (const candidate of rows) {
          const turn = Number(candidate.getAttribute('data-turn-anchor'))
          if (Number.isSafeInteger(turn) && turn >= pendingJump.turn) {
            land(candidate)
            break
          }
        }
        settle()
      }, [settleTick, pendingJump, rootRef])

      return { activeTurn, busyTurn, onJump }
    }
