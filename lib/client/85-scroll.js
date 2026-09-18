    /* ──────────────────────────── 滚动行为 ──────────────────────────── */

    /** 距顶部多少像素以内算「触顶」。留一点余量，滚轮惯性到不了 0 也能触发。 */
    const TOP_LOAD_THRESHOLD_PX = 64

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
     * @param options - `turns`（回合号数组）、`hasMore`、`loadingOlder`、`loadOlder`。
     * @returns `{activeTurn}`：当前视口顶部所在回合的编号。
     */
    function useScroller(rootRef, options) {
      const [activeTurn, setActiveTurn] = useState(null)
      /** 每次渲染刷新一次的最新值快照：事件监听只装一次，但要读到最新状态。 */
      const latest = useRef(options)
      latest.current = options
      const scrollerRef = useRef(null)
      const armedRef = useRef(true)
      const anchorRef = useRef(null)

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
          if (scroller.scrollTop > TOP_LOAD_THRESHOLD_PX) {
            armedRef.current = true
            return
          }
          if (armedRef.current !== true) return
          if (state.hasMore !== true || state.loadingOlder === true) return
          if (typeof state.loadOlder !== 'function') return
          armedRef.current = false
          const first = root.querySelector('[data-turn-anchor]')
          anchorRef.current = first === null ? null : {
            turn: first.getAttribute('data-turn-anchor'),
            top: first.getBoundingClientRect().top,
          }
          state.loadOlder()
        }

        measure()
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
          scroller.removeEventListener('scroll', onScroll)
          scrollerRef.current = null
          if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        }
      }, [rootRef])

      // 内容变长后把阅读位置钉回原处（见上文第 3 点）。
      useEffect(() => {
        const anchor = anchorRef.current
        if (anchor === null) return
        anchorRef.current = null
        const root = rootRef.current
        const scroller = scrollerRef.current
        if (root === null || root === undefined || scroller === null) return
        const target = root.querySelector(`[data-turn-anchor="${anchor.turn}"]`)
        if (target === null) return
        const delta = target.getBoundingClientRect().top - anchor.top
        if (delta !== 0) scroller.scrollTop += delta
      }, [rootRef, options.turns])

      return { activeTurn }
    }
