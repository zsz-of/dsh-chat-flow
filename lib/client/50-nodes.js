    /* ──────────────────────────── 消息 ──────────────────────────── */

    /** 用户消息气泡（字面文本，不做 markdown 解析——与核心的 `MessageText` 语义一致）。 */
    function UserBubble({ text }) {
      if (typeof text !== 'string' || text.trim() === '') return null
      return h('div', { className: 'dcf-ask' }, h('div', { className: 'dcf-bubble' }, h(MessageText, { text })))
    }

    /**
     * 助手正文。
     *
     * 用核心的 `MarkdownText` 而不是自造渲染：它已经处理了不可信输出（丢弃原始 HTML、
     * 失效不安全链接、增量流式高亮），自己写会把这些安全与性能细节一并丢掉。
     */
    function AssistantText({ text, labels }) {
      if (typeof text !== 'string' || text.trim() === '') return null
      return h('div', { className: 'dcf-text' }, h(MarkdownText, { text, labels }))
    }

    /* ──────────────────────────── 基础零件 ──────────────────────────── */

    /** 每个卡片类型对应的行首图标（同一类型用同一个字形，一眼能扫出操作类型）。 */
    const CARD_ICONS = {
      command: 'IconCodeOutline16',
      file: 'IconEditOutline16',
      mcp: 'IconCordisPluginOutline14',
      question: 'IconQuestionOutline14',
      subagent: 'IconAgentPresetOutline16',
      plain: 'IconInspectOutline12',
    }

    /**
     * 取某个卡片类型的图标组件。
     *
     * @param kind - 卡片类型。
     * @returns 图标组件；primitives 里没有该字形时返回 `null`（渲染层留等宽占位）。
     */
    function iconForCard(kind) {
      const icon = primitives[CARD_ICONS[kind] ?? '']
      if (typeof icon === 'function' || (icon !== null && typeof icon === 'object' && icon !== undefined)) return icon
      const fallback = primitives.IconInspectOutline12
      return typeof fallback === 'function' ? fallback : null
    }

    /** 可折叠行左端的箭头：用 primitives 的雪佛龙 + CSS 旋转，不额外造图标。 */
    function Chevron({ open }) {
      const icon = primitives.IconChevronRightOutline14
      if (typeof icon !== 'function') return h('span', { className: 'dcf-chev' })
      return h(icon, { className: 'dcf-chev', 'data-open': open === true ? 'true' : 'false' })
    }

    /**
     * 折叠容器：子树**始终挂载**，只切换 CSS grid 轨道高度（`0fr ↔ 1fr`）并过渡。
     *
     * 三个设计点：
     * 1. **不卸载子树**——卸载会丢掉嵌套块的展开状态（例如展开的任务里那个展开的「思考中」），
     *    也会让进出动画退化成瞬间替换；核心的 `ChatNodeSeat` 同样奉行「稳定 seat、只隐藏不卸载」。
     * 2. **不量高度**——`grid-template-rows` 的过渡由浏览器插值，无需 `useLayoutEffect` +
     *    `scrollHeight`，内容流式增长时也不会抖。
     * 3. **收起时摘掉焦点**——CSS 里用 `visibility: hidden`（延迟到动画结束）把子树从 Tab 顺序里摘出去。
     *
     * @param props - `open`、`className`（内层类名，承载 padding/gap）、`children`。
     * @returns 折叠容器；没有内容时返回 `null`。
     */
    function Fold({ open, className, children }) {
      if (children === undefined || children === null) return null
      return h(
        'div',
        { className: 'dcf-fold', 'data-open': open === true ? 'true' : 'false' },
        h('div', { className: className ?? 'dcf-body' }, children),
      )
    }

    /**
     * 通用折叠行：一行标题 + 摘要 + 右侧徽标，展开体经 {@link Fold}。
     *
     * 交互与核心的工具行一致（点整行切换、`aria-expanded` 可读），因为这是同一个心智模型：
     * 先看一行摘要，需要时再展开看明细。不可展开的行走纯文本行（`div`）而不是 disabled 按钮
     * ——它是一条标签，不是一个失效控件。
     *
     * @param props - `open`、`onToggle`、`leading`、`title`、`summary`、`trailing`、`children`。
     * @returns 可折叠行。
     */
    function DisclosureLine({ open, onToggle, leading, title, summary, trailing, children, className }) {
      const interactive = typeof onToggle === 'function'
      const cells = [
        h(Chevron, { open }),
        leading ?? null,
        title === undefined || title === null ? null : h('span', { className: 'dcf-title' }, title),
        summary === undefined || summary === null || summary === ''
          ? null
          : h('span', { className: 'dcf-summary' }, summary),
        trailing ?? null,
      ]
      const row = interactive
        ? h(
            'button',
            { type: 'button', className: 'dcf-row', 'aria-expanded': open === true, onClick: onToggle },
            ...cells,
          )
        : h('div', { className: 'dcf-row', 'data-static': 'true' }, ...cells)
      return h('div', { className: className ?? 'dcf-block' }, row, h(Fold, { open }, children))
    }

    /* ──────────────────────────── 卡片 ──────────────────────────── */

    /** 状态徽标：命令/提问/子 agent 的四态都用它，颜色由 `data-tone` 决定。 */
    function StatusChip({ tone, text }) {
      if (typeof text !== 'string' || text === '') return null
      return h('span', { className: 'dcf-chip', 'data-tone': tone }, text)
    }

    /** 命令卡的状态文案（四态）。 */
    function commandStatusText(t, status) {
      if (status === 'running') return t('flow.status.running')
      if (status === 'failed') return t('flow.status.failed')
      if (status === 'cancelled') return t('flow.status.cancelled')
      return t('flow.status.done')
    }

    /** 状态 → 色调（复用同一套颜色语义，避免每张卡自己发明一套）。 */
    function toneOfStatus(status) {
      if (status === 'failed') return 'err'
      if (status === 'cancelled') return 'warn'
      if (status === 'running') return 'live'
      return 'ok'
    }

    /**
     * 卡片外壳：图标 + 标题 + 摘要 + 状态徽标，展开体在下方。
     *
     * 所有专属卡片都用它，因此「卡片长什么样、展开怎么动」只有一处实现。
     *
     * @param props - `kind`（决定图标）、`title`、`summary`、`chips`、`live`、`open`、`onToggle`、`children`。
     * @returns 卡片。
     */
    function Card({ kind, title, summary, chips, live, open, onToggle, children }) {
      const icon = iconForCard(kind)
      const leading = icon === null ? h('span', { className: 'dcf-chev' }) : h(icon, { className: 'dcf-cardicon' })
      return h(
        'div',
        { className: 'dcf-card', 'data-kind': kind, 'data-live': live === true ? 'true' : 'false' },
        h(
          'button',
          { type: 'button', className: 'dcf-cardhead', 'aria-expanded': open === true, onClick: onToggle },
          h(Chevron, { open }),
          leading,
          h('span', { className: 'dcf-cardtitle' }, title),
          summary === undefined || summary === null || summary === ''
            ? null
            : h('span', { className: 'dcf-cardsummary' }, summary),
          ...(Array.isArray(chips) ? chips : []),
        ),
        h(Fold, { open, className: 'dcf-cardbody' }, children),
      )
    }

    /** 文件编辑卡的差异徽标：红色 `−N`、绿色 `+N`。 */
    function DiffChips({ added, removed }) {
      const chips = []
      if (removed > 0) chips.push(h('span', { key: 'minus', className: 'dcf-chip', 'data-tone': 'del' }, `−${removed}`))
      if (added > 0) chips.push(h('span', { key: 'plus', className: 'dcf-chip', 'data-tone': 'add' }, `+${added}`))
      if (chips.length === 0) chips.push(h('span', { key: 'none', className: 'dcf-chip', 'data-tone': 'muted' }, '±0'))
      return chips
    }

    /** 命令卡：头部一行状态，展开后是终端卡片（命令 + 输出）。 */
    function CommandCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, card.status === 'running')
      const chips = [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: commandStatusText(t, card.status) })]
      if (card.exitCode !== undefined && card.exitCode !== 0) {
        chips.push(h(StatusChip, { key: 'exit', tone: 'err', text: t('flow.exitCode', { code: card.exitCode }) }))
      }
      if (card.signal !== undefined) {
        chips.push(h(StatusChip, { key: 'signal', tone: 'warn', text: t('flow.signal', { signal: card.signal }) }))
      }
      return h(
        Card,
        {
          kind: 'command',
          title: t('flow.category.command'),
          summary: card.commandShort,
          chips,
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(TerminalBlock, {
          command: card.command,
          output: card.output,
          running: card.status === 'running',
          exitCode: card.exitCode,
          signal: card.signal,
          maxLines: 14,
          labels: terminalLabels(t),
        }),
      )
    }

    /** 文件编辑卡：头部显示路径与 `−N/+N`，展开后是入参与结果。 */
    function FileCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      const counts = card.diff ?? { added: 0, removed: 0 }
      return h(
        Card,
        {
          kind: 'file',
          title: t('flow.category.file'),
          summary: card.fileName,
          chips: DiffChips(counts),
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h('div', { className: 'dcf-note' }, t('flow.card.diffNote')),
        h('pre', { className: 'dcf-pre' }, card.argsRaw === '' ? t('flow.noOutput') : card.argsRaw),
        card.output === '' ? null : h('pre', { className: 'dcf-pre' }, card.output),
      )
    }

    /** MCP 卡：头部只写函数名，展开才给输入与返回值。 */
    function McpCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      const title = card.server === '' ? card.mcpTool : `${card.server} · ${card.mcpTool}`
      return h(
        Card,
        {
          kind: 'mcp',
          title: t('flow.category.mcp'),
          summary: title,
          chips: [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: commandStatusText(t, card.status) })],
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(JsonBlock, { label: t('flow.card.input'), payload: card.args }),
        card.output === '' ? null : h(JsonBlock, { label: t('flow.card.result'), payload: card.output }),
      )
    }

    /** 提问卡：头部是问题本身，展开后是选项与用户回答（按问题 id 回配）。 */
    function QuestionCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, card.answered !== true)
      const first = card.prompts[0]
      const summary =
        first === undefined ? card.summary : first.header !== '' ? `${first.header}：${first.question}` : first.question
      const body = []
      for (const prompt of card.prompts) {
        const parts = [h('div', { key: 'q', className: 'dcf-questiontext' }, prompt.question)]
        for (const option of prompt.options) {
          const chosen = prompt.selected.includes(option)
          parts.push(
            h('div', { key: `o:${option}`, className: 'dcf-option', 'data-chosen': chosen ? 'true' : 'false' }, option),
          )
        }
        if (prompt.custom !== '') parts.push(h('div', { key: 'custom', className: 'dcf-option' }, prompt.custom))
        body.push(h('div', { key: prompt.id === '' ? prompt.question : prompt.id, className: 'dcf-question' }, parts))
      }
      if (card.output !== '') {
        body.push(h(JsonBlock, { key: 'answer', label: t('flow.card.answer'), payload: card.output }))
      }
      return h(
        Card,
        {
          kind: 'question',
          title: t('flow.category.question'),
          summary,
          chips: [
            h(StatusChip, {
              key: 'status',
              tone: card.status === 'cancelled' ? 'warn' : card.answered === true ? 'ok' : 'live',
              text:
                card.status === 'cancelled'
                  ? t('flow.status.cancelled')
                  : card.answered === true
                    ? t('flow.status.done')
                    : t('flow.card.waiting'),
            }),
          ],
          live: card.answered !== true && card.status !== 'cancelled',
          open,
          onToggle: toggle,
        },
        body,
      )
    }

    /**
     * 子 agent 卡：**输出默认展开**，子 agent 结束后**自动折叠**这个节点。
     *
     * 与「思考中」同一层（都是任务下的处理过程），因此层级是
     * 任务处理流 > 子任务 > 小处理过程 = 子 agent 操作（用户当轮要求的分级）。
     * 展开体是子 agent 交回的报告文本；父会话的节点树里没有子会话的内部步骤
     * （子会话是独立会话），所以内部操作不在这里重复展开。
     */
    function SubagentCard({ card, t, sessionId, keyPrefix }) {
      const report = card.report
      // 默认展开的时机不是「收到 tool/result」而是「收到结算通知」：后台派发时结果只是一行
      // `started subagent <id>`，子 agent 那时还在跑（见 core-seams.md §8.7）。
      const live = report === undefined && card.status !== 'failed' && card.status !== 'cancelled'
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, live)
      const statusText2 = card.status === 'started' ? t('flow.status.started') : commandStatusText(t, card.status)
      const body = []
      if (card.prompt !== '') body.push(h('pre', { key: 'prompt', className: 'dcf-pre' }, card.prompt))
      if (report === undefined) {
        body.push(h('div', { key: 'await', className: 'dcf-note' }, t('flow.card.awaitReport')))
      } else {
        if (report.summary !== '') body.push(h('div', { key: 'summary', className: 'dcf-note' }, report.summary))
        if (report.text !== '') {
          body.push(h('div', { key: 'report', className: 'dcf-text' }, h(MarkdownText, { text: report.text, labels: card.markdownLabels })))
        }
      }
      return h(
        Card,
        {
          kind: 'subagent',
          title: t('flow.card.subagent'),
          summary: card.summary === '' ? card.prompt.split('\n', 1)[0] : card.summary,
          chips: [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: statusText2 })],
          live,
          open,
          onToggle: toggle,
        },
        body,
      )
    }

    /** 兜底卡：没有专属卡片的工具（只读内置、未知插件工具）——一行标题 + 摘要，展开是入参与结果。 */
    function PlainCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      return h(
        Card,
        {
          kind: 'plain',
          title: card.name,
          summary: card.summary,
          chips: card.status === 'failed'
            ? [h(StatusChip, { key: 'status', tone: 'err', text: t('flow.status.failed') })]
            : [],
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(JsonBlock, { label: t('flow.card.input'), payload: card.args }),
        card.output === '' ? null : h(JsonBlock, { label: t('flow.card.output'), payload: card.output }),
      )
    }

    /** 按卡片类型分派。所有展开态用同一个 `keyPrefix` 作为持久化键前缀（= 节点 key）。 */
    function ToolCard({ card, t, sessionId, labels, keyPrefix }) {
      const shared = { card: { ...card, markdownLabels: labels }, t, sessionId, keyPrefix }
      if (card.kind === 'command') return h(CommandCard, shared)
      if (card.kind === 'file') return h(FileCard, shared)
      if (card.kind === 'mcp') return h(McpCard, shared)
      if (card.kind === 'question') return h(QuestionCard, shared)
      if (card.kind === 'subagent') return h(SubagentCard, shared)
      return h(PlainCard, shared)
    }

    /** 「思考」行：默认折叠，展开后是原始推理文本。 */
    function ThinkingEntry({ entry, t, sessionId }) {
      const [open, toggle] = useCollapse(sessionId, `think:${entry.key}`, false)
      const lines = entry.text.split('\n').length
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.category.thinking'),
          trailing: h('span', { className: 'dcf-badge' }, String(lines)),
        },
        h('pre', { className: 'dcf-pre' }, entry.text),
      )
    }

    /** 「思考」块里的一行非工具过程（斜杠命令、上下文压缩、重试…）：只显示标题。 */
    function ProcessRowEntry({ entry, t }) {
      return h(DisclosureLine, {
        open: false,
        leading: h('span', { className: 'dcf-chev' }),
        title: t(entry.titleKey),
      })
    }

    /**
     * 「上下文注入」折叠点：把这一段的多次注入**合并**在一个折叠点里（用户要求）。
     *
     * 折叠时只显示段数，展开后逐段显示注入正文（原文保留换行）。
     */
    function ContextEntry({ entry, t, sessionId }) {
      const [open, toggle] = useCollapse(sessionId, `ctx:${entry.key}`, false)
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t(entry.titleKey),
          trailing: h('span', { className: 'dcf-badge' }, t('flow.context.count', { count: entry.items.length })),
        },
        entry.items.map((item) => h('pre', { key: item.key, className: 'dcf-pre' }, item.text)),
      )
    }
