/**
 * 本文件由 scripts/build-client.mjs 自动生成，请勿直接编辑。
 * 源码分片（按拼接顺序）：
 *   - lib/client/00-head.js
 *   - lib/client/05-locale.js
 *   - lib/client/10-classify.js
 *   - lib/client/20-derive.js
 *   - lib/client/30-collapse.js
 *   - lib/client/40-style.js
 *   - lib/client/50-nodes.js
 *   - lib/client/60-process.js
 *   - lib/client/70-turn.js
 *   - lib/client/75-rail.js
 *   - lib/client/80-view.js
 *   - lib/client/85-scroll.js
 *   - lib/client/99-tail.js
 *
 * 修改流程：改 lib/client/*.js → node scripts/build-client.mjs
 */

/**
 * `dsh-chat-flow` client —— 任务主视图：把扁平对话重组成「计划 → 任务列表 → 子对话」，
 * 并把任务执行期间的一切动作折进可展开的「正在处理」统计块。
 *
 * **本文件由 `lib/client/*.js` 拼接生成**（`node scripts/build-client.mjs`），不要直接改它：
 * DSH 只按 `exports["./client"]` 提供一个 URL（`/plugins/<包名>/client.js`），物理上必须单文件；
 * 拼接式构建让源码仍按领域分片、每片都能单读。
 *
 * 浏览器侧是 `window.__ModuleLoader__.load` 手写的 CJS 风格 bundle（零第三方依赖）：
 * `react` 与 `@deepseek-ai/dsh-client-ui-primitives` 由宿主的冻结模块表提供（平台 seed word）。
 *
 * 数据来源是本插件的关键设计：整棵对话节点树经 ui-chat 的 `uiSession.provide({hooks:['chat']})`
 * 作为标准 hook 暴露给**所有** session 作用域条目，因此本视图用 `props.useChat` 就能拿到它，
 * 不需要 fork 核心渲染器、不读 DOM、也不需要 host 再算一份数据。
 */

