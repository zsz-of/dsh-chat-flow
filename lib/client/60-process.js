    /* ──────────────────────────── 「正在处理」折叠块 ──────────────────────────── */

    /**
     * 把 {@link statsSummary} 的分段拼成一行本地化文本。
     *
     * 文案组装放在**渲染层**而不是派生层：派生层只认类别键，中文/英文由 `t` 决定，
     * 这样英文界面里不会漏出中文。5 类全为 0 时退化成操作总数（有操作）或「无操作」。
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
     * 一段节点里的动作折成的「正在处理」块。
     *
     * 折叠时**只**显示统计（验收第 8 条）：编辑文件 / 命令 / 提问 / MCP / 插件 各多少次，
     * 计数为 0 的类别省略（沿用核心过程折叠的呈现约定），5 项全为 0 时退化成「N 个操作」。
     * 展开后逐条列出（验收第 9 条）：一行一条，每条还能再展开看入参与结果。
     *
     * @param props - `blockKey`（折叠状态键）、`entries`（明细）、`stats`、`t`、`sessionId`。
     * @returns 折叠块。
     */
    function ProcessingBlock({ blockKey, entries, stats, t, sessionId, active }) {
      // 默认展开条件 = 这段动作所属的任务/回合**正在进行**；完成后自动收起成一行统计
      // （用户手动点过就以用户的选择为准，见 useCollapse 的持久化语义）。
      const [open, toggle] = useCollapse(sessionId, blockKey, active === true)
      const body = []
      for (const entry of entries) {
        if (entry.kind === 'tool') {
          body.push(h(ToolEntry, { key: `t:${entry.key}`, entry, t, sessionId }))
        } else if (entry.kind === 'thinking') {
          body.push(h(ThinkingEntry, { key: `k:${entry.key}`, entry, t, sessionId }))
        } else {
          body.push(h(ProcessRowEntry, { key: `r:${entry.key}`, entry }))
        }
      }
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.processing'),
          summary: describeStats(stats, t),
          trailing: h('span', { className: 'dcf-count' }, String(entries.length)),
        },
        body,
      )
    }

    /** 节点是否直接显示在对话流里（用户发言与助手正文）；其余都进「正在处理」。 */
    function isInlineNode(node) {
      if (node?.kind === 'user' || node?.kind === 'steering') return messageTextOf(node) !== ''
      if (node?.kind === 'assistant-step') return assistantTextOf(node) !== ''
      return false
    }

    /** 一条直接显示的节点。 */
    function InlineNode({ node, labels }) {
      if (node?.kind === 'user' || node?.kind === 'steering') {
        return h(UserBubble, { text: messageTextOf(node) })
      }
      return h(AssistantText, { text: assistantTextOf(node), labels })
    }

    /**
     * 渲染一段节点：先是一块汇总的「正在处理」，再按顺序渲染直接显示的内容。
     *
     * 为什么把动作汇总成一块而不是按位置穿插：任务执行期间的绝大多数节点都是动作，
     * 穿插会让「任务 → 子对话」的层级被动作行冲散；汇总成一块后，一个任务的展开体
     * 永远是「正在处理（N 个操作）→ 助手说了什么」这个可预期的形状。
     *
     * @param props - `nodes`、`blockKey`、`t`、`sessionId`、`labels`、`active`（所属任务/回合是否正在进行）。
     * @returns 节点序列；没有任何可显示内容时返回 `null`。
     */
    function NodeSequence({ nodes, blockKey, t, sessionId, labels, active }) {
      const entries = useMemo(() => processEntries(nodes), [nodes])
      const inline = useMemo(() => nodes.filter(isInlineNode), [nodes])
      const stats = useMemo(() => statsOfNodes(nodes), [nodes])
      if (entries.length === 0 && inline.length === 0) return null
      const children = []
      if (entries.length > 0) {
        children.push(h(ProcessingBlock, { key: 'process', blockKey, entries, stats, t, sessionId, active }))
      }
      for (const node of inline) children.push(h(InlineNode, { key: node.key, node, labels }))
      return h('div', { className: 'dcf-block' }, children)
    }
