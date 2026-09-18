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
     */
    const ZH = {
      'view.flow': '任务',
      'flow.empty': '这个会话还没有可显示的内容。',
      'flow.loadOlder': '加载更早的历史',
      'flow.plan': '规划过程',
      'flow.planDraft': '计划初稿',
      'flow.tasks': '任务列表',
      'flow.tasksSummary': '{total} 项 · {done} 已完成',
      'flow.status.pending': '未开始',
      'flow.status.in_progress': '进行中',
      'flow.status.completed': '已完成',
      'flow.category.editFile': '编辑文件',
      'flow.category.command': '命令',
      'flow.category.question': '提问',
      'flow.category.mcp': 'MCP',
      'flow.category.plugin': '插件',
      'flow.category.core': '其他',
      'flow.processing': '正在处理',
      'flow.noOps': '无操作',
      'flow.ops': '{count} 个操作',
      'flow.thinking': '思考',
      'flow.rail': '回合导航',
      'flow.rail.jump': '跳到第 {turn} 轮',
      'flow.args': '入参',
      'flow.output': '结果',
      'flow.planUpdate': '计划更新',
      'flow.copy': '复制',
      'flow.copied': '已复制',
      'flow.footnotes': '脚注',
      'flow.collapse': '收起',
      'flow.expandRest': '展开其余 {count} 行',
      'flow.collapseAria': '收起',
      'flow.expandAria': '展开其余 {count} 行',
      'flow.noOutput': '（无输出）',
      'flow.running': '运行中',
      'flow.failed': '失败',
      'flow.done': '已完成',
      'flow.exitCode': '退出码 {code}',
      'flow.signal': '信号 {signal}',
    }

    const EN = {
      'view.flow': 'Tasks',
      'flow.empty': 'Nothing to show in this session yet.',
      'flow.loadOlder': 'Load earlier history',
      'flow.plan': 'Planning',
      'flow.planDraft': 'Initial plan',
      'flow.tasks': 'Tasks',
      'flow.tasksSummary': '{total} tasks · {done} done',
      'flow.status.pending': 'Not started',
      'flow.status.in_progress': 'In progress',
      'flow.status.completed': 'Done',
      'flow.category.editFile': 'Files edited',
      'flow.category.command': 'Commands',
      'flow.category.question': 'Questions',
      'flow.category.mcp': 'MCP',
      'flow.category.plugin': 'Plugins',
      'flow.category.core': 'Other',
      'flow.processing': 'Working',
      'flow.noOps': 'No operations',
      'flow.ops': '{count} operations',
      'flow.thinking': 'Thought',
      'flow.rail': 'Turn navigation',
      'flow.rail.jump': 'Jump to turn {turn}',
      'flow.args': 'Input',
      'flow.output': 'Result',
      'flow.planUpdate': 'Plan updated',
      'flow.copy': 'Copy',
      'flow.copied': 'Copied',
      'flow.footnotes': 'Footnotes',
      'flow.collapse': 'Collapse',
      'flow.expandRest': 'Show {count} more lines',
      'flow.collapseAria': 'Collapse',
      'flow.expandAria': 'Show {count} more lines',
      'flow.noOutput': '(no output)',
      'flow.running': 'Running',
      'flow.failed': 'Failed',
      'flow.done': 'Done',
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
        running: t('flow.running'),
        failed: t('flow.failed'),
        done: t('flow.done'),
        copy: t('flow.copy'),
        copied: t('flow.copied'),
        noOutput: t('flow.noOutput'),
        collapseAria: t('flow.collapseAria'),
        collapse: t('flow.collapse'),
        expandAria: (count) => t('flow.expandAria', { count }),
        expand: (count) => t('flow.expandRest', { count }),
      }
    }
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
     * 若把导轨与内容放进同一个限宽列，它就只能贴内容右缘而不是窗口右缘，宽窗口下会显得很怪
     * （核心的 TurnNavigator 也是把槽放在限宽列外面的）。
     */
    const FLOW_CSS = `
.dcf-root{display:block;width:100%;padding:14px 0 8px;box-sizing:border-box;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}
.dcf-main{display:flex;flex-direction:column;gap:14px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:0 30px;box-sizing:border-box}
.dcf-empty{color:var(--dsw-alias-label-tertiary);padding:8px 2px}
.dcf-hint{color:var(--dsw-alias-label-tertiary);font-size:13px;background:0 0;border:none;cursor:pointer;text-align:left;padding:4px 2px}
.dcf-hint:hover{color:var(--dsw-alias-label-secondary)}
.dcf-turn{display:flex;flex-direction:column;gap:10px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px;scroll-margin-top:12px}
.dcf-turn:first-child{border-top:none;padding-top:0}
.dcf-ask{display:flex;justify-content:flex-end}
.dcf-ask .dcf-bubble{background:var(--dsw-specific-bubble);border-radius:18px;padding:9px 14px;max-width:min(82%,640px);white-space:pre-wrap;word-break:break-word}
.dcf-block{display:flex;flex-direction:column;gap:6px}
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
.dcf-body{display:flex;flex-direction:column;gap:6px;padding:2px 0 4px 22px}
.dcf-panel{border-left:2px solid var(--dsw-alias-border-l2);padding-left:10px;display:flex;flex-direction:column;gap:6px}
.dcf-plan-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}
.dcf-tasks{display:flex;flex-direction:column;gap:2px}
.dcf-task{display:flex;flex-direction:column;gap:2px}
.dcf-taskrow{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-taskrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-taskrow[data-status=completed] .dcf-tasktitle{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dcf-taskrow[data-status=in_progress] .dcf-tasktitle{color:var(--dsw-alias-label-primary);font-weight:500}
.dcf-taskrow[data-status=pending] .dcf-tasktitle{color:var(--dsw-alias-label-secondary)}
.dcf-dot{flex:none;margin-top:6px}
.dcf-dot-pending{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);display:inline-block}
.dcf-tasktitle{min-width:0;flex:1 1 auto;overflow-wrap:anywhere}
.dcf-badge{flex:none;color:var(--dsw-alias-label-caption);font-size:12px;font-variant-numeric:tabular-nums}
.dcf-text{overflow-wrap:anywhere}
.dcf-text p{margin:0 0 8px}
.dcf-text p:last-child{margin-bottom:0}
.dcf-pre{margin:0;padding:8px 10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border-radius:6px;overflow:auto;max-height:280px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dcf-foot{color:var(--dsw-alias-label-caption);font-size:12px;padding-top:2px}

/* 折叠动画：grid-template-rows 0fr ↔ 1fr 是不需要 JS 量高度的平滑方案。
   子树**保持挂载**（与核心的稳定 seat 同思路）：卸载会丢掉嵌套块的展开状态，
   进出也会退化成「瞬间替换」。收起时用 visibility 把子树的 Tab 焦点一并摘掉，
   并把这一步推迟到动画结束（0s 延迟 + 动画时长）。 */
.dcf-fold{display:grid;grid-template-rows:0fr;visibility:hidden;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear .22s}
.dcf-fold[data-open=true]{grid-template-rows:1fr;visibility:visible;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear 0s}
.dcf-fold>*{min-height:0;overflow:hidden}

/* 右侧回合导轨：粘在滚动视口顶部的零高槽里，绝对定位出竖向刻度条。 */
.dcf-rail-slot{position:sticky;top:0;z-index:7;height:0;pointer-events:none}
.dcf-rail{--dcf-rail-band:calc(var(--dsh-conversation-viewport-height,100dvh) - var(--dsh-composer-height,152px));position:absolute;right:6px;top:calc(var(--dcf-rail-band) / 2);transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;padding:6px 0;max-height:min(420px,max(0px,calc(var(--dcf-rail-band) - 80px)));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;pointer-events:auto}
.dcf-rail::-webkit-scrollbar{display:none}
.dcf-mark{position:relative;flex:none;width:22px;height:10px;padding:0;border:0;background:0 0;cursor:pointer}
.dcf-mark::before{content:'';position:absolute;top:50%;right:0;transform:translateY(-50%);width:12px;height:2px;border-radius:2px;background:var(--dsw-alias-border-l4);transition:width .14s ease,background-color .14s ease}
.dcf-mark:hover::before{background:var(--dsw-alias-label-tertiary);width:18px}
.dcf-mark[data-active=true]::before{background:var(--dsw-alias-label-primary);width:20px}
.dcf-mark[data-live=true]::before{animation:dcf-mark-live 1s ease-in-out infinite}
.dcf-mark:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px;border-radius:4px}
@keyframes dcf-mark-live{0%,100%{opacity:1}50%{opacity:.35}}

/* 动效收敛：尊重系统的「减少动态效果」。 */
@media (prefers-reduced-motion:reduce){
.dcf-fold,.dcf-fold[data-open=true],.dcf-chev,.dcf-mark::before{transition:none}
.dcf-mark[data-live=true]::before{animation:none}
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
     * 折叠容器：子树**始终挂载**，只切换 CSS grid 轨道高度（`0fr ↔ 1fr`）并过渡。
     *
     * 三个设计点：
     * 1. **不卸载子树**——卸载会丢掉嵌套块的展开状态（例如展开的任务里那个展开的「正在处理」），
     *    也会让进出动画退化成瞬间替换；核心的 `ChatNodeSeat` 同样奉行「稳定 seat、只隐藏不卸载」。
     * 2. **不量高度**——`grid-template-rows` 的过渡由浏览器插值，无需 `useLayoutEffect` +
     *    `scrollHeight`，内容流式增长时也不会抖。
     * 3. **收起时摘掉焦点**——CSS 里用 `visibility: hidden`（延迟到动画结束）把子树从 Tab 顺序里摘出去，
     *    否则收起的子树里那些按钮仍会被键盘走到。
     *
     * @param props - `open`（是否展开）、`className`（内层类名，承载 padding/gap）、`children`。
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
     * 一行「可展开」的行：整行是按钮，展开后在下方显示内容。
     *
     * 交互与核心的工具行一致（点整行切换、`aria-expanded` 可读），因为这两处是同一个心智模型：
     * 先看一行摘要，需要时再展开看明细。
     * 不可展开的行走**纯文本行**（`div`）而不是 disabled 按钮——它是一条标签，不是一个失效控件。
     * 展开体一律经 {@link Fold}，因此每一行的进出都带同一套动画。
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
      return h('div', { className: 'dcf-block' }, row, h(Fold, { open }, children))
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
    /* ──────────────────────────── 「正在处理」折叠块 ──────────────────────────── */

    /**
     * 把 {@link statsSummary} 的分段拼成一行本地化文本。
     *
     * 文案组装放在**渲染层**而不是派生层：派生层只认类别键，中文/英文由 `t` 决定，
     * 这样英文界面里不会漏出中文。5 类全为 0 时退化成操作总数（有操作）或「无操作」。
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
     * 一段节点里的动作折成的「正在处理」块。
     *
     * 折叠时**只**显示统计（验收第 8 条）：编辑文件 / 命令 / 提问 / MCP / 插件 各多少次，
     * 计数为 0 的类别省略（沿用核心过程折叠的呈现约定），5 项全为 0 时退化成「N 个操作」。
     * 展开后逐条列出（验收第 9 条）：一行一条，每条还能再展开看入参与结果。
     *
     * @param props - `blockKey`（折叠状态键）、`entries`（明细）、`stats`、`t`、`sessionId`。
     * @returns 折叠块。
     */
    function ProcessingBlock({ blockKey, entries, stats, t, sessionId, active }) {
      // 默认展开条件 = 这段动作所属的任务/回合**正在进行**；完成后自动收起成一行统计
      // （用户手动点过就以用户的选择为准，见 useCollapse 的持久化语义）。
      const [open, toggle] = useCollapse(sessionId, blockKey, active === true)
      const body = []
      for (const entry of entries) {
        if (entry.kind === 'tool') {
          body.push(h(ToolEntry, { key: `t:${entry.key}`, entry, t, sessionId }))
        } else if (entry.kind === 'thinking') {
          body.push(h(ThinkingEntry, { key: `k:${entry.key}`, entry, t, sessionId }))
        } else {
          body.push(h(ProcessRowEntry, { key: `r:${entry.key}`, entry }))
        }
      }
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.processing'),
          summary: describeStats(stats, t),
          trailing: h('span', { className: 'dcf-count' }, String(entries.length)),
        },
        body,
      )
    }

    /** 节点是否直接显示在对话流里（用户发言与助手正文）；其余都进「正在处理」。 */
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
     * 渲染一段节点：先是一块汇总的「正在处理」，再按顺序渲染直接显示的内容。
     *
     * 为什么把动作汇总成一块而不是按位置穿插：任务执行期间的绝大多数节点都是动作，
     * 穿插会让「任务 → 子对话」的层级被动作行冲散；汇总成一块后，一个任务的展开体
     * 永远是「正在处理（N 个操作）→ 助手说了什么」这个可预期的形状。
     *
     * @param props - `nodes`、`blockKey`、`t`、`sessionId`、`labels`、`active`（所属任务/回合是否正在进行）。
     * @returns 节点序列；没有任何可显示内容时返回 `null`。
     */
    function NodeSequence({ nodes, blockKey, t, sessionId, labels, active }) {
      const entries = useMemo(() => processEntries(nodes), [nodes])
      const inline = useMemo(() => nodes.filter(isInlineNode), [nodes])
      const stats = useMemo(() => statsOfNodes(nodes), [nodes])
      if (entries.length === 0 && inline.length === 0) return null
      const children = []
      if (entries.length > 0) {
        children.push(h(ProcessingBlock, { key: 'process', blockKey, entries, stats, t, sessionId, active }))
      }
      for (const node of inline) children.push(h(InlineNode, { key: node.key, node, labels }))
      return h('div', { className: 'dcf-block' }, children)
    }
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
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`（本回合是否正在进行）。
     * @returns 折叠分组；该回合没有规划阶段时返回 `null`。
     */
    function PlanGroup({ group, t, sessionId, labels, live }) {
      const planningNodes = useMemo(
        () => group.planNodes.filter((node) => node.key !== group.planCallKey),
        [group],
      )
      // 进行中默认展开（看得见规划过程），回合结束后自动收起。
      const [open, toggle] = useCollapse(sessionId, `plan:${group.turn}`, live === true)
      if (group.plan === null) return null
      const body = [
        h(NodeSequence, {
          key: 'plan-sequence',
          nodes: planningNodes,
          blockKey: `proc:plan:${group.turn}`,
          t,
          sessionId,
          labels,
          active: live,
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
     * 界面立刻跟着变。展开策略也是实时的：
     * - `in_progress`（或所在回合正在跑）→ **默认展开**，能看见它正在做什么；
     * - `completed` / `pending` → **默认自动收起**，只留一行状态；
     * 用户手动点过之后就以用户的选择为准（`useCollapse` 只记录显式切换）。
     *
     * @param props - `group`、`task`、`t`、`sessionId`、`labels`、`live`（本回合是否正在进行）。
     * @returns 任务行。
     */
    function TaskRow({ group, task, t, sessionId, labels, live }) {
      const active = live === true || task.status === 'in_progress'
      const [open, toggle] = useCollapse(sessionId, `task:${group.turn}:${task.index}`, active)
      const expandable = task.nodes.length > 0
      // 展开为位置参数而不是塞一个数组：数组子节点会被 React 当成列表，要求每个都带 key；
      // 这里的位置本来就是固定的（箭头 / 状态点 / 标题 / 状态 / 操作数），不需要 key。
      const cells = [
        expandable ? h(Chevron, { open }) : h('span', { className: 'dcf-chev' }),
        h(TaskDot, { status: task.status }),
        h('span', { className: 'dcf-tasktitle' }, task.content),
        h('span', { className: 'dcf-badge' }, statusText(t, task.status)),
        expandable ? h('span', { className: 'dcf-count' }, t('flow.ops', { count: task.stats.listed })) : null,
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
            ...cells,
          )
        : h('div', { className: 'dcf-taskrow', 'data-status': task.status }, ...cells)
      return h(
        'div',
        { className: 'dcf-task' },
        row,
        h(
          Fold,
          { open: expandable && open },
          h(NodeSequence, {
            nodes: task.nodes,
            blockKey: `proc:${group.turn}:${task.index}`,
            t,
            sessionId,
            labels,
            active,
          }),
        ),
      )
    }

    /**
     * 任务列表：有序、可看出进行到哪一项（验收第 3、4 条）。
     *
     * 列表本身不折叠——它是这个视图的主干，藏起来就失去意义了。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`。
     * @returns 任务列表；该回合没有计划时返回 `null`。
     */
    function TaskList({ group, t, sessionId, labels, live }) {
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
            h(TaskRow, { key: `task:${group.turn}:${task.index}`, group, task, t, sessionId, labels, live }),
          ),
        ),
      )
    }

    /**
     * 一个回合 = 一次用户输入产生的任务流，也是右侧导轨上的一个刻度。
     *
     * 有计划：用户发言 → 规划过程（可折叠）→ 任务列表 → 收尾（任务全部完成后的汇报）。
     * 没计划（琐碎请求）：用户发言 → 正在处理（可折叠）+ 结论，保持紧凑。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`（本回合是否正在进行）。
     * @returns 回合块。
     */
    function TurnGroup({ group, t, sessionId, labels, live }) {
      const children = []
      if (group.inputText !== '') children.push(h(UserBubble, { key: 'ask', text: group.inputText }))
      if (group.planned) {
        children.push(h(PlanGroup, { key: 'plan', group, t, sessionId, labels, live }))
        children.push(h(TaskList, { key: 'tasks', group, t, sessionId, labels, live }))
        children.push(
          h(NodeSequence, {
            key: 'closing',
            nodes: group.closing,
            blockKey: `proc:closing:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
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
            active: live,
          }),
        )
      }
      return h(
        'div',
        {
          className: 'dcf-turn',
          'data-turn': String(group.turn),
          'data-turn-anchor': String(group.turn),
        },
        children,
      )
    }
    /* ──────────────────────────── 右侧回合导轨 ──────────────────────────── */

    /**
     * 右侧刻度条：每个回合一个刻度，点击跳到该回合（一次对话）的开头。
     *
     * 结构与核心的 `TurnNavigator` 同构但**不共用代码**（它没有任何公开导出）：
     * 一个**零高 sticky 槽**钉在滚动视口顶部，里面绝对定位出竖向刻度条。
     * 这样滚动时导轨始终停在视口里，刻度数与内容高度无关（不需要按比例定位）。
     *
     * 只画**已加载**的回合——`turns` 就是本视图自己派生出的回合号列表。
     * 核心还能用 `turnOutline` 投影把未加载的回合画成淡刻度并翻页跳过去；
     * 本项目未做（需要 `loadThrough` + 待加载后定位），记在执行计划的下一轮候选里。
     *
     * @param props - `turns`（回合号数组）、`activeTurn`、`liveTurn`、`onJump`、`t`。
     * @returns 导轨；只有一个回合时返回 `null`（没有可跳的目标）。
     */
    function TurnRail({ turns, activeTurn, liveTurn, onJump, t }) {
      if (!Array.isArray(turns) || turns.length < 2) return null
      return h(
        'div',
        { className: 'dcf-rail-slot' },
        h(
          'div',
          { className: 'dcf-rail', role: 'navigation', 'aria-label': t('flow.rail') },
          ...turns.map((turn) => {
            const label = t('flow.rail.jump', { turn })
            return h('button', {
              key: String(turn),
              type: 'button',
              className: 'dcf-mark',
              'data-active': turn === activeTurn ? 'true' : 'false',
              'data-live': turn === liveTurn ? 'true' : 'false',
              'aria-current': turn === activeTurn ? 'true' : undefined,
              title: label,
              'aria-label': label,
              onClick: () => onJump(turn),
            })
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
    function FlowBody({ sessionId, useChat, useSession, t, loadOlder }) {
      const rootRef = useRef(null)
      const snapshot = useChat(identitySelector)
      const flow = useMemo(() => deriveFlow(snapshot), [snapshot])
      const labels = useMemo(() => markdownLabels(t), [t])
      const session = useSession(identitySelector)

      const running = session?.running === true
      const turns = useMemo(() => flow.turns.map((group) => group.turn), [flow])
      /** 正在跑的回合：它的默认展开态与导轨上的呼吸刻度都用它。 */
      const liveTurn = running && turns.length > 0 ? turns[turns.length - 1] : null
      const { activeTurn } = useScroller(rootRef, {
        turns,
        hasMore: session?.hasMore,
        loadingOlder: session?.loadingOlder,
        loadOlder,
      })
      const onJump = useCallback((turn) => jumpToTurn(rootRef.current, turn), [])

      const main = []
      if (session?.hasMore === true) {
        main.push(
          h(
            'button',
            {
              key: 'load-older',
              type: 'button',
              className: 'dcf-hint',
              disabled: session.loadingOlder === true,
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
        h(TurnRail, { turns, activeTurn, liveTurn, onJump, t }),
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
      /** 每次渲染刷新一次的最新值快照：事件监听只装一次，但要读到最新状态。 */
      const latest = useRef(options)
      latest.current = options
      const scrollerRef = useRef(null)
      const armedRef = useRef(true)
      const anchorRef = useRef(null)

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
          if (scroller.scrollTop > TOP_LOAD_THRESHOLD_PX) {
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

      return { activeTurn }
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
      statsOfNodes,
      statsSummary,
      describeStats,
      summarizeToolCall,
      processEntries,
      deriveFlow,
      orderedNodes,
      todosOfToolCall,
      assistantTextOf,
      markdownLabels,
      terminalLabels,
      installStyles,
      jumpToTurn,
      TOP_LOAD_THRESHOLD_PX,
      useScroller,
      FLOW_CSS,
      views: {
        TaskFlowView,
        FlowBody,
        TurnGroup,
        TurnRail,
        TaskList,
        TaskRow,
        PlanGroup,
        ProcessingBlock,
        NodeSequence,
        Fold,
      },
    }
    return module.exports
  },
})
