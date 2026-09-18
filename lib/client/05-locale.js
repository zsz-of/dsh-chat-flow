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
      'flow.thinking.done': '思考完成',
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
