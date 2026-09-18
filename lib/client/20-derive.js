    /* ──────────────────────────── 节点树 → 任务流 ──────────────────────────── */

    /**
     * 这一层是纯函数：输入是核心的 chat 快照，输出是「计划 / 任务列表 / 子对话 / 统计」视图模型。
     *
     * 之所以全部在这里派生，而不是让 host 另算一份：
     * 验收标准第 10 条要求「统计数字与实际发生在该任务内的调用次数一致」。节点树就是会话日志的
     * 呈现，界面与统计都从同一份数据出发，才不会出现两套真相（见 `docs/exec-plans`）。
     */

    /** 「正在处理」里逐条明细要收的非工具节点类型，值为该行的中文标题。 */
    const PROCESS_ROW_TITLES = {
      'system-prompt': '系统提示词',
      context: '上下文注入',
      command: '斜杠命令',
      compaction: '上下文压缩',
      'manual-compaction': '手动压缩',
      'model-retry': '模型重试',
      'turn-error': '本轮出错',
      'turn-max-tokens': '达到 token 上限',
      unknown: '未识别事件',
    }

    /** 参与「正在处理」明细的节点类型（工具调用另算，见 {@link processEntries}）。 */
    const PROCESS_ROW_KINDS = new Set(Object.keys(PROCESS_ROW_TITLES))

    /**
     * 判断一个工具块是否已落定。
     *
     * 形状来自核心：未落定时是 `{callId, name, argsRaw, …}`；落定后被替换成
     * `{kind:'tool-result', call:{name, argsRaw}, content, isError, …}`。
     * 因此「有 `kind` 字段」就是「已落定」——核心自己也这么判（`ui-chat` 导出的 `isSettledTool`）。
     *
     * @param block - 工具块。
     * @returns 是否已落定。
     */
    function isSettledToolBlock(block) {
      return block !== null && typeof block === 'object' && 'kind' in block
    }

    /**
     * 取出工具名（落定与未落定两种情况统一）。
     *
     * @param block - 工具块。
     * @returns 工具名，取不到时返回空串。
     */
    function toolNameOf(block) {
      if (block === null || typeof block !== 'object') return ''
      const name = isSettledToolBlock(block) ? block.call?.name : block.name
      return typeof name === 'string' ? name : ''
    }

    /**
     * 取出工具入参原文（JSON 字符串）。
     *
     * @param block - 工具块。
     * @returns 入参原文，取不到时返回空串。
     */
    function toolArgsRawOf(block) {
      if (block === null || typeof block !== 'object') return ''
      const raw = isSettledToolBlock(block) ? block.call?.argsRaw : block.argsRaw
      return typeof raw === 'string' ? raw : ''
    }

    /**
     * `JSON.parse` 的安全版本。
     *
     * @param raw - 可能不是合法 JSON 的字符串。
     * @returns 解析值；解析失败返回 `undefined`。
     */
    function parseJsonSafe(raw) {
      if (typeof raw !== 'string' || raw === '') return undefined
      try {
        return JSON.parse(raw)
      } catch {
        return undefined
      }
    }

    /** 工具入参对象；不是对象时给空对象，调用方不必再判空。 */
    function toolArgsOf(block) {
      const parsed = parseJsonSafe(toolArgsRawOf(block))
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    }

    /**
     * 把内容块数组拼成纯文本（只取 `type:'text'`）。
     *
     * @param content - 内容块数组。
     * @returns 拼接后的文本，块之间用换行分隔。
     */
    function contentToText(content) {
      if (!Array.isArray(content)) return ''
      const parts = []
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
      return parts.join('\n')
    }

    /** 工具调用节点的工具块；不是工具调用节点时返回 `null`。 */
    function toolBlockOfNode(node) {
      if (node === null || typeof node !== 'object') return null
      if (node.kind !== 'tool-call') return null
      const root = node.data?.root
      return root !== null && typeof root === 'object' ? root : null
    }

    /**
     * 该节点是否是一次 `todo_write`，是则返回它写出的整表。
     *
     * 只认「参数能解析出 `todos` 数组」的调用：被拒绝或参数损坏的调用保留原文但不算任务列表，
     * 这与核心 todo 卡片的行为一致（它同样只信任可解析的 `argsRaw`）。
     *
     * @param node - 对话节点。
     * @returns `{content, status}[]`，或 `null`。
     */
    function todosOfToolCall(node) {
      const block = toolBlockOfNode(node)
      if (block === null) return null
      if (toolNameOf(block) !== 'todo_write') return null
      const raw = toolArgsOf(block).todos
      if (!Array.isArray(raw)) return null
      const todos = []
      for (const item of raw) {
        if (item === null || typeof item !== 'object') return null
        if (typeof item.content !== 'string') return null
        const status = item.status === 'completed' || item.status === 'in_progress' ? item.status : 'pending'
        todos.push({ content: item.content, status })
      }
      return todos
    }

    /**
     * 取节点所属回合号。
     *
     * 三个来源按可靠性排序：节点的 `location`（装配引擎给的权威坐标）、
     * `data.turn`（assistant-step 自带）、工具块自己的 `turn`。都取不到时归 0 号回合，
     * 这样「只有已加载窗口」的历史片段也仍能分组显示，而不是整段消失。
     *
     * @param node - 对话节点。
     * @returns 回合号。
     */
    function turnOfNode(node) {
      const location = node?.location
      if (location?.kind === 'step' || location?.kind === 'turn') {
        const turn = location.turn?.turn
        if (typeof turn === 'number') return turn
      }
      const direct = node?.data?.turn
      if (typeof direct === 'number') return direct
      const block = toolBlockOfNode(node)
      if (block !== null && typeof block.turn === 'number') return block.turn
      return 0
    }

    /**
     * 把工具调用压成一行摘要：优先用最能代表这次操作的那个参数。
     *
     * @param name - 工具名。
     * @param args - 工具入参对象。
     * @returns 一行摘要文本（可能为空串）。
     */
    function summarizeToolCall(name, args) {
      const pick = (key) => (typeof args[key] === 'string' && args[key] !== '' ? args[key] : undefined)
      const firstLine = (text) => text.split('\n', 1)[0].trim()
      if (name === 'todo_write' && Array.isArray(args.todos)) {
        const done = args.todos.filter((item) => item?.status === 'completed').length
        return `${args.todos.length} 项 · ${done} 已完成`
      }
      for (const key of ['command', 'file_path', 'filePath', 'path', 'pattern', 'query', 'url', 'from', 'to']) {
        const value = pick(key)
        if (value !== undefined) return firstLine(value)
      }
      for (const key of ['skill', 'name', 'description', 'prompt', 'plan']) {
        const value = pick(key)
        if (value !== undefined) return firstLine(value)
      }
      return ''
    }

    /** 排序并提供全部节点：先用 `order`（核心的呈现序），补上不在其中的隐藏节点。 */
    function orderedNodes(snapshot) {
      const store = snapshot?.nodes
      if (store === undefined || typeof store.values !== 'function') return []
      const nodes = []
      const seen = new Set()
      const order = Array.isArray(snapshot.order) ? snapshot.order : []
      for (const key of order) {
        const node = typeof store.get === 'function' ? store.get(key) : undefined
        if (node === undefined || node === null) continue
        nodes.push(node)
        seen.add(node.key)
      }
      for (const node of store.values()) {
        if (node === null || typeof node !== 'object' || seen.has(node.key)) continue
        nodes.push(node)
      }
      return nodes
    }

    /** assistant-step 里可见的正文（`text` 块）。 */
    function assistantTextOf(node) {
      if (node?.kind !== 'assistant-step' || !Array.isArray(node.data?.blocks)) return ''
      const parts = []
      for (const block of node.data.blocks) {
        if (block?.kind === 'text' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
      }
      return parts.join('\n\n')
    }

    /** assistant-step 里的推理文本（`reasoning` 块），折叠进「正在处理」。 */
    function assistantReasoningOf(node) {
      if (node?.kind !== 'assistant-step' || !Array.isArray(node.data?.blocks)) return ''
      const parts = []
      for (const block of node.data.blocks) {
        if (block?.kind === 'reasoning' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
      }
      return parts.join('\n\n')
    }

    /** 用户/steering 节点的文字内容。 */
    function messageTextOf(node) {
      return contentToText(node?.data?.content)
    }

    /**
     * 「正在处理」的明细条目，按节点顺序。
     *
     * 每条要么是一次工具调用（`kind:'tool'`），要么是一行非工具过程（`kind:'row'`，
     * 例如斜杠命令、上下文压缩），要么是一段推理（`kind:'thinking'`）。
     * 只读的内置工具（read / grep 等）也在其中——验收第 7、9 条要求所有动作都能展开看到。
     *
     * @param nodes - 一个任务（或一段无计划回合）的节点序列。
     * @returns 明细条目数组。
     */
    function processEntries(nodes) {
      const entries = []
      for (const node of nodes) {
        const block = toolBlockOfNode(node)
        if (block !== null) {
          const name = toolNameOf(block)
          entries.push({
            kind: 'tool',
            key: node.key,
            name,
            category: categoryOfTool(name),
            summary: summarizeToolCall(name, toolArgsOf(block)),
            settled: isSettledToolBlock(block),
            isError: isSettledToolBlock(block) ? block.isError === true : false,
            argsRaw: toolArgsRawOf(block),
            output: isSettledToolBlock(block) ? contentToText(block.content) : '',
          })
          continue
        }
        if (node?.kind === 'assistant-step') {
          const reasoning = assistantReasoningOf(node)
          if (reasoning !== '') entries.push({ kind: 'thinking', key: node.key, text: reasoning })
          continue
        }
        const title = PROCESS_ROW_TITLES[node?.kind]
        if (title !== undefined) entries.push({ kind: 'row', key: node.key, title })
      }
      return entries
    }

    /**
     * 统计一段节点里的工具调用次数，按 5 类分桶。
     *
     * 口径（与验收第 8、10 条对应，可逐条核对）：
     * - 每个**根**工具调用节点算 1 次；`subCalls`（代码分派等嵌套调用）不重复计数。
     * - 只读内置工具归 `core`，不进入用户可见的 5 项，但仍逐条出现在展开明细里。
     * - `todo_write`（计划写入）归 `core`：它是任务边界本身，不算任务执行动作。
     *
     * @param nodes - 一个任务的节点序列。
     * @returns `{counts, total, listed}`。
     */
    function statsOfNodes(nodes) {
      const counts = { editFile: 0, command: 0, question: 0, mcp: 0, plugin: 0, core: 0 }
      let total = 0
      for (const node of nodes) {
        const block = toolBlockOfNode(node)
        if (block === null) continue
        const category = categoryOfTool(toolNameOf(block))
        counts[category] = (counts[category] ?? 0) + 1
        total += 1
      }
      return { counts, total, listed: processEntries(nodes).length }
    }

    /**
     * 挑出要显示的统计分段：非零的 5 类，按固定顺序（编辑文件 / 命令 / 提问 / MCP / 插件）。
     *
     * 只返回类别键与计数，**不含任何文案**——文案由渲染点用 `t(...)` 组装（见 `describeStats`）。
     * 值为 0 的类别省略，沿用核心过程折叠的呈现约定（`turn-process` 控件同样省略零分段）。
     *
     * @param stats - {@link statsOfNodes} 的结果。
     * @returns `{segments, listed}`；`segments` 为空表示这 5 类都是 0。
     */
    function statsSummary(stats) {
      const segments = []
      for (const category of STAT_CATEGORIES) {
        const count = stats.counts[category] ?? 0
        if (count > 0) segments.push({ category, count })
      }
      return { segments, listed: stats.listed }
    }

    /** 首个 `in_progress` 任务的下标；没有则为 -1。 */
    function activeTaskIndex(tasks) {
      for (let index = 0; index < tasks.length; index += 1) {
        if (tasks[index].status === 'in_progress') return index
      }
      return -1
    }

    /**
     * 用新的整表更新任务序列（`todo_write` 是整表覆盖语义）。
     *
     * 按 `content` 认领同一项，保留它已经收集到的子对话节点；新出现的项追加到末尾；
     * 被这一版列表删掉的项把节点交给收尾区（`orphaned`），避免它们的对话凭空消失。
     *
     * @param tasks - 现任务序列（就地更新）。
     * @param todos - 新整表。
     * @returns `{target, orphaned}`：`target` 是「本次更新应当归到哪个任务」的下标，`orphaned` 是被删项的节点。
     */
    function applyTodoUpdate(tasks, todos) {
      const orphans = []
      const completedTargets = []
      const next = []
      for (const item of todos) {
        const existing = tasks.find((task) => task.content === item.content && !task.dropped)
        if (existing === undefined) {
          next.push({ content: item.content, status: item.status, nodes: [] })
          continue
        }
        if (existing.status !== 'completed' && item.status === 'completed') completedTargets.push(existing)
        existing.status = item.status
        next.push(existing)
      }
      const kept = new Set(next)
      for (const task of tasks) {
        if (kept.has(task) || task.dropped) continue
        task.dropped = true
        for (const node of task.nodes) orphans.push(node)
      }
      tasks.length = 0
      for (const task of next) tasks.push(task)
      const completed = completedTargets.find((task) => tasks.includes(task))
      if (completed !== undefined) return { target: tasks.indexOf(completed), orphaned: orphans }
      const active = activeTaskIndex(tasks)
      return { target: active >= 0 ? active : tasks.length - 1, orphaned: orphans }
    }

    /**
     * 把一个回合的节点折成视图模型：计划分组 + 任务列表 + 每任务的子对话 + 收尾。
     *
     * 归属规则（可核对）：一段节点属于**产生它时正在 `in_progress` 的那一项**；
     * 一个都没有在跑时（全部已完成）归入收尾区；首个 `todo_write` 之前的节点归入计划分组。
     *
     * @param turn - 回合号。
     * @param inputNode - 触发本回合的用户节点（可能不存在，例如只加载到中途）。
     * @param nodes - 本回合除用户节点外的全部节点。
     * @returns 视图模型。
     */
    function buildTurnGroup(turn, inputNode, nodes) {
      const planNodes = []
      const closing = []
      const tasks = []
      let plan = null
      let planCallKey = null
      let seenTodo = false
      for (const node of nodes) {
        const todos = todosOfToolCall(node)
        if (todos !== null && !seenTodo) {
          seenTodo = true
          plan = { todos, node }
          planCallKey = node.key
          for (const item of todos) tasks.push({ content: item.content, status: item.status, nodes: [] })
          planNodes.push(node)
          continue
        }
        if (todos !== null) {
          const update = applyTodoUpdate(tasks, todos)
          for (const orphan of update.orphaned) closing.push(orphan)
          const bucket = tasks[update.target]
          if (bucket !== undefined) bucket.nodes.push(node)
          else closing.push(node)
          continue
        }
        if (!seenTodo) {
          planNodes.push(node)
          continue
        }
        const active = activeTaskIndex(tasks)
        if (active >= 0) tasks[active].nodes.push(node)
        else closing.push(node)
      }
      const active = activeTaskIndex(tasks)
      const completed = tasks.filter((task) => task.status === 'completed').length
      return {
        key: `turn:${turn}`,
        turn,
        input: inputNode,
        inputText: messageTextOf(inputNode),
        nodes,
        planned: plan !== null,
        planNodes,
        planCallKey,
        plan,
        tasks: tasks.map((task, index) => ({
          index,
          content: task.content,
          status: task.status,
          nodes: task.nodes,
          stats: statsOfNodes(task.nodes),
        })),
        activeIndex: active,
        completedCount: completed,
        closing,
      }
    }

    /**
     * 主派生：chat 快照 → 回合分组列表。
     *
     * 一个用户输入开一个分组（这就是「任务」的时间边界）；没计划的分组依然成型，
     * 只是 `planned === false`，由渲染层退化成「正在处理 + 结论」的紧凑形态。
     *
     * @param snapshot - `useChat((s) => s)` 拿到的快照。
     * @returns `{turns}`。
     */
    function deriveFlow(snapshot) {
      const turns = []
      let current = null
      for (const node of orderedNodes(snapshot)) {
        if (node.kind === 'user') {
          current = { turn: turnOfNode(node), input: node, nodes: [] }
          turns.push(current)
          continue
        }
        if (current === null) {
          current = { turn: turnOfNode(node), input: undefined, nodes: [] }
          turns.push(current)
        }
        current.nodes.push(node)
      }
      return { turns: turns.map((item) => buildTurnGroup(item.turn, item.input, item.nodes)) }
    }
