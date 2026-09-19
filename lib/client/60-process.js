    /* ──────────────────────────── 「思考中 / 思考完成」块 ──────────────────────────── */

    /**
     * 把统计分段拼成一行本地化文本。
     *
     * 文案组装放在**渲染层**而不是派生层：派生层只认类别键，中文/英文由 `t` 决定。
     * **计数为 0 的类别完全不显示**（用户明确要求）；5 类全为 0 时退化成「无操作」。
     *
     * @param stats - {@link statsOfNodes} 的结果。
     * @param t - locale 座位。
     * @returns 折叠态那一行统计文本。
     */
    function describeStats(stats, t) {
      const { segments, listed } = statsSummary(stats)
      if (segments.length === 0) return listed > 0 ? t('flow.ops', { count: listed }) : t('flow.noOps')
      return segments.map((segment) => `${t(CATEGORY_LOCALE_KEYS[segment.category])} ${segment.count}`).join(' · ')
    }

    /**
     * 「思考中 / 思考完成」块：一段处理过程的折叠容器。
     *
     * - 标题随状态切换：还在跑 = **思考中**（带浮动光效），跑完 = **思考完成**，被停掉 = **未完成**；
     * - 折叠时只显示 5 项统计（思考 / 命令 / 编辑文件 / MCP / 提问，0 值不显示）；
     * - 默认展开条件 = 这段过程所属的任务/回合正在进行；结束后自动收起；
     * - **容器是插槽的，内容是核心的**：行内每一行都走原生座位（命令卡、工具卡、思考行…），
     *   多次上下文注入合并进同一个折叠点（{@link ContextFold}）。
     *
     * @param props - `blockKey`、`nodes`、`stats`、`t`、`sessionId`、`active`、`unfinished`、`labels`、`seat`、`subagents`。
     * @returns 折叠块。
     */
    function ThinkingBlock({ blockKey, nodes, stats, t, sessionId, active, unfinished, labels, seat, subagents }) {
      const [open, toggle] = useCollapse(sessionId, blockKey, active === true)
      const rows = useMemo(() => groupProcessNodes(nodes), [nodes])
      const models = useMemo(() => rowModelsOf(nodes, subagents), [nodes, subagents])
      const body = []
      for (const row of rows) {
        if (row.kind === 'contexts') {
          body.push(
            h(ContextFold, {
              key: `ctx:${row.nodes[0].key}`,
              nodes: row.nodes,
              models,
              t,
              sessionId,
              seat,
              labels,
            }),
          )
          continue
        }
        body.push(
          h(NativeNodeRow, {
            key: row.node.key,
            node: row.node,
            row: models.get(row.node.key),
            seat,
            t,
            sessionId,
            labels,
          }),
        )
      }
      // 三种标题：进行中 / 已思考完成 / 未完成（回合结束但仍有没做完的动作 —— 例如被停止）。
      const title = active === true ? t('flow.thinking.live') : unfinished === true ? t('flow.status.unfinished') : t('flow.thinking.done')
      return h(
        'div',
        { className: 'dcf-thinking', 'data-live': active === true ? 'true' : 'false' },
        h(
          'button',
          { type: 'button', className: 'dcf-row dcf-thinkinghead', 'aria-expanded': open === true, onClick: toggle },
          h(Chevron, { open }),
          h('span', { className: 'dcf-thinkingtitle', 'data-shimmer': active === true ? 'true' : 'false' }, title),
          // 折叠点后面不加数字（用户要求）：统计本身就说明了这一段做了什么。
          h('span', { className: 'dcf-summary' }, describeStats(stats, t)),
        ),
        h(Fold, { open, className: 'dcf-body' }, body),
      )
    }

    /** 节点是否直接显示在对话流里（用户发言与助手正文）；其余都进「思考」块。 */
    function isInlineNode(node) {
      if (node?.kind === 'user' || node?.kind === 'steering') return messageTextOf(node) !== ''
      if (node?.kind === 'assistant-step') return assistantTextOf(node) !== ''
      return false
    }

    /**
     * 渲染一段节点：先是一块汇总的「思考中/思考完成」，再按顺序渲染直接显示的内容。
     *
     * 为什么把动作汇总成一块而不是按位置穿插：一段任务里绝大多数节点都是动作，
     * 穿插会让「任务 → 子对话」的层级被动作行冲散；汇总成一块后，一个任务的展开体
     * 永远是「思考中（统计）→ 行 → 助手说了什么」这个可预期的形状。
     *
     * `mode` 只渲染其中一半：`process` 给折进任务阶段的那一份，`inline` 给留在外面的正文。
     * 两半**互斥**（正文节点只走 inline，其余只走 process），因此同一个节点永远不会被渲染两次。
     *
     * @param props - `nodes`、`blockKey`、`t`、`sessionId`、`labels`、`active`、`unfinished`、`subagents`、`mode`、`seat`。
     * @returns 节点序列；没有任何可显示内容时返回 `null`。
     */
    function NodeSequence({ nodes, blockKey, t, sessionId, labels, active, unfinished, subagents, mode, seat }) {
      const seatNodes = useMemo(() => seatNodesOf(nodes), [nodes])
      const processNodes = useMemo(() => seatNodes.filter((node) => !isInlineNode(node)), [seatNodes])
      const inline = useMemo(() => seatNodes.filter(isInlineNode), [seatNodes])
      const stats = useMemo(() => statsOfNodes(nodes, subagents), [nodes, subagents])
      const models = useMemo(() => rowModelsOf(seatNodes, subagents), [seatNodes, subagents])
      if (processNodes.length === 0 && inline.length === 0) return null
      const children = []
      if (processNodes.length > 0 && mode !== 'inline') {
        children.push(
          h(ThinkingBlock, {
            key: 'thinking',
            blockKey,
            nodes: processNodes,
            stats,
            t,
            sessionId,
            active,
            unfinished,
            labels,
            seat,
            subagents,
          }),
        )
      }
      if (mode !== 'process') {
        for (const node of inline) {
          children.push(
            h(NativeNodeRow, {
              key: node.key,
              node,
              row: models.get(node.key),
              seat,
              t,
              sessionId,
              labels,
            }),
          )
        }
      }
      return h('div', { className: 'dcf-block' }, children)
    }
