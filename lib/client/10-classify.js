    /* ──────────────────────────── 工具名 → 卡片类型与统计 ──────────────────────────── */

    /**
     * 核心工具箱自带的工具名。
     *
     * 用途：把「插件提供的工具」与「核心内置工具」分开。DSH 不给插件工具加强制前缀，
     * 所以只能反过来——枚举核心包自带的名字，不在名单里的按「插件提供」计。
     * 名单来自各 `@deepseek-ai/dsh-tool-*` 包里的 `defineTool({ name })`，见
     * `docs/references/core-seams.md`；DSH 升级后新增的内置工具会暂时被算成插件工具，
     * 这是刻意的取舍：宁可把未知归到「插件」，也不要漏掉用户装的插件。
     */
    const CORE_TOOL_NAMES = new Set([
      'read', 'read_image', 'glob', 'grep',
      'web_search', 'web_fetch',
      'todo_write', 'exit_plan_mode',
      'skill', 'subagent', 'subagent_fork', 'send_message', 'interrupt_agent', 'list_agents',
      'workflow', 'ralph', 'create_goal', 'get_goal', 'update_goal',
      'job_list', 'job_output', 'job_kill',
      'run_code', 'cordis_define', 'cordis_undefine', 'cordis_run', 'cordis_stop',
      'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
    ])

    /** 命令类工具名（与核心 `dsh-tool-pwsh` / `dsh-tool-bash` 的注册名一致）。 */
    const COMMAND_TOOL_NAMES = new Set(['pwsh', 'bash'])

    /** 写/改文件类工具名（`dsh-tool-fs` 的 `write`/`edit` 与 `dsh-tool-str-replace-editor`）。 */
    const FILE_MUTATION_TOOL_NAMES = new Set(['write', 'edit', 'str_replace_editor'])

    /** 向用户提问的工具名（`dsh-tool-ask-user`）。 */
    const QUESTION_TOOL_NAMES = new Set(['ask_user_question'])

    /**
     * 是否派生子 agent 的工具。
     *
     * 与核心同规则（`CHAT:1363-1365`：`name === 'subagent' || name.startsWith('subagent_')`）——
     * 工具名由部署配置决定，`subagent_codex` / `subagent_claude_code` 这类也在同一族里。
     *
     * @param name - 工具名。
     * @returns 是否子 agent 工具。
     */
    function isSubagentTool(name) {
      return name === 'subagent' || name.startsWith('subagent_')
    }

    /**
     * 折叠统计的 5 个类别，**顺序即显示顺序**；计数为 0 的类别不显示。
     *
     * 与最初版本的口径差别（用户当轮要求）：去掉「插件」，加入「思考次数」。
     * 只读内置工具（`read` / `grep` 等）仍不进入统计，但逐条出现在展开明细里。
     */
    const STAT_CATEGORIES = ['thinking', 'command', 'file', 'mcp', 'question']

    /**
     * 类别 → locale 键。
     *
     * 派生层只产出类别键，**中文不在这一层出现**：展示文案一律由渲染点通过 `t(...)` 取，
     * 否则英文界面里会漏出中文（primitives 与 locale 的分工就是这么定的）。
     */
    const CATEGORY_LOCALE_KEYS = {
      thinking: 'flow.category.thinking',
      command: 'flow.category.command',
      file: 'flow.category.file',
      mcp: 'flow.category.mcp',
      question: 'flow.category.question',
    }

    /**
     * 工具名 → 卡片类型。卡片类型决定这一条操作长什么样、展开后显示什么。
     *
     * 判定顺序即优先级；`plain` 是兜底（一行标题 + 摘要，展开显示 JSON 入参与结果文本）。
     *
     * @param name - 工具名。
     * @returns `'subagent' | 'mcp' | 'command' | 'file' | 'question' | 'plain'`。
     */
    function cardKindOfTool(name) {
      if (typeof name !== 'string' || name === '') return 'plain'
      if (isSubagentTool(name)) return 'subagent'
      if (name.startsWith('mcp__')) return 'mcp'
      if (COMMAND_TOOL_NAMES.has(name)) return 'command'
      if (FILE_MUTATION_TOOL_NAMES.has(name)) return 'file'
      if (QUESTION_TOOL_NAMES.has(name)) return 'question'
      return 'plain'
    }

    /**
     * 工具名归类（图标与调试用）。
     *
     * @param name - 工具名。
     * @returns 卡片类型，或 `'core'` / `'plugin'`（无专属卡片的工具）。
     */
    function categoryOfTool(name) {
      const card = cardKindOfTool(name)
      if (card !== 'plain') return card
      return CORE_TOOL_NAMES.has(name) ? 'core' : 'plugin'
    }
