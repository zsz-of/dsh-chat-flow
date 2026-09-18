    /* ──────────────────────────── 工具名 → 5 类统计 ──────────────────────────── */

    /**
     * 核心工具箱自带的工具名。
     *
     * 用途：把「插件调用」与「内置工具调用」分开。DSH 不给插件工具加强制前缀，
     * 所以只能反过来——枚举核心包自带的名字，不在名单里的工具按「插件提供」计。
     * 名单来自各 `@deepseek-ai/dsh-tool-*` 包里的 `defineTool({ name })`，见
     * `docs/references/core-seams.md`；DSH 升级后新增的内置工具会暂时被算成插件调用，
     * 这是刻意的取舍：宁可把未知归到「插件」，也不要漏掉用户装的插件。
     */
    const CORE_TOOL_NAMES = new Set([
      // 文件读取与检索
      'read', 'read_image', 'glob', 'grep',
      // 网络
      'web_search', 'web_fetch',
      // 任务与计划
      'todo_write', 'exit_plan_mode',
      // 技能 / 子代理 / 工作流 / 目标 / 后台任务
      'skill', 'subagent', 'subagent_fork', 'send_message', 'interrupt_agent', 'list_agents',
      'workflow', 'ralph', 'create_goal', 'get_goal', 'update_goal',
      'job_list', 'job_output', 'job_kill',
      // 运行时与代码执行
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
     * 折叠统计的 5 个类别，**顺序即显示顺序**（编辑文件 / 命令 / 提问 / MCP / 插件）。
     *
     * `core` 不在其中：`read` / `grep` 这类内置只读工具不占用户要看的 5 项统计，
     * 但它们仍然逐条出现在展开后的明细里（验收第 7、9 条要求所有动作都归入「正在处理」）。
     */
    const STAT_CATEGORIES = ['editFile', 'command', 'question', 'mcp', 'plugin']

    /**
     * 类别 → locale 键。
     *
     * 派生层只产出类别键，**中文不在这一层出现**：展示文案一律由渲染点通过 `t(...)` 取，
     * 否则英文界面里会漏出中文（primitives 与 locale 的分工就是这么定的）。
     */
    const CATEGORY_LOCALE_KEYS = {
      editFile: 'flow.category.editFile',
      command: 'flow.category.command',
      question: 'flow.category.question',
      mcp: 'flow.category.mcp',
      plugin: 'flow.category.plugin',
      core: 'flow.category.core',
    }

    /**
     * 把一个工具名归到 5 类之一（外加不参与统计的 `core`）。
     *
     * 判定顺序即优先级：MCP 前缀 → 命令 → 写文件 → 提问 → 核心内置 → 其余按插件。
     * 若某插件把自己的工具取名成 `pwsh`，它会按命令计——DSH 不做工具名去重，
     * 这里的取舍是「按名字分类」，因为名字是界面上唯一能看到的身份。
     *
     * @param name - 工具名，来自节点的 `data.root.call.name`。
     * @returns 类别键（见 {@link STAT_CATEGORIES} 与 `core`）。
     */
    function categoryOfTool(name) {
      if (typeof name !== 'string' || name === '') return 'plugin'
      if (name.startsWith('mcp__')) return 'mcp'
      if (COMMAND_TOOL_NAMES.has(name)) return 'command'
      if (FILE_MUTATION_TOOL_NAMES.has(name)) return 'editFile'
      if (QUESTION_TOOL_NAMES.has(name)) return 'question'
      if (CORE_TOOL_NAMES.has(name)) return 'core'
      return 'plugin'
    }
