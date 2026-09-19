    /* ──────────────────────────── 计划 / 任务列表快照 / 子任务 ──────────────────────────── */

    /** 状态点在任务行左侧：已完成/进行中用 primitives 的 `StateDot`，未开始用空心圆。 */
    function TaskDot({ status, stalled }) {
      if (status === 'completed') return h(StateDot, { state: 'done', size: 10, className: 'dcf-dot' })
      // ⚠️ `ongoing` 是**会转的**状态点。回合已结束（例如被用户停止）却还挂在 in_progress 上的任务
      // 必须换成静态的警示点，否则界面一直在转，等于告诉用户「还在干活」——那是错的。
      if (status === 'in_progress') {
        return h(StateDot, { state: stalled === true ? 'warning' : 'ongoing', size: 10, className: 'dcf-dot' })
      }
      return h('span', { className: 'dcf-dot dcf-dot-pending' })
    }

    /** 把毫秒格式化成「x小时x分x秒」（值为 0 的高位单位省略，秒始终显示）。 */
    function formatDuration(ms, t) {
      const total = Math.max(0, Math.round(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      const parts = []
      if (hours > 0) parts.push(t('flow.duration.hour', { count: hours }))
      if (hours > 0 || minutes > 0) parts.push(t('flow.duration.minute', { count: minutes }))
      parts.push(t('flow.duration.second', { count: seconds }))
      return parts.join('')
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
     * 首个 `todo_write` 调用本身不在这里重复成一行明细——它的内容就是那份清单。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`、`unfinished`、`seat`。
     * @returns 折叠分组；该回合没有规划阶段时返回 `null`。
     */
    function PlanGroup({ group, t, sessionId, labels, live, unfinished, seat }) {
      const [open, toggle] = useCollapse(sessionId, `plan:${group.turn}`, live === true)
      const first = group.segments[0]
      if (first === undefined) return null
      const body = [
        h(NodeSequence, {
          key: 'plan-sequence',
          nodes: group.planNodes,
          blockKey: `proc:plan:${group.turn}`,
          t,
          sessionId,
          labels,
          active: live,
          subagents: group.subagents,
          seat,
        }),
        h(
          'div',
          { key: 'plan-draft', className: 'dcf-platebody' },
          ...first.todos.map((todo, index) =>
            h(
              'div',
              { key: `draft:${index}`, className: 'dcf-taskrow', 'data-status': todo.status },
              h(TaskDot, { status: todo.status, stalled: unfinished === true }),
              h('span', { className: 'dcf-tasktitle' }, todo.content),
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
            total: first.todos.length,
            done: first.todos.filter((todo) => todo.status === 'completed').length,
          }),
        },
        body,
      )
    }

    /** 一次列表更新的「本次变化」文字（完成 / 开始 / 新增 / 移除）。没有变化时返回空串。 */
    function describeTodoChange(changed, t) {
      if (changed === undefined) return ''
      const parts = []
      for (const item of changed.finished) parts.push(`${item} ✓`)
      for (const item of changed.started) parts.push(`${item} ▶`)
      for (const item of changed.added) parts.push(`${item} +`)
      for (const item of changed.removed) parts.push(`${item} −`)
      if (parts.length === 0) return ''
      return t('flow.tasksChanged', { text: parts.join(' · ') })
    }

    /**
     * 任务列表**快照面板**：每一次 `todo_write` 的冻结状态各成一块（背景板）。
     *
     * 这是用户当轮要求的核心语义：「不能全局调用，只有有更新任务列表，就要存储一次这时的状态，
     * 之后显示也是显示这时的状态」。所以这里渲染的是**该分段自己的那份快照**，
     * 而不是「当前最新列表」——否则对话里每处列表都长一样，历史进度就没有意义了。
     *
     * 默认展开：最近一次更新（读者最关心当前进度）；更早的历史快照收起成一行摘要，
     * 点开仍能看到当时逐项的完整状态。
     *
     * @param props - `segment`、`t`、`sessionId`、`defaultOpen`。
     * @returns 快照面板。
     */
    function SnapshotPlate({ segment, t, sessionId, defaultOpen, unfinished }) {
      const [open, toggle] = useCollapse(sessionId, `plate:${segment.key}`, defaultOpen === true)
      // 首个快照（计划本身）不写「本次变化」——那一版里每一项都是新增的，列出来只是噪音。
      const change = segment.isPlan === true ? '' : describeTodoChange(segment.changed, t)
      const body = []
      if (change !== '') body.push(h('div', { key: 'change', className: 'dcf-change' }, change))
      for (const todo of segment.todos) {
        body.push(
          h(
            'div',
            { key: `item:${todo.content}`, className: 'dcf-taskrow', 'data-status': todo.status },
            h(TaskDot, { status: todo.status, stalled: unfinished === true }),
            h('span', { className: 'dcf-tasktitle' }, todo.content),
            h('span', { className: 'dcf-badge' }, statusText(t, todo.status)),
          ),
        )
      }
      return h(
        'div',
        { className: 'dcf-plate' },
        h(
          'button',
          { type: 'button', className: 'dcf-platehead', 'aria-expanded': open === true, onClick: toggle },
          h(Chevron, { open }),
          h('span', { className: 'dcf-platetitle' }, t('flow.tasks')),
          h('span', { className: 'dcf-badge' }, t('flow.tasksUpdate', { index: segment.index + 1 })),
          h(
            'span',
            { className: 'dcf-count' },
            t('flow.tasksSummary', { total: segment.todos.length, done: segment.completedCount }),
          ),
        ),
        h(Fold, { open, className: 'dcf-platebody' }, body),
      )
    }

    /**
     * 一个分段里的「子任务」折叠体：这一版列表当时正在进行的那一项。
     *
     * 这就是「完成一个任务后需要 agent 写明下一个任务，然后才显示下一个节点」的落点：
     * 下一个任务节点属于**下一个分段**，而下一个分段由那次 `todo_write` 开启。
     * 该任务在这一版快照里必然是 `in_progress`（快照是冻结的），所以状态点显示「进行中」，
     * 「已完成」会在下一块快照面板里出现。
     *
     * **默认展开只给「此刻正在做的那一项」**（`segment.isCurrentTask`，见 `buildTurnGroup`）：
     * 更早分段的那一项早就被后续列表标成完成了，它的折叠体没有理由继续摊开；
     * 而当前这一项无论回合是否还在跑都保持展开——用户停下来的那一刻最该看见的就是它停在哪一步。
     *
     * @param props - `segment`、`t`、`sessionId`、`labels`、`live`、`unfinished`、`subagents`、`seat`。
     * @returns 子任务折叠体；该分段没有进行中的任务时返回 `null`。
     */
    function TaskFold({ segment, t, sessionId, labels, live, unfinished, subagents, seat }) {
      const [open, toggle] = useCollapse(sessionId, `task:${segment.key}`, segment.isCurrentTask === true)
      if (segment.activeTask === null) return null
      return h(
        'div',
        { className: 'dcf-task' },
        h(
          'button',
          {
            type: 'button',
            className: 'dcf-taskrow',
            'data-status': 'in_progress',
            'aria-expanded': open === true,
            onClick: toggle,
          },
          h(Chevron, { open }),
          h(TaskDot, { status: 'in_progress', stalled: unfinished === true }),
          h('span', { className: 'dcf-tasktitle' }, segment.activeTask),
          h('span', { className: 'dcf-badge' }, t('flow.ops', { count: segment.stats.listed })),
        ),
        h(
          Fold,
          { open },
          h(NodeSequence, {
            nodes: segment.nodes,
            blockKey: `proc:${segment.key}`,
            t,
            sessionId,
            labels,
            // 「思考中 / 思考完成」按**回合是否还在跑**判定（不是按任务是否当前）：
            // 会话停了就不该再有东西告诉用户「还在处理」。
            active: live,
            unfinished,
            subagents: subagents,
            seat,
          }),
        ),
      )
    }

    /**
     * 一个回合 = 一次用户输入产生的任务流（「任务处理流」这一层）。
     *
     * 层级（用户当轮要求）：**任务处理流 > 子任务 > 小处理过程 = 子 agent 操作**。
     * - 任务处理流 = 本组件（回合）；
     * - 子任务 = {@link TaskFold}（由某次列表更新点名的那一项）；
     * - 小处理过程 = {@link ThinkingBlock}（思考中 / 思考完成），子 agent 卡片与它同级。
     *
     * 有计划：用户发言 → 规划过程 → 逐段（列表快照 + 子任务）→ 收尾。
     * 没计划：用户发言 → 按操作序列折叠（`looseNodes`）。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`、`seat`。
     * @returns 回合块。
     */
    function TurnGroup({ group, t, sessionId, labels, live, seat }) {
      // 任务阶段折叠（参考 TRAE）：**进行中展开、输出任务总结后自动折叠**，折叠头上写任务耗时与统计。
      // 回合已经结束却还有没做完的任务（例如被用户停止）时**保持展开**：那是用户最需要看到的状态，
      // 折叠头同时挂「未完成」标记，别让停下来的回合看起来像一切正常。
      const unfinished = group.unfinished === true && live !== true
      // 任务阶段折叠默认展开的三种情形：回合正在跑 / 回合结束但留下没做完的事 / 还有一项任务
      // 停在「进行中」（用户最该先看到它）。
      const hasCurrentTask = group.segments.some((segment) => segment.isCurrentTask === true)
      const stageOpenDefault = live === true || unfinished === true || hasCurrentTask
      const [stageOpen, toggleStage] = useCollapse(sessionId, `stage:${group.turn}`, stageOpenDefault)
      const durationText =
        group.durationMs === null ? '' : t('flow.stage.duration', { text: formatDuration(group.durationMs, t) })
      const statsText = describeStats(group.stats, t)
      const stageSummary = [durationText, statsText].filter((part) => part !== '').join(' · ')
      /** 用户发言走原生座位；这里只算一次它自己的回退模型。 */
      const inputRow = useMemo(
        () => (group.input === undefined ? null : nodeRowOf(group.input, group.subagents)),
        [group],
      )

      const children = []
      if (group.input !== undefined) {
        children.push(
          h(NativeNodeRow, { key: 'ask', node: group.input, row: inputRow, seat, t, sessionId, labels }),
        )
      }

      // ---- 折进「任务过程」的部分：计划分组 + 每段的任务列表快照 + 子任务 + 过程明细 ----
      const stage = []
      if (group.planned) {
        if (group.planNodes.length > 0) {
          stage.push(h(PlanGroup, { key: 'plan', group, t, sessionId, labels, live, unfinished, seat }))
        }
        const lastIndex = group.segments.length - 1
        for (const segment of group.segments) {
          stage.push(
            h(SnapshotPlate, {
              key: `plate:${segment.key}`,
              segment,
              t,
              sessionId,
              // 最后一块快照面板默认展开：读者最关心的是这一轮最终的进度（更早的历史快照收成一行摘要）。
              defaultOpen: segment.index === lastIndex,
              unfinished,
            }),
          )
          stage.push(
            h(TaskFold, {
              key: `task:${segment.key}`,
              segment,
              t,
              sessionId,
              labels,
              live,
              unfinished,
              subagents: group.subagents,
              seat,
            }),
          )
          if (segment.activeTask === null && segment.nodes.length > 0) {
            stage.push(
              h(NodeSequence, {
                key: `seq:${segment.key}`,
                nodes: segment.nodes,
                blockKey: `proc:${segment.key}`,
                t,
                sessionId,
                labels,
                active: live,
                unfinished,
                subagents: group.subagents,
                mode: 'process',
                seat,
              }),
            )
          }
        }
      }
      const tailNodes = group.planned ? group.closing : group.looseNodes
      stage.push(
        h(NodeSequence, {
          key: 'stage-process',
          nodes: tailNodes,
          blockKey: `proc:${group.planned ? 'closing' : 'loose'}:${group.turn}`,
          t,
          sessionId,
          labels,
          active: live,
          unfinished,
          subagents: group.subagents,
          mode: 'process',
          seat,
        }),
      )
      children.push(
        h(DisclosureLine, {
          key: 'stage',
          open: stageOpen,
          onToggle: toggleStage,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.stage'),
          summary: stageSummary,
          trailing: unfinished
            ? h(StatusChip, { tone: 'warn', text: t('flow.status.unfinished') })
            : null,
        }, stage),
      )

      // ---- 留在外面的部分：任务总结正文（任务结束时对用户的输出）----
      children.push(
        h(NodeSequence, {
          key: 'stage-inline',
          nodes: tailNodes,
          blockKey: `inline:${group.turn}`,
          t,
          sessionId,
          labels,
          active: live,
          unfinished,
          subagents: group.subagents,
          mode: 'inline',
          seat,
        }),
      )

      return h(
        'div',
        { className: 'dcf-turn', 'data-turn': String(group.turn), 'data-turn-anchor': String(group.turn) },
        children,
      )
    }