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
 *   - lib/client/55-native.js
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

    /**
     * 本插件留在**会话级存储**里的全部键前缀（都拼成 `<前缀>.<sessionId>`）。
     *
     * 列在这里而不是散在各分片，是因为「会话删了要把本插件的东西一起带走」这件事
     * 需要一个**唯一清单**：漏掉任何一个，那个键就再也没人会读（键里带着 sessionId），
     * 只会一直躺在用户的存储里。
     */
    const SESSION_KEY_PREFIXES = [
      COLLAPSE_KEY,
      'dsh-chat-flow.scroll',
      'dsh-chat-flow.ended-away',
    ]

    /**
     * 清掉本插件给某个会话留下的全部数据（会话被删除时调用）。
     *
     * **存储不可用不能把删除动作带崩**：隐私模式、配额打满时读写都会抛，
     * 而「少清几个键」远比「删不掉会话」轻得多，所以整体静默降级。
     *
     * @param sessionId - 被删除的会话 id。
     * @param env - `{localStorage, sessionStorage}`（真机传 `window`，测试传替身）。
     * @returns 实际删掉的键个数（排查与测试用）。
     */
    function purgeSessionData(sessionId, env) {
      if (typeof sessionId !== 'string' || sessionId === '') return 0
      const suffix = `.${sessionId}`
      let removed = 0
      for (const store of [env?.localStorage, env?.sessionStorage]) {
        if (store === null || store === undefined || typeof store.removeItem !== 'function') continue
        try {
          const doomed = []
          for (let index = 0; index < store.length; index += 1) {
            const key = store.key(index)
            if (typeof key === 'string' && SESSION_KEY_PREFIXES.some((prefix) => key === `${prefix}${suffix}`)) {
              doomed.push(key)
            }
          }
          for (const key of doomed) {
            store.removeItem(key)
            removed += 1
          }
        } catch (_) {
          // 存储不可用（隐私模式 / 配额满）：放弃清理，但不影响调用方继续删会话。
        }
      }
      return removed
    }

    /**
     * 找出「本插件留了数据、但会话列表里已经没有」的 sessionId。
     *
     * 核心**没有**会话删除事件（`ctx.sessions` 只给一个列表快照），所以删除只能这样发现：
     * 会话列表变了之后，比对哪些 id 不见了。调用方再对每个 id 调 `purgeSessionData`。
     *
     * 两道保险，防止把**还活着**的会话的数据误删（顺序很重要）：
     * 1. `alive` 为空时一律不动手——重连重拉会让列表短暂变空，那时候「全都不见了」不是事实；
     * 2. 正在看的那个会话由调用方排除（`useSessions` 的列表里可能还没有它，比如刚建的空会话）。
     *
     * @param env - `{localStorage, sessionStorage}`。
     * @param alive - 会话列表里的 id 集合。
     * @returns 消失的 sessionId 数组（去重，顺序按存储里的先来后到）。
     */
    function staleSessionIds(env, alive) {
      const gone = []
      if (alive === null || alive === undefined || alive.size === 0) return gone
      for (const store of [env?.localStorage, env?.sessionStorage]) {
        if (store === null || store === undefined || typeof store.key !== 'function') continue
        try {
          for (let index = 0; index < store.length; index += 1) {
            const key = store.key(index)
            if (typeof key !== 'string') continue
            for (const prefix of SESSION_KEY_PREFIXES) {
              const head = `${prefix}.`
              if (!key.startsWith(head)) continue
              const sessionId = key.slice(head.length)
              if (sessionId !== '' && !alive.has(sessionId) && !gone.includes(sessionId)) gone.push(sessionId)
            }
          }
        } catch (_) {
          // 存储不可用：放弃这一轮清理（同上，静默降级）。
        }
      }
      return gone
    }

    /**
     * 本视图自己的条目 id 与排序位。
     *
     * **为什么不遮蔽核心「对话」视图**：视图选择的 fallback 硬编码为 `id === 'chat'`，
     * 遮蔽（同 id + 更低 priority）确实能让本视图成为默认，代价是核心那条条目仍在账本里，
     * 标签栏读的正是账本 → 出现两个标签、且两个都带激活下划线（`aria-selected` 按 id 比对）。
     * 而核心**不允许注销别人的条目**（`StoredEntry` 无 disposer），所以遮蔽必然留下重复标签。
     *
     * 现在的做法：用独立 id 作为**并列视图**（原生「对话」仍是默认），标签栏只有一个高亮；
     * 想用任务流视图点「任务」标签即可（选择会被持久化）。
     */
    const TAB_VIEW_ID = 'flow'
    const TAB_VIEW_ORDER = 5

    /**
     * 跳到某个回合时，在滚动口顶部留出的空隙（核心 `landOnRow` 硬编码 24px，这里用同一量级）。
     *
     * 放在 head 里是因为它被两个分片共用：`80-view.js` 的刻度跳转与 `85-scroll.js` 的翻页落位。
     */
    const RAIL_LAND_OFFSET_PX = 24

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
      'flow.scrollToBottom': '快速回到底部',

      'flow.tasks': '任务列表',
      'flow.tasksSummary': '{total} 项 · {done} 已完成',
      'flow.tasksUpdate': '第 {index} 次更新',

      'flow.status.pending': '未开始',
      'flow.status.in_progress': '进行中',
      'flow.status.completed': '已完成',
      'flow.status.running': '运行中',
      'flow.status.done': '已完成运行',
      'flow.status.failed': '运行失败',
      'flow.status.cancelled': '已取消',
      'flow.status.started': '已派出',
      'flow.status.stopped': '已停止',

      'flow.category.thinking': '思考 {count} 次',
      'flow.category.command': '执行 {count} 条命令',
      'flow.category.read': '读取 {count} 个文件',
      'flow.category.file': '编辑 {count} 个文件',
      'flow.category.mcp': '调用 {count} 个 MCP 工具',
      'flow.category.question': '提问 {count} 次',

      'flow.thinking.live': '思考中',
      'flow.thinking.done': '思考已完成',
      'flow.thinking.cutOff': '思考被打断',
      'flow.loadingLocked': '正在加载更早的内容…（页面已锁定，加载完成后可直接继续）',
      'flow.stage': '任务过程',
      'flow.stage.duration': '任务耗时 {text}',
      'flow.duration.hour': '{count}小时',
      'flow.duration.minute': '{count}分',
      'flow.duration.second': '{count}秒',
      'flow.status.unfinished': '被打断',
      'flow.context.count': '{count} 段注入',
      'flow.noOps': '无操作',
      'flow.ops': '{count} 个操作',
      'flow.tasksDone': '已完成：{text}',
      'flow.pending.steering': '插队待处理',
      'flow.pending.queued': '排队中',
      'flow.steering': '插队',
      'flow.error.title': '任务视图渲染失败',
      'flow.error.hint': '界面其余部分仍然可用：切到「对话」标签可以继续，或刷新页面重试。请把上面这行信息反馈给插件作者。',

      'flow.row.context': '上下文准备',
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
      'flow.scrollToBottom': 'Scroll to bottom',

      'flow.tasks': 'Tasks',
      'flow.tasksSummary': '{total} tasks · {done} done',
      'flow.tasksUpdate': 'Update {index}',

      'flow.status.pending': 'Not started',
      'flow.status.in_progress': 'In progress',
      'flow.status.completed': 'Done',
      'flow.status.running': 'Running',
      'flow.status.done': 'Finished',
      'flow.status.failed': 'Failed',
      'flow.status.cancelled': 'Cancelled',
      'flow.status.started': 'Dispatched',
      'flow.status.stopped': 'Stopped',

      'flow.category.thinking': 'Thought {count} times',
      'flow.category.command': 'Ran {count} commands',
      'flow.category.read': 'Read {count} files',
      'flow.category.file': 'Edited {count} files',
      'flow.category.mcp': 'Called {count} MCP tools',
      'flow.category.question': 'Asked {count} questions',

      'flow.thinking.live': 'Thinking',
      'flow.thinking.done': 'Thought',
      'flow.thinking.cutOff': 'Thinking interrupted',
      'flow.loadingLocked': 'Loading earlier history… (page locked until it lands)',
      'flow.stage': 'Task process',
      'flow.stage.duration': 'Took {text}',
      'flow.duration.hour': '{count}h ',
      'flow.duration.minute': '{count}m ',
      'flow.duration.second': '{count}s',
      'flow.status.unfinished': 'Interrupted',
      'flow.context.count': '{count} injections',
      'flow.noOps': 'No operations',
      'flow.ops': '{count} operations',
      'flow.tasksDone': 'Done: {text}',
      'flow.pending.steering': 'Steering, waiting',
      'flow.pending.queued': 'Queued',
      'flow.steering': 'Steering',
      'flow.error.title': 'Task view failed to render',
      'flow.error.hint': 'The rest of the UI still works: switch to the Chat tab, or reload the page. Please report the line above to the plugin author.',

      'flow.row.context': 'Context preparation',
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

    /**
     * **读取文件**类工具名（`dsh-tool-fs` 的 `read`、`read_image`）。
     *
     * 用户当轮要求统计里要有「读取 n 个文件」这一项。口径刻意收窄：
     * **只有真的把文件内容读进来的工具算**——`grep` / `glob` / `web_fetch` / `list_agents`
     * 这类是「检索/取远端」，不是「读了几个文件」，算进来会让数字虚高。
     * 它们在展开明细里照旧逐条可见，只是不进这一项。
     */
    const READ_TOOL_NAMES = new Set(['read', 'read_image'])

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
     * 折叠统计的类别，**顺序即显示顺序**；计数为 0 的类别不显示。
     *
     * 与最初版本的口径差别（用户逐轮要求）：去掉「插件」，加入「思考次数」，
     * 再加入「读取文件」（`read` / `read_image`）。每一项都以完整句子呈现，
     * 例如「思考 3 次 · 执行 5 条命令 · 读取 2 个文件 · 编辑 1 个文件」（见 `describeStats`）。
     * 子 agent 与其它的内置工具（`todo_write` 等）不进统计，但逐条出现在展开明细里。
     */
    const STAT_CATEGORIES = ['thinking', 'command', 'read', 'file', 'mcp', 'question']

    /**
     * 类别 → locale 键。
     *
     * 派生层只产出类别键，**中文不在这一层出现**：展示文案一律由渲染点通过 `t(...)` 取，
     * 否则英文界面里会漏出中文（primitives 与 locale 的分工就是这么定的）。
     */
    const CATEGORY_LOCALE_KEYS = {
      thinking: 'flow.category.thinking',
      command: 'flow.category.command',
      read: 'flow.category.read',
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
     * 本插件**自己接管**的合成节点：不交给原生座位（见 `55-native.js` 的 `seatNodesOf`）。
     *
     * - `turn-process`：核心的「过程折叠」控制器。本插件的任务阶段折叠就是它的替代品，
     *   渲染它等于在一个折叠里再套一个折叠（而且它需要 `turnProcess` 主人参数才能工作）。
     *
     * ⚠️ `turn-tail` **必须**交给原生条目：用户的复制 / 点赞 / 点踩 /「在新对话中分支」按钮
     * 全在它里面（`TurnTailNodeView` 渲染 `MessageIconActions` + `conversation.chat.assistant-actions`
     * 链 + 投递物链 + 用量面板，`CHAT:3536-3581`）。它**不会**重复正文：`closing.blocks`
     * 只是复制按钮的载荷，不作为可见文本渲染。
     */
    const OWNED_NODE_KINDS = new Set(['turn-process'])

    /**
     * 这个节点**必然渲染成空**吗？
     *
     * 判据刻意**只认「已知必然渲染成空」的两种节点**，而不是「统计条目为 0」——
     * `workflow-run` / `command-input` 这类节点由核心的原生叶子画出完整外观，却不在本层的
     * 统计口径里；用「条目为 0」当判据会把它们整块抹掉（`unknown-surface` 这种核心新增的
     * 未知 kind 同理，宁可多画一个空块也不要吃掉内容）。
     *
     * - 本插件自己接管的合成节点（`turn-process`）：座位层不画它；
     * - 没有正文、也没有推理的助手步：核心对它是 `return null`（`CHAT:2898`——既不在流式中、
     *   也不是被打断、块里除工具调用外什么都没有）。
     *
     * 用户报告过这种空白块：「每个对话的最前端（第一个用户输入之前）都会有一个无操作的思考」。
     *
     * @param node - 对话节点。
     * @returns 是否必然渲染成空。
     */
    function isBlankNode(node) {
      if (OWNED_NODE_KINDS.has(node?.kind)) return true
      if (node?.kind !== 'assistant-step') return false
      return assistantTextOf(node) === '' && assistantReasoningOf(node) === ''
    }

    /**
     * 参与「上下文准备」折叠的节点类型：注入的上下文，以及模型的系统提示词。
     *
     * 用户当轮要求「系统提示词注入合并到上下文注入中」——它和规则/记忆/时间那些注入是同一类东西
     * （都是「这一轮开始前给模型准备了什么」），逐条占行只会把动作列表撑长。
     *
     * @param node - 对话节点。
     * @returns 是否属于上下文类节点。
     */
    function isContextNode(node) {
      return node?.kind === 'context' || node?.kind === 'system-prompt'
    }

    /** 上下文类节点的可读文本：`context` 在 `content` 数组里，`system-prompt` 在 `data.text` 里。 */
    function contextTextOf(node) {
      if (node?.kind === 'system-prompt') return typeof node.data?.text === 'string' ? node.data.text : ''
      return messageTextOf(node)
    }

    /**
     * 节点是否**直接显示在对话流里**（用户发言与助手正文）。
     *
     * 它是「过程 run / 正文 run」切分的判据：一段过程里一旦出现对用户可见的正文，
     * 前面的思考块就算结束了（用户要求「思考中过程中如果 AI 输出了对用户显示的内容，
     * 这个思考节点就结束，下次就开始下一个节点」）。
     *
     * @param node - 对话节点。
     * @returns 是否直接显示。
     */
    function isInlineNode(node) {
      if (node?.kind === 'user' || node?.kind === 'steering') return messageTextOf(node) !== ''
      if (node?.kind === 'assistant-step') return assistantTextOf(node) !== ''
      return false
    }

    /**
     * 必须留在**最外层**的节点类型：用户发言、插队消息、收尾控件。
     *
     * 用户当轮要求「用户发送的内容始终保留在最外层的层级，不要能被任意一个节点折叠」。
     * 这类节点既不进过程块、也不进任何折叠体，由回合层直接渲染：
     * - `user` / `steering`：用户说的话（steering 还额外充当分组边界，见 {@link deriveFlow}）；
     * - `turn-tail`：收尾控件（见 {@link isFooterNode}）。
     *
     * @param node - 对话节点。
     * @returns 是否必须留在最外层。
     */
    function isTopLevelNode(node) {
      return node?.kind === 'user' || node?.kind === 'steering' || isFooterNode(node)
    }

    /**
     * 把一段节点切成**交替的 run**：连续的过程节点合成一个 `process` run，
     * 连续的正文节点合成一个 `inline` run；**最外层节点（用户发言/插队/收尾）在这里被剔除并切断 run**
     * ——它们由回合层渲染，且「用户发了消息」本身就意味着上一块到此结束（用户要求）。
     *
     * 渲染层据此把「思考」块切成多个：正文一出现，上一个思考块就封口，后面的动作属于下一个块。
     * 纯函数，可单测。
     *
     * @param nodes - 一段节点（已按呈现序排列）。
     * @returns `{kind:'process'|'inline', nodes}[]`；最外层节点不出现、但会切断相邻的 run。
     */
    function nodeRunsOf(nodes) {
      const runs = []
      const list = Array.isArray(nodes) ? nodes : []
      for (let index = 0; index < list.length; index += 1) {
        const node = list[index]
        if (isTopLevelNode(node)) continue
        const kind = isInlineNode(node) ? 'inline' : 'process'
        const previous = list[index - 1]
        // 紧跟在最外层节点后面的那个节点**必须另起一块**：用户发了消息 → 上一块到此为止。
        const separated = previous !== undefined && isTopLevelNode(previous)
        const last = runs[runs.length - 1]
        if (last !== undefined && last.kind === kind && !separated) last.nodes.push(node)
        else runs.push({ kind, nodes: [node] })
      }
      return runs
    }

    /**
     * 一段 run 里**最后一段正文**的下标（没有正文 run 时返回 -1）。
     *
     * 渲染层用它把「任务过程」分成内外两半（用户要求「思考过程中穿插的对用户输出的内容应该合并到
     * 任务过程里面去，而不应该显示在最外层的层级」）：
     * - 任务还在跑：**所有** run 都在任务过程里（此时折叠体默认展开，看得见）；
     * - 任务结束：只有**最后一段正文**（就是「任务结束时对用户的汇报」）留在最外层，
     *   其余（包括过程中穿插的那些正文）全部收进任务过程。
     *
     * @param runs - {@link nodeRunsOf} 的结果。
     * @returns 下标，或 -1。
     */
    function lastInlineRunIndex(runs) {
      for (let index = (runs?.length ?? 0) - 1; index >= 0; index -= 1) {
        if (runs[index].kind === 'inline') return index
      }
      return -1
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
    /**
     * 按核心的呈现序取节点：**只认 `snapshot.order`**。
     *
     * 核心自己就是拿 `order` 渲染节点列表的（`CHAT:2461-2478` 把 `order` 交给 ChatNodeList），
     * 而 `nodes` 这个 Map 里可能**留着已经移出呈现序的节点**——对话回滚（rewind）之后正是如此：
     * `order` 已经去掉回滚点之后的节点，Map 里还留着旧条目。早期版本为了「兜住隐藏节点」
     * 把不在 order 里的条目也补上，结果就是**回滚后旧内容仍然留在界面上**。
     * 现在与核心一致，只用 order。
     *
     * ⚠️ 额外过滤 `visibility === 'hidden'` 的节点（rewind 插件可能把旧版本标记为隐藏而不从 order 移除）。
     * 这样即使核心的 order 里还留有旧节点引用，只要它们被标记为 hidden 就不出现在任务视图里。
     *
     * `order` 缺失/解析不出东西时（装配异常或首次加载的中间态）才退化成「取 Map 的全部值」：
     * 空会话仍然是空，而不会因为拿不到 order 就整块不显示。
     *
     * @param snapshot - `useChat` 快照。
     * @returns 节点数组（呈现序）。
     */
    function orderedNodes(snapshot) {
      const store = snapshot?.nodes
      if (store === undefined || typeof store.values !== 'function') return []
      const order = Array.isArray(snapshot.order) ? snapshot.order : []
      const nodes = []
      for (const key of order) {
        const node = typeof store.get === 'function' ? store.get(key) : undefined
        if (node === undefined || node === null) continue
        // 过滤被 rewind 插件标记为隐藏的节点（即使还在 order 里也不显示）
        if (node.visibility === 'hidden') continue
        nodes.push(node)
      }
      if (nodes.length > 0) return nodes
      for (const node of store.values()) {
        if (node === null || typeof node !== 'object') continue
        if (node.visibility === 'hidden') continue
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

    /**
     * 算「**被打断**」的错误码：`CANCELLED_CODES` 的真子集。
     *
     * 两个口径刻意不同（用户裁决过「超时/结果未知这些都不算被打断」）：
     * - **卡片状态**用 `CANCELLED_CODES`：超时与结果未知确实不是「失败」，卡片上写「已取消」更准；
     * - **「被打断」**只认「有人把它掐了」：用户按取消（`interrupted`）、调用被中止
     *   （`aborted*`）、提问被撤回（`ask_*`）。**超时**（`tool_timeout`）与**结果未知**
     *   （`tool_outcome_unknown`）是运行环境的问题，不该把整块思考标成「被打断」。
     */
    const INTERRUPT_CODES = new Set(['interrupted', 'aborted', 'aborted_before_dispatch', 'ask_cancelled', 'ask_aborted'])

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
        // ⚠️ 子 agent 报告在 `subagents.notices` 里（`collectSubagentContext` 的产物）。
        // 这里曾经误写成裸 `notices?.get(...)`（作用域里根本没有这个名字）：只要结果文本真的是
        // `started subagent <uuid>`，取值就会抛 `ReferenceError` —— 历史里带子 agent 调用的会话
        // 一被加载（例如点导轨跳到未加载回合）就会踩到。夹具默认给的是一句普通报告，
        // 所以短路分支（`childId === ''`）把它挡住了，直到真机上翻历史才暴露。
        const notices = subagents?.notices
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
      if (isContextNode(node)) return { kind: 'context', key: node.key, text: contextTextOf(node) }
      const titleKey = PROCESS_ROW_TITLES[node?.kind]
      return titleKey === undefined ? null : { kind: 'row', key: node.key, nodeKind: node.kind, titleKey }
    }

    /**
     * 把一段节点切成「行」：连续的上下文类节点（注入的上下文 + 系统提示词）合并成一行
     * （用户要求多次注入只占一个折叠点），其余每个节点各占一行。
     * 合并行的位置＝该段里**第一个**上下文节点的位置，顺序不乱。
     *
     * @param nodes - 一段节点（已按呈现序排列）。
     * @returns 行数组：`{kind:'node', node}` 或 `{kind:'contexts', nodes}`。
     */
    function groupProcessNodes(nodes) {
      const rows = []
      let contexts = null
      for (const node of nodes) {
        if (isContextNode(node)) {
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
     * 统计一段节点里的动作，按固定类别分桶。
     *
     * 口径（可逐条核对）：
     * - `thinking`：含推理块的助手步数（一次「思考」算 1 次）；
     * - `command` / `read` / `file` / `mcp` / `question`：对应的**根**工具调用次数；
     *   `read` 只认 `read` / `read_image`（见 `READ_TOOL_NAMES`），检索类不算读文件；
     *   `subCalls`（代码分派等嵌套调用）不重复计数；
     * - 其余工具（子 agent、未知插件工具）不进统计，但仍逐条出现在明细里；
     * - `todo_write`（任务列表更新）是分段边界本身，不算任务执行动作。
     *
     * @param nodes - 一段节点序列。
     * @returns `{counts, listed}`。
     */
    function statsOfNodes(nodes, subagents) {
      const counts = { thinking: 0, command: 0, read: 0, file: 0, mcp: 0, question: 0 }
      const entries = processEntries(nodes, subagents)
      for (const entry of entries) {
        if (entry.kind === 'thinking') {
          counts.thinking += 1
          continue
        }
        if (entry.kind !== 'tool') continue
        // 「读取文件」按工具名判定，而不是卡片类型：读文件的卡片是 `plain`（交给原生叶子画），
        // 没有专属卡片类型，所以只能在统计这一层按名字认。
        if (READ_TOOL_NAMES.has(entry.card.name)) {
          counts.read += 1
          continue
        }
        const kind = entry.card.kind
        if (kind === 'command' || kind === 'file' || kind === 'mcp' || kind === 'question') counts[kind] += 1
      }
      return { counts, listed: entries.length }
    }

    /**
     * 挑出要显示的统计分段：非零的类别，按固定顺序
     * （思考 / 命令 / 读取文件 / 编辑文件 / MCP / 提问）。
     *
     * 只返回类别键与计数，**不含任何文案**——文案由渲染点用 `t(...)` 组装（见 `describeStats`）。
     * 值为 0 的类别**完全不显示**（用户明确要求「若为 0 则不显示对应的项」）。
     *
     * @param stats - {@link statsOfNodes} 的结果。
     * @returns `{segments, listed}`；`segments` 为空表示这些类别都是 0。
     */
    function statsSummary(stats) {
      const segments = []
      for (const category of STAT_CATEGORIES) {
        const count = stats.counts[category] ?? 0
        if (count > 0) segments.push({ category, count })
      }
      return { segments, listed: stats.listed }
    }

    /**
     * 一段过程是否**没有善终**（被掐断在半路）。
     *
     * 用途是「取消键」那类场景：用户在一次写入的中途按下取消，这一段就停在半路。
     * 渲染层据此**保持这一块展开**——半截内容如果连折叠体一起收起来，看起来就像内容丢了。
     *
     * 判据**只用核心自己给出的中断证据**（两条都来自核心的数据形状）：
     * - `assistant-step`：`data.status === 'interrupted'`（核心自己也用它渲染「已停止」，`CHAT:2995`；
     *   该状态由核心在「这一步没写出 `assistant/message`」时合成，`CHAT:4448` / `4394`）；
     * - 工具块：错误码属于 {@link INTERRUPT_CODES}。**核心会对「没回来的调用」合成
     *   `error.code === 'interrupted'`**（`CHAT:6079-6104`，前提是那一步/回合已经关闭），
     *   所以「被掐断」这件事永远有权威来源，本插件不需要自己去猜。
     *
     * ⚠️ **禁止**再用「工具块还没落定」（`toolStatusOf === 'running'`）当判据（用户裁决：
     * 「命令执行失败不要算被打断」）。没落定只说明**结果没挂到节点上**，不说明有人掐了它：
     * 核心只把 `surfaceOp === 'append'` 的结果挂回调用节点（`CHAT:6142`），
     * 被改写成 `replace` 的结果（历史重放/压缩后很常见，本机实测 20 例，其中 5 例是失败的命令）
     * 于是一批**正常结束甚至失败**的命令会停在「未落定」上——拿它当判据就会把整块思考
     * 误标成「思考被打断」。
     * ⚠️ **超时与结果未知也不算**（用户裁决）：那是运行环境的问题。
     *
     * @param nodes - 一段（或一个块里的）节点。
     * @returns 是否未善终。
     */
    function cutOffOf(nodes) {
      for (const node of nodes ?? []) {
        if (node?.kind === 'assistant-step' && node.data?.status === 'interrupted') return true
        const block = toolBlockOfNode(node)
        if (block === null) continue
        if (INTERRUPT_CODES.has(toolErrorCodeOf(block))) return true
      }
      return false
    }

    /* ──────────────────────────── 待发送 / 插队的消息 ──────────────────────────── */

    /**
     * 已经在呈现序里出现过的 rpcId 集合（核心 `observedRpcIds` 的同义实现，`CHAT:1951-1961`）。
     *
     * 作用：一条「本地回显」的待发送消息，在它变成正式的用户节点之后必须**不再重复显示**，
     * 靠的就是 rpcId 已经出现在 order 的 user/steering 节点里（或出现在队列项里）。
     *
     * @param snapshot - `useChat` 快照。
     * @param queue - `session.queue`。
     * @returns rpcId 集合。
     */
    function observedRpcIdsOf(snapshot, queue) {
      const observed = new Set()
      const store = snapshot?.nodes
      const order = Array.isArray(snapshot?.order) ? snapshot.order : []
      for (const key of order) {
        const node = typeof store?.get === 'function' ? store.get(key) : undefined
        if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
        const rpcId = node.data?.source?.rpcId
        if (typeof rpcId === 'string') observed.add(rpcId)
      }
      for (const item of Array.isArray(queue) ? queue : []) {
        if (typeof item?.rpcId === 'string') observed.add(item.rpcId)
      }
      return observed
    }

    /**
     * 还没进入对话的**用户消息**（核心在对话流末尾渲染的那两串，`CHAT:2483-2492`）。
     *
     * 两种来源，语义不同，所以分开给状态：
     * - `steering`：用户选了「插队发送」，消息排队等着被注入到**正在跑的这一回合**里；
     * - `echo`：刚点发送、host 还没回执的本地回显（`placement === 'queued'` 的那批由输入区自己显示，
     *   与核心一致地在这里跳过）。
     *
     * @param queue - `session.queue`。
     * @param submissions - `session.pendingSubmissions`。
     * @param snapshot - `useChat` 快照（用来判断回显是否已经落地）。
     * @returns `{kind, key, text}[]`。
     */
    function pendingSeatsOf(queue, submissions, snapshot) {
      const seats = []
      for (const item of Array.isArray(queue) ? queue : []) {
        if (item?.placement !== 'steering') continue
        seats.push({
          kind: 'steering',
          key: typeof item.id === 'string' ? item.id : `steering:${seats.length}`,
          text: contentToText(item.content),
        })
      }
      const observed = observedRpcIdsOf(snapshot, queue)
      for (const submission of Array.isArray(submissions) ? submissions : []) {
        if (submission?.placement === 'queued') continue
        const requestId = typeof submission?.requestId === 'string' ? submission.requestId : ''
        if (requestId !== '' && observed.has(requestId)) continue
        seats.push({
          kind: 'echo',
          key: requestId === '' ? `echo:${seats.length}` : requestId,
          text: typeof submission?.text === 'string' ? submission.text : '',
        })
      }
      return seats
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
     * 是否是**回合尾部的收尾节点**（`turn-tail`）。
     *
     * 它是复制 / 点赞 / 点踩 /「在新对话中分支」按钮的载体（见 `core-seams.md §13.5`），
     * 位置必须是**一轮对话的总结之后**——用户当轮明确要求它不要出现在「任务过程」折叠体里面。
     * 因此派生层把它从各段里摘出来单独成组（{@link buildTurnGroup} 的 `footerNodes`），
     * 渲染层在正文序列之后单独渲染它们。
     *
     * @param node - 对话节点。
     * @returns 是否是收尾节点。
     */
    function isFooterNode(node) {
      return node?.kind === 'turn-tail'
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
      /**
       * 「动手之前」的那一段：首个 `todo_write` 之前的节点（想过什么、说过什么、跑过什么）。
       *
       * ⚠️ 它**不再单独成折叠体**（用户要求「移除掉规划过程，全部算任务过程里面」）：
       * 渲染层把它排在「任务过程」折叠体的最前面，与快照面板、子任务、过程明细同一个折叠体。
       */
      const planNodes = []
      const segments = []
      const looseNodes = []
      /** 收尾节点（`turn-tail`）单独成组：它的位置固定在「总结之后」，不能进任何折叠体。 */
      const footerNodes = []
      let previousTodos = null
      let current = null
      for (const node of nodes) {
        if (isFooterNode(node)) {
          footerNodes.push(node)
          continue
        }
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
        /**
         * **被后续列表接管**：只要后面还有更新的列表，这一版就不再代表「现在」。
         *
         * 快照**内容**照旧冻结（用户要求「显示也是显示这时的状态」），但它的**运行状态**不能冻结：
         * 旧列表里那一项已经不是「进行中」了，渲染层据此把它显示成「已停止」并默认收起。
         * 不这么做的话，一个回合从头到尾**第一步那一版**都挂着会转的进度圈
         * （用户报告过「老的任务列表都在第一步，都有进度圈在转」）。
         */
        segment.superseded = segment.index < segments.length - 1
      }

      // 「此刻正在做的那一项」：某分段点名了 `in_progress`，且**后续任何一次列表更新都没有**把它
      // 标成完成或删掉。这样历史快照照旧冻结，但只有真正还没结束的那一项默认展开——
      // 否则一个长对话里每一段任务都会摊在界面上。
      for (const segment of segments) {
        if (segment.activeTask === null) {
          segment.isCurrentTask = false
          continue
        }
        const takenOver = segments
          .slice(segment.index + 1)
          .some(
            (later) =>
              later.changed.finished.includes(segment.activeTask) ||
              later.changed.removed.includes(segment.activeTask),
          )
        segment.isCurrentTask = !takenOver
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
      // `startedAt` 单独暴露出来：回合还在跑时渲染层用它做**实时计时**（now - startedAt）。
      let startedAt
      let endedAt
      if (timelineTurn !== undefined && timelineTurn.start !== undefined && timelineTurn.end !== undefined) {
        startedAt = timelineTurn.start.time
        endedAt = timelineTurn.end.time
      } else {
        if (timelineTurn !== undefined && timelineTurn.start !== undefined) startedAt = timelineTurn.start.time
        for (const node of nodes) {
          const time = nodeTimeOf(node)
          if (time === undefined) continue
          if (startedAt === undefined || time < startedAt) startedAt = time
          if (endedAt === undefined || time > endedAt) endedAt = time
        }
      }
      const closed = turnClosedOf(nodes, timelineTurn)
      /**
       * 回合**没有善终**：结束了但**最后一个任务列表**里还留着「进行中」的任务，
       * 或有调用停在做（`running`）。
       *
       * ⚠️ **只看最后一个列表**（用户裁决：「最后判定有没有被打断看得是最后一个出现的任务列表的状态，
       * 不然永远在结束的时候会被第一个任务列表改为被打断状态」）：每一版快照都是**冻结**的，
       * 第一个列表里那一项永远停在 `in_progress`，拿「任一版本有进行中」当判据，任何跑过两步以上
       * 的回合都会恒定地被标成「被打断」。
       *
       * ⚠️ **不把「后台子 agent 已派出但报告未到」算进来**（`card.status === 'started'`）：
       * 那是正常情况（后台派发本来就异步），算进来会让每个跑过 subagent 的回合都挂「被打断」，
       * 于是同一回合里**每一块思考**都被标成被打断（用户报告过）。
       * 子 agent 只有在**结果就是一行 `started subagent <id>` 且回合随即结束**时才算没收尾，
       * 那种情况下 `card.status` 仍是 `started`，但它不该由这里兜——交给用户看子会话本身。
       */
      const unfinished =
        closed &&
        ((last !== undefined && last.todos.some((todo) => todo.status === 'in_progress')) ||
          processEntries(nodes, subagents).some((entry) => entry.kind === 'tool' && entry.card.status === 'running'))
      /**
       * 本回合**最后一个可渲染节点**的 key（跳过收尾节点）。
       *
       * 「思考中」只属于「此刻还在往里写的那一块」：把 `active` 的判据从「所属回合在跑」收窄到
       * 「这一块里包含这个节点」，于是一个节点写完之后就不再显示「思考中」，而是显示「思考已完成」。
       * 跳过收尾节点的原因：它不参与任何过程折叠（见 {@link isFooterNode}），拿它当判据会让
       * 整个回合没有一块算「正在写」。
       */
      let liveKey = null
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        if (!isFooterNode(nodes[index])) {
          liveKey = nodes[index].key
          break
        }
      }

      return {
        // key 必须**按分组**唯一：同一个回合里可能因为插队消息而有多个分组（见 deriveFlow）。
        key: `turn:${turn}:${inputNode?.key ?? 'head'}`,
        turn,
        input: inputNode,
        /** 这一组的开头是什么：普通用户发言还是插队消息（渲染层据此选座位与标记）。 */
        inputKind: inputNode?.kind ?? 'user',
        closed,
        unfinished,
        /**
         * 这一组的节点**全部必然渲染成空**（{@link isBlankNode}）吗？
         *
         * 只用于一件事：没有用户输入的空组不渲染（见 `deriveFlow` 的过滤）。
         */
        blank: nodes.every(isBlankNode),
        durationMs: startedAt === undefined || endedAt === undefined ? null : Math.max(0, endedAt - startedAt),
        startedAt,
        liveKey,
        inputText: messageTextOf(inputNode),
        planned,
        planNodes,
        segments,
        looseNodes,
        closing,
        footerNodes,
        subagents,
        stats: statsOfNodes(planned ? nodes : looseNodes, subagents),
      }
    }

    /**
     * 主派生：chat 快照 → 回合分组列表。
     *
     * 一个用户输入开一个分组（这就是「任务处理流」的时间边界）。
     *
     * ⭐ **插队消息（`steering`）同样开一个分组**（用户要求）：用户发的内容必须始终留在最外层、
     * 不能被任何折叠节点吞掉，而且「一个节点里用户发了消息」就意味着**那个节点结束了**
     * （他要么去处理另一件事，要么追加了新内容）。把 steering 当成分组边界同时满足这两点：
     * 它以气泡形式成为新分组的开头（永远在最外层），前面那一组的内容不再跨过它继续堆叠。
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
      const groups = []
      let current = null
      for (const node of nodes) {
        if (node.kind === 'user' || node.kind === 'steering') {
          current = { turn: turnOfNode(node), input: node, nodes: [] }
          groups.push(current)
          continue
        }
        if (current === null) {
          current = { turn: turnOfNode(node), input: undefined, nodes: [] }
          groups.push(current)
        }
        current.nodes.push(node)
      }
      return {
        turns: groups
          .map((item) =>
            buildTurnGroup(item.turn, item.input, item.nodes, subagents, timelineTurns?.get(item.turn)),
          )
          /**
           * ⚠️ **丢掉「没有用户输入、又没有任何可列出内容」的分组**（用户报告过「每个对话的最前端
           * （第一个用户输入之前）都会有一个无操作的思考，时长和第一次任务的第一个思考相同」）。
           *
           * 成因：第一个用户输入之前就已经有节点了——核心为这一回合合成的 `turn-process` 节点排在
           * 回合开始处（`turn/start` 早于第一条 `user/message`，本机实测 seq 5 vs 8），
           * 于是它自成一组。这一组没有输入气泡、节点又全被本插件接管（`seatNodesOf` 过滤掉），
           * 只剩一个「任务耗时 + 无操作」的折叠头；而它的 `turn` 与真正的第一回合**同号**，
           * 时间线的起止自然也一样，看起来就像第一回合的思考被复制了一份留在最前面。
           *
           * 保留有内容的分组（例如历史分页后窗口正好从一个回合中间开始：那些孤儿节点本身是要看的，
           * 只是没有输入气泡）——判据是「这一组的每个节点都必然渲染成空」（{@link isBlankNode}），
           * 而不是「统计条目为 0」：`workflow-run` / 核心新增的未知 kind 有原生外观却不在统计口径里。
           */
          .filter(
            (group) => group.input !== undefined || group.footerNodes.length > 0 || !group.blank,
          ),
      }
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
.dcf-ask{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.dcf-askactions{display:flex;justify-content:flex-end}
.dcf-askbuttons{display:flex;align-items:center;gap:6px;min-height:20px}
.dcf-mini{background:0 0;border:none;color:var(--dsw-alias-label-caption);font:inherit;font-size:12px;line-height:18px;padding:0 4px;cursor:pointer;border-radius:4px}
.dcf-mini:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.dcf-ask .dcf-bubble{background:var(--dsw-specific-bubble);border-radius:18px;padding:9px 14px;max-width:min(82%,640px);white-space:pre-wrap;word-break:break-word}
.dcf-block{display:flex;flex-direction:column;gap:6px}

/* 原生叶子行：内容 100% 由核心的原生组件渲染，本插件只给行容器与行距。
   核心的阅读列靠 flowItem 兄弟选择器给出行距（dsh-client-ui-chat/lib/client.js:1440），
   而本视图的列是 .dcf-main，所以要自己补上同一条间距（模板里不能出现反引号）。
   折叠体内部比正文行紧一档（8px）：那里是一串动作行，用同一档间距会显得散。 */
.dcf-leaf{display:block;min-width:0}
.dcf-leaf:empty{display:none}
.dcf-leaf+.dcf-leaf{margin-top:var(--dsh-chat-flow-gap,16px)}
.dcf-body>.dcf-leaf+.dcf-leaf,.dcf-platebody>.dcf-leaf+.dcf-leaf{margin-top:8px}
.dcf-leaf+.dcf-thinking,.dcf-thinking+.dcf-leaf,.dcf-leaf+.dcf-block,.dcf-block+.dcf-leaf{margin-top:var(--dsh-chat-flow-gap,16px)}
.dcf-body>.dcf-block,.dcf-body>.dcf-thinking{margin-top:0}
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
/* 锁住的折叠行（任务还在跑时的「任务过程」）：点不动，因此也不给 hover 反馈。 */
.dcf-row[data-locked=true]:hover{background:0 0}
/* 展开箭头：**必须让包裹盒恰好等于图标盒**，否则旋转中心不是箭头的几何中心。
   svg 默认是 inline，行高（本视图 22px 左右）会把包裹盒撑高、图标掉到基线上——
   于是在 14×14 的盒子里，旋转中心（盒中心）与箭头中心差了半个行高，看起来就是「绕着角转」。
   用 flex 居中 + svg 的 display:block 把两者对齐，并显式写 transform-origin:center 兜底。
   （注意：本文件是模板字符串，注释里不能出现反引号。） */
.dcf-chev{flex:none;width:14px;height:14px;margin-top:4px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption);transition:transform .22s cubic-bezier(.2,.8,.2,1);transform-origin:center}
.dcf-chev>svg{display:block}
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

/* 任务列表快照面板：**思考块以外的任务列表要有背景板**（用户要求）——
   它是这一轮任务的「状态板」，与一行行动作明细不是同一层级，用底色 + 描边把它托起来。 */
.dcf-plate{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;padding:2px 4px;margin:2px 0}
.dcf-platehead{display:flex;align-items:center;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:8px;padding:4px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-platehead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-platetitle{flex:none;color:var(--dsw-alias-label-primary)}
.dcf-platebody{display:flex;flex-direction:column;gap:1px;padding:2px 6px 4px 22px}
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
.dcf-thinkingtitle{flex:none;color:var(--dsw-alias-label-tertiary)}
/* 浮动光效：一道高光在文字上循环扫过，用来表达「还在处理」。 */
.dcf-thinkingtitle[data-shimmer=true]{background-image:linear-gradient(100deg,var(--dsw-alias-label-tertiary) 0%,var(--dsw-alias-label-tertiary) 38%,var(--dsw-alias-label-primary) 50%,var(--dsw-alias-label-tertiary) 62%,var(--dsw-alias-label-tertiary) 100%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dcf-shimmer 1.8s linear infinite}
@keyframes dcf-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}

/* 卡片：一次操作的背景板。头部一行，展开体在里面。 */
.dcf-card{background:0 0;border:0;border-radius:0;overflow:visible}
.dcf-card[data-live=true]{}
.dcf-cardhead{display:flex;align-items:center;gap:8px;width:100%;min-width:0;background:0 0;border:none;padding:4px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-cardhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-cardhead:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:-2px}
.dcf-cardicon{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-secondary)}
.dcf-cardtitle{flex:none;color:var(--dsw-alias-label-tertiary)}
.dcf-cardsummary{min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-cardbody{display:flex;flex-direction:column;gap:6px;padding:0 6px 6px 22px}

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
/* 刻度：一个方格，里面写**回合号**（用户要求数字显示；横线认不出这是第几轮）。
   状态靠边框与文字颜色区分，不靠形状——形状已经让给数字了。 */
.dcf-mark{position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:20px;padding:0;border:1px solid var(--dsw-alias-border-l4,#3a3a3a);border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:10px;line-height:1;font-variant-numeric:tabular-nums;cursor:pointer;transition:border-color .14s ease,color .14s ease,background-color .14s ease}
.dcf-mark:hover{border-color:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-secondary,#ccc)}
.dcf-mark[data-active=true]{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-surface-tertiary,rgba(140,140,140,.2));color:var(--dsw-alias-label-primary)}
.dcf-mark[data-loaded=false]{border-style:dashed;opacity:.6}
.dcf-mark[data-live=true] .dcf-marknum{animation:dcf-mark-live 1s ease-in-out infinite}
.dcf-mark[data-busy=true] .dcf-marknum{color:transparent}
.dcf-mark .dcf-spinner{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:10px;height:10px}
.dcf-mark:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px}
.dcf-scroll-bottom-btn{position:fixed;bottom:56px;right:28px;z-index:8;display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,#444);background:var(--dsw-alias-surface-secondary,rgba(30,30,30,.85));color:var(--dsw-alias-label-secondary,#ccc);cursor:pointer;backdrop-filter:blur(4px);box-shadow:0 2px 12px rgba(0,0,0,.35);transition:opacity .18s ease,transform .14s ease}
.dcf-scroll-bottom-btn:hover{background:var(--dsw-alias-surface-tertiary,rgba(50,50,50,.9));transform:translateY(-1px)}
.dcf-scroll-bottom-btn:active{transform:translateY(0)}
.dcf-scroll-bottom-btn:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px}

@keyframes dcf-mark-live{0%,100%{opacity:1}50%{opacity:.35}}

/* 窄屏 / 手机：阅读列收窄内边距、导轨变细并让位、触摸目标加大、避开安全区。
   导轨**不隐藏**——它是这个视图的主要导航；只把它压细并给内容留出右侧空间。 */
@media (max-width:720px){
.dcf-root{padding:10px 0 8px}
.dcf-main{gap:12px;padding:0 20px 0 12px}
.dcf-rail{right:2px;gap:10px;max-height:min(320px,max(0px,calc(var(--dcf-rail-band) - 48px)))}
.dcf-mark{width:24px;height:24px;font-size:11px}
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
.dcf-leaf+.dcf-leaf{margin-top:12px}
}

/* 行首状态标记（目前只有插队消息用）：贴在气泡上方，说明这条消息是怎么进来的。 */
.dcf-leaf-marked{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.dcf-leafmarker{align-self:flex-end;margin-right:4px}

/* 待发送 / 插队的消息：坐在列表末尾，一眼看出「我发的消息去哪了」。 */
.dcf-pending{display:flex;flex-direction:column;align-items:flex-end;gap:4px;opacity:.92}
.dcf-pendingstate{display:flex;justify-content:flex-end;padding-right:4px}

/* 视图层错误摘要：不白屏、可读、可反馈（正常情况永远看不到它）。 */
.dcf-error{display:flex;flex-direction:column;gap:8px;margin:10px 0;padding:12px 14px;border:.5px solid var(--dsw-alias-state-error-primary,var(--dsw-alias-border-l1));border-radius:10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08))}
.dcf-errortitle{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));font-weight:500}

/* 触屏设备：去掉只对鼠标有意义的悬浮反馈，避免点击后残留 hover 态。
   刻度仍然要够大（34px 宽），数字读得清。 */
@media (hover:none){
.dcf-rail{right:0;gap:12px}
.dcf-mark{width:34px;height:24px}
.dcf-row:hover,button.dcf-taskrow:hover,.dcf-cardhead:hover,.dcf-platehead:hover{background:0 0}
}

/* 动效收敛：尊重系统的「减少动态效果」。 */
@media (prefers-reduced-motion:reduce){
.dcf-fold,.dcf-fold[data-open=true],.dcf-chev,.dcf-mark{transition:none}
.dcf-mark[data-live=true] .dcf-marknum{animation:none}
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

    /** 复制一段文本到剪贴板，并把「已复制」状态显示一小会儿。 */
    function useCopyAction(text) {
      const [copied, setCopied] = useState(false)
      const onCopy = useCallback(() => {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
            navigator.clipboard.writeText(text)
          }
        } catch {
          // 剪贴板不可用（非安全上下文等）：静默失败，不打断阅读。
        }
        setCopied(true)
        if (typeof window !== 'undefined') window.setTimeout(() => setCopied(false), 1500)
      }, [text])
      return [copied, onCopy]
    }

    /**
     * 用户消息气泡（字面文本，不做 markdown 解析——与核心的 `MessageText` 语义一致）。
     *
     * ⚠️ **这里必须照着核心的 DOM 约定输出属性**，否则别人的插件挂不上来：
     * 回退插件（`dsh-rewind-plugin`）用一段 DOM 桥，按
     * `[data-chat-flow-kind="user"][data-chat-anchor-key]` 找用户消息座位，
     * 再往座位里的 `[data-actions-reveal]` 容器的**最后一个子元素**里 portal 一个「还原到此处」按钮
     * （它要求那个容器里**已经有一个按钮**，否则整条座位被跳过）。
     * 所以这里给座位打上这两个属性，并在里面放一个真实的「复制」按钮：
     * 既是有用的功能，也是那个容器被认领的前提。
     *
     * @param props - `text`、`nodeKey`（该消息节点的 key，用作锚点）、`kind`（`user` / `steering`）、`t`。
     * @returns 用户消息行。
     */
    function UserBubble({ text, nodeKey, kind, t }) {
      const [copied, onCopy] = useCopyAction(typeof text === 'string' ? text : '')
      if (typeof text !== 'string' || text.trim() === '') return null
      const anchors =
        nodeKey === undefined
          ? {}
          : { 'data-chat-flow-kind': kind ?? 'user', 'data-chat-anchor-key': nodeKey }
      return h(
        'div',
        { className: 'dcf-ask', ...anchors },
        h('div', { className: 'dcf-bubble' }, h(MessageText, { text })),
        h(
          'div',
          { className: 'dcf-askactions', 'data-actions-reveal': 'true' },
          h(
            'div',
            { className: 'dcf-askbuttons' },
            h(
              'button',
              { type: 'button', className: 'dcf-mini', title: t('flow.copy'), onClick: onCopy },
              copied ? t('flow.copied') : t('flow.copy'),
            ),
          ),
        ),
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

    /**
     * 可折叠行左端的箭头：**状态与旋转都挂在包裹容器上**。
     *
     * ⚠️ primitives 的图标组件只接受 `size` / `className` 两个 prop
     * （`({ size = 14, className }) => jsx('svg', {...})`），`data-*` **不会**透传到 `<svg>`。
     * 所以 `data-open` 与旋转都放在外层 `<span class="dcf-chev">` 上，否则 CSS 的
     * `[data-open=true]` 永远匹配不到、箭头永远不转（这是本视图第一个真实缺陷）。
     *
     * @param props - `open`：展开时向右旋转 90°，指向下。
     * @returns 箭头容器。
     */
    function Chevron({ open }) {
      const icon = primitives.IconChevronRightOutline14
      return h(
        'span',
        { className: 'dcf-chev', 'data-open': open === true ? 'true' : 'false' },
        typeof icon === 'function' ? h(icon, {}) : null,
      )
    }

    /**
     * 折叠容器：切换 CSS grid 轨道高度（`0fr ↔ 1fr`）并过渡，可选**懒加载**。
     *
     * 三个设计点：
     * 1. **默认保持挂载**——展开状态归组件自己所有（例如展开的任务里那个展开的「思考中」），
     *    卸载会把它丢掉；核心的 `ChatNodeSeat` 也奉行「稳定 seat、只隐藏不卸载」。所以
     *    `lazy` 默认关闭：收起只改 CSS，子树留在树里。
     * 2. **`lazy` 只给装了重子树的折叠体用**（当前只有「思考中 / 思考完成」块）——它默认收起、
     *    而正文里的每一条明细都要经原生座位 `conversation.chat.node` 走一遍核心渲染，一个长
     *    会话里这就是几百次白跑。这类折叠体在收起时只留**空壳**（`.dcf-fold` + 空白 `.dcf-body`），
     *    展开时才把子树挂上。空壳留在 DOM 里是为了让「展开」那一帧仍有 CSS 过渡可插值
     *    （连容器一起卸载就变成瞬间替换而不是滑开）。
     *    卸载**不会**丢嵌套块的展开状态：状态归 `useCollapse` 所有，存在 localStorage 里，
     *    重新挂载时按同一个键读回来（见 `30-collapse.js`）。
     * 3. **不量高度**——`grid-template-rows` 的过渡由浏览器插值，无需 `useLayoutEffect` +
     *    `scrollHeight`，内容流式增长时也不会抖。收起时再用 `visibility: hidden`（延迟到动画
     *    结束）把子树从 Tab 顺序里摘出去。
     *
     * @param props - `open`、`className`（内层类名，承载 padding/gap）、`children`、`lazy`。
     * @returns 折叠容器；**没有内容**时返回 `null`（不留下无意义的空壳）。
     */
    function Fold({ open, className, children, lazy }) {
      if (children === undefined || children === null) return null
      // 懒加载路径：收起即不渲染子树；其余折叠体照旧「收起只改 CSS」。
      const body = open === true || lazy !== true ? children : null
      return h(
        'div',
        { className: 'dcf-fold', 'data-open': open === true ? 'true' : 'false' },
        h('div', { className: className ?? 'dcf-body' }, body),
      )
    }

    /**
     * 通用折叠行：一行标题 + 摘要 + 右侧徽标，展开体经 {@link Fold}。
     *
     * 交互与核心的工具行一致（点整行切换、`aria-expanded` 可读），因为这是同一个心智模型：
     * 先看一行摘要，需要时再展开看明细。不可展开的行走纯文本行（`div`）而不是 disabled 按钮
     * ——它是一条标签，不是一个失效控件。
     *
     * `locked` 表示「此刻不允许开合」（例如任务还在跑时的「任务过程」）：整行退化成静态行并带
     * `data-locked`，用户点不动它；`open` 与摘要照常显示，所以读者仍然看得到状态。
     *
     * @param props - `open`、`onToggle`、`leading`、`title`、`summary`、`trailing`、`children`、`className`、`locked`。
     * @returns 可折叠行。
     */
    function DisclosureLine({ open, onToggle, leading, title, summary, trailing, children, className, locked }) {
      const interactive = typeof onToggle === 'function' && locked !== true
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
        : h(
            'div',
            { className: 'dcf-row', 'data-static': 'true', 'data-locked': locked === true ? 'true' : undefined },
            ...cells,
          )
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
    /* ──────────────────────────── 原生节点座位 ──────────────────────────── */

    /**
     * 核心的**对话节点插槽**：本视图的每一行内容都从这里渲染。
     *
     * 用户要求「命令运行、工具调用、思考的展示方式都用原生的 DSH 的，自己只处理节点之间的层级关系」。
     * 这个槽就是核心的叶子渲染面：17 个 kind 全部有原生条目——14 个在 `dsh-client-ui-chat`
     * （`user` / `steering` / `context` / `system-prompt` / `assistant-step` / `command` /
     * `manual-compaction` / `compaction` / `model-retry` / `turn-error` / `turn-max-tokens` /
     * `turn-process` / `turn-tail` / `unknown`），另有 `tool-call`（ui-tool，内部再按工具名分派到
     * 命令卡 / 差异块 / 读取块 / 搜索块 / 提问卡…）、`command-input`（ui-goal）、
     * `workflow-run`（ui-workflow-run）。事实与行号见 `docs/references/core-seams.md` §13。
     */
    const NATIVE_NODE_SLOT = 'conversation.chat.node'

    /** 消息图片插槽：原生用户/助手座位经它渲染附件（ui-attachment 注册的条目）。 */
    const NATIVE_IMAGES_SLOT = 'conversation.message.images'

    /** 本插件自己的会话作用域子槽：只为让渲染器给本条目 `renderSlot` 与 `SessionProvider`。 */
    const OWN_SEAT_SLOT = 'chat-flow.seat'

    /**
     * ⚠️ **本视图自己接管的合成节点**（不交给原生座位）定义在派生层：`20-derive.js` 的
     * `OWNED_NODE_KINDS`——那里同时说明为什么 `turn-tail` 必须交给核心而不是自己画。
     * 放在派生层是因为「哪些节点属于本插件」是**模型层的事实**：座位筛选（`seatNodesOf`）
     * 与「空块」判定（`isBlankNode`）都从同一处读，避免两份名单走偏。
     */

    /**
     * 本条目声明的子槽表。
     *
     * ⚠️ **这里有一个刻意的技巧，依据是核心源码而不是猜测**：`register()` 的子槽冲突检查只枚举
     * **自有可枚举**键（`dsh-client-ui-slots/lib/index.js:100` 的 `Object.keys(options.children)`），
     * 而 `renderSlot` 的所有权检查只做属性读取（`dsh-client-ui-renderer/lib/client.js:285`
     * 的 `entry.children?.[key]`）。核心 ui-chat 的视图条目**已经声明**了
     * `conversation.chat.node` 与 `conversation.message.images`，直接写进 children 会抛
     * 「slot is already declared」。把这两个核心子槽挂成**不可枚举属性**：冲突检查看不到它们，
     * 所有权检查读得到它们，于是本条目获得 `renderSlot` 的授权，却既不去声明、也永远不会
     * 在释放时连带把别人的子槽收掉（`releaseEntry` 同样只枚举自有可枚举键，见 §13）。
     *
     * `chat-flow.seat` 是本插件**自己**的会话作用域子槽（空实现）：条目一旦声明了 children，
     * 渲染器才会把 `renderSlot` 放进 kit；其中有会话作用域子槽时才会给 `SessionProvider`。
     *
     * @returns children 表。
     */
    function nativeViewChildren() {
      const children = {}
      children[OWN_SEAT_SLOT] = { kind: 'single', scope: 'session' }
      const coreSlots = [
        [NATIVE_NODE_SLOT, { kind: 'keyed', scope: 'session' }],
        [NATIVE_IMAGES_SLOT, { kind: 'single', scope: 'session' }],
      ]
      for (const [key, spec] of coreSlots) {
        Object.defineProperty(children, key, {
          value: spec,
          enumerable: false,
          writable: false,
          configurable: true,
        })
      }
      return children
    }

    /**
     * 节点所在回合的**数据存储**，作为插槽的 `hookContext` 传下去。
     *
     * 与核心 `turnDataOf`（`dsh-client-ui-chat/lib/client.js:1467-1470`）逐字同义：
     * 只有 `location.kind` 是 `turn` / `step` 时才有；`unresolved` 或没有 location 时是 `undefined`。
     * 这个值必须**每次渲染都传**（哪怕是 `undefined`），因为该槽子规格上挂着上下文 hook 工厂
     * （`CHAT_NODE_INJECT`，见 §13）；渲染器发现「有上下文 hook 却没给 hookContext」会直接抛
     * `SlotAssemblyError`（`dsh-client-ui-renderer/lib/client.js:635`）。
     *
     * @param node - 对话节点。
     * @returns 回合数据存储，或 `undefined`。
     */
    function turnDataOfNode(node) {
      const location = node?.location
      return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.data : undefined
    }

    /** 节点所在回合号（原生座位没有这个属性，本视图用它输出核心同款的 `data-chat-turn`）。 */
    function turnOfChatNode(node) {
      const location = node?.location
      return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
    }

    /**
     * 原生座位外层的错误边界。
     *
     * **为什么必须有**：本视图把整块界面交给别人的组件渲染，任何一次原生渲染抛错都会顺着
     * React 冒泡到插槽条目的错误边界，条目被判「让位」（abdicate）——整块对话区变成
     * `data-slot-error`，代价远大于少渲染一行。这里把失败收敛在**单个节点**的范围内：
     * 那一行退化成自绘叶子，其余行照常。
     */
    class NativeLeafBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        // 显式报错而不是静默吞掉：真机出问题时这条日志是唯一的线索。
        console.warn('[chat-flow] 原生节点座位渲染失败，该行改用自绘叶子：', error)
      }

      render() {
        return this.state.failed === true ? (this.props.fallback ?? null) : this.props.children
      }
    }

    /**
     * 真正调用插槽的那一层（抛错发生在它的渲染里，因此被外层边界接住）。
     *
     * `fallback` 同时交给核心：某个 kind 没有任何条目时，插槽自己会渲染它
     * （`dsh-client-ui-renderer/lib/client.js:828`），所以「核心没装 ui-tool」这类情况
     * 也会退化成自绘卡片，而不是留一片空白。
     */
    function NativeSeatInner({ node, owner, renderSlot, fallback }) {
      return renderSlot(
        NATIVE_NODE_SLOT,
        { ...owner, node },
        {
          entryKey: typeof node?.kind === 'string' ? node.kind : 'unknown',
          hookContext: turnDataOfNode(node),
          fallback,
        },
      )
    }

    /**
     * 一个节点的原生座位。
     *
     * @param props - `node`、`owner`（原生座位需要的主人参数）、`renderSlot`、`fallback`。
     * @returns 座位；`renderSlot` 不可用（例如装配里没有 ui-chat）时直接给回退叶子。
     */
    function NativeSeat({ node, owner, renderSlot, fallback }) {
      const safeFallback = fallback ?? null
      if (typeof renderSlot !== 'function') return safeFallback
      return h(
        NativeLeafBoundary,
        { fallback: safeFallback },
        h(NativeSeatInner, { node, owner, renderSlot, fallback: safeFallback }),
      )
    }

    /**
     * 自绘叶子：原生座位不可用时的退路，复用本插件原有的卡片层。
     *
     * @param props - `node`、`row`（{@link nodeRowOf} 的结果）、`t`、`sessionId`、`labels`。
     * @returns 叶子；该节点没有可渲染模型时返回 `null`。
     */
    function ChatFlowLeaf({ node, row, t, sessionId, labels }) {
      if (row === null || row === undefined) return null
      if (row.kind === 'tool') {
        return h(ToolCard, { card: row.card, t, sessionId, labels, keyPrefix: `n:${row.key}` })
      }
      if (row.kind === 'thinking') return h(ThinkingEntry, { entry: row, t, sessionId })
      if (row.kind === 'row') return h(ProcessRowEntry, { entry: row, t })
      if (row.kind === 'message') {
        return h(UserBubble, { text: row.text, nodeKey: node?.key, kind: node?.kind, t })
      }
      if (row.kind === 'assistant') return h(AssistantText, { text: row.text, labels })
      return h('pre', { className: 'dcf-pre' }, row.text)
    }

    /**
     * 一行节点：**原生座位优先、自绘叶子兜底**，并补上核心的 DOM 约定属性。
     *
     * `data-chat-anchor-key` / `data-chat-flow-kind` / `data-chat-flow-key` / `data-chat-turn`
     * 是核心 `ChatNodeSeat` 外层容器（`dsh-client-ui-chat/lib/client.js:1535-1544`）输出的属性，
     * 别人的插件按它们找座位——例如回退插件用
     * `[data-chat-flow-kind="user"][data-chat-anchor-key]` 定位用户发言，再往行内的按钮容器里
     * 挂一个「还原到此处」按钮（`dsh-rewind-plugin/lib/client.js:1111-1123`）。
     *
     * @param props - `node`、`row`、`seat`（`{owner, renderSlot}`）、`t`、`sessionId`、`labels`、`marker`（可选的状态标记文字）。
     * @returns 行。
     */
    function NativeNodeRow({ node, row, seat, t, sessionId, labels, marker }) {
      const fallback = h(ChatFlowLeaf, { node, row, t, sessionId, labels })
      const attributes = {
        className: marker === null || marker === undefined ? 'dcf-leaf' : 'dcf-leaf dcf-leaf-marked',
        'data-chat-flow-kind': node.kind,
        'data-chat-flow-key': node.key,
        'data-chat-anchor-key': node.key,
      }
      const turn = turnOfChatNode(node)
      if (turn !== undefined) attributes['data-chat-turn'] = String(turn)
      const content = [
        h(NativeSeat, {
          key: 'seat',
          node,
          owner: seat?.owner,
          renderSlot: seat?.renderSlot,
          fallback,
        }),
      ]
      // 状态标记（目前只有插队消息用）：挂在行首，说明「这条消息是怎么进来的」。
      if (marker !== null && marker !== undefined) {
        content.unshift(h('span', { key: 'marker', className: 'dcf-chip dcf-leafmarker', 'data-tone': 'warn' }, marker))
      }
      return h('div', attributes, content)
    }

    /** 一批节点的回退模型（按节点 key 索引）；空结果不建 Map，避免每行都白查一次。 */
    function rowModelsOf(nodes, subagents) {
      const models = new Map()
      for (const node of nodes) {
        const row = nodeRowOf(node, subagents)
        if (row !== null) models.set(node.key, row)
      }
      return models
    }

    /**
     * 会话相对路径 → 主机可用的绝对路径。
     *
     * 与核心的 `resolveWorkspacePath`（`@deepseek-ai/dsh-util-workspace-path/lib/index.js:16-20`）
     * 同义：`/` 开头与 Windows 盘符/UNC 前缀视为绝对路径，其余拼到会话 cwd 下。
     * 那个助手是包内私有导出、不在平台 seed 模块表里，所以这里自己实现同义逻辑。
     *
     * @param cwd - 会话工作区根。
     * @param path - 绝对或用例相对路径。
     * @returns 绝对路径；cwd 未知时原样返回。
     */
    function resolveSeatPath(cwd, path) {
      if (typeof path !== 'string' || path === '') return path
      if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')) return path
      if (typeof cwd !== 'string' || cwd === '') return path
      return `${cwd.replace(/[/\\]+$/, '')}/${path.replace(/^[/\\]+/, '')}`
    }

    /**
     * 原生叶子需要的**注入面**：核心 ui-chat 在它自己的视图条目里提供的同款能力
     * （`dsh-client-ui-chat/lib/client.js:8108-8151`），本视图必须自己造一份。
     *
     * 可选服务一律用 `ctx.get(name)` 取，**不写进 `inject` 列表**：cordis 的 `inject` 是强依赖，
     * 服务缺席会让整个插件干脆不装配（对话区连任务视图都不会出现）；而 `ctx.get` 缺席只返回
     * `undefined`，能力降级、视图照常。核心自己也用 `ctx.get('chatFileMentions')`（`ui-chat:8123`）。
     *
     * @param ctx - 客户端插件上下文。
     * @param sessionId - 本条目所属会话。
     * @returns 注入面。
     */
    function nativeSeatFace(ctx, sessionId) {
      const optional = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)
      const uiConversation = optional('uiConversation')
      const remote = optional('remote')
      return {
        /** 按会话 cwd 打开文件（原生叶子里点文件名会走到这里）。 */
        openFile: async (path) => {
          if (remote?.session === undefined) throw new Error('chat-flow: remote.session 不可用，无法打开路径')
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          const result = await remote.session.openWorkspacePath({ path: resolveSeatPath(cwd, path) })
          if (result.ok !== true) throw new Error(`chat-flow: 打开路径失败（${result.error?.message ?? '未知原因'}）`)
        },
        /** 附件图片 URL；核心在同一个位置提供同名的 `{peek}` 挂件（`ui-chat:8133`）。 */
        loadImage:
          uiConversation === undefined
            ? undefined
            : Object.assign((attachment) => uiConversation.imageUrl(sessionId, attachment), {
                peek: (attachment) => uiConversation.peekImageUrl(sessionId, attachment),
              }),
        /** 助手消息里的文件引用；服务缺席时给 `undefined`，原生叶子会跳过提及渲染（`ui-chat:8123`）。 */
        fileMentions: (owner) => {
          const service = optional('chatFileMentions')
          return typeof service?.forClosing === 'function' ? service.forClosing(owner) : undefined
        },
        /** 从某个 seq 分叉出新会话（回合尾部的分支按钮用，`ui-chat:8141-8149`）。 */
        forkAt: (seq) => {
          const sessions = ctx.sessions
          if (typeof sessions?.fork !== 'function') return
          sessions.fork({ sessionId, atSeq: seq, increaseTitle: true }).then(
            (childId) => sessions.open(childId),
            // 分叉失败（会话已被释放等）不该打断阅读：显式忽略，不写空 catch。
            () => undefined,
          )
        },
      }
    }

    /** 要渲染的节点：剔除本视图自己接管的合成节点（见 {@link OWNED_NODE_KINDS}）。 */
    function seatNodesOf(nodes) {
      return nodes.filter((node) => node !== null && node !== undefined && !OWNED_NODE_KINDS.has(node.kind))
    }

    /**
     * 「上下文注入」折叠点：一段里的多次注入**合并进同一个折叠点**（用户要求）。
     *
     * 折叠态只显示注入段数，展开后每一段仍是**原生座位**（核心的 `context` 条目带来源与形态标签），
     * 只是被收进了同一个折叠容器里——层级由本插件给，内容仍由核心画。
     *
     * @param props - `nodes`（该段全部 context 节点）、`models`、`t`、`sessionId`、`seat`、`labels`。
     * @returns 折叠点。
     */
    function ContextFold({ nodes, models, t, sessionId, seat, labels }) {
      const [open, toggle] = useCollapse(sessionId, `ctx:${nodes[0].key}`, false)
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.row.context'),
          trailing: h('span', { className: 'dcf-badge' }, t('flow.context.count', { count: nodes.length })),
        },
        nodes.map((node) =>
          h(NativeNodeRow, {
            key: node.key,
            node,
            row: models.get(node.key),
            seat,
            t,
            sessionId,
            labels,
          }),
        ),
      )
    }
    /* ──────────────────────────── 「思考中 / 思考完成」块 ──────────────────────────── */

    /**
     * 把统计分段拼成一行本地化文本。
     *
     * 文案组装放在**渲染层**而不是派生层：派生层只认类别键，中文/英文由 `t` 决定。
     * 每一项都是**完整句子**（用户要求「思考 x 次 执行 y 条命令 读取 w 个文件 编辑 z 个文件
     * 这种说法」），所以计数作为参数传进模板，而不是在句子后面再挂一个裸数字——
     * 中文的量词是跟着名词走的，拼接会拼出「执行 5 命令」这种半截话。
     * **计数为 0 的类别完全不显示**（用户明确要求）；全部为 0 时退化成「N 个操作」或「无操作」。
     *
     * @param stats - {@link statsOfNodes} 的结果。
     * @param t - locale 座位。
     * @returns 折叠态那一行统计文本。
     */
    function describeStats(stats, t) {
      const { segments, listed } = statsSummary(stats)
      if (segments.length === 0) return listed > 0 ? t('flow.ops', { count: listed }) : t('flow.noOps')
      return segments.map((segment) => t(CATEGORY_LOCALE_KEYS[segment.category], { count: segment.count })).join(' · ')
    }

    /**
     * 「思考中 / 思考完成」块：一段处理过程的折叠容器。
     *
     * - 标题随状态切换：还在跑 = **思考中**（带浮动光效），跑完 = **思考完成**，被停掉 = **未完成**；
     * - 折叠时只显示非零的统计项（思考 x 次 / 执行 y 条命令 / 读取 w 个文件 / 编辑 z 个文件 /
     *   调用 k 个 MCP 工具 / 提问 v 次，0 值不显示）；
     * - 默认展开条件 = 这段过程所属的任务/回合正在进行；结束后自动收起；
     * - **容器是插槽的，内容是核心的**：行内每一行都走原生座位（命令卡、工具卡、思考行…），
     *   多次上下文注入合并进同一个折叠点（{@link ContextFold}）。
     *
     * @param props - `blockKey`、`nodes`、`models`、`stats`、`t`、`sessionId`、`active`、`cutOff`、`labels`、`seat`。
     * @returns 折叠块。
     */
    function ThinkingBlock({ blockKey, nodes, models, stats, t, sessionId, active, cutOff, labels, seat }) {
      // **默认永远收起**（懒加载：收起时正文不进 DOM——本块是唯一传 `lazy: true` 的折叠体，
      // 因为它的明细最多且每条都要经原生座位走一遍核心渲染；展开时正文按需重建）。
      // 折叠头一行给出状态（思考中 / 思考已完成 / 思考被打断）与统计，需要看过程时点开。
      const [open, toggle] = useCollapse(sessionId, blockKey, false)
      const rows = useMemo(() => groupProcessNodes(nodes), [nodes])
      const body = []
      for (const row of rows) {
        if (row.kind === 'contexts') {
          body.push(
            h(ContextFold, {
              key: `ctx:${row.nodes[0].key}`,
              nodes: row.nodes,
              models,
              t,
              sessionId,
              seat,
              labels,
            }),
          )
          continue
        }
        body.push(
          h(NativeNodeRow, {
            key: row.node.key,
            node: row.node,
            row: models.get(row.node.key),
            seat,
            t,
            sessionId,
            labels,
          }),
        )
      }
      /**
       * 标题只看**这一块自己**有没有被中断（`cutOff`）。
       *
       * ⚠️ 不能把「回合还没收尾」（`unfinished`）当成被打断：回合级的标志里含着
       * 「后台子 agent 已派出但报告未到」这类正常情况，一挂上去就变成**每一块都写「被打断」**
       * （用户报告过）。回合级的标志只用在「任务过程」折叠头的警示 chip 上。
       */
      const title =
        active === true
          ? t('flow.thinking.live')
          : cutOff === true
            ? t('flow.thinking.cutOff')
            : t('flow.thinking.done')
      return h(
        'div',
        { className: 'dcf-thinking', 'data-live': active === true ? 'true' : 'false' },
        h(
          'button',
          {
            type: 'button',
            className: 'dcf-row dcf-thinkinghead',
            'aria-expanded': open === true,
            // 折叠键写进 DOM：本块是全插件**唯一**懒加载的折叠体，收起时正文根本不在树里，
            // 「这一块的键是什么」就成了排查与测试都绕不开的信息（同时也是 localStorage 里的键）。
            'data-fold-key': blockKey,
            onClick: toggle,
          },
          h(Chevron, { open }),
          h('span', { className: 'dcf-thinkingtitle', 'data-shimmer': active === true ? 'true' : 'false' }, title),
          // 折叠点后面不加数字（用户要求）：统计本身就说明了这一段做了什么。
          h('span', { className: 'dcf-summary' }, describeStats(stats, t)),
        ),
        h(Fold, { open, className: 'dcf-body', lazy: true }, body),
      )
    }

    /**
     * 渲染一段节点：按「过程 run / 正文 run」交替排列。
     *
     * **为什么按 run 切**（用户要求）：一段过程里一旦出现对用户可见的正文，
     * 前面的思考块就**封口**（结束），后面的动作属于**下一个**思考块——
     * 于是「思考中」不再是一整段任务的巨大容器，而是「一次思考 → 一段输出 → 再思考」的节奏。
     *
     * `mode` 决定渲染哪一半（两份互斥，同一节点不会被画两次）：
     * - `inside`（默认）：画进「任务过程」的那一份。`summary === true` 时**跳过最后一段正文**
     *   （那一段要留在最外层当汇报）；
     * - `summary`：只画**最后一段正文**（任务结束时对用户的汇报）。
     *
     * 用户当轮要求「思考过程中穿插的对用户输出的内容应该合并到任务过程的节点里面去，
     * 而不应该显示在最外层的层级」：所以跑动中（`summary` 不为真、外面也不画）过程中写的正文
     * 全都在任务过程里；只有任务结束后的那一段留在最外层。
     *
     * **收尾节点（`turn-tail`）在这里被剔除**：它的位置由回合层固定在「总结之后」单独渲染
     * （见 `isFooterNode`），任何折叠体都不该把它卷进去——否则复制/点赞/点踩/分支按钮会
     * 跑到「任务过程」里面去（用户报告过）。
     *
     * @param props - `nodes`、`blockKey`、`t`、`sessionId`、`labels`、`active`、`liveKey`、`subagents`、`mode`、`summary`、`seat`。
     * @returns 节点序列；没有任何可显示内容时返回 `null`。
     */
    function NodeSequence({ nodes, blockKey, t, sessionId, labels, active, liveKey, subagents, mode, summary, seat }) {
      // 最外层节点（用户发言 / 插队 / 收尾控件）由回合层渲染：这里剔除它们；run 也会在它们处断开。
      const seatNodes = useMemo(() => seatNodesOf(nodes).filter((node) => !isTopLevelNode(node)), [nodes])
      const runs = useMemo(() => nodeRunsOf(seatNodes), [seatNodes])
      // 回退模型只在这里算一次：正文行与过程块共用这份 Map，避免重复解析工具块。
      const models = useMemo(() => rowModelsOf(seatNodes, subagents), [seatNodes, subagents])
      const summaryIndex = lastInlineRunIndex(runs)
      const children = []
      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index]
        if (mode === 'summary' ? index !== summaryIndex : summary === true && index === summaryIndex) continue
        if (run.kind === 'process') {
          // 整块都渲染成空的过程（见 {@link isBlankNode}）不画：画出来只有一个「无操作」的折叠头，
          // 看起来就像一个凭空的思考块（用户报告过最前面那块残留）。
          if (run.nodes.every(isBlankNode)) continue
          const first = run.nodes[0]
          /**
           * 这一块**正在写**吗？判据是「回合在跑 **且** 本块包含回合的最后一个可渲染节点」。
           * 只判回合会让同一回合里早已写完的块一直显示「思考中」（用户报告过）；
           * 只判节点又会让回合结束后的最后一块永远停在「思考中」。
           */
          const blockActive =
            active === true &&
            liveKey !== null &&
            liveKey !== undefined &&
            run.nodes.some((node) => node.key === liveKey)
          children.push(
            h(ThinkingBlock, {
              // 每个 run 一块：key 与折叠状态键都用该 run 的第一个节点（稳定且唯一）。
              key: `run:${first.key}`,
              blockKey: `${blockKey}:${first.key}`,
              nodes: run.nodes,
              models,
              stats: statsOfNodes(run.nodes, subagents),
              t,
              sessionId,
              active: blockActive,
              cutOff: cutOffOf(run.nodes),
              labels,
              seat,
            }),
          )
          continue
        }
        for (const node of run.nodes) {
          children.push(
            h(NativeNodeRow, {
              key: node.key,
              node,
              row: models.get(node.key),
              seat,
              t,
              sessionId,
              labels,
            }),
          )
        }
      }
      if (children.length === 0) return null
      return h('div', { className: 'dcf-block' }, children)
    }
    /* ──────────────────────────── 计划 / 任务列表快照 / 子任务 ──────────────────────────── */

    /** 状态点在任务行左侧：已完成/进行中用 primitives 的 `StateDot`，未开始用空心圆。 */
    function TaskDot({ status, stalled }) {
      if (status === 'completed') return h(StateDot, { state: 'done', size: 10, className: 'dcf-dot' })
      // ⚠️ `ongoing` 是**会转的**状态点。回合已结束（例如被用户停止）却还挂在 in_progress 上的任务
      // 必须换成静态的警示点，否则界面一直在转，等于告诉用户「还在干活」——那是错的。
      if (status === 'in_progress') {
        return h(StateDot, { state: stalled === true ? 'warning' : 'ongoing', size: 10, className: 'dcf-dot' })
      }
      // 「已停止」：被后续任务列表接管的那一项。用 primitives 的中性静态点（`idle` 没有专属配色，
      // 走 currentColor）——它既不是「还在转」，也不是「出错了」，只是不再运行。
      if (status === 'stopped') return h(StateDot, { state: 'idle', size: 10, className: 'dcf-dot' })
      return h('span', { className: 'dcf-dot dcf-dot-pending' })
    }

    /**
     * 任务行在界面上的**显示状态**。
     *
     * 快照内容永远冻结（用户要求「显示也是显示这时的状态」），但**运行状态不能冻结**：
     * 后续列表一出现，旧列表里那一项就不再是「进行中」了——它已经被接管。
     * 不这么做的话，一个回合从头到尾**第一步那一版**都挂着会转的进度圈
     * （用户报告过「老的任务列表都在第一步，都有进度圈在转」）。
     *
     * @param segment - 分段视图模型（认 `superseded`）。
     * @param status - 该快照里冻结的状态。
     * @returns `stopped`（被接管），否则原样返回。
     */
    function displayStatusOf(segment, status) {
      return segment.superseded === true && status === 'in_progress' ? 'stopped' : status
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
      if (status === 'stopped') return t('flow.status.stopped')
      return t('flow.status.pending')
    }

    /**
     * 任务列表**快照面板**：每一次 `todo_write` 的冻结状态各成一块（背景板）。
     *
     * 这是用户当轮要求的核心语义：「不能全局调用，只有有更新任务列表，就要存储一次这时的状态，
     * 之后显示也是显示这时的状态」。所以这里渲染的是**该分段自己的那份快照**，
     * 而不是「当前最新列表」——否则对话里每处列表都长一样，历史进度就没有意义了。
     *
     * **默认展开规则**（三条用户要求合起来）：
     * - **只有最后一块（当前那一版）默认展开**（用户要求「如果一个任务列表出现后列表被更新了，
     *   那么老的任务列表就应该自动折叠」）：旧版是历史，展开只是占地方；
     * - 当前这一版里，**整张表全部已完成时也默认收起**（用户要求「当任务列表更新为『全部已完成』
     *   状态时，不需要展开」）——这时候没有「进度」可看；
     * - 用户手动点过就以用户的选择为准（`useCollapse` 只在显式切换时写 localStorage）。
     *
     * ⚠️ 表内**运行状态跟着最新的列表走**：被接管的旧版里「进行中」那一项显示成「已停止」、
     * 点也不再转（见 {@link displayStatusOf}）——冻结的是**内容**，不是「还在不在跑」。
     *
     * @param props - `segment`、`t`、`sessionId`、`unfinished`。
     * @returns 快照面板。
     */
    function SnapshotPlate({ segment, t, sessionId, unfinished }) {
      /** 这一版是不是「当前那一版」（后面还有更新的列表就被接管了）。 */
      const current = segment.superseded !== true
      /** 整张表是否都已完成（空表不算），据此决定默认展开还是默认收起。 */
      const allDone = segment.todos.length > 0 && segment.completedCount === segment.todos.length
      const [open, toggle] = useCollapse(sessionId, `plate:${segment.key}`, current && allDone !== true)
      /**
       * 面板正文：**只写「哪些已完成」**（用户要求），不再写「本次变化（X ✓ · Y ▶）」那种对比说明。
       * 逐项列表本身带着状态点与状态徽标，所以这一行只是把「这一版里已经完成的部分」点名出来。
       */
      const done = segment.todos.filter((todo) => todo.status === 'completed').map((todo) => todo.content)
      const body = []
      if (done.length > 0) {
        body.push(h('div', { key: 'done', className: 'dcf-change' }, t('flow.tasksDone', { text: done.join(' · ') })))
      }
      for (const todo of segment.todos) {
        // 显示状态：被接管的旧版里那一项不再是「进行中」，而是「已停止」。
        const status = displayStatusOf(segment, todo.status)
        body.push(
          h(
            'div',
            { key: `item:${todo.content}`, className: 'dcf-taskrow', 'data-status': status },
            h(TaskDot, { status, stalled: current && unfinished === true }),
            h('span', { className: 'dcf-tasktitle' }, todo.content),
            h('span', { className: 'dcf-badge' }, statusText(t, status)),
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
     * 「当一个任务或一个节点完成后自动折叠」）。更早分段的折叠体没有理由继续摊开；
     * 唯一例外是「回合结束但没做完」——那时保持展开，让用户一眼看到它停在哪一步。
     *
     * ⚠️ **被后续列表接管的旧分段一律不展开**（`segment.superseded`）：即使那一项在后续列表里
     * 仍然是 `in_progress`（同一次任务跨了多版列表），展开的也应该是**最新那一版**——
     * 否则同一个任务会同时摊开好几个折叠体（用户报告过「从头至尾老的任务列表都在第一步」）。
     *
     * @param props - `segment`、`t`、`sessionId`、`labels`、`live`、`unfinished`、`subagents`、`seat`。
     * @returns 子任务折叠体；该分段没有进行中的任务时返回 `null`。
     */
    function TaskFold({ segment, t, sessionId, labels, live, unfinished, subagents, seat, liveKey }) {
      const current = segment.superseded !== true
      const [open, toggle] = useCollapse(
        sessionId,
        `task:${segment.key}`,
        current && segment.isCurrentTask === true && (live === true || unfinished === true),
      )
      if (segment.activeTask === null) return null
      /** 被接管的旧分段里，这一项也显示成「已停止」（内容冻结，运行状态跟最新列表走）。 */
      const status = displayStatusOf(segment, 'in_progress')
      return h(
        'div',
        { className: 'dcf-task' },
        h(
          'button',
          {
            type: 'button',
            className: 'dcf-taskrow',
            'data-status': status,
            'aria-expanded': open === true,
            onClick: toggle,
          },
          h(Chevron, { open }),
          h(TaskDot, { status, stalled: current && unfinished === true }),
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
      // 「任务过程」：**进行中默认展开，并且此时不允许关闭**（用户要求「任务过程中默认展开，
      // 任务完成了以后才允许关闭这个节点」）；任务结束后默认收起，用户可以自由开合（选择被记住）。
      // 回合结束但没做完的任务、以及「正在做的那一项」仍然在折叠体里，靠头上的「被打断」标记提示。
      const unfinished = group.unfinished === true && live !== true
      // 折叠状态键用 `group.key`（同一回合里可能因为插队消息而有多个分组，见 deriveFlow）。
      const [storedStageOpen, toggleStage] = useCollapse(sessionId, `stage:${group.key}`, false)
      const stageOpen = live === true ? true : storedStageOpen
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
        // 用户说的话永远在最外层（`NativeNodeRow` 直接在回合块里，不进任何折叠体）。
        // 插队消息额外挂一个「插队」标记：同一个回合里出现第二个气泡时，读者要知道它是怎么来的。
        children.push(
          h(NativeNodeRow, {
            key: 'ask',
            node: group.input,
            row: inputRow,
            seat,
            t,
            sessionId,
            labels,
            marker: group.inputKind === 'steering' ? t('flow.steering') : null,
          }),
        )
      }

      // ---- 折进「任务过程」的部分：动手之前的规划段 + 每段的任务列表快照 + 子任务 + 过程明细 ----
      const stage = []
      if (group.planned && group.planNodes.length > 0) {
        /**
         * 「规划过程」不再单独成折叠体（用户要求「移除掉规划过程，全部算任务过程里面」）：
         * 首个 `todo_write` 之前的那一段（想过什么、说过什么）**排在任务过程的最前面**，
         * 与快照面板、子任务、过程明细同一个折叠体。
         *
         * ⚠️ 这里**不传 `mode`/`summary`**：规划段在定义上早于任何分段，永远不可能是本回合的收尾汇报，
         * 若跟着 `summary` 逻辑跳过最后一段正文，那一段就会从界面上彻底消失。
         */
        stage.push(
          h(NodeSequence, {
            key: 'plan-sequence',
            nodes: group.planNodes,
            blockKey: `proc:plan:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
            liveKey: group.liveKey,
            subagents: group.subagents,
            seat,
          }),
        )
      }
      if (group.planned) {
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
                subagents: group.subagents,
                seat,
              }),
            )
          }
        }
      }
      const tailNodes = group.planned ? group.closing : group.looseNodes
      /**
       * 任务是否已经结束。
       *
       * 它是「过程里穿插的正文放哪儿」的开关（用户要求）：任务结束时，**最后一段正文**才是
       * 「任务结束时对用户的汇报」，留在最外层；其余（包括跑动中穿插写的那些正文）全部收进任务过程。
       */
      const closed = group.closed === true
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
          subagents: group.subagents,
          mode: 'inside',
          summary: closed,
          seat,
        }),
      )
      children.push(
        h(DisclosureLine, {
          key: 'stage',
          open: stageOpen,
          onToggle: toggleStage,
          // 跑动中**不允许关闭**：`locked` 让折叠头退化成静态行（点不动），完成后恢复成按钮。
          locked: live === true,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.stage'),
          summary: stageSummary,
          trailing: unfinished
            ? h(StatusChip, { tone: 'warn', text: t('flow.status.unfinished') })
            : null,
        }, stage),
      )

      // ---- 留在最外面的部分：**只有任务结束时的那一段汇报**（任务没结束就什么都不放外面）----
      if (closed) {
        children.push(
          h(NodeSequence, {
            key: 'stage-summary',
            nodes: tailNodes,
            blockKey: `summary:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
            liveKey: group.liveKey,
            subagents: group.subagents,
            mode: 'summary',
            seat,
          }),
        )
      }

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
    }    /* ──────────────────────────── 右侧回合导轨 ──────────────────────────── */

    /**
     * 把导轨滚到最底部（当前回合就在最后一格）。
     *
     * 导轨自己是个可滚容器（刻度多了要溢出），但它不跟阅读视口联动：**默认停在顶部**，
     * 于是高亮在最后几格时用户什么也看不见。所以挂载与刻度数变化时主动滚到底。
     * 只在这一刻滚，之后用户手动滚动不被抢（阅读时导轨跟着视口跳会很烦）。
     *
     * @param rail - `.dcf-rail` 元素（滚动容器）。
     */
    function scrollRailToBottom(rail) {
      if (rail === null || rail === undefined) return
      rail.scrollTop = rail.scrollHeight
    }

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
     * 刻度里写**回合号数字**（用户要求：不要光秃秃的横线，刻度要能读出「这是第几轮」）：
     * 用户说的「第 N 轮」与这里的数字是同一个数，所以点击/无障碍文案都不用换算。
     * 加载中（`data-busy`）时数字让位给转圈——那一格正在等翻页，读数没有意义。
     *
     * 只有一个刻度时也渲染（它可能是唯一的一个未加载刻度）。没有可跳目标时返回 `null`。
     *
     * @param props - `items`、`activeTurn`、`liveTurn`、`busyTurn`、`onJump`、`t`。
     * @returns 导轨。
     */
    function TurnRail({ items, activeTurn, liveTurn, busyTurn, onJump, t }) {
      const railRef = useRef(null)
      const count = Array.isArray(items) ? items.length : 0

      // 挂载与刻度数变化时滚到底：默认高亮是最后一轮，滚在顶部就看不见它。
      useEffect(() => {
        scrollRailToBottom(railRef.current)
      }, [count])

      if (!Array.isArray(items) || items.length === 0) return null
      // 只有一个刻度且它已加载 = 没有可跳的目标（也没有更早的历史），不渲染。
      if (items.length < 2 && items.every((item) => item.loaded === true)) return null
      return h(
        'div',
        { className: 'dcf-rail-slot' },
        h(
          'div',
          { className: 'dcf-rail', ref: railRef, role: 'navigation', 'aria-label': t('flow.rail') },
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
              h('span', { className: 'dcf-marknum' }, String(item.turn)),
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
     * 空列表常量。
     *
     * ⚠️ 必须是**同一个引用**：选择器返回新建的 `[]` 会让 `useSyncExternalStore` 每帧都判定
     * 「快照变了」，进而在滚动/流式渲染时反复重渲染甚至自激。
     */
    const EMPTY_LIST = []

    /** `useSessions` 缺席时的替身：同一个渲染位置永远只调一次、返回 undefined，hook 顺序不变。 */
    function noSessions() {
      return undefined
    }

    /**
     * 每秒走一格的实时时钟（只在 `active` 为真时走）。
     *
     * 用途是「任务耗时实时统计」：回合还在跑时显示 `now - startedAt`，从 0 分 0 秒开始往上加；
     * 回合结束后渲染层改用派生层算好的固定耗时，这个定时器随之停掉（effect 的清理函数）。
     *
     * @param active - 是否需要计时。
     * @returns 当前时间戳（毫秒）。
     */
    function useTick(active) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (active !== true) return undefined
        setNow(Date.now())
        if (typeof setInterval !== 'function') return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /**
     * 原生座位的**主人参数**（owner props）。
     *
     * 这些参数是核心 `ChatNodeSeat` 在 `renderSlot('conversation.chat.node', routedOwner, …)` 时
     * 交给原生叶子的（`dsh-client-ui-chat/lib/client.js:1509-1553`，逐项来源见
     * `docs/references/core-seams.md` §13）。本视图自己画层级，就必须把同样的参数补齐，
     * 否则原生叶子在真机上会因为拿不到 `openFile` / `fileMentions` / `renderMessageImages`
     * 而在事件回调里抛错（点一下文件名、展开一条带附件的消息都会踩到）。
     *
     * 三项刻意留空：
     * - `selectedCallId`：核心用它高亮「详情」侧栏里选中的调用，本视图没有那个侧栏；
     * - `turnProcess`：核心的「过程折叠」控制器，本插件用自己的任务阶段折叠替代它；
     * - `cwd` 取不到时留空，原生叶子按原样使用路径。
     *
     * @param props - 本视图收到的插槽 props。
     * @param sessionId - 本视图所属会话。
     * @returns `{owner, renderSlot}`：`owner` 给原生叶子，`renderSlot` 给原生座位。
     */
    function useNativeSeat(props, sessionId) {
      const { renderSlot, openFile, forkAt, fileMentions, loadImage, openView, useSessions } = props
      const useSessionsSafe = typeof useSessions === 'function' ? useSessions : noSessions
      const cwd = useSessionsSafe((state) => (state?.byId === undefined ? undefined : state.byId[sessionId]?.cwd))
      return useMemo(
        () => ({
          renderSlot,
          owner: {
            cwd,
            selectedCallId: undefined,
            turnProcess: undefined,
            /**
             * 核心的实现是 `openView('trajectory', callId)`（`ui-chat:2020-2022`），
             * `openView` 由 `conversation.session` 作为 owner prop 交给视图条目。
             */
            inspectCall: (callId) => {
              if (typeof openView === 'function') openView('trajectory', callId)
            },
            openFile: typeof openFile === 'function' ? openFile : () => Promise.resolve(),
            forkAt: typeof forkAt === 'function' ? forkAt : () => {},
            fileMentions: typeof fileMentions === 'function' ? fileMentions : () => undefined,
            // 与核心同一行语义：把 owner 原样转交消息图片插槽，并补上 loadImage（`ui-chat:2059-2062`）。
            renderMessageImages:
              typeof renderSlot === 'function'
                ? (target) => renderSlot(NATIVE_IMAGES_SLOT, { ...target, loadImage })
                : undefined,
          },
        }),
        [renderSlot, cwd, openView, openFile, forkAt, fileMentions, loadImage],
      )
    }

    /**
     * 跳到某个回合（一次对话）的开头。
     *
     * ⚠️ **必须只滚会话体（`[data-conversation-scroll]`），绝不能用 `scrollIntoView`**
     * （用户报告过：点最后一个刻度会让整个界面连输入框一起上移半屏）。
     *
     * 原因是 shell 的结构与 CSS（`core-seams.md §7.1`）：
     * - 真正的滚动宿主是 `div.scrollBody[data-conversation-scroll]`，它里面**既有视图区也有输入框座位**
     *   （`composerSeat`），输入框靠 `position: sticky; bottom: 0` 钉在容器底部；
     * - `scrollIntoView` 会滚动**所有**可滚动祖先——包括 `overflow: hidden` 的盒子（脚本仍可滚它），
     *   而 shell 在 composer 浮层态正是把 `.viewArea` 设成 `overflow: hidden`。
     *   于是浏览器把外层盒子一起滚了，`sticky` 的参照系随之改变，界面连同输入框整体上移。
     *
     * 核心自己也是这么做的：`landOnRow` 直接算 `el.scrollTop += flowTop(row, el) - 24`（`CHAT:2154-2165`）。
     * 系统开了「减少动态效果」时用瞬时跳转，与 CSS 里的动效收敛保持一致。
     *
     * @param root - 本视图根节点。
     * @param turn - 目标回合号。
     * @returns 无。
     */
    function jumpToTurn(root, turn) {
      if (root === null || root === undefined || typeof root.querySelector !== 'function') return
      const target = root.querySelector(`[data-turn-anchor="${turn}"]`)
      if (target === null || typeof target.getBoundingClientRect !== 'function') return
      const scroller = scrollerOfView(root)
      if (scroller === null || typeof scroller.scrollTop !== 'number') return
      const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - RAIL_LAND_OFFSET_PX
      if (delta === 0) return
      const reduced =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      const top = Math.max(0, scroller.scrollTop + delta)
      // `scrollTo` 支持平滑滚动，而且作用域就是这个元素——不会再牵扯外层盒子。
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
        return
      }
      scroller.scrollTop = top
    }

    /**
     * 本视图所在的**会话滚动宿主**：`[data-conversation-scroll]`（shell 的 scrollBody）。
     *
     * 取不到时退化成父元素/自身：这样在测试与非常规装配下也拿得到一个可滚的盒子，
     * 而不是把动作交给 `scrollIntoView` 去滚整个文档。
     *
     * @param root - 本视图根节点。
     * @returns 滚动宿主，或 `null`。
     */
    function scrollerOfView(root) {
      if (root === null || root === undefined) return null
      const found = typeof root.closest === 'function' ? root.closest('[data-conversation-scroll]') : null
      return found ?? root.parentElement ?? root
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
    function FlowBody(props) {
      const { sessionId, useChat, useSession, useProjection, t, loadOlder, loadThrough } = props
      const rootRef = useRef(null)
      const snapshot = useChat(identitySelector)
      const flow = useMemo(() => deriveFlow(snapshot), [snapshot])
      const labels = useMemo(() => markdownLabels(t), [t])
      const session = useSession(identitySelector)
      const seat = useNativeSeat(props, sessionId)

      /**
       * 还没进入对话的用户消息（DSH 的「插队发送」/ 排队）。
       *
       * 选择器返回的必须是**稳定引用**（`state.queue` 本身或共享的空数组），否则 uSES 会自激。
       */
      const inbox = useSession((state) => (Array.isArray(state?.queue) ? state.queue : EMPTY_LIST))
      const submissions = useSession((state) =>
        Array.isArray(state?.pendingSubmissions) ? state.pendingSubmissions : EMPTY_LIST,
      )
      const pendingSeats = useMemo(() => pendingSeatsOf(inbox, submissions, snapshot), [inbox, submissions, snapshot])

      const running = session?.running === true
      /** 实时时钟：只有在跑的时候才每秒走一格（结束的回合用派生层算好的固定耗时）。 */
      const now = useTick(running)
      /**
       * 已加载的回合号（去重）。
       *
       * 同一个回合里可能因为**插队消息**而有多个分组（见 `deriveFlow`），导轨只需要一个刻度，
       * 所以这里去重；`liveTurn` 仍然按「最后一个分组」判定，但要用分组的 key 比较
       * （同一个回合里的前几个分组已经结束了，不该跟着一起算「正在跑」）。
       */
      const turns = useMemo(() => [...new Set(flow.turns.map((group) => group.turn))], [flow])
      const liveTurn = running && turns.length > 0 ? turns[turns.length - 1] : null
      const liveGroupKey = running && flow.turns.length > 0 ? flow.turns[flow.turns.length - 1].key : null
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
        // 首次挂载时让 rail 默认激活最后一个回合——视觉上「最末位始终是最新轮次」，
        // 与 rail 上 `data-active` 高亮配合，让用户一眼看到当前在最新回合。
        initialActiveTurn: turns.length > 0 ? turns[turns.length - 1] : null,
      })

      /**
       * 滚动行为：任务进行中切换 → 保持切出时的位置；任务结束后的首次切换 → 翻到最后。
       *
       * 规则：
       * - 任务还在跑：无论何时切换进来，都恢复切出时的滚动位置；
       * - 任务在用户离开期间结束（`running` 从 true 变 false，同时视图处于隐藏态）：
       *   首次切换回来时翻到最后（看到最新输出），之后恢复切出时的位置；
       * - 任务在用户正看着时结束（视图可见时 `running` 变 false）：直接翻到最后，不额外标记。
       *
       * 判据用 `session?.running`（DSH 的会话运行态），不是 `flow.status`（本插件派生）。
       * `visibilitychange` 覆盖：切换标签页、最小化窗口、切换到别的 DSH 视图（对话/任务标签）。
       * `beforeunload` 覆盖：刷新、关闭页面。
       *
       * sessionStorage 按 sessionId 隔离（同一会话的多个标签页共享位置）。
       */
      const SS_SCROLL = `dsh-chat-flow.scroll.${sessionId}`
      const SS_ENDED_AWAY = `dsh-chat-flow.ended-away.${sessionId}`

      /** 记住上一个 `running` 值，用来判断「离开期间状态是否变了」。 */
      const prevRunningRef = useRef(running)

      /** 记住视图在「离开」前是否可见（不在可见态时不重复翻）。 */
      const wasVisibleRef = useRef(false)

      // 首次挂载：从 sessionStorage 恢复滚动位置（仅在任务已结束时才需要翻到底）。
      useEffect(() => {
        const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
        if (scroller === null) return
        const endedAway = sessionStorage.getItem(SS_ENDED_AWAY) === '1'
        if (endedAway) {
          // 首次进来时任务已结束（用户刷新了页面或跨标签页回来）→ 翻到底
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
          sessionStorage.removeItem(SS_ENDED_AWAY)
        }
        const saved = sessionStorage.getItem(SS_SCROLL)
        if (saved !== null) {
          const pos = Number(saved)
          if (Number.isFinite(pos)) scroller.scrollTop = pos
        }
      }, []) // eslint-disable-line react-hooks/exhaustive-deps

      // 监听：离开时记录位置，回来时决定是翻到底还是恢复位置。
      useEffect(() => {
        const handleLeave = () => {
          const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
          if (scroller !== null) sessionStorage.setItem(SS_SCROLL, String(scroller.scrollTop))
          // 如果在视图隐藏期间任务结束，下次回来要翻到底
          if (document.visibilityState !== 'visible' && running === true) {
            sessionStorage.setItem(SS_ENDED_AWAY, '1')
          }
          wasVisibleRef.current = false
        }

        const handleActivate = () => {
          const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
          const endedAway = sessionStorage.getItem(SS_ENDED_AWAY) === '1'

          if (endedAway) {
            // 任务在离开期间结束了 → 翻到底
            if (scroller !== null) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
          } else {
            // 任务还在跑（或在可见时已结束）→ 恢复切出时的位置
            const saved = sessionStorage.getItem(SS_SCROLL)
            if (saved !== null && scroller !== null) {
              const pos = Number(saved)
              if (Number.isFinite(pos)) scroller.scrollTop = pos
            }
          }
          wasVisibleRef.current = true
        }

        const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            handleActivate()
          } else {
            handleLeave()
          }
        }

        const handleBeforeUnload = () => {
          handleLeave()
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange)
          window.removeEventListener('beforeunload', handleBeforeUnload)
        }
      }, [running, sessionId])

      // `running` 从 true 变 false：在可见态下任务结束 → 直接翻到底
      useEffect(() => {
        if (prevRunningRef.current === true && running === false && wasVisibleRef.current === true) {
          const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
          if (scroller !== null) {
            scrollViewToBottom(scroller)
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
          }
        }
        prevRunningRef.current = running
      }, [running])

      /**
       * 快速回到底部按钮（`FloatingScrollButton`）。
       *
       * 逻辑：滚动宿主滚动超过 300px 时显示按钮；点击后滚动到最底部。
       * 只在任务进行中显示（结束后不需要快速回底，用户已能看到最新内容）。
       */
      const [showBottomBtn, setShowBottomBtn] = useState(false)

      /**
       * 会话列表快照：用来发现「已经被删掉的会话」。
       *
       * 核心没有会话删除事件，`useSessions` 是唯一可用的接缝（标准 props，官方 standardProps 清单里）。
       * 选择器返回整张快照而不是 `ids` 数组——返回新数组会让 uSES 自激。
       */
      const useSessionsSafe = typeof props.useSessions === 'function' ? props.useSessions : noSessions
      const sessionList = useSessionsSafe((state) => state)

      // 滚动监听：跟踪是否已远离底部（判据见 `isAwayFromBottom`）。
      useEffect(() => {
        const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
        if (scroller === null) return undefined
        const handleScroll = () => setShowBottomBtn(isAwayFromBottom(scroller))
        scroller.addEventListener('scroll', handleScroll, { passive: true })
        handleScroll()
        return () => scroller.removeEventListener('scroll', handleScroll)
      }, [running])

      /**
       * 会话被删除时，把本插件给那个会话留下的数据一起带走（localStorage 折叠状态 + sessionStorage 滚动记录）。
       *
       * 判据是「存储里有键、会话列表里没这个 id」（`staleSessionIds`），列表为空时不动手
       * （重连重拉会让列表短暂变空，那不是删除）；当前正在看的这个会话永远排除在外，
       * 因为刚建的空会话可能还没进列表。
       */
      useEffect(() => {
        const ids = sessionList?.ids
        if (!Array.isArray(ids)) return
        const alive = new Set(ids)
        alive.add(sessionId)
        for (const stale of staleSessionIds(window, alive)) purgeSessionData(stale, window)
      }, [sessionList, sessionId])

      /**
       * 快速回到底部按钮：固定在右下角，圆形箭头图标。
       * 视觉上在 rail 左侧，不遮挡内容。
       */
      const scrollToBottomButton = showBottomBtn && running === true
        ? h(
            'button',
            {
              key: 'scroll-to-bottom',
              type: 'button',
              className: 'dcf-scroll-bottom-btn',
              'aria-label': t('flow.scrollToBottom'),
              title: t('flow.scrollToBottom'),
              onClick: () => {
                const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
                scrollViewToBottom(scroller)
              },
            },
            h(
              'svg',
              {
                viewBox: '0 0 16 16',
                width: 16,
                height: 16,
                fill: 'currentColor',
                'aria-hidden': 'true',
              },
              h('path', { d: 'M8 12L2 6h3V2h6v4h3L8 12z' }),
            ),
          )
        : null

      const main = []
      if (session?.hasMore === true || session?.loadingOlder === true) {
        // 加载中显示动画而不是按钮：用户不需要点，滚到顶部就会自动开始加载。
        main.push(
          session.loadingOlder === true
            ? h(
                'div',
                { key: 'loading-older', className: 'dcf-loading', 'data-dcf-load-anchor': 'true' },
                h('span', { className: 'dcf-spinner' }),
                h('span', null, t('flow.loadingLocked')),
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
            live: group.key === liveGroupKey,
            seat,
            now,
          }),
        )
      }
      // 还没进入对话的用户消息（插队 / 排队）：它们在节点树里还不存在，必须由视图自己显示，
      // 否则「我明明发了消息」在任务视图里看不到任何反应（核心在对话流末尾渲染同样这两串）。
      for (const pending of pendingSeats) {
        main.push(h(PendingBubble, { key: `pending:${pending.key}`, seat: pending, t }))
      }

      return h(
        'div',
        { className: 'dcf-root', ref: rootRef, 'data-chat-flow-owner': 'dsh-chat-flow' },
        h(TurnRail, { items: railItems, activeTurn, liveTurn, busyTurn, onJump, t }),
        scrollToBottomButton,
        h('div', { className: 'dcf-main' }, main),
      )
    }

    /**
     * 还没进入对话的那条用户消息（插队 / 排队 / 本地回显）。
     *
     * 三种状态各有一句话说明，这是用户要求「处理好插队发送消息的状态」的落点：
     * 消息不会再「发出去就没影了」——它在列表末尾有一个座位，并被明确标成「插队待处理」或「排队中」。
     *
     * `data-pending-steering` 是核心约定（它的待发送座位带这个属性，`CHAT:1224-1237`），
     * 外部的回退插件也按它找待发送座位（`dsh-rewind-plugin/lib/client.js:1114`）。
     *
     * @param props - `seat`（`{kind, key, text}`）、`t`。
     * @returns 待发送气泡行。
     */
    function PendingBubble({ seat, t }) {
      const steering = seat.kind === 'steering'
      return h(
        'div',
        {
          className: 'dcf-leaf dcf-pending',
          'data-pending-steering': steering === true ? 'true' : undefined,
          'data-submission-echo': steering === true ? undefined : 'true',
        },
        h(UserBubble, { text: seat.text, t }),
        h(
          'div',
          { className: 'dcf-pendingstate' },
          h(StatusChip, {
            tone: steering === true ? 'live' : 'muted',
            text: t(steering === true ? 'flow.pending.steering' : 'flow.pending.queued'),
          }),
        ),
      )
    }

    /**
     * 视图层错误边界：本插件自己这一侧的渲染错误**不再让整块视图让位**。
     *
     * 为什么必须有：本条目崩溃会被插槽判定为「让位」（`RENDERER:519-533` 的 abdicate），
     * 结果是整块对话区变成 `data-slot-error` 一直到刷新——用户看到的就是「任务视图莫名变白」。
     * 有了这一层，出错时只把错误摘要画出来（并留 `console.warn` 线索），视图其余部分与标签栏都还在。
     *
     * 注意：它接不住**事件回调与副作用里**抛出的错误（React 边界的固有限制），
     * 所以派生层与渲染层的取值一律写成防御式的。
     */
    class ViewBodyBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, message: '' }
      }

      static getDerivedStateFromError(error) {
        return { failed: true, message: error instanceof Error ? error.message : String(error) }
      }

      componentDidCatch(error) {
        console.warn('[chat-flow] 任务视图渲染失败，已降级为错误摘要（不再让整块视图让位）：', error)
      }

      render() {
        if (this.state.failed !== true) return this.props.children
        const t = typeof this.props.t === 'function' ? this.props.t : (key) => key
        return h(
          'div',
          { className: 'dcf-error', 'data-dcf-error': this.state.message },
          h('div', { className: 'dcf-errortitle' }, t('flow.error.title')),
          h('pre', { className: 'dcf-pre' }, this.state.message),
          h('div', { className: 'dcf-note' }, t('flow.error.hint')),
        )
      }
    }

    /**
     * 任务视图：`conversation.view` 的条目组件。
     *
     * 这一层只做两件事：能力探测（`useChat` 是 ui-chat 提供的，缺了就给空态而不是抛异常）
     * 与**错误边界**（自己的渲染错误降级成错误摘要，别让整块视图让位）。
     *
     * @param props - 插槽 kit + owner props。
     * @returns 任务视图。
     */
    function TaskFlowView(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const ready = typeof props.useChat === 'function' && typeof props.useSession === 'function'
      if (!ready) return h('div', { className: 'dcf-empty' }, t('flow.empty'))
      return h(ViewBodyBoundary, { t }, h(FlowBody, { ...props, t }))
    }
    /* ──────────────────────────── 滚动行为 ──────────────────────────── */

    /** 距顶部多少像素以内算「触顶」。留一点余量，滚轮惯性到不了 0 也能触发。 */
    const TOP_LOAD_THRESHOLD_PX = 64

    /**
     * 距底部多少像素以内算「还在底部」。
     *
     * 超过它才需要「快速回到底部」按钮：几百像素的余量让「差一点点到底」不弹按钮，
     * 免得正常阅读时按钮一直闪。
     */
    const BOTTOM_THRESHOLD_PX = 300

    /**
     * 视口离开底部了吗（够不够格显示「快速回到底部」按钮）。
     *
     * 单独成函数是为了能直接测：按钮本身的显隐要靠真实的 scroll 事件，
     * 而滚动事件在 node 侧没有 DOM 就没有，判据却可以逐条断言。
     *
     * @param scroller - 滚动宿主（只看 `scrollTop` / `scrollHeight` / `clientHeight`）。
     */
    function isAwayFromBottom(scroller) {
      if (scroller === null || scroller === undefined) return false
      return scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - BOTTOM_THRESHOLD_PX
    }

    /**
     * 平滑滚到最底部。
     *
     * 「快速回到底部」按钮与「任务结束后自动跟到底」共用这一处：
     * 两处各写一遍 `scrollTo` 的话，改行为（比如换成 `auto`）必然会漏掉一处。
     *
     * @param scroller - 滚动宿主；为 `null` 时什么都不做（滚动宿主还没绑上去）。
     */
    function scrollViewToBottom(scroller) {
      if (scroller === null || scroller === undefined) return
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    }

    /** 行相对滚动宿主的位置：与页面整体滚动无关（核心 `flowTop` 同义，`CHAT:1895-1897`）。 */
    function flowTopOf(row, scroller) {
      return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    }

    /** 按节点 key 找已渲染的行（核心 `anchorElement` 同义，`CHAT:1867-1870`）。 */
    function anchorRowOf(root, key) {
      if (key === null || key === '') return null
      for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
        if (row.getAttribute('data-chat-anchor-key') === key) return row
      }
      return null
    }

    /**
     * 选一个稳定的锚点行：**视口顶部往下第一个可见节点行**（找不到就退化成第一行）。
     *
     * 为什么锚在「节点行」而不是「回合块」：加载历史时回合块会被整段重排，而节点行带
     * `data-chat-anchor-key`（核心同款属性），前插之后仍然唯一存在，才能把阅读位置钉回去。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @returns `{key, top}`，或没有任何节点行时 `null`。
     */
    function visibleAnchorOf(root, scroller) {
      const hostTop = scroller.getBoundingClientRect().top
      let first = null
      for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
        const key = row.getAttribute('data-chat-anchor-key')
        if (key === null || key === '') continue
        const top = flowTopOf(row, scroller)
        if (first === null) first = { key, top }
        if (row.getBoundingClientRect().top - hostTop >= 0) return { key, top }
      }
      return first
    }

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
     * @param options - `turns`（回合号数组）、`hasMore`、`loadingOlder`、`loadOlder`、`firstSeq`。
     * @returns `{activeTurn, busyTurn, onJump}`：当前视口顶部所在回合、正在加载的刻度、刻度点击。
     */
    function useScroller(rootRef, options) {
      const {
        turns = [],
        hasMore,
        loadingOlder,
        loadOlder,
        loadThrough,
        firstSeq,
        /**
         * 初始激活的回合号（由外层指定，如「rail 默认滚到底部」）。
         * 有值时：初始 `activeTurn` 直接用它；首次 measure 跳过（避免把顶部回合误设为激活）。
         */
        initialActiveTurn = null,
      } = options
      const [activeTurn, setActiveTurn] = useState(initialActiveTurn)
      const [busyTurn, setBusyTurn] = useState(null)
      const [pendingJump, setPendingJump] = useState(null)
      const [settleTick, setSettleTick] = useState(0)
      /** 已用过 initialActiveTurn → 后续全走 measure。 */
      const usedInitialRef = useRef(initialActiveTurn !== null)
      /** 每次渲染刷新一次的最新值快照：事件监听只装一次，但要读到最新状态。 */
      const latest = useRef(options)
      latest.current = options
      const scrollerRef = useRef(null)
      const armedRef = useRef(true)
      const anchorRef = useRef(null)
      /** 上一个窗口头 seq：只有它变小（真的前插了）才做锚定补偿（核心同款，`CHAT:2227`）。 */
      const firstSeqRef = useRef(null)
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
          // 记下**前插之前**的阅读锚点（节点行 + 它在滚动口里的位置），前插落地后按它补偿。
          anchorRef.current = visibleAnchorOf(root, scroller)
          state.loadOlder()
        }

        // 有 initialActiveTurn 时首次不 measure：外层已经把激活回合定死在最后一个（导轨默认滚到底），
        // 这里再量一次会把**顶部的**回合误设成激活。之后再绑定时正常 measure。
        if (usedInitialRef.current === true) measure()
        else usedInitialRef.current = true
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
          scroller.removeEventListener('scroll', onScroll)
          scrollerRef.current = null
          if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        }
      }, [rootRef])

      /**
       * 前插之后把阅读位置钉回原处（见上文第 3 点）。
       *
       * **触发条件是「窗口头真的往前挪了」**（`firstSeq` 变小），而不是「渲染了一次」：
       * 这正是核心的做法（`CHAT:2227-2231`：`anchorRef !== null && firstSeq < firstSeqRef.current`）。
       * 早期版本一渲染就把锚点消费掉，于是「加载开始」那一刻就把锚点清了，
       * 等内容真正前插进来时已经没有锚点可用——用户看到的就是**加载完页面跳一下**。
       *
       * 一页加载可能包含多页（`loadThrough` 会循环），所以补偿之后如果还在加载中，
       * 就按当前位置重新记一次锚点，让下一批前插继续钉住同一个节点。
       */
      useEffect(() => {
        const firstSeq = options.firstSeq
        const previous = firstSeqRef.current
        const anchor = anchorRef.current
        if (anchor !== null && firstSeq !== null && previous !== null && firstSeq < previous) {
          const root = rootRef.current
          const scroller = scrollerRef.current
          if (root !== null && root !== undefined && scroller !== null) {
            const row = anchorRowOf(root, anchor.key)
            if (row !== null) {
              const delta = flowTopOf(row, scroller) - anchor.top
              if (delta !== 0) scroller.scrollTop += delta
              anchorRef.current =
                options.loadingOlder === true ? { key: anchor.key, top: flowTopOf(row, scroller) } : null
            } else {
              anchorRef.current = null
            }
          }
        }
        firstSeqRef.current = firstSeq
      }, [rootRef, options.firstSeq, options.loadingOlder])

      /**
       * 分页期间**把页面钉住**（用户要求「加载过程中不要发生跳变，可以不允许滚动操作」）。
       *
       * 做法是每帧把锚点行拉回它被记录时的视口位置：内容前插造成的位移被立刻补掉，
       * 用户在这几帧里的滚动输入也会被同一帧纠回，于是页面在加载期间看起来是**冻住**的；
       * `loadingOlder` 落回 false 时 effect 清理，一切交还用户。
       *
       * 为什么不用 `overflow: hidden` 去锁滚动条：那是 shell 的滚动容器，隐藏溢出会让经典滚动条
       * 消失、内容宽度变化十几个像素，反而制造一次横向跳动；逐帧钉住没有任何布局副作用。
       */
      useEffect(() => {
        if (options.loadingOlder !== true) return undefined
        if (typeof requestAnimationFrame !== 'function') return undefined
        let frame = 0
        const pin = () => {
          frame = requestAnimationFrame(pin)
          const root = rootRef.current
          const scroller = scrollerRef.current
          const anchor = anchorRef.current
          if (root === null || root === undefined || scroller === null || anchor === null) return
          const row = anchorRowOf(root, anchor.key)
          if (row === null) return
          const delta = flowTopOf(row, scroller) - anchor.top
          if (delta !== 0) scroller.scrollTop += delta
        }
        frame = requestAnimationFrame(pin)
        return () => cancelAnimationFrame(frame)
      }, [rootRef, options.loadingOlder])

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
          const scroller = scrollerRef.current
          if (root !== null && root !== undefined && scroller !== null) {
            anchorRef.current = visibleAnchorOf(root, scroller)
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
     * **视图内容分两层**：
     * - **层级是插槽的**：回合分组 / 任务阶段折叠 / 任务列表快照 / 子任务 / 右侧导轨，全部由本插件画；
     * - **叶子是核心的**：每一行节点都经 `renderSlot('conversation.chat.node', …)` 交给核心的原生
     *   条目渲染（命令卡、差异块、读取块、搜索块、提问卡、思考行…），只有座位缺席或渲染失败时才
     *   退化成自绘叶子（见 `lib/client/55-native.js`）。
     *
     * 声明 `children` 有两层作用：一是渲染器**只有看到 children 才会给出 `renderSlot`**
     * （`dsh-client-ui-renderer/lib/client.js:613-621`），二是顺带拿到会话作用域的 `SessionProvider`。
     * 详见 {@link nativeViewChildren} 里的注释（含核心行号依据）。
     *
     * **为什么用独立 id（不再遮蔽核心「对话」）**：视图选择的 fallback 硬编码为
     * 「存储的偏好 → `id === 'chat'` → 否则不渲染」。遮蔽（同 id + 更低 priority）能让本视图
     * 成为默认，但核心条目仍在账本里，而标签栏读的正是账本 → 两个标签、两个都带激活下划线。
     * 核心**不允许注销别人的条目**，所以遮蔽必然留下重复标签；改用独立 id 后标签栏只有一个高亮，
     * 原生「对话」仍是默认，需要任务流时点「任务」标签（选择持久化）。
     *
     * @param ctx - 客户端插件上下文。
     * @returns 无。
     */function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'chat-flow: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: TAB_VIEW_ID,
            order: TAB_VIEW_ORDER,
            label: () => t('view.flow'),
            locale: NS,
            children: nativeViewChildren(),
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
              // 原生叶子需要的主人/注入能力（openFile / loadImage / fileMentions / forkAt）。
              ...nativeSeatFace(ctx, sessionId),
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
      TAB_VIEW_ID,
      TAB_VIEW_ORDER,
      NS,
      ZH,
      EN,
      NATIVE_NODE_SLOT,
      NATIVE_IMAGES_SLOT,
      OWN_SEAT_SLOT,
      OWNED_NODE_KINDS,
      nativeViewChildren,
      nativeSeatFace,
      resolveSeatPath,
      turnDataOfNode,
      turnOfChatNode,
      seatNodesOf,
      rowModelsOf,
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
      nodeRowOf,
      groupProcessNodes,
      cutOffOf,
      observedRpcIdsOf,
      pendingSeatsOf,
      nodeRunsOf,
      isTopLevelNode,
      deriveFlow,
      orderedNodes,
      todosOfToolCall,
      diffTodos,
      assistantTextOf,
      formatDuration,
      markdownLabels,
      terminalLabels,
      installStyles,
      jumpToTurn,
      TOP_LOAD_THRESHOLD_PX,
      BOTTOM_THRESHOLD_PX,
      isAwayFromBottom,
      scrollViewToBottom,
      SESSION_KEY_PREFIXES,
      purgeSessionData,
      staleSessionIds,
      useScroller,
      useTick,
      mergeRailItems,
      scrollRailToBottom,
      FLOW_CSS,
      views: {
        TaskFlowView,
        FlowBody,
        ViewBodyBoundary,
        TurnGroup,
        TurnRail,
        SnapshotPlate,
        TaskFold,
        ThinkingBlock,
        NodeSequence,
        PendingBubble,
        NativeSeat,
        NativeNodeRow,
        ChatFlowLeaf,
        ContextFold,
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