window.__ModuleLoader__.load({
  id: 'dsh-chat-flow',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { useState, useEffect, useMemo, useCallback, useRef } = react
    const h = react.createElement

    /** 客户端插件依赖的服务：插槽表、本地化、会话绑定（拉更早的历史用）。 */
    const inject = ['slots', 'locale', 'sessions']

    /** locale namespace 与样式 tag 都必须是全局唯一的（不同插件共用同一张注册表）。 */
    const NS = 'chat-flow'
    const STYLE_ID = 'dsh-chat-flow-style'
    const COLLAPSE_KEY = 'dsh-chat-flow.collapse'

    /** 核心对话视图的 id：视图选择的 fallback 硬编码为它，因此想当默认视图只能认领这个 id。 */
    const CHAT_VIEW_ID = 'chat'
    const CHAT_VIEW_ORDER = 0

    /**
     * 遮蔽核心条目的优先级：同单元格上 **priority 最小者**渲染。
     * 核心条目是 0，因此 -1 即可接管，且两者不同 priority 时并存不冲突（冲突只判同 id 同 priority）。
     */
    const SHADOW_PRIORITY = -1

    /** JSON 安全序列化：`payload` 里可能有循环引用或 BigInt，序列化失败不能把整块视图带崩。 */
    function safeStringify(value) {
      try {
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }

    /* 以下四个是 primitives 缺失时的退路：DSH 升级若改名或移除某个原语，
       视图仍然可读，而不是整块变成 `data-slot-error`。 */
    function PlainText({ text }) {
      return h('div', { className: 'dcf-text' }, String(text ?? ''))
    }
    function PlainJson({ payload }) {
      return h('pre', { className: 'dcf-pre' }, safeStringify(payload))
    }
    function PlainTerminal({ command, output }) {
      const text = `${command ?? ''}${output ? `\n\n${output}` : ''}`
      return h('pre', { className: 'dcf-pre' }, text)
    }
    function PlainDot({ className }) {
      return h('span', { className: className ?? 'dcf-dot dcf-dot-pending' })
    }

    /** 取 primitives 里的组件，拿不到就用退路。 */
    function componentOr(candidate, fallback) {
      if (typeof candidate === 'function') return candidate
      if (candidate !== null && typeof candidate === 'object') return candidate
      return fallback
    }

    const MarkdownText = componentOr(primitives.MarkdownText, PlainText)
    const MessageText = componentOr(primitives.MessageText, PlainText)
    const JsonBlock = componentOr(primitives.JsonBlock, PlainJson)
    const TerminalBlock = componentOr(primitives.TerminalBlock, PlainTerminal)
    const StateDot = componentOr(primitives.StateDot, PlainDot)
    /* ──────────────────────────── 文案 ──────────────────────────── */

    /**
     * 中英文字典。
     *
     * 界面文案归 `ctx.locale` 所有（核心的既定分工：primitives 是零 locale 的原子组件，
     * 每段面向用户的文案都由渲染点通过 label prop 提供）。视图组件从插槽 kit 拿到的 `t`
     * 就是绑定到 {@link NS} 的这个字典。
     *
     * 值必须是**字符串模板**：`translate` 用 `/\{(\w+)\}/g` 做插值，函数值不会被调用。
     * 插值参数写成单花括号，缺键时 `t` 回落成键名本身（因此键名也要能看懂）。
     * 中英两份的键集必须完全一致（`client-locale.test.js` 强制）。
     */
    const ZH = {
      'view.flow': '任务',
      'flow.empty': '这个会话还没有可显示的内容。',
      'flow.loadOlder': '加载更早的历史',
      'flow.rail': '回合导航',
      'flow.rail.jump': '跳到第 {turn} 轮',
      'flow.rail.jumpLoad': '加载并跳到第 {turn} 轮',

      'flow.plan': '规划过程',
      'flow.tasks': '任务列表',
      'flow.tasksSummary': '{total} 项 · {done} 已完成',
      'flow.tasksUpdate': '第 {index} 次更新',
      'flow.tasksChanged': '本次变化：{text}',

      'flow.status.pending': '未开始',
      'flow.status.in_progress': '进行中',
      'flow.status.completed': '已完成',
      'flow.status.running': '运行中',
      'flow.status.done': '已完成运行',
      'flow.status.failed': '运行失败',
      'flow.status.cancelled': '已取消',
      'flow.status.started': '已派出',

      'flow.category.thinking': '思考',
      'flow.category.command': '命令',
      'flow.category.file': '编辑文件',
      'flow.category.mcp': 'MCP',
      'flow.category.question': '提问',

      'flow.thinking.live': '思考中',
      'flow.thinking.done': '已思考完成',
      'flow.loadingOlder': '正在加载更早的内容…',
      'flow.context.count': '{count} 段注入',
      'flow.noOps': '无操作',
      'flow.ops': '{count} 个操作',

      'flow.row.systemPrompt': '系统提示词',
      'flow.row.context': '上下文注入',
      'flow.row.command': '斜杠命令',
      'flow.row.compaction': '上下文压缩',
      'flow.row.manualCompaction': '手动压缩',
      'flow.row.modelRetry': '模型重试',
      'flow.row.turnError': '本轮出错',
      'flow.row.maxTokens': '达到 token 上限',
      'flow.row.unknown': '未识别事件',

      'flow.card.input': '输入',
      'flow.card.output': '输出',
      'flow.card.result': '返回值',
      'flow.card.answer': '回答',
      'flow.card.waiting': '等待回答…',
      'flow.card.diffNote': '本次改动',
      'flow.card.subagent': '子 agent',
      'flow.card.awaitReport': '已派出子会话，报告稍后到达',

      'flow.copy': '复制',
      'flow.copied': '已复制',
      'flow.footnotes': '脚注',
      'flow.collapse': '收起',
      'flow.expandRest': '展开其余 {count} 行',
      'flow.collapseAria': '收起',
      'flow.expandAria': '展开其余 {count} 行',
      'flow.noOutput': '（无输出）',
      'flow.exitCode': '退出码 {code}',
      'flow.signal': '信号 {signal}',
    }

    const EN = {
      'view.flow': 'Tasks',
      'flow.empty': 'Nothing to show in this session yet.',
      'flow.loadOlder': 'Load earlier history',
      'flow.rail': 'Turn navigation',
      'flow.rail.jump': 'Jump to turn {turn}',
      'flow.rail.jumpLoad': 'Load and jump to turn {turn}',

      'flow.plan': 'Planning',
      'flow.tasks': 'Tasks',
      'flow.tasksSummary': '{total} tasks · {done} done',
      'flow.tasksUpdate': 'Update {index}',
      'flow.tasksChanged': 'Changed: {text}',

      'flow.status.pending': 'Not started',
      'flow.status.in_progress': 'In progress',
      'flow.status.completed': 'Done',
      'flow.status.running': 'Running',
      'flow.status.done': 'Finished',
      'flow.status.failed': 'Failed',
      'flow.status.cancelled': 'Cancelled',
      'flow.status.started': 'Dispatched',

      'flow.category.thinking': 'Thoughts',
      'flow.category.command': 'Commands',
      'flow.category.file': 'Files edited',
      'flow.category.mcp': 'MCP',
      'flow.category.question': 'Questions',

      'flow.thinking.live': 'Thinking',
      'flow.thinking.done': 'Thought',
      'flow.loadingOlder': 'Loading earlier history…',
      'flow.context.count': '{count} injections',
      'flow.noOps': 'No operations',
      'flow.ops': '{count} operations',

      'flow.row.systemPrompt': 'System prompt',
      'flow.row.context': 'Injected context',
      'flow.row.command': 'Slash command',
      'flow.row.compaction': 'Compaction',
      'flow.row.manualCompaction': 'Manual compaction',
      'flow.row.modelRetry': 'Model retry',
      'flow.row.turnError': 'Turn error',
      'flow.row.maxTokens': 'Token limit reached',
      'flow.row.unknown': 'Unknown event',

      'flow.card.input': 'Input',
      'flow.card.output': 'Output',
      'flow.card.result': 'Return value',
      'flow.card.answer': 'Answer',
      'flow.card.waiting': 'Waiting for answer…',
      'flow.card.diffNote': 'this change',
      'flow.card.subagent': 'Subagent',
      'flow.card.awaitReport': 'Subagent dispatched; report arrives later',

      'flow.copy': 'Copy',
      'flow.copied': 'Copied',
      'flow.footnotes': 'Footnotes',
      'flow.collapse': 'Collapse',
      'flow.expandRest': 'Show {count} more lines',
      'flow.collapseAria': 'Collapse',
      'flow.expandAria': 'Show {count} more lines',
      'flow.noOutput': '(no output)',
      'flow.exitCode': 'exit code {code}',
      'flow.signal': 'signal {signal}',
    }

    /** Markdown 原子组件要的 chrome 文案（primitives 自己不持有语言回退）。 */
    function markdownLabels(t) {
      return {
        code: { copyLabel: t('flow.copy'), copiedLabel: t('flow.copied') },
        footnotes: t('flow.footnotes'),
      }
    }

    /** 终端卡片要的 chrome 文案，键名与 `TerminalBlock` 的 labels 契约一一对应。 */
    function terminalLabels(t) {
      return {
        signal: (signal) => t('flow.signal', { signal }),
        exitCode: (code) => t('flow.exitCode', { code }),
        running: t('flow.status.running'),
        failed: t('flow.status.failed'),
        done: t('flow.status.done'),
        copy: t('flow.copy'),
        copied: t('flow.copied'),
        noOutput: t('flow.noOutput'),
        collapseAria: t('flow.collapseAria'),
        collapse: t('flow.collapse'),
        expandAria: (count) => t('flow.expandAria', { count }),
        expand: (count) => t('flow.expandRest', { count }),
      }
    }
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
    function buildTurnGroup(turn, inputNode, nodes, subagents) {
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

      return {
        key: `turn:${turn}`,
        turn,
        input: inputNode,
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
      return { turns: turns.map((item) => buildTurnGroup(item.turn, item.input, item.nodes, subagents)) }
    }
    /* ──────────────────────────── 折叠状态 ──────────────────────────── */

    /**
     * 折叠/展开状态按「会话 + 块键」存进 localStorage。
     *
     * 验收第 2 条要求折叠状态「刷新后不还原」，所以必须落盘；块键形如
     * `plan:3` / `task:3:1` / `proc:3:1`，同一会话里每个块各自记住自己的状态。
     *
     * localStorage 在隐私模式或被策略禁用时会抛异常，此时退回进程内对象：
     * 功能降级成「本页会话内有效」，但绝不因为存储不可用而白屏。
     */
    const collapseStore = new Map()

    /**
     * 读取并缓存某个会话的折叠表。
     *
     * @param sessionId - 会话 id。
     * @returns `{map, listeners}`；`map` 是块键 → 是否展开。
     */
    function collapseEntry(sessionId) {
      let entry = collapseStore.get(sessionId)
      if (entry !== undefined) return entry
      let map = {}
      try {
        const raw = window.localStorage.getItem(`${COLLAPSE_KEY}.${sessionId}`)
        const parsed = raw === null ? null : JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object') map = parsed
      } catch {
        // 存储不可用：退化成纯内存，行为与用户选的「仅当前会话」一致。
      }
      entry = { map, listeners: new Set() }
      collapseStore.set(sessionId, entry)
      return entry
    }

    /** 把折叠表写回 localStorage；写失败不抛（内存里的状态仍然正确）。 */
    function persistCollapse(sessionId, map) {
      try {
        window.localStorage.setItem(`${COLLAPSE_KEY}.${sessionId}`, JSON.stringify(map))
      } catch {
        // 同上：存储不可用时静默降级。
      }
    }

    /**
     * 一个可折叠块的受控状态。
     *
     * @param sessionId - 会话 id（作用域）。
     * @param blockKey - 块键，会话内唯一。
     * @param defaultOpen - 没有存过状态时的默认值。
     * @returns `[open, toggle]`。
     */
    function useCollapse(sessionId, blockKey, defaultOpen) {
      const entry = collapseEntry(sessionId)
      const [, forceRender] = useState(0)
      useEffect(() => {
        const listener = () => forceRender((value) => value + 1)
        entry.listeners.add(listener)
        return () => {
          entry.listeners.delete(listener)
        }
      }, [sessionId, blockKey])
      const stored = entry.map[blockKey]
      const open = typeof stored === 'boolean' ? stored : defaultOpen
      const toggle = useCallback(() => {
        entry.map[blockKey] = !(typeof entry.map[blockKey] === 'boolean' ? entry.map[blockKey] : defaultOpen)
        persistCollapse(sessionId, entry.map)
        for (const listener of entry.listeners) listener()
      }, [sessionId, blockKey, defaultOpen])
      return [open, toggle]
    }
    /* ──────────────────────────── 样式 ──────────────────────────── */

    /**
     * 一次性注入样式表。
     *
     * 颜色与字号全部走主题 token（`--dsw-*` / `--dsh-*`），不写死色值，
     * 这样浅色/深色主题与用户字号设置都会自动跟随。
     * 类名前缀 `dcf-` 是本插件私有（DSH 里各插件的 `<style>` 是全局的，前缀撞车会互相污染）。
     *
     * 布局分三层，这是右侧导轨能工作的前提：
     * - `.dcf-root` 是块级满宽容器（**不带** max-width）；
     * - `.dcf-rail-slot` 是**零高 sticky 槽**，占满宽度、钉在滚动视口顶部，只在里面绝对定位出导轨；
     * - `.dcf-main` 才是阅读列（限宽 + 居中 + 左右留白让开导轨）。
     *
     * 视觉层次（用户要求「分出主次、该加背景板就加」）：
     * 背景板 = 任务列表快照 `.dcf-plate`；卡片 = 一次操作 `.dcf-card`；
     * 「思考中/思考完成」是容器的标题行，不加板，只靠左侧竖线与缩进表达从属关系。
     */
    const FLOW_CSS = `
.dcf-root{display:block;width:100%;padding:14px 0 8px;box-sizing:border-box;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}
.dcf-main{display:flex;flex-direction:column;gap:14px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:0 30px;box-sizing:border-box}
.dcf-empty{color:var(--dsw-alias-label-tertiary);padding:8px 2px}
.dcf-hint{color:var(--dsw-alias-label-tertiary);font-size:13px;background:0 0;border:none;cursor:pointer;text-align:left;padding:4px 2px}
.dcf-hint:hover{color:var(--dsw-alias-label-secondary)}
.dcf-loading{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:6px 2px}
.dcf-spinner{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-secondary);animation:dcf-spin .8s linear infinite}
@keyframes dcf-spin{to{transform:rotate(360deg)}}
.dcf-turn{display:flex;flex-direction:column;gap:10px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px;scroll-margin-top:12px}
.dcf-turn:first-child{border-top:none;padding-top:0}
.dcf-ask{display:flex;justify-content:flex-end}
.dcf-ask .dcf-bubble{background:var(--dsw-specific-bubble);border-radius:18px;padding:9px 14px;max-width:min(82%,640px);white-space:pre-wrap;word-break:break-word}
.dcf-block{display:flex;flex-direction:column;gap:6px}
.dcf-note{color:var(--dsw-alias-label-caption);font-size:12px}
.dcf-text{overflow-wrap:anywhere}
.dcf-text p{margin:0 0 8px}
.dcf-text p:last-child{margin-bottom:0}
.dcf-pre{margin:0;padding:8px 10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border-radius:6px;overflow:auto;max-height:280px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary)}

/* 行：可折叠的一行标题。整行是按钮（触摸目标 ≥ 32px），hover 才给底色。 */
.dcf-row{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-row:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:1px}
.dcf-row[data-static=true]{cursor:default}
.dcf-row[data-static=true]:hover{background:0 0}
.dcf-chev{flex:none;width:14px;height:14px;margin-top:4px;color:var(--dsw-alias-label-caption);transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.dcf-chev[data-open=true]{transform:rotate(90deg)}
.dcf-title{flex:none;color:var(--dsw-alias-label-secondary)}
.dcf-summary{min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-count{flex:none;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.dcf-badge{flex:none;color:var(--dsw-alias-label-caption);font-size:12px;font-variant-numeric:tabular-nums}
.dcf-body{display:flex;flex-direction:column;gap:6px;padding:2px 0 4px 22px}

/* 折叠动画：grid-template-rows 0fr ↔ 1fr，不需要 JS 量高度。
   子树**保持挂载**（与核心的稳定 seat 同思路）：卸载会丢掉嵌套块的展开状态，
   进出也会退化成「瞬间替换」。收起时用 visibility 把子树的 Tab 焦点一并摘掉。 */
.dcf-fold{display:grid;grid-template-rows:0fr;visibility:hidden;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear .22s}
.dcf-fold[data-open=true]{grid-template-rows:1fr;visibility:visible;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear 0s}
.dcf-fold>*{min-height:0;overflow:hidden}

/* 任务列表快照面板（背景板）：一次列表更新一块，冻结当时的状态。 */
.dcf-plate{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.06));border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:2px}
.dcf-platehead{display:flex;align-items:center;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:8px;padding:6px 8px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-platehead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-platetitle{flex:none;color:var(--dsw-alias-label-secondary);font-weight:500}
.dcf-platebody{display:flex;flex-direction:column;gap:1px;padding:2px 8px 6px 26px}
.dcf-change{color:var(--dsw-alias-label-caption);font-size:12px;padding:2px 0 4px}

/* 任务行：快照里的项与「子任务」折叠体共用一套状态样式。 */
.dcf-tasks{display:flex;flex-direction:column;gap:2px}
.dcf-task{display:flex;flex-direction:column;gap:2px}
.dcf-taskrow{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
button.dcf-taskrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-taskrow[data-status=completed] .dcf-tasktitle{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dcf-taskrow[data-status=in_progress] .dcf-tasktitle{color:var(--dsw-alias-label-primary);font-weight:500}
.dcf-taskrow[data-status=pending] .dcf-tasktitle{color:var(--dsw-alias-label-secondary)}
.dcf-dot{flex:none;margin-top:6px}
.dcf-dot-pending{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);display:inline-block}
.dcf-tasktitle{min-width:0;flex:1 1 auto;overflow-wrap:anywhere}

/* 「思考中 / 思考完成」：容器的标题行 + 左侧竖线表达从属，不加背景板（不与卡片抢层级）。 */
.dcf-thinking{display:flex;flex-direction:column;gap:2px}
.dcf-thinkinghead{border-left:2px solid var(--dsw-alias-border-l2)}
.dcf-thinking[data-live=true] .dcf-thinkinghead{border-left-color:var(--dsw-alias-label-primary)}
.dcf-thinkingtitle{flex:none;color:var(--dsw-alias-label-secondary);font-weight:500}
/* 浮动光效：一道高光在文字上循环扫过，用来表达「还在处理」。 */
.dcf-thinkingtitle[data-shimmer=true]{background-image:linear-gradient(100deg,var(--dsw-alias-label-tertiary) 0%,var(--dsw-alias-label-tertiary) 38%,var(--dsw-alias-label-primary) 50%,var(--dsw-alias-label-tertiary) 62%,var(--dsw-alias-label-tertiary) 100%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dcf-shimmer 1.8s linear infinite}
@keyframes dcf-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}

/* 卡片：一次操作的背景板。头部一行，展开体在里面。 */
.dcf-card{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.06));border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.dcf-card[data-live=true]{border-color:var(--dsw-alias-label-tertiary)}
.dcf-cardhead{display:flex;align-items:center;gap:8px;width:100%;min-width:0;background:0 0;border:none;padding:6px 10px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-cardhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-cardhead:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:-2px}
.dcf-cardicon{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-secondary)}
.dcf-cardtitle{flex:none;color:var(--dsw-alias-label-secondary)}
.dcf-cardsummary{min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-primary);font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-cardbody{display:flex;flex-direction:column;gap:6px;padding:0 10px 10px 10px}

/* 状态徽标：同一套色调语义给所有卡片复用。 */
.dcf-chip{flex:none;border-radius:999px;padding:1px 8px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12));color:var(--dsw-alias-label-tertiary)}
.dcf-chip[data-tone=ok]{color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=err]{color:var(--dsw-alias-state-error-label,var(--dsw-alias-label-primary))}
.dcf-chip[data-tone=warn]{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=live]{color:var(--dsw-alias-label-primary)}
.dcf-chip[data-tone=add]{color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=del]{color:var(--dsw-alias-state-error-label,var(--dsw-alias-label-primary))}
.dcf-chip[data-tone=muted]{opacity:.7}

/* 提问卡：问题 + 选项（被选中的那项高亮）。 */
.dcf-question{display:flex;flex-direction:column;gap:2px}
.dcf-questiontext{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.dcf-option{color:var(--dsw-alias-label-tertiary);font-size:13px;padding-left:14px;position:relative}
.dcf-option::before{content:'·';position:absolute;left:4px}
.dcf-option[data-chosen=true]{color:var(--dsw-alias-label-primary);font-weight:500}
.dcf-option[data-chosen=true]::before{content:'✓'}

/* 右侧回合导轨：粘在滚动视口顶部的零高槽里，绝对定位出竖向刻度条。 */
.dcf-rail-slot{position:sticky;top:0;z-index:7;height:0;pointer-events:none}
.dcf-rail{--dcf-rail-band:calc(var(--dsh-conversation-viewport-height,100dvh) - var(--dsh-composer-height,152px));position:absolute;right:6px;top:calc(var(--dcf-rail-band) / 2);transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;padding:6px 0;max-height:min(420px,max(0px,calc(var(--dcf-rail-band) - 80px)));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;pointer-events:auto}
.dcf-rail::-webkit-scrollbar{display:none}
.dcf-mark{position:relative;flex:none;width:22px;height:10px;padding:0;border:0;background:0 0;cursor:pointer}
.dcf-mark::before{content:'';position:absolute;top:50%;right:0;transform:translateY(-50%);width:12px;height:2px;border-radius:2px;background:var(--dsw-alias-border-l4);transition:width .14s ease,background-color .14s ease}
.dcf-mark:hover::before{background:var(--dsw-alias-label-tertiary);width:18px}
.dcf-mark[data-active=true]::before{background:var(--dsw-alias-label-primary);width:20px}
.dcf-mark[data-loaded=false]::before{width:8px;opacity:.55}
.dcf-mark[data-busy=true]::before{animation:dcf-mark-live 1s ease-in-out infinite}
.dcf-mark .dcf-spinner{position:absolute;top:50%;right:2px;transform:translateY(-50%);width:10px;height:10px}
.dcf-mark[data-live=true]::before{animation:dcf-mark-live 1s ease-in-out infinite}
.dcf-mark:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px;border-radius:4px}
@keyframes dcf-mark-live{0%,100%{opacity:1}50%{opacity:.35}}

/* 窄屏 / 手机：阅读列收窄内边距、导轨变细并让位、触摸目标加大、避开安全区。
   导轨**不隐藏**——它是这个视图的主要导航；只把它压细并给内容留出右侧空间。 */
@media (max-width:720px){
.dcf-root{padding:10px 0 8px}
.dcf-main{gap:12px;padding:0 20px 0 12px}
.dcf-rail{right:2px;gap:10px;max-height:min(320px,max(0px,calc(var(--dcf-rail-band) - 48px)))}
.dcf-mark{width:24px;height:20px}
.dcf-mark::before{width:12px;height:3px;border-radius:2px}
.dcf-mark[data-active=true]::before{width:14px}
.dcf-ask .dcf-bubble{max-width:100%}
.dcf-summary{max-width:42vw}
.dcf-cardhead,.dcf-platehead{padding:9px 10px}
button.dcf-row,button.dcf-taskrow{min-height:34px;align-items:center}
.dcf-chev{margin-top:0}
.dcf-dot{margin-top:0}
.dcf-cardsummary{font-size:12px}
.dcf-pre{max-height:220px;font-size:11px}
.dcf-cardbody{padding:0 10px 10px 10px}
.dcf-body{padding:2px 0 4px 14px}
.dcf-platebody{padding:2px 8px 6px 16px}
}

/* 触屏设备：去掉只对鼠标有意义的悬浮反馈，避免点击后残留 hover 态。 */
@media (hover:none){
.dcf-rail{right:0;gap:12px}
.dcf-mark{width:34px;height:24px}
.dcf-mark::before{width:16px;height:3px}
.dcf-mark[data-active=true]::before{width:20px}
.dcf-row:hover,button.dcf-taskrow:hover,.dcf-cardhead:hover,.dcf-platehead:hover{background:0 0}
.dcf-mark:hover::before{width:12px;background:var(--dsw-alias-border-l4)}
}

/* 动效收敛：尊重系统的「减少动态效果」。 */
@media (prefers-reduced-motion:reduce){
.dcf-fold,.dcf-fold[data-open=true],.dcf-chev,.dcf-mark::before{transition:none}
.dcf-mark[data-live=true]::before{animation:none}
.dcf-thinkingtitle[data-shimmer=true]{animation:none;background-image:none;color:inherit}
}
`

    /** 注入样式：按固定 id 去重，重复调用不会堆 `<style>`。 */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = FLOW_CSS
      document.head.appendChild(style)
    }
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
    /* ──────────────────────────── 「思考中 / 思考完成」块 ──────────────────────────── */

    /**
     * 把统计分段拼成一行本地化文本。
     *
     * 文案组装放在**渲染层**而不是派生层：派生层只认类别键，中文/英文由 `t` 决定。
     * **计数为 0 的类别完全不显示**（用户明确要求）；5 类全为 0 时退化成「无操作」。
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
     * 「思考中 / 思考完成」块：一段处理过程的折叠容器。
     *
     * - 标题随状态切换：还在跑 = **思考中**（带浮动光效），跑完 = **思考完成**（用户当轮要求）；
     * - 折叠时只显示 5 项统计（思考 / 命令 / 编辑文件 / MCP / 提问，0 值不显示）；
     * - 默认展开条件 = 这段过程所属的任务/回合正在进行；结束后自动收起。
     *
     * @param props - `blockKey`、`entries`、`stats`、`t`、`sessionId`、`active`、`labels`。
     * @returns 折叠块。
     */
    function ThinkingBlock({ blockKey, entries, stats, t, sessionId, active, labels }) {
      const [open, toggle] = useCollapse(sessionId, blockKey, active === true)
      const body = []
      for (const entry of entries) {
        if (entry.kind === 'tool') {
          body.push(
            h(ToolCard, { key: `t:${entry.key}`, card: entry.card, t, sessionId, labels, keyPrefix: `op:${entry.key}` }),
          )
        } else if (entry.kind === 'context') {
          body.push(h(ContextEntry, { key: `c:${entry.key}`, entry, t, sessionId }))
        } else if (entry.kind === 'thinking') {
          body.push(h(ThinkingEntry, { key: `k:${entry.key}`, entry, t, sessionId }))
        } else {
          body.push(h(ProcessRowEntry, { key: `r:${entry.key}`, entry, t }))
        }
      }
      const title = active === true ? t('flow.thinking.live') : t('flow.thinking.done')
      return h(
        'div',
        { className: 'dcf-thinking', 'data-live': active === true ? 'true' : 'false' },
        h(
          'button',
          { type: 'button', className: 'dcf-row dcf-thinkinghead', 'aria-expanded': open === true, onClick: toggle },
          h(Chevron, { open }),
          h('span', { className: 'dcf-thinkingtitle', 'data-shimmer': active === true ? 'true' : 'false' }, title),
          // 折叠点后面不加数字（用户要求）：统计本身就说明了这一段做了什么。
          h('span', { className: 'dcf-summary' }, describeStats(stats, t)),
        ),
        h(Fold, { open, className: 'dcf-body' }, body),
      )
    }

    /** 节点是否直接显示在对话流里（用户发言与助手正文）；其余都进「思考」块。 */
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
     * 渲染一段节点：先是一块汇总的「思考中/思考完成」，再按顺序渲染直接显示的内容。
     *
     * 为什么把动作汇总成一块而不是按位置穿插：一段任务里绝大多数节点都是动作，
     * 穿插会让「任务 → 子对话」的层级被动作行冲散；汇总成一块后，一个任务的展开体
     * 永远是「思考中（统计）→ 卡片 → 助手说了什么」这个可预期的形状。
     *
     * @param props - `nodes`、`blockKey`、`t`、`sessionId`、`labels`、`active`。
     * @returns 节点序列；没有任何可显示内容时返回 `null`。
     */
    function NodeSequence({ nodes, blockKey, t, sessionId, labels, active, subagents }) {
      const entries = useMemo(() => processEntries(nodes, subagents), [nodes, subagents])
      const inline = useMemo(() => nodes.filter(isInlineNode), [nodes])
      const stats = useMemo(() => statsOfNodes(nodes), [nodes])
      if (entries.length === 0 && inline.length === 0) return null
      const children = []
      if (entries.length > 0) {
        children.push(h(ThinkingBlock, { key: 'thinking', blockKey, entries, stats, t, sessionId, active, labels }))
      }
      for (const node of inline) children.push(h(InlineNode, { key: node.key, node, labels }))
      return h('div', { className: 'dcf-block' }, children)
    }
    /* ──────────────────────────── 计划 / 任务列表快照 / 子任务 ──────────────────────────── */

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
     * 首个 `todo_write` 调用本身不在这里重复成一行明细——它的内容就是那份清单。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`。
     * @returns 折叠分组；该回合没有规划阶段时返回 `null`。
     */
    function PlanGroup({ group, t, sessionId, labels, live }) {
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
        }),
        h(
          'div',
          { key: 'plan-draft', className: 'dcf-platebody' },
          ...first.todos.map((todo, index) =>
            h(
              'div',
              { key: `draft:${index}`, className: 'dcf-taskrow', 'data-status': todo.status },
              h(TaskDot, { status: todo.status }),
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
    function SnapshotPlate({ segment, t, sessionId, defaultOpen }) {
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
            h(TaskDot, { status: todo.status }),
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
     * @param props - `segment`、`t`、`sessionId`、`labels`、`live`。
     * @returns 子任务折叠体；该分段没有进行中的任务时返回 `null`。
     */
    function TaskFold({ segment, t, sessionId, labels, live, subagents }) {
      const [open, toggle] = useCollapse(sessionId, `task:${segment.key}`, live === true)
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
          h(TaskDot, { status: 'in_progress' }),
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
            active: live,
            subagents: subagents,
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
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`。
     * @returns 回合块。
     */
    function TurnGroup({ group, t, sessionId, labels, live }) {
      const children = []
      if (group.inputText !== '') children.push(h(UserBubble, { key: 'ask', text: group.inputText }))
      if (group.planned) {
        if (group.planNodes.length > 0) {
          children.push(h(PlanGroup, { key: 'plan', group, t, sessionId, labels, live }))
        }
        const lastIndex = group.segments.length - 1
        for (const segment of group.segments) {
          children.push(
            h(SnapshotPlate, {
              key: `plate:${segment.key}`,
              segment,
              t,
              sessionId,
              defaultOpen: segment.index === lastIndex,
            }),
          )
          const fold = h(TaskFold, { key: `task:${segment.key}`, segment, t, sessionId, labels, live, subagents: group.subagents })
          if (fold !== null) children.push(fold)
          // 该分段没有进行中的任务时，它自己的节点（如果有）直接显示，不挂在任何任务下。
          if (segment.activeTask === null && segment.nodes.length > 0) {
            children.push(
              h(NodeSequence, {
                key: `seq:${segment.key}`,
                nodes: segment.nodes,
                blockKey: `proc:${segment.key}`,
                t,
                sessionId,
                labels,
                active: live,
                subagents: group.subagents,
              }),
            )
          }
        }
        children.push(
          h(NodeSequence, {
            key: 'closing',
            nodes: group.closing,
            blockKey: `proc:closing:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
            subagents: group.subagents,
          }),
        )
      } else {
        children.push(
          h(NodeSequence, {
            key: 'loose',
            nodes: group.looseNodes,
            blockKey: `proc:loose:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
            subagents: group.subagents,
          }),
        )
      }
      return h(
        'div',
        { className: 'dcf-turn', 'data-turn': String(group.turn), 'data-turn-anchor': String(group.turn) },
        children,
      )
    }
    /* ──────────────────────────── 右侧回合导轨 ──────────────────────────── */

    /**
     * 把「已加载的回合」与 `turnOutline` 投影合并成导轨刻度。
     *
     * 这是核心 `mergeTurnRailItems`（`CHAT:1829-1858`）的同构实现：
     * `turnOutline` 是**全集**（含未加载回合，带 `turn` 与 `seq`），已加载的回合覆盖同名项，
     * 结果按 `turn` 升序。`seq` 是 `turn/start` 事件的 seq，也就是 `loadThrough` 的翻页目标。
     *
     * @param outline - `useProjection('turnOutline')` 的值：`{turn, seq, prompt, response}[]`，或 `undefined`。
     * @param loadedTurns - 本视图自己派生出的回合号数组。
     * @returns `{turn, loaded, seq}[]`，按 turn 升序。
     */
    function mergeRailItems(outline, loadedTurns) {
      const byTurn = new Map()
      if (Array.isArray(outline)) {
        for (const entry of outline) {
          if (entry === null || typeof entry !== 'object') continue
          if (!Number.isSafeInteger(entry.turn) || entry.turn < 0) continue
          if (!Number.isSafeInteger(entry.seq) || entry.seq < 0) continue
          byTurn.set(entry.turn, {
            turn: entry.turn,
            loaded: false,
            seq: entry.seq,
            summary: typeof entry.prompt === 'string' ? entry.prompt : '',
          })
        }
      }
      for (const turn of loadedTurns) {
        const previous = byTurn.get(turn)
        byTurn.set(turn, {
          turn,
          loaded: true,
          seq: previous?.seq ?? null,
          summary: previous?.summary ?? '',
        })
      }
      return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
    }

    /**
     * 右侧刻度条：每个回合一个刻度，点击跳到该回合（一次对话）的开头。
     *
     * 结构与核心的 `TurnNavigator` 同构但**不共用代码**（它没有任何公开导出）：
     * 一个**零高 sticky 槽**钉在滚动视口顶部，里面绝对定位出竖向刻度条。
     * 这样滚动时导轨始终停在视口里，刻度数与内容高度无关（不需要按比例定位）。
     *
     * 刻度分两种：
     * - **已加载**（`data-loaded="true"`）→ 点击直接滚动到该回合；
     * - **未加载**（`data-loaded="false"`，淡显）→ 点击先翻页加载到它，期间该刻度显示加载动画
     *   （`data-busy="true"`），加载完成后自动滚到位。
     *
     * 只有一个刻度时也渲染（它可能是唯一的一个未加载刻度）。没有可跳目标时返回 `null`。
     *
     * @param props - `items`、`activeTurn`、`liveTurn`、`busyTurn`、`onJump`、`t`。
     * @returns 导轨。
     */
    function TurnRail({ items, activeTurn, liveTurn, busyTurn, onJump, t }) {
      if (!Array.isArray(items) || items.length === 0) return null
      // 只有一个刻度且它已加载 = 没有可跳的目标（也没有更早的历史），不渲染。
      if (items.length < 2 && items.every((item) => item.loaded === true)) return null
      return h(
        'div',
        { className: 'dcf-rail-slot' },
        h(
          'div',
          { className: 'dcf-rail', role: 'navigation', 'aria-label': t('flow.rail') },
          ...items.map((item) => {
            const busy = item.turn === busyTurn
            const label = t(item.loaded === true ? 'flow.rail.jump' : 'flow.rail.jumpLoad', { turn: item.turn })
            return h(
              'button',
              {
                key: String(item.turn),
                type: 'button',
                className: 'dcf-mark',
                'data-loaded': item.loaded === true ? 'true' : 'false',
                'data-busy': busy === true ? 'true' : 'false',
                'data-active': item.turn === activeTurn ? 'true' : 'false',
                'data-live': item.turn === liveTurn ? 'true' : 'false',
                'aria-busy': busy === true ? 'true' : undefined,
                'aria-current': item.turn === activeTurn ? 'true' : undefined,
                title: label,
                'aria-label': label,
                onClick: () => {
                  if (typeof onJump === 'function') onJump(item)
                },
              },
              busy === true ? h('span', { className: 'dcf-spinner' }) : null,
            )
          }),
        ),
      )
    }
    /* ──────────────────────────── 任务主视图 ──────────────────────────── */

    /** 取整份快照的选择器：引用稳定，避免每次渲染都重新订阅。 */
    function identitySelector(value) {
      return value
    }

    /**
     * 跳到某个回合（一次对话）的开头。
     *
     * 用 `scrollIntoView` 而不是自己算 `scrollTop`：滚动宿主是 shell 的，它的 padding、
     * header 与 sticky 顶栏都由 shell 决定，交给浏览器算才不会偏。
     * 系统开了「减少动态效果」时用瞬时跳转，与 CSS 里的动效收敛保持一致。
     *
     * @param root - 本视图根节点。
     * @param turn - 目标回合号。
     * @returns 无。
     */
    function jumpToTurn(root, turn) {
      if (root === null || root === undefined || typeof root.querySelector !== 'function') return
      const target = root.querySelector(`[data-turn-anchor="${turn}"]`)
      if (target === null || typeof target.scrollIntoView !== 'function') return
      const reduced =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    }

    /**
     * 任务视图主体（真正调用 hook 的地方）。
     *
     * 数据来源全部是**标准 props**，不读 DOM 取业务数据、不开自有数据通道：
     * - `useChat` 由 ui-chat 通过 `uiSession.provide({hooks:['chat']})` 提供，是整棵对话节点树；
     * - `useSession` 由 ui-session 内置源提供，用来判断 `running` / `hasMore` / `loadingOlder`；
     * - `t` 来自本条目声明的 `locale`；
     * - `loadOlder` 来自本条目自己的 `inject`。
     *
     * 布局分两层：外层是满宽块（承载右侧导轨的 sticky 槽），内层 `.dcf-main` 才是限宽阅读列。
     *
     * @param props - 见上。
     * @returns 任务流 + 右侧回合导轨。
     */
    function FlowBody({ sessionId, useChat, useSession, useProjection, t, loadOlder, loadThrough }) {
      const rootRef = useRef(null)
      const snapshot = useChat(identitySelector)
      const flow = useMemo(() => deriveFlow(snapshot), [snapshot])
      const labels = useMemo(() => markdownLabels(t), [t])
      const session = useSession(identitySelector)

      const running = session?.running === true
      const turns = useMemo(() => flow.turns.map((group) => group.turn), [flow])
      /** 正在跑的回合：它的默认展开态与导轨上的呼吸刻度都用它。 */
      const liveTurn = running && turns.length > 0 ? turns[turns.length - 1] : null
      /**
       * 窗口头部的 seq 代理值（核心同款）：取第一条可见节点的 `anchorSeq`。
       * 这不是真正的窗口起点 seq（`Session.baseSeq` 是私有的、不进快照），
       * 所以它只用来判断「目标 seq 是否可能已被窗口覆盖」，落位时还有兜底分支。
       */
      const firstSeq =
        snapshot.order.length === 0 ? null : (snapshot.nodes.get(snapshot.order[0])?.anchorSeq ?? null)

      /**
       * 导轨刻度 = `turnOutline` 投影（全集，含未加载回合）∪ 本视图已加载的回合。
       *
       * `turnOutline` 由 `dsh-session-turn-outline` 注册（key `turnOutline`，wire 值是数组，
       * 每项 `{turn, seq, prompt, response}`；`seq` 是该轮 `turn/start` 的 seq，即翻页目标）。
       * 投影缺失时退化成「只显示已加载的回合」。
       */
      const outline = typeof useProjection === 'function' ? useProjection('turnOutline') : undefined
      const railItems = useMemo(() => mergeRailItems(outline, turns), [outline, turns])

      const { activeTurn, busyTurn, onJump } = useScroller(rootRef, {
        turns,
        hasMore: session?.hasMore,
        loadingOlder: session?.loadingOlder,
        loadOlder,
        loadThrough,
        firstSeq,
      })

      const main = []
      if (session?.hasMore === true || session?.loadingOlder === true) {
        // 加载中显示动画而不是按钮：用户不需要点，滚到顶部就会自动开始加载。
        main.push(
          session.loadingOlder === true
            ? h(
                'div',
                { key: 'loading-older', className: 'dcf-loading', 'data-dcf-load-anchor': 'true' },
                h('span', { className: 'dcf-spinner' }),
                h('span', null, t('flow.loadingOlder')),
              )
            : h(
                'button',
                {
                  key: 'load-older',
                  type: 'button',
                  className: 'dcf-hint',
                  'data-dcf-load-anchor': 'true',
                  onClick: () => {
                    if (typeof loadOlder === 'function') loadOlder()
                  },
                },
                t('flow.loadOlder'),
              ),
        )
      }
      if (flow.turns.length === 0) {
        main.push(h('div', { key: 'empty', className: 'dcf-empty' }, t('flow.empty')))
      }
      for (const group of flow.turns) {
        main.push(
          h(TurnGroup, {
            key: group.key,
            group,
            t,
            sessionId,
            labels,
            live: group.turn === liveTurn,
          }),
        )
      }

      return h(
        'div',
        { className: 'dcf-root', ref: rootRef, 'data-chat-flow-owner': 'dsh-chat-flow' },
        h(TurnRail, { items: railItems, activeTurn, liveTurn, busyTurn, onJump, t }),
        h('div', { className: 'dcf-main' }, main),
      )
    }

    /**
     * 任务视图：`conversation.view` 的 `chat` 单元格得主。
     *
     * 这一层只做能力探测——`useChat` 是 ui-chat 提供的，如果那个包不在装配里，
     * 视图给出空态而不是抛异常（插槽条目崩溃会被判定为让位，整块变 `data-slot-error`，
     * 那是比空态差得多的用户体验）。
     *
     * @param props - 插槽 kit + owner props。
     * @returns 任务视图。
     */
    function TaskFlowView(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const ready = typeof props.useChat === 'function' && typeof props.useSession === 'function'
      if (!ready) return h('div', { className: 'dcf-empty' }, t('flow.empty'))
      return h(FlowBody, { ...props, t })
    }
    /* ──────────────────────────── 滚动行为 ──────────────────────────── */

    /** 距顶部多少像素以内算「触顶」。留一点余量，滚轮惯性到不了 0 也能触发。 */
    const TOP_LOAD_THRESHOLD_PX = 64

    /** 跳到某个回合时，在滚动口顶部留出的空隙（核心的 landOnRow 硬编码 24px，这里用同一量级）。 */
    const RAIL_LAND_OFFSET_PX = 24

    /**
     * 绑定真实的滚动宿主，负责两件事：**触顶自动加载更早的历史**、**跟踪当前回合**。
     *
     * 几个必须说明的取舍：
     * 1. **滚动宿主是 shell 的，不是本视图的**。核心把会话体包在 `[data-conversation-scroll]`
     *    里（`ui-conversation` 的 scrollBody），所以这里用 `closest()` 向上找它，
     *    而不是自己再套一个滚动容器——套两层会出现嵌套滚动条。
     * 2. **防重复触发用「先离开顶部」的闸门**（`armedRef`），而不是时间冷却。
     *    加载后修正滚动位置本身会引起一次 scroll 事件，没有闸门就会自己触发自己，
     *    一路把所有历史拉完。闸门语义：只有「曾经滚到阈值以下、又回到顶部」才算一次新的触顶。
     * 3. **位置锚定**：加载更早的内容会把旧内容往下推。这里记住第一个回合元素的视口位置，
     *    内容变长后把差值补回 `scrollTop`，读者眼睛停在原处。
     *    如果浏览器原生 scroll anchoring 已经处理了，差值≈0，这一步就是空操作——两者不冲突。
     * 4. 度量放在 rAF 里做（一次滚动只量一帧），因为读 `getBoundingClientRect` 会强制布局。
     *
     * @param rootRef - 本视图根节点的 ref（滚动宿主由它向上找）。
     * @param options - `turns`（回合号数组）、`hasMore`、`loadingOlder`、`loadOlder`。
     * @returns `{activeTurn}`：当前视口顶部所在回合的编号。
     */
    function useScroller(rootRef, options) {
      const [activeTurn, setActiveTurn] = useState(null)
      const [busyTurn, setBusyTurn] = useState(null)
      const [pendingJump, setPendingJump] = useState(null)
      const [settleTick, setSettleTick] = useState(0)
      /** 每次渲染刷新一次的最新值快照：事件监听只装一次，但要读到最新状态。 */
      const latest = useRef(options)
      latest.current = options
      const scrollerRef = useRef(null)
      const armedRef = useRef(true)
      const anchorRef = useRef(null)
      /** 防死循环：同一个窗口头只允许再翻一次（核心的 `jumpRepageHeadRef` 同款）。 */
      const repagedRef = useRef(null)
      /** 上一个 `loadingOlder`：用来在它落回 false 时补一次落位尝试。 */
      const wasPagingRef = useRef(options.loadingOlder === true)

      useEffect(() => {
        const root = rootRef.current
        if (root === null || root === undefined || typeof root.closest !== 'function') return undefined
        const scroller = root.closest('[data-conversation-scroll]') ?? root.parentElement ?? root
        scrollerRef.current = scroller
        let frame = 0

        const measure = () => {
          frame = 0
          const anchors = root.querySelectorAll('[data-turn-anchor]')
          if (anchors.length === 0) return
          const hostTop = scroller.getBoundingClientRect().top
          let current = Number(anchors[0].getAttribute('data-turn-anchor'))
          for (const anchor of anchors) {
            if (anchor.getBoundingClientRect().top - hostTop > TOP_LOAD_THRESHOLD_PX) break
            current = Number(anchor.getAttribute('data-turn-anchor'))
          }
          setActiveTurn((previous) => (previous === current ? previous : current))
        }

        const onScroll = () => {
          if (frame === 0 && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(measure)
          else measure()

          const state = latest.current
          // 闸门用「加载锚点（按钮或加载提示）还在不在视口里」判定：
          // 锚点滚出视口（用户在读下面的内容）→ 重新武装；锚点回到视口（用户滚到最上面）
          // → 触发一次加载。这比裸的 scrollTop 阈值更贴近用户看到的东西。
          const anchor = root.querySelector('[data-dcf-load-anchor]')
          const scrollerTop = scroller.getBoundingClientRect().top
          const visible = anchor === null ? scroller.scrollTop <= TOP_LOAD_THRESHOLD_PX : anchor.getBoundingClientRect().bottom >= scrollerTop
          if (visible !== true) {
            armedRef.current = true
            return
          }
          if (armedRef.current !== true) return
          if (state.hasMore !== true || state.loadingOlder === true) return
          if (typeof state.loadOlder !== 'function') return
          armedRef.current = false
          const first = root.querySelector('[data-turn-anchor]')
          anchorRef.current = first === null ? null : {
            turn: first.getAttribute('data-turn-anchor'),
            top: first.getBoundingClientRect().top,
          }
          state.loadOlder()
        }

        measure()
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
          scroller.removeEventListener('scroll', onScroll)
          scrollerRef.current = null
          if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        }
      }, [rootRef])

      // 内容变长后把阅读位置钉回原处（见上文第 3 点）。
      useEffect(() => {
        const anchor = anchorRef.current
        if (anchor === null) return
        anchorRef.current = null
        const root = rootRef.current
        const scroller = scrollerRef.current
        if (root === null || root === undefined || scroller === null) return
        const target = root.querySelector(`[data-turn-anchor="${anchor.turn}"]`)
        if (target === null) return
        const delta = target.getBoundingClientRect().top - anchor.top
        if (delta !== 0) scroller.scrollTop += delta
      }, [rootRef, options.turns])

      /**
       * 点一个刻度。
       *
       * 已加载 → 直接滚过去；未加载 → 记下目标（`pendingJump`）并把刻度置为加载态，
       * 然后 `loadThrough(seq)` 翻页。**完成判定不靠 promise**（它永不 reject，失败也 resolve），
       * 而靠「目标回合变成了已加载」这个渲染事实（见下面的落位 effect）。
       */
      const onJump = useCallback(
        (item) => {
          if (item === null || typeof item !== 'object') return
          if (item.loaded === true) {
            jumpToTurn(rootRef.current, item.turn)
            return
          }
          const loadThrough = latest.current.loadThrough
          if (typeof loadThrough !== 'function' || item.seq === null) return
          const root = rootRef.current
          const first = root === null || root === undefined ? null : root.querySelector('[data-turn-anchor]')
          if (first !== null) {
            anchorRef.current = { turn: first.getAttribute('data-turn-anchor'), top: first.getBoundingClientRect().top }
          }
          repagedRef.current = null
          setBusyTurn(item.turn)
          setPendingJump({ turn: item.turn, seq: item.seq })
          Promise.resolve(loadThrough(item.seq)).then(() => setSettleTick((tick) => tick + 1))
        },
        [rootRef],
      )

      // `loadThrough` 在 `loadingOlder` 已被普通加载占用时会**立即 resolve 而不排队**，
      // 所以必须在它落回 false 时再补一次落位尝试（核心用同样的 tick 机制）。
      useEffect(() => {
        const paging = options.loadingOlder === true
        if (wasPagingRef.current === true && paging === false && pendingJump !== null) {
          setSettleTick((tick) => tick + 1)
        }
        wasPagingRef.current = paging
      }, [options.loadingOlder, pendingJump])

      /**
       * 落位：目标回合一渲染出来就滚到它。
       *
       * 三层兜底（顺序与核心一致）：① 目标回合已是已加载且能找到锚点 → 落位收尾；
       * ② 窗口还没覆盖目标 seq（`firstSeq > seq`）→ 允许**再翻一次**（同一个窗口头只翻一次，防死循环）；
       * ③ 都失败时退化成「滚到第一个 turn ≥ 目标的回合」。
       */
      useEffect(() => {
        if (pendingJump === null) return
        const root = rootRef.current
        const scroller = scrollerRef.current
        if (root === null || root === undefined || scroller === null) return
        const land = (row) => {
          const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - RAIL_LAND_OFFSET_PX
          if (delta !== 0) scroller.scrollTop += delta
        }
        const settle = () => {
          setPendingJump(null)
          setBusyTurn(null)
        }
        const row = root.querySelector(`[data-turn-anchor="${pendingJump.turn}"]`)
        if (row !== null) {
          land(row)
          settle()
          return
        }
        const state = latest.current
        const firstSeq = state.firstSeq
        if (state.hasMore === true && (firstSeq === null || firstSeq === undefined || firstSeq > pendingJump.seq)) {
          if (state.loadingOlder === true) return
          if (repagedRef.current !== firstSeq) {
            repagedRef.current = firstSeq
            const loadThrough = state.loadThrough
            if (typeof loadThrough === 'function') {
              Promise.resolve(loadThrough(pendingJump.seq)).then(() => setSettleTick((tick) => tick + 1))
              return
            }
          }
        }
        const rows = root.querySelectorAll('[data-turn-anchor]')
        for (const candidate of rows) {
          const turn = Number(candidate.getAttribute('data-turn-anchor'))
          if (Number.isSafeInteger(turn) && turn >= pendingJump.turn) {
            land(candidate)
            break
          }
        }
        settle()
      }, [settleTick, pendingJump, rootRef])

      return { activeTurn, busyTurn, onJump }
    }
    /* ──────────────────────────── 插件接线 ──────────────────────────── */

    /**
     * 注册任务视图。
     *
     * **为什么是 `id: 'chat'` + `priority: -1`**：视图选择的 fallback 在核心里硬编码为
     * 「存储的偏好 → id === 'chat' → 否则不渲染」，`order` 再小都不会成为默认
     * （见 `docs/references/core-seams.md`）。插槽对「同 id 同 priority」判冲突，对
     * 「同 id 不同 priority」判遮蔽——**最小 priority 渲染**，所以 -1 就能接管这个单元格：
     * 默认视图天然落在任务视图上，用户点过「轨迹」等其它视图后仍可用标签切回来。
     *
     * 代价（已在执行计划里记录）：核心条目无法注销，标签栏会多出一个同样指向本视图的
     * 「对话」标签。
     *
     * @param ctx - 客户端插件上下文。
     * @returns 无。
     */
    function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'chat-flow: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: CHAT_VIEW_ID,
            order: CHAT_VIEW_ORDER,
            priority: SHADOW_PRIORITY,
            label: () => t('view.flow'),
            locale: NS,
            inject: (sessionId) => ({
              sessionId,
              /**
               * 拉更早的历史页。
               *
               * 会话 binding 可能已经释放（切走会话的竞态），因此取不到时静默返回——
               * 按钮点一下没反应，比抛异常把整块视图打成错误态要好。
               */
              loadOlder: () => {
                try {
                  ctx.sessions.binding(sessionId)?.session.loadOlder()
                } catch {
                  // 会话已释放：忽略这次点击。
                }
              },
              /**
               * 翻页加载到指定 seq（导轨点未加载回合用）。
               *
               * 与 `loadOlder` 的差别：它内部**循环**加载直到窗口覆盖该 seq（每页 200 条），
               * 全程把 `loadingOlder` 置真，且返回的 promise **永不 reject**（失败也 resolve）。
               * 因此调用方不能拿「promise 完成」当成功，必须回看目标回合是否已加载。
               */
              loadThrough: (seq) => {
                try {
                  return ctx.sessions.binding(sessionId)?.session.loadThrough(seq) ?? Promise.resolve()
                } catch {
                  // 会话已释放：立即 resolve，调用方按「没加载到」处理。
                  return Promise.resolve()
                }
              },
            }),
          },
          TaskFlowView,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    /**
     * 测试接缝：纯函数与常量直接暴露，node 侧测试不必模拟整套插槽就能验证派生逻辑，
     * 也能逐字断言注册参数（id / priority / order）。
     */
    exports.__internals = {
      CHAT_VIEW_ID,
      CHAT_VIEW_ORDER,
      SHADOW_PRIORITY,
      NS,
      ZH,
      EN,
      categoryOfTool,
      cardKindOfTool,
      statsOfNodes,
      statsSummary,
      describeStats,
      summarizeToolCall,
      diffCountsOf,
      parseCommandOutcome,
      toolStatusOf,
      toolCardOf,
      processEntries,
      deriveFlow,
      orderedNodes,
      todosOfToolCall,
      diffTodos,
      assistantTextOf,
      markdownLabels,
      terminalLabels,
      installStyles,
      jumpToTurn,
      TOP_LOAD_THRESHOLD_PX,
      useScroller,
      mergeRailItems,
      FLOW_CSS,
      views: {
        TaskFlowView,
        FlowBody,
        TurnGroup,
        TurnRail,
        SnapshotPlate,
        TaskFold,
        PlanGroup,
        ThinkingBlock,
        NodeSequence,
        Fold,
        ToolCard,
        Card,
        DisclosureLine,
        UserBubble,
        AssistantText,
      },
    }
    return module.exports
  },
})
