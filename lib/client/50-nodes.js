    /* ──────────────────────────── 节点渲染 ──────────────────────────── */

    /** 每个统计类别对应的行首图标（同一类别用同一个字形，一眼能扫出操作类型）。 */
    const CATEGORY_ICONS = {
      editFile: 'IconEditOutline16',
      command: 'IconCodeOutline16',
      question: 'IconQuestionOutline14',
      mcp: 'IconCordisPluginOutline14',
      plugin: 'IconCordisPluginOutline14',
      core: 'IconInspectOutline12',
    }

    /**
     * 取某类别图标的渲染函数。
     *
     * @param category - 统计类别键。
     * @returns 图标组件；primitives 里没有该字形时返回 `null`（渲染层按「无图标」处理）。
     */
    function iconForCategory(category) {
      const iconName = CATEGORY_ICONS[category]
      const icon = iconName === undefined ? undefined : primitives[iconName]
      return typeof icon === 'function' ? icon : null
    }

    /** 可折叠行左端的箭头：用 primitives 的雪佛龙 + CSS 旋转，不额外造图标。 */
    function Chevron({ open }) {
      const icon = primitives.IconChevronRightOutline14
      if (typeof icon !== 'function') return h('span', { className: 'dcf-chev' })
      return h(icon, { className: 'dcf-chev', 'data-open': open === true ? 'true' : 'false' })
    }

    /**
     * 一行「可展开」的行：整行是按钮，展开后在下方显示内容。
     *
     * 交互与核心的工具行一致（点整行切换、`aria-expanded` 可读、禁止态时不带指针），
     * 因为这两处是同一个心智模型：先看一行摘要，需要时再展开看明细。
     * 不可展开的行走**纯文本行**（`div`）而不是 disabled 按钮——它是一条标签，不是一个失效控件。
     */
    function DisclosureLine({ open, onToggle, leading, title, summary, trailing, children }) {
      const interactive = typeof onToggle === 'function'
      const row = interactive
        ? h(
            'button',
            {
              type: 'button',
              className: 'dcf-row',
              'aria-expanded': open === true,
              onClick: onToggle,
            },
            h(Chevron, { open }),
            leading ?? null,
            title === undefined || title === null ? null : h('span', { className: 'dcf-title' }, title),
            summary === undefined || summary === null || summary === ''
              ? null
              : h('span', { className: 'dcf-summary' }, summary),
            trailing ?? null,
          )
        : h(
            'div',
            { className: 'dcf-row', 'data-static': 'true' },
            h('span', { className: 'dcf-chev' }),
            leading ?? null,
            title === undefined || title === null ? null : h('span', { className: 'dcf-title' }, title),
            summary === undefined || summary === null || summary === ''
              ? null
              : h('span', { className: 'dcf-summary' }, summary),
            trailing ?? null,
          )
      return h(
        'div',
        { className: 'dcf-block' },
        row,
        open === true && children !== undefined ? h('div', { className: 'dcf-body' }, children) : null,
      )
    }

    /** 用户消息气泡（字面文本，不做 markdown 解析——与核心的 `MessageText` 语义一致）。 */
    function UserBubble({ text }) {
      if (typeof text !== 'string' || text.trim() === '') return null
      return h(
        'div',
        { className: 'dcf-ask' },
        h('div', { className: 'dcf-bubble' }, h(MessageText, { text })),
      )
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

    /** 工具调用的展开明细：命令类用终端卡片，其余用 JSON 入参 + 结果文本。 */
    function ToolDetail({ entry, t }) {
      const parsedArgs = parseJsonSafe(entry.argsRaw)
      const children = []
      if (entry.category === 'command') {
        const args = toolArgsOf({ name: entry.name, argsRaw: entry.argsRaw })
        children.push(
          h(TerminalBlock, {
            key: 'terminal',
            command: typeof args.command === 'string' ? args.command : entry.summary,
            output: entry.settled ? entry.output : '',
            running: entry.settled !== true,
            maxLines: 14,
            labels: terminalLabels(t),
          }),
        )
      } else {
        children.push(
          h(JsonBlock, {
            key: 'args',
            label: t('flow.args'),
            payload: parsedArgs === undefined ? entry.argsRaw : parsedArgs,
          }),
        )
        if (entry.settled === true && entry.output !== '') {
          children.push(
            h(JsonBlock, { key: 'result', label: t('flow.output'), payload: entry.output }),
          )
        }
      }
      return children
    }

    /** 一行摘要前的图标列：没有对应字形时留一个等宽占位，避免文字错位。 */
    function ToolLeading({ entry }) {
      const icon = iconForCategory(entry.category)
      if (icon === null) return h('span', { className: 'dcf-chev' })
      return h(icon, { className: 'dcf-chev', 'data-open': 'false' })
    }

    /**
     * 「正在处理」里的一条操作。
     *
     * 折叠态只有一行（图标 + 工具名 + 摘要），展开态才渲染明细——这正是验收第 9 条
     * 「一行一条、可再展开看详情」的要求。
     */
    function ToolEntry({ entry, t, sessionId }) {
      const [open, toggle] = useCollapse(sessionId, `op:${entry.key}`, false)
      const title = entry.name === 'todo_write' ? t('flow.planUpdate') : entry.name
      const trailing = entry.settled === true && entry.isError === true
        ? h('span', { className: 'dcf-badge' }, t('flow.failed'))
        : entry.settled === true
          ? null
          : h('span', { className: 'dcf-badge' }, t('flow.running'))
      return h(
        DisclosureLine,
        { open, onToggle: toggle, leading: h(ToolLeading, { entry }), title, summary: entry.summary, trailing },
        h(ToolDetail, { entry, t }),
      )
    }

    /** 「正在处理」里的一行非工具过程（斜杠命令、压缩、重试…）：只显示标题，不带明细。 */
    function ProcessRowEntry({ entry }) {
      return h(
        DisclosureLine,
        { open: false, leading: h('span', { className: 'dcf-chev' }), title: entry.title },
        null,
      )
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
          title: t('flow.thinking'),
          summary: '',
          trailing: h('span', { className: 'dcf-badge' }, String(lines)),
        },
        h('pre', { className: 'dcf-pre' }, entry.text),
      )
    }
