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

    /**
     * 把毫秒格式化成「x分x秒」（有小时才加小时位）。
     *
     * **分位始终显示**：用户要求计时「从 0 分 0 秒开始」，所以刚开跑的任务显示 `0分3秒`
     * 而不是 `3秒`——位数固定，读数时不会跳。
     */
    function formatDuration(ms, t) {
      const total = Math.max(0, Math.round(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      const parts = []
      if (hours > 0) parts.push(t('flow.duration.hour', { count: hours }))
      parts.push(t('flow.duration.minute', { count: minutes }))
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
     * 内容 = 首个任务列表写出之前的对话（助手说过什么、想过什么）。
     *
     * ⚠️ **这里不再重复渲染计划初稿清单**：那一版任务列表就是**第一个任务列表快照面板**
     * （分段 0，`isPlan`），两处都画会让「任务列表」在界面上出现两次（用户报告过）。
     * 首个 `todo_write` 调用本身也不在这里成行——它的内容就是那份快照。
     *
     * **默认收起**（用户要求「规划过程完成以后自动折叠」），折叠头也不显示「N 项 · M 已完成」
     * ——那正是下面的任务列表快照面板要负责的信息。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`、`unfinished`、`seat`、`liveKey`。
     * @returns 折叠分组；该回合没有规划阶段时返回 `null`。
     */
    function PlanGroup({ group, t, sessionId, labels, live, unfinished, seat, liveKey }) {
      const [open, toggle] = useCollapse(sessionId, `plan:${group.turn}`, false)
      if (group.segments.length === 0) return null
      const body = [
        h(NodeSequence, {
          key: 'plan-sequence',
          nodes: group.planNodes,
          blockKey: `proc:plan:${group.turn}`,
          t,
          sessionId,
          labels,
          active: live,
          liveKey,
          subagents: group.subagents,
          seat,
        }),
      ]
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.plan'),
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
     * **默认展开**（用户要求「带背景板的任务列表默认展开」）：它是这一轮的任务状态板，
     * 应该一眼能看到逐项状态；更早的历史快照也可以各自点开/收起。
     *
     * @param props - `segment`、`t`、`sessionId`、`unfinished`。
     * @returns 快照面板。
     */
    function SnapshotPlate({ segment, t, sessionId, unfinished }) {
      const [open, toggle] = useCollapse(sessionId, `plate:${segment.key}`, true)
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
     * **默认展开只给「此刻正在做的那一项」**（`segment.isCurrentTask`，见 `buildTurnGroup`），
     * 且必须**这个回合还在跑**：任务一旦完成或回合结束，它就自动折叠（用户要求
     * 「当一个任务或一个节点完成后自动折叠」）。更早分段的那一项早就被后续列表标成完成了，
     * 折叠体没有理由继续摊开；唯一例外是「回合结束但没做完」——那时保持展开，
     * 让用户一眼看到它停在哪一步。
     *
     * @param props - `segment`、`t`、`sessionId`、`labels`、`live`、`unfinished`、`subagents`、`seat`。
     * @returns 子任务折叠体；该分段没有进行中的任务时返回 `null`。
     */
    function TaskFold({ segment, t, sessionId, labels, live, unfinished, subagents, seat, liveKey }) {
      const [open, toggle] = useCollapse(
        sessionId,
        `task:${segment.key}`,
        segment.isCurrentTask === true && (live === true || unfinished === true),
      )
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
            // 「思考中」按「这一块里有没有回合的最后一个节点」判定（见 NodeSequence 的 blockActive）：
            // 这一项写完了就立刻变成「思考已完成」，而不是整回合一直挂着「思考中」。
            active: live,
            liveKey,
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
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`、`seat`、`now`。
     * @returns 回合块。
     */
    function TurnGroup({ group, t, sessionId, labels, live, seat, now }) {
      // 「任务过程」**始终默认折叠**（用户当轮要求）：折叠头一行说明它有耗时与统计，
      // 需要看过程时点开即可（用户手动点开的状态照旧被记住）。
      // 回合结束但没做完的任务、以及「正在做的那一项」仍然在折叠体里，靠头上的「未完成」标记提示。
      const unfinished = group.unfinished === true && live !== true
      const [stageOpen, toggleStage] = useCollapse(sessionId, `stage:${group.turn}`, false)
      /**
       * 任务耗时：**正在跑的回合实时计时**（`now` 由视图每秒刷新一次，见 `useTick`），
       * 已经结束的回合用派生层算好的固定值。从 0 分 0 秒开始往上走。
       */
      const liveMs =
        live === true && typeof group.startedAt === 'number' && typeof now === 'number'
          ? Math.max(0, now - group.startedAt)
          : null
      const durationMs = liveMs === null ? group.durationMs : liveMs
      const durationText =
        durationMs === null ? '' : t('flow.stage.duration', { text: formatDuration(durationMs, t) })
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
          stage.push(
            h(PlanGroup, {
              key: 'plan',
              group,
              t,
              sessionId,
              labels,
              live,
              unfinished,
              seat,
              liveKey: group.liveKey,
            }),
          )
        }
        for (const segment of group.segments) {
          stage.push(
            h(SnapshotPlate, {
              key: `plate:${segment.key}`,
              segment,
              t,
              sessionId,
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
              liveKey: group.liveKey,
            }),
          )
          if (segment.activeTask === null && segment.nodes.length > 0) {
            // 这一段已经没有「进行中」的任务了，`TaskFold` 不渲染；它自己的过程与正文都放在这里。
            // 用默认 mode（两份都渲染）：正文如果只走 process 那一份就会被丢掉。
            stage.push(
              h(NodeSequence, {
                key: `seq:${segment.key}`,
                nodes: segment.nodes,
                blockKey: `proc:${segment.key}`,
                t,
                sessionId,
                labels,
                active: live,
                liveKey: group.liveKey,
                unfinished,
                subagents: group.subagents,
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
          liveKey: group.liveKey,
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
          liveKey: group.liveKey,
          unfinished,
          subagents: group.subagents,
          mode: 'inline',
          seat,
        }),
      )

      // ---- 收尾节点固定排在**总结之后**（用户要求）：复制 / 点赞 / 点踩 /「在新对话中分支」在它里面。
      // 它们不进任何折叠体（`NodeSequence` 里也会把它们剔除），所以这里单独渲染一次。
      for (const node of group.footerNodes ?? []) {
        children.push(
          h(NativeNodeRow, {
            key: `footer:${node.key}`,
            node,
            row: null,
            seat,
            t,
            sessionId,
            labels,
          }),
        )
      }

      return h(
        'div',
        { className: 'dcf-turn', 'data-turn': String(group.turn), 'data-turn-anchor': String(group.turn) },
        children,
      )
    }