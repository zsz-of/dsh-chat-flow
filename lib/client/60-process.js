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
     * @param props - `blockKey`、`nodes`、`models`、`stats`、`t`、`sessionId`、`active`、`cutOff`、`unfinished`、`labels`、`seat`。
     * @returns 折叠块。
     */
    function ThinkingBlock({ blockKey, nodes, models, stats, t, sessionId, active, cutOff, unfinished, labels, seat }) {
      // **默认永远收起**（用户要求「思考中的节点默认折叠」+「下一个节点不展开」）：
      // 折叠头一行给出状态（思考中 / 思考已完成 / 思考未完成）与统计，需要看过程时点开。
      const [open, toggle] = useCollapse(sessionId, blockKey, false)
      const rows = useMemo(() => groupProcessNodes(nodes), [nodes])
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
      // 四种标题：正在写 / 被中断（半截）/ 未完成（回合结束但还有没做完的动作）/ 已思考完成。
      const title =
        active === true
          ? t('flow.thinking.live')
          : cutOff === true
            ? t('flow.thinking.cutOff')
            : unfinished === true
              ? t('flow.status.unfinished')
              : t('flow.thinking.done')
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

    /**
     * 渲染一段节点：按「过程 run / 正文 run」交替排列。
     *
     * **为什么按 run 切**（用户当轮要求）：一段过程里一旦出现对用户可见的正文，
     * 前面的思考块就**封口**（结束），后面的动作属于**下一个**思考块——
     * 于是「思考中」不再是一整段任务的巨大容器，而是「一次思考 → 一段输出 → 再思考」的节奏。
     *
     * `mode` 只渲染其中一半：`process` 只渲染过程块（折进任务阶段的那些），
     * `inline` 只渲染正文行（留在折叠体外的那份）。两份互斥，同一节点不会被渲染两次。
     *
     * **收尾节点（`turn-tail`）在这里被剔除**：它的位置由回合层固定在「总结之后」单独渲染
     * （见 `isFooterNode`），任何折叠体都不该把它卷进去——否则复制/点赞/点踩/分支按钮会
     * 跑到「任务过程」里面去（用户报告过）。
     *
     * @param props - `nodes`、`blockKey`、`t`、`sessionId`、`labels`、`active`、`unfinished`、`liveKey`、`subagents`、`mode`、`seat`。
     * @returns 节点序列；没有任何可显示内容时返回 `null`。
     */
    function NodeSequence({ nodes, blockKey, t, sessionId, labels, active, unfinished, liveKey, subagents, mode, seat }) {
      const seatNodes = useMemo(() => seatNodesOf(nodes).filter((node) => !isFooterNode(node)), [nodes])
      const runs = useMemo(() => nodeRunsOf(seatNodes), [seatNodes])
      // 回退模型只在这里算一次：正文行与过程块共用这份 Map，避免重复解析工具块。
      const models = useMemo(() => rowModelsOf(seatNodes, subagents), [seatNodes, subagents])
      const children = []
      for (const run of runs) {
        if (run.kind === 'process') {
          if (mode === 'inline') continue
          const first = run.nodes[0]
          /**
           * 这一块**正在写**吗？判据是「回合在跑 **且** 本块包含回合的最后一个可渲染节点」。
           * 只判回合会让同一回合里早已写完的块一直显示「思考中」（用户报告过）；
           * 只判节点又会让回合结束后的最后一块永远停在「思考中」。
           */
          const blockActive =
            active === true &&
            liveKey !== null &&
            liveKey !== undefined &&
            run.nodes.some((node) => node.key === liveKey)
          children.push(
            h(ThinkingBlock, {
              // 每个 run 一块：key 与折叠状态键都用该 run 的第一个节点（稳定且唯一）。
              key: `run:${first.key}`,
              blockKey: `${blockKey}:${first.key}`,
              nodes: run.nodes,
              models,
              stats: statsOfNodes(run.nodes, subagents),
              t,
              sessionId,
              active: blockActive,
              cutOff: cutOffOf(run.nodes),
              unfinished,
              labels,
              seat,
            }),
          )
          continue
        }
        if (mode === 'process') continue
        for (const node of run.nodes) {
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
      if (children.length === 0) return null
      return h('div', { className: 'dcf-block' }, children)
    }
