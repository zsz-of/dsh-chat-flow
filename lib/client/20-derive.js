    /* ──────────────────────────── 节点树 → 任务流 ──────────────────────────── */

    /**
     * 这一层是纯函数：输入是核心的 chat 快照，输出是「计划 / 任务列表快照 / 子任务 / 卡片 / 统计」视图模型。
     *
     * 之所以全部在这里派生，而不是让 host 另算一份：
     * 验收标准第 10 条要求「统计数字与实际发生在该任务内的调用次数一致」。节点树就是会话日志的
     * 呈现，界面与统计都从同一份数据出发，才不会出现两套真相（见 `docs/exec-plans`）。
     *
     * 本层**不产出任何人类语言**：所有文案由渲染层用 `t(...)` 组装。
     */

    /** 参与明细的非工具节点类型与它的标题键。 */
    const PROCESS_ROW_TITLES = {
      'system-prompt': 'flow.row.systemPrompt',
      context: 'flow.row.context',
      command: 'flow.row.command',
      compaction: 'flow.row.compaction',
      'manual-compaction': 'flow.row.manualCompaction',
      'model-retry': 'flow.row.modelRetry',
      'turn-error': 'flow.row.turnError',
      'turn-max-tokens': 'flow.row.maxTokens',
      unknown: 'flow.row.unknown',
    }

    /**
     * 判断一个工具块是否已落定。
     *
     * 形状来自核心：未落定时是 `{callId, name, argsRaw, …}`；落定后被替换成
     * `{kind:'tool-result', call:{name, argsRaw}, content, isError, error?, meta?, …}`。
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

    /** 取节点的时间戳（毫秒）：assistant-step / 工具块 / user 节点各有一处来源。 */
    function nodeTimeOf(node) {
      const direct = node?.data?.time
      if (typeof direct === 'number') return direct
      const block = toolBlockOfNode(node)
      if (block !== null) {
        if (typeof block.callTime === 'number') return block.callTime
        if (typeof block.time === 'number') return block.time
      }
      return undefined
    }

    /** 该回合是否已经结束：时间线说关了，或者出现了只在收尾时才会有的节点。 */
    function turnClosedOf(nodes, timelineTurn) {
      if (timelineTurn !== undefined && timelineTurn.status === 'closed') return true
      for (const node of nodes) {
        if (node?.kind === 'turn-tail' || node?.kind === 'turn-error' || node?.kind === 'turn-max-tokens') return true
      }
      return false
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

    /** assistant-step 里的推理文本（`reasoning` 块），折叠进「思考」块。 */
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

    /* ──────────────────────────── 卡片模型 ──────────────────────────── */

    /** 被判为「已取消」的错误码：核心用 `interrupted` 合成被中断的调用，另有若干 ABORTED 家族。 */
    const CANCELLED_CODES = new Set([
      'interrupted',
      'aborted',
      'aborted_before_dispatch',
      'tool_timeout',
      'tool_outcome_unknown',
      'ask_cancelled',
      'ask_aborted',
    ])

    /** 取文本的第一行并截断：卡片折叠态只给一行摘要，完整内容留给展开体。 */
    function firstLineOf(text, limit) {
      if (typeof text !== 'string' || text === '') return ''
      const line = text.split('\n', 1)[0].trim()
      const max = limit ?? 120
      return line.length <= max ? line : `${line.slice(0, max - 1)}…`
    }

    /** 取路径的文件名：折叠态只显示文件名，完整路径留给展开体。 */
    function baseNameOf(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.split(/[/\\]+/)
      const name = parts[parts.length - 1]
      return name === '' ? path : name
    }
    /** 取工具块的错误码（落定后 `error.code` 存在时），统一小写便于比对。 */
    function toolErrorCodeOf(block) {
      const code = block?.error?.code
      return typeof code === 'string' ? code.toLowerCase() : ''
    }

    /**
     * 命令结果的终止标记。
     *
     * **退出码与信号不在结果树里**——宿主把它们写进结果文本的尾部：
     * `\n[exit code: N]` / `\n[killed by signal: S]`（见 `core-seams.md` §8.3）。
     * 因此这里做的是**文本解析**，并且要把标记从输出里剥掉（核心的终端卡片也这么做），
     * 否则读者会在输出末尾看到一行本可以做成徽标的原文。
     *
     * @param text - 结果文本。
     * @returns `{output, exitCode, signal, timedOut}`；两个标记都没有时退出码按 0 处理。
     */
    function parseCommandOutcome(text) {
      const source = typeof text === 'string' ? text : ''
      const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(source)
      const exit = /\n\[exit code: (\d+)\]$/.exec(source)
      const timedOut = /\[timed out after \d+ms\]/.test(source)
      let output = source
      if (signal !== null) output = source.slice(0, signal.index)
      else if (exit !== null) output = source.slice(0, exit.index)
      return {
        output,
        exitCode: exit === null ? 0 : Number(exit[1]),
        signal: signal === null ? undefined : signal[1],
        timedOut,
      }
    }

    /**
     * 工具卡的状态，四态：`running` / `done` / `failed` / `cancelled`。
     *
     * 判定顺序刻意把「取消」放在「失败」之前：被用户中断的命令 `isError` 也为真，
     * 若先判失败，就会把「用户主动取消」误报成「运行失败」——那是两件完全不同的事。
     *
     * @param block - 工具块。
     * @param outcome - 命令类工具的文本解析结果（可选）。
     * @returns 状态键。
     */
    function toolStatusOf(block, outcome) {
      if (isSettledToolBlock(block) !== true) return 'running'
      if (CANCELLED_CODES.has(toolErrorCodeOf(block))) return 'cancelled'
      if (outcome !== undefined && (outcome.signal !== undefined || outcome.timedOut)) return 'cancelled'
      if (outcome !== undefined && outcome.exitCode !== 0) return 'failed'
      if (block.isError === true) return 'failed'
      return 'done'
    }

    /** 文本的行数（空串算 0 行，避免「空改动」被算成 1 行）。 */
    function lineCountOf(text) {
      if (typeof text !== 'string' || text === '') return 0
      return text.split('\n').length
    }

    /**
     * 文件编辑卡的行数统计（`+N` / `-N`）。
     *
     * 口径：优先用**入参**推导（模型自己声明的这次改动），因为它同时适用于「运行中」与「已完成」
     * 两种状态，数字不会跳变：
     * - `write`：新增 = 写入内容的行数，删除 = 0；
     * - `edit`：按 `old_string` / `new_string` 的行数；
     * - `str_replace_editor`：按 `old_str` / `new_str`（兼容 `old_string` / `new_string`）。
     *
     * 为什么不直接用结果的 `meta.diffs`：那是真实前后文本的 hunk，**带 3 行上下文**，
     * 上下文行会被同时计入 `+` 与 `−`（核心的 `diffTotals` 也如此），于是「运行中」与
     * 「已完成」的同一处改动会显示成两个不同的数字。这里取「本次改动的行数」，并在
     * 界面上标注为「本次改动」，避免被误读成最终文件差异。
     *
     * 入参里拿不到可比较文本时（例如 `str_replace_editor` 的线号模式），返回 `null`，
     * 由渲染层显示「±0」而不是编一个数字出来。
     *
     * @param name - 工具名。
     * @param args - 工具入参对象。
     * @returns `{added, removed}`，或 `null`（无法判断）。
     */
    function diffCountsOf(name, args) {
      if (name === 'write') {
        return typeof args.content === 'string' ? { added: lineCountOf(args.content), removed: 0 } : null
      }
      const before = args.old_string ?? args.old_str
      const after = args.new_string ?? args.new_str
      if (typeof before !== 'string' || typeof after !== 'string') return null
      return { added: lineCountOf(after), removed: lineCountOf(before) }
    }

    /**
     * 把 MCP 公开工具名切成服务器名与原始工具名。
     *
     * 核心明说公开名**不以反解为契约**（长名或非法字符会被截断并加哈希后缀），
     * 所以这里只做「尽力还原」：解析不出来就整串当函数名，绝不因此丢信息。
     *
     * @param name - 形如 `mcp__<server>__<tool>` 的公开名。
     * @returns `{server, tool}`；`server` 可能为空串。
     */
    function splitMcpToolName(name) {
      if (typeof name !== 'string' || !name.startsWith('mcp__')) return { server: '', tool: String(name ?? '') }
      const rest = name.slice('mcp__'.length)
      const separator = rest.indexOf('__')
      if (separator <= 0) return { server: '', tool: rest }
      return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) }
    }

    /** 提问卡的入参规范化：`questions` → `{id, header, question, options}`。 */
    function questionPromptsOf(args) {
      const raw = Array.isArray(args.questions) ? args.questions : []
      const prompts = []
      for (const item of raw) {
        if (item === null || typeof item !== 'object') continue
        const options = Array.isArray(item.options)
          ? item.options.map((option) => {
              if (option === null || typeof option !== 'object') return String(option)
              return typeof option.label === 'string' && option.label !== '' ? option.label : String(option.value ?? '')
            })
          : []
        prompts.push({
          id: typeof item.id === 'string' ? item.id : '',
          header: typeof item.header === 'string' ? item.header : '',
          question: typeof item.question === 'string' ? item.question : '',
          options,
        })
      }
      return prompts
    }

    /** 提问卡的回答：结果是 `JSON.stringify({answers:[{id, selected[], custom?}]})` 的单个文本块。 */
    function questionAnswersOf(output) {
      const parsed = parseJsonSafe(output)
      const answers = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.answers) ? parsed.answers : null
      if (answers === null) return null
      const byId = new Map()
      for (const answer of answers) {
        if (answer === null || typeof answer !== 'object') return null
        if (typeof answer.id !== 'string') return null
        const selected = Array.isArray(answer.selected) ? answer.selected.filter((item) => typeof item === 'string') : []
        byId.set(answer.id, { selected, custom: typeof answer.custom === 'string' ? answer.custom : '' })
      }
      return byId
    }

    /**
     * 收集子 agent 的卡片上下文：结算通知 + 已被卡片消费掉的子会话 id。
     *
     * @param nodes - 全部（已排序的）节点。
     * @returns `{notices, consumed}`。
     */
    function collectSubagentContext(nodes) {
      const notices = collectSubagentNotices(nodes)
      const consumed = new Set()
      for (const node of nodes) {
        const block = toolBlockOfNode(node)
        if (block === null) continue
        if (!isSubagentTool(toolNameOf(block))) continue
        const childId = subagentChildIdOf(contentToText(block.content))
        if (childId !== '') consumed.add(childId)
      }
      return { notices, consumed }
    }

    /**
     * 工具块 → 卡片模型。
     *
     * 每张卡片都带 `status`（四态）与 `output`（结果文本），渲染层据此决定
     * 卡片头显示什么、展开显示什么。
     *
     * **嵌套子调用一律降级成 `plain`**：`subCalls` 里的子结果既没有 `meta` 也没有 `error`，
     * 按专属卡片解析会得到错的退出码与差异数字。核心的第一方卡片同样在这里放弃（见
     * `core-seams.md` §8.6）。
     *
     * @param block - 工具块。
     * @param subagents - 子 agent 上下文（可选）。
     * @returns 卡片模型。
     */
    function toolCardOf(block, subagents) {
      const name = toolNameOf(block)
      const args = toolArgsOf(block)
      const settled = isSettledToolBlock(block)
      const isChild = block !== null && typeof block === 'object' && block.parentCallId !== undefined
      const rawOutput = settled ? contentToText(block.content) : ''
      // 命令类工具的退出码/信号只能从结果文本尾部的标记里解析（结果树里没有这些字段）。
      const outcome = settled && COMMAND_TOOL_NAMES.has(name) ? parseCommandOutcome(rawOutput) : null
      const kind = isChild ? 'plain' : cardKindOfTool(name)
      const card = {
        kind,
        name,
        settled,
        isChild,
        status: toolStatusOf(block, outcome ?? undefined),
        summary: summarizeToolCall(name, args),
        argsRaw: toolArgsRawOf(block),
        args,
        output: outcome === null ? rawOutput : outcome.output,
        isError: settled && block.isError === true,
      }
      if (kind === 'command') {
        card.command = typeof args.command === 'string' ? args.command : card.summary
        // 折叠态只显示「运行的那条命令」的首行（截断），完整命令与输出都在展开体里。
        card.commandShort = firstLineOf(card.command)
        card.exitCode = outcome === null ? undefined : outcome.exitCode
        card.signal = outcome === null ? undefined : outcome.signal
      }
      if (kind === 'file') {
        card.path =
          typeof args.file_path === 'string' && args.file_path !== ''
            ? args.file_path
            : typeof args.path === 'string' && args.path !== ''
              ? args.path
              : card.summary
        card.diff = diffCountsOf(name, args)
        // 折叠态只显示文件名，不显示完整路径（完整路径在展开体的入参里）。
        card.fileName = baseNameOf(card.path)
      }
      if (kind === 'mcp') {
        const split = splitMcpToolName(name)
        card.server = split.server
        card.mcpTool = split.tool
      }
      if (kind === 'question') {
        card.prompts = questionPromptsOf(args)
        card.status = toolErrorCodeOf(block) === 'ask_cancelled' ? 'cancelled' : card.status
        const answers = settled && card.isError !== true ? questionAnswersOf(rawOutput) : null
        card.answered = answers !== null
        card.prompts = card.prompts.map((prompt) => {
          const answer = answers === null ? undefined : answers.get(prompt.id)
          return {
            ...prompt,
            selected: answer === undefined ? [] : answer.selected,
            custom: answer === undefined ? '' : answer.custom,
          }
        })
      }
      if (kind === 'subagent') {
        card.prompt =
          typeof args.prompt === 'string' && args.prompt !== ''
            ? args.prompt
            : typeof args.description === 'string'
              ? args.description
              : ''
        card.background = args.run_in_background !== false
        card.childId = subagentChildIdOf(card.output)
        const notice = card.childId === '' ? undefined : notices?.get(card.childId)
        card.report = notice
        // 三态：还在跑 / 已派出（后台，报告稍后到）/ 已结算。
        if (card.status !== 'running' && notice === undefined && card.childId !== '') card.status = 'started'
        if (notice !== undefined) card.status = 'done'
      }
      return card
    }

    /**
     * 从子 agent 调用的结果文本里取子会话 id。
     *
     * 后台（默认）派发时结果只有一行 `started subagent <uuid>`；前台调用则直接给报告，
     * 取不到 uuid 就返回空串。`started background subagent job <jobId>` 给的是 jobId
     * 而不是子会话 id，所以这里只认 `started subagent`。
     *
     * @param output - 结果文本。
     * @returns 子会话 id，或空串。
     */
    function subagentChildIdOf(output) {
      if (typeof output !== 'string') return ''
      const matched = /^started subagent ([0-9a-fA-F-]{36})/.exec(output.trim())
      return matched === null ? '' : matched[1]
    }

    /**
     * 收集子 agent 结算通知（父会话节点树里唯一的「子 agent 报告」来源）。
     *
     * 子 agent 结算时父会话会收到一条 `user/message`，其 `source.kind === 'subagent-settled'`，
     * 客户端把它渲染成 `context` 节点：`source.summary` 是一行状态，`content` 里是子 agent 的收尾报告。
     * 子 agent 内部的工具调用与思考**不在**父会话节点树里（子会话是独立会话）。
     *
     * @param nodes - 全部（已排序的）节点。
     * @returns `Map<子会话 id, {summary, text}>`。
     */
    function collectSubagentNotices(nodes) {
      const notices = new Map()
      for (const node of nodes) {
        if (node?.kind !== 'context') continue
        const source = node.data?.source
        if (source?.kind !== 'subagent-settled') continue
        const childId = typeof source.senderSessionId === 'string' ? source.senderSessionId : ''
        if (childId === '') continue
        notices.set(childId, {
          summary: typeof source.summary === 'string' ? source.summary : '',
          text: contentToText(node.data?.content),
        })
      }
      return notices
    }

    /**
     * 一段节点里的明细条目，按节点顺序。
     *
     * 条目类型：
     * - `kind:'thinking'` —— 一段推理（含推理块的助手步）→ 「思考」行，展开看原文；
     * - `kind:'tool'` —— 一次工具调用 → 按 `card.kind` 渲染成专属卡片；
     * - `kind:'row'` —— 一行非工具过程（斜杠命令、上下文压缩、重试…）。
     *
     * 只读内置工具（`read` / `grep` 等）也在其中（`card.kind === 'plain'`）：
     * 所有动作都必须能在展开明细里看到，只是没有专属卡片。
     *
     * @param nodes - 一段节点序列。
     * @returns 明细条目数组。
     */
    function processEntries(nodes, subagents) {
      const entries = []
      for (const node of nodes) {
        const block = toolBlockOfNode(node)
        if (block !== null) {
          entries.push({ kind: 'tool', key: node.key, card: toolCardOf(block, subagents) })
          continue
        }
        if (node?.kind === 'assistant-step') {
          const reasoning = assistantReasoningOf(node)
          if (reasoning !== '') entries.push({ kind: 'thinking', key: node.key, text: reasoning })
          continue
        }
        // 已被子 agent 卡片消费的结算通知不再单独占一行（报告显示在卡片里）。
        if (node?.kind === 'context' && subagents !== undefined) {
          const source = node.data?.source
          if (source?.kind === 'subagent-settled' && subagents.consumed.has(source.senderSessionId)) continue
        }
        // 多次上下文注入**合并成一个**可展开的折叠点（用户要求）：一次回合里往往有
        // 规则/记忆/时间/环境多段注入，逐条占行只会把动作列表撑长。
        if (node?.kind === 'context') {
          const text = messageTextOf(node)
          const existing = entries.find((entry) => entry.kind === 'context')
          if (existing === undefined) {
            entries.push({ kind: 'context', key: node.key, titleKey: PROCESS_ROW_TITLES.context, items: [{ key: node.key, text }] })
          } else {
            existing.items.push({ key: node.key, text })
          }
          continue
        }
        const titleKey = PROCESS_ROW_TITLES[node?.kind]
        if (titleKey !== undefined) entries.push({ kind: 'row', key: node.key, nodeKind: node.kind, titleKey })
      }
      return entries
    }

    /**
     * **单个**节点的回退模型。
     *
     * 与 {@link processEntries} 的分工：那一层给「一段」节点做合并与统计（上下文注入并成一条、
     * 被子 agent 卡片消费掉的结算通知不再占行），这一层只回答「这一个节点自己是什么」。
     * 渲染层主路径走核心的原生座位，只有**座位缺席或渲染失败**时才来取这份模型自绘
     * （见 `lib/client/55-native.js`），所以它必须逐节点独立、不做跨节点合并。
     *
     * @param node - 一个对话节点。
     * @param subagents - 子 agent 上下文（可选，取子 agent 报告用）。
     * @returns `{kind, key, …}`，或该节点没有可渲染内容时 `null`。
     */
    function nodeRowOf(node, subagents) {
      const block = toolBlockOfNode(node)
      if (block !== null) return { kind: 'tool', key: node.key, card: toolCardOf(block, subagents) }
      if (node?.kind === 'assistant-step') {
        const text = assistantTextOf(node)
        if (text !== '') return { kind: 'assistant', key: node.key, text }
        const reasoning = assistantReasoningOf(node)
        return reasoning === '' ? null : { kind: 'thinking', key: node.key, text: reasoning }
      }
      if (node?.kind === 'user' || node?.kind === 'steering') {
        const text = messageTextOf(node)
        return text === '' ? null : { kind: 'message', key: node.key, text }
      }
      if (node?.kind === 'context') return { kind: 'context', key: node.key, text: messageTextOf(node) }
      const titleKey = PROCESS_ROW_TITLES[node?.kind]
      return titleKey === undefined ? null : { kind: 'row', key: node.key, nodeKind: node.kind, titleKey }
    }

    /**
     * 把一段节点切成「行」：连续的上下文注入合并成一行（用户要求多次注入只占一个折叠点），
     * 其余每个节点各占一行。合并行的位置＝该段里**第一个**注入节点的位置，顺序不乱。
     *
     * @param nodes - 一段节点（已按呈现序排列）。
     * @returns 行数组：`{kind:'node', node}` 或 `{kind:'contexts', nodes}`。
     */
    function groupProcessNodes(nodes) {
      const rows = []
      let contexts = null
      for (const node of nodes) {
        if (node?.kind === 'context') {
          if (contexts === null) {
            contexts = { kind: 'contexts', nodes: [] }
            rows.push(contexts)
          }
          contexts.nodes.push(node)
          continue
        }
        rows.push({ kind: 'node', node })
      }
      return rows
    }

    /**
     * 统计一段节点里的动作，按新的 5 类分桶。
     *
     * 口径（可逐条核对）：
     * - `thinking`：含推理块的助手步数（一次「思考」算 1 次）；
     * - `command` / `file` / `mcp` / `question`：对应卡片类型的**根**工具调用次数；
     *   `subCalls`（代码分派等嵌套调用）不重复计数；
     * - 其余工具（只读内置、子 agent、未知插件工具）不进 5 项统计，但仍逐条出现在明细里；
     * - `todo_write`（任务列表更新）是分段边界本身，不算任务执行动作。
     *
     * @param nodes - 一段节点序列。
     * @returns `{counts, listed}`。
     */
    function statsOfNodes(nodes, subagents) {
      const counts = { thinking: 0, command: 0, file: 0, mcp: 0, question: 0 }
      const entries = processEntries(nodes, subagents)
      for (const entry of entries) {
        if (entry.kind === 'thinking') {
          counts.thinking += 1
          continue
        }
        if (entry.kind !== 'tool') continue
        const kind = entry.card.kind
        if (kind === 'command' || kind === 'file' || kind === 'mcp' || kind === 'question') counts[kind] += 1
      }
      return { counts, listed: entries.length }
    }

    /**
     * 挑出要显示的统计分段：非零的 5 类，按固定顺序（思考 / 命令 / 编辑文件 / MCP / 提问）。
     *
     * 只返回类别键与计数，**不含任何文案**——文案由渲染点用 `t(...)` 组装（见 `describeStats`）。
     * 值为 0 的类别**完全不显示**（用户明确要求「若为 0 则不显示对应的项」）。
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

    /* ──────────────────────────── 任务列表快照与分段 ──────────────────────────── */

    /**
     * 比较两版任务列表，得出「这一版改了什么」。
     *
     * 已标记完成的任务不再参与比较（用户明确要求「已标记完成的任务就不管了」）：
     * 它在这一版里是 completed，在上一版里也是 completed，就不算变化；
     * 若这一版把它删掉了，也不算变化（它的历史快照已经冻结在之前的分段里）。
     *
     * @param previous - 上一版整表（首版传 `null`）。
     * @param next - 这一版整表。
     * @returns `{added, started, finished, removed}`：各自是任务文字数组。
     */
    function diffTodos(previous, next) {
      const before = new Map((previous ?? []).map((todo) => [todo.content, todo.status]))
      const added = []
      const started = []
      const finished = []
      for (const todo of next) {
        const was = before.get(todo.content)
        if (was === undefined) {
          added.push(todo.content)
          continue
        }
        if (was !== 'completed' && todo.status === 'completed') finished.push(todo.content)
        if (was !== 'in_progress' && todo.status === 'in_progress') started.push(todo.content)
        before.delete(todo.content)
      }
      const removed = []
      for (const [content, status] of before) {
        if (status !== 'completed') removed.push(content)
      }
      return { added, started, finished, removed }
    }

    /** 快照里首个 `in_progress` 的下标；没有则 -1。 */
    function activeIndexOf(todos) {
      for (let index = 0; index < todos.length; index += 1) {
        if (todos[index].status === 'in_progress') return index
      }
      return -1
    }

    /**
     * 把一个回合切成「任务列表快照段」。
     *
     * **这是本项目最关键的语义**（用户当轮要求）：每一次 `todo_write` 都开一个新分段，
     * 并把当时的整表**冻结**成该段的快照。之后渲染只用这份冻结快照，不去问「最新的列表」——
     * 否则对话里每一处列表都显示同一个最新状态，历史进度就失去意义。
     *
     * 由此自然得到「完成一个任务后必须写明下一个任务，才显示下一个节点」：
     * 下一个任务节点属于**下一个分段**，而下一个分段是由那次 `todo_write` 开启的。
     *
     * 没有任何 `todo_write` 的回合退化成 `unplanned`：全部节点留在 `looseNodes`，
     * 渲染层按操作序列折叠（用户明确要求支持这种情况）。
     *
     * @param turn - 回合号。
     * @param inputNode - 触发本回合的用户节点（可能不存在）。
     * @param nodes - 本回合除用户节点外的全部节点。
     * @returns 回合视图模型。
     */
    function buildTurnGroup(turn, inputNode, nodes, subagents, timelineTurn) {
      const planNodes = []
      const segments = []
      const looseNodes = []
      let previousTodos = null
      let current = null
      for (const node of nodes) {
        const todos = todosOfToolCall(node)
        if (todos !== null) {
          current = {
            key: `seg:${turn}:${segments.length}`,
            index: segments.length,
            callKey: node.key,
            callNode: node,
            todos,
            changed: diffTodos(previousTodos, todos),
            isPlan: segments.length === 0,
            nodes: [],
          }
          segments.push(current)
          previousTodos = todos.map((todo) => ({ content: todo.content, status: todo.status }))
          continue
        }
        if (current === null) planNodes.push(node)
        else current.nodes.push(node)
      }

      const planned = segments.length > 0
      for (const segment of segments) {
        const activeIndex = activeIndexOf(segment.todos)
        segment.activeIndex = activeIndex
        segment.activeTask = activeIndex >= 0 ? segment.todos[activeIndex].content : null
        segment.stats = statsOfNodes(segment.nodes, subagents)
        segment.completedCount = segment.todos.filter((todo) => todo.status === 'completed').length
        segment.callCard = toolCardOf(toolBlockOfNode(segment.callNode) ?? {}, subagents)
      }

      // 「此刻正在做的那一项」：某分段点名了 `in_progress`，且**后续任何一次列表更新都没有**把它
      // 标成完成或删掉。这样历史快照照旧冻结，但只有真正还没结束的那一项默认展开——
      // 否则一个长对话里每一段任务都会摊在界面上。
      for (const segment of segments) {
        if (segment.activeTask === null) {
          segment.isCurrentTask = false
          continue
        }
        const superseded = segments
          .slice(segment.index + 1)
          .some(
            (later) =>
              later.changed.finished.includes(segment.activeTask) ||
              later.changed.removed.includes(segment.activeTask),
          )
        segment.isCurrentTask = !superseded
      }

      // 没有任何列表更新：按操作序列折叠。
      if (!planned) for (const node of nodes) looseNodes.push(node)

      // 最后一个分段若是「全部已完成」，它之后的节点属于收尾区；更早的分段永远只管自己那段。
      const last = segments[segments.length - 1]
      const closing = []
      if (last !== undefined && last.activeIndex < 0) {
        for (const node of last.nodes) closing.push(node)
        last.nodes = []
        last.stats = statsOfNodes(last.nodes, subagents)
      }

      // 任务耗时：优先用时间线的回合起止；没有时间线就退化成「该回合节点时间的最大最小值」。
      let startedAt
      let endedAt
      if (timelineTurn !== undefined && timelineTurn.start !== undefined && timelineTurn.end !== undefined) {
        startedAt = timelineTurn.start.time
        endedAt = timelineTurn.end.time
      } else {
        for (const node of nodes) {
          const time = nodeTimeOf(node)
          if (time === undefined) continue
          if (startedAt === undefined || time < startedAt) startedAt = time
          if (endedAt === undefined || time > endedAt) endedAt = time
        }
      }
      const closed = turnClosedOf(nodes, timelineTurn)
      const unfinished = closed && (segments.some((segment) => segment.todos.some((todo) => todo.status === 'in_progress'))
        || processEntries(nodes, subagents).some((entry) => entry.kind === 'tool' && (entry.card.status === 'running' || entry.card.status === 'started')))

      return {
        key: `turn:${turn}`,
        turn,
        input: inputNode,
        closed,
        unfinished,
        durationMs: startedAt === undefined || endedAt === undefined ? null : Math.max(0, endedAt - startedAt),
        inputText: messageTextOf(inputNode),
        planned,
        planNodes,
        segments,
        looseNodes,
        closing,
        subagents,
        stats: statsOfNodes(planned ? nodes : looseNodes, subagents),
      }
    }

    /**
     * 主派生：chat 快照 → 回合分组列表。
     *
     * 一个用户输入开一个分组（这就是「任务处理流」的时间边界）。
     *
     * @param snapshot - `useChat((s) => s)` 拿到的快照。
     * @returns `{turns}`。
     */
    function deriveFlow(snapshot) {
      const nodes = orderedNodes(snapshot)
      // 子 agent 的报告来自稍后的结算通知，所以索引必须建在**整棵节点树**上
      // （通知可能落在下一个回合里），而不是逐个回合去建。
      const subagents = collectSubagentContext(nodes)
      const timelineTurns = snapshot?.timeline?.turns
      const turns = []
      let current = null
      for (const node of nodes) {
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
      return {
        turns: turns.map((item) =>
          buildTurnGroup(item.turn, item.input, item.nodes, subagents, timelineTurns?.get(item.turn)),
        ),
      }
    }
