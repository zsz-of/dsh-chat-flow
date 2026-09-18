    /* ──────────────────────────── 计划分组 / 任务列表 ──────────────────────────── */

    /** 状态点在任务行左侧：已完成/进行中用 primitives 的 `StateDot`，未开始用空心圆。 */
    function TaskDot({ status }) {
      if (status === 'completed') return h(StateDot, { state: 'done', size: 10, className: 'dcf-dot' })
      if (status === 'in_progress') return h(StateDot, { state: 'ongoing', size: 10, className: 'dcf-dot' })
      return h('span', { className: 'dcf-dot dcf-dot-pending' })
    }

    /** 任务状态的本地化文字。 */
    function statusText(t, status) {
      if (status === 'completed') return t('flow.status.completed')
      if (status === 'in_progress') return t('flow.status.in_progress')
      return t('flow.status.pending')
    }

    /**
     * 计划分组：把「规划过程」折起来（验收第 2 条）。
     *
     * 内容 = 首个任务列表写出之前的对话（助手说了什么、想过什么）+ 计划初稿清单。
     * 首个 `todo_write` 调用本身不在这里重复成一行明细——它的内容就是下面那份清单。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`。
     * @returns 折叠分组；该回合没有规划阶段时返回 `null`。
     */
    function PlanGroup({ group, t, sessionId, labels }) {
      const planningNodes = useMemo(
        () => group.planNodes.filter((node) => node.key !== group.planCallKey),
        [group],
      )
      const [open, toggle] = useCollapse(sessionId, `plan:${group.turn}`, false)
      if (group.plan === null) return null
      const body = [
        h(NodeSequence, {
          key: 'plan-sequence',
          nodes: planningNodes,
          blockKey: `proc:plan:${group.turn}`,
          t,
          sessionId,
          labels,
        }),
        h(
          'div',
          { key: 'plan-draft', className: 'dcf-panel' },
          h('div', { className: 'dcf-plan-head' }, t('flow.planDraft')),
          ...group.plan.todos.map((todo, index) =>
            h(
              'div',
              { key: `draft:${index}`, className: 'dcf-task' },
              h(
                'div',
                { className: 'dcf-taskrow', 'data-status': todo.status },
                h('span', { className: 'dcf-chev' }),
                h(TaskDot, { status: todo.status }),
                h('span', { className: 'dcf-tasktitle' }, todo.content),
              ),
            ),
          ),
        ),
      ]
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.plan'),
          summary: t('flow.tasksSummary', {
            total: group.plan.todos.length,
            done: group.plan.todos.filter((todo) => todo.status === 'completed').length,
          }),
        },
        body,
      )
    }

    /**
     * 一个任务：一行状态 + 可折叠的子对话（验收第 4、5 条）。
     *
     * 任务状态是**实时**的：`todo_write` 每次整表覆盖都会重算状态点，因此模型一标记完成，
     * 界面立刻跟着变。子对话默认折叠，展开后是该任务执行期间产生的全部节点。
     *
     * @param props - `group`、`task`、`t`、`sessionId`、`labels`。
     * @returns 任务行。
     */
    function TaskRow({ group, task, t, sessionId, labels }) {
      const [open, toggle] = useCollapse(sessionId, `task:${group.turn}:${task.index}`, false)
      const expandable = task.nodes.length > 0
      const cells = [
        expandable ? h(Chevron, { open }) : h('span', { className: 'dcf-chev' }),
        h(TaskDot, { status: task.status }),
        h('span', { className: 'dcf-tasktitle' }, task.content),
        h('span', { key: 'status', className: 'dcf-badge' }, statusText(t, task.status)),
        expandable
          ? h('span', { key: 'count', className: 'dcf-count' }, t('flow.ops', { count: task.stats.listed }))
          : null,
      ]
      // 还没有子对话的任务是**不可展开的行**，用 div 而不是 disabled 按钮：
      // 它仍是一条要读的状态行，不是一个失效控件（disabled 会带来灰色与不可聚焦的语义）。
      const row = expandable
        ? h(
            'button',
            {
              type: 'button',
              className: 'dcf-taskrow',
              'data-status': task.status,
              'aria-expanded': open,
              onClick: toggle,
            },
            cells,
          )
        : h('div', { className: 'dcf-taskrow', 'data-status': task.status }, cells)
      return h(
        'div',
        { className: 'dcf-task' },
        row,
        expandable && open
          ? h(
              'div',
              { className: 'dcf-body' },
              h(NodeSequence, {
                nodes: task.nodes,
                blockKey: `proc:${group.turn}:${task.index}`,
                t,
                sessionId,
                labels,
              }),
            )
          : null,
      )
    }

    /**
     * 任务列表：有序、可看出进行到哪一项（验收第 3、4 条）。
     *
     * 列表本身不折叠——它是这个视图的主干，藏起来就失去意义了。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`。
     * @returns 任务列表；该回合没有计划时返回 `null`。
     */
    function TaskList({ group, t, sessionId, labels }) {
      if (group.tasks.length === 0) return null
      return h(
        'div',
        { className: 'dcf-block' },
        h(
          'div',
          { className: 'dcf-plan-head' },
          h('span', null, t('flow.tasks')),
          h(
            'span',
            { className: 'dcf-badge' },
            t('flow.tasksSummary', { total: group.tasks.length, done: group.completedCount }),
          ),
        ),
        h(
          'div',
          { className: 'dcf-tasks' },
          ...group.tasks.map((task) =>
            h(TaskRow, { key: `task:${group.turn}:${task.index}`, group, task, t, sessionId, labels }),
          ),
        ),
      )
    }

    /**
     * 一个回合 = 一次用户输入产生的任务流。
     *
     * 有计划：用户发言 → 规划过程（折叠）→ 任务列表 → 收尾（任务全部完成后的汇报）。
     * 没计划（琐碎请求）：用户发言 → 正在处理（折叠）+ 结论，保持紧凑。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`。
     * @returns 回合块。
     */
    function TurnGroup({ group, t, sessionId, labels }) {
      const children = []
      if (group.inputText !== '') children.push(h(UserBubble, { key: 'ask', text: group.inputText }))
      if (group.planned) {
        children.push(h(PlanGroup, { key: 'plan', group, t, sessionId, labels }))
        children.push(h(TaskList, { key: 'tasks', group, t, sessionId, labels }))
        children.push(
          h(NodeSequence, {
            key: 'closing',
            nodes: group.closing,
            blockKey: `proc:closing:${group.turn}`,
            t,
            sessionId,
            labels,
          }),
        )
      } else {
        children.push(
          h(NodeSequence, {
            key: 'loose',
            nodes: group.planNodes,
            blockKey: `proc:loose:${group.turn}`,
            t,
            sessionId,
            labels,
          }),
        )
      }
      return h('div', { className: 'dcf-turn', 'data-turn': String(group.turn) }, children)
    }
